//! Filename-level Arranger observation.
//!
//! `arr01.work`..=`arr08.work` are separate documents. This module does not
//! map an arranger `pattern_id` onto `BankIndex` or `PatternIndex`. The
//! pinned parser's own comments disagree about that numbering, `n_rows == 0`
//! means both "no rows" and "256 rows", and the only tracked fixture does not
//! show a labeled Bank/Pattern. See `docs/planning/MO_PSE_ARRANGER_READ_1.md`.

use crate::project_structure::InvalidStructureIndex;
use crate::RootRelativePath;

pub const ARRANGEMENT_FILE_COUNT: u8 = 8;

/// Slot of `arr01.work`..=`arr08.work` derived from the file name.
///
/// `0` is `arr01`. This is not a number read from inside the file, and it is
/// not a Bank index.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct ArrangementFileIndex(u8);

impl ArrangementFileIndex {
    pub fn new(value: u8) -> Result<Self, InvalidStructureIndex> {
        if value < ARRANGEMENT_FILE_COUNT {
            Ok(Self(value))
        } else {
            Err(InvalidStructureIndex::for_value("arrangement file", value))
        }
    }

    /// Zero-based filename slot.
    pub fn get(self) -> u8 {
        self.0
    }

    /// On-media file number (`arr01`..=`arr08`).
    pub fn file_number(self) -> u8 {
        self.0 + 1
    }

    pub fn all() -> impl Iterator<Item = Self> {
        (0..ARRANGEMENT_FILE_COUNT).map(Self)
    }
}

/// Read-only classification of one `arrNN.work` file.
///
/// No variant carries a [`crate::project_structure::BankIndex`] or
/// [`crate::project_structure::PatternIndex`].
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ArrangementInspection {
    Malformed,
    UnsupportedVersion {
        observed_version: u8,
    },
    /// Header, datatype version, and raw checksum match the pinned parser.
    /// Row bytes are still not projected onto Bank/Pattern indexes.
    ///
    /// `n_rows == 0` is ambiguous in ot-tools-io: the same value means an
    /// empty arrangement and a 256-row arrangement, and the deserializer
    /// replaces every row with `EmptyRow` in that case. Callers must not
    /// treat a withheld observation as "no Bank references".
    ReferencesWithheld {
        datatype_version: u8,
        current_n_rows: u8,
        previous_n_rows: u8,
    },
}

impl ArrangementInspection {
    pub fn withholds_references(self) -> bool {
        matches!(self, Self::ReferencesWithheld { .. })
    }

    /// `true` when a decoded `n_rows` byte is the ambiguous zero value.
    pub fn active_row_count_is_ambiguous(self) -> bool {
        match self {
            Self::ReferencesWithheld {
                current_n_rows,
                previous_n_rows,
                ..
            } => current_n_rows == 0 || previous_n_rows == 0,
            _ => false,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ArrangementFileObservation {
    pub index: ArrangementFileIndex,
    pub source_relative_path: RootRelativePath,
    pub inspection: ArrangementInspection,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn arrangement_file_index_follows_the_filename_slot() {
        assert!(ArrangementFileIndex::new(8).is_err());
        let first = ArrangementFileIndex::new(0).unwrap();
        let last = ArrangementFileIndex::new(7).unwrap();
        assert_eq!(first.get(), 0);
        assert_eq!(first.file_number(), 1);
        assert_eq!(last.file_number(), 8);
        assert_eq!(ArrangementFileIndex::all().count(), 8);
    }

    #[test]
    fn withheld_inspection_is_not_a_resolved_reference() {
        let inspection = ArrangementInspection::ReferencesWithheld {
            datatype_version: 6,
            current_n_rows: 0,
            previous_n_rows: 0,
        };
        assert!(inspection.withholds_references());
        assert!(inspection.active_row_count_is_ambiguous());
        assert!(!ArrangementInspection::Malformed.withholds_references());
        assert!(!ArrangementInspection::Malformed.active_row_count_is_ambiguous());
    }
}
