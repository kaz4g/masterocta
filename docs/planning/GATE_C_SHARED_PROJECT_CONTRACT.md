# Gate C shared Project / reference contract

- Status: implementation contract (post-RC6 remediation)
- Scope: read/catalog/rename shared semantics for Project `.work` / `.strd`
- Non-scope: Human Gate C PASS, RC6 identity changes, media writes

## Purpose

Human Gate C on RC6 observed a legitimate Project blocked from write mode because
FLEX recorder buffer slot 133 carried a non-empty `PATH=` while the legacy reader
treated it as a regular `SampleSlotId` and marked the whole Project `Malformed`.
This document records the shared contract that replaces that split behavior.

## Parser ownership

| Responsibility | Owner | Revision |
|---|---|---|
| Reversible Windows-1258 + SAMPLE structure scan | `ot-codec::project_structure` | shared with reader + rewrite |
| Project bytes → META, compatibility, assignments | `ot-codec::parse_project_document` | `masterocta/ot-codec-project` / `v2` |
| Surgical PATH rewrite (regular slots only) | `ot-codec::MemoryProjectReferenceCodec` | existing M5-B contract |
| Syntax + inventory reference identity | `ot-domain::reference_identity` | re-exported by `ot-codec::reference_resolution` |
| Catalog persistence | `ot-catalog` / `legacy_read_adapter` | no re-interpretation |
| Bank binary decode + bounds | pinned `ot-tools-io` + `bank_validation` | `masterocta/bank-validation` / `v1` |

The shared structure parser accepts `&[u8]` only, validates reversible Windows-1258,
and tracks PATH byte ranges in the source buffer (not decoded UTF-8 offsets alone).
Neither parser nor rewrite opens filesystem paths, Tauri handles, or SQLite.

## Slot classification

- **Regular slots:** `SampleSlotId` Static/Flex 1–128 with non-empty `PATH=` become
  catalog assignments and rename impact candidates.
- **Recorder buffers:** FLEX media slots 129–136 map to `RecorderBufferId` buffer
  1–8. `PATH=` may be empty or non-empty; blocks are preserved in source bytes but
  excluded from assignments, usage edges, and rename targets.
- **Invalid:** Static ≥129, Flex ≥137, slot 0, unknown `TYPE`, duplicate TYPE+SLOT,
  unclosed `[SAMPLE]`, irreversible Windows-1258 → `Malformed`.

## Required Project containers

Before SAMPLE scan or compatibility evidence, the codec requires exactly one each of
closed, non-nested:

- `[META]` … `[/META]`
- `[SETTINGS]` … `[/SETTINGS]`
- `[STATES]` … `[/STATES]`

`[SAMPLE]` blocks are 0..N. Missing, duplicate, unclosed, or nested required
containers → `Malformed`. Optional fields inside containers (for example SAMPLE
`TRIGQUANTIZATION`) are not required.

## Compatibility (structure + version candidate)

Supported only when all hold:

1. Required containers above are valid
2. `TYPE=OCTATRACK DPS-1 PROJECT`
3. `VERSION=19`
4. OS token parses as `R####` + ASCII spaces + release (`1.40`, `1.40A`, …)

Evidence (never inferred from release suffix alone in the codec):

- `VerifiedMasterOctaFixture` for exact `R0173` / `1.40` + VERSION 19
- `UpstreamLibrary` only after catalog scan copies bytes to a TempDir and pinned
  `ProjectFile` succeeds for upstream-candidate releases (`1.40A`, `1.40B`, `1.40C`)

Unknown VERSION or release → `UnsupportedVersion` (read-only). Malformed META or
unparseable OS token → `Malformed`.

## Reference identity

Contract owner: `ot-domain::reference_identity` (exact → unique ASCII case →
`Ambiguous`). Steps:

1. Resolve raw Project-relative `PATH=` syntax to a root-relative path.
2. Match inventory with exact path first, then ASCII case-insensitive **unique**
   match.
3. Multiple case-insensitive candidates → `Ambiguous` (edit blocked).
4. Same content hash at different paths remains distinct file instances.

Rename planning treats `Ambiguous` assignments that case-match the rename source as
unresolved. Prepare proves backup `PATH=` bytes against the approved source using
`raw_path_matches_inventory_reference` (unique case match allowed; basename-only
lowercasing forbidden).

Catalog, rename planning, Prepare, and Apply re-verification use the same rules.
`ot-executor` does not depend on `ot-codec` directly.

## Coverage and discovery flags

| Flag | Meaning |
|---|---|
| `has_project_file` | `project.work` exists (Working) |
| `has_saved_checkpoint` | `project.strd` exists (SavedCheckpoint) |
| `has_banks` | any `bank01`–`bank16` `.work` or `.strd` exists |

Project discovery accepts directories with any of the above. **Usage graph
completeness** and **set project coverage** are separate:

- Coverage incomplete when a flagged Working/Saved document is missing from the
  indexed catalog projection, or when bank-only layout exists without either
  `project.work` or `project.strd`.
- Usage graph incomplete when coverage is incomplete, indexed bank documents are
  missing/unparsed while `has_banks`, or Working project documents are missing while
  `has_project_file`.

Empty topology → both incomplete (no vacuous `.all()` on empty sets).
Incomplete coverage blocks rename planning (`IncompleteSetProjectCoverage`);
incomplete usage blocks with `IncompleteUsageGraph`.

## Rename plan schema

- Canonical prefix: `masterocta:rename-impact-plan:v2`
- Plan ID includes Static/Flex kind in reference-update hashing and sort keys.
- Prepared snapshots using v1 plan IDs are rejected with `PLAN_SCHEMA_MISMATCH`;
  operators must re-plan. Recovery from backup bytes is unchanged.

## Human Gate C observation (user-provided)

During RC6 clone-load smoke, Edit mode reported unsupported/malformed catalog state
for a Project whose `.work` / `.strd` pair matched the 12-SAMPLE layout with FLEX
129–136 and a non-empty PATH on slot 133. This contract targets that false
`Malformed` without claiming a re-run of Human Gate C.

## Bank machine slot numbering

Evidence from tracked fixtures and `ot-tools-io` decode (not Elektron spec):

| Domain | Index range | Notes |
|---|---|---|
| Project `SLOT=` | 1–128 Static/Flex | 1-based in text |
| Project recorder buffers | FLEX 129–136 | `RecorderBufferId`, excluded from rename |
| Bank machine static/flex raw | 0–127, 255 | 0 = slot 1; 255 = unassigned |
| Bank flex observed recorder range | 129–136 | parseable, excluded from regular usage |
| Bank raw ≥128 (except 129–136 flex) | — | not mapped to regular usage |

Usage is built from the same in-memory `BankFile` immediately after decode +
validation. Bank machine types must be known values 0–4 (Static, Flex, Thru,
Neighbor, Pickup per pinned `ot-tools-io`); any other value → Bank not `Parsed` and
usage/rename gates stay incomplete.

## Parser provenance by document kind

| Document / artifact | `parser_name` | `parser_revision` | Notes |
|---|---|---|---|
| Project `.work` / `.strd` | `masterocta/ot-codec-project` | `v2` | includes compatibility evidence when verified |
| Bank decode failure | `masterocta/ot-tools-io-bank` | `v1` | no `source_version`, no validator success |
| Bank after validation | `masterocta/bank-validation` | `v1` | decode succeeded |
| `.ot` sidecar / slot-local settings | `masterocta/sample-settings` | `v1` | does not copy Project parser name |

## Catalog migration trust (0010 + 0011)

Migration `0008` FK handling was corrected (FK toggle outside immediate TX). Migration
`0011` records `catalog_meta.observational_projection_repair_applied` and, **once per
database in the same transaction as applying 0011**, marks existing roots with
`observational_projection_untrusted = 1` when the pre-upgrade schema was ≥ 8. Reopen
after repair does not re-untrust rescanned roots. Fresh migrations from v7 and below
retain data and stay trusted. Full rescan success (`replace_projection`) is the only
per-root trust recovery. Write/plan/prepare paths fail closed while untrusted.
**No user production DB migration is applied from this remediation branch.**

## Bank checksum

Bank header and slot/part bounds are validated before `Parsed`. Checksum enforcement
for `.work` vs `.strd` roles remains **pending fixture evidence**; do not reject
banks solely on checksum until role-specific fixtures are recorded.
