#![forbid(unsafe_code)]

use ot_domain::{RecorderBufferId, SampleSlotId, SampleSlotKind};
use std::collections::HashSet;
use std::ops::Range;

pub(crate) const SAMPLE_START: &str = "[SAMPLE]";
pub(crate) const SAMPLE_END: &str = "[/SAMPLE]";
pub(crate) const META_START: &str = "[META]";
pub(crate) const META_END: &str = "[/META]";
pub(crate) const SETTINGS_START: &str = "[SETTINGS]";
pub(crate) const SETTINGS_END: &str = "[/SETTINGS]";
pub(crate) const STATES_START: &str = "[STATES]";
pub(crate) const STATES_END: &str = "[/STATES]";
pub(crate) const FLEX_RECORDER_MIN: u16 = 129;
pub(crate) const FLEX_RECORDER_MAX: u16 = 136;

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct StructureSampleBlock {
    pub kind: SampleSlotKind,
    pub number: u16,
    pub raw_path: String,
    pub path_range: Range<usize>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum SampleStructureError {
    IrreversibleEncoding,
    UnclosedSampleBlock,
    UnexpectedSampleCloser,
    NestedSampleBlock,
    DuplicateField,
    DuplicatePathLine,
    MissingType,
    MissingSlot,
    MissingPath,
    DuplicateSlot { kind: SampleSlotKind, number: u16 },
    InvalidSlot,
    UnsupportedSlotType,
    UnsafePathText,
    MalformedDocument,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum ObservedSlotKind {
    Regular(SampleSlotId),
    Recorder(RecorderBufferId),
    Invalid,
}

pub(crate) fn decode_reversible_windows_1258(bytes: &[u8]) -> Result<String, SampleStructureError> {
    let (decoded, _, had_errors) = encoding_rs::WINDOWS_1258.decode(bytes);
    if had_errors {
        return Err(SampleStructureError::IrreversibleEncoding);
    }
    let text = decoded.into_owned();
    let (encoded, _, had_unmappable) = encoding_rs::WINDOWS_1258.encode(&text);
    if had_unmappable || encoded.as_ref() != bytes {
        return Err(SampleStructureError::IrreversibleEncoding);
    }
    Ok(text)
}

pub(crate) fn encode_reversible_windows_1258(text: &str) -> Result<Vec<u8>, SampleStructureError> {
    let (encoded, _, had_unmappable) = encoding_rs::WINDOWS_1258.encode(text);
    if had_unmappable {
        return Err(SampleStructureError::IrreversibleEncoding);
    }
    Ok(encoded.into_owned())
}

pub(crate) fn classify_observed_slot(kind: SampleSlotKind, number: u16) -> ObservedSlotKind {
    if let Ok(slot) = SampleSlotId::new(kind, number) {
        return ObservedSlotKind::Regular(slot);
    }
    if kind == SampleSlotKind::Flex {
        if let Ok(buffer) = RecorderBufferId::new(number) {
            return ObservedSlotKind::Recorder(buffer);
        }
    }
    ObservedSlotKind::Invalid
}

pub(crate) fn is_flex_recorder_buffer(kind: SampleSlotKind, number: u16) -> bool {
    kind == SampleSlotKind::Flex && (FLEX_RECORDER_MIN..=FLEX_RECORDER_MAX).contains(&number)
}

pub(crate) fn validate_required_container_sections(text: &str) -> Result<(), SampleStructureError> {
    validate_single_required_section(text, SETTINGS_START, SETTINGS_END)?;
    validate_single_required_section(text, STATES_START, STATES_END)?;
    Ok(())
}

fn validate_single_required_section(
    text: &str,
    start: &str,
    end: &str,
) -> Result<(), SampleStructureError> {
    let lines = text_lines(text);
    let mut open_depth = 0;
    let mut saw_open = false;
    let mut saw_close = false;
    for line in &lines {
        let content = line.content;
        if content == start {
            if saw_open {
                return Err(SampleStructureError::MalformedDocument);
            }
            if open_depth > 0 {
                return Err(SampleStructureError::NestedSampleBlock);
            }
            saw_open = true;
            open_depth += 1;
        } else if content == end {
            if open_depth == 0 {
                return Err(SampleStructureError::UnexpectedSampleCloser);
            }
            open_depth -= 1;
            saw_close = true;
        } else if open_depth > 0
            && matches!(
                content,
                META_START
                    | META_END
                    | SETTINGS_START
                    | SETTINGS_END
                    | STATES_START
                    | STATES_END
                    | SAMPLE_START
                    | SAMPLE_END
            )
        {
            return Err(SampleStructureError::NestedSampleBlock);
        }
    }
    if !saw_open || !saw_close || open_depth != 0 {
        return Err(SampleStructureError::MalformedDocument);
    }
    Ok(())
}

pub(crate) fn parse_sample_blocks(
    text: &str,
) -> Result<Vec<StructureSampleBlock>, SampleStructureError> {
    let lines = text_lines(text);
    let mut blocks = Vec::new();
    let mut seen = HashSet::new();
    let mut index = 0;

    while index < lines.len() {
        match classify_block_line(lines[index].content) {
            BlockLine::Other => index += 1,
            BlockLine::Close(BlockKind::Sample) => {
                return Err(SampleStructureError::UnexpectedSampleCloser)
            }
            BlockLine::Close(BlockKind::Meta) => {
                return Err(SampleStructureError::MalformedDocument)
            }
            BlockLine::Open(BlockKind::Meta) => {
                index = skip_closed_block(&lines, index + 1, META_END)?;
            }
            BlockLine::Open(BlockKind::Sample) => {
                index += 1;
                let block = parse_sample_block(&lines, &mut index)?;
                if !seen.insert((block.kind, block.number)) {
                    return Err(SampleStructureError::DuplicateSlot {
                        kind: block.kind,
                        number: block.number,
                    });
                }
                blocks.push(block);
            }
        }
    }

    Ok(blocks)
}

fn parse_sample_block(
    lines: &[TextLine<'_>],
    index: &mut usize,
) -> Result<StructureSampleBlock, SampleStructureError> {
    let mut slot_type = None;
    let mut slot_number = None;
    let mut path = None;
    let mut closed = false;

    while *index < lines.len() {
        match classify_block_line(lines[*index].content) {
            BlockLine::Open(_) => return Err(SampleStructureError::NestedSampleBlock),
            BlockLine::Close(BlockKind::Sample) => {
                *index += 1;
                closed = true;
                break;
            }
            BlockLine::Close(BlockKind::Meta) => {
                return Err(SampleStructureError::MalformedDocument)
            }
            BlockLine::Other => {
                let line = &lines[*index];
                if let Some(value) = field_value(line.content, "TYPE") {
                    if slot_type.is_some() {
                        return Err(SampleStructureError::DuplicateField);
                    }
                    slot_type = Some(parse_slot_kind(value)?);
                } else if let Some(value) = field_value(line.content, "SLOT") {
                    if slot_number.is_some() {
                        return Err(SampleStructureError::DuplicateField);
                    }
                    slot_number = Some(parse_slot_number(value)?);
                } else if let Some(value) = field_value(line.content, "PATH") {
                    if path.is_some() {
                        return Err(SampleStructureError::DuplicatePathLine);
                    }
                    ensure_safe_raw_path(value)?;
                    let value_start = line.content_start + line.content.len() - value.len();
                    let value_end = line.content_start + line.content.len();
                    path = Some((value_start..value_end, value.to_owned()));
                }
                *index += 1;
            }
        }
    }

    if !closed {
        return Err(SampleStructureError::UnclosedSampleBlock);
    }

    let kind = slot_type.ok_or(SampleStructureError::MissingType)?;
    let number = slot_number.ok_or(SampleStructureError::MissingSlot)?;
    let (path_range, raw_path) = path.ok_or(SampleStructureError::MissingPath)?;
    Ok(StructureSampleBlock {
        kind,
        number,
        raw_path,
        path_range,
    })
}

fn skip_closed_block(
    lines: &[TextLine<'_>],
    start: usize,
    end_marker: &str,
) -> Result<usize, SampleStructureError> {
    let mut index = start;
    while index < lines.len() {
        if lines[index].content == end_marker {
            return Ok(index + 1);
        }
        index += 1;
    }
    Err(SampleStructureError::MalformedDocument)
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum BlockKind {
    Meta,
    Sample,
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
    content_start: usize,
}

fn text_lines(text: &str) -> Vec<TextLine<'_>> {
    let mut lines = Vec::new();
    let mut pos = 0;
    while pos < text.len() {
        let rest = &text[pos..];
        let step = rest.find('\n').map(|index| index + 1).unwrap_or(rest.len());
        let content = rest[..step].trim_end_matches(['\r', '\n']);
        lines.push(TextLine {
            content,
            content_start: pos,
        });
        pos += step;
        if step == rest.len() {
            break;
        }
    }
    lines
}

pub(crate) fn field_value<'a>(line: &'a str, key: &str) -> Option<&'a str> {
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

fn parse_slot_kind(value: &str) -> Result<SampleSlotKind, SampleStructureError> {
    if value.eq_ignore_ascii_case("STATIC") {
        Ok(SampleSlotKind::Static)
    } else if value.eq_ignore_ascii_case("FLEX") {
        Ok(SampleSlotKind::Flex)
    } else {
        Err(SampleStructureError::UnsupportedSlotType)
    }
}

fn parse_slot_number(value: &str) -> Result<u16, SampleStructureError> {
    if value.is_empty() || !value.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err(SampleStructureError::InvalidSlot);
    }
    let number = value
        .parse::<u16>()
        .map_err(|_| SampleStructureError::InvalidSlot)?;
    if number == 0 {
        return Err(SampleStructureError::InvalidSlot);
    }
    Ok(number)
}

fn ensure_safe_raw_path(path: &str) -> Result<(), SampleStructureError> {
    if path.is_empty() {
        return Ok(());
    }
    if path.contains('\0')
        || path.contains('\n')
        || path.contains('\r')
        || path.contains(SAMPLE_START)
        || path.contains(SAMPLE_END)
    {
        return Err(SampleStructureError::UnsafePathText);
    }
    Ok(())
}

pub(crate) fn slot_kind_token(kind: SampleSlotKind) -> &'static str {
    match kind {
        SampleSlotKind::Static => "STATIC",
        SampleSlotKind::Flex => "FLEX",
    }
}
