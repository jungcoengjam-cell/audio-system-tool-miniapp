# Jev-Assisted Engineering Review and Adversarial QA Workflow

This reusable workflow is development-only and tool-agnostic. Jev is not a TuneBuddy runtime component. New product features and production remediation belong in a separate, human-approved product-development thread. Do not restart completed benchmark runs or create a new benchmark run without an explicit human request.

## Phase 0 — BASELINE

Capture a read-only baseline before analysis: production/core code, relevant documentation, catalog/data, tests, history/results, Git HEAD/status/diffs, and frozen evidence hashes. Verify manifests and baselines without regenerating or rewriting historical artifacts. Record untracked work separately from tracked changes.

## Phase 1 — FACTUAL DOSSIER

Read implementation and relevant formulas, documentation, catalog, tests, and history. Separate: (a) production facts, (b) documented behavior, (c) assumptions, (d) historical findings, and (e) unresolved questions. Cite exact files/lines and distinguish current behavior from approved requirements.

## Phase 2 — JEV STRUCTURED QA REVIEWER / RISK FILTER / CHALLENGE LAYER

The experimentally supported Jev role is **JEV STRUCTURED QA REVIEWER / RISK FILTER / CHALLENGE LAYER**. The current TypeSafe/Jev interface does not provide open-ended text generation suitable for independently writing complete testcases. The structured interface can review/select among supplied candidates. In the generation capability experiment, 8/8 guided combinations duplicated known mechanisms; `JEV_GENERATION_NOVELTY_RATE = 0%`, `JEV_GENERATION_ACTIONABLE_RATE = 0%`, capability classification `C — REVIEWER / FILTER ONLY`. See `tests/p2-jev/jev-generation-capability/` for the experiment and its provenance.

Jev may independently judge Codex/Sol-generated hypotheses, rank or filter risk candidates, challenge engineering assumptions, review whether a candidate represents a real engineering concern, review mutation candidates, provide structured second opinions, challenge test coverage, and challenge proposed invariants when expressible through the supported Jev interface.

Use only currently supported structured forms (Choice, Score, or Noul) and only when appropriate to the question. Preserve the exact request, raw response, execution metadata, model, timestamps, and hashes. Keep the returned signal labeled `JEV_SIGNAL`; label Sol/Codex's independent reading `SOL/CODEX_INTERPRETATION`. Confidence is not authority.

Jev must not be credited with independently generating a testcase supplied by Codex/Sol, creating a failure mechanism merely because it selected a supplied option, or producing prose reasoning the API did not return. Preserve candidate and finding provenance. Do not ask Jev to invent product rules or numeric contracts.

## Phase 3 — SOL INDEPENDENT REVIEW

Sol independently reviews implementation, formulas, documentation, catalog, tests, and history against the dossier and Jev evidence. For each claim, choose `ACCEPT`, `REJECT`, `NEEDS_HUMAN_DECISION`, or `NEEDS_MORE_EVIDENCE`. Sol records its interpretation separately from Jev’s stored signal and may identify an oracle, harness, or validator defect.

## Phase 4 — TEST INVENTORY

Inventory deterministic tests, release/integration checks, existing regressions, development adversarial suites, mocks/harnesses, and uncovered surfaces. Record what each suite actually exercises and its latest result; do not call one suite another or imply that a prior run was rerun.

## Phase 5 — STRUCTURED JEV COVERAGE REVIEW

After Codex/Sol have built a factual inventory and candidate findings, Jev may review selected supplied candidates for risk priority, engineering relevance, semantic role, mutation quality, coverage, or an explicitly stated invariant. Do not ask Jev to generate tests, test gaps, or failure mechanisms. Supply the candidates and rules explicitly; ask only questions supported by Choice, Score, or Noul. Preserve raw requests/responses and provenance. A selected candidate remains Codex/Sol-originated.

## Phase 6 — CODEX/SOL HYPOTHESIS AND CANDIDATE AUTHORING

Codex/Sol author test hypotheses and candidate scenarios from the factual dossier and applicable evidence. Cover relevant value boundaries; unit and semantic-role confusion; valid-but-wrong values; conflicting evidence; defaults and restored history/preferences; stale state; multiple entities; valid values in invalid combinations; mode/model changes; lifecycle/timing; unload/reload; delayed callbacks; cache reuse and result invalidation; output/report/copy/save consistency; catalog boundaries; and realistic field-engineering mistakes. Mark unsupported proposals and duplicates explicitly. Jev may only review supplied candidates as described in Phase 5.

## Phase 7 — PROVENANCE

Every scenario, finding, failure class, mutation, and test-quality claim carries one or more origins: `jev`, `sol`, `codex`, `deterministic_test`, `existing_regression`, `human`, `mixed`. For `mixed`, name each contributor. Keep Jev’s signal separate from Sol/Codex interpretation. Never attribute another origin’s scenario or result to Jev.

## Phase 8 — FAILURE-CLASS CLUSTERING

Cluster repeated candidates by failure mechanism, not by wording, input value, or failing assertion. Record representative and repeated IDs, relevant product surface, duplicate/near-duplicate rationale, confidence, and unresolved policy/oracle. Do not count multiple assertions for one mechanism as multiple defects.

## Phase 9 — TEST ORACLE

For each proposed expected behavior, cite its authority: deterministic engineering formula, approved product rule, verified documentation/catalog fact, independent calculation, or human-approved invariant. Jev's structured judgment must never be the sole oracle for any supplied testcase. If no reliable authority exists, mark `NEEDS_HUMAN_ORACLE`; do not turn a signal or confidence into product truth.

## Phase 10 — EXECUTABLE TEST SELECTION

Select a small set that distinguishes important mechanisms and prefer real supported page/user paths. Use core API tests when core-only behavior is the target; label harness-injected and field-workflow cases. For each executable case record scenario origin, expected-behavior authority, invariant, executable path, result, and triage. Avoid mocks that bypass the behavior under test. Do not claim page reachability from a synthetic core call.

## Phase 11 — PRE-FIX EXECUTION

Run the selected tests against **CURRENT production** without first changing production behavior. Preserve command, environment, exact output, and run artifact. Use these seven classifications precisely where applicable: `CONFIRMED_PRODUCT_BUG`, `CORE_HARDENING_CANDIDATE`, `TEST_ORACLE_ERROR`, `TEST_HARNESS_ERROR`, `UNSPECIFIED_REQUIREMENT`, `EXPECTED_CURRENT_BEHAVIOR`, `NEEDS_HUMAN_REVIEW`. A valid result containing NaN/Infinity from malformed synthetic data may support a core-hardening candidate; it does not alone establish a normal-path product bug.

## Phase 12 — REACHABILITY

State the strongest demonstrated layer for every risk: `normal_page_path`, `catalog_path`, `core_api_only`, `test_harness_only`, `field_workflow`, or `unverified`. Separate direct core reproduction from catalog provenance and ordinary user reachability. Verify page/catalog reachability before proposing production logic for a synthetic case.

## Phase 13 — MUTATION REVIEW

Codex/Sol author mutation candidates for a supported failure class. Jev may review or rank those supplied candidates using supported structured forms; it does not author mutation variants. Save the exact request and response, source/test oracle, execution, and reproduction evidence. Keep Jev's selected signal separate from Codex/Sol-authored candidates and interpretation. Do not infer that structured review constitutes independent mutation generation.

## Phase 14 — TEST-QUALITY REVIEW

Use an independent Jev context and Sol to ask whether assertions prove their invariant, mocks match supported runtime behavior, expected values are independent, setup is reachable, state transitions/callbacks are modeled, and coverage overlaps. Verify every concern against the source and execution. Classify false-positive test ideas, oracle errors, and harness errors separately from product defects.

## Phase 15 — HUMAN REVIEW

Present unresolved policies and evidence gaps to the human. Preserve decisions and scope exactly; do not silently decide physical limits, field confirmation, unknown-mode policy, reachability, or product expansion. A desired feature is a candidate, not authorization to implement it in the QA workflow.

## Phase 16 — PRODUCT THREAD HANDOFF

For approved or proposed product work, hand off a reviewable package to the separate product thread: evidence links, provenance, invariant/oracle, exact reproduction, affected tests, mutation findings, reachability/scope limits, and human decision. Label feature requests `FEATURE_CANDIDATE_REQUIRES_PRODUCT_THREAD_REVIEW`. Do not implement production changes here without later explicit human authorization.

## Access and response-integrity policy

Jev is optional development infrastructure. Never expose or request API keys. On authentication/RBAC, service, or transport failure, preserve the exact request and error/response, mark the Jev-dependent stage `INCOMPLETE` / `BLOCKED_BY_JEV_ACCESS`, stop that stage, and continue only independent work. Never simulate Jev, ask Sol/Codex to impersonate it, fabricate a response, or block ordinary product development in the separate thread.

For malformed or unusable output, preserve the exact request and exact response/error, mark the Jev stage `INCOMPLETE`, and mark the execution `INVALID_RESPONSE`; do not consume it as a valid Jev result. A local validator disagreement is an evidence-pipeline issue: retain the original execution and add a linked, append-only offline review if justified. Validate IDs, schema, option keys, types, finite ranges, choice consistency, and confidence. Enforce probability sums only under a documented serialization/precision contract. Values consistent with rounding do not prove provider-internal precision.

## Metrics and yield

Report each metric explicitly, with provenance and a denominator or `N/A` where applicable:

- Raw candidate count and candidate count by each origin (`jev`, `sol`, `codex`, `deterministic_test`, `existing_regression`, `human`, `mixed`).
- Unique failure classes by origin.
- Executable test count and test outcomes.
- Confirmed bugs by origin.
- Core-hardening candidates by origin.
- Unreachable synthetic findings, only where unreachability is proven; report unverified reachability separately.
- False-positive ideas by origin.
- Oracle errors, harness errors, and unspecified requirements.
- Mutation findings by origin.
- Human-review workload: unresolved decisions/oracles and items awaiting review.

Also report review coverage, duplicated/clustered scenarios, and reachability level. Calculate separately:

`JEV NEW FAILURE CLASS YIELD = newly confirmed Jev-origin failure classes / reviewed Jev-origin adversarial clusters`

Under the current interface, Jev-origin testcase/mechanism generation is normally `N/A` because candidate authoring belongs to Codex/Sol/human. Use a Jev-origin generation denominator only if a future supported interface returns independently authored failure-mechanism evidence; preserve that request and response as evidence. A Jev selection of a supplied candidate is reviewer signal and does not change candidate origin.

`COMBINED QA NEW FAILURE CLASS YIELD = all newly confirmed failure classes / all reviewed adversarial clusters`

If a denominator is zero or origin cannot be established, report `N/A` and explain why. Do not use Codex-origin scenarios as the Jev denominator and never attribute combined yield to Jev.
