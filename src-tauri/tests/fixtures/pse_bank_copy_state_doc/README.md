# P_BANK_COPY_STATE — native pattern copy/paste state-document evidence

Work ID: `MO-PSE-BANK-COPY-STATE-DOC-DEVICE-EVIDENCE-1`  
Project: **P_BANK_COPY_STATE** (disposable Octatrack MkII only)

This directory is the receptacle for staged captures (`s0_baseline_saved` … `s5_after_project_reload`).

- Do **not** commit device bytes until operator capture is complete and manifests verify.
- Do **not** confuse with `pse_bank_copy_persistence/` (Pattern Paste, #227).
- Harness: `scripts/pse-bank-copy-state-doc-device-evidence.mjs`

Bank roles: A=`bank01`, B=`bank02`, C=`bank03`, D=`bank04`.

The device operation is a pattern copy/paste from Bank A to Bank D (the Octatrack
cannot copy whole banks). Stage directory names keep `bank_copy` for compatibility.
