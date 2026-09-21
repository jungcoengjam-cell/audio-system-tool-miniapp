# P2-A V2 offline dataset

V2 contains 144 synthetic requests: 120 cases inherited from V1 and 24 additions. The inherited IDs and all seven descriptive metadata fields remain unchanged; the expected annotation schema changes to record one or more routes, intent ambiguity, and per-parameter state separately. Four JSON arrays are kept as source files. This is still offline dataset work: no Jev/model call, network access, credential read, API runner, installation, or production integration is part of this phase.

V2 defines no inference question contract or runner. The V1 `questions.v1.json` describes only the earlier V1 labels and is not a valid question configuration for V2; any future inference adaptation requires separate review and approval.

## Annotation contract

Each expected object has `tool`, `intent_ambiguous`, `parameters`, `clarification`, and `rationale`. Only `tool: "multiple"` carries a `tools` array, with at least two distinct routes. `intent_ambiguous` records uncertainty about the user's intended tool/task, independently of missing or invalid parameter values. For inherited examples, preserve the V1 category/mode/type/tags as provenance and language-coverage metadata; V2 `expected` is authoritative when those old tags suggest a judgment that changed under review. Neither tags nor expected labels may be sent to a future inference call.

Parameter keys are qualified names such as `venue.nom` and must exist in the V1 field registry or the explicit `field_additions` in `schema.json`. A parameter records `user_present`, optional raw `value`, `source`, `valid`, `sufficient`, and `evidence`; optional `semantic_role: "unresolved"`, `possible_typo: true`, and `conflict: {"resolution": null|string}` preserve distinct uncertainty types. User evidence must be an exact substring of the utterance. Catalog, derived, and documented-default values are not user-provided. `missing` has no value, `valid: null`, `sufficient: false`, and empty evidence. Operating ranges use `{ "min": number, "max": number }`; alternative candidates use arrays with at least two unique primitive values, and remain separate from ranges in the report. All numeric values must be finite.

Sufficiency and clarification are separate decisions. A parameter may be insufficient without forcing a question when the documented policy permits proceeding. An invalid value must be insufficient. A possible typo preserves the original user wording and leaves validity unknown; it never authorizes silent correction. A conflict resolution must quote explicit user wording. Clarification reasons use only the six registered codes in `schema.json`, and carry the affected parameter names. Intent ambiguity does not automatically set clarification, nor does clarification automatically mark the intent ambiguous.

The expected validation report separates primary-route case counts from the per-tool memberships of `multiple` cases. It reports parameter-level counts for present/absent and sufficient/insufficient, plus missing, invalid, catalog, derived, default, unresolved-role, range, typo, conflict, and request-without-permission states. Each such count has a distinct case count because a case can carry several states. Source counts are parameter-level and overlap case counts. These dimensions therefore must not be summed together as if they were exclusive case totals.

## Human review boundary

`human-review.json` preserves 30 explicitly reviewed decisions and confirmed product rules, including their conditions. It does not claim that all 144 labels received expert review. Fourteen inherited examples have substantive human-directed semantic revisions, 16 have a recorded review that retains the principal label, and the other 90 have no individual human review. The inherited 120 cases retain their metadata, while every expected annotation has been migrated to the V2 schema; schema-only migrations must not be reported as semantic human review. Source-backed defaults are identified separately from user-confirmed product decisions. V2 NOM ranges are a language/evaluation contract: the existing equation is applied to supported endpoints and the worst case is selected. The current production parser still accepts a scalar positive integer; do not claim that production accepts range objects.

## Offline validation

From the repository root:

```text
node tests/p2-jev/v2/validate.cjs
node tests/p2-jev/v2/validate.cjs --self-test
```

The self-test mutates in-memory fixtures to ensure the validator catches unknown fields, non-substring evidence, malformed ranges, invalid missing-state encoding, and forbidden inference fields. It does not alter the datasets. Validation also checks the exact V1 canonical data hash and every file hash listed in the existing V1 freeze manifest.

After an independent final review, the parent task may create the integrity manifest with `node tests/p2-jev/v2/freeze.cjs`. The command refuses overwrite and only writes after validation succeeds. To verify a frozen V2 set later, run `node tests/p2-jev/v2/validate.cjs --require-frozen`; this checks V1 and V2 manifest metadata, the canonical dataset hash, the exact authored V2 file set, and every recorded file hash. No freeze manifest is included before review approval.
