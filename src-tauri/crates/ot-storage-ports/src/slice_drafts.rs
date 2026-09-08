use crate::CatalogRootIdentity;
use ot_domain::slice_draft::SliceDraft;
use ot_domain::{ContentHash, RootRelativePath};

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SliceDraftBinding {
    pub root: CatalogRootIdentity,
    pub relative_path: RootRelativePath,
    pub source_hash: ContentHash,
    pub sample_rate: u32,
    pub frame_count: u64,
}

#[derive(Debug)]
pub enum SliceDraftStoreError {
    Conflict,
    Invalid(&'static str),
    Unavailable(String),
}

impl std::fmt::Display for SliceDraftStoreError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Conflict => f.write_str("slice draft revision conflict"),
            Self::Invalid(message) => f.write_str(message),
            Self::Unavailable(message) => f.write_str(message),
        }
    }
}
impl std::error::Error for SliceDraftStoreError {}

pub trait SliceDraftCatalog {
    fn load_slice_draft(
        &self,
        binding: &SliceDraftBinding,
    ) -> Result<Option<SliceDraft>, SliceDraftStoreError>;
    fn save_slice_draft(
        &mut self,
        binding: &SliceDraftBinding,
        draft: &SliceDraft,
        expected_revision: u64,
    ) -> Result<SliceDraft, SliceDraftStoreError>;
}
