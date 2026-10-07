# Gain structure UI refactor — 2026-10-07

## Scope and behavior

The gain page now keeps a compact result pane above an independently scrolling input pane. The input groups are amplifier, load, and calibration; the load group is available only for voltage-gain models. The fixed result distinguishes attenuation, direct alignment, and insufficient drive, and keeps the DSP output placement and 0 dB amplifier control visible with the result.

Reset becomes available when draft inputs exist; share, favorite, and project save require a valid result. Share preview has loading, error, retry, and cancel states; project save has loading and visible write errors; reset reports a persistent error if draft removal fails. Favorite behavior continues to use the existing records controller. Reset clears only the gain draft and preserves favorites and saved records. Share preview uses the page-local overlay and one validated cached image for preview, send, and save. Project save uses the existing two-argument records API with a frozen result; changing inputs closes the sheet, rechecks the selected project, and searching away from a selected project clears that target. The sheet keeps the selected project name beside its save actions.

## Compatibility

No calculation helpers, equipment data, validation rules, preference schema, record payload shape, or record service were changed. The original `getResultText`, `getRecordPayload`, `copyResult`, and report action methods remain available. The comparison runner checks the page calculation and canonical text/payload against the captured pre-refactor page across real amplifier, stage, mode, load, and target combinations.

## Verification

- `node tests/gain-structure-refactor-2026-10-07/run.cjs` — 6 focused scenarios passed, including calculation parity, all three alignment outcomes, draft/reset behavior, stale results, report cache callbacks, project target changes, and keyboard episodes.
- `node tests/package-reclaim/ui-resources.cjs` — passed. Gain now uses explicit structural UI contracts; all other frozen expanded-WXML hashes and XLR resource checks remain intact.
- The new deterministic suite passed 87/87 cases. In the clean candidate, 16/18 isolated release gates passed, including performance coverage and page-controller checks. The remaining two failures are the candidate HEAD's existing draft-protocol gate and media size (677,497 bytes versus its 338 KiB limit). No draft resources or thresholds were changed; the clean candidate retains HEAD's draft gate, while the local formal worktree contains separate draft-related changes.
- The full release wrapper still stops at the package-size gate: 2809.3 KiB versus 2650.0 KiB. The pre-task snapshot already exceeded that gate at 2754.5 KiB; no gate was weakened.
- `node --check` passed for the edited page controller and JavaScript test files.

The final candidate passed the official WCC/WCSC compilation and 108/108 Chromium geometry checks against the real WXML/controller bridge. The final 108-case visual run includes the restored initialization performance measurements in the current controller. The official app reopened in full mode but remained on its welcome screen, with runtime page inspection and console calls timing out; native runtime verification is therefore blocked, and no physical-device test is claimed. An official development-preview QR was generated and delivered to the original task's Library; nothing was published.

## Review evidence and phone acceptance

Curated screenshots and the exact source hashes are in [the QA evidence](qa/gain-structure-ui-2026-10-07/verification.json). These are Chromium renderings of the actual controller and WXML/WXSS, with synthetic records for project-sheet checks; they are not native or physical-device screenshots.

1. Scan the delivered development-preview QR. Select TC-X2200B, 1 V, stereo, and target -6 dBFS: DSP final output attenuation is -10.19 dB. Edit an input and confirm the old result clears until recalculation; switch to a voltage-gain model and check the load reminder.
2. Select TC-22000, 33 dB, bridge, 8 ohms, and target -3 dBFS: insufficient drive is 1.17 dB, with guidance remaining visible. Test a long model name, light/dark themes, a small phone, and input scrolling with the keyboard open.
3. Repeat favorite/unfavorite and share preview/cancel/retry. Select a project, search away from it, and verify the target clears; save, cancel, restore, recalculate, and reset. Reset should clear the gain draft while preserving saved records.
