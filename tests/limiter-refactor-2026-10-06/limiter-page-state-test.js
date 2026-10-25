'use strict'

const assert = require('assert/strict')
const fs = require('fs')
const path = require('path')
const { buildResultReportPayload } = require('../../utils/result-report')

const PREF_KEY = 'audioTool.limiter.preferences'
const savedPreferences = {
  amplifierModel: 'TC-2350B', speakerModel: 'TS-803C', count: 1,
  wiring: 'parallel', mode: 'stereo', sensitivityVoltage: 1, highPassFrequency: 80,
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

function installClock() {
  const original = { now: Date.now, setTimeout: global.setTimeout, clearTimeout: global.clearTimeout }
  let now = 1000
  let nextId = 0
  const timers = new Map()
  const scheduled = []
  Date.now = () => now
  global.setTimeout = (callback, delay = 0) => {
    const id = ++nextId
    const timer = { id, at: now + Math.max(0, Number(delay) || 0), callback }
    timers.set(id, timer)
    scheduled.push(timer)
    return id
  }
  global.clearTimeout = (id) => timers.delete(id)
  return {
    advance(milliseconds) {
      const end = now + milliseconds
      let executions = 0
      while (true) {
        const due = [...timers.values()].filter((timer) => timer.at <= end)
          .sort((left, right) => left.at - right.at || left.id - right.id)[0]
        if (!due) break
        timers.delete(due.id)
        now = due.at
        due.callback()
        executions += 1
        if (executions > 10000) throw new Error('fake clock runaway')
      }
      now = end
    },
    pendingCount: () => timers.size,
    scheduled: () => scheduled.slice(),
    restore() {
      Date.now = original.now
      global.setTimeout = original.setTimeout
      global.clearTimeout = original.clearTimeout
    },
  }
}

function bootPage({ seedPreferences = false, storage: suppliedStorage, pageContainerSupport = false } = {}) {
  const original = { Page: global.Page, wx: global.wx, timers: installClock() }
  const storage = suppliedStorage || new Map()
  if (seedPreferences) storage.set(PREF_KEY, clone(savedPreferences))
  const writes = []
  const modals = []
  const toasts = []
  const shareCalls = []
  const loadingCalls = []
  const vibrations = []
  let definition
  const wx = {
    getStorageSync: (key) => clone(storage.get(key)),
    setStorageSync(key, value) { writes.push(key); storage.set(key, clone(value)) },
    removeStorageSync: (key) => storage.delete(key),
    getStorageInfoSync: () => ({ currentSize: 1, limitSize: 10240 }),
    getSystemInfoSync: () => ({ theme: 'light', windowWidth: 390, windowHeight: 844, pixelRatio: 3 }),
    canIUse: (feature) => feature === 'page-container' && pageContainerSupport,
    vibrateShort(options) { vibrations.push(options) },
    showModal(options) { modals.push(options) },
    showToast(options) { toasts.push(options) },
    showLoading(options) { loadingCalls.push(options) },
    hideLoading() {},
    showShareImageMenu(options) { shareCalls.push(options) },
    getFileSystemManager: () => ({ access: ({ success }) => success() }),
  }
  global.wx = wx
  require('../helpers/offline-guard').registerWx(wx)
  const pagePath = path.resolve(__dirname, '../../pages/limiter/limiter.js')
  for (const relative of ['../../pages/limiter/limiter.js', '../../utils/preferences.js', '../../utils/records.js']) {
    const absolute = path.resolve(__dirname, relative)
    delete require.cache[require.resolve(absolute)]
  }
  global.Page = (value) => { definition = value }
  require(pagePath)
  const page = Object.assign({}, definition, {
    data: clone(definition.data),
    setData(changes, callback) {
      Object.assign(this.data, changes)
      if (callback) callback()
    },
  })
  page.onLoad()
  return {
    page, wx, storage, writes, modals, toasts, shareCalls, loadingCalls, vibrations, clock: original.timers,
    close() {
      if (!page._isUnloaded) page.onUnload()
      original.timers.restore()
      global.Page = original.Page
      global.wx = original.wx
    },
  }
}

function pick(page, field, index) {
  page.pauseReminderForPicker()
  page.onPickerChange({ currentTarget: { dataset: { field } }, detail: { value: String(index) } })
}

function choose(page, field, index) {
  page.onChoiceTap({ currentTarget: { dataset: { field, index: String(index) } } })
}

function stepCount(page, step) {
  page.onCountStep({ currentTarget: { dataset: { step: String(step) } } })
}

function vibrationTypes(context) {
  return context.vibrations.map((options) => options.type)
}

function expectVibrations(context, ...types) {
  assert.deepEqual(vibrationTypes(context), types)
}

function clearVibrations(context) {
  context.vibrations.length = 0
}

function selectModel(page, type, model) {
  page.openEquipmentSelector({ currentTarget: { dataset: { type } } })
  page.onSelectorInput({ detail: { value: model } })
  const item = page.data.selectorItems.find((candidate) => candidate.model === model)
  assert(item, `selector should find ${model}`)
  page.selectEquipment({ currentTarget: { dataset: { index: item.index } } })
}

function testOverlayIncludeUsesPageScope() {
  const mainPath = path.resolve(__dirname, '../../pages/limiter/limiter.wxml')
  const overlayPath = path.resolve(__dirname, '../../pages/limiter/limiter-overlays.wxml')
  const main = fs.readFileSync(mainPath, 'utf8')
  const overlays = fs.readFileSync(overlayPath, 'utf8')
  assert.equal((main.match(/<include src="\.\/limiter-overlays\.wxml" \/>/g) || []).length, 2,
    'the native container and legacy fallback include the same page-scope panels')
  assert.doesNotMatch(main, /<template\s+is="limiterOverlayPanels"/,
    'panels must not depend on template data being inherited from their parent')
  const fieldPickers = main.split('\n').filter((line) => line.includes('<picker') && line.includes('class="field-picker"'))
  assert.equal(fieldPickers.length, 2, 'connection and HPF pickers use the bounded field-column wrapper')
  for (const field of ['wiringIndex', 'highPassFrequencyIndex']) {
    const picker = fieldPickers.find((tag) => tag.includes(`data-field="${field}"`))
    assert(picker, `${field} keeps its picker data field`)
    assert(picker.includes('bindchange="onPickerChange"') && picker.includes('bindcancel="cancelPicker"'),
      `${field} keeps its existing picker handlers`)
  }
  assert.match(main, /<button class="action-button" aria-label="重置本次计算"[^>]*bindtap="requestReset"><view class="action-icon icon-reset"><\/view>/,
    'the CSS reset glyph stays inside the original native button and accessible action')
  for (const binding of [
    'selectorVisible', 'selectorItems', 'detailsVisible', 'detailsText',
    'shareSheetVisible', 'resultReportImagePath', 'projectSheetVisible',
    'projectItems', 'projectPreview', 'savedAtText',
  ]) assert(overlays.includes(binding), `the included overlay markup must read page field ${binding}`)
}

function testNullHpfDoesNotEnableReset() {
  const context = bootPage({ storage: new Map([[PREF_KEY, { highPassFrequency: null }]]) })
  try {
    assert.equal(context.page.data.calculationState, 'empty')
    assert.equal(context.page.data.highPassFrequencyIndex, 0, 'saved null HPF maps to the explicit no-filter option')
    assert.equal(context.page.data.canReset, false,
      'a saved null HPF by itself is not an input and cannot enable reset')
  } finally { context.close() }
}

function testEmptyAndRealInputEvents() {
  const context = bootPage()
  const { page, storage, writes, clock } = context
  try {
    assert.equal(page.data.calculationState, 'empty')
    assert.equal(page.data.canReset, false, 'an empty draft must not enable reset because HPF is null')
    assert.deepEqual([
      page.data.amplifierIndex, page.data.speakerIndex, page.data.countIndex,
      page.data.wiringIndex, page.data.modeIndex, page.data.sensitivityIndex,
      page.data.highPassFrequencyIndex,
    ], [-1, -1, -1, -1, -1, -1, -1])
    page.onPickerChange({ currentTarget: { dataset: { field: 'highPassFrequencyIndex' } }, detail: { value: '0' } })
    assert.equal(page.data.highPassFrequencyIndex, -1, 'choosing the already-unselected HPF must not create a draft')
    assert.equal(page.data.canReset, false)
    assert.equal(page.getRecordPayload(), null)
    assert.equal(writes.length, 0)

    for (const raw of ['', null, undefined, ' ', '1.0', '1e0', '-1']) {
      page.onPickerChange({ currentTarget: { dataset: { field: 'highPassFrequencyIndex' } }, detail: { value: raw } })
      page.onChoiceTap({ currentTarget: { dataset: { field: 'sensitivityIndex', index: raw } } })
      page.onCountStep({ currentTarget: { dataset: { step: raw } } })
    }
    assert.deepEqual([
      page.data.highPassFrequencyIndex, page.data.sensitivityIndex, page.data.countIndex,
    ], [-1, -1, -1], 'empty and malformed event values cannot silently select an index')
    assert.equal(page.data.reminderActive, false)
    assert.equal(writes.length, 0, 'malformed events do not persist or start advisory reminders')

    page.onShow()
    stepCount(page, -1)
    assert.equal(page.data.countIndex, -1, 'decrementing the empty stepper never selects a count')
    stepCount(page, 1)
    assert.equal(page.data.countIndex, 0, 'the first increment explicitly selects one speaker')
    stepCount(page, -1)
    assert.equal(page.data.countIndex, 0, 'the minimum count cannot be decremented')
    for (let index = 0; index < page.data.counts.length; index += 1) stepCount(page, 1)
    assert.equal(page.data.countIndex, page.data.counts.length - 1, 'the stepper reaches the supported maximum')
    stepCount(page, 1)
    assert.equal(page.data.countIndex, page.data.counts.length - 1, 'the maximum count cannot be exceeded')
    for (let index = 0; index < page.data.counts.length - 1; index += 1) stepCount(page, -1)
    assert.equal(page.data.countIndex, 0)

    page.openEquipmentSelector({ currentTarget: { dataset: { type: 'amplifier' } } })
    const firstSelectorIndex = page.data.selectorItems[0].index
    const writesBeforeBadSelectorEvents = writes.length
    for (const raw of ['', null, undefined, ' ', '1.0', '1e0', 999999]) {
      page.selectEquipment({ currentTarget: { dataset: { index: raw } } })
      assert.equal(page.data.amplifierIndex, -1)
      assert.equal(writes.length, writesBeforeBadSelectorEvents)
    }
    page.closeEquipmentSelector()
    page.selectEquipment({ currentTarget: { dataset: { index: firstSelectorIndex } } })
    assert.equal(page.data.amplifierIndex, -1, 'a queued selector tap after close cannot alter the draft')
    selectModel(page, 'amplifier', 'TC-2350B')
    assert.equal(page.data.selectedAmplifier.model, 'TC-2350B', 'first amplifier selection updates the rendered model')
    selectModel(page, 'speaker', 'TS-803C')
    assert.equal(page.data.selectedSpeaker.model, 'TS-803C', 'first speaker selection updates the rendered model')
    page.onGroupTap({ currentTarget: { dataset: { group: 'load' } } })
    assert.equal(page.data.countIndex, 0)
    page.onGroupTap({ currentTarget: { dataset: { group: 'settings' } } })
    choose(page, 'sensitivityIndex', 0)
    assert.equal(page.data.calculationState, 'incomplete')
    assert.match(page.data.missingMessage, /负载（功放模式）/, 'missing mode is attributed to the Load tab')

    page.onGroupTap({ currentTarget: { dataset: { group: 'load' } } })
    pick(page, 'modeIndex', 0)
    assert.equal(page.data.calculationState, 'valid')
    assert.equal(page.data.reminderActive, false, 'the first valid threshold establishes a baseline without a reminder')
    assert.equal(page.data.thresholdText, '-19.2')
    assert.equal(page.data.timingReady, false, 'unselected HPF keeps the real threshold but no timing')
    assert.equal(page.data.attackText, '— ms')
    assert.equal(page.getRecordPayload().preferences.highPassFrequency, null)

    const hpfIndex = page.data.highPassFrequencies.findIndex((item) => item.value === 80)
    page.onGroupTap({ currentTarget: { dataset: { group: 'settings' } } })
    pick(page, 'highPassFrequencyIndex', hpfIndex)
    assert.equal(page.data.timingReady, true)
    assert.equal(page.data.attackText, '8 ms')
    assert.equal(page.data.releaseText, '128 ms')
    assert.equal(page.data.reminderActive, false, 'first HPF selection does not create a reminder')
    const laterHpfIndex = page.data.highPassFrequencies.findIndex((item) => item.value === 100)
    pick(page, 'highPassFrequencyIndex', laterHpfIndex)
    assert.equal(page.data.reminderActive, true, 'changing HPF after the null baseline starts a reminder')
    assert.deepEqual(page.data.reminderGroups, ['device', 'load'], 'a later HPF change reminds the other groups')
    const canonicalRecord = page.getRecordPayload()
    const reportRecord = page.buildResultReportRecord()
    assert(reportRecord.resultText.startsWith(`${canonicalRecord.resultText}\n`),
      'export-only input detail is appended without changing the canonical record text')
    const reportPayload = buildResultReportPayload(reportRecord)
    assert(reportPayload.lines.length <= 20, 'the actual image payload remains within its 20-line limit')
    const inputLines = reportRecord.resultText.split('\n').slice(-8, -1)
    assert.equal(inputLines.length, 7, 'the export view appends all seven actual inputs')
    for (const line of inputLines) assert(reportPayload.lines.includes(line), `the image payload retains ${line}`)
    assert(reportPayload.lines.includes('提醒：部分参数仍沿用原值，请结合现场核对。'))
    assert(reportPayload.lines.some((line) => line.includes('0 dBFS = +18.4 dBu')),
      'the image retains the DSP calibration')
    assert.match(reportPayload.trustDescription, /现场需复核/, 'the image retains its usage limitation')

    page.onGroupTap({ currentTarget: { dataset: { group: 'load' } } })
    choose(page, 'modeIndex', 1)
    assert.equal(page.data.modeIndex, 1)
    assert.equal(page.data.calculationState, 'invalid')
    assert(page.data.result.warning)
    assert.deepEqual(page.data.reminderGroups, ['device', 'settings'], 'Load edits remind the other two tabs')
    assert(!page.data.reminderText.includes('30 秒'), 'the reminder copy must not contradict the live countdown')
    const epoch = page._reminderEpoch
    const beforeSameChoice = page._reminderRemainingMs
    clock.advance(2000)
    choose(page, 'modeIndex', 1)
    assert.equal(page._reminderEpoch, epoch, 'reselecting the active mode is not a new edit')
    assert.equal(page._reminderRemainingMs, beforeSameChoice - 2000, 'same-choice taps leave the visible-time timer running without restarting it')
    const remaining = page._reminderRemainingMs

    page.pauseReminderForPicker()
    clock.advance(8000)
    pick(page, 'highPassFrequencyIndex', laterHpfIndex)
    assert.equal(page._reminderEpoch, epoch, 'same-value HPF picker confirmation does not restart the reminder')
    assert.equal(page._reminderRemainingMs, remaining, 'time spent in the native HPF picker is paused')
    page.pauseReminderForPicker()
    clock.advance(6000)
    page.cancelPicker()
    assert.equal(page._reminderRemainingMs, remaining, 'picker cancellation resumes the saved remaining duration')

    page.openCalculationDetails({ currentTarget: { dataset: { type: 'calculation' } } })
    clock.advance(7000)
    page.closeDetails()
    assert.equal(page._reminderRemainingMs, remaining, 'details overlay time does not count as visible reminder time')
    clock.advance(5000)
    const visibleRemaining = remaining - 5000
    assert.equal(page.data.reminderSeconds, Math.ceil(visibleRemaining / 1000))
    page.onHide()
    clock.advance(9000)
    page.onShow()
    assert.equal(page._reminderRemainingMs, visibleRemaining, 'background time is paused and restored')
    clock.advance(visibleRemaining)
    assert.equal(page.data.reminderActive, false)
    assert.equal(page.data.calculationState, 'invalid', 'advisory expiry leaves the domain warning visible')
    assert.equal(page.data.modeIndex, 1, 'advisory expiry preserves the current input')

    stepCount(page, 1)
    assert.equal(page.data.calculationState, 'incomplete', 'multiple speakers without wiring must not reach the engine')
    assert.match(page.data.missingMessage, /负载（连接方式）/)
    assert.equal(page.data.result, null)
    assert.equal(page.getRecordPayload(), null)

    page.requestReset()
    const cancel = context.modals.at(-1)
    cancel.success({ confirm: false })
    assert.equal(page.data.countIndex, 1, 'canceling reset preserves the draft')
    page.requestReset()
    const confirm = context.modals.at(-1)
    confirm.success({ confirm: true })
    assert.equal(page.data.calculationState, 'empty')
    assert.equal(page.data.canReset, false)
    assert.equal(page.data.result, null)
    assert.deepEqual(page.data.groupTabs.map((item) => item.reminded), [false, false, false])
    assert.equal(storage.has(PREF_KEY), false, 'reset removes only the Limiter input preference')
    assert(writes.includes(PREF_KEY), 'real input events persist the local draft')

    const writesBeforeReentry = writes.length
    page.onUnload()
    page.onLoad()
    assert.deepEqual([
      page.data.amplifierIndex, page.data.speakerIndex, page.data.countIndex,
      page.data.wiringIndex, page.data.modeIndex, page.data.sensitivityIndex,
      page.data.highPassFrequencyIndex,
    ], [-1, -1, -1, -1, -1, -1, -1], 're-entering after reset starts with every input unselected')
    assert.equal(writes.length, writesBeforeReentry, 're-entering an empty draft does not bootstrap preferences')

    let setDataCalls = 0
    const originalSetData = page.setData
    page.setData = function countAfterUnload(...args) { setDataCalls += 1; return originalSetData.apply(this, args) }
    page.onUnload()
    const unloadedCallCount = setDataCalls
    clock.advance(60000)
    assert.equal(setDataCalls, unloadedCallCount, 'unload prevents late timer setData calls')
  } finally { context.close() }
}

function testFifteenSecondReminderDuration() {
  const context = bootPage({ seedPreferences: true })
  const { page, clock } = context
  try {
    page.onShow()
    choose(page, 'sensitivityIndex', 1)
    assert.equal(page.data.reminderActive, true)
    assert.equal(page.data.reminderSeconds, 15, 'an actual input edit starts a 15-second reminder')
    assert.equal(page._reminderRemainingMs, 15000)
    assert.equal(page.data.calculationState, 'valid', 'the 15-second test starts from a valid calculation')
    const captureCalculation = () => ({
      inputs: [page.data.amplifierIndex, page.data.speakerIndex, page.data.countIndex,
        page.data.wiringIndex, page.data.modeIndex, page.data.sensitivityIndex,
        page.data.highPassFrequencyIndex],
      result: clone(page.data.result),
      resultText: page.getResultText(),
      thresholdText: page.data.thresholdText,
      calculationState: page.data.calculationState,
      payload: clone(page.getRecordPayload()),
    })
    const editedSnapshot = captureCalculation()
    assert(editedSnapshot.payload, 'the reminder edit retains the full canonical record payload')
    clock.advance(14999)
    assert.equal(page.data.reminderActive, true, 'the reminder remains active through 14,999 ms of visible time')
    assert.equal(page.data.reminderSeconds, 1, 'the visible countdown reaches its final second before expiry')
    assert.deepEqual(captureCalculation(), editedSnapshot, 'countdown ticks do not alter inputs, result text, or canonical payload')
    clock.advance(1)
    assert.equal(page.data.reminderActive, false, 'the reminder is dismissed at exactly 15,000 ms')
    assert.equal(page._reminderRemainingMs, 0)
    assert.deepEqual(captureCalculation(), editedSnapshot, 'reminder expiry preserves inputs, result text, and canonical payload')
  } finally { context.close() }
}

function testUnknownRestoredValueStaysIncomplete() {
  const storage = new Map([[PREF_KEY, {
    amplifierModel: 'NOT-IN-CATALOG', speakerModel: 'TS-803C', count: 1,
    wiring: 'parallel', mode: 'stereo', sensitivityVoltage: 1, highPassFrequency: 80,
  }]])
  const context = bootPage({ storage })
  const { page, writes } = context
  try {
    assert.equal(page.data.amplifierIndex, -1, 'an unknown saved model remains unselected')
    assert.equal(page.data.selectedAmplifier, null)
    assert.equal(page.data.speakerIndex >= 0, true)
    assert.equal(page.data.calculationState, 'incomplete')
    assert.equal(page.data.result, null, 'partial restored inputs never produce a synthetic result')
    assert.match(page.data.missingMessage, /设备（功放）/)
    assert.equal(writes.length, 0, 'restoring an unknown value does not rewrite the saved preferences')
  } finally { context.close() }
}

function testFavoriteRenderingAcrossInvalidResult() {
  const context = bootPage({ seedPreferences: true })
  const { page } = context
  try {
    page.onShow()
    const originalPayload = page.getRecordPayload()
    assert.equal(page.data.hasValidResult, true)
    assert.equal(page.data.wiringIndex, -1, 'saved count-one parallel is canonical neutral, not an explicit wiring choice')
    page.toggleCurrentFavorite()
    assert.equal(page.data.currentFavorite, true)

    stepCount(page, 1)
    assert.equal(page.data.calculationState, 'incomplete', 'a restored count-one draft requires a wiring choice before increasing the count')
    assert.match(page.data.missingMessage, /负载（连接方式）/)
    pick(page, 'wiringIndex', 0)
    stepCount(page, 1)
    stepCount(page, 1)
    assert.equal(page.data.calculationState, 'invalid', 'four parallel TS-803C speakers exceed the documented TC-2350B load range')
    assert.equal(page.data.currentFavorite, false, 'an invalid result never displays another configuration as the current favorite')
    const records = require('../../utils/records')
    assert.equal(records.getFavoriteByPayload(originalPayload)?.favorite, true,
      'invalidating the current result keeps the separate saved favorite')
    assert.equal(records.getRecordByPayload(originalPayload), null,
      'saving a favorite does not create or depend on a project record')
    assert.equal(context.storage.get('audioTool.records.v1')?.length || 0, 0,
      'the favorite remains isolated from project-record storage')
    assert.equal(context.storage.get('audioTool.favorites.v1')?.length, 1,
      'the saved configuration remains in the favorites store')

    stepCount(page, -1)
    stepCount(page, -1)
    pick(page, 'wiringIndex', 1)
    assert.equal(page.data.calculationState, 'valid', 'the explicitly selected two-speaker series load is a different valid signature')
    assert.equal(page.data.currentFavorite, false)
    assert.equal(records.getFavoriteByPayload(page.getRecordPayload()), null,
      'a different valid signature is not reported as the saved favorite')
    assert.equal(records.getFavoriteByPayload(originalPayload)?.favorite, true,
      'switching signatures does not remove the original favorite')
    stepCount(page, -1)
    assert.equal(page.data.hasValidResult, true)
    assert.equal(page.data.currentFavorite, true, 'returning to the original result signature restores its saved favorite state')
    assert.equal(records.getFavoriteByPayload(page.getRecordPayload())?.favorite, true,
      'returning to the original signature resolves to the saved favorite record')
  } finally { context.close() }
}

function testProjectSnapshotAndContinuation() {
  const context = bootPage({ seedPreferences: true })
  const { page, storage, modals } = context
  try {
    page.onShow()
    assert.equal(page.data.wiringIndex, -1, 'restored count-one parallel does not masquerade as a user wiring choice')
    page.commitInput({ countIndex: 1 })
    assert.equal(page.data.calculationState, 'incomplete', 'changing a restored single speaker to multiple requires an explicit wiring choice')
    assert.equal(page.data.result, null)
    page.commitInput({ countIndex: 0 })
    assert.equal(page.data.calculationState, 'valid')
    const records = require('../../utils/records')
    const projectA = records.createProject('测试项目甲')
    const projectB = records.createProject('测试项目乙')
    assert(projectA && projectB)
    const payload = page.getRecordPayload()
    records.addRecordToProject(payload, projectA.id, { name: '甲配置', note: '甲备注' })
    records.addRecordToProject(payload, projectB.id, { name: '乙配置', note: '乙备注' })

    const projectRows = storage.get('audioTool.projects.v1')
    const fixtureProject = projectRows.find((project) => project.id === projectA.id)
    fixtureProject.wiringSchedule = {
      revision: 1,
      lines: Array.from({ length: 80 }, (_, index) => ({ id: String(index), notes: '现场布线备注'.repeat(8) })),
    }
    storage.set('audioTool.projects.v1', projectRows)
    const workspace = records.getWorkspaceSnapshot({ forceRefresh: true })
    assert.equal(workspace.projects.find((project) => project.id === projectA.id).wiringSchedule.lines.length, 80,
      'the private project snapshot retains its full wiring schedule')

    page.openProjectSheet()
    const listedProject = page.data.projectItems.find((project) => project.id === projectA.id)
    assert.deepEqual(Object.keys(listedProject), ['id', 'name'], 'the render list projects only fields used by the WXML')
    assert.equal(Object.hasOwn(listedProject, 'wiringSchedule'), false, 'large project wiring details stay out of Page.data')
    page.chooseProject({ currentTarget: { dataset: { id: projectA.id } } })
    assert.equal(page.data.projectConfigName, '甲配置')
    assert.equal(page.data.projectConfigNote, '甲备注')
    assert.equal(page.data.projectPreview.thresholdText, '-19.2', 'project preview is based on the frozen result snapshot')
    page.backToProjectList()
    page.chooseProject({ currentTarget: { dataset: { id: projectB.id } } })
    assert.equal(page.data.projectConfigName, '乙配置', 'project metadata is prefilled for the selected project')
    assert.equal(page.data.projectConfigNote, '乙备注')

    page.onProjectConfigNameInput({ detail: { value: '手动名称' } })
    page.onProjectConfigNoteInput({ detail: { value: '手动备注' } })
    page.backToProjectList()
    page.chooseProject({ currentTarget: { dataset: { id: projectA.id } } })
    assert.equal(page.data.projectConfigName, '手动名称', 'switching target does not replace typed configuration name')
    assert.equal(page.data.projectConfigNote, '手动备注', 'switching target does not replace typed note')

    page.saveProjectConfiguration()
    const changeConfirmation = modals.at(-1)
    assert.match(changeConfirmation.content, /更新/)
    page.setProjectTarget(projectB)
    changeConfirmation.success({ confirm: true })
    assert.equal(records.getRecordByPayload(payload).projectMetadata[projectA.id].name, '甲配置',
      'a target change while confirmation is open prevents writing to the captured destination')

    page.setProjectTarget(projectA)
    page.saveProjectConfiguration()
    modals.at(-1).success({ confirm: true })
    const saved = records.getRecordByPayload(payload)
    assert.equal(saved.projectMetadata[projectA.id].name, '手动名称')
    assert.equal(saved.projectMetadata[projectA.id].note, '手动备注')
    assert.equal(page.data.savedProjectName, projectA.name)
    assert.equal(page.data.savedConfigName, '手动名称')
    assert(page.data.savedAtText)

    const before = page.getRecordPayload()
    page.continueAfterProjectSave()
    assert.equal(page.data.projectSheetVisible, false)
    assert.deepEqual(page.getRecordPayload(), before, 'Continue keeps current inputs and result')
    assert.equal(page._lastProjectTarget.id, projectA.id, 'Continue retains destination for the next configuration')
    page.openProjectSheet()
    assert.equal(page.data.projectStep, 'details', 'the next save can reuse the still-valid destination')
    assert.equal(page.data.projectTargetId, projectA.id)
    assert.equal(page.data.projectConfigName, '手动名称')
    page.closeProjectSheet()

    let shareArgs
    page.openSharePreview()
    page.setData({ resultReportImagePath: 'temp://limiter.png' })
    page.shareResultReportImage()
    shareArgs = context.shareCalls.at(-1)
    assert.deepEqual({ path: shareArgs.path, needShowEntrance: shareArgs.needShowEntrance }, {
      path: 'temp://limiter.png', needShowEntrance: false,
    })
    const toastCount = context.toasts.length
    shareArgs.fail({ errMsg: 'showShareImageMenu:fail cancel' })
    assert.equal(context.toasts.length, toastCount, 'canceling the native share menu is not reported as a failure')
    shareArgs.fail({ errMsg: 'showShareImageMenu:fail network unavailable' })
    assert.equal(context.toasts.length, toastCount + 1, 'a real native share failure gives an actionable message')
    const originalShareMenu = context.wx.showShareImageMenu
    delete context.wx.showShareImageMenu
    page.shareResultReportImage()
    assert.match(context.toasts.at(-1).title, /长按图片转发/, 'unsupported devices keep the shared helper long-press fallback')
    context.wx.showShareImageMenu = originalShareMenu
    page.closeSharePreview()
    let accessResult
    page.setData({ resultReportImagePath: 'temp://missing.png' })
    page.resultReportSignature = page.getResultReportSignature()
    context.wx.getFileSystemManager = () => ({ access: (options) => { accessResult = options } })
    let canvasCount = 0
    const originalContext = context.wx.createCanvasContext
    const originalExport = context.wx.canvasToTempFilePath
    context.wx.createCanvasContext = () => new Proxy({}, { get: (_target, name) => {
      if (name === 'measureText') return (text) => ({ width: String(text).length * 14 })
      if (name === 'draw') return (_reserve, callback) => (typeof _reserve === 'function' ? _reserve : callback)?.()
      return () => {}
    } })
    context.wx.canvasToTempFilePath = (options) => { canvasCount += 1; options.success({ tempFilePath: 'temp://regenerated.png' }) }
    page.openSharePreview()
    assert.equal(context.loadingCalls.length, 0, 'the local share sheet never invokes a full-screen loading mask')
    accessResult.fail()
    assert.equal(canvasCount, 1, 'a missing cached file triggers local image regeneration')
    assert.equal(page.data.resultReportImagePath, 'temp://regenerated.png')
    if (originalContext === undefined) delete context.wx.createCanvasContext
    else context.wx.createCanvasContext = originalContext
    if (originalExport === undefined) delete context.wx.canvasToTempFilePath
    else context.wx.canvasToTempFilePath = originalExport
  } finally { context.close() }
}

function testProjectMetadataProjectionInPage() {
  const context = bootPage({ seedPreferences: true })
  const { page, storage, modals } = context
  try {
    page.onShow()
    const records = require('../../utils/records')
    const recordsKey = 'audioTool.records.v1'
    const payload = page.getRecordPayload()
    const associatedProject = records.createProject('有效所属项目')
    assert(associatedProject)
    assert(records.addRecordToProject(payload, associatedProject.id, { name: '有效配置名', note: '有效备注' }))
    const orphanProject = records.createProject('孤立元数据项目')
    assert(orphanProject)
    const orphanRecords = storage.get(recordsKey)
    const orphanRecord = orphanRecords.find((record) => record.signature === JSON.stringify(['limiter', payload.preferences]))
    assert(orphanRecord)
    const seededRecordId = orphanRecord.id
    const seededResultText = orphanRecord.resultText
    assert.deepEqual(orphanRecord.projectIds, [associatedProject.id], 'the source remains a valid project-backed record')
    orphanRecord.projectMetadata = {
      [associatedProject.id]: { name: '有效配置名', note: '有效备注', savedAt: Date.now() },
      [orphanProject.id]: { name: '孤立配置名', note: '不应预填', savedAt: Date.now() },
    }
    storage.set(recordsKey, orphanRecords)
    records.getWorkspaceSnapshot({ forceRefresh: true })

    page.openProjectSheet()
    page.chooseProject({ currentTarget: { dataset: { id: orphanProject.id } } })
    assert.equal(page.data.projectConfigName, payload.title, 'unassociated project metadata cannot replace the canonical configuration name')
    assert.equal(page.data.projectConfigNote, '', 'unassociated project metadata cannot prefill a note')
    page.saveProjectConfiguration()
    assert.equal(modals.length, 0, 'orphaned metadata does not trigger an update confirmation')
    const savedRecord = records.getRecordByPayload(payload)
    assert(savedRecord, 'saving to the selected project keeps the existing project record resolvable')
    assert.equal(savedRecord.id, seededRecordId, 'saving to another project preserves the canonical record id')
    assert.equal(savedRecord.signature, JSON.stringify(['limiter', payload.preferences]), 'saving preserves the parameter signature')
    assert.equal(savedRecord.resultText, seededResultText, 'saving preserves the previously calculated result')
    assert.deepEqual(savedRecord.projectIds, [associatedProject.id, orphanProject.id])
    assert.equal(savedRecord.projectMetadata[associatedProject.id].name, '有效配置名', 'valid metadata for its existing project is retained')
    assert.equal(savedRecord.projectMetadata[orphanProject.id].name, payload.title, 'saving adds canonical metadata for the selected project')
    assert.equal(records.getFavoriteByPayload(payload), null, 'a project record is not fabricated as a standalone favorite')
    page.closeProjectSheet()

    const inheritedProject = records.createProject('原型元数据项目')
    assert(inheritedProject)
    assert(records.addRecordToProject(payload, inheritedProject.id, { name: '旧配置名', note: '旧备注' }))
    const inheritedRecords = storage.get(recordsKey)
    const inheritedRecord = inheritedRecords.find((record) => record.signature === JSON.stringify(['limiter', payload.preferences]))
    assert(inheritedRecord)
    inheritedRecord.projectMetadata = Object.create({
      [inheritedProject.id]: { name: '原型污染', note: '不得读取', savedAt: Date.now() },
    })
    storage.set(recordsKey, inheritedRecords)
    records.getWorkspaceSnapshot({ forceRefresh: true })

    page.openProjectSheet()
    page.chooseProject({ currentTarget: { dataset: { id: inheritedProject.id } } })
    assert.equal(page.data.projectConfigName, payload.title, 'inherited metadata falls back to the canonical shared record title')
    assert.equal(page.data.projectConfigNote, '', 'inherited metadata cannot supply a project note')
    page.saveProjectConfiguration()
    assert.equal(modals.length, 0, 'inherited metadata does not trigger a false update confirmation')
    assert.equal(records.getRecordByPayload(payload).projectMetadata[inheritedProject.id].name, payload.title)
  } finally { context.close() }
}

function testPendingReportCallbacksAreInvalidated() {
  const context = bootPage({ seedPreferences: true })
  const { page, wx, shareCalls } = context
  const originalContext = wx.createCanvasContext
  const originalExport = wx.canvasToTempFilePath
  const drawCallbacks = []
  const exportCallbacks = []
  let exportCount = 0
  let staleReportActionCount = 0
  let accessCount = 0
  try {
    page.onShow()
    wx.previewImage = () => { staleReportActionCount += 1 }
    wx.saveImageToPhotosAlbum = () => { staleReportActionCount += 1 }
    wx.createCanvasContext = () => new Proxy({}, { get: (_target, name) => {
      if (name === 'measureText') return (text) => ({ width: String(text).length * 14 })
      if (name === 'draw') return (_reserve, callback) => drawCallbacks.push(callback)
      return () => {}
    } })
    wx.canvasToTempFilePath = (options) => { exportCount += 1; exportCallbacks.push(options) }

    page.openSharePreview()
    assert.equal(context.loadingCalls.length, 0, 'local report generation uses the in-sheet spinner only')
    assert.equal(page.data.isGeneratingResultReport, true)
    page.closeSharePreview()
    assert.equal(page.data.isGeneratingResultReport, false)
    drawCallbacks.shift()()
    assert.equal(exportCount, 0, 'closing the share sheet invalidates a pending canvas callback')
    page.setData({ resultReportImagePath: 'stale-image-path' })
    page.retryResultReport()
    page.generateResultReportImage()
    page.shareResultReportImage()
    page.previewResultReportImage()
    page.saveResultReportImage()
    assert.equal(page.data.isGeneratingResultReport, false, 'report actions cannot restart after the share sheet closes')
    assert.equal(shareCalls.length, 0, 'a stale image cannot be sent after close')
    assert.equal(staleReportActionCount, 0, 'preview and save cannot run after close')

    page.setData({ resultReportImagePath: '' })
    page.openSharePreview()
    assert.equal(page.data.isGeneratingResultReport, true)
    const lateDraw = drawCallbacks.shift()
    page.onHide()
    assert.equal(page.data.isGeneratingResultReport, false)
    lateDraw()
    assert.equal(exportCount, 0, 'hiding the page invalidates a pending canvas callback')
    page.setData({ resultReportImagePath: 'temp://late-hidden.png' })
    page.resultReportSignature = page.getResultReportSignature()
    wx.getFileSystemManager = () => ({ access: ({ success }) => { accessCount += 1; success() } })
    page.retryResultReport()
    page.generateResultReportImage()
    page.previewResultReportImage()
    page.shareResultReportImage()
    page.saveResultReportImage()
    assert.equal(page.data.isGeneratingResultReport, false, 'hidden share sheets reject all report actions')
    assert.equal(accessCount, 0, 'hidden retry/generate do not inspect or reuse a cached image')
    assert.equal(shareCalls.length, 0, 'hidden share does not invoke WeChat APIs')
    assert.equal(staleReportActionCount, 0, 'hidden preview/save do not invoke WeChat APIs')

    page.setData({ resultReportImagePath: '' })
    page.resultReportSignature = ''
    page.onShow()
    page.retryResultReport()
    assert.equal(page.data.isGeneratingResultReport, true, 'show restores the active share sheet retry path')
    const resumedDraw = drawCallbacks.shift()
    resumedDraw()
    assert.equal(exportCount, 1, 'a visible retry can reach the export callback')
    const lateExport = exportCallbacks.shift()
    page.onHide()
    lateExport.success({ tempFilePath: 'temp://late-export.png' })
    assert.equal(page.data.resultReportImagePath, '', 'an export completed after hide cannot restore a stale image')
    assert.equal(page.data.resultReportPreviewVisible, false)

    page.onShow()
    page.retryResultReport()
    assert.equal(page.data.isGeneratingResultReport, true, 'a later show permits another valid retry')
    assert.equal(drawCallbacks.length, 1)
  } finally {
    if (originalContext === undefined) delete wx.createCanvasContext
    else wx.createCanvasContext = originalContext
    if (originalExport === undefined) delete wx.canvasToTempFilePath
    else wx.canvasToTempFilePath = originalExport
    context.close()
  }
}

function testPageContainerBackLifecycle() {
  const context = bootPage({ seedPreferences: true, pageContainerSupport: true })
  const { page, wx, clock, modals } = context
  const originalContext = wx.createCanvasContext
  const originalExport = wx.canvasToTempFilePath
  const drawCallbacks = []
  let exportCount = 0
  try {
    page.onShow()
    assert.equal(page.data.pageContainerSupported, true, 'the base-library feature check enables one native page container')
    choose(page, 'modeIndex', 1)
    assert.equal(page.data.reminderActive, true)
    page.openCalculationDetails({ currentTarget: { dataset: { type: 'calculation' } } })
    assert.equal(page._activePageContainerOverlay.name, 'details')
    page.onPageContainerBeforeLeave()
    const remaining = page._reminderRemainingMs
    clock.advance(4000)
    assert.equal(page._reminderRemainingMs, remaining, 'native-container leave keeps the visible-time clock paused')
    page.onPageContainerAfterLeave()
    assert.equal(page.data.detailsVisible, false, 'native back clears the active overlay after leave')
    assert.equal(page._reminderTimer != null, true, 'afterleave resumes the remaining visible-time timer')

    page.openCalculationDetails({ currentTarget: { dataset: { type: 'calculation' } } })
    page.closeDetails()
    assert(page._pageContainerLeave, 'closing the sheet holds the clock through the native leave transition')
    page.onShow()
    assert.equal(page._reminderTimer, null, 'a page show callback cannot restart the clock before afterleave')
    const closingRemaining = page._reminderRemainingMs
    clock.advance(4000)
    assert.equal(page._reminderRemainingMs, closingRemaining)
    page.onPageContainerAfterLeave()
    assert(page._reminderTimer != null, 'afterleave restarts the clock after the close transition')

    page.openCalculationDetails({ currentTarget: { dataset: { type: 'limits' } } })
    const oldEpoch = page._activePageContainerOverlay.epoch
    page.closeDetails()
    page.onPageContainerAfterLeave()
    assert.equal(page.data.detailsVisible, false, 'the original overlay finishes leaving before another root action')
    page.openCalculationDetails({ currentTarget: { dataset: { type: 'calculation' } } })
    const newEpoch = page._activePageContainerOverlay.epoch
    assert.notEqual(newEpoch, oldEpoch)
    page.onPageContainerAfterLeave()
    assert.equal(page.data.detailsVisible, true, 'a duplicate old afterleave callback cannot close a newly opened overlay')

    page.closeDetails()
    page.onPageContainerAfterLeave()
    choose(page, 'modeIndex', 0)
    wx.createCanvasContext = () => new Proxy({}, { get: (_target, name) => {
      if (name === 'measureText') return (text) => ({ width: String(text).length * 14 })
      if (name === 'draw') return (_reserve, callback) => drawCallbacks.push(typeof _reserve === 'function' ? _reserve : callback)
      return () => {}
    } })
    wx.canvasToTempFilePath = () => { exportCount += 1 }
    page.openSharePreview()
    assert.equal(page.data.isGeneratingResultReport, true)
    page.onPageContainerBeforeLeave()
    assert.equal(page.data.isGeneratingResultReport, false, 'beforeleave cancels in-flight report generation')
    page.retryResultReport()
    page.generateResultReportImage()
    page.shareResultReportImage()
    page.previewResultReportImage()
    page.saveResultReportImage()
    assert.equal(exportCount, 0, 'report actions are refused while the native sheet is leaving')
    drawCallbacks.shift()()
    assert.equal(exportCount, 0, 'a late draw callback cannot export after native back begins')
    page.onPageContainerAfterLeave()
    assert.equal(page.data.shareSheetVisible, false)

    const records = require('../../utils/records')
    const project = records.createProject('返回键项目')
    const payload = page.getRecordPayload()
    records.addRecordToProject(payload, project.id, { name: '旧名称', note: '' })
    page.openProjectSheet()
    page.chooseProject({ currentTarget: { dataset: { id: project.id } } })
    page.onProjectConfigNameInput({ detail: { value: '新名称' } })
    page.saveProjectConfiguration()
    const confirm = modals.at(-1)
    assert.equal(page._projectSavePending, true)
    const requestId = page._projectRequestId
    page.onPageContainerBeforeLeave()
    assert(page._projectRequestId > requestId, 'beforeleave invalidates the pending project request nonce')
    assert.equal(page._projectSavePending, false)
    confirm.success({ confirm: true })
    assert.equal(records.getRecordByPayload(payload).projectMetadata[project.id].name, '旧名称',
      'a delayed project confirmation cannot write after native back')
    page.onPageContainerAfterLeave()
    assert.equal(page.data.projectSheetVisible, false)

    page.openCalculationDetails({ currentTarget: { dataset: { type: 'calculation' } } })
    page.onPageContainerBeforeLeave()
    const setData = page.setData
    let setDataAfterUnload = 0
    page.setData = function guardLateSetData(changes, callback) {
      if (this._isUnloaded) setDataAfterUnload += 1
      return setData.call(this, changes, callback)
    }
    page.onUnload()
    page.onPageContainerAfterLeave()
    assert.equal(setDataAfterUnload, 0, 'late native afterleave callbacks cannot write page state after unload')
  } finally {
    if (originalContext === undefined) delete wx.createCanvasContext
    else wx.createCanvasContext = originalContext
    if (originalExport === undefined) delete wx.canvasToTempFilePath
    else wx.canvasToTempFilePath = originalExport
    context.close()
  }
}

function testReminderTimerCallbackOwnership() {
  const olderEpoch = bootPage({ seedPreferences: true })
  try {
    const { page, clock } = olderEpoch
    page.onShow()
    choose(page, 'modeIndex', 1)
    const staleHandle = page._reminderTimer
    const staleTimer = clock.scheduled().find((timer) => timer.id === staleHandle)
    assert(staleTimer)
    const firstEpoch = page._reminderEpoch
    choose(page, 'sensitivityIndex', 1)
    assert(page._reminderEpoch > firstEpoch, 'a new edit advances the reminder epoch')
    const currentHandle = page._reminderTimer
    const currentRemaining = page._reminderRemainingMs
    assert.notEqual(currentHandle, staleHandle)
    staleTimer.callback()
    assert.equal(page._reminderTimer, currentHandle, 'an old-epoch callback cannot clear the newer timer')
    assert.equal(page._reminderRemainingMs, currentRemaining, 'an old-epoch callback cannot consume remaining time')
    page.onHide()
    assert.equal(clock.pendingCount(), 0, 'onHide cancels the current timer after an old callback was delivered')
    const hiddenRemaining = page._reminderRemainingMs
    staleTimer.callback()
    assert.equal(clock.pendingCount(), 0)
    assert.equal(page._reminderRemainingMs, hiddenRemaining, 'a delivered stale callback cannot change hidden remaining time')
  } finally { olderEpoch.close() }

  const sameEpoch = bootPage({ seedPreferences: true })
  try {
    const { page, clock } = sameEpoch
    page.onShow()
    choose(page, 'modeIndex', 1)
    const staleHandle = page._reminderTimer
    const staleTimer = clock.scheduled().find((timer) => timer.id === staleHandle)
    assert(staleTimer)
    const epoch = page._reminderEpoch
    page.onHide()
    const pausedRemaining = page._reminderRemainingMs
    page.onShow()
    assert.equal(page._reminderEpoch, epoch, 'hide/show resumes within the same reminder epoch')
    const resumedHandle = page._reminderTimer
    assert.notEqual(resumedHandle, staleHandle)
    staleTimer.callback()
    assert.equal(page._reminderTimer, resumedHandle, 'same-epoch callback must still own the current timer handle')
    assert.equal(page._reminderRemainingMs, pausedRemaining, 'same-epoch stale callback cannot consume paused time')
    page.onHide()
    assert.equal(clock.pendingCount(), 0, 'onHide cancels the resumed handle')
    const hiddenRemaining = page._reminderRemainingMs
    staleTimer.callback()
    assert.equal(clock.pendingCount(), 0)
    assert.equal(page._reminderRemainingMs, hiddenRemaining)
  } finally { sameEpoch.close() }
}

function testPageContainerOverlayOpenerMatrix() {
  const openers = {
    selector: (page) => page.openEquipmentSelector({ currentTarget: { dataset: { type: 'amplifier' } } }),
    details: (page) => page.openCalculationDetails({ currentTarget: { dataset: { type: 'calculation' } } }),
    share: (page) => page.openSharePreview(),
    project: (page) => page.openProjectSheet(),
  }
  const visible = (page) => [
    page.data.selectorVisible, page.data.detailsVisible,
    page.data.shareSheetVisible, page.data.projectSheetVisible,
  ]
  const expected = { selector: [true, false, false, false], details: [false, true, false, false],
    share: [false, false, true, false], project: [false, false, false, true] }

  for (const native of [false, true]) {
    for (const activeName of Object.keys(openers)) {
      for (const attemptedName of Object.keys(openers)) {
        const context = bootPage({ seedPreferences: true, pageContainerSupport: native })
        const { page } = context
        try {
          openers[activeName](page)
          assert.equal(page._activePageContainerOverlay?.name, activeName)
          const epoch = page._activePageContainerOverlay.epoch
          openers[attemptedName](page)
          assert.equal(page._activePageContainerOverlay?.epoch, epoch,
            `${native ? 'native' : 'fallback'} ${activeName} blocks ${attemptedName}`)
          assert.deepEqual(visible(page), expected[activeName],
            `${native ? 'native' : 'fallback'} ${activeName} remains the only overlay after ${attemptedName}`)
          const close = {
            selector: page.closeEquipmentSelector, details: page.closeDetails,
            share: page.closeSharePreview, project: page.closeProjectSheet,
          }[activeName]
          close.call(page)
          if (native) page.onPageContainerAfterLeave()
          assert.deepEqual(visible(page), [false, false, false, false])
        } finally { context.close() }
      }
    }
  }
}

function testSelectorLeaveOwnership() {
  for (const native of [false, true]) {
    for (const selectDifferent of [false, true]) {
      const context = bootPage({ seedPreferences: true, pageContainerSupport: native })
      const { page } = context
      try {
        page.openEquipmentSelector({ currentTarget: { dataset: { type: 'amplifier' } } })
        const currentIndex = page.data.amplifierIndex
        const item = selectDifferent
          ? page.data.selectorItems.find((candidate) => candidate.index !== currentIndex)
          : page.data.selectorItems.find((candidate) => candidate.index === currentIndex)
        assert(item, 'the selector exposes the chosen model for changed and same-value events')
        const priorModel = page.data.selectedAmplifier.model
        page.selectEquipment({ currentTarget: { dataset: { index: String(item.index) } } })
        assert.equal(page.data.selectorVisible, false)
        if (selectDifferent) assert.notEqual(page.data.selectedAmplifier.model, priorModel)
        else assert.equal(page.data.selectedAmplifier.model, priorModel)
        if (native) {
          assert.equal(page._activePageContainerOverlay?.name, 'selector')
          assert.equal(page._pageContainerLeave?.fallback, false)
          page.openProjectSheet()
          assert.equal(page.data.projectSheetVisible, false, 'native selector leave lock blocks another sheet')
          page.onPageContainerAfterLeave()
        }
        assert.equal(page._activePageContainerOverlay, null,
          `${native ? 'native' : 'fallback'} selector releases only after its leave is complete`)
      } finally { context.close() }
    }
  }
}

function testImplicitOverlayCloseReleasePaths() {
  for (const native of [false, true]) {
    const projectContext = bootPage({ seedPreferences: true, pageContainerSupport: native })
    try {
      const { page } = projectContext
      page.openProjectSheet()
      assert.equal(page.data.projectSheetVisible, true)
      page.commitInput({ modeIndex: page.data.modeIndex === 0 ? 1 : 0 })
      assert.equal(page.data.projectSheetVisible, false, 'a calculation update closes a stale project snapshot')
      if (native) {
        assert.equal(page._activePageContainerOverlay?.name, 'project')
        assert.equal(page._pageContainerLeave?.fallback, false)
        page.onPageContainerAfterLeave()
      }
      assert.equal(page._activePageContainerOverlay, null,
        `${native ? 'native' : 'fallback'} project invalidation releases overlay ownership`)
    } finally { projectContext.close() }

    const resetContext = bootPage({ seedPreferences: true, pageContainerSupport: native })
    try {
      const { page } = resetContext
      page.openCalculationDetails({ currentTarget: { dataset: { type: 'calculation' } } })
      const persisted = page.clearDraft()
      assert.equal(persisted, true)
      assert.equal(page.data.detailsVisible, false)
      if (native) {
        assert.equal(page._activePageContainerOverlay?.name, 'details')
        page.onPageContainerAfterLeave()
      }
      assert.equal(page._activePageContainerOverlay, null,
        `${native ? 'native' : 'fallback'} reset clears an existing overlay lock`)
    } finally { resetContext.close() }
  }
}

function testFallbackDeferredLeaveAndUnloadGuards() {
  const context = bootPage({ seedPreferences: true })
  const { page, wx, writes, modals } = context
  try {
    page.openEquipmentSelector({ currentTarget: { dataset: { type: 'amplifier' } } })
    const selectedIndex = page.data.amplifierIndex
    const callbacks = []
    const setData = page.setData
    page.setData = function deferRender(changes, callback) {
      setData.call(this, changes)
      if (callback) callbacks.push(callback)
    }
    page.selectEquipment({ currentTarget: { dataset: { index: String(selectedIndex) } } })
    assert.equal(page.data.selectorVisible, false)
    assert.equal(page._activePageContainerOverlay?.name, 'selector', 'fallback selection keeps its lock until rendered')
    const leavingEpoch = page._pageContainerLeave?.epoch
    assert.equal(page._pageContainerLeave?.fallback, true)
    page.openProjectSheet()
    assert.equal(page.data.projectSheetVisible, false, 'fallback render callback must run before another opener')
    callbacks.at(-1)()
    assert.equal(page._activePageContainerOverlay, null)
    assert.equal(page._pageContainerLeave, null)

    page.openCalculationDetails({ currentTarget: { dataset: { type: 'calculation' } } })
    const detailsEpoch = page._activePageContainerOverlay.epoch
    assert.notEqual(detailsEpoch, leavingEpoch)
    callbacks.at(-1)()
    assert.equal(page._activePageContainerOverlay?.epoch, detailsEpoch,
      'a duplicate callback from the old fallback render cannot clear a newer overlay')
    page.closeDetails()
    assert.equal(page._activePageContainerOverlay?.name, 'details', 'fallback X-close retains ownership through render')
    assert.equal(page._pageContainerLeave?.fallback, true)
    callbacks.at(-1)()
    assert.equal(page._activePageContainerOverlay, null)
    page.setData = setData

    let lateNavigation = 0
    let latePreviewOrSave = 0
    wx.navigateTo = () => { lateNavigation += 1 }
    wx.previewImage = () => { latePreviewOrSave += 1 }
    wx.saveImageToPhotosAlbum = () => { latePreviewOrSave += 1 }
    let lateShareMenu = 0
    wx.showShareImageMenu = () => { lateShareMenu += 1 }
    page.setData({ resultReportImagePath: 'stale-image-path' })
    const writesBeforeUnload = writes.length
    const modalsBeforeUnload = modals.length
    let writesAfterUnload = 0
    page.setData = function countLateSetData(changes, callback) {
      if (this._isUnloaded) writesAfterUnload += 1
      return setData.call(this, changes, callback)
    }
    page.onUnload()
    page.openProjectSheet()
    page.openSharePreview()
    page.openEquipmentSelector({ currentTarget: { dataset: { type: 'speaker' } } })
    page.openCalculationDetails({ currentTarget: { dataset: { type: 'limits' } } })
    page.requestReset()
    page.toggleCurrentFavorite()
    page.onGroupTap({ currentTarget: { dataset: { group: 'load' } } })
    stepCount(page, 1)
    choose(page, 'modeIndex', 1)
    page.pauseReminderForPicker()
    page.onPickerChange({ currentTarget: { dataset: { field: 'highPassFrequencyIndex' } }, detail: { value: '9' } })
    page.retryResultReport()
    page.generateResultReportImage()
    page.shareResultReportImage()
    page.previewResultReportImage()
    page.saveResultReportImage()
    page.openEquipmentDetail({ currentTarget: { dataset: { model: 'TC-2350B' } } })
    assert.equal(writesAfterUnload, 0)
    assert.equal(writes.length, writesBeforeUnload)
    assert.equal(modals.length, modalsBeforeUnload)
    assert.equal(lateShareMenu, 0, 'an unloaded page cannot open the native share menu')
    assert.equal(latePreviewOrSave, 0, 'an unloaded page cannot preview or save a stale image')
    assert.equal(lateNavigation, 0, 'a closed or unloaded selector cannot navigate from a late detail tap')
    assert.equal(page._activePageContainerOverlay, null)
  } finally { context.close() }
}

function testRootOverlayActionExclusivity() {
  const context = bootPage({ seedPreferences: true, pageContainerSupport: true })
  const { page, wx, writes, modals } = context
  try {
    page.onShow()
    const records = require('../../utils/records')
    const target = records.createProject('遮挡测试项目')
    assert(target)
    page.onGroupTap({ currentTarget: { dataset: { group: 'load' } } })
    const initialCount = page.data.countIndex
    const initialMode = page.data.modeIndex
    const initialGroup = page.data.activeGroup
    const initialWrites = writes.length
    const initialModals = modals.length
    const priorProjectSnapshot = { retained: true }
    page._projectNameTouched = true
    page._projectNoteTouched = true
    page._projectPrefillKey = 'keep-project-inputs'
    page._projectSnapshotForSave = priorProjectSnapshot

    page.openSharePreview()
    assert.equal(page.data.shareSheetVisible, true)
    const shareEpoch = page._activePageContainerOverlay.epoch
    page.openSharePreview()
    page.openProjectSheet()
    page.openEquipmentSelector({ currentTarget: { dataset: { type: 'amplifier' } } })
    page.openCalculationDetails({ currentTarget: { dataset: { type: 'limits' } } })
    page.requestReset()
    page.toggleCurrentFavorite()
    page.onGroupTap({ currentTarget: { dataset: { group: 'settings' } } })
    stepCount(page, 1)
    choose(page, 'modeIndex', 1)
    assert.equal(page._activePageContainerOverlay.epoch, shareEpoch, 'repeated and cross-sheet taps do not replace the active share sheet')
    assert.deepEqual([
      page.data.selectorVisible, page.data.detailsVisible, page.data.shareSheetVisible, page.data.projectSheetVisible,
    ], [false, false, true, false], 'root overlay actions are mutually exclusive')
    assert.deepEqual([page.data.activeGroup, page.data.countIndex, page.data.modeIndex],
      [initialGroup, initialCount, initialMode], 'background tabs and inputs ignore events while a sheet is open')
    assert.equal(page.data.currentFavorite, false, 'favorite ignores root taps while a sheet is open')
    assert.equal(modals.length, initialModals, 'reset does not open a native modal over a sheet')
    assert.equal(writes.length, initialWrites, 'blocked favorite/reset taps do not write storage')
    assert.equal(page._projectNameTouched, true)
    assert.equal(page._projectNoteTouched, true)
    assert.equal(page._projectPrefillKey, 'keep-project-inputs')
    assert.strictEqual(page._projectSnapshotForSave, priorProjectSnapshot,
      'a blocked project-sheet tap returns before clearing typed fields or its snapshot')

    page.closeSharePreview()
    assert(page._pageContainerLeave, 'closing starts a protected native leave transition')
    const closingProjectSnapshot = page._projectSnapshotForSave
    page.openProjectSheet()
    page.openEquipmentSelector({ currentTarget: { dataset: { type: 'amplifier' } } })
    page.openCalculationDetails({ currentTarget: { dataset: { type: 'calculation' } } })
    page.openSharePreview()
    stepCount(page, 1)
    choose(page, 'modeIndex', 1)
    page.onGroupTap({ currentTarget: { dataset: { group: 'settings' } } })
    assert.deepEqual([
      page.data.selectorVisible, page.data.detailsVisible, page.data.shareSheetVisible, page.data.projectSheetVisible,
    ], [false, false, false, false], 'root and background taps are ignored during native leave')
    assert.deepEqual([page.data.activeGroup, page.data.countIndex, page.data.modeIndex],
      [initialGroup, initialCount, initialMode], 'the leave transition blocks background input events')
    assert.equal(page._projectNameTouched, true)
    assert.strictEqual(page._projectSnapshotForSave, closingProjectSnapshot)
    page.onPageContainerAfterLeave()

    page.openProjectSheet()
    assert.equal(page.data.projectSheetVisible, true, 'a new root sheet opens after the prior leave completes')
    page.chooseProject({ currentTarget: { dataset: { id: target.id } } })
    page.onProjectConfigNameInput({ detail: { value: '手动填写的项目配置' } })
    page.onProjectConfigNoteInput({ detail: { value: '保留这段备注' } })
    const projectEpoch = page._activePageContainerOverlay.epoch
    const projectSnapshot = page._projectSnapshotForSave
    const typedName = page.data.projectConfigName
    const typedNote = page.data.projectConfigNote
    const projectWrites = writes.length
    const projectModals = modals.length
    page.openProjectSheet()
    page.openSharePreview()
    page.openEquipmentSelector({ currentTarget: { dataset: { type: 'speaker' } } })
    page.openCalculationDetails({ currentTarget: { dataset: { type: 'calculation' } } })
    page.requestReset()
    page.toggleCurrentFavorite()
    stepCount(page, 1)
    choose(page, 'modeIndex', 1)
    page.onGroupTap({ currentTarget: { dataset: { group: 'settings' } } })
    assert.equal(page._activePageContainerOverlay.epoch, projectEpoch)
    assert.deepEqual([
      page.data.selectorVisible, page.data.detailsVisible, page.data.shareSheetVisible, page.data.projectSheetVisible,
    ], [false, false, false, true], 'the existing project form stays the only visible sheet')
    assert.equal(page.data.projectConfigName, typedName)
    assert.equal(page.data.projectConfigNote, typedNote)
    assert.equal(page._projectNameTouched, true)
    assert.equal(page._projectNoteTouched, true)
    assert.strictEqual(page._projectSnapshotForSave, projectSnapshot)
    assert.equal(modals.length, projectModals)
    assert.equal(writes.length, projectWrites, 'blocked favorite/reset taps leave project state and storage untouched')

    page.closeProjectSheet()
    const projectLeave = page._pageContainerLeave
    page.openProjectSheet()
    assert.equal(page.data.projectSheetVisible, false, 'the project sheet cannot reopen until its leave completes')
    assert.strictEqual(page._pageContainerLeave, projectLeave)
    page.onPageContainerAfterLeave()

    page.requestReset()
    assert.equal(page._resetModalPending, true)
    const resetModalCount = modals.length
    page.requestReset()
    page.openSharePreview()
    page.openProjectSheet()
    page.openEquipmentSelector({ currentTarget: { dataset: { type: 'amplifier' } } })
    page.openCalculationDetails({ currentTarget: { dataset: { type: 'calculation' } } })
    page.onGroupTap({ currentTarget: { dataset: { group: 'settings' } } })
    stepCount(page, 1)
    choose(page, 'modeIndex', 1)
    assert.equal(modals.length, resetModalCount, 'a pending reset blocks duplicate root modals and overlays')
    assert.deepEqual([
      page.data.selectorVisible, page.data.detailsVisible, page.data.shareSheetVisible, page.data.projectSheetVisible,
    ], [false, false, false, false])
    assert.deepEqual([page.data.activeGroup, page.data.countIndex, page.data.modeIndex],
      [initialGroup, initialCount, initialMode], 'pending reset blocks background input events')
    modals.at(-1).success({ confirm: false })

    page.pauseReminderForPicker()
    page.openSharePreview()
    page.openProjectSheet()
    page.openEquipmentSelector({ currentTarget: { dataset: { type: 'amplifier' } } })
    page.openCalculationDetails({ currentTarget: { dataset: { type: 'calculation' } } })
    const hpfIndex = page.data.highPassFrequencies.findIndex((item) => item.value === 100)
    page.onPickerChange({ currentTarget: { dataset: { field: 'highPassFrequencyIndex' } }, detail: { value: String(hpfIndex) } })
    assert.equal(page.data.highPassText, '100 Hz', 'a valid native picker result remains allowed')
    assert.deepEqual([
      page.data.selectorVisible, page.data.detailsVisible, page.data.shareSheetVisible, page.data.projectSheetVisible,
    ], [false, false, false, false], 'the picker itself blocks opening other root sheets')

    page.openSharePreview()
    page.pauseReminderForPicker()
    const unchangedHpf = page.data.highPassText
    const blockedPickerIndex = page.data.highPassFrequencies.findIndex((item) => item.value === 125)
    page.onPickerChange({ currentTarget: { dataset: { field: 'highPassFrequencyIndex' } }, detail: { value: String(blockedPickerIndex) } })
    assert.equal(page.data.highPassText, unchangedHpf, 'a native picker event queued behind share cannot alter HPF')
    assert.equal(page._pickerOverlayOpen, false, 'a blocked picker tap cannot claim picker ownership')
    page.closeSharePreview()
    page.onPageContainerAfterLeave()

    let navigationCount = 0
    wx.navigateTo = () => { navigationCount += 1 }
    page.openEquipmentSelector({ currentTarget: { dataset: { type: 'amplifier' } } })
    page.closeEquipmentSelector()
    page.openEquipmentDetail({ currentTarget: { dataset: { model: 'TC-2350B' } } })
    assert.equal(navigationCount, 0, 'a late equipment-detail event after selector close cannot navigate')
    page.onPageContainerAfterLeave()
  } finally { context.close() }
}

function testLimiterInputHaptics() {
  const context = bootPage({ seedPreferences: true })
  const { page, clock } = context
  try {
    page.onShow()
    choose(page, 'sensitivityIndex', 1)
    expectVibrations(context, 'light')
    assert.equal(page.data.reminderActive, true, 'the test starts the real reminder timer through an input event')
    clearVibrations(context)
    clock.advance(15000)
    expectVibrations(context)

    page.onGroupTap({ currentTarget: { dataset: { group: 'load' } } })
    expectVibrations(context, 'light')
    clearVibrations(context)
    page.onGroupTap({ currentTarget: { dataset: { group: 'load' } } })
    expectVibrations(context)

    choose(page, 'modeIndex', 1)
    assert.equal(page.data.calculationState, 'invalid', 'a legal mode choice may produce a domain warning')
    expectVibrations(context, 'light')
    clearVibrations(context)
    choose(page, 'modeIndex', 1)
    expectVibrations(context)

    page.commitInput({ modeIndex: 0, sensitivityIndex: 0 })
    expectVibrations(context, 'light')
    clearVibrations(context)
    page.onCountStep({ currentTarget: { dataset: { step: '-1' } } })
    expectVibrations(context)
    for (let index = 0; index < page.data.counts.length - 1; index += 1) {
      clearVibrations(context)
      stepCount(page, 1)
      expectVibrations(context, 'light')
    }
    clearVibrations(context)
    stepCount(page, 1)
    expectVibrations(context)

    page.pauseReminderForPicker()
    expectVibrations(context, 'light')
    clearVibrations(context)
    page.pauseReminderForPicker()
    expectVibrations(context)
    page.onPickerChange({ currentTarget: { dataset: { field: 'wiringIndex' } }, detail: { value: '0' } })
    expectVibrations(context, 'light')
    assert.equal(page.data.calculationState, 'invalid', 'a valid picker choice still confirms when the engine warns')

    clearVibrations(context)
    page.pauseReminderForPicker()
    expectVibrations(context, 'light')
    clearVibrations(context)
    page.onPickerChange({ currentTarget: { dataset: { field: 'wiringIndex' } }, detail: { value: '0' } })
    expectVibrations(context)
    page.pauseReminderForPicker()
    clearVibrations(context)
    page.cancelPicker()
    expectVibrations(context)
    page.pauseReminderForPicker()
    clearVibrations(context)
    page.onPickerChange({ currentTarget: { dataset: { field: 'wiringIndex' } }, detail: { value: '999' } })
    expectVibrations(context)

    page.openEquipmentSelector({ currentTarget: { dataset: { type: 'amplifier' } } })
    expectVibrations(context, 'light')
    const categoryIndex = page.data.selectorCategoryIndex
    const otherCategoryIndex = page.data.selectorCategories.findIndex((_category, index) => index !== categoryIndex)
    assert(otherCategoryIndex >= 0, 'the selector exposes another equipment category')
    clearVibrations(context)
    page.onSelectorCategoryTap({ currentTarget: { dataset: { index: String(otherCategoryIndex) } } })
    expectVibrations(context, 'light')
    clearVibrations(context)
    page.onSelectorCategoryTap({ currentTarget: { dataset: { index: String(otherCategoryIndex) } } })
    expectVibrations(context)
    page.onSelectorCategoryTap({ currentTarget: { dataset: { index: '999' } } })
    expectVibrations(context)

    page.onSelectorCategoryTap({ currentTarget: { dataset: { index: String(categoryIndex) } } })
    clearVibrations(context)
    page.selectEquipment({ currentTarget: { dataset: { index: '999999' } } })
    expectVibrations(context)
    const alternative = page.data.selectorItems.find((item) => item.index !== page.data.amplifierIndex)
    assert(alternative, 'the open selector contains another amplifier')
    page.selectEquipment({ currentTarget: { dataset: { index: String(alternative.index) } } })
    expectVibrations(context, 'light')
  } finally { context.close() }
}

function testLimiterMenuAndExistingActionHaptics() {
  const context = bootPage({ seedPreferences: true })
  const { page, vibrations } = context
  const records = require('../../utils/records')
  try {
    page.onShow()
    page.toggleCurrentFavorite()
    expectVibrations(context, 'medium')
    const payload = page.getRecordPayload()
    assert.equal(records.getFavoriteByPayload(payload)?.favorite, true, 'the favorite is stored independently')
    assert.equal(records.getRecordByPayload(payload), null, 'favoriting alone does not create a project record')

    const project = records.createProject('震动反馈测试项目')
    assert(project)
    clearVibrations(context)
    page.openProjectSheet()
    expectVibrations(context, 'light')
    assert.equal(page.data.projectSheetVisible, true)
    assert(page.data.projectItems.some((item) => item.id === project.id))
    page.chooseProject({ currentTarget: { dataset: { id: project.id } } })
    clearVibrations(context)
    page.saveProjectConfiguration()
    expectVibrations(context, 'medium')
    assert.equal(page.data.projectStep, 'success')
    const saved = records.getRecordByPayload(payload)
    assert.equal(saved.favorite, false, 'the project record does not absorb favorite state')
    assert.equal(records.getFavoriteByPayload(payload)?.favorite, true, 'saving project metadata preserves the separate favorite')
    assert(saved.projectMetadata[project.id], 'the real project save action writes its project record')

    page.continueAfterProjectSave()
    page.onPageContainerAfterLeave()
    const resultBeforeReset = clone(page.data.result)
    clearVibrations(context)
    page.requestReset()
    expectVibrations(context, 'light')
    clearVibrations(context)
    context.modals.at(-1).success({ confirm: false })
    expectVibrations(context)
    assert.deepEqual(page.data.result, resultBeforeReset, 'canceling the reset keeps the result')

    page.requestReset()
    expectVibrations(context, 'light')
    clearVibrations(context)
    context.modals.at(-1).success({ confirm: true })
    expectVibrations(context)
    assert.equal(page.data.calculationState, 'empty')
    const retained = records.getRecordByPayload(payload)
    assert.equal(retained.favorite, false, 'confirming reset retains the project record without conflating favorites')
    assert.equal(records.getFavoriteByPayload(payload)?.favorite, true, 'confirming reset retains the separate saved favorite')
    assert(retained.projectMetadata[project.id], 'confirming reset retains the saved project')
  } finally { context.close() }
}

function testLimiterSharePreviewHaptics() {
  const context = bootPage({ seedPreferences: true })
  const { page } = context
  try {
    page.onShow()
    page.openSharePreview()
    expectVibrations(context, 'light')
    assert.equal(page.data.shareSheetVisible, true)
    assert.equal(page.data.isGeneratingResultReport, false,
      'the Limiter page-owned generator handles the unavailable canvas without another pulse')

    page.setData({ resultReportImagePath: 'temp://limiter-share.png' })
    clearVibrations(context)
    assert.equal(page.shareResultReportImage(), true)
    expectVibrations(context)
    const share = context.shareCalls.at(-1)
    assert.deepEqual({ path: share.path, needShowEntrance: share.needShowEntrance }, {
      path: 'temp://limiter-share.png', needShowEntrance: false,
    })

    page.closeSharePreview()
    page.onPageContainerAfterLeave()
    page.setData({ resultReportImagePath: 'temp://limiter-cached.png' })
    page.resultReportSignature = page.getResultReportSignature()
    clearVibrations(context)
    page.openSharePreview()
    expectVibrations(context, 'light')
    assert.equal(page.data.resultReportPreviewVisible, true, 'the valid cached image opens through the page-owned cache check')
    expectVibrations(context, 'light')
  } finally { context.close() }
}

function testLimiterHapticsRespectGuardsAndApiFailures() {
  const emptyContext = bootPage()
  try {
    emptyContext.page.openSharePreview()
    emptyContext.page.openProjectSheet()
    emptyContext.page.toggleCurrentFavorite()
    emptyContext.page.requestReset()
    expectVibrations(emptyContext)
  } finally { emptyContext.close() }

  const guardedContext = bootPage({ seedPreferences: true })
  try {
    const { page } = guardedContext
    page.openEquipmentSelector({ currentTarget: { dataset: { type: 'amplifier' } } })
    expectVibrations(guardedContext, 'light')
    clearVibrations(guardedContext)
    page.openSharePreview()
    page.openProjectSheet()
    page.requestReset()
    page.toggleCurrentFavorite()
    expectVibrations(guardedContext)
    page.closeEquipmentSelector()
    expectVibrations(guardedContext)
    page.onPageContainerAfterLeave()
    page.onUnload()
    page.onGroupTap({ currentTarget: { dataset: { group: 'settings' } } })
    expectVibrations(guardedContext)
  } finally { guardedContext.close() }

  const records = require('../../utils/records')
  for (const failureMode of ['missing', 'throw', 'fail']) {
    const context = bootPage({ seedPreferences: true })
    try {
      const { page, wx, storage, writes } = context
      page.onShow()
      page.toggleCurrentFavorite()
      clearVibrations(context)
      const payload = page.getRecordPayload()
      const recordBefore = clone(records.getRecordByPayload(payload))
      const resultBefore = clone(page.data.result)
      const payloadBefore = clone(payload)
      const storageBefore = clone([...storage.entries()])
      const writesBefore = writes.length
      const attempted = []
      if (failureMode === 'missing') {
        delete wx.vibrateShort
      } else {
        wx.vibrateShort = (options) => {
          attempted.push(options)
          if (failureMode === 'throw') throw new Error('simulated vibration failure')
          options.fail({ errMsg: 'simulated vibration failure' })
        }
      }

      page.onGroupTap({ currentTarget: { dataset: { group: 'load' } } })
      assert.equal(page.data.activeGroup, 'load', `${failureMode} vibration keeps the requested UI action working`)
      assert.deepEqual(page.data.result, resultBefore)
      assert.deepEqual(page.getRecordPayload(), payloadBefore)
      assert.deepEqual(records.getRecordByPayload(payload), recordBefore)
      assert.deepEqual([...storage.entries()], storageBefore)
      assert.equal(writes.length, writesBefore)
      assert.deepEqual(attempted.map((options) => options.type), failureMode === 'missing' ? [] : ['light'])
    } finally { context.close() }
  }
}

function testLimiterHapticsAfterPageHide() {
  const context = bootPage({ seedPreferences: true })
  const { page, wx } = context
  try {
    page.onShow()
    page.setData({ resultReportImagePath: 'temp://limiter-pending.png' })
    page.resultReportSignature = page.getResultReportSignature()
    let access
    wx.getFileSystemManager = () => ({ access: (options) => { access = options } })

    page.openSharePreview()
    expectVibrations(context, 'light')
    assert.equal(typeof access?.success, 'function', 'the cache callback is pending while the preview is active')
    clearVibrations(context)
    page.onHide()
    access.success()
    expectVibrations(context)
    assert.equal(page.data.resultReportPreviewVisible, false, 'a stale cache callback cannot update a hidden page')
  } finally { context.close() }
}

testOverlayIncludeUsesPageScope()
testNullHpfDoesNotEnableReset()
testEmptyAndRealInputEvents()
testFifteenSecondReminderDuration()
testUnknownRestoredValueStaysIncomplete()
testFavoriteRenderingAcrossInvalidResult()
testProjectSnapshotAndContinuation()
testProjectMetadataProjectionInPage()
testPendingReportCallbacksAreInvalidated()
testPageContainerBackLifecycle()
testReminderTimerCallbackOwnership()
testPageContainerOverlayOpenerMatrix()
testSelectorLeaveOwnership()
testImplicitOverlayCloseReleasePaths()
testFallbackDeferredLeaveAndUnloadGuards()
testRootOverlayActionExclusivity()
testLimiterInputHaptics()
testLimiterMenuAndExistingActionHaptics()
testLimiterSharePreviewHaptics()
testLimiterHapticsRespectGuardsAndApiFailures()
testLimiterHapticsAfterPageHide()
console.log('Limiter page state/refactor tests passed')
