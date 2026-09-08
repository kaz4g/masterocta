use ot_audio::{
    create_preview, AudioError, FrameRange, WaveformCache, WaveformEngine, WaveformMetadata,
    WaveformQuery, WaveformResponseV2, WaveformSlice,
};
use ot_domain::{ContentHash, RootId};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

const PRODUCT_DIRECTORY: &str = "MasterOCTa";
const WAVEFORM_CACHE_DIRECTORY: &str = "waveform-cache";
const DEFAULT_PREVIEW_TTL: Duration = Duration::from_secs(2 * 60);
const MAX_PREVIEW_TOKENS: usize = 8;

pub type SharedAudioRuntime = Arc<AudioRuntime>;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WaveformPreparation {
    pub state: &'static str,
    pub metadata: Option<WaveformMetadata>,
    pub error_code: Option<&'static str>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PreviewTicket {
    pub token: String,
    pub expires_in_seconds: u64,
    pub byte_length: usize,
    pub duration_millis: u64,
    pub truncated: bool,
    pub range: Option<FrameRange>,
    pub sample_rate: Option<u32>,
    pub truncation_reason: Option<&'static str>,
}

#[derive(Clone)]
struct PreviewRecord {
    root_id: RootId,
    bytes: Vec<u8>,
    expires_at: Instant,
    source: Option<(PathBuf, ContentHash)>,
}

#[derive(Default)]
struct PreviewState {
    records: HashMap<String, PreviewRecord>,
}

pub struct AudioRuntime {
    waveform_cache: WaveformCache,
    engine: WaveformEngine,
    jobs: Mutex<HashMap<String, WaveformPreparation>>,
    job_generation: Mutex<()>,
    previews: Mutex<PreviewState>,
    preview_generation: Mutex<()>,
    preview_ttl: Duration,
    nonce: [u8; 32],
    next_token: AtomicU64,
}

impl AudioRuntime {
    fn open(data_directory: &Path, preview_ttl: Duration) -> Result<Self, AudioRuntimeError> {
        fs::create_dir_all(data_directory)
            .map_err(|error| runtime_io("create data directory", error))?;
        let canonical_data_directory = data_directory
            .canonicalize()
            .map_err(|error| runtime_io("resolve data directory", error))?;
        let product_directory = canonical_data_directory.join(PRODUCT_DIRECTORY);
        ensure_product_directory(&canonical_data_directory, &product_directory)?;
        let canonical_product_directory = product_directory
            .canonicalize()
            .map_err(|error| runtime_io("resolve product data directory", error))?;
        let waveform_directory = canonical_product_directory.join(WAVEFORM_CACHE_DIRECTORY);
        let waveform_cache =
            WaveformCache::open(waveform_directory.clone()).map_err(AudioRuntimeError::Audio)?;
        let mut nonce = [0_u8; 32];
        getrandom::fill(&mut nonce)
            .map_err(|error| AudioRuntimeError::Entropy(error.to_string()))?;
        Ok(Self {
            waveform_cache,
            engine: WaveformEngine::open(waveform_directory).map_err(AudioRuntimeError::Audio)?,
            jobs: Mutex::new(HashMap::new()),
            job_generation: Mutex::new(()),
            previews: Mutex::new(PreviewState::default()),
            preview_generation: Mutex::new(()),
            preview_ttl,
            nonce,
            next_token: AtomicU64::new(1),
        })
    }

    pub fn waveform(
        &self,
        asset_id: &str,
        expected_hash: &ContentHash,
        source_path: &Path,
        target_points: usize,
    ) -> Result<WaveformSlice, AudioRuntimeError> {
        self.waveform_cache
            .waveform(asset_id, expected_hash, source_path, target_points)
            .map_err(AudioRuntimeError::Audio)
    }

    pub fn create_preview_token(
        &self,
        root_id: &RootId,
        asset_id: &str,
        expected_hash: &ContentHash,
        source_path: &Path,
    ) -> Result<PreviewTicket, AudioRuntimeError> {
        let _generation = self
            .preview_generation
            .lock()
            .map_err(|_| AudioRuntimeError::Unavailable)?;
        let preview =
            create_preview(expected_hash, source_path).map_err(AudioRuntimeError::Audio)?;
        let now = Instant::now();
        let expires_at = now + self.preview_ttl;
        let token = self.new_token(root_id, asset_id);
        let ticket = PreviewTicket {
            token: token.clone(),
            expires_in_seconds: self.preview_ttl.as_secs(),
            byte_length: preview.bytes.len(),
            duration_millis: preview.duration_millis,
            truncated: preview.truncated,
            range: None,
            sample_rate: None,
            truncation_reason: None,
        };
        let mut state = self.lock_previews()?;
        state.records.retain(|_, record| record.expires_at > now);
        if state.records.len() >= MAX_PREVIEW_TOKENS {
            if let Some(oldest) = state
                .records
                .iter()
                .min_by_key(|(_, record)| record.expires_at)
                .map(|(token, _)| token.clone())
            {
                state.records.remove(&oldest);
            }
        }
        state.records.insert(
            token,
            PreviewRecord {
                root_id: root_id.clone(),
                bytes: preview.bytes,
                expires_at,
                source: None,
            },
        );
        Ok(ticket)
    }

    pub fn read_preview(
        &self,
        root_id: &RootId,
        token: &str,
    ) -> Result<Vec<u8>, AudioRuntimeError> {
        validate_preview_token(token)?;
        let now = Instant::now();
        let mut state = self.lock_previews()?;
        let Some(record) = state.records.get(token) else {
            return Err(AudioRuntimeError::InvalidPreviewToken);
        };
        if record.expires_at <= now {
            state.records.remove(token);
            return Err(AudioRuntimeError::ExpiredPreviewToken);
        }
        if state
            .records
            .get(token)
            .is_none_or(|record| &record.root_id != root_id)
        {
            return Err(AudioRuntimeError::InvalidPreviewToken);
        }
        let source = record.source.clone();
        drop(state);
        if let Some((path, hash)) = source {
            self.engine
                .verify_source(&hash, &path)
                .map_err(AudioRuntimeError::Audio)?;
        }
        let mut state = self.lock_previews()?;
        if state
            .records
            .get(token)
            .is_none_or(|r| r.expires_at <= Instant::now() || &r.root_id != root_id)
        {
            return Err(AudioRuntimeError::InvalidPreviewToken);
        }
        let record = state
            .records
            .remove(token)
            .expect("preview record was checked");
        Ok(record.bytes)
    }

    pub fn prepare_waveform(
        self: &Arc<Self>,
        asset_id: &str,
        hash: &ContentHash,
        path: &Path,
    ) -> Result<WaveformPreparation, AudioRuntimeError> {
        let key = hash.as_str().to_owned();
        let mut jobs = self
            .jobs
            .lock()
            .map_err(|_| AudioRuntimeError::Unavailable)?;
        if let Some(job) = jobs.get(&key) {
            let result = job.clone();
            // Deliver a terminal failure once. A new consumer may retry after the
            // source/cache becomes available again instead of retaining a sticky failure.
            if !["READY", "QUEUED", "GENERATING"].contains(&result.state) {
                jobs.remove(&key);
            }
            drop(jobs);
            if result.state == "READY" {
                if let Err(error) = self.engine.verify_source(hash, path) {
                    self.jobs
                        .lock()
                        .map_err(|_| AudioRuntimeError::Unavailable)?
                        .remove(&key);
                    return Err(AudioRuntimeError::Audio(error));
                }
            }
            return Ok(result);
        }
        if jobs
            .values()
            .filter(|job| job.state == "QUEUED" || job.state == "GENERATING")
            .count()
            >= 8
        {
            return Err(AudioRuntimeError::Audio(AudioError::InvalidRequest(
                "waveform queue is full; retry shortly",
            )));
        }
        if jobs.len() >= 32 {
            let old = jobs
                .iter()
                .find(|(_, j)| j.state != "QUEUED" && j.state != "GENERATING")
                .map(|(key, _)| key.clone());
            if let Some(old) = old {
                jobs.remove(&old);
            }
        }
        let queued = WaveformPreparation {
            state: "QUEUED",
            metadata: None,
            error_code: None,
        };
        jobs.insert(key.clone(), queued.clone());
        drop(jobs);
        let runtime = Arc::clone(self);
        let asset = asset_id.to_owned();
        let hash = hash.clone();
        let path = path.to_owned();
        std::thread::spawn(move || {
            let Ok(_generation) = runtime.job_generation.lock() else {
                if let Ok(mut jobs) = runtime.jobs.lock() {
                    jobs.insert(
                        key,
                        WaveformPreparation {
                            state: "CANCELLED",
                            metadata: None,
                            error_code: Some("AUDIO_RUNTIME_UNAVAILABLE"),
                        },
                    );
                }
                return;
            };
            if let Ok(mut jobs) = runtime.jobs.lock() {
                if let Some(job) = jobs.get_mut(&key) {
                    job.state = "GENERATING";
                }
            }
            let outcome = runtime.engine.prepare(&asset, &hash, &path);
            let job = match outcome {
                Ok(metadata) => WaveformPreparation {
                    state: "READY",
                    metadata: Some(metadata),
                    error_code: None,
                },
                Err(error) => WaveformPreparation {
                    state: match error {
                        AudioError::UnsupportedFormat | AudioError::UnsupportedChannelLayout => {
                            "UNSUPPORTED"
                        }
                        AudioError::SourceChanged => "SOURCE_CHANGED",
                        AudioError::UnsafeCachePath(_) => "CACHE_UNSAFE",
                        _ => "DECODE_FAILED",
                    },
                    metadata: None,
                    error_code: Some(error.code()),
                },
            };
            if let Ok(mut jobs) = runtime.jobs.lock() {
                jobs.insert(key, job);
            }
        });
        Ok(queued)
    }

    pub fn query_waveform(
        &self,
        asset: &str,
        hash: &ContentHash,
        path: &Path,
        query: &WaveformQuery,
    ) -> Result<WaveformResponseV2, AudioRuntimeError> {
        self.engine
            .query(asset, hash, path, query)
            .map_err(AudioRuntimeError::Audio)
    }

    pub fn create_ranged_preview_token(
        &self,
        root: &RootId,
        asset: &str,
        hash: &ContentHash,
        path: &Path,
        range: FrameRange,
    ) -> Result<PreviewTicket, AudioRuntimeError> {
        let _generation = self
            .preview_generation
            .lock()
            .map_err(|_| AudioRuntimeError::Unavailable)?;
        let preview = self
            .engine
            .preview(hash, path, range)
            .map_err(AudioRuntimeError::Audio)?;
        let now = Instant::now();
        let token = self.new_token(root, asset);
        let ticket = PreviewTicket {
            token: token.clone(),
            expires_in_seconds: self.preview_ttl.as_secs(),
            byte_length: preview.bytes.len(),
            duration_millis: (preview.range.end_frame_exclusive - preview.range.start_frame) * 1000
                / u64::from(preview.sample_rate),
            truncated: preview.truncated,
            range: Some(preview.range),
            sample_rate: Some(preview.sample_rate),
            truncation_reason: preview.truncation_reason,
        };
        let mut state = self.lock_previews()?;
        state.records.retain(|_, record| record.expires_at > now);
        if state.records.len() >= MAX_PREVIEW_TOKENS {
            if let Some(oldest) = state
                .records
                .iter()
                .min_by_key(|(_, r)| r.expires_at)
                .map(|(key, _)| key.clone())
            {
                state.records.remove(&oldest);
            }
        }
        state.records.insert(
            token,
            PreviewRecord {
                root_id: root.clone(),
                bytes: preview.bytes,
                expires_at: now + self.preview_ttl,
                source: Some((path.to_owned(), hash.clone())),
            },
        );
        Ok(ticket)
    }

    fn new_token(&self, root_id: &RootId, asset_id: &str) -> String {
        let sequence = self.next_token.fetch_add(1, Ordering::Relaxed);
        let mut hasher = Sha256::new();
        hasher.update(b"preview:v1");
        hasher.update(self.nonce);
        hasher.update(sequence.to_be_bytes());
        hasher.update((root_id.as_str().len() as u64).to_be_bytes());
        hasher.update(root_id.as_str().as_bytes());
        hasher.update((asset_id.len() as u64).to_be_bytes());
        hasher.update(asset_id.as_bytes());
        format!("preview:v1:{:x}", hasher.finalize())
    }

    fn lock_previews(&self) -> Result<std::sync::MutexGuard<'_, PreviewState>, AudioRuntimeError> {
        self.previews
            .lock()
            .map_err(|_| AudioRuntimeError::Unavailable)
    }
}

pub fn open_shared_audio_runtime(
    data_directory: &Path,
) -> Result<SharedAudioRuntime, AudioRuntimeError> {
    Ok(Arc::new(AudioRuntime::open(
        data_directory,
        DEFAULT_PREVIEW_TTL,
    )?))
}

fn ensure_product_directory(
    canonical_data_directory: &Path,
    product_directory: &Path,
) -> Result<(), AudioRuntimeError> {
    match fs::symlink_metadata(product_directory) {
        Ok(metadata) => {
            if metadata.file_type().is_symlink() || !metadata.is_dir() {
                return Err(AudioRuntimeError::UnsafePath(
                    "product data directory must be a real directory",
                ));
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            fs::create_dir(product_directory)
                .map_err(|error| runtime_io("create product data directory", error))?;
        }
        Err(error) => return Err(runtime_io("inspect product data directory", error)),
    }

    let canonical_product_directory = product_directory
        .canonicalize()
        .map_err(|error| runtime_io("resolve product data directory", error))?;
    if !canonical_product_directory.starts_with(canonical_data_directory) {
        return Err(AudioRuntimeError::UnsafePath(
            "product data directory escaped the application data directory",
        ));
    }
    Ok(())
}

fn validate_preview_token(token: &str) -> Result<(), AudioRuntimeError> {
    let digest = token
        .strip_prefix("preview:v1:")
        .ok_or(AudioRuntimeError::InvalidPreviewToken)?;
    if digest.len() != 64
        || !digest
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(AudioRuntimeError::InvalidPreviewToken);
    }
    Ok(())
}

#[derive(Debug)]
pub enum AudioRuntimeError {
    Io {
        operation: &'static str,
        message: String,
    },
    UnsafePath(&'static str),
    Entropy(String),
    Audio(AudioError),
    InvalidPreviewToken,
    ExpiredPreviewToken,
    Unavailable,
}

impl AudioRuntimeError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::Io { .. } | Self::Entropy(_) | Self::Unavailable => "AUDIO_RUNTIME_UNAVAILABLE",
            Self::UnsafePath(_) => "AUDIO_CACHE_UNSAFE",
            Self::Audio(error) => error.code(),
            Self::InvalidPreviewToken => "PREVIEW_TOKEN_INVALID",
            Self::ExpiredPreviewToken => "PREVIEW_TOKEN_EXPIRED",
        }
    }

    pub fn recoverable(&self) -> bool {
        match self {
            Self::UnsafePath(_) | Self::Entropy(_) | Self::Unavailable => false,
            Self::Audio(error) => error.recoverable(),
            Self::Io { .. } | Self::InvalidPreviewToken | Self::ExpiredPreviewToken => true,
        }
    }
}

impl std::fmt::Display for AudioRuntimeError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io { operation, message } => {
                write!(formatter, "could not {operation}: {message}")
            }
            Self::UnsafePath(message) => formatter.write_str(message),
            Self::Entropy(message) => {
                write!(
                    formatter,
                    "could not initialize preview token entropy: {message}"
                )
            }
            Self::Audio(error) => std::fmt::Display::fmt(error, formatter),
            Self::InvalidPreviewToken => formatter.write_str("preview token is invalid or expired"),
            Self::ExpiredPreviewToken => formatter.write_str("preview token has expired"),
            Self::Unavailable => formatter.write_str("audio runtime is unavailable"),
        }
    }
}

impl std::error::Error for AudioRuntimeError {}

fn runtime_io(operation: &'static str, error: std::io::Error) -> AudioRuntimeError {
    AudioRuntimeError::Io {
        operation,
        message: error.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn runtime(ttl: Duration) -> (TempDir, AudioRuntime) {
        let data = TempDir::new().unwrap();
        let runtime = AudioRuntime::open(data.path(), ttl).unwrap();
        (data, runtime)
    }

    fn synthetic_source(directory: &Path, variant: i16) -> (PathBuf, ContentHash, String) {
        let source = directory.join(format!("synthetic-{variant}.wav"));
        let mut wav = Vec::new();
        wav.extend(b"RIFF");
        wav.extend(2036_u32.to_le_bytes());
        wav.extend(b"WAVEfmt ");
        wav.extend(16_u32.to_le_bytes());
        wav.extend(1_u16.to_le_bytes());
        wav.extend(1_u16.to_le_bytes());
        wav.extend(8000_u32.to_le_bytes());
        wav.extend(16000_u32.to_le_bytes());
        wav.extend(2_u16.to_le_bytes());
        wav.extend(16_u16.to_le_bytes());
        wav.extend(b"data");
        wav.extend(2000_u32.to_le_bytes());
        for _ in 0..1000 {
            wav.extend(variant.to_le_bytes());
        }
        fs::write(&source, &wav).unwrap();
        let hash = ContentHash::parse(format!("sha256:{:x}", Sha256::digest(&wav))).unwrap();
        let mut digest = Sha256::new();
        digest.update(b"asset:v1");
        digest.update((hash.as_str().len() as u64).to_be_bytes());
        digest.update(hash.as_str().as_bytes());
        let asset = format!("asset:v1:{:x}", digest.finalize());
        (source, hash, asset)
    }

    #[test]
    fn waveform_jobs_share_content_and_bound_the_background_queue() {
        let data = TempDir::new().unwrap();
        let source_root = TempDir::new().unwrap();
        let source_directory = source_root.path().canonicalize().unwrap();
        let runtime = open_shared_audio_runtime(data.path()).unwrap();
        let generation = runtime.job_generation.lock().unwrap();
        let sources: Vec<_> = (0..9)
            .map(|i| synthetic_source(&source_directory, i))
            .collect();
        for (source, hash, asset) in sources.iter().take(8) {
            assert_eq!(
                runtime.prepare_waveform(asset, hash, source).unwrap().state,
                "QUEUED"
            );
        }
        let (source, hash, asset) = &sources[0];
        assert_eq!(
            runtime.prepare_waveform(asset, hash, source).unwrap().state,
            "QUEUED"
        );
        assert_eq!(runtime.jobs.lock().unwrap().len(), 8);
        let (source, hash, asset) = &sources[8];
        assert!(runtime.prepare_waveform(asset, hash, source).is_err());
        // Browsing and preview bookkeeping are never locked by waveform generation.
        assert!(runtime.previews.try_lock().is_ok());
        drop(generation);
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            let complete = runtime
                .jobs
                .lock()
                .unwrap()
                .values()
                .all(|job| job.state == "READY");
            if complete {
                break;
            }
            assert!(
                Instant::now() < deadline,
                "background generation did not complete"
            );
            std::thread::sleep(Duration::from_millis(5));
        }
        for (source, hash, _) in sources.iter().take(8) {
            assert_eq!(
                format!("sha256:{:x}", Sha256::digest(fs::read(source).unwrap())),
                hash.as_str()
            );
        }
    }

    #[test]
    fn creates_product_directory_when_missing() {
        let data = TempDir::new().unwrap();
        let product = data.path().join(PRODUCT_DIRECTORY);
        assert!(!product.exists());
        AudioRuntime::open(data.path(), Duration::from_secs(60)).unwrap();
        assert!(product.is_dir());
    }

    #[test]
    fn preview_tokens_are_opaque_and_bound_to_one_root() {
        let (_data, runtime) = runtime(Duration::from_secs(60));
        let root = RootId::new("root-one").unwrap();
        let other = RootId::new("root-two").unwrap();
        let token = runtime.new_token(&root, "asset:v1:opaque");
        runtime.previews.lock().unwrap().records.insert(
            token.clone(),
            PreviewRecord {
                root_id: root.clone(),
                bytes: b"preview".to_vec(),
                expires_at: Instant::now() + Duration::from_secs(60),
                source: None,
            },
        );

        assert!(token.starts_with("preview:v1:"));
        assert!(!token.contains(root.as_str()));
        assert!(matches!(
            runtime.read_preview(&other, &token),
            Err(AudioRuntimeError::InvalidPreviewToken)
        ));
        assert_eq!(runtime.read_preview(&root, &token).unwrap(), b"preview");
        assert!(matches!(
            runtime.read_preview(&root, &token),
            Err(AudioRuntimeError::InvalidPreviewToken)
        ));
    }

    #[test]
    fn expired_preview_tokens_fail_closed() {
        let (_data, runtime) = runtime(Duration::ZERO);
        let root = RootId::new("root-one").unwrap();
        let token = runtime.new_token(&root, "asset:v1:opaque");
        runtime.previews.lock().unwrap().records.insert(
            token.clone(),
            PreviewRecord {
                root_id: root.clone(),
                bytes: b"preview".to_vec(),
                expires_at: Instant::now(),
                source: None,
            },
        );

        assert!(matches!(
            runtime.read_preview(&root, &token),
            Err(AudioRuntimeError::ExpiredPreviewToken)
        ));
    }

    #[cfg(unix)]
    #[test]
    fn rejects_a_symlinked_waveform_cache_directory() {
        use std::os::unix::fs::symlink;

        let data = TempDir::new().unwrap();
        let outside = TempDir::new().unwrap();
        let product = data.path().join(PRODUCT_DIRECTORY);
        fs::create_dir(&product).unwrap();
        symlink(outside.path(), product.join(WAVEFORM_CACHE_DIRECTORY)).unwrap();

        assert!(matches!(
            AudioRuntime::open(data.path(), Duration::from_secs(60)),
            Err(AudioRuntimeError::Audio(AudioError::UnsafeCachePath(_)))
        ));
    }
}
