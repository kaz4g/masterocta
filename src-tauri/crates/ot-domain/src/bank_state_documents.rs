//! Read-only semantics for Bank Working (`.work`) and SavedCheckpoint (`.strd`)
//! state documents. This module does not generate ChangePlans, touch the
//! filesystem, or authorize Apply.
//!
//! Evidence: tracked fixtures, PSE read model, and legacy writer behavior
//! documented in `docs/planning/PSE_BANK_STATE_DOC_SEMANTICS.md`.

use crate::{project_structure::BankIndex, RootRelativePath, StateDocumentRole};

/// Which on-media Bank state files exist for one Bank index.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum BankStateDocumentPresence {
    Both,
    WorkingOnly,
    SavedCheckpointOnly,
    Neither,
}

impl BankStateDocumentPresence {
    pub fn from_flags(working_present: bool, saved_checkpoint_present: bool) -> Self {
        match (working_present, saved_checkpoint_present) {
            (true, true) => Self::Both,
            (true, false) => Self::WorkingOnly,
            (false, true) => Self::SavedCheckpointOnly,
            (false, false) => Self::Neither,
        }
    }
}

/// Observed Working / SavedCheckpoint files for one Bank slot.
///
/// Missing roles are not inferred from the sibling role.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct BankStateDocumentSet {
    pub bank: BankIndex,
    pub working_present: bool,
    pub saved_checkpoint_present: bool,
}

impl BankStateDocumentSet {
    pub fn new(bank: BankIndex, working_present: bool, saved_checkpoint_present: bool) -> Self {
        Self {
            bank,
            working_present,
            saved_checkpoint_present,
        }
    }

    pub fn presence(&self) -> BankStateDocumentPresence {
        BankStateDocumentPresence::from_flags(self.working_present, self.saved_checkpoint_present)
    }

    pub fn has_role(&self, role: StateDocumentRole) -> bool {
        match role {
            StateDocumentRole::Working => self.working_present,
            StateDocumentRole::SavedCheckpoint => self.saved_checkpoint_present,
        }
    }
}

/// Whether a ChangePlan generator may proceed past presence checks alone.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PresencePrecondition {
    /// Both roles present on a tracked real-device fixture path.
    ObservedPair,
    /// Presence pattern is not proven safe for planning (fail-closed).
    Stop(MissingPairStop),
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MissingPairStop {
    /// `.work` without sibling `.strd` (synthetic fixture only; device norm unproven).
    WorkingOnlyUnproven,
    /// `.strd` without sibling `.work` (not observed as device-generated in tracked fixtures).
    SavedCheckpointOnly,
    /// No Bank state files at this index.
    NeitherDocuments,
}

impl BankStateDocumentSet {
    pub fn presence_precondition(&self) -> PresencePrecondition {
        match self.presence() {
            BankStateDocumentPresence::Both => PresencePrecondition::ObservedPair,
            BankStateDocumentPresence::WorkingOnly => {
                PresencePrecondition::Stop(MissingPairStop::WorkingOnlyUnproven)
            }
            BankStateDocumentPresence::SavedCheckpointOnly => {
                PresencePrecondition::Stop(MissingPairStop::SavedCheckpointOnly)
            }
            BankStateDocumentPresence::Neither => {
                PresencePrecondition::Stop(MissingPairStop::NeitherDocuments)
            }
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum BankStateDocOperation {
    Copy,
    Move,
    Swap,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum StateDocRuleStatus {
    Ready,
    Blocked,
}

pub const COPY_STATE_DOC_RULE: StateDocRuleStatus = StateDocRuleStatus::Blocked;
pub const MOVE_STATE_DOC_RULE: StateDocRuleStatus = StateDocRuleStatus::Blocked;
pub const SWAP_STATE_DOC_RULE: StateDocRuleStatus = StateDocRuleStatus::Blocked;
pub const ACTIVE_BANK_RETARGET_RULE: StateDocRuleStatus = StateDocRuleStatus::Blocked;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CopySavedCheckpointSemantics {
    Unknown,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ActiveBankRetarget {
    /// Active bank selection follow-up is not decided (`[STATES] BANK`).
    Unknown,
    /// Operation does not involve the active bank index.
    NotApplicable,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum StateDocOperationVerdict {
    Blocked(StateDocOperationBlockReason),
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum StateDocOperationBlockReason {
    OperationRuleBlocked,
    WorkingSavedCheckpointRuleUnresolved,
    PresenceStop(MissingPairStop),
    CrossRolePairRejected,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BankStateDocumentRef {
    pub bank: BankIndex,
    pub role: StateDocumentRole,
}

/// Deterministic, read-only projection of which Bank state documents an
/// operation would concern. Does not authorize writes.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BankOperationStateEffect {
    pub operation: BankStateDocOperation,
    pub source: BankIndex,
    pub destination: BankIndex,
    pub source_presence: BankStateDocumentSet,
    pub destination_presence: BankStateDocumentSet,
    pub active_bank: Option<BankIndex>,
    pub candidate_documents: Vec<BankStateDocumentRef>,
    pub verdict: StateDocOperationVerdict,
    pub copy_saved_checkpoint_semantics: CopySavedCheckpointSemantics,
    pub active_bank_retarget: ActiveBankRetarget,
}

pub fn bank_state_document_file_name(bank: BankIndex, role: StateDocumentRole) -> String {
    let extension = match role {
        StateDocumentRole::Working => "work",
        StateDocumentRole::SavedCheckpoint => "strd",
    };
    format!("bank{:02}.{}", bank.file_number(), extension)
}

pub fn bank_state_document_path(
    project_relative_path: &RootRelativePath,
    bank: BankIndex,
    role: StateDocumentRole,
) -> RootRelativePath {
    let file_name = bank_state_document_file_name(bank, role);
    let components = project_relative_path
        .as_str()
        .split('/')
        .chain([file_name.as_str()]);
    RootRelativePath::from_components(components)
        .expect("bank state document names are single relative components")
}

const BANK_STATE_ROLES: [StateDocumentRole; 2] = [
    StateDocumentRole::Working,
    StateDocumentRole::SavedCheckpoint,
];

fn push_if_present(
    out: &mut Vec<BankStateDocumentRef>,
    set: &BankStateDocumentSet,
    role: StateDocumentRole,
) {
    if set.has_role(role) {
        out.push(BankStateDocumentRef {
            bank: set.bank,
            role,
        });
    }
}

fn copy_candidate_documents(
    source: &BankStateDocumentSet,
    destination: BankIndex,
) -> Vec<BankStateDocumentRef> {
    let mut out = Vec::new();
    for role in BANK_STATE_ROLES {
        if source.has_role(role) {
            out.push(BankStateDocumentRef {
                bank: destination,
                role,
            });
        }
    }
    out.sort_by(|left, right| {
        left.bank
            .get()
            .cmp(&right.bank.get())
            .then_with(|| role_order(left.role).cmp(&role_order(right.role)))
    });
    out
}

fn move_or_swap_candidate_documents(
    left: &BankStateDocumentSet,
    right: &BankStateDocumentSet,
) -> Vec<BankStateDocumentRef> {
    let mut out = Vec::new();
    for role in BANK_STATE_ROLES {
        if left.has_role(role) {
            push_if_present(&mut out, left, role);
        }
        if right.has_role(role) {
            push_if_present(&mut out, right, role);
        }
    }
    out.sort_by(|a, b| {
        a.bank
            .get()
            .cmp(&b.bank.get())
            .then_with(|| role_order(a.role).cmp(&role_order(b.role)))
    });
    out
}

fn role_order(role: StateDocumentRole) -> u8 {
    match role {
        StateDocumentRole::Working => 0,
        StateDocumentRole::SavedCheckpoint => 1,
    }
}

fn active_bank_retarget_for_move_or_swap(
    operation: BankStateDocOperation,
    source: BankIndex,
    destination: BankIndex,
    active_bank: Option<BankIndex>,
) -> ActiveBankRetarget {
    let _ = operation;
    match active_bank {
        Some(active) if active == source => ActiveBankRetarget::Unknown,
        Some(active) if active == destination && operation == BankStateDocOperation::Swap => {
            ActiveBankRetarget::Unknown
        }
        Some(_) => ActiveBankRetarget::NotApplicable,
        None => ActiveBankRetarget::NotApplicable,
    }
}

fn operation_rule_status(operation: BankStateDocOperation) -> StateDocRuleStatus {
    match operation {
        BankStateDocOperation::Copy => COPY_STATE_DOC_RULE,
        BankStateDocOperation::Move => MOVE_STATE_DOC_RULE,
        BankStateDocOperation::Swap => SWAP_STATE_DOC_RULE,
    }
}

fn finalize_verdict(
    operation: BankStateDocOperation,
    source_presence: BankStateDocumentSet,
    destination_presence: BankStateDocumentSet,
) -> StateDocOperationVerdict {
    if let PresencePrecondition::Stop(stop) = source_presence.presence_precondition() {
        return StateDocOperationVerdict::Blocked(StateDocOperationBlockReason::PresenceStop(stop));
    }
    if operation != BankStateDocOperation::Copy {
        if let PresencePrecondition::Stop(stop) = destination_presence.presence_precondition() {
            return StateDocOperationVerdict::Blocked(StateDocOperationBlockReason::PresenceStop(
                stop,
            ));
        }
    }
    if operation_rule_status(operation) == StateDocRuleStatus::Blocked {
        return StateDocOperationVerdict::Blocked(
            StateDocOperationBlockReason::WorkingSavedCheckpointRuleUnresolved,
        );
    }
    StateDocOperationVerdict::Blocked(StateDocOperationBlockReason::OperationRuleBlocked)
}

/// Returns false when a swap plan would cross-mix roles (for example pairing
/// source Working with destination SavedCheckpoint).
pub fn swap_preserves_role_pairs(
    source: &BankStateDocumentSet,
    destination: &BankStateDocumentSet,
) -> bool {
    for role in BANK_STATE_ROLES {
        let source_has = source.has_role(role);
        let dest_has = destination.has_role(role);
        if source_has != dest_has {
            return false;
        }
    }
    true
}

pub fn evaluate_bank_operation_state_effect(
    operation: BankStateDocOperation,
    source: BankIndex,
    destination: BankIndex,
    source_presence: BankStateDocumentSet,
    destination_presence: BankStateDocumentSet,
    active_bank: Option<BankIndex>,
) -> BankOperationStateEffect {
    let source_presence = BankStateDocumentSet::new(
        source,
        source_presence.working_present,
        source_presence.saved_checkpoint_present,
    );
    let destination_presence = BankStateDocumentSet::new(
        destination,
        destination_presence.working_present,
        destination_presence.saved_checkpoint_present,
    );

    let mut verdict = finalize_verdict(operation, source_presence, destination_presence);
    if operation == BankStateDocOperation::Swap
        && !swap_preserves_role_pairs(&source_presence, &destination_presence)
    {
        verdict =
            StateDocOperationVerdict::Blocked(StateDocOperationBlockReason::CrossRolePairRejected);
    }

    let candidate_documents = match operation {
        BankStateDocOperation::Copy => copy_candidate_documents(&source_presence, destination),
        BankStateDocOperation::Move | BankStateDocOperation::Swap => {
            move_or_swap_candidate_documents(&source_presence, &destination_presence)
        }
    };

    let active_bank_retarget = match operation {
        BankStateDocOperation::Copy => ActiveBankRetarget::NotApplicable,
        BankStateDocOperation::Move | BankStateDocOperation::Swap => {
            active_bank_retarget_for_move_or_swap(operation, source, destination, active_bank)
        }
    };

    let copy_saved_checkpoint_semantics = CopySavedCheckpointSemantics::Unknown;

    BankOperationStateEffect {
        operation,
        source,
        destination,
        source_presence,
        destination_presence,
        active_bank,
        candidate_documents,
        verdict,
        copy_saved_checkpoint_semantics,
        active_bank_retarget,
    }
}
