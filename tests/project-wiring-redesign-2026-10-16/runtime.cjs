const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const root = path.resolve(__dirname, '../..')
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value))
const projectKey = 'audioTool.projects.v1'
const activeKey = 'audioTool.activeProject.v1'
const viewPreferenceKey = 'audioTool.projectWiring.view.v1'

function makeFixture(name = 'standard', count = 4) {
  const long = name === 'long'
  const compact = name === 'compact'
  const devices = [
    { id: 'receiver-1', type: 'receiver', name: long ? '舞台左侧无线话筒接收机一号通道与扩展设备长名称' : '无线接收机 1' },
    { id: 'mixer-1', type: 'mixer', name: long ? '主扩声调音台及多功能会议中心超长完整设备名称' : '调音台' },
    { id: 'amplifier-1', type: 'amplifier', name: '功放' },
    { id: 'mixer-duplicate', type: 'mixer', name: '调音台' },
  ]
  const lines = Array.from({ length: name === 'empty' ? 0 : count }, (_, index) => ({
    id: `qa-line-${index + 1}`, code: `A${String(index + 1).padStart(3, '0')}`,
    fromDeviceId: devices[0].id, fromDevice: devices[0].name,
    fromPort: long ? `OUTPUT-${index + 1}-LONG-PORT-NAME-\u957f\u7aef\u53e3\u6807\u7b7e` : compact ? `OUT${index + 1}` : `OUT ${index + 1}`,
    toDeviceId: index === count - 1 && count === 4 ? devices[3].id : devices[1].id, toDevice: devices[1].name,
    toPort: long ? `INPUT-${index + 1}-LONG-PORT-NAME-\u76ee\u6807\u7aef\u53e3\u6807\u7b7e` : compact ? `IN${index + 1}` : `IN ${index + 1}`,
    purpose: '', buildType: 'finished', cableType: 'balanced',
    spec: compact ? 'RVPE 2×0.5 mm²' : index % 2 ? '' : 'RVPE 2×0.5 mm2',
    connectorA: compact || !(index % 2) ? 'xlrFemale' : '', connectorB: compact || !(index % 2) ? 'xlrMale' : '',
    lengthText: compact || !(index % 2) ? '3' : '', status: 'pending', notes: '',
  }))
  const schedule = { version: 1, revision: 0, nextNumber: lines.length + 1, lines, devices: name === 'empty' ? [] : devices }
  if (name === 'numbered') lines.forEach((line, index) => { line.code = ['A009', 'A010', 'A100', 'A200'][index] || line.code })
  if (name === 'mixedlegacy') {
    const legacy = { ...lines[0], id: 'legacy-line', code: 'A005', fromDevice: '历史设备', toDevice: '历史目标' }
    delete legacy.fromDeviceId; delete legacy.toDeviceId
    lines.push(legacy); schedule.nextNumber = 6
  }
  if (name === 'maxlegal') {
    devices[0].name = '源设备完整名称'.repeat(20).slice(0, 100)
    devices[1].name = '目标设备完整名称'.repeat(20).slice(0, 100)
    for (const [index, line] of lines.entries()) Object.assign(line, {
      code: (index ? `CUSTOM-LINE-${index}-0123456789ABCDEFGXYZ` : '自定义线路编号'.repeat(8)).slice(0, 32),
      fromDevice: devices[0].name, toDevice: devices[1].name,
      fromPort: '源端口完整中文名称'.repeat(12).slice(0, 80),
      toPort: 'TARGET-PORT-LONG-ASCII-TOKEN-'.repeat(4).slice(0, 80),
      spec: '线缆完整规格描述'.repeat(20).slice(0, 120),
      connectorA: '来源接头自定义完整名称'.repeat(8).slice(0, 60),
      connectorB: '目标接头自定义完整名称'.repeat(8).slice(0, 60),
    })
  }
  return { id: 'qa-project-1', name: long ? '多功能会议中心主会场设备通道与线缆完整长项目名称' : '多功能厅', createdAt: 1, updatedAt: 2, wiringSchedule: schedule }
}

function createRuntime(options = {}) {
  const fixture = makeFixture(options.fixture, options.count)
  const storage = options.storage ? clone(options.storage) : {
    [projectKey]: [fixture, { id: 'qa-project-2', name: '小剧场', createdAt: 1, updatedAt: 1 }],
    [activeKey]: fixture.id, 'audioTool.storageSchemaVersion': 3,
  }
  const events = { writes: [], toasts: [], modals: [], shares: [], exports: [], canvasCalls: [], loading: 0, titles: [], navigationColors: [], navigations: [] }
  let failRead = false
  let failWrite = false
  let failPreferenceRead = false
  let failPreferenceWrite = false
  let selectors = {}
  let currentPage
  let deferReportCallback = false
  let deferPhotoSaveCallbacks = false
  const dataCallbacks = []
  const photoSaveCallbacks = []
  const drawQueue = []
  const themeListeners = new Set()
  const noop = () => {}
  const wx = {
    getStorageSync(key) {
      if (failRead && key === projectKey) throw Error('QA storage read failure')
      if (failPreferenceRead && key === viewPreferenceKey) throw Error('QA preference read failure')
      return clone(storage[key] ?? '')
    },
    setStorageSync(key, value) {
      if (failWrite || (failPreferenceWrite && key === viewPreferenceKey)) throw Error('QA storage write failure')
      storage[key] = clone(value); events.writes.push({ key, value: clone(value) })
    },
    removeStorageSync(key) { delete storage[key] },
    setNavigationBarTitle(value) { events.titles.push(value.title) },
    showToast(value) { events.toasts.push(clone(value)) },
    showModal(value) { events.modals.push(value) },
    showLoading() { events.loading++ }, hideLoading() { events.loading-- },
    hideKeyboard: noop, vibrateShort: noop, vibrateLong: noop,
    onThemeChange(listener) { themeListeners.add(listener) }, offThemeChange(listener) { themeListeners.delete(listener) },
    onKeyboardHeightChange: noop, offKeyboardHeightChange: noop,
    getWindowInfo: () => ({ windowWidth: options.width || 390, windowHeight: options.height || 844, screenHeight: options.height || 844, statusBarHeight: options.capsule ? (Number(options.statusHeight) || 20) : 0, safeArea: { top: 0, bottom: (options.height || 844) - (Number(options.safeBottom) || 0) } }),
    getAppBaseInfo: () => ({ theme: options.baseTheme ?? options.theme ?? 'light' }),
    getSystemInfoSync: () => { if (options.systemInfoThrows) throw Error('QA legacy system info failure'); return { theme: options.systemTheme ?? options.theme ?? 'light', windowWidth: options.width || 390, windowHeight: options.height || 844 } },
    getMenuButtonBoundingClientRect: () => options.capsule ? ({ left: Number(options.menuLeft) || (options.width || 390) - 96, top: Number(options.menuTop) || 26, bottom: Number(options.menuBottom) || 58, right: (options.width || 390) - 8, width: 88, height: 32 }) : null,
    setNavigationBarColor(value) { events.navigationColors.push(clone(value)) },
    navigateBack(value) { events.navigations.push({ type: 'back', ...clone(value) }) },
    switchTab(value) { events.navigations.push({ type: 'tab', ...clone(value) }) },
    nextTick(callback) { callback() },
    createSelectorQuery() {
      const pending = []
      const query = { in() { return this }, select(selector) {
        const selection = { boundingClientRect(callback) { pending.push(() => callback(selectors[selector] || null)); return query },
          fields(_options, callback) { pending.push(() => callback(selectors[selector] || null)); return query },
          scrollOffset(callback) { pending.push(() => callback({ scrollTop: 0 })); return query } }
        return selection
      }, exec(callback) { pending.forEach(call => call()); callback?.() } }
      return query
    },
    createCanvasContext() {
      return new Proxy({}, { get(target, key) {
        if (key === 'draw') return (_reserve, callback) => drawQueue.push(callback)
        return (...args) => { events.canvasCalls.push([key, ...args]) }
      }, set(target, key, value) { target[key] = value; return true } })
    },
    canvasToTempFilePath(value) { events.exports.push({ canvasId: value.canvasId, width: value.width, height: value.height }); value.success?.({ tempFilePath: '/__placeholder.png' }) },
    previewImage(value) { events.shares.push({ type: 'preview', ...clone(value) }) },
    showShareImageMenu(value) { events.shares.push({ type: 'share', path: value.path }) },
    saveImageToPhotosAlbum(value) {
      events.shares.push({ type: 'save', filePath: value.filePath })
      if (deferPhotoSaveCallbacks) photoSaveCallbacks.push(value.success)
      else value.success?.()
    },
    setClipboardData(value) { value.success?.() },
  }
  if (options.systemInfoAbsent) delete wx.getSystemInfoSync
  function activate() { global.wx = wx; global.getCurrentPages = () => currentPage ? [currentPage] : []; global.getApp = () => ({ globalData: { theme: options.appTheme ?? options.theme ?? 'light' } }) }
  function page(pageOptions = {}) {
    activate()
    let definition
    global.Page = value => { definition = value }
    for (const name of Object.keys(require.cache)) if (name.startsWith(root + path.sep) && /[\\/](?:pages[\\/]project-wiring|utils)[\\/]/.test(name)) delete require.cache[name]
    if (options.workspaceUiSource) {
      const filename = path.join(root, 'pages/project-wiring/workspace-ui.js')
      const replacement = new Module(filename, module); replacement.filename = filename; replacement.paths = Module._nodeModulePaths(path.dirname(filename))
      replacement._compile(fs.readFileSync(options.workspaceUiSource, 'utf8'), filename); require.cache[filename] = replacement
    }
    require(path.join(root, 'pages/project-wiring/index.js'))
    currentPage = { ...definition, data: clone(definition.data), setData(patch, callback) {
      // WeChat transports setData as JSON: undefined properties are omitted.
      for (const [key, value] of Object.entries(clone(patch))) {
        const keys = key.replace(/\[(\d+)\]/g, '.$1').split('.')
        let node = this.data
        for (const part of keys.slice(0, -1)) node = node[part] ?? (node[part] = {})
        node[keys.at(-1)] = clone(value)
      }
      if (callback && deferReportCallback && Array.isArray(patch.reportImages) && patch.reportImages.length) dataCallbacks.push(callback)
      else callback?.()
    } }
    currentPage.onLoad?.(pageOptions)
    currentPage.onShow?.()
    return currentPage
  }
  async function dispatch(method, dataset = {}, detail = {}, extra = {}) {
    activate()
    if (typeof currentPage[method] !== 'function') throw Error(`Unknown page method: ${method}`)
    const event = { type: 'tap', currentTarget: { id: extra.id || '', dataset }, target: { id: extra.id || '', dataset }, detail, ...extra }
    const result = currentPage[method](event)
    if (result && typeof result.then === 'function') await result
    for (let guard = 0; drawQueue.length && guard < 1000; guard++) drawQueue.shift()?.()
    await new Promise(resolve => setTimeout(resolve, 25))
    return clone(currentPage.data)
  }
  function snapshot() { return { data: clone(currentPage?.data), storage: clone(storage), events: clone({ ...events, modals: events.modals.map(({ success, fail, ...rest }) => rest) }), schedule: clone(currentPage?._schedule), methods: Object.keys(currentPage || {}).filter(key => typeof currentPage[key] === 'function') } }
  return { wx, storage, events, activate, page, dispatch, snapshot, setSelectors(value) { selectors = value || {} },
    failReads(value) { failRead = value }, failWrites(value) { failWrite = value },
    failPreferenceReads(value) { failPreferenceRead = value }, failPreferenceWrites(value) { failPreferenceWrite = value },
    respondModal(confirm) { const modal = events.modals.at(-1); modal?.success?.({ confirm, cancel: !confirm }) },
    applyLoadFailure(error) { activate(); currentPage.applyLoadResult({ ok: false, project: null, schedule: null, error }) },
    deferReportCallbacks(value) { deferReportCallback = value },
    flushDataCallbacks() { activate(); const count = dataCallbacks.length; while (dataCallbacks.length) dataCallbacks.shift()(); return count },
    deferPhotoSaveCallbacks(value) { deferPhotoSaveCallbacks = Boolean(value) },
    completeNextPhotoSave() { activate(); const callback = photoSaveCallbacks.shift(); callback?.(); return { completed: Boolean(callback), pending: photoSaveCallbacks.length } },
    theme(value) { options.theme = value; activate(); themeListeners.forEach(listener => listener({ theme: value })) },
    resize(value) { for (const key of ['width','height','safeBottom','menuLeft','menuTop','menuBottom','statusHeight']) if (Object.hasOwn(value,key)) options[key]=value[key]; activate(); currentPage.onResize?.() } }
}

module.exports = { createRuntime, makeFixture, root, clone }
