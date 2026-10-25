const assert = require('assert')
const childProcess = require('child_process')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const vm = require('vm')
const { evaluateDraftProtocolPackageGate } = require('./control-protocol-package-gate')

const { amplifiers, speakers } = require('../data/equipment')
const { amplifierInputStages } = require('../data/amplifier-input-stages')
const { cameras } = require('../data/cameras')
const { dmxFixtures, stageLightingProducts } = require('../data/stage-lighting')
const { knowledgeItems, findKnowledgeById } = require('../data/knowledge')
const { APP_VERSION, PRODUCT_DATA_DATE, PRODUCT_COUNTS } = require('../data/app-meta')
const { speakerSpecifications } = require('../data/speaker-specifications')
const { calculateConstantVoltageCable, calculateProfessionalSpeakerCable } = require('../utils/cable')
const {
  calculateCoverage,
  calculateGroundAreaPlacement,
  calculateHorizontalOnlyPlacement,
  calculateVerticalPlanePlacement,
  getCameraMountLabel,
  getCameraMountType,
  getCalculableCameraViews,
  getHorizontalCameraViews,
  resolveCustomFov,
  resolveLibraryFov,
  resolveLibraryOptics,
} = require('../utils/camera-fov')
const { calculateLimiter } = require('../utils/limiter')
const { calculateDmxAddressPlan } = require('../utils/dmx-address')
const {
  buildCatalogCategories,
  buildCatalogOptions,
  filterCatalogItems,
  findCatalogModelIndex,
} = require('../utils/catalog-selector')
const { calculateGainStructure } = require('../utils/gain-structure')
const { calculateLedScreenPlan } = require('../utils/led-screen')
const { calculateSpeakerSpl } = require('../utils/spl')
const {
  RECENT_STORAGE_KEY,
  buildProductComparison,
  filterProducts,
  getCategories,
  getProductDetail,
  getProductFilters,
  getProductList,
  getRecentProducts,
} = require('../utils/products')
const recordsApi = require('../utils/records')

const root = path.resolve(__dirname, '..')
function expandWxmlIncludes(relativePath, includeStack = []) {
  const file = path.resolve(root, relativePath)
  const normalizedPath = path.relative(root, file).replace(/\\/g, '/')
  assert(!includeStack.includes(normalizedPath), `WXML include 循环：${normalizedPath}`)
  const wxml = fs.readFileSync(file, 'utf8')
  return wxml.replace(/<include\s+src="([^"]+)"\s*\/>/g, (includeTag, source) => {
    const includedFile = path.resolve(path.dirname(file), source)
    assert(includedFile === root || includedFile.startsWith(`${root}${path.sep}`),
      `WXML include 越出工作区：${source}`)
    const includedRelativePath = path.relative(root, includedFile).replace(/\\/g, '/')
    return expandWxmlIncludes(includedRelativePath, [...includeStack, normalizedPath])
  })
}

const themeAliasMap = {
  '--theme-text': '--tx',
  '--theme-text-secondary': '--ts',
  '--theme-text-tertiary': '--tt',
  '--theme-control': '--tc',
  '--theme-surface': '--tv',
  '--theme-surface-muted': '--tmm',
  '--theme-accent-text': '--ta',
  '--theme-accent-soft': '--as',
  '--theme-divider': '--td',
  '--theme-warning': '--tw',
  '--theme-warning-soft': '--tws',
  '--theme-success': '--ty',
  '--theme-shadow': '--th',
  '--theme-primary-fill': '--tp',
  '--theme-danger': '--tg',
}
const assertFinalThemeDeclaration = (source, selector, declaration, message, forbidden = []) => {
  const normalized = source.replace(/\s+/g, '')
  const selectorText = selector.replace(/\s+/g, '')
  const declarationText = declaration.replace(/\s+/g, '')
  const property = declarationText.split(':', 1)[0] + ':'
  const blocks = [...normalized.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((match) => match[1].split(',').some((part) => part === selectorText) && match[2].includes(property))
  assert(blocks.length > 0, message)
  const last = blocks[blocks.length - 1]
  const declarationVariants = [declarationText]
  Object.entries(themeAliasMap).forEach(([longName, shortName]) => {
    if (declarationText.includes(longName)) declarationVariants.push(declarationText.replace(longName, shortName))
  })
  assert(declarationVariants.some((value) => last[2].includes(value)), message)
  forbidden.forEach((value) => assert(!last[2].includes(value.replace(/\s+/g, '')), `${selector} 后置覆盖了禁止样式 ${value}`))
}
// Scoped cascade check for frozen theme selectors. This is deliberately limited:
// it compares same-property rules that contain the target classes, and does not
// claim to implement the full CSS selector matcher.
const assertThemeCascade = (source, selector, declaration, message, { darkOnly = true } = {}) => {
  const normalized = source.replace(/\/\*[\s\S]*?\*\//g, '')
  let scoped = normalized
  if (darkOnly) {
    const blocks = []
    const markerPattern = /@media\s*\(prefers-color-scheme:\s*dark\)/g
    let marker
    while ((marker = markerPattern.exec(normalized))) {
      const open = normalized.indexOf('{', marker.index)
      let depth = 0
      let close = -1
      for (let i = open; i < normalized.length; i += 1) {
        if (normalized[i] === '{') depth += 1
        else if (normalized[i] === '}' && --depth === 0) { close = i; break }
      }
      assert(close > open, `${message}: 深色媒体块结构异常`)
      blocks.push(normalized.slice(open + 1, close))
      markerPattern.lastIndex = close + 1
    }
    assert(blocks.length > 0, `${message}: 缺少深色媒体块`)
    scoped = blocks.join('}')
  }
  const property = declaration.split(':', 1)[0].trim().toLowerCase()
  const expected = declaration.replace(/\s+/g, '').toLowerCase()
  const expectedVariants = [expected]
  Object.entries(themeAliasMap).forEach(([longName, shortName]) => {
    if (expected.includes(longName)) expectedVariants.push(expected.replace(longName, shortName))
  })
  const targetClasses = [...selector.matchAll(/\.[A-Za-z0-9_-]+/g)].map((match) => match[0].toLowerCase())
  const specificity = (part) => [
    (part.match(/#[A-Za-z0-9_-]+/g) || []).length,
    (part.match(/\.[A-Za-z0-9_-]+|\[[^\]]+\]|:(?!:)[A-Za-z0-9_-]+/g) || []).length,
    (part.match(/(?:^|[\s>+~,(])(?:page|[A-Za-z][A-Za-z0-9_-]*)/g) || []).length,
  ]
  const compareSpecificity = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]
  const candidates = []
  for (const match of scoped.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const blockProperty = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, 'i').exec(match[2])
    if (!blockProperty) continue
    for (const part of match[1].split(',')) {
      const partClasses = [...part.matchAll(/\.[A-Za-z0-9_-]+/g)].map((item) => item[0].toLowerCase())
      if (!targetClasses.every((className) => partClasses.includes(className))) continue
      candidates.push({ value: `${property}:${blockProperty[1]}`.replace(/\s+/g, '').toLowerCase(), specificity: specificity(part), order: candidates.length })
    }
  }
  if (!candidates.length && targetClasses.length > 1) {
    const leafClass = targetClasses[targetClasses.length - 1]
    for (const match of scoped.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const blockProperty = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, 'i').exec(match[2])
      if (!blockProperty) continue
      for (const part of match[1].split(',')) {
        const partClasses = [...part.matchAll(/\.[A-Za-z0-9_-]+/g)].map((item) => item[0].toLowerCase())
        if (partClasses.length !== 1 || partClasses[0] !== leafClass) continue
        candidates.push({ value: `${property}:${blockProperty[1]}`.replace(/\s+/g, '').toLowerCase(), specificity: specificity(part), order: candidates.length })
      }
    }
  }
  assert(candidates.length > 0, `${message}: 缺少真实深色规则 ${selector}`)
  const winner = candidates.reduce((best, candidate) => {
    if (!best) return candidate
    const comparison = compareSpecificity(candidate.specificity, best.specificity)
    return comparison > 0 || (comparison === 0 && candidate.order > best.order) ? candidate : best
  }, null)
  assert(expectedVariants.some((value) => winner.value.includes(value)), `${message}: ${selector} 存在后置或更高优先级硬编码覆盖 ${winner.value}`)
}
const cascadeFixture = '@media (prefers-color-scheme: dark){.side-angle-label{background:var(--as)}page .side-angle-label.side-angle-label{background:#fff}}'
assert.throws(() => assertThemeCascade(cascadeFixture, '.side-angle-label', 'background:var(--theme-accent-soft)', '主题级联后置覆盖自测', { darkOnly: true }), /后置或更高优先级硬编码覆盖/)
const recordsCascadeFixture = '@media (prefers-color-scheme: dark){.interior-project-notes-label{color:var(--ts)}page .interior-project-notes-label{color:#86868b}}'
assert.throws(() => assertThemeCascade(recordsCascadeFixture, '.interior-project-notes-label', 'color:var(--theme-text-secondary)', '记录备注级联后置覆盖自测', { darkOnly: true }), /后置或更高优先级硬编码覆盖/)
// This is intentionally scoped to the dark media block and to the target class tokens.
// It is a bright-tail guard, not a general CSS cascade parser.
const assertDarkNoBrightTail = (source, entries, message) => {
  const normalized = source.replace(/\s+/g, '')
  const darkIndex = normalized.search(/@media\(prefers-color-scheme:dark\)/)
  assert(darkIndex >= 0, `${message}: 缺少深色媒体块`)
  const darkSource = normalized.slice(darkIndex)
  const blocks = [...darkSource.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  entries.forEach(({ selector, forbidden }) => {
    const classes = [...selector.matchAll(/\.[A-Za-z0-9_-]+/g)].map((match) => match[0])
    const matched = blocks.filter((match) => classes.every((className) => match[1].includes(className)))
    assert(matched.length > 0, `${message}: 缺少真实选择器 ${selector}`)
    matched.forEach((match) => {
      forbidden.forEach((value) => {
        assert(!match[2].includes(value.replace(/\s+/g, '')), `${message}: ${selector} 深色规则出现亮色 ${value}`)
      })
    })
  })
}
const brightTailFixture = '@media (prefers-color-scheme: dark){.target{background:var(--theme-control)}page .target.target{background:#fff}}'
assert.throws(() => assertDarkNoBrightTail(brightTailFixture, [{ selector: '.target', forbidden: ['background:#fff'] }], '亮色尾部自测'), /出现亮色/)
const LENGTH_PROPERTIES = new Set([
  'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'gap', 'row-gap', 'column-gap', 'width', 'height', 'min-width', 'max-width',
  'min-height', 'max-height', 'top', 'right', 'bottom', 'left', 'inset',
  'border-radius', 'border-width', 'border-top-width', 'border-right-width',
  'border-bottom-width', 'border-left-width', 'font-size', 'letter-spacing',
  'text-indent', 'box-shadow',
])
const findBareLengthNumbers = (source, file = '<fixture>') => {
  const violations = []
  const declarationPattern = /(?:^|[;{])\s*([a-z-]+)\s*:\s*([^;{}]+)/gi
  const numberPattern = /(?<![\w.#-])-?(?:\d+(?:\.\d+)?|\.\d+)(?![\dA-Za-z%.])/g
  for (const match of source.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(declarationPattern)) {
    const property = match[1].toLowerCase()
    if (!LENGTH_PROPERTIES.has(property)) continue
    let value = match[2]
    if (property === 'box-shadow') value = value.replace(/(?:rgba?|hsla?)\([^)]*\)/gi, '')
    for (const number of value.matchAll(numberPattern)) {
      const token = number[0]
      if (Number(token) === 0) continue
      const before = value.slice(0, number.index).trimEnd()
      if (before.endsWith('/')) continue
      violations.push({ file, property, value: match[2].trim(), token })
    }
  }
  return violations
}
const bareLengthFixture = '.x{padding:12;line-height:1.2;opacity:1;width:calc(100% / 2);font-weight:600;z-index:2}'
assert.strictEqual(findBareLengthNumbers(bareLengthFixture).length, 1, '长度单位扫描器未正确区分合法无单位属性')
const bareLengthViolations = []
const walkWxss = (directory) => {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) walkWxss(absolute)
    else if (entry.name.endsWith('.wxss')) bareLengthViolations.push(...findBareLengthNumbers(fs.readFileSync(absolute, 'utf8'), absolute))
  }
}
walkWxss(root)
assert.strictEqual(bareLengthViolations.length, 0, `WXSS 存在非零长度裸数字: ${JSON.stringify(bareLengthViolations.slice(0, 5))}`)
const PACKAGE_BUDGETS = Object.freeze({
  total: 5120 * 1024,
  // Source-only ceiling; the compiled WeChat package still needs a DevTools size check.
  mainTotal: 2460 * 1024,
  mainJavaScript: 1536 * 1024,
  subPackageJavaScript: 352 * 1024,
  '.wxss': 576 * 1024,
  '.wxml': 368 * 1024,
  media: 1680 * 1024,
  singleJavaScript: 160 * 1024,
})
const EXPECTED_APP_PAGES = Object.freeze([
  'pages/index/index',
  'pages/tools/tools',
  'pages/projects/projects',
  'pages/settings/settings',
  'pages/basis/detail',
  'pages/projects/favorite-detail',
  'pages/projects/recovery',
  'pages/records/report',
  'pages/limiter/limiter',
  'pages/spl/spl',
  'pages/cable/cable',
  'pages/audio-wiring/index',
  'pages/audio-wiring/report-bridge',
  'pages/camera/camera',
  'pages/led-screen/led-screen',
  'pages/gain-structure/gain-structure',
  'pages/dmx-address/dmx-address',
  'pages/dmx-address/channel-guide',
  'pages/dmx-layout/dmx-layout',
  'pages/products/library',
  'pages/products/detail',
  'pages/records/project',
  'pages/project-wiring/index',
  'pages/project-wiring/report-bridge',
  'pages/knowledge/detail',
  'pages/troubleshoot/index',
  'pages/control-protocol/index',
  'pages/control-protocol/detail',
])

function getRegisteredPagePaths(appConfig) {
  const subPackagePages = (appConfig.subPackages || []).flatMap((subPackage) => (
    (subPackage.pages || []).map((pagePath) => `${subPackage.root}/${pagePath}`)
  ))
  return [...(appConfig.pages || []), ...subPackagePages]
}

function getPackageGroups(packageFiles, appConfig) {
  const subPackages = appConfig.subPackages || []
  const definitions = [
    { name: '主包', root: '' },
    ...subPackages.map((subPackage) => ({ name: `分包 ${subPackage.root}`, root: subPackage.root })),
  ]
  return definitions.map((definition) => ({
    ...definition,
    files: packageFiles.filter((file) => {
      const relativePath = normalizeRelativePath(file)
      return definition.root
        ? relativePath === definition.root || relativePath.startsWith(`${definition.root}/`)
        : !subPackages.some((subPackage) => (
          relativePath === subPackage.root || relativePath.startsWith(`${subPackage.root}/`)
        ))
    }),
  }))
}

function findSubPackageRequires(files, subPackageRoots) {
  const matches = []
  files.filter((file) => path.extname(file).toLowerCase() === '.js').forEach((file) => {
    const source = fs.readFileSync(file, 'utf8')
    const requirePattern = /require\(\s*['"]([^'"]+)['"]\s*\)/g
    let match
    while ((match = requirePattern.exec(source))) {
      const request = match[1]
      const resolved = request.startsWith('.')
        ? normalizeRelativePath(path.resolve(path.dirname(file), request))
        : request.replace(/\\/g, '/')
      if (subPackageRoots.some((rootPath) => (
        resolved === rootPath || resolved.startsWith(`${rootPath}/`)
      ))) {
        matches.push({ file: normalizeRelativePath(file), request })
      }
    }
  })
  return matches
}
const SENSITIVE_WECHAT_APIS = Object.freeze([
  {
    category: '网络请求',
    apis: ['request', 'uploadFile', 'downloadFile', 'connectSocket'],
  },
  {
    category: '登录与用户身份',
    apis: ['login', 'getUserProfile', 'getUserInfo', 'getWeRunData'],
  },
  {
    category: '位置',
    apis: [
      'getLocation',
      'getFuzzyLocation',
      'chooseLocation',
      'openLocation',
      'startLocationUpdate',
      'startLocationUpdateBackground',
      'onLocationChange',
    ],
  },
  {
    category: '麦克风',
    apis: ['getRecorderManager', 'startRecord', 'stopRecord', 'joinVoIPChat'],
  },
  {
    category: '摄像头与采集',
    apis: ['createCameraContext', 'chooseMedia', 'chooseImage', 'scanCode'],
  },
])

function findByModel(items, model) {
  const item = items.find((entry) => entry.model === model)
  assert(item, `缺少产品型号：${model}`)
  return item
}

function checkCatalogSelector() {
  const options = buildCatalogOptions([
    { model: 'TC-2350B', sensitivityDb: 91 },
    { model: 'TS-803C', sensitivityDb: 95 },
    { model: 'TC-2500B', sensitivityDb: 92 },
  ], (item) => ({ sensitivityDb: item.sensitivityDb }))
  const categories = buildCatalogCategories(options)

  assert.deepStrictEqual(categories.map((item) => item.label), ['全部', 'TC系列', 'TS系列'])
  assert.deepStrictEqual(filterCatalogItems(options, categories, '2350', 0).map((item) => item.model), ['TC-2350B'])
  assert.deepStrictEqual(filterCatalogItems(options, categories, '', 1).map((item) => item.model), ['TC-2350B', 'TC-2500B'])
  assert.strictEqual(findCatalogModelIndex(options, 'TS-803C'), 1)
  assert.strictEqual(findCatalogModelIndex(options, 'missing', 2), 2)
  assert.strictEqual(options[1].sensitivityDb, 95)
}

function assertUnique(items, getKey, label) {
  const keys = items.map(getKey)
  assert.strictEqual(new Set(keys).size, keys.length, `${label}存在重复项`)
}

function collectJavaScriptFiles(directory, result = []) {
  fs.readdirSync(directory, { withFileTypes: true }).forEach((entry) => {
    if (entry.name === '.git') return
    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory()) collectJavaScriptFiles(fullPath, result)
    else if (entry.name.endsWith('.js')) result.push(fullPath)
  })
  return result
}

function collectMediaFiles(directory, result = []) {
  fs.readdirSync(directory, { withFileTypes: true }).forEach((entry) => {
    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory()) collectMediaFiles(fullPath, result)
    else if (/\.(png|jpe?g|gif|bmp|webp|mp3|wav|aac|m4a)$/i.test(entry.name)) result.push(fullPath)
  })
  return result
}

function collectFiles(directory, result = []) {
  fs.readdirSync(directory, { withFileTypes: true }).forEach((entry) => {
    if (entry.name === '.git') return
    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory()) collectFiles(fullPath, result)
    else result.push(fullPath)
  })
  return result
}

function normalizeRelativePath(file) {
  return path.relative(root, file).replace(/\\/g, '/')
}

function isPackageIgnored(relativePath, ignoreRules) {
  return ignoreRules.some((item) => (
    item.type === 'folder'
      ? relativePath === item.value || relativePath.startsWith(`${item.value}/`)
      : relativePath === item.value
  ))
}

function getEffectivePackageFiles(projectConfig) {
  const ignoreRules = projectConfig.packOptions?.ignore || []
  return collectFiles(root).filter((file) => !isPackageIgnored(normalizeRelativePath(file), ignoreRules))
}

function formatKiB(bytes) {
  return `${(bytes / 1024).toFixed(1)} KiB`
}

function findSensitiveApiCalls(files) {
  const matches = []
  files.filter((file) => path.extname(file).toLowerCase() === '.js').forEach((file) => {
    const source = fs.readFileSync(file, 'utf8')
    SENSITIVE_WECHAT_APIS.forEach(({ category, apis }) => {
      apis.forEach((api) => {
        const pattern = new RegExp(
          `\\bwx\\s*(?:\\?\\.\\s*${api}\\b|\\.\\s*${api}\\b|\\[\\s*['\"]${api}['\"]\\s*\\])\\s*\\(`,
          'g',
        )
        let match
        while ((match = pattern.exec(source))) {
          matches.push({
            api: `wx.${api}`,
            category,
            file: normalizeRelativePath(file),
            line: source.slice(0, match.index).split(/\r?\n/).length,
          })
        }
      })
    })
  })
  return matches
}

function checkReleasePackageGates() {
  const projectConfig = JSON.parse(fs.readFileSync(path.join(root, 'project.config.json'), 'utf8'))
  const appConfig = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'))
  assert.strictEqual(appConfig.darkmode, true, 'app.json 未开启系统深色模式')
  assert.strictEqual(appConfig.themeLocation, 'theme.json', 'app.json 未配置主题文件')
  const themeConfig = JSON.parse(fs.readFileSync(path.join(root, 'theme.json'), 'utf8'))
  const themeKeys = ['navBgColor', 'navTextColor', 'bgTextStyle', 'pageBgColor', 'tabBgColor', 'tabTextColor', 'tabSelectedColor', 'tabBorderColor', 'exploreIcon', 'exploreSelectedIcon', 'toolsIcon', 'toolsSelectedIcon', 'projectsIcon', 'projectsSelectedIcon']
  for (const mode of ['light', 'dark']) {
    assert(themeConfig[mode] && themeKeys.every((key) => themeConfig[mode][key]), `theme.json 缺少 ${mode} 主题键`)
  }
  assert.strictEqual(themeConfig.light.pageBgColor, '#f2f2f7')
  assert.strictEqual(themeConfig.dark.pageBgColor, '#000000')
  assert.strictEqual(themeConfig.light.bgTextStyle, 'dark')
  assert.strictEqual(themeConfig.dark.bgTextStyle, 'light')
  assert.strictEqual(themeConfig.light.navTextColor, 'black')
  assert.strictEqual(themeConfig.dark.navTextColor, 'white')
  assert.strictEqual(themeConfig.light.tabTextColor, '#636366')
  assert.strictEqual(themeConfig.light.tabSelectedColor, '#0066cc')
  assert.strictEqual(themeConfig.dark.tabTextColor, '#aeaeb2')
  assert.strictEqual(themeConfig.dark.tabSelectedColor, '#0a84ff')
  const appWxss = fs.readFileSync(path.join(root, 'app.wxss'), 'utf8')
  assert(/--theme-accent-text:\s*#005eb8/.test(appWxss) && /--theme-primary-fill:\s*#0066cc/.test(appWxss),
    '浅色主题缺少增强文字色或主按钮填充色')
  const appDarkCss = appWxss.slice(appWxss.indexOf('@media (prefers-color-scheme: dark)'))
  assert(/--theme-accent-text:\s*#8ac8ff/.test(appDarkCss) && /--theme-primary-fill:\s*#0066cc/.test(appDarkCss),
    '深色主题缺少增强文字色或主按钮填充色')
  assert(/--theme-text-secondary:\s*#5f5f64/.test(appWxss) && /--theme-text-tertiary:\s*#6e6e73/.test(appWxss),
    '浅色主题辅助文字色对比度未达标')
  assert(/--theme-success:\s*#1f744c/.test(appWxss), '浅色成功状态色对比度未达标')
  const secondThemePages = [
    'pages/limiter/limiter.wxss', 'pages/spl/spl.wxss', 'pages/cable/cable.wxss',
    'pages/camera/camera.wxss', 'pages/led-screen/led-screen.wxss',
    'pages/gain-structure/gain-structure.wxss', 'pages/products/library.wxss',
    'pages/products/detail.wxss', 'pages/knowledge/detail.wxss',
    'pages/dmx-address/dmx-address.wxss', 'pages/dmx-address/channel-guide.wxss',
    'pages/control-protocol/index.wxss', 'pages/control-protocol/detail.wxss',
  ]
  secondThemePages.forEach((file) => {
    const source = fs.readFileSync(path.join(root, file), 'utf8')
    const darkStart = Math.min(...[source.indexOf('@media (prefers-color-scheme: dark)'), source.indexOf('@media (prefers-color-scheme:dark)')].filter((index) => index >= 0))
    const darkCss = darkStart >= 0 ? source.slice(darkStart) : ''
    const hasDarkThemeToken = file === 'pages/gain-structure/gain-structure.wxss'
      ? darkCss.includes('var(--theme-control)') && darkCss.includes('var(--theme-success)')
      : file === 'pages/dmx-address/dmx-address.wxss'
        ? /--text:\s*#fff\b/.test(darkCss) && /--control:\s*#1c1c1e\b/.test(darkCss)
      : darkCss.includes('var(--theme-text)') || darkCss.includes('var(--tx)')
    assert(source.startsWith('@import "../../styles/theme-page-shared.wxss"') && (source.match(/@import "\.\.\/\.\.\/styles\/theme-page-shared\.wxss"/g) || []).length === 1 && (file === 'pages/knowledge/detail.wxss' || hasDarkThemeToken),
      `${file} 未接入第二批深色主题规则`)
    if (file === 'pages/knowledge/detail.wxss') {
      assert(/\.article-lead\{[^}]*color:var\(--ts\)[^}]*font-size:30rpx/.test(source) && /\.article-section\{[^}]*border-top:1rpx solid var\(--td\)/.test(source),
        `${file} 正文未使用主题辅助文字色或章节分隔线`)
    }
  })
  const darkRequiredByPage = {
    'pages/limiter/limiter.wxss': ['.field-control', '.output-status-invalid'],
    'pages/spl/spl.wxss': ['.settings-card .speaker-field .equipment-value', '.settings-card .speaker-field .equipment-model'],
    'pages/cable/cable.wxss': ['.mode-tab.mode-tab-active .mode-label', '.cable-spec'],
    'pages/camera/camera.wxss': ['.selector-model.selector-model'],
    'pages/gain-structure/gain-structure.wxss': ['.result-card', '.status-chip', '.sheet-panel', '.project-row-selected'],
    'pages/led-screen/led-screen.wxss': [],
    'pages/products/library.wxss': [],
    'pages/products/detail.wxss': [],
    'pages/dmx-address/dmx-address.wxss': ['.address-chip', '.fixture-control-box', '.quantity-box input', '.fixture-name'],
    'pages/dmx-address/channel-guide.wxss': ['.product-name.product-name', '.mode.mode-active'],
  }
  const darkCssFromFirstMedia = (source) => {
    const starts = [source.indexOf('@media (prefers-color-scheme: dark)'), source.indexOf('@media (prefers-color-scheme:dark)')].filter((index) => index >= 0)
    return source.slice(Math.min(...starts)).replace(/\s+/g, '')
  }
  const assertDarkDeclaration = (source, selector, declaration, message) => {
    const darkCss = darkCssFromFirstMedia(source)
    const selectorText = selector.replace(/\s+/g, '')
    const declarationText = declaration.replace(/\s+/g, '')
    let selectorIndex = darkCss.indexOf(selectorText)
    let matched = false
    while (selectorIndex >= 0) {
      const blockStart = darkCss.indexOf('{', selectorIndex)
      const blockEnd = darkCss.indexOf('}', blockStart)
      const body = blockStart >= 0 && blockEnd > blockStart ? darkCss.slice(blockStart + 1, blockEnd) : ''
      const declarationVariants = [declarationText]
      Object.entries(themeAliasMap).forEach(([longName, shortName]) => {
        if (declarationText.includes(longName)) declarationVariants.push(declarationText.replace(longName, shortName))
      })
      if (declarationVariants.some((value) => body.includes(value))) {
        matched = true
        break
      }
      selectorIndex = darkCss.indexOf(selectorText, selectorIndex + selectorText.length)
    }
    assert(matched, message)
  }
  Object.entries(darkRequiredByPage).forEach(([file, selectors]) => {
    const source = fs.readFileSync(path.join(root, file), 'utf8')
    const darkStart = Math.min(...[source.indexOf('@media (prefers-color-scheme: dark)'), source.indexOf('@media (prefers-color-scheme:dark)')].filter((index) => index >= 0))
    const darkCss = source.slice(darkStart)
    selectors.forEach((selector) => assert(darkCss.includes(selector), `${file} dark 规则缺少真实选择器 ${selector}`))
  })
  const wxssFiles = []
  const collectWxss = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
    if (entry.name === 'tmp') return
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) collectWxss(full)
    else if (entry.isFile() && entry.name.endsWith('.wxss')) wxssFiles.push(full)
  })
  // Archived verification snapshots are outside the production page source set.
  collectWxss(path.join(root, 'pages'))
  const sharedImportFiles = wxssFiles.filter((file) => fs.readFileSync(file, 'utf8').includes('@import "../../styles/theme-page-shared.wxss"'))
  const expectedSharedThemePages = secondThemePages.concat('pages/audio-wiring/index.wxss', 'pages/project-wiring/index.wxss', 'pages/records/report.wxss')
  assert.strictEqual(sharedImportFiles.length, expectedSharedThemePages.length, '共享主题导入集合必须严格等于第二批页面与布线分包页面')
  assert(expectedSharedThemePages.every((file) => sharedImportFiles.includes(path.join(root, file))), '共享主题导入集合与预期页面不一致')
  const secondThemeRoots = {
    'pages/limiter/limiter.wxss': '.page-root, .page-scroll',
    'pages/spl/spl.wxss': '.page-root, .page-scroll',
    'pages/cable/cable.wxss': '.page-root, .page-scroll',
    'pages/camera/camera.wxss': '.page-root, .page-scroll',
    'pages/led-screen/led-screen.wxss': '.page-root, .page-scroll',
    'pages/gain-structure/gain-structure.wxss': '.page-root',
    'pages/products/library.wxss': '.page-scroll',
    'pages/products/detail.wxss': '.page-scroll',
    'pages/knowledge/detail.wxss': '.knowledge-scroll',
    'pages/dmx-address/dmx-address.wxss': '.page-root',
    'pages/dmx-address/channel-guide.wxss': '.page',
  }
  Object.entries(secondThemeRoots).forEach(([file, rootSelector]) => {
    const source = fs.readFileSync(path.join(root, file), 'utf8')
    assert(source.replace(/\s+/g, '').includes(rootSelector.replace(/\s+/g, '')), `${file} 缺少真实页面根类覆盖`)
  })
  const recordsTheme = fs.readFileSync(path.join(root, 'pages/records/project.wxss'), 'utf8')
  const recordsWxmlTheme = fs.readFileSync(path.join(root, 'pages/records/project.wxml'), 'utf8')
  const projectHomeImport = '@import "../../styles/homepage.wxss"'
  const projectDarkStart = Math.min(...[recordsTheme.indexOf('@media (prefers-color-scheme: dark)'), recordsTheme.indexOf('@media (prefers-color-scheme:dark)')].filter((index) => index >= 0))
  const projectDarkCss = recordsTheme.slice(projectDarkStart)
  const appThemeForProject = fs.readFileSync(path.join(root, 'app.wxss'), 'utf8')
  const appDarkStartForProject = appThemeForProject.indexOf('@media (prefers-color-scheme: dark)')
  const appDarkThemeForProject = appThemeForProject.slice(appDarkStartForProject)
  assert(recordsTheme.startsWith(`${projectHomeImport};`)
    && (recordsTheme.match(/@import "\.\.\/\.\.\/styles\/homepage\.wxss"/g) || []).length === 1
    && /\.interior-root\{[^}]*background:var\(--theme-page-bg\)[^}]*color:var\(--theme-text\)/.test(recordsTheme)
    && projectDarkCss.includes('.interior-root,.interior-scroll,.interior-content{background:#000}')
    && projectDarkCss.includes('background:var(--theme-surface)')
    && projectDarkCss.includes('background:var(--theme-control)')
    && /--theme-page-bg:\s*#000/.test(appDarkThemeForProject)
    && /--theme-surface:\s*#1c1c1e/.test(appDarkThemeForProject)
    && /--theme-control:\s*#2c2c2e/.test(appDarkThemeForProject)
    && /--theme-text:\s*#fff/.test(appDarkThemeForProject),
  '项目内部页需使用首页共享样式与有效的全局深色主题变量')
  assert(/\.interior-filter-row \.home-chip-active\{[^}]*background:var\(--theme-primary-fill\)[^}]*color:#fff/.test(projectDarkCss),
    '项目内部页深色筛选选中项需保持蓝底白字')
  assert(/\.interior-menu-button\{[^}]*width:44px[^}]*max-width:44px[^}]*flex:0 0 44px/.test(recordsTheme)
    && /\.interior-report-button\{[^}]*width:100%;[^}]*max-width:none;[^}]*flex:1 1 100%/.test(recordsTheme),
  '项目管理和报告按钮需保持可控原生触区宽度')
  assert(recordsTheme.includes('.interior-root{height:100vh;background:var(--theme-page-bg);color:var(--theme-text)}')
    && recordsTheme.includes('.interior-item{') && recordsTheme.includes('background:var(--theme-surface)')
    && recordsWxmlTheme.includes('class="interior-project-title"')
    && recordsWxmlTheme.includes('class="interior-report-button" disabled="{{workspaceError}}" bindtap="openProjectReport"')
    && recordsWxmlTheme.includes('class="interior-search-input"')
    && recordsWxmlTheme.includes('class="interior-item'),
  '项目内部页需使用首页共享样式、全局主题变量及当前真实结构')
  assert(!recordsWxmlTheme.includes('interior-add-button') && !recordsWxmlTheme.includes('interior-bottom-bar'),
    '项目详情不再显示添加内容固定底栏')
  const dmxTheme = fs.readFileSync(path.join(root, 'pages/dmx-address/dmx-address.wxss'), 'utf8')
  const channelGuideTheme = fs.readFileSync(path.join(root, 'pages/dmx-address/channel-guide.wxss'), 'utf8')
  const sharedTheme = fs.readFileSync(path.join(root, 'styles/theme-page-shared.wxss'), 'utf8')
  ;['.fixture-search-sheet', '.fixture-channel-guide-sheet', '.floating-card', '.pending-sheet', '.save-project-sheet', '.result-report-preview-sheet']
    .forEach((selector) => assert(dmxTheme.includes(selector), `DMX 页面缺少真实弹层覆盖：${selector}`))
  assert(sharedTheme.includes('.picker-value.picker-value') && sharedTheme.includes('.selector-model.selector-model') && sharedTheme.includes('.metric.metric') &&
    sharedTheme.includes('.selector-search.selector-search') && sharedTheme.includes('.input-shell.input-shell') &&
    sharedTheme.includes('.status-chip.status-chip-good'), '共享主题缺少明确控件与成功态覆盖')
  assert(fs.readFileSync(path.join(root, 'pages/dmx-address/channel-guide.wxss'), 'utf8').includes('.range text:first-child') &&
    recordsWxmlTheme.includes('interior-report-button') && dmxTheme.includes('.fixture-search-box input'),
  '第二批页面内部控件深色覆盖不完整')
  const recordsDarkStart = Math.min(...[recordsTheme.indexOf('@media (prefers-color-scheme: dark)'), recordsTheme.indexOf('@media (prefers-color-scheme:dark)')].filter((index) => index >= 0))
  const dmxDarkStart = Math.min(...[dmxTheme.indexOf('@media (prefers-color-scheme: dark)'), dmxTheme.indexOf('@media (prefers-color-scheme:dark)')].filter((index) => index >= 0))
  const hasRecordThemeClasses = [...recordsWxmlTheme.matchAll(/<view\b([^>]*)>/g)].some((match) => {
    const classAttribute = /\bclass="([^"]+)"/.exec(match[1])
    const classes = classAttribute ? classAttribute[1].split(/\s+/) : []
    return classes.includes('interior-item') && classes.includes('interior-record-item')
  })
  assert(recordsTheme.slice(recordsDarkStart).includes('.interior-project-title') &&
    recordsTheme.slice(recordsDarkStart).includes('background:var(--theme-control)') &&
    recordsTheme.slice(recordsDarkStart).includes('background:var(--theme-surface)') &&
    hasRecordThemeClasses &&
    dmxTheme.includes('.fixture-search-row-selected{background:var(--control)') &&
    dmxTheme.includes('.fixture-result-model{color:var(--text)') && dmxTheme.includes('.fixture-channel-guide-detail-ranges') &&
    dmxTheme.slice(dmxDarkStart).includes('.address-chip{background:var(--group-tint)'), '深色主题内部真实结构覆盖不完整')
  assert(sharedTheme.includes('page .field-label.field-label') && sharedTheme.includes('page .input-wrap.input-wrap') && sharedTheme.includes('input::placeholder') && sharedTheme.includes('.selector-panel') && sharedTheme.includes('button[disabled]'),
    '第二批共享主题规则未覆盖输入、占位符、选择器和禁用态')
  const guideDarkStart = Math.min(...[channelGuideTheme.indexOf('@media (prefers-color-scheme: dark)'), channelGuideTheme.indexOf('@media (prefers-color-scheme:dark)')].filter((index) => index >= 0))
  const guideDark = channelGuideTheme.slice(guideDarkStart)
  assert(guideDark.includes('.mode.mode-active') && !/\.product-name\.product-name[^}]*background\s*:\s*var\(--theme-accent-soft\)/.test(guideDark), '通道页非激活文字规则不得携带激活背景')
  assertDarkDeclaration(dmxTheme, '.page-root', 'background:#000', 'DMX 深色页面根背景应为预览图纯黑色')
  assertDarkDeclaration(dmxTheme, '.page-root', '--surface:#111', 'DMX 深色弹层缺少表面背景变量')
  assertDarkDeclaration(dmxTheme, '.page-root', '--control:#1c1c1e', 'DMX 深色输入缺少控件背景变量')
  assertDarkDeclaration(dmxTheme, '.page-root', '--text:#fff', 'DMX 深色主文字缺少白色变量')
  assertDarkDeclaration(dmxTheme, '.quantity-box input', 'color:#fff', 'DMX 数量输入缺少深色可读文字')
  const dmxBaseCss = dmxTheme.slice(0, dmxDarkStart)
  const dmxBaseDeclarations = (selector) => [...dmxBaseCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((match) => match[1].split(',').map((value) => value.trim()).includes(selector))
    .map((match) => match[2].replace(/\s+/g, '')).join(';')
  assert(dmxBaseDeclarations('.page-scroll').includes('background:var(--page-bg)'), 'DMX 滚动页面未继承根主题背景')
  ;['.fixture-search-sheet', '.fixture-channel-guide-sheet', '.floating-card', '.pending-sheet', '.save-project-sheet', '.result-report-preview-sheet']
    .forEach((selector) => assert(dmxBaseDeclarations(selector).includes('background:var(--surface)') &&
      (dmxBaseDeclarations(selector).includes('color:var(--text)') || selector === '.floating-card'),
    `DMX 实际弹层未继承深色表面与文字：${selector}`))
  assert(dmxBaseDeclarations('.fixture-search-box').includes('background:var(--control)') &&
    dmxBaseDeclarations('.fixture-search-box input').includes('color:var(--text)') &&
    dmxBaseDeclarations('.project-name-input').includes('background:var(--control)') &&
    dmxBaseDeclarations('.project-name-input').includes('color:var(--text)'), 'DMX 搜索与项目输入缺少主题继承')
  const knowledgeTheme = fs.readFileSync(path.join(root, 'pages/knowledge/detail.wxss'), 'utf8')
  assert(/\.article-lead\{[^}]*padding:0[^}]*color:var\(--ts\)/.test(knowledgeTheme), '知识详情引导语应为透明纸面正文并使用主题辅助文字色')
  assert(/\.section-paragraph\{[^}]*color:var\(--ts\)[^}]*font-size:29rpx/.test(knowledgeTheme), '知识详情正文缺少可读的主题辅助文字色')
  assert(/\.knowledge-error-button\.knowledge-error-button\{[^}]*background:var\(--tp\)[^}]*color:#fff/.test(knowledgeTheme), '知识详情错误页按钮缺少蓝底白字层叠保护')
  const splTheme = fs.readFileSync(path.join(root, 'pages/spl/spl.wxss'), 'utf8')
  assertDarkDeclaration(splTheme, '.distance-input-wrap', 'background:var(--theme-control)', 'SPL 距离输入壳缺少深色控件背景')
  assertDarkDeclaration(splTheme, '.settings-card .compact-grid .field-label.field-label', 'color:var(--theme-text-secondary)', 'SPL 紧凑输入标签缺少深色辅助文字色')
  assertDarkDeclaration(splTheme, '.reference-title.reference-title', 'color:var(--theme-text)', 'SPL 参考标题缺少深色主文字色')
  assertDarkDeclaration(splTheme, '.meeting-text', 'color:var(--theme-text-secondary)', 'SPL 参考说明缺少深色辅助文字色')
  assertDarkDeclaration(splTheme, '.distance-value', 'color:var(--theme-text-secondary)', 'SPL 距离数值缺少深色辅助文字色')
  assertDarkDeclaration(sharedTheme, 'page .warning-text.warning-text', 'color:var(--theme-warning)', '共享警告正文未使用 warning 语义色')
  assert(!recordsTheme.includes('.interior-comparison-grid') && !recordsTheme.includes('.interior-comparison-row'),
    '项目详情不再保留计算记录比较表样式')
  ;['pages/dmx-layout/dmx-layout.wxss']
    .forEach((file) => assert(!fs.readFileSync(path.join(root, file), 'utf8').includes('theme-page-shared'), `${file} 不得导入第二批共享主题`))
  ;['pages/led-screen/led-screen.json', 'pages/gain-structure/gain-structure.json', 'pages/products/library.json',
    'pages/products/detail.json', 'pages/dmx-address/dmx-address.json', 'pages/dmx-address/channel-guide.json',
    'pages/dmx-layout/dmx-layout.json']
    .forEach((file) => {
      const source = fs.readFileSync(path.join(root, file), 'utf8')
      assert(!source.includes('navigationBarBackgroundColor') && !source.includes('navigationBarTextStyle'),
        `${file} 不得写死导航栏颜色`)
    })
  assert.deepStrictEqual(
    Object.fromEntries(['navigationBarTextStyle', 'navigationBarBackgroundColor', 'backgroundColor', 'backgroundTextStyle'].map((key) => [key, appConfig.window[key]])),
    { navigationBarTextStyle: '@navTextColor', navigationBarBackgroundColor: '@navBgColor', backgroundColor: '@pageBgColor', backgroundTextStyle: '@bgTextStyle' },
  )
  assert.deepStrictEqual(
    Object.fromEntries(['color', 'selectedColor', 'backgroundColor', 'borderStyle'].map((key) => [key, appConfig.tabBar[key]])),
    { color: '@tabTextColor', selectedColor: '@tabSelectedColor', backgroundColor: '@tabBgColor', borderStyle: '@tabBorderColor' },
  )
  const iconKeys = ['exploreIcon', 'exploreSelectedIcon', 'toolsIcon', 'toolsSelectedIcon', 'projectsIcon', 'projectsSelectedIcon']
  for (const mode of ['light', 'dark']) iconKeys.forEach((key) => assert(fs.existsSync(path.join(root, themeConfig[mode][key])), `${mode} 主题图标缺失：${key}`))
  for (const item of appConfig.tabBar.list) {
    assert(item.iconPath.startsWith('@') && item.selectedIconPath.startsWith('@'), `${item.text}页签图标未使用主题变量`)
  }
  const layoutFactorySource = fs.readFileSync(path.join(root, 'pages/dmx-layout/page-factory.js'), 'utf8')
  const layoutRendererSource = fs.readFileSync(path.join(root, 'pages/dmx-layout/layout-renderer.js'), 'utf8')
  const layoutCanvasSource = `${layoutFactorySource}\n${layoutRendererSource}`
  assert(layoutCanvasSource.includes('CANVAS_THEMES') && layoutCanvasSource.includes('getCanvasTheme') &&
    layoutFactorySource.includes('wx.onThemeChange') && layoutFactorySource.includes('wx.offThemeChange') &&
    layoutFactorySource.includes('this.clearImage()') && layoutRendererSource.includes('theme.background') &&
    layoutRendererSource.includes('theme.stage'), '位置图 Canvas 缺少浅深色调色板或主题切换清图重绘机制')
  ;['pages/dmx-layout/dmx-layout.wxss'].forEach((file) => {
    const source = fs.readFileSync(path.join(root, file), 'utf8')
    const layoutDarkCss = source.slice(source.search(/@media\s*\(prefers-color-scheme:\s*dark\)/)).replace(/\s+/g, '')
    assert(/@media\s*\(prefers-color-scheme:\s*dark\)/.test(source) &&
      ['page-bg', 'surface', 'control'].every((token) => new RegExp(`var\\(\\s*--theme-${token}(?:\\s*,[^)]+)?\\s*\\)`).test(source)) &&
      /--theme-page-bg:\s*#000\b/.test(layoutDarkCss) && /--theme-surface:\s*#1c1c1e\b/.test(layoutDarkCss) &&
      /--theme-control:\s*#2c2c2e\b/.test(layoutDarkCss) && /--theme-text:\s*#fff\b/.test(layoutDarkCss) &&
      /\.settings-apply,\.reduction-confirm,\.export-share\{background:#007aff\}/.test(source), `${file} 缺少核心深色层级覆盖`)
  })
  const packageFiles = getEffectivePackageFiles(projectConfig)
  const draftProtocolGate = evaluateDraftProtocolPackageGate(
    packageFiles.map(normalizeRelativePath),
  )
  assert(draftProtocolGate.allowed,
    `拒绝发布：包内仍含未正式收录的控制协议开发样本/照片：${draftProtocolGate.resources.join('、')}。开发样本只能存放在 tests/fixtures 中。`)
  const packageGroups = getPackageGroups(packageFiles, appConfig)
  const subPackageRoots = (appConfig.subPackages || []).map((subPackage) => subPackage.root)
  const mainPackage = packageGroups.find((group) => !group.root)
  const mainPackageBytes = mainPackage.files.reduce((total, file) => total + fs.statSync(file).size, 0)
  const crossPackageRequires = findSubPackageRequires(mainPackage.files, subPackageRoots)
  assert.strictEqual(crossPackageRequires.length, 0,
    `主包 JS 不得 require 分包资源：${crossPackageRequires.map((item) => `${item.file} -> ${item.request}`).join('；')}`)
  const basisSubPackage = (appConfig.subPackages || []).find((subPackage) => subPackage.root === 'pages/basis')
  assert(basisSubPackage?.pages?.includes('detail'), '依据详情页未注册为独立分包')
  assert(!appConfig.pages.includes('pages/basis/detail'), '依据详情页仍位于主包 pages 中')
  assert(fs.existsSync(path.join(root, 'pages/basis/assets/cable.png')))
  assert(!fs.existsSync(path.join(root, 'assets/basis')), '依据详情图仍位于主包 assets')
  const dmxSubPackage = (appConfig.subPackages || []).find((subPackage) => subPackage.root === 'pages/dmx-address')
  assert(dmxSubPackage?.pages?.includes('dmx-address'), 'DMX 地址页未注册为独立分包')
  assert(dmxSubPackage?.pages?.includes('channel-guide'), 'DMX 通道资料页未注册为独立分包')
  assert(!appConfig.pages.includes('pages/dmx-address/dmx-address'), 'DMX 地址页仍在主包 pages 中')
  assert(fs.existsSync(path.join(root, 'pages/dmx-address/data/stage-lighting-channels.js')))
  assert(fs.existsSync(path.join(root, 'pages/dmx-address/utils/dmx-channel-guide.js')))
  assert(!fs.existsSync(path.join(root, 'data/stage-lighting-channels.js')), '详细灯具通道资料仍位于主包 data')
  assert(!fs.existsSync(path.join(root, 'utils/dmx-channel-guide.js')), 'DMX 通道工具仍位于主包 utils')
  const bytesByExtension = packageFiles.reduce((totals, file) => {
    const extension = path.extname(file).toLowerCase()
    totals[extension] = (totals[extension] || 0) + fs.statSync(file).size
    return totals
  }, {})
  const totalBytes = packageFiles.reduce((total, file) => total + fs.statSync(file).size, 0)
  const javascriptFiles = packageFiles
    .filter((file) => path.extname(file).toLowerCase() === '.js')
    .map((file) => ({ file, bytes: fs.statSync(file).size }))
    .sort((left, right) => right.bytes - left.bytes)
  const largestJavaScript = javascriptFiles[0] || { file: '', bytes: 0 }

  assert(
    totalBytes <= PACKAGE_BUDGETS.total,
    `有效正式包超过 ${formatKiB(PACKAGE_BUDGETS.total)}：${formatKiB(totalBytes)}`,
  )
  assert(
    mainPackageBytes <= PACKAGE_BUDGETS.mainTotal,
    `主包源码资源超过 ${formatKiB(PACKAGE_BUDGETS.mainTotal)}：${formatKiB(mainPackageBytes)}`,
  )
  ;['.wxss', '.wxml'].forEach((extension) => {
    const actual = bytesByExtension[extension] || 0
    assert(
      actual <= PACKAGE_BUDGETS[extension],
      `有效正式包 ${extension.slice(1).toUpperCase()} 超过 ${formatKiB(PACKAGE_BUDGETS[extension])}：${formatKiB(actual)}`,
    )
  })
  assert(
    largestJavaScript.bytes <= PACKAGE_BUDGETS.singleJavaScript,
    `单个 JS 超过 ${formatKiB(PACKAGE_BUDGETS.singleJavaScript)}：${normalizeRelativePath(largestJavaScript.file)} ${formatKiB(largestJavaScript.bytes)}`,
  )
  packageGroups.forEach((group) => {
    const javascriptBytes = group.files
      .filter((file) => path.extname(file).toLowerCase() === '.js')
      .reduce((total, file) => total + fs.statSync(file).size, 0)
    const javascriptBudget = group.root
      ? PACKAGE_BUDGETS.subPackageJavaScript
      : PACKAGE_BUDGETS.mainJavaScript
    assert(
      javascriptBytes <= javascriptBudget,
      `${group.name} JS 超过 ${formatKiB(javascriptBudget)}：${formatKiB(javascriptBytes)}`,
    )
  })

  assert.strictEqual(new Set(appConfig.pages).size, appConfig.pages.length, 'app.json 页面清单存在重复路径')
  const registeredPages = getRegisteredPagePaths(appConfig)
  assert.strictEqual(new Set(registeredPages).size, registeredPages.length, '主包与分包页面清单存在重复路径')
  assert.deepStrictEqual([...registeredPages].sort(), [...EXPECTED_APP_PAGES].sort(), '主包与分包页面清单与发布基线不一致')
  registeredPages.forEach((pagePath) => {
    ;['.js', '.json', '.wxml', '.wxss'].forEach((extension) => {
      const file = path.join(root, `${pagePath}${extension}`)
      assert(fs.existsSync(file), `页面缺少 ${extension} 文件：${pagePath}`)
      if (extension === '.json') JSON.parse(fs.readFileSync(file, 'utf8'))
    })
  })
  const tabPages = (appConfig.tabBar?.list || []).map((item) => item.pagePath)
  assert.strictEqual(new Set(tabPages).size, tabPages.length, 'tabBar 页面存在重复路径')
  tabPages.forEach((pagePath) => assert(registeredPages.includes(pagePath), `tabBar 页面未注册：${pagePath}`))

  const sensitiveCalls = findSensitiveApiCalls(packageFiles)
  assert.strictEqual(
    sensitiveCalls.length,
    0,
    `检测到需人工审核的敏感 API：\n${sensitiveCalls.map((item) => (
      `- ${item.category} ${item.api} @ ${item.file}:${item.line}`
    )).join('\n')}`,
  )

  const javascriptByPackage = packageGroups.map((group) => {
    const bytes = group.files
      .filter((file) => path.extname(file).toLowerCase() === '.js')
      .reduce((total, file) => total + fs.statSync(file).size, 0)
    const budget = group.root
      ? PACKAGE_BUDGETS.subPackageJavaScript
      : PACKAGE_BUDGETS.mainJavaScript
    return `${group.name} JS ${formatKiB(bytes)} / ${formatKiB(budget)}`
  }).join('；')
  console.log(
    `发布包门禁：总计 ${formatKiB(totalBytes)} / ${formatKiB(PACKAGE_BUDGETS.total)}；`
    + `主包源码资源 ${formatKiB(mainPackageBytes)} / ${formatKiB(PACKAGE_BUDGETS.mainTotal)}（非微信编译包实测值）；`
    + `${javascriptByPackage}；`
    + `WXSS ${formatKiB(bytesByExtension['.wxss'] || 0)} / ${formatKiB(PACKAGE_BUDGETS['.wxss'])}；`
    + `WXML ${formatKiB(bytesByExtension['.wxml'] || 0)} / ${formatKiB(PACKAGE_BUDGETS['.wxml'])}；`
    + `最大 JS ${normalizeRelativePath(largestJavaScript.file)} ${formatKiB(largestJavaScript.bytes)} / ${formatKiB(PACKAGE_BUDGETS.singleJavaScript)}。`,
  )
  console.log(`页面清单门禁：${appConfig.pages.length} 个主包页面、${registeredPages.length - appConfig.pages.length} 个分包页面、${tabPages.length} 个 tabBar 页面均完整。`)
  console.log('敏感 API 静态扫描：0 命中；用户触发的剪贴板、相册保存、震动与 Canvas API 保持允许。')
}

function checkSyntax() {
  collectJavaScriptFiles(root).forEach((file) => new vm.Script(fs.readFileSync(file, 'utf8'), { filename: file }))
}





function checkDmxAddressLazyChannelGuide() {
  const dmxAddressPath = path.join(root, 'pages/dmx-address/dmx-address.js')
  const dmxAddressSource = fs.readFileSync(dmxAddressPath, 'utf8')
  const resultViewSource = fs.readFileSync(path.join(root, 'pages/dmx-address/result-view.js'), 'utf8')
  const channelGuideRequires = [...dmxAddressSource.matchAll(
    /require\(['"]\.\/utils\/dmx-channel-guide['"]\)/g,
  )]
  const channelGuideApiBody = dmxAddressSource.match(
    /function getChannelGuideApi\(\)\s*\{([\s\S]*?)\n\}/,
  )
  assert.strictEqual(channelGuideRequires.length, 1,
    'DMX 地址页的通道资料 require 必须且只能出现一次')
  assert(channelGuideApiBody
    && /channelGuideApi\s*=\s*require\(['"]\.\/utils\/dmx-channel-guide['"]\)/.test(channelGuideApiBody[1]),
  'DMX 地址页的通道资料 require 未位于 getChannelGuideApi 缓存赋值中')
  assert(resultViewSource.includes('new Set(dmxFixtures.map((fixture) => fixture.model))'),
    'DMX 结果视图未使用轻量灯具型号 Set 标记通道入口')

  const Module = require('module')
  const guidePath = require.resolve('../pages/dmx-address/utils/dmx-channel-guide')
  delete require.cache[require.resolve(dmxAddressPath)]
  delete require.cache[guidePath]
  const previousPage = global.Page
  const previousWx = global.wx
  const originalLoad = Module._load
  let definition = null
  let channelProfilesLoaded = 0
  global.Page = (value) => { definition = value }
  global.wx = { vibrateShort: () => {}, showToast: () => {} }
  Module._load = function trackDmxChannelProfiles(request, parent, isMain) {
    if (request === '../data/stage-lighting-channels') channelProfilesLoaded += 1
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    require(dmxAddressPath)
    assert(definition, 'DMX 地址页未注册页面')
    assert.strictEqual(channelProfilesLoaded, 0, '进入 DMX 地址页时已加载完整通道资料')
    const page = {
      ...definition,
      data: { fixtureChannelGuide: null, fixtureChannelGuideDetail: null },
      setData(value) { Object.assign(this.data, value) },
    }
    const plan = calculateDmxAddressPlan({
      startAddress: 1,
      groups: [{ name: '测试灯具', fixtureModel: 'TL-SV3103', channelCount: 14, fixtureCount: 1 }],
    })
    page._calculationResult = plan
    page.openFixtureChannelGuide({ currentTarget: { dataset: { globalIndex: plan.fixtures[0].globalIndex } } })
    assert.strictEqual(channelProfilesLoaded, 1, '首次打开通道入口未按需加载完整通道资料')
    assert(page.data.fixtureChannelGuide, '按需加载后未生成通道指南')
    assert.strictEqual(page.data.fixtureChannelGuide.channels.length, 14, '按需生成的通道指南内容异常')
    page.openFixtureChannelGuide({ currentTarget: { dataset: { globalIndex: plan.fixtures[0].globalIndex } } })
    assert.strictEqual(channelProfilesLoaded, 1, '重复打开通道入口重复加载完整通道资料')
  } finally {
    Module._load = originalLoad
    delete require.cache[require.resolve(dmxAddressPath)]
    delete require.cache[guidePath]
    if (previousPage === undefined) delete global.Page
    else global.Page = previousPage
    if (previousWx === undefined) delete global.wx
    else global.wx = previousWx
  }
}

function checkSharedResultReportPreviewTemplate() {
  const templateRelativePath = 'templates/result-report-preview.wxml'
  const templatePath = path.join(root, templateRelativePath)
  assert(fs.existsSync(templatePath), '共享结果图片 Canvas/预览模板不存在')
  const template = fs.readFileSync(templatePath, 'utf8')
  assert(template.includes('canvas-id="resultReportCanvas"')
    && template.includes('bindtap="shareResultReportImage"')
    && template.includes('bindtap="saveResultReportImage"'),
  '共享结果图片模板缺少 Canvas、分享或保存入口')
  ;['camera', 'cable'].forEach((page) => {
    const source = fs.readFileSync(path.join(root, `pages/${page}/${page}.wxml`), 'utf8')
    assert.strictEqual(
      (source.match(/<include\s+src="\.\.\/\.\.\/templates\/result-report-preview\.wxml"\s*\/>/g) || []).length,
      1,
      `${page} 页面未唯一引用共享结果图片模板`,
    )
  })
  const splWxml = fs.readFileSync(path.join(root, 'pages/spl/spl.wxml'), 'utf8')
  const splJs = fs.readFileSync(path.join(root, 'pages/spl/spl.js'), 'utf8')
  const splReport = fs.readFileSync(path.join(root, 'pages/spl/spl-report.js'), 'utf8')
  assert.strictEqual(
    (splWxml.match(/<canvas\b[^>]*canvas-id="resultReportCanvas"/g) || []).length,
    1,
    'SPL 页内结果图片预览必须保留唯一 Canvas',
  )
  assert(splWxml.includes('bindtap="openSharePreview"')
    && splWxml.includes('class="share-image" src="{{resultReportImagePath}}" mode="aspectFit"')
    && splWxml.includes('class="share-image-frame" style="{{shareImageFrameStyle}}"')
    && splWxml.includes('bindload="onResultReportImageLoad"')
    && splWxml.includes('bindtap="previewResultReportImage"')
    && !splWxml.includes('share-image-scroll'),
  'SPL 页内结果图片预览缺少生成入口、缓存图片、加载布局或原图预览入口')
  assert(splWxml.includes('class="share-state share-error"')
    && splWxml.includes('bindtap="retryResultReport"')
    && splWxml.includes('bindtap="closeSharePreview"')
    && splWxml.includes('bindtap="shareResultReportImage"')
    && splWxml.includes('bindtap="saveResultReportImage"'),
  'SPL 页内结果图片预览缺少失败重试、关闭、转发或保存入口')
  assert.strictEqual(
    (splWxml.match(/disabled="\{\{!resultReportImagePath \|\| isGeneratingResultReport \|\| isCheckingResultReportCache \|\| isCalculationPending\}\}"/g) || []).length,
    2,
    'SPL 转发与保存必须在无缓存、生成中、检查缓存或计算待定时禁用',
  )
  assert(splJs.includes('generateResultReportImage()')
    && splJs.includes('wx.getFileSystemManager()')
    && splJs.includes('fileSystem.access({ path, success: showCached, fail: regenerate })')
    && splJs.includes('updateShareImageLayout()')
    && splJs.includes('shareImageFrameStyle')
    && !splJs.includes('updateShareImageScrollStyle')
    && splJs.includes('wx.previewImage({')
    && splJs.includes('wx.showShareImageMenu({')
    && splJs.includes('saveGeneratedImage(this.data.resultReportImagePath)')
    && splJs.includes("require('./spl-report')")
    && splReport.includes('function drawSplReport(')
    && splReport.includes('function calculateSplReportHeight('),
  'SPL 本地结果图片预览缺少生成、缓存校验、整图布局、原图、转发、保存或本地 renderer')
  const gainWxml = fs.readFileSync(path.join(root, 'pages/gain-structure/gain-structure.wxml'), 'utf8')
  const gainOverlay = fs.readFileSync(path.join(root, 'pages/gain-structure/gain-overlays.wxml'), 'utf8')
  assert(!gainWxml.includes('../..\/templates\/result-report-preview.wxml')
    && gainWxml.includes('<include src="./gain-overlays.wxml" />')
    && gainOverlay.includes('bindtap="shareResultReportImage"')
    && gainOverlay.includes('bindtap="saveResultReportImage"')
    && gainWxml.includes('canvas-id="resultReportCanvas"'),
  '增益架构本地结果图片模板缺少 Canvas、发送或保存入口')
  const limiter = expandWxmlIncludes('pages/limiter/limiter.wxml')
  const limiterShareActions = /<view class="share-actions">([\s\S]*?)<\/view>/.exec(limiter)
  assert(limiter.includes('canvas-id="resultReportCanvas"')
    && limiter.includes('bindtap="openSharePreview"')
    && limiter.includes('bindtap="shareResultReportImage"')
    && limiter.includes('bindtap="saveResultReportImage"'),
  '限制器本地结果图片模板缺少 Canvas、预览或发送/保存入口')
  assert(limiterShareActions
    && (limiterShareActions[1].match(/<button\b/g) || []).length === 2
    && limiterShareActions[1].includes('发送给微信好友')
    && limiterShareActions[1].includes('保存到手机'),
  '限制器图片预览必须只提供发送与保存两个应用内动作')
}

function checkLedScreenPlan() {
  const modulePlan = calculateLedScreenPlan({
    wallWidthMeters: 6,
    wallHeightMeters: 3,
    topReserveMeters: 0.2,
    bottomReserveMeters: 0.2,
    viewingDistanceMeters: 3,
    unitKey: 'module',
    pixelPitch: 'recommended',
  })
  assert.strictEqual(modulePlan.error, undefined)
  assert.strictEqual(modulePlan.pixelPitch, 1.53)
  assert.strictEqual(modulePlan.screenWidthMeters * 1000 % 320, 0)
  assert.strictEqual(modulePlan.screenHeightMeters * 1000 % 160, 0)
  assert.strictEqual(modulePlan.totalUnits, modulePlan.columns * modulePlan.rows)
  assert(modulePlan.screenWidthMeters <= 6)
  assert.strictEqual(modulePlan.frameWidthCentimeters, 5)
  assert.strictEqual(modulePlan.columns, 14)
  assert.strictEqual(modulePlan.rows, 15)
  assert.strictEqual(modulePlan.dimensionText, '4.48 × 2.4 m')
  assert.strictEqual(modulePlan.installedWidthMeters, modulePlan.screenWidthMeters + 0.1)
  assert.strictEqual(modulePlan.installedHeightMeters, modulePlan.screenHeightMeters + 0.1)
  assert(modulePlan.installedWidthMeters <= 6)
  assert(modulePlan.actualTopMarginMeters >= 0.2)
  assert(modulePlan.actualBottomMarginMeters >= 0.2)
  assert.strictEqual(modulePlan.targetAspectRatioKey, '16:9')
  assert(calculateLedScreenPlan({
    wallWidthMeters: 6,
    wallHeightMeters: 3,
    topReserveMeters: 0.2,
    bottomReserveMeters: 0.2,
    viewingDistanceMeters: 3,
    unitKey: 'module',
    pixelPitch: 0.9375,
  }).error)
  assert(calculateLedScreenPlan({
    wallWidthMeters: 1,
    wallHeightMeters: 1,
    topReserveMeters: 0,
    bottomReserveMeters: 0,
    frameWidthMeters: 0.5,
    viewingDistanceMeters: 3,
    unitKey: 'module',
    pixelPitch: 1.25,
  }).error)

  ;['16:9', '4:3', '21:9', '16:10', '32:9'].forEach((aspectRatioKey) => {
    const ratioPlan = calculateLedScreenPlan({
      wallWidthMeters: 12,
      wallHeightMeters: 4,
      topReserveMeters: 0.1,
      bottomReserveMeters: 0.1,
      viewingDistanceMeters: 4,
      aspectRatioKey,
      unitKey: 'module',
      pixelPitch: 'recommended',
    })
    assert.strictEqual(ratioPlan.error, undefined)
    assert.strictEqual(ratioPlan.targetAspectRatioKey, aspectRatioKey)
    assert(ratioPlan.screenWidthMeters <= 12)
    assert(ratioPlan.screenHeightMeters <= 3.8)
  })

  const premiumPlan = calculateLedScreenPlan({
    wallWidthMeters: 6.4,
    wallHeightMeters: 3.2,
    topReserveMeters: 0.1,
    bottomReserveMeters: 0.1,
    viewingDistanceMeters: 3,
    unitKey: 'cabinetPremiumA',
    pixelPitch: 1.86,
  })
  assert.strictEqual(premiumPlan.error, undefined)
  assert.strictEqual(premiumPlan.unitLabel, '高端 A 系列')
  assert.strictEqual(premiumPlan.ratioCloseToTarget, true)
  assert.strictEqual(premiumPlan.pitchMode, 'specified')
  assert.strictEqual(premiumPlan.statusKey, 'near')
  assert(calculateLedScreenPlan({
    wallWidthMeters: 1,
    wallHeightMeters: 0.4,
    topReserveMeters: 0.2,
    bottomReserveMeters: 0.2,
    viewingDistanceMeters: 3,
    unitKey: 'module',
    pixelPitch: 1.25,
  }).error)
}

function checkData() {
  assert.strictEqual(APP_VERSION, '6.0.0')
  assert.strictEqual(PRODUCT_DATA_DATE, '2026-09-01')
  assert.strictEqual(fs.readFileSync(path.join(root, 'VERSION'), 'utf8').trim(), APP_VERSION)
  assert(Object.isFrozen(PRODUCT_COUNTS), '产品资料库数量统计必须冻结')
  assert.strictEqual(amplifiers.length, 38, '功放产品数量发生变化，请复核资料')
  assert.strictEqual(speakers.length, 148, '音箱产品数量发生变化，请复核资料')
  assertUnique(amplifiers, (item) => item.model, '功放产品库')
  assertUnique(speakers, (item) => item.model, '音箱产品库')
  assert.strictEqual(cameras.length, 26, '摄像机产品数量发生变化，请复核资料')
  assert.deepStrictEqual(PRODUCT_COUNTS, {
    amplifier: amplifiers.length,
    speaker: speakers.length,
    camera: cameras.length,
    lighting: stageLightingProducts.length,
  }, '首页产品统计与实际产品库不一致')
  assertUnique(cameras, (item) => item.model, '摄像机产品库')
  assert.strictEqual(stageLightingProducts.length, 149, '舞台灯光产品数量发生变化，请复核资料')
  assertUnique(stageLightingProducts, (item) => item.model, '舞台灯光产品库')
  assert.deepStrictEqual(
    stageLightingProducts.reduce((counts, item) => ({
      ...counts,
      [item.category]: (counts[item.category] || 0) + 1,
    }), {}),
    { 电源直通箱: 10, 灯光控台: 16, 灯具: 123 },
  )
  assert.strictEqual(dmxFixtures.length, 121, '可自动编址灯具数量异常')
  stageLightingProducts.forEach((item) => {
    assert(item.model && item.name && item.category && item.source, '舞台灯光产品资料不完整')
    assert(['control', 'fixture', 'power'].includes(item.categoryKey), `${item.model} 设备分类无效`)
    assert(Array.isArray(item.channelModes), `${item.model} 通道模式格式无效`)
    assert(item.channelModes.every((mode) => Number.isInteger(mode) && mode > 0 && mode <= 512), `${item.model} 通道模式数值无效`)
    assert.strictEqual(new Set(item.channelModes).size, item.channelModes.length, `${item.model} 通道模式重复`)
    assert.strictEqual(item.dmxAddressable, item.categoryKey === 'fixture' && item.channelModes.length > 0)
  })
  assert.deepStrictEqual(
    stageLightingProducts
      .filter((item) => item.categoryKey === 'fixture' && !item.dmxAddressable)
      .map((item) => item.model),
    ['TL-SL622', 'TL-SL643'],
  )
  assert.deepStrictEqual(findByModel(stageLightingProducts, 'TL-SE3401').channelModes, [4, 16, 88, 168])
  assert.deepStrictEqual(findByModel(stageLightingProducts, 'TL-SL344').channelModes, [2, 4, 6, 8, 12])
  assert.deepStrictEqual(findByModel(stageLightingProducts, 'TL-SV3103').channelModes, [14, 16, 18])
  assert.deepStrictEqual(findByModel(stageLightingProducts, 'TL-SL326').channelModes, [1])
  assert.strictEqual(new Set(cameras.map((item) => item.source)).size, 21, '摄像机说明书来源数量异常')
  assert(cameras.every((item) => item.source.startsWith('itc产品说明书 ')), '摄像机说明书文件名未按桌面原文件记录')
  cameras.forEach((item) => {
    assert(item.model && item.source && item.sourcePages, '摄像机缺少型号、资料来源或参数页')
    assert(['ptz', 'fixed', 'eptz', 'mixed'].includes(item.mountType), `${item.model} 缺少安装结构分类`)
    assert(item.views?.length, `${item.model} 缺少镜头视角数据`)
    item.views.forEach((view, viewIndex) => {
      assert(view.hWide > 0, `${item.model} 的 ${view.label} 缺少水平视场角`)
      const wide = resolveLibraryFov(item, viewIndex, 'wide')
      if (view.vWide > 0) {
        assert.strictEqual(wide.horizontalFov, view.hWide)
        assert.strictEqual(wide.verticalFov, view.vWide)
      } else assert.strictEqual(wide, null, `${item.model} 缺少厂家垂直角却进入了计算`)

      const tele = resolveLibraryFov(item, viewIndex, 'tele')
      if (view.hTele > 0 && view.vTele > 0) {
        assert.strictEqual(tele.horizontalFov, view.hTele)
        assert.strictEqual(tele.verticalFov, view.vTele)
      } else assert.strictEqual(tele, null, `${item.model} 缺少厂家长焦双轴角却进入了计算`)
    })
  })
  assert.strictEqual(cameras.filter((item) => getCalculableCameraViews(item).length).length, 16)
  assert.strictEqual(cameras.filter((item) => getHorizontalCameraViews(item).length).length, 26)
  assert.deepStrictEqual(
    cameras.filter((item) => !getCalculableCameraViews(item).length).map((item) => item.model),
    ['TS-0663JS', 'TS-0663XS', 'TS-0663JSM', 'TS-0663XSM', 'TV-6104HK', 'TV-6124UK', 'TV-612KM', 'TV-620KL', 'TV-620KM', 'TV-MU650X'],
  )
  amplifiers.forEach((item) => {
    assert(item.model && item.source, '功放缺少型号或资料来源')
    assert(Object.keys(item.stereoPower || {}).length, `${item.model} 缺少立体声功率数据`)
  })
  assert.deepStrictEqual(
    Object.keys(amplifierInputStages).sort(),
    amplifiers.map((item) => item.model).sort(),
    '功放输入级参数与当前功放产品库不一致',
  )
  Object.entries(amplifierInputStages).forEach(([model, stage]) => {
    assert(['inputSensitivity', 'voltageGain'].includes(stage.controlType), `${model} 输入级控制类型无效`)
    assert(['V', 'dBu', 'dB'].includes(stage.unit), `${model} 输入级单位无效`)
    assert(stage.options.length && stage.options.every(Number.isFinite), `${model} 输入级档位无效`)
    assert.strictEqual(new Set(stage.options).size, stage.options.length, `${model} 输入级档位重复`)
    assert(stage.source && stage.sourcePages.length, `${model} 缺少输入级参数来源`)
    assert(stage.sourcePages.every((page) => Number.isInteger(page) && page > 0), `${model} 参数页码无效`)
    assert.strictEqual(stage.verification, 'manual-page', `${model} 输入级参数未经原页复核`)
  })
  assert.deepStrictEqual(amplifierInputStages['TC-22000'].options, [33, 36, 39, 42])
  assert.deepStrictEqual(amplifierInputStages['TC-41500DT'].options, [2, 6, 12])
  assert.strictEqual(amplifierInputStages['TC-41500DT'].maximumInputDbu, 20)
  assert.deepStrictEqual(amplifierInputStages['TC-4200B'].options, [1])
  assert.strictEqual(amplifierInputStages['TC-X2200B'].defaultValue, 1)
  speakers.forEach((item) => {
    assert(item.model && item.source, '音箱缺少型号或资料来源')
    assert(item.ratedPower > 0 && item.impedance > 0, `${item.model} 缺少额定功率或阻抗`)
  })

  const missingSensitivity = speakers
    .filter((item) => !Number.isFinite(item.sensitivityDb))
    .map((item) => item.model)
    .sort()
  assert.deepStrictEqual(missingSensitivity, ['KS-153', 'TS-403C'])

  assert.strictEqual(Object.keys(speakerSpecifications).length, 148)
  assert.deepStrictEqual(Object.keys(speakerSpecifications).sort(), speakers.map((item) => item.model).sort())
  assert.strictEqual(Object.values(speakerSpecifications).filter((item) => Number.isFinite(item.peakPower)).length, 67)
  assert.strictEqual(Object.values(speakerSpecifications).filter((item) => Number.isFinite(item.maximumSplDb)).length, 132)
  assert.strictEqual(Object.values(speakerSpecifications).filter((item) => item.horizontalCoverageDeg != null || item.verticalCoverageDeg != null || item.verticalCoverage != null).length, 103)
  const splitBandModels = ['KS-153', 'KS-208A', 'TS-405HBS', 'TX-1508', 'TX-1510']
  assert.deepStrictEqual(speakers.filter((item) => item.calculationDisabled).map((item) => item.model).sort(), splitBandModels)
  assert.deepStrictEqual(Object.keys(speakerSpecifications).filter((model) => speakerSpecifications[model].bands).sort(), splitBandModels)
  assert.strictEqual(findByModel(speakers, 'TS-108R').sensitivityDb, 91)
  assert.deepStrictEqual(
    (({ ratedPower, impedance, minimumFrequency, sensitivityDb }) => ({ ratedPower, impedance, minimumFrequency, sensitivityDb }))(
      findByModel(speakers, 'TS-208R'),
    ),
    { ratedPower: 100, impedance: 8, minimumFrequency: 60, sensitivityDb: 92 },
  )
  assert.deepStrictEqual(
    (({ ratedPower, impedance, minimumFrequency, sensitivityDb }) => ({ ratedPower, impedance, minimumFrequency, sensitivityDb }))(
      findByModel(speakers, 'TS-208RH'),
    ),
    { ratedPower: 200, impedance: 8, minimumFrequency: 50, sensitivityDb: 92 },
  )
  assert.strictEqual(speakerSpecifications['TS-208R'].maximumSplDb, 112)
  assert.strictEqual(speakerSpecifications['TS-208R'].directivityAdjustmentDeg, 12)
  assert.strictEqual(speakerSpecifications['TS-208RH'].maximumPower, 400)
  assert.strictEqual(speakerSpecifications['TS-208RH'].maximumSplToleranceDb, 3)
  assert.strictEqual(speakerSpecifications['TS-208RH'].sourcePage.page, 2)
  assert.strictEqual(findByModel(speakers, 'LA-2800').ratedPower, 500)
  assert.strictEqual(findByModel(speakers, 'LA-2800').minimumFrequency, 70)
  assert.strictEqual(findByModel(speakers, 'KS-405').impedance, 16)
  assert.strictEqual(findByModel(speakers, 'TS-610W').peakPower, 1200)
  assert(!speakers.some((item) => item.model === 'TS-603B-603W'))

  assertUnique(knowledgeItems, (item) => item.id, '扩声知识库')
  knowledgeItems.forEach((item) => assert.strictEqual(findKnowledgeById(item.id), item))
  assert.deepStrictEqual(
    knowledgeItems.filter((item) => item.visualType).map((item) => item.visualType),
    ['limiter', 'distance', 'cable', 'fill', 'gain', 'camera', 'dmx', 'led'],
    '八个工具的知识图解未完整对应',
  )
  const ledArticle = findKnowledgeById('led-screen-fit')
  assert(ledArticle && ledArticle.category === '视频' && ledArticle.visualType === 'led')
  assert(ledArticle.visualTitle.includes('净屏') && ledArticle.visualConclusion.includes('含包边外尺寸'))
  assert(ledArticle.title.includes('净屏') && ledArticle.title.includes('包边'))
  assert(ledArticle.path.includes('id=led-screen-fit') && ledArticle.relatedPath === '/pages/led-screen/led-screen')
  const ledText = ledArticle.sections.map((section) => [section.title].concat(section.paragraphs, section.formulas).join('')).join('')
  assert(ledText.includes('320 × 160 mm') && ledText.includes('8 × 9 = 72') && ledText.includes('2.66 × 1.54 m'))
  assert.strictEqual(ledArticle.sections.flatMap((section) => section.formulas).length, 6)
  assert(knowledgeItems.filter((item) => item.category === '音频').length === 5)
  assert(knowledgeItems.filter((item) => item.category === '视频').length === 2)
  assert(knowledgeItems.filter((item) => item.category === '灯光').length === 1)
  const dmxArticle = findKnowledgeById('dmx-address-basics')
  assert(dmxArticle.title.includes('DMX 地址') && dmxArticle.formulaNote.includes('仅演示连续自动'))
  assert(dmxArticle.sections.some((section) => section.title.includes('按组分域')
    && section.paragraphs.join('').includes('A、B')
    && section.paragraphs.join('').includes('输出域与两条物理线路映射')))
  assert(dmxArticle.sections.some((section) => section.bullets.join('').includes('不自动溢出')
    && section.bullets.join('').includes('拆组或换域')))
  assert.strictEqual(findKnowledgeById('missing-article'), null)

  const projectConfig = JSON.parse(fs.readFileSync(path.join(root, 'project.config.json'), 'utf8'))
  collectMediaFiles(path.join(root, 'assets')).forEach((file) => {
    assert(fs.statSync(file).size <= 200 * 1024, `图片或音频超过 200 KB：${path.relative(root, file)}`)
  })
  const packageMediaFiles = collectMediaFiles(root).filter((file) => {
    const relativePath = path.relative(root, file).replace(/\\/g, '/')
    return !projectConfig.packOptions.ignore.some((item) => (
      item.type === 'file'
        ? relativePath === item.value
        : relativePath === item.value || relativePath.startsWith(`${item.value}/`)
    ))
  })
  const packageMediaBytes = packageMediaFiles.reduce((total, file) => total + fs.statSync(file).size, 0)
  assert(packageMediaBytes <= PACKAGE_BUDGETS.media,
    `代码包图片和音频合计超过 ${formatKiB(PACKAGE_BUDGETS.media)}：${packageMediaBytes} bytes`)
  const packIgnore = new Map(projectConfig.packOptions.ignore.map((item) => [item.value, item.type]))
  assert.strictEqual(packIgnore.get('docs'), 'folder')
  assert.strictEqual(packIgnore.get('tests'), 'folder')
  ;['AGENTS.md', 'CHANGELOG.md', 'DESIGN.md', 'README.md', 'UI_RULES_README.md', 'VERSION']
    .forEach((file) => assert.strictEqual(packIgnore.get(file), 'file', `${file} 未从正式包排除`))
  ;['limiter', 'spl', 'cable', 'camera', 'gain-structure', 'dmx-address']
    .forEach((name) => assert.strictEqual(
      packIgnore.get(`assets/home/module-${name}.jpg`),
      'file',
      `旧版模块图片 module-${name}.jpg 未从正式包排除`,
    ))
  const appConfig = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'))
  const registeredPages = getRegisteredPagePaths(appConfig)
  assert(!appConfig.pages.includes('pages/records/records'))
  assert(appConfig.pages.includes('pages/records/project'))
  assert(appConfig.pages.includes('pages/products/library'))
  assert(appConfig.pages.includes('pages/products/detail'))
  assert(appConfig.pages.includes('pages/camera/camera'))
  assert(appConfig.pages.includes('pages/led-screen/led-screen'))
  assert(appConfig.pages.includes('pages/gain-structure/gain-structure'))
  assert(registeredPages.includes('pages/dmx-address/dmx-address'))

  const amplifierCatalog = getProductList('amplifier')
  const speakerCatalog = getProductList('speaker')
  const cameraCatalog = getProductList('camera')
  const lightingCatalog = getProductList('lighting')
  assert.strictEqual(amplifierCatalog.length, 38)
  assert.strictEqual(speakerCatalog.length, 148)
  assert.strictEqual(cameraCatalog.length, 26)
  assert.strictEqual(lightingCatalog.length, 149)
  assert.strictEqual(getProductList('amplifier'), amplifierCatalog, '功放目录未复用静态缓存')
  assert.strictEqual(getProductList('speaker'), speakerCatalog, '音箱目录未复用静态缓存')
  assert.strictEqual(getProductList('camera'), cameraCatalog, '摄像机目录未复用静态缓存')
  assert.strictEqual(getProductList('lighting'), lightingCatalog, '舞台灯光目录未复用静态缓存')
  assert(getCategories('speaker').includes('TS系列'))
  assert(filterProducts('speaker', '803', '全部').some((item) => item.model === 'TS-803C'))
  assert(filterProducts('speaker', '', '全部', 'coverage').length >= 99)
  assert.strictEqual(filterProducts('camera', '', '全部', 'cameraFov').length, 26)
  assert(filterProducts('camera', '6124', '全部').some((item) => item.model === 'TV-6124HK'))
  assert.strictEqual(filterProducts('lighting', '', '全部', 'dmxAddress').length, 121)
  assert(filterProducts('lighting', '超级帕灯', '灯具').some((item) => item.model === 'TL-SL342B'))
  assert(getCategories('lighting').includes('灯光控台'))
  const productComparison = buildProductComparison('speaker', ['TS-603C', 'TS-803C'])
  assert.deepStrictEqual(productComparison.models, ['TS-603C', 'TS-803C'])
  assert(productComparison.rows.some((row) => row.label === '额定功率' && row.different))
  const speakerDetail = getProductDetail('speaker', 'TS-803C')
  assert.strictEqual(speakerDetail.reviewDate, PRODUCT_DATA_DATE)
  assert.strictEqual(speakerDetail.sensitivityDb, 95)
  assert.strictEqual(speakerDetail.maximumSplText, '120 dB SPL')
  assert.strictEqual(speakerDetail.coverageText, '100° × 90°')
  const ts208rhDetail = getProductDetail('speaker', 'TS-208RH')
  assert.strictEqual(ts208rhDetail.powerLimitLabel, '最大功率')
  assert.strictEqual(ts208rhDetail.powerLimitText, '400 W')
  assert.strictEqual(ts208rhDetail.sensitivityText, '92 ±3 dB')
  assert.strictEqual(ts208rhDetail.maximumSplText, '115 ±3 dB SPL')
  assert.strictEqual(ts208rhDetail.sourcePageText, '规格页码：第 2 页')
  const splitBandDetail = getProductDetail('speaker', 'KS-153')
  assert.strictEqual(splitBandDetail.bandRows.length, 2)
  assert.strictEqual(splitBandDetail.bandRows[0].soundPressureText, '额定 126 / 峰值 132 dB SPL')
  assert.strictEqual(splitBandDetail.modules.find((item) => item.key === 'limiter').actionable, false)
  assert.strictEqual(splitBandDetail.modules.find((item) => item.key === 'spl').actionable, false)
  assert.strictEqual(speakerDetail.sourcePageText, '规格页码：第 2 页')
  const cameraDetail = getProductDetail('camera', 'TV-6124HK')
  assert.strictEqual(cameraDetail.viewRows[0].horizontalText, '71–8.2°')
  assert.strictEqual(cameraDetail.viewRows[0].verticalText, '42.7–4.5°')
  assert.strictEqual(cameraDetail.modules[0].actionable, true)
  assert.strictEqual(cameraDetail.sourcePageText, '规格页码：第 5 页')
  const incompleteCameraDetail = getProductDetail('camera', 'TV-MU650X')
  assert.strictEqual(incompleteCameraDetail.modules[0].actionable, true)
  assert.strictEqual(incompleteCameraDetail.mountLabel, '机械云台')
  assert.strictEqual(incompleteCameraDetail.viewRows[0].statusLabel, '仅水平预估')
  assert(incompleteCameraDetail.missingParameters.includes('主镜头：垂直视场角'))
  const lightingDetail = getProductDetail('lighting', 'TL-SV3103')
  assert.deepStrictEqual(lightingDetail.modeRows.map((item) => item.value), [14, 16, 18])
  assert.strictEqual(lightingDetail.modules[0].key, 'dmxAddress')
  assert.strictEqual(lightingDetail.modules[0].actionable, true)
  const manualLightingDetail = getProductDetail('lighting', 'TL-SL643')
  assert.strictEqual(manualLightingDetail.modules[0].actionable, false)
}

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

function checkBaselines() {
  const camera = findByModel(cameras, 'TV-6124HK')
  const wideCoverage = calculateCoverage(resolveLibraryFov(camera, 0, 'wide'), { distanceMeters: 5 })
  assert.strictEqual(wideCoverage.coverageWidthMeters, 7.13)
  assert.strictEqual(wideCoverage.coverageHeightMeters, 3.91)
  assert.strictEqual(wideCoverage.horizontalFov, 71)
  assert.strictEqual(wideCoverage.verticalSource, '厂家说明书标注')
  assert.strictEqual(resolveLibraryFov(camera, 0, 'wide').endpointLabel, '广角端全景')

  const teleDistance = calculateCoverage(resolveLibraryFov(camera, 0, 'tele'), {
    calculationMode: 'targetWidth',
    targetWidthMeters: 6,
  })
  assert.strictEqual(teleDistance.distanceMeters, 41.85)
  assert.strictEqual(teleDistance.coverageHeightMeters, 3.29)
  assert.strictEqual(resolveLibraryFov(camera, 0, 'tele').endpointLabel, '长焦端全区域参考')
  assert.strictEqual(resolveLibraryFov(findByModel(cameras, 'TV-MU650X'), 0, 'wide'), null)
  assert.strictEqual(resolveLibraryFov(findByModel(cameras, 'TV-6104HK'), 0, 'wide'), null)
  assert.strictEqual(resolveLibraryOptics(findByModel(cameras, 'TV-MU650X'), 0, 'wide').horizontalFov, 110)
  assert.strictEqual(resolveLibraryOptics(findByModel(cameras, 'TV-MU650X'), 0, 'wide').horizontalOnly, true)
  assert.strictEqual(getCameraMountType(findByModel(cameras, 'TS-0663JP')), 'eptz')
  assert.strictEqual(getCameraMountLabel(findByModel(cameras, 'TS-0663JP')), '电子云台（固定安装）')
  assert.strictEqual(getCameraMountType(findByModel(cameras, 'TS-0650JSM'), 0), 'ptz')
  assert.strictEqual(getCameraMountType(findByModel(cameras, 'TS-0650JSM'), 1), 'fixed')
  assert.strictEqual(resolveCustomFov({ definitionMode: 'angles', horizontalFov: 60 }), null)

  const customCoverage = calculateCoverage(resolveCustomFov({
    definitionMode: 'sensor',
    sensorWidth: 6.4,
    sensorHeight: 3.6,
    focalLength: 4.5,
  }), { distanceMeters: 5 })
  assert.strictEqual(customCoverage.coverageWidthMeters, 7.11)
  assert.strictEqual(customCoverage.coverageHeightMeters, 4)

  const groundPlacement = calculateGroundAreaPlacement(resolveLibraryFov(camera, 0, 'wide'), {
    widthMeters: 6,
    depthMeters: 4,
    subjectHeightMeters: 1.8,
    heightMode: 'auto',
    marginRatio: 0.1,
  })
  assert.strictEqual(groundPlacement.cameraSetbackMeters, 4.65)
  assert.strictEqual(groundPlacement.cameraHeightMeters, 2.3)
  assert.strictEqual(groundPlacement.requiredVerticalFov, 25.2)
  assert.strictEqual(groundPlacement.framingVersion, 2)
  assert.strictEqual(groundPlacement.effectiveDepthMeters, 4)
  assert.strictEqual(groundPlacement.depthMarginMeters, 0)
  const legacyGroundPlacement = calculateGroundAreaPlacement(resolveLibraryFov(camera, 0, 'wide'), {
    widthMeters: 6, depthMeters: 4, subjectHeightMeters: 1.8, heightMode: 'auto', marginRatio: 0.1,
    calculationVersion: 1,
  })
  assert.strictEqual(legacyGroundPlacement.cameraSetbackMeters, 4.83, '历史记录保留旧退距')
  assert.strictEqual(legacyGroundPlacement.requiredVerticalFov, 24.4, '历史记录保留旧垂直角')
  assert(groundPlacement.requiredHorizontalFov <= groundPlacement.horizontalFov)
  assert(groundPlacement.requiredVerticalFov <= groundPlacement.verticalFov)
  assert(groundPlacement.cameraSetbackMeters
    * Math.tan(groundPlacement.requiredHorizontalFov * Math.PI / 360)
    >= groundPlacement.widthMeters / 2, '水平构图包络没有覆盖区域近端两角')
  assert.strictEqual(
    groundPlacement.distanceConstraintText,
    '水平下限处垂直校核通过',
  )

  const planePlacement = calculateVerticalPlanePlacement(resolveLibraryFov(camera, 0, 'wide'), {
    widthMeters: 6,
    heightMeters: 2.5,
    bottomHeightMeters: 0.8,
    heightMode: 'auto',
    marginRatio: 0.1,
  })
  assert.strictEqual(planePlacement.distanceMeters, 4.63)
  assert.strictEqual(planePlacement.cameraHeightMeters, 2.05)
  assert.strictEqual(planePlacement.frameWidthMeters, 6.6)
  assert.strictEqual(planePlacement.frameHeightMeters, 3.62)
  assert(planePlacement.requiredHorizontalFov <= planePlacement.horizontalFov)
  assert(planePlacement.requiredVerticalFov <= planePlacement.verticalFov)

  const horizontalOnlyPlacement = calculateHorizontalOnlyPlacement(
    resolveLibraryOptics(findByModel(cameras, 'TV-MU650X'), 0, 'wide'),
    {
      sceneMode: 'ground',
      widthMeters: 6,
      depthMeters: 4,
      subjectHeightMeters: 1.8,
      heightMode: 'auto',
      marginRatio: 0.1,
    },
  )
  assert.strictEqual(horizontalOnlyPlacement.cameraSetbackMeters, 2.31)
  assert.strictEqual(horizontalOnlyPlacement.horizontalOnly, true)
  assert.strictEqual(horizontalOnlyPlacement.verticalFov, null)
  assert(horizontalOnlyPlacement.distanceConstraintText.includes('不能校核上下边界'))

  const limiter = calculateLimiter({
    amplifier: findByModel(amplifiers, 'TC-2350B'),
    speaker: findByModel(speakers, 'TS-803C'),
    count: 1,
    wiring: 'parallel',
    mode: 'stereo',
    sensitivityVoltage: 1,
    highPassFrequency: 80,
  })
  assert.strictEqual(limiter.thresholdDbfs, -19.2)
  assert.strictEqual(limiter.attackTimeMs, 8)
  assert.strictEqual(limiter.releaseTimeMs, 128)
  assert.strictEqual(limiter.targetOutputVoltage, 34.64)

  const limiterWithoutTiming = calculateLimiter({
    amplifier: findByModel(amplifiers, 'TC-2350B'),
    speaker: findByModel(speakers, 'TS-803C'),
    count: 1,
    wiring: 'parallel',
    mode: 'stereo',
    sensitivityVoltage: 1,
    highPassFrequency: null,
  })
  assert.strictEqual(limiterWithoutTiming.valid, true)
  assert.strictEqual(limiterWithoutTiming.timingReady, false)
  assert.strictEqual(limiterWithoutTiming.thresholdDbfs, -19.2)
  assert.strictEqual(limiterWithoutTiming.attackTimeMs, undefined)

  const sensitivityGainStructure = calculateGainStructure({
    amplifier: findByModel(amplifiers, 'TC-2350B'),
    inputStage: amplifierInputStages['TC-2350B'],
    selectedStageValue: 1,
  })
  assert.strictEqual(sensitivityGainStructure.valid, true)
  assert.strictEqual(sensitivityGainStructure.fullPowerInputVoltage, 1)
  assert.strictEqual(sensitivityGainStructure.fullPowerInputDbu, 2.21)
  assert.strictEqual(sensitivityGainStructure.dspMaxOutputDbu, 18.4)
  assert.strictEqual(sensitivityGainStructure.targetDspOutputDbu, 12.4)
  assert.strictEqual(sensitivityGainStructure.nominalDspOutputDbu, 0.4)
  assert.strictEqual(sensitivityGainStructure.naturalFullPowerDbfs, -16.19)
  assert.strictEqual(sensitivityGainStructure.recommendedAttenuationDb, 10.19)
  assert.strictEqual(sensitivityGainStructure.nominalDspDbfs, -18)
  assert.strictEqual(sensitivityGainStructure.availableAmplifierHeadroomDb, 12)
  assert.strictEqual(sensitivityGainStructure.alignmentMode, 'attenuate')

  const explicitLegacyCalibration = calculateGainStructure({
    amplifier: findByModel(amplifiers, 'TC-2350B'),
    inputStage: amplifierInputStages['TC-2350B'],
    selectedStageValue: 1,
    dspMaxOutputDbu: 18,
  })
  assert.strictEqual(explicitLegacyCalibration.dspMaxOutputDbu, 18)
  assert.strictEqual(explicitLegacyCalibration.targetDspOutputDbu, 12)
  assert.strictEqual(explicitLegacyCalibration.naturalFullPowerDbfs, -15.79)
  assert.strictEqual(explicitLegacyCalibration.recommendedAttenuationDb, 9.79)

  const twoVoltGainStructure = calculateGainStructure({
    amplifier: findByModel(amplifiers, 'TC-2350B'),
    inputStage: amplifierInputStages['TC-2350B'],
    selectedStageValue: 2,
  })
  assert.strictEqual(twoVoltGainStructure.fullPowerInputDbu, 8.23)
  assert.strictEqual(twoVoltGainStructure.recommendedAttenuationDb, 4.17)

  const sameSensitivityDifferentModel = calculateGainStructure({
    amplifier: findByModel(amplifiers, 'TC-2500B'),
    inputStage: amplifierInputStages['TC-2500B'],
    selectedStageValue: 1,
  })
  assert.strictEqual(
    sameSensitivityDifferentModel.recommendedAttenuationDb,
    sensitivityGainStructure.recommendedAttenuationDb,
    '同为1 V输入灵敏度的不同型号不应产生不同对齐衰减',
  )

  const thresholdCrossingGainStructure = calculateGainStructure({
    amplifier: findByModel(amplifiers, 'TC-41500DT'),
    inputStage: amplifierInputStages['TC-41500DT'],
    selectedStageValue: 12,
  })
  assert.strictEqual(thresholdCrossingGainStructure.fullPowerInputDbu, 12)
  assert.strictEqual(thresholdCrossingGainStructure.naturalFullPowerDbfs, -6.4)
  assert.strictEqual(thresholdCrossingGainStructure.recommendedAttenuationDb, 0.4)
  assert.strictEqual(thresholdCrossingGainStructure.alignmentMode, 'attenuate')

  const directGainStructure = calculateGainStructure({
    amplifier: findByModel(amplifiers, 'TC-41500DT'),
    inputStage: amplifierInputStages['TC-41500DT'],
    selectedStageValue: 12,
    targetPeakDbfs: -6.4,
  })
  assert.strictEqual(directGainStructure.targetDspOutputDbu, 12)
  assert.strictEqual(directGainStructure.naturalFullPowerDbfs, -6.4)
  assert.strictEqual(directGainStructure.recommendedAttenuationDb, 0)
  assert.strictEqual(directGainStructure.alignmentMode, 'direct')

  const shortfallGainStructure = calculateGainStructure({
    amplifier: findByModel(amplifiers, 'TC-41500DT'),
    inputStage: amplifierInputStages['TC-41500DT'],
    selectedStageValue: 12,
    targetPeakDbfs: -12,
  })
  assert.strictEqual(shortfallGainStructure.alignmentMode, 'insufficientDrive')
  assert.strictEqual(shortfallGainStructure.driveShortfallDb, 5.6)
  assert.strictEqual(shortfallGainStructure.recommendedAttenuationDb, 0)

  const voltageGainStructure = calculateGainStructure({
    amplifier: findByModel(amplifiers, 'TC-22000'),
    inputStage: amplifierInputStages['TC-22000'],
    selectedStageValue: 42,
    mode: 'stereo',
    loadImpedance: 8,
  })
  assert.strictEqual(voltageGainStructure.calculationBasis, 'ratedPowerAndVoltageGain')
  assert.strictEqual(voltageGainStructure.amplifierRatedPower, 2000)
  assert.strictEqual(voltageGainStructure.fullPowerInputVoltage, 1.005)
  assert.strictEqual(voltageGainStructure.fullPowerInputDbu, 2.26)
  assert.strictEqual(voltageGainStructure.recommendedAttenuationDb, 10.14)

  const missingStageSelection = calculateGainStructure({
    amplifier: findByModel(amplifiers, 'TC-22000'),
    inputStage: amplifierInputStages['TC-22000'],
    mode: 'stereo',
    loadImpedance: 8,
  })
  assert.strictEqual(missingStageSelection.valid, false)
  assert(missingStageSelection.warning.includes('核对后面板拨码'))

  const unsupportedGainLoad = calculateGainStructure({
    amplifier: findByModel(amplifiers, 'TC-22000'),
    inputStage: amplifierInputStages['TC-22000'],
    selectedStageValue: 42,
    mode: 'stereo',
    loadImpedance: 3,
  })
  assert.strictEqual(unsupportedGainLoad.valid, false)
  assert(unsupportedGainLoad.warning.includes('无法反算3Ω'))

  const invalidDigitalPeak = calculateGainStructure({
    inputStage: amplifierInputStages['TC-2350B'],
    selectedStageValue: 1,
    targetPeakDbfs: 1,
  })
  assert.strictEqual(invalidDigitalPeak.valid, false)

  const manualDefaultGainStructure = calculateGainStructure({
    amplifier: findByModel(amplifiers, 'TC-X2200B'),
    inputStage: amplifierInputStages['TC-X2200B'],
  })
  assert.strictEqual(manualDefaultGainStructure.valid, true)
  assert.strictEqual(manualDefaultGainStructure.selectionSource, 'manualDefault')

  const spl = calculateSpeakerSpl({
    speaker: findByModel(speakers, 'TS-803C'),
    distanceMeters: 4,
    speakerCount: 1,
    summationMode: 'distributed',
  })
  assert.strictEqual(spl.oneMeterSpl, 119.8)
  assert.strictEqual(spl.selectedSpl, 107.7)

  const constantCable = calculateConstantVoltageCable({
    totalPowerW: 100,
    distanceMeters: 100,
    environment: 'indoor',
  })
  assert.strictEqual(constantCable.spec, 'RVV2×0.5 mm²')
  assert.strictEqual(constantCable.designPowerW, 150)
  assert.strictEqual(constantCable.formulaMinimumArea, 0.08)

  const professionalCable = calculateProfessionalSpeakerCable({
    totalPowerW: 300,
    distanceMeters: 50,
  })
  assert.strictEqual(professionalCable.spec, '秋叶原 300 芯×2 金银线')
  assert.strictEqual(professionalCable.currentA, 12)


}

function checkPageControllers() {
  const storage = new Map()
  let clipboard = ''
  let navigationTitle = ''
  let navigatedUrl = ''
  let storageWriteCount = 0
  const storageReadCounts = new Map()
  const storageWriteCounts = new Map()
  const vibrationTypes = []
  const ledPreviews = []
  let systemTheme = 'light'
  let themeChangeHandler = null
  let removedThemeChangeHandler = null
  global.wx = {
    getSystemInfoSync: () => ({ theme: systemTheme }),
    onThemeChange: (handler) => { themeChangeHandler = handler },
    offThemeChange: (handler) => { removedThemeChangeHandler = handler },
    getStorageSync: (key) => {
      storageReadCounts.set(key, (storageReadCounts.get(key) || 0) + 1)
      return storage.get(key)
    },
    getStorageInfoSync: () => ({ currentSize: 128, limitSize: 10240 }),
    setStorageSync: (key, value) => {
      storageWriteCount += 1
      storageWriteCounts.set(key, (storageWriteCounts.get(key) || 0) + 1)
      storage.set(key, value)
    },
    removeStorageSync: (key) => storage.delete(key),
    setClipboardData: ({ data }) => { clipboard = data },
    previewImage: (options) => ledPreviews.push(options),
    setNavigationBarTitle: ({ title }) => { navigationTitle = title },
    showModal: ({ success }) => success({ confirm: true, content: '测试会议室' }),
    showToast: () => {},
    vibrateShort: ({ type }) => vibrationTypes.push(type),
    navigateTo: ({ url }) => { navigatedUrl = url },
    navigateBack: () => {},
    reLaunch: () => {},
  }

  const loadPage = (relativePath) => {
    const file = path.join(root, relativePath)
    let definition = null
    global.Page = (value) => { definition = value }
    delete require.cache[require.resolve(file)]
    require(file)
    assert(definition, `${relativePath} 未注册页面`)
    return {
      ...definition,
      data: JSON.parse(JSON.stringify(definition.data)),
      setData(value, callback) {
        Object.entries(value).forEach(([dataPath, item]) => {
          const segments = dataPath.replace(/\[(\d+)\]/g, '.$1').split('.')
          if (segments.length === 1) {
            this.data[dataPath] = item
            return
          }
          let target = this.data
          segments.slice(0, -1).forEach((segment) => { target = target[segment] })
          target[segments[segments.length - 1]] = item
        })
        if (callback) callback()
      },
    }
  }

  const assertWxmlHandlers = (page, relativePath) => {
    const wxml = expandWxmlIncludes(relativePath)
    const handlers = [...wxml.matchAll(/\b(?:bind|catch)[a-z]+="([^"]+)"/g)]
      .map((match) => match[1])
    handlers.forEach((handler) => {
      assert.strictEqual(typeof page[handler], 'function', `${relativePath} 缺少事件处理：${handler}`)
    })
  }

  storage.set('audioTool.limiter.preferences', {
    amplifierModel: 'TC-2350B',
    speakerModel: 'TS-803C',
    count: 1,
    wiring: 'parallel',
    mode: 'stereo',
    sensitivityVoltage: 1,
    highPassFrequency: 80,
  })
  const limiterPage = loadPage('pages/limiter/limiter.js')
  assertWxmlHandlers(limiterPage, 'pages/limiter/limiter.wxml')
  const limiterSetData = limiterPage.setData
  const writesBeforeLimiterLoad = storageWriteCount
  let limiterInitializationSetDataCount = 0
  limiterPage.setData = function countLimiterInitializationSetData(value, callback) {
    limiterInitializationSetDataCount += 1
    return limiterSetData.call(this, value, callback)
  }
  limiterPage.onLoad()
  limiterPage.setData = limiterSetData
  assert.strictEqual(limiterPage.getRecordLookupPayload().module, 'limiter')
  assert.strictEqual(limiterInitializationSetDataCount, 1, '限幅器初始化仍执行多次视图提交')
  assert.strictEqual(storageWriteCount, writesBeforeLimiterLoad, '限幅器初始化仍把刚读取的偏好重复写回本地')
  assert(!Object.prototype.hasOwnProperty.call(limiterPage.data, 'amplifiers'),
    '限幅器仍把完整功放目录常驻在 Page.data')
  assert(!Object.prototype.hasOwnProperty.call(limiterPage.data, 'speakers'),
    '限幅器仍把完整音箱目录常驻在 Page.data')
  assert.strictEqual(limiterPage.data.selectedAmplifier.model, 'TC-2350B')
  assert.strictEqual(limiterPage.data.selectedSpeaker.model, 'TS-803C')
  const limiterResultText = limiterPage.getResultText()
  assert(limiterResultText.includes('-19.2 dBFS')
    && limiterResultText.includes('0 dBFS = +18.4 dBu')
    && limiterResultText.includes('Attack：8 ms'))
  assert(limiterResultText.includes('结果性质：产品参数计算'))
  assert.strictEqual(limiterPage.getRecordPayload().resultText, limiterResultText,
    '限幅器结果图/可见结果文本之外的记录文本不得分叉')
  const limiterWxml = expandWxmlIncludes('pages/limiter/limiter.wxml')
  assert(limiterWxml.includes('0 dBFS = +18.4 dBu'), '限幅器页面未显示当前 DSP 校准值')
  assert(limiterWxml.includes('bindtap="openSharePreview"')
    && limiterWxml.includes('canvas-id="resultReportCanvas"'),
  '限幅器页面缺少结果图片生成入口或离屏 Canvas')
  assert(limiterWxml.includes('bindtap="shareResultReportImage"')
    && limiterWxml.includes('bindtap="saveResultReportImage"'),
  '限幅器结果图片缺少转发或保存入口')
  assert(limiterWxml.includes('bindtap="onCountStep"')
    && limiterWxml.includes('bindtap="onChoiceTap"'),
  '限幅器数量、功放模式和输入灵敏度必须使用直接可选控件')
  assert((limiterWxml.match(/<page-container\b/g) || []).length === 2
    && limiterWxml.includes('show="{{pageContainerSupported && (selectorVisible || detailsVisible || shareSheetVisible || projectSheetVisible)}}"')
    && limiterWxml.includes('bind:beforeleave="onPageContainerBeforeLeave"')
    && limiterWxml.includes('bind:afterleave="onPageContainerAfterLeave"')
    && limiterWxml.includes('class="editor-navigation-guard"')
    && limiterWxml.includes('bind:beforeleave="onEditorNavigationBeforeLeave"')
    && limiterWxml.includes('bind:afterleave="onEditorNavigationAfterLeave"')
    && limiterWxml.includes('!pageContainerSupported && (selectorVisible || detailsVisible || shareSheetVisible || projectSheetVisible)'),
  '限幅器必须保留互不包裹的编辑返回守卫、原浮层生命周期和旧基础库遮罩回退')
  let limiterReportExportCount = 0
  let exportedLimiterCanvas = null
  const limiterReportContext = new Proxy({}, {
    get: (target, key) => {
      if (key === 'measureText') return (text) => ({ width: String(text).length * 14 })
      if (key === 'draw') return (reserve, callback) => {
        const done = typeof reserve === 'function' ? reserve : callback
        if (done) done()
      }
      return () => {}
    },
  })
  wx.createCanvasContext = (canvasId) => {
    assert.strictEqual(canvasId, 'resultReportCanvas')
    return limiterReportContext
  }
  wx.getFileSystemManager = () => ({ access: ({ success }) => success() })
  wx.canvasToTempFilePath = (options) => {
    limiterReportExportCount += 1
    exportedLimiterCanvas = options
    options.success({ tempFilePath: 'temp://limiter-result.png' })
  }
  let limiterShowLoadingCalls = 0
  wx.showLoading = () => { limiterShowLoadingCalls += 1 }
  wx.hideLoading = () => {}
  limiterPage.onShow()
  limiterPage.openSharePreview()
  assert.strictEqual(limiterShowLoadingCalls, 0, '限幅器图片生成不得打开遮挡关闭按钮的全屏加载蒙层')
  assert.strictEqual(limiterPage.data.resultReportImagePath, 'temp://limiter-result.png')
  assert.strictEqual(limiterPage.data.resultReportPreviewVisible, true)
  assert(exportedLimiterCanvas.destWidth <= 1500 && exportedLimiterCanvas.destHeight <= 4096,
    '限幅器结果图导出尺寸超过安全上限')
  limiterPage.closeResultReportPreview()
  limiterPage.openSharePreview()
  assert.strictEqual(limiterReportExportCount, 1, '相同限幅器结果没有复用已生成图片')
  limiterPage.closeSharePreview()
  const thresholdOnlyResult = limiterPage.commitInput({ highPassFrequencyIndex: 0 })
  assert.strictEqual(thresholdOnlyResult.valid, true)
  assert.strictEqual(thresholdOnlyResult.timingReady, false)
  assert.strictEqual(limiterPage.data.resultReportImagePath, '', '限幅器参数变化后仍沿用旧结果图片')
  assert(limiterPage.getResultText().includes('-19.2 dBFS'))
  assert(!limiterPage.getResultText().includes('Attack：'))
  assert(!limiterPage.getRecordPayload().summary.includes('Attack'))
  delete wx.createCanvasContext
  delete wx.getFileSystemManager
  delete wx.canvasToTempFilePath
  delete wx.showLoading
  delete wx.hideLoading
  limiterPage.toggleCurrentFavorite()
  assert.strictEqual(limiterPage.data.currentFavorite, true)
  limiterPage.openEquipmentSelector({ currentTarget: { dataset: { type: 'amplifier' } } })
  assert(limiterPage.data.selectorItems.every((item) => !item.stereoPower && !item.source),
    '限幅器功放选择器仍传入完整产品资料')
  limiterPage.openEquipmentDetail({ currentTarget: { dataset: { model: 'TC-2350B' } } })
  assert.strictEqual(navigatedUrl, '/pages/products/detail?type=amplifier&model=TC-2350B')
  limiterPage.openEquipmentSelector({ currentTarget: { dataset: { type: 'speaker' } } })
  assert.strictEqual(limiterPage.data.selectorItems.length, 60, '限幅器音箱选择器未按首批 60 条渲染')
  assert(limiterPage.data.selectorTotalCount > limiterPage.data.selectorItems.length)
  limiterPage.appendSelectorItems()
  assert.strictEqual(limiterPage.data.selectorItems.length, 120, '限幅器音箱选择器滚动后未追加第二批')

  const splPage = loadPage('pages/spl/spl.js')
  assertWxmlHandlers(splPage, 'pages/spl/spl.wxml')
  const splSetData = splPage.setData
  const writesBeforeSplLoad = storageWriteCount
  let splInitializationSetDataCount = 0
  splPage.setData = function countSplInitializationSetData(value, callback) {
    splInitializationSetDataCount += 1
    return splSetData.call(this, value, callback)
  }
  splPage.onLoad()
  splPage.setData = splSetData
  assert.strictEqual(splPage.getRecordLookupPayload().module, 'spl')
  assert.strictEqual(splInitializationSetDataCount, 1, '声压级页面初始化仍执行多次视图提交')
  assert.strictEqual(storageWriteCount, writesBeforeSplLoad, '声压级页面初始化仍把刚读取的偏好重复写回本地')
  assert(!Object.prototype.hasOwnProperty.call(splPage.data, 'speakers'),
    '声压级页面仍把完整音箱目录常驻在 Page.data')
  assert.strictEqual(splPage.data.selectedSpeaker.model, 'TS-803C')
  splPage.copyResult()
  assert(clipboard.includes('107.7 dB SPL'))
  assert(clipboard.includes('结果性质：自由场理论估算'))
  const splWxml = expandWxmlIncludes('pages/spl/spl.wxml')
  assert(splWxml.includes('bindtap="openSharePreview"')
    && splWxml.includes('canvas-id="resultReportCanvas"'),
  '声压级页面缺少结果图片生成入口或离屏 Canvas')
  assert(splWxml.includes('bindtap="shareResultReportImage"')
    && splWxml.includes('bindtap="saveResultReportImage"')
    && splWxml.includes('bindtap="saveProjectConfiguration"'),
  '声压级结果图片缺少转发或保存入口')
  let splReportExportCount = 0
  let exportedSplCanvas = null
  const splReportContext = new Proxy({}, {
    get: (target, key) => {
      if (key === 'measureText') return (text) => ({ width: String(text).length * 14 })
      if (key === 'draw') return (reserve, callback) => {
        const done = typeof reserve === 'function' ? reserve : callback
        if (done) done()
      }
      return () => {}
    },
  })
  wx.createCanvasContext = (canvasId) => {
    assert.strictEqual(canvasId, 'resultReportCanvas')
    return splReportContext
  }
  wx.canvasToTempFilePath = (options) => {
    splReportExportCount += 1
    exportedSplCanvas = options
    options.success({ tempFilePath: 'temp://spl-result.png' })
  }
  let splCacheAccessPath = ''
  wx.getFileSystemManager = () => ({ access: ({ path, success }) => { splCacheAccessPath = path; success() } })
  wx.showLoading = () => {}
  wx.hideLoading = () => {}
  splPage.onShow()
  const originalSplSetTimeout = global.setTimeout
  const originalSplClearTimeout = global.clearTimeout
  const splTimers = []
  global.setTimeout = (callback, delay) => {
    const timer = { callback, delay, cleared: false }
    splTimers.push(timer)
    return timer
  }
  global.clearTimeout = (timer) => { if (timer) timer.cleared = true }
  assert.strictEqual(splPage.openSharePreview(), true, '声压级分享预览未能打开')
  assert.strictEqual(splPage.data.resultReportImagePath, 'temp://spl-result.png')
  assert.strictEqual(splPage.data.shareSheetVisible, true)
  assert.strictEqual(splPage.data.resultReportPreviewVisible, true)
  assert(exportedSplCanvas.destWidth <= 1500 && exportedSplCanvas.destHeight <= 4096,
    '声压级结果图导出尺寸超过安全上限')
  assert.strictEqual(splPage.openSharePreview(), false, '重复打开声压级分享预览未被阻止')
  assert.strictEqual(splPage.closeSharePreview(), true, '声压级分享预览未能关闭')
  const splCloseTimer = splTimers.find((timer) => timer.delay === 320 && !timer.cleared)
  assert(splCloseTimer, '声压级分享关闭动画没有 320ms 生命周期')
  assert.strictEqual(splPage.openSharePreview(), false, '关闭动画期间声压级分享预览仍可重开')
  splCloseTimer.callback()
  assert.strictEqual(splPage.data.shareSheetVisible, false)
  assert.strictEqual(splPage.openSharePreview(), true, '声压级分享预览关闭后无法重新打开')
  assert.strictEqual(splCacheAccessPath, 'temp://spl-result.png', '声压级重新打开没有校验缓存文件')
  assert.strictEqual(splPage.data.resultReportPreviewVisible, true)
  assert.strictEqual(splReportExportCount, 1, '相同声压级结果没有复用已生成图片')
  assert.strictEqual(splPage.closeSharePreview({ silent: true }), true)
  global.setTimeout = originalSplSetTimeout
  global.clearTimeout = originalSplClearTimeout
  splPage.openSpeakerSelector()
  assert.strictEqual(splPage.data.selectorItems.length, 60, '声压级音箱选择器未按首批 60 条渲染')
  assert(splPage.data.selectorTotalCount > splPage.data.selectorItems.length)
  assert(splPage.data.selectorItems.every((item) => !item.ratedPower && !item.source),
    '声压级选择器仍传入完整音箱产品资料')
  splPage.appendSelectorItems()
  assert.strictEqual(splPage.data.selectorItems.length, 120, '声压级音箱选择器滚动后未追加第二批')
  splPage.openSpeakerDetail({ currentTarget: { dataset: { model: 'TS-803C' } } })
  assert.strictEqual(navigatedUrl, '/pages/products/detail?type=speaker&model=TS-803C')
  splPage.onDistanceInput({ detail: { value: '5' } })
  assert.strictEqual(splPage.data.result.distanceMeters, 4, '声压级输入尚未结束就进行了完整计算')
  splPage.onDistanceBlur()
  assert.strictEqual(splPage.data.result.distanceMeters, 5, '声压级输入结束后未立即刷新计算')
  assert.strictEqual(splPage.data.resultReportImagePath, '', '声压级参数变化后仍沿用旧结果图片')
  delete wx.createCanvasContext
  delete wx.canvasToTempFilePath
  delete wx.getFileSystemManager
  delete wx.showLoading
  delete wx.hideLoading
  splPage.onDistanceInput({ detail: { value: '4' } })
  splPage.onDistanceBlur()
  const writesBeforeRepeatedSplCalculation = storageWriteCount
  splPage.calculate()
  assert.strictEqual(storageWriteCount, writesBeforeRepeatedSplCalculation, '相同声压级状态仍重复写入偏好')

  const cablePage = loadPage('pages/cable/cable.js')
  assertWxmlHandlers(cablePage, 'pages/cable/cable.wxml')
  const cableSetData = cablePage.setData
  let cableInitializationSetDataCount = 0
  cablePage.setData = function countCableInitializationSetData(value, callback) {
    cableInitializationSetDataCount += 1
    return cableSetData.call(this, value, callback)
  }
  cablePage.onLoad()
  cablePage.setData = cableSetData
  assert.strictEqual(cablePage.getRecordLookupPayload().module, 'cable')
  assert.strictEqual(cableInitializationSetDataCount, 1, '线材页面初始化仍执行多次视图提交')
  cablePage.copyResult()
  assert(clipboard.includes('RVV2×0.5 mm²'))
  assert(clipboard.includes('结果性质：公司标准推荐'))
  const cableWxml = expandWxmlIncludes('pages/cable/cable.wxml')
  assert(cableWxml.includes('bindtap="generateResultReportImage"')
    && cableWxml.includes('canvas-id="resultReportCanvas"'),
  '线材页面缺少结果图片生成入口或离屏 Canvas')
  assert(cableWxml.includes('bindtap="shareResultReportImage"')
    && cableWxml.includes('bindtap="saveResultReportImage"'),
  '线材结果图片缺少转发或保存入口')
  let cableReportExportCount = 0
  let exportedCableCanvas = null
  const cableReportContext = new Proxy({}, {
    get: (target, key) => {
      if (key === 'measureText') return (text) => ({ width: String(text).length * 14 })
      if (key === 'draw') return (reserve, callback) => {
        const done = typeof reserve === 'function' ? reserve : callback
        if (done) done()
      }
      return () => {}
    },
  })
  wx.createCanvasContext = (canvasId) => {
    assert.strictEqual(canvasId, 'resultReportCanvas')
    return cableReportContext
  }
  wx.canvasToTempFilePath = (options) => {
    cableReportExportCount += 1
    exportedCableCanvas = options
    options.success({ tempFilePath: 'temp://cable-result.png' })
  }
  wx.showLoading = () => {}
  wx.hideLoading = () => {}
  cablePage.generateResultReportImage()
  assert.strictEqual(cablePage.data.resultReportImagePath, 'temp://cable-result.png')
  assert.strictEqual(cablePage.data.resultReportPreviewVisible, true)
  assert(exportedCableCanvas.destWidth <= 1500 && exportedCableCanvas.destHeight <= 4096,
    '线材结果图导出尺寸超过安全上限')
  cablePage.closeResultReportPreview()
  cablePage.generateResultReportImage()
  assert.strictEqual(cableReportExportCount, 1, '相同线材结果没有复用已生成图片')
  cablePage.onInput({
    currentTarget: { dataset: { field: 'constantPowerText' } },
    detail: { value: '120' },
  })
  assert.strictEqual(cablePage.data.result.designPowerW, 150, '线材输入尚未结束就进行了完整计算')
  cablePage.onInputBlur()
  assert.strictEqual(cablePage.data.result.designPowerW, 180, '线材输入结束后未立即刷新计算')
  assert.strictEqual(cablePage.data.resultReportImagePath, '', '线材参数变化后仍沿用旧结果图片')
  delete wx.createCanvasContext
  delete wx.canvasToTempFilePath
  delete wx.showLoading
  delete wx.hideLoading

  const gainPage = loadPage('pages/gain-structure/gain-structure.js')
  assertWxmlHandlers(gainPage, 'pages/gain-structure/gain-structure.wxml')
  const gainWxml = expandWxmlIncludes('pages/gain-structure/gain-structure.wxml')
  const gainWxss = fs.readFileSync(path.join(root, 'pages/gain-structure/gain-structure.wxss'), 'utf8').replace(/\s+/g, '')
  for (const [file, tool] of [
    ['pages/cable/cable.wxml', 'cable'],
    ['pages/camera/camera.wxml', 'camera'],
    ['pages/led-screen/led-screen.wxml', 'ledScreen'],
    ['pages/spl/spl.wxml', 'spl'],
    ['pages/limiter/limiter.wxml', 'limiter'],
  ]) {
    const source = fs.readFileSync(path.join(root, file), 'utf8')
    assert(!source.includes('basis-detail-link')
      && !source.includes('/pages/basis/detail?tool=' + tool)
      && !source.includes('查看计算依据'),
    file + ' 的结果区不应显示计算依据入口')
  }
  assert(!gainWxml.includes('basis-detail-link')
    && !gainWxml.includes('/pages/basis/detail?tool=gainStructure')
    && /\.result-pane\{[^}]*display:flex;[^}]*flex-direction:column;/.test(gainWxss)
    && /\.result-card\{[^}]*width:100%;/.test(gainWxss)
    && /\.action-rail\{[^}]*position:absolute;/.test(gainWxss),
  '增益结构结果区应纵向占满结果面板，操作栏悬浮，页面不放计算依据入口')
  assert(gainWxml.includes('0 dBFS = +18.4 dBu'), '增益结构页面未显示当前 DSP 校准值')
  assert(!gainWxml.includes('功放输入旋钮'), '增益结构页面仍使用不适用于屏幕或软件控制的旧称呼')
  assert(!gainWxml.includes('bindtap="calculate"')
    && !gainWxml.includes('calculate-button')
    && !gainWxml.includes('重新计算')
    && !gainWxml.includes('再计算'),
  '增益结构有效输入应自动更新，页面不能保留手动计算入口')
  assert(gainWxml.includes('calculationState === \'incomplete\'')
    && gainWxml.includes('输入完整后结果会自动更新'),
  '增益结构缺失依赖时应持续提示并清除旧结果')
  storage.set('audioTool.gainStructure.preferences', {
    amplifierModel: 'TC-X2200B', stageValue: 1, mode: 'stereo',
    loadImpedance: null, targetPeakDbfs: -6,
  })
  const gainSetData = gainPage.setData
  const writesBeforeGainLoad = storageWriteCount
  let gainInitializationSetDataCount = 0
  gainPage.setData = function countGainInitializationSetData(value, callback) {
    gainInitializationSetDataCount += 1
    return gainSetData.call(this, value, callback)
  }
  gainPage.onLoad()
  gainPage.setData = gainSetData
  assert.strictEqual(gainPage.getRecordLookupPayload().module, 'gainStructure')
  assert.strictEqual(gainInitializationSetDataCount, 1, '增益结构初始化仍执行多次视图提交')
  assert.strictEqual(storageWriteCount, writesBeforeGainLoad, '增益结构初始化仍把刚读取的偏好重复写回本地')
  assert.strictEqual(gainPage.data.selectedAmplifier.model, 'TC-X2200B')
  assert.strictEqual(gainPage.data.amplifiers, undefined, '增益架构仍把完整功放库常驻页面数据')
  assert.strictEqual(gainPage.data.selectorItems.length, 0, '增益架构初始化仍把完整搜索列表传入视图层')
  assert.strictEqual(gainPage.data.stageOptions[gainPage.data.stageIndex].value, 1)
  assert.strictEqual(gainPage.data.result.recommendedAttenuationDb, 10.19)
  const originalGainSetData = gainPage.setData
  let unchangedGainSetDataCount = 0
  gainPage.setData = function countUnchangedGainSetData(value, callback) {
    unchangedGainSetDataCount += 1
    return originalGainSetData.call(this, value, callback)
  }
  gainPage.onTargetPeakTap({ currentTarget: { dataset: { index: gainPage.data.targetPeakIndex } } })
  gainPage.setData = originalGainSetData
  assert.strictEqual(unchangedGainSetDataCount, 0, '重复选择当前增益结构选项仍触发视图与存储更新')
  gainPage.copyResult()
  assert(clipboard.includes('系统增益结构助手'))
  assert(clipboard.includes('DSP 标定：0 dBFS = +18.4 dBu'))
  assert(clipboard.includes('系统对齐衰减：10.19 dB'))
  assert(clipboard.includes('DSP 输入表目标：节目峰值约 -6 dBFS'))
  assert(clipboard.includes('DSP 最终输出增益：-10.19 dB'))
  assert(clipboard.includes('功放输入电平控制：0 dB 衰减'))
  assert(clipboard.includes('不要重复衰减'))
  assert(clipboard.includes('相同衰减不代表相同功放功率'))
  assert(clipboard.includes('设置限幅保护'))
  assert(gainWxml.includes('bindtap="openSharePreview"')
    && gainWxml.includes('canvas-id="resultReportCanvas"'),
  '增益架构页面缺少结果图片生成入口或离屏 Canvas')
  assert(gainWxml.includes('bindtap="shareResultReportImage"')
    && gainWxml.includes('bindtap="saveResultReportImage"'),
  '增益架构结果图片缺少转发或保存入口')
  let gainReportExportCount = 0
  let exportedGainCanvas = null
  const gainReportContext = new Proxy({}, {
    get: (target, key) => {
      if (key === 'measureText') return (text) => ({ width: String(text).length * 14 })
      if (key === 'draw') return (reserve, callback) => {
        const done = typeof reserve === 'function' ? reserve : callback
        if (done) done()
      }
      return () => {}
    },
  })
  wx.createCanvasContext = (canvasId) => {
    assert.strictEqual(canvasId, 'resultReportCanvas')
    return gainReportContext
  }
  wx.canvasToTempFilePath = (options) => {
    gainReportExportCount += 1
    exportedGainCanvas = options
    options.success({ tempFilePath: 'temp://gain-result.png' })
  }
  wx.getFileSystemManager = () => ({ access: ({ success }) => success() })
  wx.showLoading = () => {}
  wx.hideLoading = () => {}
  gainPage.openSharePreview()
  assert.strictEqual(gainPage.data.resultReportImagePath, 'temp://gain-result.png')
  assert.strictEqual(gainPage.data.resultReportPreviewVisible, true)
  assert(exportedGainCanvas.destWidth <= 1500 && exportedGainCanvas.destHeight <= 4096,
    '增益架构结果图导出尺寸超过安全上限')
  gainPage.closeSharePreview()
  gainPage.openSharePreview()
  assert.strictEqual(gainReportExportCount, 1, '相同增益架构结果没有复用已生成图片')
  gainPage.onTargetPeakTap({ currentTarget: { dataset: { index: 0 } } })
  assert.strictEqual(gainPage.data.resultReportImagePath, '', '增益架构参数变化后仍沿用旧结果图片')
  assert.strictEqual(gainPage.data.result.valid, true,
    '增益架构参数变化后应立即导出当前计算结果')
  assert.strictEqual(gainPage.getRecordPayload().preferences.targetPeakDbfs, -3,
    '自动推导后的记录 payload 应使用新的目标峰值')
  gainPage.onTargetPeakTap({ currentTarget: { dataset: { index: 1 } } })
  delete wx.createCanvasContext
  delete wx.canvasToTempFilePath
  delete wx.getFileSystemManager
  delete wx.showLoading
  delete wx.hideLoading
  assert.strictEqual(gainPage.getRecordPayload().module, 'gainStructure',
    '完整输入的自动推导结果应立即生成记录 payload')
  gainPage.calculate()
  const gainPayload = gainPage.getRecordPayload()
  assert.strictEqual(gainPayload.module, 'gainStructure')
  assert.strictEqual(gainPage.data.result.executionMode, 'dsp')
  const writesBeforeRepeatedGainCalculation = storageWriteCount
  gainPage.calculate()
  assert.strictEqual(storageWriteCount, writesBeforeRepeatedGainCalculation, '相同增益结构状态仍重复写入偏好')
  gainPage.openAmplifierDetail({ currentTarget: { dataset: { model: 'TC-X2200B' } } })
  assert.strictEqual(navigatedUrl, '/pages/products/detail?type=amplifier&model=TC-X2200B')

  gainPage.openAmplifierSelector()
  assert.strictEqual(gainPage.data.selectorTotalCount, amplifiers.length)
  assert.strictEqual(gainPage.data.selectorItems.length, Math.min(60, amplifiers.length))
  gainPage.closeAmplifierSelector()
  assert.strictEqual(gainPage.data.selectorItems.length, 0)

  const noDefaultIndex = amplifiers.findIndex((item) => item.model === 'TC-2350B')
  gainPage.selectAmplifier({ currentTarget: { dataset: { index: noDefaultIndex } } })
  assert.strictEqual(gainPage.data.stageIndex, -1)
  assert.strictEqual(gainPage.data.result, null)
  assert.strictEqual(gainPage.data.calculationState, 'incomplete')
  gainPage.onStageTap({ currentTarget: { dataset: { index: 0 } } })
  assert.strictEqual(gainPage.data.result.valid, true)

  const voltageGainIndex = amplifiers.findIndex((item) => item.model === 'TC-22000')
  gainPage.selectAmplifier({ currentTarget: { dataset: { index: voltageGainIndex } } })
  gainPage.onStageTap({ currentTarget: { dataset: { index: 0 } } })
  assert.strictEqual(gainPage.data.result, null)
  gainPage.onLoadChange({ detail: { value: '1' } })
  assert.strictEqual(gainPage.data.result.valid, true)
  assert.strictEqual(gainPage.data.result.calculationBasis, 'ratedPowerAndVoltageGain')

  const lightingWorkspace = require('../pages/dmx-layout/lighting-workspace')
  const { createGroup, buildPreferences } = require('../pages/dmx-address/group-input')
  const dmxWorkspaceBeforeLoad = lightingWorkspace.readLightingWorkspace()
  assert.strictEqual(dmxWorkspaceBeforeLoad.ok, true, 'DMX canonical fixture workspace could not be read')
  assert.strictEqual(dmxWorkspaceBeforeLoad.contextId, lightingWorkspace.TEMPORARY_CONTEXT_ID)
  const canonicalFixtureGroup = createGroup(1, {
    fixtureSource: 'library',
    fixtureModel: 'TL-SE3401',
    libraryChannelCount: 16,
    channelCount: '16',
    fixtureCount: '4',
    targetUniverse: 'A',
  })
  assert.strictEqual(canonicalFixtureGroup.fixtureModel, 'TL-SE3401')
  assert.strictEqual(canonicalFixtureGroup.libraryChannelCount, '16')
  const canonicalFixturePreferences = buildPreferences({
    groups: [canonicalFixtureGroup],
    startAddressText: '1',
    allocationMode: 'auto',
  })
  const canonicalFixtureScheme = lightingWorkspace.createLightingScheme(canonicalFixturePreferences)
  assert(canonicalFixtureScheme, 'canonical DMX fixture scheme could not be created')
  const canonicalFixtureSave = lightingWorkspace.saveLightingScheme(
    dmxWorkspaceBeforeLoad.contextId,
    canonicalFixtureScheme,
    dmxWorkspaceBeforeLoad.revision,
  )
  assert.strictEqual(canonicalFixtureSave.ok, true, 'canonical DMX fixture workspace could not be saved')

  const stableCheckFixtureGroups = [
    createGroup(1, {
      fixtureSource: 'library', fixtureModel: 'TL-SE3401', libraryChannelCount: 16,
      channelCount: '16', fixtureCount: '2', targetUniverse: 'A',
    }),
    createGroup(2, {
      fixtureSource: 'library', fixtureModel: 'TL-SE3401', libraryChannelCount: 16,
      channelCount: '16', fixtureCount: '2', targetUniverse: 'B',
    }),
  ]
  const stableCheckFixturePreferences = buildPreferences({
    groups: stableCheckFixtureGroups,
    startAddressText: '1',
    allocationMode: 'manual',
  })
  const stableCheckFixtureScheme = lightingWorkspace.createLightingScheme(stableCheckFixturePreferences)
  assert(stableCheckFixtureScheme, 'stableId address-check fixture scheme could not be created')
  const stableCheckWorkspaceBeforeSeed = lightingWorkspace.readLightingWorkspace(lightingWorkspace.TEMPORARY_CONTEXT_ID)
  assert(stableCheckWorkspaceBeforeSeed.ok, 'stableId address-check fixture workspace could not be read')
  const stableCheckSeed = lightingWorkspace.saveLightingScheme(
    stableCheckWorkspaceBeforeSeed.contextId,
    stableCheckFixtureScheme,
    stableCheckWorkspaceBeforeSeed.revision,
  )
  assert(stableCheckSeed.ok, 'stableId address-check fixture scheme could not be saved')
  const stableCheckPage = loadPage('pages/dmx-address/dmx-address.js')
  stableCheckPage.onLoad()
  stableCheckPage.onShow()
  assert.strictEqual(stableCheckPage.data.result.totalFixtures, 4)
  const stableCheckContextId = stableCheckPage._contextId
  stableCheckPage.openFloatingCard({ currentTarget: { dataset: { index: 0 } } })
  const stableAChip = stableCheckPage.data.floatingGroup.fixtureChips.find((chip) => chip.addressText === 'A001')
  assert(stableAChip && stableAChip.stableId, 'current address chip did not expose A001 stable identity')
  const stableCheckBeforeA = lightingWorkspace.readLightingWorkspace(stableCheckContextId)
  assert(stableCheckBeforeA.ok, 'A001 check could not read its public workspace')
  assert.deepStrictEqual(Object.keys(stableCheckBeforeA.scheme.checksById), [], 'stableId check fixture must begin unchecked')
  stableCheckPage.toggleFixtureCheck({
    currentTarget: { dataset: { stableId: stableAChip.stableId, globalIndex: stableAChip.globalIndex } },
  })
  const stableCheckAfterA = lightingWorkspace.readLightingWorkspace(stableCheckContextId)
  assert(stableCheckAfterA.scheme.checksById[stableAChip.stableId], 'A001 check was not persisted through the current chip handler')
  stableCheckPage.openFloatingCard({ currentTarget: { dataset: { index: 1 } } })
  const stableBChip = stableCheckPage.data.floatingGroup.fixtureChips.find((chip) => chip.addressText === 'B001')
  assert(stableBChip && stableBChip.stableId, 'current address chip did not expose B001 stable identity')
  stableCheckPage.toggleFixtureCheck({
    currentTarget: { dataset: { stableId: stableBChip.stableId, globalIndex: stableBChip.globalIndex } },
  })
  const stableCheckAfterAAndB = lightingWorkspace.readLightingWorkspace(stableCheckContextId)
  assert.deepStrictEqual(
    Object.keys(stableCheckAfterAAndB.scheme.checksById).sort(),
    [stableAChip.stableId, stableBChip.stableId].sort(),
    'A001 and B001 must both persist as separate address checks',
  )
  stableCheckPage.openFloatingCard({ currentTarget: { dataset: { index: 0 } } })
  const restoredAChip = stableCheckPage.data.floatingGroup.fixtureChips.find((chip) => chip.addressText === 'A001')
  assert.strictEqual(restoredAChip.checked, true, 'A001 current chip did not restore its checked state')
  stableCheckPage.toggleFixtureCheck({
    currentTarget: { dataset: { stableId: restoredAChip.stableId, globalIndex: restoredAChip.globalIndex } },
  })
  const stableCheckAfterClearA = lightingWorkspace.readLightingWorkspace(stableCheckContextId)
  assert.deepStrictEqual(
    Object.keys(stableCheckAfterClearA.scheme.checksById),
    [stableBChip.stableId],
    'clearing A001 by its current chip must preserve the unrelated B001 check',
  )
  assert.strictEqual(stableCheckPage.data.floatingGroup.fixtureChips.find((chip) => chip.addressText === 'A001').checked, false)
  const canonicalFixtureRestore = lightingWorkspace.saveLightingScheme(
    stableCheckContextId,
    canonicalFixtureScheme,
    stableCheckAfterClearA.revision,
  )
  assert(canonicalFixtureRestore.ok, 'canonical DMX fixture workspace could not be restored after stableId check coverage')
  stableCheckPage.onHide()

  const dmxPage = loadPage('pages/dmx-address/dmx-address.js')
  assertWxmlHandlers(dmxPage, 'pages/dmx-address/dmx-address.wxml')
  const dmxAddressJs = fs.readFileSync(path.join(root, 'pages/dmx-address/dmx-address.js'), 'utf8')
  const dmxWxml = fs.readFileSync(path.join(root, 'pages/dmx-address/dmx-address.wxml'), 'utf8')
  const dmxWxss = fs.readFileSync(path.join(root, 'pages/dmx-address/dmx-address.wxss'), 'utf8')
  const dmxResultViewJs = fs.readFileSync(path.join(root, 'pages/dmx-address/result-view.js'), 'utf8')
  const dmxLayoutWxml = fs.readFileSync(path.join(root, 'pages/dmx-layout/dmx-layout.wxml'), 'utf8')
  const dmxLayoutFactory = fs.readFileSync(path.join(root, 'pages/dmx-layout/page-factory.js'), 'utf8')
  const dmxLayoutExportController = fs.readFileSync(path.join(root, 'pages/dmx-layout/layout-export-controller.js'), 'utf8')
  const dmxLayoutInteractions = fs.readFileSync(path.join(root, 'pages/dmx-layout/layout-interactions.js'), 'utf8')
  const dmxLayoutSettings = fs.readFileSync(path.join(root, 'pages/dmx-layout/layout-settings.js'), 'utf8')
  assert(dmxResultViewJs.includes('CHANNEL_GUIDE_FIXTURE_MODELS')
    && dmxAddressJs.includes('getChannelGuideApi')
    && !dmxAddressJs.includes('hasDmxChannelProfile')
    && !dmxAddressJs.includes('getDmxChannelProfile'),
  'DMX 结果视图未使用轻量 Set 标记通道资料可用性，或仍存在顶层 profile 查询')
  assert(!dmxWxss.includes('fixture-channel-guide-modes')
    && !dmxWxss.includes('fixture-channel-guide-mode {')
    && !dmxWxss.includes('fixture-channel-guide-mode-active'),
  'DMX 通道速查仍残留未使用的模式切换样式')
  assert(dmxWxml.includes('bindtap="openFixtureLayout"')
    && dmxAddressJs.includes('openFixtureLayout()')
    && dmxAddressJs.includes('lightingContextId=${encodeURIComponent(this._contextId)}')
    && dmxLayoutWxml.includes('bindtap="generateLayoutImage"')
    && dmxLayoutWxml.includes('bindtap="previewImage"')
    && dmxLayoutWxml.includes('bindtap="shareImage"')
    && dmxLayoutWxml.includes('bindtap="saveImage"')
    && dmxLayoutFactory.includes("require('./layout-export-controller')")
    && dmxLayoutFactory.includes('createLayoutExportMethods({')
    && dmxLayoutFactory.includes('...layoutExportMethods')
    && dmxLayoutExportController.includes('generateLayoutImage()')
    && dmxLayoutExportController.includes('previewImage()')
    && dmxLayoutExportController.includes('shareImage()')
    && dmxLayoutExportController.includes('saveImage()'),
  'DMX 统一布局图未从地址页连通到生成、预览、转发与保存动作')
  assert(!dmxWxml.includes('class="notice-card"')
    && !dmxWxml.includes('域尾保留地址')
    && !dmxWxss.includes('.notice-card'),
  'DMX 编址结果仍渲染重复的域尾保留地址提示卡')
  assert(!dmxWxml.includes('方案汇总')
    && !dmxWxml.includes('class="result-summary-section"')
    && !dmxWxss.includes('.result-summary-section'),
  'DMX 地址方案仍渲染重复的方案汇总信息')
  assert(dmxWxml.includes('class="fixture-thumb" data-index="{{groupIndex}}" bindtap="openFloatingCard"')
    && dmxWxml.includes('class="address-chips address-chips-preview"')
    && dmxWxml.includes('class="floating-backdrop" bindtap="closeFloatingCard"')
    && dmxWxml.includes('bindchange="onCardModeChange"')
    && dmxWxml.includes('bindinput="onCardQuantityInput"')
    && dmxWxml.includes('bindblur="onCardQuantityBlur"')
    && dmxWxml.includes('wx:for="{{floatingGroup.fixtureChips}}"')
    && dmxWxml.includes('data-stable-id="{{chip.stableId}}"')
    && dmxWxml.includes('bindtap="toggleFixtureCheck"')
    && dmxWxml.includes('bindtouchend="onFloatingTouchEnd"')
    && !dmxWxml.includes('class="group-editor-summary"')
    && !dmxWxml.includes('class="group-editor-overlay"')
    && !dmxWxml.includes('class="group-editor-row'),
  'DMX 灯具组编辑必须符合当前浮卡交互契约')
  assert(dmxWxml.includes('class="context-row"')
    && dmxWxml.includes('bindchange="onLightingContextChange"')
    && dmxWxml.includes('class="add-group-button')
    && dmxWxml.includes('bindtap="addGroup"')
    && dmxWxml.includes('class="fixture-search-row')
    && dmxWxml.includes('bindtap="selectFixture"')
    && dmxAddressJs.includes("this.resetFixturePicker('search', { fixtureSearchGroupIndex: -1 })")
    && dmxWxml.includes('class="layout-entry" bindtap="openFixtureLayout"'),
  'DMX 现场方案、单型号灯组添加入口或灯位图导航结构不完整')
  assert(/<view\b[^>]*class="page-title"[^>]*>灯具编址<\/view>/.test(dmxWxml)
    && !dmxWxml.includes('class="hero"')
    && !dmxWxml.includes('class="hero-title"')
    && !dmxWxml.includes('class="hero-subtitle"')
    && !dmxWxml.includes('查看地址方案')
    && !dmxWxml.includes('class="plan-workspace-head"')
    && !dmxWxml.includes('class="plan-workspace-title"')
    && !dmxWxml.includes('class="plan-workspace-back"')
    && !dmxWxml.includes('修改配置')
    && !dmxWxml.includes('class="workspace-primary-action"')
    && !dmxWxss.includes('.workspace-primary-action'),
  'DMX 配置页仍保留重复的标题说明或地址方案跳转按钮')
  ;[
    'group-order-note',
    'plan-workspace-note',
    'dmx-solution-actions-note',
    'dmx-layout-entry-note',
    'group-editor-sheet-note',
    'fixture-search-subtitle',
    'result-report-preview-subtitle',
  ].forEach((className) => assert(!dmxWxml.includes(className), `DMX 页面标题仍保留解释小字：${className}`))
  const dmxSetData = dmxPage.setData
  let dmxInitializationSetDataCount = 0
  dmxPage.setData = function countDmxInitializationSetData(value, callback) {
    dmxInitializationSetDataCount += 1
    return dmxSetData.call(this, value, callback)
  }
  dmxPage.onLoad()
  dmxPage.setData = dmxSetData
  assert.strictEqual(dmxPage.getRecordLookupPayload().module, 'dmxAddress')
  assert.strictEqual(dmxInitializationSetDataCount, 1, 'DMX 编址初始化仍执行多次视图提交')
  assert.strictEqual(dmxPage.data.result.totalFixtures, 4)
  assert.strictEqual(dmxPage.data.result.nextText, 'A065')
  assert.strictEqual(dmxPage.data.result.universes.length, 4)
  assert.strictEqual(dmxPage.data.result.selectedUniverse.label, 'A')
  assert.strictEqual(dmxPage.data.result.selectedUniverse.fixtureCount, 4)
  assert.strictEqual(dmxPage.data.result.selectedUniverse.detailGroups.length, 0)
  assert.strictEqual(dmxPage.data.fixtureSearchTotal, 0)
  assert.deepStrictEqual(dmxPage.data.fixtureSearchResults, [], 'DMX 页面关闭搜索时仍常驻灯具结果')
  dmxPage.onShow()
  dmxPage.openFloatingCard({ currentTarget: { dataset: { index: 0 } } })
  assert.strictEqual(dmxPage.data.floatingVisible, true, '打开灯具组预览卡后未显示浮卡')
  assert.strictEqual(dmxPage.data.floatingGroup.groupIndex, 0, '浮卡未对应选中的灯具组')
  dmxPage.closeFloatingCard()
  assert.strictEqual(dmxPage._floatingClosing, true, '点击浮卡背景后未启动关闭生命周期')
  assert.strictEqual(dmxPage.data.allocationMode, 'auto')
  assert.strictEqual(dmxPage.data.groups[0].targetUniverse, 'A')
  assert.strictEqual(dmxPage._calculationResult.fixtures[0].addressText, 'A001')
  dmxPage.switchAllocationMode({ currentTarget: { dataset: { mode: 'manual' } } })
  assert.strictEqual(dmxPage.data.pendingChange.kind, 'allocationMode')
  assert.strictEqual(dmxPage.data.pendingChange.valid, true)
  assert.strictEqual(dmxPage.data.allocationMode, 'auto', '确认前不得提交手动编址方式')
  assert.strictEqual(dmxPage.data.groups[0].targetUniverse, 'A', '确认前不得提交目标域变化')
  assert.strictEqual(dmxPage._calculationResult.fixtures[0].addressText, 'A001', '确认前地址结果保持不变')
  dmxPage.confirmPendingChange()
  assert.strictEqual(dmxPage.data.allocationMode, 'manual')
  assert.strictEqual(dmxPage.data.groups[0].targetUniverse, 'A')
  assert.strictEqual(dmxPage._calculationResult.fixtures[0].addressText, 'A001')
  dmxPage.onGroupUniverseChange({
    currentTarget: { dataset: { index: 0 } },
    detail: { value: 1 },
  })
  assert.strictEqual(dmxPage.data.pendingChange.kind, 'groupUniverse')
  assert.strictEqual(dmxPage.data.pendingChange.valid, true)
  assert.strictEqual(dmxPage.data.allocationMode, 'manual')
  assert.strictEqual(dmxPage.data.groups[0].targetUniverse, 'A', '确认前目标域仍保持 A')
  assert.strictEqual(dmxPage._calculationResult.fixtures[0].addressText, 'A001', '确认前地址仍保持 A001')
  dmxPage.confirmPendingChange()
  assert.strictEqual(dmxPage.data.groups[0].targetUniverse, 'B')
  assert.strictEqual(dmxPage.data.result.fixtures, undefined, 'DMX 页面不应把逐台数组传入视图层')
  assert.strictEqual(dmxPage._calculationResult.fixtures[0].addressText, 'B001')
  assert.strictEqual(dmxPage.getPreferences().allocationMode, 'manual')
  assert.strictEqual(dmxPage.getPreferences().groups[0].targetUniverse, 'B')
  dmxPage.switchAllocationMode({ currentTarget: { dataset: { mode: 'auto' } } })
  assert.strictEqual(dmxPage.data.pendingChange.kind, 'allocationMode')
  assert.strictEqual(dmxPage.data.pendingChange.valid, true)
  assert.strictEqual(dmxPage.data.allocationMode, 'manual', '确认前仍保持手动编址方式')
  assert.strictEqual(dmxPage.data.groups[0].targetUniverse, 'B')
  assert.strictEqual(dmxPage._calculationResult.fixtures[0].addressText, 'B001', '确认前地址仍保持 B001')
  dmxPage.confirmPendingChange()
  assert.strictEqual(dmxPage.data.allocationMode, 'auto')
  assert.strictEqual(dmxPage._calculationResult.fixtures[0].addressText, 'A001')
  dmxPage.openFixtureLayout()
  const layoutUrl = new URL(navigatedUrl, 'https://tunebuddy.invalid')
  assert.strictEqual(layoutUrl.pathname, '/pages/dmx-layout/dmx-layout')
  assert.deepStrictEqual(Array.from(layoutUrl.searchParams.entries()), [['lightingContextId', dmxPage._contextId]])

  const dmxLayoutRouteConfig = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'))
  const dmxLayoutPageConfig = JSON.parse(fs.readFileSync(path.join(root, 'pages/dmx-layout/dmx-layout.json'), 'utf8'))
  assert(dmxLayoutRouteConfig.pages.includes('pages/dmx-layout/dmx-layout')
    && !dmxLayoutRouteConfig.pages.includes('pages/dmx-layout-landscape/dmx-layout-landscape'),
  '灯位图正式应用路由应保持竖屏页面，横屏兼容文件不得注册')
  assert.strictEqual(dmxLayoutPageConfig.pageOrientation, 'portrait', '正式灯位图路由应固定竖屏')
  assert(!dmxLayoutWxml.includes('openLandscapeLayout') && !dmxLayoutWxml.includes('layout-orientation-button'),
    '正式竖屏灯位图仍暴露已退役横屏入口')
  assert(dmxLayoutWxml.includes('bindtap="clearSelectedRodLayout"')
    && dmxLayoutWxml.includes('bindtap="clearLayoutImage"')
    && dmxLayoutFactory.includes("require('./layout-interactions')")
    && dmxLayoutFactory.includes('createLayoutPlacementMethods(layoutInteractionDependencies)')
    && dmxLayoutFactory.includes('...layoutPlacementMethods')
    && dmxLayoutInteractions.includes('clearSelectedRodLayout()')
    && dmxLayoutInteractions.includes('this.clearLayoutPositions(this._activeRodId)')
    && dmxLayoutInteractions.includes("this.clearLayoutPositions('')")
    && dmxLayoutInteractions.includes('String(position.rodId) === targetRodId'),
  '灯位图须区分当前杆清空和全图清空，并将单杆操作限制在目标杆')
  const dmxWritesBeforeRepeatedCalculation = storageWriteCount
  let unchangedDmxSetDataCount = 0
  dmxPage.setData = function countUnchangedDmxSetData(value, callback) {
    unchangedDmxSetDataCount += 1
    return dmxSetData.call(this, value, callback)
  }
  dmxPage.commitCalculation()
  dmxPage.setData = dmxSetData
  assert.strictEqual(unchangedDmxSetDataCount, 0, '相同 DMX 输入仍重复提交视图')
  assert.strictEqual(storageWriteCount, dmxWritesBeforeRepeatedCalculation, '相同 DMX 输入仍重复写入偏好')
  assert.strictEqual(dmxPage.data.activeWorkspace, 'config', 'DMX 页面默认应先显示编址配置工作区')
  dmxPage.switchWorkspace({ currentTarget: { dataset: { workspace: 'plan' } } })
  assert.strictEqual(dmxPage.data.activeWorkspace, 'plan', 'DMX 工作区切换未进入地址方案')
  dmxPage.switchWorkspace({ currentTarget: { dataset: { workspace: 'config' } } })
  assert.strictEqual(dmxPage.data.activeWorkspace, 'config', '地址方案返回配置入口失效')
  const dmxOriginalGroups = JSON.parse(JSON.stringify(dmxPage.data.groups))
  const validDmxFixtureModels = dmxFixtures
    .filter((fixture) => fixture && fixture.model && Array.isArray(fixture.channelModes) && fixture.channelModes.length)
  const existingFixtureModel = validDmxFixtureModels[0]?.model
  assert(existingFixtureModel, '单型号编址回归缺少可用灯具型号')
  dmxPage.openFixtureSearch({ currentTarget: { dataset: { index: 0 } } })
  dmxPage.selectFixture({ currentTarget: { dataset: { model: existingFixtureModel } } })
  assert.strictEqual(dmxPage.data.pendingChange.kind, 'edit', '更换现有型号应先进入待确认状态')
  assert.strictEqual(dmxPage.data.groups[0].fixtureModel, dmxOriginalGroups[0].fixtureModel,
    '确认前不应覆盖现有灯组型号')
  dmxPage.confirmPendingChange()
  assert.strictEqual(dmxPage.data.groups[0].fixtureModel, existingFixtureModel, '灯具目录选择未更新现有组型号')

  const dmxGroupsBeforeSingleModelAdd = JSON.parse(JSON.stringify(dmxPage.data.groups))
  dmxPage.onBaseInput({ currentTarget: { dataset: { key: 'startAddressText' } }, detail: { value: '513' } })
  dmxPage.onFieldBlur({ currentTarget: { dataset: { key: 'startAddressText' } } })
  assert.strictEqual(dmxPage.data.pendingChange.kind, 'startAddress', '无效起始地址应进入确认预览')
  assert.strictEqual(dmxPage.data.pendingChange.valid, false, '无效起始地址未被阻止')
  assert(dmxPage.data.pendingChange.error, '无效起始地址未保留错误原因')
  dmxPage.confirmPendingChange()
  assert.deepStrictEqual(dmxPage.data.groups, dmxGroupsBeforeSingleModelAdd,
    '无效起始地址确认不得修改灯具组')
  dmxPage.cancelPendingChange()

  dmxPage.addGroup()
  assert.strictEqual(dmxPage.data.fixtureSearchOpen, true, '添加灯组未打开单型号灯具目录')
  assert.strictEqual(dmxPage.data.fixtureBatchOpen, false, '添加灯组仍打开多型号选择面板')
  dmxPage.selectFixture({ currentTarget: { dataset: { model: existingFixtureModel } } })
  assert.strictEqual(dmxPage.data.pendingChange.kind, 'add', '选择一个型号后未进入新增灯组确认')
  assert.strictEqual(dmxPage.data.pendingChange.fixtureModel, existingFixtureModel)
  dmxPage.onPendingQuantityInput({ detail: { value: '2' } })
  dmxPage.onPendingQuantityBlur()
  assert.strictEqual(dmxPage.data.pendingChange.valid, true, '合法的同型号数量未通过验证')
  dmxPage.confirmPendingChange()
  assert.strictEqual(dmxPage.data.fixtureBatchOpen, false, '确认新增后多型号面板仍打开')
  assert.strictEqual(dmxPage.data.groups.length, dmxGroupsBeforeSingleModelAdd.length + 1,
    '单型号确认未创建新灯组')
  const addedSameModelGroup = dmxPage.data.groups.at(-1)
  assert.strictEqual(addedSameModelGroup.fixtureModel, existingFixtureModel,
    '新增灯组型号与本次选择不一致')
  assert.strictEqual(Number(addedSameModelGroup.fixtureCount), 2,
    '单型号流程未保留多台同型号数量')

  const legacyCustomGroupFixture = {
    name: '染色灯',
    customName: '染色灯',
    fixtureSource: 'custom',
    fixtureModel: '',
    fixtureName: '',
    channelModes: [],
    channelCount: '8',
    customChannelCount: '8',
    fixtureCount: '6',
    targetUniverse: 'A',
  }
  dmxPage.commitCalculation({
    groups: [...dmxOriginalGroups, legacyCustomGroupFixture],
    startAddressText: '1',
    allocationMode: 'auto',
  })
  const restoredLegacyCustomGroup = dmxPage.data.groups.at(-1)
  assert.strictEqual(restoredLegacyCustomGroup.fixtureSource, 'custom',
    '显式旧自定义灯具 fixture 未按历史数据恢复')
  assert.strictEqual(restoredLegacyCustomGroup.name, '染色灯')
  assert.strictEqual(dmxPage.data.result.totalFixtures, 10)
  assert.strictEqual(dmxPage.data.result.nextText, 'A113')
  const dmxResultText = dmxPage.getResultText()
  assert(dmxResultText.includes('灯具地址码计算'))
  assert(dmxResultText.includes('编址方式：连续自动'), 'DMX 完整结果格式缺少编址方式')
  assert(dmxResultText.includes('染色灯 · 6 台 · 8 CH/台'))
  assert(dmxPage.getRecordPayload().resultText.includes('染色灯 · 6 台 · 8 CH/台'),
    'DMX 项目历史须继续保留完整文字结果')
  assert(!dmxWxml.includes('bindtap="copyResult"') && !dmxWxml.includes('class="copy-result-button"'),
    'DMX 页面不应提供用户侧全文复制入口')
  assert.strictEqual(dmxPage.getRecordPayload().module, 'dmxAddress')
  const dmxReportRecord = dmxPage.buildResultReportRecord()
  assert.strictEqual(dmxReportRecord.resultText.split('\n').length, 2)
  assert(!dmxReportRecord.resultText.includes('#1'), 'DMX 方案长图仍塞入逐台地址明细')
  assert(dmxReportRecord.resultText.includes('染色灯'), 'DMX 方案长图缺少灯具组范围')
  const autoCrossDomainPlan = calculateDmxAddressPlan({
    startAddress: 500,
    groups: [{ name: '跨域组', channelCount: 16, fixtureCount: 2 }],
  })
  const autoCrossDomainReport = dmxPage.buildResultReportRecord({ ...autoCrossDomainPlan, valid: true })
  assert(!autoCrossDomainReport.resultText.includes('· A域'), '连续自动跨域报告不应误标单一域')
  const manualReport = dmxPage.buildResultReportRecord({
    ...calculateDmxAddressPlan({
      startAddress: 1,
      allocationMode: 'manual',
      groups: [{ name: 'B组', channelCount: 16, fixtureCount: 2, targetUniverse: 'B' }],
    }),
    valid: true,
  })
  assert(manualReport.resultText.includes('· B域'), '按组分域报告缺少目标域')
  let dmxReportExportCount = 0
  let exportedDmxReport = null
  const dmxReportContext = new Proxy({}, {
    get: (target, key) => {
      if (key === 'measureText') return (text) => ({ width: String(text).length * 14 })
      if (key === 'draw') return (reserve, callback) => {
        const done = typeof reserve === 'function' ? reserve : callback
        if (done) done()
      }
      return () => {}
    },
  })
  wx.createCanvasContext = (canvasId) => {
    assert.strictEqual(canvasId, 'resultReportCanvas')
    return dmxReportContext
  }
  wx.canvasToTempFilePath = (options) => {
    dmxReportExportCount += 1
    exportedDmxReport = options
    options.success({ tempFilePath: 'temp://dmx-result.png' })
  }
  wx.showLoading = () => {}
  wx.hideLoading = () => {}
  dmxPage.generateResultReportImage()
  assert.strictEqual(dmxPage.data.resultReportImagePath, 'temp://dmx-result.png')
  assert.strictEqual(dmxPage.data.resultReportPreviewVisible, true)
  assert(exportedDmxReport.destWidth <= 1500 && exportedDmxReport.destHeight <= 4096,
    'DMX 编址方案图导出尺寸超过安全上限')
  dmxPage.closeResultReportPreview()
  dmxPage.generateResultReportImage()
  assert.strictEqual(dmxReportExportCount, 1, '相同 DMX 编址方案没有复用已生成图片')
  delete wx.createCanvasContext
  delete wx.canvasToTempFilePath
  delete wx.showLoading
  delete wx.hideLoading
  dmxPage.openFixtureSearch({ currentTarget: { dataset: { index: 0 } } })
  assert.strictEqual(dmxPage.data.fixtureSearchOpen, true)
  assert.strictEqual(dmxPage.data.fixtureSearchTotal, 121)
  assert.deepStrictEqual(
    dmxPage.data.fixtureSearchCategories.map((item) => [item.label, item.count]),
    [
      ['全部', 121],
      ['摇头灯', 36],
      ['PAR/染色', 21],
      ['柔光灯', 11],
      ['成像/聚光', 22],
      ['效果灯', 21],
      ['舞台特效', 10],
    ],
    '灯具搜索分类或分类数量异常',
  )
  dmxPage.selectFixtureCategory({ currentTarget: { dataset: { category: '舞台特效' } } })
  assert.strictEqual(dmxPage.data.fixtureSearchCategory, '舞台特效')
  assert.strictEqual(dmxPage.data.fixtureSearchTotal, 10)
  assert(dmxPage.data.fixtureSearchResults.every((item) => item.category === '舞台特效'))
  assert.strictEqual(vibrationTypes.at(-1), 'light')
  dmxPage.selectFixtureCategory({ currentTarget: { dataset: { category: '全部' } } })
  dmxPage.onFixtureSearchInput({ detail: { value: 'SV3103' } })
  assert.notDeepStrictEqual(dmxPage.data.fixtureSearchResults.map((item) => item.model), ['TL-SV3103'],
    '灯具搜索输入仍在每个字符后立即刷新完整结果列表')
  dmxPage.flushFixtureSearch()
  assert.deepStrictEqual(dmxPage.data.fixtureSearchResults.map((item) => item.model), ['TL-SV3103'])
  assert.strictEqual(dmxPage.data.fixtureSearchTotal, 1)
  const searchedFixtureGroupsBeforeEdit = JSON.parse(JSON.stringify(dmxPage.data.groups))
  const storageWritesBeforeSearchedFixtureEdit = storageWriteCount
  dmxPage.selectFixture({ currentTarget: { dataset: { model: 'TL-SV3103' } } })
  assert.strictEqual(dmxPage.data.pendingChange.kind, 'edit', '更换灯具型号应先进入确认预览')
  assert.strictEqual(dmxPage.data.pendingChange.fixtureModel, 'TL-SV3103', '型号预览与搜索选择不一致')
  assert.strictEqual(dmxPage.data.pendingChange.valid, true, '合法型号更换预览未通过验证')
  assert.deepStrictEqual(dmxPage.data.groups, searchedFixtureGroupsBeforeEdit, '确认前已覆盖原灯组')
  assert.strictEqual(storageWriteCount, storageWritesBeforeSearchedFixtureEdit, '型号更换预览阶段不得写入偏好')
  dmxPage.confirmPendingChange()
  assert.strictEqual(dmxPage.data.groups[0].fixtureModel, 'TL-SV3103')
  assert.strictEqual(dmxPage.data.groups[0].fixtureSource, 'library')
  assert.strictEqual(dmxPage.data.groups[0].channelCount, '14')
  assert.strictEqual(dmxPage.getPreferences().groups[0].fixtureModel, 'TL-SV3103')
  assert.strictEqual(dmxPage.data.resultReportImagePath, '', 'DMX 灯具参数变化后仍沿用旧方案图片')
  assert.strictEqual(dmxPage.data.fixtureSearchTotal, 0)
  assert.deepStrictEqual(dmxPage.data.fixtureSearchResults, [], '选择灯具后仍保留搜索结果')
  assert.strictEqual(vibrationTypes.at(-1), 'light')
  const guideFixture = dmxPage._calculationResult.fixtures[0]
  dmxPage.openFixtureChannelGuide({
    currentTarget: { dataset: { globalIndex: guideFixture.globalIndex } },
  })
  assert(dmxPage.data.fixtureChannelGuide, '逐台地址卡片未打开灯具通道速查')
  assert.strictEqual(dmxPage.data.fixtureChannelGuideDetail, null, '打开通道速查时未清理旧详情')
  assert(dmxPage.data.fixtureChannelGuide.channels.every(
    (channel) => !Object.prototype.hasOwnProperty.call(channel, 'expanded'),
  ), '通道速查卡片仍保留旧 expanded 状态')
  const firstGuideRangeIndex = dmxPage.data.fixtureChannelGuide.channels.findIndex(
    (channel) => channel.ranges.length,
  )
  const secondGuideRangeIndex = dmxPage.data.fixtureChannelGuide.channels.findIndex(
    (channel, index) => index > firstGuideRangeIndex && channel.ranges.length,
  )
  assert(firstGuideRangeIndex >= 0 && secondGuideRangeIndex >= 0, '通道速查缺少可查看数值段的通道')
  const firstGuideChannel = dmxPage.data.fixtureChannelGuide.channels[firstGuideRangeIndex]
  dmxPage.selectFixtureChannelGuideDetail({
    currentTarget: { dataset: { channelIndex: firstGuideRangeIndex } },
  })
  assert.strictEqual(dmxPage.data.fixtureChannelGuideDetail.channel, firstGuideChannel.channel)
  assert.strictEqual(dmxPage.data.fixtureChannelGuideDetail.actualAddress, firstGuideChannel.actualAddress)
  assert.strictEqual(dmxPage.data.fixtureChannelGuideDetail.name, firstGuideChannel.name)
  assert.deepStrictEqual(dmxPage.data.fixtureChannelGuideDetail.ranges, firstGuideChannel.ranges)
  dmxPage.selectFixtureChannelGuideDetail({
    currentTarget: { dataset: { channelIndex: secondGuideRangeIndex } },
  })
  assert.notStrictEqual(
    dmxPage.data.fixtureChannelGuideDetail.channel,
    firstGuideChannel.channel,
    '通道详情未支持切换到另一通道',
  )
  dmxPage.closeFixtureChannelGuideDetail()
  assert.strictEqual(dmxPage.data.fixtureChannelGuideDetail, null, '通道详情关闭入口失效')
  dmxPage.selectFixtureChannelGuideDetail({
    currentTarget: { dataset: { channelIndex: firstGuideRangeIndex } },
  })
  dmxPage.openFixtureChannelGuide({
    currentTarget: { dataset: { globalIndex: guideFixture.globalIndex } },
  })
  assert.strictEqual(dmxPage.data.fixtureChannelGuideDetail, null, '重新打开通道速查后仍残留详情')
  dmxPage.closeFixtureChannelGuide()
  assert.strictEqual(dmxPage.data.fixtureChannelGuide, null)
  assert.strictEqual(dmxPage.data.fixtureChannelGuideDetail, null, '关闭通道速查后未清理详情')
  let unchangedModeSetDataCount = 0
  dmxPage.setData = function countUnchangedModeSetData(value, callback) {
    unchangedModeSetDataCount += 1
    return dmxSetData.call(this, value, callback)
  }
  dmxPage.onChannelModeChange({
    currentTarget: { dataset: { index: 0 } },
    detail: { value: 0 },
  })
  dmxPage.setData = dmxSetData
  assert.strictEqual(unchangedModeSetDataCount, 0, '重复选择当前 DMX 通道模式仍触发视图更新')
  const vibrationsBeforeModeChange = vibrationTypes.length
  dmxPage.onChannelModeChange({
    currentTarget: { dataset: { index: 0 } },
    detail: { value: 1 },
  })
  assert.strictEqual(dmxPage.data.groups[0].channelCount, '16')
  assert.strictEqual(dmxPage.data.groups[0].libraryChannelCount, '16')
  assert.strictEqual(dmxPage.data.groups[0].channelModeIndex, 1)
  assert.deepStrictEqual(vibrationTypes.slice(vibrationsBeforeModeChange), ['light'])
  dmxPage.switchFixtureSource({ currentTarget: { dataset: { index: 0, source: 'custom' } } })
  assert.strictEqual(dmxPage.data.groups[0].fixtureSource, 'custom')
  assert.strictEqual(dmxPage.data.groups[0].fixtureModel, 'TL-SV3103', '切换自定义后未保留库内灯具')
  dmxPage.onGroupInput({
    currentTarget: { dataset: { index: 0, field: 'name' } },
    detail: { value: '自定义测试灯具' },
  })
  dmxPage.onGroupInput({
    currentTarget: { dataset: { index: 0, field: 'channelCount' } },
    detail: { value: '20' },
  })
  dmxPage.onFieldBlur()
  dmxPage.switchFixtureSource({ currentTarget: { dataset: { index: 0, source: 'library' } } })
  assert.strictEqual(dmxPage.data.groups[0].fixtureSource, 'library')
  assert.strictEqual(dmxPage.data.groups[0].fixtureModel, 'TL-SV3103')
  assert.strictEqual(dmxPage.data.groups[0].channelCount, '16', '切回库内后未恢复原通道模式')
  dmxPage.switchFixtureSource({ currentTarget: { dataset: { index: 0, source: 'custom' } } })
  assert.strictEqual(dmxPage.data.groups[0].name, '自定义测试灯具')
  assert.strictEqual(dmxPage.data.groups[0].channelCount, '20', '再次切换自定义后未恢复自定义通道数')
  dmxPage.switchFixtureSource({ currentTarget: { dataset: { index: 0, source: 'library' } } })
  assert.strictEqual(vibrationTypes.at(-1), 'light')
  const groupsBeforeConfirmedDelete = JSON.parse(JSON.stringify(dmxPage.data.groups))
  const storageWritesBeforeConfirmedDelete = storageWriteCount
  dmxPage.requestDeleteGroup({ currentTarget: { dataset: { index: 1 } } })
  assert.strictEqual(dmxPage.data.pendingChange.kind, 'delete', '删除灯组应先进入确认预览')
  assert.strictEqual(dmxPage.data.pendingChange.deleteIndex, 1, '删除预览索引与目标灯组不一致')
  assert.strictEqual(dmxPage.data.pendingChange.groupId, groupsBeforeConfirmedDelete[1]._lightingGroupId)
  assert.deepStrictEqual(dmxPage.data.groups, groupsBeforeConfirmedDelete, '删除确认前已改变灯组')
  assert.strictEqual(storageWriteCount, storageWritesBeforeConfirmedDelete, '删除预览阶段不得写入偏好')
  dmxPage.confirmPendingChange()
  assert.strictEqual(dmxPage.data.groups.length, groupsBeforeConfirmedDelete.length - 1, '确认删除未只移除目标灯组')
  assert.strictEqual(dmxPage.data.groups[0]._lightingGroupId, groupsBeforeConfirmedDelete[0]._lightingGroupId, '确认删除改变了其他灯组身份')
  assert.strictEqual(dmxPage.data.groups[0].fixtureModel, groupsBeforeConfirmedDelete[0].fixtureModel, '确认删除改变了其他灯组型号')
  assert.strictEqual(dmxPage.data.groups[0].channelCount, groupsBeforeConfirmedDelete[0].channelCount, '确认删除改变了其他灯组通道模式')
  assert.strictEqual(dmxPage.getPreferences().groups.length, groupsBeforeConfirmedDelete.length - 1, '确认删除未持久化指定灯组移除')
  assert.strictEqual(dmxPage.data.pendingChange, null, '删除确认后仍残留预览')
  assert.strictEqual(vibrationTypes.at(-1), 'medium')
  const lastGroupBeforeDeleteRequest = JSON.parse(JSON.stringify(dmxPage.data.groups))
  const storageWritesBeforeLastGroupRequest = storageWriteCount
  dmxPage.requestDeleteGroup({ currentTarget: { dataset: { index: 0 } } })
  assert.strictEqual(dmxPage.data.pendingChange.kind, 'delete', '最后一组删除应先进入确认预览')
  assert.strictEqual(dmxPage.data.pendingChange.deleteIndex, 0)
  assert.deepStrictEqual(dmxPage.data.groups, lastGroupBeforeDeleteRequest, '最后一组删除预览已改变当前方案')
  assert.strictEqual(storageWriteCount, storageWritesBeforeLastGroupRequest, '最后一组删除预览阶段不得写入偏好')
  dmxPage.onUserCancelPendingChange()
  assert.strictEqual(dmxPage.data.pendingChangeClosing, true, '最后一组取消未走当前关闭生命周期')
  assert.deepStrictEqual(dmxPage.data.groups, lastGroupBeforeDeleteRequest, '最后一组取消改变了当前方案')
  assert.strictEqual(storageWriteCount, storageWritesBeforeLastGroupRequest, '最后一组取消产生了存储写入')
  dmxPage.finishPendingChangeClose()
  assert.strictEqual(dmxPage.data.pendingChange, null, '最后一组取消后预览未关闭')
  const lastGroupVibrationsBeforeConfirm = vibrationTypes.length
  const storageWritesBeforeLastGroupConfirm = storageWriteCount
  dmxPage.requestDeleteGroup({ currentTarget: { dataset: { index: 0 } } })
  assert.strictEqual(dmxPage.data.pendingChange.valid, true)
  assert.strictEqual(dmxPage.data.pendingChange.remainingGroupCount, 0)
  assert(dmxWxml.includes('删除后当前方案将没有灯具'), '最后一组预览须明确确认后会留下空方案')
  assert.strictEqual(storageWriteCount, storageWritesBeforeLastGroupConfirm, '最后一组确认前不得写入偏好')
  dmxPage.confirmPendingChange()
  assert.strictEqual(dmxPage.data.groups.length, 0, '确认删除最后一组后须保留空方案')
  assert.strictEqual(dmxPage.getPreferences().groups.length, 0, '空方案须保存到偏好')
  assert.strictEqual(dmxPage._unsavedScheme, false, '最后一组删除须确认保存成功')
  assert(storageWriteCount > storageWritesBeforeLastGroupConfirm, '最后一组删除成功后须完成存储写入')
  assert.deepStrictEqual(vibrationTypes.slice(lastGroupVibrationsBeforeConfirm), ['medium'], '最后一组保存成功后恰好触发一次 medium')

  const largeDmxPage = loadPage('pages/dmx-address/dmx-address.js')
  largeDmxPage.onLoad()
  largeDmxPage.onShow()
  largeDmxPage.commitCalculation({
    startAddressText: '1',
    groups: [
      { id: 'large-1', name: '灯具组一', fixtureModel: '', fixtureName: '', channelModes: [], channelCount: '4', fixtureCount: '200' },
      { id: 'large-2', name: '灯具组二', fixtureModel: '', fixtureName: '', channelModes: [], channelCount: '4', fixtureCount: '200' },
      { id: 'large-3', name: '灯具组三', fixtureModel: '', fixtureName: '', channelModes: [], channelCount: '4', fixtureCount: '100' },
    ],
  })
  assert.strictEqual(largeDmxPage._calculationResult.fixtures.length, 500)
  assert(!Object.prototype.hasOwnProperty.call(largeDmxPage.data.result, 'fixtures'),
    'DMX 完整逐台数组仍重复传入视图层')
  assert(!Object.prototype.hasOwnProperty.call(largeDmxPage.data.result, 'groups'),
    'DMX 完整分组逐台数据仍重复传入视图层')
  assert.strictEqual(largeDmxPage.data.result.universes.length, 4)
  assert.strictEqual(largeDmxPage.data.result.selectedUniverse.label, 'A')
  assert.strictEqual(largeDmxPage.data.result.selectedUniverse.fixtureCount, 128)
  assert.strictEqual(largeDmxPage.data.result.selectedUniverse.detailGroups.length, 0,
    'DMX 域默认仍一次性渲染逐台明细')
  assert(JSON.stringify(largeDmxPage.data.result).length < 12000,
    '500 台灯具的默认 DMX 视图数据仍然过大')
  largeDmxPage.toggleUniverseDetails()
  assert.strictEqual(
    largeDmxPage.data.result.selectedUniverse.detailGroups
      .reduce((sum, group) => sum + group.fixtures.length, 0),
    80,
    'DMX 域逐台地址首批未限制为 80 台',
  )
  assert.strictEqual(largeDmxPage.data.result.selectedUniverse.hasMoreFixtures, true)
  const firstFixtureProgressKey =
    largeDmxPage.data.result.selectedUniverse.detailGroups[0].fixtures[0].progressKey
  const secondFixtureProgressKey =
    largeDmxPage.data.result.selectedUniverse.detailGroups[0].fixtures[1].progressKey
  largeDmxPage.loadMoreFixtureDetails()
  assert.strictEqual(
    largeDmxPage.data.result.selectedUniverse.detailGroups
      .reduce((sum, group) => sum + group.fixtures.length, 0),
    128,
    'DMX 域滚动到底后未加载剩余逐台地址',
  )
  assert.strictEqual(largeDmxPage.data.result.selectedUniverse.hasMoreFixtures, false)
  const crossBatchFixtureProgressKey =
    largeDmxPage.data.result.selectedUniverse.detailGroups
      .flatMap((group) => group.fixtures)[100].progressKey
  const largeDmxSetData = largeDmxPage.setData
  let fixtureSelectionPatch = null
  largeDmxPage.setData = function captureFixtureSelectionPatch(value, callback) {
    fixtureSelectionPatch = value
    return largeDmxSetData.call(this, value, callback)
  }
  const writesBeforeProgressSelection = storageWriteCount
  largeDmxPage.toggleFixtureSelection({
    currentTarget: { dataset: { progressKey: firstFixtureProgressKey } },
  })
  assert.strictEqual(vibrationTypes.at(-1), 'light')
  largeDmxPage.toggleFixtureSelection({
    currentTarget: { dataset: { progressKey: secondFixtureProgressKey } },
  })
  largeDmxPage.toggleFixtureSelection({
    currentTarget: { dataset: { progressKey: crossBatchFixtureProgressKey } },
  })
  largeDmxPage.setData = largeDmxSetData
  assert(!Object.prototype.hasOwnProperty.call(fixtureSelectionPatch, 'result'),
    'DMX 地址勾选仍重复传输完整结果视图')
  assert.strictEqual(storageWriteCount, writesBeforeProgressSelection,
    'DMX 地址连续勾选仍逐次同步写入本地存储')
  assert.strictEqual(largeDmxPage.data.result.selectedUniverse.checkedCount, 3)
  assert.strictEqual(
    largeDmxPage.data.result.selectedUniverse.detailGroups
      .reduce((sum, group) => sum + group.checkedCount, 0),
    3,
  )
  assert.strictEqual(
    largeDmxPage.data.result.selectedUniverse.detailGroups
      .flatMap((group) => group.fixtures)
      .filter((fixture) => fixture.selected).length,
    3,
    'DMX 地址卡片不支持跨批次连续多选',
  )
  largeDmxPage.toggleUniverseDetails()
  assert.strictEqual(largeDmxPage.data.result.selectedUniverse.detailGroups.length, 0)
  assert.strictEqual(largeDmxPage.data.result.selectedUniverse.checkedCount, 3)
  largeDmxPage.toggleUniverseDetails()
  assert.strictEqual(
    largeDmxPage.data.result.selectedUniverse.detailGroups
      .reduce((sum, group) => sum + group.fixtures.length, 0),
    80,
    '重新打开 DMX 域详情后未重置为首批 80 台',
  )
  assert.strictEqual(
    largeDmxPage.data.result.selectedUniverse.detailGroups[0].fixtures
      .filter((fixture) => fixture.selected).length,
    2,
    'DMX 地址详情关闭后丢失设置进度',
  )
  largeDmxPage.toggleUniverseDetails()
  largeDmxPage.selectUniverse({ currentTarget: { dataset: { label: 'B' } } })
  assert.strictEqual(largeDmxPage.data.result.selectedUniverse.label, 'B')
  assert.strictEqual(largeDmxPage.data.result.selectedUniverse.checkedCount, 0)
  assert.strictEqual(largeDmxPage.data.result.selectedUniverse.detailGroups.length, 0)
  largeDmxPage.toggleUniverseDetails()
  assert.deepStrictEqual(
    largeDmxPage.data.result.selectedUniverse.detailGroups.map((group) => group.name),
    ['灯具组一', '灯具组二'],
    'DMX 域逐台地址未按灯具组分段',
  )
  largeDmxPage.toggleUniverseDetails()
  largeDmxPage.switchResultView({ currentTarget: { dataset: { mode: 'group' } } })
  largeDmxPage.toggleGroupDetails()
  assert.strictEqual(largeDmxPage.data.result.selectedGroup.checkedCount, 3)
  assert.strictEqual(
    largeDmxPage.data.result.selectedGroup.displayFixtures.filter((fixture) => fixture.selected).length,
    2,
    '切换到按灯具组查看后丢失首批内的地址设置进度',
  )
  largeDmxPage.loadMoreFixtureDetails()
  assert.strictEqual(largeDmxPage.data.result.selectedGroup.displayFixtures.length, 160,
    'DMX 灯具组首次滚动加载未追加到 160 台')
  assert.strictEqual(
    largeDmxPage.data.result.selectedGroup.displayFixtures.filter((fixture) => fixture.selected).length,
    3,
    'DMX 灯具组加载下一批后未恢复跨批次设置进度',
  )
  largeDmxPage.loadMoreFixtureDetails()
  assert.strictEqual(largeDmxPage.data.result.selectedGroup.displayFixtures.length, 200,
    'DMX 灯具组后续滚动加载未显示完整 200 台')
  assert.strictEqual(largeDmxPage.data.result.selectedGroup.hasMoreFixtures, false)
  const thirdFixtureProgressKey = largeDmxPage.data.result.selectedGroup.displayFixtures[2].progressKey
  largeDmxPage.toggleFixtureSelection({
    currentTarget: { dataset: { progressKey: thirdFixtureProgressKey } },
  })
  largeDmxPage.flushFixtureProgressWrite()
  assert.strictEqual(storageWriteCount, writesBeforeProgressSelection + 1,
    'DMX 地址连续勾选未合并为一次进度存储')
  assert.strictEqual(largeDmxPage.data.result.selectedGroup.checkedCount, 4)
  const restoredDmxProgressPage = loadPage('pages/dmx-address/dmx-address.js')
  restoredDmxProgressPage.onLoad()
  restoredDmxProgressPage.onShow()
  assert.strictEqual(restoredDmxProgressPage.data.result.totalFixtures, 500)
  assert.strictEqual(restoredDmxProgressPage.data.result.selectedUniverse.checkedCount, 4,
    '重新进入 DMX 页面后未恢复相同编址方案的设置进度')
  const dmxProgressStorageKey = 'audioTool.dmxAddress.progress'
  const previousDmxShowModal = wx.showModal
  let staleClearConfirmation = null
  largeDmxPage.switchResultView({ currentTarget: { dataset: { mode: 'universe' } } })
  largeDmxPage.selectUniverse({ currentTarget: { dataset: { label: 'B' } } })
  if (!largeDmxPage.data.result.selectedUniverse.detailGroups.length) largeDmxPage.toggleUniverseDetails()
  const bProgressFixture = largeDmxPage.data.result.selectedUniverse.detailGroups
    .flatMap((group) => group.fixtures)
    .find((fixture) => fixture.addressText === 'B001')
  assert(bProgressFixture, 'DMX 持久化夹具未包含 B001')
  const bProgressKey = bProgressFixture.progressKey
  largeDmxPage.toggleFixtureSelection({
    currentTarget: { dataset: { progressKey: bProgressKey } },
  })
  largeDmxPage.flushFixtureProgressWrite()
  assert.strictEqual(largeDmxPage.data.result.selectedUniverse.checkedCount, 1,
    'B 域设置进度没有进入可见结果')
  const progressWithFourAAndOneB = storage.get(dmxProgressStorageKey)
  assert.strictEqual(progressWithFourAAndOneB.calculationSignature, largeDmxPage._fixtureProgressSignature)
  assert.strictEqual(progressWithFourAAndOneB.keys.length, 5,
    'A、B 两域的五个设置标记未共同持久化')
  assert.strictEqual(progressWithFourAAndOneB.keys.filter((key) => key.endsWith(':B001')).length, 1)
  assert.strictEqual(progressWithFourAAndOneB.keys.filter((key) => key.includes(':A')).length, 4)

  largeDmxPage.selectUniverse({ currentTarget: { dataset: { label: 'A' } } })
  if (!largeDmxPage.data.result.selectedUniverse.detailGroups.length) largeDmxPage.toggleUniverseDetails()
  const workspaceBeforeCurrentClear = lightingWorkspace.readLightingWorkspace(largeDmxPage._contextId)
  assert(workspaceBeforeCurrentClear.ok, '旧 progressKey 标记迁移前无法读取公开工作区')
  assert.notStrictEqual(largeDmxPage._workspaceRevision, workspaceBeforeCurrentClear.revision,
    '公开读取迁入旧 progressKey 标记后，原页面版本应显式识别为过期')
  let legacyClearConfirmation = null
  wx.showModal = ({ success }) => { legacyClearConfirmation = success }
  const progressBeforeStaleLegacyClear = JSON.parse(JSON.stringify(storage.get(dmxProgressStorageKey)))
  const writesBeforeStaleLegacyClear = storageWriteCount
  largeDmxPage.clearVisibleFixtureSelections()
  assert.strictEqual(typeof legacyClearConfirmation, 'function', '旧同页清空前没有请求确认')
  legacyClearConfirmation({ confirm: true })
  assert.strictEqual(largeDmxPage.data.result.selectedUniverse.checkedCount, 4,
    '公开工作区迁移后，过期旧页面不得清除地址标记')
  assert.strictEqual(storageWriteCount, writesBeforeStaleLegacyClear,
    '过期旧页面的 bulk-clear 确认不得再次写入设置进度')
  assert.deepStrictEqual(storage.get(dmxProgressStorageKey), progressBeforeStaleLegacyClear,
    '过期旧页面的 bulk-clear 确认不得改写旧 progressKey 数据')
  const workspaceAfterStaleLegacyClear = lightingWorkspace.readLightingWorkspace(largeDmxPage._contextId)
  assert.strictEqual(workspaceAfterStaleLegacyClear.revision, workspaceBeforeCurrentClear.revision,
    '过期旧页面的 bulk-clear 确认不得推进公开工作区版本')
  assert.deepStrictEqual(workspaceAfterStaleLegacyClear.scheme, workspaceBeforeCurrentClear.scheme,
    '过期旧页面的 bulk-clear 确认不得改写公开工作区方案')
  wx.showModal = previousDmxShowModal

  const freshLegacyClearPage = loadPage('pages/dmx-address/dmx-address.js')
  freshLegacyClearPage.onLoad()
  freshLegacyClearPage.onShow()
  assert.strictEqual(freshLegacyClearPage.data.result.totalFixtures, 500)
  assert.strictEqual(freshLegacyClearPage.data.result.selectedUniverse.checkedCount, 4,
    'fresh 页面未恢复公开工作区中的四个 A 域地址检查')
  const freshLegacyWorkspace = lightingWorkspace.readLightingWorkspace(freshLegacyClearPage._contextId)
  assert.strictEqual(freshLegacyClearPage._workspaceRevision, freshLegacyWorkspace.revision,
    'fresh bulk-clear compatibility 页面未基于当前工作区版本')
  if (!freshLegacyClearPage.data.result.selectedUniverse.detailGroups.length) freshLegacyClearPage.toggleUniverseDetails()
  freshLegacyClearPage.clearVisibleFixtureSelections()
  assert.strictEqual(freshLegacyClearPage.data.result.selectedUniverse.checkedCount, 0,
    'fresh 页面无法清除已有 A 域 progressKey 标记')
  const progressAfterFreshLegacyClear = storage.get(dmxProgressStorageKey)
  assert.strictEqual(progressAfterFreshLegacyClear.calculationSignature, progressBeforeStaleLegacyClear.calculationSignature)
  assert.deepStrictEqual(progressAfterFreshLegacyClear.keys, [bProgressKey],
    'fresh legacy clear 必须保留 B 域的独立设置')
  const workspaceAfterFreshLegacyClear = lightingWorkspace.readLightingWorkspace(freshLegacyClearPage._contextId)
  const migratedCheckCalculation = lightingWorkspace.calculateScheme(workspaceAfterFreshLegacyClear.scheme)
  assert(migratedCheckCalculation.ok && migratedCheckCalculation.valid, 'fresh legacy clear workspace did not retain a valid lighting plan')
  const persistedCheckedAddresses = migratedCheckCalculation.result.fixtures
    .filter((fixture) => Object.prototype.hasOwnProperty.call(workspaceAfterFreshLegacyClear.scheme.checksById, fixture.stableId))
    .map((fixture) => fixture.addressText)
  assert.strictEqual(Object.keys(workspaceAfterFreshLegacyClear.scheme.checksById).length, 1)
  assert.deepStrictEqual(persistedCheckedAddresses, ['B001'],
    'fresh legacy clear must preserve the unrelated B001 public workspace check after legacy identity migration')
  largeDmxPage.onHide()
  largeDmxPage.onShow()
  assert.strictEqual(largeDmxPage._workspaceRevision, workspaceAfterFreshLegacyClear.revision,
    '旧 large Page 未通过显示生命周期刷新到 clear 后的公开工作区')
  assert.strictEqual(largeDmxPage.data.result.selectedUniverse.checkedCount, 0,
    'legacy clear 后 A 域地址检查未从公开工作区刷新')
  restoredDmxProgressPage.onHide()
  restoredDmxProgressPage.onShow()

  while (largeDmxPage.data.result.selectedUniverse.hasMoreFixtures) largeDmxPage.loadMoreFixtureDetails()
  const staleAProgressFixtures = largeDmxPage.data.result.selectedUniverse.detailGroups
    .flatMap((group) => group.fixtures)
  assert(staleAProgressFixtures.length > 100, '陈旧确认夹具没有覆盖跨批次地址')
  ;[0, 1, 2, 100].forEach((index) => largeDmxPage.toggleFixtureSelection({
    currentTarget: { dataset: { progressKey: staleAProgressFixtures[index].progressKey } },
  }))
  largeDmxPage.flushFixtureProgressWrite()
  assert.strictEqual(largeDmxPage.data.result.selectedUniverse.checkedCount, 4,
    '陈旧确认前没有恢复 A 域的跨批次已设置状态')
  wx.showModal = ({ success }) => { staleClearConfirmation = success }
  largeDmxPage.clearVisibleFixtureSelections()
  assert.strictEqual(typeof staleClearConfirmation, 'function', '清空前没有请求确认')
  const publicWorkspaceBeforePlanChange = lightingWorkspace.readLightingWorkspace(restoredDmxProgressPage._contextId)
  assert(publicWorkspaceBeforePlanChange.ok, 'DMX 地址进度迁入后无法读取公开工作区')
  assert.strictEqual(publicWorkspaceBeforePlanChange.scheme.preferences.startAddressText, '1')
  restoredDmxProgressPage.onHide()
  restoredDmxProgressPage.onShow()
  assert.strictEqual(restoredDmxProgressPage._workspaceRevision, publicWorkspaceBeforePlanChange.revision,
    '编址输入变更页面未通过显示生命周期刷新到 legacy progress 迁移后的公开版本')
  assert.strictEqual(restoredDmxProgressPage.data.startAddressText, '1')
  assert.strictEqual(restoredDmxProgressPage._unsavedScheme, false, '编址变更前页面不应保留未保存草稿')
  assert.strictEqual(restoredDmxProgressPage.data.result.selectedUniverse.checkedCount, 4,
    '公开导入 legacy progress 后未在新页面恢复四个 A 域地址检查')
  const changedDmxPlan = restoredDmxProgressPage.commitCalculation({ startAddressText: '2' })
  assert(changedDmxPlan.valid, '当前公开工作区上的新编址方案计算失败')
  assert.strictEqual(restoredDmxProgressPage.data.result.selectedUniverse.checkedCount, 0,
    '改变 DMX 编址方案后错误继承了旧设置进度')
  assert.strictEqual(restoredDmxProgressPage._unsavedScheme, false,
    '当前公开工作区上的新编址方案未能保存')
  const publicWorkspaceAfterPlanChange = lightingWorkspace.readLightingWorkspace(restoredDmxProgressPage._contextId)
  assert(publicWorkspaceAfterPlanChange.ok, '新编址方案保存后无法读取公开工作区')
  assert.strictEqual(publicWorkspaceAfterPlanChange.scheme.preferences.startAddressText, '2',
    '新编址输入未保存到公开工作区')
  const committedDmxPlan = lightingWorkspace.calculateScheme(publicWorkspaceAfterPlanChange.scheme)
  assert(committedDmxPlan.ok && committedDmxPlan.valid, '保存后的新编址方案无法复算')
  assert.strictEqual(committedDmxPlan.result.fixtures[0].addressText, 'A002',
    'public calculation must expose the new A002 start address')
  const restoredCommittedDmxPage = loadPage('pages/dmx-address/dmx-address.js')
  restoredCommittedDmxPage.onLoad()
  restoredCommittedDmxPage.onShow()
  assert.strictEqual(restoredCommittedDmxPage.data.startAddressText, '2',
    'fresh DMX page did not restore the saved public start address')
  assert.strictEqual(restoredCommittedDmxPage.data.result.totalFixtures, 500)
  for (const universeLabel of ['A', 'B', 'C', 'D']) {
    restoredCommittedDmxPage.selectUniverse({ currentTarget: { dataset: { label: universeLabel } } })
    assert.strictEqual(restoredCommittedDmxPage.data.result.selectedUniverse.checkedCount, 0,
      `saved start-address change must invalidate old checks in ${universeLabel}`)
  }
  restoredCommittedDmxPage.onHide()
  const workspaceBeforeStaleConfirmation = lightingWorkspace.readLightingWorkspace(largeDmxPage._contextId)
  assert(workspaceBeforeStaleConfirmation.ok, '陈旧确认前无法读取公开工作区')
  const progressBeforeStaleConfirmation = JSON.parse(JSON.stringify(storage.get(dmxProgressStorageKey)))
  const writesBeforeStaleConfirmation = storageWriteCount
  staleClearConfirmation({ confirm: true })
  assert.strictEqual(largeDmxPage.data.result.selectedUniverse.checkedCount, 4,
    '陈旧页面的清空确认错误地修改了新版本的地址核对')
  assert.strictEqual(storageWriteCount, writesBeforeStaleConfirmation,
    '陈旧确认不得再次写入地址设置进度')
  assert.deepStrictEqual(storage.get(dmxProgressStorageKey), progressBeforeStaleConfirmation,
    '陈旧确认不得修改已保存的地址设置进度')
  const workspaceAfterStaleConfirmation = lightingWorkspace.readLightingWorkspace(largeDmxPage._contextId)
  assert.strictEqual(workspaceAfterStaleConfirmation.revision, workspaceBeforeStaleConfirmation.revision,
    '陈旧确认不得改写公开工作区版本')
  assert.deepStrictEqual(workspaceAfterStaleConfirmation.scheme, workspaceBeforeStaleConfirmation.scheme,
    '陈旧确认不得改写公开工作区方案')

  wx.showModal = previousDmxShowModal
  largeDmxPage.onHide()
  largeDmxPage.onShow()
  const latestDmxWorkspace = lightingWorkspace.readLightingWorkspace(largeDmxPage._contextId)
  assert(latestDmxWorkspace.ok, '清空测试未能读取当前公开工作区')
  assert.strictEqual(largeDmxPage._workspaceRevision, latestDmxWorkspace.revision,
    '清空测试页面未通过显示生命周期刷新到最新工作区版本')
  assert.strictEqual(largeDmxPage.data.startAddressText, '2',
    '显示生命周期未采用最新公开工作区的编址输入')
  assert.strictEqual(largeDmxPage.data.result.selectedUniverse.checkedCount, 0,
    '当前地址方案没有清空旧设置进度')
  largeDmxPage.switchResultView({ currentTarget: { dataset: { mode: 'universe' } } })
  largeDmxPage.selectUniverse({ currentTarget: { dataset: { label: 'A' } } })
  if (!largeDmxPage.data.result.selectedUniverse.detailGroups.length) largeDmxPage.toggleUniverseDetails()
  while (largeDmxPage.data.result.selectedUniverse.hasMoreFixtures) largeDmxPage.loadMoreFixtureDetails()
  const currentUniverseFixtures = largeDmxPage.data.result.selectedUniverse.detailGroups
    .flatMap((group) => group.fixtures)
  ;[0, 1, 2, 100].forEach((index) => largeDmxPage.toggleFixtureSelection({
    currentTarget: { dataset: { progressKey: currentUniverseFixtures[index].progressKey } },
  }))
  largeDmxPage.flushFixtureProgressWrite()
  assert.strictEqual(largeDmxPage.data.result.selectedUniverse.checkedCount, 4,
    '当前可见页面未建立非空跨批次地址核对集合')
  const currentPlanProgress = storage.get(dmxProgressStorageKey)
  assert.strictEqual(currentPlanProgress.calculationSignature, JSON.stringify(latestDmxWorkspace.scheme.preferences))
  assert.strictEqual(currentPlanProgress.keys.length, 4)
  const workspaceAfterCurrentLegacyProgress = lightingWorkspace.readLightingWorkspace(largeDmxPage._contextId)
  assert(workspaceAfterCurrentLegacyProgress.ok, 'legacy progress flush 后无法读取公开工作区')
  assert.strictEqual(workspaceAfterCurrentLegacyProgress.scheme.preferences.startAddressText, '2')
  largeDmxPage.onHide()
  largeDmxPage.onShow()
  assert.strictEqual(largeDmxPage._workspaceRevision, workspaceAfterCurrentLegacyProgress.revision,
    '地址清空页面未先通过显示生命周期刷新到 legacy progress 导入后的版本')
  assert.strictEqual(largeDmxPage.data.result.selectedUniverse.checkedCount, 4,
    'legacy progress 导入后当前页面未恢复四个 A 域核对')
  largeDmxPage.clearVisibleFixtureSelections()
  assert.strictEqual(largeDmxPage.data.result.selectedUniverse.checkedCount, 0)
  assert.strictEqual(storage.get(dmxProgressStorageKey).calculationSignature,
    JSON.stringify(latestDmxWorkspace.scheme.preferences))
  assert.deepStrictEqual(storage.get(dmxProgressStorageKey).keys, [],
    '清空当前域后未持久删除全部已渲染批次的标记')
  assert.strictEqual(
    [...largeDmxPage._checkedFixtureKeys].filter((key) => key.includes(':')).length,
    0,
    '清空当前域时只清除了首批已渲染地址',
  )
  assert.strictEqual(vibrationTypes.at(-1), 'medium')
  largeDmxPage.switchResultView({ currentTarget: { dataset: { mode: 'group' } } })
  if (!largeDmxPage.data.result.selectedGroup.expanded) largeDmxPage.toggleGroupDetails()
  largeDmxPage.loadMoreFixtureDetails()
  const hiddenGroupFixtureProgressKey =
    largeDmxPage.data.result.selectedGroup.displayFixtures[100].progressKey
  largeDmxPage.toggleFixtureSelection({
    currentTarget: { dataset: { progressKey: hiddenGroupFixtureProgressKey } },
  })
  largeDmxPage.toggleGroupDetails()
  largeDmxPage.toggleGroupDetails()
  assert.strictEqual(largeDmxPage.data.result.selectedGroup.displayFixtures.length, 80)
  largeDmxPage.flushFixtureProgressWrite()
  const workspaceAfterHiddenGroupToggle = lightingWorkspace.readLightingWorkspace(largeDmxPage._contextId)
  assert(workspaceAfterHiddenGroupToggle.ok, 'hidden-group legacy progress flush could not import into the public workspace')
  assert.strictEqual(workspaceAfterHiddenGroupToggle.scheme.preferences.startAddressText, '2')
  largeDmxPage.onHide()
  largeDmxPage.onShow()
  assert.strictEqual(largeDmxPage._workspaceRevision, workspaceAfterHiddenGroupToggle.revision,
    'hidden-group clear page did not refresh to the imported public workspace revision')
  assert.strictEqual(largeDmxPage.data.result.viewMode, 'group')
  if (!largeDmxPage.data.result.selectedGroup.expanded) largeDmxPage.toggleGroupDetails()
  while (largeDmxPage.data.result.selectedGroup.hasMoreFixtures) largeDmxPage.loadMoreFixtureDetails()
  const restoredHiddenGroupFixture = largeDmxPage.data.result.selectedGroup.displayFixtures[100]
  assert.strictEqual(restoredHiddenGroupFixture.progressKey, hiddenGroupFixtureProgressKey)
  assert.strictEqual(restoredHiddenGroupFixture.selected, true,
    'public progress import lost the checked fixture beyond the first 80 rows')
  assert.strictEqual(largeDmxPage.data.result.selectedGroup.checkedCount, 1)
  largeDmxPage.toggleGroupDetails()
  largeDmxPage.toggleGroupDetails()
  assert.strictEqual(largeDmxPage.data.result.selectedGroup.displayFixtures.length, 80)
  assert.strictEqual(largeDmxPage.data.result.selectedGroup.checkedCount, 1,
    'collapsing/reopening group details lost the hidden checked fixture')
  assert(!largeDmxPage.data.result.selectedGroup.displayFixtures.some((fixture) => fixture.progressKey === hiddenGroupFixtureProgressKey),
    'hidden row 100 unexpectedly remained in the first 80-row render')
  largeDmxPage.clearVisibleFixtureSelections()
  assert.strictEqual(largeDmxPage.data.result.selectedGroup.checkedCount, 0)
  assert(!largeDmxPage._checkedFixtureKeys.has(hiddenGroupFixtureProgressKey),
    '清空当前灯具组时只清除了首批已渲染地址')
  const largeDmxResultText = largeDmxPage.getResultText()
  assert.strictEqual(
    largeDmxResultText.split('\n').filter((line) => /^\s+#\d+\s+/.test(line)).length,
    500,
    'DMX 分批渲染后复制结果未保留完整 500 台地址',
  )
  const lastAssignedFixture = largeDmxPage._calculationResult.fixtures.at(-1)
  assert(largeDmxResultText.includes(
    `#${lastAssignedFixture.fixtureIndex}  ${lastAssignedFixture.addressText}  占用 ${lastAssignedFixture.rangeText}`,
  ), 'DMX 分批渲染后复制结果缺少最后一台灯具地址')
  assert.strictEqual(
    largeDmxPage.getRecordPayload().resultText
      .split('\n').filter((line) => /^\s+#\d+\s+/.test(line)).length,
    500,
    'DMX 分批渲染后项目记录未保留完整 500 台地址',
  )

  const dmxLayoutWxss = fs.readFileSync(path.join(root, 'pages/dmx-layout/dmx-layout.wxss'), 'utf8')

  const appWxss = fs.readFileSync(path.join(root, 'app.wxss'), 'utf8')
  const firstDarkIndex = dmxLayoutWxss.search(/@media\s*\(prefers-color-scheme:\s*dark\)/)
  const dmxLight = dmxLayoutWxss.slice(0, firstDarkIndex)
  const dmxDark = dmxLayoutWxss.slice(firstDarkIndex)
  const assertDarkDeclaration = (selector, declaration, source = dmxDark) => {
    const matched = [...source.matchAll(/([^{}]+)\{([^{}]*)\}/g)].some(([, selectors, declarations]) => (
      selectors.split(',').some((item) => item.trim() === selector || item.trim().endsWith(` ${selector}`)) && declarations.includes(declaration)
    ))
    assert(matched,
      `深色样式缺少 ${selector} 的 ${declaration}`)
  }
  const assertFinalDarkDeclaration = (selector, declaration, source = dmxDark) => {
    const neutral = selector.includes('palette-group-chip') ? '.palette-group-chip.palette-group-chip,' : '.palette-group.palette-group,'
    const tail = source.slice(Math.max(0, source.lastIndexOf(neutral)))
    assertDarkDeclaration(selector, declaration, tail)
  }
  assert(dmxLayoutFactory.includes("require('./layout-settings')")
    && dmxLayoutFactory.includes('createLayoutSettingsMethods({')
    && dmxLayoutFactory.includes('...layoutSettingsMethods')
    && dmxLayoutSettings.includes('const validationErrors = {}')
    && dmxLayoutSettings.includes('collectRodErrors(\'internalRods\', draft.internalRods, internalRods, axis)')
    && dmxLayoutSettings.includes('collectRodErrors(\'frontRods\', draft.frontRods, frontRods, 200)')
    && dmxLayoutSettings.includes('layoutValidationErrorsById: validationErrors')
    && dmxLayoutSettings.includes("layoutErrorScrollIntoView: 'rod-error-' + firstInvalidRodId")
    && dmxLayoutWxml.includes('layoutValidationErrorsById[item.id]')
    && /\.rod-inline-error\{[^}]*background:rgba\(220,55,55,\.1\)[^}]*color:#a5231d/.test(dmxLayoutWxss)
    && /\.layout-page\.dark-mode \.rod-inline-error\{color:#ff8b83\}/.test(dmxLayoutWxss),
  '逐杆错误须绑定到各杆、定位首错且保持明暗主题可读')
  const { getMarkerTextColor, GROUP_COLORS, CANVAS_THEMES } = require('../pages/dmx-layout/layout-renderer')
  const contrast = (hex, text) => { const rgb=[0,2,4].map(i=>parseInt(hex.slice(i+1,i+3),16)/255).map(v=>v<=.03928?v/12.92:((v+.055)/1.055)**2.4); const l=rgb.reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0); const t=text==='#000000'?0:1; const a=Math.max(l,t),b=Math.min(l,t); return (a+.05)/(b+.05) }
  GROUP_COLORS.forEach((color) => assert(contrast(color, getMarkerTextColor(color)) >= 4.5, `地址标记文字对比度不足 ${color}`))
  const hexContrast = (a, b) => { const lum = (hex) => { const rgb=[0,2,4].map(i=>parseInt(hex.slice(i+1,i+3),16)/255).map(v=>v<=.03928?v/12.92:((v+.055)/1.055)**2.4); return rgb.reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0) }; const x=lum(a),y=lum(b); return (Math.max(x,y)+.05)/(Math.min(x,y)+.05) }
  assert(hexContrast('#ededf2', '#c43830') >= 4.5, '竖屏清空按钮浅色对比度不足')
  const canvasContrast = (a, b) => { const lum = (hex) => { const rgb=[0,2,4].map(i=>parseInt(hex.slice(i+1,i+3),16)/255).map(v=>v<=.03928?v/12.92:((v+.055)/1.055)**2.4); return rgb.reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0) }; const x=lum(a),y=lum(b); return (Math.max(x,y)+.05)/(Math.min(x,y)+.05) }
  ;[['border','stage'],['border','background'],['rail','stage'],['success','stage']].forEach(([a,b]) => assert(canvasContrast(CANVAS_THEMES.light[a], CANVAS_THEMES.light[b]) >= 3, `浅色 Canvas ${a}/${b} 对比度不足`))
  ;[['border','stage'],['rail','stage'],['success','stage']].forEach(([a,b]) => assert(canvasContrast(CANVAS_THEMES.dark[a], CANVAS_THEMES.dark[b]) >= 3, `深色 Canvas ${a}/${b} 对比度不足`))
  const requiredThemeAliases = Object.entries(themeAliasMap)
  requiredThemeAliases.forEach(([longName, shortName]) => {
    const declaration = `${shortName}:var(${longName})`
    assert(appWxss.includes(declaration), `app.wxss 浅色主题别名缺少 ${declaration}`)
    const darkStart = appWxss.search(/@media\s*\(prefers-color-scheme:\s*dark\)/)
    assert(darkStart >= 0 && appWxss.slice(darkStart).includes(declaration), `app.wxss 深色主题别名缺少 ${declaration}`)
  })
  assert.throws(() => {
    const unknownAliasFixture = '--unknown-theme-alias:var(--not-declared)'
    assert(requiredThemeAliases.some(([, shortName]) => unknownAliasFixture.startsWith(`${shortName}:`)), '未知主题别名未被拒绝')
  }, /未知主题别名未被拒绝/)
  assert(/\.result-report-preview-subtitle\{[^}]*color:var\(--theme-text-secondary\)/.test(appWxss), '全局预览副标题未使用主题辅助色')
  assertFinalThemeDeclaration(appWxss, '.result-report-preview-action-primary', 'background:var(--theme-primary-fill)', '全局预览主按钮未使用主题主按钮色', ['background:#0066cc'])
  assertDarkDeclaration('.result-report-preview-action-secondary', 'color:var(--theme-accent-text)', appWxss)
  assertFinalThemeDeclaration(appWxss, '.result-image-button', 'background:var(--theme-primary-fill)', '全局结果主按钮未使用主题主按钮色', ['background:#0066cc'])
  assertFinalThemeDeclaration(appWxss, '.copy-result-button', 'background:var(--theme-control)', '公共复制按钮未使用主题控件色', ['background:var(--theme-surface)'])
  const assertThemeDeclaration = (source, selector, declaration, message) => {
    const selectorText = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const declarationVariants = [declaration]
    Object.entries(themeAliasMap).forEach(([longName, shortName]) => {
      if (declaration.includes(longName)) declarationVariants.push(declaration.replace(longName, shortName))
    })
    const declarationPattern = declarationVariants.map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
    assert(new RegExp(`${selectorText}\\{[^}]*(${declarationPattern})`).test(source.replace(/\s+/g, '')), message)
  }
  ;[
    ['pages/camera/camera.wxss', '.camera-input-tab-active', 'background:var(--theme-surface)'],
    ['pages/camera/camera.wxss', '.choice-item-active', 'background:var(--theme-accent-soft)'],
    ['pages/camera/camera.wxss', 'button.camera-action-button', 'background:var(--theme-surface)'],
    ['pages/products/library.wxss', '.capability-chip-active', 'background:var(--theme-accent-soft)'],
    ['pages/records/project.wxss', '.interior-report-button', 'background:var(--theme-control)'],
    ['pages/led-screen/led-screen.wxss', '.led-report-save', 'color:var(--theme-accent-text)'],
    ['pages/knowledge/detail.wxss', '.distance-action-button', 'background:var(--theme-control)'],
    ['pages/limiter/limiter.wxss', '.selector-detail', 'background:var(--theme-accent-soft)'],
    ['pages/spl/spl.wxss', '.selector-detail.selector-detail', 'background:var(--theme-accent-soft)'],
  ].forEach(([file, selector, declaration]) => {
    const source = fs.readFileSync(path.join(root, file), 'utf8')
    assertThemeDeclaration(source, selector, declaration, `${file} 缺少 ${selector} 主题控件层级`)
  })
  ;[
    ['app.wxss', '.copy-result-button', 'background:var(--theme-control)', ['background:var(--theme-surface)']],
    ['app.wxss', '.result-image-button', 'background:var(--theme-primary-fill)', ['background:#0066cc']],
    // Retired result-view tab selector; current single-model and result contracts remain covered.
    ['pages/dmx-address/dmx-address.wxss', '.fixture-channel-guide-detail', 'background:var(--control)', ['background:#f2f7ff']],
    ['pages/dmx-address/dmx-address.wxss', '.fixture-search-row-selected', 'background:var(--control)', ['background:#007aff']],
    ['pages/gain-structure/gain-structure.wxss', '.choice-card', 'background:var(--theme-surface)', []],
    ['pages/gain-structure/gain-structure.wxss', '.choice-description', 'color:var(--theme-text-secondary)', ['color:#86868d']],
    ['pages/gain-structure/gain-structure.wxss', '.project-target-name', 'color:var(--theme-text)', []],
    ['pages/camera/camera.wxss', '.camera-input-tab', 'color:var(--theme-text-secondary)', ['color:#6e6e73']],
    ['pages/camera/camera.wxss', '.equipment-model', 'color:var(--theme-text)', ['color:#1d1d1f']],
    ['pages/led-screen/led-screen.wxss', '.led-report-title', 'color:var(--theme-text)', ['color:#1d1d1f']],
    ['pages/led-screen/led-screen.wxss', '.led-report-share', 'background:var(--theme-primary-fill)', ['background:#007aff']],
    ['pages/spl/spl.wxss', '.spl-value', 'color:var(--theme-text)', ['color:#1d1d1f']],
    ['pages/spl/spl.wxss', '.spl-unit', 'color:var(--theme-text-secondary)', ['color:#1d1d1f']],
    ['pages/products/detail.wxss', '.module-action', 'background:var(--theme-primary-fill)', ['background:#007aff']],
    ['pages/knowledge/detail.wxss', '.knowledge-error-button.knowledge-error-button', 'background:var(--tp)', ['background:#007aff']],
    ['pages/knowledge/detail.wxss', '.knowledge-error', 'background:var(--theme-page-bg)', ['background:#edf5ff']],
    ['pages/knowledge/detail.wxss', '.knowledge-error-title', 'color:var(--tx)', ['color:#1d1d1f']],
    ['pages/knowledge/detail.wxss', '.knowledge-error-text', 'color:var(--ts)', ['color:#6e6e73']],
    ['pages/spl/spl.wxss', '.result-label', 'color:var(--theme-text-secondary)', ['color:#6e6e73']],
    ['pages/spl/spl.wxss', '.reference-scale', 'background:var(--theme-surface-muted)', ['background:#ffffff']],
    ['pages/spl/spl.wxss', '.distance-tag', 'background:var(--theme-accent-soft)', ['background:#ffffff']],
    ['pages/gain-structure/gain-structure.wxss', '.status-chip', 'color:var(--theme-success)', ['color:#087f70']],
    ['pages/camera/camera.wxss', 'button.camera-action-button', 'background:var(--theme-surface)', ['background:#fff']],
    ['pages/records/project.wxss', '.interior-project-notes-copy', 'color:var(--theme-text)', ['color:#3a3a3c']],
    ['pages/knowledge/detail.wxss', '.distance-visual-title', 'color:var(--theme-text)', ['color:#1d1d1f']],
    ['pages/knowledge/detail.wxss', '.distance-conclusion-main', 'color:var(--theme-text)', ['color:#4c4c52']],
    ['pages/knowledge/detail.wxss', '.distance-formula-line', 'color:var(--theme-accent-text)', ['color:#075aa8']],
    ['pages/knowledge/detail.wxss', '.distance-formula-note', 'color:var(--theme-text-secondary)', ['color:#5f6772']],
    ['pages/products/detail.wxss', '.module-description', 'color:var(--theme-text-secondary)', ['color:#818188']],
    ['pages/products/detail.wxss', '.module-info', 'color:var(--theme-text-secondary)', ['color:#8e8e93']],
    ['pages/products/detail.wxss', '.source-label', 'color:var(--theme-accent-text)', ['color:#007aff']],
    ['pages/products/detail.wxss', '.source-text', 'color:var(--theme-text)', ['color:#4f4f55']],
    ['pages/products/detail.wxss', '.source-extra', 'color:var(--theme-text-secondary)', ['color:#74747b']],
    ['pages/products/detail.wxss', '.source-review', 'color:var(--theme-text-secondary)', ['color:#8e8e93']],
    ['pages/led-screen/led-screen.wxss', '.screen-dimension', 'color:var(--theme-text)', ['color:#1d1d1f']],
    ['pages/led-screen/led-screen.wxss', '.result-label', 'color:var(--theme-text-secondary)', ['color:#7d7d83']],
    ['pages/led-screen/led-screen.wxss', '.viewing-result', 'background:var(--theme-accent-soft)', ['background:#eef6ff']],
    ['pages/led-screen/led-screen.wxss', '.viewing-facts', 'color:var(--theme-text-secondary)', ['color:#6e6e73']],
    ['pages/led-screen/led-screen.wxss', '.viewing-status', 'color:var(--theme-accent-text)', ['color:#007aff']],
    ['pages/led-screen/led-screen.wxss', '.viewing-status', 'background:var(--theme-surface)', ['background:rgba(0,122,255,.1)']],
    ['pages/led-screen/led-screen.wxss', '.viewing-note', 'color:var(--theme-text-secondary)', ['color:#6e6e73']],
    ['pages/products/detail.wxss', '.lighting-spec-list', 'background:var(--theme-control)', ['background:#f2f2f7']],
    ['pages/products/detail.wxss', '.source-card', 'background:var(--theme-surface)', ['background:#fff']],
    ['pages/spl/spl.wxss', '.distance-unit', 'color:var(--theme-text-secondary)', ['color:#667085']],
    ['pages/spl/spl.wxss', '.reference-chip', 'background:var(--theme-accent-soft)', ['background:#dceaff']],
    ['pages/led-screen/led-screen.wxss', '.screen-install-dimension', 'background:var(--theme-accent-soft)', ['background:#efefff']],
    ['pages/knowledge/detail.wxss', '.distance-visual-kicker', 'color:var(--theme-accent-text)', ['color:#007aff']],
    ['pages/knowledge/detail.wxss', '.section-number', 'color:var(--theme-accent-text)', ['color:#007aff']],
    ['pages/knowledge/detail.wxss', '.fill-source-main-left', 'background:var(--theme-primary-fill)', ['background:#007aff']],
    ['pages/knowledge/detail.wxss', '.fill-source-support-left', 'background:var(--theme-success)', ['background:#20a94a']],
    ['pages/led-screen/led-screen.wxss', '.result-label', 'color:var(--theme-text-secondary)', ['color:#6e6e73']],
    ['pages/led-screen/led-screen.wxss', '.screen-layout', 'color:var(--theme-text-secondary)', ['color:#6e6e73']],
    ['pages/led-screen/led-screen.wxss', '.wall-width-label', 'color:var(--theme-text-secondary)', ['color:#6e6e73']],
    ['pages/led-screen/led-screen.wxss', '.diagram-clearances', 'color:var(--theme-text-secondary)', ['color:#6e6e73']],
    ['pages/camera/camera.wxss', 'button.camera-action-button', 'background:var(--theme-surface)', ['background:#fff']],
    ['pages/products/library.wxss', '.hero-counts', 'color:var(--theme-accent-text)', ['color:#2c6fae']],
    ['pages/products/library.wxss', '.product-mark', 'background:var(--theme-accent-soft)', ['background:#eaf3ff']],
    ['pages/products/library.wxss', '.product-ability', 'background:var(--theme-accent-soft)', ['background:#f0f5ff']],
    ['pages/products/library.wxss', '.product-status-ready', 'background:var(--theme-control)', ['background:#eaf8ef']],
    ['pages/products/detail.wxss', '.hero-summary', 'color:var(--theme-text-secondary)', ['color:#6e6e73']],
    ['pages/products/detail.wxss', '.hero-status-ready', 'background:var(--theme-control)', ['background:#eaf8ef']],
    ['pages/products/detail.wxss', '.power-label', 'color:var(--theme-text-secondary)', ['color:#818188']],
    ['pages/limiter/limiter.wxss', '.result-label', 'color:var(--theme-text-secondary)', ['color:#6e6e73']],
    ['pages/cable/cable.wxss', '.input-unit', 'color:var(--theme-text-secondary)', ['color:#667085']],
    ['pages/cable/cable.wxss', '.result-label', 'color:var(--theme-text-secondary)', ['color:#6e6e73']],
    ['pages/records/project.wxss', '.interior-project-notes-label', 'color:var(--theme-text-secondary)', ['color:#86868b']],
  ].forEach(([file, selector, declaration, forbidden]) => {
    assertFinalThemeDeclaration(fs.readFileSync(path.join(root, file), 'utf8'), selector, declaration, `${file} 最终规则缺少 ${selector} 主题声明`, forbidden)
  })
  const recordsWxmlForTheme = fs.readFileSync(path.join(root, 'pages/records/project.wxml'), 'utf8')
  const splWxssForTheme = fs.readFileSync(path.join(root, 'pages/spl/spl.wxss'), 'utf8')
  const productsDetailWxssForTheme = fs.readFileSync(path.join(root, 'pages/products/detail.wxss'), 'utf8')
  const productsLibraryWxssForTheme = fs.readFileSync(path.join(root, 'pages/products/library.wxss'), 'utf8')
  const productsLibraryWxmlForTheme = fs.readFileSync(path.join(root, 'pages/products/library.wxml'), 'utf8')
  const productsDetailWxmlForTheme = fs.readFileSync(path.join(root, 'pages/products/detail.wxml'), 'utf8')
  const knowledgeWxssForTheme = fs.readFileSync(path.join(root, 'pages/knowledge/detail.wxss'), 'utf8')
  const knowledgeWxmlForTheme = fs.readFileSync(path.join(root, 'pages/knowledge/detail.wxml'), 'utf8')
  const demoScenesWxmlForTheme = fs.readFileSync(path.join(root, 'pages/knowledge/demo-scenes.wxml'), 'utf8')
  const limiterWxssForTheme = fs.readFileSync(path.join(root, 'pages/limiter/limiter.wxss'), 'utf8')
  const ledWxssForTheme = fs.readFileSync(path.join(root, 'pages/led-screen/led-screen.wxss'), 'utf8')
  assert(/\.input-wrap\s+text\{[^}]*color:var\(--theme-text-secondary\)/.test(ledWxssForTheme),
    'LED 输入单位未使用辅助文字主题色')
  assert(/\.field-label\{[^}]*color:var\(--theme-text-secondary\)/.test(limiterWxssForTheme),
    '限制器设备字段标签未使用辅助文字主题色')
  assert(/wx:if="\{\{project\.notes\}\}" class="interior-project-notes"/.test(recordsWxmlForTheme)
    && recordsWxmlForTheme.includes('class="interior-project-notes-label"')
    && /\.interior-project-notes-label\{[^}]*color:var\(--theme-text-secondary\)/.test(fs.readFileSync(path.join(root, 'pages/records/project.wxss'), 'utf8')),
  '项目详情须只读显示非空备注，并使用辅助文字主题色标注')
  const assertFrozenCascade = (file, selector, declaration, message, options = {}) => {
    assertThemeCascade(fs.readFileSync(path.join(root, file), 'utf8'), selector, declaration, message, options)
  }
  ;[
    ['pages/knowledge/detail.wxss', '.fill-source-main-left', 'background:var(--theme-primary-fill)', '知识页主声源左侧深色背景被覆盖'],
    ['pages/knowledge/detail.wxss', '.fill-source-main-right', 'background:var(--theme-primary-fill)', '知识页主声源右侧深色背景被覆盖'],
    ['pages/knowledge/detail.wxss', '.fill-source-main-left', 'color:#fff', '知识页主声源左侧文字色被覆盖'],
    ['pages/knowledge/detail.wxss', '.fill-source-main-right', 'color:#fff', '知识页主声源右侧文字色被覆盖'],
    ['pages/knowledge/detail.wxss', '.fill-source-support-left', 'background:var(--theme-success)', '知识页辅助声源左侧深色背景被覆盖'],
    ['pages/knowledge/detail.wxss', '.fill-source-support-right', 'background:var(--theme-success)', '知识页辅助声源右侧深色背景被覆盖'],
    ['pages/knowledge/detail.wxss', '.fill-source-support-left', 'color:var(--theme-surface)', '知识页辅助声源左侧文字色被覆盖'],
    ['pages/knowledge/detail.wxss', '.fill-source-support-right', 'color:var(--theme-surface)', '知识页辅助声源右侧文字色被覆盖'],
    ['pages/products/library.wxss', '.product-mark', 'background:var(--theme-accent-soft)', '产品标记背景被覆盖'],
    ['pages/products/library.wxss', '.product-mark', 'color:var(--theme-accent-text)', '产品标记文字色被覆盖'],
    ['pages/products/library.wxss', '.product-ability', 'background:var(--theme-accent-soft)', '产品能力标签背景被覆盖'],
    ['pages/products/library.wxss', '.product-ability', 'color:var(--theme-accent-text)', '产品能力标签文字色被覆盖'],
    ['pages/products/library.wxss', '.product-status-ready', 'background:var(--theme-control)', '产品就绪状态背景被覆盖'],
    ['pages/products/library.wxss', '.product-status-ready', 'color:var(--theme-success)', '产品就绪状态文字色被覆盖'],
    ['pages/products/detail.wxss', '.card-kicker', 'color:var(--theme-accent-text)', '产品详情卡片 kicker 文字色被覆盖'],
    ['pages/products/detail.wxss', '.hero-status-ready', 'background:var(--theme-control)', '产品详情就绪状态背景被覆盖'],
    ['pages/products/detail.wxss', '.hero-status-ready', 'color:var(--theme-success)', '产品详情就绪状态文字色被覆盖'],
    ['pages/records/project.wxss', '.interior-project-notes-label', 'color:var(--theme-text-secondary)', '记录备注标签文字色被覆盖'],
    ['pages/limiter/limiter.wxss', '.field-label', 'color:var(--theme-text-secondary)', '限制器设备字段标签文字色被覆盖'],
    ['pages/led-screen/led-screen.wxss', '.input-wrap text', 'color:var(--theme-text-secondary)', 'LED 输入单位文字色被覆盖'],
  ].forEach(([file, selector, declaration, message]) => assertFrozenCascade(file, selector, declaration, message, { darkOnly: false }))
  assert(!recordsWxmlForTheme.includes('comparisonMode') && !recordsWxmlForTheme.includes('interior-comparison-card'),
    '项目详情不再显示计算记录比较界面')
  assert(splWxml.includes('<view class="spl-value">') && splWxml.includes('<text class="spl-unit">')
    && splWxssForTheme.includes('.spl-value{') && splWxssForTheme.includes('.spl-unit{'),
  'SPL 深色数值规则未绑定真实嵌套结构')
  assert(fs.readFileSync(path.join(root, 'pages/products/detail.wxml'), 'utf8').includes('class="module-action"')
    && /\.module-action\{[^}]*background:var\(--(?:theme-primary-fill|tp)\)/.test(productsDetailWxssForTheme),
    '产品详情主操作按钮未绑定真实样式')
  ;['type-tabs', 'search-card', 'search-input', 'recent-card', 'product-comparison-table', 'product-comparison-head',
    'product-comparison-different', 'search-clear', 'product-verified-type',
    'empty-text', 'product-comparison-clear'].forEach((className) => {
    assert(productsLibraryWxmlForTheme.includes(className), `产品资料库缺少真实类 ${className}`)
  })
  assert(productsLibraryWxmlForTheme.includes('product-status-{{item.statusKey}}'),
    '产品资料库状态类未使用真实动态绑定')
  assertThemeCascade(
    `${fs.readFileSync(path.join(root, 'styles/theme-page-shared.wxss'), 'utf8')}\n${productsLibraryWxssForTheme}`,
    '.search-input', 'background:transparent', '产品资料库搜索输入框未覆盖共享双 class 深色背景', { darkOnly: true },
  )
  ;['hero-category', 'power-grid', 'spec-grid', 'camera-view-list', 'coverage-empty',
    'split-band-warning', 'lighting-mode-chip', 'missing-item', 'not-found'].forEach((className) => {
    assert(productsDetailWxmlForTheme.includes(className), `产品详情缺少真实类 ${className}`)
  })
  ;[
    ['.type-tabs', 'background:var(--theme-control)'],
    ['.recent-card', 'background:var(--theme-surface)'],
    ['.product-comparison-table', 'background:var(--theme-control)'],
    ['.product-comparison-head', 'background:var(--theme-accent-soft)'],
    ['.product-comparison-different', 'background:var(--theme-warning-soft)'],
    ['.product-status-partial', 'background:var(--theme-warning-soft)'],
    ['.search-clear', 'background:var(--theme-control)'],
    ['.product-verified-type', 'color:var(--theme-text-secondary)'],
    ['.empty-text', 'color:var(--theme-text-secondary)'],
    ['.product-comparison-clear', 'color:var(--theme-accent-text)'],
  ].forEach(([selector, declaration]) => assertThemeCascade(
    productsLibraryWxssForTheme, selector, declaration, `产品资料库最终 ${selector} 覆盖缺失`, { darkOnly: false },
  ))
  ;[
    ['.hero-category', 'background:var(--theme-control)'],
    ['.power-grid', 'background:var(--theme-control)'],
    ['.camera-view-list', 'background:var(--theme-control)'],
    ['.coverage-empty', 'background:var(--theme-control)'],
    ['.split-band-warning', 'background:var(--theme-accent-soft)'],
    ['.lighting-mode-chip', 'background:var(--theme-accent-soft)'],
    ['.missing-item', 'background:var(--theme-warning-soft)'],
    ['.not-found', 'background:var(--theme-surface)'],

  ].forEach(([selector, declaration]) => assertThemeCascade(
    productsDetailWxssForTheme, selector, declaration, `产品详情最终 ${selector} 覆盖缺失`, { darkOnly: false },
  ))
  assert(fs.readFileSync(path.join(root, 'pages/knowledge/detail.wxml'), 'utf8').includes('knowledge-error-button')
    && knowledgeWxssForTheme.includes('.knowledge-error-button{')
    && !knowledgeWxssForTheme.includes('.related-card'),
  '知识详情错误按钮或死规则校验失败')
  assert(!limiterWxssForTheme.includes('.speaker-field') && !splWxssForTheme.includes('.warning-data'),
    '限制器或 SPL 残留未使用深色选择器')
  assert(!ledWxssForTheme.includes('.screen-dimension-value') && !ledWxssForTheme.includes('.screen-size-value')
    && !ledWxssForTheme.includes('.dimension-value'), 'LED 残留未使用深色选择器')
  assert(!dmxWxss.includes('.workspace-card,.universe-card') && !dmxWxss.includes('.channel-card,.fixture-search-sheet'),
    'DMX 残留未使用卡片选择器')
  assert(dmxWxml.includes('fixtureSearchCategories') && dmxWxml.includes('fixture-category-active')
    && dmxWxml.includes('bindtap="selectFixtureCategory"') && dmxWxml.includes('item.count')
    && dmxWxml.includes('fixtureSearchResults') && dmxWxml.includes('fixture.primaryName')
    && dmxWxml.includes('fixture.model') && dmxWxml.includes('fixture.modeText') && dmxWxml.includes('bindtap="selectFixture"'), '当前目录保类别计数、型号/名称/模式及选择入口')
  assert(limiterWxml.includes('class="result-timing"')
    && limiterWxml.includes('class="result-time-grid"')
    && limiterWxml.includes('class="result-time-item"')
    && limiterWxml.includes('class="result-time-label"')
    && /class="[^"]*\bresult-time-value\b[^"]*"/.test(limiterWxml)
    && limiterWxml.includes('class="result-time-source"'),
  '限制器结果时间卡片缺少本轮深色真实结构')
  ;['fixture-category', 'fixture-search-count', 'fixture-search-row', 'fixture-result-name',
    'address-chips', 'address-chip', 'chip-check', 'floating-check-count',
    'fixture-channel-guide-list', 'fixture-channel-guide-row', 'fixture-channel-guide-detail', 'fixture-channel-guide-detail-close'].forEach((className) => {
    assert(dmxWxml.includes(`class="${className}`), `当前 DMX 页面缺少真实类 ${className}`)
  })
  ;['demo-card', 'demo-caption', 'demo-step', 'kd-scene', 'kd-limit-line', 'kd-distance', 'kd-cable', 'kd-gain', 'kd-camera', 'kd-dmx', 'kd-led'].forEach((className) => {
    assert((knowledgeWxmlForTheme + demoScenesWxmlForTheme).includes(`class="${className}`), `知识动画缺少真实类 ${className}`)
  })
  const closeout8SemanticResult = require('./closeout8-contract-regression.cjs').runCloseout8Contracts({ log: false, failFast: true })
  assert.strictEqual(closeout8SemanticResult.failures.length, 0, `Closeout 8 semantic contracts failed: ${JSON.stringify(closeout8SemanticResult.failures)}`)
  ;[
    ['.result-time-item', 'background:linear-gradient(145deg,var(--theme-surface),var(--theme-accent-soft))'],
    ['.result-time-label', 'color:var(--theme-text-secondary)'],
    ['.result-time-value', 'color:var(--theme-text)'],
    ['.result-time-source', 'color:var(--theme-text-secondary)'],
  ].forEach(([selector, declaration]) => assertThemeCascade(
    limiterWxssForTheme, selector, declaration, `限制器 dark 结果区缺少最终 ${selector} 覆盖`,
  ))
  const gainWxssForTheme = fs.readFileSync(path.join(root, 'pages/gain-structure/gain-structure.wxss'), 'utf8')
  assertDarkNoBrightTail(gainWxssForTheme, [
    { selector: '.result-card', forbidden: ['rgba(240,248,255,.92)'] },
    { selector: '.status-chip', forbidden: ['color:#087f70'] },
    { selector: '.project-row-selected', forbidden: ['background:var(--theme-accent-soft)'] },
  ], '增益结构深色亮色尾部检查')
  assertDarkNoBrightTail(splWxssForTheme, [
    { selector: '.spl-value', forbidden: ['color:#1d1d1f', 'background:#fff'] },
    { selector: '.spl-unit', forbidden: ['color:#1d1d1f', 'background:#fff'] },
  ], 'SPL 数值深色亮色尾部检查')
  assertThemeCascade(knowledgeWxssForTheme, '.knowledge-error', 'background:var(--theme-page-bg)', '知识错误页背景存在后置亮色覆盖', { darkOnly: false })
  assertThemeCascade(knowledgeWxssForTheme, '.knowledge-error-mark', 'background:var(--theme-accent-soft)', '知识错误页标记背景存在后置亮色覆盖', { darkOnly: false })
  assertThemeCascade(knowledgeWxssForTheme, '.knowledge-error-mark', 'color:var(--theme-accent-text)', '知识错误页标记文字存在后置亮色覆盖', { darkOnly: false })
  assertThemeCascade(knowledgeWxssForTheme, '.knowledge-error-title', 'color:var(--theme-text)', '知识错误页标题存在后置亮色覆盖', { darkOnly: false })
  assertThemeCascade(knowledgeWxssForTheme, '.knowledge-error-text', 'color:var(--theme-text-secondary)', '知识错误页正文存在后置亮色覆盖', { darkOnly: false })
  assertThemeCascade(knowledgeWxssForTheme, '.related-button.related-button', 'background:var(--theme-primary-fill)', '知识页主 CTA 背景存在后置覆盖', { darkOnly: false })
  assertThemeCascade(knowledgeWxssForTheme, '.related-button.related-button', 'color:#fff', '知识页主 CTA 文字存在后置覆盖', { darkOnly: false })
  assert(/button\.placement-clear-button\{[^}]*background:rgba\(220,55,55,\.08\)[^}]*color:#c63a32/.test(dmxLayoutWxss)
    && hexContrast('#c63a32', '#f5f5f7') >= 4.5,
  '当前灯位图清空操作缺少可读的浅色文字对比度')
  assert(!dmxLayoutWxml.includes('bindtap="openLandscapeLayout"')
    && !dmxLayoutWxml.includes('layout-orientation-button'),
  '已批准退役的横屏入口不得回到正式竖屏页')
  assert(dmxLayoutWxml.includes('bindtouchcancel="onCanvasTouchCancel"'), '正式竖屏灯位图没有绑定触摸取消处理')
  assert(/\.fixture-channel-guide-list\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)/s.test(dmxWxss)
    && /class="fixture-channel-guide-list"[\s\S]*class="fixture-channel-guide-row"/.test(dmxWxml)
    && /class="fixture-channel-guide-detail"[\s\S]*class="fixture-channel-guide-detail-ranges"/.test(dmxWxml)
    && dmxWxml.includes('{{item.actualAddress}}') && dmxWxml.includes('{{item.name}}')
    && dmxWxml.includes('{{fixtureChannelGuideDetail.actualAddress}}')
    && dmxWxml.includes('fixtureChannelGuideDetail.ranges')
    && /class="fixture-channel-guide-detail-close"[^>]*bindtap="closeFixtureChannelGuideDetail"/.test(dmxWxml)
    && dmxWxml.includes('catchtap="onUserCloseFixtureChannelGuide"'),
    '当前通道速查须保双列列表、实际地址/功能/范围、独立详情和关闭动作')
  // 旧 138rpx 行高仅按 750rpx / 375 CSS px 基准折算为 69 CSS px，不外推到所有视口。
  const guideRowRule = /\.fixture-channel-guide-row\s*\{([^}]*)\}/.exec(dmxWxss)
  const guideRowMinHeight = guideRowRule && /min-height:\s*(\d+(?:\.\d+)?)(px|rpx)/.exec(guideRowRule[1])
  const guideRowMinHeightPx = guideRowMinHeight && Number(guideRowMinHeight[1]) * (guideRowMinHeight[2] === 'rpx' ? 0.5 : 1)
  assert(guideRowMinHeightPx >= 69, '当前通道行低于旧 138rpx 行高在 750rpx / 375 CSS px 基准下的 69px 最小高度')
  assert(/\.fixture-channel-guide-detail\s*\{[^}]*flex-shrink:\s*0(?:;|})/s.test(dmxWxss),
    '当前通道详情必须保留不可收缩区域')
  // CSS establishes the layout box only; native touch behavior still requires a device check.
  assert(/\.floating-chips \.address-chip\{min-width:48px;min-height:44px/.test(dmxWxss)
    && /\.address-chips\{[^}]*display:flex;flex-wrap:wrap;gap:4px/.test(dmxWxss)
    && /class="address-chips floating-chips"[^>]*>\s*<view[^>]*class="address-chip \{\{chip\.checked/.test(dmxWxml),
  '浮卡中可交互地址格须有至少 44×44 CSS px 的真实节点盒')
  assert(dmxWxml.includes('{{floatingGroup.checkedCount}}') && dmxWxml.includes('{{floatingGroup.fixtureCountValue}}'),
    '当前浮卡需展示核对数量与灯具数量')
  assert(/<view(?=[^>]*class="address-chip)(?=[^>]*data-stable-id="{{chip.stableId}}")(?=[^>]*bindtap="toggleFixtureCheck")(?=[^>]*catchlongpress="openFixtureChannelGuide")[^>]*>/.test(dmxWxml)
    && dmxWxml.includes('chip.addressText')
    && dmxWxml.includes('<text wx:if="{{chip.checked}}" class="chip-check"')
    && dmxWxml.includes('>✓</text>')
    && /\.address-chip-checked\{[^}]*background:var\(--group-color\)[^}]*color:#fff/s.test(dmxWxss),
    '当前地址格需保稳定ID、实际地址、核对状态、点按核对和长按通道入口同节点')
  assert(/\.fixture-search-row-selected\s*\{[^}]*background:\s*var\(--control\)/s.test(dmxWxss)
    && !/\.fixture-search-row:active\s*,\s*\.fixture-search-row-selected/.test(dmxWxss),
    '型号选择弹层选中行使用随主题变化的中性表面')
  // Current Page overlay/style, placement, CAS, save/retry and export lifecycle contracts are registered in focused suites below.
  let cameraCanvasDrawCount = 0
  let cameraCanvasQueryCount = 0
  const cameraCanvasContext = new Proxy({}, {
    get: (target, key) => {
      if (key in target) return target[key]
      if (key === 'clearRect') return () => { cameraCanvasDrawCount += 1 }
      return () => {}
    },
    set: (target, key, value) => {
      target[key] = value
      return true
    },
  })
  const cameraCanvasNode = { getContext: () => cameraCanvasContext }
  wx.createSelectorQuery = () => {
    const query = {
      in: () => query,
      select: (selector) => {
        if (selector === '#cameraFovCanvas') cameraCanvasQueryCount += 1
        return query
      },
      fields: () => query,
      exec: (callback) => callback([{ node: cameraCanvasNode, width: 330, height: 350 }]),
    }
    return query
  }
  wx.getWindowInfo = () => ({ pixelRatio: 3 })
  const cameraPage = loadPage('pages/camera/camera.js')
  assertWxmlHandlers(cameraPage, 'pages/camera/camera.wxml')
  const cameraWxml = expandWxmlIncludes('pages/camera/camera.wxml')
  const cameraWxss = fs.readFileSync(path.join(root, 'pages/camera/camera.wxss'), 'utf8')
  const cameraJsSource = fs.readFileSync(path.join(root, 'pages/camera/camera.js'), 'utf8')
  assert(!/<(?:view|text)[^>]*class="[^"]*(?:page-header|page-title)/.test(cameraWxml),
    'V3 摄像机页面不应显示单独的页面标题；无障碍 aria-label 可以保留标题文本')
  assert(cameraWxml.includes('aria-label="摄像机安装计算"'),
    '摄像机页面滚动区域应保留可访问名称')
  assert(cameraWxml.includes('<canvas type="2d" id="cameraFovCanvas"'))
  assert(!cameraWxml.includes('安装后转向'), '摄像机页面仍保留旧云台文案')
  assert(!cameraWxml.includes('canvas-id="cameraFovCanvas"'),
    '摄像机安装示意图回退到会在真机滚动中错位的旧版 Canvas')
  assert(cameraWxml.includes('bindtap="generateResultReportImage"')
    && cameraWxml.includes('canvas-id="resultReportCanvas"')
    && cameraWxml.includes('bindtap="shareResultReportImage"')
    && cameraWxml.includes('bindtap="saveResultReportImage"'),
  '摄像机结果长图入口或预览动作不完整')
  assert(!cameraWxml.includes('镜头变焦端点'), '长焦端仍作为安装距离选项显示')
  assert(cameraWxml.includes('id="cameraInputCard" class="card camera-input-card"'), '摄像机输入项未合并到统一卡片')
  assert(cameraWxml.includes('水平距离从镜头中心量到实际拍摄区前沿；区域按宽度中心线居中。')
    && cameraWxml.includes('水平距离从镜头中心量到目标平面。'),
  '摄像机输入提示应分别说明地面和目标平面的水平距离参考')
  assert(!cameraWxml.includes('cameras[') && !cameraWxml.includes('cameras.length'),
    '摄像机 WXML 仍直接引用未暴露到页面 data 的完整产品库')
  assert(cameraWxml.includes('id="cameraResultHero" class="camera-result-screen"'), '摄像机主结果屏缺少常显结果区')
  assert(cameraWxml.includes('id="cameraFovCanvas"')
    && cameraWxml.includes('统一正交三维示意')
    && cameraJsSource.includes("renderPreviewAtSize(context, result, width, height, 'spatial', this.data.theme)"),
  '摄像机结果屏应展示当前统一正交三维示意并调用空间渲染器')
  const cameraRailStart = cameraWxml.indexOf('id="cameraResultRail"')
  const cameraHeroStart = cameraWxml.indexOf('id="cameraResultHero"')
  const cameraRail = cameraWxml.slice(cameraRailStart, cameraHeroStart)
  assert(cameraRailStart >= 0 && cameraHeroStart > cameraRailStart
    && cameraWxml.includes('id="cameraResultPane" class="camera-result-pane"'),
  '摄像机结果操作栏未覆盖在结果面板内并先于结果图')
  ;[
    ['cameraReset', 'resetToDefaults'],
    ['cameraShare', 'generateResultReportImage'],
    ['cameraFavorite', 'toggleCurrentFavorite'],
    ['cameraProject', 'saveToActiveProject'],
  ].forEach(([id, handler]) => {
    assert(new RegExp(`<button id="${id}" class="camera-action-button"(?=[^>]*bindtap="${handler}")[^>]*>`).test(cameraRail),
      `摄像机结果操作栏缺少 ${id}/${handler}`)
  })
  assert.strictEqual((cameraRail.match(/<button id="camera(?:Reset|Share|Favorite|Project)"/g) || []).length, 4,
    '摄像机 overlay rail 应恰有 reset/share/favorite/project 四个动作')
  const cameraActionStyle = cameraWxss.replace(/\s+/g, '')
  assert(/\.camera-result-rail\{[^}]*position:absolute;[^}]*right:(?:0(?:px)?|\d+px)/.test(cameraActionStyle),
    '摄像机操作 rail 应浮在结果图右侧')
  assert(/button\.camera-action-button\{[^}]*width:44px;[^}]*height:44px;[^}]*border-radius:50%/.test(cameraActionStyle),
    '摄像机 overlay 操作按钮应为 44px 圆形触控目标')
  let cameraScreenMarginRight = null
  const splitCssValues = (value) => {
    const values = []
    let depth = 0
    let current = ''
    for (const character of value.trim()) {
      if (character === '(') depth += 1
      else if (character === ')') depth = Math.max(0, depth - 1)
      if (/\s/.test(character) && depth === 0) {
        if (current) values.push(current)
        current = ''
      } else {
        current += character
      }
    }
    if (current) values.push(current)
    return values
  }
  ;[...cameraWxss.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, selectors]) => selectors.split(',').some((selector) => selector.trim() === '.camera-result-screen'))
    .forEach(([, , declarations]) => declarations.split(';').forEach((item) => {
      const separator = item.indexOf(':')
      if (separator < 0) return
      const property = item.slice(0, separator).trim()
      const value = item.slice(separator + 1).replace(/!important\s*$/, '').trim()
      if (property === 'margin-right') {
        cameraScreenMarginRight = value
      } else if (property === 'margin') {
        const values = splitCssValues(value)
        if (values.length >= 1 && values.length <= 4) {
          cameraScreenMarginRight = values.length === 1 ? values[0] : values[1]
        }
      }
    }))
  assert(['0', '0px', '0rpx'].includes(cameraScreenMarginRight),
    '摄像机主图不应为 rail 让出一列并偏离居中布局')
  const cameraCanvasTag = cameraWxml.match(/<canvas type="2d" id="cameraFovCanvas"[^>]*>/)
  assert(cameraCanvasTag
    && cameraCanvasTag[0].includes('{{result.distanceReferenceText}}')
    && cameraCanvasTag[0].includes('{{result.presentationDistanceText}}')
    && cameraCanvasTag[0].includes('{{result.heightDisplayLabel}}')
    && cameraCanvasTag[0].includes('{{result.presentationHeightText}}')
    && cameraCanvasTag[0].includes('{{result.presentationPitchLabel}}')
    && cameraCanvasTag[0].includes('{{result.presentationStatusText}}'),
  '摄像机全屏主图的无障碍名称应绑定最终展示距离、高度、俯角和状态')
  assert(!cameraWxml.includes('光学几何估算'), '摄像机结果仍显示重复的估算性质说明')
  assert(!cameraWxml.includes('区域中心距摄像机'), '摄像机结果仍显示区域中心与远沿距离说明')
  assert(cameraWxml.indexOf('id="cameraResultHero"') < cameraWxml.indexOf('id="cameraInputCard"'),
    '摄像机主结果图未出现在输入卡之前')
  ;[
    'cameraSourceTabs', 'cameraCustomPanel', 'cameraCopySummary', 'cameraCopyFull',
    'cameraResultTail', 'cameraDetailsContent', 'camera-details-card',
    'camera-formula-equation', 'camera-geometry-section', 'camera-primary-results',
    'camera-copy-actions',
  ].forEach((marker) => assert(!cameraWxml.includes(marker), `V3 摄像机界面仍包含已移除的 UI：${marker}`))
  assert(!cameraWxml.includes('bindtap="copyResult"')
    && !cameraWxml.includes('bindtap="copyInstallSummary"')
    && !cameraWxml.includes('bindtap="toggleCalculationDetails"')
    && !cameraWxml.includes('wx:for="{{result.calculationRows}}"'),
  '摄像机页面不应再显示单独复制或推导详情控件')
  const cameraInitializationSetData = cameraPage.setData
  let cameraInitializationSetDataCount = 0
  cameraPage.setData = function countCameraInitializationSetData(value, callback) {
    cameraInitializationSetDataCount += 1
    return cameraInitializationSetData.call(this, value, callback)
  }
  cameraPage.onLoad()
  cameraPage.setData = cameraInitializationSetData
  cameraPage.onShow()
  assert.strictEqual(cameraPage.data.cameraCount, 26, '摄像机选择器数量展示不正确')
  assert.strictEqual(cameraPage.data.selectedCamera.model, 'TV-6124HK', '摄像机初始化型号展示不正确')
  assert.strictEqual(cameraPage.getRecordLookupPayload().module, 'camera')
  let unchangedCameraSetDataCount = 0
  cameraPage.setData = function countUnchangedCameraSetData(value, callback) {
    unchangedCameraSetDataCount += 1
    return cameraInitializationSetData.call(this, value, callback)
  }
  cameraPage.onSceneModeTap({ currentTarget: { dataset: { index: cameraPage.data.sceneModeIndex } } })
  cameraPage.setData = cameraInitializationSetData
  assert.strictEqual(unchangedCameraSetDataCount, 0,
    'Repeatedly selecting the active camera option still recalculates and updates the view')
  assert.strictEqual(cameraInitializationSetDataCount, 1, '摄像机页面初始化仍执行多次视图提交')
  assert(cameraCanvasDrawCount > 0, '摄像机主结果屏出现后未绘制安装示意图')
  assert.strictEqual(cameraCanvasQueryCount, 1, '摄像机 Canvas 初始化查询次数异常')
  const initialCameraCanvasDrawCount = cameraCanvasDrawCount
  assert.equal(typeof cameraPage.toggleCalculationDetails, 'undefined',
    'V3 摄像机界面不应保留已移除的推导详情切换控制器')
  assert.equal(typeof cameraPage.copyInstallSummary, 'undefined',
    'V3 摄像机界面不应保留独立安装摘要复制入口')
  assert.equal(typeof cameraPage.copyResult, 'undefined',
    'V3 摄像机界面不应保留独立完整公式复制入口')
  assert(!Object.prototype.hasOwnProperty.call(cameraPage.data, 'cameras'),
    '摄像机完整产品库仍被放入页面 data')
  cameraPage.openCameraSelector()
  assert.strictEqual(cameraPage.data.selectorItems.length, 26, '摄像机选择器未加载完整可选库')
  assert(cameraPage.data.selectorItems.every((item) => !item.views && !item.source),
    '摄像机完整产品参数仍被传入视图层')
  const defaultCameraIndex = cameraPage.data.selectorItems.findIndex((item) => item.model === 'TV-6124HK')
  cameraPage.selectCamera({ currentTarget: { dataset: { index: defaultCameraIndex } } })
  assert.strictEqual(cameraPage.data.selectedCamera.model, 'TV-6124HK', '选择摄像机后型号展示未同步')
  if (cameraPage.data.viewOptions.length > 1) {
    cameraPage.onViewTap({ currentTarget: { dataset: { index: 1 } } })
    assert.strictEqual(cameraPage.data.selectedMountLabel, cameraPage.data.viewOptions[1].mountLabel,
      '切换摄像机视角后安装方式展示未同步')
    assert.strictEqual(cameraPage.data.selectedCamera.model, 'TV-6124HK', '切换视角后型号展示发生漂移')
  }
  cameraPage.onFieldInput({ currentTarget: { dataset: { field: 'groundWidthText' } }, detail: { value: '0' } })
  cameraPage.onFieldBlur()
  assert.strictEqual(cameraPage.data.result, null, '摄像机非法输入后仍保留无效结果')
  assert.strictEqual(cameraPage.data.selectedCamera.model, 'TV-6124HK', '摄像机非法输入后丢失所选型号展示')
  cameraPage.onFieldInput({ currentTarget: { dataset: { field: 'groundWidthText' } }, detail: { value: '6' } })
  cameraPage.onFieldBlur()
  assert.strictEqual(cameraCanvasQueryCount, 2, '无效输入清除结果后重新计算没有重建 Canvas 缓存')
  assert(cameraCanvasDrawCount > initialCameraCanvasDrawCount, '摄像机参数恢复有效后没有重绘示意图')
  assert.strictEqual(cameraPage.data.result.displayModel, 'TV-6124HK')
  assert.strictEqual(cameraPage.data.result.sceneMode, 'ground')
  assert.strictEqual(cameraPage.data.result.framingVersion, 2)
  assert.strictEqual(cameraPage.data.result.cameraSetbackMeters, 4.65)
  assert.strictEqual(cameraPage.data.result.primaryDistanceMeters, 4.65)
  assert(Math.abs(cameraPage.data.result.calculationDistanceMeters - 4.653141850232092) < 1e-12,
    '默认 v2 求解距离应保留完整精度')
  assert.strictEqual(cameraPage.data.result.presentedMinimumDistanceMeters, 4.66)
  assert.strictEqual(cameraPage.data.result.presentationDistanceText, '4.66 m')
  assert.strictEqual(cameraPage.data.result.cameraHeightMeters, 2.3)
  assert.strictEqual(cameraPage.data.result.presentationHeightText, '2.30 m')
  assert.strictEqual(cameraPage.data.result.presentationPitchLabel, '俯角 14.8°')
  assert.strictEqual(cameraPage.data.result.presentationStatusText, cameraPage.data.result.calculationConclusion)
  assert.strictEqual(cameraPage.data.result.distanceMeaning, '当前模型下理论最小距离')
  assert.deepStrictEqual(cameraPage.data.result.calculationRows, [
    {
      title: '确定真实目标边界',
      formula: '场地纵深保持输入值，投影目标各角点到相机取景截面',
      substitution: '宽 6 m，纵深 4 m',
      value: '使用镜头中心与俯仰基底',
    },
    {
      title: '加入取景余量',
      formula: '投影包络总宽、总高分别 × (1 + 余量)，两侧均分',
      substitution: '1 + 10%',
      value: '每侧 5%',
    },
    {
      title: '求解前沿退距',
      formula: '扩张后的水平、垂直投影包络同时位于镜头视场角内',
      substitution: '镜头高 2.30 m，俯角 14.8°；水平 71°，垂直 42.7°',
      value: '4.66 m',
    },
  ])
  assert.strictEqual(cameraPage.data.result.calculationVisual.horizontalBarPercent, 100)
  assert.strictEqual(cameraPage.data.result.calculationVisual.verticalBarPercent, 100)
  assert.strictEqual(cameraPage.data.result.calculationVisual.limitingAxisLabel, '水平下限处垂直校核通过')
  assert.strictEqual(cameraPage.data.result.calculationVisual.hasDepthMargin, false)
  assert(!Object.prototype.hasOwnProperty.call(cameraPage.getPreferences(), 'endpoint'),
    '摄像机新记录仍保存已取消的长焦端点字段')
  const originalCameraSetData = cameraPage.setData
  let cameraCalculationSetDataCount = 0
  cameraPage.setData = function setDataWithCount(value, callback) {
    cameraCalculationSetDataCount += 1
    originalCameraSetData.call(this, value, callback)
  }
  cameraPage.calculate()
  cameraPage.setData = originalCameraSetData
  assert.strictEqual(cameraCalculationSetDataCount, 1, '未变化的收藏状态仍触发重复 setData')
  assert.strictEqual(cameraCanvasQueryCount, 2, '重复计算时重新查询或创建了 Canvas')
  cameraPage.onFieldInput({
    currentTarget: { dataset: { field: 'groundWidthText' } },
    detail: { value: '7' },
  })
  assert.strictEqual(cameraPage.data.result.widthMeters, 6, '输入事件未经过合并计算')
  cameraPage.onFieldBlur()
  assert.strictEqual(cameraPage.data.result.widthMeters, 7, '输入结束后未立即刷新计算')
  cameraPage.onFieldInput({
    currentTarget: { dataset: { field: 'groundWidthText' } },
    detail: { value: '6' },
  })
  cameraPage.onFieldBlur()
  assert.strictEqual(cameraCanvasQueryCount, 2, '输入刷新时未复用 Canvas')
  const groundCameraText = cameraPage.getResultText()
  assert(groundCameraText.includes('摄像机安装反算｜地面区域'))
  assert(groundCameraText.includes('摄像机距区域前沿：4.66 m'))
  assert(groundCameraText.includes('建议镜头中心高度：2.30 m'))
  assert.strictEqual(cameraPage.data.result.presentationAimText, '向下 14.8°')
  assert.strictEqual(cameraPage.data.result.mountType, 'ptz', '默认 TV-6124HK 安装结构应为机械云台')
  assert.strictEqual(cameraPage.data.result.mountLabel, '机械云台')
  assert.strictEqual(cameraPage.data.result.aimLabel, '机械云台水平与俯仰')
  assert(groundCameraText.includes('机械云台水平与俯仰：向下 14.8°'),
    'PTZ v2 report text must retain the approved displayed aim and direction')
  assert(groundCameraText.includes('计算结论：当前展示的距离、高度与俯仰组合通过模型双轴校核；实际安装仍需现场复核。'),
    'current v2 result text must identify the complete displayed tuple and site-review limit')
  assert(groundCameraText.includes('展示状态：当前展示的距离、高度与俯仰组合通过模型双轴校核；实际安装仍需现场复核。'),
    'current v2 status text must match its displayed tuple')
  assert(groundCameraText.includes('安装点位统一按广角端计算'))
  assert(groundCameraText.includes('计算过程：'))
  assert(groundCameraText.includes('扩张后的水平、垂直投影包络同时位于镜头视场角内'))
  assert(groundCameraText.includes('镜头高 2.30 m，俯角 14.8°；水平 71°，垂直 42.7°'))
  assert(!groundCameraText.includes('max(Dₕ, Dᵥ)'), 'camera result should describe the constrained vertical check rather than independent max distance')
  const groundCameraPayload = cameraPage.getRecordPayload()
  assert.strictEqual(groundCameraPayload.resultText, groundCameraText,
    'camera record payload must retain the same complete v2 presentation text')
  let cameraReportExportCount = 0
  let exportedCameraReport = null
  const cameraReportTextLines = []
  const cameraReportContext = new Proxy({}, {
    get: (target, key) => {
      if (key === 'measureText') return (text) => ({ width: String(text).length * 14 })
      if (key === 'fillText') return (text) => { cameraReportTextLines.push(String(text)) }
      if (key === 'draw') return (reserve, callback) => {
        const done = typeof reserve === 'function' ? reserve : callback
        if (done) done()
      }
      return () => {}
    },
  })
  wx.createCanvasContext = (canvasId) => {
    assert.strictEqual(canvasId, 'resultReportCanvas')
    return cameraReportContext
  }
  wx.canvasToTempFilePath = (options) => {
    cameraReportExportCount += 1
    exportedCameraReport = options
    options.success({ tempFilePath: 'temp://camera-result.png' })
  }
  wx.showLoading = () => {}
  wx.hideLoading = () => {}
  cameraPage.generateResultReportImage()
  assert.strictEqual(cameraPage.data.resultReportImagePath, 'temp://camera-result.png')
  assert.strictEqual(cameraPage.data.resultReportPreviewVisible, true)
  assert(cameraReportTextLines.some((text) => text.includes('4.66 m')), 'camera report omitted the v2 displayed distance')
  assert(cameraReportTextLines.some((text) => text.includes('2.30 m')), 'camera report omitted the v2 displayed height')
  assert(cameraReportTextLines.some((text) => text.includes('向下 14.8°')), 'camera report omitted the v2 displayed pitch')
  assert(exportedCameraReport.destWidth <= 1500 && exportedCameraReport.destHeight <= 4096,
    '摄像机结果图导出尺寸超过安全上限')
  cameraPage.closeResultReportPreview()
  const previousCameraGetFileSystemManager = wx.getFileSystemManager
  let cameraReportCacheAccessPath = ''
  wx.getFileSystemManager = () => ({ access: ({ path, success }) => {
    cameraReportCacheAccessPath = path
    success()
  } })
  cameraPage.generateResultReportImage()
  assert.strictEqual(cameraReportExportCount, 1, '相同摄像机结果没有复用已生成图片')
  assert.strictEqual(cameraReportCacheAccessPath, 'temp://camera-result.png',
    '摄像机缓存复用未校验本地图片路径')
  if (previousCameraGetFileSystemManager === undefined) delete wx.getFileSystemManager
  else wx.getFileSystemManager = previousCameraGetFileSystemManager
  cameraPage.onSceneModeTap({ currentTarget: { dataset: { index: 1 } } })
  assert.strictEqual(cameraPage.data.resultReportImagePath, '', '摄像机参数变化后仍沿用旧结果图片')
  cameraPage.generateResultReportImage()
  assert.strictEqual(cameraReportExportCount, 2, '摄像机参数变化后未重新生成结果图片')
  delete wx.createCanvasContext
  delete wx.canvasToTempFilePath
  delete wx.showLoading
  delete wx.hideLoading
  assert.strictEqual(cameraPage.data.result.sceneMode, 'plane')
  assert.strictEqual(cameraPage.data.result.distanceMeters, 4.63)
  const planeCameraText = cameraPage.getResultText()
  assert(planeCameraText.includes('摄像机安装反算｜垂直平面'))
  assert(planeCameraText.includes('摄像机距目标平面：4.63 m'))
  cameraPage.onSceneModeTap({ currentTarget: { dataset: { index: 0 } } })
  const fixedCameraIndex = cameraPage.data.selectorItems.findIndex((item) => item.model === 'TS-0663JP')
  cameraPage.selectCamera({ currentTarget: { dataset: { index: fixedCameraIndex } } })
  assert.strictEqual(cameraPage.data.selectedCamera.model, 'TS-0663JP', '切换固定安装摄像机后型号展示未同步')
  assert.strictEqual(cameraPage.data.result.mountLabel, '电子云台（固定安装）')
  assert.strictEqual(cameraPage.data.result.requiresInitialAim, true)
  assert(cameraPage.data.result.aimValue.includes('向下'))
  const multiViewCameraIndex = cameraPage.data.selectorItems.findIndex((item) => item.model === 'TS-0650JSM')
  cameraPage.selectCamera({ currentTarget: { dataset: { index: multiViewCameraIndex } } })
  assert.strictEqual(cameraPage.data.selectedCamera.model, 'TS-0650JSM', '切换多视角摄像机后型号展示未同步')
  assert(cameraPage.data.viewOptions.length > 1, '多视角摄像机测试样本未提供多个视角')
  cameraPage.onViewTap({ currentTarget: { dataset: { index: 1 } } })
  assert.strictEqual(cameraPage.data.selectedMountLabel, getCameraMountLabel(findByModel(cameras, 'TS-0650JSM'), 1),
    '多视角摄像机切换视角后安装方式展示未同步')
  const fixedHorizontalCameraIndex = cameraPage.data.selectorItems.findIndex((item) => item.model === 'TV-6124UK')
  cameraPage.selectCamera({ currentTarget: { dataset: { index: fixedHorizontalCameraIndex } } })
  assert.strictEqual(cameraPage.data.selectedCamera.model, 'TV-6124UK', '切换水平视场摄像机后型号展示未同步')
  assert.strictEqual(cameraPage.data.result.mountLabel, '固定式/枪机')
  assert.strictEqual(cameraPage.data.result.horizontalOnly, true)
  assert.strictEqual(cameraPage.data.result.requiresInitialAim, true)
  const horizontalCameraIndex = cameraPage.data.selectorItems.findIndex((item) => item.model === 'TV-MU650X')
  cameraPage.selectCamera({ currentTarget: { dataset: { index: horizontalCameraIndex } } })
  assert.strictEqual(cameraPage.data.selectedCamera.model, 'TV-MU650X', '切换水平预估摄像机后型号展示未同步')
  assert.strictEqual(cameraPage.data.result.horizontalOnly, true)
  assert(cameraPage.data.result.distanceMeaning.includes('非完整安装距离'))
  assert(cameraPage.getResultText().includes('垂直未校核'))
  assert.strictEqual(cameraPage.getPreferences().sourceMode, 'library',
    'camera page preferences must remain library-bound after selecting a catalog camera')
  delete wx.createSelectorQuery
  delete wx.getWindowInfo

  const legacyProject = recordsApi.createProject('Release legacy project')
  const project = recordsApi.createProject('Release selected project')
  const legacyActiveKey = 'audioTool.activeProject.v1'
  assert(legacyProject && project)
  assert.strictEqual(recordsApi.setActiveProject(legacyProject.id).id, legacyProject.id,
    'the legacy setter remains available for compatibility')
  const legacyKeyValueBeforeSave = storage.get(legacyActiveKey)
  const legacyKeyWritesBeforeSave = storageWriteCounts.get(legacyActiveKey) || 0
  const previousGetCurrentPages = global.getCurrentPages
  const previousSplPageVisibility = splPage._pageVisible
  splPage._pageVisible = true
  global.getCurrentPages = () => [splPage]
  const previousSplSetTimeoutForProject = global.setTimeout
  const previousSplClearTimeoutForProject = global.clearTimeout
  const projectTimers = []
  global.setTimeout = (callback, delay) => {
    const timer = { callback, delay, cleared: false }
    projectTimers.push(timer)
    return timer
  }
  global.clearTimeout = (timer) => { if (timer) timer.cleared = true }
  const writesBeforeProjectSelection = storageWriteCount
  const recordsBeforeProjectSelection = recordsApi.getRecords().length
  assert.strictEqual(splPage.openProjectSheet(), true, 'saving a result must open the project chooser')
  assert.strictEqual(storageWriteCount, writesBeforeProjectSelection,
    'opening the project chooser must not save the result')
  assert.strictEqual(recordsApi.getRecords().length, recordsBeforeProjectSelection,
    'the result must remain unsaved until a project is selected')
  assert.strictEqual(recordsApi.getProjectRecords(project.id).length, 0)
  assert(splPage.data.projectItems.some((item) => item.id === project.id))
  assert(splPage.data.projectItems.some((item) => item.id === legacyProject.id))
  assert(splPage.data.projectItems.every((item) => !Object.hasOwn(item, 'isActive')),
    'the project chooser lists targets without binding a legacy current-project state')
  assert.strictEqual(splPage.chooseProject({ currentTarget: { dataset: { id: project.id } } }), true)
  assert.strictEqual(splPage.data.projectStep, 'details')
  assert.strictEqual(splPage.data.projectTargetId, project.id)
  assert.strictEqual(storageWriteCount, writesBeforeProjectSelection,
    'choosing a project must not save before the explicit configuration confirmation')
  assert.strictEqual(recordsApi.getRecords().length, recordsBeforeProjectSelection)
  assert.strictEqual(splPage.closeProjectSheet(), true, 'canceling the project sheet must close it')
  const projectCloseTimer = projectTimers.find((timer) => timer.delay === 320 && !timer.cleared)
  assert(projectCloseTimer, 'project sheet close must retain its close lifecycle')
  projectCloseTimer.callback()
  assert.strictEqual(storageWriteCount, writesBeforeProjectSelection,
    'canceling before explicit save must not write the result')
  assert.strictEqual(recordsApi.getRecords().length, recordsBeforeProjectSelection)
  assert.strictEqual(recordsApi.getProjectRecords(project.id).length, 0)

  assert.strictEqual(splPage.openProjectSheet(), true)
  assert.strictEqual(splPage.data.projectStep, 'details')
  assert.strictEqual(splPage.data.projectTargetId, project.id,
    'the previous user-selected target must be restored without writing a record')
  assert.strictEqual(storageWriteCount, writesBeforeProjectSelection)
  assert.strictEqual(recordsApi.getRecords().length, recordsBeforeProjectSelection)
  const saveConfirmationAccepted = splPage.saveProjectConfiguration()
  assert.strictEqual(saveConfirmationAccepted, true, 'explicit project configuration confirmation must save')
  const recordsAfterProjectConfirmation = recordsApi.getRecords().length
  assert.strictEqual(recordsAfterProjectConfirmation, recordsBeforeProjectSelection + 1,
    'confirming the project save must create one canonical record')
  assert.strictEqual(splPage.saveProjectConfiguration(), false,
    'a second confirmation after the save must not save a duplicate record')
  assert.strictEqual(recordsApi.getRecords().length, recordsAfterProjectConfirmation)
  global.setTimeout = previousSplSetTimeoutForProject
  global.clearTimeout = previousSplClearTimeoutForProject
  if (previousGetCurrentPages === undefined) delete global.getCurrentPages
  else global.getCurrentPages = previousGetCurrentPages
  if (previousSplPageVisibility === undefined) delete splPage._pageVisible
  else splPage._pageVisible = previousSplPageVisibility
  assert(recordsApi.getProjectRecords(project.id).length > 0)
  assert.strictEqual(recordsApi.getProjectRecords(legacyProject.id).length, 0,
    'the result must be saved only to the explicitly selected project')
  assert.strictEqual(storage.get(legacyActiveKey), legacyKeyValueBeforeSave,
    'explicit project selection leaves the historical raw key unchanged')
  assert.strictEqual(storageWriteCounts.get(legacyActiveKey) || 0, legacyKeyWritesBeforeSave,
    'project selection and record saving never write the historical raw key')
  assert.strictEqual(recordsApi.getActiveProject().id, legacyProject.id,
    'the retained legacy getter remains available without driving project selection')
  storage.set('audioTool.records.v1', [
    ...storage.get('audioTool.records.v1'),
    {
      id: 'legacy-recent-record',
      module: 'spl',
      title: '旧版最近记录',
      summary: '升级时应自动清理',
      preferences: { legacy: true },
      resultText: '旧版普通历史',
      favorite: false,
      projectIds: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
  ])
  storage.set('audioTool.projects.v1', storage.get('audioTool.projects.v1').map(({ roomLengthText, ...item }) => item))
  storage.set('audioTool.storageSchemaVersion', 1)
  assert.strictEqual(recordsApi.getProjects()[0].roomLengthText, '')
  assert.strictEqual(storage.get('audioTool.storageSchemaVersion'), recordsApi.STORAGE_SCHEMA_VERSION)
  assert(!recordsApi.getRecords().some((record) => record.id === 'legacy-recent-record'))
  assert.strictEqual(recordsApi.getProjectRecords(project.id).length, 1)
  const migratedLegacyRecent = recordsApi.getRecoveryEntries().find((entry) => entry.kind === 'legacy-recent'
    && entry.snapshot?.id === 'legacy-recent-record')
  assert(migratedLegacyRecent, '旧版最近记录应进入可恢复区，而不是被静默丢弃')
  const limiterPayload = limiterPage.getRecordPayload()
  recordsApi.addRecordToProject(limiterPayload, project.id)
  assert.strictEqual(recordsApi.getProjectRecords(project.id).length, 2)
  const legacyKeyReadsBeforeSnapshot = storageReadCounts.get(legacyActiveKey) || 0
  const workspaceSnapshot = recordsApi.getWorkspaceSnapshot({ forceRefresh: true })
  assert.strictEqual(workspaceSnapshot.projects.length, 2)
  assert.strictEqual(workspaceSnapshot.activeProject, null)
  assert.strictEqual(storageReadCounts.get(legacyActiveKey) || 0, legacyKeyReadsBeforeSnapshot,
    'the new workspace snapshot neither reads nor resolves the historical active-project key')
  assert.strictEqual(workspaceSnapshot.records.length, recordsApi.getRecords().length)
  const originalSetStorageSync = wx.setStorageSync
  const limiterRecordBeforeFailure = recordsApi.getRecordByPayload(limiterPayload)
  wx.setStorageSync = (key, value) => {
    if (key === 'audioTool.projects.v1') throw new Error('simulated project storage failure')
    originalSetStorageSync(key, value)
  }
  assert.strictEqual(recordsApi.removeRecordFromProject(limiterRecordBeforeFailure.id, project.id), false)
  assert(recordsApi.getProjectRecords(project.id).some((record) => record.id === limiterRecordBeforeFailure.id),
    '项目更新时间写入失败后，记录归属没有回滚')
  wx.setStorageSync = (key, value) => {
    if (key === 'audioTool.activeProject.v1') throw new Error('simulated active project storage failure')
    originalSetStorageSync(key, value)
  }
  assert.strictEqual(recordsApi.setActiveProject(project.id), null,
    '当前项目写入失败时仍返回设置成功')
  wx.setStorageSync = originalSetStorageSync
  assert.strictEqual(recordsApi.restoreRecord(recordsApi.getRecordByPayload(limiterPayload)), '/pages/limiter/limiter')
  const recordStorageReads = storageReadCounts.get('audioTool.records.v1') || 0
  recordsApi.getRecordByPayload(limiterPayload)
  recordsApi.getRecordByPayload(limiterPayload)
  assert.strictEqual(storageReadCounts.get('audioTool.records.v1') || 0, recordStorageReads,
    'Repeated favorite lookups should reuse the normalized record index instead of reading storage')
  const persistentRecordCount = recordsApi.getRecords().length
  for (let index = 0; index < 25; index += 1) {
    const transientRecord = recordsApi.saveRecord({
      module: 'spl',
      title: `测试记录 ${index}`,
      summary: '普通计算不应自动保存',
      preferences: { testIndex: index },
      resultText: `测试结果 ${index}`,
    })
    assert.strictEqual(transientRecord, null)
  }
  const storedRecords = recordsApi.getRecords()
  assert.strictEqual(storedRecords.length, persistentRecordCount)
  assert(storedRecords.every((record) => record.projectIds.length), '持久计算记录必须保留明确项目归属')
  const favoriteSnapshots = recordsApi.getFavorites()
  const limiterFavorite = favoriteSnapshots.find((favorite) => favorite.module === 'limiter')
  assert(limiterFavorite && limiterFavorite.id.startsWith('favorite-'), '收藏应保存为独立且稳定编号的快照')
  assert(!storedRecords.some((record) => record.id === limiterFavorite.id || record.favorite === true),
    '独立收藏快照不得伪装成项目计算记录')

  const appConfig = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'))
  assert.deepStrictEqual(
    appConfig.tabBar.list.map((item) => item.pagePath),
    ['pages/tools/tools', 'pages/projects/projects', 'pages/index/index'],
  )
  assert.deepStrictEqual(
    appConfig.tabBar.list.map((item) => item.text),
    ['工具', '项目', '依据'],
    '主导航顺序应与工具、项目、依据一致',
  )
  const tabThemeConfig = JSON.parse(fs.readFileSync(path.join(root, 'theme.json'), 'utf8'))
  appConfig.tabBar.list.forEach((item) => {
    const resolveThemePath = (value) => tabThemeConfig.light[value.slice(1)]
    assert(fs.existsSync(path.join(root, resolveThemePath(item.iconPath))), `${item.text}页签缺少默认图标`)
    assert(fs.existsSync(path.join(root, resolveThemePath(item.selectedIconPath))), `${item.text}页签缺少选中图标`)
  })

  const toolRegistry = require('../utils/tool-registry')
  const indexSource = fs.readFileSync(path.join(root, 'pages/index/index.js'), 'utf8')
  assert(!indexSource.includes('knowledgeItems') && indexSource.includes('getBasisTools'),
    '依据首页应从统一工具注册表读取计算依据入口')
  const indexPage = loadPage('pages/index/index.js')
  assertWxmlHandlers(indexPage, 'pages/index/index.wxml')
  assert.deepStrictEqual(indexPage.data.basisTools, [], '依据目录首次渲染前应为空，避免隐藏条目闪现')
  const visibilityKey = require('../utils/tool-visibility').TOOL_VISIBILITY_KEY
  const hadVisibilityPreference = storage.has(visibilityKey)
  const previousVisibilityPreference = storage.get(visibilityKey)
  const previousGetApp = global.getApp
  global.getApp = () => ({ globalData: { primaryNavigation: { launchPath: '', restoreAllowed: false, restoreChecked: true } } })
  storage.delete(visibilityKey)
  indexPage.onShow()
  assert.deepStrictEqual(indexPage.data.basisTools.map(({ id }) => id),
    ['cable', 'gainStructure', 'limiter', 'spl', 'camera', 'ledScreen'])
  assert.deepStrictEqual(indexPage.data.basisTools, toolRegistry.getBasisTools(),
    '依据首页入口必须与工具注册表保持一致')
  assert.strictEqual(indexPage.data.visibilityReady, true, '依据目录应在 onShow 后标记为可显示')
  storage.set(visibilityKey, { version: 1, hiddenToolIds: ['camera'] })
  indexPage.onShow()
  assert(!indexPage.data.basisTools.some(({ id }) => id === 'camera'), '依据页 onShow 应同步隐藏设置已关闭的工具')
  storage.delete(visibilityKey)
  indexPage.onShow()
  assert.deepStrictEqual(indexPage.data.basisTools, toolRegistry.getBasisTools(), '重新显示工具后依据入口应在 onShow 恢复')
  if (hadVisibilityPreference) storage.set(visibilityKey, previousVisibilityPreference)
  else storage.delete(visibilityKey)
  indexPage.data.basisTools.forEach((item) => {
    assert.strictEqual(item.path, `/pages/basis/detail?tool=${encodeURIComponent(item.id)}`)
    assert.strictEqual(toolRegistry.getBasisTool(item.id).id, item.id)
    assert.strictEqual(item.title, toolRegistry.getTool(item.id).title)
  })
  const indexWxml = fs.readFileSync(path.join(root, 'pages/index/index.wxml'), 'utf8')
  assert(indexWxml.includes('wx:for="{{basisTools}}"') && indexWxml.includes('url="{{item.path}}"'))
  assert(indexWxml.includes('{{item.title}}') && indexWxml.includes('{{item.subject}}')
    && indexWxml.includes('{{item.summary}}') && indexWxml.includes('查看图解与说明'))
  assert(!indexWxml.includes('item.category') && !indexWxml.includes('home-basis-category'), '依据目录不应显示右上角分类标签')
  assert(!indexWxml.includes('knowledgeItems') && !indexWxml.includes('知识文章'))
  const indexWxss = fs.readFileSync(path.join(root, 'pages/index/index.wxss'), 'utf8')
  assert(indexWxss.includes('@import "../../styles/homepage.wxss"'))
  assert(indexWxss.includes('.home-basis-row') && indexWxss.includes('var(--theme-surface)')
    && indexWxss.includes('prefers-reduced-motion'))
  assert.strictEqual(storage.get('audioTool.primaryTab.v1'), 'basis', '依据页显示时应记录依据主标签')
  if (previousGetApp === undefined) delete global.getApp
  else global.getApp = previousGetApp
  const toolsSource = fs.readFileSync(path.join(root, 'pages/tools/tools.js'), 'utf8')
  assert(!toolsSource.includes("require('../../data/equipment')"), '工具页应通过工具注册表惰性展示入口')
  assert(!toolsSource.includes("require('../../data/cameras')"), '工具页不应加载完整摄像机库')
  const toolsPage = loadPage('pages/tools/tools.js')
  const toolsWxss = fs.readFileSync(path.join(root, 'pages/tools/tools.wxss'), 'utf8')
  const toolsWxssCompact = toolsWxss.replace(/\s+/g, '')
  const toolsWxml = fs.readFileSync(path.join(root, 'pages/tools/tools.wxml'), 'utf8')
  const toolImageNames = [
    'module-gain-structure-catalog.png', 'module-limiter-catalog.png', 'module-spl-catalog.png',
    'module-cable-catalog.png', 'module-camera-catalog.png',
    'module-led-screen-catalog.png', 'module-dmx-address-catalog.png', 'module-library-catalog.png',
  ]
  const parsePngHeader = (file) => {
    const bytes = fs.readFileSync(file)
    assert(bytes.readUInt32BE(0) === 0x89504e47 && bytes.readUInt32BE(4) === 0x0d0a1a0a, `${file} 不是 PNG`)
    let offset = 8
    let width = 0
    let height = 0
    let colorType = 0
    let hasTransparency = false
    while (offset + 12 <= bytes.length) {
      const length = bytes.readUInt32BE(offset)
      const type = bytes.toString('ascii', offset + 4, offset + 8)
      const dataStart = offset + 8
      const dataEnd = dataStart + length
      assert(dataEnd + 4 <= bytes.length, `${file} PNG chunk 越界：${type}`)
      if (type === 'IHDR') {
        width = bytes.readUInt32BE(offset + 8)
        height = bytes.readUInt32BE(offset + 12)
        colorType = bytes[offset + 17]
      } else if (type === 'tRNS') {
        for (let index = dataStart; index < dataEnd; index += 1) {
          if (bytes[index] < 255) {
            hasTransparency = true
            break
          }
        }
      }
      offset += length + 12
      if (type === 'IEND') break
    }
    assert(width === 256 && height === 256, `${file} 尺寸不是 256x256`)
    assert(colorType === 4 || colorType === 6 || (colorType === 3 && hasTransparency), `${file} 缺少真实 alpha 通道`)
    return bytes.length
  }
  const toolImageBytes = toolImageNames.reduce((total, name) => {
    const file = path.join(root, 'assets', 'home', name)
    assert(fs.existsSync(file) && toolRegistry.TOOLS.some((tool) => tool.icon === `/assets/home/${name}`), `工具注册表缺少 PNG 引用或文件：${name}`)
    const bytes = parsePngHeader(file)
    assert(bytes <= 20 * 1024, `工具透明 PNG 超过 20 KiB：${name}`)
    return total + bytes
  }, 0)
  assert(toolImageBytes <= 112 * 1024, `工具透明 PNG 超过 112 KiB：${formatKiB(toolImageBytes)}`)
  const audioWiringCatalogImage = 'module-audio-wiring-catalog.png'
  const audioWiringCatalogPath = path.join(root, 'assets', 'home', audioWiringCatalogImage)
  assert(fs.existsSync(audioWiringCatalogPath) && toolRegistry.getTool('audioWiring').icon === `/assets/home/${audioWiringCatalogImage}`,
    '接线助手注册表缺少透明 PNG 引用或文件')
  const audioWiringCatalogBytes = parsePngHeader(audioWiringCatalogPath)
  assert(audioWiringCatalogBytes <= 20 * 1024,
    '接线助手工具卡透明 PNG 超过 20 KiB')
  assert(toolImageBytes + audioWiringCatalogBytes <= 121 * 1024,
    `九张工具透明 PNG 超过 121 KiB：${formatKiB(toolImageBytes + audioWiringCatalogBytes)}`)
  const projectWiringCatalogImage = 'module-project-wiring-catalog.png'
  const projectWiringCatalogPath = path.join(root, 'assets', 'home', projectWiringCatalogImage)
  assert(fs.existsSync(projectWiringCatalogPath) && toolRegistry.getTool('projectWiring').icon === `/assets/home/${projectWiringCatalogImage}`,
    '通道与线缆注册表缺少专属 PNG 引用或文件')
  const projectWiringCatalogBytes = parsePngHeader(projectWiringCatalogPath)
  assert(projectWiringCatalogBytes <= 20 * 1024,
    '通道与线缆工具卡透明 PNG 超过 20 KiB')
  const projectConfigForToolAssets = JSON.parse(fs.readFileSync(path.join(root, 'project.config.json'), 'utf8'))
  const ignoredToolJpgs = new Set((projectConfigForToolAssets.packOptions?.ignore || []).map((item) => item.value))
  ;['cable', 'limiter', 'spl'].forEach((id) => {
    assert(ignoredToolJpgs.has(`assets/home/module-${id}-catalog.jpg`), `旧工具 JPG 未加入忽略：${id}`)
  })
  ;['camera', 'dmx-address', 'led-screen', 'gain-structure'].forEach((id) => {
    assert(fs.existsSync(path.join(root, 'assets', 'home', `module-${id}-catalog.jpg`)), `文章复用 JPG 缺失：${id}`)
    assert(!ignoredToolJpgs.has(`assets/home/module-${id}-catalog.jpg`), `文章复用 JPG 被错误忽略：${id}`)
  })
  ;['cable', 'limiter', 'spl'].forEach((id) => {
    assert(fs.existsSync(path.join(root, 'assets', 'home', `module-${id}-catalog.jpg`)), `旧工具 JPG 缺失：${id}`)
  })
  const cutout = require('./generate-tool-cutouts')
  const sample = Buffer.from([255, 255, 255, 255, 100, 110, 120, 255, 255, 0, 0, 255, 220, 240, 255, 255])
  const originalSample = Buffer.from(sample)
  cutout.applyWhiteMatte(sample)
  assert.strictEqual(sample[3], 0, '白色 matte 未透明')
  assert.deepStrictEqual([...sample.slice(4, 7)], [...originalSample.slice(4, 7)], '暗色设备像素被改变')
  assert.deepStrictEqual([...sample.slice(8, 11)], [...originalSample.slice(8, 11)], '饱和色像素溢出或被改变')
  const paleAlpha = sample[15] / 255
  assert(paleAlpha > 0 && paleAlpha < 1, '浅蓝半透明 matte 未保留')
  for (let channel = 0; channel < 3; channel += 1) {
    const rebuilt = sample[12 + channel] * paleAlpha + 255 * (1 - paleAlpha)
    assert(Math.abs(rebuilt - originalSample[12 + channel]) <= 1.1, '浅蓝去白重建误差超过 1')
  }
  const ledSource = Buffer.alloc(256 * 256 * 4, 0)
  const ledPanel = Buffer.alloc(256 * 256 * 4, 0)
  ledSource[(100 * 256 + 100) * 4] = 17
  ledSource[(100 * 256 + 100) * 4 + 3] = 255
  cutout.restoreLedPanel(ledPanel, ledSource, 256, 256)
  assert.strictEqual(ledPanel[(100 * 256 + 100) * 4], 17, 'LED 屏内部保护区未恢复')
  assert.strictEqual(ledPanel[(100 * 256 + 100) * 4 + 3], 255, 'LED 屏内部保护区 alpha 未恢复')
  assert.strictEqual(ledPanel[(10 * 256 + 10) * 4 + 3], 0, 'LED 屏外部区域被错误恢复')
  assert.strictEqual(ledPanel[(195 * 256 + 230) * 4 + 3], 0, 'LED 屏右下外部区域被错误恢复')
  assertWxmlHandlers(toolsPage, 'pages/tools/tools.wxml')
  assert.deepStrictEqual(toolsPage.data.categories, ['全部', '布线', '音频', '视频', '灯光', '中控', '资料'])
  assert.strictEqual(toolsPage.data.activeCategory, '全部')
  assert.deepStrictEqual(toolsPage.data.tools, [], '显示偏好读取前不应闪现已隐藏工具')
  toolsPage.onShow()
  assert.deepStrictEqual(toolsPage.data.tools.map(({ id }) => id), toolRegistry.getTools().map(({ id }) => id))
  const registeredAppRoutes = new Set([
    ...appConfig.pages,
    ...(appConfig.subPackages || []).flatMap((pack) => pack.pages.map((page) => `${pack.root}/${page}`)),
  ])
  toolRegistry.getTools().forEach((tool) => {
    const route = tool.path.replace(/^\//, '').split('?')[0]
    assert(registeredAppRoutes.has(route), `${tool.id} 工具入口必须指向已注册路由：${tool.path}`)
    if (recordsApi.MODULES[tool.id]) assert.strictEqual(tool.path, recordsApi.MODULES[tool.id].path)
  })
  toolsPage.onCategoryTap({ currentTarget: { dataset: { category: '视频' } } })
  assert.strictEqual(toolsPage.data.activeCategory, '视频')
  assert.deepStrictEqual(toolsPage.data.tools.map(({ id }) => id), ['camera', 'ledScreen'])
  const videoTools = toolsPage.data.tools
  toolsPage.onCategoryTap({ currentTarget: { dataset: { category: '无效分类' } } })
  assert.strictEqual(toolsPage.data.activeCategory, '视频', '无效分类不能改变当前筛选状态')
  assert.deepStrictEqual(toolsPage.data.tools, videoTools)
  toolsPage.onCategoryTap({ currentTarget: { dataset: { category: '全部' } } })
  assert.deepStrictEqual(toolsPage.data.tools.map(({ id }) => id), toolRegistry.getTools().map(({ id }) => id))

  const previousToolGetApp = global.getApp
  global.getApp = () => ({ globalData: { primaryNavigation: { launchPath: '', restoreAllowed: false, restoreChecked: true } } })
  toolsPage.onShow()
  assert.strictEqual(storage.get('audioTool.primaryTab.v1'), 'tools', '工具页显示时应记录工具主标签')
  if (previousToolGetApp === undefined) delete global.getApp
  else global.getApp = previousToolGetApp

  assert(toolsWxml.includes('class="home-category-strip" scroll-x')
    && toolsWxml.includes('wx:for="{{categories}}"') && toolsWxml.includes('data-category="{{item}}"')
    && toolsWxml.includes('bindtap="onCategoryTap"') && toolsWxml.includes('aria-pressed="{{activeCategory === item}}"'))
  assert(toolsWxml.includes('class="home-tool-grid"')
    && toolsWxml.includes('navigator wx:for="{{tools}}"') && toolsWxml.includes('url="{{item.path}}"')
    && toolsWxml.includes('wx:key="id"'))
  assert(toolsWxml.includes('bindtap="openSettings"')
    && toolsWxml.includes('aria-label="打开设置"')
    && toolsWxml.includes("item.id === 'productLibrary'")
    && toolsWxml.includes('home-tool-title-line">产品</view><view class="home-tool-title-line">资料库')
    && !toolsWxml.includes('home-library-card'))
  assert(toolsWxss.includes('@import "../../styles/homepage.wxss"'))
  assert(toolsWxssCompact.includes('.home-tool-grid{display:grid;box-sizing:border-box;width:100%;grid-template-columns:repeat(4,minmax(0,1fr));column-gap:16rpx;row-gap:16rpx}')
    && toolsWxssCompact.includes('.home-tool-card{display:flex;box-sizing:border-box;width:100%;height:200rpx;min-width:0;min-height:200rpx;flex:00auto;padding:10rpx6rpx;')
    && toolsWxssCompact.includes('.home-tool-title{display:flex;box-sizing:border-box;width:100%;min-height:32px;flex-direction:column;align-items:center;justify-content:center')
    && toolsWxssCompact.includes('.home-tool-title-line{display:block;box-sizing:border-box;width:100%;min-width:0;font-size:13px;line-height:1.2')
    && toolsWxssCompact.includes('background:var(--theme-surface)')
    && toolsWxssCompact.includes('overflow-wrap:anywhere'),
  '工具目录需维持四列（11 项按 4/4/3 排列）、16rpx 间距、固定 200rpx 高度、13px 两行名称和主题表面')
  assert(toolsWxssCompact.includes('.home-header-action{')
    && toolsWxssCompact.includes('min-width:44px;min-height:44px')
    && toolsWxssCompact.includes('.tools-settings-glyph{'),
  '设置按钮需保留清晰图标和可操作触区')
  assert(!toolsWxml.includes('wiringModules') && !toolsWxml.includes('module-strip')
    && !toolsWxml.includes('module-row'), '工具页仍引用旧分组卡片视图模型')

  assert.deepStrictEqual(Object.keys(recordsApi.MODULES).sort(), [
    'audioWiring', 'camera', 'cable', 'dmxAddress', 'gainStructure', 'ledScreen', 'limiter', 'spl',
  ].sort(), '接线助手须加入记录归档模块，同时保持七个计算模块范围')
  const ledScreenPage = loadPage('pages/led-screen/led-screen.js')
  assertWxmlHandlers(ledScreenPage, 'pages/led-screen/led-screen.wxml')
  ledScreenPage.onLoad()
  ledScreenPage.onShow()
  assert.strictEqual(ledScreenPage.data.result.pixelPitch, 1.53)
  assert.strictEqual(ledScreenPage.data.result.unitKey, 'module')
  assert.strictEqual(ledScreenPage.data.result.frameWidthCentimeters, 5)
  assert.strictEqual(ledScreenPage.data.result.layoutText, '横向模组 14 × 纵向模组 15，总共 210 块')
  ledScreenPage.onAspectRatioChange({ detail: { value: 3 } })
  assert.strictEqual(ledScreenPage.data.result.targetAspectRatioKey, '16:10')
  ledScreenPage.onUnitChange({ detail: { value: 1 } })
  assert.strictEqual(ledScreenPage.data.result.unitKey, 'cabinetStandard')
  ledScreenPage.onUnitChange({ detail: { value: 2 } })
  assert.strictEqual(ledScreenPage.data.result.unitKey, 'cabinetPremiumA')
  ledScreenPage.onPitchChange({ detail: { value: 3 } })
  assert.strictEqual(ledScreenPage.data.result.pixelPitch, 1.86)
  const unchangedLedResult = ledScreenPage.data.result
  ledScreenPage.onPitchChange({ detail: { value: 3 } })
  assert.strictEqual(ledScreenPage.data.result, unchangedLedResult)
  ledScreenPage.copyResult()
  assert(clipboard.includes('LED 大屏尺寸预估'))
  const ledWxml = expandWxmlIncludes('pages/led-screen/led-screen.wxml')
  assert(ledWxml.includes('bindtap="openSharePreview"')
    && ledWxml.includes('canvas-id="ledScreenReportCanvas"'),
  'LED 页面缺少方案预览入口或离屏 Canvas')
  assert(ledWxml.includes('bindtap="shareReportImage"')
    && ledWxml.includes('bindtap="saveReportImage"')
    && ledWxml.includes('bindtap="retryReportPreview"')
    && ledWxml.includes('bindtap="previewReportImage"')
    && !/ReportImageViewer|report-image-viewer/.test(ledWxml),
  'LED 方案长图缺少转发或保存入口')
  let exportedLedCanvas = null
  const ledCanvasContext = new Proxy({}, {
    get: (target, key) => {
      if (key === 'measureText') return (text) => ({ width: String(text).length * 14 })
      if (key === 'draw') return (reserve, callback) => {
        const done = typeof reserve === 'function' ? reserve : callback
        if (done) done()
      }
      return () => {}
    },
  })
  wx.createCanvasContext = (canvasId) => {
    assert.strictEqual(canvasId, 'ledScreenReportCanvas')
    return ledCanvasContext
  }
  wx.canvasToTempFilePath = (options) => {
    exportedLedCanvas = options
    options.success({ tempFilePath: 'temp://led-screen-report.png' })
  }
  wx.showLoading = () => {}
  wx.hideLoading = () => {}
  ledScreenPage.openSharePreview()
  assert.strictEqual(ledScreenPage.data.reportImagePath, 'temp://led-screen-report.png')
  assert.strictEqual(ledScreenPage.data.reportPreviewVisible, true)
  assert.strictEqual(exportedLedCanvas.destWidth, 1500)
  assert.strictEqual(exportedLedCanvas.destHeight, ledScreenPage.data.reportCanvasHeight * 2)
  assert.strictEqual(ledScreenPage.previewReportImage(), true,
    'LED 原图预览入口应使用共享原生预览 API')
  assert.deepStrictEqual(ledPreviews, [{
    current: 'temp://led-screen-report.png',
    urls: ['temp://led-screen-report.png'],
  }], 'LED 原图预览应传入完整路径和 URL 列表')
  ledScreenPage.closeReportPreview(true)
  assert.strictEqual(ledScreenPage.data.reportPreviewVisible, false)
  ledScreenPage.openSharePreview()
  assert.strictEqual(ledScreenPage.data.reportPreviewVisible, true,
    '相同 LED 方案没有复用已生成图片')
  assert.strictEqual(ledScreenPage.previewReportImage(), true,
    '重新打开的当前 LED 图片仍应支持原生预览')
  assert.strictEqual(ledPreviews.length, 2)
  ledScreenPage.commitCalculatedState({ wallWidthText: '7' })
  assert.strictEqual(ledScreenPage.data.reportImagePath, '', 'LED 输入变化后仍沿用旧方案图片')
  delete wx.createCanvasContext
  delete wx.canvasToTempFilePath
  delete wx.showLoading
  delete wx.hideLoading

  const projectsPage = loadPage('pages/projects/projects.js')
  const projectsWxss = fs.readFileSync(path.join(root, 'pages/projects/projects.wxss'), 'utf8')
  const projectsDarkStart = projectsWxss.search(/@media\s*\(prefers-color-scheme:\s*dark\)/)
  const projectsDarkCss = projectsDarkStart >= 0 ? projectsWxss.slice(projectsDarkStart) : ''
  const projectsWxssCompact = projectsWxss.replace(/\s+/g, '')
  assert(projectsDarkCss.replace(/\s+/g, '').includes('.project-recovery-button{background:var(--theme-surface);color:var(--theme-text-secondary)') &&
    projectsDarkCss.replace(/\s+/g, '').includes('.favorite-card-footer{border-color:var(--theme-divider)'),
  '项目与收藏页深色模式未沿用语义主题色')
  assert(projectsWxssCompact.includes('.project-tab{display:flex;box-sizing:border-box;min-width:0;min-height:44px;flex:1;') &&
    projectsWxssCompact.includes('.project-tab-active{background:var(--theme-surface)') &&
    projectsWxssCompact.includes('.project-card-summary{margin-top:7rpx;color:var(--theme-text-secondary);font-size:13px') &&
    projectsWxssCompact.includes('.favorite-card-summary{margin-top:5rpx;color:var(--theme-text-secondary);font-size:13px') &&
    projectsWxssCompact.includes('.project-card-title,.favorite-card-title{flex:1;min-width:0;color:var(--theme-text);font-size:16px') &&
    projectsWxssCompact.includes('.project-card-updated,.favorite-card-time{margin-top:7rpx;color:var(--theme-text-tertiary);font-size:12px'),
  '项目与收藏卡片缺少可读字号、紧凑分段切换或语义主题色')
  assert(projectsWxssCompact.includes('.project-header.project-header-actionsbutton.project-recovery-button,.project-header.project-header-actionsbutton.project-create-button{display:flex;box-sizing:border-box;width:auto;height:44px;min-height:44px;') &&
    projectsWxssCompact.includes('padding:014px;align-items:center;justify-content:center;') &&
    projectsWxssCompact.includes('.project-search-clear{display:flex;box-sizing:border-box;width:auto;min-width:44px;height:44px;'),
  '项目页顶部操作或清除入口未保留最小触区')
  assertWxmlHandlers(projectsPage, 'pages/projects/projects.wxml')
  projectsPage.onShow()
  assert.deepStrictEqual(projectsPage.data.tabs, ['项目', '收藏'])
  assert.strictEqual(projectsPage.data.projects.length, 2)
  assert.strictEqual(projectsPage.data.tabIndex, 0, '项目首页默认展示项目列表')
  assert(projectsPage.data.projects.some((item) => item.id === project.id))
  assert(projectsPage.data.favorites.some((item) => item.id === limiterFavorite.id),
    '独立收藏快照未展示在收藏列表')
  projectsPage.onProjectFilterTap({ currentTarget: { dataset: { key: 'calculation' } } })
  assert.deepStrictEqual(projectsPage.data.projects.map((item) => item.id), [project.id],
    '计算记录筛选没有按项目稳定关联显示结果')
  projectsPage.onProjectFilterTap({ currentTarget: { dataset: { key: 'all' } } })
  projectsPage.onSearchInput({ detail: { value: 'Release selected' } })
  assert.deepStrictEqual(projectsPage.data.projects.map((item) => item.id), [project.id],
    '项目搜索没有按项目名称筛选')
  projectsPage.clearSearch()
  projectsPage.onTabTap({ currentTarget: { dataset: { index: 1 } } })
  assert.strictEqual(projectsPage.data.tabIndex, 1)
  assert(projectsPage.data.favorites.some((item) => item.id === limiterFavorite.id))
  const projectsWxml = fs.readFileSync(path.join(root, 'pages/projects/projects.wxml'), 'utf8')
  assert(projectsWxml.includes('class="project-tabs"') && projectsWxml.includes('bindtap="onTabTap"'))
  assert(projectsWxml.includes('class="home-panel project-list-card"') && projectsWxml.includes('data-id="{{item.id}}" bindtap="openProject"'))
  assert(projectsWxml.includes('class="home-panel favorite-list-card') && projectsWxml.includes('data-id="{{item.id}}" bindtap="openFavorite"'))
  assert(projectsWxml.includes('bindtap="openRecovery"') && projectsWxml.includes('project-recovery-button'))
  assert(!projectsWxml.includes('catchtap="openProjectWiring"') && !projectsWxml.includes('catchtap="openProjectReport"'),
    '项目列表卡片应由单一入口打开详情')
  projectsPage.openFavorite({ currentTarget: { dataset: { id: limiterFavorite.id } } })
  assert.strictEqual(navigatedUrl, `/pages/projects/favorite-detail?id=${encodeURIComponent(limiterFavorite.id)}`)
  projectsPage.openProject({ currentTarget: { dataset: { id: project.id } } })
  assert.strictEqual(navigatedUrl, `/pages/records/project?id=${encodeURIComponent(project.id)}`)

  const libraryPage = loadPage('pages/products/library.js')
  assertWxmlHandlers(libraryPage, 'pages/products/library.wxml')
  const librarySetData = libraryPage.setData
  let libraryInitializationSetDataCount = 0
  libraryPage.setData = function countLibraryInitializationSetData(value, callback) {
    libraryInitializationSetDataCount += 1
    return librarySetData.call(this, value, callback)
  }
  libraryPage.onLoad({ type: 'speaker' })
  libraryPage.onShow()
  libraryPage.setData = librarySetData
  assert.strictEqual(libraryInitializationSetDataCount, 1, '产品资料库首次显示仍执行重复刷新')
  assert.strictEqual(libraryPage.data.typeIndex, 1)
  assert.strictEqual(libraryPage.data.productTotalCount, 148)
  assert.strictEqual(libraryPage.data.products.length, 12)
  assert(libraryPage.data.hasMoreProducts)
  storage.set(RECENT_STORAGE_KEY, [{ type: 'speaker', model: 'TS-803C', viewedAt: Date.now() }])
  let recentRefreshPatch = null
  libraryPage.setData = function captureRecentRefresh(value, callback) {
    recentRefreshPatch = value
    return librarySetData.call(this, value, callback)
  }
  libraryPage.onShow()
  libraryPage.setData = librarySetData
  assert(recentRefreshPatch && !Object.prototype.hasOwnProperty.call(recentRefreshPatch, 'products'),
    '从产品详情返回后仍重复向视图层提交完整产品列表')
  assert.deepStrictEqual(Object.keys(libraryPage.data.recentProducts[0]).sort(), ['category', 'model'],
    '最近查看仍向视图层传入未使用的完整产品对象')
  let loadMorePatch = null
  let loadMoreSetDataCount = 0
  libraryPage.setData = function captureLoadMorePatch(value, callback) {
    loadMoreSetDataCount += 1
    loadMorePatch = value
    return librarySetData.call(this, value, callback)
  }
  libraryPage.loadMoreProducts()
  libraryPage.setData = librarySetData
  assert.strictEqual(loadMoreSetDataCount, 1, '产品资料库追加列表未保持一次 setData')
  assert(loadMorePatch && !Object.prototype.hasOwnProperty.call(loadMorePatch, 'products'),
    '产品资料库追加列表仍重传完整 products')
  assert(loadMorePatch['products[12]'] && loadMorePatch['products[23]'],
    '产品资料库追加列表未使用 products[12] 等逐项路径')
  assert.strictEqual(Object.keys(loadMorePatch).filter((key) => key.startsWith('products[')).length, 12,
    '产品资料库追加列表未只提交下一页 12 条')
  assert.strictEqual(libraryPage.data.products.length, 24)
  assert(libraryPage.data.products.every((item) => typeof item.compareSelected === 'boolean'))
  assert(libraryPage.data.products.every((item) => !Object.prototype.hasOwnProperty.call(item, 'capabilities')),
    '产品资料库仍向视图层传入筛选专用能力对象')
  libraryPage.onCapabilityTap({ currentTarget: { dataset: { index: 3 } } })
  assert(libraryPage.data.products.length > 0)
  assert(libraryPage.filteredProducts.every((item) => item.capabilities.maximumSpl))
  libraryPage.onCapabilityTap({ currentTarget: { dataset: { index: 0 } } })
  libraryPage.onSearchInput({ detail: { value: 'TS-610' } })
  libraryPage.onCategoryTap({ currentTarget: { dataset: { index: 0 } } })
  assert.strictEqual(libraryPage.data.keyword, 'TS-610', '资料库切换分类时丢失了尚待合并的搜索词')
  libraryPage.onSearchInput({ detail: { value: 'TS-803' } })
  libraryPage.onSearchConfirm({ detail: { value: 'TS-803' } })
  assert(libraryPage.data.products.some((item) => item.model === 'TS-803C'))
  assert.strictEqual(libraryPage.data.showRecent, false)
  assert.deepStrictEqual(libraryPage.data.recentProducts, [],
    'Hidden recent products should not remain in the search result view data')
  libraryPage.openProduct({ currentTarget: { dataset: { model: 'TS-803C' } } })
  assert.strictEqual(navigatedUrl, '/pages/products/detail?type=speaker&model=TS-803C')
  const assertComparisonPatch = (patch, label) => {
    const keys = Object.keys(patch || {})
    ;['products', 'categories', 'recentProducts', 'productTotalCount'].forEach((key) => {
      assert(!Object.prototype.hasOwnProperty.call(patch, key), `${label}仍提交无关字段 ${key}`)
    })
    assert(keys.every((key) => key === 'compareSelectedModels'
      || key === 'productComparison'
      || /^products\[\d+\]\.compareSelected$/.test(key)),
    `${label}提交了非局部更新路径`)
  }
  let firstComparePatch = null
  let firstCompareSetDataCount = 0
  libraryPage.setData = function captureFirstComparePatch(value, callback) {
    firstCompareSetDataCount += 1
    firstComparePatch = value
    return librarySetData.call(this, value, callback)
  }
  libraryPage.toggleProductCompare({ currentTarget: { dataset: { model: 'TS-603C' } } })
  libraryPage.setData = librarySetData
  assert.strictEqual(firstCompareSetDataCount, 1, '第一次产品对比未保持一次 setData')
  assertComparisonPatch(firstComparePatch, '第一次产品对比')
  assert.deepStrictEqual(libraryPage.data.compareSelectedModels, ['TS-603C'])
  let secondComparePatch = null
  let secondCompareSetDataCount = 0
  libraryPage.setData = function captureSecondComparePatch(value, callback) {
    secondCompareSetDataCount += 1
    secondComparePatch = value
    return librarySetData.call(this, value, callback)
  }
  libraryPage.toggleProductCompare({ currentTarget: { dataset: { model: 'TS-803C' } } })
  libraryPage.setData = librarySetData
  assert.strictEqual(secondCompareSetDataCount, 1, '第二次产品对比未保持一次 setData')
  assertComparisonPatch(secondComparePatch, '第二次产品对比')
  assert.strictEqual(secondComparePatch['products[0].compareSelected'], true,
    '第二次产品对比未只更新可见卡片状态')
  assert.strictEqual(libraryPage.data.productComparison.models.length, 2)
  let clearComparisonPatch = null
  let clearComparisonSetDataCount = 0
  libraryPage.setData = function captureClearComparisonPatch(value, callback) {
    clearComparisonSetDataCount += 1
    clearComparisonPatch = value
    return librarySetData.call(this, value, callback)
  }
  libraryPage.clearProductComparison()
  libraryPage.setData = librarySetData
  assert.strictEqual(clearComparisonSetDataCount, 1, '清空产品对比未保持一次 setData')
  assertComparisonPatch(clearComparisonPatch, '清空产品对比')
  assert.strictEqual(clearComparisonPatch['products[0].compareSelected'], false,
    '清空产品对比未清除可见卡片状态')
  assert.deepStrictEqual(libraryPage.data.compareSelectedModels, [])
  assert.strictEqual(libraryPage.data.productComparison, null)
  console.log(
    `产品资料库列表提交：追加 ${Buffer.byteLength(JSON.stringify(loadMorePatch))} bytes；`
    + `对比1 ${Buffer.byteLength(JSON.stringify(firstComparePatch))} bytes；`
    + `对比2 ${Buffer.byteLength(JSON.stringify(secondComparePatch))} bytes；`
    + `清空 ${Buffer.byteLength(JSON.stringify(clearComparisonPatch))} bytes。`,
  )
  libraryPage.onTypeTap({ currentTarget: { dataset: { index: 2 } } })
  assert.strictEqual(libraryPage.data.productTotalCount, 26)
  assert.strictEqual(libraryPage.data.products.length, 12)
  assert.strictEqual(libraryPage.filteredProducts.filter((item) => item.capabilities.cameraFov).length, 26)
  libraryPage.openProduct({ currentTarget: { dataset: { model: 'TV-6124HK' } } })
  assert.strictEqual(navigatedUrl, '/pages/products/detail?type=camera&model=TV-6124HK')
  libraryPage.onTypeTap({ currentTarget: { dataset: { index: 3 } } })
  assert.strictEqual(libraryPage.data.productTotalCount, 149)
  assert.strictEqual(libraryPage.data.products.length, 12)
  libraryPage.onCapabilityTap({ currentTarget: { dataset: { index: 1 } } })
  assert.strictEqual(libraryPage.data.productTotalCount, 121)
  libraryPage.onSearchConfirm({ detail: { value: 'TL-SV3103' } })
  assert.strictEqual(libraryPage.data.products[0].model, 'TL-SV3103')
  libraryPage.openProduct({ currentTarget: { dataset: { model: 'TL-SV3103' } } })
  assert.strictEqual(navigatedUrl, '/pages/products/detail?type=lighting&model=TL-SV3103')

  const detailWxml = fs.readFileSync(path.join(root, 'pages/products/detail.wxml'), 'utf8')
  const detailProductFields = [...new Set([...detailWxml.matchAll(/product\.([A-Za-z_]\w*)/g)]
    .map((match) => match[1]))]
  const detailForbiddenFields = ['specification', 'views', 'sourcePages', 'channelModes', 'name']
  const detailProjectedNestedFields = new Set(['viewRows', 'profile', 'dmxChannelGuide'])
  const detailPayloads = []
  const assertProjectedDetail = (page, type, model) => {
    const fullDetail = getProductDetail(type, model)
    const viewProduct = page.data.product
    detailProductFields.forEach((field) => {
      if (fullDetail[field] === undefined) return
      assert.notStrictEqual(viewProduct[field], undefined,
        `产品详情视图模型丢失 WXML 字段 product.${field}`)
      if (!detailProjectedNestedFields.has(field)) {
        assert.deepStrictEqual(viewProduct[field], fullDetail[field],
          `产品详情视图模型改变了原样字段 product.${field}`)
      }
    })
    detailForbiddenFields.forEach((field) => assert(
      !Object.prototype.hasOwnProperty.call(viewProduct, field),
      `产品详情视图模型仍携带逻辑字段 ${field}`,
    ))
    const viewBytes = Buffer.byteLength(JSON.stringify(viewProduct))
    const fullBytes = Buffer.byteLength(JSON.stringify(fullDetail))
    assert(viewBytes < fullBytes, `${type} 详情视图载荷未小于完整详情对象`)
    detailPayloads.push({ type, model, fullBytes, viewBytes })
  }

  const amplifierDetailPage = loadPage('pages/products/detail.js')
  assertWxmlHandlers(amplifierDetailPage, 'pages/products/detail.wxml')
  amplifierDetailPage.onLoad({ type: 'amplifier', model: 'KT-P21000' })
  assertProjectedDetail(amplifierDetailPage, 'amplifier', 'KT-P21000')
  assert(amplifierDetailPage.data.product.stereoRows.length > 0)
  amplifierDetailPage.openCalculator({ currentTarget: { dataset: { module: 'limiter' } } })
  assert.strictEqual(navigatedUrl, '/pages/limiter/limiter')
  assert.strictEqual(storage.get('audioTool.limiter.preferences').amplifierModel, 'KT-P21000')

  const productDetailPage = loadPage('pages/products/detail.js')
  assertWxmlHandlers(productDetailPage, 'pages/products/detail.wxml')
  productDetailPage.onLoad({ type: 'speaker', model: 'TS-803C' })
  assertProjectedDetail(productDetailPage, 'speaker', 'TS-803C')
  assert.strictEqual(productDetailPage.data.product.model, 'TS-803C')
  assert.strictEqual(productDetailPage.data.product.reviewDate, PRODUCT_DATA_DATE)
  assert.strictEqual(Object.prototype.hasOwnProperty.call(productDetailPage.data.product, 'profile'), false)
  assert(detailProductFields.includes('hasCoverageData') && detailProductFields.includes('coverageText'),
    '当前音箱详情 WXML 未由结构化覆盖角字段驱动')
  assert.strictEqual(productDetailPage.data.product.hasCoverageData, true)
  assert.strictEqual(productDetailPage.data.product.coverageText, '100° × 90°')
  assert.strictEqual(getRecentProducts('speaker')[0].model, 'TS-803C')
  productDetailPage.openCalculator({ currentTarget: { dataset: { module: 'spl' } } })
  assert.strictEqual(navigatedUrl, '/pages/spl/spl')
  assert.strictEqual(storage.get('audioTool.spl.preferences').speakerModel, 'TS-803C')

  const splitBandDetailPage = loadPage('pages/products/detail.js')
  splitBandDetailPage.onLoad({ type: 'speaker', model: 'KS-153' })
  assertProjectedDetail(splitBandDetailPage, 'speaker', 'KS-153')
  assert(splitBandDetailPage.data.product.bandRows.length > 0)
  assert.strictEqual(splitBandDetailPage.data.product.bandRows[0].key, 'LF')

  const profiledDetailPage = loadPage('pages/products/detail.js')
  profiledDetailPage.onLoad({ type: 'speaker', model: 'KF-D10F' })
  assertProjectedDetail(profiledDetailPage, 'speaker', 'KF-D10F')
  assert.strictEqual(profiledDetailPage.data.product.source, 'itc产品说明书 KF-D10F中文说明书-V0.2.pdf')
  assert.strictEqual(profiledDetailPage.data.product.sourcePageText, '规格页码：第 2 页')
  assert(detailProductFields.includes('source') && detailProductFields.includes('sourcePageText'),
    'KF-D10F 说明书来源与规格页未进入详情投影')
  const kfD10fDetailWxml = fs.readFileSync(path.join(root, 'pages/products/detail.wxml'), 'utf8')
  assert(kfD10fDetailWxml.includes('<view class="source-text">{{product.source}}</view>')
    && kfD10fDetailWxml.includes('<view wx:if="{{product.sourcePageText}}" class="source-extra">{{product.sourcePageText}}</view>'),
    'KF-D10F 当前详情页未显示公开来源与页码字段')
  assert.strictEqual(profiledDetailPage.data.product.ratedPower, 350)
  assert.strictEqual(profiledDetailPage.data.product.impedance, 8)
  assert.strictEqual(profiledDetailPage.data.product.maximumSplText, '129 dB SPL')
  assert.strictEqual(profiledDetailPage.data.product.coverageText, '100° × 90°')

  const cameraDetailPage = loadPage('pages/products/detail.js')
  cameraDetailPage.onLoad({ type: 'camera', model: 'TV-6124HK' })
  assertProjectedDetail(cameraDetailPage, 'camera', 'TV-6124HK')
  assert.strictEqual(cameraDetailPage.data.product.type, 'camera')
  assert(cameraDetailPage.data.product.viewRows[0].horizontalText)
  cameraDetailPage.openCalculator({ currentTarget: { dataset: { module: 'camera' } } })
  assert.strictEqual(navigatedUrl, '/pages/camera/camera')
  assert.strictEqual(storage.get('audioTool.camera.preferences').cameraModel, 'TV-6124HK')

  const partialCameraDetailPage = loadPage('pages/products/detail.js')
  partialCameraDetailPage.onLoad({ type: 'camera', model: 'TV-MU650X' })
  assertProjectedDetail(partialCameraDetailPage, 'camera', 'TV-MU650X')
  assert.strictEqual(partialCameraDetailPage.data.product.statusKey, 'partial')
  assert(partialCameraDetailPage.data.product.missingParameters.includes('主镜头：垂直视场角'))
  assert(partialCameraDetailPage.data.product.viewRows.some((row) => row.missingText))

  const lightingDetailPage = loadPage('pages/products/detail.js')
  lightingDetailPage.onLoad({ type: 'lighting', model: 'TL-SV3103' })
  assertProjectedDetail(lightingDetailPage, 'lighting', 'TL-SV3103')
  assert(lightingDetailPage.data.product.specRows.length > 0)
  assert(lightingDetailPage.data.product.dmxChannelGuide.modes.length > 0)
  assert.strictEqual(lightingDetailPage.data.product.type, 'lighting')
  assertWxmlHandlers(lightingDetailPage, 'pages/products/detail.wxml')
  const dmxPreferencesBeforeGuide = JSON.stringify(storage.get('audioTool.dmxAddress.preferences'))
  lightingDetailPage.openDmxChannelGuide()
  assert.strictEqual(navigatedUrl, '/pages/dmx-address/channel-guide?model=TL-SV3103')
  assert.strictEqual(JSON.stringify(storage.get('audioTool.dmxAddress.preferences')), dmxPreferencesBeforeGuide)

  const assertLightingCatalogImportRoute = (url) => {
    const parsed = new URL(url, 'https://tunebuddy.invalid')
    assert.strictEqual(parsed.pathname, '/pages/dmx-address/dmx-address')
    assert.deepStrictEqual(Array.from(parsed.searchParams.entries()), [['lightingCatalogImport', '1']])
  }
  const dmxPreferencesKey = 'audioTool.dmxAddress.preferences'
  const verifyDmxCatalogWorkspaceImport = (label, expectedGroups, expectedAddresses) => {
    const workspaceKeys = [
      lightingWorkspace.WORKSPACE_KEY,
      lightingWorkspace.JOURNAL_KEY,
      dmxPreferencesKey,
      'audioTool.dmxAddress.progress',
      'audioTool.dmxLayout.v1',
    ]
    const before = workspaceKeys.map((key) => ({
      key,
      present: storage.has(key),
      value: storage.has(key) ? JSON.parse(JSON.stringify(storage.get(key))) : undefined,
    }))
    try {
      const page = loadPage('pages/dmx-address/dmx-address.js')
      page.onLoad({ lightingCatalogImport: '1' })
      assert.strictEqual(page.data.contextError, '', label + '页面未能读入导入后的灯光工作区')
      const workspace = lightingWorkspace.readLightingWorkspace(lightingWorkspace.TEMPORARY_CONTEXT_ID)
      assert(workspace.ok, label + '公开灯光工作区读取失败')
      assert.strictEqual(page._contextId, workspace.contextId)
      assert.strictEqual(page._workspaceRevision, workspace.revision)
      const groupRows = (groups) => groups.map((group) => [
        group.fixtureModel || '',
        String(group.channelCount),
        String(group.fixtureCount),
        group.targetUniverse,
      ])
      assert.deepStrictEqual(groupRows(workspace.scheme.preferences.groups), expectedGroups,
        label + '导入未写入公开方案，或意外改动了现有组')
      assert.deepStrictEqual(groupRows(page.data.groups), expectedGroups,
        label + '实际 DMX 页面未呈现导入后的公开分组')
      const calculated = lightingWorkspace.calculateScheme(workspace.scheme)
      assert(calculated.ok && calculated.valid, label + '导入后的公开方案不能完成有效编址')
      const addresses = calculated.result.fixtures.map((fixture) => fixture.addressText)
      assert.deepStrictEqual(addresses, expectedAddresses,
        label + '导入后的逐台地址与独立预期不符')
      assert.deepStrictEqual(page._calculationResult.fixtures.map((fixture) => fixture.addressText), expectedAddresses,
        label + 'DMX 页面实际结果与独立逐台地址预期不符')
    } finally {
      before.forEach(({ key, present, value }) => {
        if (present) storage.set(key, value)
        else storage.delete(key)
      })
    }
  }
  const dmxPreferencesBeforeProductImport = storage.get(dmxPreferencesKey)
  const existingDmxGroup = {
    id: 'group-1',
    name: 'Existing fixture',
    fixtureSource: 'custom',
    fixtureModel: '',
    libraryChannelCount: '',
    customName: 'Existing fixture',
    customChannelCount: '8',
    channelCount: '8',
    fixtureCount: '2',
    targetUniverse: 'A',
  }
  const unrelatedDmxGroup = {
    id: 'group-unrelated',
    name: 'Unrelated fixture',
    fixtureSource: 'custom',
    fixtureModel: '',
    libraryChannelCount: '',
    customName: 'Unrelated fixture',
    customChannelCount: '4',
    channelCount: '4',
    fixtureCount: '1',
    targetUniverse: 'B',
  }
  storage.set(dmxPreferencesKey, {
    startAddressText: '1',
    allocationMode: 'auto',
    groups: [existingDmxGroup, unrelatedDmxGroup],
  })
  navigatedUrl = ''
  const writesBeforeDmxImportOpen = storageWriteCount
  lightingDetailPage.openCalculator({ currentTarget: { dataset: { module: 'dmxAddress' } } })
  assert.strictEqual(navigatedUrl, '')
  assert.strictEqual(storageWriteCount, writesBeforeDmxImportOpen,
    'opening DMX product import must not write preferences')
  assert.strictEqual(lightingDetailPage.data.dmxImportVisible, true)
  assert.deepStrictEqual(lightingDetailPage.data.dmxImportModes.map((mode) => mode.channelCount),
    lightingDetailPage._productDetail.channelModes)
  assert.strictEqual(lightingDetailPage.data.dmxImportChannelCount, '',
    'DMX product import requires an explicit channel-mode choice')
  assert.strictEqual(lightingDetailPage.data.dmxImportExistingGroupCount, 2)

  const cancelFixtureCount = storageWriteCount
  lightingDetailPage.selectDmxImportMode({ currentTarget: { dataset: { channelCount: 16 } } })
  lightingDetailPage.onDmxImportFixtureCountInput({ detail: { value: '2' } })
  lightingDetailPage.selectDmxImportAction({ currentTarget: { dataset: { action: 'append' } } })
  const preferencesBeforeInvalidDmxImport = JSON.stringify(storage.get(dmxPreferencesKey))
  const writesBeforeInvalidDmxImport = storageWriteCount
  lightingDetailPage.onDmxImportFixtureCountInput({ detail: { value: '0' } })
  lightingDetailPage.confirmDmxProductImport()
  assert.strictEqual(storageWriteCount, writesBeforeInvalidDmxImport, '非法灯具数量不得写入 DMX 草稿')
  assert.strictEqual(JSON.stringify(storage.get(dmxPreferencesKey)), preferencesBeforeInvalidDmxImport,
    '非法灯具数量不得改变已有组')
  assert.strictEqual(lightingDetailPage.data.dmxImportVisible, true)
  assert(lightingDetailPage.data.dmxImportError, '非法灯具数量未给出校验反馈')
  lightingDetailPage.onDmxImportFixtureCountInput({ detail: { value: '2' } })
  lightingDetailPage.closeDmxProductImport()
  assert.strictEqual(lightingDetailPage.data.dmxImportVisible, false)
  assert.strictEqual(storageWriteCount, cancelFixtureCount, 'cancelling DMX product import must not write preferences')
  assert.deepStrictEqual(storage.get(dmxPreferencesKey).groups, [existingDmxGroup, unrelatedDmxGroup],
    'cancelling DMX product import must preserve existing groups')

  navigatedUrl = ''
  const writesBeforeDmxImportAppend = storageWriteCount
  lightingDetailPage.openCalculator({ currentTarget: { dataset: { module: 'dmxAddress' } } })
  assert.strictEqual(lightingDetailPage.data.dmxImportChannelCount, '')
  lightingDetailPage.selectDmxImportMode({ currentTarget: { dataset: { channelCount: 16 } } })
  lightingDetailPage.onDmxImportFixtureCountInput({ detail: { value: '2' } })
  lightingDetailPage.confirmDmxProductImport()
  assert.strictEqual(storageWriteCount, writesBeforeDmxImportAppend,
    'DMX product import must require an explicit append or replace choice')
  assert.strictEqual(lightingDetailPage.data.dmxImportVisible, true)
  lightingDetailPage.selectDmxImportAction({ currentTarget: { dataset: { action: 'append' } } })
  lightingDetailPage.confirmDmxProductImport()
  assertLightingCatalogImportRoute(navigatedUrl)
  assert.strictEqual(storageWriteCount, writesBeforeDmxImportAppend + 1)
  let importedDmxPreferences = storage.get(dmxPreferencesKey)
  assert.strictEqual(importedDmxPreferences.groups.length, 3)
  assert.deepStrictEqual(importedDmxPreferences.groups[0], existingDmxGroup,
    'append must preserve the existing DMX group')
  assert.deepStrictEqual(importedDmxPreferences.groups[1], unrelatedDmxGroup,
    'append must preserve the unrelated existing DMX group')
  let lightingGroup = importedDmxPreferences.groups[2]
  assert.strictEqual(lightingGroup.fixtureModel, 'TL-SV3103')
  assert.strictEqual(lightingGroup.name, `${lightingDetailPage._productDetail.model} ${lightingDetailPage._productDetail.name}`)
  assert.strictEqual(lightingGroup.channelCount, '16', 'import must use the selected channel mode')
  assert.strictEqual(lightingGroup.fixtureCount, '2')
  verifyDmxCatalogWorkspaceImport('append', [
    ['', '8', '2', 'A'],
    ['', '4', '1', 'B'],
    ['TL-SV3103', '16', '2', 'A'],
  ], ['A001', 'A009', 'A017', 'A021', 'A037'])

  navigatedUrl = ''
  const writesBeforeDmxImportReplace = storageWriteCount
  lightingDetailPage.openCalculator({ currentTarget: { dataset: { module: 'dmxAddress' } } })
  lightingDetailPage.selectDmxImportMode({ currentTarget: { dataset: { channelCount: 18 } } })
  lightingDetailPage.onDmxImportFixtureCountInput({ detail: { value: '3' } })
  lightingDetailPage.selectDmxImportAction({ currentTarget: { dataset: { action: 'replace' } } })
  lightingDetailPage.confirmDmxProductImport()
  assertLightingCatalogImportRoute(navigatedUrl)
  assert.strictEqual(storageWriteCount, writesBeforeDmxImportReplace + 1)
  importedDmxPreferences = storage.get(dmxPreferencesKey)
  assert.strictEqual(importedDmxPreferences.groups.length, 1,
    'replace must leave only the imported DMX group')
  lightingGroup = importedDmxPreferences.groups[0]
  assert.strictEqual(lightingGroup.fixtureModel, 'TL-SV3103')
  assert.strictEqual(lightingGroup.channelCount, '18', 'replace must use the selected channel mode')
  assert.strictEqual(lightingGroup.fixtureCount, '3')
  verifyDmxCatalogWorkspaceImport('replace', [
    ['TL-SV3103', '18', '3', 'A'],
  ], ['A001', 'A019', 'A037'])
  storage.set(dmxPreferencesKey, dmxPreferencesBeforeProductImport)

  const nonDmxLightingDetailPage = loadPage('pages/products/detail.js')
  nonDmxLightingDetailPage.onLoad({ type: 'lighting', model: 'TL-SL643' })
  assertProjectedDetail(nonDmxLightingDetailPage, 'lighting', 'TL-SL643')
  assert.strictEqual(nonDmxLightingDetailPage.data.product.dmxChannelGuide, null)
  assert.strictEqual(nonDmxLightingDetailPage.data.product.modules[0].actionable, false)
  console.log(`产品详情视图载荷：${detailPayloads.map((item) => (
    `${item.type} ${item.viewBytes}/${item.fullBytes} bytes`
  )).join('；')}。`)

  const channelGuidePage = loadPage('pages/dmx-address/channel-guide.js')
  assertWxmlHandlers(channelGuidePage, 'pages/dmx-address/channel-guide.wxml')
  const channelGuideWxml = fs.readFileSync(path.join(root, 'pages/dmx-address/channel-guide.wxml'), 'utf8')
  assert(channelGuideWxml.includes('class="range-list"'), '通道资料页缺少范围列')
  assert(!/<[^>]*(?:wx:if[^>]*wx:for|wx:for[^>]*wx:if)[^>]*>/s.test(channelGuideWxml),
    '通道资料页不得在同一节点混用 wx:if 与 wx:for，以免 wx:else 真机编译失败')
  assert(!channelGuideWxml.includes('toggleRanges') && !channelGuideWxml.includes('expanded'),
    '通道资料页不应保留展开交互')
  channelGuidePage.onLoad({ model: encodeURIComponent('TL-SV3103') })
  assert.strictEqual(channelGuidePage.data.empty, false)
  assert.strictEqual(channelGuidePage.data.guide.channels.length, 14)
  assert.deepStrictEqual(channelGuidePage.data.guide.modes.map((mode) => mode.channelCount), [14, 16, 18])
  channelGuidePage.switchMode({ currentTarget: { dataset: { channelCount: 16 } } })
  assert.strictEqual(channelGuidePage.data.guide.channelCount, 16)
  assert(channelGuidePage.data.guide.channels.some((channel) => channel.ranges.length))
  assert(channelGuidePage.data.guide.channels.every((channel) => !Object.prototype.hasOwnProperty.call(channel, 'expanded')))
  channelGuidePage.onLoad({ model: 'TL-SV3103', channelCount: 'invalid' })
  assert.strictEqual(channelGuidePage.data.guide.channelCount, 14)
  channelGuidePage.onLoad({ model: 'TL-SL612' })
  assert.strictEqual(channelGuidePage.data.empty, false)
  assert.strictEqual(channelGuidePage.data.guide.channelCount, 4)
  assert.strictEqual(channelGuidePage.data.guide.channels.length, 4)

  const missingProductPage = loadPage('pages/products/detail.js')
  missingProductPage.onLoad({ type: 'speaker', model: 'NOT-FOUND' })
  assert.strictEqual(missingProductPage.data.product, null)
  assert.strictEqual(navigationTitle, '产品资料')

  const projectPage = loadPage('pages/records/project.js')
  assertWxmlHandlers(projectPage, 'pages/records/project.wxml')
  projectPage.onLoad({ id: project.id })
  assert.strictEqual(projectPage.data.project.id, project.id)
  assert.strictEqual(projectPage.data.storageHealth.percent, 1)
  const projectRecordIds = recordsApi.getProjectRecords(project.id).map((record) => record.id).sort()
  assert.strictEqual(projectPage.data.records.length, projectRecordIds.length)
  assert.deepStrictEqual(projectPage.data.records.map((record) => record.id).sort(), projectRecordIds,
    '项目详情应使用计算记录稳定 ID 对应当前项目关联')
  assert.strictEqual(projectPage.data.recordGroups.length, 2)
  projectPage.startEditProject()
  projectPage.onProjectFieldInput({ currentTarget: { dataset: { field: 'name' } }, detail: { value: '交易集团二楼会议室' } })
  projectPage.onProjectFieldInput({ currentTarget: { dataset: { field: 'venueName' } }, detail: { value: '二楼多功能会议室' } })
  projectPage.onProjectFieldInput({ currentTarget: { dataset: { field: 'engineer' } }, detail: { value: '调试一组' } })
  projectPage.onProjectFieldInput({ currentTarget: { dataset: { field: 'notes' } }, detail: { value: '复核主扩与补声电平' } })
  projectPage.onProjectFieldInput({ currentTarget: { dataset: { field: 'roomLengthText' } }, detail: { value: '12' } })
  projectPage.onProjectFieldInput({ currentTarget: { dataset: { field: 'roomWidthText' } }, detail: { value: '8' } })
  projectPage.onProjectFieldInput({ currentTarget: { dataset: { field: 'roomHeightText' } }, detail: { value: '4' } })
  projectPage.onProjectDateChange({ detail: { value: '2026-07-16' } })
  projectPage.saveProjectDetails()
  assert.strictEqual(projectPage.data.project.name, '交易集团二楼会议室')
  assert.strictEqual(projectPage.data.project.venueName, '二楼多功能会议室')
  const projectWxml = fs.readFileSync(path.join(root, 'pages/records/project.wxml'), 'utf8')
  assert(projectWxml.includes('bindtap="openProjectReport"')
    && !projectWxml.includes('generateProjectReportImage')
    && !projectWxml.includes('canvas-id="projectReportCanvas"'),
  '项目详情应将完整报告交给独立分页报告页')
  assert(projectWxml.includes('data-id="{{record.id}}" bindtap="onProjectItemTap"')
    && projectWxml.includes('data-swipe-type="record"')
    && projectWxml.includes('catchtap="onProjectSwipeDelete"'),
  '项目计算记录应保留稳定 ID 打开入口，并通过受控的项目内左滑移除入口操作')
  assert(!projectWxml.includes('添加项目模块')
    && !projectWxml.includes('添加模块</button>')
    && !projectWxml.includes('添加或管理通道与线缆')
    && !projectWxml.includes('添加线路</button>')
    && projectWxml.includes('wx:for="{{wiringLines}}"')
    && projectWxml.includes('data-id="{{item.id}}" bindtap="openProjectWiring"')
    && projectWxml.includes('data-swipe-type="line"'),
  '项目详情不显示添加模块/线路按钮，线路行保留打开入口并按稳定 ID 提供左滑删除')
  assert(!projectWxml.includes('moduleProgress'), '项目详情正常视图不应显示模块进度宫格')
  projectPage.openProjectReport()
  assert.strictEqual(navigatedUrl, `/pages/records/report?id=${encodeURIComponent(project.id)}`,
    '项目报告入口必须把稳定项目 ID 传给独立报告页')
  const reportPage = loadPage('pages/records/report.js')
  assertWxmlHandlers(reportPage, 'pages/records/report.wxml')
  reportPage.onLoad({ id: project.id })
  assert.strictEqual(reportPage.projectId, project.id)
  const reportItemIds = reportPage.data.selectionSections.flatMap((section) => section.items.map((item) => item.id))
  const reportRecordIds = reportPage.data.selectionSections
    .flatMap((section) => section.items.filter((item) => item.type === 'calculation').map((item) => item.id))
    .map((id) => id.slice('record:'.length)).sort()
  assert.deepStrictEqual(reportRecordIds, projectRecordIds,
    '报告候选应按稳定计算记录 ID 完整覆盖项目记录')
  assert.strictEqual(reportPage.data.selectedCount, reportItemIds.length,
    '报告初始选择未包含全部真实项目内容')
  assert(reportPage.data.totalCount >= projectRecordIds.length)
  const selectedBeforeToggle = reportPage.data.selectedCount
  const firstReportItemId = reportPage.data.selectedItemIds[0]
  reportPage.toggleReportItem({ currentTarget: { dataset: { id: firstReportItemId } } })
  assert.strictEqual(reportPage.data.selectedCount, selectedBeforeToggle - 1,
    '分页报告选择没有按稳定候选 ID 更新')
  reportPage.toggleReportItem({ currentTarget: { dataset: { id: firstReportItemId } } })
  assert.strictEqual(reportPage.data.selectedCount, selectedBeforeToggle)
  const reportWxml = fs.readFileSync(path.join(root, 'pages/records/report.wxml'), 'utf8')
  assert(reportWxml.includes('bindtap="toggleAllReportItems"')
    && reportWxml.includes('bindtap="toggleReportItem"')
    && reportWxml.includes('bindtap="generateReport"')
    && reportWxml.includes('bindtap="generateReportPdf"')
    && reportWxml.includes('bindtap="shareReportPdf"')
    && reportWxml.includes('projectReportPdfCanvas')
    && !reportWxml.includes('bindtap="inspectReportPages"')
    && !reportWxml.includes('bindtap="saveAllReportPages"')
    && !reportWxml.includes('bindtap="shareCurrentReportPage"'),
  '独立项目报告缺少选择、分页预览或 PDF 导出/分享操作，或仍暴露图片预览/保存入口')

  const knowledgePage = loadPage('pages/knowledge/detail.js')
  assertWxmlHandlers(knowledgePage, 'pages/knowledge/detail.wxml')
  ;['gain-alignment', 'camera-fov-distance', 'dmx-address-basics'].forEach((id) => {
    knowledgePage.onLoad({ id })
    assert.strictEqual(knowledgePage.data.article.id, id)
  })
  const knowledgeWxml = fs.readFileSync(path.join(root, 'pages/knowledge/detail.wxml'), 'utf8')
  const knowledgeWxss = fs.readFileSync(path.join(root, 'pages/knowledge/detail.wxss'), 'utf8')
  const demoScenesWxss = fs.readFileSync(path.join(root, 'pages/knowledge/demo-scenes.wxss'), 'utf8')
  assert(!knowledgeWxml.includes('article.category') && !knowledgeWxml.includes('article.readTime'),
    '文章封面仍显示容易误认为媒体类型和播放时长的分类与分钟信息')
  assert(!knowledgeWxml.includes('article-meta') && !knowledgeWxss.includes('.article-meta'),
    '文章封面仍保留已移除的分类时长节点或样式')
  assert(!knowledgeWxml.includes('扩声现场笔记'), '知识详情仍硬编码旧文章分类')
  const demoScenes = require('../pages/knowledge/demo-scenes').demos
  assert.deepStrictEqual(Object.keys(demoScenes).sort(), ['cable', 'camera', 'distance', 'dmx', 'gain', 'led', 'limiter'])
  Object.keys(demoScenes).forEach((type) => {
    assert(demoScenes[type].steps.length >= 3, `${type} 动画步骤不足`)
    assert(demoScenes[type].steps.every((step) => step.label && step.caption), `${type} 动画步骤缺少标签或说明`)
  })
  assert(knowledgeWxml.includes('<include src="./demo-scenes.wxml" />')
    && knowledgeWxml.includes('demoFrame')
    && knowledgeWxml.includes('demoIndex')
    && knowledgeWxml.includes('demoPlaying')
    && knowledgeWxml.includes('class="fill-scene"'),
  '知识详情缺少新播放器接口或 fill 场景')
  assert(knowledgeWxss.includes('@import "./demo-scenes.wxss";')
    && knowledgeWxss.includes('.demo-card')
    && /@media \(prefers-reduced-motion:\s*reduce\)/.test(demoScenesWxss),
  '知识详情缺少新场景样式或减少动态规则')
  assert(/\.fill-scene\{[^}]*height:342rpx[^}]*border-color:var\(--ty\)[^}]*background:var\(--as\)/.test(knowledgeWxss),
    'fill 场景缺少专用高度与接力主题底色')
  assert(!knowledgeWxml.match(/class="(?:limiter-scene|distance-scene|cable-scene|gain-scene|camera-principle-scene|dmx-scene|led-scene)/),
    '知识详情仍保留旧七场景节点')
  knowledgePage.onLoad({ id: 'led-screen-fit' })
  assert.strictEqual(knowledgePage.data.article.category, '视频')
  knowledgePage.openRelatedTool()
  assert.strictEqual(navigatedUrl, '/pages/led-screen/led-screen')
  knowledgePage.onLoad({ id: 'invalid-id' })
  assert.strictEqual(knowledgePage.data.article, null)
  assert.strictEqual(navigationTitle, '内容不存在')

  const preferenceKeys = [
    'audioTool.limiter.preferences',
    'audioTool.spl.preferences',
    'audioTool.cable.preferences',
    'audioTool.camera.preferences',
    'audioTool.ledScreen.preferences',
    'audioTool.gainStructure.preferences',
    'audioTool.dmxAddress.preferences',
  ]
  preferenceKeys.forEach((key) => storage.set(key, { test: true }))
  toolsPage.openSettings()
  assert.strictEqual(navigatedUrl, '/pages/settings/settings', '工具页设置入口未打开设置页')
  const settingsPage = loadPage('pages/settings/settings.js')
  assertWxmlHandlers(settingsPage, 'pages/settings/settings.wxml')
  settingsPage.onShow()
  settingsPage.onToolVisibilityChange({ currentTarget: { dataset: { id: 'camera' } }, detail: { value: false } })
  toolsPage.onShow()
  assert(!toolsPage.data.tools.some(({ id }) => id === 'camera'), '关闭工具显示后返回首页应立即隐藏入口')
  let settingsResetModal = null
  const showModalBeforeSettings = wx.showModal
  wx.showModal = (options) => { settingsResetModal = options }
  settingsPage.resetPreferences()
  assert(settingsResetModal && settingsResetModal.title === '恢复默认设置', '设置页未要求确认清理偏好')
  settingsResetModal.success({ confirm: false })
  assert(preferenceKeys.every((key) => storage.has(key)), '取消恢复默认时不应清除工具偏好')
  assert(storage.has('audioTool.toolVisibility.v1'), '取消恢复默认应保留工具显示偏好')
  settingsPage.resetPreferences()
  settingsResetModal.success({ confirm: true })
  wx.showModal = showModalBeforeSettings
  preferenceKeys.forEach((key) => assert(!storage.has(key), `${key} 未被恢复默认设置清除`))
  assert(!storage.has('audioTool.toolVisibility.v1'), '恢复默认应清除工具显示偏好')
  toolsPage.onShow()
  assert.strictEqual(toolsPage.data.tools.length, toolRegistry.getTools().length, '恢复默认后全部工具应重新显示')
  const preferencesApi = require('../utils/preferences')
  const writesBeforePreferenceRestore = storageWriteCount
  preferencesApi.writePreferences(preferenceKeys[0], { test: true })
  assert.strictEqual(storageWriteCount, writesBeforePreferenceRestore + 1,
    '恢复默认后偏好缓存未失效，导致相同设置无法重新保存')

  delete global.Page
  delete global.wx
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

checkSyntax()
childProcess.execFileSync(process.execPath, [path.join(root, 'tests/package-reclaim/generate-stage-lighting.cjs'), '--check'], { stdio: 'inherit' })
childProcess.execFileSync(process.execPath, [path.join(root, 'tests/package-reclaim/catalog-equivalence.cjs')], { stdio: 'inherit' })
childProcess.execFileSync(process.execPath, [path.join(root, 'tests/package-reclaim/catalog-generator-test.cjs')], { stdio: 'inherit' })
childProcess.execFileSync(process.execPath, [path.join(root, 'tests/package-reclaim/ui-resources.cjs')], { stdio: 'inherit' })
checkReleasePackageGates()
checkCatalogSelector()
checkDmxAddressLazyChannelGuide()
checkSharedResultReportPreviewTemplate()
checkLedScreenPlan()
checkData()
checkProductLibraryLazyLoading()
checkBaselines()
checkPageControllers()
checkHapticFeedback()
checkReportImageActions()
checkPerformanceMeasurements()
checkAudioPagePerformanceCoverage()
checkProductLibraryPerformanceCoverage()
checkLedScreenPerformanceCoverage()
checkProjectDetailPerformanceCoverage()

const auditRegressionScripts = [
  'record-module-boundary-test.cjs',
  'audit-runtime-regression.js',
  'homepage-refactor-2026-10-18/storage-adversarial.cjs',
  'homepage-refactor-2026-10-18/projects-storage-recovery.cjs',
  'storage-migration-failure-stages-regression.cjs',
  'audit-dmx-regression.js',
  'audit-led-regression.js',
  'report-render-regression.cjs',
  'led-records-regression.js',
  'led-first-use-regression.js',
  'knowledge-demo-test.js',
  'troubleshoot-test.js',
  'review-fixes-regression.js',
  'dmx-layout-model-test.js',
  'dmx-layout-renderer-test.js',
  'dmx-layout-overlap-test.js',
  'dmx-unified-export-flow-regression.cjs',
  'dmx-viewport-boundary-regression.cjs',
  'dmx-result-view-test.js',
  'report-drawing-regression.js',
  'report-pdf-regression.cjs',
  'report-empty-lighting-regression.cjs',
  'report-canvas-equivalence.js',
  'dmx-core-regression.js',
  'dmx-group-input-test.js',
  'dmx-product-import-test.js',
  'product-detail-route-test.js',
  'result-project-target-test.js',
  'limiter-project-metadata-test.js',
  'limiter-refactor-2026-10-06/limiter-page-state-test.js',
  'gain-report-regression.js',
  'report-lifecycle-regression.js',
  'dmx-lifecycle-regression.js',
  'dmx-layout-overlay-style-regression.cjs',
  'dmx-layout-current-flow-regression.cjs',
  'dmx-remaining-structure-realm-regression.cjs',
  'dmx-ui-refactor-2026-10-18/native-source-contracts-test.cjs',
  'dmx-ui-native-fixes-2026-10-18/layout-canvas-2d-regression-test.cjs',
  'dmx-placement-panel-2026-10-18/placement-panel-regression.cjs',
  'repair7-owner-decisions-regression.cjs',
  'dmx-ui-refactor-2026-10-18/layout-theme-lifecycle-test.cjs',
  'dmx-floating-card-contract-regression.cjs',
  'dmx-cold-initialization-regression.cjs',
  'dmx-single-model-add-regression.cjs',
  'dmx-placement-panel-2026-10-18/main-card-preview-test.cjs',
  'dmx-ui-refinements-2026-10-18/main-runtime-robustness-test.cjs',
  'dmx-first-use-experience-test.js',
  'dmx-search-lifecycle-regression.js',
  'dmx-picker-cross-boundary-regression.cjs',
  'page-lifecycle-regression.js',
  'calculator-renderer-regression.js',
  'camera-first-use-regression.js',
  'camera-closeout2-minimum-presentation-regression.cjs',
  'camera-closeout3-presentation-regression.cjs',
  'camera-refactor-2026-10-11/camera-v3-controller-regression.cjs',
  'camera-refactor-2026-10-11/camera-v4-ui-markup-regression.cjs',
  'camera-refactor-2026-10-11/camera-v4-record-metadata-regression.cjs',
  'camera-refactor-2026-10-11/camera-v4-actions-regression.cjs',
  'calculation-boundary-regression.js',
  'audio-wiring-model-test.js',
  'audio-wiring-page-test.js',
  'audio-wiring-renderer-test.js',
  'project-wiring-model-test.js',
  'project-save-controllers-2026-10-24.cjs',
  'project-wiring-storage-test.js',
  'project-wiring-page-test.js',
  'project-wiring-editor-boundary-regression-2026-10-24.cjs',
  'project-wiring-report-lifecycle-regression.cjs',
  'project-wiring-report-test.js',
  'project-wiring-entry-test.js',
  'homepage-refactor-2026-10-18/navigation-basis-behavior.cjs',
  'homepage-refactor-2026-10-18/revision-2/settings-visibility.cjs',
  'venue-removal-2026-10-15/removal-regression.cjs',
  'control-protocol-test.js',
  'spl-refactor-2026-10-11/localreport-regression.cjs',
  'dmx-engineering-closeout8-regression.cjs',
  'closeout8-contract-regression.cjs',
  'haptics-ui-regression.cjs',
  'haptics-wiring-regression.cjs',
  'haptics-calculators-regression.cjs',
].map((filename) => path.resolve(__dirname, filename))
auditRegressionScripts.forEach((scriptPath) => {
  assert(fs.existsSync(scriptPath), `缺少独立审查回归脚本：${scriptPath}`)
  childProcess.execFileSync(process.execPath, [scriptPath], { stdio: 'inherit' })
})

console.log('开发工作区自检通过：十一个工具入口（含七个计算模块、两个接线工具、控制协议与产品资料库）、38 款功放、148 款音箱、26 款摄像机、149 款舞台灯光设备及既有数值基准均正常。')
