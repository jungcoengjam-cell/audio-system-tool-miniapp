'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const recordsPath = path.join(root, 'utils/records.js')
const projectPagePath = path.join(root, 'pages/records/project.js')
const toolsPagePath = path.join(root, 'pages/tools/tools.js')
const storage = new Map()
const writes = []
const navigations = []
let capturedPage
let modalOptions
let clipboardText = ''

const projectA = {
  id: 'legacy-project-a',
  name: '历史项目 A',
  venueName: '旧会议室名称',
  engineer: '旧工程师',
  projectDate: '2026-10-14',
  notes: '初始备注',
  roomLengthText: '12',
  roomWidthText: '8',
  roomHeightText: '3',
  standardClassKey: 'legacy-standard',
  gradeKey: 'legacy-G',
  createdAt: 1,
  updatedAt: 1,
}
const projectB = {
  id: 'legacy-project-b',
  name: '历史项目 B',
  createdAt: 2,
  updatedAt: 2,
}
const legacyPreferences = { sceneMode: 'meeting', speakerModel: 'legacy-speaker' }
const legacyRecord = {
  id: 'legacy-venue-record',
  module: 'venue',
  title: '历史会议室方案',
  summary: '历史方案摘要仍可阅读',
  resultText: '完整历史结果：旧会议室方案与计算说明。',
  preferences: legacyPreferences,
  signature: JSON.stringify(['venue', legacyPreferences]),
  favorite: true,
  projectIds: [projectA.id],
  projectMetadata: {
    [projectA.id]: { name: '历史配置 A', note: '保留的项目备注', savedAt: 3 },
  },
  createdAt: 3,
  updatedAt: 3,
}
const activeKeys = [
  'limiter', 'spl', 'cable', 'camera', 'gainStructure', 'dmxAddress', 'ledScreen', 'audioWiring',
]
const { amplifiers, speakers } = require('../../data/equipment')
const activeLimiterPreferences = {
  amplifierModel: amplifiers[0].model,
  speakerModel: speakers.find((item) => !item.calculationDisabled).model,
  count: 1,
  wiring: 'parallel',
  mode: 'stereo',
  sensitivityVoltage: 1,
  highPassFrequency: 80,
}
const activeRecords = activeKeys.map((module, index) => {
  const preferences = module === 'limiter' ? activeLimiterPreferences : { fixture: module }
  return {
    id: `active-${module}`,
    module,
    title: `${module} 结果`,
    summary: `${module} 摘要`,
    resultText: `${module} 完整结果`,
    preferences,
    signature: JSON.stringify([module, preferences]),
    favorite: false,
    projectIds: [projectA.id],
    createdAt: 10 + index,
    updatedAt: 10 + index,
  }
})

storage.set('audioTool.storageSchemaVersion', 3)
storage.set('audioTool.records.v1', [...activeRecords, legacyRecord])
storage.set('audioTool.projects.v1', [projectA, projectB])
storage.set('audioTool.activeProject.v1', projectB.id)
storage.set('audioTool.venue.preferences', { old: 'must remain untouched' })

global.wx = {
  getStorageSync(key) { return storage.get(key) },
  setStorageSync(key, value) {
    writes.push({ key, value })
    storage.set(key, value)
  },
  removeStorageSync(key) { storage.delete(key) },
  getStorageInfoSync() { return { currentSize: 1, limitSize: 100 } },
  setNavigationBarTitle() {},
  showToast() {},
  showModal(options) { modalOptions = options },
  setClipboardData({ data }) { clipboardText = data },
  navigateTo(options) { navigations.push(options.url) },
  vibrateShort() {},
}

function loadFresh(relativePath) {
  const filename = path.join(root, relativePath)
  delete require.cache[filename]
  return require(filename)
}

function walk(relativePath) {
  const directory = path.join(root, relativePath)
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const child = path.join(relativePath, entry.name)
    return entry.isDirectory() ? walk(child) : [child]
  })
}

function assertProductionRelativeRequiresResolve() {
  const productionFiles = ['pages', 'utils', 'data'].flatMap(walk).filter((file) => file.endsWith('.js'))
  const missing = []
  productionFiles.forEach((relativeFile) => {
    const source = fs.readFileSync(path.join(root, relativeFile), 'utf8')
      .replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
    for (const [, , request] of source.matchAll(/\brequire\(\s*(['"])(\.[^'"]+)\1\s*\)/g)) {
      const target = path.resolve(root, path.dirname(relativeFile), request)
      const candidates = [target, `${target}.js`, `${target}.json`, path.join(target, 'index.js')]
      if (!candidates.some((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile())) {
        missing.push(`${relativeFile} -> ${request}`)
      }
    }
  })
  assert.deepEqual(missing, [], 'all production relative imports resolve after removal')
}

const records = loadFresh('utils/records.js')
assert.deepEqual(Object.keys(records.MODULES), activeKeys, 'only the eight supported modules remain active')
const legacyMetadata = records.getModuleMetadata('venue')
assert.equal(legacyMetadata.retired, true, 'historical venue metadata is marked retired')
assert.equal(Object.hasOwn(legacyMetadata, 'path'), false, 'retired metadata has no route')
assert.equal(Object.hasOwn(legacyMetadata, 'preferenceKey'), false, 'retired metadata has no preference key')

const writesBeforeLegacyRestore = writes.length
assert.equal(records.restoreRecord(legacyRecord), '', 'a historical venue result cannot restore a calculator')
assert.equal(records.prepareProjectModule(projectA.id, 'venue'), '', 'a project cannot open the retired module')
assert.equal(writes.length, writesBeforeLegacyRestore, 'legacy restore and project preparation do not write storage')
assert.equal(storage.get('audioTool.activeProject.v1'), projectB.id, 'legacy preparation preserves the active project')
assert.deepEqual(storage.get('audioTool.venue.preferences'), { old: 'must remain untouched' },
  'legacy restore leaves any old preference untouched')

const historicalFavorite = records.getFavoriteByPayload(legacyRecord)
assert(historicalFavorite, 'the existing historical favorite is available through the favorites store')
assert.equal(historicalFavorite.id, legacyRecord.id)
const removeFavoriteResult = records.toggleFavoriteById(historicalFavorite.id)
assert.equal(removeFavoriteResult, null, 'successful favorite removal follows the current null return contract')
assert.equal(records.getFavoriteByPayload(legacyRecord), null,
  'the historical favorite is removed from its observable favorites store')
const unfavorited = records.getRecordById(legacyRecord.id)
assert(unfavorited, 'removing a favorite preserves its historical project record')
assert.equal(unfavorited.favorite, false)
assert.equal(unfavorited.id, legacyRecord.id)
assert.equal(unfavorited.resultText, legacyRecord.resultText)
const forgedLegacyUpdate = records.saveRecord({
  ...unfavorited,
  title: '伪造标题',
  summary: '伪造摘要',
  resultText: '伪造完整结果',
  preferences: { ...legacyPreferences, speakerModel: '伪造音箱' },
})
const protectedLegacy = records.getRecords().find((record) => record.id === legacyRecord.id)
assert.equal(forgedLegacyUpdate, null, 'a changed legacy input payload is rejected')
assert.equal(protectedLegacy.title, legacyRecord.title)
assert.equal(protectedLegacy.summary, legacyRecord.summary)
assert.equal(protectedLegacy.resultText, legacyRecord.resultText)
assert.deepEqual(protectedLegacy.preferences, legacyRecord.preferences)
const safeLegacyUpdate = records.saveRecord({
  ...protectedLegacy,
  title: '伪造标题',
  summary: '伪造摘要',
  resultText: '伪造完整结果',
}, { favorite: true })
assert(safeLegacyUpdate, 'an unchanged legacy identity can still update management state')
assert.equal(safeLegacyUpdate.favorite, true)
assert.equal(safeLegacyUpdate.title, legacyRecord.title)
assert.equal(safeLegacyUpdate.summary, legacyRecord.summary)
assert.equal(safeLegacyUpdate.resultText, legacyRecord.resultText)
assert.deepEqual(safeLegacyUpdate.preferences, legacyRecord.preferences)

const addedLegacy = records.addRecordToProject(safeLegacyUpdate, projectB.id, {
  name: '项目 B 历史配置',
  note: '项目 B 的历史备注',
})
assert.equal(addedLegacy.id, legacyRecord.id, 'adding a legacy result reuses its stored id')
assert.deepEqual(addedLegacy.projectIds, [projectA.id, projectB.id])
assert.equal(records.getProjectRecordView(addedLegacy, projectB.id).projectNote, '项目 B 的历史备注')
assert.equal(records.removeRecordFromProject(legacyRecord.id, projectB.id), true,
  'a legacy record can be removed from one project')
const retainedLegacy = records.getRecords().find((record) => record.id === legacyRecord.id)
assert.deepEqual(retainedLegacy.projectIds, [projectA.id], 'removal preserves its other project association')
assert.equal(retainedLegacy.projectMetadata[projectA.id].note, '保留的项目备注')
assert.equal(Object.hasOwn(retainedLegacy.projectMetadata, projectB.id), false,
  'removal clears only the removed project’s note')
assert.equal(retainedLegacy.resultText, legacyRecord.resultText)

const beforeRejectedSaves = JSON.stringify(storage.get('audioTool.records.v1'))
const beforeRejectedWriteCount = writes.length
assert.equal(records.saveRecord({
  module: 'venue', title: '新历史记录', summary: '新摘要', resultText: '新结果', preferences: { sceneMode: 'new' },
}), null, 'new venue records are rejected')
assert.equal(records.addRecordToProject({
  module: 'venue', title: '新项目记录', summary: '新摘要', resultText: '新结果', preferences: { sceneMode: 'new' },
}, projectB.id), null, 'a new venue result cannot be added to a project')
assert.equal(JSON.stringify(storage.get('audioTool.records.v1')), beforeRejectedSaves,
  'rejected legacy saves do not change stored records')
assert.equal(writes.length, beforeRejectedWriteCount, 'rejected legacy saves do not write storage')

assert.equal(records.restoreRecord(activeRecords[0]), '/pages/limiter/limiter',
  'an active calculator still restores normally')
assert.equal(storage.has('audioTool.limiter.preferences'), false,
  'the route helper resolves an active calculator without writing preferences')

global.Page = (definition) => { capturedPage = definition }
const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'))
const registeredPages = [
  ...app.pages,
  ...(app.subPackages || []).flatMap((subpackage) => subpackage.pages.map((page) => `${subpackage.root}/${page}`)),
]
assert.equal(registeredPages.some((page) => page.startsWith('pages/venue/')), false,
  'the retired calculator is absent from app routes')
assert.equal(fs.existsSync(path.join(root, 'pages/venue')), false, 'the retired page directory is absent')
assert.equal(fs.existsSync(path.join(root, 'tests/venue-refactor-2026-10-14')), false,
  'the archived venue-only test directory is absent')
for (const filename of [
  'utils/venue.js', 'utils/venue-plan.js', 'utils/venue-pag-nag.js', 'utils/venue-handoff.js',
  'utils/venue-geometry.js', 'utils/venue-discussion.js', 'utils/venue-discussion-plan.js',
  'data/speaker-recommendation-profiles.js',
]) assert.equal(fs.existsSync(path.join(root, filename)), false, `${filename} is removed`)
for (const filename of [
  'assets/home/module-venue-catalog.jpg',
  'assets/home/module-venue-catalog.png',
  'assets/home/module-venue.jpg',
]) assert.equal(fs.existsSync(path.join(root, filename)), false, `${filename} is removed`)
assertProductionRelativeRequiresResolve()

loadFresh('pages/tools/tools.js')
const toolsPage = capturedPage
assert(toolsPage, 'the tools page registers through the mini-program page adapter')
toolsPage.data = { ...toolsPage.data }
toolsPage.setData = (changes, callback) => {
  toolsPage.data = { ...toolsPage.data, ...changes }
  if (callback) callback()
}
toolsPage.refreshTools()
assert.equal(toolsPage.data.tools.length, 10,
  'ten active menu entries remain, including the wiring assistant and wiring workspace')
assert(toolsPage.data.tools.some((item) => item.id === 'audioWiring')
  && toolsPage.data.tools.some((item) => item.id === 'projectWiring'),
'the tools menu retains both wiring entries')
assert.equal(toolsPage.data.tools.some((item) => item.id === 'venue'), false,
  'the tools menu has no venue entry')

loadFresh('pages/records/project.js')
const projectPage = capturedPage
assert(projectPage, 'the project page registers through the mini-program page adapter')
projectPage.data = { ...projectPage.data }
projectPage.setData = (changes, callback) => {
  projectPage.data = { ...projectPage.data, ...changes }
  if (callback) callback()
}
projectPage.onLoad({ id: projectA.id })
assert.equal(projectPage.data.workspaceError, undefined)
assert.equal(projectPage.data.moduleProgress.length, 8, 'retired records do not add an active progress slot')
assert.equal(projectPage.data.moduleProgress.filter((item) => item.complete).length, 8,
  'eight active module results complete eight progress slots')
projectPage.onProjectItemTap({ currentTarget: { dataset: { id: activeRecords[0].id } } })
const activeRoute = new URL(navigations.at(-1), 'https://tunebuddy.local')
assert.equal(activeRoute.pathname, '/pages/limiter/limiter', 'an active project record navigates to its calculator')
const editorSessionId = activeRoute.searchParams.get('editorSessionId')
assert(editorSessionId, 'opening an active record creates an editor session route')
const resultRecordContext = require('../../utils/result-record-context')
const openedSession = resultRecordContext.getSession(editorSessionId)
assert.equal(openedSession.sourceKind, 'project-record')
assert.equal(openedSession.recordId, activeRecords[0].id)
assert.equal(openedSession.projectId, projectA.id)
assert.deepEqual(openedSession.preferences, activeLimiterPreferences)
loadFresh('pages/limiter/limiter.js')
const limiterPage = capturedPage
limiterPage.data = { ...limiterPage.data }
limiterPage.setData = (changes, callback) => {
  limiterPage.data = { ...limiterPage.data, ...changes }
  if (callback) callback()
}
limiterPage.onLoad(Object.fromEntries(activeRoute.searchParams.entries()))
assert.deepEqual(storage.get('audioTool.limiter.preferences'), activeLimiterPreferences,
  'the limiter editor session applies the saved parameters during onLoad')
assert.equal(limiterPage.data.selectedAmplifier.model, activeLimiterPreferences.amplifierModel)
assert.equal(limiterPage.data.selectedSpeaker.model, activeLimiterPreferences.speakerModel)
assert.equal(limiterPage.data.counts[limiterPage.data.countIndex], activeLimiterPreferences.count)
assert.equal(limiterPage.data.modes[limiterPage.data.modeIndex].value, activeLimiterPreferences.mode)
assert.equal(limiterPage.data.sensitivities[limiterPage.data.sensitivityIndex].value,
  activeLimiterPreferences.sensitivityVoltage)
assert.equal(limiterPage.data.highPassFrequencies[limiterPage.data.highPassFrequencyIndex].value,
  activeLimiterPreferences.highPassFrequency)
assert.equal(limiterPage.data.hasValidResult, true,
  'the restored parameters produce the same valid limiter result state')
limiterPage.onUnload()
assert.equal(resultRecordContext.getSession(editorSessionId), null, 'unloading closes the clean editor session')
assert.equal(storage.has('audioTool.limiter.preferences'), false,
  'closing the clean editor restores the original absent draft')
const venueGroup = projectPage.data.recordGroups.find((group) => group.module === 'venue')
assert(venueGroup, 'the project still displays its historical venue group')
assert.equal(venueGroup.records[0].summary, legacyRecord.summary)
assert.equal(venueGroup.records[0].retired, true)
const { buildRecordComparison } = require('../../utils/record-comparison')
assert.equal(buildRecordComparison([legacyRecord, legacyRecord]), null,
  'retired records cannot enter comparison')

const writesBeforeLegacyUi = writes.length
const navigationsBeforeLegacyUi = [...navigations]
projectPage.onProjectItemTap({ currentTarget: { dataset: { id: legacyRecord.id } } })
assert(modalOptions, 'opening the legacy project row shows the saved-result dialog')
assert.equal(modalOptions.confirmText, '复制结果')
assert([...modalOptions.confirmText].length <= 4, 'the legacy confirmation label fits the compact modal button')
assert.equal(modalOptions.content, retainedLegacy.resultText, 'the dialog shows the stored result text')
modalOptions.success({ confirm: true })
assert.equal(clipboardText, retainedLegacy.resultText, 'the dialog copies the full stored result')
projectPage.openProjectModule({ currentTarget: { dataset: { module: 'venue' } } })
assert.deepEqual(navigations, navigationsBeforeLegacyUi, 'legacy UI actions do not navigate to a removed page')
assert.equal(writes.length, writesBeforeLegacyUi, 'legacy UI actions do not write preferences or project state')

const projectReportText = projectPage.getProjectReportText()
assert(projectReportText.includes(retainedLegacy.resultText), 'the copied project report retains the legacy result')
assert(!/扩声目标|类别等级|标准类别|目标等级/.test(projectReportText),
  'a new project summary does not emit removed room-amplification fields')
projectPage.copyProject()
assert.equal(clipboardText, projectReportText, 'copying the project report uses the same retained history')

loadFresh('pages/projects/projects.js')
const favoritesPage = capturedPage
favoritesPage.data = { ...favoritesPage.data }
favoritesPage.setData = (changes, callback) => {
  favoritesPage.data = { ...favoritesPage.data, ...changes }
  if (callback) callback()
}
favoritesPage.refresh({ forceRefresh: true })
const favoriteLegacy = favoritesPage.data.favorites.find((record) => record.module === 'venue')
assert(favoriteLegacy, 'the historical record remains visible in the favorites list')
assert.equal(favoriteLegacy.archived, true)
favoritesPage.openFavorite({ currentTarget: { dataset: { id: favoriteLegacy.id } } })
const favoriteRoute = new URL(navigations.at(-1), 'https://tunebuddy.local')
assert.equal(favoriteRoute.pathname, '/pages/projects/favorite-detail',
  'opening a historical favorite reaches its detail page')
loadFresh('pages/projects/favorite-detail.js')
const favoriteDetailPage = capturedPage
favoriteDetailPage.data = { ...favoriteDetailPage.data }
favoriteDetailPage.setData = (changes, callback) => {
  favoriteDetailPage.data = { ...favoriteDetailPage.data, ...changes }
  if (callback) callback()
}
favoriteDetailPage.onLoad(Object.fromEntries(favoriteRoute.searchParams.entries()))
assert(favoriteDetailPage.data.favorite, 'the historical favorite detail loads')
assert.equal(favoriteDetailPage.data.favorite.resultText, retainedLegacy.resultText,
  'the historical favorite detail retains its full saved result')
assert.equal(favoriteDetailPage.data.favorite.canLoad, false,
  'a retired favorite does not offer an unsafe calculator reload')

projectPage.startEditProject()
projectPage.setData({
  projectForm: { ...projectPage.data.projectForm, notes: '更新后的普通项目备注' },
})
projectPage.saveProjectDetails()
const savedProject = records.getProjects().find((project) => project.id === projectA.id)
assert.equal(savedProject.notes, '更新后的普通项目备注')
assert.equal(savedProject.standardClassKey, projectA.standardClassKey,
  'editing ordinary project fields preserves the stored standard key')
assert.equal(savedProject.gradeKey, projectA.gradeKey,
  'editing ordinary project fields preserves the stored grade key')

const projectReport = loadFresh('pages/records/project-report.js')
const reportPayload = projectReport.buildProjectReportPayload(projectPage.data.project,
  projectPage.data.recordGroups, { totalModuleCount: 8, generatedAt: 'test' })
assert(reportPayload)
assert.equal(reportPayload.completedModuleCount, 8, 'the project report counts only active modules')
assert.equal(reportPayload.totalModuleCount, 8, 'the project report denominator remains eight active modules')
assert(reportPayload.groups.some((group) => group.module === 'venue'),
  'the project report can still include a readable historical result group')

console.log('PASS venue removal integration: active routes and menu, retired record storage, project progress, and history display')
