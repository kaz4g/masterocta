//! Read-only Project structure model: Bank, Pattern, Part, Track, and the
//! sample-slot reference each track machine points at.
//!
//! Working and SavedCheckpoint Bank documents are kept as separate entries.
//! A reader must never substitute one role for the other. Scene, Arranger, and
//! Recorder semantics are not decoded; they are listed as unmodeled dependencies
//! so downstream planning fails closed instead of treating them as absent.

use crate::{
    RecorderBufferId, RootRelativePath, SampleSlotId, StateDocumentParseStatus, StateDocumentRole,
};
use std::fmt;

pub const BANK_COUNT: u8 = 16;
pub const PATTERNS_PER_BANK: u8 = 16;
pub const PARTS_PER_BANK: u8 = 4;
pub const AUDIO_TRACKS_PER_PART: u8 = 8;
pub const ARRANGEMENTS_PER_PROJECT: u8 = 8;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct InvalidStructureIndex {
    kind: &'static str,
    value: u8,
}

impl fmt::Display for InvalidStructureIndex {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "invalid {} index {}", self.kind, self.value)
    }
}

impl std::error::Error for InvalidStructureIndex {}

macro_rules! structure_index {
    ($name:ident, $kind:literal, $count:expr) => {
        #[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
        pub struct $name(u8);

        impl $name {
            pub fn new(value: u8) -> Result<Self, InvalidStructureIndex> {
                if value < $count {
                    Ok(Self(value))
                } else {
                    Err(InvalidStructureIndex { kind: $kind, value })
                }
            }

            /// Zero-based position.
            pub fn get(self) -> u8 {
                self.0
            }

            pub fn all() -> impl Iterator<Item = Self> {
                (0..$count).map(Self)
            }
        }
    };
}

structure_index!(BankIndex, "bank", BANK_COUNT);
structure_index!(PatternIndex, "pattern", PATTERNS_PER_BANK);
structure_index!(PartIndex, "part", PARTS_PER_BANK);
structure_index!(TrackIndex, "track", AUDIO_TRACKS_PER_PART);
structure_index!(ArrangementIndex, "arrangement", ARRANGEMENTS_PER_PROJECT);

impl BankIndex {
    /// Octatrack UI letter (`A`..=`P`).
    pub fn letter(self) -> char {
        char::from(b'A' + self.0)
    }

    /// On-media file number (`bank01`..=`bank16`).
    pub fn file_number(self) -> u8 {
        self.0 + 1
    }
}

impl ArrangementIndex {
    /// On-media file number (`arr01`..=`arr08`).
    pub fn file_number(self) -> u8 {
        self.0 + 1
    }
}

/// Audio-track machine type as stored in a Part. `Unknown` keeps the raw value
/// visible; Bank validation already marks such documents `Malformed`.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum MachineKind {
    Static,
    Flex,
    Thru,
    Neighbor,
    Pickup,
    Unknown(u8),
}

impl MachineKind {
    pub fn from_raw(raw: u8) -> Self {
        match raw {
            0 => Self::Static,
            1 => Self::Flex,
            2 => Self::Thru,
            3 => Self::Neighbor,
            4 => Self::Pickup,
            other => Self::Unknown(other),
        }
    }

    pub fn plays_sample_slot(self) -> bool {
        matches!(self, Self::Static | Self::Flex)
    }
}

/// What the active machine of a track points at. Only Static and Flex machines
/// reference a slot; the slot number of the inactive machine kind is not listed.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum TrackSlotReference {
    NoSampleMachine,
    Unassigned,
    Slot(SampleSlotId),
    RecorderBuffer(RecorderBufferId),
    /// Raw value outside the documented ranges; never resolved to a slot.
    Unrecognized(u8),
}

/// Whether an audio-track slot plays a machine or is the project master track.
///
/// `MASTER_TRACK` lives in working `project.work` `[SETTINGS]`. Pinned
/// ot-tools-io stores it as `AudioControlPage.master_track`: `1` is master and
/// every other parsed integer is not. When it is master, Track 8 does not play
/// a sample, and leftover machine-slot bytes are not a slot reference.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TrackPlayback {
    Audio {
        machine: MachineKind,
        slot: TrackSlotReference,
    },
    Master,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TrackStructure {
    pub index: TrackIndex,
    pub playback: TrackPlayback,
}

/// A Part as read from the Bank's working (`unsaved`) Part copy.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PartStructure {
    pub index: PartIndex,
    pub tracks: Vec<TrackStructure>,
}

/// Pattern playback multiplier stored by pinned ot-tools-io.
///
/// `0` is 2x through `6` is 1/8x. Any other raw value stays unrecognized and is
/// not rewritten to 1x.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PatternPlaybackScale {
    Times2,
    Times3Over2,
    Times1,
    Times3Over4,
    Times1Over2,
    Times1Over4,
    Times1Over8,
    Unrecognized(u8),
}

/// Master length while a pattern is in per-track scale mode.
///
/// `Infinite` is only the documented sentinel pair `multiplier == 255` and
/// `length == 255`. A finite step count is never used for that pair. Normal
/// mode uses [`PatternScale::Normal`] and does not have this sentinel.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PatternMasterLength {
    Finite(u16),
    Infinite,
    Unrecognized { multiplier: u8, length: u8 },
}

/// One audio track's length and scale while the pattern is in per-track mode.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct TrackScale {
    pub track: TrackIndex,
    pub length: u8,
    pub scale: PatternPlaybackScale,
}

/// Active pattern scale. Inactive mode's fields are not copied into the other variant.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum PatternScale {
    /// `scale_mode == 0`. `master_length` is `master_len` and is always finite.
    Normal {
        master_length: u16,
        master_scale: PatternPlaybackScale,
    },
    /// `scale_mode == 1`. Track scales follow audio tracks 0 through 7.
    PerTrack {
        master_length: PatternMasterLength,
        master_scale: PatternPlaybackScale,
        tracks: Vec<TrackScale>,
    },
    Unrecognized {
        raw: u8,
    },
}

/// A Pattern refers to a Part by index; it is not nested under that Part.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PatternStructure {
    pub index: PatternIndex,
    pub part: PartIndex,
    pub scale: PatternScale,
}

pub fn pattern_playback_scale(raw: u8) -> PatternPlaybackScale {
    match raw {
        0 => PatternPlaybackScale::Times2,
        1 => PatternPlaybackScale::Times3Over2,
        2 => PatternPlaybackScale::Times1,
        3 => PatternPlaybackScale::Times3Over4,
        4 => PatternPlaybackScale::Times1Over2,
        5 => PatternPlaybackScale::Times1Over4,
        6 => PatternPlaybackScale::Times1Over8,
        other => PatternPlaybackScale::Unrecognized(other),
    }
}

/// Decode per-track master length from the pinned parser's range table.
///
/// `master_len_per_track_multiplier` selects the range. `255` with
/// `master_len_per_track == 255` is `INF`. Multiplier `4` is 1024 steps.
/// Multipliers `1`..=`3` are `256 * multiplier + length`. Multiplier `0` is the
/// length byte itself, and that byte's documented minimum is 2. The alternate
/// `(length + 1) * (multiplier + 1)` note on the length field contradicts this
/// table, so it is not applied.
pub fn per_track_master_length(multiplier: u8, length: u8) -> PatternMasterLength {
    match multiplier {
        255 if length == 255 => PatternMasterLength::Infinite,
        4 => PatternMasterLength::Finite(1024),
        0 if length >= 2 => PatternMasterLength::Finite(u16::from(length)),
        1..=3 => PatternMasterLength::Finite(u16::from(multiplier) * 256 + u16::from(length)),
        _ => PatternMasterLength::Unrecognized { multiplier, length },
    }
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum UnmodeledDependency {
    Scenes,
    Arrangements,
    RecorderSetup,
}

pub const BANK_UNMODELED_DEPENDENCIES: [UnmodeledDependency; 3] = [
    UnmodeledDependency::Scenes,
    UnmodeledDependency::Arrangements,
    UnmodeledDependency::RecorderSetup,
];

/// One observed Bank state document. `patterns` and `parts` are empty unless
/// `parse_status` is `Parsed`; partial decodes are never exposed.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BankStructure {
    pub bank: BankIndex,
    pub role: StateDocumentRole,
    pub source_relative_path: RootRelativePath,
    pub parse_status: StateDocumentParseStatus,
    pub patterns: Vec<PatternStructure>,
    pub parts: Vec<PartStructure>,
    pub unmodeled: Vec<UnmodeledDependency>,
}

impl BankStructure {
    pub fn pattern(&self, index: PatternIndex) -> Option<&PatternStructure> {
        self.patterns.iter().find(|pattern| pattern.index == index)
    }

    pub fn part(&self, index: PartIndex) -> Option<&PartStructure> {
        self.parts.iter().find(|part| part.index == index)
    }

    pub fn patterns_using_part(&self, index: PartIndex) -> impl Iterator<Item = &PatternStructure> {
        self.patterns
            .iter()
            .filter(move |pattern| pattern.part == index)
    }
}

/// `project.work` `[STATES] BANK` uses the same zero-based index as [`BankIndex`].
///
/// Pinned ot-tools-io keeps the ASCII integer as `State.bank`. The legacy
/// reader names that index with letters `A`..=`P` and opens `bankNN` as
/// `states.bank + 1`, which is [`BankIndex::file_number`]. A value outside
/// `0..16` is unrecognized and is not rewritten to Bank A.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ProjectBankSelection {
    Selected(BankIndex),
    Unrecognized(u8),
}

/// `project.work` `[STATES] PATTERN` uses the same zero-based index as
/// [`PatternIndex`]. The legacy reader indexes `patterns[states.pattern]`.
/// A value outside `0..16` is unrecognized.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ProjectPatternSelection {
    Selected(PatternIndex),
    Unrecognized(u8),
}

/// `project.work` `[STATES] ARRANGEMENT` uses the same zero-based index as
/// [`ArrangementIndex`] on the evidenced firmware only.
///
/// Disposable `P_ARR_TEST` on Octatrack MkII OS 1.40 (R0173) stored UI
/// Arrangement 1 / 2 / 8 as raw `0` / `1` / `7`. The edited names `ARR1-TEST`,
/// `ARR2-TEST`, and `ARR8-TEST` remained in `arr01.work`, `arr02.work`, and
/// `arr08.work`. A value outside `0..8` is unrecognized and is not clamped.
/// Any other OS revision or release, including 1.40B, stays unrecognized.
/// `ARRANGEMENT_MODE` is not modeled.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ProjectArrangementSelection {
    Selected(ArrangementIndex),
    Unrecognized(u8),
}

/// Active selection from one project state document. Selections are `None`
/// unless `parse_status` is `Parsed`.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProjectStateDocument {
    pub role: StateDocumentRole,
    pub source_relative_path: RootRelativePath,
    pub parse_status: StateDocumentParseStatus,
    pub bank: Option<ProjectBankSelection>,
    pub pattern: Option<ProjectPatternSelection>,
    pub arrangement: Option<ProjectArrangementSelection>,
    /// `Some(true)` only when a parsed working project has `MASTER_TRACK=1`.
    /// Withheld documents leave this `None`, and Track 8 stays an audio track.
    pub master_track: Option<bool>,
}

pub fn project_bank_selection(raw: u8) -> ProjectBankSelection {
    match BankIndex::new(raw) {
        Ok(index) => ProjectBankSelection::Selected(index),
        Err(_) => ProjectBankSelection::Unrecognized(raw),
    }
}

pub fn project_pattern_selection(raw: u8) -> ProjectPatternSelection {
    match PatternIndex::new(raw) {
        Ok(index) => ProjectPatternSelection::Selected(index),
        Err(_) => ProjectPatternSelection::Unrecognized(raw),
    }
}

/// Octatrack MkII revision whose arrangement slots were captured.
pub const ARRANGEMENT_EVIDENCED_OS_REVISION: &str = "R0173";
/// Octatrack OS release whose arrangement slots were captured. `1.40B` is not this release.
pub const ARRANGEMENT_EVIDENCED_OS_RELEASE: &str = "1.40";

/// Map `[STATES] ARRANGEMENT` only for [`ARRANGEMENT_EVIDENCED_OS_REVISION`] /
/// [`ARRANGEMENT_EVIDENCED_OS_RELEASE`]. Other versions keep `raw` unrecognized.
pub fn project_arrangement_selection(
    raw: u8,
    os_revision: &str,
    os_release: &str,
) -> ProjectArrangementSelection {
    if os_revision != ARRANGEMENT_EVIDENCED_OS_REVISION
        || os_release != ARRANGEMENT_EVIDENCED_OS_RELEASE
    {
        return ProjectArrangementSelection::Unrecognized(raw);
    }
    match ArrangementIndex::new(raw) {
        Ok(index) => ProjectArrangementSelection::Selected(index),
        Err(_) => ProjectArrangementSelection::Unrecognized(raw),
    }
}

/// Banks are ordered by Bank index, then Working before SavedCheckpoint.
/// `project_state` is the Working `project.work` selection only. A missing
/// Working file stays `None` and is not filled from `project.strd`.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProjectStructure {
    pub project_relative_path: RootRelativePath,
    pub project_state: Option<ProjectStateDocument>,
    pub banks: Vec<BankStructure>,
}

impl ProjectStructure {
    pub fn bank(&self, bank: BankIndex, role: StateDocumentRole) -> Option<&BankStructure> {
        self.banks
            .iter()
            .find(|entry| entry.bank == bank && entry.role == role)
    }
}

pub fn state_role_rank(role: StateDocumentRole) -> u8 {
    match role {
        StateDocumentRole::Working => 0,
        StateDocumentRole::SavedCheckpoint => 1,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn indices_reject_values_past_their_range() {
        assert_eq!(BankIndex::new(15).unwrap().get(), 15);
        assert!(BankIndex::new(16).is_err());
        assert_eq!(PatternIndex::new(15).unwrap().get(), 15);
        assert!(PatternIndex::new(16).is_err());
        assert_eq!(PartIndex::new(3).unwrap().get(), 3);
        assert!(PartIndex::new(4).is_err());
        assert_eq!(TrackIndex::new(7).unwrap().get(), 7);
        assert!(TrackIndex::new(8).is_err());
        assert_eq!(ArrangementIndex::new(7).unwrap().get(), 7);
        assert!(ArrangementIndex::new(8).is_err());
    }

    #[test]
    fn index_iterators_cover_the_full_range() {
        assert_eq!(BankIndex::all().count(), 16);
        assert_eq!(PatternIndex::all().count(), 16);
        assert_eq!(PartIndex::all().count(), 4);
        assert_eq!(TrackIndex::all().count(), 8);
        assert_eq!(ArrangementIndex::all().count(), 8);
    }

    #[test]
    fn bank_index_maps_to_letter_and_file_number() {
        let first = BankIndex::new(0).unwrap();
        let last = BankIndex::new(15).unwrap();
        assert_eq!((first.letter(), first.file_number()), ('A', 1));
        assert_eq!((last.letter(), last.file_number()), ('P', 16));
    }

    #[test]
    fn machine_kind_keeps_unknown_raw_value() {
        assert_eq!(MachineKind::from_raw(0), MachineKind::Static);
        assert_eq!(MachineKind::from_raw(4), MachineKind::Pickup);
        assert_eq!(MachineKind::from_raw(9), MachineKind::Unknown(9));
        assert!(MachineKind::Flex.plays_sample_slot());
        assert!(!MachineKind::Thru.plays_sample_slot());
    }

    #[test]
    fn patterns_using_part_follows_the_reference_not_nesting() {
        let part = |value| PartIndex::new(value).unwrap();
        let pattern = |index, part_index| PatternStructure {
            index: PatternIndex::new(index).unwrap(),
            part: part(part_index),
            scale: PatternScale::Normal {
                master_length: 16,
                master_scale: PatternPlaybackScale::Times1,
            },
        };
        let bank = BankStructure {
            bank: BankIndex::new(0).unwrap(),
            role: StateDocumentRole::Working,
            source_relative_path: RootRelativePath::parse("SET/P/bank01.work").unwrap(),
            parse_status: StateDocumentParseStatus::Parsed,
            patterns: vec![pattern(0, 0), pattern(1, 2), pattern(2, 2)],
            parts: Vec::new(),
            unmodeled: BANK_UNMODELED_DEPENDENCIES.to_vec(),
        };
        let users: Vec<u8> = bank
            .patterns_using_part(part(2))
            .map(|pattern| pattern.index.get())
            .collect();
        assert_eq!(users, vec![1, 2]);
        assert_eq!(bank.patterns_using_part(part(1)).count(), 0);
    }

    #[test]
    fn project_bank_selection_reuses_bank_index() {
        let selected = project_bank_selection(0);
        assert_eq!(
            selected,
            ProjectBankSelection::Selected(BankIndex::new(0).unwrap())
        );
        let ProjectBankSelection::Selected(index) = selected else {
            panic!("bank 0 must be a BankIndex");
        };
        assert_eq!(index.letter(), 'A');
        assert_eq!(index.file_number(), 1);
        assert_eq!(
            project_bank_selection(15),
            ProjectBankSelection::Selected(BankIndex::new(15).unwrap())
        );
    }

    #[test]
    fn project_pattern_selection_reuses_pattern_index() {
        assert_eq!(
            project_pattern_selection(0),
            ProjectPatternSelection::Selected(PatternIndex::new(0).unwrap())
        );
        assert_eq!(
            project_pattern_selection(15),
            ProjectPatternSelection::Selected(PatternIndex::new(15).unwrap())
        );
    }

    #[test]
    fn project_bank_selection_keeps_out_of_range_raw() {
        assert_eq!(
            project_bank_selection(16),
            ProjectBankSelection::Unrecognized(16)
        );
        assert_eq!(
            project_bank_selection(255),
            ProjectBankSelection::Unrecognized(255)
        );
    }

    #[test]
    fn project_pattern_selection_keeps_out_of_range_raw() {
        assert_eq!(
            project_pattern_selection(16),
            ProjectPatternSelection::Unrecognized(16)
        );
        assert_eq!(
            project_pattern_selection(255),
            ProjectPatternSelection::Unrecognized(255)
        );
    }

    #[test]
    fn project_arrangement_selection_maps_zero_based_file_slots() {
        for raw in [0_u8, 1, 7] {
            let selected = project_arrangement_selection(
                raw,
                ARRANGEMENT_EVIDENCED_OS_REVISION,
                ARRANGEMENT_EVIDENCED_OS_RELEASE,
            );
            let ProjectArrangementSelection::Selected(index) = selected else {
                panic!("arrangement {raw} must be a file slot");
            };
            assert_eq!(index.get(), raw);
            assert_eq!(index.file_number(), raw + 1);
        }
    }

    #[test]
    fn project_arrangement_selection_keeps_out_of_range_raw() {
        assert_eq!(
            project_arrangement_selection(
                8,
                ARRANGEMENT_EVIDENCED_OS_REVISION,
                ARRANGEMENT_EVIDENCED_OS_RELEASE,
            ),
            ProjectArrangementSelection::Unrecognized(8)
        );
        assert_eq!(
            project_arrangement_selection(
                255,
                ARRANGEMENT_EVIDENCED_OS_REVISION,
                ARRANGEMENT_EVIDENCED_OS_RELEASE,
            ),
            ProjectArrangementSelection::Unrecognized(255)
        );
    }

    #[test]
    fn project_arrangement_selection_keeps_unevidenced_firmware_unrecognized() {
        for (revision, release) in [
            ("R0177", "1.40B"),
            ("R0173", "1.40A"),
            ("R0174", "1.40"),
            ("", ""),
        ] {
            assert_eq!(
                project_arrangement_selection(0, revision, release),
                ProjectArrangementSelection::Unrecognized(0),
                "{revision} {release}"
            );
            assert_eq!(
                project_arrangement_selection(7, revision, release),
                ProjectArrangementSelection::Unrecognized(7),
                "{revision} {release}"
            );
        }
    }

    #[test]
    fn playback_scale_keeps_unrecognized_raw() {
        assert_eq!(pattern_playback_scale(0), PatternPlaybackScale::Times2);
        assert_eq!(pattern_playback_scale(2), PatternPlaybackScale::Times1);
        assert_eq!(pattern_playback_scale(6), PatternPlaybackScale::Times1Over8);
        assert_eq!(
            pattern_playback_scale(7),
            PatternPlaybackScale::Unrecognized(7)
        );
        assert_eq!(
            pattern_playback_scale(255),
            PatternPlaybackScale::Unrecognized(255)
        );
    }

    #[test]
    fn per_track_master_length_keeps_inf_distinct_from_finite() {
        assert_eq!(
            per_track_master_length(255, 255),
            PatternMasterLength::Infinite
        );
        assert_eq!(
            per_track_master_length(0, 255),
            PatternMasterLength::Finite(255)
        );
        assert_eq!(
            per_track_master_length(4, 0),
            PatternMasterLength::Finite(1024)
        );
        assert_eq!(
            per_track_master_length(0, 2),
            PatternMasterLength::Finite(2)
        );
        assert_eq!(
            per_track_master_length(1, 0),
            PatternMasterLength::Finite(256)
        );
        assert_eq!(
            per_track_master_length(3, 255),
            PatternMasterLength::Finite(1023)
        );
        assert_ne!(
            per_track_master_length(255, 255),
            PatternMasterLength::Finite(255)
        );
        assert_ne!(
            per_track_master_length(255, 255),
            PatternMasterLength::Finite(1024)
        );
    }

    #[test]
    fn per_track_master_length_rejects_undocumented_multiplier() {
        assert_eq!(
            per_track_master_length(255, 16),
            PatternMasterLength::Unrecognized {
                multiplier: 255,
                length: 16
            }
        );
        assert_eq!(
            per_track_master_length(0, 1),
            PatternMasterLength::Unrecognized {
                multiplier: 0,
                length: 1
            }
        );
        assert_eq!(
            per_track_master_length(5, 16),
            PatternMasterLength::Unrecognized {
                multiplier: 5,
                length: 16
            }
        );
        assert_eq!(
            per_track_master_length(9, 16),
            PatternMasterLength::Unrecognized {
                multiplier: 9,
                length: 16
            }
        );
    }

    #[test]
    fn unmodeled_dependencies_are_explicit() {
        assert_eq!(BANK_UNMODELED_DEPENDENCIES.len(), 3);
        assert_eq!(
            BANK_UNMODELED_DEPENDENCIES,
            [
                UnmodeledDependency::Scenes,
                UnmodeledDependency::Arrangements,
                UnmodeledDependency::RecorderSetup,
            ]
        );
    }
}
