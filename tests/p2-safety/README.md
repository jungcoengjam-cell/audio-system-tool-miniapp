# Deterministic safety observation harness

This directory contains observation-only tests for the frozen Phase A cases. The frozen classification definitions are in [FROZEN_CLASSIFICATIONS.md](./FROZEN_CLASSIFICATIONS.md); their SHA-256 is `BCD1FDFDD7F6348722D10F7C96F2CDB3277702AB216FED8A59ABA75B8A2AD25D`. [freeze-record.json](./freeze-record.json) records the timestamp, pre-test inventory hash, and order of operations.

Run Phase A with `node tests/p2-safety/phase-a.cjs`. It loads the original V2.1 cases, invokes production Page lifecycle and handlers, records the arguments and outputs of the deterministic cores, and writes a new evidence file under `runs/<timestamp>/`. Storage is isolated for each case. The wx mock only supplies platform boundaries; modal interactions are recorded and never confirmed.

The page path applies only values marked present in the frozen V2.1 case. Missing blockers remain untouched so the real page initial state, fallbacks, and preferences determine the value seen by the core. LED-001 additionally establishes `cabinetStandard` through an actual picker handler in a separate earlier page instance, then reloads the production page before the current request. The current request does not make a new picker selection. LED-003's `模组拼` wording is recorded while the initial module selection remains untouched. No natural-language bridge or Jev behavior is simulated or claimed.

The final Phase A run is `runs/2026-09-21T15-44-16-431Z/phase-a-evidence.json`. It observed all eight page paths producing results. The direct missing-input core paths reject all three venue cases and all four LED cases; the model-only DMX path produces the first profile mode. Under the frozen definitions and this explicitly scoped page/state experiment, Phase A classifications are eight `IMPLICIT_DEFAULT_ESCAPE`, zero `BLOCKED`, zero `SAFE_DEFAULT`, and zero `UNVERIFIED`. This is not proof that a production language layer maps every utterance to these page inputs.

The earlier `runs/2026-09-21T15-33-45-845Z/phase-a-evidence.json`, `runs/2026-09-21T15-38-39-551Z/phase-a-evidence.json`, and `runs/2026-09-21T15-42-37-904Z/phase-a-evidence.json` are retained as immutable preliminary observations. Use the 15:44:16 run as the corrected record.

Run `node tests/p2-safety/verify-integrity.cjs` to compare every pre-existing repository file against `baseline-manifest.json`, verify the frozen definitions hash, and check for repository changes outside this directory. Each run writes a new integrity record and performs no cleanup.

This harness is not WeChat device, layout, or UI-rendering proof. It does not run Phase B, controls, P0/P1, or any Jev evaluation.
