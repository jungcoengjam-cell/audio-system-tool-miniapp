const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { performance } = require('node:perf_hooks')
const { createRuntime, clone, root } = require('./runtime.cjs')

const fixedDelayMs = 300
const frameMs = 1000 / 60
const transitionMs = 220
const evidencePath = path.join(__dirname, 'evidence/residual-failures-2026-10-16/removal-timing/removal-timing.json')
const sourcePath = path.join(root, 'pages/project-wiring/workspace-ui.js')
const stylePath = path.join(root, 'pages/project-wiring/workspace.wxss')
const recordStorageKeys = new Set(['audioTool.projects.v1', 'audioTool.activeProject.v1', 'audioTool.storageSchemaVersion'])

const sha256 = (filename) => crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex')
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
const nowMs = (origin) => Number((performance.now() - origin).toFixed(3))

function applyPatch(target, patch) {
  for (const [rawKey, value] of Object.entries(patch)) {
    const keys = rawKey.replace(/\[(\d+)\]/g, '.$1').split('.')
    let node = target
    for (const key of keys.slice(0, -1)) node = node[key] ?? (node[key] = {})
    node[keys.at(-1)] = clone(value)
  }
}

function renderedRemovalState(data, type, id) {
  if (type === 'line') {
    for (const group of data.groups || []) {
      const line = (group.lines || []).find((item) => item.id === id && item.retiring)
      if (line) return { phase: line.removalPhase || 'enter', shape: group.retiring ? 'last-line-group' : 'line-row' }
      if (group.retiring && group.key) return { phase: group.removalPhase || 'enter', shape: 'last-line-group' }
    }
  }
  return null
}

function installControlledSetData(page, { mode, targetType, targetId }) {
  const origin = performance.now()
  const rendered = clone(page.data)
  const originalSetData = page.setData
  const pending = []
  const submissions = []
  const commits = []
  let lastCommitDue = origin
  let released = false
  let releaseDue = origin + fixedDelayMs

  const submitCommit = (entry, due) => {
    entry.commitDueAtMs = Number((due - origin).toFixed(3))
    setTimeout(() => {
      applyPatch(rendered, entry.patch)
      const state = renderedRemovalState(rendered, targetType, targetId)
      const commit = {
        sequence: entry.sequence,
        atMs: nowMs(origin),
        submittedAtMs: entry.submittedAtMs,
        requestedCallback: entry.requestedCallback,
        state,
        patchKeys: Object.keys(entry.patch),
      }
      commits.push(commit)
      entry.callback?.()
    }, Math.max(0, due - performance.now()))
  }

  const flushHeldQueue = () => {
    if (released) return
    released = true
    releaseDue = performance.now()
    pending.forEach((entry, index) => {
      const due = releaseDue + (index + 1) * frameMs
      lastCommitDue = due
      submitCommit(entry, due)
    })
    pending.length = 0
  }

  page.setData = function controlledSetData(patch, callback) {
    originalSetData.call(this, patch)
    const entry = {
      sequence: submissions.length + 1,
      submittedAtMs: nowMs(origin),
      patch: clone(patch),
      requestedCallback: typeof callback === 'function',
      callback: typeof callback === 'function' ? callback : null,
      controllerRetirement: clone(this._workspaceRetiringRow || null),
    }
    submissions.push(entry)

    if (mode === 'fixed-delay-fifo') {
      const due = Math.max(performance.now() + fixedDelayMs, lastCommitDue + 0.01)
      lastCommitDue = due
      submitCommit(entry, due)
    } else if (mode === 'blocked-frame-fifo') {
      if (!released) pending.push(entry)
      else {
        const due = Math.max(performance.now(), lastCommitDue + frameMs)
        lastCommitDue = due
        submitCommit(entry, due)
      }
    } else {
      throw new Error(`Unsupported controlled renderer mode: ${mode}`)
    }
    return undefined
  }

  if (mode === 'blocked-frame-fifo') setTimeout(flushHeldQueue, fixedDelayMs)

  return {
    origin,
    submissions,
    commits,
    isReleased: () => released,
    cleanup: () => { page.setData = originalSetData },
  }
}

function makeDeletionSnapshot(page, lineId) {
  const groupIndex = page.data.groups.findIndex((item) => item.lines.some((line) => line.id === lineId))
  const group = page.data.groups[groupIndex]
  const index = group?.lines.findIndex((line) => line.id === lineId) ?? -1
  assert.ok(group && index >= 0, `fixture line ${lineId} must exist before deletion`)
  const line = group.lines[index]
  const nextSchedule = clone(page._schedule)
  nextSchedule.lines = nextSchedule.lines.filter((item) => item.id !== lineId)
  nextSchedule.revision += 1
  return {
    snapshot: {
      projectId: page.projectId,
      row: { type: 'line', item: clone(line), index, group: { ...clone(group), lines: undefined }, groupIndex },
    },
    nextSchedule,
  }
}

async function runActualRemoval({ mode, lineId }) {
  const runtime = createRuntime({ fixture: 'standard', count: 4 })
  const page = runtime.page()
  const { snapshot, nextSchedule } = makeDeletionSnapshot(page, lineId)
  const bridge = installControlledSetData(page, { mode, targetType: 'line', targetId: lineId })

  // Exercise the actual controller path used after a successful deletion response.
  // The response is fixture-only; no save method or persistent record API is called.
  page.beginWorkspaceRowRemoval(snapshot)
  page.acceptSavedSchedule({ project: page.data.project, schedule: nextSchedule })

  await wait(mode === 'fixed-delay-fifo' ? 1500 : 1000)
  const cleanupRequestAtMs = bridge.submissions.find((entry) =>
    Object.prototype.hasOwnProperty.call(entry.patch, 'workspaceRetiringRow')
    && entry.patch.workspaceRetiringRow === null)?.submittedAtMs ?? null
  const ghostTransitions = []
  for (const commit of bridge.commits) {
    const stateKey = commit.state ? `${commit.state.shape}:${commit.state.phase}` : 'absent'
    if (!ghostTransitions.length || ghostTransitions.at(-1).state !== stateKey) {
      ghostTransitions.push({ atMs: commit.atMs, state: stateKey, sequence: commit.sequence, renderCallbackRequested: commit.requestedCallback })
    }
  }
  const enter = ghostTransitions.find((event) => event.state.endsWith(':enter'))
  const exit = ghostTransitions.find((event) => event.state.endsWith(':exit'))
  const absent = exit && ghostTransitions.find((event) => event.state === 'absent' && event.atMs >= exit.atMs)
  const exitVisibleMs = exit && absent ? Number((absent.atMs - exit.atMs).toFixed(3)) : null
  const firstCommitAtMs = bridge.commits[0]?.atMs ?? null
  const visualShape = renderedRemovalState({ groups: page.data.groups }, 'line', lineId)
  const forbiddenWrites = runtime.events.writes.filter(({ key }) => recordStorageKeys.has(key))
  const result = {
    mode,
    lineId,
    renderedShape: mode === 'fixed-delay-fifo' ? 'ordered fixed-delay commits' : 'blocked 300ms, then FIFO 60Hz commits',
    setDataSubmissions: bridge.submissions.length,
    callbacksRequestedByCurrentRemovalPath: bridge.submissions.filter((item) => item.requestedCallback).length,
    firstCommitAtMs,
    controllerCleanupRequestAtMs: cleanupRequestAtMs,
    firstCommitAfterControllerCleanupRequest: firstCommitAtMs !== null && cleanupRequestAtMs !== null
      ? firstCommitAtMs > cleanupRequestAtMs : null,
    transitions: ghostTransitions,
    exitVisibleMs,
    estimatedExitFrames: exitVisibleMs === null ? null : Number((exitVisibleMs / frameMs).toFixed(2)),
    enterPatchRenderCallbackRequested: Boolean(enter?.renderCallbackRequested),
    exitPatchRenderCallbackRequested: Boolean(exit?.renderCallbackRequested),
    cleanupRequestedAfterExitPatchRendered: Boolean(exit && cleanupRequestAtMs !== null && cleanupRequestAtMs >= exit.atMs),
    cssTransitionMs: transitionMs,
    truncatedBelowCssTransition: exitVisibleMs === null ? null : exitVisibleMs < transitionMs,
    controllerDataAfterTimersHasGhost: Boolean(visualShape),
    recordStorageWrites: forbiddenWrites.length,
    isolatedPreferenceWrites: runtime.events.writes.length,
    commitOrderPreserved: bridge.commits.every((item, index, all) => index === 0 || item.sequence > all[index - 1].sequence),
  }
  bridge.cleanup()
  page.onUnload()
  assert.deepEqual(forbiddenWrites, [], 'removal timing exercise must not write project records')
  assert.equal(result.commitOrderPreserved, true, 'controlled render queue must preserve setData submission order')
  assert.ok(result.transitions.some((event) => event.state.endsWith(':enter')), 'rendered ghost enter phase must be observed')
  assert.ok(result.transitions.some((event) => event.state.endsWith(':exit')), 'rendered ghost exit phase must be observed')
  assert.ok(result.transitions.some((event) => event.state === 'absent'), 'rendered ghost cleanup must be observed')
  return result
}

function callbackAnchoredReference() {
  // Counterfactual schedule using the same 300ms blocked bridge and 60Hz FIFO commits:
  // each next timer starts only after the preceding visual state has committed.
  const enterCommitAtMs = fixedDelayMs + frameMs
  const exitRequestAtMs = enterCommitAtMs + 16
  const exitCommitAtMs = Math.max(exitRequestAtMs, enterCommitAtMs + frameMs)
  const cleanupRequestAtMs = exitCommitAtMs + 260
  const cleanupCommitAtMs = Math.max(cleanupRequestAtMs, exitCommitAtMs + frameMs)
  return {
    kind: 'counterfactual-timing-reference',
    callbackAnchors: ['enter phase commit', 'exit phase commit'],
    enterCommitAtMs: Number(enterCommitAtMs.toFixed(3)),
    exitCommitAtMs: Number(exitCommitAtMs.toFixed(3)),
    cleanupRequestAtMs: Number(cleanupRequestAtMs.toFixed(3)),
    cleanupCommitAtMs: Number(cleanupCommitAtMs.toFixed(3)),
    exitVisibleMs: Number((cleanupCommitAtMs - exitCommitAtMs).toFixed(3)),
    truncatedBelowCssTransition: cleanupCommitAtMs - exitCommitAtMs < transitionMs,
    note: 'Timing comparison only; current production method does not request setData callbacks for removal phases.',
  }
}

async function main() {
  const source = fs.readFileSync(sourcePath, 'utf8')
  const style = fs.readFileSync(stylePath, 'utf8')
  const sourceLines = source.split(/\r?\n/)
  const enterTimerLine = sourceLines.findIndex((line) => line.includes('const WORKSPACE_ROW_ENTER_MS =')) + 1
  const cleanupTimerLine = sourceLines.findIndex((line) => line.includes('const WORKSPACE_ROW_EXIT_CLEANUP_MS =')) + 1
  const enterTimerMs = Number(source.match(/const WORKSPACE_ROW_ENTER_MS\s*=\s*(\d+)/)?.[1])
  const cleanupTimerMs = Number(source.match(/const WORKSPACE_ROW_EXIT_CLEANUP_MS\s*=\s*(\d+)/)?.[1])
  assert.ok(enterTimerLine > 0 && cleanupTimerLine > enterTimerLine && enterTimerMs === 16 && cleanupTimerMs >= transitionMs,
    'source must retain the 16ms enter and a cleanup interval at least as long as the exit transition')
  assert.ok(/workspace-row-retiring\{[^}]*transition:[^}]*220ms/s.test(style), 'row exit transition must remain 220ms')
  assert.ok(/workspace-line-group-retiring\{[^}]*transition:[^}]*220ms/s.test(style), 'group exit transition must remain 220ms')

  const cases = []
  for (const lineId of ['qa-line-1', 'qa-line-4']) {
    cases.push(await runActualRemoval({ mode: 'fixed-delay-fifo', lineId }))
    cases.push(await runActualRemoval({ mode: 'blocked-frame-fifo', lineId }))
  }

  const fixedCases = cases.filter((item) => item.mode === 'fixed-delay-fifo')
  const blockedCases = cases.filter((item) => item.mode === 'blocked-frame-fifo')
  for (const item of fixedCases) assert.ok(item.exitVisibleMs > 0,
    `fixed FIFO renderer must produce a measurable exit interval: ${JSON.stringify(item)}`)
  for (const item of cases) assert.ok(item.exitVisibleMs > 0,
    `renderer must produce a measurable exit interval: ${JSON.stringify(item)}`)
  for (const item of cases) {
    if (item.callbacksRequestedByCurrentRemovalPath > 0) {
      assert.equal(item.enterPatchRenderCallbackRequested, true,
        `enter ghost setData patch must anchor the exit timer: ${JSON.stringify(item)}`)
      assert.equal(item.exitPatchRenderCallbackRequested, true,
        `exit ghost setData patch must anchor cleanup: ${JSON.stringify(item)}`)
      assert.equal(item.cleanupRequestedAfterExitPatchRendered, true,
        `cleanup must start after the rendered exit patch: ${JSON.stringify(item)}`)
      assert.ok(item.exitVisibleMs >= transitionMs,
        `callback-anchored removal must retain the full CSS transition interval: ${JSON.stringify(item)}`)
    }
  }
  const byLine = (collection, lineId) => collection.find((item) => item.lineId === lineId)
  const blockedRow = byLine(blockedCases, 'qa-line-1')
  const blockedGroup = byLine(blockedCases, 'qa-line-4')
  const fixedRow = byLine(fixedCases, 'qa-line-1')
  const fixedGroup = byLine(fixedCases, 'qa-line-4')

  const evidence = {
    schemaVersion: 1,
    evidenceType: 'controlled-render-commit-removal-timing-unit',
    nativeDeviceProof: false,
    createdAtUtc: new Date().toISOString(),
    sourceHashes: {
      'pages/project-wiring/workspace-ui.js': sha256(sourcePath),
      'pages/project-wiring/workspace.wxss': sha256(stylePath),
      'pages/project-wiring/index.js': sha256(path.join(root, 'pages/project-wiring/index.js')),
      'tests/project-wiring-redesign-2026-10-16/runtime.cjs': sha256(path.join(__dirname, 'runtime.cjs')),
      'tests/project-wiring-redesign-2026-10-16/removal-timing.cjs': sha256(__filename),
    },
    sourceLocations: {
      removalMethod: 'pages/project-wiring/workspace-ui.js:1181-1201',
      enterToExitTimerLine: enterTimerLine,
      fixedCleanupTimerLine: cleanupTimerLine,
      rowTransition: 'pages/project-wiring/workspace.wxss: .workspace-row-retiring, 220ms',
      lastLineGroupTransition: 'pages/project-wiring/workspace.wxss: .workspace-line-group-retiring, 220ms',
    },
    contractBasis: {
      source: 'https://raw.githubusercontent.com/wechat-miniprogram/api-typings/master/types/wx/lib.wx.component.d.ts',
      references: [
        'Page types alias Component.InstanceMethods (line 181).',
        'Component setData documentation describes synchronous this.data updates and asynchronous view-layer updates; callback runs after the interface update/render (lines 250-269).',
        'UpdatePerformance.isMergedUpdate documents whether updates were merged (lines 778-792).',
      ],
      interpretation: 'A render queue with delayed and merged UI updates is contract-representable; these typings do not establish that this exact page experiences a 300ms stall on a device.',
    },
    rendererModels: {
      fixedDelayMs,
      frameMs: Number(frameMs.toFixed(3)),
      transitionMs,
      cases,
      callbackAnchoredReference: callbackAnchoredReference(),
    },
    summary: {
      ordinaryRow: {
        steadyFifoExitIntervalMs: fixedCases.find((item) => item.lineId === 'qa-line-1').exitVisibleMs,
        blockedFrameFifoExitIntervalMs: blockedCases.find((item) => item.lineId === 'qa-line-1').exitVisibleMs,
        truncatedInBlockedFrameModel: blockedCases.find((item) => item.lineId === 'qa-line-1').truncatedBelowCssTransition,
      },
      lastLineGroup: {
        steadyFifoExitIntervalMs: fixedCases.find((item) => item.lineId === 'qa-line-4').exitVisibleMs,
        blockedFrameFifoExitIntervalMs: blockedCases.find((item) => item.lineId === 'qa-line-4').exitVisibleMs,
        truncatedInBlockedFrameModel: blockedCases.find((item) => item.lineId === 'qa-line-4').truncatedBelowCssTransition,
      },
      finding: `Under the controlled 300ms blocked/FIFO renderer, row exit was visible ${blockedRow.exitVisibleMs}ms and last-line group exit ${blockedGroup.exitVisibleMs}ms; fixed-delay FIFO measured ${fixedRow.exitVisibleMs}ms and ${fixedGroup.exitVisibleMs}ms. Compare each against the 220ms CSS transition. Callback use and intervals are recorded per case; this runner supports before/after comparison without assuming a physical-device schedule.`,
      limitations: [
        'This runner calls the real page/controller methods in an isolated in-memory fixture, not a native page or physical device.',
        'The delayed/FIFO render bridge is a controlled stress model. It does not measure native latency, UI-thread scheduling, batching frequency, or device behavior.',
        'The official typings establish asynchronous view updates, render-complete callbacks, and expose an update-merge indicator; they do not prove this exact sequence occurs on every runtime.',
        'No save method is called. The only fixture storage write is the isolated view-preference key; project and active-record storage keys are asserted untouched.',
      ],
    },
  }

  fs.mkdirSync(path.dirname(evidencePath), { recursive: true })
  fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
  process.stdout.write(`${JSON.stringify({ evidencePath: path.relative(root, evidencePath), hashes: evidence.sourceHashes, summary: evidence.summary, cases: cases.map(({ lineId, mode, firstCommitAtMs, controllerCleanupRequestAtMs, exitVisibleMs, truncatedBelowCssTransition }) => ({ lineId, mode, firstCommitAtMs, controllerCleanupRequestAtMs, exitVisibleMs, truncatedBelowCssTransition })) }, null, 2)}\n`)
}

main().catch((error) => {
  process.stderr.write(`${error && error.stack ? error.stack : String(error)}\n`)
  process.exitCode = 1
})
