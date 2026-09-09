//! Validated Bank read-model checks used before a Bank state document is marked
//! `Parsed`. This does not re-encode Banks or enforce checksums without fixture
//! evidence for the specific document role (`.work` vs `.strd`).

use ot_tools_io::banks::{BankFile, BANK_FILE_VERSION, BANK_HEADER};

pub(crate) const BANK_VALIDATOR_NAME: &str = "masterocta/bank-validation";
pub(crate) const BANK_VALIDATOR_REVISION: &str = "v1";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum BankValidationError {
    HeaderMismatch,
    UnsupportedVersion,
    InvalidPartAssignment,
    InvalidMachineSlot,
    InvalidMachineType,
}

pub(crate) fn validate_bank_file(bank: &BankFile) -> Result<(), BankValidationError> {
    if bank.header != BANK_HEADER {
        return Err(BankValidationError::HeaderMismatch);
    }
    if bank.datatype_version != BANK_FILE_VERSION {
        return Err(BankValidationError::UnsupportedVersion);
    }
    if bank.parts.unsaved.0.len() != 4 || bank.parts.saved.0.len() != 4 {
        return Err(BankValidationError::InvalidPartAssignment);
    }
    for pattern in bank.patterns.0.iter() {
        if pattern.part_assignment > 3 {
            return Err(BankValidationError::InvalidPartAssignment);
        }
    }
    for part in bank.parts.unsaved.0.iter().chain(bank.parts.saved.0.iter()) {
        for machine_type in &part.audio_track_machine_types {
            if !machine_type_valid(*machine_type) {
                return Err(BankValidationError::InvalidMachineType);
            }
        }
        for track in &part.audio_track_machine_slots {
            if !machine_static_slot_id_valid(track.static_slot_id) {
                return Err(BankValidationError::InvalidMachineSlot);
            }
            if !machine_flex_slot_id_valid(track.flex_slot_id) {
                return Err(BankValidationError::InvalidMachineSlot);
            }
        }
    }
    Ok(())
}

/// Static=0, Flex=1, Thru=2, Neighbor=3, Pickup=4 per pinned ot-tools-io.
fn machine_type_valid(machine_type: u8) -> bool {
    matches!(machine_type, 0..=4)
}

/// Bank machine slots store a 0-based pool index (`0` = slot 1, `9` = slot 10).
/// `255` is the unassigned sentinel. Values `128` and above are not regular slots.
fn machine_static_slot_id_valid(slot_id: u8) -> bool {
    matches!(slot_id, 0..=127 | 255)
}

/// Flex machine slots may reference recorder-buffer range `129..=136` on tracked
/// fixtures. Those values are observable but excluded from regular sample usage.
fn machine_flex_slot_id_valid(slot_id: u8) -> bool {
    matches!(slot_id, 0..=127 | 255 | 129..=136)
}

/// Map a Bank machine slot raw value to a 0-based usage pool index.
pub(crate) fn bank_machine_slot_to_usage_index(slot_id: u8) -> Option<usize> {
    match slot_id {
        255 => None,
        0..=127 => Some(slot_id as usize),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ot_tools_io::{BankFile, OctatrackFileIO};
    use std::path::PathBuf;

    fn fixture_bank(name: &str) -> BankFile {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/real_device")
            .join(name);
        BankFile::from_data_file(&path).expect("fixture bank")
    }

    #[test]
    fn tracked_real_device_bank_passes_header_and_version_validation() {
        let bank = fixture_bank("bank01.work");
        assert_eq!(validate_bank_file(&bank), Ok(()));
    }

    #[test]
    fn header_mismatch_is_rejected() {
        let mut bank = fixture_bank("bank01.work");
        bank.header[0] ^= 0x01;
        assert_eq!(
            validate_bank_file(&bank),
            Err(BankValidationError::HeaderMismatch)
        );
    }

    #[test]
    fn flex_recorder_range_is_observable_but_not_regular_usage() {
        assert!(machine_flex_slot_id_valid(129));
        assert!(machine_flex_slot_id_valid(136));
        assert!(!machine_static_slot_id_valid(129));
        assert_eq!(bank_machine_slot_to_usage_index(129), None);
    }

    #[test]
    fn bank_machine_slot_zero_maps_to_first_pool_index() {
        assert_eq!(bank_machine_slot_to_usage_index(0), Some(0));
        assert_eq!(bank_machine_slot_to_usage_index(9), Some(9));
        assert_eq!(bank_machine_slot_to_usage_index(255), None);
    }

    #[test]
    fn bank_machine_slot_out_of_range_is_rejected() {
        assert_eq!(bank_machine_slot_to_usage_index(128), None);
        assert_eq!(bank_machine_slot_to_usage_index(129), None);
    }

    #[test]
    fn known_machine_types_zero_through_four_pass_validation() {
        let mut bank = fixture_bank("bank01.work");
        bank.parts.unsaved.0[0].audio_track_machine_types = [0, 1, 2, 3, 4, 0, 1, 2];
        assert_eq!(validate_bank_file(&bank), Ok(()));
    }

    #[test]
    fn unknown_machine_type_rejects_bank() {
        for machine_type in [5_u8, 42, 255] {
            let mut bank = fixture_bank("bank01.work");
            bank.parts.unsaved.0[0].audio_track_machine_types[0] = machine_type;
            assert_eq!(
                validate_bank_file(&bank),
                Err(BankValidationError::InvalidMachineType)
            );
        }
    }

    #[test]
    fn unknown_machine_type_in_saved_part_rejects_bank() {
        let mut bank = fixture_bank("bank01.work");
        bank.parts.saved.0[1].audio_track_machine_types[3] = 42;
        assert_eq!(
            validate_bank_file(&bank),
            Err(BankValidationError::InvalidMachineType)
        );
    }
}
