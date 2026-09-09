#![forbid(unsafe_code)]

use crate::{RootRelativePath, SampleReferenceStatus};
use std::collections::HashSet;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ProjectReferenceSyntaxError;

/// Resolve a Project-relative `PATH=` value against the project directory.
pub fn resolve_project_reference_syntax(
    project_relative: &RootRelativePath,
    raw_path: &str,
) -> Result<RootRelativePath, ProjectReferenceSyntaxError> {
    let bytes = raw_path.as_bytes();
    if raw_path.starts_with(['/', '\\'])
        || (bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':')
        || raw_path.contains('\0')
    {
        return Err(ProjectReferenceSyntaxError);
    }
    let mut components = project_relative
        .as_str()
        .split('/')
        .map(str::to_owned)
        .collect::<Vec<_>>();
    for component in raw_path.split(['/', '\\']) {
        match component {
            "" => return Err(ProjectReferenceSyntaxError),
            "." => {}
            ".." => {
                if components.pop().is_none() {
                    return Err(ProjectReferenceSyntaxError);
                }
            }
            component => components.push(component.to_owned()),
        }
    }
    RootRelativePath::from_components(components).map_err(|_| ProjectReferenceSyntaxError)
}

/// Resolve syntax, then match against a root-relative inventory path set.
pub fn resolve_against_inventory(
    project_relative: &RootRelativePath,
    raw_path: &str,
    inventory_paths: &HashSet<String>,
) -> (Option<RootRelativePath>, SampleReferenceStatus) {
    if raw_path.is_empty() {
        return (None, SampleReferenceStatus::UnassignedSlot);
    }

    let resolved = match resolve_project_reference_syntax(project_relative, raw_path) {
        Ok(path) => path,
        Err(ProjectReferenceSyntaxError) => return (None, SampleReferenceStatus::InvalidPath),
    };

    if inventory_paths.contains(resolved.as_str()) {
        return (Some(resolved), SampleReferenceStatus::Resolved);
    }

    let case_insensitive_matches = inventory_paths
        .iter()
        .filter(|candidate| candidate.eq_ignore_ascii_case(resolved.as_str()))
        .collect::<Vec<_>>();

    match case_insensitive_matches.len() {
        0 => (Some(resolved), SampleReferenceStatus::Missing),
        1 => (
            RootRelativePath::parse(case_insensitive_matches[0].as_str())
                .map(Some)
                .unwrap_or(Some(resolved)),
            SampleReferenceStatus::Resolved,
        ),
        _ => (Some(resolved), SampleReferenceStatus::Ambiguous),
    }
}

/// Whether two inventory paths refer to the same file instance (exact or unique ASCII case).
pub fn inventory_paths_equivalent(left: &RootRelativePath, right: &RootRelativePath) -> bool {
    left == right || left.as_str().eq_ignore_ascii_case(right.as_str())
}

/// Whether a raw Project `PATH=` refers to the expected inventory file.
pub fn raw_path_matches_inventory_reference(
    project_relative: &RootRelativePath,
    raw_path: &str,
    expected_inventory_path: &RootRelativePath,
) -> Result<bool, ProjectReferenceSyntaxError> {
    let resolved = resolve_project_reference_syntax(project_relative, raw_path)?;
    Ok(inventory_paths_equivalent(
        &resolved,
        expected_inventory_path,
    ))
}
