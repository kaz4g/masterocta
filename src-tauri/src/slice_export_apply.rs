//! Production IPC adapter for persisted slice draft → derived SLICE_EXPORT.

use crate::catalog_runtime::SharedCatalog;
use crate::derived_audio_runtime::{
    DerivedAudioRuntime, OtAudioTrimProcessor, OtAudioTrimVerifier, SharedDerivedAudioRuntime,
};
use crate::root_registry::RootRegistry;
use crate::v2_api::{
    catalog_error, catalog_identity, file_for_instance_id, load_library_snapshot, opaque_asset_id,
    ApiError,
};
use chrono::Utc;
use ot_application::{ApplySliceExportDerivation, SliceExportApplyError, TrimApplyError};
use ot_audio::content_hash_for_bytes;
use ot_audio::pcm::{inspect_wav_layout, MAX_SNAPSHOT_BYTES};
use ot_domain::{RootId, SliceExportIntent};
use ot_storage_ports::slice_drafts::{SliceDraftBinding, SliceDraftCatalog};
use ot_storage_ports::CatalogError;
use serde::{Deserialize, Serialize};
use std::io::Read;
use std::sync::atomic::AtomicBool;
use std::sync::MutexGuard;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SliceExportApplyDto {
    pub derived_asset_id: String,
    pub source_unchanged: bool,
    pub start_frame: String,
    pub end_exclusive: String,
}

pub fn slice_export_apply_sync(
    registry: &RootRegistry,
    catalog: &SharedCatalog,
    derived: &SharedDerivedAudioRuntime,
    root_id: &RootId,
    file_instance_id: &str,
    marker_id: &str,
    expected_revision: u64,
) -> Result<SliceExportApplyDto, ApiError> {
    let resolved = registry.resolve(root_id)?;
    let identity = catalog_identity(&resolved.session)?;
    let library = load_library_snapshot(catalog, &identity)?;
    let file = file_for_instance_id(&identity, &library, file_instance_id)?;
    let source = ot_backup::open_root_regular_file(&resolved.canonical_path, &file.relative_path)
        .map_err(|_| invalid("source could not be opened safely"))?;
    let before = source.metadata().map_err(|_| internal())?;
    let mut source = source;
    let source_bytes = read_bounded_wav_bytes(&mut source)?;
    let live_hash = content_hash_for_bytes(&source_bytes);
    if live_hash != file.content_hash {
        return Err(source_changed());
    }
    let current = ot_backup::open_root_regular_file(&resolved.canonical_path, &file.relative_path)
        .map_err(|_| source_changed())?;
    let after = current.metadata().map_err(|_| source_changed())?;
    if !same_file(&before, &after)
        || !same_file(&before, &source.metadata().map_err(|_| source_changed())?)
    {
        return Err(source_changed());
    }
    registry.resolve(root_id)?;
    let cancelled = AtomicBool::new(false);
    let layout = inspect_wav_layout(&source_bytes, &cancelled).map_err(pcm_layout_error)?;
    let binding = SliceDraftBinding {
        root: identity,
        relative_path: file.relative_path,
        source_hash: file.content_hash.clone(),
        sample_rate: layout.info.sample_rate,
        frame_count: layout.info.frame_count,
    };
    let (resolved_range, verified_revision) = {
        let catalog_guard = lock_catalog(catalog)?;
        let draft = SliceDraftCatalog::load_slice_draft(&*catalog_guard, &binding)
            .map_err(slice_draft_store_error)?
            .ok_or_else(slice_missing)?;
        if draft.revision != expected_revision {
            return Err(stale_draft());
        }
        let range = draft.marker_range(marker_id).map_err(|_| slice_missing())?;
        if range.within(binding.frame_count).is_err() {
            return Err(range_changed());
        }
        (range, draft.revision)
    };
    let intent = SliceExportIntent::new(
        binding.source_hash.clone(),
        verified_revision,
        marker_id,
        resolved_range,
    );
    let source_hash_before = binding.source_hash.clone();
    let verified_source_hash = live_hash;
    let created_at = Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let mut catalog_guard = lock_catalog(catalog)?;
    let mut derived_guard = lock_derived(derived)?;
    let processor = OtAudioTrimProcessor;
    let verifier = OtAudioTrimVerifier;
    let mut apply = ApplySliceExportDerivation::new(
        &processor,
        &verifier,
        &mut *derived_guard,
        &mut *catalog_guard,
        &created_at,
    );
    let result = apply
        .execute(
            &binding,
            &intent,
            &source_bytes,
            &verified_source_hash,
            &source_hash_before,
        )
        .map_err(slice_export_error)?;
    Ok(SliceExportApplyDto {
        derived_asset_id: opaque_asset_id(&result.output),
        source_unchanged: result.source_unchanged,
        start_frame: resolved_range.start().to_string(),
        end_exclusive: resolved_range.end_exclusive().to_string(),
    })
}

fn read_bounded_wav_bytes(source: &mut std::fs::File) -> Result<Vec<u8>, ApiError> {
    let metadata = source.metadata().map_err(|_| internal())?;
    let length = metadata.len();
    if length == 0 {
        return Err(invalid("source file is empty"));
    }
    if length as usize > MAX_SNAPSHOT_BYTES {
        return Err(audio_limit_exceeded());
    }
    let mut bytes = Vec::with_capacity(length as usize);
    source
        .take(length)
        .read_to_end(&mut bytes)
        .map_err(|_| internal())?;
    Ok(bytes)
}

fn same_file(a: &std::fs::Metadata, b: &std::fs::Metadata) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if a.dev() != b.dev() || a.ino() != b.ino() {
            return false;
        }
    }
    a.is_file() && b.is_file() && a.len() == b.len() && a.modified().ok() == b.modified().ok()
}

fn lock_catalog(
    catalog: &SharedCatalog,
) -> Result<MutexGuard<'_, ot_catalog::SqliteCatalog>, ApiError> {
    catalog.lock().map_err(|_| internal())
}

fn lock_derived(
    derived: &SharedDerivedAudioRuntime,
) -> Result<MutexGuard<'_, DerivedAudioRuntime>, ApiError> {
    derived.lock().map_err(|_| internal())
}

fn slice_export_error(error: SliceExportApplyError) -> ApiError {
    match error {
        SliceExportApplyError::SourceChanged => source_changed(),
        SliceExportApplyError::DraftNotFound | SliceExportApplyError::SliceMissing => {
            slice_missing()
        }
        SliceExportApplyError::StaleDraft => stale_draft(),
        SliceExportApplyError::RangeChanged | SliceExportApplyError::InvalidRange => {
            range_changed()
        }
        SliceExportApplyError::Pipeline(pipeline) => trim_pipeline_error(pipeline),
        SliceExportApplyError::Catalog(catalog) => map_catalog_for_slice_export(catalog),
        SliceExportApplyError::Plan(message) => invalid(&message),
    }
}

fn trim_pipeline_error(error: TrimApplyError) -> ApiError {
    match error {
        TrimApplyError::SourceMismatch => source_changed(),
        TrimApplyError::NoOpDerivation => ApiError::new(
            "NO_OP_DERIVATION",
            "export would not change the source audio",
            true,
        ),
        TrimApplyError::Verification { .. } => ApiError::new(
            "DERIVED_AUDIO_VERIFICATION_FAILED",
            "derived audio failed verification",
            true,
        ),
        TrimApplyError::Publish(_) => ApiError::new(
            "DERIVED_AUDIO_PUBLISH_FAILED",
            "derived audio could not be published",
            true,
        ),
        TrimApplyError::Catalog(catalog) => map_catalog_for_slice_export(catalog),
        TrimApplyError::Processor(message) | TrimApplyError::Plan(message) => invalid(&message),
    }
}

fn map_catalog_for_slice_export(error: CatalogError) -> ApiError {
    if let CatalogError::Derivation(invalid) = &error {
        if matches!(invalid, ot_domain::InvalidDerivation::ConflictingLineage) {
            return ApiError::new(
                "CONFLICTING_LINEAGE",
                "derived asset already has a registered parent",
                true,
            );
        }
    }
    catalog_error(error)
}

fn slice_draft_store_error(
    error: ot_storage_ports::slice_drafts::SliceDraftStoreError,
) -> ApiError {
    match error {
        ot_storage_ports::slice_drafts::SliceDraftStoreError::Conflict => stale_draft(),
        ot_storage_ports::slice_drafts::SliceDraftStoreError::Invalid(message) => invalid(message),
        ot_storage_ports::slice_drafts::SliceDraftStoreError::Unavailable(_) => internal(),
    }
}

fn pcm_layout_error(error: ot_audio::pcm::PcmError) -> ApiError {
    match error {
        ot_audio::pcm::PcmError::LimitExceeded => audio_limit_exceeded(),
        ot_audio::pcm::PcmError::Audio(ot_audio::AudioError::SourceChanged) => source_changed(),
        ot_audio::pcm::PcmError::Audio(error) => {
            ApiError::new(error.code(), error.to_string(), true)
        }
        ot_audio::pcm::PcmError::Cancelled => internal(),
    }
}

fn invalid(message: &str) -> ApiError {
    ApiError::new("INVALID_SLICE_REQUEST", message, true)
}

fn internal() -> ApiError {
    ApiError::new("INTERNAL_ERROR", "slice export could not complete", true)
}

fn source_changed() -> ApiError {
    ApiError::new(
        "SOURCE_CHANGED",
        "source changed; rescan and analyze again",
        true,
    )
}

fn stale_draft() -> ApiError {
    ApiError::new(
        "STALE_DRAFT",
        "the draft changed; reload it before exporting",
        true,
    )
}

fn slice_missing() -> ApiError {
    ApiError::new(
        "SLICE_MISSING",
        "the requested slice is not present in the draft",
        true,
    )
}

fn range_changed() -> ApiError {
    ApiError::new(
        "RANGE_CHANGED",
        "the slice range changed; reload the draft before exporting",
        true,
    )
}

fn audio_limit_exceeded() -> ApiError {
    ApiError::new(
        "AUDIO_LIMIT_EXCEEDED",
        "source exceeds the current 64 MiB snapshot or PCM allocation limit",
        true,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::derived_audio_runtime::DerivedAudioRuntime;
    use crate::v2_api::{gate_c_register_and_index_root, opaque_file_instance_id};
    use ot_application::ApplyTrimDerivation;
    use ot_domain::slice_draft::{DraftMarker, SliceDraft};
    use ot_domain::slicing::{FrameRange, PcmFrame};
    use ot_domain::{FileInstance, TrimIntent};
    use ot_storage_ports::CatalogRootIdentity;
    use serde_json::json;
    use std::fs;
    use std::path::Path;
    use std::sync::Arc;
    use tempfile::TempDir;

    fn registry() -> Arc<RootRegistry> {
        Arc::new(RootRegistry::default())
    }

    const FIXTURE_FRAMES: u64 = 4_000;

    fn minimal_ot_root(root: &Path) {
        let set = root.join("SET");
        fs::create_dir_all(set.join("AUDIO")).unwrap();
        fs::create_dir_all(set.join("PROJECT")).unwrap();
        fs::write(set.join("PROJECT/project.work"), b"fixture").unwrap();
        fs::write(
            set.join("AUDIO/export.wav"),
            ot_audio::test_minimal_wav(FIXTURE_FRAMES as u32),
        )
        .unwrap();
    }

    fn draft_with_marker(frame_count: u64, marker_id: &str, start: u64, end: u64) -> SliceDraft {
        let region = FrameRange::new(PcmFrame::new(0), PcmFrame::new(frame_count)).unwrap();
        let draft = SliceDraft {
            revision: 0,
            region,
            markers: vec![
                DraftMarker {
                    id: marker_id.into(),
                    start: PcmFrame::new(start),
                    locked: false,
                    manual: true,
                    candidate_id: None,
                    estimated_attack: None,
                },
                DraftMarker {
                    id: "tail".into(),
                    start: PcmFrame::new(end),
                    locked: false,
                    manual: true,
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

    fn fixture() -> (
        TempDir,
        TempDir,
        Arc<RootRegistry>,
        SharedCatalog,
        SharedDerivedAudioRuntime,
        RootId,
        String,
        FileInstance,
    ) {
        let ot_root = TempDir::new().unwrap();
        minimal_ot_root(ot_root.path());
        let data = TempDir::new().unwrap();
        let registry = registry();
        let catalog = crate::catalog_runtime::open_shared_catalog(data.path()).unwrap();
        let derived =
            crate::derived_audio_runtime::open_shared_derived_audio_runtime(data.path()).unwrap();
        let (session, _library) =
            gate_c_register_and_index_root(&registry, &catalog, ot_root.path().to_str().unwrap())
                .unwrap();
        let root_id = session.root_id.clone();
        let identity = catalog_identity(&registry.resolve(&root_id).unwrap().session).unwrap();
        let library = load_library_snapshot(&catalog, &identity).unwrap();
        let file = library
            .file_instances
            .iter()
            .find(|file| file.relative_path.as_str() == "SET/AUDIO/export.wav")
            .cloned()
            .unwrap();
        let file_instance_id = opaque_file_instance_id(&identity, &file);
        (
            ot_root,
            data,
            registry,
            catalog,
            derived,
            root_id,
            file_instance_id,
            file,
        )
    }

    fn save_draft(
        ot_root: &Path,
        catalog: &SharedCatalog,
        identity: &CatalogRootIdentity,
        file: &FileInstance,
        draft: &SliceDraft,
    ) -> u64 {
        let bytes = fs::read(ot_root.join("SET/AUDIO/export.wav")).unwrap();
        let cancelled = AtomicBool::new(false);
        let layout = inspect_wav_layout(&bytes, &cancelled).unwrap();
        let binding = SliceDraftBinding {
            root: identity.clone(),
            relative_path: file.relative_path.clone(),
            source_hash: file.content_hash.clone(),
            sample_rate: layout.info.sample_rate,
            frame_count: layout.info.frame_count,
        };
        let mut guard = catalog.lock().unwrap();
        guard.save_slice_draft(&binding, draft, 0).unwrap().revision
    }

    #[test]
    fn slice_export_ipc_exports_selected_marker() {
        let (ot_root, _data, registry, catalog, derived, root_id, file_id, file) = fixture();
        let identity = catalog_identity(&registry.resolve(&root_id).unwrap().session).unwrap();
        let revision = save_draft(
            ot_root.path(),
            &catalog,
            &identity,
            &file,
            &draft_with_marker(FIXTURE_FRAMES, "mid", 500, 3_500),
        );
        let first = slice_export_apply_sync(
            &registry, &catalog, &derived, &root_id, &file_id, "mid", revision,
        )
        .unwrap();
        let second = slice_export_apply_sync(
            &registry, &catalog, &derived, &root_id, &file_id, "mid", revision,
        )
        .unwrap();
        assert_eq!(first.derived_asset_id, second.derived_asset_id);
        assert_eq!(first.start_frame, "500");
        assert_eq!(first.end_exclusive, "3500");
        assert!(!first.derived_asset_id.is_empty());
        drop(ot_root);
    }

    #[test]
    fn slice_export_ipc_rejects_stale_revision() {
        let (ot_root, _data, registry, catalog, derived, root_id, file_id, file) = fixture();
        let identity = catalog_identity(&registry.resolve(&root_id).unwrap().session).unwrap();
        let revision = save_draft(
            ot_root.path(),
            &catalog,
            &identity,
            &file,
            &draft_with_marker(FIXTURE_FRAMES, "mid", 500, 3_500),
        );
        let err = slice_export_apply_sync(
            &registry,
            &catalog,
            &derived,
            &root_id,
            &file_id,
            "mid",
            revision - 1,
        )
        .unwrap_err();
        assert_eq!(json!(err)["code"], "STALE_DRAFT");
    }

    #[test]
    fn slice_export_ipc_rejects_missing_marker() {
        let (ot_root, _data, registry, catalog, derived, root_id, file_id, file) = fixture();
        let identity = catalog_identity(&registry.resolve(&root_id).unwrap().session).unwrap();
        let revision = save_draft(
            ot_root.path(),
            &catalog,
            &identity,
            &file,
            &draft_with_marker(FIXTURE_FRAMES, "mid", 500, 3_500),
        );
        let err = slice_export_apply_sync(
            &registry, &catalog, &derived, &root_id, &file_id, "missing", revision,
        )
        .unwrap_err();
        assert_eq!(json!(err)["code"], "SLICE_MISSING");
    }

    #[test]
    fn slice_export_ipc_rejects_source_changed() {
        let (ot_root, _data, registry, catalog, derived, root_id, file_id, file) = fixture();
        let identity = catalog_identity(&registry.resolve(&root_id).unwrap().session).unwrap();
        let revision = save_draft(
            ot_root.path(),
            &catalog,
            &identity,
            &file,
            &draft_with_marker(FIXTURE_FRAMES, "mid", 500, 3_500),
        );
        fs::write(ot_root.path().join("SET/AUDIO/export.wav"), b"changed").unwrap();
        let err = slice_export_apply_sync(
            &registry, &catalog, &derived, &root_id, &file_id, "mid", revision,
        )
        .unwrap_err();
        assert_eq!(json!(err)["code"], "SOURCE_CHANGED");
    }

    #[test]
    fn slice_export_ipc_reports_conflicting_lineage() {
        let (ot_root, data, registry, catalog, derived, root_id, file_id, file) = fixture();
        let identity = catalog_identity(&registry.resolve(&root_id).unwrap().session).unwrap();
        let revision = save_draft(
            ot_root.path(),
            &catalog,
            &identity,
            &file,
            &draft_with_marker(FIXTURE_FRAMES, "mid", 500, 3_500),
        );
        let range = FrameRange::new(PcmFrame::new(500), PcmFrame::new(3_500)).unwrap();
        let source_bytes = fs::read(ot_root.path().join("SET/AUDIO/export.wav")).unwrap();
        let before = file.content_hash.clone();
        let mut runtime = DerivedAudioRuntime::open(data.path()).unwrap();
        let mut catalog_guard = catalog.lock().unwrap();
        ApplyTrimDerivation::new(
            &OtAudioTrimProcessor,
            &OtAudioTrimVerifier,
            &mut runtime,
            &mut *catalog_guard,
            "2026-09-20T12:00:00.000Z",
        )
        .execute(
            &TrimIntent::new(file.content_hash.clone(), range),
            &source_bytes,
            &file.content_hash,
            &before,
        )
        .unwrap();
        drop(catalog_guard);
        let err = slice_export_apply_sync(
            &registry, &catalog, &derived, &root_id, &file_id, "mid", revision,
        )
        .unwrap_err();
        assert_eq!(json!(err)["code"], "CONFLICTING_LINEAGE");
    }
}
