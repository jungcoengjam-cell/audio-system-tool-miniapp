'use strict'

const assert = require('node:assert/strict')

const recordsPath = require.resolve('../../utils/records')
const contextPath = require.resolve('../../utils/result-record-context')
const actionsPath = require.resolve('../../utils/result-record-actions')
const keys = {
  schema: 'audioTool.storageSchemaVersion',
  projects: 'audioTool.projects.v1',
  records: 'audioTool.records.v1',
  favorites: 'audioTool.favorites.v1',
  recovery: 'audioTool.recovery.v1',
  sessions: 'audioTool.resultEditorSessions.v1',
  cable: 'audioTool.cable.preferences',
}

const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value))

function setup({ originalPreferences = { mode: 'constant', constantPowerText: '111' }, records = [] } = {}) {
  const storage = new Map(Object.entries(clone({
    [keys.schema]: 4,
    [keys.projects]: [{ id: 'project-main', name: '主项目', createdAt: 100, updatedAt: 200 }],
    [keys.records]: records,
    [keys.favorites]: [],
    [keys.recovery]: [],
    [keys.cable]: originalPreferences,
  })))
  const writeCounts = new Map()
  const failAt = new Map()
  const toasts = []
  const navigation = []
  let actionTapIndex = 0
  global.wx = {
    getStorageSync: (key) => clone(storage.get(key)),
    setStorageSync: (key, value) => {
      const count = (writeCounts.get(key) || 0) + 1
      writeCounts.set(key, count)
      if (failAt.get(key) === count) throw new Error(`injected write failure: ${key}#${count}`)
      storage.set(key, clone(value))
    },
    removeStorageSync: (key) => storage.delete(key),
    canIUse: () => true,
    navigateTo: ({ url, fail }) => { navigation.push(url); if (!url) fail?.() },
    navigateBack: () => { navigation.push('BACK') },
    showToast: (value) => toasts.push(value.title),
    showActionSheet: (options) => options.success?.({ tapIndex: actionTapIndex }),
    showModal: (options) => options.success?.({ confirm: true, content: 'QA 项目' }),
    vibrateShort: () => {},
  }
  global.getCurrentPages = () => [activePage]
  delete require.cache[recordsPath]
  delete require.cache[contextPath]
  delete require.cache[actionsPath]
  const recordsApi = require(recordsPath)
  const context = require(contextPath)
  const actions = require(actionsPath)
  return {
    storage, writeCounts, failAt, toasts, navigation, recordsApi, context, actions,
    failOnWrite(key, ordinal) { failAt.set(key, (writeCounts.get(key) || 0) + ordinal) },
    chooseAction(index) { actionTapIndex = index },
  }
}

let activePage = null

function makePage(payload) {
  const page = {
    data: { editorSessionActive: false, editorDirty: false },
    setData(changes, callback) { Object.assign(this.data, changes); callback?.() },
    getEditorPreferences() { return clone(payload.preferences) },
    getRecordPayload() { return clone(payload) },
  }
  activePage = page
  return page
}

function openDraft(fixture, payload) {
  const page = makePage(payload)
  const id = fixture.context.openProjectDraft('cable', 'project-main', payload.preferences)
  assert.ok(id)
  assert.ok(fixture.context.attachResultEditor(page, 'cable', { editorSessionId: id }))
  return { id, page }
}

function run(name, body, results) {
  try {
    body()
    results.push({ name, status: 'PASS' })
  } catch (error) {
    results.push({ name, status: 'FAIL', error: error.stack })
  }
}

const results = []

run('project draft first use starts with empty preference and explicit project identity', () => {
  const fixture = setup({ originalPreferences: undefined })
  fixture.storage.delete(keys.cable)
  const page = makePage({ module: 'cable', preferences: {}, resultText: 'QA result' })
  const id = fixture.context.openProjectDraft('cable', 'project-main')
  assert.ok(id)
  assert.equal(fixture.storage.get(keys.cable) && Object.keys(fixture.storage.get(keys.cable)).length, 0)
  const session = fixture.context.attachResultEditor(page, 'cable', { editorSessionId: id })
  assert.equal(session.projectId, 'project-main')
  assert.equal(page.data.editorSessionActive, true)
  assert.deepEqual(session.baselinePreferences, {})
}, results)

run('failed original preference restore keeps owner snapshot; restart resume preserves original A', () => {
  const fixture = setup()
  const payload = { module: 'cable', title: 'QA 记录', preferences: { mode: 'professional', professionalPowerText: '200' }, resultText: 'QA result' }
  const { id, page } = openDraft(fixture, payload)
  payload.preferences = { mode: 'professional', professionalPowerText: '300' }
  fixture.failOnWrite(keys.cable, 1)
  assert.equal(fixture.context.finalizeResultEditor(page), false)
  const staged = fixture.context.getSession(id)
  assert.equal(staged.restorationPending, true)
  assert.deepEqual(staged.originalPreferences, { mode: 'constant', constantPowerText: '111' })

  assert.equal(fixture.context.resumeResultEditor(id), true)
  const resumed = fixture.context.getSession(id)
  assert.deepEqual(resumed.originalPreferences, { mode: 'constant', constantPowerText: '111' })
  assert.deepEqual(fixture.storage.get(keys.cable), payload.preferences)
  assert.equal(resumed.restorationPending, false)
}, results)

run('failed final session-store write is restart-resumable and discard restores the backup', () => {
  const fixture = setup()
  const payload = { module: 'cable', title: 'QA 记录', preferences: { mode: 'professional', professionalPowerText: '200' }, resultText: 'QA result' }
  const { id, page } = openDraft(fixture, payload)
  payload.preferences = { mode: 'professional', professionalPowerText: '300' }
  // finalize writes stage first, then the completed interrupted/removed session.
  fixture.failOnWrite(keys.sessions, 2)
  assert.equal(fixture.context.finalizeResultEditor(page), false)
  assert.deepEqual(fixture.storage.get(keys.cable), { mode: 'constant', constantPowerText: '111' })
  assert.equal(fixture.context.getSession(id).restorationPending, true)
  assert.equal(fixture.context.discardInterruptedSession(id), true)
  assert.deepEqual(fixture.storage.get(keys.cable), { mode: 'constant', constantPowerText: '111' })
  assert.equal(fixture.context.getSession(id), null)
}, results)

run('discarding an interrupted draft never overwrites newer temporary work', () => {
  const fixture = setup()
  const payload = { module: 'cable', title: 'QA 记录', preferences: { mode: 'professional', professionalPowerText: '200' }, resultText: 'QA result' }
  const { id, page } = openDraft(fixture, payload)
  payload.preferences = { mode: 'professional', professionalPowerText: '300' }
  assert.equal(fixture.context.finalizeResultEditor(page), true)
  assert.equal(fixture.context.getSession(id).interrupted, true)
  fixture.storage.set(keys.cable, { mode: 'constant', constantPowerText: 'new temporary C' })
  assert.equal(fixture.context.discardInterruptedSession(id), true)
  assert.deepEqual(fixture.storage.get(keys.cable), { mode: 'constant', constantPowerText: 'new temporary C' })
}, results)

run('resume captures newer temporary work as its new original and restores it after discard', () => {
  const fixture = setup()
  const payload = { module: 'cable', title: 'QA 记录', preferences: { mode: 'professional', professionalPowerText: '200' }, resultText: 'QA result' }
  const { id, page } = openDraft(fixture, payload)
  payload.preferences = { mode: 'professional', professionalPowerText: '300' }
  assert.equal(fixture.context.finalizeResultEditor(page), true)
  fixture.storage.set(keys.cable, { mode: 'constant', constantPowerText: 'new temporary C' })
  assert.equal(fixture.context.resumeResultEditor(id), true)
  const resumed = fixture.context.getSession(id)
  assert.deepEqual(resumed.originalPreferences, { mode: 'constant', constantPowerText: 'new temporary C' })
  const resumedPage = makePage(payload)
  assert.ok(fixture.context.attachResultEditor(resumedPage, 'cable', { editorSessionId: id }))
  assert.equal(fixture.context.discardResultEditor(resumedPage), true)
  assert.deepEqual(fixture.storage.get(keys.cable), { mode: 'constant', constantPowerText: 'new temporary C' })
}, results)

run('resumed record keeps its original baseline through calculator onLoad capture and Save updates same ID', () => {
  const original = {
    id: 'record-resumed', module: 'cable', title: '原线材记录', summary: '原摘要',
    preferences: { mode: 'constant', constantPowerText: '100' }, resultText: '原结果',
    signature: JSON.stringify(['cable', { mode: 'constant', constantPowerText: '100' }]),
    favorite: false, archived: false, projectIds: ['project-main'], createdAt: 100, updatedAt: 200,
  }
  const fixture = setup({ records: [original] })
  const payload = { ...original, preferences: clone(original.preferences), resultText: original.resultText }
  const firstPage = makePage(payload)
  const id = fixture.context.openRecordEditor(original, 'project-record', 'project-main')
  assert.ok(id)
  assert.ok(fixture.context.attachResultEditor(firstPage, 'cable', { editorSessionId: id }))

  payload.preferences = { mode: 'constant', constantPowerText: '200' }
  payload.resultText = '编辑后的结果'
  assert.equal(fixture.context.finalizeResultEditor(firstPage), true)
  assert.equal(fixture.context.resumeResultEditor(id), true)

  const resumedPage = makePage(payload)
  const resumed = fixture.context.attachResultEditor(resumedPage, 'cable', { editorSessionId: id })
  assert.ok(resumed)
  assert.equal(fixture.context.captureEditorBaseline(resumedPage), true)
  assert.deepEqual(resumedPage._resultEditorSession.baselinePreferences, original.preferences)
  assert.equal(fixture.context.isEditorDirty(resumedPage), true)

  let saved
  fixture.actions.saveEditorRecord(resumedPage, false, (success, record) => { saved = { success, record } })
  assert.equal(saved.success, true)
  assert.equal(saved.record.id, original.id)
  assert.equal(fixture.recordsApi.getRecordById(original.id).resultText, '编辑后的结果')
}, results)

run('record success plus session-store failure is idempotent on Save retry', () => {
  const fixture = setup()
  const payload = { module: 'cable', title: 'QA 线材方案', summary: 'QA summary', preferences: { mode: 'professional', professionalPowerText: '200' }, resultText: 'QA result' }
  const { page } = openDraft(fixture, payload)
  fixture.failOnWrite(keys.sessions, 2) // prepare succeeds, markEditorSaved fails
  let first
  fixture.actions.saveEditorRecord(page, false, (...args) => { first = args })
  assert.equal(first[0], false)
  assert.equal(first[2].recordPersisted, true)
  assert.equal(first[2].sessionPersistenceError, true)
  const firstRecord = fixture.recordsApi.getRecords().find((record) => record.editorSaveToken)
  assert.ok(firstRecord)
  assert.ok(page._resultEditorSession.pendingSave)

  let retry
  fixture.actions.saveEditorRecord(page, false, (...args) => { retry = args })
  assert.equal(retry[0], true)
  assert.equal(fixture.recordsApi.getRecords().filter((record) => record.editorSaveToken).length, 1)
  assert.equal(page._resultEditorSession.recordId, firstRecord.id)
  assert.equal(page._resultEditorSession.pendingSave, undefined)
}, results)

run('leave-save stays in editor when record is stored but session sync fails', () => {
  const fixture = setup()
  const payload = { module: 'cable', title: 'QA 线材方案', summary: 'QA summary', preferences: { mode: 'professional', professionalPowerText: '200' }, resultText: 'QA result' }
  const { page } = openDraft(fixture, payload)
  payload.preferences = { mode: 'professional', professionalPowerText: '300' }
  payload.resultText = 'QA changed result'
  fixture.failOnWrite(keys.sessions, 2)
  fixture.chooseAction(0)
  fixture.actions.requestEditorLeave(page)
  assert.equal(fixture.navigation.includes('BACK'), false)
  assert.ok(page._resultEditorSession.pendingSave)
  assert.equal(page.data.editorSessionPersistenceError, true)
  assert.equal(fixture.recordsApi.getRecords().filter((record) => record.editorSaveToken).length, 1)
}, results)

run('Save As after a session-store failure survives restart and does not duplicate', () => {
  const original = {
    id: 'record-original', module: 'cable', title: '原记录', summary: 'original',
    preferences: { mode: 'constant', constantPowerText: '100' }, resultText: 'original result',
    signature: JSON.stringify(['cable', { mode: 'constant', constantPowerText: '100' }]),
    favorite: false, archived: false, projectIds: ['project-main'], createdAt: 100, updatedAt: 200,
  }
  const fixture = setup({ records: [original] })
  const payload = { module: 'cable', title: '副本', summary: 'copy', preferences: { mode: 'professional', professionalPowerText: '200' }, resultText: 'copy result' }
  const page = makePage(payload)
  const id = fixture.context.openRecordEditor(original, 'project-record', 'project-main')
  assert.ok(id)
  assert.ok(fixture.context.attachResultEditor(page, 'cable', { editorSessionId: id }))
  fixture.failOnWrite(keys.sessions, 2) // prepare succeeds, saved-record metadata update fails
  let first
  fixture.actions.saveEditorRecord(page, true, (...args) => { first = args })
  assert.equal(first[0], false)
  const copy = fixture.recordsApi.getRecords().find((record) => record.editorSaveToken)
  assert.ok(copy)
  assert.notEqual(copy.id, original.id)
  assert.equal(fixture.context.finalizeResultEditor(page), true)
  assert.equal(fixture.context.resumeResultEditor(id), true)

  const resumedPage = makePage(payload)
  assert.ok(fixture.context.attachResultEditor(resumedPage, 'cable', { editorSessionId: id }))
  let retry
  fixture.actions.saveEditorRecord(resumedPage, false, (...args) => { retry = args })
  assert.equal(retry[0], true)
  assert.deepEqual(fixture.recordsApi.getRecords().map((record) => record.id).sort(), [original.id, copy.id].sort())
  assert.equal(fixture.recordsApi.getRecords().find((record) => record.id === original.id).resultText, 'original result')
}, results)

run('navigation guard waits for page-container afterleave before native back', () => {
  const fixture = setup()
  const payload = { module: 'cable', title: 'QA 线材方案', preferences: { mode: 'professional', professionalPowerText: '200' }, resultText: 'QA result' }
  const { page } = openDraft(fixture, payload)
  page.data.editorGuardSupported = true
  page.data.editorGuardArmed = true
  assert.equal(fixture.actions.navigateBackFromEditor(page), true)
  assert.equal(fixture.navigation.includes('BACK'), false)
  assert.equal(page._editorNavigationPending, true)
  fixture.context.createEditorNavigationMethods().onEditorNavigationAfterLeave.call(page)
  assert.equal(fixture.navigation.filter((item) => item === 'BACK').length, 1)
}, results)

console.log(JSON.stringify({ runAt: new Date().toISOString(), results }, null, 2))
if (results.some((result) => result.status !== 'PASS')) process.exitCode = 1
