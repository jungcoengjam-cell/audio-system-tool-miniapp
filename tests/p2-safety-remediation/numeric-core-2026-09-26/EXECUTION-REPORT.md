# Numeric core finite result remediation — execution record

Status: implementation, execution gates, and GPT-6 Sol independent review complete; accepted. No commit was created.

## Approved scope and design

Applied the approved invariant to the six `CORE_HARDENING_CANDIDATE` findings only. Each core keeps its own small result guards; no shared validator, formula rewrite, catalog edit, or UI change was added. Successful numeric fields are checked at the result boundary. Existing tool-specific input rules and signed values remain intact.

Historical reachability classifications remain unchanged: Gain and Limiter malformed catalog leaves are `USER_PATH_REACHABLE=UNVERIFIED`; SPL aggregate overflow and unchecked gain are `NO` through the inspected current page/call graph; Camera coverage direct-core cases are `NO` through the inspected current production call graph. This remediation is direct-core hardening and does not establish a normal user-path defect.

## Remediation classification

| Finding | Remediation status | Historical classification | Historical `USER_PATH_REACHABLE` |
|---|---|---|---|
| NC-GAIN-01 | `REMEDIATED_AS_DEFENSE_IN_DEPTH` | `CORE_HARDENING_CANDIDATE` | `UNVERIFIED` |
| NC-LIM-01 | `REMEDIATED_AS_DEFENSE_IN_DEPTH` | `CORE_HARDENING_CANDIDATE` | `UNVERIFIED` |
| NC-SPL-01 | `REMEDIATED_AS_DEFENSE_IN_DEPTH` | `CORE_HARDENING_CANDIDATE` | `NO` |
| NC-SPL-02 | `REMEDIATED_AS_DEFENSE_IN_DEPTH` | `CORE_HARDENING_CANDIDATE` | `NO` |
| NC-CAM-01 | `REMEDIATED_AS_DEFENSE_IN_DEPTH` | `CORE_HARDENING_CANDIDATE` | `NO` |
| NC-CAM-02 | `REMEDIATED_AS_DEFENSE_IN_DEPTH` | `CORE_HARDENING_CANDIDATE` | `NO` |

These remediation statuses record the completed core hardening. The historical classifications and `USER_PATH_REACHABLE` values above remain unchanged; this does not claim a reachable user-path defect. The unresolved NC-CABLE-01 and NC-CAM-03 contracts remain unchanged.

## Production changes

- `utils/spl.js`: reject non-finite summation gain, reject rounded non-finite SPL values and aggregate rated-power overflow, and make the exported distance-row builder return `null` safely for invalid calculations.
- `utils/gain-structure.js`: guard finite numeric fields in both branches of the exported `resolveFullPowerInput` and in the final `calculateGainStructure` success object. This covers malformed power leaves, voltage underflow, voltage-to-dBu overflow, and final rounding overflow.
- `utils/limiter.js`: reject non-finite total speaker power or rounded load before building a result; return explicit invalid results when the computed valid result has non-finite required numeric fields. Missing HPF continues to produce `timingReady: false` with an otherwise valid result.
- `utils/camera-fov.js`: require finite horizontal, vertical, and diagonal FOV values; horizontal and vertical retain the existing `(0,179)` rule. Require finite coverage distance, dimensions, area, and rounded FOV output fields. Diagonal FOV is required to be finite and has no additional `<179` rule.

No formulas or product data changed. The Cable review-estimate contract (NC-CABLE-01) and Camera tiny-positive-distance display contract (NC-CAM-03) remain unresolved. The latter remains displayed as `0 m` for `Number.MIN_VALUE`; this behavior is now characterized without deciding whether it is acceptable.

## Regression and compatibility evidence

Added `numeric-safety.test.cjs` with nine checks. `evidence/pre-fix-red-suite.json` records all six candidate regression assertions failing against the pre-change `git HEAD` implementations. Separate `gain-derived-red.json` and `limiter-aggregate-red.json` records cover finite-input overflow/underflow boundaries raised during review. Existing valid outputs are captured in `evidence/valid-output-baseline.json` and `evidence/valid-output-supplement.json` before production edits; the permanent suite compares both serialized snapshots, including Gain sensitivity, Limiter without HPF, and Camera target-width outputs.

The regression command is:

```text
node tests/p2-safety-remediation/numeric-core-2026-09-26/numeric-safety.test.cjs
```

Result: 9 checks passed. Coverage includes Gain/Limiter explicit invalid results, SPL aggregate overflow and signed/zero gain, all six preserved findings, valid result snapshots, finite diagonal FOV above 179 degrees, and preservation of the unresolved Camera 0 m display behavior.

## Package size

Baseline and post-change values from the existing release-check accounting:

| Measure | Before | After | Delta | Limit / remaining after |
|---|---:|---:|---:|---:|
| Total package | 2,105,767 B (2056.4 KiB) | 2,108,212 B (2058.8 KiB) | +2,445 B (≈2.39 KiB) | 2,116,608 B / 8,396 B |
| Main package JavaScript | 828,024 B (808.6 KiB) | 830,469 B (811.0 KiB) | +2,445 B (≈2.39 KiB) | 837,632 B / 7,163 B |
| WXSS | 266,518 B (260.3 KiB) | 266,518 B | 0 | 267,264 B / 746 B |
| WXML | 250,901 B (245.0 KiB) | 250,901 B | 0 | 251,904 B / 1,003 B |
| Media | 332,872 B | 332,872 B | 0 | 346,112 B / 13,240 B |
| Largest JavaScript file | `pages/dmx-address/data/stage-lighting-channels.js`, 89,436 B (87.3 KiB) | 89,436 B | 0 | 102,400 B / 12,964 B |

The three subpackages are unchanged: DMX address 246,860 B (241.1 KiB), Audio Wiring 98,829 B (96.5 KiB), and Project Wiring 73,867 B (72.1 KiB). No package limit is exceeded. Exact byte accounting is saved in `evidence/package-accounting.json`; the displayed rounded KiB values come from `tests/release-check.js`.

## Verification results

- Numeric remediation suite: 9/9 passed.
- `node tests/deterministic-check.js`: passed, including the deterministic offline/release isolation suite; 86/86 new deterministic cases passed.
- `node tests/p2-safety-remediation/minimal/run-active.cjs`: passed, 13 suites and 66 checks.
- `node tests/release-check.js`: passed; package accounting above, 149 products and 121 fixtures equivalent, generated catalog current, zero sensitive API scan hits.
- `node tests/package-reclaim/catalog-equivalence.cjs`: passed; 149 products and 121 fixtures, serialized source SHA-256 `8e821adbacbf54cc4a80861d4d1ed9b163fd2ffd287ec83c19d2d7e924d07582`.
- Credential scan of the tracked change context: passed with zero findings. `evidence/credential-scan.json` uses the existing scanner, which scans `tests/p2-safety` and tracked production text. It does not include this task's untracked numeric directory.
- Credential scan of the new untracked directory: `evidence/new-files-quality-scan.json` reports 23 text files scanned under `tests/p2-safety-remediation/numeric-core-2026-09-26/`, 13 content/filename rules, zero findings, and zero skipped files. The scanner includes itself; its generated report is excluded to avoid self-reference. The scan detects listed literal credential patterns and sensitive filenames, not every possible secret encoding.
- Tracked whitespace check: `git diff --check` passed for the four tracked production files. Its scope does not include untracked files.
- Untracked whitespace check: the local evidence checker ran `git diff --no-index --check -- NUL <path>` on each of the 23 text files in the new directory, with zero whitespace diagnostics. Git returned status 1 for each expected new-file diff; its LF-to-CRLF normalization notices are recorded separately and are not whitespace diagnostics. The generated scan report was checked in a separate invocation with the same command; status 1, empty diagnostics.
- Frozen Phase 1 evidence: 25 files and hashes recorded in `evidence/phase1-frozen-manifest.json` before production edits.
- Broader frozen evidence: 4,945 files / 97,724,398 bytes recorded in `evidence/broader-frozen-evidence-manifest.json`; check command is `node tests/p2-safety-remediation/numeric-core-2026-09-26/evidence/historical-manifest.cjs --check`.

GPT-6 Sol independent review returned ACCEPT, as detailed below. Git status and the exact proposed changes are reported with that review; this execution did not commit.

## Independent review and evidence-scope follow-up

GPT-6 Sol completed independent final review and returned **ACCEPT**. The review reports 54 boundary calls with no successful result leaking a non-finite required numeric field, no signed/zero-domain regressions, and no formula or product-data changes. It also identified that the initial supplementary snapshots were not asserted by the permanent suite and that earlier credential/whitespace scans did not cover this task's untracked files. The permanent suite now asserts both valid-output snapshots; `evidence/new-files-quality-scan.json` independently covers the new directory and reports 23 scanned text files, 13 credential/filename rules, zero credential hits, and zero whitespace diagnostics. The scan report itself was checked separately for whitespace. No production or frozen historical files changed during this evidence-only follow-up.
