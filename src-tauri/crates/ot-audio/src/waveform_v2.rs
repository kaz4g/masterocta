//! Read-only, source-frame Waveform 2.0 queries. No original-media writes.
use super::*;

pub const ANALYZER_VERSION: &str = "waveform:v2";
const BASE_FRAMES: u64 = 64;
const MAX_BASE_PEAKS: u64 = 262_144;
const MAX_SOURCE_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const CACHE_BUDGET: u64 = 256 * 1024 * 1024;
const MAX_RANGE_PREVIEW_BYTES: usize = 16 * 1024 * 1024;
const MAX_RANGE_PREVIEW_SECONDS: u64 = 30;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FrameRange {
    #[serde(with = "decimal_frame")]
    pub start_frame: u64,
    #[serde(with = "decimal_frame")]
    pub end_frame: u64,
}

mod decimal_frame {
    use serde::{Deserialize, Deserializer, Serializer};

    pub fn serialize<S: Serializer>(value: &u64, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&value.to_string())
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(deserializer: D) -> Result<u64, D::Error> {
        let text = String::deserialize(deserializer)?;
        if text.is_empty()
            || text.len() > 20
            || (text.len() > 1 && text.starts_with('0'))
            || !text.bytes().all(|byte| byte.is_ascii_digit())
        {
            return Err(serde::de::Error::custom("expected a canonical decimal PCM frame"));
        }
        text.parse().map_err(serde::de::Error::custom)
    }
}

impl FrameRange {
    pub fn validate(self, total: u64) -> Result<Self, AudioError> {
        if self.start_frame >= self.end_frame || self.end_frame > total {
            return Err(AudioError::InvalidRequest("range must be nonempty and inside the audio"));
        }
        Ok(self)
    }

    fn len(self) -> u64 {
        self.end_frame - self.start_frame
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WaveformQuery {
    pub range: Option<FrameRange>,
    pub target_points: usize,
}

impl WaveformQuery {
    pub fn validate(&self) -> Result<(), AudioError> {
        if !(MIN_TARGET_POINTS..=MAX_TARGET_POINTS).contains(&self.target_points) {
            return Err(AudioError::InvalidRequest("target points must be between 32 and 4096"));
        }
        if let Some(range) = self.range {
            range.validate(u64::MAX)?;
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WaveformWindow {
    pub analyzer_version: &'static str,
    pub sample_rate: u32,
    pub channels: u16,
    #[serde(with = "decimal_frame")]
    pub frame_count: u64,
    pub range: FrameRange,
    #[serde(with = "decimal_frame")]
    pub frames_per_peak: u64,
    /// One min/max array per source channel, with identical bucket boundaries.
    pub channel_peaks: Vec<Vec<WaveformPeak>>,
}

#[derive(Debug, Deserialize, Serialize)]
struct Pyramid {
    version: String,
    asset_id: String,
    sample_rate: u32,
    channels: u16,
    frame_count: u64,
    levels: Vec<Level>,
}

#[derive(Debug, Deserialize, Serialize)]
struct Level {
    frames_per_peak: u64,
    channel_peaks: Vec<Vec<WaveformPeak>>,
}

fn check_current(current: &impl Fn() -> bool) -> Result<(), AudioError> {
    if current() {
        Ok(())
    } else {
        Err(AudioError::Cancelled)
    }
}

impl WaveformCache {
    pub fn query(
        &self,
        asset_id: &str,
        expected_hash: &ContentHash,
        source_path: &Path,
        query: &WaveformQuery,
        current: impl Fn() -> bool,
    ) -> Result<WaveformWindow, AudioError> {
        query.validate()?;
        let digest = validate_asset_id(asset_id, expected_hash)?;
        // Serialize expensive work; superseded requests exit before reading media.
        let _operation = self.operation.lock().map_err(|_| {
            AudioError::CacheUnavailable("waveform cache lock was poisoned".into())
        })?;
        check_current(&current)?;
        ensure_real_directory(&self.directory)?;
        let source = verified_source(source_path, expected_hash, &current)?;
        let cache_path = self.directory.join(format!("waveform-v2-{digest}.json"));
        reject_unsafe_cache_entry(&cache_path)?;
        let pyramid = load_pyramid(&cache_path, asset_id)?;
        let pyramid = match pyramid {
            Some(pyramid) => pyramid,
            None => {
                let snapshot = Snapshot::capture(&self.directory, source, expected_hash, &current)?;
                let pyramid = build_pyramid(snapshot.open()?, source_path, asset_id, &current)?;
                check_current(&current)?;
                let encoded_len = serde_json::to_vec(&pyramid)
                    .map_err(|error| AudioError::CacheUnavailable(error.to_string()))?.len();
                reserve_cache_space(&self.directory, &cache_path, encoded_len as u64)?;
                write_cache(&cache_path, &pyramid)?;
                pyramid
            }
        };
        let range = query.range.unwrap_or(FrameRange {
            start_frame: 0,
            end_frame: pyramid.frame_count,
        }).validate(pyramid.frame_count)?;
        check_current(&current)?;
        if let Some(level) = pyramid.levels.iter().find(|level| {
            range.len().div_ceil(query.target_points as u64) >= pyramid.levels[0].frames_per_peak
                && range.len().div_ceil(level.frames_per_peak) <= query.target_points as u64
                && range.start_frame.is_multiple_of(level.frames_per_peak)
                && (range.end_frame == pyramid.frame_count
                    || range.end_frame.is_multiple_of(level.frames_per_peak))
        }) {
            let start = (range.start_frame / level.frames_per_peak) as usize;
            let end = range.end_frame.div_ceil(level.frames_per_peak) as usize;
            return Ok(WaveformWindow {
                analyzer_version: ANALYZER_VERSION,
                sample_rate: pyramid.sample_rate,
                channels: pyramid.channels,
                frame_count: pyramid.frame_count,
                range,
                frames_per_peak: level.frames_per_peak,
                channel_peaks: level.channel_peaks.iter().map(|peaks| peaks[start..end].to_vec()).collect(),
            });
        }
        // Never invent detail by interpolating overview peaks, or let an attack
        // outside the requested range leak into an edge bucket.
        let source = verified_source(source_path, expected_hash, &current)?;
        let snapshot = Snapshot::capture(&self.directory, source, expected_hash, &current)?;
        let frames_per_peak = range.len().div_ceil(query.target_points as u64).max(1);
        let mut accumulators: Vec<PeakAccumulator> = (0..pyramid.channels)
            .map(|_| PeakAccumulator::new(frames_per_peak)).collect();
        let info = decode_frames(snapshot.open()?, source_path, &current, |index, frame, _| {
            if (range.start_frame..range.end_frame).contains(&index) {
                for (accumulator, sample) in accumulators.iter_mut().zip(frame) {
                    accumulator.push(*sample, *sample);
                }
            }
            Ok(())
        })?;
        if info != (pyramid.sample_rate, pyramid.channels, pyramid.frame_count) {
            return Err(AudioError::SourceChanged);
        }
        Ok(WaveformWindow {
            analyzer_version: ANALYZER_VERSION,
            sample_rate: info.0,
            channels: info.1,
            frame_count: info.2,
            range,
            frames_per_peak,
            channel_peaks: accumulators.into_iter().map(PeakAccumulator::finish).collect(),
        })
    }

    pub fn preview_range(
        &self,
        expected_hash: &ContentHash,
        source_path: &Path,
        range: FrameRange,
    ) -> Result<PreviewAudio, AudioError> {
        range.validate(u64::MAX)?;
        let _operation = self.operation.lock().map_err(|_| {
            AudioError::CacheUnavailable("waveform cache lock was poisoned".into())
        })?;
        ensure_real_directory(&self.directory)?;
        let source = verified_source(source_path, expected_hash, &|| true)?;
        let snapshot = Snapshot::capture(&self.directory, source, expected_hash, &|| true)?;
        let mut pcm = Vec::new();
        let info = decode_frames(snapshot.open()?, source_path, &|| true, |index, frame, rate| {
            if range.len() > u64::from(rate) * MAX_RANGE_PREVIEW_SECONDS
                || range.len() > (MAX_RANGE_PREVIEW_BYTES / (frame.len() * 2)) as u64
            {
                return Err(AudioError::InvalidRequest("range preview is limited to 30 seconds and 16 MiB"));
            }
            if (range.start_frame..range.end_frame).contains(&index) {
                for sample in frame {
                    let encoded = if *sample < 0.0 {
                        (*sample * 32768.0) as i16
                    } else {
                        (*sample * 32767.0) as i16
                    };
                    pcm.extend_from_slice(&encoded.to_le_bytes());
                }
            }
            Ok(())
        })?;
        range.validate(info.2)?;
        Ok(PreviewAudio {
            bytes: encode_pcm_wav(&pcm, info.0, info.1)?,
            duration_millis: range.len() * 1000 / u64::from(info.0),
            truncated: false,
        })
    }
}

fn verified_source(path: &Path, hash: &ContentHash, current: &impl Fn() -> bool) -> Result<File, AudioError> {
    let meta = fs::symlink_metadata(path).map_err(source_io)?;
    if meta.len() > MAX_SOURCE_BYTES { return Err(AudioError::InvalidRequest("waveform input is limited to 2 GiB")); }
    if !meta.is_file() || meta.file_type().is_symlink() {
        return Err(AudioError::SourceUnavailable("expected a regular audio file of at most 2 GiB".into()));
    }
    // RootRegistry has already resolved and checked every path component.
    let mut file = File::open(path).map_err(source_io)?;
    let opened = fs::symlink_metadata(path).map_err(source_io)?;
    if !opened.is_file() || opened.file_type().is_symlink() || !file.metadata().map_err(source_io)?.is_file() {
        return Err(AudioError::SourceChanged);
    }
    let mut hasher = Sha256::new();
    let mut count = 0_u64;
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        check_current(current)?;
        let read = file.read(&mut buffer).map_err(source_io)?;
        if read == 0 { break; }
        count += read as u64;
        if count > MAX_SOURCE_BYTES { return Err(AudioError::SourceChanged); }
        hasher.update(&buffer[..read]);
    }
    if format!("sha256:{:x}", hasher.finalize()) != hash.as_str() {
        return Err(AudioError::SourceChanged);
    }
    file.rewind().map_err(source_io)?;
    Ok(file)
}

/// Private application-cache input. The decoder never reads mutable original bytes.
struct Snapshot { path: Option<PathBuf>, file: Option<File> }
impl Snapshot {
    fn capture(directory: &Path, mut source: File, hash: &ContentHash, current: &impl Fn() -> bool) -> Result<Self, AudioError> {
        let sequence = NEXT_TEMP_FILE.fetch_add(1, Ordering::Relaxed);
        let path = directory.join(format!("waveform-input-{}-{sequence}.tmp", std::process::id()));
        let mut options = OpenOptions::new();
        options.read(true).write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let file = options.open(&path).map_err(cache_io)?;
        let mut snapshot = Self { path: Some(path), file: Some(file) };
        #[cfg(unix)]
        {
            // An open, unlinked snapshot also disappears on process termination.
            fs::remove_file(snapshot.path.as_ref().expect("snapshot path exists")).map_err(cache_io)?;
            snapshot.path = None;
        }
        let mut hasher = Sha256::new();
        let mut count = 0_u64;
        let mut buffer = [0_u8; 64 * 1024];
        loop {
            check_current(current)?;
            let read = source.read(&mut buffer).map_err(source_io)?;
            if read == 0 { break; }
            count += read as u64;
            if count > MAX_SOURCE_BYTES { return Err(AudioError::SourceChanged); }
            hasher.update(&buffer[..read]);
            snapshot.file.as_mut().expect("snapshot file exists").write_all(&buffer[..read]).map_err(cache_io)?;
        }
        if format!("sha256:{:x}", hasher.finalize()) != hash.as_str() {
            return Err(AudioError::SourceChanged);
        }
        snapshot.file.as_mut().expect("snapshot file exists").flush().map_err(cache_io)?;
        snapshot.file.as_mut().expect("snapshot file exists").rewind().map_err(cache_io)?;
        Ok(snapshot)
    }

    fn open(&self) -> Result<File, AudioError> { self.file.as_ref().expect("snapshot file exists").try_clone().map_err(cache_io) }
}
impl Drop for Snapshot {
    fn drop(&mut self) { drop(self.file.take()); if let Some(path) = &self.path { let _ = fs::remove_file(path); } }
}

fn decode_frames(
    source: File,
    source_path: &Path,
    current: &impl Fn() -> bool,
    mut visit: impl FnMut(u64, &[f32], u32) -> Result<(), AudioError>,
) -> Result<(u32, u16, u64), AudioError> {
    let mut decoded = open_decoder(source, source_path)?;
    let params = decoded.decoder.codec_params();
    let rate = params.sample_rate.filter(|rate| *rate > 0).ok_or(AudioError::UnsupportedFormat)?;
    let channels = params.channels.map(|channels| channels.count()).ok_or(AudioError::UnsupportedFormat)?;
    if !(1..=2).contains(&channels) { return Err(AudioError::UnsupportedFormat); }
    let expected = params.n_frames.filter(|frames| *frames > 0).ok_or(AudioError::UnsupportedFormat)?;
    // PCM is at least one byte per channel per frame. Reject hostile headers
    // before allocating or doing work proportional to a claimed duration.
    if expected > MAX_SOURCE_BYTES / channels as u64 { return Err(AudioError::UnsupportedFormat); }
    let mut index = 0_u64;
    while let Some(packet) = decoded.next_packet()? {
        check_current(current)?;
        let audio = decoded.decoder.decode(&packet).map_err(|error| AudioError::DecodeFailed(error.to_string()))?;
        let spec = *audio.spec();
        if spec.rate != rate || spec.channels.count() != channels {
            return Err(AudioError::DecodeFailed("audio parameters changed during decoding".into()));
        }
        if audio.capacity() > 1_048_576 {
            return Err(AudioError::DecodeFailed("decoded packet exceeds the frame limit".into()));
        }
        let mut buffer = SampleBuffer::<f32>::new(audio.capacity() as u64, spec);
        buffer.copy_interleaved_ref(audio);
        if !buffer.samples().len().is_multiple_of(channels) {
            return Err(AudioError::DecodeFailed("decoded packet is not frame aligned".into()));
        }
        for frame in buffer.samples().chunks_exact(channels) {
            if index >= expected || frame.iter().any(|sample| !sample.is_finite()) {
                return Err(AudioError::DecodeFailed("invalid PCM data or frame count".into()));
            }
            let clamped = [frame[0].clamp(-1.0, 1.0), frame.get(1).copied().unwrap_or(0.0).clamp(-1.0, 1.0)];
            visit(index, &clamped[..channels], rate)?;
            index += 1;
        }
    }
    check_current(current)?;
    if index != expected {
        return Err(AudioError::DecodeFailed("incomplete PCM source".into()));
    }
    Ok((rate, channels as u16, index))
}

fn build_pyramid(source: File, path: &Path, asset_id: &str, current: &impl Fn() -> bool) -> Result<Pyramid, AudioError> {
    let mut accumulators = Vec::new();
    let mut scale = BASE_FRAMES;
    let mut seen = 0_u64;
    let info = decode_frames(source, path, current, |_, frame, _| {
        if accumulators.is_empty() {
            accumulators = (0..frame.len()).map(|_| PeakAccumulator::new(scale)).collect();
        }
        for (accumulator, sample) in accumulators.iter_mut().zip(frame) {
            accumulator.push(*sample, *sample);
        }
        seen += 1;
        // Compact only at a complete even bucket boundary; no tail gets weighted twice.
        if seen.is_multiple_of(scale) && accumulators[0].peaks.len() as u64 >= MAX_BASE_PEAKS {
            for accumulator in &mut accumulators {
                accumulator.peaks = aggregate_peaks(&accumulator.peaks, 2);
                accumulator.samples_per_peak *= 2;
            }
            scale *= 2;
        }
        Ok(())
    })?;
    let mut levels = vec![Level {
        frames_per_peak: scale,
        channel_peaks: accumulators.into_iter().map(PeakAccumulator::finish).collect(),
    }];
    while levels.last().is_some_and(|level| level.channel_peaks[0].len() > 1) {
        let previous = levels.last().expect("base level exists");
        levels.push(Level {
            frames_per_peak: previous.frames_per_peak * 4,
            channel_peaks: previous.channel_peaks.iter().map(|peaks| aggregate_peaks(peaks, 4)).collect(),
        });
    }
    Ok(Pyramid {
        version: ANALYZER_VERSION.into(), asset_id: asset_id.into(),
        sample_rate: info.0, channels: info.1, frame_count: info.2, levels,
    })
}

fn load_pyramid(path: &Path, asset_id: &str) -> Result<Option<Pyramid>, AudioError> {
    let meta = match fs::symlink_metadata(path) {
        Ok(meta) => meta,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(cache_io(error)),
    };
    reject_unsafe_cache_entry(path)?;
    if meta.len() > MAX_CACHE_BYTES { return Ok(None); }
    let reader = BufReader::new(File::open(path).map_err(cache_io)?.take(MAX_CACHE_BYTES + 1));
    let pyramid: Pyramid = match serde_json::from_reader(reader) {
        Ok(pyramid) => pyramid,
        Err(_) => return Ok(None),
    };
    if pyramid.version != ANALYZER_VERSION || pyramid.asset_id != asset_id
        || pyramid.sample_rate == 0 || !(1..=2).contains(&pyramid.channels)
        || pyramid.frame_count == 0 || pyramid.frame_count > MAX_SOURCE_BYTES / u64::from(pyramid.channels)
        || pyramid.levels.is_empty() || pyramid.levels.len() > 32
    { return Ok(None); }
    let mut scale = pyramid.levels[0].frames_per_peak;
    if scale < BASE_FRAMES || !scale.is_power_of_two()
        || pyramid.frame_count.div_ceil(scale) > MAX_BASE_PEAKS
    { return Ok(None); }
    for (index, level) in pyramid.levels.iter().enumerate() {
        let count = pyramid.frame_count.div_ceil(scale);
        if level.frames_per_peak != scale || level.channel_peaks.len() != usize::from(pyramid.channels)
            || level.channel_peaks.iter().any(|peaks| peaks.len() as u64 != count || peaks.iter().any(|peak| {
                !peak.min.is_finite() || !peak.max.is_finite() || peak.min < -1.0 || peak.max > 1.0 || peak.min > peak.max
            }))
        { return Ok(None); }
        if index > 0 {
            let previous = &pyramid.levels[index - 1];
            for (peaks, prior) in level.channel_peaks.iter().zip(&previous.channel_peaks) {
                if *peaks != aggregate_peaks(prior, 4) { return Ok(None); }
            }
        }
        if index + 1 < pyramid.levels.len() {
            scale = match scale.checked_mul(4) { Some(scale) => scale, None => return Ok(None) };
        }
    }
    if pyramid.levels.last().is_none_or(|level| level.channel_peaks[0].len() != 1) { return Ok(None); }
    Ok(Some(pyramid))
}

fn reserve_cache_space(directory: &Path, target: &Path, needed: u64) -> Result<(), AudioError> {
    if needed > MAX_CACHE_BYTES { return Err(AudioError::CacheUnavailable("waveform cache entry is too large".into())); }
    let mut entries = Vec::new();
    let mut total = needed;
    for entry in fs::read_dir(directory).map_err(cache_io)? {
        let entry = entry.map_err(cache_io)?;
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue; };
        let Some(digest) = name.strip_prefix("waveform-v2-").and_then(|name| name.strip_suffix(".json")) else { continue; };
        if digest.len() != 64 || !digest.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)) { continue; }
        let path = entry.path();
        reject_unsafe_cache_entry(&path)?;
        if path == target { continue; }
        let meta = fs::symlink_metadata(&path).map_err(cache_io)?;
        total = total.saturating_add(meta.len());
        entries.push((meta.modified().map_err(cache_io)?, path, meta.len()));
    }
    entries.sort();
    for (_, path, len) in entries {
        if total <= CACHE_BUDGET { break; }
        reject_unsafe_cache_entry(&path)?;
        fs::remove_file(path).map_err(cache_io)?;
        total = total.saturating_sub(len);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn fixture(rate: u32, channels: u16, frames: usize, sample: impl Fn(usize, usize) -> i16) -> (TempDir, PathBuf, ContentHash, String) {
        let directory = TempDir::new().unwrap();
        let path = directory.path().join("synthetic.wav");
        let mut pcm = Vec::new();
        for index in 0..frames {
            for channel in 0..usize::from(channels) { pcm.extend_from_slice(&sample(index, channel).to_le_bytes()); }
        }
        fs::write(&path, encode_pcm_wav(&pcm, rate, channels).unwrap()).unwrap();
        let hash = ContentHash::parse(format!("sha256:{:x}", Sha256::digest(fs::read(&path).unwrap()))).unwrap();
        let mut hasher = Sha256::new();
        hasher.update(b"asset:v1");
        hasher.update((hash.as_str().len() as u64).to_be_bytes());
        hasher.update(hash.as_str().as_bytes());
        let asset = format!("asset:v1:{:x}", hasher.finalize());
        (directory, path, hash, asset)
    }

    fn query(range: Option<(u64, u64)>, target_points: usize) -> WaveformQuery {
        WaveformQuery { range: range.map(|(start_frame, end_frame)| FrameRange { start_frame, end_frame }), target_points }
    }

    #[test]
    fn frame_wire_format_is_lossless_and_rejects_noncanonical_or_numeric_values() {
        let range = FrameRange { start_frame: 9_007_199_254_740_993, end_frame: u64::MAX };
        let json = serde_json::to_string(&range).unwrap();
        assert_eq!(serde_json::from_str::<FrameRange>(&json).unwrap(), range);
        assert!(json.contains("\"9007199254740993\""));
        for invalid in ["0", "\"01\"", "\"-1\"", "\"1e2\"", "\"18446744073709551616\""] {
            assert!(serde_json::from_str::<FrameRange>(&format!("{{\"startFrame\":{invalid},\"endFrame\":\"20\"}}")).is_err());
        }
    }

    #[test]
    fn stereo_polarity_and_silence_are_preserved_without_touching_the_source() {
        let (_fixture, path, hash, asset) = fixture(8000, 2, 65536, |_, channel| if channel == 0 { 16384 } else { -16384 });
        let before = fs::read(&path).unwrap();
        let directory = TempDir::new().unwrap();
        let cache = WaveformCache::open(directory.path()).unwrap();
        for _ in 0..2 {
            let result = cache.query(&asset, &hash, &path, &query(None, 64), || true).unwrap();
            assert_eq!(result.channels, 2);
            assert!(result.channel_peaks[0].iter().all(|peak| peak.min > 0.49 && peak.max > 0.49));
            assert!(result.channel_peaks[1].iter().all(|peak| peak.min < -0.49 && peak.max < -0.49));
            assert!(result.channel_peaks[0].len() <= 64);
        }
        assert_eq!(fs::read(&path).unwrap(), before);
        assert!(fs::read_dir(directory.path()).unwrap().all(|entry| entry.unwrap().path().extension().unwrap() == "json"));
        let (_silent, silent_path, silent_hash, silent_asset) = fixture(8000, 1, 1000, |_, _| 0);
        let result = cache.query(&silent_asset, &silent_hash, &silent_path, &query(None, 32), || true).unwrap();
        assert!(result.channel_peaks[0].iter().all(|peak| peak.min == 0.0 && peak.max == 0.0));
    }

    #[test]
    fn zoom_reads_real_single_frames_and_excludes_attacks_outside_half_open_range() {
        let (_fixture, path, hash, asset) = fixture(8000, 2, 65536, |index, channel| {
            if index == 100 || index == 108 { 30000 } else if index == 103 && channel == 1 { -20000 } else { 0 }
        });
        let directory = TempDir::new().unwrap();
        let cache = WaveformCache::open(directory.path()).unwrap();
        cache.query(&asset, &hash, &path, &query(None, 32), || true).unwrap();
        let result = cache.query(&asset, &hash, &path, &query(Some((101, 108)), 32), || true).unwrap();
        assert_eq!(result.frames_per_peak, 1);
        assert_eq!(result.channel_peaks[0].len(), 7);
        assert!(result.channel_peaks[0].iter().all(|peak| peak.max == 0.0));
        assert!(result.channel_peaks[1][2].min < -0.60);
        assert!(result.channel_peaks[1].iter().all(|peak| peak.max <= 0.0));
    }

    #[test]
    fn changed_live_source_is_rejected_even_when_a_pyramid_is_cached() {
        let (_fixture, path, hash, asset) = fixture(8000, 1, 65536, |_, _| 1);
        let directory = TempDir::new().unwrap();
        let cache = WaveformCache::open(directory.path()).unwrap();
        cache.query(&asset, &hash, &path, &query(None, 32), || true).unwrap();
        let mut bytes = fs::read(&path).unwrap();
        bytes[100] ^= 1;
        fs::write(&path, bytes).unwrap();
        assert!(matches!(cache.query(&asset, &hash, &path, &query(None, 32), || true), Err(AudioError::SourceChanged)));
    }

    #[test]
    fn invalid_and_truncated_requests_never_return_partial_success() {
        let (_fixture, path, hash, asset) = fixture(8000, 1, 1000, |_, _| 1);
        let directory = TempDir::new().unwrap();
        let cache = WaveformCache::open(directory.path()).unwrap();
        for range in [(0, 0), (2, 1), (1000, 1001)] {
            assert!(cache.query(&asset, &hash, &path, &query(Some(range), 32), || true).is_err());
        }
        for points in [0, 31, 4097, usize::MAX] {
            assert!(cache.query(&asset, &hash, &path, &query(None, points), || true).is_err());
        }
        let mut bytes = fs::read(&path).unwrap();
        bytes.truncate(bytes.len() - 100);
        fs::write(&path, &bytes).unwrap();
        let truncated_hash = ContentHash::parse(format!("sha256:{:x}", Sha256::digest(bytes))).unwrap();
        assert!(cache.preview_range(&truncated_hash, &path, FrameRange { start_frame: 0, end_frame: 10 }).is_err());
    }

    #[test]
    fn previews_an_exact_range_after_sixty_seconds_and_enforces_limits() {
        let (_fixture, path, hash, _) = fixture(1000, 2, 62000, |index, channel| {
            if index >= 61000 && channel == 0 { 16384 } else { 0 }
        });
        let before = fs::read(&path).unwrap();
        let directory = TempDir::new().unwrap();
        let cache = WaveformCache::open(directory.path()).unwrap();
        let preview = cache.preview_range(&hash, &path, FrameRange { start_frame: 61000, end_frame: 62000 }).unwrap();
        assert_eq!(preview.bytes.len(), 44 + 1000 * 2 * 2);
        assert_eq!(preview.duration_millis, 1000);
        assert!(!preview.truncated);
        assert!(i16::from_le_bytes([preview.bytes[44], preview.bytes[45]]) >= 16383);
        assert_eq!(&preview.bytes[46..48], &[0, 0]);
        assert!(cache.preview_range(&hash, &path, FrameRange { start_frame: 0, end_frame: 31000 }).is_err());
        assert_eq!(fs::read(&path).unwrap(), before);
    }

    #[test]
    fn malformed_cache_regenerates_and_superseded_work_stops_without_a_cache_write() {
        let (_fixture, path, hash, asset) = fixture(8000, 1, 65536, |_, _| 123);
        let directory = TempDir::new().unwrap();
        let cache = WaveformCache::open(directory.path()).unwrap();
        assert!(matches!(cache.query(&asset, &hash, &path, &query(None, 32), || false), Err(AudioError::Cancelled)));
        assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 0);
        let expected = cache.query(&asset, &hash, &path, &query(None, 32), || true).unwrap();
        let cache_path = directory.path().join(format!("waveform-v2-{}.json", asset.strip_prefix("asset:v1:").unwrap()));
        fs::write(&cache_path, b"{broken cache").unwrap();
        let actual = cache.query(&asset, &hash, &path, &query(None, 32), || true).unwrap();
        assert_eq!(expected.channel_peaks, actual.channel_peaks);
    }

    #[test]
    fn aiff_uses_the_same_frame_coordinates_and_channel_contract() {
        let directory = TempDir::new().unwrap();
        let path = directory.path().join("synthetic.aiff");
        let frames = 128_u32;
        let mut bytes = Vec::new();
        bytes.extend_from_slice(b"FORM");
        bytes.extend_from_slice(&(46 + frames * 2).to_be_bytes());
        bytes.extend_from_slice(b"AIFFCOMM");
        bytes.extend_from_slice(&18_u32.to_be_bytes());
        bytes.extend_from_slice(&1_u16.to_be_bytes());
        bytes.extend_from_slice(&frames.to_be_bytes());
        bytes.extend_from_slice(&16_u16.to_be_bytes());
        bytes.extend_from_slice(&[0x40, 0x0e, 0xac, 0x44, 0, 0, 0, 0, 0, 0]);
        bytes.extend_from_slice(b"SSND");
        bytes.extend_from_slice(&(8 + frames * 2).to_be_bytes());
        bytes.extend_from_slice(&[0; 8]);
        for i in 0..frames { bytes.extend_from_slice(&(i as i16 * 100).to_be_bytes()); }
        fs::write(&path, &bytes).unwrap();
        let hash = ContentHash::parse(format!("sha256:{:x}", Sha256::digest(&bytes))).unwrap();
        let cache_directory = TempDir::new().unwrap();
        let cache = WaveformCache::open(cache_directory.path()).unwrap();
        let preview = cache.preview_range(&hash, &path, FrameRange { start_frame: 50, end_frame: 60 }).unwrap();
        assert_eq!(preview.bytes.len(), 64);
        assert!(i16::from_le_bytes([preview.bytes[44], preview.bytes[45]]) >= 4999);
        assert_eq!(fs::read(path).unwrap(), bytes);
    }

    #[cfg(unix)]
    #[test]
    fn symlink_cache_and_source_fail_closed() {
        use std::os::unix::fs::symlink;
        let (fixture, path, hash, asset) = fixture(8000, 1, 65536, |_, _| 0);
        let directory = TempDir::new().unwrap();
        let cache = WaveformCache::open(directory.path()).unwrap();
        let link = fixture.path().join("linked.wav");
        symlink(&path, &link).unwrap();
        assert!(cache.query(&asset, &hash, &link, &query(None, 32), || true).is_err());
        let cache_path = directory.path().join(format!("waveform-v2-{}.json", asset.strip_prefix("asset:v1:").unwrap()));
        symlink(&path, &cache_path).unwrap();
        assert!(matches!(cache.query(&asset, &hash, &path, &query(None, 32), || true), Err(AudioError::UnsafeCachePath(_))));
    }
}
