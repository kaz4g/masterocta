use crate::reference_identity::{
    inventory_paths_equivalent, raw_path_matches_inventory_reference,
    resolve_against_inventory, resolve_project_reference_syntax,
};
use crate::{RootRelativePath, SampleReferenceStatus};
use std::collections::HashSet;

#[test]
fn unique_case_insensitive_inventory_match_resolves() {
    let project = RootRelativePath::parse("SET/PROJECT").unwrap();
    let inventory = HashSet::from(["SET/AUDIO/kick.wav".to_owned()]);
    let (path, status) = resolve_against_inventory(&project, "../AUDIO/KICK.wav", &inventory);
    assert_eq!(status, SampleReferenceStatus::Resolved);
    assert_eq!(path.unwrap().as_str(), "SET/AUDIO/kick.wav");
}

#[test]
fn ambiguous_case_inventory_blocks_resolution() {
    let project = RootRelativePath::parse("SET/PROJECT").unwrap();
    let inventory = HashSet::from([
        "SET/AUDIO/Kick.wav".to_owned(),
        "SET/AUDIO/kick.wav".to_owned(),
    ]);
    let (_, status) = resolve_against_inventory(&project, "../AUDIO/KICK.wav", &inventory);
    assert_eq!(status, SampleReferenceStatus::Ambiguous);
}

#[test]
fn prepare_contract_accepts_case_mismatch_between_syntax_and_inventory() {
    let project = RootRelativePath::parse("SET/PROJECT").unwrap();
    let expected = RootRelativePath::parse("SET/AUDIO/kick.wav").unwrap();
    assert!(raw_path_matches_inventory_reference(
        &project,
        "../AUDIO/KICK.wav",
        &expected
    )
    .unwrap());
}

#[test]
fn resolve_project_reference_syntax_rejects_absolute_paths() {
    assert!(
        resolve_project_reference_syntax(
            &RootRelativePath::parse("SET/PROJECT/project.work").unwrap(),
            "/absolute.wav"
        )
        .is_err()
    );
}

#[test]
fn inventory_paths_equivalent_matches_unique_ascii_case() {
    let left = RootRelativePath::parse("SET/AUDIO/kick.wav").unwrap();
    let right = RootRelativePath::parse("SET/AUDIO/KICK.WAV").unwrap();
    assert!(inventory_paths_equivalent(&left, &right));
}
