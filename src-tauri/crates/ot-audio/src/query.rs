//! Read-only, frame-addressed waveform engine. WFM2 is a disposable local cache.
use super::*;
use rustix::fs::{openat, renameat, unlinkat, AtFlags, Mode, OFlags, CWD};
use std::collections::HashMap;
use std::io::{Cursor, SeekFrom};
use symphonia::core::formats::{SeekMode, SeekTo};

const MAGIC: &[u8; 8] = b"WFM2\r\n\x1a\n";
const BASE: u64 = 64;
const CHUNK: u64 = 256;
const RECORD: u64 = 24;
const LIMIT: u64 = 256 * 1024 * 1024;
const MAX_FRAMES: u64 = 9_007_199_254_740_991;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FrameRange {
    pub start_frame: u64,
    pub end_frame_exclusive: u64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WaveformQuery {
    pub start_frame: u64,
    pub end_frame_exclusive: u64,
    pub target_points: usize,
    pub channel_mode: ChannelMode,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ChannelMode {
    Separate,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WaveformMetadata {
    pub sample_rate: u32,
    pub channel_count: u16,
    pub total_frames: u64,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct QueryPeak {
    pub min: f32,
    pub max: f32,
    pub rms: f64,
    pub frame_count: u64,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct QueryChannel {
    pub channel_index: u16,
    pub peaks: Vec<QueryPeak>,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WaveformResponseV2 {
    pub schema: &'static str,
    pub analyzer_version: &'static str,
    #[serde(flatten)]
    pub metadata: WaveformMetadata,
    pub range: FrameRange,
    /// P + 1 integer frame boundaries. Empty buckets are forbidden.
    pub bucket_boundaries: Vec<u64>,
    pub channels: Vec<QueryChannel>,
}

#[derive(Clone, Copy, Debug)]
struct Bucket {
    min: f32,
    max: f32,
    sum_squares: f64,
    count: u64,
}
impl Default for Bucket {
    fn default() -> Self {
        Self {
            min: 1.0,
            max: -1.0,
            sum_squares: 0.0,
            count: 0,
        }
    }
}
impl Bucket {
    fn push(&mut self, value: f32) {
        self.min = self.min.min(value);
        self.max = self.max.max(value);
        self.sum_squares += f64::from(value).powi(2);
        self.count += 1;
    }
    fn merge(&mut self, child: Self) {
        if child.count == 0 {
            return;
        }
        self.min = self.min.min(child.min);
        self.max = self.max.max(child.max);
        self.sum_squares += child.sum_squares;
        self.count += child.count;
    }
    fn peak(self) -> QueryPeak {
        QueryPeak {
            min: self.min,
            max: self.max,
            rms: (self.sum_squares / self.count as f64).sqrt(),
            frame_count: self.count,
        }
    }
    fn encode(self, out: &mut Vec<u8>) {
        out.extend(self.min.to_le_bytes());
        out.extend(self.max.to_le_bytes());
        out.extend(self.sum_squares.to_le_bytes());
        out.extend(self.count.to_le_bytes());
    }
}

fn corrupt() -> AudioError {
    AudioError::CacheUnavailable("invalid WFM2 cache".into())
}
fn invalid() -> AudioError {
    AudioError::InvalidRequest("invalid frame range or target point count")
}
fn read_array<const N: usize>(r: &mut impl Read) -> Result<[u8; N], AudioError> {
    let mut b = [0; N];
    r.read_exact(&mut b).map_err(|_| corrupt())?;
    Ok(b)
}
fn u32le(r: &mut impl Read) -> Result<u32, AudioError> {
    Ok(u32::from_le_bytes(read_array(r)?))
}
fn u64le(r: &mut impl Read) -> Result<u64, AudioError> {
    Ok(u64::from_le_bytes(read_array(r)?))
}
fn channel_bytes(count: u64) -> u64 {
    count * RECORD + count.div_ceil(CHUNK) * 32
}

#[derive(Clone, Copy)]
struct Level {
    width: u64,
    count: u64,
    offset: u64,
}
struct CacheReader {
    file: File,
    metadata: WaveformMetadata,
    levels: Vec<Level>,
    chunks: HashMap<(usize, u16, u64), Vec<Bucket>>,
}
impl CacheReader {
    fn open(path: &Path, hash: &ContentHash) -> Result<Self, AudioError> {
        check_path(path, false)?;
        let mut file = secure_open(path, false)?;
        let size = file.metadata().map_err(cache_io)?.len();
        if !(148..=LIMIT).contains(&size) {
            return Err(corrupt());
        }
        let mut prefix = [0; 100];
        file.read_exact(&mut prefix).map_err(|_| corrupt())?;
        let mut r = Cursor::new(prefix);
        if &read_array::<8>(&mut r)? != MAGIC || u32le(&mut r)? != 2 || u32le(&mut r)? != 2 {
            return Err(corrupt());
        }
        if read_array::<64>(&mut r)?.as_slice() != &hash.as_str().as_bytes()[7..] {
            return Err(corrupt());
        }
        let sample_rate = u32le(&mut r)?;
        let channel_count = u16::try_from(u32le(&mut r)?).map_err(|_| corrupt())?;
        let metadata = WaveformMetadata {
            sample_rate,
            channel_count,
            total_frames: u64le(&mut r)?,
        };
        let count = u32le(&mut r)? as usize;
        if metadata.sample_rate == 0
            || !(1..=2).contains(&metadata.channel_count)
            || metadata.total_frames == 0
            || metadata.total_frames > MAX_FRAMES
            || !(1..=24).contains(&count)
        {
            return Err(corrupt());
        }
        let mut index = vec![0; count * 24];
        file.read_exact(&mut index).map_err(|_| corrupt())?;
        let mut digest = Sha256::new();
        digest.update(prefix);
        digest.update(&index);
        if digest.finalize().as_slice() != read_array::<32>(&mut file)? {
            return Err(corrupt());
        }
        let mut r = Cursor::new(index);
        let mut offset = 100 + count as u64 * 24 + 32;
        let mut width = BASE;
        let mut levels = Vec::new();
        for _ in 0..count {
            let level = Level {
                width: u64le(&mut r)?,
                count: u64le(&mut r)?,
                offset: u64le(&mut r)?,
            };
            if level.width != width
                || level.count != metadata.total_frames.div_ceil(width)
                || level.offset != offset
            {
                return Err(corrupt());
            }
            offset = offset
                .checked_add(
                    channel_bytes(level.count)
                        .checked_mul(u64::from(metadata.channel_count))
                        .ok_or_else(corrupt)?,
                )
                .ok_or_else(corrupt)?;
            if offset > LIMIT {
                return Err(corrupt());
            }
            width = width.checked_mul(4).ok_or_else(corrupt)?;
            levels.push(level);
        }
        if size != offset || levels.last().is_none_or(|level| level.count != 1) {
            return Err(corrupt());
        }
        Ok(Self {
            file,
            metadata,
            levels,
            chunks: HashMap::new(),
        })
    }
    fn bucket(&mut self, level: usize, channel: u16, index: u64) -> Result<Bucket, AudioError> {
        let info = self.levels[level];
        if index >= info.count {
            return Err(corrupt());
        }
        let chunk = index / CHUNK;
        let key = (level, channel, chunk);
        if !self.chunks.contains_key(&key) {
            let count = (info.count - chunk * CHUNK).min(CHUNK);
            let offset = info.offset
                + u64::from(channel) * channel_bytes(info.count)
                + chunk * (CHUNK * RECORD + 32);
            self.file.seek(SeekFrom::Start(offset)).map_err(cache_io)?;
            let mut bytes = vec![0; (count * RECORD) as usize];
            self.file.read_exact(&mut bytes).map_err(|_| corrupt())?;
            if Sha256::digest(&bytes).as_slice() != read_array::<32>(&mut self.file)? {
                return Err(corrupt());
            }
            let mut r = Cursor::new(bytes);
            let mut buckets = Vec::new();
            for i in 0..count {
                let bucket = Bucket {
                    min: f32::from_le_bytes(read_array(&mut r)?),
                    max: f32::from_le_bytes(read_array(&mut r)?),
                    sum_squares: f64::from_le_bytes(read_array(&mut r)?),
                    count: u64le(&mut r)?,
                };
                let expected_count =
                    (self.metadata.total_frames - (chunk * CHUNK + i) * info.width).min(info.width);
                if bucket.count != expected_count
                    || !bucket.min.is_finite()
                    || !bucket.max.is_finite()
                    || !bucket.sum_squares.is_finite()
                    || bucket.min < -1.0
                    || bucket.max > 1.0
                    || bucket.min > bucket.max
                    || bucket.sum_squares < 0.0
                    || bucket.sum_squares > bucket.count as f64
                {
                    return Err(corrupt());
                }
                buckets.push(bucket);
            }
            self.chunks.insert(key, buckets);
        }
        Ok(self.chunks[&key][(index % CHUNK) as usize])
    }
}

/// Descriptor-relative traversal rejects symlink swaps between validation and open.
fn secure_open(path: &Path, directory: bool) -> Result<File, AudioError> {
    use std::path::Component;
    if !path.is_absolute() {
        return Err(AudioError::UnsafeCachePath("audio path must be absolute"));
    }
    let mut fd = openat(
        CWD,
        "/",
        OFlags::RDONLY | OFlags::DIRECTORY | OFlags::CLOEXEC,
        Mode::empty(),
    )
    .map_err(|e| cache_io(e.into()))?;
    let components: Vec<_> = path.components().collect();
    for (index, component) in components.iter().enumerate() {
        match component {
            Component::RootDir => continue,
            Component::Normal(name) => {
                let flags = OFlags::RDONLY
                    | OFlags::NOFOLLOW
                    | OFlags::CLOEXEC
                    | OFlags::NONBLOCK
                    | if directory || index + 1 < components.len() {
                        OFlags::DIRECTORY
                    } else {
                        OFlags::empty()
                    };
                fd = openat(&fd, *name, flags, Mode::empty())
                    .map_err(|_| AudioError::UnsafeCachePath("audio path changed or is unsafe"))?;
            }
            _ => return Err(AudioError::UnsafeCachePath("invalid audio path component")),
        }
    }
    let file = File::from(fd);
    let metadata = file.metadata().map_err(cache_io)?;
    if (directory && !metadata.is_dir()) || (!directory && !metadata.is_file()) {
        return Err(AudioError::UnsafeCachePath(
            "audio path has an invalid file type",
        ));
    }
    Ok(file)
}

/// Check every path component, including a replaced cache directory. No source writes.
fn check_path(path: &Path, missing_leaf: bool) -> Result<(), AudioError> {
    for ancestor in path.ancestors() {
        match fs::symlink_metadata(ancestor) {
            Ok(m) if m.file_type().is_symlink() => {
                return Err(AudioError::UnsafeCachePath("symlink in audio/cache path"))
            }
            Ok(_) => {}
            Err(e)
                if missing_leaf && ancestor == path && e.kind() == std::io::ErrorKind::NotFound => {
            }
            Err(e) => return Err(cache_io(e)),
        }
    }
    Ok(())
}

#[derive(Clone, PartialEq, Eq)]
struct Stamp {
    length: u64,
    modified: Option<std::time::SystemTime>,
    #[cfg(unix)]
    identity: (u64, u64, i64, i64),
}
fn stamp(m: &fs::Metadata) -> Stamp {
    #[cfg(unix)]
    use std::os::unix::fs::MetadataExt;
    Stamp {
        length: m.len(),
        modified: m.modified().ok(),
        #[cfg(unix)]
        identity: (m.dev(), m.ino(), m.ctime(), m.ctime_nsec()),
    }
}

fn precise_change_tracking(file: &File) -> bool {
    #[cfg(target_os = "macos")]
    {
        // APFS supports nanosecond change timestamps. Never extend this allowlist
        // to removable/remote filesystems based on size/mtime equivalence.
        rustix::fs::fstatfs(file).is_ok_and(|fs| {
            let name: Vec<u8> = fs
                .f_fstypename
                .iter()
                .take_while(|c| **c != 0)
                .map(|c| *c as u8)
                .collect();
            name == b"apfs"
        })
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = file;
        false
    }
}

/// A hash-verified open source revision. On Unix, ctime detects metadata-preserving rewrites.
/// Other hosts rehash rather than trusting a size/mtime observation.
#[derive(Clone)]
struct Verified {
    stamp: Stamp,
    hash: String,
}

pub struct WaveformEngine {
    directory: PathBuf,
    directory_handle: File,
    generation: Mutex<()>,
    verified: Mutex<HashMap<PathBuf, Verified>>,
}
impl WaveformEngine {
    pub fn open(directory: PathBuf) -> Result<Self, AudioError> {
        ensure_real_directory(&directory)?;
        // Canonicalize only after checking the user-supplied leaf, allowing OS temp aliases.
        let directory = directory.canonicalize().map_err(cache_io)?;
        check_path(&directory, false)?;
        let directory_handle = secure_open(&directory, true)?;
        Ok(Self {
            directory,
            directory_handle,
            generation: Mutex::new(()),
            verified: Mutex::new(HashMap::new()),
        })
    }
    fn source(&self, path: &Path, hash: &ContentHash) -> Result<(File, Stamp), AudioError> {
        self.verified_source(path, hash, false)
    }
    fn verified_source(
        &self,
        path: &Path,
        hash: &ContentHash,
        force_hash: bool,
    ) -> Result<(File, Stamp), AudioError> {
        check_path(path, false)?;
        let before = fs::symlink_metadata(path).map_err(source_io)?;
        if !before.is_file() {
            return Err(AudioError::SourceChanged);
        }
        let current = stamp(&before);
        let mut file = secure_open(path, false)?;
        if stamp(&file.metadata().map_err(source_io)?) != current {
            return Err(AudioError::SourceChanged);
        }
        let reuse = !force_hash
            && precise_change_tracking(&file)
            && self
                .verified
                .lock()
                .map_err(|_| corrupt())?
                .get(path)
                .is_some_and(|v| v.stamp == current && v.hash == hash.as_str());
        if !reuse {
            let mut digest = Sha256::new();
            let mut buffer = [0; 65536];
            loop {
                let n = file.read(&mut buffer).map_err(source_io)?;
                if n == 0 {
                    break;
                }
                digest.update(&buffer[..n]);
            }
            if format!("sha256:{:x}", digest.finalize()) != hash.as_str() {
                return Err(AudioError::SourceChanged);
            }
            self.check_source(path, &current)?;
            if stamp(&file.metadata().map_err(source_io)?) != current {
                return Err(AudioError::SourceChanged);
            }
            let mut verified = self.verified.lock().map_err(|_| corrupt())?;
            if verified.len() >= 32 {
                verified.clear();
            }
            verified.insert(
                path.to_owned(),
                Verified {
                    stamp: current.clone(),
                    hash: hash.as_str().into(),
                },
            );
            file.rewind().map_err(source_io)?;
        }
        Ok((file, current))
    }
    fn check_source(&self, path: &Path, expected: &Stamp) -> Result<(), AudioError> {
        check_path(path, false)?;
        if stamp(&fs::symlink_metadata(path).map_err(source_io)?) != *expected {
            return Err(AudioError::SourceChanged);
        }
        Ok(())
    }
    pub fn verify_source(&self, hash: &ContentHash, path: &Path) -> Result<(), AudioError> {
        self.verified_source(path, hash, true).map(|_| ())
    }
    fn check_directory(&self) -> Result<(), AudioError> {
        let current = secure_open(&self.directory, true)?;
        let current = rustix::fs::fstat(&current).map_err(|e| cache_io(e.into()))?;
        let original = rustix::fs::fstat(&self.directory_handle).map_err(|e| cache_io(e.into()))?;
        if current.st_dev != original.st_dev || current.st_ino != original.st_ino {
            return Err(AudioError::UnsafeCachePath(
                "cache directory identity changed",
            ));
        }
        Ok(())
    }
    fn path(&self, hash: &ContentHash) -> PathBuf {
        self.directory
            .join(format!("waveform-v2-{}.wfm2", &hash.as_str()[7..]))
    }
    pub fn prepare(
        &self,
        asset: &str,
        hash: &ContentHash,
        path: &Path,
    ) -> Result<WaveformMetadata, AudioError> {
        self.prepare_inner(asset, hash, path, false)
    }
    fn prepare_inner(
        &self,
        asset: &str,
        hash: &ContentHash,
        path: &Path,
        force: bool,
    ) -> Result<WaveformMetadata, AudioError> {
        validate_asset_id(asset, hash)?;
        let (source, revision) = self.source(path, hash)?;
        self.check_directory()?;
        let cache = self.path(hash);
        check_path(&cache, true)?;
        if !force {
            match CacheReader::open(&cache, hash) {
                Ok(reader) => {
                    self.check_source(path, &revision)?;
                    return Ok(reader.metadata);
                }
                Err(error @ AudioError::UnsafeCachePath(_)) => return Err(error),
                Err(_) => {}
            }
        }
        let _generation = self.generation.lock().map_err(|_| corrupt())?;
        if !force {
            match CacheReader::open(&cache, hash) {
                Ok(reader) => {
                    self.check_source(path, &revision)?;
                    return Ok(reader.metadata);
                }
                Err(error @ AudioError::UnsafeCachePath(_)) => return Err(error),
                Err(_) => {}
            }
        }
        let mut decoded = PcmReader::open(source, path)?;
        let metadata = decoded.metadata;
        let count = metadata.total_frames.div_ceil(BASE);
        if count > LIMIT / (RECORD * u64::from(metadata.channel_count) * 2) {
            return Err(AudioError::CacheUnavailable(
                "waveform exceeds cache size limit".into(),
            ));
        }
        let mut base = vec![Vec::with_capacity(count as usize); metadata.channel_count as usize];
        let mut accumulator = vec![Bucket::default(); metadata.channel_count as usize];
        decoded.range(0, metadata.total_frames, |frame, values| {
            for (channel, &value) in values.iter().enumerate() {
                accumulator[channel].push(value);
            }
            if (frame + 1) % BASE == 0 || frame + 1 == metadata.total_frames {
                for channel in 0..values.len() {
                    base[channel].push(accumulator[channel]);
                    accumulator[channel] = Bucket::default();
                }
            }
        })?;
        self.check_source(path, &revision)?;
        let mut levels = vec![base];
        while levels.last().unwrap()[0].len() > 1 {
            let next = levels
                .last()
                .unwrap()
                .iter()
                .map(|channel| {
                    channel
                        .chunks(4)
                        .map(|children| {
                            let mut parent = Bucket::default();
                            for child in children {
                                parent.merge(*child);
                            }
                            parent
                        })
                        .collect()
                })
                .collect();
            levels.push(next);
        }
        self.write(&cache, hash, metadata, &levels)?;
        self.check_source(path, &revision)?;
        Ok(metadata)
    }
    fn write(
        &self,
        path: &Path,
        hash: &ContentHash,
        metadata: WaveformMetadata,
        levels: &[Vec<Vec<Bucket>>],
    ) -> Result<(), AudioError> {
        let mut header = Vec::new();
        header.extend(MAGIC);
        header.extend(2_u32.to_le_bytes());
        header.extend(2_u32.to_le_bytes());
        header.extend(&hash.as_str().as_bytes()[7..]);
        header.extend(metadata.sample_rate.to_le_bytes());
        header.extend(u32::from(metadata.channel_count).to_le_bytes());
        header.extend(metadata.total_frames.to_le_bytes());
        header.extend((levels.len() as u32).to_le_bytes());
        let mut offset = 100 + levels.len() as u64 * 24 + 32;
        let mut width = BASE;
        for level in levels {
            let count = level[0].len() as u64;
            header.extend(width.to_le_bytes());
            header.extend(count.to_le_bytes());
            header.extend(offset.to_le_bytes());
            offset += channel_bytes(count) * u64::from(metadata.channel_count);
            width *= 4;
        }
        if offset > LIMIT {
            return Err(corrupt());
        }
        let checksum = Sha256::digest(&header);
        header.extend(checksum);
        check_path(path, true)?;
        reject_unsafe_cache_entry(path)?;
        let temporary = path.with_extension(format!(
            "partial-{}-{}",
            std::process::id(),
            NEXT_TEMP_FILE.fetch_add(1, Ordering::Relaxed)
        ));
        self.check_directory()?;
        let temporary_name = temporary.file_name().ok_or_else(corrupt)?;
        let target_name = path.file_name().ok_or_else(corrupt)?;
        let file = File::from(
            openat(
                &self.directory_handle,
                temporary_name,
                OFlags::WRONLY | OFlags::CREATE | OFlags::EXCL | OFlags::NOFOLLOW | OFlags::CLOEXEC,
                Mode::RUSR | Mode::WUSR,
            )
            .map_err(|e| cache_io(e.into()))?,
        );
        let result = (|| {
            let mut writer = BufWriter::new(file);
            writer.write_all(&header).map_err(cache_io)?;
            for level in levels {
                for channel in level {
                    for chunk in channel.chunks(CHUNK as usize) {
                        let mut bytes = Vec::with_capacity(chunk.len() * RECORD as usize);
                        for b in chunk {
                            b.encode(&mut bytes);
                        }
                        writer.write_all(&bytes).map_err(cache_io)?;
                        writer
                            .write_all(&Sha256::digest(&bytes))
                            .map_err(cache_io)?;
                    }
                }
            }
            writer.flush().map_err(cache_io)?;
            writer.get_ref().sync_all().map_err(cache_io)?;
            drop(writer);
            check_path(path, true)?;
            reject_unsafe_cache_entry(path)?;
            self.check_directory()?;
            renameat(
                &self.directory_handle,
                temporary_name,
                &self.directory_handle,
                target_name,
            )
            .map_err(|e| cache_io(e.into()))?;
            self.directory_handle.sync_all().map_err(cache_io)
        })();
        if result.is_err() && check_path(&temporary, true).is_ok() {
            let _ = unlinkat(&self.directory_handle, temporary_name, AtFlags::empty());
        }
        result
    }
    pub fn query(
        &self,
        asset: &str,
        hash: &ContentHash,
        path: &Path,
        query: &WaveformQuery,
    ) -> Result<WaveformResponseV2, AudioError> {
        validate_asset_id(asset, hash)?;
        if query.target_points == 0
            || query.target_points > MAX_TARGET_POINTS
            || query.start_frame >= query.end_frame_exclusive
            || query.end_frame_exclusive > MAX_FRAMES
            || query.target_points as u64 > query.end_frame_exclusive - query.start_frame
        {
            return Err(invalid());
        }
        self.prepare(asset, hash, path)?;
        // Retry a corrupt data chunk once by regenerating, preserving the invalid entry until atomic replacement.
        match self.query_once(hash, path, query) {
            Err(AudioError::CacheUnavailable(_)) => {
                self.prepare_inner(asset, hash, path, true)?;
                self.query_once(hash, path, query)
            }
            result => result,
        }
    }
    fn query_once(
        &self,
        hash: &ContentHash,
        path: &Path,
        query: &WaveformQuery,
    ) -> Result<WaveformResponseV2, AudioError> {
        let (source, revision) = self.source(path, hash)?;
        let mut cache = CacheReader::open(&self.path(hash), hash)?;
        if query.end_frame_exclusive > cache.metadata.total_frames {
            return Err(invalid());
        }
        let length = query.end_frame_exclusive - query.start_frame;
        let boundaries: Vec<_> = (0..=query.target_points)
            .map(|i| {
                query.start_frame
                    + (u128::from(length) * i as u128 / query.target_points as u128) as u64
            })
            .collect();
        let mut buckets = vec![
            vec![Bucket::default(); query.target_points];
            cache.metadata.channel_count as usize
        ];
        let mut edges: Vec<(u64, u64, usize)> = Vec::new();
        for (i, pair) in boundaries.windows(2).enumerate() {
            let mut frame = pair[0];
            while frame < pair[1] {
                let level = cache
                    .levels
                    .iter()
                    .enumerate()
                    .rev()
                    .find(|(_, l)| frame.is_multiple_of(l.width) && l.width <= pair[1] - frame)
                    .map(|(i, _)| i);
                if let Some(level) = level {
                    let width = cache.levels[level].width;
                    for channel in 0..cache.metadata.channel_count {
                        buckets[channel as usize][i].merge(cache.bucket(
                            level,
                            channel,
                            frame / width,
                        )?);
                    }
                    frame += width;
                } else {
                    let end = ((frame / BASE + 1) * BASE).min(pair[1]);
                    edges.push((frame, end, i));
                    frame = end;
                }
            }
        }
        let mut pcm = PcmReader::open(source, path)?;
        if pcm.metadata != cache.metadata {
            return Err(AudioError::SourceChanged);
        }
        // Adjacent edge ranges are decoded in one seek/read, including deep zoom.
        let mut edge = 0;
        while edge < edges.len() {
            let first = edge;
            let start = edges[edge].0;
            let mut end = edges[edge].1;
            edge += 1;
            while edge < edges.len() && edges[edge].0 <= end + BASE {
                end = edges[edge].1;
                edge += 1;
            }
            let mut current = first;
            pcm.range(start, end, |frame, values| {
                while current < edge && frame >= edges[current].1 {
                    current += 1;
                }
                if current < edge && frame >= edges[current].0 {
                    for (channel, &value) in values.iter().enumerate() {
                        buckets[channel][edges[current].2].push(value);
                    }
                }
            })?;
        }
        self.check_source(path, &revision)?;
        Ok(WaveformResponseV2 {
            schema: "waveform-query:v2",
            analyzer_version: "waveform:v2",
            metadata: cache.metadata,
            range: FrameRange {
                start_frame: query.start_frame,
                end_frame_exclusive: query.end_frame_exclusive,
            },
            bucket_boundaries: boundaries,
            channels: buckets
                .into_iter()
                .enumerate()
                .map(|(channel, buckets)| QueryChannel {
                    channel_index: channel as u16,
                    peaks: buckets.into_iter().map(Bucket::peak).collect(),
                })
                .collect(),
        })
    }
}

/// Symphonia 0.5.5 counts the eight SSND control bytes as audio. Read validated
/// AIFF PCM extents directly into its codec, retaining COMM's exact frame count.
fn aiff_pcm_extent(source: &File) -> Result<Option<(u64, usize, u64)>, AudioError> {
    let mut file = source.try_clone().map_err(source_io)?;
    file.rewind().map_err(source_io)?;
    let mut header = [0; 12];
    file.read_exact(&mut header).map_err(source_io)?;
    file.rewind().map_err(source_io)?;
    if &header[..4] != b"FORM" {
        return Ok(None);
    }
    if &header[8..] != b"AIFF" && &header[8..] != b"AIFC" {
        return Err(AudioError::UnsupportedFormat);
    }
    let malformed = || AudioError::DecodeFailed("invalid AIFF PCM extent".into());
    let end = 8 + u64::from(u32::from_be_bytes(header[4..8].try_into().unwrap()));
    if end > file.metadata().map_err(source_io)?.len() || end < 12 {
        return Err(malformed());
    }
    let mut position = 12;
    let mut common = None;
    let mut sound = None;
    while position + 8 <= end {
        file.seek(SeekFrom::Start(position)).map_err(source_io)?;
        let mut chunk = [0; 8];
        file.read_exact(&mut chunk).map_err(source_io)?;
        let size = u64::from(u32::from_be_bytes(chunk[4..].try_into().unwrap()));
        let data = position + 8;
        if data + size > end {
            return Err(malformed());
        }
        if &chunk[..4] == b"COMM" {
            if common.is_some() || size < 18 {
                return Err(malformed());
            }
            let mut fields = [0; 8];
            file.read_exact(&mut fields).map_err(source_io)?;
            let channels = u16::from_be_bytes(fields[..2].try_into().unwrap());
            let frames = u32::from_be_bytes(fields[2..6].try_into().unwrap()) as u64;
            let bits = u16::from_be_bytes(fields[6..].try_into().unwrap());
            if !(1..=2).contains(&channels) {
                return Err(AudioError::UnsupportedChannelLayout);
            }
            if ![8, 16, 24, 32].contains(&bits) {
                return Err(AudioError::UnsupportedFormat);
            }
            if &header[8..] == b"AIFC" {
                if size < 22 {
                    return Err(malformed());
                }
                file.seek(SeekFrom::Start(data + 18)).map_err(source_io)?;
                let mut codec = [0; 4];
                file.read_exact(&mut codec).map_err(source_io)?;
                if ![b"NONE", b"twos", b"sowt", b"fl32", b"FL32"].contains(&&codec) {
                    return Err(AudioError::UnsupportedFormat);
                }
            }
            common = Some((usize::from(channels) * usize::from(bits / 8), frames));
        } else if &chunk[..4] == b"SSND" {
            if sound.is_some() || size < 8 {
                return Err(malformed());
            }
            let mut control = [0; 8];
            file.read_exact(&mut control).map_err(source_io)?;
            if control != [0; 8] {
                return Err(AudioError::UnsupportedFormat);
            }
            sound = Some((data + 8, size - 8));
        }
        position = data + size + size % 2;
    }
    let (bytes_per_frame, frames) = common.ok_or_else(malformed)?;
    let (offset, size) = sound.ok_or_else(malformed)?;
    if frames == 0 || frames * bytes_per_frame as u64 != size {
        return Err(malformed());
    }
    file.rewind().map_err(source_io)?;
    Ok(Some((offset, bytes_per_frame, frames)))
}

struct PcmReader {
    direct: Option<(File, u64, usize)>,
    decoded: DecoderState,
    metadata: WaveformMetadata,
}
impl PcmReader {
    fn open(file: File, path: &Path) -> Result<Self, AudioError> {
        let direct = aiff_pcm_extent(&file)?;
        let decoded = open_decoder(file.try_clone().map_err(source_io)?, path)?;
        let params = &decoded
            .format
            .tracks()
            .iter()
            .find(|t| t.id == decoded.track_id)
            .ok_or(AudioError::UnsupportedFormat)?
            .codec_params;
        let rate = params.sample_rate.ok_or(AudioError::UnsupportedFormat)?;
        let channels = params
            .channels
            .ok_or(AudioError::UnsupportedFormat)?
            .count();
        if !(1..=2).contains(&channels) {
            return Err(AudioError::UnsupportedChannelLayout);
        }
        let frames = direct
            .as_ref()
            .map(|extent| extent.2)
            .or(params.n_frames)
            .ok_or(AudioError::UnsupportedFormat)?;
        if rate == 0
            || frames == 0
            || frames > MAX_FRAMES
            || params.start_ts != 0
            || params
                .time_base
                .is_none_or(|t| t.numer != 1 || t.denom != rate)
        {
            return Err(AudioError::UnsupportedFormat);
        }
        Ok(Self {
            direct: direct.map(|(offset, bytes_per_frame, _)| (file, offset, bytes_per_frame)),
            decoded,
            metadata: WaveformMetadata {
                sample_rate: rate,
                channel_count: channels as u16,
                total_frames: frames,
            },
        })
    }
    fn range(
        &mut self,
        start: u64,
        end: u64,
        mut visit: impl FnMut(u64, &[f32]),
    ) -> Result<(), AudioError> {
        if start >= end || end > self.metadata.total_frames {
            return Err(invalid());
        }
        if self.direct.is_none() {
            self.decoded
                .format
                .seek(
                    SeekMode::Accurate,
                    SeekTo::TimeStamp {
                        ts: start,
                        track_id: self.decoded.track_id,
                    },
                )
                .map_err(|e| AudioError::DecodeFailed(e.to_string()))?;
        }
        self.decoded.decoder.reset();
        let mut next = start;
        while next < end {
            let packet = if let Some((file, offset, bytes_per_frame)) = &mut self.direct {
                let frames = (end - next).min(4096);
                file.seek(SeekFrom::Start(*offset + next * *bytes_per_frame as u64))
                    .map_err(source_io)?;
                let mut bytes = vec![0; frames as usize * *bytes_per_frame];
                file.read_exact(&mut bytes)
                    .map_err(|_| AudioError::DecodeFailed("truncated AIFF PCM".into()))?;
                symphonia::core::formats::Packet::new_from_boxed_slice(
                    self.decoded.track_id,
                    next,
                    frames,
                    bytes.into_boxed_slice(),
                )
            } else {
                self.decoded
                    .next_packet()?
                    .ok_or_else(|| AudioError::DecodeFailed("truncated PCM source".into()))?
            };
            let ts = packet.ts;
            if ts > next {
                return Err(AudioError::DecodeFailed("non-contiguous PCM frames".into()));
            }
            let audio = self
                .decoded
                .decoder
                .decode(&packet)
                .map_err(|e| AudioError::DecodeFailed(e.to_string()))?;
            let spec = *audio.spec();
            if spec.rate != self.metadata.sample_rate
                || spec.channels.count() != self.metadata.channel_count as usize
            {
                return Err(AudioError::DecodeFailed("PCM parameters changed".into()));
            }
            let mut samples = SampleBuffer::<f32>::new(audio.capacity() as u64, spec);
            samples.copy_interleaved_ref(audio);
            if !samples
                .samples()
                .len()
                .is_multiple_of(spec.channels.count())
            {
                return Err(AudioError::DecodeFailed("unaligned PCM frames".into()));
            }
            for (i, values) in samples
                .samples()
                .chunks_exact(spec.channels.count())
                .enumerate()
            {
                let frame = ts + i as u64;
                if frame < next {
                    continue;
                }
                if frame >= end {
                    break;
                }
                if values
                    .iter()
                    .any(|v| !v.is_finite() || *v < -1.0 || *v > 1.0)
                {
                    return Err(AudioError::DecodeFailed("invalid PCM amplitude".into()));
                }
                visit(frame, values);
                next = frame + 1;
            }
        }
        Ok(())
    }
}

#[derive(Clone, Debug)]
pub struct RangedPreview {
    pub bytes: Vec<u8>,
    pub range: FrameRange,
    pub sample_rate: u32,
    pub truncated: bool,
    pub truncation_reason: Option<&'static str>,
}
impl WaveformEngine {
    pub fn preview(
        &self,
        hash: &ContentHash,
        path: &Path,
        range: FrameRange,
    ) -> Result<RangedPreview, AudioError> {
        let (file, revision) = self.verified_source(path, hash, true)?;
        let mut pcm = PcmReader::open(file, path)?;
        if range.start_frame >= range.end_frame_exclusive
            || range.end_frame_exclusive > pcm.metadata.total_frames
        {
            return Err(invalid());
        }
        let duration_limit = u64::from(pcm.metadata.sample_rate) * MAX_PREVIEW_SECONDS;
        let byte_limit =
            (MAX_PREVIEW_BYTES as u64 - 44) / (u64::from(pcm.metadata.channel_count) * 2);
        let requested = range.end_frame_exclusive - range.start_frame;
        let count = requested.min(duration_limit).min(byte_limit);
        let actual = FrameRange {
            start_frame: range.start_frame,
            end_frame_exclusive: range.start_frame + count,
        };
        let mut bytes =
            Vec::with_capacity((count * u64::from(pcm.metadata.channel_count) * 2) as usize);
        pcm.range(
            actual.start_frame,
            actual.end_frame_exclusive,
            |_, values| {
                for &value in values {
                    let encoded = if value < 0.0 {
                        (value * 32768.0) as i16
                    } else {
                        (value * 32767.0) as i16
                    };
                    bytes.extend(encoded.to_le_bytes());
                }
            },
        )?;
        self.check_source(path, &revision)?;
        Ok(RangedPreview {
            bytes: encode_pcm_wav(&bytes, pcm.metadata.sample_rate, pcm.metadata.channel_count)?,
            range: actual,
            sample_rate: pcm.metadata.sample_rate,
            truncated: count < requested,
            truncation_reason: if count == requested {
                None
            } else if byte_limit < duration_limit {
                Some("byteLimit")
            } else {
                Some("durationLimit")
            },
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    struct Fixture {
        _temp: TempDir,
        source: PathBuf,
        cache: PathBuf,
        bytes: Vec<u8>,
        samples: Vec<Vec<f32>>,
        hash: ContentHash,
        asset: String,
        engine: WaveformEngine,
    }
    fn fixture(channels: u16, frames: usize, rate: u32) -> Fixture {
        let temp = TempDir::new().unwrap();
        let root = temp.path().canonicalize().unwrap();
        let source = root.join("generated.wav");
        let cache = root.join("cache");
        let mut pcm = Vec::new();
        let mut samples = vec![Vec::new(); channels as usize];
        for frame in 0..frames {
            let left = ((frame * 7919 % 60001) as i32 - 30000) as i16;
            for (channel, samples) in samples.iter_mut().enumerate() {
                let value = if channel == 0 { left } else { -left };
                pcm.extend(value.to_le_bytes());
                samples.push(f32::from(value) / 32768.0);
            }
        }
        let bytes = encode_pcm_wav(&pcm, rate, channels).unwrap();
        fs::write(&source, &bytes).unwrap();
        let hash = ContentHash::parse(format!("sha256:{:x}", Sha256::digest(&bytes))).unwrap();
        let mut digest = Sha256::new();
        digest.update(b"asset:v1");
        digest.update((hash.as_str().len() as u64).to_be_bytes());
        digest.update(hash.as_str().as_bytes());
        let asset = format!("asset:v1:{:x}", digest.finalize());
        let engine = WaveformEngine::open(cache.clone()).unwrap();
        Fixture {
            _temp: temp,
            source,
            cache,
            bytes,
            samples,
            hash,
            asset,
            engine,
        }
    }
    fn query(
        f: &Fixture,
        start: u64,
        end: u64,
        points: usize,
    ) -> Result<WaveformResponseV2, AudioError> {
        f.engine.query(
            &f.asset,
            &f.hash,
            &f.source,
            &WaveformQuery {
                start_frame: start,
                end_frame_exclusive: end,
                target_points: points,
                channel_mode: ChannelMode::Separate,
            },
        )
    }
    fn assert_oracle(f: &Fixture, result: &WaveformResponseV2) {
        for channel in &result.channels {
            for (i, peak) in channel.peaks.iter().enumerate() {
                let start = result.bucket_boundaries[i] as usize;
                let end = result.bucket_boundaries[i + 1] as usize;
                let values = &f.samples[channel.channel_index as usize][start..end];
                let min = values.iter().copied().fold(f32::INFINITY, f32::min);
                let max = values.iter().copied().fold(f32::NEG_INFINITY, f32::max);
                let rms = (values.iter().map(|v| f64::from(*v).powi(2)).sum::<f64>()
                    / values.len() as f64)
                    .sqrt();
                assert_eq!(peak.frame_count, (end - start) as u64);
                assert_eq!(peak.min, min);
                assert_eq!(peak.max, max);
                assert!((peak.rms - rms).abs() < 1e-10);
            }
        }
        assert_eq!(
            fs::read(&f.source).unwrap(),
            f.bytes,
            "original fixture bytes changed"
        );
    }
    #[test]
    fn exact_point_count_and_unaligned_ranges_match_pcm_oracle() {
        let f = fixture(2, 100_003, 44100);
        for (start, end, points) in [
            (0, 100_003, 640),
            (17, 43, 26),
            (63, 257, 17),
            (991, 99_999, 1001),
            (0, 100_003, 1),
            (100_000, 100_003, 2),
        ] {
            let response = query(&f, start, end, points).unwrap();
            assert_eq!(response.bucket_boundaries.len(), points + 1);
            assert_eq!(response.channels[0].peaks.len(), points);
            assert_eq!(response.bucket_boundaries[0], start);
            assert_eq!(*response.bucket_boundaries.last().unwrap(), end);
            assert_oracle(&f, &response);
            assert_eq!(response, query(&f, start, end, points).unwrap());
        }
    }
    #[test]
    fn mono_stereo_inverse_phase_and_tail_rms_are_preserved() {
        let mono = fixture(1, 65, 48000);
        let response = query(&mono, 0, 65, 1).unwrap();
        assert_eq!(response.channels.len(), 1);
        assert_oracle(&mono, &response);
        let stereo = fixture(2, 257, 48000);
        let response = query(&stereo, 0, 257, 1).unwrap();
        assert_oracle(&stereo, &response);
        assert_eq!(
            response.channels[0].peaks[0].max,
            -response.channels[1].peaks[0].min
        );
        assert_eq!(
            response.channels[0].peaks[0].rms,
            response.channels[1].peaks[0].rms
        );
    }
    #[test]
    fn invalid_ranges_and_multichannel_are_rejected() {
        let f = fixture(1, 100, 44100);
        for (s, e, p) in [
            (0, 0, 1),
            (10, 9, 1),
            (0, 101, 1),
            (0, 10, 11),
            (0, 100, 0),
            (0, 100, 4097),
            (0, u64::MAX, 1),
        ] {
            assert!(query(&f, s, e, p).is_err());
        }
        let f = fixture(3, 100, 44100);
        assert!(matches!(
            query(&f, 0, 100, 10),
            Err(AudioError::UnsupportedChannelLayout)
        ));
        assert!(matches!(
            f.engine.preview(
                &f.hash,
                &f.source,
                FrameRange {
                    start_frame: 0,
                    end_frame_exclusive: 100
                }
            ),
            Err(AudioError::UnsupportedChannelLayout)
        ));
    }
    #[test]
    fn corrupt_header_and_chunk_are_rebuilt_without_deleting_source_or_v1() {
        let f = fixture(2, 100003, 44100);
        let original = query(&f, 0, 100003, 640).unwrap();
        let old = f.cache.join("waveform-v1-retained.json");
        fs::write(&old, b"v1 retained").unwrap();
        let path = f.engine.path(&f.hash);
        fs::write(&path, b"truncated").unwrap();
        assert_eq!(query(&f, 0, 100003, 640).unwrap(), original);
        let mut bytes = fs::read(&path).unwrap();
        let reader = CacheReader::open(&path, &f.hash).unwrap();
        bytes[reader.levels[0].offset as usize + 3] ^= 0xff;
        fs::write(&path, &bytes).unwrap();
        assert_eq!(query(&f, 0, 100003, 640).unwrap(), original);
        assert_eq!(fs::read(old).unwrap(), b"v1 retained");
        assert_eq!(fs::read(&f.source).unwrap(), f.bytes);
    }
    #[test]
    fn changed_source_cannot_reuse_a_verified_revision() {
        let f = fixture(1, 1000, 44100);
        query(&f, 0, 1000, 10).unwrap();
        let mut changed = f.bytes.clone();
        changed[50] ^= 0xff;
        fs::write(&f.source, &changed).unwrap();
        assert!(matches!(
            query(&f, 0, 1000, 10),
            Err(AudioError::SourceChanged)
        ));
        assert!(matches!(
            f.engine.preview(
                &f.hash,
                &f.source,
                FrameRange {
                    start_frame: 0,
                    end_frame_exclusive: 100
                }
            ),
            Err(AudioError::SourceChanged)
        ));
        assert_eq!(fs::read(&f.source).unwrap(), changed);
    }
    #[cfg(unix)]
    #[test]
    fn symlink_entries_and_replaced_cache_parent_fail_closed() {
        use std::os::unix::fs::symlink;
        let f = fixture(1, 1000, 44100);
        let path = f.engine.path(&f.hash);
        symlink(&f.source, &path).unwrap();
        assert!(matches!(
            query(&f, 0, 1000, 10),
            Err(AudioError::UnsafeCachePath(_))
        ));
        fs::remove_file(&path).unwrap();
        fs::rename(&f.cache, f.cache.with_extension("retained")).unwrap();
        let outside = TempDir::new().unwrap();
        symlink(outside.path(), &f.cache).unwrap();
        assert!(matches!(
            query(&f, 0, 1000, 10),
            Err(AudioError::UnsafeCachePath(_))
        ));
        assert_eq!(fs::read_dir(outside.path()).unwrap().count(), 0);
        assert_eq!(fs::read(&f.source).unwrap(), f.bytes);
    }
    #[test]
    fn preview_seeks_past_sixty_seconds_and_reports_actual_range() {
        let f = fixture(2, 130_123, 1000);
        let range = FrameRange {
            start_frame: 70_017,
            end_frame_exclusive: 130_123,
        };
        let result = f.engine.preview(&f.hash, &f.source, range).unwrap();
        assert_eq!(
            result.range,
            FrameRange {
                start_frame: 70_017,
                end_frame_exclusive: 130_017
            }
        );
        assert!(result.truncated);
        assert_eq!(result.truncation_reason, Some("durationLimit"));
        let source_start = 44 + 70_017 * 4;
        // Negative PCM values survive decode/re-encode exactly; positive PCM has one-LSB quantization.
        let actual = i16::from_le_bytes(result.bytes[44..46].try_into().unwrap());
        let expected =
            i16::from_le_bytes(f.bytes[source_start..source_start + 2].try_into().unwrap());
        assert!((i32::from(actual) - i32::from(expected)).abs() <= 1);
        assert_eq!(result.bytes.len(), 44 + 60_000 * 4);
        assert_eq!(fs::read(&f.source).unwrap(), f.bytes);
    }
    #[test]
    fn preview_byte_limit_includes_the_wav_header() {
        let f = fixture(2, 8_388_600, 192_000);
        let preview = f
            .engine
            .preview(
                &f.hash,
                &f.source,
                FrameRange {
                    start_frame: 0,
                    end_frame_exclusive: 8_388_600,
                },
            )
            .unwrap();
        assert_eq!(preview.bytes.len(), MAX_PREVIEW_BYTES);
        assert_eq!(preview.range.end_frame_exclusive, 8_388_597);
        assert_eq!(preview.truncation_reason, Some("byteLimit"));
        assert_eq!(fs::read(&f.source).unwrap(), f.bytes);
    }

    #[test]
    fn same_size_rewrite_with_restored_mtime_invalidates_verified_source() {
        let f = fixture(1, 1000, 44100);
        query(&f, 0, 1000, 10).unwrap();
        let modified = fs::metadata(&f.source).unwrap().modified().unwrap();
        let mut changed = f.bytes.clone();
        changed[80] ^= 1;
        fs::write(&f.source, &changed).unwrap();
        File::options()
            .write(true)
            .open(&f.source)
            .unwrap()
            .set_times(std::fs::FileTimes::new().set_modified(modified))
            .unwrap();
        assert!(matches!(
            query(&f, 0, 1000, 10),
            Err(AudioError::SourceChanged)
        ));
        assert_eq!(fs::read(&f.source).unwrap(), changed);
    }

    #[test]
    fn aiff_seek_and_end_bucket_work() {
        let temp = TempDir::new().unwrap();
        let root = temp.path().canonicalize().unwrap();
        let source = root.join("generated.aiff");
        crate::tests::write_aiff(&source, 1003);
        let bytes = fs::read(&source).unwrap();
        let hash = crate::tests::content_hash(&source);
        let asset = crate::tests::asset_id(&hash);
        let engine = WaveformEngine::open(root.join("cache")).unwrap();
        let response = engine
            .query(
                &asset,
                &hash,
                &source,
                &WaveformQuery {
                    start_frame: 901,
                    end_frame_exclusive: 1003,
                    target_points: 51,
                    channel_mode: ChannelMode::Separate,
                },
            )
            .unwrap();
        assert_eq!(response.channels[0].peaks.len(), 51);
        let preview = engine
            .preview(
                &hash,
                &source,
                FrameRange {
                    start_frame: 901,
                    end_frame_exclusive: 1003,
                },
            )
            .unwrap();
        assert_eq!(preview.bytes.len(), 44 + 102 * 2);
        assert_eq!(fs::read(source).unwrap(), bytes);
    }
}
