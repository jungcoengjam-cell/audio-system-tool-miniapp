# P2-A V2.1 corrected offline dataset

V2.1 carries the 144 V2 cases forward, adds no cases, and makes exactly two approved corrections. The other 142 cases are checked for exact structural equality as JSON values against frozen V2. Case metadata, all existing parameter states, and additions remain unchanged except for the deltas below.

- `V2-AV-002` adds the missing `camera_fov.aspect_ratio` state and records three valid routes to horizontal FOV: direct HFOV; DFOV plus aspect ratio; or DFOV plus physical sensor width and height. Its `reason.parameters` lists the affected missing/blocking fields (`hfov_deg`, `aspect_ratio`, `sensor_width_mm`, `sensor_height_mm`); this list is not a conjunction. DFOV remains valid and sufficient for its own parameter, but does not make the request ready.
- `V2-AV-004` removes `camera_fov.scene_type` from the clarification blocker. It preserves the raw possible typo `展市区`; that typo does not block this operation. The unresolved axis of the valid 3 m dimension remains the actionable blocker. No automatic text correction is made.

The optional clarification-reason `any_of` format encodes OR between alternatives and AND among qualified fields within each alternative. `parameters` identifies affected missing/blocking fields and can omit already-present fields used by an alternative. A parameter’s `sufficient` state describes only that parameter; request readiness and user-actionable blockers are represented by clarification reasons.

V1 metadata and per-parameter sufficiency policy remain in force. V2.1 still has no inference-question configuration; `questions.v1.json` is not a valid configuration for these annotations. This phase uses no Jev/model call, network, credentials, API runner, installation, or production integration. The source utterances and user-provided values are preserved; no runtime or calculation behavior changes.

`human-review.json` keeps all original 30 V2 decisions as history and appends review records for the 24 cases added in V2, for 54 reviewed cases total. The remaining 90 cases were not individually reviewed. The two corrected V2.1 decisions supersede the earlier AV-002 and AV-004 outcomes for the corrected dataset state; both historical records remain intact.

## Offline validation

From the repository root run:

```text
node tests/p2-jev/v2.1/validate.cjs
node tests/p2-jev/v2.1/validate.cjs --self-test
```

Validation checks the V1 canonical hash and frozen files, validates the existing frozen V2 baseline, confirms 142 unchanged V2 cases and only the two approved corrections, checks reason alternatives and field references, and tests sufficiency evaluation on in-memory clones. The existing V2 data and freeze manifest remain read-only.

`freeze.cjs` creates `freeze.json` only after validation and refuses overwrite. The freeze is intentionally not created during authoring; the root task owns final review and freeze approval.
