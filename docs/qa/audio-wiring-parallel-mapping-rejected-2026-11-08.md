# Historical verification — parallel mapping layout (rejected 2026-11-08)

> **User disposition: rejected.** This build showed separate parallel labeled lines beneath the connector photos instead of physical wires joining the photographed solder contacts. The technical checks below apply only to that historical implementation; they are not acceptance evidence for the current direct-wiring requirement.

## Scope

This handoff covers the complete opened connector photos, their source record, the parallel pin-mapping presentation, and the related regression tests. The diagram draws one complete photo per physical connector head. Each model connection has a separate horizontal row line with its actual pin labels; selecting a row highlights the matching weld points on the photos. The row line is a mapping cue and does not imply a direct lead between the photographed pins. Pin identity, endpoint mapping, copied wiring text, record storage, and model data remain protected by their existing tests.

The historical verification snapshot and its source/test hashes are [audio-wiring-parallel-mapping-rejected-verification-2026-11-08.json](audio-wiring-parallel-mapping-rejected-verification-2026-11-08.json).

Photo source paths, adopted prompts, processing metadata, final dimensions, and hashes are recorded in [the provenance JSON](audio-wiring-integrated-photo-assets-2026-11-08.json). The user-facing asset notes are in [audio-wiring-photo-assets.md](../audio-wiring-photo-assets.md).

## Test changes in this handoff

- `tests/audio-wiring-renderer-test.js` checks actual PNG header dimensions against the photo manifest, full-image aspect ratios, one photo draw per physical head, physical pin/function labels, 6px clearance between every photo badge and real weld point, terminal `+ / − / G` 14 × 14 badges in three-column cases, terminal-caption spacing, absence of `undefined`/`NaN` Canvas text, one straight horizontal line per model connection, no line crossing or self-intersection, separate row endpoints and photo weld anchors, hit-path consistency, and the selected 5.8px / other 1.6px / normal 2.3px widths.
- `tests/audio-wiring-page-test.js` checks full-source image draws and preserved aspect ratios, the title-row action toolbar and its original state/handlers, and unchanged mapping-row accessibility and tap targets.
- Existing assertions for electrical mappings, valid/invalid inputs, persistence, history, copied text, report contents, and async lifecycle remain in place.

## Verification status

| Check | Status |
| --- | --- |
| Targeted renderer regression | Passed: `node tests/audio-wiring-renderer-test.js` (0.64s). Renderer SHA-256: `8D58A83EE6D168A57D7B289924071CDFDB3426A6CA09FA287DE1B702DACA6AAD`; test SHA-256: `040769F0546D26D56C3E1706067A80DF0DAD2CC3C015090579E887C7A5013601`. |
| Targeted page regression | Passed: `node tests/audio-wiring-page-test.js` (0.70s). Page JavaScript SHA-256: `42D20BEAD40091A2758ABC7CF66C7E6493174ED80EF9AC3921819D5CA6387479`; test SHA-256: `BFE24CAA6FFFA75C75BCB366A24F15128FFFC123D910CA1C576CD6C601B0B0E0`. This uses strict canvas, selector-query, and export mocks; it does not exercise native WeChat layers or album permissions. |
| Independent route/geometry audit | Passed on renderer SHA-256 `8D58A83EE6D168A57D7B289924071CDFDB3426A6CA09FA287DE1B702DACA6AAD`: 252/252 cases, including zero route crossings, badge-to-pin clearance of at least 6px, and terminal-caption/title spacing. The audit checked 63 models across four canvas widths; see [route matrix](../../tmp/wiring-integrated-2026-11-08/independent-route-matrix.json) and [full-path audit](../../tmp/wiring-integrated-2026-11-08/independent-full-path-result.json). |
| Browser interaction and PNG export | Passed: nine cases verified line selection/toggle-off, actual photo-pin highlighting, one photo per physical head, and PNG export at 320/390/430px and 1.4× text. Results: [`result.json`](../../tmp/wiring-integrated-2026-11-08/independent-ui-accepted/result.json) and screenshots under `tmp/wiring-integrated-2026-11-08/independent-ui-accepted/`. Three representative final PNGs received manual visual review; labels clear the correct welds and the terminal caption does not overlap the row heading. |
| PNG provenance | Passed before the integrated layout change: the six production PNGs were inspected from file headers/chunks and each is byte-identical to its recorded QA candidate. Provenance details are in [the photo provenance JSON](audio-wiring-integrated-photo-assets-2026-11-08.json). |
| Protected business/model/copy-text checks | Passed: 42 protected source files and all 63 model mappings/text baselines were checked; no business, model, or copied-text mutation was found. See [business review](../../tmp/wiring-integrated-2026-11-08/independent-business-result.json). |
| Geometry-cache regression | Passed on the frozen renderer; default XLR-to-terminal geometry, reversed-solver endpoint mapping, and actual photo anchors were checked. |
| Native WXML/WXSS compilation | Passed for the archived parallel-layout source version: 40 WXML and 35 WXSS files compiled. The temporary compile output has since been refreshed for the direct-wiring revision, so its current hashes do not describe this archived build. |
| Production JavaScript syntax check | Passed on the current three production JavaScript files: `pages/audio-wiring/index.js`, `pages/audio-wiring/wiring-renderer.js`, and `pages/audio-wiring/wiring-photos.js`. This is tracked separately from native WXML/WXSS compilation. |
| Full `node tests/release-check.js` | Passed with exit code 0; see [`release-check.log`](../../tmp/wiring-integrated-2026-11-08/release-check.log). The log reports total package size 4,634.7/5,120 KiB, main-package source assets 2,415.4/2,460 KiB, and audio-wiring JavaScript 235.3/352 KiB. These are workspace source-size estimates, not measurements of a WeChat-compiled package; release thresholds were unchanged. |
| Real-device test | Not run in this round. |

## Files changed

- Page and rendering: `pages/audio-wiring/index.js`, `index.wxml`, `index.wxss`, `wiring-renderer.js`, `wiring-photos.js`, and the six PNGs under `pages/audio-wiring/assets/solder/`.
- Regression coverage: `tests/audio-wiring-renderer-test.js`, `tests/audio-wiring-page-test.js`, and `tests/audio-wiring-geometry-cache-regression.cjs`.
- Documentation and evidence: `docs/audio-wiring-photo-assets.md`, this archived QA handoff, `audio-wiring-integrated-photo-assets-2026-11-08.json`, and `audio-wiring-parallel-mapping-rejected-verification-2026-11-08.json`.
