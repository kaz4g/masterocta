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
| Project bytes → META, SAMPLE classification, compatibility | `ot-codec::parse_project_document` | `masterocta/ot-codec-project` / `v1` |
| Surgical PATH rewrite (regular slots only) | `ot-codec::MemoryProjectReferenceCodec` | existing M5-B contract |
| Syntax + inventory reference resolution | `ot-codec::reference_resolution` | same as parser |
| Catalog persistence | `ot-catalog` / `legacy_read_adapter` | no re-interpretation |
| Bank binary decode | pinned `ot-tools-io` + `bank_validation` | header/version/slot bounds |

The shared Project parser accepts `&[u8]` only. It does not open filesystem paths,
Tauri handles, or SQLite.

## Slot classification

- **Regular slots:** `SampleSlotId` Static/Flex 1–128 with non-empty `PATH=` become
  catalog assignments and rename impact candidates.
- **Recorder buffers:** FLEX media slots 129–136 map to `RecorderBufferId` buffer
  1–8. `PATH=` may be empty or non-empty; blocks are preserved in source bytes but
  excluded from assignments, usage edges, and rename targets.
- **Invalid:** Static ≥129, Flex ≥137, slot 0, unknown `TYPE`, duplicate TYPE+SLOT,
  unclosed `[SAMPLE]`, irreversible Windows-1258 → `Malformed`.

## Compatibility (before upstream suffix alone)

Supported only when all hold:

1. `TYPE=OCTATRACK DPS-1 PROJECT`
2. `VERSION=19`
3. OS token parses as `R####` + ASCII spaces + release (`1.40`, `1.40A`, …)

Evidence:

- `UpstreamLibrary` when pinned `ot-tools-io` reports compatible **and** the above
  hold.
- `VerifiedMasterOctaFixture` for exact `R0173` / `1.40` + VERSION 19 when upstream
  reports unsupported.

Unknown VERSION → `UnsupportedVersion` (read-only). Malformed META/token →
`Malformed`.

## Reference identity

1. Resolve raw Project-relative `PATH=` syntax to a root-relative path.
2. Match inventory with exact path first, then ASCII case-insensitive **unique**
   match.
3. Multiple case-insensitive candidates → `Ambiguous` (edit blocked).
4. Same content hash at different paths remains distinct file instances.

Catalog, rename planning, Prepare, and Apply re-verification use the same rules.

## Coverage

Project discovery accepts directories with `project.work`, `project.strd`, or
`bank01.work`. Coverage is incomplete when:

- a discovered project lacks an indexed Working document while `has_project_file`
- a discovered project lacks an indexed SavedCheckpoint while `has_saved_checkpoint`
- bank-only layout exists without `project.work` / `project.strd`

Incomplete coverage blocks rename planning (`IncompleteSetProjectCoverage`).

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

## Bank checksum

Bank header and slot/part bounds are validated before `Parsed`. Checksum enforcement
for `.work` vs `.strd` roles remains **pending fixture evidence**; do not reject
banks solely on checksum until role-specific fixtures are recorded.
