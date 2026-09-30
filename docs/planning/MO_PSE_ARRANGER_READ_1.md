# MO-PSE-ARRANGER-READ-1 — Arranger Bank/Pattern evidence

Work ID: `MO-PSE-ARRANGER-READ-1`

Judgment recorded with this note:

```text
ARRANGER_READ = STOP_WITH_FINDINGS
BANK_MOVE_SWAP_PLANNING = NOT_READY
```

Bank ChangePlan, Bank Move, and Bank Swap are not implemented.

Pinned parser: `ot-tools-io` rev `cd246d8a595647364eb4cc78211033b2d1302526`.

Tracked fixture used for reproduction: `src-tauri/tests/fixtures/real_device/arr01.work`
(SHA-256 `e21ee32c5571a9c0b8c89cf3877fc1fae20dce25c158e0d6dfc6cb90a165a80c`, 11336 bytes).
The file was copied into a temporary directory before decode. The tracked bytes were only hashed.

## What is known

| Field | Source | Confidence | Modeled? |
| --- | --- | --- | --- |
| File names `arr01.work`..=`arr08.work` | ot-tools-io blank project has all eight; `arrangements_saved_state` is `[u8; 8]` | HIGH for the filename slot | YES, as `ArrangementFileIndex` (file name only) |
| Header `FORM….DPS1ARRA` and datatype version `6` | `ARRANGEMENT_FILE_HEADER`, `ARRANGEMENT_FILE_VERSION` | HIGH | YES, as a gate (malformed / unsupported) |
| Two blocks inside one `.work` file | `arrangement_state_current` (library: Project Menu SYNC TO CARD), `arrangement_state_previous` (library: Arranger Menu SAVE) | HIGH as parser fields; the save-menu comment is library evidence | NO roles copied from Bank `.work`/`.strd` |
| Raw checksum (byte sum of payload, big-endian trailer) | ot-tools-io `raw_file_verification` | HIGH for the algorithm | YES, mismatch is `Malformed` |
| `ArrangeRow` type byte 0 / 1 / 2 | deserializer | HIGH as the parser's classification | NO row enum in this domain |
| `pattern_id: u8` on type 0 | deserializer reads `row_data[0]` | HIGH that the parser has this byte | NO `BankIndex` / `PatternIndex` |
| `n_rows == 0` means both 0 rows and 256 rows | `ArrangementBlock::n_rows` warning; deserializer treats `i >= n_rows` as `EmptyRow`, so 0 discards every row | HIGH | Raw `n_rows` kept only inside `ReferencesWithheld`; zero is ambiguous, not "empty" |
| No `arr*.strd` in the pinned library tree | `find` over that checkout returned 0 | HIGH for that tree | `.strd` siblings are ignored |
| Library README: `.strd` files are copies of `.work` on project save, which is why arrangement tests are `.work` only | `test-data/arrange/README.md` (OS 1.40B) | MEDIUM as a general statement, not a second Arranger role | Bank Working/SavedCheckpoint is not copied onto Arranger |

## What the tracked fixture shows

Copied `arr01.work` decodes with header ok, datatype version 6, raw checksum ok (`checksum == 6`), `saved_flag == 0`, `arrangements_saved_state` all zeros, both blocks `n_rows == 0`, and the parser then reports 256 `EmptyRow` values. The 5632-byte row region of each block is entirely `0x00`.

That observation does not prove an empty arrangement. Because `n_rows == 0` is defined as ambiguous, and because a type byte of `0` is a pattern row, treating those zero bytes as pattern references would invent `pattern_id == 0` rows. The inspection result is `ReferencesWithheld` with ambiguous row counts. It does not report "no Bank references".

## What is not proven

| Field | Why it stays unmapped |
| --- | --- |
| `pattern_id` → Bank A–P and Pattern 1–16 | Struct comment says "indexed from 0 (A01) -> 256 (P16)". A `u8` cannot be 256. If `0` were A01, `255` would be P16 (`16 * 16 - 1`). Library YAML (OS 1.40B, not in this repo) uses `pattern_id` 0, 1, and 255. `1-pattern.yaml` and `4-patterns.yaml` both use `pattern_id: 1`, and the file name does not say A01 versus A02. No device UI label is stored with the tracked fixture. |
| 0-based versus 1-based | Not proven. `project.work` `[STATES] BANK=` being treated as 0-based by the legacy reader is a different field and is not applied here. |
| `pattern_id == 255` | Could be P16 or a sentinel. It is not interpreted as a normal Bank/Pattern. |
| Scene A/B (`scene_a`, `scene_b`) | Library field comment only. `1-pattern.yaml` stores 255. Not a Scene reference. |
| Tempo, offset, length, repetitions, mute, MIDI transpose, loop/jump/halt, reminder text, names, `saved_flag`, `unk*` | Parser fields exist. They are not required to list Bank references, and several comments still say the combination rule is unknown. Left unmodeled. |
| Bank-style `.strd` checkpoint for Arranger | Not created. The two blocks inside `.work` are not re-labeled Working and SavedCheckpoint. A copied `arr01.strd` is ignored. |
| Missing `arrNN.work` | Absent file. An empty arrangement is not synthesized. |
| Bank internal identity | Still `UNKNOWN`. This repo's fixtures only contain `bank01`. A synthetic `bank01` → `bank02` copy would not prove that a Bank file lacks an internal index. |

## Parser limits that block a reference graph

- Non-blank arrangement checksum tests in ot-tools-io are `#[ignore]` because deserialize-then-serialize drops data. This reader never re-encodes.
- `ArrangementFile`'s binary deserializer advances 5650 bytes per block while allocating a 5652-byte buffer (`TODO: Is this a bug?`). Block decode failure becomes `Default` (`TODO: Error instead of Default`).
- Rows at indexes `>= n_rows` are replaced with `EmptyRow`, so the parser does not retain the bytes it skipped.

Those limits are why a decoded file still returns `ReferencesWithheld` instead of a row list.

## Domain surface

`ot_domain::arrangement` exposes:

- `ArrangementFileIndex` for `arr01`..=`arr08`
- `ArrangementInspection::{Malformed, UnsupportedVersion, ReferencesWithheld}`

`ReferencesWithheld` stores the datatype version and the two raw `n_rows` bytes. It has no Bank or Pattern index. `v2_project_structure_read` is unchanged.

The backend reader only opens regular files under the registered root and the project-relative path. Symlinks are absent. There is no write API.

## `project.work` `[STATES]`

`tests/fixtures/real_device/project.work` contains `BANK=0`, `PATTERN=0`, `ARRANGEMENT=0`, `ARRANGEMENT_MODE=0`. ot-tools-io `projects::states::State` types those keys as the current UX selection (`bank`, `pattern`, `arrangement`, `arrangement_mode`). The legacy reader uses `project.states.bank + 1` when choosing `bankNN.work` (`project_reader.rs`). That comment is existing-code evidence for the project state text, not for arranger `pattern_id`.

A safe read model for `[STATES]` is a separate unit: `MO-PSE-PROJECT-STATE-READ-1`.

## Still required before Bank ChangePlan

```text
project.work [STATES]
Bank internal identity
Scene / other unmodeled external references
Arranger pattern_id mapping, with a labeled fixture
```

Additional fixture needed before any mapping: an arrangement captured with the device UI labels for at least two rows (different banks and patterns), plus the case `n_rows == 0` on a file the device shows as empty and, separately, a 256-row arrangement if the device can save one. `pattern_id` 0, 1, and 255 each need a label.

Next Work ID: `MO-PSE-PROJECT-STATE-READ-1`.

Do not start `MO-PSE-BANK-CHANGEPLAN-1` from this unit.
