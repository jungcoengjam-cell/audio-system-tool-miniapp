# Project save controller extraction QA

## Scope

Moved only the project-save data factories and page methods from Cable, SPL, Gain Structure, and Limiter into four page-specific modules. The page-level `Page` definitions keep the same data fields and public methods. Camera and LED already had separate project controllers with clear lifecycle boundaries, so their production source stayed unchanged. No WXML/WXSS, calculation algorithm, product data, validation limit, or record/storage contract changed.

## Page boundaries retained

- **Cable** freezes and compares the calculation payload before writing, verifies the saved project metadata, and protects its animated close with a revision-scoped timer. Its controller keeps Cable’s distinct select/confirm/success dialog and retry entry.
- **SPL** and **Gain Structure** retain their own configuration update confirmations. Each uses an owned save request and frozen input revision; closing invalidates a pending confirmation. Their keyboard event revision handling remains page-specific.
- **Gain Structure** continues to use its page-container overlay lifecycle and own keyboard layout helpers.
- **Limiter** retains its project target snapshot checks, page-container dismissal fence, keyboard layout integration, and its own save confirmation semantics. Reminder timing remains in the page.
- **Camera** keeps the existing frozen installation output, target checks, and delayed `setData` save callback fence.
- **LED** keeps the existing captured output, target checks, and delayed `setData` save callback fence. Favorites remain separate snapshots from project records.

Only the four extracted controllers receive runtime dependencies they use. Their `wx` proxy resolves the current global object at call time and binds API methods to that object; timers are resolved when invoked. Limiter keeps the injected `typeof wx` availability guard used by its keyboard-reset flow.

## Verification evidence

`tests/project-save-controllers-2026-10-24.cjs` was run against the preserved page sources and then the extracted pages:

- `node tests/project-save-controllers-2026-10-24.cjs before` — passed all six pages.
- `node tests/project-save-controllers-2026-10-24.cjs after` — passed all six pages.
- Both runs exercise the visible save entry, project A save, close/reopen, metadata edit and resave, project B save, cancellation, injected storage failure, and successful retry. Retry assertions confirm persisted metadata and no duplicate project record.
- The late-callback branches executed for all six pages: Cable stale close timer after reopen; SPL/Gain/Limiter native update confirmation after close; Camera/LED delayed save `setData` callback after close. The output records the executed branch per page.

Current-contract fixture adaptations were tested against preserved sources and current sources:

- Cable `testProjectFlows` and `testAnimatedCloseLifecycle` — passed before and after.
- SPL `testProjectKeyboardEventsAndMetadataIdentity` and `testProjectSaveFailureIsAtomic` — passed before and after. Project deletion assertions now follow the recoverable-delete contract: record links and metadata remain in recovery while the project is removed from the active list.
- LED controller regression — passed before and after (119 assertions/cases each). Its schema-4 fixture includes all canonical catalogs; favorite snapshots are read from `getFavorites()` and remain independent of project records.

Additional targeted regressions passed: Gain project dialog and metadata; Limiter page state and project metadata; Camera V4 project metadata and action/controller flow; LED records; homepage project-context lifecycle; and page lifecycle.

All four page files and four new modules pass `node --check`. A full unfiltered Cable refactor run also reaches a separate markup/style contract assertion (`testMarkupAndStyleContracts`, around line 1321) after the project and close cases; that assertion is outside this extraction and was not weakened. The preserved unfiltered baseline stopped earlier on a stale project fixture, so that markup assertion is not claimed as a before/after comparison.

## Limits

No WeChat developer-tool compile or real-device interaction was run. The mocked controller regressions do not verify native keyboard, modal, page-container, storage quota, or permission UI behavior. The complete release check remains part of the repository-wide final verification.
