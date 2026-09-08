//! Validated Bank read-model checks used before a Bank state document is marked
//! `Parsed`. This does not re-encode Banks or enforce checksums without fixture
//! evidence for the specific document role (`.work` vs `.strd`).

use ot_tools_io::banks::{BankFile, BANK_FILE_VERSION, BANK_HEADER};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum BankValidationError {
    HeaderMismatch,
    UnsupportedVersion,
    InvalidPartAssignment,
    InvalidMachineSlot,
}

pub(crate) fn validate_bank_file(bank: &BankFile) -> Result<(), BankValidationError> {
    if bank.header != BANK_HEADER {
        return Err(BankValidationError::HeaderMismatch);
    }
    if bank.datatype_version != BANK_FILE_VERSION {
        return Err(BankValidationError::UnsupportedVersion);
    }
    if bank.parts.unsaved.0.len() != 4 {
        return Err(BankValidationError::InvalidPartAssignment);
    }
    for pattern in bank.patterns.0.iter() {
        if pattern.part_assignment > 3 {
            return Err(BankValidationError::InvalidPartAssignment);
        }
    }
    for part in bank.parts.unsaved.0.iter() {
        for track in &part.audio_track_machine_slots {
            if !machine_slot_id_valid(track.static_slot_id) {
                return Err(BankValidationError::InvalidMachineSlot);
            }
            if !machine_slot_id_valid(track.flex_slot_id) {
                return Err(BankValidationError::InvalidMachineSlot);
            }
        }
    }
    Ok(())
}

fn machine_slot_id_valid(slot_id: u8) -> bool {
    matches!(slot_id, 0 | 255 | 1..=128 | 129..=136)
}

#[cfg(test)]
mod tests {
    use super::*;
    use ot_tools_io::OctatrackFileIO;
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
}
