//! Slice Draft export intent (Mac-side derived audio; no media Apply).

use crate::slicing::FrameRange;
use crate::ContentHash;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SliceExportIntent {
    source: ContentHash,
    expected_revision: u64,
    marker_id: String,
    range: FrameRange,
}

impl SliceExportIntent {
    pub fn new(
        source: ContentHash,
        expected_revision: u64,
        marker_id: impl Into<String>,
        range: FrameRange,
    ) -> Self {
        Self {
            source,
            expected_revision,
            marker_id: marker_id.into(),
            range,
        }
    }

    pub fn source(&self) -> &ContentHash {
        &self.source
    }

    pub fn expected_revision(&self) -> u64 {
        self.expected_revision
    }

    pub fn marker_id(&self) -> &str {
        &self.marker_id
    }

    pub fn range(&self) -> FrameRange {
        self.range
    }
}
