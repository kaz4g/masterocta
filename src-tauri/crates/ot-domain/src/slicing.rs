//! Source PCM coordinates for AUTO-SLICE-1. A frame contains all channels.
//! These values are deliberately independent of the raw Octatrack u32 fields.

use std::fmt;

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub struct PcmFrame(u64);

impl PcmFrame {
    pub const fn new(value: u64) -> Self {
        Self(value)
    }

    pub const fn get(self) -> u64 {
        self.0
    }

    /// Canonical decimal only: no signs, whitespace, exponents or leading zeroes.
    pub fn parse_decimal(value: &str) -> Result<Self, SliceCoordinateError> {
        if value.is_empty()
            || value.len() > 20
            || (value.len() > 1 && value.starts_with('0'))
            || !value.bytes().all(|byte| byte.is_ascii_digit())
        {
            return Err(SliceCoordinateError::InvalidDecimal);
        }
        value
            .parse::<u64>()
            .map(Self)
            .map_err(|_| SliceCoordinateError::InvalidDecimal)
    }

    /// Integral microseconds avoid platform-dependent floating-point rounding.
    /// Positive half-frame ties round upward, as specified by AUTO-SLICE-1.
    pub fn from_microseconds(
        microseconds: u64,
        sample_rate: u32,
    ) -> Result<Self, SliceCoordinateError> {
        if sample_rate == 0 {
            return Err(SliceCoordinateError::InvalidSampleRate);
        }
        let frames = (u128::from(microseconds) * u128::from(sample_rate) + 500_000) / 1_000_000;
        u64::try_from(frames)
            .map(Self)
            .map_err(|_| SliceCoordinateError::Overflow)
    }
}

impl fmt::Display for PcmFrame {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(formatter)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct FrameRange {
    start: PcmFrame,
    end_exclusive: PcmFrame,
}

impl FrameRange {
    pub fn new(start: PcmFrame, end_exclusive: PcmFrame) -> Result<Self, SliceCoordinateError> {
        if start >= end_exclusive {
            return Err(SliceCoordinateError::EmptyOrReversed);
        }
        Ok(Self {
            start,
            end_exclusive,
        })
    }

    pub const fn start(self) -> PcmFrame {
        self.start
    }

    pub const fn end_exclusive(self) -> PcmFrame {
        self.end_exclusive
    }

    pub const fn frame_count(self) -> u64 {
        self.end_exclusive.0 - self.start.0
    }

    pub fn within(self, source_frame_count: u64) -> Result<Self, SliceCoordinateError> {
        if self.end_exclusive.0 > source_frame_count {
            return Err(SliceCoordinateError::OutsideSource);
        }
        Ok(self)
    }

    pub fn contains(self, frame: PcmFrame) -> bool {
        self.start <= frame && frame < self.end_exclusive
    }
}

/// Consecutive auto slices only. Imported slices may overlap and must not be
/// silently passed through this constructor or normalized into this model.
pub fn consecutive_slices(
    starts: &[PcmFrame],
    region: FrameRange,
    max_slices: usize,
) -> Result<Vec<FrameRange>, SliceCoordinateError> {
    if starts.len() > max_slices {
        return Err(SliceCoordinateError::TooManySlices);
    }
    if starts.iter().any(|start| !region.contains(*start)) {
        return Err(SliceCoordinateError::OutsideSource);
    }
    if starts.windows(2).any(|pair| pair[0] >= pair[1]) {
        return Err(SliceCoordinateError::UnorderedStarts);
    }
    starts
        .iter()
        .enumerate()
        .map(|(index, start)| {
            FrameRange::new(
                *start,
                starts.get(index + 1).copied().unwrap_or(region.end_exclusive),
            )
        })
        .collect()
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SliceCoordinateError {
    InvalidDecimal,
    InvalidSampleRate,
    Overflow,
    EmptyOrReversed,
    OutsideSource,
    UnorderedStarts,
    TooManySlices,
}

impl fmt::Display for SliceCoordinateError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::InvalidDecimal => "frame must be a canonical decimal u64",
            Self::InvalidSampleRate => "sample rate must be positive",
            Self::Overflow => "frame conversion overflowed",
            Self::EmptyOrReversed => "frame range must be nonempty and increasing",
            Self::OutsideSource => "frame range is outside the source",
            Self::UnorderedStarts => "auto slice starts must be strictly increasing",
            Self::TooManySlices => "slice count exceeds the requested limit",
        })
    }
}

impl std::error::Error for SliceCoordinateError {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decimal_roundtrip_preserves_values_beyond_javascript_precision() {
        for value in [0, 1, 44_100, 9_007_199_254_740_993, u64::MAX] {
            assert_eq!(
                PcmFrame::parse_decimal(&value.to_string()).unwrap().get(),
                value
            );
        }
        for invalid in [
            "", "00", "01", "-1", "+1", " 1", "1 ", "1e3", "1.0", "１", "18446744073709551616",
        ] {
            assert_eq!(
                PcmFrame::parse_decimal(invalid),
                Err(SliceCoordinateError::InvalidDecimal)
            );
        }
    }

    #[test]
    fn time_conversion_uses_source_rate_and_rounds_half_up() {
        assert_eq!(
            PcmFrame::from_microseconds(1_000_000, 44_100).unwrap().get(),
            44_100
        );
        assert_eq!(
            PcmFrame::from_microseconds(1_000_000, 48_000).unwrap().get(),
            48_000
        );
        assert_eq!(PcmFrame::from_microseconds(1_000, 44_100).unwrap().get(), 44);
        assert_eq!(PcmFrame::from_microseconds(500, 1_000).unwrap().get(), 1);
        assert_eq!(
            PcmFrame::from_microseconds(1, 0),
            Err(SliceCoordinateError::InvalidSampleRate)
        );
        assert_eq!(
            PcmFrame::from_microseconds(u64::MAX, u32::MAX),
            Err(SliceCoordinateError::Overflow)
        );
    }

    #[test]
    fn half_open_range_includes_one_frame_and_excludes_its_end() {
        let range = FrameRange::new(PcmFrame::new(9), PcmFrame::new(10)).unwrap();
        assert_eq!(range.frame_count(), 1);
        assert!(range.contains(PcmFrame::new(9)));
        assert!(!range.contains(PcmFrame::new(10)));
        assert!(range.within(10).is_ok());
        assert_eq!(range.within(9), Err(SliceCoordinateError::OutsideSource));
        assert!(FrameRange::new(PcmFrame::new(0), PcmFrame::new(0)).is_err());
        assert!(FrameRange::new(PcmFrame::new(2), PcmFrame::new(1)).is_err());
    }

    #[test]
    fn end_sentinel_is_not_counted_and_no_onsets_stays_empty() {
        let region = FrameRange::new(PcmFrame::new(0), PcmFrame::new(65)).unwrap();
        assert!(consecutive_slices(&[], region, 64).unwrap().is_empty());
        let starts = (0..64).map(PcmFrame::new).collect::<Vec<_>>();
        let slices = consecutive_slices(&starts, region, 64).unwrap();
        assert_eq!(slices.len(), 64);
        assert_eq!(slices.last().unwrap().end_exclusive().get(), 65);
        assert_eq!(
            consecutive_slices(&starts, region, 63),
            Err(SliceCoordinateError::TooManySlices)
        );
        assert!(consecutive_slices(&[PcmFrame::new(65)], region, 64).is_err());
        assert!(consecutive_slices(&[PcmFrame::new(1), PcmFrame::new(1)], region, 64).is_err());
        assert!(consecutive_slices(&[PcmFrame::new(2), PcmFrame::new(1)], region, 64).is_err());
    }
}
