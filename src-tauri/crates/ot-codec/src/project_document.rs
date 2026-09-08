#![forbid(unsafe_code)]

use ot_domain::{
    ProjectCompatibilityEvidence, RecorderBufferId, SampleSlotId, SampleSlotKind,
    StateDocumentParseStatus,
};
use std::collections::HashSet;

pub const PROJECT_PARSER_NAME: &str = "masterocta/ot-codec-project";
pub const PROJECT_PARSER_REVISION: &str = "v1";

const META_TYPE: &str = "OCTATRACK DPS-1 PROJECT";
const META_VERSION: u32 = 19;
const VERIFIED_OS_REVISION: &str = "R0173";
const VERIFIED_OS_RELEASE: &str = "1.40";
const UPSTREAM_RELEASE_SUFFIXES: [&str; 3] = ["1.40A", "1.40B", "1.40C"];

const SAMPLE_START: &str = "[SAMPLE]";
const SAMPLE_END: &str = "[/SAMPLE]";
const META_START: &str = "[META]";
const META_END: &str = "[/META]";

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProjectDocumentParseResult {
    pub parse_status: StateDocumentParseStatus,
    pub compatibility: ProjectDocumentCompatibility,
    pub source_version: Option<String>,
    pub compatibility_evidence: Option<ProjectCompatibilityEvidence>,
    pub regular_assignments: Vec<RegularSampleAssignment>,
    pub recorder_buffers: Vec<RecorderBufferObservation>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ProjectDocumentCompatibility {
    Supported {
        evidence: ProjectCompatibilityEvidence,
    },
    UnsupportedVersion,
    Malformed,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RegularSampleAssignment {
    pub slot: SampleSlotId,
    pub raw_path: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RecorderBufferObservation {
    pub buffer: RecorderBufferId,
    pub raw_path: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct MetaFields {
    file_type: String,
    project_version: u32,
    os_version: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct ParsedSampleBlock {
    kind: SampleSlotKind,
    number: u16,
    raw_path: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum BlockKind {
    Meta,
    Sample,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ProjectOsVersion {
    revision: String,
    release: String,
}

pub fn parse_project_document(bytes: &[u8]) -> ProjectDocumentParseResult {
    let text = match decode_windows_1258(bytes) {
        Ok(text) => text,
        Err(_) => {
            return malformed_result(None);
        }
    };

    let meta = match parse_meta_block(&text) {
        Ok(meta) => meta,
        Err(status) => {
            return ProjectDocumentParseResult {
                parse_status: status,
                compatibility: ProjectDocumentCompatibility::Malformed,
                source_version: None,
                compatibility_evidence: None,
                regular_assignments: Vec::new(),
                recorder_buffers: Vec::new(),
            };
        }
    };

    let source_version = Some(meta.os_version.clone());
    let compatibility = evaluate_compatibility(&meta);
    let compatibility_evidence = match compatibility {
        ProjectDocumentCompatibility::Supported { evidence } => Some(evidence),
        ProjectDocumentCompatibility::UnsupportedVersion
        | ProjectDocumentCompatibility::Malformed => None,
    };

    if !matches!(
        compatibility,
        ProjectDocumentCompatibility::Supported { .. }
    ) {
        let parse_status = match compatibility {
            ProjectDocumentCompatibility::UnsupportedVersion => {
                StateDocumentParseStatus::UnsupportedVersion
            }
            ProjectDocumentCompatibility::Malformed => StateDocumentParseStatus::Malformed,
            ProjectDocumentCompatibility::Supported { .. } => StateDocumentParseStatus::Parsed,
        };
        return ProjectDocumentParseResult {
            parse_status,
            compatibility,
            source_version,
            compatibility_evidence,
            regular_assignments: Vec::new(),
            recorder_buffers: Vec::new(),
        };
    }

    match parse_sample_blocks(&text) {
        Ok((regular_assignments, recorder_buffers)) => ProjectDocumentParseResult {
            parse_status: StateDocumentParseStatus::Parsed,
            compatibility,
            source_version,
            compatibility_evidence,
            regular_assignments,
            recorder_buffers,
        },
        Err(parse_status) => ProjectDocumentParseResult {
            parse_status,
            compatibility,
            source_version,
            compatibility_evidence,
            regular_assignments: Vec::new(),
            recorder_buffers: Vec::new(),
        },
    }
}

fn malformed_result(source_version: Option<String>) -> ProjectDocumentParseResult {
    ProjectDocumentParseResult {
        parse_status: StateDocumentParseStatus::Malformed,
        compatibility: ProjectDocumentCompatibility::Malformed,
        source_version,
        compatibility_evidence: None,
        regular_assignments: Vec::new(),
        recorder_buffers: Vec::new(),
    }
}

fn decode_windows_1258(bytes: &[u8]) -> Result<String, ()> {
    let (decoded, _, had_errors) = encoding_rs::WINDOWS_1258.decode(bytes);
    if had_errors {
        return Err(());
    }
    let text = decoded.into_owned();
    let (encoded, _, had_unmappable) = encoding_rs::WINDOWS_1258.encode(&text);
    if had_unmappable || encoded.as_ref() != bytes {
        return Err(());
    }
    Ok(text)
}

fn parse_meta_block(text: &str) -> Result<MetaFields, StateDocumentParseStatus> {
    let lines = text_lines(text);
    let mut index = 0;
    while index < lines.len() {
        if lines[index].content == META_START {
            index += 1;
            let mut file_type = None;
            let mut project_version = None;
            let mut os_version = None;
            while index < lines.len() {
                if lines[index].content == META_END {
                    break;
                }
                let line = &lines[index];
                if let Some(value) = field_value(line.content, "TYPE") {
                    if file_type.is_some() {
                        return Err(StateDocumentParseStatus::Malformed);
                    }
                    file_type = Some(value.to_owned());
                } else if let Some(value) = field_value(line.content, "VERSION") {
                    if project_version.is_some() {
                        return Err(StateDocumentParseStatus::Malformed);
                    }
                    project_version = Some(parse_u32_field(value)?);
                } else if let Some(value) = field_value(line.content, "OS_VERSION") {
                    if os_version.is_some() {
                        return Err(StateDocumentParseStatus::Malformed);
                    }
                    os_version = Some(value.to_owned());
                }
                index += 1;
            }
            let file_type = file_type.ok_or(StateDocumentParseStatus::Malformed)?;
            let project_version = project_version.ok_or(StateDocumentParseStatus::Malformed)?;
            let os_version = os_version.ok_or(StateDocumentParseStatus::Malformed)?;
            return Ok(MetaFields {
                file_type,
                project_version,
                os_version,
            });
        }
        index += 1;
    }
    Err(StateDocumentParseStatus::Malformed)
}

fn parse_u32_field(value: &str) -> Result<u32, StateDocumentParseStatus> {
    if value.is_empty() || !value.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err(StateDocumentParseStatus::Malformed);
    }
    value
        .parse::<u32>()
        .map_err(|_| StateDocumentParseStatus::Malformed)
}

fn evaluate_compatibility(meta: &MetaFields) -> ProjectDocumentCompatibility {
    if meta.file_type != META_TYPE {
        return ProjectDocumentCompatibility::Malformed;
    }
    if meta.project_version != META_VERSION {
        return ProjectDocumentCompatibility::UnsupportedVersion;
    }
    let os_version = parse_os_version(&meta.os_version);
    if os_version.is_none() {
        return ProjectDocumentCompatibility::UnsupportedVersion;
    }
    let os_version = os_version.unwrap();
    if upstream_release_supported(&os_version.release) {
        return ProjectDocumentCompatibility::Supported {
            evidence: ProjectCompatibilityEvidence::UpstreamLibrary,
        };
    }
    if os_version.revision == VERIFIED_OS_REVISION && os_version.release == VERIFIED_OS_RELEASE {
        return ProjectDocumentCompatibility::Supported {
            evidence: ProjectCompatibilityEvidence::VerifiedMasterOctaFixture,
        };
    }
    ProjectDocumentCompatibility::UnsupportedVersion
}

fn upstream_release_supported(release: &str) -> bool {
    UPSTREAM_RELEASE_SUFFIXES.contains(&release)
}

pub(crate) fn parse_os_version(value: &str) -> Option<ProjectOsVersion> {
    let separator_start = value.as_bytes().iter().position(|byte| *byte == b' ')?;
    let revision = &value[..separator_start];
    let separator_end = value.as_bytes()[separator_start..]
        .iter()
        .position(|byte| *byte != b' ')
        .map(|offset| separator_start + offset)?;
    let release = &value[separator_end..];

    if release.contains(' ') || !valid_revision(revision) || !valid_release(release) {
        return None;
    }

    Some(ProjectOsVersion {
        revision: revision.to_owned(),
        release: release.to_owned(),
    })
}

fn valid_revision(value: &str) -> bool {
    value.len() == 5
        && value.starts_with('R')
        && value.as_bytes()[1..].iter().all(u8::is_ascii_digit)
}

fn valid_release(value: &str) -> bool {
    let Some((major, minor_and_suffix)) = value.split_once('.') else {
        return false;
    };
    if major.is_empty() || !major.bytes().all(|byte| byte.is_ascii_digit()) {
        return false;
    }
    let bytes = minor_and_suffix.as_bytes();
    matches!(bytes.len(), 2 | 3)
        && bytes[..2].iter().all(u8::is_ascii_digit)
        && (bytes.len() == 2 || bytes[2].is_ascii_uppercase())
}

fn parse_sample_blocks(
    text: &str,
) -> Result<(Vec<RegularSampleAssignment>, Vec<RecorderBufferObservation>), StateDocumentParseStatus>
{
    let lines = text_lines(text);
    let mut regular_assignments = Vec::new();
    let mut recorder_buffers = Vec::new();
    let mut seen = HashSet::new();
    let mut index = 0;

    while index < lines.len() {
        match classify_block_line(lines[index].content) {
            BlockLine::Other => index += 1,
            BlockLine::Close(BlockKind::Sample) => return Err(StateDocumentParseStatus::Malformed),
            BlockLine::Close(BlockKind::Meta) => return Err(StateDocumentParseStatus::Malformed),
            BlockLine::Open(BlockKind::Meta) => {
                index = skip_closed_block(&lines, index + 1, META_END)?;
            }
            BlockLine::Open(BlockKind::Sample) => {
                index += 1;
                let block = parse_sample_block(&lines, &mut index)?;
                if !seen.insert((block.kind, block.number)) {
                    return Err(StateDocumentParseStatus::Malformed);
                }
                match classify_slot(block.kind, block.number) {
                    SlotClassification::Regular(slot) => {
                        if !block.raw_path.is_empty() {
                            regular_assignments.push(RegularSampleAssignment {
                                slot,
                                raw_path: block.raw_path,
                            });
                        }
                    }
                    SlotClassification::Recorder(buffer) => {
                        recorder_buffers.push(RecorderBufferObservation {
                            buffer,
                            raw_path: block.raw_path,
                        });
                    }
                    SlotClassification::Invalid => {
                        return Err(StateDocumentParseStatus::Malformed);
                    }
                }
            }
        }
    }

    regular_assignments.sort_by(|left, right| {
        (slot_kind_rank(left.slot.kind()), left.slot.number())
            .cmp(&(slot_kind_rank(right.slot.kind()), right.slot.number()))
    });
    recorder_buffers.sort_by_key(|entry| entry.buffer.buffer_number());
    Ok((regular_assignments, recorder_buffers))
}

enum SlotClassification {
    Regular(SampleSlotId),
    Recorder(RecorderBufferId),
    Invalid,
}

fn classify_slot(kind: SampleSlotKind, number: u16) -> SlotClassification {
    if let Ok(slot) = SampleSlotId::new(kind, number) {
        return SlotClassification::Regular(slot);
    }
    if kind == SampleSlotKind::Flex {
        if let Ok(buffer) = RecorderBufferId::new(number) {
            return SlotClassification::Recorder(buffer);
        }
    }
    SlotClassification::Invalid
}

fn parse_sample_block(
    lines: &[TextLine<'_>],
    index: &mut usize,
) -> Result<ParsedSampleBlock, StateDocumentParseStatus> {
    let mut slot_type = None;
    let mut slot_number = None;
    let mut path = None;

    while *index < lines.len() {
        match classify_block_line(lines[*index].content) {
            BlockLine::Open(_) => return Err(StateDocumentParseStatus::Malformed),
            BlockLine::Close(BlockKind::Sample) => {
                *index += 1;
                break;
            }
            BlockLine::Close(BlockKind::Meta) => return Err(StateDocumentParseStatus::Malformed),
            BlockLine::Other => {
                let line = &lines[*index];
                if let Some(value) = field_value(line.content, "TYPE") {
                    if slot_type.is_some() {
                        return Err(StateDocumentParseStatus::Malformed);
                    }
                    slot_type = Some(parse_slot_kind(value)?);
                } else if let Some(value) = field_value(line.content, "SLOT") {
                    if slot_number.is_some() {
                        return Err(StateDocumentParseStatus::Malformed);
                    }
                    slot_number = Some(parse_slot_number(value)?);
                } else if let Some(value) = field_value(line.content, "PATH") {
                    if path.is_some() {
                        return Err(StateDocumentParseStatus::Malformed);
                    }
                    path = Some(value.to_owned());
                }
                *index += 1;
            }
        }
    }

    let kind = slot_type.ok_or(StateDocumentParseStatus::Malformed)?;
    let number = slot_number.ok_or(StateDocumentParseStatus::Malformed)?;
    let raw_path = path.ok_or(StateDocumentParseStatus::Malformed)?;
    Ok(ParsedSampleBlock {
        kind,
        number,
        raw_path,
    })
}

fn skip_closed_block(
    lines: &[TextLine<'_>],
    start: usize,
    end_marker: &str,
) -> Result<usize, StateDocumentParseStatus> {
    let mut index = start;
    while index < lines.len() {
        if lines[index].content == end_marker {
            return Ok(index + 1);
        }
        index += 1;
    }
    Err(StateDocumentParseStatus::Malformed)
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum BlockLine {
    Open(BlockKind),
    Close(BlockKind),
    Other,
}

fn classify_block_line(line: &str) -> BlockLine {
    if line == META_START {
        return BlockLine::Open(BlockKind::Meta);
    }
    if line == META_END {
        return BlockLine::Close(BlockKind::Meta);
    }
    if line == SAMPLE_START {
        return BlockLine::Open(BlockKind::Sample);
    }
    if line == SAMPLE_END {
        return BlockLine::Close(BlockKind::Sample);
    }
    if line.eq_ignore_ascii_case(META_START)
        || line.eq_ignore_ascii_case(META_END)
        || line.eq_ignore_ascii_case(SAMPLE_START)
        || line.eq_ignore_ascii_case(SAMPLE_END)
        || line.contains(META_START)
        || line.contains(META_END)
        || line.contains(SAMPLE_START)
        || line.contains(SAMPLE_END)
    {
        return BlockLine::Open(BlockKind::Sample);
    }
    BlockLine::Other
}

struct TextLine<'a> {
    content: &'a str,
}

fn text_lines(text: &str) -> Vec<TextLine<'_>> {
    let mut lines = Vec::new();
    let mut pos = 0;
    while pos < text.len() {
        let rest = &text[pos..];
        let step = rest.find('\n').map(|index| index + 1).unwrap_or(rest.len());
        let content = rest[..step].trim_end_matches(['\r', '\n']);
        lines.push(TextLine { content });
        pos += step;
        if step == rest.len() {
            break;
        }
    }
    lines
}

fn field_value<'a>(line: &'a str, key: &str) -> Option<&'a str> {
    let line_bytes = line.as_bytes();
    let key_bytes = key.as_bytes();
    if line_bytes.len() < key_bytes.len() + 1 {
        return None;
    }
    if !line_bytes[..key_bytes.len()].eq_ignore_ascii_case(key_bytes) {
        return None;
    }
    if line_bytes[key_bytes.len()] != b'=' {
        return None;
    }
    Some(&line[key_bytes.len() + 1..])
}

fn parse_slot_kind(value: &str) -> Result<SampleSlotKind, StateDocumentParseStatus> {
    if value.eq_ignore_ascii_case("STATIC") {
        Ok(SampleSlotKind::Static)
    } else if value.eq_ignore_ascii_case("FLEX") {
        Ok(SampleSlotKind::Flex)
    } else {
        Err(StateDocumentParseStatus::Malformed)
    }
}

fn parse_slot_number(value: &str) -> Result<u16, StateDocumentParseStatus> {
    if value.is_empty() || !value.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err(StateDocumentParseStatus::Malformed);
    }
    let number = value
        .parse::<u16>()
        .map_err(|_| StateDocumentParseStatus::Malformed)?;
    if number == 0 {
        return Err(StateDocumentParseStatus::Malformed);
    }
    Ok(number)
}

fn slot_kind_rank(kind: SampleSlotKind) -> u8 {
    ot_domain::slot_kind_rank(kind)
}
