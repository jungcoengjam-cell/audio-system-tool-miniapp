# Post-fix P2 safety acceptance

Acceptance version 1.0, dated 2026-09-24. This area records the post-fix
acceptance independently of the frozen pre-fix baseline. It does not change
the historical `IMPLICIT_DEFAULT_ESCAPE` classifications.

The active page contract is checked with:

```text
node tests/p2-safety-remediation/minimal/run-active.cjs
```

The saved `active-remediation.json` is the fresh 13-group, 66-named-check
run. `p0p1-report.json` is a separate deterministic-suite report. Its raw
runtime measurements can vary between executions; the manifest records only
its stable acceptance count and status. `blocked-controls.json` preserves the
fresh real-handler results for the three controls.

The historical `tests/p2-safety-remediation/minimal/run-minimal.cjs` retains
obsolete Venue/CAM field mappings and is not a current passing test. The
historical `tests/p2-safety-remediation/operation-inputs-unit.cjs` targets the
archived oversized experimental API and is not the active minimal-gate
contract. Neither is deleted or reclassified.

The release-check source-byte accounting follows the current
`tests/release-check.js` effective package file selection and package groups.
It is not a compiled or uploaded WeChat package size. Platform build and
device status are recorded separately in `manifest.json`.

Run `node tests/p2-safety-remediation/post-fix-acceptance/credential-scan.cjs`
to create the credential scan report. After freezing the report, rerun only
with `--check-only`; that mode scans every acceptance file without writing.
The separate historical safety scan also checks its frozen evidence tree and
tracked production text.

Frozen V1, V2, V2.1, benchmark protocol, safety definition, and safety-baseline
hashes were validated independently. The baseline verifier is read-only; this
acceptance area does not overwrite that baseline. The manifest SHA-256 is
reported separately and is not embedded in the manifest itself.
