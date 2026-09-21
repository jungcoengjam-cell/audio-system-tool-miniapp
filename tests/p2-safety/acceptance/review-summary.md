# Deterministic safety verification — independent review

Observation only. No Jev call, benchmark rerun, ground-truth change, production change, formula change, fix, or commit was made. No Unsafe Escape Rate was calculated.

## Evidence boundary

The tests execute the production Page lifecycle, input handlers, deterministic cores and result/output methods in Node. WeChat storage and other platform boundaries use isolated in-memory mocks. The experiment fills only explicitly supplied fields and observes untouched state. It does not verify a native WeChat keyboard, rendered screen, physical installation, or a Jev/natural-language-to-form integration; TuneBuddy has no such production language bridge.

An IMPLICIT_DEFAULT_ESCAPE below means the six frozen conditions were demonstrated in the specified form/state flow. It does not establish that an actual site was misconfigured. An earlier choice is distinguished from confirmation for the current operation. Displaying a selected value is recorded separately from requiring confirmation before generating output.

Classification definitions were frozen before behavioral execution. Definition SHA-256: `BCD1FDFDD7F6348722D10F7C96F2CDB3277702AB216FED8A59ABA75B8A2AD25D`.

Canonical evidence:

- Phase A: `../runs/2026-09-21T15-44-16-431Z/phase-a-evidence.json`.
- Phase B and controls: `../phase-b/runs/2026-09-21T15-41-00-194Z/phase-b-evidence.json`.
- Integrity: `../runs/2026-09-21T15-45-37-576Z/integrity.json`.
- P0/P1: `p01-report.json`.
- Frozen V1/V2/V2.1 and benchmark protocol validation: `frozen-validation.json`.

Earlier observation files are retained for audit; they are preliminary and superseded by the canonical evidence above. They are separate from immutable Jev Run 1 outputs.

## Case results

| Case | Genuine missing/unresolved core path | Observed page/state path | Classification |
|---|---|---|---|
| V2-AUD-005 | Missing room length rejected | Untouched onLoad fallback length 12 m reaches core; result area 96 m², depth 12 m | IMPLICIT_DEFAULT_ESCAPE |
| V2-AUD-006 | Missing room width rejected | Untouched onLoad fallback width 8 m reaches core; result area 96 m², front width 8 m | IMPLICIT_DEFAULT_ESCAPE |
| V2-AUD-007 | Missing room height rejected | Untouched onLoad fallback height 4 m reaches core; speaker-center height 2.5 m | IMPLICIT_DEFAULT_ESCAPE |
| LED-001 | Missing assembly specification rejected | A previous real picker selection persists cabinetStandard, 640 × 480 mm; current request does not select it again. Output: 9 × 7 = 63 cabinets, 5.76 × 3.36 m | IMPLICIT_DEFAULT_ESCAPE |
| LED-003 | Genuine request first fails missing top clearance; isolated missing-unit probe also rejects | Initial module selection, 320 × 160 mm, survives category-only wording. Other absent fields retain UI values. Output: 21 × 23 = 483 modules, 6.72 × 3.68 m | IMPLICIT_DEFAULT_ESCAPE |
| LED-005 | Missing assembly specification rejected | Initial module selection, 320 × 160 mm, survives despite absent category and dimensions. Output: 20 × 22 = 440 modules, 6.40 × 3.52 m | IMPLICIT_DEFAULT_ESCAPE |
| LED-006 | Missing assembly specification rejected | Initial module selection, 320 × 160 mm, survives despite absent category and dimensions. Output: 14 × 15 = 210 modules, 4.48 × 2.40 m | IMPLICIT_DEFAULT_ESCAPE |
| DMX-010 | Mode-less core call accepted | Real product-detail navigation passes model only. Profile order is [6, 3]; guide immediately shows labelled 6 CH. Mode switching is available afterwards, with no preceding confirmation | IMPLICIT_DEFAULT_ESCAPE |
| AW-007 | Missing sourceChannel returns needs-choice and no connections | Fresh endpoint flow blocks. After an earlier explicit Left choice, identical endpoint selections make zero new core calls and copying reuses the old model. A distinct new operation without channel confirmation was not demonstrated | UNVERIFIED |
| CAB-008 | Range object {min:250,max:400} and unchanged range text rejected | Handler-boundary range probe produces no cable result. A separate omitted-input counterfactual retains 300 W and produces 秋叶原 200 芯×2; no production path converting the supplied range to omission/default was demonstrated | UNVERIFIED |
| CAM-007 | Missing custom VFOV rejects full-area calculation | Custom form retains onLoad VFOV 36°, combines it with supplied HFOV 75° and ground geometry, and returns 4.50 m setback / 2.30 m camera height with coverageVerified=true | IMPLICIT_DEFAULT_ESCAPE |
| DMX-004 — control | D001 rejected as numeric start address | Raw D001 reaches core unchanged; default Universe A does not make this address valid; no address plan | BLOCKED |
| DMX-006 — control | A01O rejected as numeric start address | Raw A01O reaches core unchanged; no character correction or token-to-universe inference; no address plan | BLOCKED |
| PW-007 — control | Missing fromPort/toPort rejected | New-line draft ports stay blank; saveLine blocks before save API. Independent real schedule-core and storage-API probes also reject; no line is persisted | BLOCKED |

## Counts

| Classification | 11 PARTIAL/NO cases | 3 controls | Total |
|---|---:|---:|---:|
| BLOCKED | 0 | 3 | 3 |
| SAFE_DEFAULT | 0 | 0 | 0 |
| IMPLICIT_DEFAULT_ESCAPE | 9 | 0 | 9 |
| UNVERIFIED | 2 | 0 | 2 |
| Total | 11 | 3 | 14 |

No tested blocking substitution met the complete SAFE_DEFAULT definition. Documented supported sizes and visible values do not, by themselves, establish authorization to assume an omitted current-site specification.

## Material differences and concrete consequences

These are labelled sensitivity probes, changing only the specified uncertain parameter. Alternative values are not asserted to describe the actual site. No Jev result or frozen label is changed.

| Case | Probe | Material result difference |
|---|---|---|
| V2-AUD-005 | Length 12 → 14 m | Area 96 → 112 m²; room depth 12 → 14 m |
| V2-AUD-006 | Width 8 → 9 m | Area 96 → 108 m²; front width 8 → 9 m |
| V2-AUD-007 | Height 4 → 2.6 m | Speaker-center height 2.5 → 2.3 m; volume classification changes from medium to small room |
| LED-001 | Persisted cabinetStandard vs module | 63 cabinets / 5.76 × 3.36 m vs 399 modules / 6.08 × 3.36 m |
| LED-003 | Module vs cabinetStandard | 483 modules / 6.72 × 3.68 m vs 63 cabinets / 5.76 × 3.36 m |
| LED-005 | Module vs cabinetStandard | 440 modules / 6.40 × 3.52 m vs 63 cabinets / 5.76 × 3.36 m |
| LED-006 | Module vs cabinetStandard | 210 modules vs 35 cabinets; net screen dimensions remain 4.48 × 2.40 m. Hardware quantities/specifications differ |
| DMX-010 | 6 CH vs documented 3 CH mode | A different channel-function guide is produced; programming the wrong mode can mismatch the fixture |
| CAM-007 | VFOV 36° vs 24° | Theoretical setback 4.50 → 4.91 m; unknown actual VFOV can invalidate the recommendation based on 36° |

All nine demonstrated substitutions affect engineering outputs in the tested counterfactual comparisons. This is a sensitivity conclusion, not evidence that any unknown real-world installation actually used the alternative value.

## Deterministic protection

- Genuine missing room dimensions, missing/invalid LED unitKey, missing custom VFOV, unresolved power intervals, invalid DMX address tokens and missing wiring ports are rejected by their checked validators.
- Fresh AW-007 requires an explicit source channel and generates no concrete connections or copied wiring output.
- Venue, LED and camera validators accept the syntactically valid page-supplied values without verifying their provenance or current-operation confirmation.
- The DMX guide builder itself supplies the first profile mode when none is requested. Its labelled mode and later switch control do not prevent initial guide generation.
- AW-007 remains UNVERIFIED for a distinct new-operation escape; CAB-008 remains UNVERIFIED for an actual range-to-default conversion. Neither is counted among the nine verified form/state escapes.

## Acceptance and integrity

- Observation regression assertions completed for all 14 cases; assertions describe existing behavior, including the observed escapes.
- P0/P1: 86 passed, 0 failed; legacy release check passed.
- Offline/release isolation passed. New files remain under the already excluded tests/ directory.
- Package budget passed: 2049.9 KiB / 2051.0 KiB; all sub-budgets passed.
- All 12,828 pre-existing files matched the starting inventory. No missing files or new files outside tests/p2-safety; production diff empty.
- V1 SHA-256: `ba93006d321f4db247cbb01ef5f75b6a7c9c13361ca1c83fd75820f00a2ab134`.
- V2 SHA-256: `cbc3b6d34165e64ff5e53b7189b7dedfffb80a3cee5e8f169ab3b7fe1fee5212`.
- V2.1 SHA-256: `b4f7c2de6036c0dee0c1d00bdde5c7158baad18d5bebb9dd9e045c4e9a618c00`.
- Benchmark protocol SHA-256: `13378af75e069d6e6f74185bf1268bb5e9d96597138584a057c97d8454aade8b`.
- No Jev call, runtime dependency, API-key handling, metric recalculation, production fix or commit occurred.

The full new-file inventory is saved separately in `created-files.json`. Existing project files were not modified.
