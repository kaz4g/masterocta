//! DTO boundary for `v2_project_structure_read` (`MO-PSE-READ-MODEL-2`).
//!
//! Resolves a registered root and maps the B1 read model. Paths in the DTO are
//! root-relative. Malformed and unsupported Banks expose no Pattern or Part
//! values. This module does not write.

use crate::project_structure_reader::read_project_structure;
use crate::root_registry::{ResolvedRoot, RootRegistry, RootRegistryError};
use ot_domain::project_structure::{
    BankStructure, MachineKind, PartStructure, PatternStructure, ProjectStructure,
    TrackSlotReference, TrackStructure, UnmodeledDependency,
};
use ot_domain::{
    RootId, RootRelativePath, SampleSlotKind, StateDocumentParseStatus, StateDocumentRole,
};
use ot_storage_ports::StorageError;
use serde::Serialize;

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProjectStructureDto {
    pub(crate) project_relative_path: String,
    pub(crate) banks: Vec<BankStructureDto>,
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
    pub(crate) master_length: u16,
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
    pub(crate) machine: MachineKindDto,
    pub(crate) slot: TrackSlotReferenceDto,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(crate) enum MachineKindDto {
    Static,
    Flex,
    Thru,
    Neighbor,
    Pickup,
    Unknown { raw: u8 },
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
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
    NotADirectory,
    Storage(StorageError),
}

impl ProjectStructureReadError {
    pub(crate) fn code(&self) -> &'static str {
        match self {
            Self::Root(error) => error.code(),
            Self::NotADirectory => "INVALID_PROJECT_PATH",
            Self::Storage(error) => storage_code(error),
        }
    }

    pub(crate) fn message(&self) -> String {
        match self {
            Self::Root(error) => error.to_string(),
            Self::NotADirectory => {
                "the project path must be a directory inside the registered root".to_owned()
            }
            Self::Storage(_) => {
                "the project structure could not be read inside the registered root".to_owned()
            }
        }
    }
}

fn storage_code(error: &StorageError) -> &'static str {
    let message = error.message();
    if message.starts_with("PATH_ESCAPE") {
        "PATH_ESCAPE"
    } else if message.starts_with("SYMLINK_ESCAPE") {
        "SYMLINK_ESCAPE"
    } else if message.starts_with("ROOT_REMOVED") {
        "ROOT_REMOVED"
    } else {
        "PROJECT_STRUCTURE_UNAVAILABLE"
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
        .map_err(ProjectStructureReadError::Storage)?;
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
    .map_err(ProjectStructureReadError::Storage)?;
    if path.is_dir() {
        Ok(())
    } else {
        Err(ProjectStructureReadError::NotADirectory)
    }
}

fn to_dto(structure: ProjectStructure) -> ProjectStructureDto {
    ProjectStructureDto {
        project_relative_path: structure.project_relative_path.as_str().to_owned(),
        banks: structure.banks.into_iter().map(bank_dto).collect(),
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
        master_length: pattern.master_length,
    }
}

fn part_dto(part: PartStructure) -> PartStructureDto {
    PartStructureDto {
        index: part.index.get(),
        tracks: part.tracks.into_iter().map(track_dto).collect(),
    }
}

fn track_dto(track: TrackStructure) -> TrackStructureDto {
    TrackStructureDto {
        index: track.index.get(),
        machine: machine_dto(track.machine),
        slot: slot_dto(track.slot),
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
