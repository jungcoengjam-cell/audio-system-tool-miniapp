'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const storage = new Map()
const storageReadFailures = new Set()
const storageWriteFailures = new Set()
const storageWriteCounts = new Map()
const navigationAttempts = []
const navigations = []
const toastTitles = []
let storageReadFailureHits = 0
let failNextNavigation = false
const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value))

global.wx = {
  getStorageSync(key) {
    if (storageReadFailures.has(key)) {
      storageReadFailureHits += 1
      throw new Error(`read failed: ${key}`)
    }
    return clone(storage.get(key))
  },
  setStorageSync(key, value) {
    storageWriteCounts.set(key, (storageWriteCounts.get(key) || 0) + 1)
    if (storageWriteFailures.has(key)) throw new Error(`write failed: ${key}`)
    storage.set(key, clone(value))
  },
  removeStorageSync(key) { storage.delete(key) },
  getStorageInfoSync() { return { currentSize: 128, limitSize: 10240 } },
  getSystemInfoSync() { return { theme: 'light' } },
  showToast({ title }) { toastTitles.push(title) },
  navigateTo(options) {
    navigationAttempts.push(options.url)
    if (failNextNavigation) {
      failNextNavigation = false
      if (options.fail) options.fail({ errMsg: 'navigateTo:fail test' })
      return
    }
    navigations.push(options.url)
  },
  navigateBack() {},
}

const records = require('../utils/records')
const FAVORITES_KEY = 'audioTool.favorites.v1'
const RECORDS_KEY = 'audioTool.records.v1'
const PROJECTS_KEY = 'audioTool.projects.v1'
const SESSIONS_KEY = 'audioTool.resultEditorSessions.v1'
const activePagePath = path.join(root, 'pages/projects/projects.js')
const relevantModules = [
  'pages/projects/favorite-load-check.js',
  'utils/result-record-context.js',
  'data/equipment.js',
  'data/cameras.js',
  'data/amplifier-input-stages.js',
  'utils/camera-fov.js',
  'pages/records/report-model.js',
].map((relative) => path.resolve(root, relative))
const modulesBeforePageLoad = new Set(Object.keys(require.cache).map((file) => path.resolve(file)))
const pageDefinitions = []
global.Page = (definition) => pageDefinitions.push(definition)
delete require.cache[activePagePath]
const pageDefinition = require(activePagePath)
const newlyLoadedModules = Object.keys(require.cache)
  .map((file) => path.resolve(file))
  .filter((file) => !modulesBeforePageLoad.has(file))
assert.strictEqual(pageDefinitions.length, 1, '加载项目页只应注册一个 Page')
assert(pageDefinition && typeof pageDefinition === 'object', '项目页模块加载失败')
assert.deepStrictEqual(newlyLoadedModules.filter((file) => relevantModules.includes(file)), [],
  '项目页冷加载不应新增收藏预检、设备目录、摄像机视场或编辑上下文依赖')

const page = {
  ...pageDefinitions[0],
  data: clone(pageDefinitions[0].data),
  setData(value, callback) {
    Object.entries(value).forEach(([key, item]) => { this.data[key] = item })
    if (callback) callback()
  },
}

const { amplifiers, speakers } = require('../data/equipment')
const { cameras } = require('../data/cameras')
const { amplifierInputStages } = require('../data/amplifier-input-stages')
const { getHorizontalCameraViews } = require('../utils/camera-fov')
const amplifier = amplifiers.find((item) => amplifierInputStages[item.model])
const speaker = speakers.find((item) => !item.calculationDisabled && Number.isFinite(item.sensitivityDb))
const camera = cameras.find((item) => getHorizontalCameraViews(item).length > 0)
assert(amplifier && speaker && camera, '测试夹具需要当前可用的功放、音箱和摄像机型号')

const testCases = []
function checkCase(name, callback) {
  callback()
  testCases.push(name)
}

const preferencesByModule = {
  limiter: {
    amplifierModel: amplifier.model,
    speakerModel: speaker.model,
    count: 1,
    wiring: 'parallel',
    mode: 'stereo',
    sensitivityVoltage: 1,
    highPassFrequency: 80,
  },
  spl: { speakerModel: speaker.model, distance: 5, count: 1 },
  gainStructure: { amplifierModel: amplifier.model, sourceLevel: -18 },
  camera: {
    sourceMode: 'library',
    cameraModel: camera.model,
    viewIndex: 0,
    cameraCalculationVersion: 1,
    temporaryOwner: 'favorite-direct-entry-test',
  },
  cable: { mode: 'constant', environment: 'indoor', length: 25 },
  ledScreen: { aspectRatio: '16:9', unitKey: 'module', pitch: 'recommended', width: 6, height: 3 },
  audioWiring: {
    version: 1,
    outputId: 'xlrBalanced',
    inputId: 'terminalBalanced',
    manualSelected: { output: true, input: true },
    viewMode: 'wiring',
    face: 'mating',
  },
}

const favoritesByModule = Object.create(null)
Object.entries(preferencesByModule).forEach(([module, preferences]) => {
  const favorite = records.saveFavoriteSnapshot({
    module,
    title: `测试收藏 ${module}`,
    summary: `快照 ${module}`,
    preferences,
    resultText: `保存结果 ${module}`,
  }, { saveAs: true })
  assert(favorite, `无法创建 ${module} 收藏测试夹具`)
  favoritesByModule[module] = favorite
})

const unsupportedFavorites = [
  { id: 'favorite-test-venue', module: 'venue', preferences: { venueType: 'historic' }, resultText: '旧会议室结果' },
  { id: 'favorite-test-unknown', module: 'unknownModule', preferences: { retained: true }, resultText: '未知模块结果' },
]
storage.set(FAVORITES_KEY, [...storage.get(FAVORITES_KEY), ...unsupportedFavorites.map((item) => ({
  ...item,
  favorite: true,
  createdAt: Date.now(),
  updatedAt: Date.now(),
} ))])
assert(records.getWorkspaceSnapshot({ forceRefresh: true }).ok,
  '未知及退役收藏测试夹具应通过实际 workspace 读取')
const dmxFavorite = records.saveFavoriteSnapshot({
  module: 'dmxAddress',
  title: '已退役的灯光收藏',
  preferences: { startAddress: 1 },
  resultText: 'DMX 原始结果',
}, { saveAs: true })
assert(dmxFavorite, '无法创建 DMX 退役收藏测试夹具')
const invalidDeviceFavorite = records.saveFavoriteSnapshot({
  module: 'limiter',
  title: '型号已失效的收藏',
  preferences: { amplifierModel: 'missing-amplifier', speakerModel: 'missing-speaker' },
  resultText: '原始历史结果',
}, { saveAs: true })
assert(invalidDeviceFavorite, '无法创建失效型号收藏测试夹具')

page.onShow()
assert.strictEqual(page.data.workspaceError, '')
const projectsWxml = fs.readFileSync(path.join(root, 'pages/projects/projects.wxml'), 'utf8')
const projectsWxss = fs.readFileSync(path.join(root, 'pages/projects/projects.wxss'), 'utf8').replace(/\s+/g, '')
assert(projectsWxml.includes('data-id="{{item.id}}" bindtap="openFavorite"'),
  '收藏卡片主体必须仍有直接入口')
assert(projectsWxml.includes('class="favorite-card-footer" role="button" aria-label="查看保存时的参数和结果" data-id="{{item.id}}" catchtap="openFavoriteDetail">'),
  '收藏卡片详情入口应有读屏名称、数据 ID 和阻止冒泡的 catchtap')
assert(/\.favorite-card-footer\{[^}]*min-height:44px/.test(projectsWxss)
  && /\.favorite-card-footer\{[^}]*box-sizing:border-box/.test(projectsWxss),
'收藏卡片详情入口触区必须达到 44px 高并纳入盒尺寸计算')
checkCase('项目页冷加载无新预检/上下文/设备依赖，卡片详情触区可访问且至少 44px', () => {})

const context = require('../utils/result-record-context')
function favoriteRouteFor(url) {
  const parsed = new URL(url, 'https://miniapp.local')
  return { pathname: parsed.pathname, sessionId: parsed.searchParams.get('editorSessionId') }
}
function openEditorAndReturn(module, favorite) {
  const metadata = records.MODULES[module]
  const temporaryPreferences = { existingTemporaryWork: module, value: `keep-${module}` }
  storage.set(metadata.preferenceKey, temporaryPreferences)
  const favoritesBefore = JSON.stringify(storage.get(FAVORITES_KEY))
  const recordsBefore = JSON.stringify(storage.get(RECORDS_KEY))
  const projectsBefore = JSON.stringify(storage.get(PROJECTS_KEY))
  const navigationStart = navigations.length
  const sessionId = page.openFavorite({ currentTarget: { dataset: { id: favorite.id } } })
  assert.strictEqual(typeof sessionId, 'string', `${module} 收藏没有打开编辑会话`)
  const route = favoriteRouteFor(navigations[navigationStart])
  assert.strictEqual(route.pathname, metadata.path, `${module} 收藏未进入对应工具`)
  assert.strictEqual(route.sessionId, sessionId, `${module} 直达链接缺少新建的编辑会话 ID`)
  const session = context.getSession(sessionId)
  assert(session, `${module} 收藏编辑会话没有写入存储`)
  assert.strictEqual(session.sourceKind, 'favorite', `${module} 应使用独立收藏副本来源`)
  assert.strictEqual(session.recordId, '', `${module} 收藏副本不能绑定或覆盖项目记录`)
  assert.strictEqual(session.projectId, '', `${module} 收藏副本不能绑定到项目`)
  const expectedPreferences = {
    ...favorite.preferences,
    ...(module === 'camera' ? { cameraCalculationVersion: 2 } : {}),
  }
  assert.deepStrictEqual(session.preferences, expectedPreferences, `${module} 收藏参数未原样带入会话`)
  assert.deepStrictEqual(storage.get(metadata.preferenceKey), expectedPreferences,
    `${module} 工具未收到收藏参数副本`)
  const editorPage = { data: {}, setData(value) { Object.assign(this.data, value) } }
  assert(context.attachResultEditor(editorPage, module, { editorSessionId: sessionId }),
    `${module} 工具无法接入收藏编辑会话`)
  assert(context.finalizeResultEditor(editorPage), `${module} 工具返回时未完成参数恢复`)
  assert.deepStrictEqual(storage.get(metadata.preferenceKey), temporaryPreferences,
    `${module} 返回后未恢复之前的临时参数`)
  assert.strictEqual(context.getSession(sessionId), null, `${module} 正常返回后仍残留编辑会话`)
  assert.strictEqual(JSON.stringify(storage.get(FAVORITES_KEY)), favoritesBefore,
    `${module} 直达或编辑改变了独立收藏快照`)
  assert.strictEqual(JSON.stringify(storage.get(RECORDS_KEY)), recordsBefore,
    `${module} 收藏直达改变了项目业务记录`)
  assert.strictEqual(JSON.stringify(storage.get(PROJECTS_KEY)), projectsBefore,
    `${module} 收藏直达改变了项目数据`)
  page.onShow()
}

Object.entries(favoritesByModule).forEach(([module, favorite]) => {
  checkCase(`${module} 收藏直达、参数副本、返回恢复及业务数据不变`, () => {
    openEditorAndReturn(module, favorite)
  })
})
checkCase('点击时加载的收藏预检 helper 不会注册额外页面', () => {
  assert.strictEqual(pageDefinitions.length, 1)
})

checkCase('收藏详情 footer 仍可打开旧详情页且不创建会话', () => {
  const beforeSessionWrites = storageWriteCounts.get(SESSIONS_KEY) || 0
  const favoritesBefore = JSON.stringify(storage.get(FAVORITES_KEY))
  page.openFavoriteDetail({ currentTarget: { dataset: { id: favoritesByModule.limiter.id } } })
  assert.strictEqual(navigations.at(-1),
    `/pages/projects/favorite-detail?id=${encodeURIComponent(favoritesByModule.limiter.id)}`)
  assert.strictEqual(storageWriteCounts.get(SESSIONS_KEY) || 0, beforeSessionWrites)
  assert.strictEqual(JSON.stringify(storage.get(FAVORITES_KEY)), favoritesBefore,
    'footer 查看详情不得修改独立收藏')
})

for (const [label, favorite] of [
  ['DMX retired module', dmxFavorite],
  ['retired venue module', { id: 'favorite-test-venue' }],
  ['unknown module', { id: 'favorite-test-unknown' }],
  ['invalid device reference', invalidDeviceFavorite],
]) {
  checkCase(`${label} 安全回退到收藏详情，不创建会话`, () => {
    const beforeSessionWrites = storageWriteCounts.get(SESSIONS_KEY) || 0
    const beforeNavigations = navigations.length
    const result = page.openFavorite({ currentTarget: { dataset: { id: favorite.id } } })
    assert.strictEqual(result, false)
    assert.strictEqual(navigations.length, beforeNavigations + 1, `${label} 应回退到详情页`)
    assert.strictEqual(navigations.at(-1),
      `/pages/projects/favorite-detail?id=${encodeURIComponent(favorite.id)}`)
    assert.strictEqual(storageWriteCounts.get(SESSIONS_KEY) || 0, beforeSessionWrites)
  })
}

checkCase('已消失收藏显示错误且不写会话', () => {
  const beforeSessionWrites = storageWriteCounts.get(SESSIONS_KEY) || 0
  const result = page.openFavorite({ currentTarget: { dataset: { id: 'missing-favorite' } } })
  assert.strictEqual(result, false)
  assert.strictEqual(storageWriteCounts.get(SESSIONS_KEY) || 0, beforeSessionWrites)
  assert(toastTitles.some((title) => title.includes('收藏不存在')))
})

checkCase('已移入回收站的收藏不创建会话', () => {
  const recycledFavorite = favoritesByModule.spl
  assert(records.removeFavorite(recycledFavorite.id), '测试收藏应能移入回收站')
  const beforeSessionWrites = storageWriteCounts.get(SESSIONS_KEY) || 0
  assert.strictEqual(page.openFavorite({ currentTarget: { dataset: { id: recycledFavorite.id } } }), false)
  assert.strictEqual(storageWriteCounts.get(SESSIONS_KEY) || 0, beforeSessionWrites)
  assert(toastTitles.some((title) => title.includes('收藏不存在')))
})

checkCase('workspace storage 读取失败显示错误且不写会话', () => {
  const beforeSessionWrites = storageWriteCounts.get(SESSIONS_KEY) || 0
  const beforeReadFailures = storageReadFailureHits
  const beforeToasts = toastTitles.length
  storageReadFailures.add(FAVORITES_KEY)
  try {
    assert.strictEqual(page.openFavorite({ currentTarget: { dataset: { id: favoritesByModule.limiter.id } } }), false)
  } finally {
    storageReadFailures.delete(FAVORITES_KEY)
  }
  assert(storageReadFailureHits > beforeReadFailures, '测试应实际注入 favorites raw storage 读取失败')
  assert.strictEqual(storageWriteCounts.get(SESSIONS_KEY) || 0, beforeSessionWrites)
  assert(toastTitles.length > beforeToasts, 'storage read failure should produce a user-visible toast')
})

checkCase('创建收藏会话失败显示错误且不导航', () => {
  const preferenceKey = records.MODULES.limiter.preferenceKey
  const originalPreferences = { existingTemporaryWork: 'creation-failure' }
  storage.set(preferenceKey, originalPreferences)
  const navigationStart = navigationAttempts.length
  storageWriteFailures.add(SESSIONS_KEY)
  try {
    assert.strictEqual(page.openFavorite({ currentTarget: { dataset: { id: favoritesByModule.limiter.id } } }), false)
  } finally {
    storageWriteFailures.delete(SESSIONS_KEY)
  }
  assert.strictEqual(navigationAttempts.length, navigationStart)
  assert.deepStrictEqual(storage.get(preferenceKey), originalPreferences)
  assert(toastTitles.some((title) => title.includes('无法打开计算副本')))
})

checkCase('导航失败清理会话后允许再次尝试', () => {
  const preferenceKey = records.MODULES.limiter.preferenceKey
  const originalPreferences = { existingTemporaryWork: 'navigation-retry' }
  storage.set(preferenceKey, originalPreferences)
  failNextNavigation = true
  const failedSessionId = page.openFavorite({ currentTarget: { dataset: { id: favoritesByModule.limiter.id } } })
  assert.strictEqual(typeof failedSessionId, 'string')
  assert.strictEqual(context.getSession(failedSessionId), null, '导航失败回调应清理新会话')
  assert.deepStrictEqual(storage.get(preferenceKey), originalPreferences, '导航失败后应恢复进入前偏好')
  const retrySessionId = page.openFavorite({ currentTarget: { dataset: { id: favoritesByModule.limiter.id } } })
  assert.strictEqual(typeof retrySessionId, 'string', '导航失败后同一收藏应可重试')
  assert.notStrictEqual(retrySessionId, failedSessionId)
  const editorPage = { data: {}, setData(value) { Object.assign(this.data, value) } }
  assert(context.attachResultEditor(editorPage, 'limiter', { editorSessionId: retrySessionId }))
  assert(context.finalizeResultEditor(editorPage))
  page.onShow()
})

checkCase('同卡连点只创建一个活动收藏会话', () => {
  const beforeNavigationCount = navigationAttempts.length
  const beforeSessionWrites = storageWriteCounts.get(SESSIONS_KEY) || 0
  const sessionId = page.openFavorite({ currentTarget: { dataset: { id: favoritesByModule.limiter.id } } })
  const afterFirstSessionWrites = storageWriteCounts.get(SESSIONS_KEY) || 0
  assert.strictEqual(typeof sessionId, 'string')
  assert.strictEqual(page.openFavorite({ currentTarget: { dataset: { id: favoritesByModule.limiter.id } } }), false)
  assert.strictEqual(navigationAttempts.length, beforeNavigationCount + 1)
  assert.strictEqual(storageWriteCounts.get(SESSIONS_KEY) || 0, afterFirstSessionWrites)
  assert(afterFirstSessionWrites > beforeSessionWrites)
  const editorPage = { data: {}, setData(value) { Object.assign(this.data, value) } }
  assert(context.attachResultEditor(editorPage, 'limiter', { editorSessionId: sessionId }))
  assert(context.finalizeResultEditor(editorPage))
  page.onShow()
})

checkCase('interrupted session 不会锁住同一收藏入口', () => {
  const sessionId = page.openFavorite({ currentTarget: { dataset: { id: favoritesByModule.limiter.id } } })
  const sessionStore = storage.get(SESSIONS_KEY)
  storage.set(SESSIONS_KEY, {
    ...sessionStore,
    sessions: sessionStore.sessions.map((session) => session.id === sessionId
      ? { ...session, interrupted: true }
      : session),
  })
  const retry = page.openFavorite({ currentTarget: { dataset: { id: favoritesByModule.limiter.id } } })
  assert.strictEqual(typeof retry, 'string')
  assert.notStrictEqual(retry, sessionId)
  storage.set(SESSIONS_KEY, { version: 2, sessions: [], owners: {} })
  storage.set(records.MODULES.limiter.preferenceKey, { existingTemporaryWork: 'interrupted-cleanup' })
  page.onShow()
})

checkCase('restorationPending session 可先恢复再打开新收藏副本', () => {
  const preferenceKey = records.MODULES.limiter.preferenceKey
  const temporaryPreferences = { existingTemporaryWork: 'pending-restoration' }
  storage.set(preferenceKey, temporaryPreferences)
  const sessionId = page.openFavorite({ currentTarget: { dataset: { id: favoritesByModule.limiter.id } } })
  const sessionStore = storage.get(SESSIONS_KEY)
  storage.set(SESSIONS_KEY, {
    ...sessionStore,
    owners: { ...sessionStore.owners, limiter: sessionId },
    sessions: sessionStore.sessions.map((session) => session.id === sessionId
      ? { ...session, restorationPending: true, discardPending: true }
      : session),
  })
  const retriedSessionId = page.openFavorite({ currentTarget: { dataset: { id: favoritesByModule.limiter.id } } })
  assert.strictEqual(typeof retriedSessionId, 'string')
  assert.notStrictEqual(retriedSessionId, sessionId)
  const editorPage = { data: {}, setData(value) { Object.assign(this.data, value) } }
  assert(context.attachResultEditor(editorPage, 'limiter', { editorSessionId: retriedSessionId }))
  assert(context.finalizeResultEditor(editorPage))
  assert.deepStrictEqual(storage.get(preferenceKey), temporaryPreferences)
  page.onShow()
})

storage.set(SESSIONS_KEY, { version: 2, sessions: [], owners: {} })
delete global.Page
delete global.wx

console.log(`收藏直达回归通过：${testCases.length} 项（7 个可载入模块及失败、重试、恢复和详情回退场景）。`)
