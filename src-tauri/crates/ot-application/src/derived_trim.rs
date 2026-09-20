use ot_domain::{
    standard_trim_processor, AssetDerivation, ContentHash, DerivationKind,
    DerivationParameterEnvelope, ExpectedTrimOutput, TrimIntent, TrimPlan,
};
use ot_storage_ports::{
    AssetDerivationCatalog, CatalogError, DerivedAudioCatalog, DerivedFileUpsert,
};
use std::fmt;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TrimApplyResult {
    pub output: ContentHash,
    pub source_unchanged: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum TrimVerificationKind {
    PcmMismatch,
    MetadataMismatch,
    MalformedOutput,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum TrimApplyError {
    SourceMismatch,
    NoOpDerivation,
    Verification {
        kind: TrimVerificationKind,
        message: String,
    },
    Catalog(CatalogError),
    Processor(String),
    Publish(String),
    Plan(String),
}

impl fmt::Display for TrimApplyError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::SourceMismatch => {
                formatter.write_str("verified source hash does not match intent or source bytes")
            }
            Self::NoOpDerivation => {
                formatter.write_str("trim output is identical to source content")
            }
            Self::Verification { kind, message } => {
                write!(formatter, "trim verification failed ({kind:?}): {message}")
            }
            Self::Catalog(error) => write!(formatter, "catalog error: {error}"),
            Self::Processor(message) => write!(formatter, "trim processor error: {message}"),
            Self::Publish(message) => write!(formatter, "derived publish error: {message}"),
            Self::Plan(message) => write!(formatter, "trim plan error: {message}"),
        }
    }
}

impl std::error::Error for TrimApplyError {}

impl From<CatalogError> for TrimApplyError {
    fn from(error: CatalogError) -> Self {
        Self::Catalog(error)
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TrimWavResult {
    pub wav_bytes: Vec<u8>,
    pub expected: ExpectedTrimOutput,
    pub output_hash: ContentHash,
}

pub trait TrimWavProcessor {
    fn trim_wav(
        &self,
        source_bytes: &[u8],
        intent: &TrimIntent,
    ) -> Result<TrimWavResult, TrimApplyError>;
}

pub trait TrimDerivationVerifier {
    fn content_hash(&self, bytes: &[u8]) -> Result<ContentHash, TrimApplyError>;

    fn verify_source_for_intent(
        &self,
        source_bytes: &[u8],
        intent: &TrimIntent,
    ) -> Result<(), TrimApplyError>;

    fn verify_output_pcm(
        &self,
        source_bytes: &[u8],
        intent: &TrimIntent,
        output_wav_bytes: &[u8],
    ) -> Result<ExpectedTrimOutput, TrimApplyError>;
}

pub trait DerivedAudioPublisher {
    fn publish_trim_output(
        &mut self,
        plan: &TrimPlan,
        wav_bytes: &[u8],
        output_hash: &ContentHash,
    ) -> Result<(), TrimApplyError>;
}

pub struct ApplyTrimDerivation<'a, P, V, S, C> {
    processor: &'a P,
    verifier: &'a V,
    publisher: &'a mut S,
    catalog: &'a mut C,
    created_at: &'a str,
}

impl<'a, P, V, S, C> ApplyTrimDerivation<'a, P, V, S, C>
where
    P: TrimWavProcessor,
    V: TrimDerivationVerifier,
    S: DerivedAudioPublisher,
    C: DerivedAudioCatalog + AssetDerivationCatalog,
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
        intent: &TrimIntent,
        verified_source_bytes: &[u8],
        verified_source_hash: &ContentHash,
        source_hash_before: &ContentHash,
    ) -> Result<TrimApplyResult, TrimApplyError> {
        let prepared = prepare_publish_trim_derivation(
            self.processor,
            self.verifier,
            self.publisher,
            self.catalog,
            intent,
            verified_source_bytes,
            verified_source_hash,
            source_hash_before,
        )?;
        let derivation = AssetDerivation::new(
            prepared.output.clone(),
            prepared.actual_source_hash.clone(),
            DerivationKind::Trim,
            prepared.processor.clone(),
            prepared.trim_parameters.clone(),
            prepared.actual_source_hash.clone(),
            self.created_at,
        )
        .map_err(|error| TrimApplyError::Plan(error.to_string()))?;
        self.catalog.register_asset_derivation(&derivation)?;
        Ok(TrimApplyResult {
            output: prepared.output,
            source_unchanged: prepared.source_unchanged,
        })
    }
}

pub struct TrimDerivationPrepared {
    pub output: ContentHash,
    pub source_unchanged: bool,
    pub actual_source_hash: ContentHash,
    pub processor: ot_domain::ProcessorIdentity,
    pub trim_parameters: DerivationParameterEnvelope,
    pub plan: TrimPlan,
}

#[allow(clippy::too_many_arguments)]
pub fn prepare_publish_trim_derivation<P, V, S, C>(
    processor: &P,
    verifier: &V,
    publisher: &mut S,
    catalog: &mut C,
    intent: &TrimIntent,
    verified_source_bytes: &[u8],
    verified_source_hash: &ContentHash,
    source_hash_before: &ContentHash,
) -> Result<TrimDerivationPrepared, TrimApplyError>
where
    P: TrimWavProcessor,
    V: TrimDerivationVerifier,
    S: DerivedAudioPublisher,
    C: DerivedAudioCatalog,
{
    let actual_source_hash = verifier.content_hash(verified_source_bytes)?;
    if intent.source() != verified_source_hash
        || intent.source() != source_hash_before
        || actual_source_hash != *verified_source_hash
    {
        return Err(TrimApplyError::SourceMismatch);
    }
    verifier.verify_source_for_intent(verified_source_bytes, intent)?;
    let TrimWavResult {
        wav_bytes,
        expected: _claimed_expected,
        output_hash: _claimed_output_hash,
    } = processor.trim_wav(verified_source_bytes, intent)?;
    let verified_expected =
        verifier.verify_output_pcm(verified_source_bytes, intent, &wav_bytes)?;
    let output_hash = verifier.content_hash(&wav_bytes)?;
    if output_hash == actual_source_hash {
        return Err(TrimApplyError::NoOpDerivation);
    }
    let trim_parameters = DerivationParameterEnvelope::trim(intent.range())
        .map_err(|error| TrimApplyError::Plan(error.to_string()))?;
    let processor =
        standard_trim_processor().map_err(|error| TrimApplyError::Plan(error.to_string()))?;
    let plan = TrimPlan::new(
        actual_source_hash.clone(),
        actual_source_hash.clone(),
        intent.range(),
        verified_expected,
        processor.clone(),
        trim_parameters.clone(),
        &output_hash,
    )
    .map_err(|_| TrimApplyError::Plan("invalid trim plan".into()))?;
    publisher.publish_trim_output(&plan, &wav_bytes, &output_hash)?;
    catalog.upsert_derived_file(&DerivedFileUpsert {
        content_hash: output_hash.clone(),
        byte_size: wav_bytes.len() as u64,
        relative_path: plan.published_relative_path().to_string(),
        modified_at_unix_ns: None,
    })?;
    Ok(TrimDerivationPrepared {
        output: output_hash,
        source_unchanged: source_hash_before == &actual_source_hash,
        actual_source_hash,
        processor,
        trim_parameters,
        plan,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use ot_domain::slicing::{FrameRange, PcmFrame};
    use std::cell::RefCell;
    use std::sync::atomic::{AtomicUsize, Ordering};

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

    fn permissive_expected() -> ExpectedTrimOutput {
        ExpectedTrimOutput {
            sample_rate: 44_100,
            channels: 1,
            bits_per_sample: 16,
            frame_count: 10,
        }
    }

    struct LabelVerifier;

    impl TrimDerivationVerifier for LabelVerifier {
        fn content_hash(&self, bytes: &[u8]) -> Result<ContentHash, TrimApplyError> {
            if bytes.len() == 64 {
                Ok(hash(2))
            } else {
                Ok(hash(1))
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
            _intent: &TrimIntent,
            _output_wav_bytes: &[u8],
        ) -> Result<ExpectedTrimOutput, TrimApplyError> {
            Ok(permissive_expected())
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
            _intent: &TrimIntent,
            _output_wav_bytes: &[u8],
        ) -> Result<ExpectedTrimOutput, TrimApplyError> {
            Ok(permissive_expected())
        }
    }

    struct BeforeAfterVerifier {
        before: ContentHash,
        after: ContentHash,
    }

    impl TrimDerivationVerifier for BeforeAfterVerifier {
        fn content_hash(&self, bytes: &[u8]) -> Result<ContentHash, TrimApplyError> {
            if bytes == b"before" {
                Ok(self.before.clone())
            } else {
                Ok(self.after.clone())
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
            _intent: &TrimIntent,
            _output_wav_bytes: &[u8],
        ) -> Result<ExpectedTrimOutput, TrimApplyError> {
            Ok(permissive_expected())
        }
    }

    struct RejectingOutputVerifier {
        source: ContentHash,
        output: ContentHash,
    }

    impl TrimDerivationVerifier for RejectingOutputVerifier {
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
            _intent: &TrimIntent,
            _output_wav_bytes: &[u8],
        ) -> Result<ExpectedTrimOutput, TrimApplyError> {
            Err(TrimApplyError::Verification {
                kind: TrimVerificationKind::PcmMismatch,
                message: "injected pcm mismatch".into(),
            })
        }
    }

    struct RecordingPublisher {
        calls: AtomicUsize,
    }

    impl DerivedAudioPublisher for RecordingPublisher {
        fn publish_trim_output(
            &mut self,
            _plan: &TrimPlan,
            _wav_bytes: &[u8],
            _output_hash: &ContentHash,
        ) -> Result<(), TrimApplyError> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            Ok(())
        }
    }

    struct FakeCatalog {
        upsert_calls: RefCell<usize>,
    }

    impl FakeCatalog {
        fn new() -> Self {
            Self {
                upsert_calls: RefCell::new(0),
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
            _derivation: &AssetDerivation,
        ) -> Result<(), CatalogError> {
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

    #[test]
    fn correct_bytes_and_hash_passes() {
        let source = hash(1);
        let output = hash(2);
        let range = FrameRange::new(PcmFrame::new(0), PcmFrame::new(10)).unwrap();
        let intent = TrimIntent::new(source.clone(), range);
        let processor = RecordingProcessor {
            calls: AtomicUsize::new(0),
            result: sample_result(output),
        };
        let verifier = LabelVerifier;
        let mut publisher = RecordingPublisher {
            calls: AtomicUsize::new(0),
        };
        let mut catalog = FakeCatalog::new();
        let mut apply = ApplyTrimDerivation::new(
            &processor,
            &verifier,
            &mut publisher,
            &mut catalog,
            "2026-09-20T00:00:00.000Z",
        );
        apply
            .execute(&intent, b"source-bytes", &source, &source)
            .unwrap();
        assert_eq!(processor.calls.load(Ordering::SeqCst), 1);
        assert_eq!(publisher.calls.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn wrong_bytes_with_matching_caller_hash_rejects_before_processor() {
        let source = hash(3);
        let output = hash(4);
        let range = FrameRange::new(PcmFrame::new(0), PcmFrame::new(10)).unwrap();
        let intent = TrimIntent::new(source.clone(), range);
        let processor = RecordingProcessor {
            calls: AtomicUsize::new(0),
            result: sample_result(output),
        };
        let verifier = FixedVerifier(hash(99));
        let mut publisher = RecordingPublisher {
            calls: AtomicUsize::new(0),
        };
        let mut catalog = FakeCatalog::new();
        let mut apply = ApplyTrimDerivation::new(
            &processor,
            &verifier,
            &mut publisher,
            &mut catalog,
            "2026-09-20T00:00:00.000Z",
        );
        assert!(matches!(
            apply.execute(&intent, b"other-bytes", &source, &source),
            Err(TrimApplyError::SourceMismatch)
        ));
        assert_eq!(processor.calls.load(Ordering::SeqCst), 0);
        assert_eq!(publisher.calls.load(Ordering::SeqCst), 0);
        assert_eq!(*catalog.upsert_calls.borrow(), 0);
    }

    #[test]
    fn stale_caller_hash_rejects() {
        let source = hash(5);
        let stale = hash(6);
        let output = hash(7);
        let range = FrameRange::new(PcmFrame::new(0), PcmFrame::new(10)).unwrap();
        let intent = TrimIntent::new(source.clone(), range);
        let processor = RecordingProcessor {
            calls: AtomicUsize::new(0),
            result: sample_result(output),
        };
        let verifier = FixedVerifier(source.clone());
        let mut publisher = RecordingPublisher {
            calls: AtomicUsize::new(0),
        };
        let mut catalog = FakeCatalog::new();
        let mut apply = ApplyTrimDerivation::new(
            &processor,
            &verifier,
            &mut publisher,
            &mut catalog,
            "2026-09-20T00:00:00.000Z",
        );
        assert!(matches!(
            apply.execute(&intent, b"x", &stale, &stale),
            Err(TrimApplyError::SourceMismatch)
        ));
        assert_eq!(processor.calls.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn changed_source_bytes_after_hash_snapshot_rejects() {
        let source = hash(8);
        let output = hash(9);
        let range = FrameRange::new(PcmFrame::new(0), PcmFrame::new(10)).unwrap();
        let intent = TrimIntent::new(source.clone(), range);
        let processor = RecordingProcessor {
            calls: AtomicUsize::new(0),
            result: sample_result(output),
        };
        let verifier = BeforeAfterVerifier {
            before: source.clone(),
            after: hash(10),
        };
        let mut publisher = RecordingPublisher {
            calls: AtomicUsize::new(0),
        };
        let mut catalog = FakeCatalog::new();
        let mut apply = ApplyTrimDerivation::new(
            &processor,
            &verifier,
            &mut publisher,
            &mut catalog,
            "2026-09-20T00:00:00.000Z",
        );
        apply.execute(&intent, b"before", &source, &source).unwrap();
        assert!(matches!(
            apply.execute(&intent, b"after", &source, &source),
            Err(TrimApplyError::SourceMismatch)
        ));
    }

    #[test]
    fn noop_trim_rejects_before_publish() {
        let source = hash(11);
        let range = FrameRange::new(PcmFrame::new(0), PcmFrame::new(10)).unwrap();
        let intent = TrimIntent::new(source.clone(), range);
        let processor = RecordingProcessor {
            calls: AtomicUsize::new(0),
            result: sample_result(source.clone()),
        };
        let verifier = FixedVerifier(source.clone());
        let mut publisher = RecordingPublisher {
            calls: AtomicUsize::new(0),
        };
        let mut catalog = FakeCatalog::new();
        let mut apply = ApplyTrimDerivation::new(
            &processor,
            &verifier,
            &mut publisher,
            &mut catalog,
            "2026-09-20T00:00:00.000Z",
        );
        assert!(matches!(
            apply.execute(&intent, b"x", &source, &source),
            Err(TrimApplyError::NoOpDerivation)
        ));
        assert_eq!(publisher.calls.load(Ordering::SeqCst), 0);
        assert_eq!(*catalog.upsert_calls.borrow(), 0);
    }

    #[test]
    fn verification_failure_skips_publish_and_catalog() {
        let source = hash(12);
        let output = hash(13);
        let range = FrameRange::new(PcmFrame::new(0), PcmFrame::new(10)).unwrap();
        let intent = TrimIntent::new(source.clone(), range);
        let processor = RecordingProcessor {
            calls: AtomicUsize::new(0),
            result: sample_result(output.clone()),
        };
        let verifier = RejectingOutputVerifier {
            source: source.clone(),
            output,
        };
        let mut publisher = RecordingPublisher {
            calls: AtomicUsize::new(0),
        };
        let mut catalog = FakeCatalog::new();
        let mut apply = ApplyTrimDerivation::new(
            &processor,
            &verifier,
            &mut publisher,
            &mut catalog,
            "2026-09-20T00:00:00.000Z",
        );
        assert!(matches!(
            apply.execute(&intent, b"source-bytes", &source, &source),
            Err(TrimApplyError::Verification {
                kind: TrimVerificationKind::PcmMismatch,
                ..
            })
        ));
        assert_eq!(processor.calls.load(Ordering::SeqCst), 1);
        assert_eq!(publisher.calls.load(Ordering::SeqCst), 0);
        assert_eq!(*catalog.upsert_calls.borrow(), 0);
    }
}
