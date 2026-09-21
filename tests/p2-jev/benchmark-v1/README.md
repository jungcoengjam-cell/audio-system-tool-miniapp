# P2 Jev benchmark v1

This directory contains frozen inputs, an offline request builder and validator, a guarded Jev runner, and an offline evaluator for comparing Jev with the V2.1 annotation set. Its dataset source is commit `1e843d63f7d3c94770be690af58f616382ed7f53`, canonical dataset SHA-256 `b4f7c2de6036c0dee0c1d00bdde5c7158baad18d5bebb9dd9e045c4e9a618c00`. The configuration date is 2026-09-21. The dry-run and evaluator make no network requests and do not read credentials. Live mode is opt-in and reads its API key from the process environment only.

The benchmark has 144 utterances and 1,142 scheduled parameter states. Each case produces one request batch for `routing`, `intent_ambiguous`, and `clarification_required`. Each parameter state produces one batch for `user_present`, `validity`, and `sufficient`: 3,858 judgments in 1,286 batches total. Case scope is an oracle-derived scheduling annotation: `scope.json` contains only case ID to sorted qualified parameter names. Report this limitation with every result; it is not model output and must not be used as evidence of routing or as additional prompt context.

`stimuli.json` contains only case IDs and unchanged user utterances. `context.json` contains neutral routing and parameter definitions, general operating rules, the documented gain-structure commissioning default, generic SPL and DMX knowledge, and catalog records copied literally from production catalog modules. At request-build time, product records are included only when their exact model token appears in the utterance; all recorded modes and options for that model are retained. Catalog specifications may supply documented model attributes, but they do not replace explicit user values, select a mode, establish a physical switch state, or prove device permission. Product matches use alphanumeric token boundaries, so a model such as `TC-2500B` does not accidentally match `TC-2500`. Context records contain no case IDs or expected annotations. No numeric prediction tasks are scheduled.

Provenance for the frozen user utterances, parameter names, and V2.1 case scopes is `tests/p2-jev/v2.1/{audio.cases.json,av-and-controls.cases.json,audio.additions.json,av.additions.json}`. The V2.1 canonical digest is independently checked. Neutral parameter names come from `tests/p2-jev/rubric.v1.json` plus V2.1 `schema.json` field additions; rubric policies, rationales, and expected parameter values are never passed into request construction. Catalog records are copied from `data/equipment.js`, `data/cameras.js`, and `data/stage-lighting.js`. The SPL implementation facts come from `utils/spl.js`; conventional `10 log10(N)` applies only to scoped same-model speakers each operating at rated power at equal distance in free field. Camera angle and sensor geometry constraints come from `utils/camera-fov.js`; DMX slot and fixture count constraints from `utils/dmx-address.js`; and the -6 dBFS default from `utils/gain-structure.js`. The -6 dBFS default applies only when the user has not provided a target; it is a commissioning default, not a universal industry rule. A request to connect an audio cold leg to shield does not confirm that the device output topology or manuals permit it. DMX channel-function lookup is knowledge intent; DMX address planning is a separate route.

## Request interface

`common.cjs` exports:

- `loadAssets()` returns `{ protocol, context, stimuli, scope }`.
- `buildRequests(assets)` returns request descriptors with `case_id`, `request_id`, `judgments`, and `body`. `case_id` and judgment metadata are local scheduling fields and are excluded from the API body.
- `canonical(value)` recursively sorts object keys while preserving array order.
- `sha256(bytes)` returns a lowercase SHA-256 digest.
- `verifyFrozen()` checks the manifest, every source/config/test/static asset digest, and the exact source-file set.

Every API body has exactly `{ model, state, questions }`, uses model `jev-1.13.0`, and targets `https://api.typesafe.ai/v1/systemone`. Questions are keyed by judgment ID and have `type`, `instructions`, and `criteria`; choice criteria are option-ID-to-description maps, and Noul criteria define `true` and `false`. The static builder does not call the endpoint. The guarded live runner uses this contract; consult the [System One API documentation](https://docs.typesafe.ai/api) when reviewing or changing API behavior.

Case-level state contains the unchanged utterance and neutral context. Parameter-level state contains the same utterance and context plus one neutral parameter definition. It never includes category, mode, case type, tags, case IDs, expected labels, rationale, review notes, source flags, or target/derived gold values. Explicit invalid candidates count as present. Catalog, default, and derived information do not count as explicit presence. Validity is independent and considers current information from all available sources. Sufficiency is judged per parameter and does not determine whether the whole request needs a clarification. Preserve possible-typo text. Continue after explicit conflict resolution. A request to tie an audio cold leg to shield does not grant device permission. DFOV plus aspect ratio is sufficient geometry for horizontal FOV. A scene-type typo is nonblocking when scene type is not needed. No hidden LED cabinet default is assumed.

## Response and retry contract

Choice responses are expected as `{type:"choice",choice,probabilities,confidence}`; report API-provided confidence. Noul responses are expected as `{type:"noul",noul}`, where `noul` is the probability of true. Use `noul >= 0.5` as true. For Noul only, derive certainty as `max(p, 1-p)` and keep it distinct from API confidence. Descriptive certainty bands are `[0,0.5)`, `[0.5,0.7)`, `[0.7,0.9)`, and `[0.9,1]`; high is at least 0.9, low is below 0.7. These bands are descriptive, not acceptance thresholds.

The runner defaults to offline dry-run and requires explicit `--live`, `--run-id`, and `--protocol-hash` flags for a live run. Its live-runner contract is a 30-second timeout, concurrency 1, at most 3 total attempts, retrying network errors, timeouts, HTTP 408, HTTP 429, and 5xx only, with 1,000 ms then 2,000 ms backoff. HTTP 401/403 aborts the run. Malformed 2xx responses and model mismatches are recorded without retry; other HTTP errors are recorded and the run continues. The key is never written to run files or logs. If it appears in a request or response, the runner fails closed and withholds that body.

Each raw run is created exclusively and cannot overwrite an existing run. The run directory stores its protocol/dataset identity, per-attempt records whose `request_body` field is the JSON metadata object, exact response-body bytes in `bodies/*.body` when available, and a summary. Keep raw runs immutable. The evaluator writes a separate analysis report outside the raw run, also using exclusive creation. The documented forms are:

```text
node tests/p2-jev/benchmark-v1/runner.cjs
node tests/p2-jev/benchmark-v1/runner.cjs --live --run-id run-1 --protocol-hash <verified-protocol-hash>
node tests/p2-jev/benchmark-v1/evaluate.cjs --run tests/p2-jev/benchmark-v1/runs/run-1 --output tests/p2-jev/benchmark-v1/analysis/run-1/report.json
```

The live form is documented here but was not executed during asset preparation.

The evaluator reports exact 17-option routing confusion and per-tool recall when support is at least 5; TP/TN/FP/FN, accuracy, precision, recall, and F1 for binary judgments; a three-option validity confusion matrix; and coverage and errors separately from scored labels. It also reports confidence-band agreement/error, every disagreement with references to immutable raw records, and eleven ground-truth slices computed offline: `ambiguous_requests`, `invalid_requests`, `missing_source`, `range_cases`, `catalog_source`, `derived_source`, `possible_typo`, `conflict_present`, `resolved_conflict`, `mixed_language`, and `alternative_units`. Their exact inclusion rules are defined by `SLICE_RULES` in `evaluate.cjs`. Missing outputs are never converted into labels. There is no benchmark acceptance threshold. Report the oracle-derived scope limitation and any missing or malformed responses; do not silently drop disagreements or score only confident predictions.

## Offline checks and freeze

Run `node tests/p2-jev/benchmark-v1/common.test.cjs` and `node tests/p2-jev/benchmark-v1/validate.cjs --dry-run` to verify the static inputs, exact request schema, totals, and request digest without network access. The dry run is not a Jev inference run.

`freeze.cjs` refuses overwrite. The initial `freeze.json` is intentionally created only after root review signals that all benchmark assets are present. After that, `verifyFrozen()` rejects changed or added source/config/test/static files; only ignored generated files under `reports/`, `runs/`, `analysis/`, and `dry-run-output/` are excluded.
