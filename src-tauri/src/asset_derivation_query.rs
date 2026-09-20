//! Read-only production IPC for derived AudioAsset lineage (parent + children).

use crate::catalog_runtime::SharedCatalog;
use crate::root_registry::RootRegistry;
use crate::v2_api::{
    catalog_error, catalog_identity, catalog_lock_error, content_hash_for_asset_id,
    load_library_snapshot, opaque_asset_id, ApiError,
};
use ot_application::{ListDerivedChildren, LoadAssetDerivation};
use ot_domain::{
    AssetDerivation, ContentHash, DerivationParameters, RootId, MAC_DERIVED_AUDIO_ROOT_FINGERPRINT,
};
use ot_storage_ports::CatalogRootIdentity;
use serde::Serialize;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetDerivationGetDto {
    pub asset_id: String,
    pub is_derived: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub derivation: Option<DerivationDto>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetDerivationListChildrenDto {
    pub asset_id: String,
    pub children: Vec<DerivationDto>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DerivationDto {
    pub asset_id: String,
    pub kind: String,
    pub parent_asset_id: String,
    pub parent_available: bool,
    pub processor: DerivationProcessorDto,
    pub created_at: String,
    pub parameters: DerivationParametersDto,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DerivationProcessorDto {
    pub name: String,
    pub revision: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DerivationParametersDto {
    pub status: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_frame: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_frame_exclusive: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
}

pub fn asset_derivation_get_sync(
    registry: &RootRegistry,
    catalog: &SharedCatalog,
    root_id: &RootId,
    asset_id: &str,
) -> Result<AssetDerivationGetDto, ApiError> {
    registry.resolve(root_id)?;
    let content_hash = resolve_catalog_content_hash(registry, catalog, root_id, asset_id)?;
    let catalog_guard = catalog.lock().map_err(|_| catalog_lock_error())?;
    let derivation = LoadAssetDerivation::new(&*catalog_guard)
        .execute(&content_hash)
        .map_err(catalog_error)?;
    let parent_available = parent_source_available(&*catalog_guard, derivation.as_ref())?;
    Ok(AssetDerivationGetDto {
        asset_id: asset_id.to_owned(),
        is_derived: derivation.is_some(),
        derivation: derivation
            .as_ref()
            .map(|row| derivation_to_dto(row, &content_hash, parent_available)),
    })
}

pub fn asset_derivation_list_children_sync(
    registry: &RootRegistry,
    catalog: &SharedCatalog,
    root_id: &RootId,
    asset_id: &str,
) -> Result<AssetDerivationListChildrenDto, ApiError> {
    registry.resolve(root_id)?;
    let content_hash = resolve_catalog_content_hash(registry, catalog, root_id, asset_id)?;
    let catalog_guard = catalog.lock().map_err(|_| catalog_lock_error())?;
    let children = ListDerivedChildren::new(&*catalog_guard)
        .execute(&content_hash)
        .map_err(catalog_error)?;
    let mut dtos = Vec::with_capacity(children.len());
    for child in &children {
        let parent_available = parent_source_available(&*catalog_guard, Some(child))?;
        dtos.push(derivation_to_dto(child, child.output(), parent_available));
    }
    Ok(AssetDerivationListChildrenDto {
        asset_id: asset_id.to_owned(),
        children: dtos,
    })
}

fn resolve_catalog_content_hash(
    registry: &RootRegistry,
    catalog: &SharedCatalog,
    root_id: &RootId,
    asset_id: &str,
) -> Result<ContentHash, ApiError> {
    crate::v2_api::validate_asset_id(asset_id)?;
    let resolved = registry.resolve(root_id)?;
    let ot_identity = catalog_identity(&resolved.session)?;
    if let Ok(snapshot) = load_library_snapshot(catalog, &ot_identity) {
        if let Ok(hash) = content_hash_for_asset_id(&snapshot, asset_id) {
            return Ok(hash);
        }
    }
    if let Ok(derived_identity) = CatalogRootIdentity::new(MAC_DERIVED_AUDIO_ROOT_FINGERPRINT) {
        if let Ok(snapshot) = load_library_snapshot(catalog, &derived_identity) {
            if let Ok(hash) = content_hash_for_asset_id(&snapshot, asset_id) {
                return Ok(hash);
            }
        }
    }
    let catalog_guard = catalog.lock().map_err(|_| catalog_lock_error())?;
    for hash in catalog_guard
        .list_audio_asset_content_hashes()
        .map_err(catalog_error)?
    {
        if opaque_asset_id(&hash) == asset_id {
            return Ok(hash);
        }
    }
    Err(ApiError::new(
        "CATALOG_ASSET_NOT_FOUND",
        "the requested audio asset is not present in the catalog",
        true,
    ))
}

fn parent_source_available(
    catalog: &ot_catalog::SqliteCatalog,
    derivation: Option<&AssetDerivation>,
) -> Result<bool, ApiError> {
    let Some(derivation) = derivation else {
        return Ok(false);
    };
    catalog
        .audio_asset_has_file_instance(derivation.source())
        .map_err(catalog_error)
}

fn derivation_to_dto(
    derivation: &AssetDerivation,
    output_asset_id_source: &ContentHash,
    parent_available: bool,
) -> DerivationDto {
    DerivationDto {
        asset_id: opaque_asset_id(output_asset_id_source),
        kind: derivation.kind().token().to_owned(),
        parent_asset_id: opaque_asset_id(derivation.source()),
        parent_available,
        processor: DerivationProcessorDto {
            name: derivation.processor().name().to_owned(),
            revision: derivation.processor().revision().to_owned(),
        },
        created_at: derivation.created_at().to_owned(),
        parameters: parameters_to_dto(derivation),
    }
}

fn parameters_to_dto(derivation: &AssetDerivation) -> DerivationParametersDto {
    if derivation.parameters_unavailable() {
        return DerivationParametersDto {
            status: "unavailable",
            start_frame: None,
            end_frame_exclusive: None,
            role: None,
        };
    }
    match derivation.parameters().parameters() {
        DerivationParameters::Trim { range } | DerivationParameters::SliceExport { range } => {
            DerivationParametersDto {
                status: "available",
                start_frame: Some(range.start().to_string()),
                end_frame_exclusive: Some(range.end_exclusive().to_string()),
                role: None,
            }
        }
        DerivationParameters::Stem { role } => DerivationParametersDto {
            status: "available",
            start_frame: None,
            end_frame_exclusive: None,
            role: Some(role.token().to_owned()),
        },
        DerivationParameters::Empty => DerivationParametersDto {
            status: "available",
            start_frame: None,
            end_frame_exclusive: None,
            role: None,
        },
        DerivationParameters::LegacyTrimUnspecified => DerivationParametersDto {
            status: "unavailable",
            start_frame: None,
            end_frame_exclusive: None,
            role: None,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::derived_audio_runtime::{
        DerivedAudioRuntime, OtAudioTrimProcessor, OtAudioTrimVerifier,
    };
    use crate::slice_export_apply::slice_export_apply_sync;
    use crate::v2_api::{
        catalog_identity, gate_c_register_and_index_root, opaque_file_instance_id,
    };
    use ot_application::ApplyTrimDerivation;
    use ot_domain::slice_draft::{DraftMarker, SliceDraft};
    use ot_domain::slicing::{FrameRange, PcmFrame};
    use ot_domain::{
        AssetDerivation, DerivationKind, DerivationParameterEnvelope, ProcessorIdentity,
        TrimIntent,
    };
    use ot_storage_ports::slice_drafts::{SliceDraftBinding, SliceDraftCatalog};
    use ot_storage_ports::AssetDerivationCatalog;
    use serde_json::json;
    use std::fs;
    use std::path::Path;
    use std::sync::atomic::AtomicBool;
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

    fn fixture() -> (
        TempDir,
        TempDir,
        Arc<RootRegistry>,
        SharedCatalog,
        crate::derived_audio_runtime::SharedDerivedAudioRuntime,
        RootId,
        String,
        ot_domain::FileInstance,
    ) {
        let ot_root = TempDir::new().unwrap();
        minimal_ot_root(ot_root.path());
        let data = TempDir::new().unwrap();
        let registry = registry();
        let catalog = crate::catalog_runtime::open_shared_catalog(data.path()).unwrap();
        let derived =
            crate::derived_audio_runtime::open_shared_derived_audio_runtime(data.path()).unwrap();
        let (session, _) =
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

    #[test]
    fn original_asset_reports_not_derived() {
        let (_ot, _data, registry, catalog, _derived, root_id, _file_id, file) = fixture();
        let asset_id = opaque_asset_id(&file.content_hash);
        let result = asset_derivation_get_sync(&registry, &catalog, &root_id, &asset_id).unwrap();
        assert!(!result.is_derived);
        assert!(result.derivation.is_none());
        let children =
            asset_derivation_list_children_sync(&registry, &catalog, &root_id, &asset_id).unwrap();
        assert!(children.children.is_empty());
    }

    #[test]
    fn slice_export_child_listed_for_original_parent() {
        let (ot_root, _data, registry, catalog, derived, root_id, file_id, file) = fixture();
        let identity = catalog_identity(&registry.resolve(&root_id).unwrap().session).unwrap();
        let draft = SliceDraft {
            revision: 0,
            region: FrameRange::new(PcmFrame::new(0), PcmFrame::new(FIXTURE_FRAMES)).unwrap(),
            markers: vec![
                DraftMarker {
                    id: "mid".into(),
                    start: PcmFrame::new(500),
                    locked: false,
                    manual: true,
                    candidate_id: None,
                    estimated_attack: None,
                },
                DraftMarker {
                    id: "tail".into(),
                    start: PcmFrame::new(3_500),
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
        let bytes = fs::read(ot_root.path().join("SET/AUDIO/export.wav")).unwrap();
        let cancelled = AtomicBool::new(false);
        let layout = ot_audio::pcm::inspect_wav_layout(&bytes, &cancelled).unwrap();
        let binding = SliceDraftBinding {
            root: identity.clone(),
            relative_path: file.relative_path.clone(),
            source_hash: file.content_hash.clone(),
            sample_rate: layout.info.sample_rate,
            frame_count: layout.info.frame_count,
        };
        let revision = {
            let mut guard = catalog.lock().unwrap();
            guard
                .save_slice_draft(&binding, &draft, 0)
                .unwrap()
                .revision
        };
        let export = slice_export_apply_sync(
            &registry, &catalog, &derived, &root_id, &file_id, "mid", revision,
        )
        .unwrap();
        let source_asset_id = opaque_asset_id(&file.content_hash);
        let children =
            asset_derivation_list_children_sync(&registry, &catalog, &root_id, &source_asset_id)
                .unwrap();
        assert_eq!(children.children.len(), 1);
        let child = &children.children[0];
        assert_eq!(child.kind, "SLICE_EXPORT");
        assert_eq!(child.asset_id, export.derived_asset_id);
        assert_eq!(child.parent_asset_id, source_asset_id);
        assert!(child.parent_available);
        assert_eq!(child.parameters.status, "available");
        assert_eq!(child.parameters.start_frame.as_deref(), Some("500"));
        assert_eq!(
            child.parameters.end_frame_exclusive.as_deref(),
            Some("3500")
        );
        let derived_get =
            asset_derivation_get_sync(&registry, &catalog, &root_id, &export.derived_asset_id)
                .unwrap();
        assert!(derived_get.is_derived);
        assert_eq!(
            derived_get.derivation.as_ref().unwrap().parent_asset_id,
            source_asset_id
        );
        let json = serde_json::to_string(&children).unwrap();
        assert!(!json.contains("sha256:"));
        assert!(!json.contains("Application Support"));
        assert!(!json.contains("rootfp:v1:"));
    }

    #[test]
    fn trim_derivation_get_exposes_parent_opaque_id() {
        let (ot_root, data, registry, catalog, _derived, root_id, _file_id, file) = fixture();
        let range = FrameRange::new(PcmFrame::new(500), PcmFrame::new(3_500)).unwrap();
        let source_bytes = fs::read(ot_root.path().join("SET/AUDIO/export.wav")).unwrap();
        let before = file.content_hash.clone();
        let mut runtime = DerivedAudioRuntime::open(data.path()).unwrap();
        let mut catalog_guard = catalog.lock().unwrap();
        let result = ApplyTrimDerivation::new(
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
        let derived_asset_id = opaque_asset_id(&result.output);
        let get =
            asset_derivation_get_sync(&registry, &catalog, &root_id, &derived_asset_id).unwrap();
        assert!(get.is_derived);
        let row = get.derivation.unwrap();
        assert_eq!(row.kind, "TRIM");
        assert_eq!(row.parent_asset_id, opaque_asset_id(&file.content_hash));
        assert!(!serde_json::to_string(&row).unwrap().contains("sha256:"));
    }

    #[test]
    fn parent_unavailable_is_data_not_error() {
        let (_ot, _data, registry, catalog, _derived, root_id, _file_id, _file) = fixture();
        let output = ContentHash::parse(format!("sha256:{:064x}", 43)).unwrap();
        let missing_parent = ContentHash::parse(format!("sha256:{:064x}", 44)).unwrap();
        let processor = ProcessorIdentity::new("masterocta-trim", "pcm-wav-v1").unwrap();
        let range = FrameRange::new(PcmFrame::new(1), PcmFrame::new(100)).unwrap();
        let envelope = DerivationParameterEnvelope::trim(range).unwrap();
        {
            let mut guard = catalog.lock().unwrap();
            guard.ensure_audio_asset_row(&missing_parent, 200).unwrap();
            guard.ensure_audio_asset_row(&output, 100).unwrap();
            let derivation = AssetDerivation::from_stored(
                output.clone(),
                missing_parent.clone(),
                DerivationKind::Trim,
                processor,
                envelope,
                missing_parent,
                "2026-09-20T00:00:00.000Z",
            )
            .unwrap();
            guard.register_asset_derivation(&derivation).unwrap();
        }
        let asset_id = opaque_asset_id(&output);
        let get = asset_derivation_get_sync(&registry, &catalog, &root_id, &asset_id).unwrap();
        assert!(!get.derivation.unwrap().parent_available);
    }

    #[test]
    fn invalid_and_unknown_asset_ids_fail_closed() {
        let (_ot, _data, registry, catalog, _derived, root_id, _file_id, file) = fixture();
        let invalid =
            asset_derivation_get_sync(&registry, &catalog, &root_id, "asset:v1:not-valid-hex")
                .unwrap_err();
        assert_eq!(json!(invalid)["code"], "INVALID_ASSET_ID");
        let missing = asset_derivation_get_sync(
            &registry,
            &catalog,
            &root_id,
            &format!("asset:v1:{}", "b".repeat(64)),
        )
        .unwrap_err();
        assert_eq!(json!(missing)["code"], "CATALOG_ASSET_NOT_FOUND");
    }

    #[test]
    fn catalog_reopen_preserves_query_results() {
        let (ot_root, data, registry, catalog, derived, root_id, file_id, file) = fixture();
        let identity = catalog_identity(&registry.resolve(&root_id).unwrap().session).unwrap();
        let draft = SliceDraft {
            revision: 0,
            region: FrameRange::new(PcmFrame::new(0), PcmFrame::new(FIXTURE_FRAMES)).unwrap(),
            markers: vec![
                DraftMarker {
                    id: "mid".into(),
                    start: PcmFrame::new(500),
                    locked: false,
                    manual: true,
                    candidate_id: None,
                    estimated_attack: None,
                },
                DraftMarker {
                    id: "tail".into(),
                    start: PcmFrame::new(3_500),
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
        let bytes = fs::read(ot_root.path().join("SET/AUDIO/export.wav")).unwrap();
        let cancelled = AtomicBool::new(false);
        let layout = ot_audio::pcm::inspect_wav_layout(&bytes, &cancelled).unwrap();
        let binding = SliceDraftBinding {
            root: identity,
            relative_path: file.relative_path.clone(),
            source_hash: file.content_hash.clone(),
            sample_rate: layout.info.sample_rate,
            frame_count: layout.info.frame_count,
        };
        let revision = {
            let mut guard = catalog.lock().unwrap();
            guard
                .save_slice_draft(&binding, &draft, 0)
                .unwrap()
                .revision
        };
        slice_export_apply_sync(
            &registry, &catalog, &derived, &root_id, &file_id, "mid", revision,
        )
        .unwrap();
        let source_asset_id = opaque_asset_id(&file.content_hash);
        let before =
            asset_derivation_list_children_sync(&registry, &catalog, &root_id, &source_asset_id)
                .unwrap();
        drop(catalog);
        let reopened = crate::catalog_runtime::open_shared_catalog(data.path()).unwrap();
        let after =
            asset_derivation_list_children_sync(&registry, &reopened, &root_id, &source_asset_id)
                .unwrap();
        assert_eq!(before.children.len(), after.children.len());
        assert_eq!(before.children[0].asset_id, after.children[0].asset_id);
    }
}
