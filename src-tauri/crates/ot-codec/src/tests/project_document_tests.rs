use crate::{
    parse_project_document, ProjectDocumentCompatibility, PROJECT_PARSER_NAME,
    PROJECT_PARSER_REVISION,
};
use ot_domain::{
    ProjectCompatibilityEvidence, RecorderBufferId, SampleSlotId, SampleSlotKind,
    StateDocumentParseStatus,
};

fn encode_windows_1258(text: &str) -> Vec<u8> {
    let (encoded, _, had_unmappable) = encoding_rs::WINDOWS_1258.encode(text);
    assert!(!had_unmappable);
    encoded.into_owned()
}

fn sample_block(kind: &str, number: &str, path: &str) -> String {
    format!(
        "[SAMPLE]\r\nTYPE={kind}\r\nSLOT={number}\r\nPATH={path}\r\nTRIGQUANTIZATION=-1\r\n[/SAMPLE]"
    )
}

fn gate_c_meta() -> String {
    "[META]\r\nTYPE=OCTATRACK DPS-1 PROJECT\r\nVERSION=19\r\nOS_VERSION=R0173      1.40\r\n[/META]\r\n"
        .to_owned()
}

fn gate_c_twelve_sample_document() -> Vec<u8> {
    let body = format!(
        "{meta}\r\n{static1}\r\n{static2}\r\n{static4}\r\n{static5}\r\n{flex129}\r\n{flex130}\r\n{flex131}\r\n{flex132}\r\n{flex133}\r\n{flex134}\r\n{flex135}\r\n{flex136}\r\n",
        meta = gate_c_meta(),
        static1 = sample_block("STATIC", "001", "../AUDIO/kick.wav"),
        static2 = sample_block("STATIC", "002", "../AUDIO/snare.wav"),
        static4 = sample_block("STATIC", "004", "../AUDIO/hat.wav"),
        static5 = sample_block("STATIC", "005", "../AUDIO/clap.wav"),
        flex129 = sample_block("FLEX", "129", ""),
        flex130 = sample_block("FLEX", "130", ""),
        flex131 = sample_block("FLEX", "131", ""),
        flex132 = sample_block("FLEX", "132", ""),
        flex133 = sample_block("FLEX", "133", "../AUDIO/rec.wav"),
        flex134 = sample_block("FLEX", "134", ""),
        flex135 = sample_block("FLEX", "135", ""),
        flex136 = sample_block("FLEX", "136", ""),
    );
    encode_windows_1258(&body)
}

#[test]
fn gate_c_twelve_sample_structure_parses_regular_and_recorder_buffers() {
    let parsed = parse_project_document(&gate_c_twelve_sample_document());

    assert_eq!(parsed.parse_status, StateDocumentParseStatus::Parsed);
    assert_eq!(
        parsed.compatibility,
        ProjectDocumentCompatibility::Supported {
            evidence: ProjectCompatibilityEvidence::VerifiedMasterOctaFixture,
        }
    );
    assert_eq!(parsed.source_version.as_deref(), Some("R0173      1.40"));
    assert_eq!(PROJECT_PARSER_NAME, "masterocta/ot-codec-project");
    assert_eq!(PROJECT_PARSER_REVISION, "v1");
    assert_eq!(parsed.regular_assignments.len(), 4);
    assert!(parsed.regular_assignments.iter().all(|assignment| {
        assignment.slot.number() != 129
            && assignment.slot.number() != 133
            && assignment.slot.kind() == SampleSlotKind::Static
    }));
    assert_eq!(parsed.recorder_buffers.len(), 8);
    assert_eq!(
        parsed.recorder_buffers[4].buffer,
        RecorderBufferId::new(133).unwrap()
    );
    assert_eq!(parsed.recorder_buffers[4].raw_path, "../AUDIO/rec.wav");
}

#[test]
fn duplicate_sample_blocks_fail_closed() {
    let body = format!(
        "{meta}\r\n{first}\r\n{second}\r\n",
        meta = gate_c_meta(),
        first = sample_block("STATIC", "001", "kick.wav"),
        second = sample_block("STATIC", "001", "other.wav"),
    );
    let parsed = parse_project_document(&encode_windows_1258(&body));
    assert_eq!(parsed.parse_status, StateDocumentParseStatus::Malformed);
    assert!(parsed.regular_assignments.is_empty());
}

#[test]
fn invalid_meta_type_is_malformed() {
    let body =
        "[META]\r\nTYPE=NOT-A-PROJECT\r\nVERSION=19\r\nOS_VERSION=R0173      1.40\r\n[/META]\r\n";
    let parsed = parse_project_document(&encode_windows_1258(body));
    assert_eq!(parsed.parse_status, StateDocumentParseStatus::Malformed);
    assert_eq!(
        parsed.compatibility,
        ProjectDocumentCompatibility::Malformed
    );
}

#[test]
fn invalid_slot_number_malforms_the_document() {
    let body = format!(
        "{meta}\r\n{sample}\r\n",
        meta = gate_c_meta(),
        sample = sample_block("STATIC", "200", "kick.wav"),
    );
    let parsed = parse_project_document(&encode_windows_1258(&body));
    assert_eq!(parsed.parse_status, StateDocumentParseStatus::Malformed);
}

#[test]
fn recorder_buffer_non_empty_path_does_not_malform_project() {
    let parsed = parse_project_document(&gate_c_twelve_sample_document());
    assert_eq!(parsed.parse_status, StateDocumentParseStatus::Parsed);
    assert!(parsed
        .recorder_buffers
        .iter()
        .any(|entry| entry.buffer == RecorderBufferId::new(133).unwrap()));
    assert!(!parsed.regular_assignments.iter().any(|assignment| {
        assignment.slot == SampleSlotId::new(SampleSlotKind::Flex, 1).unwrap()
            && assignment.raw_path == "../AUDIO/rec.wav"
    }));
}
