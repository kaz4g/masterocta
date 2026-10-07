# PSE Arrangement real-device capture harness

Work ID: `MO-PSE-PROJECT-STATE-ARRANGEMENT-EVIDENCE-1`  
GitHub: [#204](https://github.com/kaz4g/masterocta/issues/204) (child of [#181](https://github.com/kaz4g/masterocta/issues/181))

This directory is a waiting receptacle. It does not contain a device copy.
`project.work` `[STATES] ARRANGEMENT` stays `Unmapped(raw)` until labeled
copies are inspected. Do not infer a slot mapping from this harness.

```text
CAPTURE_STATUS = WAITING_FOR_REAL_DEVICE
ARRANGEMENT_MAPPING = UNKNOWN
DOMAIN_CHANGED = NO
```

## Disposable project declaration

- Create a new disposable project on the Octatrack. Do not reuse a live
  project, a production project, or the Bank-evidence project `P_TEST`.
- Project name: `P_ARR_TEST`.
- Edit only on the device. Do not rewrite `project.work` or `arrNN.work`
  on the Mac.
- Original CF/media stays read-only on the Mac. Copy the disposable project
  off the card. Do not scan or hash the mounted card from this repository.
- Do not record the card mount path or any absolute machine path in
  `capture.meta.json`.

## Device (fill when the copy arrives)

| Field | Value |
| --- | --- |
| Device | Octatrack MkII |
| OS | operator reads the device OS screen into `os_version` |
| Project | `P_ARR_TEST` |
| Capture date | operator fills `capture_date` per capture |

## Forbidden

- Python, hex, or serializer edits to arrangement or project bytes
- Renaming another fixture to look like an Arrangement capture
- Using a synthetic `ARRANGEMENT=` value as mapping proof
- Treating AppleDouble (`._*`) or `.DS_Store` as Octatrack files
- Filling `expected_arrangement_index` from a parsed raw value

`expected_arrangement_index` is fixed from the UI choice before analysis:
Arrangement 1 → 0, Arrangement 2 → 1, Arrangement 8 → 7.

## Where to put the copies

Copy each saved project **directory contents** into the matching capture
directory, next to the existing `capture.meta.json`. Do not nest another
project folder. Do not delete or replace `capture.meta.json`.

| Capture | UI Arrangement | Directory |
| --- | --- | --- |
| A | 1 | `arrangement_1/` |
| B | 2 | `arrangement_2/` |
| C | 8 | `arrangement_8/` |

After the copy, `arrangement_1/project.work` must exist beside
`arrangement_1/capture.meta.json`. The same layout applies to B and C.

## Device steps

1. On Octatrack MkII, create a new project named `P_ARR_TEST`.
2. Arrangement 1: set row 1 to Bank A Pattern 1. Perform the device's normal
   project save. Copy the project directory contents into `arrangement_1/`.
3. On the same project, Arrangement 2: set row 1 to Bank A Pattern 2. Save
   again. Copy into `arrangement_2/` as a separate tree. Do not overwrite
   capture A.
4. Arrangement 8: set row 1 to Bank A Pattern 8. Save again. Copy into
   `arrangement_8/`.
5. In each `capture.meta.json`, record the OS string, the exact save action
   names, and the capture date. Set `device_generated` to `true` only after
   that copy exists. Leave `synthetic_modification` at `false`.

The row edits exist so `arr01.work`, `arr02.work`, and `arr08.work` can be
told apart later. They are not an Arranger `pattern_id` study.

## Manifest

From the repository root, after a real copy is in place:

```bash
node scripts/pse-arrangement-capture.mjs status
node scripts/pse-arrangement-capture.mjs write-manifest arrangement_1
node scripts/pse-arrangement-capture.mjs verify-manifest arrangement_1
node scripts/pse-arrangement-capture.mjs inspect arrangement_1
```

Repeat `write-manifest`, `verify-manifest`, and `inspect` for
`arrangement_2` and `arrangement_8`.

`write-manifest` writes `SHA256SUMS.json` only. It hashes `project.work`,
`project.strd` when present, and `arr01`–`arr08` `.work` / `.strd` files.
`verify-manifest` recomputes those hashes and does not write. Inspection
does not modify fixture bytes.

`status` stays `WAITING_FOR_REAL_DEVICE` until a capture has
`device_generated: true`, complete provenance, and a regular `project.work`.
One capture is not a mapping rule. The script does not change domain code.
