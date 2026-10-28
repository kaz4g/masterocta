//! Read-only Bank Copy sample-slot remap preview (`MO-PSE-BANK-COPY-PREVIEW-REMAP-1`).
//!
//! Pure functions only: no filesystem, no Apply, no legacy `copy_bank`.

use crate::bank_changeplan::BankChangePlanReferenceObservation;
use ot_domain::project_structure::{BankIndex, TrackIndex, TrackSlotReference};
use ot_domain::{
    BankReferenceInventory, PartStateRole, ReferenceCoverageAggregate, ReferenceOrigin,
    ReferenceScopeRole, RootId, RootRelativePath, SampleReferenceStatus, SampleSlotId,
    SampleSlotKind, StateDocumentRole,
};
use sha2::{Digest, Sha256};
use std::fmt;

pub const BANK_COPY_REMAP_PREVIEW_SCHEMA: &str = "masterocta.bank-copy-remap-preview:v1";
const SNAPSHOT_ID_PREFIX: &str = "bank-copy-remap-preview:v1:";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MasterTrackSetting {
    Disabled,
    Enabled,
    Unavailable,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProjectIdentity {
    pub root_id: RootId,
    pub project_relative_path: RootRelativePath,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SampleSlotSnapshotEntry {
    pub slot: SampleSlotId,
    pub occupied: bool,
    pub reference_status: Option<SampleReferenceStatus>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SampleSlotSnapshot {
    pub entries: Vec<SampleSlotSnapshotEntry>,
}

impl SampleSlotSnapshot {
    pub fn entry(&self, slot: SampleSlotId) -> Option<&SampleSlotSnapshotEntry> {
        self.entries.iter().find(|entry| entry.slot == slot)
    }

    pub fn is_occupied(&self, slot: SampleSlotId) -> bool {
        self.entry(slot)
            .map(|entry| entry.occupied)
            .unwrap_or(false)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum BankCopySlotPlacementPolicy {
    /// Same project: slot numbers are shared; never allocate new slots.
    PreserveSlotNumbers,
    /// Cross-project hypothetical analysis only.
    KeepThenLowestFree,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum BankCopyDocumentHealth {
    Ok,
    Malformed,
    UnsupportedVersion,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BankCopyRemapPreviewInput {
    pub source_project: ProjectIdentity,
    pub destination_project: ProjectIdentity,
    pub source_bank: BankIndex,
    pub destination_bank: BankIndex,
    pub source_document_role: StateDocumentRole,
    pub destination_document_role: StateDocumentRole,
    pub source_slot_snapshot: SampleSlotSnapshot,
    pub destination_slot_snapshot: SampleSlotSnapshot,
    pub reference_observations: Vec<BankChangePlanReferenceObservation>,
    pub reference_coverage: ot_domain::ReferenceCoverage,
    pub placement_policy: BankCopySlotPlacementPolicy,
    pub master_track: MasterTrackSetting,
    pub snapshot_revision: u64,
    pub inventory_revision: u64,
    pub source_document_health: BankCopyDocumentHealth,
    pub destination_document_health: BankCopyDocumentHealth,
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum SlotRemapDisposition {
    Unchanged,
    RemapCandidate,
    Unresolved,
    Blocked,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ObservedSlotReference {
    pub scope: ReferenceScopeRole,
    pub origin: ReferenceOrigin,
    pub part_state: PartStateRole,
    pub part: ot_domain::project_structure::PartIndex,
    pub pattern: Option<ot_domain::project_structure::PatternIndex>,
    pub track: TrackIndex,
    pub step: Option<u8>,
    pub source_slot: SampleSlotId,
    pub disposition: SlotRemapDisposition,
    pub candidate_slot: Option<SampleSlotId>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SlotRemapCandidate {
    pub source_slot: SampleSlotId,
    pub candidate_slot: SampleSlotId,
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum BankCopyRemapBlocker {
    CopySavedCheckpointSemanticsUnknown,
    CrossRoleDocumentPair,
    SnapshotRevisionMismatch,
    ReferenceCoverageIncomplete,
    MalformedSourceDocument,
    MalformedDestinationDocument,
    UnsupportedSourceVersion,
    UnsupportedDestinationVersion,
    MasterTrackSettingUnavailable,
    MasterTrackEnabledWithTrackEightSlotReference,
    UnrecognizedSlotReference,
    SameProjectSnapshotMismatch,
    UnsupportedPlacementPolicy,
    IdentityConflict,
    InsufficientSlotCapacity,
    ReferenceObservationMismatch,
}

impl fmt::Display for BankCopyRemapBlocker {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{self:?}")
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum BankCopyRemapPreviewStatus {
    SameProjectPreserved,
    CrossProjectHypothetical,
    Blocked,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BankCopyRemapPreview {
    pub schema: &'static str,
    pub source_bank: BankIndex,
    pub destination_bank: BankIndex,
    pub unchanged_references: Vec<ObservedSlotReference>,
    pub static_remap_candidates: Vec<SlotRemapCandidate>,
    pub flex_remap_candidates: Vec<SlotRemapCandidate>,
    pub occupied_slots: Vec<SampleSlotId>,
    pub unresolved_references: Vec<ObservedSlotReference>,
    pub capacity_conflicts: Vec<SampleSlotId>,
    pub identity_conflicts: Vec<SampleSlotId>,
    pub reference_coverage: ot_domain::ReferenceCoverage,
    pub snapshot_identity: String,
    pub status: BankCopyRemapPreviewStatus,
    pub blockers: Vec<BankCopyRemapBlocker>,
}

impl BankCopyRemapPreview {
    pub fn apply_authorized(&self) -> bool {
        false
    }

    pub fn cross_project_copy_supported(&self) -> bool {
        false
    }
}

pub fn compute_bank_copy_remap_preview(input: &BankCopyRemapPreviewInput) -> BankCopyRemapPreview {
    let snapshot_identity = derive_snapshot_identity(input);
    let mut blockers = validate_input(input);
    blockers.sort_by_key(blocker_rank);
    blockers.dedup();

    if !blockers.is_empty() {
        return blocked_preview(input, snapshot_identity, blockers);
    }

    let same_project = projects_match(&input.source_project, &input.destination_project);
    if same_project {
        compute_same_project_preview(input, snapshot_identity)
    } else {
        compute_cross_project_preview(input, snapshot_identity)
    }
}

fn validate_input(input: &BankCopyRemapPreviewInput) -> Vec<BankCopyRemapBlocker> {
    let mut blockers = Vec::new();
    if input.source_document_role != StateDocumentRole::Working
        || input.destination_document_role != StateDocumentRole::Working
    {
        blockers.push(BankCopyRemapBlocker::CopySavedCheckpointSemanticsUnknown);
        if input.source_document_role != input.destination_document_role {
            blockers.push(BankCopyRemapBlocker::CrossRoleDocumentPair);
        }
    }
    if input.snapshot_revision != input.inventory_revision {
        blockers.push(BankCopyRemapBlocker::SnapshotRevisionMismatch);
    }
    if input.reference_coverage.aggregate()
        != ReferenceCoverageAggregate::CompleteForChangePlanReview
    {
        blockers.push(BankCopyRemapBlocker::ReferenceCoverageIncomplete);
    }
    match input.source_document_health {
        BankCopyDocumentHealth::Malformed => {
            blockers.push(BankCopyRemapBlocker::MalformedSourceDocument)
        }
        BankCopyDocumentHealth::UnsupportedVersion => {
            blockers.push(BankCopyRemapBlocker::UnsupportedSourceVersion)
        }
        BankCopyDocumentHealth::Ok => {}
    }
    match input.destination_document_health {
        BankCopyDocumentHealth::Malformed => {
            blockers.push(BankCopyRemapBlocker::MalformedDestinationDocument)
        }
        BankCopyDocumentHealth::UnsupportedVersion => {
            blockers.push(BankCopyRemapBlocker::UnsupportedDestinationVersion)
        }
        BankCopyDocumentHealth::Ok => {}
    }
    if input.master_track == MasterTrackSetting::Unavailable {
        blockers.push(BankCopyRemapBlocker::MasterTrackSettingUnavailable);
    }
    if input.master_track == MasterTrackSetting::Enabled {
        for observation in source_content_observations(input) {
            if observation.track.get() == 7 && slot_from_target(&observation.target).is_some() {
                blockers.push(BankCopyRemapBlocker::MasterTrackEnabledWithTrackEightSlotReference);
                break;
            }
        }
    }
    for observation in source_content_observations(input) {
        if matches!(observation.target, TrackSlotReference::Unrecognized(_)) {
            blockers.push(BankCopyRemapBlocker::UnrecognizedSlotReference);
            break;
        }
    }
    if projects_match(&input.source_project, &input.destination_project) {
        if input.placement_policy != BankCopySlotPlacementPolicy::PreserveSlotNumbers {
            blockers.push(BankCopyRemapBlocker::UnsupportedPlacementPolicy);
        }
        if input.source_slot_snapshot != input.destination_slot_snapshot {
            blockers.push(BankCopyRemapBlocker::SameProjectSnapshotMismatch);
        }
    } else if input.placement_policy != BankCopySlotPlacementPolicy::KeepThenLowestFree {
        blockers.push(BankCopyRemapBlocker::UnsupportedPlacementPolicy);
    }
    blockers
}

fn compute_same_project_preview(
    input: &BankCopyRemapPreviewInput,
    snapshot_identity: String,
) -> BankCopyRemapPreview {
    let mut unchanged = Vec::new();
    let mut unresolved = Vec::new();
    let mut identity_conflicts = Vec::new();

    for observation in source_content_observations(input) {
        let Some(source_slot) = slot_from_target(&observation.target) else {
            continue;
        };
        let status = observation.reference_status;
        if status == Some(SampleReferenceStatus::Resolved) {
            unchanged.push(classified_reference(
                observation,
                source_slot,
                SlotRemapDisposition::Unchanged,
                Some(source_slot),
            ));
            if input.destination_slot_snapshot.is_occupied(source_slot)
                && input
                    .source_slot_snapshot
                    .entry(source_slot)
                    .map(|e| e.reference_status)
                    != input
                        .destination_slot_snapshot
                        .entry(source_slot)
                        .map(|e| e.reference_status)
            {
                identity_conflicts.push(source_slot);
            }
        } else if is_unresolved_status(status) {
            unresolved.push(classified_reference(
                observation,
                source_slot,
                SlotRemapDisposition::Unresolved,
                None,
            ));
        }
    }

    sort_references(&mut unchanged);
    sort_references(&mut unresolved);
    identity_conflicts.sort_by_key(|slot| (slot_kind_rank(slot.kind()), slot.number()));

    let mut blockers = Vec::new();
    if !identity_conflicts.is_empty() {
        blockers.push(BankCopyRemapBlocker::IdentityConflict);
    }
    blockers.sort_by_key(blocker_rank);
    blockers.dedup();

    let status = if blockers.is_empty() {
        BankCopyRemapPreviewStatus::SameProjectPreserved
    } else {
        BankCopyRemapPreviewStatus::Blocked
    };

    BankCopyRemapPreview {
        schema: BANK_COPY_REMAP_PREVIEW_SCHEMA,
        source_bank: input.source_bank,
        destination_bank: input.destination_bank,
        unchanged_references: unchanged,
        static_remap_candidates: Vec::new(),
        flex_remap_candidates: Vec::new(),
        occupied_slots: occupied_slots(input),
        unresolved_references: unresolved,
        capacity_conflicts: Vec::new(),
        identity_conflicts,
        reference_coverage: input.reference_coverage,
        snapshot_identity,
        status,
        blockers,
    }
}

fn compute_cross_project_preview(
    input: &BankCopyRemapPreviewInput,
    snapshot_identity: String,
) -> BankCopyRemapPreview {
    let mut unchanged = Vec::new();
    let mut unresolved = Vec::new();
    let mut static_candidates = Vec::new();
    let mut flex_candidates = Vec::new();
    let mut capacity_conflicts = Vec::new();

    let mut needed_static = Vec::new();
    let mut needed_flex = Vec::new();
    for observation in source_content_observations(input) {
        let Some(source_slot) = slot_from_target(&observation.target) else {
            continue;
        };
        match observation.reference_status {
            Some(SampleReferenceStatus::Resolved) => match source_slot.kind() {
                SampleSlotKind::Static => needed_static.push(source_slot),
                SampleSlotKind::Flex => needed_flex.push(source_slot),
            },
            status if is_unresolved_status(status) => unresolved.push(classified_reference(
                observation,
                source_slot,
                SlotRemapDisposition::Unresolved,
                None,
            )),
            _ => {}
        }
    }
    needed_static.sort_by_key(|slot| slot.number());
    needed_static.dedup();
    needed_flex.sort_by_key(|slot| slot.number());
    needed_flex.dedup();

    let static_map = build_pool_remap(
        &needed_static,
        &input.destination_slot_snapshot,
        &mut static_candidates,
        &mut capacity_conflicts,
    );
    let flex_map = build_pool_remap(
        &needed_flex,
        &input.destination_slot_snapshot,
        &mut flex_candidates,
        &mut capacity_conflicts,
    );

    for observation in source_content_observations(input) {
        let Some(source_slot) = slot_from_target(&observation.target) else {
            continue;
        };
        if observation.reference_status != Some(SampleReferenceStatus::Resolved) {
            continue;
        }
        let map = match source_slot.kind() {
            SampleSlotKind::Static => &static_map,
            SampleSlotKind::Flex => &flex_map,
        };
        let Some(candidate) = map.get(&source_slot) else {
            continue;
        };
        let disposition = if *candidate == source_slot {
            SlotRemapDisposition::Unchanged
        } else {
            SlotRemapDisposition::RemapCandidate
        };
        unchanged.push(classified_reference(
            observation,
            source_slot,
            disposition,
            Some(*candidate),
        ));
    }

    sort_references(&mut unchanged);
    sort_references(&mut unresolved);
    static_candidates
        .sort_by_key(|entry| (entry.source_slot.number(), entry.candidate_slot.number()));
    flex_candidates
        .sort_by_key(|entry| (entry.source_slot.number(), entry.candidate_slot.number()));
    capacity_conflicts.sort_by_key(|slot| (slot_kind_rank(slot.kind()), slot.number()));

    let mut blockers = Vec::new();
    if !capacity_conflicts.is_empty() {
        blockers.push(BankCopyRemapBlocker::InsufficientSlotCapacity);
    }
    blockers.sort_by_key(blocker_rank);
    blockers.dedup();

    let status = if blockers.is_empty() {
        BankCopyRemapPreviewStatus::CrossProjectHypothetical
    } else {
        BankCopyRemapPreviewStatus::Blocked
    };

    BankCopyRemapPreview {
        schema: BANK_COPY_REMAP_PREVIEW_SCHEMA,
        source_bank: input.source_bank,
        destination_bank: input.destination_bank,
        unchanged_references: unchanged,
        static_remap_candidates: static_candidates,
        flex_remap_candidates: flex_candidates,
        occupied_slots: occupied_slots(input),
        unresolved_references: unresolved,
        capacity_conflicts,
        identity_conflicts: Vec::new(),
        reference_coverage: input.reference_coverage,
        snapshot_identity,
        status,
        blockers,
    }
}

fn build_pool_remap(
    needed: &[SampleSlotId],
    destination: &SampleSlotSnapshot,
    candidates_out: &mut Vec<SlotRemapCandidate>,
    capacity_out: &mut Vec<SampleSlotId>,
) -> std::collections::HashMap<SampleSlotId, SampleSlotId> {
    let pool_kind = needed
        .first()
        .map(|slot| slot.kind())
        .unwrap_or(SampleSlotKind::Static);
    let mut occupied: std::collections::BTreeSet<u16> = destination
        .entries
        .iter()
        .filter(|entry| entry.occupied && entry.slot.kind() == pool_kind)
        .map(|entry| entry.slot.number())
        .collect();
    let mut remap = std::collections::HashMap::new();
    for source_slot in needed {
        if destination
            .entries
            .iter()
            .any(|entry| entry.occupied && entry.slot == *source_slot)
            || occupied.contains(&source_slot.number())
        {
            if let Some(free) = lowest_free_slot(pool_kind, &occupied) {
                occupied.insert(free.number());
                candidates_out.push(SlotRemapCandidate {
                    source_slot: *source_slot,
                    candidate_slot: free,
                });
                remap.insert(*source_slot, free);
            } else {
                capacity_out.push(*source_slot);
            }
        } else {
            occupied.insert(source_slot.number());
            remap.insert(*source_slot, *source_slot);
        }
    }
    remap
}

fn lowest_free_slot(
    kind: SampleSlotKind,
    occupied: &std::collections::BTreeSet<u16>,
) -> Option<SampleSlotId> {
    for number in 1..=128u16 {
        if !occupied.contains(&number) {
            return SampleSlotId::new(kind, number).ok();
        }
    }
    None
}

fn blocked_preview(
    input: &BankCopyRemapPreviewInput,
    snapshot_identity: String,
    blockers: Vec<BankCopyRemapBlocker>,
) -> BankCopyRemapPreview {
    BankCopyRemapPreview {
        schema: BANK_COPY_REMAP_PREVIEW_SCHEMA,
        source_bank: input.source_bank,
        destination_bank: input.destination_bank,
        unchanged_references: Vec::new(),
        static_remap_candidates: Vec::new(),
        flex_remap_candidates: Vec::new(),
        occupied_slots: occupied_slots(input),
        unresolved_references: Vec::new(),
        capacity_conflicts: Vec::new(),
        identity_conflicts: Vec::new(),
        reference_coverage: input.reference_coverage,
        snapshot_identity,
        status: BankCopyRemapPreviewStatus::Blocked,
        blockers,
    }
}

fn occupied_slots(input: &BankCopyRemapPreviewInput) -> Vec<SampleSlotId> {
    let mut slots: Vec<_> = input
        .destination_slot_snapshot
        .entries
        .iter()
        .filter(|entry| entry.occupied)
        .map(|entry| entry.slot)
        .collect();
    slots.sort_by_key(|slot| (slot_kind_rank(slot.kind()), slot.number()));
    slots
}

fn classified_reference(
    observation: &BankChangePlanReferenceObservation,
    source_slot: SampleSlotId,
    disposition: SlotRemapDisposition,
    candidate_slot: Option<SampleSlotId>,
) -> ObservedSlotReference {
    ObservedSlotReference {
        scope: observation.scope,
        origin: observation.origin,
        part_state: observation.part_state,
        part: observation.part,
        pattern: observation.pattern,
        track: observation.track,
        step: observation.step,
        source_slot,
        disposition,
        candidate_slot,
    }
}

fn source_content_observations(
    input: &BankCopyRemapPreviewInput,
) -> Vec<&BankChangePlanReferenceObservation> {
    let mut out: Vec<_> = input
        .reference_observations
        .iter()
        .filter(|observation| observation.scope == ReferenceScopeRole::SourceContent)
        .collect();
    out.sort_by(compare_observation_ptr);
    out
}

fn compare_observation_ptr(
    left: &&BankChangePlanReferenceObservation,
    right: &&BankChangePlanReferenceObservation,
) -> std::cmp::Ordering {
    scope_rank(left.scope)
        .cmp(&scope_rank(right.scope))
        .then_with(|| left.bank.get().cmp(&right.bank.get()))
        .then_with(|| role_rank(left.document_role).cmp(&role_rank(right.document_role)))
        .then_with(|| origin_rank(left.origin).cmp(&origin_rank(right.origin)))
        .then_with(|| left.part.get().cmp(&right.part.get()))
        .then_with(|| pattern_key(left.pattern).cmp(&pattern_key(right.pattern)))
        .then_with(|| left.track.get().cmp(&right.track.get()))
        .then_with(|| step_key(left.step).cmp(&step_key(right.step)))
}

fn sort_references(references: &mut [ObservedSlotReference]) {
    references.sort_by(|left, right| {
        scope_rank(left.scope)
            .cmp(&scope_rank(right.scope))
            .then_with(|| origin_rank(left.origin).cmp(&origin_rank(right.origin)))
            .then_with(|| left.part.get().cmp(&right.part.get()))
            .then_with(|| pattern_key(left.pattern).cmp(&pattern_key(right.pattern)))
            .then_with(|| left.track.get().cmp(&right.track.get()))
            .then_with(|| step_key(left.step).cmp(&step_key(right.step)))
            .then_with(|| {
                slot_kind_rank(left.source_slot.kind())
                    .cmp(&slot_kind_rank(right.source_slot.kind()))
            })
            .then_with(|| left.source_slot.number().cmp(&right.source_slot.number()))
    });
}

fn slot_from_target(target: &TrackSlotReference) -> Option<SampleSlotId> {
    match target {
        TrackSlotReference::Slot(id) => Some(*id),
        _ => None,
    }
}

fn is_unresolved_status(status: Option<SampleReferenceStatus>) -> bool {
    matches!(
        status,
        Some(
            SampleReferenceStatus::Missing
                | SampleReferenceStatus::Ambiguous
                | SampleReferenceStatus::InvalidPath
                | SampleReferenceStatus::UnassignedSlot
        ) | None
    )
}

fn projects_match(left: &ProjectIdentity, right: &ProjectIdentity) -> bool {
    left.root_id.as_str() == right.root_id.as_str()
        && left.project_relative_path.as_str() == right.project_relative_path.as_str()
}

fn derive_snapshot_identity(input: &BankCopyRemapPreviewInput) -> String {
    let mut hasher = Sha256::new();
    hasher.update(SNAPSHOT_ID_PREFIX.as_bytes());
    encode_u64(&mut hasher, input.snapshot_revision);
    encode_str(&mut hasher, input.source_project.root_id.as_str());
    encode_str(
        &mut hasher,
        input.source_project.project_relative_path.as_str(),
    );
    encode_str(&mut hasher, input.destination_project.root_id.as_str());
    encode_str(
        &mut hasher,
        input.destination_project.project_relative_path.as_str(),
    );
    encode_u8(&mut hasher, input.source_bank.get());
    encode_u8(&mut hasher, input.destination_bank.get());
    encode_u8(&mut hasher, role_code(input.source_document_role));
    encode_u8(&mut hasher, role_code(input.destination_document_role));
    encode_u8(&mut hasher, placement_code(input.placement_policy));
    encode_u8(&mut hasher, master_track_code(input.master_track));
    encode_snapshot(&mut hasher, &input.source_slot_snapshot);
    encode_snapshot(&mut hasher, &input.destination_slot_snapshot);
    let mut observations = input.reference_observations.clone();
    observations.sort_by(compare_observation_value);
    for observation in observations {
        encode_observation(&mut hasher, &observation);
    }
    format!(
        "{SNAPSHOT_ID_PREFIX}{}",
        hex_digest(hasher.finalize().as_slice())
    )
}

#[allow(clippy::too_many_arguments)]
pub fn preview_input_from_inventory(
    source_project: ProjectIdentity,
    destination_project: ProjectIdentity,
    source_bank: BankIndex,
    destination_bank: BankIndex,
    source_document_role: StateDocumentRole,
    destination_document_role: StateDocumentRole,
    source_slot_snapshot: SampleSlotSnapshot,
    destination_slot_snapshot: SampleSlotSnapshot,
    inventory: &BankReferenceInventory,
    placement_policy: BankCopySlotPlacementPolicy,
    master_track: MasterTrackSetting,
    source_document_health: BankCopyDocumentHealth,
    destination_document_health: BankCopyDocumentHealth,
) -> BankCopyRemapPreviewInput {
    let reference_observations = scoped_observations(inventory, source_bank, destination_bank);
    BankCopyRemapPreviewInput {
        source_project,
        destination_project,
        source_bank,
        destination_bank,
        source_document_role,
        destination_document_role,
        source_slot_snapshot,
        destination_slot_snapshot,
        reference_observations,
        reference_coverage: inventory.coverage,
        placement_policy,
        master_track,
        snapshot_revision: inventory.observed_revision,
        inventory_revision: inventory.observed_revision,
        source_document_health,
        destination_document_health,
    }
}

pub fn scoped_observations(
    inventory: &BankReferenceInventory,
    source: BankIndex,
    destination: BankIndex,
) -> Vec<BankChangePlanReferenceObservation> {
    let mut out = Vec::new();
    for observation in &inventory.observations {
        let scope = if observation.bank == source {
            ReferenceScopeRole::SourceContent
        } else if observation.bank == destination {
            ReferenceScopeRole::DestinationCurrent
        } else {
            continue;
        };
        out.push(BankChangePlanReferenceObservation {
            scope,
            bank: observation.bank,
            document_role: observation.document_role,
            origin: observation.origin,
            part_state: observation.part_state,
            part: observation.part,
            pattern: observation.pattern,
            track: observation.track,
            step: observation.step,
            target: observation.target,
            audible: observation.audible,
            reference_status: observation.reference_status,
            referenced_relative_path: observation.referenced_relative_path.clone(),
        });
    }
    out.sort_by(compare_observation_value);
    out
}

fn compare_observation_value(
    left: &BankChangePlanReferenceObservation,
    right: &BankChangePlanReferenceObservation,
) -> std::cmp::Ordering {
    scope_rank(left.scope)
        .cmp(&scope_rank(right.scope))
        .then_with(|| left.bank.get().cmp(&right.bank.get()))
        .then_with(|| role_rank(left.document_role).cmp(&role_rank(right.document_role)))
        .then_with(|| origin_rank(left.origin).cmp(&origin_rank(right.origin)))
        .then_with(|| left.part.get().cmp(&right.part.get()))
        .then_with(|| pattern_key(left.pattern).cmp(&pattern_key(right.pattern)))
        .then_with(|| left.track.get().cmp(&right.track.get()))
        .then_with(|| step_key(left.step).cmp(&step_key(right.step)))
        .then_with(|| format!("{:?}", left.target).cmp(&format!("{:?}", right.target)))
}

fn encode_snapshot(hasher: &mut Sha256, snapshot: &SampleSlotSnapshot) {
    encode_u64(hasher, snapshot.entries.len() as u64);
    let mut entries = snapshot.entries.clone();
    entries.sort_by_key(|entry| (slot_kind_rank(entry.slot.kind()), entry.slot.number()));
    for entry in entries {
        encode_u8(hasher, slot_kind_rank(entry.slot.kind()));
        encode_u16(hasher, entry.slot.number());
        encode_u8(hasher, u8::from(entry.occupied));
        encode_u8(
            hasher,
            entry
                .reference_status
                .map(reference_status_code)
                .unwrap_or(255),
        );
    }
}

fn encode_observation(hasher: &mut Sha256, observation: &BankChangePlanReferenceObservation) {
    encode_u8(hasher, scope_rank(observation.scope));
    encode_u8(hasher, observation.bank.get());
    encode_u8(hasher, role_code(observation.document_role));
    encode_u8(hasher, origin_rank(observation.origin));
    encode_u8(hasher, observation.part.get());
    encode_u8(hasher, pattern_key(observation.pattern));
    encode_u8(hasher, observation.track.get());
    encode_u8(hasher, step_key(observation.step));
    encode_str(hasher, &format!("{:?}", observation.target));
    encode_u8(
        hasher,
        observation
            .reference_status
            .map(reference_status_code)
            .unwrap_or(255),
    );
}

fn encode_u64(hasher: &mut Sha256, value: u64) {
    hasher.update(value.to_be_bytes());
}

fn encode_u16(hasher: &mut Sha256, value: u16) {
    hasher.update(value.to_be_bytes());
}

fn encode_u8(hasher: &mut Sha256, value: u8) {
    hasher.update([value]);
}

fn encode_str(hasher: &mut Sha256, value: &str) {
    encode_u64(hasher, value.len() as u64);
    hasher.update(value.as_bytes());
}

fn hex_digest(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn scope_rank(scope: ReferenceScopeRole) -> u8 {
    match scope {
        ReferenceScopeRole::SourceContent => 0,
        ReferenceScopeRole::DestinationCurrent => 1,
        ReferenceScopeRole::OperatedBank => 2,
    }
}

fn origin_rank(origin: ReferenceOrigin) -> u8 {
    match origin {
        ReferenceOrigin::ActiveMachine => 0,
        ReferenceOrigin::SampleLock => 1,
        ReferenceOrigin::SavedPartMachine => 2,
    }
}

fn role_rank(role: StateDocumentRole) -> u8 {
    role_code(role)
}

fn role_code(role: StateDocumentRole) -> u8 {
    match role {
        StateDocumentRole::Working => 0,
        StateDocumentRole::SavedCheckpoint => 1,
    }
}

fn placement_code(policy: BankCopySlotPlacementPolicy) -> u8 {
    match policy {
        BankCopySlotPlacementPolicy::PreserveSlotNumbers => 0,
        BankCopySlotPlacementPolicy::KeepThenLowestFree => 1,
    }
}

fn master_track_code(setting: MasterTrackSetting) -> u8 {
    match setting {
        MasterTrackSetting::Disabled => 0,
        MasterTrackSetting::Enabled => 1,
        MasterTrackSetting::Unavailable => 2,
    }
}

fn pattern_key(pattern: Option<ot_domain::project_structure::PatternIndex>) -> u8 {
    pattern.map(|value| value.get()).unwrap_or(255)
}

fn step_key(step: Option<u8>) -> u8 {
    step.unwrap_or(255)
}

fn reference_status_code(status: SampleReferenceStatus) -> u8 {
    match status {
        SampleReferenceStatus::Resolved => 0,
        SampleReferenceStatus::Missing => 1,
        SampleReferenceStatus::InvalidPath => 2,
        SampleReferenceStatus::Ambiguous => 3,
        SampleReferenceStatus::UnassignedSlot => 4,
    }
}

fn slot_kind_rank(kind: SampleSlotKind) -> u8 {
    ot_domain::slot_kind_rank(kind)
}

fn blocker_rank(blocker: &BankCopyRemapBlocker) -> u8 {
    match blocker {
        BankCopyRemapBlocker::CopySavedCheckpointSemanticsUnknown => 0,
        BankCopyRemapBlocker::CrossRoleDocumentPair => 1,
        BankCopyRemapBlocker::SnapshotRevisionMismatch => 2,
        BankCopyRemapBlocker::ReferenceCoverageIncomplete => 3,
        BankCopyRemapBlocker::MalformedSourceDocument => 4,
        BankCopyRemapBlocker::MalformedDestinationDocument => 5,
        BankCopyRemapBlocker::UnsupportedSourceVersion => 6,
        BankCopyRemapBlocker::UnsupportedDestinationVersion => 7,
        BankCopyRemapBlocker::MasterTrackSettingUnavailable => 8,
        BankCopyRemapBlocker::MasterTrackEnabledWithTrackEightSlotReference => 9,
        BankCopyRemapBlocker::UnrecognizedSlotReference => 10,
        BankCopyRemapBlocker::SameProjectSnapshotMismatch => 11,
        BankCopyRemapBlocker::UnsupportedPlacementPolicy => 12,
        BankCopyRemapBlocker::IdentityConflict => 13,
        BankCopyRemapBlocker::InsufficientSlotCapacity => 14,
        BankCopyRemapBlocker::ReferenceObservationMismatch => 15,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ot_domain::project_structure::{PartIndex, PatternIndex, TrackIndex};
    use ot_domain::{ReferenceCoverage, ReferenceOrigin, ReferenceScopeRole};

    fn project_id(label: &str) -> ProjectIdentity {
        ProjectIdentity {
            root_id: RootId::new(format!("root:{label}")).unwrap(),
            project_relative_path: RootRelativePath::parse("SET/PROJECT").unwrap(),
        }
    }

    fn slot(kind: SampleSlotKind, number: u16) -> SampleSlotId {
        SampleSlotId::new(kind, number).unwrap()
    }

    fn snapshot(
        entries: &[(SampleSlotKind, u16, bool, Option<SampleReferenceStatus>)],
    ) -> SampleSlotSnapshot {
        SampleSlotSnapshot {
            entries: entries
                .iter()
                .map(|(kind, number, occupied, status)| SampleSlotSnapshotEntry {
                    slot: slot(*kind, *number),
                    occupied: *occupied,
                    reference_status: *status,
                })
                .collect(),
        }
    }

    fn observation(
        scope: ReferenceScopeRole,
        origin: ReferenceOrigin,
        part_state: PartStateRole,
        track: u8,
        target: TrackSlotReference,
        status: Option<SampleReferenceStatus>,
    ) -> BankChangePlanReferenceObservation {
        BankChangePlanReferenceObservation {
            scope,
            bank: BankIndex::new(0).unwrap(),
            document_role: StateDocumentRole::Working,
            origin,
            part_state,
            part: PartIndex::new(0).unwrap(),
            pattern: None,
            track: TrackIndex::new(track).unwrap(),
            step: None,
            target,
            audible: None,
            reference_status: status,
            referenced_relative_path: None,
        }
    }

    fn base_input(
        source_project: ProjectIdentity,
        destination_project: ProjectIdentity,
        placement: BankCopySlotPlacementPolicy,
        source_snapshot: SampleSlotSnapshot,
        destination_snapshot: SampleSlotSnapshot,
        observations: Vec<BankChangePlanReferenceObservation>,
    ) -> BankCopyRemapPreviewInput {
        BankCopyRemapPreviewInput {
            source_project,
            destination_project,
            source_bank: BankIndex::new(0).unwrap(),
            destination_bank: BankIndex::new(1).unwrap(),
            source_document_role: StateDocumentRole::Working,
            destination_document_role: StateDocumentRole::Working,
            source_slot_snapshot: source_snapshot,
            destination_slot_snapshot: destination_snapshot,
            reference_observations: observations,
            reference_coverage: ReferenceCoverage::complete_for_changeplan_review(),
            placement_policy: placement,
            master_track: MasterTrackSetting::Disabled,
            snapshot_revision: 1,
            inventory_revision: 1,
            source_document_health: BankCopyDocumentHealth::Ok,
            destination_document_health: BankCopyDocumentHealth::Ok,
        }
    }

    #[test]
    fn apply_authorization_is_always_denied() {
        let preview = compute_bank_copy_remap_preview(&base_input(
            project_id("a"),
            project_id("a"),
            BankCopySlotPlacementPolicy::PreserveSlotNumbers,
            snapshot(&[(
                SampleSlotKind::Static,
                1,
                true,
                Some(SampleReferenceStatus::Resolved),
            )]),
            snapshot(&[(
                SampleSlotKind::Static,
                1,
                true,
                Some(SampleReferenceStatus::Resolved),
            )]),
            vec![observation(
                ReferenceScopeRole::SourceContent,
                ReferenceOrigin::ActiveMachine,
                PartStateRole::Working,
                0,
                TrackSlotReference::Slot(slot(SampleSlotKind::Static, 1)),
                Some(SampleReferenceStatus::Resolved),
            )],
        ));
        assert!(!preview.apply_authorized());
        assert!(!preview.cross_project_copy_supported());
    }

    #[test]
    fn same_project_preserves_static_and_flex_slots() {
        let snap = snapshot(&[
            (
                SampleSlotKind::Static,
                3,
                true,
                Some(SampleReferenceStatus::Resolved),
            ),
            (
                SampleSlotKind::Flex,
                8,
                true,
                Some(SampleReferenceStatus::Resolved),
            ),
        ]);
        let preview = compute_bank_copy_remap_preview(&base_input(
            project_id("same"),
            project_id("same"),
            BankCopySlotPlacementPolicy::PreserveSlotNumbers,
            snap.clone(),
            snap,
            vec![
                observation(
                    ReferenceScopeRole::SourceContent,
                    ReferenceOrigin::ActiveMachine,
                    PartStateRole::Working,
                    0,
                    TrackSlotReference::Slot(slot(SampleSlotKind::Static, 3)),
                    Some(SampleReferenceStatus::Resolved),
                ),
                observation(
                    ReferenceScopeRole::SourceContent,
                    ReferenceOrigin::ActiveMachine,
                    PartStateRole::Working,
                    1,
                    TrackSlotReference::Slot(slot(SampleSlotKind::Flex, 8)),
                    Some(SampleReferenceStatus::Resolved),
                ),
            ],
        ));
        assert_eq!(
            preview.status,
            BankCopyRemapPreviewStatus::SameProjectPreserved
        );
        assert!(preview.static_remap_candidates.is_empty());
        assert!(preview.flex_remap_candidates.is_empty());
        assert_eq!(preview.unchanged_references.len(), 2);
        assert!(preview
            .unchanged_references
            .iter()
            .all(|reference| reference.disposition == SlotRemapDisposition::Unchanged));
    }

    #[test]
    fn raw_zero_maps_to_slot_one_unchanged() {
        let snap = snapshot(&[(
            SampleSlotKind::Static,
            1,
            true,
            Some(SampleReferenceStatus::Resolved),
        )]);
        let preview = compute_bank_copy_remap_preview(&base_input(
            project_id("same"),
            project_id("same"),
            BankCopySlotPlacementPolicy::PreserveSlotNumbers,
            snap.clone(),
            snap,
            vec![observation(
                ReferenceScopeRole::SourceContent,
                ReferenceOrigin::ActiveMachine,
                PartStateRole::Working,
                0,
                TrackSlotReference::Slot(slot(SampleSlotKind::Static, 1)),
                Some(SampleReferenceStatus::Resolved),
            )],
        ));
        assert_eq!(preview.unchanged_references[0].source_slot.number(), 1);
    }

    #[test]
    fn unassigned_and_no_sample_machine_are_not_unresolved() {
        let snap = snapshot(&[]);
        let preview = compute_bank_copy_remap_preview(&base_input(
            project_id("same"),
            project_id("same"),
            BankCopySlotPlacementPolicy::PreserveSlotNumbers,
            snap.clone(),
            snap,
            vec![
                observation(
                    ReferenceScopeRole::SourceContent,
                    ReferenceOrigin::ActiveMachine,
                    PartStateRole::Working,
                    0,
                    TrackSlotReference::Unassigned,
                    Some(SampleReferenceStatus::UnassignedSlot),
                ),
                observation(
                    ReferenceScopeRole::SourceContent,
                    ReferenceOrigin::ActiveMachine,
                    PartStateRole::Working,
                    1,
                    TrackSlotReference::NoSampleMachine,
                    None,
                ),
            ],
        ));
        assert!(preview.unresolved_references.is_empty());
        assert!(preview.unchanged_references.is_empty());
    }

    #[test]
    fn missing_reference_is_unresolved_not_remap_candidate() {
        let snap = snapshot(&[(SampleSlotKind::Static, 4, false, None)]);
        let preview = compute_bank_copy_remap_preview(&base_input(
            project_id("same"),
            project_id("same"),
            BankCopySlotPlacementPolicy::PreserveSlotNumbers,
            snap.clone(),
            snap,
            vec![observation(
                ReferenceScopeRole::SourceContent,
                ReferenceOrigin::SampleLock,
                PartStateRole::Working,
                0,
                TrackSlotReference::Slot(slot(SampleSlotKind::Static, 4)),
                Some(SampleReferenceStatus::Missing),
            )],
        ));
        assert_eq!(preview.unresolved_references.len(), 1);
        assert_eq!(
            preview.unresolved_references[0].disposition,
            SlotRemapDisposition::Unresolved
        );
    }

    #[test]
    fn cross_project_uses_lowest_free_slot_without_filename_dedup() {
        let source_snap = snapshot(&[
            (
                SampleSlotKind::Static,
                3,
                true,
                Some(SampleReferenceStatus::Resolved),
            ),
            (
                SampleSlotKind::Static,
                5,
                true,
                Some(SampleReferenceStatus::Resolved),
            ),
        ]);
        let destination_snap = snapshot(&[
            (
                SampleSlotKind::Static,
                3,
                true,
                Some(SampleReferenceStatus::Resolved),
            ),
            (
                SampleSlotKind::Static,
                4,
                true,
                Some(SampleReferenceStatus::Resolved),
            ),
        ]);
        let preview = compute_bank_copy_remap_preview(&base_input(
            project_id("a"),
            project_id("b"),
            BankCopySlotPlacementPolicy::KeepThenLowestFree,
            source_snap,
            destination_snap,
            vec![
                observation(
                    ReferenceScopeRole::SourceContent,
                    ReferenceOrigin::ActiveMachine,
                    PartStateRole::Working,
                    0,
                    TrackSlotReference::Slot(slot(SampleSlotKind::Static, 3)),
                    Some(SampleReferenceStatus::Resolved),
                ),
                observation(
                    ReferenceScopeRole::SourceContent,
                    ReferenceOrigin::ActiveMachine,
                    PartStateRole::Working,
                    1,
                    TrackSlotReference::Slot(slot(SampleSlotKind::Static, 5)),
                    Some(SampleReferenceStatus::Resolved),
                ),
            ],
        ));
        assert_eq!(
            preview.status,
            BankCopyRemapPreviewStatus::CrossProjectHypothetical
        );
        assert_eq!(preview.static_remap_candidates.len(), 1);
        assert_eq!(preview.static_remap_candidates[0].source_slot.number(), 3);
        assert_eq!(
            preview.static_remap_candidates[0].candidate_slot.number(),
            1
        );
        assert!(preview.unchanged_references.iter().any(|reference| {
            reference.source_slot.number() == 5
                && reference.disposition == SlotRemapDisposition::Unchanged
        }));
    }

    #[test]
    fn shared_source_slot_uses_one_candidate() {
        let source_snap = snapshot(&[(
            SampleSlotKind::Flex,
            2,
            true,
            Some(SampleReferenceStatus::Resolved),
        )]);
        let destination_snap = snapshot(&[(
            SampleSlotKind::Flex,
            2,
            true,
            Some(SampleReferenceStatus::Resolved),
        )]);
        let preview = compute_bank_copy_remap_preview(&base_input(
            project_id("a"),
            project_id("b"),
            BankCopySlotPlacementPolicy::KeepThenLowestFree,
            source_snap,
            destination_snap,
            vec![
                observation(
                    ReferenceScopeRole::SourceContent,
                    ReferenceOrigin::ActiveMachine,
                    PartStateRole::Working,
                    0,
                    TrackSlotReference::Slot(slot(SampleSlotKind::Flex, 2)),
                    Some(SampleReferenceStatus::Resolved),
                ),
                observation(
                    ReferenceScopeRole::SourceContent,
                    ReferenceOrigin::SampleLock,
                    PartStateRole::Working,
                    1,
                    TrackSlotReference::Slot(slot(SampleSlotKind::Flex, 2)),
                    Some(SampleReferenceStatus::Resolved),
                ),
            ],
        ));
        assert_eq!(preview.flex_remap_candidates.len(), 1);
        assert_eq!(preview.unchanged_references.len(), 2);
        assert!(preview
            .unchanged_references
            .iter()
            .all(|reference| reference.candidate_slot == Some(slot(SampleSlotKind::Flex, 1))));
    }

    #[test]
    fn capacity_conflict_blocks_cross_project_preview() {
        let mut destination_entries = Vec::new();
        for number in 1..=128u16 {
            destination_entries.push((
                SampleSlotKind::Static,
                number,
                true,
                Some(SampleReferenceStatus::Resolved),
            ));
        }
        let preview = compute_bank_copy_remap_preview(&base_input(
            project_id("a"),
            project_id("b"),
            BankCopySlotPlacementPolicy::KeepThenLowestFree,
            snapshot(&[(
                SampleSlotKind::Static,
                1,
                true,
                Some(SampleReferenceStatus::Resolved),
            )]),
            snapshot(&destination_entries),
            vec![observation(
                ReferenceScopeRole::SourceContent,
                ReferenceOrigin::ActiveMachine,
                PartStateRole::Working,
                0,
                TrackSlotReference::Slot(slot(SampleSlotKind::Static, 1)),
                Some(SampleReferenceStatus::Resolved),
            )],
        ));
        assert_eq!(preview.status, BankCopyRemapPreviewStatus::Blocked);
        assert!(preview
            .blockers
            .contains(&BankCopyRemapBlocker::InsufficientSlotCapacity));
    }

    #[test]
    fn saved_checkpoint_pair_is_blocked() {
        let mut input = base_input(
            project_id("same"),
            project_id("same"),
            BankCopySlotPlacementPolicy::PreserveSlotNumbers,
            snapshot(&[]),
            snapshot(&[]),
            Vec::new(),
        );
        input.destination_document_role = StateDocumentRole::SavedCheckpoint;
        let preview = compute_bank_copy_remap_preview(&input);
        assert_eq!(preview.status, BankCopyRemapPreviewStatus::Blocked);
        assert!(preview
            .blockers
            .contains(&BankCopyRemapBlocker::CopySavedCheckpointSemanticsUnknown));
    }

    #[test]
    fn unrecognized_reference_blocks_preview() {
        let preview = compute_bank_copy_remap_preview(&base_input(
            project_id("same"),
            project_id("same"),
            BankCopySlotPlacementPolicy::PreserveSlotNumbers,
            snapshot(&[]),
            snapshot(&[]),
            vec![observation(
                ReferenceScopeRole::SourceContent,
                ReferenceOrigin::ActiveMachine,
                PartStateRole::Working,
                0,
                TrackSlotReference::Unrecognized(200),
                None,
            )],
        ));
        assert!(preview
            .blockers
            .contains(&BankCopyRemapBlocker::UnrecognizedSlotReference));
    }

    #[test]
    fn master_track_enabled_with_track_eight_reference_blocks() {
        let snap = snapshot(&[(
            SampleSlotKind::Static,
            2,
            true,
            Some(SampleReferenceStatus::Resolved),
        )]);
        let mut input = base_input(
            project_id("same"),
            project_id("same"),
            BankCopySlotPlacementPolicy::PreserveSlotNumbers,
            snap.clone(),
            snap,
            vec![observation(
                ReferenceScopeRole::SourceContent,
                ReferenceOrigin::ActiveMachine,
                PartStateRole::Working,
                7,
                TrackSlotReference::Slot(slot(SampleSlotKind::Static, 2)),
                Some(SampleReferenceStatus::Resolved),
            )],
        );
        input.master_track = MasterTrackSetting::Enabled;
        let preview = compute_bank_copy_remap_preview(&input);
        assert!(preview
            .blockers
            .contains(&BankCopyRemapBlocker::MasterTrackEnabledWithTrackEightSlotReference));
    }

    #[test]
    fn same_input_yields_deterministic_snapshot_identity() {
        let input = base_input(
            project_id("same"),
            project_id("same"),
            BankCopySlotPlacementPolicy::PreserveSlotNumbers,
            snapshot(&[(
                SampleSlotKind::Static,
                1,
                true,
                Some(SampleReferenceStatus::Resolved),
            )]),
            snapshot(&[(
                SampleSlotKind::Static,
                1,
                true,
                Some(SampleReferenceStatus::Resolved),
            )]),
            vec![observation(
                ReferenceScopeRole::SourceContent,
                ReferenceOrigin::ActiveMachine,
                PartStateRole::Working,
                0,
                TrackSlotReference::Slot(slot(SampleSlotKind::Static, 1)),
                Some(SampleReferenceStatus::Resolved),
            )],
        );
        let first = compute_bank_copy_remap_preview(&input);
        let second = compute_bank_copy_remap_preview(&input);
        assert_eq!(first.snapshot_identity, second.snapshot_identity);
        assert_eq!(first, second);
    }

    #[test]
    fn snapshot_revision_mismatch_blocks_preview() {
        let mut input = base_input(
            project_id("same"),
            project_id("same"),
            BankCopySlotPlacementPolicy::PreserveSlotNumbers,
            snapshot(&[]),
            snapshot(&[]),
            Vec::new(),
        );
        input.inventory_revision = 2;
        let preview = compute_bank_copy_remap_preview(&input);
        assert!(preview
            .blockers
            .contains(&BankCopyRemapBlocker::SnapshotRevisionMismatch));
    }

    #[test]
    fn static_and_flex_pools_are_independent() {
        let dest = snapshot(&[
            (
                SampleSlotKind::Static,
                3,
                true,
                Some(SampleReferenceStatus::Resolved),
            ),
            (SampleSlotKind::Flex, 3, false, None),
        ]);
        let preview = compute_bank_copy_remap_preview(&base_input(
            project_id("a"),
            project_id("b"),
            BankCopySlotPlacementPolicy::KeepThenLowestFree,
            snapshot(&[(
                SampleSlotKind::Flex,
                3,
                true,
                Some(SampleReferenceStatus::Resolved),
            )]),
            dest,
            vec![observation(
                ReferenceScopeRole::SourceContent,
                ReferenceOrigin::ActiveMachine,
                PartStateRole::Working,
                0,
                TrackSlotReference::Slot(slot(SampleSlotKind::Flex, 3)),
                Some(SampleReferenceStatus::Resolved),
            )],
        ));
        assert_eq!(preview.flex_remap_candidates.len(), 0);
        assert!(preview.unchanged_references.iter().any(|reference| {
            reference.source_slot == slot(SampleSlotKind::Flex, 3)
                && reference.disposition == SlotRemapDisposition::Unchanged
        }));
    }

    #[test]
    fn recorder_buffer_is_not_remap_candidate() {
        use ot_domain::RecorderBufferId;
        let snap = snapshot(&[]);
        let preview = compute_bank_copy_remap_preview(&base_input(
            project_id("same"),
            project_id("same"),
            BankCopySlotPlacementPolicy::PreserveSlotNumbers,
            snap.clone(),
            snap,
            vec![observation(
                ReferenceScopeRole::SourceContent,
                ReferenceOrigin::ActiveMachine,
                PartStateRole::Working,
                0,
                TrackSlotReference::RecorderBuffer(RecorderBufferId::new(129).unwrap()),
                None,
            )],
        ));
        assert!(preview.unchanged_references.is_empty());
        assert!(preview.unresolved_references.is_empty());
    }

    #[test]
    fn working_and_saved_part_observations_stay_separate() {
        let snap = snapshot(&[(
            SampleSlotKind::Static,
            2,
            true,
            Some(SampleReferenceStatus::Resolved),
        )]);
        let preview = compute_bank_copy_remap_preview(&base_input(
            project_id("same"),
            project_id("same"),
            BankCopySlotPlacementPolicy::PreserveSlotNumbers,
            snap.clone(),
            snap,
            vec![
                observation(
                    ReferenceScopeRole::SourceContent,
                    ReferenceOrigin::ActiveMachine,
                    PartStateRole::Working,
                    0,
                    TrackSlotReference::Slot(slot(SampleSlotKind::Static, 2)),
                    Some(SampleReferenceStatus::Resolved),
                ),
                observation(
                    ReferenceScopeRole::SourceContent,
                    ReferenceOrigin::SavedPartMachine,
                    PartStateRole::Saved,
                    0,
                    TrackSlotReference::Slot(slot(SampleSlotKind::Static, 2)),
                    Some(SampleReferenceStatus::Resolved),
                ),
            ],
        ));
        assert_eq!(preview.unchanged_references.len(), 2);
        assert_ne!(
            preview.unchanged_references[0].part_state,
            preview.unchanged_references[1].part_state
        );
    }

    #[test]
    fn bank_copy_remap_preview_module_has_no_write_syscalls_in_source() {
        let source = include_str!("bank_copy_remap_preview.rs");
        for line in source.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with("//")
                || trimmed.contains("forbidden in")
                || trimmed.starts_with('"')
            {
                continue;
            }
            for forbidden in [
                "to_data_file(",
                "fs::write(",
                "fs::rename(",
                "fs::remove_file(",
            ] {
                assert!(
                    !trimmed.contains(forbidden),
                    "forbidden token {forbidden} in code line: {trimmed}"
                );
            }
        }
    }

    #[test]
    fn bank_changeplan_alignment_uses_same_scoped_observations() {
        use crate::bank_changeplan::{plan_bank_change, BankChangeIntent, BankChangePlanningFacts};
        use crate::bank_mutation::{ManifestEntry, ReadinessEvidence, TreeManifest};
        use ot_domain::project_structure::{
            BankStructure, MachineKind, PartStructure, PatternPlaybackScale, PatternScale,
            PatternStructure, ProjectBankSelection, ProjectStateDocument, ProjectStructure,
            TrackPlayback, TrackStructure, BANK_UNMODELED_DEPENDENCIES,
        };
        use ot_domain::BankStateDocumentSet;
        use ot_domain::{BankReferenceInventory, BankSampleReferenceObservation, ContentHash};

        let source = BankIndex::new(0).unwrap();
        let destination = BankIndex::new(1).unwrap();
        let slot_ref = TrackSlotReference::Slot(slot(SampleSlotKind::Static, 9));
        let inventory = BankReferenceInventory {
            observed_revision: 7,
            observations: vec![BankSampleReferenceObservation {
                bank: source,
                document_role: StateDocumentRole::Working,
                origin: ReferenceOrigin::ActiveMachine,
                part_state: PartStateRole::Working,
                part: PartIndex::new(0).unwrap(),
                pattern: None,
                track: TrackIndex::new(0).unwrap(),
                step: None,
                target: slot_ref,
                audible: None,
                reference_status: Some(SampleReferenceStatus::Resolved),
                referenced_relative_path: None,
            }],
            coverage: ReferenceCoverage::complete_for_changeplan_review(),
        };
        let track = TrackStructure {
            index: TrackIndex::new(0).unwrap(),
            playback: TrackPlayback::Audio {
                machine: MachineKind::Static,
                slot: slot_ref,
            },
        };
        let bank_doc = |bank: BankIndex, role: StateDocumentRole, path: &str| BankStructure {
            bank,
            role,
            source_relative_path: RootRelativePath::parse(path).unwrap(),
            parse_status: ot_domain::StateDocumentParseStatus::Parsed,
            patterns: vec![PatternStructure {
                index: PatternIndex::new(0).unwrap(),
                part: PartIndex::new(0).unwrap(),
                scale: PatternScale::Normal {
                    master_length: 16,
                    master_scale: PatternPlaybackScale::Times1,
                },
            }],
            parts: vec![PartStructure {
                index: PartIndex::new(0).unwrap(),
                tracks: vec![track.clone()],
            }],
            unmodeled: BANK_UNMODELED_DEPENDENCIES.to_vec(),
        };
        let structure = ProjectStructure {
            project_relative_path: RootRelativePath::parse("SET/PROJECT").unwrap(),
            project_state: Some(ProjectStateDocument {
                role: StateDocumentRole::Working,
                source_relative_path: RootRelativePath::parse("SET/PROJECT/project.work").unwrap(),
                parse_status: ot_domain::StateDocumentParseStatus::Parsed,
                bank: Some(ProjectBankSelection::Selected(source)),
                pattern: None,
                arrangement: None,
                master_track: Some(false),
            }),
            banks: vec![
                bank_doc(
                    source,
                    StateDocumentRole::Working,
                    "SET/PROJECT/bank01.work",
                ),
                bank_doc(
                    source,
                    StateDocumentRole::SavedCheckpoint,
                    "SET/PROJECT/bank01.strd",
                ),
                bank_doc(
                    destination,
                    StateDocumentRole::Working,
                    "SET/PROJECT/bank02.work",
                ),
                bank_doc(
                    destination,
                    StateDocumentRole::SavedCheckpoint,
                    "SET/PROJECT/bank02.strd",
                ),
            ],
        };
        let mut manifest = TreeManifest::new();
        for (path, byte) in [
            ("SET/PROJECT/project.work", 1u8),
            ("SET/PROJECT/bank01.work", 2),
            ("SET/PROJECT/bank01.strd", 3),
            ("SET/PROJECT/bank02.work", 4),
            ("SET/PROJECT/bank02.strd", 5),
        ] {
            manifest.insert(
                RootRelativePath::parse(path).unwrap(),
                ManifestEntry::File {
                    byte_size: 10,
                    content_hash: ContentHash::parse(format!(
                        "sha256:{}",
                        format!("{byte:02x}").repeat(32)
                    ))
                    .unwrap(),
                },
            );
        }
        let facts = BankChangePlanningFacts {
            root_id: RootId::new("root-session-1").unwrap(),
            device_fingerprint: format!("rootfp:v1:{}", "a".repeat(64)),
            observed_revision: 7,
            identity_is_stable: true,
            read_model_schema: "masterocta.project-structure:v4".to_owned(),
            project_relative_path: RootRelativePath::parse("SET/PROJECT").unwrap(),
            project_structure: structure,
            scope_manifest: manifest,
            source_presence: BankStateDocumentSet::new(source, true, true),
            destination_presence: BankStateDocumentSet::new(destination, true, true),
            reference_inventory: inventory.clone(),
        };
        let plan = plan_bank_change(
            BankChangeIntent::Copy {
                source,
                destination,
            },
            &facts,
            &ReadinessEvidence::current_main(),
        )
        .unwrap();
        let snap = snapshot(&[(
            SampleSlotKind::Static,
            9,
            true,
            Some(SampleReferenceStatus::Resolved),
        )]);
        let preview = compute_bank_copy_remap_preview(&preview_input_from_inventory(
            project_id("same"),
            project_id("same"),
            source,
            destination,
            StateDocumentRole::Working,
            StateDocumentRole::Working,
            snap.clone(),
            snap,
            &inventory,
            BankCopySlotPlacementPolicy::PreserveSlotNumbers,
            MasterTrackSetting::Disabled,
            BankCopyDocumentHealth::Ok,
            BankCopyDocumentHealth::Ok,
        ));
        let scoped = scoped_observations(&inventory, source, destination);
        assert_eq!(scoped, plan.reference_observations);
        assert_eq!(preview.unchanged_references[0].source_slot.number(), 9);
    }
}
