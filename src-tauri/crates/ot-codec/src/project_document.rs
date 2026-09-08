#![forbid(unsafe_code)]

use crate::project_structure::{
    classify_observed_slot, decode_reversible_windows_1258, field_value,
    parse_sample_blocks as parse_structure_sample_blocks, ObservedSlotKind, SampleStructureError,
    META_END, META_START,
};
use ot_domain::{
    ProjectCompatibilityEvidence, RecorderBufferId, SampleSlotId, SampleSlotKind,
    StateDocumentParseStatus,
};

pub const PROJECT_PARSER_NAME: &str = "masterocta/ot-codec-project";
pub const PROJECT_PARSER_REVISION: &str = "v1";

const META_TYPE: &str = "OCTATRACK DPS-1 PROJECT";
const META_VERSION: u32 = 19;
const VERIFIED_OS_REVISION: &str = "R0173";
const VERIFIED_OS_RELEASE: &str = "1.40";
const UPSTREAM_RELEASE_SUFFIXES: [&str; 3] = ["1.40A", "1.40B", "1.40C"];

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

    match parse_document_sample_blocks(&text) {
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
    decode_reversible_windows_1258(bytes).map_err(|_| ())
}

fn parse_document_sample_blocks(
    text: &str,
) -> Result<(Vec<RegularSampleAssignment>, Vec<RecorderBufferObservation>), StateDocumentParseStatus>
{
    let blocks =
        parse_structure_sample_blocks(text).map_err(map_structure_error_to_parse_status)?;
    let mut regular_assignments = Vec::new();
    let mut recorder_buffers = Vec::new();

    for block in blocks {
        match classify_observed_slot(block.kind, block.number) {
            ObservedSlotKind::Regular(slot) => {
                if !block.raw_path.is_empty() {
                    regular_assignments.push(RegularSampleAssignment {
                        slot,
                        raw_path: block.raw_path,
                    });
                }
            }
            ObservedSlotKind::Recorder(buffer) => {
                recorder_buffers.push(RecorderBufferObservation {
                    buffer,
                    raw_path: block.raw_path,
                });
            }
            ObservedSlotKind::Invalid => return Err(StateDocumentParseStatus::Malformed),
        }
    }

    regular_assignments.sort_by(|left, right| {
        (slot_kind_rank(left.slot.kind()), left.slot.number())
            .cmp(&(slot_kind_rank(right.slot.kind()), right.slot.number()))
    });
    recorder_buffers.sort_by_key(|entry| entry.buffer.buffer_number());
    Ok((regular_assignments, recorder_buffers))
}

fn map_structure_error_to_parse_status(_error: SampleStructureError) -> StateDocumentParseStatus {
    StateDocumentParseStatus::Malformed
}

fn slot_kind_rank(kind: SampleSlotKind) -> u8 {
    ot_domain::slot_kind_rank(kind)
}

fn parse_meta_block(text: &str) -> Result<MetaFields, StateDocumentParseStatus> {
    let lines = meta_text_lines(text);
    let mut index = 0;
    while index < lines.len() {
        if lines[index].content == META_START {
            index += 1;
            let mut file_type = None;
            let mut project_version = None;
            let mut os_version = None;
            let mut found_end = false;
            while index < lines.len() {
                if lines[index].content == META_END {
                    found_end = true;
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
            if !found_end {
                return Err(StateDocumentParseStatus::Malformed);
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

struct MetaTextLine<'a> {
    content: &'a str,
}

fn meta_text_lines(text: &str) -> Vec<MetaTextLine<'_>> {
    let mut lines = Vec::new();
    let mut pos = 0;
    while pos < text.len() {
        let rest = &text[pos..];
        let step = rest.find('\n').map(|index| index + 1).unwrap_or(rest.len());
        let content = rest[..step].trim_end_matches(['\r', '\n']);
        lines.push(MetaTextLine { content });
        pos += step;
        if step == rest.len() {
            break;
        }
    }
    lines
}
