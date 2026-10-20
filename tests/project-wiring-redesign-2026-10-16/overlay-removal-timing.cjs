const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { performance } = require('node:perf_hooks')
const { createRuntime, clone, root } = require('./runtime.cjs')

const stallMs = 300
const frameMs = 1000 / 60
const transitionMs = 240
const evidencePath = path.join(__dirname, 'evidence/residual-failures-2026-10-16/removal-timing/overlay-timing.json')
const sourcePath = path.join(root, 'pages/project-wiring/workspace-ui.js')
const stylePath = path.join(root, 'pages/project-wiring/workspace.wxss')
const projectKeys = new Set(['audioTool.projects.v1', 'audioTool.activeProject.v1', 'audioTool.storageSchemaVersion'])
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function applyPatch(target, patch) {
  for (const [rawKey, value] of Object.entries(patch)) {
    const keys = rawKey.replace(/\[(\d+)\]/g, '.$1').split('.')
    let node = target
    for (const key of keys.slice(0, -1)) node = node[key] ?? (node[key] = {})
    node[keys.at(-1)] = clone(value)
  }
}

function installBlockedFrameRenderer(page) {
  const origin = performance.now()
  const rendered = clone(page.data)
  const original = page.setData
  const pending = []
  const submissions = []
  const commits = []
  let released = false
  let lastDue = origin
  const relative = () => Number((performance.now() - origin).toFixed(3))
  const schedule = (entry, due) => setTimeout(() => {
    applyPatch(rendered, entry.patch)
    commits.push({ sequence: entry.sequence, atMs: relative(), phase: rendered.workspaceOverlayPhases?.newProject || 'absent' })
    entry.callback?.()
  }, Math.max(0, due - performance.now()))
  const release = () => {
    if (released) return
    released = true
    const releasedAt = performance.now()
    pending.forEach((entry, index) => {
      const due = releasedAt + (index + 1) * frameMs
      lastDue = due
      schedule(entry, due)
    })
    pending.length = 0
  }
  page.setData = function delayedSetData(patch, callback) {
    original.call(this, patch)
    const entry = {
      sequence: submissions.length + 1,
      submittedAtMs: relative(),
      patch: clone(patch),
      keys: Object.keys(patch),
      callback: typeof callback === 'function' ? callback : null,
    }
    submissions.push(entry)
    if (!released) pending.push(entry)
    else {
      const due = Math.max(performance.now(), lastDue + frameMs)
      lastDue = due
      schedule(entry, due)
    }
  }
  setTimeout(release, stallMs)
  return { origin, submissions, commits, cleanup: () => { page.setData = original }, relative }
}

async function runClose({ lifecycle }) {
  const runtime = createRuntime({ fixture: 'standard', count: 4 })
  const page = runtime.page()
  const renderer = installBlockedFrameRenderer(page)
  page.requestNewProject()
  assert.equal(page.data.workspaceOverlayPhases.newProject, 'opening')
  page.closeNewProject()
  assert.equal(page.data.workspaceOverlayPhases.newProject, 'closing')
  const lifecycleAtMs = lifecycle ? renderer.relative() : null
  if (lifecycle === 'hide') page.onHide()
  if (lifecycle === 'unload') page.onUnload()

  await wait(850)
  const transitions = []
  for (const commit of renderer.commits) {
    if (!transitions.length || transitions.at(-1).phase !== commit.phase) transitions.push({ atMs: commit.atMs, phase: commit.phase, sequence: commit.sequence })
  }
  const closing = transitions.find((item) => item.phase === 'closing')
  const absent = closing && transitions.find((item) => item.phase === 'absent' && item.atMs >= closing.atMs)
  const closeVisibleMs = closing && absent ? Number((absent.atMs - closing.atMs).toFixed(3)) : null
  const postLifecycleSubmissions = lifecycle ? renderer.submissions.filter((item) => item.submittedAtMs > lifecycleAtMs + 1) : []
  const projectWrites = runtime.events.writes.filter(({ key }) => projectKeys.has(key))
  const result = {
    path: lifecycle ? `requestNewProject → closeNewProject → on${lifecycle[0].toUpperCase()}${lifecycle.slice(1)}` : 'requestNewProject → closeNewProject',
    setDataSubmissions: renderer.submissions.length,
    setDataCallbacksRequested: renderer.submissions.filter((item) => item.callback).length,
    firstCommitAtMs: renderer.commits[0]?.atMs ?? null,
    closingSubmittedAtMs: renderer.submissions.find((item) => Object.hasOwn(item.patch || {}, 'workspaceOverlayPhases.newProject')
      && item.patch['workspaceOverlayPhases.newProject'] === 'closing')?.submittedAtMs ?? null,
    closingCommitCallbackRequested: Boolean(renderer.submissions.find((item) => Object.hasOwn(item.patch || {}, 'workspaceOverlayPhases.newProject')
      && item.patch['workspaceOverlayPhases.newProject'] === 'closing')?.callback),
    lifecycleAtMs,
    transitions,
    closingVisibleMs: closeVisibleMs,
    cssTransitionMs: transitionMs,
    truncatedBelowCssTransition: closeVisibleMs === null ? null : closeVisibleMs < transitionMs,
    controllerCallbacksAfterLifecycle: postLifecycleSubmissions.filter((item) => item.keys.some((key) => key.includes('workspaceOverlayPhases'))),
    projectRecordWrites: projectWrites.length,
    isolatedPreferenceWrites: runtime.events.writes.length,
  }
  renderer.cleanup()
  if (lifecycle !== 'unload') page.onUnload()
  assert.deepEqual(projectWrites, [], 'overlay timing fixture must not write project records')
  if (lifecycle) assert.equal(result.controllerCallbacksAfterLifecycle.length, 0, 'hide/unload must invalidate pending close callbacks')
  return result
}

async function main() {
  const close = await runClose({ lifecycle: null })
  const hide = await runClose({ lifecycle: 'hide' })
  const unload = await runClose({ lifecycle: 'unload' })
  assert.ok(close.closingVisibleMs !== null && close.closingVisibleMs > 0,
    `blocked FIFO render queue must produce a measurable overlay close: ${JSON.stringify(close)}`)
  if (close.closingCommitCallbackRequested) {
    assert.ok(close.closingVisibleMs >= transitionMs,
      `callback-anchored overlay close must retain the full CSS transition interval: ${JSON.stringify(close)}`)
  }

  const evidence = {
    schemaVersion: 1,
    evidenceType: 'controlled-render-commit-overlay-close-unit',
    nativeDeviceProof: false,
    createdAtUtc: new Date().toISOString(),
    sourceHashes: {
      'pages/project-wiring/workspace-ui.js': sha256(sourcePath),
      'pages/project-wiring/workspace.wxss': sha256(stylePath),
      'pages/project-wiring/index.js': sha256(path.join(root, 'pages/project-wiring/index.js')),
      'tests/project-wiring-redesign-2026-10-16/runtime.cjs': sha256(path.join(__dirname, 'runtime.cjs')),
      'tests/project-wiring-redesign-2026-10-16/overlay-removal-timing.cjs': sha256(__filename),
    },
    controlledRenderer: { mode: '300ms blocked UI queue, then FIFO setData commits at 60Hz', stallMs, frameMs: Number(frameMs.toFixed(3)), cssTransitionMs: transitionMs },
    officialContractReference: {
      source: 'https://raw.githubusercontent.com/wechat-miniprogram/api-typings/master/types/wx/lib.wx.component.d.ts',
      details: 'setData updates this.data synchronously while view updates are asynchronous; callback follows rendered interface update (lines 250-269). UpdatePerformance.isMergedUpdate exposes whether updates were merged (lines 778-792).',
      scope: 'Supports a controlled delayed/merged render-queue model; it is not a physical-device latency measurement.',
    },
    cases: { close, hide, unload },
    summary: {
      closeIntervalMs: close.closingVisibleMs,
      truncatedBelow240ms: close.truncatedBelowCssTransition,
      hideInvalidatedPendingCloseCallback: hide.controllerCallbacksAfterLifecycle.length === 0,
      unloadInvalidatedPendingCloseCallback: unload.controllerCallbacksAfterLifecycle.length === 0,
      noProjectRecordWrites: close.projectRecordWrites + hide.projectRecordWrites + unload.projectRecordWrites === 0,
      limitations: [
        'Calls real controller methods through an isolated in-memory runtime, not a native page or physical device.',
        'The render queue is deliberately blocked for 300ms then drained FIFO once per 60Hz frame. This is a controlled contract stress model, not a claim about device scheduling frequency.',
        'No persistence API or save method is called; project records are asserted untouched.',
      ],
    },
  }
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true })
  fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
  process.stdout.write(`${JSON.stringify({ evidencePath: path.relative(root, evidencePath), sourceHash: evidence.sourceHashes['pages/project-wiring/workspace-ui.js'], summary: evidence.summary, close: { closingVisibleMs: close.closingVisibleMs, truncatedBelowCssTransition: close.truncatedBelowCssTransition }, hideNoLatePhaseSubmission: hide.controllerCallbacksAfterLifecycle.length === 0, unloadNoLatePhaseSubmission: unload.controllerCallbacksAfterLifecycle.length === 0 }, null, 2)}\n`)
}

main().catch((error) => { process.stderr.write(`${error && error.stack ? error.stack : String(error)}\n`); process.exitCode = 1 })
