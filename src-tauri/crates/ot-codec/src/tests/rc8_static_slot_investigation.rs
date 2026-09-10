//! Synthetic fixtures for MO-RC8-STATIC-LINK-INVESTIGATION-1.
//!
//! Reproduces on-disk PATH rewrite semantics observed in RC8 Human Gate C evidence
//! using fictional sample names only. Does not embed operator media or real stems.

use super::{sample_block, slot, synthetic};
use crate::{decode_windows_1258, MemoryProjectReferenceCodec};
use ot_codec_ports::{ProjectReferenceCodec, SlotPathPatch};
use ot_domain::SampleSlotKind;

const OLD_BASENAME: &str = "SYN_OLD.wav";
const _NEW_BASENAME: &str = "SYN_NEW.wav";
const OLD_PATH: &str = "../AUDIO/SYN_OLD.wav";
const NEW_PATH: &str = "../AUDIO/SYN_NEW.wav";

fn codec() -> MemoryProjectReferenceCodec {
    MemoryProjectReferenceCodec
}

fn gate_c_like_project_document(path: &str) -> Vec<u8> {
    let text = format!(
        "[META]\r\nVERSION=19\r\n[/META]\r\n\r\n\
         [STATES]\r\n\
         ARRANGEMENT_MODE=0\r\n\
         PART=0\r\n\
         TRACK=4\r\n\
         TRACK_OTHERMODE=0\r\n\
         SCENE_A_MUTE=0\r\n\
         SCENE_B_MUTE=0\r\n\
         TRACK_CUE_MASK=0\r\n\
         TRACK_MUTE_MASK=9\r\n\
         TRACK_SOLO_MASK=0\r\n\
         [/STATES]\r\n\r\n\
         {}\r\n\r\n\
         {}\r\n",
        sample_block("STATIC", "002", "../AUDIO/other.wav"),
        sample_block("STATIC", "001", path)
    );
    synthetic(&text)
}

fn replace_unique(haystack: &[u8], needle: &[u8], replacement: &[u8]) -> Vec<u8> {
    let matches = haystack
        .windows(needle.len())
        .filter(|window| *window == needle)
        .count();
    assert_eq!(matches, 1, "expected exactly one PATH occurrence");
    let start = haystack
        .windows(needle.len())
        .position(|window| window == needle)
        .expect("PATH occurrence");
    let mut out = Vec::with_capacity(haystack.len() - needle.len() + replacement.len());
    out.extend_from_slice(&haystack[..start]);
    out.extend_from_slice(replacement);
    out.extend_from_slice(&haystack[start + needle.len()..]);
    out
}

/// Mirrors RC8 Apply: static slot 001 PATH basename changes; only PATH bytes delta.
#[test]
fn rc8_static_slot_same_directory_basename_patch_changes_only_path_bytes() {
    let original = gate_c_like_project_document(OLD_PATH);
    let patched = codec()
        .apply_path_patches(
            &original,
            &[SlotPathPatch {
                slot: slot(SampleSlotKind::Static, 1),
                from_raw_path: OLD_PATH.to_owned(),
                to_raw_path: NEW_PATH.to_owned(),
            }],
        )
        .expect("apply static slot 1 patch");

    let expected = replace_unique(&original, OLD_PATH.as_bytes(), NEW_PATH.as_bytes());
    assert_eq!(patched.bytes, expected);
    assert_eq!(patched.changed_slots, vec![slot(SampleSlotKind::Static, 1)]);

    let inspect = codec().inspect_sample_paths(&patched.bytes).unwrap();
    let entry = inspect
        .iter()
        .find(|e| e.slot == slot(SampleSlotKind::Static, 1))
        .expect("static slot 1");
    assert_eq!(entry.raw_path, NEW_PATH);
    assert!(
        !decode_windows_1258(&patched.bytes)
            .unwrap()
            .contains(OLD_BASENAME),
        "old basename must not remain in project bytes"
    );
}

/// Working and saved checkpoints are independent rewrite targets (RC8 plan shape).
#[test]
fn rc8_working_and_saved_documents_patch_independently() {
    let working = gate_c_like_project_document(OLD_PATH);
    let saved = gate_c_like_project_document(OLD_PATH);

    let patch = SlotPathPatch {
        slot: slot(SampleSlotKind::Static, 1),
        from_raw_path: OLD_PATH.to_owned(),
        to_raw_path: NEW_PATH.to_owned(),
    };

    let working_only = codec()
        .apply_path_patches(&working, std::slice::from_ref(&patch))
        .unwrap();
    assert_ne!(working_only.bytes, working);
    assert_eq!(saved, working, "precondition: identical pre-rename bytes");

    let saved_only = codec().apply_path_patches(&saved, &[patch]).unwrap();
    assert_ne!(saved_only.bytes, saved);
    assert_eq!(working_only.bytes, saved_only.bytes);
}

/// MkII-after pattern: STATES drift does not revert inspected PATH (observed AFTER evidence).
#[test]
fn rc8_states_drift_after_path_patch_leaves_sample_path_resolved_to_new_name() {
    let original = gate_c_like_project_document(OLD_PATH);
    let patched = codec()
        .apply_path_patches(
            &original,
            &[SlotPathPatch {
                slot: slot(SampleSlotKind::Static, 1),
                from_raw_path: OLD_PATH.to_owned(),
                to_raw_path: NEW_PATH.to_owned(),
            }],
        )
        .unwrap()
        .bytes;

    let mut text = decode_windows_1258(&patched).unwrap();
    text = text
        .replace("TRACK=4\r\n", "TRACK=0\r\n")
        .replace("SCENE_A_MUTE=0\r\n", "SCENE_A_MUTE=1\r\n")
        .replace("TRACK_MUTE_MASK=9\r\n", "TRACK_MUTE_MASK=23\r\n");
    let with_states_drift = synthetic(&text);

    let inspect = codec().inspect_sample_paths(&with_states_drift).unwrap();
    let entry = inspect
        .iter()
        .find(|e| e.slot == slot(SampleSlotKind::Static, 1))
        .unwrap();
    assert_eq!(entry.raw_path, NEW_PATH);
    assert!(!decode_windows_1258(&with_states_drift)
        .unwrap()
        .contains(OLD_BASENAME));
}

/// M5-B non-scope: bank bytes are not inputs to project PATH codec.
#[test]
fn rc8_project_path_codec_does_not_touch_bank_blob() {
    let bank_like = vec![0x46u8, 0x4F, 0x52, 0x4D, 0x00, 0x00, 0x00, 0x00]; // FORM....
    let bank_before = bank_like.clone();

    let _ = codec()
        .apply_path_patches(
            &gate_c_like_project_document(OLD_PATH),
            &[SlotPathPatch {
                slot: slot(SampleSlotKind::Static, 1),
                from_raw_path: OLD_PATH.to_owned(),
                to_raw_path: NEW_PATH.to_owned(),
            }],
        )
        .unwrap();

    assert_eq!(
        bank_like, bank_before,
        "bank-like blob must remain untouched by project PATH codec"
    );
}

/// Codec inspect sees on-disk PATH only after patch (not device RAM).
#[test]
fn rc8_verification_blind_spot_old_path_absent_from_inspect_after_successful_patch() {
    let patched = codec()
        .apply_path_patches(
            &gate_c_like_project_document(OLD_PATH),
            &[SlotPathPatch {
                slot: slot(SampleSlotKind::Static, 1),
                from_raw_path: OLD_PATH.to_owned(),
                to_raw_path: NEW_PATH.to_owned(),
            }],
        )
        .unwrap()
        .bytes;

    let inspect = codec().inspect_sample_paths(&patched).unwrap();
    assert!(
        inspect.iter().all(|entry| entry.raw_path != OLD_PATH),
        "inspect must not report stale on-disk PATH after patch"
    );
    assert!(
        inspect
            .iter()
            .any(|entry| entry.raw_path == NEW_PATH && entry.slot.number() == 1),
        "inspect must report destination PATH for static slot 1"
    );
}
