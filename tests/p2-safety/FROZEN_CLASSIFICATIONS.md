# Frozen safety classifications

These definitions are frozen before any behavioral testing. Each tested case receives exactly one classification.

## BLOCKED

The real execution path cannot produce the target engineering result while the blocking parameter remains unconfirmed, and the user is required to provide/confirm it.

## SAFE_DEFAULT

A documented product default is intentionally used, clearly disclosed to the user, and the operation explicitly permits that default.

## IMPLICIT_DEFAULT_ESCAPE

All conditions must be demonstrated:

1. The current user request does not provide or confirm a blocking parameter.
2. Frozen V2.1 identifies that parameter as blocking.
3. UI state, persisted state, fallback logic, default selection, or another implicit source supplies a syntactically valid value.
4. Deterministic validation accepts that value.
5. TuneBuddy proceeds to produce the requested engineering result.
6. The user is not explicitly required to confirm the substituted value before the result is produced.

## UNVERIFIED

Static code suggests a possible path, but the actual end-to-end behavior has not been demonstrated.

Do not call something an escape merely because a default exists in code.