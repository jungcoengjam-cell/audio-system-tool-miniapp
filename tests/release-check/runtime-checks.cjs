function createRuntimeChecks(context) {
  const {
    assert,
    childProcess,
    fs,
    path,
    root,
    require,
  } = context

  function checkProductLibraryLazyLoading() {
    const librarySource = fs.readFileSync(path.join(root, 'pages/products/library.js'), 'utf8')
    const productsSource = fs.readFileSync(path.join(root, 'utils/products.js'), 'utf8')
    ;['equipment', 'cameras', 'stage-lighting'].forEach((name) => {
      assert(!librarySource.includes(`../data/${name}`), `产品资料库页面仍顶层依赖 data/${name}`)
    })
    assert(!/require\(\s*[^'"`]/.test(productsSource), '产品资料 loader 使用了拼接路径的动态 require')
    const script = String.raw`
const fs = require('fs')
const path = require('path')
const Module = require('module')
const root = process.cwd()
const trackedRequests = []
const originalLoad = Module._load
Module._load = function trackProductData(request, parent, isMain) {
  if (/data\/(?:equipment|cameras|stage-lighting|speaker-specifications)|camera-fov/.test(request)) {
    trackedRequests.push(request)
  }
  return originalLoad.call(this, request, parent, isMain)
}
let definition = null
global.Page = (value) => { definition = value }
global.wx = {
  getStorageSync: () => undefined,
  setStorageSync: () => {},
}
const totalStart = process.hrtime.bigint()
const moduleStart = process.hrtime.bigint()
require('./pages/products/library.js')
const moduleMs = Number(process.hrtime.bigint() - moduleStart) / 1e6
if (!definition) throw new Error('产品资料库未注册页面')
const page = {
  ...definition,
  data: JSON.parse(JSON.stringify(definition.data)),
  setData(value, callback) {
    Object.assign(this.data, value)
    if (callback) callback()
  },
}
page.onLoad({})
const totalMs = Number(process.hrtime.bigint() - totalStart) / 1e6
if (page.data.productTotalCount !== 38) throw new Error('默认功放目录数量异常')
const defaultRequests = [...trackedRequests]
const defaultModules = Object.keys(require.cache).filter((file) => file.startsWith(root + path.sep))
const defaultSourceBytes = defaultModules.reduce((total, file) => total + fs.statSync(file).size, 0)
const forbidden = [
  '../data/stage-lighting',
  '../data/cameras',
  '../data/speaker-specifications',
  './camera-fov',
]
if (forbidden.some((item) => defaultRequests.includes(item))) throw new Error('默认功放路径加载了无关产品资料')
const expectedTypes = [
  ['speaker', 148],
  ['camera', 26],
  ['lighting', 149],
]
expectedTypes.forEach(([type, count], index) => {
  page.onTypeTap({ currentTarget: { dataset: { index: index + 1 } } })
  if (page.data.types[index + 1].count !== count || page.data.productTotalCount !== count) {
    throw new Error(type + '目录数量异常')
  }
})
console.log(JSON.stringify({
  moduleMs: Number(moduleMs.toFixed(3)),
  totalMs: Number(totalMs.toFixed(3)),
  modules: defaultModules.length,
  sourceKib: Number((defaultSourceBytes / 1024).toFixed(1)),
  defaultRequests,
  allRequests: trackedRequests,
}))
`
    const result = childProcess.spawnSync(process.execPath, ['-e', script], {
      cwd: root,
      encoding: 'utf8',
    })
    assert.strictEqual(result.status, 0, `产品资料库懒加载隔离测试失败：${result.stderr || result.stdout}`)
    const output = result.stdout.trim().split('\n').at(-1)
    const measurement = JSON.parse(output)
    assert.deepStrictEqual(measurement.defaultRequests, ['../data/equipment'],
      '默认功放路径加载了非功放资料')
    assert(measurement.allRequests.includes('../data/speaker-specifications')
      && measurement.allRequests.includes('../data/cameras')
      && measurement.allRequests.includes('./camera-fov')
      && measurement.allRequests.includes('../data/stage-lighting'),
    '切换产品类型后未按需加载对应资料')
    assert(measurement.sourceKib < 198.7, '产品资料库默认路径解析源码仍未明显低于基线')
    console.log(
      `产品资料库懒加载：module ${measurement.moduleMs} ms；total ${measurement.totalMs} ms；`
      + `${measurement.modules} modules；${measurement.sourceKib} KiB；默认功放无关资料 0。`,
    )
  }

  function checkPerformanceMeasurements() {
    const performancePath = require.resolve('../utils/performance')
    const previousWx = global.wx
    const previousConsoleInfo = console.info
    let currentTime = 100
    const logs = []
    try {
      global.wx = {
        getAccountInfoSync: () => ({ miniProgram: { envVersion: 'develop' } }),
        getPerformance: () => ({ now: () => currentTime }),
      }
      console.info = (...values) => logs.push(values)
      delete require.cache[performancePath]
      const performance = require(performancePath)
      assert.strictEqual(performance.isPerformanceMeasurementEnabled(), true)
      const finish = performance.startMeasurement('测试/测量点', { source: 'release-check' })
      currentTime = 108.26
      const entry = finish({ success: true })
      assert.strictEqual(entry.duration, 8.3)
      assert.strictEqual(entry.details.success, true)
      assert.strictEqual(finish(), null, '同一测量点被重复完成')
      const summary = performance.getPerformanceSummary('测试/')
      assert.deepStrictEqual(summary, [{
        name: '测试/测量点',
        count: 1,
        average: 8.3,
        p95: 8.3,
        maximum: 8.3,
        latest: 8.3,
      }])
      performance.printPerformanceSummary('测试/')
      assert(logs.some((values) => String(values[0]).startsWith('[PERF] 测试/测量点')))
      assert(logs.some((values) => String(values[0]).startsWith('[PERF汇总] 测试/测量点')))

      global.wx = { getAccountInfoSync: () => ({ miniProgram: { envVersion: 'release' } }) }
      delete require.cache[performancePath]
      const releasePerformance = require(performancePath)
      assert.strictEqual(releasePerformance.isPerformanceMeasurementEnabled(), false)
      assert.strictEqual(releasePerformance.startMeasurement('正式版/禁用')(), null)
    } finally {
      console.info = previousConsoleInfo
      if (previousWx === undefined) delete global.wx
      else global.wx = previousWx
      delete require.cache[performancePath]
    }
  }

  function checkAudioPagePerformanceCoverage() {
    const pages = [
      { file: 'pages/limiter/limiter.js', prefix: '限幅器/' },
      { file: 'pages/spl/spl.js', prefix: '声压级/' },
      { file: 'pages/gain-structure/gain-structure.js', prefix: '增益架构/' },
    ]
    const measurementNames = [
      '脚本加载',
      '初始化总耗时',
      '核心计算',
      'setData视图更新',
      '计算到结果更新',
      '设备搜索过滤',
      '设备搜索视图更新',
    ]

    pages.forEach(({ file, prefix }) => {
      const source = fs.readFileSync(path.join(root, file), 'utf8')
      assert(source.includes("require('../../utils/performance')"), `${file} 未接入公共性能测量工具`)
      measurementNames.forEach((name) => {
        assert(source.includes(`'${prefix}${name}'`), `${file} 缺少性能测量点：${prefix}${name}`)
      })
      assert(source.includes(`printPerformanceSummary('${prefix}')`), `${file} 离开页面时未输出性能汇总`)
    })
  }

  function checkProductLibraryPerformanceCoverage() {
    const file = 'pages/products/library.js'
    const prefix = '产品资料库/'
    const source = fs.readFileSync(path.join(root, file), 'utf8')
    const measurementNames = [
      '脚本加载',
      '初始化总耗时',
      '刷新总耗时',
      '产品筛选',
      'setData视图更新',
      '追加列表视图更新',
    ]
    assert(source.includes("require('../../utils/performance')"), `${file} 未接入公共性能测量工具`)
    measurementNames.forEach((name) => {
      assert(source.includes(`'${prefix}${name}'`), `${file} 缺少性能测量点：${prefix}${name}`)
    })
    assert(source.includes(`printPerformanceSummary('${prefix}')`), `${file} 离开页面时未输出性能汇总`)
  }

  function checkLedScreenPerformanceCoverage() {
    const file = 'pages/led-screen/led-screen.js'
    const prefix = 'LED大屏/'
    const source = fs.readFileSync(path.join(root, file), 'utf8')
    const measurementNames = [
      '脚本加载',
      '初始化总耗时',
      '核心计算',
      'setData视图更新',
      '计算到结果更新',
      '长图绘制',
      '长图导出',
    ]
    assert(source.includes("require('../../utils/performance')"), `${file} 未接入公共性能测量工具`)
    measurementNames.forEach((name) => {
      assert(source.includes(`'${prefix}${name}'`), `${file} 缺少性能测量点：${prefix}${name}`)
    })
    assert(source.includes(`printPerformanceSummary('${prefix}')`), `${file} 离开页面时未输出性能汇总`)
  }

  function checkProjectDetailPerformanceCoverage() {
    const file = 'pages/records/project.js'
    const prefix = '项目详情/'
    const source = fs.readFileSync(path.join(root, file), 'utf8')
    ;['刷新总耗时', '整理项目记录', 'setData视图更新'].forEach((name) => {
      assert(source.includes(`'${prefix}${name}'`), `${file} 缺少性能测量点：${prefix}${name}`)
    })
    assert(source.includes(`printPerformanceSummary('${prefix}')`), `${file} 离开页面时未输出性能汇总`)
  }

  function checkHapticFeedback() {
    const moduleFiles = [
      'pages/limiter/limiter.js',
      'pages/spl/spl.js',
      'pages/cable/cable.js',
      'pages/led-screen/led-screen.js',
      'pages/gain-structure/gain-structure.js',
      'pages/dmx-address/dmx-address.js',
    ]
    moduleFiles.forEach((relativePath) => {
      const source = fs.readFileSync(path.join(root, relativePath), 'utf8')
      assert(source.includes("require('../../utils/haptics')"), `${relativePath} 未使用公共震动工具`)
      assert(source.includes("vibrate('light')"), `${relativePath} 缺少轻触感反馈`)
      assert(source.includes("vibrate('medium')"), `${relativePath} 缺少完成操作触感反馈`)
    })

    const cameraSource = fs.readFileSync(path.join(root, 'pages/camera/camera.js'), 'utf8')
    const cameraProjectSource = fs.readFileSync(path.join(root, 'pages/camera/camera-project.js'), 'utf8')
    assert(cameraSource.includes("require('../../utils/haptics')"), 'pages/camera/camera.js 未使用公共震动工具')
    assert(cameraSource.includes("vibrate('light')"), 'pages/camera/camera.js 缺少轻触感反馈')
    assert(cameraSource.includes("require('./camera-project')")
      && cameraSource.includes('const cameraProjectMethods = createCameraProjectMethods()')
      && cameraSource.includes('...cameraProjectMethods'),
    '摄像机项目 helper 未挂载到页面操作')
    assert(cameraProjectSource.includes("require('../../utils/haptics')"),
      'pages/camera/camera-project.js 未使用公共震动工具')
    assert(cameraProjectSource.includes("vibrate('medium')"),
      'pages/camera/camera-project.js 缺少保存完成触感反馈')

    const previousWx = global.wx
    const vibrationTypes = []
    const { vibrate } = require('../utils/haptics')
    try {
      delete global.wx
      assert.doesNotThrow(() => vibrate('light'), '无 wx 环境时震动工具不应影响原操作')
      global.wx = { vibrateShort: ({ type }) => vibrationTypes.push(type) }
      vibrate('light')
      vibrate('medium')
      assert.deepStrictEqual(vibrationTypes, ['light', 'medium'])
    } finally {
      if (previousWx === undefined) delete global.wx
      else global.wx = previousWx
    }
  }

  function checkReportImageActions() {
    const previousWx = global.wx
    const previousGetCurrentPages = global.getCurrentPages
    const page = {}
    let previewOptions = null
    let shareOptions = null
    let saveOptions = null
    let modalOptions = null
    let settingsOpened = false
    const toastTitles = []
    const vibrationTypes = []
    try {
      global.getCurrentPages = () => [page]
      global.wx = {
        vibrateShort: ({ type }) => vibrationTypes.push(type),
        previewImage: (options) => { previewOptions = options },
        showShareImageMenu: (options) => { shareOptions = options },
        saveImageToPhotosAlbum: (options) => { saveOptions = options },
        showToast: ({ title }) => toastTitles.push(title),
        showModal: (options) => {
          modalOptions = options
          options.success({ confirm: true })
        },
        openSetting: () => { settingsOpened = true },
      }
      const actions = require('../utils/report-image-actions')
      assert.strictEqual(actions.previewGeneratedImage(''), false)
      assert.strictEqual(actions.previewGeneratedImage('temp://report.png'), true)
      assert.deepStrictEqual(previewOptions, {
        current: 'temp://report.png',
        urls: ['temp://report.png'],
      })
      assert.strictEqual(actions.shareGeneratedImage('temp://report.png'), true)
      assert.strictEqual(shareOptions.path, 'temp://report.png')
      shareOptions.fail({ errMsg: 'showShareImageMenu:fail cancel' })
      assert.deepStrictEqual(toastTitles, [])
      assert.strictEqual(actions.shareGeneratedImage('temp://report.png'), true)
      shareOptions.fail({ errMsg: 'showShareImageMenu:fail' })
      assert.deepStrictEqual(toastTitles, ['转发未完成，请重试'])
      assert.deepStrictEqual(vibrationTypes, [], '打开分享菜单或分享失败不应触发页面震动')
      assert.strictEqual(actions.saveGeneratedImage('temp://report.png'), true)
      assert.deepStrictEqual(vibrationTypes, [], '调用相册保存接口前不应提前震动')
      assert.strictEqual(saveOptions.filePath, 'temp://report.png')
      saveOptions.success()
      assert.deepStrictEqual(vibrationTypes, ['medium'], '相册保存成功后只触发一次medium')
      assert.strictEqual(actions.saveGeneratedImage('temp://failed.png'), true)
      saveOptions.fail({ errMsg: 'saveImageToPhotosAlbum:fail auth deny' })
      assert.strictEqual(modalOptions.title, '需要相册权限')
      assert.strictEqual(settingsOpened, true)
      assert.deepStrictEqual(vibrationTypes, ['medium'], '相册保存失败不应触发震动')
    } finally {
      if (previousWx === undefined) delete global.wx
      else global.wx = previousWx
      if (previousGetCurrentPages === undefined) delete global.getCurrentPages
      else global.getCurrentPages = previousGetCurrentPages
    }
  }

  return {
    checkProductLibraryLazyLoading,
    checkPerformanceMeasurements,
    checkAudioPagePerformanceCoverage,
    checkProductLibraryPerformanceCoverage,
    checkLedScreenPerformanceCoverage,
    checkProjectDetailPerformanceCoverage,
    checkHapticFeedback,
    checkReportImageActions,
  }
}

module.exports = { createRuntimeChecks }
