# Minimal page safety tests

This directory contains the new page-level remediation checks. They run with
the isolated offline `wx` harness from `tests/p2-safety/harness.cjs`; the
delayed environment in `delayed-environment.cjs` retains modal, `setData`,
canvas draw, and image-export callbacks so stale asynchronous work can be
delivered deliberately.

`fixtures.cjs` is an explicit semantic mapping of the nine frozen V2.1 cases.
`verify-fixtures.cjs` checks that supplied values and missing blockers still
match `tests/p2-jev/v2.1`; that evidence is read-only and must not be changed.
`page-behavior.cjs` owns the real-page controls and manual compatibility paths
and is being extended with the structured Venue checks (A–E).

The unique historical initial-red checkpoint is
`../runs/pre-fix-red-assertions.json` (nine missing-input cases and three
blocked controls). The older `tests/p2-safety-remediation/operation-inputs-unit.cjs`,
the root pre-fix reports, and archived experiments are historical evidence;
they are not reclassified as passing tests and are not edited here.

The checks are offline isolated-`wx` tests. They do not constitute a real
WeChat-device performance or lifecycle test.

Run the current page contract subset with `node tests/p2-safety-remediation/minimal/run-active.cjs`.
It runs the three corrected Venue cases, four LED cases, Camera operation and
confirmation-card checks, gate callbacks and LED unload lifecycle, blocked
controls, and manual compatibility. It explicitly excludes DMX-010 because
that operation has not been implemented; the historical `run-minimal.cjs` and
the legacy `operation-inputs-unit.cjs` remain unchanged and are not part of the
active suite.

The 11-suite, 50/50 named-check count does not represent every historical runner.
The number counts returned named result entries, not individual assertions or
independent end-to-end cases. The
unchanged `run-minimal.cjs` still has three Venue failures because its old
semantic-key adapter does not map to the current page field names, and it also
contains pending DMX work. The unchanged `operation-inputs-unit.cjs` targets an
archived gate API. The active gate evidence comes from `gate.cjs`,
`operation-callbacks.cjs`, the Venue/LED/Camera page suites, and the LED unload
matrix (which invokes the standalone late-success lifecycle test).

The Camera `alternateEleven` case uses explicit structured facts
`HFOV=75°`, `VFOV=24°`, ground width `6 m`, depth `4 m`, subject height
`1.8 m`, automatic height, and `marginPercent=11`. It checks that the result
and record preference both retain 11%; structured favorite/project replay is
disabled because the existing preference schema cannot faithfully restore
that margin or the operation's other explicit facts.
