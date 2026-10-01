//! DTO boundary for `v2_project_structure_read` (`MO-PSE-READ-MODEL-2`).
//!
//! Resolves a registered root and maps the B1 read model. Paths in the DTO are
//! root-relative. Malformed and unsupported Banks expose no Pattern or Part
//! values. This module does not write.

use crate::device_detection::is_octatrack_project;
use crate::project_structure_reader::read_project_structure;
use crate::root_registry::{ResolvedRoot, RootRegistry, RootRegistryError};
use ot_domain::project_structure::{
    BankStructure, MachineKind, PartStructure, PatternMasterLength, PatternPlaybackScale,
    PatternScale, PatternStructure, ProjectArrangementSelection, ProjectBankSelection,
    ProjectPatternSelection, ProjectStateDocument, ProjectStructure, TrackPlayback,
    TrackSlotReference, TrackStructure, UnmodeledDependency,
};
use ot_domain::{
    RootId, RootRelativePath, SampleSlotKind, StateDocumentParseStatus, StateDocumentRole,
};
use ot_storage_ports::StorageError;
use serde::Serialize;

/// Payload discriminator for this DTO. `v3` adds Track 8's master role,
/// pattern scale mode, per-track scale, and finite/infinite master length.
/// `v2` is not extended in place. Arranger rows are still absent.
pub(crate) const PROJECT_STRUCTURE_SCHEMA: &str = "masterocta.project-structure:v3";

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProjectStructureDto {
    pub(crate) schema: &'static str,
    pub(crate) project_relative_path: String,
    pub(crate) project_state: Option<ProjectStateDto>,
    pub(crate) banks: Vec<BankStructureDto>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProjectStateDto {
    pub(crate) role: String,
    pub(crate) source_relative_path: String,
    pub(crate) parse_status: String,
    pub(crate) bank: Option<ProjectBankSelectionDto>,
    pub(crate) pattern: Option<ProjectPatternSelectionDto>,
    pub(crate) arrangement: Option<ProjectArrangementSelectionDto>,
    pub(crate) master_track: Option<bool>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub(crate) enum ProjectBankSelectionDto {
    Selected { index: u8 },
    Unrecognized { raw: u8 },
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub(crate) enum ProjectPatternSelectionDto {
    Selected { index: u8 },
    Unrecognized { raw: u8 },
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub(crate) enum ProjectArrangementSelectionDto {
    Unmapped { raw: u8 },
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BankStructureDto {
    pub(crate) index: u8,
    pub(crate) letter: String,
    pub(crate) role: String,
    pub(crate) source_relative_path: String,
    pub(crate) parse_status: String,
    pub(crate) patterns: Vec<PatternStructureDto>,
    pub(crate) parts: Vec<PartStructureDto>,
    pub(crate) unmodeled_dependencies: Vec<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PatternStructureDto {
    pub(crate) index: u8,
    pub(crate) part_index: u8,
    pub(crate) scale: PatternScaleDto,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub(crate) enum PatternScaleDto {
    Normal {
        master_length: u16,
        master_scale: PatternPlaybackScaleDto,
    },
    PerTrack {
        master_length: PatternMasterLengthDto,
        master_scale: PatternPlaybackScaleDto,
        tracks: Vec<TrackScaleDto>,
    },
    Unrecognized {
        raw: u8,
    },
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub(crate) enum PatternMasterLengthDto {
    Finite { steps: u16 },
    Infinite,
    Unrecognized { multiplier: u8, length: u8 },
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub(crate) enum PatternPlaybackScaleDto {
    Times2,
    Times3Over2,
    Times1,
    Times3Over4,
    Times1Over2,
    Times1Over4,
    Times1Over8,
    Unrecognized { raw: u8 },
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TrackScaleDto {
    pub(crate) track: u8,
    pub(crate) length: u8,
    pub(crate) scale: PatternPlaybackScaleDto,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PartStructureDto {
    pub(crate) index: u8,
    pub(crate) tracks: Vec<TrackStructureDto>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TrackStructureDto {
    pub(crate) index: u8,
    pub(crate) playback: TrackPlaybackDto,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub(crate) enum TrackPlaybackDto {
    Audio {
        machine: MachineKindDto,
        slot: TrackSlotReferenceDto,
    },
    Master,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub(crate) enum MachineKindDto {
    Static,
    Flex,
    Thru,
    Neighbor,
    Pickup,
    Unknown { raw: u8 },
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub(crate) enum TrackSlotReferenceDto {
    Slot { slot_kind: String, number: u16 },
    Unassigned,
    RecorderBuffer { buffer_number: u8 },
    NoSampleMachine,
    Unrecognized { raw: u8 },
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum ProjectStructureReadError {
    Root(RootRegistryError),
    InvalidProjectPath,
    Storage(StorageError),
}

impl ProjectStructureReadError {
    pub(crate) fn code(&self) -> &'static str {
        match self {
            Self::Root(error) => error.code(),
            Self::InvalidProjectPath => "INVALID_PROJECT_PATH",
            Self::Storage(error) => storage_code(error),
        }
    }

    pub(crate) fn message(&self) -> String {
        match self {
            Self::Root(error) => error.to_string(),
            Self::InvalidProjectPath => {
                "the project path must be an Octatrack project directory inside the registered root"
                    .to_owned()
            }
            Self::Storage(_) => {
                "the project structure could not be read inside the registered root".to_owned()
            }
        }
    }

    /// Registry unavailability stays unrecoverable. Path and storage failures
    /// remain recoverable because the caller can correct the request.
    pub(crate) fn recoverable(&self) -> bool {
        match self {
            Self::Root(error) => error.recoverable(),
            Self::InvalidProjectPath | Self::Storage(_) => true,
        }
    }
}

fn storage_code(error: &StorageError) -> &'static str {
    let message = error.message();
    if message.starts_with("PATH_ESCAPE") {
        "PATH_ESCAPE"
    } else if message.starts_with("SYMLINK_ESCAPE") {
        "SYMLINK_ESCAPE"
    } else {
        "PROJECT_STRUCTURE_UNAVAILABLE"
    }
}

/// `RootRegistry::resolve` has already shown the registered root exists.
/// A missing component inside that root is a bad project path.
fn map_storage(error: StorageError) -> ProjectStructureReadError {
    if error.message().starts_with("ROOT_REMOVED") {
        ProjectStructureReadError::InvalidProjectPath
    } else {
        ProjectStructureReadError::Storage(error)
    }
}

pub(crate) fn read_project_structure_dto(
    registry: &RootRegistry,
    root_id: &RootId,
    project_relative_path: &RootRelativePath,
) -> Result<ProjectStructureDto, ProjectStructureReadError> {
    let resolved = registry
        .resolve(root_id)
        .map_err(ProjectStructureReadError::Root)?;
    ensure_project_directory(&resolved, project_relative_path)?;
    let structure = read_project_structure(&resolved.canonical_path, project_relative_path)
        .map_err(map_storage)?;
    Ok(to_dto(structure))
}

fn ensure_project_directory(
    resolved: &ResolvedRoot,
    project_relative_path: &RootRelativePath,
) -> Result<(), ProjectStructureReadError> {
    let path = crate::legacy_read_adapter::resolve_relative_for_read(
        &resolved.canonical_path,
        project_relative_path,
    )
    .map_err(map_storage)?;
    if path.is_dir() && is_octatrack_project(&path) {
        Ok(())
    } else {
        Err(ProjectStructureReadError::InvalidProjectPath)
    }
}

fn to_dto(structure: ProjectStructure) -> ProjectStructureDto {
    ProjectStructureDto {
        schema: PROJECT_STRUCTURE_SCHEMA,
        project_relative_path: structure.project_relative_path.as_str().to_owned(),
        project_state: structure.project_state.map(project_state_dto),
        banks: structure.banks.into_iter().map(bank_dto).collect(),
    }
}

fn project_state_dto(state: ProjectStateDocument) -> ProjectStateDto {
    let parsed = state.parse_status == StateDocumentParseStatus::Parsed;
    ProjectStateDto {
        role: role_name(state.role).to_owned(),
        source_relative_path: state.source_relative_path.as_str().to_owned(),
        parse_status: parse_status_name(state.parse_status).to_owned(),
        bank: parsed
            .then_some(state.bank)
            .flatten()
            .map(bank_selection_dto),
        pattern: parsed
            .then_some(state.pattern)
            .flatten()
            .map(pattern_selection_dto),
        arrangement: parsed
            .then_some(state.arrangement)
            .flatten()
            .map(arrangement_selection_dto),
        master_track: parsed.then_some(state.master_track).flatten(),
    }
}

fn bank_selection_dto(selection: ProjectBankSelection) -> ProjectBankSelectionDto {
    match selection {
        ProjectBankSelection::Selected(index) => {
            ProjectBankSelectionDto::Selected { index: index.get() }
        }
        ProjectBankSelection::Unrecognized(raw) => ProjectBankSelectionDto::Unrecognized { raw },
    }
}

fn pattern_selection_dto(selection: ProjectPatternSelection) -> ProjectPatternSelectionDto {
    match selection {
        ProjectPatternSelection::Selected(index) => {
            ProjectPatternSelectionDto::Selected { index: index.get() }
        }
        ProjectPatternSelection::Unrecognized(raw) => {
            ProjectPatternSelectionDto::Unrecognized { raw }
        }
    }
}

fn arrangement_selection_dto(
    selection: ProjectArrangementSelection,
) -> ProjectArrangementSelectionDto {
    match selection {
        ProjectArrangementSelection::Unmapped(raw) => {
            ProjectArrangementSelectionDto::Unmapped { raw }
        }
    }
}

fn bank_dto(bank: BankStructure) -> BankStructureDto {
    let parsed = bank.parse_status == StateDocumentParseStatus::Parsed;
    BankStructureDto {
        index: bank.bank.get(),
        letter: bank.bank.letter().to_string(),
        role: role_name(bank.role).to_owned(),
        source_relative_path: bank.source_relative_path.as_str().to_owned(),
        parse_status: parse_status_name(bank.parse_status).to_owned(),
        patterns: if parsed {
            bank.patterns.into_iter().map(pattern_dto).collect()
        } else {
            Vec::new()
        },
        parts: if parsed {
            bank.parts.into_iter().map(part_dto).collect()
        } else {
            Vec::new()
        },
        unmodeled_dependencies: bank
            .unmodeled
            .into_iter()
            .map(unmodeled_name)
            .map(str::to_owned)
            .collect(),
    }
}

fn pattern_dto(pattern: PatternStructure) -> PatternStructureDto {
    PatternStructureDto {
        index: pattern.index.get(),
        part_index: pattern.part.get(),
        scale: scale_dto(&pattern.scale),
    }
}

pub(crate) fn scale_dto(scale: &PatternScale) -> PatternScaleDto {
    match scale {
        PatternScale::Normal {
            master_length,
            master_scale,
        } => PatternScaleDto::Normal {
            master_length: *master_length,
            master_scale: playback_scale_dto(*master_scale),
        },
        PatternScale::PerTrack {
            master_length,
            master_scale,
            tracks,
        } => PatternScaleDto::PerTrack {
            master_length: master_length_dto(*master_length),
            master_scale: playback_scale_dto(*master_scale),
            tracks: tracks
                .iter()
                .map(|track| TrackScaleDto {
                    track: track.track.get(),
                    length: track.length,
                    scale: playback_scale_dto(track.scale),
                })
                .collect(),
        },
        PatternScale::Unrecognized { raw } => PatternScaleDto::Unrecognized { raw: *raw },
    }
}

fn master_length_dto(length: PatternMasterLength) -> PatternMasterLengthDto {
    match length {
        PatternMasterLength::Finite(steps) => PatternMasterLengthDto::Finite { steps },
        PatternMasterLength::Infinite => PatternMasterLengthDto::Infinite,
        PatternMasterLength::Unrecognized { multiplier, length } => {
            PatternMasterLengthDto::Unrecognized { multiplier, length }
        }
    }
}

fn playback_scale_dto(scale: PatternPlaybackScale) -> PatternPlaybackScaleDto {
    match scale {
        PatternPlaybackScale::Times2 => PatternPlaybackScaleDto::Times2,
        PatternPlaybackScale::Times3Over2 => PatternPlaybackScaleDto::Times3Over2,
        PatternPlaybackScale::Times1 => PatternPlaybackScaleDto::Times1,
        PatternPlaybackScale::Times3Over4 => PatternPlaybackScaleDto::Times3Over4,
        PatternPlaybackScale::Times1Over2 => PatternPlaybackScaleDto::Times1Over2,
        PatternPlaybackScale::Times1Over4 => PatternPlaybackScaleDto::Times1Over4,
        PatternPlaybackScale::Times1Over8 => PatternPlaybackScaleDto::Times1Over8,
        PatternPlaybackScale::Unrecognized(raw) => PatternPlaybackScaleDto::Unrecognized { raw },
    }
}

fn part_dto(part: PartStructure) -> PartStructureDto {
    PartStructureDto {
        index: part.index.get(),
        tracks: part.tracks.into_iter().map(track_dto).collect(),
    }
}

fn track_dto(track: TrackStructure) -> TrackStructureDto {
    let playback = match track.playback {
        TrackPlayback::Audio { machine, slot } => TrackPlaybackDto::Audio {
            machine: machine_dto(machine),
            slot: slot_dto(slot),
        },
        TrackPlayback::Master => TrackPlaybackDto::Master,
    };
    TrackStructureDto {
        index: track.index.get(),
        playback,
    }
}

fn machine_dto(machine: MachineKind) -> MachineKindDto {
    match machine {
        MachineKind::Static => MachineKindDto::Static,
        MachineKind::Flex => MachineKindDto::Flex,
        MachineKind::Thru => MachineKindDto::Thru,
        MachineKind::Neighbor => MachineKindDto::Neighbor,
        MachineKind::Pickup => MachineKindDto::Pickup,
        MachineKind::Unknown(raw) => MachineKindDto::Unknown { raw },
    }
}

fn slot_dto(slot: TrackSlotReference) -> TrackSlotReferenceDto {
    match slot {
        TrackSlotReference::Slot(slot) => TrackSlotReferenceDto::Slot {
            slot_kind: match slot.kind() {
                SampleSlotKind::Static => "static",
                SampleSlotKind::Flex => "flex",
            }
            .to_owned(),
            number: slot.number(),
        },
        TrackSlotReference::Unassigned => TrackSlotReferenceDto::Unassigned,
        TrackSlotReference::RecorderBuffer(buffer) => TrackSlotReferenceDto::RecorderBuffer {
            buffer_number: buffer.buffer_number(),
        },
        TrackSlotReference::NoSampleMachine => TrackSlotReferenceDto::NoSampleMachine,
        TrackSlotReference::Unrecognized(raw) => TrackSlotReferenceDto::Unrecognized { raw },
    }
}

fn role_name(role: StateDocumentRole) -> &'static str {
    match role {
        StateDocumentRole::Working => "working",
        StateDocumentRole::SavedCheckpoint => "savedCheckpoint",
    }
}

fn parse_status_name(status: StateDocumentParseStatus) -> &'static str {
    match status {
        StateDocumentParseStatus::Parsed => "parsed",
        StateDocumentParseStatus::UnsupportedVersion => "unsupportedVersion",
        StateDocumentParseStatus::Malformed => "malformed",
    }
}

fn unmodeled_name(dependency: UnmodeledDependency) -> &'static str {
    match dependency {
        UnmodeledDependency::Scenes => "scenes",
        UnmodeledDependency::Arrangements => "arrangements",
        UnmodeledDependency::RecorderSetup => "recorderSetup",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schema_discriminator_serializes_on_the_dto() {
        let dto = ProjectStructureDto {
            schema: PROJECT_STRUCTURE_SCHEMA,
            project_relative_path: "SET/PROJECT".to_owned(),
            project_state: None,
            banks: Vec::new(),
        };
        let json = serde_json::to_value(&dto).unwrap();
        assert_eq!(json["schema"], "masterocta.project-structure:v3");
        assert_eq!(json["projectRelativePath"], "SET/PROJECT");
        assert!(json["banks"].as_array().unwrap().is_empty());
    }

    #[test]
    fn slot_variant_fields_serialize_as_camel_case() {
        let slot = TrackSlotReferenceDto::Slot {
            slot_kind: "static".to_owned(),
            number: 3,
        };
        let json = serde_json::to_value(&slot).unwrap();
        assert_eq!(json["kind"], "slot");
        assert_eq!(json["slotKind"], "static");
        assert_eq!(json["number"], 3);
        assert!(json.get("slot_kind").is_none());

        let buffer = TrackSlotReferenceDto::RecorderBuffer { buffer_number: 2 };
        let json = serde_json::to_value(&buffer).unwrap();
        assert_eq!(json["kind"], "recorderBuffer");
        assert_eq!(json["bufferNumber"], 2);
        assert!(json.get("buffer_number").is_none());
    }

    #[test]
    fn infinite_master_length_serializes_without_a_step_count() {
        let finite = PatternMasterLengthDto::Finite { steps: 255 };
        let infinite = PatternMasterLengthDto::Infinite;
        let finite_json = serde_json::to_value(&finite).unwrap();
        let infinite_json = serde_json::to_value(&infinite).unwrap();
        assert_eq!(finite_json["kind"], "finite");
        assert_eq!(finite_json["steps"], 255);
        assert_eq!(infinite_json["kind"], "infinite");
        assert!(infinite_json.get("steps").is_none());
        assert_ne!(finite_json, infinite_json);

        let master = TrackPlaybackDto::Master;
        let json = serde_json::to_value(&master).unwrap();
        assert_eq!(json["kind"], "master");
        assert!(json.get("slot").is_none());
        assert!(json.get("machine").is_none());

        let machine = MachineKindDto::Unknown { raw: 9 };
        let json = serde_json::to_value(&machine).unwrap();
        assert_eq!(json["kind"], "unknown");
        assert_eq!(json["raw"], 9);
    }
}
