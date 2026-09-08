//! Versioned onset proposal contracts. No filesystem or serialization dependency.
use crate::slicing::{FrameRange, PcmFrame};

pub const ONSET_ALGORITHM_VERSION: &str = "onset:drum:v1";
pub const MAX_ONSET_CANDIDATES: usize = 32_768;
pub const MAX_DRAFT_MARKERS: usize = 4_096;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct OnsetParameters {
    pub sensitivity: u8,
    pub minimum_interval_ms: u16,
    pub pre_roll_us: u16,
    pub silence_floor_db: i16,
    pub snap_radius_us: u16,
}

impl Default for OnsetParameters {
    fn default() -> Self {
        Self {
            sensitivity: 50,
            minimum_interval_ms: 35,
            pre_roll_us: 1_000,
            silence_floor_db: -72,
            snap_radius_us: 0,
        }
    }
}

impl OnsetParameters {
    pub fn validate(self) -> Result<Self, &'static str> {
        if self.sensitivity > 100
            || !(10..=250).contains(&self.minimum_interval_ms)
            || self.pre_roll_us > 10_000
            || !(-90..=-40).contains(&self.silence_floor_db)
            || self.snap_radius_us > 2_000
        {
            return Err("onset parameters are outside the supported range");
        }
        Ok(self)
    }

    pub fn threshold(self) -> f32 {
        5.0 - 0.035 * f32::from(self.sensitivity)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum BoundaryWarning {
    Uncertain,
    LeftEdgeTruncated,
    PreRollClipped,
}

#[derive(Clone, Debug, PartialEq)]
pub struct OnsetCandidate {
    pub id: String,
    pub novelty_peak: PcmFrame,
    pub estimated_attack: PcmFrame,
    pub suggested_start: PcmFrame,
    pub uncertainty: FrameRange,
    pub score: f32,
    pub strength: f32,
    pub band_scores: [f32; 3],
    pub threshold_margin: f32,
    pub warnings: Vec<BoundaryWarning>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SuppressionReason {
    SameRise,
    MinimumInterval,
    StartCollision,
    ProtectedBoundary,
}

#[derive(Clone, Debug, PartialEq)]
pub struct SuppressedOnset {
    pub candidate_id: String,
    pub reason: SuppressionReason,
}

#[derive(Clone, Debug, PartialEq)]
pub struct OnsetProposal {
    pub candidates: Vec<OnsetCandidate>,
    pub suppressed: Vec<SuppressedOnset>,
}
