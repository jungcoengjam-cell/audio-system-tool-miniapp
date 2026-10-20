'use strict'

const assert = require('node:assert/strict')
const Module = require('node:module')
const path = require('node:path')

const projectPagePath = path.resolve(__dirname, '../../pages/records/project.js')
const originalLoad = Module._load
const routes = []
const calls = { drafts: [], editors: [], updates: [], deletes: [] }
let pageDefinition
let lastActionSheet
let lastModal
global.Page = (definition) => { pageDefinition = definition }
global.wx = {
  showActionSheet(options) { lastActionSheet = options },
  showModal(options) { lastModal = options },
  navigateTo(options) { routes.push(options.url) },
  navigateBack(options) { routes.push(`back:${options.delta}`) },
  showToast() {},
}

const fakeModules = {
  limiter: { label: '限幅器', path: '/pages/limiter/limiter' },
  dmxAddress: { label: '灯光编址', path: '/pages/dmx-address/dmx-address' },
}
const mockRecords = {
  MODULES: fakeModules,
  getModuleMetadata: () => null,
  getStorageHealth: () => null,
  getProjectRecordView: (record) => record,
  getWorkspaceSnapshot: () => ({ ok: true, projects: [], records: [], favorites: [], recoveryEntries: [] }),
  deleteProject(id) { calls.deletes.push(id); return true },
  removeRecordFromProject: () => true,
  setActiveProject: (id) => ({ id }),
  updateProject(id, changes) { calls.updates.push({ id, changes }); return { id, ...changes } },
}
const mockContext = {
  openProjectDraft(moduleKey, projectId) { calls.drafts.push({ moduleKey, projectId }); return 'session-id' },
  openRecordEditor(record, sourceKind, projectId) { calls.editors.push({ record, sourceKind, projectId }); return 'editor-session' },
}

Module._load = function load(request, parent, isMain) {
  if (parent && parent.filename === projectPagePath && request === '../../utils/records') return mockRecords
  if (parent && parent.filename === projectPagePath && request === '../../utils/result-record-context') return mockContext
  if (parent && parent.filename === projectPagePath && request === '../dmx-layout/lighting-workspace') {
    return { readLightingWorkspace: () => ({ ok: true, exists: false, revision: 0, scheme: null }), calculateScheme: () => null }
  }
  return originalLoad.call(this, request, parent, isMain)
}

try {
  require(projectPagePath)
} finally {
  Module._load = originalLoad
}
assert.ok(pageDefinition, 'project page should register')

const projectId = 'project-stable-42'
const project = {
  id: projectId,
  name: '现场项目',
  isActive: false,
  recordCount: 2,
  wiringLineCount: 3,
  hasLighting: true,
  lightingFixtureCount: 4,
}
const instance = {
  ...pageDefinition,
  data: { ...pageDefinition.data, project, workspaceError: '', projectSearchText: '', projectViewFilter: 'all', moduleOptions: [{ key: 'limiter', label: '限幅器' }] },
  projectId,
  rawRecords: [{ id: 'record-stable-9', module: 'limiter', preferences: {}, projectIds: [projectId] }],
  setData(changes, callback) { this.data = { ...this.data, ...changes }; if (callback) callback() },
  refresh() {},
}

instance.openProjectReport()
assert.equal(routes.at(-1), `/pages/records/report?id=${encodeURIComponent(projectId)}`)

assert.equal(instance.launchProjectModule('limiter'), true)
assert.deepEqual(calls.drafts.at(-1), { moduleKey: 'limiter', projectId }, 'calculator draft receives the visible stable project ID')
assert.equal(routes.length, 1, 'calculator opening delegates to the isolated result editor session')

assert.equal(instance.launchProjectModule('dmxAddress'), true)
assert.equal(routes.at(-1), `/pages/dmx-address/dmx-address?lightingProjectId=${encodeURIComponent(projectId)}`)
instance.openProjectWiring()
assert.equal(routes.at(-1), `/pages/project-wiring/index?id=${encodeURIComponent(projectId)}`)
instance.openProjectLighting()
assert.equal(routes.at(-1), `/pages/dmx-address/dmx-address?lightingProjectId=${encodeURIComponent(projectId)}`)

instance.onProjectItemTap({ currentTarget: { dataset: { id: 'record-stable-9' } } })
assert.equal(calls.editors.length, 1)
assert.equal(calls.editors[0].record.id, 'record-stable-9')
assert.equal(calls.editors[0].sourceKind, 'project-record')
assert.equal(calls.editors[0].projectId, projectId)
assert.equal(instance.data.comparisonMode, undefined, 'project detail no longer enters comparison mode')
instance.openManagementMenu()
assert.deepEqual(lastActionSheet.itemList, ['重命名', '编辑项目资料', '删除项目'], 'management menu no longer exposes record comparison')

instance.startRenameProject()
instance.onRenameInput({ detail: { value: '新项目名' } })
instance.saveRenameProject()
assert.deepEqual(calls.updates.at(-1), { id: projectId, changes: { name: '新项目名' } }, 'rename uses stable ID and only changes the name')

instance.confirmDeleteProject()
assert.match(lastModal.content, /移入回收站/)
assert.match(lastModal.content, /独立收藏不会删除/)
lastModal.success({ confirm: true })
assert.equal(calls.deletes.at(-1), projectId, 'recoverable delete targets the stable project ID')
assert.equal(routes.at(-1), 'back:1')

instance.openAddProjectModule()
assert.deepEqual(lastActionSheet.itemList, ['计算记录', '通道与线缆', '灯位方案'])
lastActionSheet.success({ tapIndex: 0 })
assert.deepEqual(lastActionSheet.itemList, ['限幅器'])
lastActionSheet.success({ tapIndex: 0 })
assert.deepEqual(calls.drafts.at(-1), { moduleKey: 'limiter', projectId }, 'calculator menu keeps the explicit project context')
instance.openAddProjectModule()
lastActionSheet.success({ tapIndex: 1 })
assert.equal(routes.at(-1), `/pages/project-wiring/index?id=${encodeURIComponent(projectId)}`, 'wiring entry carries the project ID')
lastActionSheet.success({ tapIndex: 2 })
assert.equal(routes.at(-1), `/pages/dmx-address/dmx-address?lightingProjectId=${encodeURIComponent(projectId)}`, 'lighting entry carries its project context')

console.log('project interior context passed (report, record edit, calculator draft, wiring, lighting, rename, recoverable delete by stable ID)')
