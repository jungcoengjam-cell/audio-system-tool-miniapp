const assert = require('assert/strict')

const RECORDS_KEY = 'audioTool.records.v1'
const PROJECTS_KEY = 'audioTool.projects.v1'
const ACTIVE_KEY = 'audioTool.activeProject.v1'
const SCHEMA_KEY = 'audioTool.storageSchemaVersion'
const SCHEMA_VERSION = 3
const ACTION_LIMIT = 6
const ACTION_CREATE = String.fromCodePoint(0x65b0, 0x5efa, 0x9879, 0x76ee, 0x5e76, 0x4fdd, 0x5b58)
const ACTION_NEXT = String.fromCodePoint(0x4e0b, 0x4e00, 0x9875, 0x9879, 0x76ee)
const CONFIRM_TITLE = String.fromCodePoint(0x786e, 0x8ba4, 0x4fdd, 0x5b58, 0x4f4d, 0x7f6e)
const READ_FAILURE = String.fromCodePoint(0x8bfb, 0x53d6, 0x9879, 0x76ee, 0x5217, 0x8868, 0x5931, 0x8d25)
const SAVE_FAILURE = String.fromCodePoint(0x4fdd, 0x5b58, 0x5931, 0x8d25)

let storage
let writeCounts
let readFailureKey
let writeFailureKey
let actionSheets
let modals
let toastTitles
let topPage
let records
let actions

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

function projectFixture(id, name, updatedAt) {
  return {
    id,
    name,
    createdAt: updatedAt,
    updatedAt,
    venueName: '',
    engineer: '',
    projectDate: '2026-10-01',
    notes: '',
    roomLengthText: '',
    roomWidthText: '',
    roomHeightText: '',
    standardClassKey: 'conference',
    gradeKey: 'II',
  }
}

function setup(projectNames = [], activeName = '') {
  storage = new Map()
  writeCounts = new Map()
  readFailureKey = ''
  writeFailureKey = ''
  actionSheets = []
  modals = []
  toastTitles = []
  topPage = null
  const projects = projectNames.map((name, index) => projectFixture(`project-${index + 1}`, name, 5000 - index))
  storage.set(RECORDS_KEY, [])
  storage.set(PROJECTS_KEY, projects)
  storage.set(ACTIVE_KEY, projects.find((project) => project.name === activeName)?.id || '')
  storage.set(SCHEMA_KEY, SCHEMA_VERSION)

  global.wx = {
    getStorageSync(key) {
      if (key === readFailureKey) throw new Error('read failed')
      return clone(storage.get(key))
    },
    setStorageSync(key, value) {
      writeCounts.set(key, (writeCounts.get(key) || 0) + 1)
      if (key === writeFailureKey) throw new Error('write failed')
      storage.set(key, clone(value))
    },
    showActionSheet(options) { actionSheets.push(options) },
    showModal(options) { modals.push(options) },
    showToast(options) { toastTitles.push(options.title) },
    vibrateShort() {},
  }
  global.getCurrentPages = () => (topPage ? [topPage] : [])

  ;['../utils/result-record-actions', '../utils/records'].forEach((modulePath) => {
    delete require.cache[require.resolve(modulePath)]
  })
  records = require('../utils/records')
  actions = require('../utils/result-record-actions')
  return { records, actions }
}

function payload(variant = 'current') {
  return {
    module: 'limiter',
    title: `Limiter ${variant}`,
    summary: `Summary ${variant}`,
    preferences: { variant, threshold: '-6' },
    resultText: `Result ${variant}`,
  }
}

function makePage(currentPayload = payload()) {
  let activePayload = currentPayload
  const page = {
    _pageVisible: true,
    data: { currentFavorite: false },
    getRecordPayload() { return activePayload },
    getRecordLookupPayload() { return activePayload },
    setData(changes) { this.data = { ...this.data, ...changes } },
    replacePayload(nextPayload) { activePayload = nextPayload },
  }
  topPage = page
  return page
}

function writeCount(key = RECORDS_KEY) {
  return writeCounts.get(key) || 0
}

function chooseProject(sheet, name) {
  assert(sheet, 'expected an open project selector')
  assert(sheet.itemList.length <= ACTION_LIMIT, 'action sheet must contain at most six entries')
  const index = sheet.itemList.findIndex((item) => item.startsWith(name))
  assert.notEqual(index, -1, `project ${name} must be selectable`)
  sheet.success({ tapIndex: index })
}

function confirmLatestModal(confirm = true, content = '') {
  const modal = modals[modals.length - 1]
  assert(modal, 'expected an open modal')
  modal.success({ confirm, content })
  return modal
}

function projectByName(name) {
  return records.getProjects().find((project) => project.name === name)
}

function checkSelectsRestoredProjectWithoutChangingActive() {
  setup(['A Current', 'B Restored'], 'A Current')
  const a = projectByName('A Current')
  const b = projectByName('B Restored')
  records.addRecordToProject(payload('restored'), b.id)
  const page = makePage()
  const priorWrites = writeCount()

  actions.addPageToActiveProject(page)
  chooseProject(actionSheets[0], 'B Restored')
  const confirmation = modals[0]
  assert.equal(confirmation.title, CONFIRM_TITLE)
  assert(confirmation.content.includes('B Restored'), 'confirmation must show the full target name')
  confirmation.success({ confirm: true })

  assert.equal(records.getProjectRecords(a.id).some((record) => record.title === 'Limiter current'), false)
  assert.equal(records.getProjectRecords(b.id).some((record) => record.title === 'Limiter current'), true)
  assert.equal(records.getActiveProject().id, a.id, 'saving into a restored project must leave the global current project alone')
  assert.equal(writeCount(), priorWrites + 1, 'one selected save writes one record snapshot')
}

function checkExplicitlySelectsCurrentProject() {
  setup(['A Current', 'B Other'], 'A Current')
  const a = projectByName('A Current')
  const page = makePage()
  actions.addPageToActiveProject(page)
  chooseProject(actionSheets[0], 'A Current')
  confirmLatestModal(true)
  assert.equal(records.getProjectRecords(a.id).length, 1)
}

function checkCancelAndLateCallbacksCannotSave() {
  setup(['A Project'], 'A Project')
  const page = makePage()
  const startWrites = writeCount()
  actions.addPageToActiveProject(page)
  const oldChooser = actionSheets[0]
  oldChooser.fail({ errMsg: 'cancel' })
  assert.equal(page._projectSavePending, false)
  oldChooser.success({ tapIndex: 0 })
  assert.equal(writeCount(), startWrites, 'a success callback arriving after cancellation must not write')
  assert.equal(modals.length, 0)

  actions.addPageToActiveProject(page)
  const newChooser = actionSheets[1]
  oldChooser.success({ tapIndex: 0 })
  assert.equal(page._projectSavePending, true, 'an old callback must not unlock a newer request')
  assert.equal(modals.length, 0)
  chooseProject(newChooser, 'A Project')
  confirmLatestModal(true)
  assert.equal(writeCount(), startWrites + 1)
  assert.equal(records.getProjectRecords(projectByName('A Project').id).length, 1)
}

function checkNoProjectCreateAndCancelPaths() {
  setup([], '')
  const page = makePage()
  actions.addPageToActiveProject(page)
  assert.equal(actionSheets.length, 0)
  assert.equal(modals.length, 1, 'an empty workspace should open the new-project prompt')
  confirmLatestModal(true, 'New Project')
  const created = records.getActiveProject()
  assert(created, 'creating a project keeps createProject current-project semantics')
  assert.equal(modals.length, 2, 'the created target is confirmed by its full name before saving')
  assert(modals[1].content.includes(created.name))
  confirmLatestModal(true)
  assert.equal(records.getProjectRecords(created.id).length, 1)

  setup([], '')
  const cancelledPage = makePage()
  actions.addPageToActiveProject(cancelledPage)
  confirmLatestModal(false)
  assert.equal(records.getProjects().length, 0)
  assert.equal(records.getRecords().length, 0)
}

function checkCanCreateAlongsideExistingProjects() {
  setup(['Existing Project'], 'Existing Project')
  const page = makePage()
  actions.addPageToActiveProject(page)
  const chooser = actionSheets[0]
  assert(chooser.itemList.includes(ACTION_CREATE), 'an existing workspace must offer explicit project creation')
  chooser.success({ tapIndex: chooser.itemList.indexOf(ACTION_CREATE) })
  confirmLatestModal(true, 'New Project')
  const created = records.getActiveProject()
  assert.equal(created.name, 'New Project', 'creating a project keeps its existing current-project behavior')
  assert(modals[modals.length - 1].content.includes(created.name))
  confirmLatestModal(true)
  assert.equal(records.getProjectRecords(created.id).length, 1)
}

function checkPaginationCanReachTailProject() {
  const names = Array.from({ length: 8 }, (_, index) => `Project ${index + 1}`)
  setup(names, names[0])
  const page = makePage()
  actions.addPageToActiveProject(page)
  assert(actionSheets[0].itemList.some((item) => item.includes(ACTION_NEXT)))
  assert(actionSheets[0].itemList.includes(ACTION_CREATE))
  assert(actionSheets[0].itemList.length <= ACTION_LIMIT)
  actionSheets[0].success({ tapIndex: actionSheets[0].itemList.findIndex((item) => item.includes(ACTION_NEXT)) })
  assert(actionSheets[1].itemList.includes('Project 8'), 'later pages must retain projects beyond the first six')
  assert(actionSheets[1].itemList.length <= ACTION_LIMIT)
  chooseProject(actionSheets[1], 'Project 8')
  confirmLatestModal(true)
  assert.equal(records.getProjectRecords(projectByName('Project 8').id).length, 1)
}

function checkTargetRenameAndDeleteDoNotWrite() {
  setup(['A Project'], 'A Project')
  const page = makePage()
  actions.addPageToActiveProject(page)
  chooseProject(actionSheets[0], 'A Project')
  const id = projectByName('A Project').id
  records.updateProject(id, { name: 'Renamed Project' })
  const writesBeforeConfirm = writeCount()
  confirmLatestModal(true)
  assert.equal(writeCount(), writesBeforeConfirm, 'a renamed target must not receive the record')
  assert(toastTitles.some((title) => title.includes(String.fromCodePoint(0x9879, 0x76ee, 0x540d, 0x79f0))))

  setup(['A Project'], 'A Project')
  const deletePage = makePage()
  actions.addPageToActiveProject(deletePage)
  chooseProject(actionSheets[0], 'A Project')
  const deleteId = projectByName('A Project').id
  records.deleteProject(deleteId)
  const writesBeforeDeletedConfirm = writeCount()
  confirmLatestModal(true)
  assert.equal(writeCount(), writesBeforeDeletedConfirm, 'a deleted target must not receive the record')
  assert(toastTitles.some((title) => title.includes(String.fromCodePoint(0x76ee, 0x6807, 0x9879, 0x76ee))))
}

function checkReadAndWriteFailures() {
  setup(['A Project'], 'A Project')
  const readPage = makePage()
  actions.addPageToActiveProject(readPage)
  chooseProject(actionSheets[0], 'A Project')
  readFailureKey = PROJECTS_KEY
  const readsBefore = writeCount()
  confirmLatestModal(true)
  assert.equal(writeCount(), readsBefore)
  assert(toastTitles.some((title) => title.includes(READ_FAILURE)))

  setup(['A Project'], 'A Project')
  const writePage = makePage()
  actions.addPageToActiveProject(writePage)
  chooseProject(actionSheets[0], 'A Project')
  writeFailureKey = RECORDS_KEY
  const writesBefore = writeCount()
  confirmLatestModal(true)
  assert.equal(writeCount(), writesBefore + 1, 'the failing storage write is attempted exactly once')
  assert.equal(records.getRecords().length, 0)
  assert(toastTitles.some((title) => title.includes(SAVE_FAILURE)))
}

function checkVisibilityInputAndRepeatGuards() {
  setup(['A Project'], 'A Project')
  const hiddenBeforePick = makePage()
  actions.addPageToActiveProject(hiddenBeforePick)
  hiddenBeforePick._pageVisible = false
  chooseProject(actionSheets[0], 'A Project')
  assert.equal(modals.length, 0)
  assert.equal(writeCount(), 0)

  setup(['A Project'], 'A Project')
  const changedBeforePick = makePage()
  actions.addPageToActiveProject(changedBeforePick)
  changedBeforePick.replacePayload(payload('changed'))
  chooseProject(actionSheets[0], 'A Project')
  assert.equal(modals.length, 0)
  assert.equal(writeCount(), 0)

  setup(['A Project'], 'A Project')
  const hiddenBeforeConfirm = makePage()
  actions.addPageToActiveProject(hiddenBeforeConfirm)
  actions.addPageToActiveProject(hiddenBeforeConfirm)
  assert.equal(actionSheets.length, 1, 'duplicate clicks while pending should open one chooser')
  chooseProject(actionSheets[0], 'A Project')
  hiddenBeforeConfirm._pageVisible = false
  confirmLatestModal(true)
  assert.equal(writeCount(), 0)

  setup(['A Project'], 'A Project')
  const changedBeforeConfirm = makePage()
  actions.addPageToActiveProject(changedBeforeConfirm)
  chooseProject(actionSheets[0], 'A Project')
  changedBeforeConfirm.replacePayload(payload('changed'))
  confirmLatestModal(true)
  assert.equal(writeCount(), 0)
}

checkSelectsRestoredProjectWithoutChangingActive()
checkExplicitlySelectsCurrentProject()
checkCancelAndLateCallbacksCannotSave()
checkNoProjectCreateAndCancelPaths()
checkCanCreateAlongsideExistingProjects()
checkPaginationCanReachTailProject()
checkTargetRenameAndDeleteDoNotWrite()
checkReadAndWriteFailures()
checkVisibilityInputAndRepeatGuards()
console.log('Result project target test passed')