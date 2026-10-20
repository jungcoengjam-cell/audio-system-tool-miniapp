'use strict'

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const records = require('../utils/records')

const root = path.resolve(__dirname, '..')
const pagePath = path.join(root, 'pages/gain-structure/gain-structure.js')
const preferenceKey = 'audioTool.gainStructure.preferences'
const recordKeys = [
  'audioTool.records.v1',
  'audioTool.projects.v1',
  'audioTool.activeProject.v1',
  'audioTool.storageSchemaVersion',
]
const validPreferences = {
  amplifierModel: 'TC-X2200B',
  stageValue: 1,
  mode: 'stereo',
  loadImpedance: null,
  targetPeakDbfs: -6,
}

function makeWx() {
  const storage = new Map(recordKeys.map((key) => [key, key.endsWith('.v1') ? [] : '']))
  storage.set(preferenceKey, { ...validPreferences })
  const modals = []
  return {
    modals,
    wx: {
      getStorageSync(key) { return storage.get(key) },
      setStorageSync(key, value) { storage.set(key, value) },
      removeStorageSync(key) { storage.delete(key) },
      getStorageInfoSync() { return { currentSize: 0, limitSize: 10240 } },
      getSystemInfoSync() { return { windowWidth: 375, windowHeight: 812, pixelRatio: 2, theme: 'light' } },
      getWindowInfo() { return { windowHeight: 812, windowWidth: 375 } },
      canIUse() { return true },
      vibrateShort() {},
      showToast() {},
      hideKeyboard() {},
      showModal(options) { modals.push(options) },
    },
  }
}

function bootPage(modals, calls) {
  let definition
  const overrides = {
    ...records,
    addRecordToProject(...args) {
      calls.push(args)
      return records.addRecordToProject(...args)
    },
  }
  const previousPage = global.Page
  global.Page = (page) => { definition = page }
  try {
    const localRequire = (request) => require(path.resolve(path.dirname(pagePath), request))
    const module = { exports: {} }
    new Function('require', 'Page', 'module', 'exports', fs.readFileSync(pagePath, 'utf8'))(
      (request) => request === '../../utils/records' ? overrides : localRequire(request),
      global.Page,
      module,
      module.exports,
    )
  } finally {
    if (previousPage === undefined) delete global.Page
    else global.Page = previousPage
  }
  assert(definition && definition.data, 'gain page should register')
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(changes, callback) {
      Object.assign(this.data, changes)
      if (callback) callback.call(this)
    },
  })
  page.onLoad()
  page.onShow()
  assert.strictEqual(page.data.hasValidResult, true, 'test fixture must restore a real valid gain result')
  return page
}

function modalFrom(modals) {
  const modal = modals.shift()
  assert(modal, 'expected a pending native confirmation modal')
  return modal
}

function openProjectDetails(page, projectId) {
  if (!page.data.projectSheetVisible) page.openProjectSheet()
  if (page.data.projectStep === 'details' && page.data.projectTargetId === projectId) return
  if (page.data.projectStep === 'details') page.backToProjectList()
  const opened = page.chooseProject({ currentTarget: { dataset: { id: projectId } } })
  assert.strictEqual(opened, true, 'target must be visible and selectable')
  assert.strictEqual(page.data.projectStep, 'details')
}

function editConfig(page, name, note) {
  page.onProjectConfigNameInput({ detail: { value: name } })
  page.onProjectConfigNoteInput({ detail: { value: note } })
}

function projectMetadata(payload, projectId) {
  const record = records.getRecordByPayload(payload)
  return record?.projectMetadata?.[projectId] || null
}

async function main() {
  const context = makeWx()
  const previousWx = global.wx
  global.wx = context.wx
  const calls = []
  let page
  try {
    records.getWorkspaceSnapshot({ forceRefresh: true })
    page = bootPage(context.modals, calls)
    const projectA = records.createProject('异步确认项目')
    assert(projectA)

    page.openProjectSheet()
    page.chooseProject({ currentTarget: { dataset: { id: projectA.id } } })
    const frozenPayload = page._projectSnapshotForSave.payload
    const defaultName = frozenPayload.title
    const frozenCanonicalText = frozenPayload.resultText
    const expectedPreviewLines = frozenCanonicalText.split(/\r?\n/)
      .filter((line) => line.startsWith('功放额定输出输入点：')
        || line.startsWith('衰减执行位置：'))
      .join('\n')
    assert.strictEqual(page.data.projectPreview.title, frozenPayload.title)
    assert.strictEqual(page.data.projectPreview.summary, frozenPayload.summary)
    assert.strictEqual(page.data.projectPreview.resultText, expectedPreviewLines,
      'the compact preview must use the two canonical lines from the frozen payload')
    assert.strictEqual(frozenPayload.resultText, frozenCanonicalText,
      'building the preview must not alter the canonical payload')
    assert.strictEqual(expectedPreviewLines.split('\n').length, 2)
    assert.strictEqual(page.data.projectConfigName, defaultName)
    assert.strictEqual(page.saveProjectConfiguration(), true, 'first save should write without an update prompt')
    assert.strictEqual(calls.length, 1)
    assert.strictEqual(calls[0].length, 3)
    assert.deepStrictEqual(calls[0][2], { name: defaultName, note: '' })
    assert.strictEqual(calls[0][0].projectMetadata, undefined,
      'configuration metadata must stay outside the frozen payload')
    page.closeProjectSheet()

    const original = { ...projectMetadata(frozenPayload, projectA.id) }
    openProjectDetails(page, projectA.id)
    editConfig(page, '取消更新', '取消备注')
    const callsBeforeCancel = calls.length
    assert.strictEqual(page.saveProjectConfiguration(), true)
    assert.strictEqual(page.data.isSavingProject, true)
    const cancelledPrompt = modalFrom(context.modals)
    cancelledPrompt.success({ confirm: false })
    assert.strictEqual(page._projectSavePending, false)
    assert.strictEqual(page.data.isSavingProject, false)
    assert.strictEqual(calls.length, callsBeforeCancel)
    assert.deepStrictEqual(projectMetadata(frozenPayload, projectA.id), original,
      'cancel must not update the stored metadata')
    page.closeProjectSheet()

    openProjectDetails(page, projectA.id)
    editConfig(page, '关闭后不可写', '')
    const callsBeforeClose = calls.length
    assert.strictEqual(page.saveProjectConfiguration(), true)
    const closedPrompt = modalFrom(context.modals)
    page.closeProjectSheet()
    closedPrompt.success({ confirm: true })
    assert.strictEqual(calls.length, callsBeforeClose, 'a late confirm after close must not write')
    assert.strictEqual(page.data.projectSheetVisible, false)
    assert.strictEqual(page.data.isSavingProject, false)

    openProjectDetails(page, projectA.id)
    editConfig(page, '隐藏后不可写', '')
    const callsBeforeHide = calls.length
    assert.strictEqual(page.saveProjectConfiguration(), true)
    const hiddenPrompt = modalFrom(context.modals)
    page.onHide()
    hiddenPrompt.success({ confirm: true })
    assert.strictEqual(calls.length, callsBeforeHide, 'a late confirm after hide must not write')
    assert.strictEqual(page.data.projectSheetVisible, false)
    assert.strictEqual(page.data.isSavingProject, false)
    page.onShow()

    openProjectDetails(page, projectA.id)
    editConfig(page, '输入变化后不可写', '')
    const callsBeforeEdit = calls.length
    assert.strictEqual(page.saveProjectConfiguration(), true)
    const editedPrompt = modalFrom(context.modals)
    page.onProjectConfigNameInput({ detail: { value: '编辑后的新名称' } })
    editedPrompt.success({ confirm: true })
    assert.strictEqual(calls.length, callsBeforeEdit, 'editing a field must invalidate a pending confirm')
    assert.strictEqual(page._projectSavePending, false)
    assert.strictEqual(page.data.isSavingProject, false)
    assert.strictEqual(page.data.projectStep, 'details')
    page.closeProjectSheet()

    const projectB = records.createProject('另一个项目')
    assert(projectB)
    openProjectDetails(page, projectA.id)
    editConfig(page, '切换目标后不可写', '')
    const callsBeforeTargetChange = calls.length
    assert.strictEqual(page.saveProjectConfiguration(), true)
    const retargetedPrompt = modalFrom(context.modals)
    page.backToProjectList()
    page.chooseProject({ currentTarget: { dataset: { id: projectB.id } } })
    assert.strictEqual(page.data.projectTargetId, projectB.id)
    retargetedPrompt.success({ confirm: true })
    assert.strictEqual(calls.length, callsBeforeTargetChange,
      'a confirmation for the previous target must not write after switching projects')
    assert.strictEqual(page.data.projectStep, 'details')
    assert.strictEqual(page.data.projectTargetId, projectB.id)
    page.closeProjectSheet()

    openProjectDetails(page, projectA.id)
    editConfig(page, '我的新配置名', '我的新备注')
    const callsBeforeConcurrentChange = calls.length
    assert.strictEqual(page.saveProjectConfiguration(), true)
    const stalePrompt = modalFrom(context.modals)
    const concurrent = records.addRecordToProject(frozenPayload, projectA.id, {
      name: '另一处刚更新',
      note: '并发修改',
    })
    assert(concurrent)
    const concurrentMetadata = { ...projectMetadata(frozenPayload, projectA.id) }
    stalePrompt.success({ confirm: true })
    assert.strictEqual(page._projectSavePending, false,
      'a metadata-token change must release the pending request')
    assert.strictEqual(page.data.isSavingProject, false)
    assert(page.data.projectSaveError.includes('配置已变化'),
      'a changed metadata token must stop the stale confirmation')
    assert.strictEqual(calls.length, callsBeforeConcurrentChange,
      'the first stale confirmation must not overwrite concurrent metadata')
    assert.deepStrictEqual(projectMetadata(frozenPayload, projectA.id), concurrentMetadata)

    assert.strictEqual(page.saveProjectConfiguration(), true,
      'the user can explicitly reconfirm against the latest metadata')
    const latestPrompt = modalFrom(context.modals)
    latestPrompt.success({ confirm: true })
    assert.strictEqual(calls.length, callsBeforeConcurrentChange + 1)
    assert.strictEqual(page.data.projectStep, 'success')
    assert.deepStrictEqual(projectMetadata(frozenPayload, projectA.id),
      { ...projectMetadata(frozenPayload, projectA.id), name: '我的新配置名', note: '我的新备注' })
    page.closeProjectSheet()

    const projectC = records.createProject('边界配置项目')
    assert(projectC)
    page.openProjectSheet()
    if (page.data.projectStep === 'details') page.backToProjectList()
    page.beginNewProject()
    page.onNewProjectNameInput({ detail: { value: projectC.name } })
    assert.strictEqual(page.createProjectFromForm(), true)
    assert.strictEqual(page.data.projectStep, 'details')
    const maxName = '名'.repeat(60)
    const maxNote = '备'.repeat(200)
    editConfig(page, maxName, maxNote)
    const callsBeforeBoundarySave = calls.length
    assert.strictEqual(page.saveProjectConfiguration(), true, '60/200 character values must save')
    assert.strictEqual(calls.length, callsBeforeBoundarySave + 1)
    assert.strictEqual(calls[calls.length - 1][2].name.length, 60)
    assert.strictEqual(calls[calls.length - 1][2].note.length, 200)
    page.closeProjectSheet()

    openProjectDetails(page, projectC.id)
    assert.strictEqual(page.data.projectConfigName, maxName, 'the exact 60-character name should restore')
    assert.strictEqual(page.data.projectConfigNote, maxNote, 'the exact 200-character note should restore')
    const callsBeforeInvalidFields = calls.length
    page.onProjectConfigNameInput({ detail: { value: '名'.repeat(61) } })
    assert.strictEqual(page.saveProjectConfiguration(), false)
    assert(page.data.projectConfigNameError.includes('60'))
    page.onProjectConfigNameInput({ detail: { value: '有效名称' } })
    page.onProjectConfigNoteInput({ detail: { value: '备'.repeat(201) } })
    assert.strictEqual(page.saveProjectConfiguration(), false)
    assert(page.data.projectNoteError.includes('200'))
    assert.strictEqual(calls.length, callsBeforeInvalidFields,
      'invalid field lengths must be rejected before storage writes')
    assert.strictEqual(page._projectSavePending, false)
    page.closeProjectSheet()

    process.stdout.write('PASS project details, async confirmation invalidation, concurrency, and metadata limits\n')
  } finally {
    if (page && page.data.projectSheetVisible) page.closeProjectSheet()
    global.wx = previousWx
  }
}

main().catch((error) => {
  process.stderr.write((error && error.stack) || String(error))
  process.stderr.write('\n')
  process.exitCode = 1
})