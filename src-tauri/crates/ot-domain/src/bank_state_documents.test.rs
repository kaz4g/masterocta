use crate::bank_state_documents::{
    evaluate_bank_operation_state_effect, swap_aligned_role_pairings,
    swap_banks_have_symmetric_role_presence, validate_swap_role_pairings, ActiveBankRetarget,
    BankStateDocOperation, BankStateDocumentPresence, BankStateDocumentRef, BankStateDocumentSet,
    CopySavedCheckpointSemantics, MissingPairStop, PresencePrecondition, StateDocOperationBlockReason,
    StateDocOperationVerdict, StateDocRuleStatus, SwapRolePair, ACTIVE_BANK_RETARGET_RULE,
    COPY_STATE_DOC_RULE,
};
use crate::project_structure::BankIndex;
use crate::StateDocumentRole;

fn bank(n: u8) -> BankIndex {
    BankIndex::new(n).unwrap()
}

#[test]
fn work_and_strd_are_separate_roles_in_a_set() {
    let set = BankStateDocumentSet::new(bank(0), true, true);
    assert_eq!(set.presence(), BankStateDocumentPresence::Both);
    assert!(set.has_role(StateDocumentRole::Working));
    assert!(set.has_role(StateDocumentRole::SavedCheckpoint));
}

#[test]
fn saved_checkpoint_is_not_promoted_when_working_is_absent() {
    let set = BankStateDocumentSet::new(bank(0), false, true);
    assert!(!set.has_role(StateDocumentRole::Working));
    assert_eq!(
        set.presence_precondition(),
        PresencePrecondition::Stop(MissingPairStop::SavedCheckpointOnly)
    );
}

#[test]
fn copy_lists_destination_roles_present_on_source_deterministically() {
    let source = BankStateDocumentSet::new(bank(0), true, true);
    let dest = BankStateDocumentSet::new(bank(3), false, false);
    let effect = evaluate_bank_operation_state_effect(
        BankStateDocOperation::Copy,
        bank(0),
        bank(3),
        source,
        dest,
        Some(bank(0)),
    );
    assert_eq!(
        effect.candidate_documents,
        vec![
            BankStateDocumentRef {
                bank: bank(3),
                role: StateDocumentRole::Working,
            },
            BankStateDocumentRef {
                bank: bank(3),
                role: StateDocumentRole::SavedCheckpoint,
            },
        ]
    );
    assert_eq!(COPY_STATE_DOC_RULE, StateDocRuleStatus::Blocked);
    assert_eq!(
        effect.verdict,
        StateDocOperationVerdict::Blocked(
            StateDocOperationBlockReason::WorkingSavedCheckpointRuleUnresolved
        )
    );
    assert_eq!(
        effect.copy_saved_checkpoint_semantics,
        CopySavedCheckpointSemantics::Unknown
    );
}

#[test]
fn move_with_active_source_bank_marks_retarget_unknown() {
    let source = BankStateDocumentSet::new(bank(0), true, true);
    let dest = BankStateDocumentSet::new(bank(3), true, true);
    let effect = evaluate_bank_operation_state_effect(
        BankStateDocOperation::Move,
        bank(0),
        bank(3),
        source,
        dest,
        Some(bank(0)),
    );
    assert_eq!(effect.active_bank_retarget, ActiveBankRetarget::Unknown);
    assert_eq!(ACTIVE_BANK_RETARGET_RULE, StateDocRuleStatus::Blocked);
}

#[test]
fn swap_rejects_mismatched_role_presence() {
    let source = BankStateDocumentSet::new(bank(0), true, true);
    let dest = BankStateDocumentSet::new(bank(3), true, false);
    assert!(!swap_banks_have_symmetric_role_presence(&source, &dest));
    assert!(swap_aligned_role_pairings(&source, &dest).is_empty());
    let effect = evaluate_bank_operation_state_effect(
        BankStateDocOperation::Swap,
        bank(0),
        bank(3),
        source,
        dest,
        None,
    );
    assert_eq!(
        effect.verdict,
        StateDocOperationVerdict::Blocked(StateDocOperationBlockReason::SwapRolePresenceAsymmetric)
    );
    assert_eq!(
        effect.active_bank_retarget,
        ActiveBankRetarget::SelectionUnavailable
    );
}

#[test]
fn validate_swap_role_pairings_rejects_cross_role_mix() {
    let cross = SwapRolePair {
        source: BankStateDocumentRef {
            bank: bank(0),
            role: StateDocumentRole::Working,
        },
        destination: BankStateDocumentRef {
            bank: bank(3),
            role: StateDocumentRole::SavedCheckpoint,
        },
    };
    assert!(!validate_swap_role_pairings(bank(0), bank(3), &[cross]));
}

#[test]
fn mismatched_observation_bank_identity_fails_closed() {
    let observation = BankStateDocumentSet::new(bank(1), true, true);
    let effect = evaluate_bank_operation_state_effect(
        BankStateDocOperation::Move,
        bank(0),
        bank(3),
        observation,
        BankStateDocumentSet::new(bank(3), true, true),
        None,
    );
    assert_eq!(
        effect.verdict,
        StateDocOperationVerdict::Blocked(StateDocOperationBlockReason::BankIdentityMismatch)
    );
    assert!(effect.candidate_documents.is_empty());
}

#[test]
fn swap_pairs_only_matching_roles_not_cross_mix() {
    let source = BankStateDocumentSet::new(bank(0), true, true);
    let dest = BankStateDocumentSet::new(bank(3), true, true);
    let effect = evaluate_bank_operation_state_effect(
        BankStateDocOperation::Swap,
        bank(0),
        bank(3),
        source,
        dest,
        None,
    );
    for document in &effect.candidate_documents {
        assert!(matches!(
            document.role,
            StateDocumentRole::Working | StateDocumentRole::SavedCheckpoint
        ));
    }
    let roles_for_bank_a: Vec<_> = effect
        .candidate_documents
        .iter()
        .filter(|d| d.bank == bank(0))
        .map(|d| d.role)
        .collect();
    let roles_for_bank_d: Vec<_> = effect
        .candidate_documents
        .iter()
        .filter(|d| d.bank == bank(3))
        .map(|d| d.role)
        .collect();
    assert_eq!(roles_for_bank_a, roles_for_bank_d);
    assert_eq!(roles_for_bank_a.len(), 2);
}

#[test]
fn working_only_source_stops_before_operation_rule() {
    let source = BankStateDocumentSet::new(bank(0), true, false);
    let dest = BankStateDocumentSet::new(bank(3), false, false);
    let effect = evaluate_bank_operation_state_effect(
        BankStateDocOperation::Copy,
        bank(0),
        bank(3),
        source,
        dest,
        None,
    );
    assert_eq!(
        effect.verdict,
        StateDocOperationVerdict::Blocked(StateDocOperationBlockReason::PresenceStop(
            MissingPairStop::WorkingOnlyUnproven
        ))
    );
}
