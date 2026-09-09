use crate::{parse_project_document, MemoryProjectReferenceCodec, ProjectDocumentCompatibility};
use ot_codec_ports::{ProjectReferenceCodec, ReferenceRewriteError};
use ot_domain::{SampleSlotKind, StateDocumentParseStatus};

fn encode_windows_1258(text: &str) -> Vec<u8> {
    let (encoded, _, had_unmappable) = encoding_rs::WINDOWS_1258.encode(text);
    assert!(!had_unmappable);
    encoded.into_owned()
}

fn sample_block(kind: &str, number: &str, path: &str) -> String {
    format!("[SAMPLE]\r\nTYPE={kind}\r\nSLOT={number}\r\nPATH={path}\r\n[/SAMPLE]")
}

fn gate_c_meta() -> String {
    "[META]\r\nTYPE=OCTATRACK DPS-1 PROJECT\r\nVERSION=19\r\nOS_VERSION=R0173      1.40\r\n[/META]\r\n"
        .to_owned()
}

fn gate_c_containers() -> String {
    "[SETTINGS]\r\nWRITEPROTECTED=0\r\n[/SETTINGS]\r\n\r\n[STATES]\r\nBANK=0\r\n[/STATES]\r\n"
        .to_owned()
}

#[test]
fn reader_and_rewrite_agree_on_unclosed_sample_block() {
    let bytes = encode_windows_1258(&format!(
        "{}\r\n{}\r\n{}",
        gate_c_meta(),
        gate_c_containers(),
        "[SAMPLE]\r\nTYPE=STATIC\r\nSLOT=001\r\nPATH=kick.wav\r\n"
    ));
    let parsed = parse_project_document(&bytes);
    assert_eq!(parsed.parse_status, StateDocumentParseStatus::Malformed);
    assert!(parsed.regular_assignments.is_empty());
    assert_eq!(
        MemoryProjectReferenceCodec.inspect_sample_paths(&bytes),
        Err(ReferenceRewriteError::UnclosedSampleBlock)
    );
}

#[test]
fn reader_and_rewrite_agree_on_duplicate_type_slot_pair() {
    let bytes = encode_windows_1258(&format!(
        "{}\r\n{}\r\n{}\r\n{}",
        gate_c_meta(),
        gate_c_containers(),
        sample_block("STATIC", "001", "a.wav"),
        sample_block("STATIC", "001", "b.wav")
    ));
    let parsed = parse_project_document(&bytes);
    assert_eq!(parsed.parse_status, StateDocumentParseStatus::Malformed);
    assert!(matches!(
        MemoryProjectReferenceCodec.inspect_sample_paths(&bytes),
        Err(ReferenceRewriteError::DuplicateSlot { .. })
    ));
}

#[test]
fn reader_and_rewrite_agree_on_static_129_malformed() {
    let bytes = encode_windows_1258(&format!(
        "{}\r\n{}\r\n{}",
        gate_c_meta(),
        gate_c_containers(),
        sample_block("STATIC", "129", "a.wav")
    ));
    let parsed = parse_project_document(&bytes);
    assert_eq!(parsed.parse_status, StateDocumentParseStatus::Malformed);
    assert_eq!(
        MemoryProjectReferenceCodec.inspect_sample_paths(&bytes),
        Err(ReferenceRewriteError::InvalidSlot)
    );
}

#[test]
fn reader_and_rewrite_agree_on_flex_137_malformed() {
    let bytes = encode_windows_1258(&format!(
        "{}\r\n{}\r\n{}",
        gate_c_meta(),
        gate_c_containers(),
        sample_block("FLEX", "137", "a.wav")
    ));
    let parsed = parse_project_document(&bytes);
    assert_eq!(parsed.parse_status, StateDocumentParseStatus::Malformed);
    assert_eq!(
        MemoryProjectReferenceCodec.inspect_sample_paths(&bytes),
        Err(ReferenceRewriteError::InvalidSlot)
    );
}

#[test]
fn reader_and_rewrite_agree_on_supported_twelve_sample_document() {
    let body = format!(
        "{meta}\r\n{containers}\r\n{static1}\r\n{flex129}\r\n",
        meta = gate_c_meta(),
        containers = gate_c_containers(),
        static1 = sample_block("STATIC", "001", "../AUDIO/kick.wav"),
        flex129 = sample_block("FLEX", "129", ""),
    );
    let bytes = encode_windows_1258(&body);
    let parsed = parse_project_document(&bytes);
    assert_eq!(parsed.parse_status, StateDocumentParseStatus::Parsed);
    assert_eq!(
        parsed.compatibility,
        ProjectDocumentCompatibility::Supported
    );
    assert_eq!(parsed.regular_assignments.len(), 1);
    assert_eq!(parsed.recorder_buffers.len(), 1);
    let inspect = MemoryProjectReferenceCodec
        .inspect_sample_paths(&bytes)
        .unwrap();
    assert_eq!(inspect.len(), 1);
    assert_eq!(inspect[0].slot.kind(), SampleSlotKind::Static);
}
