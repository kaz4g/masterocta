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

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TrackStructure {
    pub index: TrackIndex,
    pub machine: MachineKind,
    pub slot: TrackSlotReference,
}

/// A Part as read from the Bank's working (`unsaved`) Part copy.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PartStructure {
    pub index: PartIndex,
    pub tracks: Vec<TrackStructure>,
}

/// A Pattern refers to a Part by index; it is not nested under that Part.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PatternStructure {
    pub index: PatternIndex,
    pub part: PartIndex,
    pub master_length: u16,
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

/// Banks are ordered by Bank index, then Working before SavedCheckpoint.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProjectStructure {
    pub project_relative_path: RootRelativePath,
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
    }

    #[test]
    fn index_iterators_cover_the_full_range() {
        assert_eq!(BankIndex::all().count(), 16);
        assert_eq!(PatternIndex::all().count(), 16);
        assert_eq!(PartIndex::all().count(), 4);
        assert_eq!(TrackIndex::all().count(), 8);
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
            master_length: 16,
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
}
