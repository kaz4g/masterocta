//! Read-only Pattern Copy preview IPC (`MO-PSE-PATTERN-COPY-PREVIEW-UI-1`).
//!
//! Resolves a registered root, reads Working Bank documents, and returns a
//! preview DTO. It does not write, authorize Apply, or accept a Bank file name
//! from the caller.

use crate::bank_validation::bank_parse_status;
use crate::legacy_read_adapter::resolve_relative_for_read;
use crate::pattern_copy_preview::{plan_pattern_copy_preview, project_pattern_copy_in_memory};
use crate::project_structure_command::{read_project_structure_dto, ProjectStructureReadError};
use crate::project_structure_reader::read_contained_state_document_bytes;
use crate::root_registry::RootRegistry;
use ot_domain::bank_state_documents::bank_state_document_file_name;
use ot_domain::project_structure::{BankIndex, PartIndex, PatternIndex, UnmodeledDependency};
use ot_domain::{RootId, RootRelativePath, StateDocumentRole};
use ot_plan::pattern_copy_preview::{
    finalize_pattern_copy_preview, ModeScope, PartAssignmentMode, PatternCopyBlocker,
    PatternCopyIntent, PatternCopyPreview, PatternCopyScope, PreviewObservation, TrackCopyMode,
    PATTERN_COPY_PREVIEW_SCHEMA,
};
use ot_storage_ports::StorageError;
use ot_tools_io::{BankFile, OctatrackFileIO};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::path::Path;

/// Allocation cap for one Bank document. Larger files are not decoded.
const BANK_PREVIEW_MAX_BYTES: usize = 2 * 1024 * 1024;

#[derive(Clone, Debug)]
pub(crate) struct PatternCopyPreviewArgs {
    pub root_id: RootId,
    pub project_relative_path: RootRelativePath,
    pub source_bank: u8,
    pub source_pattern: u8,
    pub destination_bank: u8,
    pub destination_pattern: u8,
    pub source_role: String,
    pub destination_role: String,
    pub track_mode: String,
    pub mode_scope: String,
    pub specific_tracks: Vec<u8>,
    pub part_assignment_mode: String,
    pub specific_part: Option<u8>,
}

#[derive(Debug)]
pub(crate) enum PatternCopyPreviewError {
    Read(ProjectStructureReadError),
    Invalid(&'static str, &'static str),
}

impl PatternCopyPreviewError {
    pub(crate) fn code(&self) -> &'static str {
        match self {
            Self::Read(error) => error.code(),
            Self::Invalid(code, _) => code,
        }
    }

    pub(crate) fn message(&self) -> String {
        match self {
            Self::Read(error) => error.message(),
            Self::Invalid(_, message) => (*message).to_owned(),
        }
    }

    pub(crate) fn recoverable(&self) -> bool {
        match self {
            Self::Read(error) => error.recoverable(),
            Self::Invalid(_, _) => true,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PatternCopyObservationDto {
    pub compared: bool,
    pub differs: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PatternCopyTrackEffectDto {
    pub track_number: u8,
    pub in_copy_scope: bool,
    pub content_differs: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PatternCopySampleObservationDto {
    pub track_number: u8,
    pub step: Option<u8>,
    /// Classification text from the preview engine. Not a media-existence check.
    pub summary: String,
    pub classified: bool,
    /// Always false. A preview never confirms that a sample file exists.
    pub confirmed_on_media: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PatternCopyPreviewDto {
    pub schema: &'static str,
    pub status: String,
    pub apply_authorized: bool,
    pub project_relative_path: String,
    pub source_bank: u8,
    pub source_pattern: u8,
    pub destination_bank: u8,
    pub destination_pattern: u8,
    pub source_role: String,
    pub destination_role: String,
    pub track_mode: String,
    pub mode_scope: String,
    pub part_assignment_mode: String,
    pub observed_document_digest: Option<String>,
    pub tracks: Vec<PatternCopyTrackEffectDto>,
    pub pattern_content: PatternCopyObservationDto,
    pub part_assignment: PatternCopyObservationDto,
    pub part_content_included: bool,
    pub preserved_destination_fields: Vec<String>,
    pub sample_references: Vec<PatternCopySampleObservationDto>,
    pub unmodeled_dependencies: Vec<String>,
    pub blockers: Vec<String>,
}

#[derive(Clone, Eq, PartialEq)]
struct DocumentSnapshot {
    project_work: Option<Vec<u8>>,
    source: Option<Vec<u8>>,
    destination: Option<Vec<u8>>,
}

#[cfg(test)]
thread_local! {
    static BETWEEN_PREVIEW_READS: std::cell::RefCell<Option<Box<dyn FnOnce()>>> =
        std::cell::RefCell::new(None);
}

fn run_between_preview_reads() {
    #[cfg(test)]
    BETWEEN_PREVIEW_READS.with(|slot| {
        if let Some(hook) = slot.borrow_mut().take() {
            hook();
        }
    });
}

pub(crate) fn read_pattern_copy_preview(
    registry: &RootRegistry,
    args: PatternCopyPreviewArgs,
) -> Result<PatternCopyPreviewDto, PatternCopyPreviewError> {
    let intent = parse_intent(&args)?;
    let resolved = registry
        .resolve(&intent.root_id)
        .map_err(ProjectStructureReadError::Root)
        .map_err(PatternCopyPreviewError::Read)?;
    let structure_before =
        read_project_structure_dto(registry, &intent.root_id, &intent.project_relative_path)
            .map_err(PatternCopyPreviewError::Read)?;

    let structural = ot_plan::pattern_copy_preview::validate_pattern_copy_intent(&intent);
    if !structural.is_empty() {
        return Ok(blocked_identity(&intent, structural));
    }

    let source_name = bank_file_name(intent.source_bank, intent.source_role)?;
    let destination_name = bank_file_name(intent.destination_bank, intent.destination_role)?;
    ensure_regular_bank_file(
        &resolved.canonical_path,
        &intent.project_relative_path,
        &source_name,
    )?;
    if destination_name != source_name {
        ensure_regular_bank_file(
            &resolved.canonical_path,
            &intent.project_relative_path,
            &destination_name,
        )?;
    }

    let before = read_snapshot(
        &resolved.canonical_path,
        &intent.project_relative_path,
        &source_name,
        &destination_name,
    )?;
    run_between_preview_reads();
    let after = read_snapshot(
        &resolved.canonical_path,
        &intent.project_relative_path,
        &source_name,
        &destination_name,
    )?;
    let structure_after =
        read_project_structure_dto(registry, &intent.root_id, &intent.project_relative_path)
            .map_err(PatternCopyPreviewError::Read)?;

    if before != after || structure_before != structure_after {
        return Ok(blocked_identity(
            &intent,
            vec![PatternCopyBlocker::DocumentChangedDuringRead],
        ));
    }

    let master = structure_before
        .project_state
        .as_ref()
        .and_then(|state| state.master_track);
    Ok(preview_from_consistent_read(&intent, &before, master))
}

fn parse_intent(
    args: &PatternCopyPreviewArgs,
) -> Result<PatternCopyIntent, PatternCopyPreviewError> {
    let source_bank = BankIndex::new(args.source_bank).map_err(|_| {
        PatternCopyPreviewError::Invalid("INVALID_BANK_INDEX", "source bank is outside 0..=15")
    })?;
    let destination_bank = BankIndex::new(args.destination_bank).map_err(|_| {
        PatternCopyPreviewError::Invalid("INVALID_BANK_INDEX", "destination bank is outside 0..=15")
    })?;
    let source_pattern = PatternIndex::new(args.source_pattern).map_err(|_| {
        PatternCopyPreviewError::Invalid(
            "INVALID_PATTERN_INDEX",
            "source pattern is outside 0..=15",
        )
    })?;
    let destination_pattern = PatternIndex::new(args.destination_pattern).map_err(|_| {
        PatternCopyPreviewError::Invalid(
            "INVALID_PATTERN_INDEX",
            "destination pattern is outside 0..=15",
        )
    })?;
    Ok(PatternCopyIntent {
        root_id: args.root_id.clone(),
        project_relative_path: args.project_relative_path.clone(),
        scope: PatternCopyScope::SinglePairSameProject,
        source_bank,
        source_pattern,
        source_role: parse_role(&args.source_role)?,
        destination_bank,
        destination_pattern,
        destination_role: parse_role(&args.destination_role)?,
        part_assignment: parse_part_assignment(&args.part_assignment_mode, args.specific_part)?,
        track_mode: parse_track_mode(&args.track_mode)?,
        mode_scope: parse_mode_scope(&args.mode_scope)?,
        specific_tracks: args.specific_tracks.clone(),
        include_part_body_copy: false,
        observed_revision: 0,
    })
}

fn parse_role(value: &str) -> Result<StateDocumentRole, PatternCopyPreviewError> {
    match value {
        "working" => Ok(StateDocumentRole::Working),
        "savedCheckpoint" => Ok(StateDocumentRole::SavedCheckpoint),
        _ => Err(PatternCopyPreviewError::Invalid(
            "INVALID_DOCUMENT_ROLE",
            "document role must be working or savedCheckpoint",
        )),
    }
}

fn parse_track_mode(value: &str) -> Result<TrackCopyMode, PatternCopyPreviewError> {
    match value {
        "all" => Ok(TrackCopyMode::All),
        "specific" => Ok(TrackCopyMode::Specific),
        _ => Err(PatternCopyPreviewError::Invalid(
            "INVALID_TRACK_MODE",
            "track mode must be all or specific",
        )),
    }
}

fn parse_mode_scope(value: &str) -> Result<ModeScope, PatternCopyPreviewError> {
    match value {
        "audio" => Ok(ModeScope::Audio),
        "midi" => Ok(ModeScope::Midi),
        "both" => Ok(ModeScope::Both),
        _ => Err(PatternCopyPreviewError::Invalid(
            "INVALID_MODE_SCOPE",
            "mode scope must be audio, midi, or both",
        )),
    }
}

fn parse_part_assignment(
    mode: &str,
    specific_part: Option<u8>,
) -> Result<PartAssignmentMode, PatternCopyPreviewError> {
    match mode {
        "keepOriginal" => Ok(PartAssignmentMode::KeepOriginal),
        "copySourcePartAssignment" => Ok(PartAssignmentMode::CopySourcePartAssignment),
        "selectSpecific" => {
            let part = specific_part.ok_or(PatternCopyPreviewError::Invalid(
                "INVALID_PART_INDEX",
                "selectSpecific requires a part index",
            ))?;
            let index = PartIndex::new(part).map_err(|_| {
                PatternCopyPreviewError::Invalid("INVALID_PART_INDEX", "part is outside 0..=3")
            })?;
            Ok(PartAssignmentMode::SelectSpecific(index))
        }
        _ => Err(PatternCopyPreviewError::Invalid(
            "INVALID_PART_ASSIGNMENT",
            "part assignment mode is not supported",
        )),
    }
}

fn bank_file_name(
    bank: BankIndex,
    role: StateDocumentRole,
) -> Result<String, PatternCopyPreviewError> {
    let file_name = bank_state_document_file_name(bank, role);
    if file_name.contains('/') || file_name.contains('\\') || file_name.contains('\0') {
        return Err(PatternCopyPreviewError::Invalid(
            "INVALID_BANK_FILE",
            "generated bank file name is not a single component",
        ));
    }
    Ok(file_name)
}

fn ensure_regular_bank_file(
    canonical_root: &Path,
    project_relative_path: &RootRelativePath,
    file_name: &str,
) -> Result<(), PatternCopyPreviewError> {
    let project = resolve_relative_for_read(canonical_root, project_relative_path)
        .map_err(map_storage)
        .map_err(PatternCopyPreviewError::Read)?;
    let path = project.join(file_name);
    match std::fs::symlink_metadata(&path) {
        Ok(metadata) if metadata.file_type().is_symlink() => Err(read_storage(
            "SYMLINK_ESCAPE: bank state document is a symlink",
        )),
        Ok(metadata) if !metadata.file_type().is_file() => Err(read_storage(
            "PROJECT_STRUCTURE_UNAVAILABLE: bank state document is not a regular file",
        )),
        Ok(_) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(read_storage(&format!(
            "PROJECT_STRUCTURE_UNAVAILABLE: {error}"
        ))),
    }
}

fn read_storage(message: &str) -> PatternCopyPreviewError {
    PatternCopyPreviewError::Read(ProjectStructureReadError::Storage(StorageError::new(
        message,
    )))
}

fn map_storage(error: StorageError) -> ProjectStructureReadError {
    if error.message().starts_with("ROOT_REMOVED") {
        ProjectStructureReadError::InvalidProjectPath
    } else {
        ProjectStructureReadError::Storage(error)
    }
}

fn read_snapshot(
    canonical_root: &Path,
    project_relative_path: &RootRelativePath,
    source_name: &str,
    destination_name: &str,
) -> Result<DocumentSnapshot, PatternCopyPreviewError> {
    let project_work =
        read_contained_state_document_bytes(canonical_root, project_relative_path, "project.work")
            .map_err(map_storage)
            .map_err(PatternCopyPreviewError::Read)?;
    let source =
        read_contained_state_document_bytes(canonical_root, project_relative_path, source_name)
            .map_err(map_storage)
            .map_err(PatternCopyPreviewError::Read)?;
    let destination = if destination_name == source_name {
        source.clone()
    } else {
        read_contained_state_document_bytes(canonical_root, project_relative_path, destination_name)
            .map_err(map_storage)
            .map_err(PatternCopyPreviewError::Read)?
    };
    Ok(DocumentSnapshot {
        project_work,
        source,
        destination,
    })
}

fn preview_from_consistent_read(
    intent: &PatternCopyIntent,
    snapshot: &DocumentSnapshot,
    master_track: Option<bool>,
) -> PatternCopyPreviewDto {
    let mut blockers = Vec::new();
    let Some(master_track) = master_track else {
        blockers.push(PatternCopyBlocker::MasterTrackSettingUnavailable);
        return blocked_identity(intent, blockers);
    };
    let source = match classified_bank(&snapshot.source, true, &mut blockers) {
        Some(bank) => bank,
        None => return blocked_identity(intent, blockers),
    };
    let destination = match classified_bank(&snapshot.destination, false, &mut blockers) {
        Some(bank) => bank,
        None => return blocked_identity(intent, blockers),
    };
    if !blockers.is_empty() {
        return blocked_identity(intent, blockers);
    }
    let source_parse = bank_parse_status(&source);
    let destination_parse = bank_parse_status(&destination);
    let preview = plan_pattern_copy_preview(
        intent,
        &source,
        &destination,
        source_parse,
        destination_parse,
        master_track,
    );
    let compared = preview.pattern_content_change == PreviewObservation::Observed;
    let (tracks, pattern_differs, part_differs) = if compared {
        projection_effects(intent, &source, &destination)
    } else {
        (Vec::new(), false, false)
    };
    dto_from_preview(
        intent,
        &preview,
        Some(document_digest(snapshot)),
        tracks,
        compared,
        pattern_differs,
        part_differs,
    )
}

fn classified_bank(
    bytes: &Option<Vec<u8>>,
    source: bool,
    blockers: &mut Vec<PatternCopyBlocker>,
) -> Option<BankFile> {
    let Some(bytes) = bytes else {
        blockers.push(if source {
            PatternCopyBlocker::SourceDocumentUnavailable
        } else {
            PatternCopyBlocker::DestinationDocumentUnavailable
        });
        return None;
    };
    if bytes.is_empty() || bytes.len() > BANK_PREVIEW_MAX_BYTES {
        blockers.push(PatternCopyBlocker::DocumentMalformed);
        return None;
    }
    match BankFile::from_bytes(bytes) {
        Ok(bank) => Some(bank),
        Err(_) => {
            blockers.push(PatternCopyBlocker::DocumentMalformed);
            None
        }
    }
}

fn projection_effects(
    intent: &PatternCopyIntent,
    source: &BankFile,
    destination: &BankFile,
) -> (Vec<PatternCopyTrackEffectDto>, bool, bool) {
    let Ok(projected) = project_pattern_copy_in_memory(source, destination, intent) else {
        return (Vec::new(), false, false);
    };
    let dst_idx = usize::from(intent.destination_pattern.get());
    let (Some(before), Some(after)) = (
        destination.patterns.0.get(dst_idx),
        projected.patterns.0.get(dst_idx),
    ) else {
        return (Vec::new(), false, false);
    };
    let tracks: Vec<_> = (0..16u8)
        .map(|track| {
            let in_copy_scope = track_in_scope(intent, track);
            let content_differs = if track < 8 {
                before.audio_track_trigs.0[usize::from(track)]
                    != after.audio_track_trigs.0[usize::from(track)]
            } else {
                let midi = usize::from(track - 8);
                before.midi_track_trigs.0[midi] != after.midi_track_trigs.0[midi]
            };
            PatternCopyTrackEffectDto {
                track_number: track,
                in_copy_scope,
                content_differs,
            }
        })
        .collect();
    let mut before_body = before.clone();
    let mut after_body = after.clone();
    before_body.part_assignment = 0;
    after_body.part_assignment = 0;
    (
        tracks,
        before_body != after_body,
        before.part_assignment != after.part_assignment,
    )
}

fn track_in_scope(intent: &PatternCopyIntent, track: u8) -> bool {
    match intent.track_mode {
        TrackCopyMode::All => match intent.mode_scope {
            ModeScope::Audio => track < 8,
            ModeScope::Midi => track >= 8,
            ModeScope::Both => true,
        },
        TrackCopyMode::Specific => intent.specific_tracks.contains(&track),
    }
}

fn blocked_identity(
    intent: &PatternCopyIntent,
    blockers: Vec<PatternCopyBlocker>,
) -> PatternCopyPreviewDto {
    let preview = finalize_pattern_copy_preview(
        intent,
        blockers,
        PreviewObservation::Unknown,
        PreviewObservation::Unknown,
        Vec::new(),
        Vec::new(),
        Vec::new(),
    );
    dto_from_preview(intent, &preview, None, Vec::new(), false, false, false)
}

fn dto_from_preview(
    intent: &PatternCopyIntent,
    preview: &PatternCopyPreview,
    digest: Option<String>,
    tracks: Vec<PatternCopyTrackEffectDto>,
    pattern_compared: bool,
    pattern_differs: bool,
    part_differs: bool,
) -> PatternCopyPreviewDto {
    let mut preserved = preview.preserved_destination_fields.clone();
    if !preserved
        .iter()
        .any(|field| field == "destination_part_bodies")
    {
        preserved.push("destination_part_bodies".to_owned());
    }
    if matches!(intent.part_assignment, PartAssignmentMode::KeepOriginal)
        && !preserved
            .iter()
            .any(|field| field == "destination_part_assignment")
    {
        preserved.push("destination_part_assignment".to_owned());
    }
    preserved.sort();
    preserved.dedup();
    let status = match preview.status {
        ot_plan::pattern_copy_preview::PatternCopyPreviewStatus::Ready => "ready",
        ot_plan::pattern_copy_preview::PatternCopyPreviewStatus::Blocked => "blocked",
    };
    PatternCopyPreviewDto {
        schema: PATTERN_COPY_PREVIEW_SCHEMA,
        status: status.to_owned(),
        apply_authorized: false,
        project_relative_path: intent.project_relative_path.as_str().to_owned(),
        source_bank: intent.source_bank.get(),
        source_pattern: intent.source_pattern.get(),
        destination_bank: intent.destination_bank.get(),
        destination_pattern: intent.destination_pattern.get(),
        source_role: role_name(intent.source_role).to_owned(),
        destination_role: role_name(intent.destination_role).to_owned(),
        track_mode: track_mode_name(intent.track_mode).to_owned(),
        mode_scope: mode_scope_name(intent.mode_scope).to_owned(),
        part_assignment_mode: part_mode_name(intent.part_assignment).to_owned(),
        observed_document_digest: digest,
        tracks,
        pattern_content: PatternCopyObservationDto {
            compared: pattern_compared,
            differs: pattern_differs,
        },
        part_assignment: PatternCopyObservationDto {
            compared: pattern_compared,
            differs: part_differs,
        },
        part_content_included: false,
        preserved_destination_fields: preserved,
        sample_references: preview
            .affected_sample_references
            .iter()
            .map(|reference| PatternCopySampleObservationDto {
                track_number: reference.track_number,
                step: reference.step,
                classified: !reference.summary.contains("Unrecognized"),
                confirmed_on_media: false,
                summary: reference.summary.clone(),
            })
            .collect(),
        unmodeled_dependencies: preview
            .unmodeled_dependencies
            .iter()
            .map(unmodeled_name)
            .map(str::to_owned)
            .collect(),
        blockers: preview.blockers.iter().map(blocker_code).collect(),
    }
}

fn document_digest(snapshot: &DocumentSnapshot) -> String {
    let mut hasher = Sha256::new();
    for bytes in [
        &snapshot.project_work,
        &snapshot.source,
        &snapshot.destination,
    ] {
        match bytes {
            Some(bytes) => {
                hasher.update((bytes.len() as u64).to_le_bytes());
                hasher.update(bytes);
            }
            None => hasher.update([0xff]),
        }
    }
    format!("{:x}", hasher.finalize())
}

fn role_name(role: StateDocumentRole) -> &'static str {
    match role {
        StateDocumentRole::Working => "working",
        StateDocumentRole::SavedCheckpoint => "savedCheckpoint",
    }
}

fn track_mode_name(mode: TrackCopyMode) -> &'static str {
    match mode {
        TrackCopyMode::All => "all",
        TrackCopyMode::Specific => "specific",
    }
}

fn mode_scope_name(scope: ModeScope) -> &'static str {
    match scope {
        ModeScope::Audio => "audio",
        ModeScope::Midi => "midi",
        ModeScope::Both => "both",
    }
}

fn part_mode_name(mode: PartAssignmentMode) -> &'static str {
    match mode {
        PartAssignmentMode::KeepOriginal => "keepOriginal",
        PartAssignmentMode::CopySourcePartAssignment => "copySourcePartAssignment",
        PartAssignmentMode::SelectSpecific(_) => "selectSpecific",
    }
}

fn unmodeled_name(dependency: &UnmodeledDependency) -> &'static str {
    match dependency {
        UnmodeledDependency::Scenes => "scenes",
        UnmodeledDependency::Arrangements => "arrangements",
        UnmodeledDependency::RecorderSetup => "recorderSetup",
    }
}

fn blocker_code(blocker: &PatternCopyBlocker) -> String {
    match blocker {
        PatternCopyBlocker::UnsupportedScope => "unsupportedScope".to_owned(),
        PatternCopyBlocker::CrossProjectNotSupported => "crossProjectNotSupported".to_owned(),
        PatternCopyBlocker::MultiPairNotSupported => "multiPairNotSupported".to_owned(),
        PatternCopyBlocker::MoveOrSwapNotSupported => "moveOrSwapNotSupported".to_owned(),
        PatternCopyBlocker::PartBodyCopyRequested => "partBodyCopyRequested".to_owned(),
        PatternCopyBlocker::CrossRoleCopySemanticsUnknown => {
            "crossRoleCopySemanticsUnknown".to_owned()
        }
        PatternCopyBlocker::WorkingSavedCheckpointRuleUnresolved => {
            "workingSavedCheckpointRuleUnresolved".to_owned()
        }
        PatternCopyBlocker::SourceEqualsDestinationPattern => {
            "sourceEqualsDestinationPattern".to_owned()
        }
        PatternCopyBlocker::InvalidTrackSelection => "invalidTrackSelection".to_owned(),
        PatternCopyBlocker::SpecificTracksRequired => "specificTracksRequired".to_owned(),
        PatternCopyBlocker::TrackIndicesOutOfRange => "trackIndicesOutOfRange".to_owned(),
        PatternCopyBlocker::SourceDocumentUnavailable => "sourceDocumentUnavailable".to_owned(),
        PatternCopyBlocker::DestinationDocumentUnavailable => {
            "destinationDocumentUnavailable".to_owned()
        }
        PatternCopyBlocker::DocumentMalformed => "documentMalformed".to_owned(),
        PatternCopyBlocker::DocumentUnsupportedVersion => "documentUnsupportedVersion".to_owned(),
        PatternCopyBlocker::UnresolvedSampleReference => "unresolvedSampleReference".to_owned(),
        PatternCopyBlocker::MasterTrackSettingUnavailable => {
            "masterTrackSettingUnavailable".to_owned()
        }
        PatternCopyBlocker::DocumentChangedDuringRead => "documentChangedDuringRead".to_owned(),
        PatternCopyBlocker::UnmodeledDependency(dependency) => {
            format!("unmodeled:{}", unmodeled_name(dependency))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::root_registry::{DeviceIdentityProvider, DeviceObservation, RootRegistryError};
    use ot_domain::RootId;
    use ot_tools_io::OctatrackFileIO;
    use sha2::{Digest, Sha256};
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::sync::Arc;
    use std::time::Duration;
    use tempfile::TempDir;

    struct HookGuard;
    impl Drop for HookGuard {
        fn drop(&mut self) {
            BETWEEN_PREVIEW_READS.with(|slot| {
                slot.borrow_mut().take();
            });
        }
    }

    struct Stable;
    impl DeviceIdentityProvider for Stable {
        fn observe(&self, _root: &Path) -> Result<DeviceObservation, RootRegistryError> {
            Ok(DeviceObservation {
                stable_key: "pattern-copy-preview".into(),
                filesystem_type: Some("apfs".into()),
                total_capacity: Some(1024),
                mount_token: "test-mount".into(),
                stable: true,
            })
        }
    }

    fn fixture(name: &str) -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures")
            .join(name)
    }

    fn digest(path: &Path) -> String {
        format!("{:x}", Sha256::digest(fs::read(path).unwrap()))
    }

    fn preview_args(
        root_id: RootId,
        source_bank: u8,
        source_pattern: u8,
        destination_bank: u8,
        destination_pattern: u8,
    ) -> PatternCopyPreviewArgs {
        PatternCopyPreviewArgs {
            root_id,
            project_relative_path: RootRelativePath::parse("SET/PROJECT").unwrap(),
            source_bank,
            source_pattern,
            destination_bank,
            destination_pattern,
            source_role: "working".to_owned(),
            destination_role: "working".to_owned(),
            track_mode: "all".to_owned(),
            mode_scope: "both".to_owned(),
            specific_tracks: Vec::new(),
            part_assignment_mode: "keepOriginal".to_owned(),
            specific_part: None,
        }
    }

    fn registered(mutate: impl FnOnce(&Path)) -> (TempDir, RootRegistry, RootId) {
        let temp = TempDir::new().unwrap();
        let project = temp.path().join("SET/PROJECT");
        fs::create_dir_all(&project).unwrap();
        for name in ["project.work", "bank01.work", "bank01.strd"] {
            fs::copy(fixture("real_device").join(name), project.join(name)).unwrap();
        }
        mutate(&project);
        let registry = RootRegistry::new(Arc::new(Stable), Duration::from_secs(60));
        let session = registry.register(temp.path().to_str().unwrap()).unwrap();
        (temp, registry, session.root_id)
    }

    fn set_master(project: &Path, enabled: bool) {
        let path = project.join("project.work");
        let mut parsed = ot_tools_io::ProjectFile::from_data_file(&path).unwrap();
        parsed.settings.control.audio.master_track = enabled;
        parsed.to_data_file(&path).unwrap();
    }

    fn plant_track_eight_static(project: &Path) {
        let path = project.join("bank01.work");
        let mut bank = BankFile::from_bytes(&fs::read(&path).unwrap()).unwrap();
        let part_idx = bank.patterns.0[0].part_assignment as usize;
        let part = &mut bank.parts.unsaved.0[part_idx];
        part.audio_track_machine_types[7] = 0;
        part.audio_track_machine_slots[7].static_slot_id = 0;
        part.audio_track_machine_slots[7].flex_slot_id = 255;
        bank.to_data_file(&path).unwrap();
    }

    #[test]
    fn a01_to_a05_preview_separates_scope_from_content_diff() {
        let _guard = HookGuard;
        let (_temp, registry, root_id) = registered(|_| {});
        let mut args = preview_args(root_id, 0, 0, 0, 4);
        args.mode_scope = "audio".to_owned();
        let dto = read_pattern_copy_preview(&registry, args).unwrap();
        assert_eq!(dto.status, "ready");
        assert!(!dto.apply_authorized);
        assert!(!dto.part_content_included);
        assert!(dto.pattern_content.compared);
        assert!(dto
            .preserved_destination_fields
            .iter()
            .any(|field| field == "destination_part_bodies"));
        assert!(dto
            .preserved_destination_fields
            .iter()
            .any(|field| field == "destination_part_assignment"));
        assert!(dto
            .tracks
            .iter()
            .filter(|track| track.track_number < 8)
            .all(|track| track.in_copy_scope));
        assert!(dto
            .tracks
            .iter()
            .filter(|track| track.track_number >= 8)
            .all(|track| { !track.in_copy_scope && !track.content_differs }));
        assert!(dto
            .unmodeled_dependencies
            .iter()
            .any(|name| name == "scenes"));
    }

    #[test]
    fn a01_to_b03_preview_uses_separate_bank_files() {
        let _guard = HookGuard;
        let (_temp, registry, root_id) = registered(|project| {
            fs::copy(project.join("bank01.work"), project.join("bank02.work")).unwrap();
        });
        let dto = read_pattern_copy_preview(&registry, preview_args(root_id, 0, 0, 1, 2)).unwrap();
        assert_eq!(dto.status, "ready");
        assert_eq!((dto.source_bank, dto.source_pattern), (0, 0));
        assert_eq!((dto.destination_bank, dto.destination_pattern), (1, 2));
        assert!(dto.tracks.iter().all(|track| track.in_copy_scope));
        assert!(dto.observed_document_digest.is_some());
    }

    #[test]
    fn static_and_flex_sample_locks_are_observations_not_confirmed_files() {
        let _guard = HookGuard;
        let (_temp, registry, root_id) = registered(|project| {
            set_master(project, true);
            let path = project.join("bank01.work");
            let mut bank = BankFile::from_bytes(&fs::read(&path).unwrap()).unwrap();
            let part_idx = bank.patterns.0[0].part_assignment as usize;
            let part = &mut bank.parts.unsaved.0[part_idx];
            part.audio_track_machine_types[0] = 0;
            part.audio_track_machine_types[1] = 1;
            let static_lock = &mut bank.patterns.0[0].audio_track_trigs.0[0].plocks.0[0];
            static_lock.static_slot_id = 0;
            static_lock.flex_slot_id = 255;
            let flex_lock = &mut bank.patterns.0[0].audio_track_trigs.0[1].plocks.0[0];
            flex_lock.static_slot_id = 255;
            flex_lock.flex_slot_id = 0;
            bank.to_data_file(&path).unwrap();
        });
        let dto = read_pattern_copy_preview(&registry, preview_args(root_id, 0, 0, 0, 4)).unwrap();
        assert!(dto
            .sample_references
            .iter()
            .any(|reference| reference.summary.contains("Static")));
        assert!(dto
            .sample_references
            .iter()
            .any(|reference| reference.summary.contains("Flex")));
        assert!(dto
            .sample_references
            .iter()
            .all(|reference| !reference.confirmed_on_media));
        assert!(!dto
            .blockers
            .iter()
            .any(|code| code == "unresolvedSampleReference"));
    }

    #[test]
    fn master_track_enabled_excludes_track_eight_sample_observation() {
        let _guard = HookGuard;
        let (_temp, registry, root_id) = registered(|project| {
            set_master(project, true);
            plant_track_eight_static(project);
        });
        let dto = read_pattern_copy_preview(&registry, preview_args(root_id, 0, 0, 0, 4)).unwrap();
        assert_eq!(dto.status, "ready");
        assert!(dto
            .sample_references
            .iter()
            .all(|reference| reference.track_number != 7));
    }

    #[test]
    fn master_track_disabled_can_observe_track_eight() {
        let _guard = HookGuard;
        let (_temp, registry, root_id) = registered(|project| {
            set_master(project, false);
            plant_track_eight_static(project);
        });
        let dto = read_pattern_copy_preview(&registry, preview_args(root_id, 0, 0, 0, 4)).unwrap();
        assert!(dto
            .sample_references
            .iter()
            .any(|reference| reference.track_number == 7));
        assert!(dto
            .sample_references
            .iter()
            .all(|reference| !reference.confirmed_on_media));
    }

    #[test]
    fn master_track_unknown_blocks_without_assuming_audio() {
        let _guard = HookGuard;
        let (_temp, registry, root_id) = registered(|project| {
            plant_track_eight_static(project);
            fs::remove_file(project.join("project.work")).unwrap();
        });
        let dto = read_pattern_copy_preview(&registry, preview_args(root_id, 0, 0, 0, 4)).unwrap();
        assert_eq!(dto.status, "blocked");
        assert!(dto
            .blockers
            .iter()
            .any(|code| code == "masterTrackSettingUnavailable"));
        assert!(dto.sample_references.is_empty());
        assert!(!dto.pattern_content.compared);
    }

    #[test]
    fn specific_track_out_of_range_is_blocked_before_projection() {
        let _guard = HookGuard;
        let (_temp, registry, root_id) = registered(|_| {});
        let mut args = preview_args(root_id, 0, 0, 0, 4);
        args.track_mode = "specific".to_owned();
        args.specific_tracks = vec![16];
        let dto = read_pattern_copy_preview(&registry, args).unwrap();
        assert_eq!(dto.status, "blocked");
        assert!(dto
            .blockers
            .iter()
            .any(|code| code == "trackIndicesOutOfRange"));
        assert!(dto.sample_references.is_empty());
        assert!(dto.observed_document_digest.is_none());
    }

    #[test]
    fn unknown_root_is_rejected() {
        let _guard = HookGuard;
        let (_temp, registry, _root_id) = registered(|_| {});
        let error = read_pattern_copy_preview(
            &registry,
            preview_args(RootId::new("missing-root").unwrap(), 0, 0, 0, 4),
        )
        .unwrap_err();
        assert_eq!(error.code(), "ROOT_NOT_APPROVED");
    }

    #[test]
    fn expired_root_is_rejected() {
        let _guard = HookGuard;
        let temp = TempDir::new().unwrap();
        let project = temp.path().join("SET/PROJECT");
        fs::create_dir_all(&project).unwrap();
        fs::copy(
            fixture("real_device").join("project.work"),
            project.join("project.work"),
        )
        .unwrap();
        fs::copy(
            fixture("real_device").join("bank01.work"),
            project.join("bank01.work"),
        )
        .unwrap();
        let registry = RootRegistry::new(Arc::new(Stable), Duration::ZERO);
        let session = registry.register(temp.path().to_str().unwrap()).unwrap();
        let error = read_pattern_copy_preview(&registry, preview_args(session.root_id, 0, 0, 0, 4))
            .unwrap_err();
        assert_eq!(error.code(), "ROOT_NOT_APPROVED");
    }

    #[test]
    fn project_path_escape_is_rejected() {
        let absolute =
            crate::v2_api::parse_project_relative_path("/tmp/project".to_owned()).unwrap_err();
        let traversal =
            crate::v2_api::parse_project_relative_path("../outside".to_owned()).unwrap_err();
        assert!(serde_json::to_string(&absolute)
            .unwrap()
            .contains("INVALID_PROJECT_PATH"));
        assert!(serde_json::to_string(&traversal)
            .unwrap()
            .contains("INVALID_PROJECT_PATH"));
    }

    #[test]
    fn symlinked_bank_file_is_rejected() {
        let _guard = HookGuard;
        let outside = TempDir::new().unwrap();
        let secret = outside.path().join("secret.work");
        fs::write(&secret, b"SECRET_BANK_BYTES").unwrap();
        let (_temp, registry, root_id) = registered(|project| {
            fs::remove_file(project.join("bank01.work")).unwrap();
            std::os::unix::fs::symlink(&secret, project.join("bank01.work")).unwrap();
        });
        let error =
            read_pattern_copy_preview(&registry, preview_args(root_id, 0, 0, 0, 4)).unwrap_err();
        assert_eq!(error.code(), "SYMLINK_ESCAPE");
        assert_eq!(fs::read(&secret).unwrap(), b"SECRET_BANK_BYTES");
    }

    #[test]
    fn symlinked_project_component_is_rejected() {
        let _guard = HookGuard;
        let temp = TempDir::new().unwrap();
        let real = temp.path().join("real-set");
        let project = real.join("PROJECT");
        fs::create_dir_all(&project).unwrap();
        fs::copy(
            fixture("real_device").join("project.work"),
            project.join("project.work"),
        )
        .unwrap();
        fs::copy(
            fixture("real_device").join("bank01.work"),
            project.join("bank01.work"),
        )
        .unwrap();
        std::os::unix::fs::symlink(&real, temp.path().join("SET")).unwrap();
        let registry = RootRegistry::new(Arc::new(Stable), Duration::from_secs(60));
        let session = registry.register(temp.path().to_str().unwrap()).unwrap();
        let error = read_pattern_copy_preview(&registry, preview_args(session.root_id, 0, 0, 0, 4))
            .unwrap_err();
        assert_eq!(error.code(), "SYMLINK_ESCAPE");
    }

    #[test]
    fn malformed_bank_is_blocked() {
        let _guard = HookGuard;
        let (_temp, registry, root_id) = registered(|project| {
            fs::write(project.join("bank01.work"), b"not a bank").unwrap();
        });
        let dto = read_pattern_copy_preview(&registry, preview_args(root_id, 0, 0, 0, 4)).unwrap();
        assert_eq!(dto.status, "blocked");
        assert!(dto.blockers.iter().any(|code| code == "documentMalformed"));
        assert!(dto.sample_references.is_empty());
    }

    #[test]
    fn unsupported_bank_version_is_blocked() {
        let _guard = HookGuard;
        let (_temp, registry, root_id) = registered(|project| {
            let path = project.join("bank01.work");
            let mut bank = BankFile::from_bytes(&fs::read(&path).unwrap()).unwrap();
            bank.datatype_version = 0;
            bank.to_data_file(&path).unwrap();
        });
        let dto = read_pattern_copy_preview(&registry, preview_args(root_id, 0, 0, 0, 4)).unwrap();
        assert_eq!(dto.status, "blocked");
        assert!(dto
            .blockers
            .iter()
            .any(|code| code == "documentUnsupportedVersion"));
        assert!(!dto.pattern_content.compared);
    }

    #[test]
    fn working_and_saved_checkpoint_mix_is_blocked_without_reading_strd() {
        let _guard = HookGuard;
        let outside = TempDir::new().unwrap();
        let secret = outside.path().join("secret.strd");
        fs::write(&secret, b"SECRET_STRD_BYTES").unwrap();
        let (_temp, registry, root_id) = registered(|project| {
            fs::remove_file(project.join("bank01.strd")).unwrap();
            std::os::unix::fs::symlink(&secret, project.join("bank01.strd")).unwrap();
        });
        let mut args = preview_args(root_id, 0, 0, 0, 4);
        args.destination_role = "savedCheckpoint".to_owned();
        let dto = read_pattern_copy_preview(&registry, args).unwrap();
        let json = serde_json::to_string(&dto).unwrap();
        assert_eq!(dto.status, "blocked");
        assert!(dto
            .blockers
            .iter()
            .any(|code| code == "crossRoleCopySemanticsUnknown"));
        assert!(dto
            .blockers
            .iter()
            .any(|code| code == "workingSavedCheckpointRuleUnresolved"));
        assert!(!json.contains("SECRET_STRD_BYTES"));
        assert_eq!(fs::read(&secret).unwrap(), b"SECRET_STRD_BYTES");
    }

    #[test]
    fn saved_checkpoint_pair_is_blocked() {
        let _guard = HookGuard;
        let (_temp, registry, root_id) = registered(|_| {});
        let mut args = preview_args(root_id, 0, 0, 0, 4);
        args.source_role = "savedCheckpoint".to_owned();
        args.destination_role = "savedCheckpoint".to_owned();
        let dto = read_pattern_copy_preview(&registry, args).unwrap();
        assert_eq!(dto.status, "blocked");
        assert!(dto
            .blockers
            .iter()
            .any(|code| code == "workingSavedCheckpointRuleUnresolved"));
        assert!(!dto
            .blockers
            .iter()
            .any(|code| code == "crossRoleCopySemanticsUnknown"));
    }

    #[test]
    fn same_pattern_is_blocked() {
        let _guard = HookGuard;
        let (_temp, registry, root_id) = registered(|_| {});
        let dto = read_pattern_copy_preview(&registry, preview_args(root_id, 0, 0, 0, 0)).unwrap();
        assert_eq!(dto.status, "blocked");
        assert!(dto
            .blockers
            .iter()
            .any(|code| code == "sourceEqualsDestinationPattern"));
    }

    #[test]
    fn document_change_during_read_discards_the_preview() {
        let _guard = HookGuard;
        let (temp, registry, root_id) = registered(|_| {});
        let bank = temp.path().join("SET/PROJECT/bank01.work");
        BETWEEN_PREVIEW_READS.with(|slot| {
            *slot.borrow_mut() = Some(Box::new(move || {
                let mut bytes = fs::read(&bank).unwrap();
                bytes[0] ^= 0x01;
                fs::write(&bank, bytes).unwrap();
            }));
        });
        let dto = read_pattern_copy_preview(&registry, preview_args(root_id, 0, 0, 0, 4)).unwrap();
        assert_eq!(dto.status, "blocked");
        assert!(dto
            .blockers
            .iter()
            .any(|code| code == "documentChangedDuringRead"));
        assert!(dto.observed_document_digest.is_none());
        assert!(dto.tracks.is_empty());
        assert!(dto.sample_references.is_empty());
        assert!(!dto.pattern_content.compared);
    }

    #[test]
    fn fixture_bytes_stay_unchanged_and_dto_has_no_absolute_path_or_raw_bank() {
        let _guard = HookGuard;
        let fixture_bank = fixture("real_device").join("bank01.work");
        let fixture_project = fixture("real_device").join("project.work");
        let before_bank = digest(&fixture_bank);
        let before_project = digest(&fixture_project);
        let (temp, registry, root_id) = registered(|_| {});
        let dto = read_pattern_copy_preview(&registry, preview_args(root_id, 0, 0, 0, 4)).unwrap();
        assert_eq!(digest(&fixture_bank), before_bank);
        assert_eq!(digest(&fixture_project), before_project);
        let json = serde_json::to_string(&dto).unwrap();
        let canonical = temp.path().canonicalize().unwrap();
        assert!(!json.contains(canonical.to_str().unwrap()));
        assert!(json.len() < fs::metadata(&fixture_bank).unwrap().len() as usize);
        assert!(!dto.apply_authorized);
        assert!(json.contains("\"applyAuthorized\":false"));
        assert!(dto
            .sample_references
            .iter()
            .all(|reference| !reference.confirmed_on_media));
    }

    #[test]
    fn preview_command_source_has_no_write_api() {
        let source = include_str!("pattern_copy_preview_command.rs");
        let production = source.split("mod tests {").next().unwrap();
        assert!(!production.contains("to_data_file"));
        assert!(!production.contains("copy_patterns"));
        assert!(!production.contains("fs::write"));
        assert!(!production.contains("File::create"));
    }
}
