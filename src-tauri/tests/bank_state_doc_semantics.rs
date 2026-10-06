//! Read-only evidence tests for MO-PSE-BANK-STATE-DOC-SEMANTICS-1.
//! Does not invoke legacy writers or mutate tracked fixtures.

use ot_domain::bank_state_documents::{
    evaluate_bank_operation_state_effect, BankStateDocOperation, BankStateDocumentSet,
};
use ot_domain::project_structure::BankIndex;
use ot_tools_io::{BankFile, OctatrackFileIO};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

fn fixture_root(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(name)
}

fn sha256_file(path: &Path) -> String {
    let bytes = fs::read(path).unwrap();
    format!("{:x}", Sha256::digest(bytes))
}

fn manifest(dir: &Path) -> BTreeMap<String, String> {
    let mut out = BTreeMap::new();
    for entry in fs::read_dir(dir).unwrap() {
        let entry = entry.unwrap();
        let path = entry.path();
        if path.is_file() {
            out.insert(
                path.file_name().unwrap().to_string_lossy().into_owned(),
                sha256_file(&path),
            );
        }
    }
    out
}

#[test]
fn contract_evaluation_leaves_tracked_fixtures_byte_identical() {
    let fixtures = ["real_device", "multipart"];
    for name in fixtures {
        let dir = fixture_root(name);
        let before = manifest(&dir);
        let bank = BankIndex::new(0).unwrap();
        let source = BankStateDocumentSet::new(
            bank,
            dir.join("bank01.work").is_file(),
            dir.join("bank01.strd").is_file(),
        );
        let dest = BankStateDocumentSet::new(BankIndex::new(3).unwrap(), false, false);
        let _ = evaluate_bank_operation_state_effect(
            BankStateDocOperation::Copy,
            bank,
            BankIndex::new(3).unwrap(),
            source,
            dest,
            Some(bank),
        );
        assert_eq!(manifest(&dir), before, "fixture {name} must stay unchanged");
    }
}

#[test]
fn real_device_bank01_work_and_strd_decode_and_differ() {
    let work_path = fixture_root("real_device").join("bank01.work");
    let strd_path = fixture_root("real_device").join("bank01.strd");
    let work_bytes = fs::read(&work_path).unwrap();
    let strd_bytes = fs::read(&strd_path).unwrap();
    assert_eq!(work_bytes.len(), strd_bytes.len());
    assert_ne!(work_bytes, strd_bytes);

    let work = BankFile::from_bytes(&work_bytes).expect("bank01.work decodes");
    let strd = BankFile::from_bytes(&strd_bytes).expect("bank01.strd decodes");
    assert_eq!(
        work.parts_edited_bitmask, strd.parts_edited_bitmask,
        "fixture observation only; not a universal SAVE PARTS rule"
    );
    assert_eq!(
        work.parts_saved_state, strd.parts_saved_state,
        "fixture observation only"
    );
}
