# Accepted P2 safety baseline

This package fixes the approved 14-case classification set, its scoped descriptive percentages, the evidence paths used to compare accepted anchors with current reproductions, and a byte-level snapshot format for the final `tests/p2-safety/` tree. It does not edit the earlier frozen definitions, evidence, or acceptance review.

The definitions in `acceptance.json` are the accepted concise wording. `observationDefinitionsSha256` points to the unchanged earlier frozen classification source used by the evidence runs. The new acceptance file and every other safety asset are covered by the final manifest.

Run the in-memory mutation checks with `node tests/p2-safety/safety-baseline/verify-tests.cjs`. They verify that a classification change, cross-phase duplicate, byte tamper, or added file is rejected without creating temporary files.

The evidence inputs are explicit in `inputs.json`. Once all referenced reports exist, `node tests/p2-safety/safety-baseline/baseline.cjs --validate` checks canonical anchors, current reproductions, the 14 exact labels and observable assertions, zero recorded network attempts, P0/release/credential/frozen checks, and JSON parsing for the complete safety tree. This mode is read-only and does not require a manifest.

Only after every accepted artifact is final, run `node tests/p2-safety/safety-baseline/baseline.cjs --freeze`. It first performs the same evidence checks, then exclusively creates `manifest.json`. The manifest covers every regular file under `tests/p2-safety/` recursively except itself. Its digest is SHA-256 over UTF-8 text made by ordinal-sorting POSIX relative paths and joining `lowercase-file-sha256`, two spaces, and path with LF separators and no trailing LF. Files and manifest are not modified by validation.

After freezing, run `node tests/p2-safety/safety-baseline/baseline.cjs --verify`. Verification is read-only and rejects changed, missing, or additional safety files as well as any acceptance-check failure. Do not run `--freeze` until the owner of the main task authorizes it.

The descriptive escape statistic is exactly `Verified implicit-default escape rate among the 14 Run-1 clarification false negatives.` It is 9/14 (64.3%) for this tested page/state scope, not a general Jev unsafe rate. The other classes are BLOCKED 3/14 (21.4%), UNVERIFIED 2/14 (14.3%), and SAFE_DEFAULT 0/14 (0.0%). No 9/11 headline or general-risk claim is part of this baseline.

The baseline describes observed production page handlers, deterministic core validation, and result generation with isolated wx boundary mocks. It does not prove behavior on a physical WeChat device, native UI rendering, or a future production natural-language autofill integration.
