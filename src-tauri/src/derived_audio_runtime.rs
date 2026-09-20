use ot_application::{
    DerivedAudioPublisher, TrimApplyError, TrimDerivationVerifier, TrimVerificationKind,
    TrimWavProcessor,
};
use ot_audio::trim_wav_integer_pcm;
use ot_domain::ContentHash;
use ot_domain::{ExpectedTrimOutput, TrimIntent, TrimPlan};
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
#[cfg(test)]
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::{Arc, Mutex};

const PRODUCT_DIRECTORY: &str = "MasterOCTa";
const DERIVED_DIRECTORY: &str = "derived-audio";
const STAGING_DIRECTORY: &str = "staging";
const PUBLISHED_DIRECTORY: &str = "published";

pub struct DerivedAudioRuntime {
    product_directory: PathBuf,
    #[cfg(test)]
    test_publish_fail_stage: AtomicU8,
}

impl DerivedAudioRuntime {
    pub fn open(data_directory: &Path) -> Result<Self, DerivedAudioRuntimeError> {
        fs::create_dir_all(data_directory)
            .map_err(|error| runtime_io("create data directory", error))?;
        let canonical_data_directory = data_directory
            .canonicalize()
            .map_err(|error| runtime_io("resolve data directory", error))?;
        let product_directory = canonical_data_directory.join(PRODUCT_DIRECTORY);
        ensure_product_directory(&canonical_data_directory, &product_directory)?;
        let derived_root = product_directory.join(DERIVED_DIRECTORY);
        ensure_subdirectory(&product_directory, &derived_root)?;
        ensure_subdirectory(&derived_root, &derived_root.join(STAGING_DIRECTORY))?;
        ensure_subdirectory(&derived_root, &derived_root.join(PUBLISHED_DIRECTORY))?;
        Ok(Self {
            product_directory,
            #[cfg(test)]
            test_publish_fail_stage: AtomicU8::new(0),
        })
    }

    #[cfg(test)]
    pub fn set_test_publish_fail_stage(&self, stage: u8) {
        self.test_publish_fail_stage.store(stage, Ordering::SeqCst);
    }

    #[cfg(test)]
    pub fn clear_test_publish_fail_stage(&self) {
        self.test_publish_fail_stage.store(0, Ordering::SeqCst);
    }

    fn publish_fail_stage(&self) -> u8 {
        #[cfg(test)]
        {
            self.test_publish_fail_stage.load(Ordering::SeqCst)
        }
        #[cfg(not(test))]
        {
            0
        }
    }

    fn derived_root(&self) -> PathBuf {
        self.product_directory.join(DERIVED_DIRECTORY)
    }

    fn staging_directory(&self) -> PathBuf {
        self.derived_root().join(STAGING_DIRECTORY)
    }

    fn published_path(&self, relative: &str) -> Result<PathBuf, DerivedAudioRuntimeError> {
        if relative.contains("..") || relative.starts_with('/') {
            return Err(DerivedAudioRuntimeError::UnsafePath {
                reason: "derived publish path must stay root-relative",
            });
        }
        let published = self.derived_root().join(PUBLISHED_DIRECTORY);
        let candidate = published.join(relative);
        if let Some(parent) = candidate.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| runtime_io("create derived publish parent", error))?;
        }
        let canonical_published = published
            .canonicalize()
            .map_err(|error| runtime_io("resolve published directory", error))?;
        let canonical_parent = candidate
            .parent()
            .ok_or(DerivedAudioRuntimeError::UnsafePath {
                reason: "missing derived parent directory",
            })?
            .canonicalize()
            .map_err(|error| runtime_io("resolve derived publish parent", error))?;
        if !canonical_parent.starts_with(&canonical_published) {
            return Err(DerivedAudioRuntimeError::UnsafePath {
                reason: "derived publish path escaped published root",
            });
        }
        Ok(candidate)
    }

    #[cfg(test)]
    pub(crate) fn staging_directory_for_tests(&self) -> PathBuf {
        self.staging_directory()
    }
}

pub struct OtAudioTrimProcessor;

impl TrimWavProcessor for OtAudioTrimProcessor {
    fn trim_wav(
        &self,
        source_bytes: &[u8],
        intent: &TrimIntent,
    ) -> Result<ot_application::TrimWavResult, TrimApplyError> {
        let cancelled = AtomicBool::new(false);
        let wav_bytes = trim_wav_integer_pcm(source_bytes, intent.range(), &cancelled)
            .map_err(|error| TrimApplyError::Processor(error.to_string()))?;
        let layout = ot_audio::pcm::inspect_wav_layout(&wav_bytes, &cancelled)
            .map_err(|error| TrimApplyError::Processor(error.to_string()))?;
        Ok(ot_application::TrimWavResult {
            output_hash: ot_audio::content_hash_for_bytes(&wav_bytes),
            wav_bytes,
            expected: ExpectedTrimOutput {
                sample_rate: layout.info.sample_rate,
                channels: layout.info.channels,
                bits_per_sample: layout.info.bits_per_sample,
                frame_count: layout.info.frame_count,
            },
        })
    }
}

pub struct OtAudioTrimVerifier;

fn map_trim_verify_error(error: ot_audio::pcm::PcmError) -> TrimApplyError {
    use ot_audio::pcm::PcmError;
    match error {
        PcmError::Cancelled => TrimApplyError::Processor("cancelled".into()),
        PcmError::LimitExceeded => TrimApplyError::Verification {
            kind: TrimVerificationKind::MalformedOutput,
            message: "wav size limit exceeded".into(),
        },
        PcmError::Audio(audio_error) => {
            let message = audio_error.to_string();
            let kind = if message.contains("PCM payload mismatch") {
                TrimVerificationKind::PcmMismatch
            } else if message.contains("metadata mismatch")
                || message.contains("frame count mismatch")
                || message.contains("payload length mismatch")
            {
                TrimVerificationKind::MetadataMismatch
            } else {
                TrimVerificationKind::MalformedOutput
            };
            TrimApplyError::Verification { kind, message }
        }
    }
}

impl TrimDerivationVerifier for OtAudioTrimVerifier {
    fn content_hash(&self, bytes: &[u8]) -> Result<ContentHash, TrimApplyError> {
        Ok(ot_audio::content_hash_for_bytes(bytes))
    }

    fn verify_source_for_intent(
        &self,
        source_bytes: &[u8],
        intent: &TrimIntent,
    ) -> Result<(), TrimApplyError> {
        let cancelled = AtomicBool::new(false);
        let layout = ot_audio::pcm::inspect_wav_layout(source_bytes, &cancelled)
            .map_err(map_trim_verify_error)?;
        intent
            .range()
            .within(layout.info.frame_count)
            .map_err(|_| TrimApplyError::Verification {
                kind: TrimVerificationKind::MalformedOutput,
                message: "trim range outside source".into(),
            })?;
        Ok(())
    }

    fn verify_output_pcm(
        &self,
        source_bytes: &[u8],
        intent: &TrimIntent,
        output_wav_bytes: &[u8],
    ) -> Result<ExpectedTrimOutput, TrimApplyError> {
        let cancelled = AtomicBool::new(false);
        ot_audio::verify_trim_wav_output(source_bytes, intent.range(), output_wav_bytes, &cancelled)
            .map_err(map_trim_verify_error)
    }
}

struct StagingPartGuard {
    path: PathBuf,
    armed: bool,
}

impl StagingPartGuard {
    fn new(path: PathBuf) -> Self {
        Self { path, armed: true }
    }

    fn disarm(&mut self) {
        self.armed = false;
    }
}

impl Drop for StagingPartGuard {
    fn drop(&mut self) {
        if self.armed {
            let _ = fs::remove_file(&self.path);
        }
    }
}

fn reject_non_regular_destination(path: &Path) -> Result<(), TrimApplyError> {
    match fs::symlink_metadata(path) {
        Ok(metadata) => {
            let file_type = metadata.file_type();
            if file_type.is_symlink() {
                return Err(TrimApplyError::Publish(
                    "derived publish path is a symlink".into(),
                ));
            }
            if metadata.is_dir() {
                return Err(TrimApplyError::Publish(
                    "derived publish path is a directory".into(),
                ));
            }
            if !file_type.is_file() {
                return Err(TrimApplyError::Publish(
                    "derived publish path is not a regular file".into(),
                ));
            }
            Ok(())
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(TrimApplyError::Publish(error.to_string())),
    }
}

pub type SharedDerivedAudioRuntime = Arc<Mutex<DerivedAudioRuntime>>;

pub fn open_shared_derived_audio_runtime(
    data_directory: &Path,
) -> Result<SharedDerivedAudioRuntime, DerivedAudioRuntimeError> {
    Ok(Arc::new(Mutex::new(DerivedAudioRuntime::open(
        data_directory,
    )?)))
}

impl DerivedAudioPublisher for DerivedAudioRuntime {
    fn publish_trim_output(
        &mut self,
        plan: &TrimPlan,
        wav_bytes: &[u8],
        output_hash: &ContentHash,
    ) -> Result<(), TrimApplyError> {
        let destination = self
            .published_path(plan.published_relative_path())
            .map_err(|error| TrimApplyError::Publish(error.to_string()))?;
        reject_non_regular_destination(&destination)?;
        if fs::symlink_metadata(&destination).is_ok() {
            let existing = fs::read(&destination)
                .map_err(|error| TrimApplyError::Publish(error.to_string()))?;
            let existing_hash = ot_audio::content_hash_for_bytes(&existing);
            if existing_hash == *output_hash {
                return Ok(());
            }
            return Err(TrimApplyError::Publish(
                "derived publish path already exists with different content".into(),
            ));
        }
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| TrimApplyError::Publish(error.to_string()))?;
        }
        let staging_name = format!(
            "trim-{}-{}.part",
            output_hash.as_str().replace(':', ""),
            std::process::id()
        );
        let staging_path = self.staging_directory().join(staging_name);
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&staging_path)
            .map_err(|error| TrimApplyError::Publish(error.to_string()))?;
        let mut guard = StagingPartGuard::new(staging_path.clone());
        if self.publish_fail_stage() == 1 {
            return Err(TrimApplyError::Publish("injected write failure".into()));
        }
        file.write_all(wav_bytes)
            .map_err(|error| TrimApplyError::Publish(error.to_string()))?;
        if self.publish_fail_stage() == 2 {
            return Err(TrimApplyError::Publish("injected sync failure".into()));
        }
        file.sync_all()
            .map_err(|error| TrimApplyError::Publish(error.to_string()))?;
        if self.publish_fail_stage() == 3 {
            return Err(TrimApplyError::Publish("injected rename failure".into()));
        }
        fs::rename(&staging_path, &destination)
            .map_err(|error| TrimApplyError::Publish(error.to_string()))?;
        guard.disarm();
        Ok(())
    }
}

#[derive(Debug)]
pub enum DerivedAudioRuntimeError {
    Io {
        operation: &'static str,
        message: String,
    },
    UnsafePath {
        reason: &'static str,
    },
}

impl std::fmt::Display for DerivedAudioRuntimeError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io { operation, message } => {
                write!(formatter, "could not {operation}: {message}")
            }
            Self::UnsafePath { reason } => formatter.write_str(reason),
        }
    }
}

impl std::error::Error for DerivedAudioRuntimeError {}

fn runtime_io(operation: &'static str, error: io::Error) -> DerivedAudioRuntimeError {
    DerivedAudioRuntimeError::Io {
        operation,
        message: error.to_string(),
    }
}

fn ensure_product_directory(
    canonical_data_directory: &Path,
    product_directory: &Path,
) -> Result<(), DerivedAudioRuntimeError> {
    match fs::symlink_metadata(product_directory) {
        Ok(metadata) => {
            if metadata.file_type().is_symlink() || !metadata.is_dir() {
                return Err(DerivedAudioRuntimeError::UnsafePath {
                    reason: "product directory must be a real directory",
                });
            }
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            fs::create_dir(product_directory)
                .map_err(|error| runtime_io("create product directory", error))?;
        }
        Err(error) => return Err(runtime_io("inspect product directory", error)),
    }
    let canonical_product = product_directory
        .canonicalize()
        .map_err(|error| runtime_io("resolve product directory", error))?;
    if !canonical_product.starts_with(canonical_data_directory) {
        return Err(DerivedAudioRuntimeError::UnsafePath {
            reason: "product directory escaped application data directory",
        });
    }
    Ok(())
}

fn ensure_subdirectory(parent: &Path, directory: &Path) -> Result<(), DerivedAudioRuntimeError> {
    match fs::symlink_metadata(directory) {
        Ok(metadata) => {
            if metadata.file_type().is_symlink() || !metadata.is_dir() {
                return Err(DerivedAudioRuntimeError::UnsafePath {
                    reason: "derived subdirectory must be a real directory",
                });
            }
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            fs::create_dir(directory)
                .map_err(|error| runtime_io("create derived directory", error))?;
        }
        Err(error) => return Err(runtime_io("inspect derived directory", error)),
    }
    let canonical_parent = parent
        .canonicalize()
        .map_err(|error| runtime_io("resolve derived parent", error))?;
    let canonical_directory = directory
        .canonicalize()
        .map_err(|error| runtime_io("resolve derived directory", error))?;
    if !canonical_directory.starts_with(&canonical_parent) {
        return Err(DerivedAudioRuntimeError::UnsafePath {
            reason: "derived directory escaped product directory",
        });
    }
    Ok(())
}

fn staging_part_files(staging_directory: &Path) -> Vec<PathBuf> {
    fs::read_dir(staging_directory)
        .map(|read_dir| {
            read_dir
                .filter_map(Result::ok)
                .map(|entry| entry.path())
                .filter(|path| {
                    path.file_name()
                        .and_then(|name| name.to_str())
                        .is_some_and(|name| name.ends_with(".part"))
                })
                .collect()
        })
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use ot_application::{
        ApplySliceExportDerivation, ApplyTrimDerivation, SliceExportApplyError, TrimApplyError,
    };
    use ot_domain::slice_draft::{DraftMarker, SliceDraft};
    use ot_domain::slicing::{FrameRange, PcmFrame};
    use ot_domain::{ContentHash, RootRelativePath, SliceExportIntent, TrimIntent};
    use ot_storage_ports::slice_drafts::{SliceDraftBinding, SliceDraftCatalog};
    use ot_storage_ports::{
        AssetDerivationCatalog, CatalogRootIdentity, DerivedAudioCatalog, DerivedFileUpsert,
    };
    use sha2::{Digest, Sha256};
    use std::sync::atomic::AtomicBool;
    use tempfile::TempDir;

    fn hash_bytes(bytes: &[u8]) -> ContentHash {
        ContentHash::parse(format!("sha256:{:x}", Sha256::digest(bytes))).unwrap()
    }

    fn sample_plan(output_hash: &ContentHash) -> TrimPlan {
        let source = ContentHash::parse(format!("sha256:{:064x}", 1)).unwrap();
        let range = FrameRange::new(PcmFrame::new(0), PcmFrame::new(10)).unwrap();
        let expected = ExpectedTrimOutput {
            sample_rate: 44_100,
            channels: 1,
            bits_per_sample: 16,
            frame_count: range.frame_count(),
        };
        let parameters = ot_domain::DerivationParameterEnvelope::trim(range).unwrap();
        let processor = ot_domain::standard_trim_processor().unwrap();
        TrimPlan::new(
            source.clone(),
            source,
            range,
            expected,
            processor,
            parameters,
            output_hash,
        )
        .unwrap()
    }

    #[test]
    fn trim_vertical_slice_registers_lineage_and_preserves_source() {
        let data = TempDir::new().unwrap();
        let mut runtime = DerivedAudioRuntime::open(data.path()).unwrap();
        let shared_catalog = crate::catalog_runtime::open_shared_catalog(data.path()).unwrap();
        let mut catalog = shared_catalog.lock().unwrap();
        let source_bytes = ot_audio::test_minimal_wav(200);
        let source_hash = hash_bytes(&source_bytes);
        catalog
            .upsert_derived_file(&DerivedFileUpsert {
                content_hash: source_hash.clone(),
                byte_size: source_bytes.len() as u64,
                relative_path: "fixtures/source.wav".into(),
                modified_at_unix_ns: None,
            })
            .unwrap();
        let range = FrameRange::new(PcmFrame::new(40), PcmFrame::new(120)).unwrap();
        let intent = TrimIntent::new(source_hash.clone(), range);
        let processor = OtAudioTrimProcessor;
        let verifier = OtAudioTrimVerifier;
        let before = hash_bytes(&source_bytes);
        let output = {
            let mut apply = ApplyTrimDerivation::new(
                &processor,
                &verifier,
                &mut runtime,
                &mut *catalog,
                "2026-09-20T12:00:00.000Z",
            );
            let result = apply
                .execute(&intent, &source_bytes, &source_hash, &before)
                .unwrap();
            assert_eq!(hash_bytes(&source_bytes), before);
            assert!(result.source_unchanged);
            result.output
        };
        let loaded = catalog.load_asset_derivation(&output).unwrap().unwrap();
        assert_eq!(loaded.source(), &source_hash);
        assert_eq!(loaded.kind(), ot_domain::DerivationKind::Trim);
        {
            let mut apply = ApplyTrimDerivation::new(
                &processor,
                &verifier,
                &mut runtime,
                &mut *catalog,
                "2026-09-20T12:00:00.000Z",
            );
            apply
                .execute(&intent, &source_bytes, &source_hash, &before)
                .unwrap();
        }
    }

    #[test]
    fn full_range_trim_is_rejected_as_noop() {
        let data = TempDir::new().unwrap();
        let mut runtime = DerivedAudioRuntime::open(data.path()).unwrap();
        let shared_catalog = crate::catalog_runtime::open_shared_catalog(data.path()).unwrap();
        let mut catalog = shared_catalog.lock().unwrap();
        let source_bytes = ot_audio::test_minimal_wav(200);
        let source_hash = hash_bytes(&source_bytes);
        let cancelled = AtomicBool::new(false);
        let layout = ot_audio::pcm::inspect_wav_layout(&source_bytes, &cancelled).unwrap();
        let full_range =
            FrameRange::new(PcmFrame::new(0), PcmFrame::new(layout.info.frame_count)).unwrap();
        let intent = TrimIntent::new(source_hash.clone(), full_range);
        let processor = OtAudioTrimProcessor;
        let verifier = OtAudioTrimVerifier;
        let before = hash_bytes(&source_bytes);
        let mut apply = ApplyTrimDerivation::new(
            &processor,
            &verifier,
            &mut runtime,
            &mut *catalog,
            "2026-09-20T12:00:00.000Z",
        );
        assert!(matches!(
            apply.execute(&intent, &source_bytes, &source_hash, &before),
            Err(TrimApplyError::NoOpDerivation)
        ));
        assert!(catalog.list_derivation_edges().unwrap().is_empty());
        assert!(staging_part_files(&runtime.staging_directory_for_tests()).is_empty());
    }

    #[test]
    fn publish_rejects_symlink_destination() {
        #[cfg(not(unix))]
        return;

        #[cfg(unix)]
        {
            use std::os::unix::fs::symlink;
            let data = TempDir::new().unwrap();
            let outside = TempDir::new().unwrap();
            let outside_file = outside.path().join("secret.wav");
            fs::write(&outside_file, b"outside").unwrap();
            let mut runtime = DerivedAudioRuntime::open(data.path()).unwrap();
            let output_hash = hash_bytes(b"payload");
            let plan = sample_plan(&output_hash);
            let destination = runtime
                .published_path(plan.published_relative_path())
                .unwrap();
            if let Some(parent) = destination.parent() {
                fs::create_dir_all(parent).unwrap();
            }
            symlink(&outside_file, &destination).unwrap();
            let err = runtime
                .publish_trim_output(&plan, b"payload", &output_hash)
                .unwrap_err();
            assert!(matches!(err, TrimApplyError::Publish(_)));
            assert_eq!(fs::read(&outside_file).unwrap(), b"outside");
        }
    }

    #[test]
    fn staging_part_removed_after_write_sync_or_rename_failure() {
        let data = TempDir::new().unwrap();
        let mut runtime = DerivedAudioRuntime::open(data.path()).unwrap();
        let staging = runtime.staging_directory_for_tests();
        let output_hash = hash_bytes(b"wav");
        let plan = sample_plan(&output_hash);
        let wav = b"wav-bytes";
        for stage in 1..=3 {
            runtime.clear_test_publish_fail_stage();
            runtime.set_test_publish_fail_stage(stage);
            let _ = runtime.publish_trim_output(&plan, wav, &output_hash);
            assert!(
                staging_part_files(&staging).is_empty(),
                "stage {stage} left .part residue"
            );
        }
        runtime.clear_test_publish_fail_stage();
        runtime
            .publish_trim_output(&plan, wav, &output_hash)
            .unwrap();
        assert!(staging_part_files(&staging).is_empty());
        runtime.clear_test_publish_fail_stage();
    }

    #[test]
    fn publish_fail_stage_isolated_per_runtime_instance() {
        let data_a = TempDir::new().unwrap();
        let data_b = TempDir::new().unwrap();
        let mut runtime_a = DerivedAudioRuntime::open(data_a.path()).unwrap();
        let mut runtime_b = DerivedAudioRuntime::open(data_b.path()).unwrap();
        let output_a = hash_bytes(b"runtime-a");
        let output_b = hash_bytes(b"runtime-b");
        let plan_a = sample_plan(&output_a);
        let plan_b = sample_plan(&output_b);
        runtime_a.set_test_publish_fail_stage(3);
        assert!(runtime_a
            .publish_trim_output(&plan_a, b"wav-a", &output_a)
            .is_err());
        runtime_b
            .publish_trim_output(&plan_b, b"wav-b", &output_b)
            .unwrap();
        runtime_a.clear_test_publish_fail_stage();
    }

    #[derive(Clone, Copy, Debug)]
    enum TrimOutputFault {
        PcmOneByte,
        ChannelsOnly,
        BitsBlockAlign,
        SampleRate,
        SameLengthContent,
    }

    struct FaultyOtAudioTrimProcessor {
        fault: TrimOutputFault,
    }

    impl TrimWavProcessor for FaultyOtAudioTrimProcessor {
        fn trim_wav(
            &self,
            source_bytes: &[u8],
            intent: &TrimIntent,
        ) -> Result<ot_application::TrimWavResult, TrimApplyError> {
            let mut result = OtAudioTrimProcessor.trim_wav(source_bytes, intent)?;
            corrupt_trim_output(&mut result.wav_bytes, self.fault);
            Ok(result)
        }
    }

    fn corrupt_trim_output(wav: &mut [u8], fault: TrimOutputFault) {
        match fault {
            TrimOutputFault::PcmOneByte | TrimOutputFault::SameLengthContent => {
                let cancelled = AtomicBool::new(false);
                let layout = ot_audio::pcm::inspect_wav_layout(wav, &cancelled).unwrap();
                let payload_offset = wav.len() - layout.pcm_payload.len();
                let index = if matches!(fault, TrimOutputFault::SameLengthContent)
                    && layout.pcm_payload.len() > 1
                {
                    payload_offset + 1
                } else {
                    payload_offset
                };
                wav[index] ^= 0x01;
            }
            TrimOutputFault::ChannelsOnly => {
                wav[22..24].copy_from_slice(&2_u16.to_le_bytes());
            }
            TrimOutputFault::SampleRate => {
                wav[24..28].copy_from_slice(&48_000_u32.to_le_bytes());
            }
            TrimOutputFault::BitsBlockAlign => {
                wav[34..36].copy_from_slice(&24_u16.to_le_bytes());
            }
        }
    }

    fn assert_faulty_trim_has_no_side_effects(
        runtime: &DerivedAudioRuntime,
        catalog: &impl AssetDerivationCatalog,
        source_bytes: &[u8],
        before_source_hash: &ContentHash,
    ) {
        assert_eq!(hash_bytes(source_bytes), *before_source_hash);
        assert!(catalog.list_derivation_edges().unwrap().is_empty());
        assert!(staging_part_files(&runtime.staging_directory_for_tests()).is_empty());
    }

    #[test]
    fn faulty_processor_output_fails_independent_verification_without_publish() {
        let faults = [
            TrimOutputFault::PcmOneByte,
            TrimOutputFault::ChannelsOnly,
            TrimOutputFault::BitsBlockAlign,
            TrimOutputFault::SampleRate,
            TrimOutputFault::SameLengthContent,
        ];
        for fault in faults {
            let data = TempDir::new().unwrap();
            let mut runtime = DerivedAudioRuntime::open(data.path()).unwrap();
            let shared_catalog = crate::catalog_runtime::open_shared_catalog(data.path()).unwrap();
            let mut catalog = shared_catalog.lock().unwrap();
            let source_bytes = ot_audio::test_minimal_wav(200);
            let source_hash = hash_bytes(&source_bytes);
            let before = source_hash.clone();
            catalog
                .upsert_derived_file(&DerivedFileUpsert {
                    content_hash: source_hash.clone(),
                    byte_size: source_bytes.len() as u64,
                    relative_path: format!("fixtures/fault-{fault:?}.wav"),
                    modified_at_unix_ns: None,
                })
                .unwrap();
            let range = FrameRange::new(PcmFrame::new(40), PcmFrame::new(120)).unwrap();
            let intent = TrimIntent::new(source_hash.clone(), range);
            let processor = FaultyOtAudioTrimProcessor { fault };
            let verifier = OtAudioTrimVerifier;
            let mut apply = ApplyTrimDerivation::new(
                &processor,
                &verifier,
                &mut runtime,
                &mut *catalog,
                "2026-09-20T12:00:00.000Z",
            );
            assert!(
                matches!(
                    apply.execute(&intent, &source_bytes, &source_hash, &before),
                    Err(TrimApplyError::Verification { .. })
                ),
                "fault {:?} should fail verification",
                fault
            );
            assert_faulty_trim_has_no_side_effects(&runtime, &*catalog, &source_bytes, &before);
        }
    }

    fn fixture_slice_draft_binding(
        source_hash: &ContentHash,
        source_bytes: &[u8],
    ) -> SliceDraftBinding {
        let cancelled = AtomicBool::new(false);
        let layout = ot_audio::pcm::inspect_wav_layout(source_bytes, &cancelled).unwrap();
        SliceDraftBinding {
            root: CatalogRootIdentity::new(format!("rootfp:v1:{}", "2".repeat(64))).unwrap(),
            relative_path: RootRelativePath::parse("SET/AUDIO/slice-export-fixture.wav").unwrap(),
            source_hash: source_hash.clone(),
            sample_rate: layout.info.sample_rate,
            frame_count: layout.info.frame_count,
        }
    }

    fn draft_with_three_markers(frame_count: u64) -> SliceDraft {
        let region = FrameRange::new(PcmFrame::new(0), PcmFrame::new(frame_count)).unwrap();
        let draft = SliceDraft {
            revision: 0,
            region,
            markers: vec![
                DraftMarker {
                    id: "first".into(),
                    start: PcmFrame::new(0),
                    locked: false,
                    manual: false,
                    candidate_id: None,
                    estimated_attack: None,
                },
                DraftMarker {
                    id: "middle".into(),
                    start: PcmFrame::new(40),
                    locked: false,
                    manual: false,
                    candidate_id: None,
                    estimated_attack: None,
                },
                DraftMarker {
                    id: "last".into(),
                    start: PcmFrame::new(160),
                    locked: false,
                    manual: false,
                    candidate_id: None,
                    estimated_attack: None,
                },
            ],
            suppressed_candidate_ids: Default::default(),
            exclusions: vec![],
        };
        draft.validate().unwrap();
        draft
    }

    #[test]
    fn slice_export_vertical_slice_registers_lineage_and_retries_idempotently() {
        let data = TempDir::new().unwrap();
        let mut runtime = DerivedAudioRuntime::open(data.path()).unwrap();
        let shared_catalog = crate::catalog_runtime::open_shared_catalog(data.path()).unwrap();
        let mut catalog = shared_catalog.lock().unwrap();
        let source_bytes = ot_audio::test_minimal_wav(200);
        let source_hash = hash_bytes(&source_bytes);
        let before = hash_bytes(&source_bytes);
        catalog
            .upsert_derived_file(&DerivedFileUpsert {
                content_hash: source_hash.clone(),
                byte_size: source_bytes.len() as u64,
                relative_path: "fixtures/slice-export-source.wav".into(),
                modified_at_unix_ns: None,
            })
            .unwrap();
        let binding = fixture_slice_draft_binding(&source_hash, &source_bytes);
        let draft = draft_with_three_markers(binding.frame_count);
        let saved = catalog.save_slice_draft(&binding, &draft, 0).unwrap();
        assert_eq!(saved.revision, 1);
        let range = saved.marker_range("middle").unwrap();
        let intent = SliceExportIntent::new(source_hash.clone(), saved.revision, "middle", range);
        let processor = OtAudioTrimProcessor;
        let verifier = OtAudioTrimVerifier;
        let output = {
            let mut apply = ApplySliceExportDerivation::new(
                &processor,
                &verifier,
                &mut runtime,
                &mut *catalog,
                "2026-09-20T12:00:00.000Z",
            );
            let result = apply
                .execute(&binding, &intent, &source_bytes, &source_hash, &before)
                .unwrap();
            assert!(result.source_unchanged);
            assert_eq!(hash_bytes(&source_bytes), before);
            result.output
        };
        let loaded = catalog.load_asset_derivation(&output).unwrap().unwrap();
        assert_eq!(loaded.kind(), ot_domain::DerivationKind::SliceExport);
        assert_eq!(loaded.source(), &source_hash);
        let cancelled = AtomicBool::new(false);
        ot_audio::verify_trim_wav_output(
            &source_bytes,
            range,
            &{
                let path = runtime
                    .published_path(&format!(
                        "v1/{}.wav",
                        output.as_str().strip_prefix("sha256:").unwrap()
                    ))
                    .unwrap();
                fs::read(path).unwrap()
            },
            &cancelled,
        )
        .unwrap();
        {
            let mut apply = ApplySliceExportDerivation::new(
                &processor,
                &verifier,
                &mut runtime,
                &mut *catalog,
                "2026-09-20T12:00:00.000Z",
            );
            apply
                .execute(&binding, &intent, &source_bytes, &source_hash, &before)
                .unwrap();
        }
        drop(catalog);
        let shared = crate::catalog_runtime::open_shared_catalog(data.path()).unwrap();
        let reopened = shared.lock().unwrap();
        assert_eq!(
            reopened
                .load_asset_derivation(&output)
                .unwrap()
                .unwrap()
                .kind(),
            ot_domain::DerivationKind::SliceExport
        );
    }

    #[test]
    fn slice_export_24bit_stereo_pcm_verification() {
        let data = TempDir::new().unwrap();
        let mut runtime = DerivedAudioRuntime::open(data.path()).unwrap();
        let shared_catalog = crate::catalog_runtime::open_shared_catalog(data.path()).unwrap();
        let mut catalog = shared_catalog.lock().unwrap();
        let source_bytes = ot_audio::test_integer_pcm_wav(24, 2, 44_100, 200);
        let source_hash = hash_bytes(&source_bytes);
        catalog
            .upsert_derived_file(&DerivedFileUpsert {
                content_hash: source_hash.clone(),
                byte_size: source_bytes.len() as u64,
                relative_path: "fixtures/slice-export-24bit-stereo.wav".into(),
                modified_at_unix_ns: None,
            })
            .unwrap();
        let binding = fixture_slice_draft_binding(&source_hash, &source_bytes);
        let draft = draft_with_three_markers(binding.frame_count);
        let saved = catalog.save_slice_draft(&binding, &draft, 0).unwrap();
        let range = saved.marker_range("middle").unwrap();
        let intent = SliceExportIntent::new(source_hash.clone(), saved.revision, "middle", range);
        let processor = OtAudioTrimProcessor;
        let verifier = OtAudioTrimVerifier;
        let before = hash_bytes(&source_bytes);
        let mut apply = ApplySliceExportDerivation::new(
            &processor,
            &verifier,
            &mut runtime,
            &mut *catalog,
            "2026-09-20T12:00:00.000Z",
        );
        let output = apply
            .execute(&binding, &intent, &source_bytes, &source_hash, &before)
            .unwrap()
            .output;
        let published = runtime
            .published_path(&format!(
                "v1/{}.wav",
                output.as_str().strip_prefix("sha256:").unwrap()
            ))
            .unwrap();
        let cancelled = AtomicBool::new(false);
        ot_audio::verify_trim_wav_output(
            &source_bytes,
            range,
            &fs::read(published).unwrap(),
            &cancelled,
        )
        .unwrap();
    }

    #[test]
    fn slice_export_conflicts_with_existing_trim_lineage() {
        let data = TempDir::new().unwrap();
        let mut runtime = DerivedAudioRuntime::open(data.path()).unwrap();
        let shared_catalog = crate::catalog_runtime::open_shared_catalog(data.path()).unwrap();
        let mut catalog = shared_catalog.lock().unwrap();
        let source_bytes = ot_audio::test_minimal_wav(200);
        let source_hash = hash_bytes(&source_bytes);
        let before = hash_bytes(&source_bytes);
        catalog
            .upsert_derived_file(&DerivedFileUpsert {
                content_hash: source_hash.clone(),
                byte_size: source_bytes.len() as u64,
                relative_path: "fixtures/slice-export-conflict-source.wav".into(),
                modified_at_unix_ns: None,
            })
            .unwrap();
        let binding = fixture_slice_draft_binding(&source_hash, &source_bytes);
        let draft = draft_with_three_markers(binding.frame_count);
        let saved = catalog.save_slice_draft(&binding, &draft, 0).unwrap();
        let range = saved.marker_range("middle").unwrap();
        let trim_intent = TrimIntent::new(source_hash.clone(), range);
        ApplyTrimDerivation::new(
            &OtAudioTrimProcessor,
            &OtAudioTrimVerifier,
            &mut runtime,
            &mut *catalog,
            "2026-09-20T12:00:00.000Z",
        )
        .execute(&trim_intent, &source_bytes, &source_hash, &before)
        .unwrap();
        let export_intent =
            SliceExportIntent::new(source_hash.clone(), saved.revision, "middle", range);
        let mut apply = ApplySliceExportDerivation::new(
            &OtAudioTrimProcessor,
            &OtAudioTrimVerifier,
            &mut runtime,
            &mut *catalog,
            "2026-09-20T12:00:00.000Z",
        );
        let err = apply
            .execute(
                &binding,
                &export_intent,
                &source_bytes,
                &source_hash,
                &before,
            )
            .unwrap_err();
        assert!(matches!(
            err,
            SliceExportApplyError::Catalog(ot_storage_ports::CatalogError::Derivation(
                ot_domain::InvalidDerivation::ConflictingLineage
            ))
        ));
    }

    #[test]
    fn create_new_failure_does_not_delete_preexisting_part() {
        let data = TempDir::new().unwrap();
        let mut runtime = DerivedAudioRuntime::open(data.path()).unwrap();
        let output_hash = hash_bytes(b"wav");
        let plan = sample_plan(&output_hash);
        let staging_name = format!(
            "trim-{}-{}.part",
            output_hash.as_str().replace(':', ""),
            std::process::id()
        );
        let staging_path = runtime.staging_directory_for_tests().join(staging_name);
        fs::write(&staging_path, b"owned-by-other-publisher").unwrap();
        assert!(runtime
            .publish_trim_output(&plan, b"wav-bytes", &output_hash)
            .is_err());
        assert_eq!(
            fs::read(&staging_path).unwrap(),
            b"owned-by-other-publisher"
        );
    }
}
