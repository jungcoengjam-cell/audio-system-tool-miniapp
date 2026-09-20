# Deterministic test runner

Run the existing release checks and the new deterministic suites with:

```sh
node tests/deterministic-check.js
```

To save the complete machine-readable report as well as print the run summary:

```sh
node tests/deterministic-check.js --report docs/deterministic-test-results.json
```

The runner re-executes itself in a child process with a small environment allowlist and an offline preload. It runs `tests/release-check.js` first, then registers and runs every deterministic suite even if an earlier step fails. The preload blocks common Node HTTP, TLS, TCP, UDP, DNS, HTTP/2, fetch, WebSocket, and supported WeChat request/cloud APIs. It records attempts before throwing; a caught exception still makes that process fail. The test harness uses only Node's built-in modules. This is an API-level test guard, not an operating-system firewall.

Every case declares one of three classifications: `implementation bug`, `engineering-rule ambiguity`, or `test problem`. Failures are ordinary failures: there are no skipped or expected-failure cases. The process exits nonzero if the legacy release run fails, a new case fails, or a blocked network attempt is observed. Existing release checks are reported separately because their assertion count is not instrumented by this runner.

The shared suite contract is `({ test, assert, close, finiteTree }) => { ... }`. Each registered test supplies a classification and a short evidence basis. `close` uses an absolute tolerance of `1e-9` by default; `finiteTree` rejects nested NaN and infinities. The JSON report lists each new case's status, classification, basis, issue, error, expected value, and actual value. Non-finite numeric values are written as strings so JSON does not turn them into null.

The page suite loads the production page modules and calls their page methods with in-memory storage, clipboard, and timer mocks. This checks application state transitions and result text; it does not emulate the WeChat renderer. It does not establish real-device layout, performance, accessibility, or WeChat platform behavior.

The package-isolation check resolves the current mini-program pack ignore rules, then scans effective shipped JavaScript and JSON for prohibited imports and executable network calls. It also inspects declared package dependencies when a root package manifest exists. This is a static guard, not a proof against obfuscated calls, runtime-generated code, platform SDK behavior, or future import mechanisms the scanner does not recognize. Source URLs used as attribution or data metadata are not treated as calls.

Do not describe a run with any failed row as passing. Triage the row using its classification and evidence, make only an authorized production change, and rerun after the relevant fix.
