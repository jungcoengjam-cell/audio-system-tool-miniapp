const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { createRuntime, clone } = require('./runtime.cjs')
const checks = []
async function test(name, task) { try { const evidence = await task(); checks.push({ name, passed: true, evidence }); console.log('PASS', name) } catch (error) { checks.push({ name, passed: false, error: error.stack }); console.error('FAIL', name, error.message) } }
function runtime() { const env = createRuntime(); env.page(); return env }
async function invoke(env, method, dataset = {}, detail = {}, extra = {}) { return env.dispatch(method, dataset, detail, extra) }
async function cancel(env, method) { const length = env.events.modals.length; await invoke(env, method); if (env.events.modals.length > length) env.respondModal(true) }
const writeCount = env => env.events.writes.filter(value => value.key === 'audioTool.projects.v1').length
async function main() {
  await test('actual duplicate device instances remain separate groups and stable stored codes', async () => {
    const env = runtime(), state = env.snapshot()
    assert.equal(state.data.groups.length, 2)
    assert.notEqual(state.data.groups[0].key, state.data.groups[1].key)
    assert.deepEqual(state.schedule.lines.map(line => line.code), ['A001', 'A002', 'A003', 'A004'])
    return { groups: state.data.groups.map(({ key, lines }) => ({ key, ids: lines.map(line => line.id) })), codes: state.schedule.lines.map(line => line.code) }
  })
  await test('device source preselect and blank cable draft', async () => {
    const env = runtime(); await invoke(env, 'connectDevice', { id: 'receiver-1' }); const state = env.snapshot()
    assert.equal(state.data.draft.fromDeviceId, 'receiver-1'); assert.equal(state.data.draft.spec, ''); assert.equal(state.data.draft.connectorA, ''); assert.equal(state.data.draft.connectorB, '')
    assert.equal(state.data.draftPairs.length, 1); return state.data.draft
  })
  await test('continuous fill stays draft then batch parent save is atomic and repeated tap safe', async () => {
    const env = runtime(); await invoke(env, 'openNewLine'); await invoke(env, 'selectEndpoint', { side: 'from' }, { value: 1 }); await invoke(env, 'selectEndpoint', { side: 'to' }, { value: 2 })
    const before = env.snapshot().schedule, writes = writeCount(env)
    await invoke(env, 'openContinuous'); for (const [field, value] of Object.entries({ fromPort: 'OUT09', toPort: 'IN09', count: '3' })) await invoke(env, 'onContinuousInput', { field }, { value })
    assert.deepEqual(env.snapshot().data.continuousPairs.map(pair => pair.fromPort), ['OUT09', 'OUT10', 'OUT11'])
    await invoke(env, 'fillContinuous'); assert.deepEqual(env.snapshot().schedule, before); assert.equal(writeCount(env), writes)
    await invoke(env, 'onPairInput', { index: 1, field: 'toPort' }, { value: 'MANUAL IN' }); await invoke(env, 'onDraftInput', { field: 'spec' }, { value: '自定义规格' }); await invoke(env, 'onDraftInput', { field: 'lengthText' }, { value: '5' })
    await invoke(env, 'saveLine'); const after = env.snapshot(); assert.equal(after.schedule.lines.length, before.lines.length + 3); assert.equal(writeCount(env), writes + 1); assert.equal(after.schedule.revision, before.revision + 1)
    assert.deepEqual(after.schedule.lines.slice(-3).map(line => line.spec), ['自定义规格', '自定义规格', '自定义规格'])
    assert.deepEqual(after.schedule.lines.slice(-3).map(line => line.lengthText), ['5', '5', '5'])
    assert.equal(after.schedule.lines.at(-2).toPort, 'MANUAL IN')
    await invoke(env, 'saveLine'); assert.equal(env.snapshot().schedule.lines.length, after.schedule.lines.length)
    const stored = clone(env.storage); env.page(); assert.deepEqual(env.storage, stored); assert.deepEqual(env.snapshot().schedule, after.schedule)
    return { added: after.schedule.lines.slice(-3), writes: writeCount(env) - writes }
  })
  await test('shared length before continuous fill replaces the empty placeholder without creating a fourth row', async () => {
    const env = runtime()
    await invoke(env, 'openNewLine')
    await invoke(env, 'selectEndpoint', { side: 'from' }, { value: 1 })
    await invoke(env, 'selectEndpoint', { side: 'to' }, { value: 2 })
    await invoke(env, 'onDraftInput', { field: 'lengthText' }, { value: '5' })
    await invoke(env, 'openContinuous')
    for (const [field, value] of Object.entries({ fromPort: 'OUT1', toPort: 'IN1', count: '3' })) await invoke(env, 'onContinuousInput', { field }, { value })
    await invoke(env, 'fillContinuous')
    const pairs = env.snapshot().data.draftPairs
    assert.equal(pairs.length, 3)
    assert.deepEqual(pairs.map(pair => pair.fromPort), ['OUT1', 'OUT2', 'OUT3'])
    assert.deepEqual(pairs.map(pair => pair.lengthText), ['5', '5', '5'])
    assert.ok(pairs.every(pair => pair.fromPort && pair.toPort))
    const initialCount = env.snapshot().schedule.lines.length
    await invoke(env, 'saveLine')
    assert.equal(env.snapshot().schedule.lines.length, initialCount + 3)
    return { pairs, addedRecords: 3 }
  })
  await test('single line edit retains ID/code hidden fields and has no batch controls', async () => {
    const env = runtime(), original = env.snapshot().schedule.lines[0]
    await invoke(env, 'onLineTap', { id: original.id }); await invoke(env, 'editDetailLine'); assert.equal(env.snapshot().data.draftIsNew, false)
    await invoke(env, 'addDraftPair'); await invoke(env, 'openContinuous'); assert.equal(env.snapshot().data.draftPairs.length, 1); assert.equal(env.snapshot().data.continuousVisible, false)
    await invoke(env, 'onPairInput', { index: 0, field: 'fromPort' }, { value: 'EDIT OUT' }); await invoke(env, 'saveLine')
    const updated = env.snapshot().schedule.lines.find(line => line.id === original.id); assert.equal(updated.code, original.code); assert.equal(updated.fromPort, 'EDIT OUT'); assert.equal(updated.status, original.status); assert.equal(updated.cableType, original.cableType)
    return updated
  })
  await test('dirty device cancel choice and line cancel leave persistent schedule and nextNumber intact', async () => {
    const env = runtime(), initial = clone(env.snapshot().schedule)
    await invoke(env, 'openDeviceEditor'); await invoke(env, 'onDeviceDraftInput', { field: 'name' }, { value: '丢弃设备' }); await invoke(env, 'requestCloseDeviceEditor'); env.respondModal(false); assert.equal(env.snapshot().data.deviceEditorVisible, true); await cancel(env, 'requestCloseDeviceEditor'); assert.equal(env.snapshot().data.deviceEditorVisible, false)
    await invoke(env, 'openNewLine'); await invoke(env, 'onPairInput', { index: 0, field: 'fromPort' }, { value: 'UNSAVED' }); await cancel(env, 'requestCloseEditor'); assert.equal(env.snapshot().data.editorVisible, false); assert.deepEqual(env.snapshot().schedule, initial); assert.equal(writeCount(env), 0)
    return { nextNumber: env.snapshot().schedule.nextNumber, writes: writeCount(env) }
  })
  await test('line horizontal movement and native scroll event suppress accidental tap', async () => {
    const env = runtime(), id = env.snapshot().schedule.lines[0].id
    await invoke(env, 'onLineTouchStart', { id }, {}, { touches: [{ clientX: 200, clientY: 100 }] }); await invoke(env, 'onLineTouchMove', { id }, {}, { touches: [{ clientX: 180, clientY: 100 }] }); await invoke(env, 'onLineTouchEnd'); await invoke(env, 'onLineTap', { id }); assert.equal(env.snapshot().data.detailVisible, false)
    await new Promise(resolve => setTimeout(resolve, 360)); await invoke(env, 'onPortCellScroll'); await invoke(env, 'onLineTap', { id }); assert.equal(env.snapshot().data.detailVisible, false)
    await new Promise(resolve => setTimeout(resolve, 360)); await invoke(env, 'onLineTap', { id }); assert.equal(env.snapshot().data.detailVisible, true)
    return { detailAfterIntentionalTap: true }
  })
  await test('project wheel Cancel and Done and new-project save are separate operations', async () => {
    const env = runtime(), initialId = env.snapshot().data.project.id
    await invoke(env, 'requestProjectPicker'); await invoke(env, 'onProjectWheelChange', {}, { value: [1] }); assert.equal(env.snapshot().data.project.id, initialId); await invoke(env, 'cancelProjectPicker'); assert.equal(env.snapshot().data.project.id, initialId)
    await invoke(env, 'requestProjectPicker'); await invoke(env, 'onProjectWheelChange', {}, { value: [1] }); await invoke(env, 'confirmProjectPicker'); assert.notEqual(env.snapshot().data.project.id, initialId)
    await invoke(env, 'requestNewProject'); await invoke(env, 'createAndOpenProject'); assert.equal(env.snapshot().data.newProjectVisible, true); assert.ok(env.snapshot().data.projectPickerError)
    await invoke(env, 'onProjectNameInput', {}, { value: 'QA 新项目' }); await invoke(env, 'createAndOpenProject'); const state = env.snapshot(); assert.equal(state.data.project.name, 'QA 新项目'); assert.equal(state.data.newProjectVisible, false); assert.equal(state.schedule.lines.length, 0)
    return { project: state.data.project }
  })
  await test('storage save failure stays recoverable and retry creates only one device', async () => {
    const env = runtime(), initial = clone(env.snapshot().schedule); env.failWrites(true)
    await invoke(env, 'openDeviceEditor'); await invoke(env, 'onDeviceDraftInput', { field: 'name' }, { value: '可重试设备' }); await invoke(env, 'saveDevices'); assert.deepEqual(env.snapshot().schedule, initial); assert.equal(env.snapshot().data.deviceEditorVisible, true)
    assert.ok(env.snapshot().data.saveError || env.snapshot().data.batchError)
    env.failWrites(false); await invoke(env, 'saveDevices'); assert.equal(env.snapshot().schedule.devices.length, initial.devices.length + 1); assert.equal(writeCount(env), 1)
    return { deviceCount: env.snapshot().schedule.devices.length, writes: writeCount(env) }
  })
  await test('Share from both tabs produces identical complete-project report jobs', async () => {
    const env = runtime(); await invoke(env, 'shareProject'); const first = clone(env.events.canvasCalls), sizes = clone(env.events.exports), images = clone(env.snapshot().data.reportImages); assert.ok(sizes.length > 0)
    await invoke(env, 'closeReportPreview'); await invoke(env, 'onWorkspaceTab', { tab: 'lines' }); await invoke(env, 'shareProject'); assert.deepEqual(env.snapshot().data.reportImages, images)
    const second = runtime(); await invoke(second, 'onWorkspaceTab', { tab: 'lines' }); await invoke(second, 'shareProject')
    assert.deepEqual(second.events.canvasCalls, first); assert.deepEqual(second.events.exports, sizes)
    return { pages: sizes.length, sameCachedArtifactAcrossTabs: true, recordedProductionDrawingCalls: first.length, sizes }
  })
  await test('JSON setData roundtrip clears actual device binding when editing to legacy endpoint', async () => {
    const env = createRuntime({ fixture: 'mixedlegacy' }); env.page(); const original = env.snapshot().schedule.lines[0]
    await invoke(env, 'editLine', { id: original.id }); const choiceIndex = env.snapshot().data.deviceChoices.findIndex(device => device.legacy && device.name === '历史设备'); assert.ok(choiceIndex > 0)
    await invoke(env, 'selectEndpoint', { side: 'from' }, { value: choiceIndex }); await invoke(env, 'saveLine')
    const updated = env.snapshot().schedule.lines.find(line => line.id === original.id)
    assert.equal(updated.fromDevice, '历史设备'); assert.equal(Object.hasOwn(updated, 'fromDeviceId'), false); assert.equal(updated.toDeviceId, original.toDeviceId); assert.equal(updated.code, original.code)
    return updated
  })
  await test('late export setData callback cannot cover newer device editor with stale preview', async () => {
    const env = runtime(); env.deferReportCallbacks(true); await invoke(env, 'shareProject'); assert.equal(env.snapshot().data.reportPreviewVisible, false)
    await invoke(env, 'openDeviceEditor'); assert.equal(env.snapshot().data.deviceEditorVisible, true); const flushed = env.flushDataCallbacks(); assert.equal(flushed, 1); assert.equal(env.snapshot().data.reportPreviewVisible, false); assert.equal(env.snapshot().data.deviceEditorVisible, true)
    return { delayedFinalCallbacks: flushed, deviceEditorVisible: env.snapshot().data.deviceEditorVisible, reportPreviewVisible: env.snapshot().data.reportPreviewVisible }
  })
  await test('continuous fill preserves existing partial-port input and multiple rows', async () => {
    const onePort = runtime(); await invoke(onePort, 'openNewLine'); await invoke(onePort, 'onPairInput', { index: 0, field: 'fromPort' }, { value: 'PRESERVED' }); await invoke(onePort, 'openContinuous')
    for (const [field, value] of Object.entries({ fromPort: 'OUT1', toPort: 'IN1', count: '2' })) await invoke(onePort, 'onContinuousInput', { field }, { value })
    await invoke(onePort, 'fillContinuous'); assert.equal(onePort.snapshot().data.draftPairs.length, 3); assert.equal(onePort.snapshot().data.draftPairs[0].fromPort, 'PRESERVED')
    const multiple = runtime(); await invoke(multiple, 'openNewLine'); await invoke(multiple, 'addDraftPair'); await invoke(multiple, 'openContinuous')
    for (const [field, value] of Object.entries({ fromPort: 'OUT1', toPort: 'IN1', count: '2' })) await invoke(multiple, 'onContinuousInput', { field }, { value })
    await invoke(multiple, 'fillContinuous'); assert.equal(multiple.snapshot().data.draftPairs.length, 4)
    return { onePortPreserved: onePort.snapshot().data.draftPairs, multipleRowsPreserved: multiple.snapshot().data.draftPairs }
  })
  const output = path.resolve(process.env.WIRING_QA_INTERACTION_OUTPUT || path.join(__dirname, 'evidence')); fs.mkdirSync(output, { recursive: true }); fs.writeFileSync(path.join(output, 'interaction-checks.json'), JSON.stringify({ runAt: new Date().toISOString(), actualController: true, isolatedStorage: true, checks }, null, 2))
  if (checks.some(check => !check.passed)) process.exitCode = 1
}
main().catch(error => { console.error(error); process.exitCode = 1 })
