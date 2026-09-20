use crate::derived_trim::{
    prepare_publish_trim_derivation, DerivedAudioPublisher, TrimApplyError, TrimDerivationVerifier,
    TrimWavProcessor,
};
use ot_domain::{
    standard_trim_processor, AssetDerivation, ContentHash, DerivationKind,
    DerivationParameterEnvelope, SliceExportIntent, TrimIntent,
};
use ot_storage_ports::slice_drafts::{SliceDraftBinding, SliceDraftCatalog, SliceDraftStoreError};
use ot_storage_ports::{AssetDerivationCatalog, CatalogError, DerivedAudioCatalog};
use std::fmt;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SliceExportApplyResult {
    pub output: ContentHash,
    pub source_unchanged: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum SliceExportApplyError {
    SourceChanged,
    DraftNotFound,
    StaleDraft,
    SliceMissing,
    RangeChanged,
    InvalidRange,
    Pipeline(TrimApplyError),
    Catalog(CatalogError),
    Plan(String),
}

impl fmt::Display for SliceExportApplyError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::SourceChanged => formatter.write_str("slice export source hash mismatch"),
            Self::DraftNotFound => formatter.write_str("slice draft not found"),
            Self::StaleDraft => formatter.write_str("slice draft revision mismatch"),
            Self::SliceMissing => formatter.write_str("slice marker not found in draft"),
            Self::RangeChanged => {
                formatter.write_str("slice range changed since export intent was created")
            }
            Self::InvalidRange => formatter.write_str("invalid slice range for export"),
            Self::Pipeline(error) => write!(formatter, "{error}"),
            Self::Catalog(error) => write!(formatter, "catalog error: {error}"),
            Self::Plan(message) => write!(formatter, "slice export plan error: {message}"),
        }
    }
}

impl std::error::Error for SliceExportApplyError {}

impl From<TrimApplyError> for SliceExportApplyError {
    fn from(error: TrimApplyError) -> Self {
        Self::Pipeline(error)
    }
}

impl From<CatalogError> for SliceExportApplyError {
    fn from(error: CatalogError) -> Self {
        Self::Catalog(error)
    }
}

pub struct ApplySliceExportDerivation<'a, P, V, S, C> {
    processor: &'a P,
    verifier: &'a V,
    publisher: &'a mut S,
    catalog: &'a mut C,
    created_at: &'a str,
}

impl<'a, P, V, S, C> ApplySliceExportDerivation<'a, P, V, S, C>
where
    P: TrimWavProcessor,
    V: TrimDerivationVerifier,
    S: DerivedAudioPublisher,
    C: DerivedAudioCatalog + AssetDerivationCatalog + SliceDraftCatalog,
{
    pub fn new(
        processor: &'a P,
        verifier: &'a V,
        publisher: &'a mut S,
        catalog: &'a mut C,
        created_at: &'a str,
    ) -> Self {
        Self {
            processor,
            verifier,
            publisher,
            catalog,
            created_at,
        }
    }

    pub fn execute(
        &mut self,
        binding: &SliceDraftBinding,
        intent: &SliceExportIntent,
        verified_source_bytes: &[u8],
        verified_source_hash: &ContentHash,
        source_hash_before: &ContentHash,
    ) -> Result<SliceExportApplyResult, SliceExportApplyError> {
        if binding.source_hash != *intent.source() {
            return Err(SliceExportApplyError::SourceChanged);
        }
        let actual_source_hash = self
            .verifier
            .content_hash(verified_source_bytes)
            .map_err(SliceExportApplyError::from)?;
        if intent.source() != verified_source_hash
            || intent.source() != source_hash_before
            || actual_source_hash != *verified_source_hash
        {
            return Err(SliceExportApplyError::SourceChanged);
        }

        let draft = SliceDraftCatalog::load_slice_draft(&*self.catalog, binding)
            .map_err(map_draft_store_error)?
            .ok_or(SliceExportApplyError::DraftNotFound)?;
        if draft.revision != intent.expected_revision() {
            return Err(SliceExportApplyError::StaleDraft);
        }
        let current_range = draft
            .marker_range(intent.marker_id())
            .map_err(|_| SliceExportApplyError::SliceMissing)?;
        if current_range != intent.range() {
            return Err(SliceExportApplyError::RangeChanged);
        }
        if current_range.within(binding.frame_count).is_err() {
            return Err(SliceExportApplyError::InvalidRange);
        }

        let trim_intent = TrimIntent::new(actual_source_hash.clone(), current_range);
        let prepared = prepare_publish_trim_derivation(
            self.processor,
            self.verifier,
            self.publisher,
            self.catalog,
            &trim_intent,
            verified_source_bytes,
            verified_source_hash,
            source_hash_before,
        )?;

        let slice_parameters = DerivationParameterEnvelope::slice_export(current_range)
            .map_err(|error| SliceExportApplyError::Plan(error.to_string()))?;
        let processor = standard_trim_processor()
            .map_err(|error| SliceExportApplyError::Plan(error.to_string()))?;
        let derivation = AssetDerivation::new(
            prepared.output.clone(),
            prepared.actual_source_hash.clone(),
            DerivationKind::SliceExport,
            processor,
            slice_parameters,
            prepared.actual_source_hash.clone(),
            self.created_at,
        )
        .map_err(|error| SliceExportApplyError::Plan(error.to_string()))?;
        self.catalog.register_asset_derivation(&derivation)?;

        Ok(SliceExportApplyResult {
            output: prepared.output,
            source_unchanged: prepared.source_unchanged,
        })
    }
}

fn map_draft_store_error(error: SliceDraftStoreError) -> SliceExportApplyError {
    match error {
        SliceDraftStoreError::Conflict => SliceExportApplyError::StaleDraft,
        SliceDraftStoreError::Invalid(message) => SliceExportApplyError::Plan(message.to_string()),
        SliceDraftStoreError::Unavailable(message) => {
            SliceExportApplyError::Catalog(CatalogError::Unavailable { message })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::derived_trim::{
        DerivedAudioPublisher, TrimApplyError, TrimDerivationVerifier, TrimWavProcessor,
        TrimWavResult,
    };
    use ot_domain::slice_draft::{DraftMarker, SliceDraft};
    use ot_domain::slicing::{FrameRange, PcmFrame};
    use ot_domain::{ExpectedTrimOutput, RootRelativePath};
    use ot_storage_ports::slice_drafts::{
        SliceDraftBinding, SliceDraftCatalog, SliceDraftStoreError,
    };
    use ot_storage_ports::{
        AssetDerivationCatalog, CatalogError, CatalogRootIdentity, DerivedAudioCatalog,
        DerivedFileUpsert,
    };
    use std::cell::RefCell;
    use std::collections::HashMap;
    use std::sync::atomic::{AtomicUsize, Ordering};

    struct MemoryDrafts {
        drafts: RefCell<HashMap<(String, String, String), SliceDraft>>,
    }

    impl MemoryDrafts {
        fn new(draft: SliceDraft, binding: &SliceDraftBinding) -> Self {
            let key = (
                binding.root.as_str().to_string(),
                binding.relative_path.as_str().to_string(),
                binding.source_hash.as_str().to_string(),
            );
            let mut map = HashMap::new();
            map.insert(key, draft);
            Self {
                drafts: RefCell::new(map),
            }
        }
    }

    impl SliceDraftCatalog for MemoryDrafts {
        fn load_slice_draft(
            &self,
            binding: &SliceDraftBinding,
        ) -> Result<Option<SliceDraft>, SliceDraftStoreError> {
            let key = (
                binding.root.as_str().to_string(),
                binding.relative_path.as_str().to_string(),
                binding.source_hash.as_str().to_string(),
            );
            Ok(self.drafts.borrow().get(&key).cloned())
        }

        fn save_slice_draft(
            &mut self,
            _binding: &SliceDraftBinding,
            _draft: &SliceDraft,
            _expected_revision: u64,
        ) -> Result<SliceDraft, SliceDraftStoreError> {
            Err(SliceDraftStoreError::Unavailable("not implemented".into()))
        }
    }

    struct RecordingProcessor {
        calls: AtomicUsize,
        result: TrimWavResult,
    }

    impl TrimWavProcessor for RecordingProcessor {
        fn trim_wav(
            &self,
            _source_bytes: &[u8],
            _intent: &TrimIntent,
        ) -> Result<TrimWavResult, TrimApplyError> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            Ok(self.result.clone())
        }
    }

    struct ExportVerifier {
        source: ContentHash,
        output: ContentHash,
    }

    impl TrimDerivationVerifier for ExportVerifier {
        fn content_hash(&self, bytes: &[u8]) -> Result<ContentHash, TrimApplyError> {
            if bytes.len() == 64 {
                Ok(self.output.clone())
            } else {
                Ok(self.source.clone())
            }
        }

        fn verify_source_for_intent(
            &self,
            _source_bytes: &[u8],
            _intent: &TrimIntent,
        ) -> Result<(), TrimApplyError> {
            Ok(())
        }

        fn verify_output_pcm(
            &self,
            _source_bytes: &[u8],
            intent: &TrimIntent,
            _output_wav_bytes: &[u8],
        ) -> Result<ExpectedTrimOutput, TrimApplyError> {
            Ok(ExpectedTrimOutput {
                sample_rate: 44_100,
                channels: 1,
                bits_per_sample: 16,
                frame_count: intent.range().frame_count(),
            })
        }
    }

    struct FixedVerifier(ContentHash);

    impl TrimDerivationVerifier for FixedVerifier {
        fn content_hash(&self, _bytes: &[u8]) -> Result<ContentHash, TrimApplyError> {
            Ok(self.0.clone())
        }

        fn verify_source_for_intent(
            &self,
            _source_bytes: &[u8],
            _intent: &TrimIntent,
        ) -> Result<(), TrimApplyError> {
            Ok(())
        }

        fn verify_output_pcm(
            &self,
            _source_bytes: &[u8],
            intent: &TrimIntent,
            _output_wav_bytes: &[u8],
        ) -> Result<ExpectedTrimOutput, TrimApplyError> {
            Ok(ExpectedTrimOutput {
                sample_rate: 44_100,
                channels: 1,
                bits_per_sample: 16,
                frame_count: intent.range().frame_count(),
            })
        }
    }

    struct RecordingPublisher {
        calls: AtomicUsize,
    }

    impl DerivedAudioPublisher for RecordingPublisher {
        fn publish_trim_output(
            &mut self,
            _plan: &ot_domain::TrimPlan,
            _wav_bytes: &[u8],
            _output_hash: &ContentHash,
        ) -> Result<(), TrimApplyError> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            Ok(())
        }
    }

    struct FakeCatalog {
        upsert_calls: RefCell<usize>,
        registered: RefCell<Vec<AssetDerivation>>,
    }

    impl FakeCatalog {
        fn new() -> Self {
            Self {
                upsert_calls: RefCell::new(0),
                registered: RefCell::new(Vec::new()),
            }
        }
    }

    impl DerivedAudioCatalog for FakeCatalog {
        fn ensure_derived_root(
            &mut self,
        ) -> Result<ot_storage_ports::CatalogRootIdentity, CatalogError> {
            ot_storage_ports::CatalogRootIdentity::new(
                ot_domain::MAC_DERIVED_AUDIO_ROOT_FINGERPRINT,
            )
            .map_err(|_| CatalogError::InvalidRootIdentity)
        }

        fn upsert_derived_file(&mut self, _upsert: &DerivedFileUpsert) -> Result<(), CatalogError> {
            *self.upsert_calls.borrow_mut() += 1;
            Ok(())
        }
    }

    impl AssetDerivationCatalog for FakeCatalog {
        fn register_asset_derivation(
            &mut self,
            derivation: &AssetDerivation,
        ) -> Result<(), CatalogError> {
            self.registered.borrow_mut().push(derivation.clone());
            Ok(())
        }

        fn load_asset_derivation(
            &self,
            _output: &ContentHash,
        ) -> Result<Option<AssetDerivation>, CatalogError> {
            Ok(None)
        }

        fn list_derived_children(
            &self,
            _source: &ContentHash,
        ) -> Result<Vec<AssetDerivation>, CatalogError> {
            Ok(Vec::new())
        }

        fn list_derivation_edges(&self) -> Result<Vec<(ContentHash, ContentHash)>, CatalogError> {
            Ok(Vec::new())
        }
    }

    fn hash(label: u8) -> ContentHash {
        ContentHash::parse(format!("sha256:{label:064x}")).unwrap()
    }

    fn binding(source: ContentHash) -> SliceDraftBinding {
        SliceDraftBinding {
            root: CatalogRootIdentity::new(format!("rootfp:v1:{}", "1".repeat(64))).unwrap(),
            relative_path: RootRelativePath::parse("SET/AUDIO/test.wav").unwrap(),
            source_hash: source,
            sample_rate: 44_100,
            frame_count: 48_000,
        }
    }

    fn draft_with_markers(revision: u64) -> SliceDraft {
        let region = FrameRange::new(PcmFrame::new(0), PcmFrame::new(48_000)).unwrap();
        let draft = SliceDraft {
            revision,
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
                    start: PcmFrame::new(10_000),
                    locked: false,
                    manual: false,
                    candidate_id: None,
                    estimated_attack: None,
                },
                DraftMarker {
                    id: "last".into(),
                    start: PcmFrame::new(40_000),
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

    fn sample_result(output: ContentHash) -> TrimWavResult {
        TrimWavResult {
            wav_bytes: vec![0_u8; 64],
            expected: ExpectedTrimOutput {
                sample_rate: 44_100,
                channels: 1,
                bits_per_sample: 16,
                frame_count: 10,
            },
            output_hash: output,
        }
    }

    fn run_export(
        draft: SliceDraft,
        binding: SliceDraftBinding,
        marker_id: &str,
        expected_revision: u64,
    ) -> Result<SliceExportApplyResult, SliceExportApplyError> {
        let source = binding.source_hash.clone();
        let range = draft
            .marker_range(marker_id)
            .unwrap_or_else(|_| FrameRange::new(PcmFrame::new(0), PcmFrame::new(1)).unwrap());
        let intent = SliceExportIntent::new(source.clone(), expected_revision, marker_id, range);
        let processor = RecordingProcessor {
            calls: AtomicUsize::new(0),
            result: sample_result(hash(2)),
        };
        let verifier = ExportVerifier {
            source: source.clone(),
            output: hash(2),
        };
        let mut publisher = RecordingPublisher {
            calls: AtomicUsize::new(0),
        };
        let mut catalog = DraftCatalog::new(draft, &binding);
        let mut apply = ApplySliceExportDerivation::new(
            &processor,
            &verifier,
            &mut publisher,
            &mut catalog,
            "2026-09-20T00:00:00.000Z",
        );
        apply.execute(&binding, &intent, b"source-bytes", &source, &source)
    }

    struct DraftCatalog {
        pub inner: FakeCatalog,
        drafts: MemoryDrafts,
    }

    impl DraftCatalog {
        fn new(draft: SliceDraft, binding: &SliceDraftBinding) -> Self {
            Self {
                inner: FakeCatalog::new(),
                drafts: MemoryDrafts::new(draft, binding),
            }
        }
    }

    impl DerivedAudioCatalog for DraftCatalog {
        fn ensure_derived_root(
            &mut self,
        ) -> Result<ot_storage_ports::CatalogRootIdentity, CatalogError> {
            self.inner.ensure_derived_root()
        }

        fn upsert_derived_file(&mut self, upsert: &DerivedFileUpsert) -> Result<(), CatalogError> {
            self.inner.upsert_derived_file(upsert)
        }
    }

    impl AssetDerivationCatalog for DraftCatalog {
        fn register_asset_derivation(
            &mut self,
            derivation: &AssetDerivation,
        ) -> Result<(), CatalogError> {
            self.inner.register_asset_derivation(derivation)
        }

        fn load_asset_derivation(
            &self,
            output: &ContentHash,
        ) -> Result<Option<AssetDerivation>, CatalogError> {
            self.inner.load_asset_derivation(output)
        }

        fn list_derived_children(
            &self,
            source: &ContentHash,
        ) -> Result<Vec<AssetDerivation>, CatalogError> {
            self.inner.list_derived_children(source)
        }

        fn list_derivation_edges(&self) -> Result<Vec<(ContentHash, ContentHash)>, CatalogError> {
            self.inner.list_derivation_edges()
        }
    }

    impl SliceDraftCatalog for DraftCatalog {
        fn load_slice_draft(
            &self,
            binding: &SliceDraftBinding,
        ) -> Result<Option<SliceDraft>, SliceDraftStoreError> {
            self.drafts.load_slice_draft(binding)
        }

        fn save_slice_draft(
            &mut self,
            binding: &SliceDraftBinding,
            draft: &SliceDraft,
            expected_revision: u64,
        ) -> Result<SliceDraft, SliceDraftStoreError> {
            self.drafts
                .save_slice_draft(binding, draft, expected_revision)
        }
    }

    #[test]
    fn resolves_first_middle_and_last_marker_ranges() {
        let source = hash(1);
        let binding = binding(source.clone());
        let draft = draft_with_markers(1);
        assert_eq!(
            draft.marker_range("first").unwrap(),
            FrameRange::new(PcmFrame::new(0), PcmFrame::new(10_000)).unwrap()
        );
        assert_eq!(
            draft.marker_range("middle").unwrap(),
            FrameRange::new(PcmFrame::new(10_000), PcmFrame::new(40_000)).unwrap()
        );
        assert_eq!(
            draft.marker_range("last").unwrap(),
            FrameRange::new(PcmFrame::new(40_000), PcmFrame::new(48_000)).unwrap()
        );
        for marker in ["first", "middle", "last"] {
            run_export(draft.clone(), binding.clone(), marker, 1).unwrap();
        }
    }

    #[test]
    fn stale_revision_rejects_without_side_effects() {
        let source = hash(3);
        let binding = binding(source);
        let draft = draft_with_markers(2);
        let err = run_export(draft, binding, "middle", 1).unwrap_err();
        assert_eq!(err, SliceExportApplyError::StaleDraft);
    }

    #[test]
    fn missing_marker_rejects() {
        let source = hash(4);
        let binding = binding(source);
        let draft = draft_with_markers(1);
        let err = run_export(draft, binding, "gone", 1).unwrap_err();
        assert_eq!(err, SliceExportApplyError::SliceMissing);
    }

    #[test]
    fn range_changed_rejects() {
        let source = hash(5);
        let binding = binding(source.clone());
        let draft = draft_with_markers(1);
        let stale_range = FrameRange::new(PcmFrame::new(10_000), PcmFrame::new(20_000)).unwrap();
        let intent = SliceExportIntent::new(source.clone(), 1, "middle", stale_range);
        let processor = RecordingProcessor {
            calls: AtomicUsize::new(0),
            result: sample_result(hash(6)),
        };
        let verifier = ExportVerifier {
            source: source.clone(),
            output: hash(6),
        };
        let mut publisher = RecordingPublisher {
            calls: AtomicUsize::new(0),
        };
        let mut catalog = DraftCatalog::new(draft, &binding);
        let mut apply = ApplySliceExportDerivation::new(
            &processor,
            &verifier,
            &mut publisher,
            &mut catalog,
            "2026-09-20T00:00:00.000Z",
        );
        assert_eq!(
            apply
                .execute(&binding, &intent, b"x", &source, &source)
                .unwrap_err(),
            SliceExportApplyError::RangeChanged
        );
        assert_eq!(publisher.calls.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn source_hash_mismatch_rejects() {
        let binding = binding(hash(8));
        let draft = draft_with_markers(1);
        let range = draft.marker_range("middle").unwrap();
        let intent = SliceExportIntent::new(hash(7), 1, "middle", range);
        let processor = RecordingProcessor {
            calls: AtomicUsize::new(0),
            result: sample_result(hash(2)),
        };
        let verifier = ExportVerifier {
            source: hash(8),
            output: hash(2),
        };
        let mut publisher = RecordingPublisher {
            calls: AtomicUsize::new(0),
        };
        let mut catalog = DraftCatalog::new(draft, &binding);
        let mut apply = ApplySliceExportDerivation::new(
            &processor,
            &verifier,
            &mut publisher,
            &mut catalog,
            "2026-09-20T00:00:00.000Z",
        );
        assert_eq!(
            apply
                .execute(&binding, &intent, b"x", &hash(8), &hash(8))
                .unwrap_err(),
            SliceExportApplyError::SourceChanged
        );
    }

    #[test]
    fn registers_slice_export_lineage() {
        let source = hash(9);
        let binding = binding(source.clone());
        let draft = draft_with_markers(1);
        let processor = RecordingProcessor {
            calls: AtomicUsize::new(0),
            result: sample_result(hash(10)),
        };
        let verifier = ExportVerifier {
            source: source.clone(),
            output: hash(10),
        };
        let mut publisher = RecordingPublisher {
            calls: AtomicUsize::new(0),
        };
        let mut catalog = DraftCatalog::new(draft.clone(), &binding);
        let range = draft.marker_range("middle").unwrap();
        let intent = SliceExportIntent::new(source.clone(), 1, "middle", range);
        let mut apply = ApplySliceExportDerivation::new(
            &processor,
            &verifier,
            &mut publisher,
            &mut catalog,
            "2026-09-20T00:00:00.000Z",
        );
        apply
            .execute(&binding, &intent, b"source-bytes", &source, &source)
            .unwrap();
        let registered = catalog.inner.registered.borrow();
        assert_eq!(registered.len(), 1);
        assert_eq!(registered[0].kind(), DerivationKind::SliceExport);
        assert_eq!(
            registered[0].parameters().encode(),
            "v1|kind=slice_export|start=10000|end=40000"
        );
    }

    #[test]
    fn noop_full_range_rejects_before_publish() {
        let source = hash(11);
        let binding = binding(source.clone());
        let region = FrameRange::new(PcmFrame::new(0), PcmFrame::new(48_000)).unwrap();
        let mut draft = SliceDraft::empty(region);
        draft.revision = 1;
        draft.markers.push(DraftMarker {
            id: "only".into(),
            start: PcmFrame::new(0),
            locked: false,
            manual: false,
            candidate_id: None,
            estimated_attack: None,
        });
        draft.validate().unwrap();
        let range = draft.marker_range("only").unwrap();
        let intent = SliceExportIntent::new(source.clone(), 1, "only", range);
        let processor = RecordingProcessor {
            calls: AtomicUsize::new(0),
            result: sample_result(source.clone()),
        };
        let verifier = FixedVerifier(source.clone());
        let mut publisher = RecordingPublisher {
            calls: AtomicUsize::new(0),
        };
        let mut catalog = DraftCatalog::new(draft, &binding);
        let mut apply = ApplySliceExportDerivation::new(
            &processor,
            &verifier,
            &mut publisher,
            &mut catalog,
            "2026-09-20T00:00:00.000Z",
        );
        assert!(matches!(
            apply
                .execute(&binding, &intent, b"x", &source, &source)
                .unwrap_err(),
            SliceExportApplyError::Pipeline(TrimApplyError::NoOpDerivation)
        ));
        assert_eq!(publisher.calls.load(Ordering::SeqCst), 0);
    }
}
