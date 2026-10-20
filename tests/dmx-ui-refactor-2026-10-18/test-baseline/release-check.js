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
const {
  buildProjectReportPayload,
  calculateProjectReportHeight,
  getExportDimensions,
} = require('../pages/records/project-report')
const { calculateSpeakerSpl } = require('../utils/spl')
const { buildRecordComparison } = require('../utils/record-comparison')
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
const recordsCascadeFixture = '@media (prefers-color-scheme: dark){.project-detail-label{color:var(--ts)}page .project-notes .project-detail-label{color:#86868b}}'
assert.throws(() => assertThemeCascade(recordsCascadeFixture, '.project-notes .project-detail-label', 'color:var(--theme-text-secondary)', '记录备注级联后置覆盖自测', { darkOnly: true }), /后置或更高优先级硬编码覆盖/)
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
  total: 2650 * 1024,
  mainJavaScript: 874 * 1024,
  subPackageJavaScript: 794 * 1024,
  '.wxss': 292 * 1024,
  '.wxml': 284 * 1024,
  media: 668 * 1024,
  singleJavaScript: 100 * 1024,
})
const EXPECTED_APP_PAGES = Object.freeze([
  'pages/index/index',
  'pages/tools/tools',
  'pages/projects/projects',
  'pages/limiter/limiter',
  'pages/spl/spl',
  'pages/cable/cable',
  'pages/audio-wiring/index',
  'pages/camera/camera',
  'pages/led-screen/led-screen',
  'pages/gain-structure/gain-structure',
  'pages/dmx-address/dmx-address',
  'pages/dmx-address/channel-guide',
  'pages/dmx-layout/dmx-layout',
  'pages/dmx-layout-landscape/dmx-layout-landscape',
  'pages/products/library',
  'pages/products/detail',
  'pages/records/project',
  'pages/project-wiring/index',
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
    'pages/products/detail.wxss', 'pages/records/project.wxss', 'pages/knowledge/detail.wxss',
    'pages/dmx-address/dmx-address.wxss', 'pages/dmx-address/channel-guide.wxss',
    'pages/control-protocol/index.wxss', 'pages/control-protocol/detail.wxss',
  ]
  secondThemePages.forEach((file) => {
    const source = fs.readFileSync(path.join(root, file), 'utf8')
    const darkStart = Math.min(...[source.indexOf('@media (prefers-color-scheme: dark)'), source.indexOf('@media (prefers-color-scheme:dark)')].filter((index) => index >= 0))
    const darkCss = darkStart >= 0 ? source.slice(darkStart) : ''
    const hasDarkThemeToken = file === 'pages/gain-structure/gain-structure.wxss'
      ? darkCss.includes('var(--theme-control)') && darkCss.includes('var(--theme-success)')
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
    'pages/records/project.wxss': ['.project-report-preview-action-secondary.project-report-preview-action-secondary'],
    'pages/dmx-address/dmx-address.wxss': ['.universe-fixture-address', '.group-editor-custom-input'],
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
  const expectedSharedThemePages = secondThemePages.concat('pages/audio-wiring/index.wxss', 'pages/project-wiring/index.wxss')
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
    'pages/records/project.wxss': '.project-page-root, .project-scroll',
    'pages/knowledge/detail.wxss': '.knowledge-scroll',
    'pages/dmx-address/dmx-address.wxss': '.page-root, .page-scroll',
    'pages/dmx-address/channel-guide.wxss': '.page',
  }
  Object.entries(secondThemeRoots).forEach(([file, rootSelector]) => {
    const source = fs.readFileSync(path.join(root, file), 'utf8')
    assert(source.replace(/\s+/g, '').includes(rootSelector.replace(/\s+/g, '')), `${file} 缺少真实页面根类覆盖`)
  })
  const recordsTheme = fs.readFileSync(path.join(root, 'pages/records/project.wxss'), 'utf8')
  assert(recordsTheme.includes('.project-report-preview-sheet'), '项目页缺少真实报告预览壳深色覆盖')
  const dmxTheme = fs.readFileSync(path.join(root, 'pages/dmx-address/dmx-address.wxss'), 'utf8')
  const channelGuideTheme = fs.readFileSync(path.join(root, 'pages/dmx-address/channel-guide.wxss'), 'utf8')
  const sharedTheme = fs.readFileSync(path.join(root, 'styles/theme-page-shared.wxss'), 'utf8')
  ;['.fixture-search-sheet', '.fixture-channel-guide-sheet', '.universe-detail-sheet', '.result-report-preview-sheet']
    .forEach((selector) => assert(dmxTheme.includes(selector), `DMX 页面缺少真实弹层覆盖：${selector}`))
  assert(sharedTheme.includes('.picker-value.picker-value') && sharedTheme.includes('.selector-model.selector-model') && sharedTheme.includes('.metric.metric') &&
    sharedTheme.includes('.selector-search.selector-search') && sharedTheme.includes('.input-shell.input-shell') &&
    sharedTheme.includes('.status-chip.status-chip-good'), '共享主题缺少明确控件与成功态覆盖')
  assert(fs.readFileSync(path.join(root, 'pages/dmx-address/channel-guide.wxss'), 'utf8').includes('.range text:first-child') &&
    recordsTheme.includes('.project-report-preview-title') && dmxTheme.includes('.fixture-search-sheet input'),
  '第二批页面内部控件深色覆盖不完整')
  const recordsDarkStart = Math.min(...[recordsTheme.indexOf('@media (prefers-color-scheme: dark)'), recordsTheme.indexOf('@media (prefers-color-scheme:dark)')].filter((index) => index >= 0))
  const dmxDarkStart = Math.min(...[dmxTheme.indexOf('@media (prefers-color-scheme: dark)'), dmxTheme.indexOf('@media (prefers-color-scheme:dark)')].filter((index) => index >= 0))
  assert(recordsTheme.slice(recordsDarkStart).includes('.project-report-preview-title') &&
    recordsTheme.includes('.project-record-card .record-title') && recordsTheme.includes('.project-record-card .record-summary') &&
    dmxTheme.slice(dmxDarkStart).includes('.fixture-search-row') &&
    dmxTheme.includes('.fixture-search-model') && dmxTheme.includes('.fixture-channel-guide-detail-ranges') &&
    dmxTheme.includes('.universe-fixture-address'), '深色主题内部真实结构覆盖不完整')
  assert(sharedTheme.includes('page .field-label.field-label') && sharedTheme.includes('page .input-wrap.input-wrap') && sharedTheme.includes('input::placeholder') && sharedTheme.includes('.selector-panel') && sharedTheme.includes('button[disabled]'),
    '第二批共享主题规则未覆盖输入、占位符、选择器和禁用态')
  const guideDarkStart = Math.min(...[channelGuideTheme.indexOf('@media (prefers-color-scheme: dark)'), channelGuideTheme.indexOf('@media (prefers-color-scheme:dark)')].filter((index) => index >= 0))
  const guideDark = channelGuideTheme.slice(guideDarkStart)
  assert(guideDark.includes('.mode.mode-active') && !/\.product-name\.product-name[^}]*background\s*:\s*var\(--theme-accent-soft\)/.test(guideDark), '通道页非激活文字规则不得携带激活背景')
  assertDarkDeclaration(dmxTheme, '.group-editor-custom-input.group-editor-custom-input', 'background:var(--theme-control)', 'DMX 自定义输入缺少深色控件背景')
  assertDarkDeclaration(dmxTheme, '.group-editor-custom-input.group-editor-custom-input', 'border:0', 'DMX 自定义输入应使用无边框填充式控件')
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
  assertDarkDeclaration(recordsTheme, '.comparison-row.comparison-row', 'background:var(--theme-control)', '记录比较行缺少深色控件背景')
  assertDarkDeclaration(recordsTheme, '.comparison-row.comparison-row', 'color:var(--theme-text)', '记录比较行缺少深色文字色')
  ;['pages/dmx-layout/dmx-layout.wxss', 'pages/dmx-layout-landscape/dmx-layout-landscape.wxss']
    .forEach((file) => assert(!fs.readFileSync(path.join(root, file), 'utf8').includes('theme-page-shared'), `${file} 不得导入第二批共享主题`))
  ;['pages/led-screen/led-screen.json', 'pages/gain-structure/gain-structure.json', 'pages/products/library.json',
    'pages/products/detail.json', 'pages/dmx-address/dmx-address.json', 'pages/dmx-address/channel-guide.json',
    'pages/dmx-layout/dmx-layout.json', 'pages/dmx-layout-landscape/dmx-layout-landscape.json']
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
  ;['pages/dmx-layout/dmx-layout.wxss', 'pages/dmx-layout-landscape/dmx-layout-landscape.wxss'].forEach((file) => {
    const source = fs.readFileSync(path.join(root, file), 'utf8')
    assert(/@media\s*\(prefers-color-scheme:\s*dark\)/.test(source) && source.includes('var(--theme-page-bg)') &&
      source.includes('var(--theme-surface)') && source.includes('var(--theme-control)') &&
      source.includes('var(--theme-primary-fill)'), `${file} 缺少核心深色层级覆盖`)
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
  const crossPackageRequires = findSubPackageRequires(mainPackage.files, subPackageRoots)
  assert.strictEqual(crossPackageRequires.length, 0,
    `主包 JS 不得 require 分包资源：${crossPackageRequires.map((item) => `${item.file} -> ${item.request}`).join('；')}`)
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
    + `${javascriptByPackage}；`
    + `WXSS ${formatKiB(bytesByExtension['.wxss'] || 0)} / ${formatKiB(PACKAGE_BUDGETS['.wxss'])}；`
    + `WXML ${formatKiB(bytesByExtension['.wxml'] || 0)} / ${formatKiB(PACKAGE_BUDGETS['.wxml'])}；`
    + `最大 JS ${normalizeRelativePath(largestJavaScript.file)} ${formatKiB(largestJavaScript.bytes)} / 100.0 KiB。`,
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

function checkProjectReportPlan() {
  const groups = Array.from({ length: 7 }, (_, groupIndex) => ({
    module: `module-${groupIndex}`,
    label: `模块 ${groupIndex + 1}`,
    trustLabel: '结果摘要',
    theme: 'blue',
    records: Array.from({ length: 3 }, (_, recordIndex) => ({
      title: `记录 ${groupIndex + 1}-${recordIndex + 1}`,
      summary: '用于验证项目长图记录上限和模块覆盖。',
      timeText: '08-12 16:00',
    })),
  }))
  const payload = buildProjectReportPayload({ name: '测试项目' }, groups, {
    totalModuleCount: 7,
  })
  assert.strictEqual(payload.groups.length, 7, '项目长图未保留每个已完成模块')
  assert.strictEqual(payload.groups.reduce((total, group) => total + group.records.length, 0), 12,
    '项目长图没有执行摘要记录上限')
  assert.strictEqual(payload.omittedCount, 9)
  const height = calculateProjectReportHeight(payload)
  const exportDimensions = getExportDimensions(height)
  assert(height > 0 && exportDimensions.destHeight <= 4096,
    '项目长图导出高度超过安全上限')
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
  assert.strictEqual(APP_VERSION, '5.1.0')
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
  assert((limiterWxml.match(/<page-container\b/g) || []).length === 1
    && limiterWxml.includes('show="{{pageContainerSupported && (selectorVisible || detailsVisible || shareSheetVisible || projectSheetVisible)}}"')
    && limiterWxml.includes('bind:beforeleave="onPageContainerBeforeLeave"')
    && limiterWxml.includes('bind:afterleave="onPageContainerAfterLeave"')
    && limiterWxml.includes('!pageContainerSupported && (selectorVisible || detailsVisible || shareSheetVisible || projectSheetVisible)'),
  '限幅器必须保留单个常驻页面容器、返回生命周期事件和旧基础库遮罩回退')
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

  const dmxPage = loadPage('pages/dmx-address/dmx-address.js')
  assertWxmlHandlers(dmxPage, 'pages/dmx-address/dmx-address.wxml')
  const dmxAddressJs = fs.readFileSync(path.join(root, 'pages/dmx-address/dmx-address.js'), 'utf8')
  const dmxWxml = fs.readFileSync(path.join(root, 'pages/dmx-address/dmx-address.wxml'), 'utf8')
  const dmxWxss = fs.readFileSync(path.join(root, 'pages/dmx-address/dmx-address.wxss'), 'utf8')
  const dmxResultViewJs = fs.readFileSync(path.join(root, 'pages/dmx-address/result-view.js'), 'utf8')
  assert(dmxResultViewJs.includes('CHANNEL_GUIDE_FIXTURE_MODELS')
    && dmxAddressJs.includes('getChannelGuideApi')
    && !dmxAddressJs.includes('hasDmxChannelProfile')
    && !dmxAddressJs.includes('getDmxChannelProfile'),
  'DMX 结果视图未使用轻量 Set 标记通道资料可用性，或仍存在顶层 profile 查询')
  assert(!dmxWxss.includes('fixture-channel-guide-modes')
    && !dmxWxss.includes('fixture-channel-guide-mode {')
    && !dmxWxss.includes('fixture-channel-guide-mode-active'),
  'DMX 通道速查仍残留未使用的模式切换样式')
  assert(dmxWxml.includes('bindtap="generateResultReportImage"')
    && dmxWxml.includes('canvas-id="resultReportCanvas"')
    && dmxWxml.includes('bindtap="shareResultReportImage"')
    && dmxWxml.includes('bindtap="saveResultReportImage"'),
  'DMX 编址方案长图入口或预览动作不完整')
  assert(dmxWxml.includes('bindtap="openFixtureLayout"'), 'DMX 编址结果缺少灯具位置图入口')
  assert(!dmxWxml.includes('class="notice-card"')
    && !dmxWxml.includes('域尾保留地址')
    && !dmxWxss.includes('.notice-card'),
  'DMX 编址结果仍渲染重复的域尾保留地址提示卡')
  assert(!dmxWxml.includes('方案汇总')
    && !dmxWxml.includes('class="result-summary-section"')
    && !dmxWxss.includes('.result-summary-section'),
  'DMX 地址方案仍渲染重复的方案汇总信息')
  assert(dmxWxml.includes('class="group-editor-summary"')
    && dmxWxml.includes('bindtap="openGroupEditor"')
    && dmxWxml.includes('class="group-editor-overlay"')
    && dmxWxml.includes('bindtap="removeGroupFromEditor"')
    && dmxWxml.includes('bindtap="finishGroupEditor"')
    && !dmxWxml.includes('class="group-editor-row')
    && !dmxWxml.includes('class="fixture-library-field"')
    && !dmxWxml.includes('class="group-compact-controls'),
  'DMX 灯具组摘要列表或底部编辑面板结构不完整')
  assert(dmxWxml.includes('data-workspace="config"')
    && dmxWxml.includes('data-workspace="plan"')
    && dmxWxml.includes('bindtap="confirmBatchAdd"')
    && dmxWxml.includes('bindtap="adjustBatchQuantity"')
    && dmxWxml.includes('bindtap="openCustomGroupFromBatch"'),
  'DMX 双工作区或批量灯具入口结构不完整')
  assert(dmxWxml.includes('<view class="page-title">灯具地址码计算</view>')
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
  dmxPage.openGroupEditor({ currentTarget: { dataset: { index: 0 } } })
  assert.strictEqual(dmxPage.data.groupEditorOpen, true, '点击灯具组摘要行后没有打开编辑面板')
  assert.strictEqual(dmxPage.data.groupEditorIndex, 0)
  dmxPage.finishGroupEditor()
  assert.strictEqual(dmxPage.data.groupEditorOpen, false, '编辑面板完成后没有关闭')
  assert.strictEqual(dmxPage.data.allocationMode, 'auto')
  dmxPage.switchAllocationMode({ currentTarget: { dataset: { mode: 'manual' } } })
  assert.strictEqual(dmxPage.data.allocationMode, 'manual')
  assert.strictEqual(dmxPage.data.groups[0].targetUniverse, 'A')
  dmxPage.onGroupUniverseChange({
    currentTarget: { dataset: { index: 0 } },
    detail: { value: 1 },
  })
  assert.strictEqual(dmxPage.data.groups[0].targetUniverse, 'B')
  assert.strictEqual(dmxPage.data.result.fixtures, undefined, 'DMX 页面不应把逐台数组传入视图层')
  assert.strictEqual(dmxPage._calculationResult.fixtures[0].addressText, 'B001')
  assert.strictEqual(dmxPage.getPreferences().allocationMode, 'manual')
  assert.strictEqual(dmxPage.getPreferences().groups[0].targetUniverse, 'B')
  dmxPage.switchAllocationMode({ currentTarget: { dataset: { mode: 'auto' } } })
  assert.strictEqual(dmxPage.data.allocationMode, 'auto')
  assert.strictEqual(dmxPage._calculationResult.fixtures[0].addressText, 'A001')
  dmxPage.openFixtureLayout()
  assert.strictEqual(navigatedUrl, '/pages/dmx-layout/dmx-layout')

  const originalDmxPreferences = JSON.parse(JSON.stringify(storage.get('audioTool.dmxAddress.preferences')))
  const expandedDmxPreferences = JSON.parse(JSON.stringify(originalDmxPreferences))
  expandedDmxPreferences.groups = expandedDmxPreferences.groups.map((group) => ({ ...group, fixtureCount: 8 }))
  storage.set('audioTool.dmxAddress.preferences', expandedDmxPreferences)
  storage.set('audioTool.dmxLayout.v1', {
    rowCount: 3,
    schemeId: 'full',
    sidePairCount: 1,
    sidePairManual: true,
    preserveUnplaced: true,
    positions: {},
  })
  const layoutPage = loadPage('pages/dmx-layout/dmx-layout.js')
  assertWxmlHandlers(layoutPage, 'pages/dmx-layout/dmx-layout.wxml')
  const portraitLayoutWxml = fs.readFileSync(path.join(root, 'pages/dmx-layout/dmx-layout.wxml'), 'utf8')
  const landscapeLayoutWxml = fs.readFileSync(path.join(root, 'pages/dmx-layout-landscape/dmx-layout-landscape.wxml'), 'utf8')
  const batchCanvasHiddenCondition = 'hidden="{{previewVisible || batchVisible}}"'
  assert(portraitLayoutWxml.includes(batchCanvasHiddenCondition)
    && landscapeLayoutWxml.includes(batchCanvasHiddenCondition),
  '横竖屏交互 Canvas 未同时受预览和批量面板状态隐藏')
  layoutPage.onLoad()
  assert(layoutPage.data.unplacedFixtureCount > 0, '灯具位置图未显示待布置灯具')
  const unplacedBefore = layoutPage._fixtures.filter((fixture) => !layoutPage._positions[`${fixture.groupIndex}:${fixture.fixtureIndex}`]).sort((a, b) => a.fixtureIndex - b.fixtureIndex)
  assert(unplacedBefore.length >= 8, '批量范围测试缺少足够未布置灯具')
  const rangeKeys = unplacedBefore.slice(1, 3).map((fixture) => `${fixture.groupIndex}:${fixture.fixtureIndex}`)
  layoutPage.openBatchPlacement()
  assert.strictEqual(layoutPage.data.batchVisible, true, '批量上杆入口未打开底部面板')
  let portraitBatchCloseDraws = 0
  const originalPortraitBatchDraw = layoutPage.drawLayout
  layoutPage.drawLayout = () => { portraitBatchCloseDraws += 1 }
  layoutPage.closeBatchPlacement()
  assert.strictEqual(layoutPage.data.batchVisible, false, '竖屏关闭批量面板后状态未恢复')
  assert.strictEqual(portraitBatchCloseDraws, 1, '竖屏关闭批量面板后没有恢复绘制 Canvas')
  layoutPage.closeBatchPlacement()
  assert.strictEqual(portraitBatchCloseDraws, 1, '竖屏重复关闭批量面板产生无意义重绘')
  layoutPage.drawLayout = originalPortraitBatchDraw
  layoutPage.openBatchPlacement()
  const topIndex = layoutPage._positionDefinitions.findIndex((definition) => definition.zone === 'top')
  layoutPage.setData({ batchStartIndex: 1, batchEndIndex: 2, batchPositionIndex: topIndex, batchDirectionIndex: 0 })
  layoutPage.applyBatchPlacement()
  const rangePositions = rangeKeys.map((key) => layoutPage._positions[key])
  assert(rangePositions.every((position) => position?.zone === 'top'), '连续地址范围未全部加入同一目标杆')
  assert.deepStrictEqual(
    layoutPage._fixtures.filter((fixture) => layoutPage._positions[`${fixture.groupIndex}:${fixture.fixtureIndex}`]?.zone === 'top').map((fixture) => `${fixture.groupIndex}:${fixture.fixtureIndex}`),
    rangeKeys,
    '连续范围之外的灯具被错误加入目标杆',
  )
  const outsideRange = unplacedBefore.filter((fixture) => !rangeKeys.includes(`${fixture.groupIndex}:${fixture.fixtureIndex}`))
  assert(outsideRange.some((fixture) => !layoutPage._positions[`${fixture.groupIndex}:${fixture.fixtureIndex}`]), '连续范围外灯具未保留待布置状态')
  const rangeFixtures = rangeKeys.map((key) => layoutPage._fixtures.find((fixture) => `${fixture.groupIndex}:${fixture.fixtureIndex}` === key))
  assert(rangePositions[0].x < rangePositions[1].x, '正序排列未按地址递增横向排布')

  const reserve = unplacedBefore[0]
  const reserveKey = `${reserve.groupIndex}:${reserve.fixtureIndex}`
  const frontIndex = layoutPage._positionDefinitions.findIndex((definition) => definition.zone === 'front')
  layoutPage._positions[reserveKey] = { zone: 'front', positionIndex: 0, x: .5, y: 1 }
  layoutPage.syncBarConfigurationFromPositions()
  layoutPage.refreshFixturePalette()
  const reverseFixtures = unplacedBefore.slice(3, 5)
  layoutPage.openBatchPlacement()
  layoutPage.setData({ batchStartIndex: 0, batchEndIndex: 1, batchPositionIndex: frontIndex, batchDirectionIndex: 1 })
  layoutPage.applyBatchPlacement()
  const frontFixtures = [reserve, ...reverseFixtures]
  const frontPositions = frontFixtures.map((fixture) => layoutPage._positions[`${fixture.groupIndex}:${fixture.fixtureIndex}`])
  assert(frontPositions.every((position) => position?.zone === 'front'), '批量目标杆已有灯具未纳入重排')
  assert.strictEqual(new Set(frontPositions.map((position) => position.x)).size, frontPositions.length, '重排后目标杆出现重复位置')
  assert(frontPositions[0].x > frontPositions[1].x && frontPositions[1].x > frontPositions[2].x, '反序未按地址反向物理排布')

  const sideIndex = layoutPage._positionDefinitions.findIndex((definition) => definition.zone === 'side-left')
  assert(sideIndex >= 0, '批量面板缺少侧光目标')
  layoutPage.openBatchPlacement()
  layoutPage.setData({ batchStartIndex: 0, batchEndIndex: 1, batchPositionIndex: sideIndex, batchDirectionIndex: 0 })
  layoutPage.applyBatchPlacement()
  const sideFixtures = unplacedBefore.slice(5, 7)
  const sidePositions = sideFixtures.map((fixture) => layoutPage._positions[`${fixture.groupIndex}:${fixture.fixtureIndex}`])
  assert(sidePositions.every((position) => position?.zone === 'side-left'), '批量侧光未分配全部灯具')
  assert(sidePositions[0].y !== sidePositions[1].y, '侧光灯具位置未拉开')
  assert(Math.abs(sidePositions[0].y - (0.04 + .92 / 3)) < .001 && Math.abs(sidePositions[1].y - (0.04 + (.92 * 2 / 3))) < .001, '侧光未沿完整纵向范围均匀排布')
  const retainedKey = rangeKeys[0]
  const retainedPosition = JSON.parse(JSON.stringify(layoutPage._positions[retainedKey]))
  layoutPage.clearBatchPosition()
  assert(sideFixtures.every((fixture) => !layoutPage._positions[`${fixture.groupIndex}:${fixture.fixtureIndex}`]), '清空本杆未移除目标灯位全部位置')
  assert.deepStrictEqual(layoutPage._positions[retainedKey], retainedPosition, '清空本杆影响了其他灯位')
  const landscapePage = loadPage('pages/dmx-layout-landscape/dmx-layout-landscape.js')
  assertWxmlHandlers(landscapePage, 'pages/dmx-layout-landscape/dmx-layout-landscape.wxml')
  landscapePage.onLoad()
  landscapePage.openBatchPlacement()
  assert.strictEqual(landscapePage.data.batchVisible, true, '横屏批量上杆面板缺失')
  let landscapeBatchCloseDraws = 0
  const originalLandscapeBatchDraw = landscapePage.drawLayout
  landscapePage.drawLayout = () => { landscapeBatchCloseDraws += 1 }
  landscapePage.closeBatchPlacement()
  assert.strictEqual(landscapePage.data.batchVisible, false, '横屏关闭批量面板后状态未恢复')
  assert.strictEqual(landscapeBatchCloseDraws, 1, '横屏关闭批量面板后没有恢复绘制 Canvas')
  landscapePage.closeBatchPlacement()
  assert.strictEqual(landscapeBatchCloseDraws, 1, '横屏重复关闭批量面板产生无意义重绘')
  landscapePage.drawLayout = originalLandscapeBatchDraw
  assert(portraitLayoutWxml.includes('批量上杆') && landscapeLayoutWxml.includes('批量上杆'))
  const batchTemplateWxml = fs.readFileSync(path.join(root, 'templates/dmx-batch-sheet.wxml'), 'utf8')
  assert(batchTemplateWxml.includes('同杆分组均匀交错') && !batchTemplateWxml.includes('按地址排序'),
    '批量上杆未准确说明同杆灯具的分组混排方向')
  assert(batchTemplateWxml.includes('class="batch-sheet-backdrop" bindtap="closeBatchPlacement"')
    && batchTemplateWxml.includes('<scroll-view class="batch-sheet" scroll-y="{{isLandscape}}" enhanced show-scrollbar="{{false}}"')
    && !batchTemplateWxml.includes('class="batch-sheet-overlay" bindtap="closeBatchPlacement" catchtouchmove'),
  '批量面板背景止滑层与原生纵向滚动层没有分离')
  const landscapeBatchWxss = fs.readFileSync(path.join(root, 'pages/dmx-layout-landscape/dmx-layout-landscape.wxss'), 'utf8')
  const portraitBatchWxss = fs.readFileSync(path.join(root, 'pages/dmx-layout/dmx-layout.wxss'), 'utf8')
  assert(portraitBatchWxss.includes('.batch-sheet{position:relative;z-index:1;width:100%;height:auto;box-sizing:border-box;border-radius:')
    && !portraitBatchWxss.match(/\.batch-sheet\{[^}]*max-height/)
    && !portraitBatchWxss.match(/\.batch-sheet\{[^}]*overflow:hidden/),
  '竖屏批量面板不再保持自然高度，可能裁掉底部操作')
  assert(landscapeBatchWxss.includes('.batch-sheet{position:relative;z-index:1;width:100%;height:90vh;max-height:calc(100vh - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 12px)')
    && landscapeBatchWxss.includes('.batch-sheet-content{box-sizing:border-box;padding:18px 22px calc(18px + env(safe-area-inset-bottom))'),
  '横屏批量原生滚动区没有明确的可视高度和安全区内边距')
  storage.set('audioTool.dmxAddress.preferences', {
    startAddressText: '1',
    allocationMode: 'auto',
    groups: [
      { name: 'A 组', channelCount: '16', fixtureCount: '4' },
      { name: 'B 组', channelCount: '16', fixtureCount: '2' },
      { name: 'C 组', channelCount: '16', fixtureCount: '2' },
      { name: 'D 组', channelCount: '16', fixtureCount: '1' },
    ],
  })
  storage.set('audioTool.dmxLayout.v1', {
    rowCount: 3, schemeId: 'top', sidePairCount: 1, sidePairManual: true,
    preserveUnplaced: true, positions: {},
  })
  const mixedBatchPage = loadPage('pages/dmx-layout/dmx-layout.js')
  mixedBatchPage.onLoad()
  const batchTopIndex = mixedBatchPage._positionDefinitions.findIndex((definition) => definition.zone === 'top' && definition.positionIndex === 0)
  const batchKey = (fixture) => `${fixture.groupIndex}:${fixture.fixtureIndex}`
  const firstAFixture = mixedBatchPage._fixtures.find((fixture) => fixture.groupIndex === 0 && fixture.fixtureIndex === 1)
  mixedBatchPage._positions[batchKey(firstAFixture)] = { zone: 'top', positionIndex: 0, x: .5, y: .25 }
  const outsideBarFixture = mixedBatchPage._fixtures.find((fixture) => fixture.groupIndex === 3)
  const outsideBarKey = batchKey(outsideBarFixture)
  const outsideBarPosition = { zone: 'top', positionIndex: 1, x: .25, y: .5 }
  mixedBatchPage._positions[outsideBarKey] = { ...outsideBarPosition }
  const applyGroupRange = (groupIndex, count, directionIndex = 0) => {
    mixedBatchPage.selectPaletteGroup({ currentTarget: { dataset: { groupIndex } } })
    mixedBatchPage.openBatchPlacement()
    mixedBatchPage.setData({
      batchStartIndex: 0,
      batchEndIndex: count - 1,
      batchPositionIndex: batchTopIndex,
      batchDirectionIndex: directionIndex,
    })
    mixedBatchPage.applyBatchPlacement()
  }
  mixedBatchPage.selectPaletteGroup({ currentTarget: { dataset: { groupIndex: 0 } } })
  mixedBatchPage.openBatchPlacement()
  assert(mixedBatchPage.data.batchPreviewText.includes('与已有1台重新等距排布'), '同组已有灯具的预览没有说明整杆会重新等距排布')
  mixedBatchPage.setData({ batchStartIndex: 0, batchEndIndex: 2, batchPositionIndex: batchTopIndex, batchDirectionIndex: 0 })
  mixedBatchPage.applyBatchPlacement()
  assert.deepStrictEqual(
    mixedBatchPage._fixtures.filter((fixture) => mixedBatchPage._positions[batchKey(fixture)]?.positionIndex === 0)
      .sort((a, b) => mixedBatchPage._positions[batchKey(a)].x - mixedBatchPage._positions[batchKey(b)].x)
      .map((fixture) => fixture.groupIndex),
    [0, 0, 0, 0],
    '首批 A 组灯具没有按地址稳定排布',
  )
  mixedBatchPage.selectPaletteGroup({ currentTarget: { dataset: { groupIndex: 1 } } })
  mixedBatchPage.openBatchPlacement()
  assert(mixedBatchPage.data.batchPreviewText.includes('与已有4台交错重排'), '预览未说明新增组会与本杆已有灯具混排')
  mixedBatchPage.setData({ batchStartIndex: 0, batchEndIndex: 1, batchPositionIndex: batchTopIndex, batchDirectionIndex: 0 })
  mixedBatchPage.applyBatchPlacement()
  const topFixturesAfterAB = mixedBatchPage._fixtures.filter((fixture) => mixedBatchPage._positions[batchKey(fixture)]?.positionIndex === 0)
  const topOrderAfterAB = topFixturesAfterAB.sort((a, b) => mixedBatchPage._positions[batchKey(a)].x - mixedBatchPage._positions[batchKey(b)].x)
  assert.deepStrictEqual(topOrderAfterAB.map((fixture) => fixture.groupIndex), [0, 1, 0, 0, 1, 0], 'A4 后上 B2 未按归一化槽位交错')
  assert.deepStrictEqual(topOrderAfterAB.filter((fixture) => fixture.groupIndex === 0).map((fixture) => fixture.fixtureIndex), [1, 2, 3, 4], '同组地址顺序发生变化')
  applyGroupRange(2, 2, 1)
  const finalTopFixtures = mixedBatchPage._fixtures.filter((fixture) => mixedBatchPage._positions[batchKey(fixture)]?.positionIndex === 0)
  const finalTopOrder = finalTopFixtures.sort((a, b) => mixedBatchPage._positions[batchKey(a)].x - mixedBatchPage._positions[batchKey(b)].x)
  assert.deepStrictEqual(finalTopOrder.map((fixture) => fixture.groupIndex), [0, 2, 1, 0, 0, 2, 1, 0], '反序没有反转三组灯具的最终混排序列')
  assert.deepStrictEqual(finalTopOrder.filter((fixture) => fixture.groupIndex === 2).map((fixture) => fixture.fixtureIndex), [2, 1], '反序后同组地址未随最终物理序列反转')
  assert.strictEqual(new Set(finalTopFixtures.map((fixture) => mixedBatchPage._positions[batchKey(fixture)].x)).size, 8, '混排后的目标杆存在坐标重叠')
  assert.deepStrictEqual(mixedBatchPage._positions[outsideBarKey], outsideBarPosition, '批量重排改变了其他杆上的既有灯位')
  const positionedKeys = Object.keys(mixedBatchPage._positions)
  assert.strictEqual(positionedKeys.length, mixedBatchPage._fixtures.length, '批量混排后有灯具丢失或重复')
  assert.deepStrictEqual(positionedKeys.slice().sort(), mixedBatchPage._fixtures.map(batchKey).sort(), '批量混排后的灯具地址键集合不完整')
  assert.strictEqual(new Set(Object.values(mixedBatchPage._positions).map((position) => `${position.x}:${position.y}`)).size, positionedKeys.length, '批量混排后灯具坐标发生重叠')
  const mixedSavedPositions = JSON.parse(JSON.stringify(mixedBatchPage._positions))
  const restoredPortraitBatchPage = loadPage('pages/dmx-layout/dmx-layout.js')
  restoredPortraitBatchPage.onLoad()
  assert.deepStrictEqual(JSON.parse(JSON.stringify(restoredPortraitBatchPage._positions)), mixedSavedPositions, '竖屏重新加载未恢复批量混排结果')
  const restoredLandscapeBatchPage = loadPage('pages/dmx-layout-landscape/dmx-layout-landscape.js')
  restoredLandscapeBatchPage.onLoad()
  assert.deepStrictEqual(JSON.parse(JSON.stringify(restoredLandscapeBatchPage._positions)), mixedSavedPositions, '横屏重新加载未恢复批量混排结果')
  storage.delete('audioTool.dmxLayout.v1')
  storage.set('audioTool.dmxAddress.preferences', originalDmxPreferences)
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
    .slice(0, 2)
  const existingFixtureModel = validDmxFixtureModels[0]?.model
  const additionalFixtureModel = validDmxFixtureModels[1]?.model
  assert(existingFixtureModel && additionalFixtureModel, '批量灯具回归缺少可用型号')
  dmxPage.openFixtureSearch({ currentTarget: { dataset: { index: 0 } } })
  dmxPage.selectFixture({ currentTarget: { dataset: { model: existingFixtureModel } } })
  assert.strictEqual(dmxPage.data.groups[0].fixtureModel, existingFixtureModel, '公开灯具选择流程未设置首组型号')
  const dmxGroupsBeforeBatch = JSON.parse(JSON.stringify(dmxPage.data.groups))
  dmxPage.onBaseInput({ currentTarget: { dataset: { key: 'startAddressText' } }, detail: { value: '513' } })
  dmxPage.onFieldBlur()
  assert.strictEqual(dmxPage.data.result.valid, false, '无效起始地址未生成错误结果')
  dmxPage.switchWorkspace({ currentTarget: { dataset: { workspace: 'plan' } } })
  assert.strictEqual(dmxPage.data.activeWorkspace, 'plan', '无效结果仍不能进入地址方案工作区')
  assert(dmxPage.data.result.error, '地址方案工作区未保留无效原因')
  dmxPage.switchWorkspace({ currentTarget: { dataset: { workspace: 'config' } } })
  dmxPage.onBaseInput({ currentTarget: { dataset: { key: 'startAddressText' } }, detail: { value: '1' } })
  dmxPage.onFieldBlur()
  dmxPage.addGroup()
  assert.strictEqual(dmxPage.data.fixtureBatchOpen, true, '添加灯具未打开批量选择面板')
  dmxPage.selectFixture({ currentTarget: { dataset: { model: existingFixtureModel } } })
  dmxPage.selectFixture({ currentTarget: { dataset: { model: existingFixtureModel } } })
  assert.strictEqual(dmxPage.data.batchSelectedItems.length, 0, '重复点选同型号未正确切换选中状态')
  dmxPage.selectFixture({ currentTarget: { dataset: { model: existingFixtureModel } } })
  dmxPage.selectFixture({ currentTarget: { dataset: { model: additionalFixtureModel } } })
  dmxPage.adjustBatchQuantity({ currentTarget: { dataset: { model: existingFixtureModel, delta: 1 } } })
  assert.strictEqual(dmxPage.data.batchSelectedItems.length, 2, '批量选择未支持多个型号')
  assert.strictEqual(dmxPage.data.batchSelectedTotal, 3, '批量选择数量加减结果异常')
  dmxPage.confirmBatchAdd()
  assert.strictEqual(dmxPage.data.fixtureBatchOpen, false, '确认批量添加后面板未关闭')
  assert.strictEqual(dmxPage.data.groups.length, dmxGroupsBeforeBatch.length + 1, '批量添加未创建新型号分组')
  assert.strictEqual(
    Number(dmxPage.data.groups.find((group) => group.fixtureModel === existingFixtureModel).fixtureCount),
    Number(dmxGroupsBeforeBatch.find((group) => group.fixtureModel === existingFixtureModel).fixtureCount) + 2,
    '批量添加已有型号未合并数量',
  )
  dmxPage.commitCalculation({ groups: dmxOriginalGroups, activeWorkspace: 'config' })
  dmxPage.addGroup()
  dmxPage.openCustomGroupFromBatch()
  assert.strictEqual(dmxPage.data.groups.length, 2, '自定义灯具入口未创建编辑分组')
  assert.strictEqual(dmxPage.data.groups[1].fixtureSource, 'custom', '自定义入口未进入自定义灯具组')
  assert.strictEqual(dmxPage.data.groupEditorOpen, true, '自定义灯具入口未打开编辑面板')
  assert.strictEqual(dmxPage.data.groupEditorIndex, 1)
  assert.strictEqual(vibrationTypes.at(-1), 'medium')
  dmxPage.switchFixtureSource({ currentTarget: { dataset: { index: 1, source: 'custom' } } })
  assert.strictEqual(dmxPage.data.groups[1].fixtureSource, 'custom')
  dmxPage.switchFixtureSource({ currentTarget: { dataset: { index: 1, source: 'library' } } })
  assert.strictEqual(dmxPage.data.groups[1].fixtureSource, 'library')
  assert.strictEqual(dmxPage.data.groups[1].fixtureModel, '')
  assert.strictEqual(dmxPage.data.fixtureSearchOpen, false, '无历史库内灯具时切回库内不应自动打开搜索')
  dmxPage.switchFixtureSource({ currentTarget: { dataset: { index: 1, source: 'custom' } } })
  dmxPage.onGroupInput({
    currentTarget: { dataset: { index: 1, field: 'name' } },
    detail: { value: '染色灯' },
  })
  dmxPage.onGroupInput({
    currentTarget: { dataset: { index: 1, field: 'channelCount' } },
    detail: { value: '8' },
  })
  dmxPage.onGroupInput({
    currentTarget: { dataset: { index: 1, field: 'fixtureCount' } },
    detail: { value: '6' },
  })
  dmxPage.onFieldBlur()
  assert.strictEqual(dmxPage.data.result.totalFixtures, 10)
  assert.strictEqual(dmxPage.data.result.nextText, 'A113')
  dmxPage.copyResult()
  assert(clipboard.includes('灯具地址码计算'))
  assert(clipboard.includes('编址方式：连续自动'), 'DMX 复制结果缺少编址方式')
  assert(clipboard.includes('染色灯 · 6 台 · 8 CH/台'))
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
  const dmxComparison = buildRecordComparison([
    { ...dmxPage.getRecordPayload(), id: 'dmx-first' },
    {
      ...dmxPage.getRecordPayload(),
      id: 'dmx-second',
      preferences: { ...dmxPage.getPreferences(), startAddressText: '101' },
    },
  ])
  assert(dmxComparison.rows.some((row) => row.label === 'A 域起始地址'))
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
  dmxPage.selectFixture({ currentTarget: { dataset: { model: 'TL-SV3103' } } })
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
  dmxPage.removeGroupFromEditor({ currentTarget: { dataset: { index: 1 } } })
  assert.strictEqual(dmxPage.data.groups.length, 1)
  assert.strictEqual(dmxPage.data.groupEditorOpen, false, '删除当前灯具组后编辑面板没有关闭')
  assert.strictEqual(vibrationTypes.at(-1), 'medium')
  dmxPage.openGroupEditor({ currentTarget: { dataset: { index: 0 } } })
  dmxPage.removeGroupFromEditor({ currentTarget: { dataset: { index: 0 } } })
  assert.strictEqual(dmxPage.data.groups.length, 1, '删除最后一组时没有保留至少一个灯具分组')
  assert.strictEqual(dmxPage.data.groupEditorOpen, true, '删除最后一组时错误关闭了编辑面板')
  dmxPage.closeGroupEditor()

  const largeDmxPage = loadPage('pages/dmx-address/dmx-address.js')
  largeDmxPage.onLoad()
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
  assert.strictEqual(restoredDmxProgressPage.data.result.totalFixtures, 500)
  assert.strictEqual(restoredDmxProgressPage.data.result.selectedUniverse.checkedCount, 4,
    '重新进入 DMX 页面后未恢复相同编址方案的设置进度')
  restoredDmxProgressPage.commitCalculation({ startAddressText: '2' })
  assert.strictEqual(restoredDmxProgressPage.data.result.selectedUniverse.checkedCount, 0,
    '改变 DMX 编址方案后错误继承了旧设置进度')
  largeDmxPage.switchResultView({ currentTarget: { dataset: { mode: 'universe' } } })
  largeDmxPage.selectUniverse({ currentTarget: { dataset: { label: 'A' } } })
  assert.strictEqual(largeDmxPage.data.result.selectedUniverse.checkedCount, 4)
  largeDmxPage.toggleUniverseDetails()
  largeDmxPage.clearVisibleFixtureSelections()
  assert.strictEqual(largeDmxPage.data.result.selectedUniverse.checkedCount, 0)
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
  largeDmxPage.clearVisibleFixtureSelections()
  assert.strictEqual(largeDmxPage.data.result.selectedGroup.checkedCount, 0)
  assert(!largeDmxPage._checkedFixtureKeys.has(hiddenGroupFixtureProgressKey),
    '清空当前灯具组时只清除了首批已渲染地址')
  largeDmxPage.copyResult()
  assert.strictEqual(
    clipboard.split('\n').filter((line) => /^\s+#\d+\s+/.test(line)).length,
    500,
    'DMX 分批渲染后复制结果未保留完整 500 台地址',
  )
  const lastAssignedFixture = largeDmxPage._calculationResult.fixtures.at(-1)
  assert(clipboard.includes(
    `#${lastAssignedFixture.fixtureIndex}  ${lastAssignedFixture.addressText}  占用 ${lastAssignedFixture.rangeText}`,
  ), 'DMX 分批渲染后复制结果缺少最后一台灯具地址')
  assert.strictEqual(
    largeDmxPage.getRecordPayload().resultText
      .split('\n').filter((line) => /^\s+#\d+\s+/.test(line)).length,
    500,
    'DMX 分批渲染后项目记录未保留完整 500 台地址',
  )

  const dmxLayoutPreferences = {
    startAddressText: '1',
    groups: [
      {
        name: '摇头灯', fixtureSource: 'custom', fixtureModel: '', libraryChannelCount: '',
        customName: '摇头灯', customChannelCount: '16', channelCount: '16', fixtureCount: '4',
      },
      {
        name: '染色灯', fixtureSource: 'custom', fixtureModel: '', libraryChannelCount: '',
        customName: '染色灯', customChannelCount: '8', channelCount: '8', fixtureCount: '6',
      },
    ],
    groupSummary: '摇头灯×4（16CH）；染色灯×6（8CH）',
  }
  storage.set('audioTool.dmxAddress.preferences', dmxLayoutPreferences)
  const dmxProgressSyncPage = loadPage('pages/dmx-address/dmx-address.js')
  dmxProgressSyncPage.onLoad()
  const dmxLayoutContext = new Proxy({}, {
    get: (target, key) => {
      if (key in target) return target[key]
      if (key === 'draw') return (reserve, callback) => {
        const done = typeof reserve === 'function' ? reserve : callback
        if (done) done()
      }
      return () => {}
    },
  })
  let exportedDmxLayout = null
  let activeDmxLayoutCanvas = ''
  const exportedDmxAddressTexts = []
  const exportedDmxLayoutTexts = []
  const exportedDmxLayoutTextCalls = []
  const dmxLayoutFillStyles = []
  const dmxLayoutStrokeStyles = []
  dmxLayoutContext.fillText = (text, x, y) => {
    if (activeDmxLayoutCanvas !== 'dmxLayoutExportCanvas') return
    const value = String(text)
    exportedDmxLayoutTexts.push(value)
    exportedDmxLayoutTextCalls.push({ text: value, x, y })
    const exportedAddressMatch = value.match(/^(?:\d+ )?([A-Z]\d{3})$/)
    if (exportedAddressMatch) exportedDmxAddressTexts.push(exportedAddressMatch[1])
  }
  dmxLayoutContext.setFillStyle = (value) => { dmxLayoutFillStyles.push(value) }
  dmxLayoutContext.setStrokeStyle = (value) => { dmxLayoutStrokeStyles.push(value) }
  wx.createCanvasContext = (canvasId) => {
    assert(['dmxLayoutCanvas', 'dmxLayoutExportCanvas'].includes(canvasId))
    activeDmxLayoutCanvas = canvasId
    return dmxLayoutContext
  }
  wx.canvasToTempFilePath = (options) => {
    exportedDmxLayout = options
    options.success({ tempFilePath: 'temp://dmx-layout.png' })
  }
  wx.showLoading = () => {}
  wx.hideLoading = () => {}
  const dmxLayoutPage = loadPage('pages/dmx-layout/dmx-layout.js')
  assertWxmlHandlers(dmxLayoutPage, 'pages/dmx-layout/dmx-layout.wxml')
  const dmxLayoutWxml = fs.readFileSync(path.join(root, 'pages/dmx-layout/dmx-layout.wxml'), 'utf8')
  const dmxLayoutWxss = fs.readFileSync(path.join(root, 'pages/dmx-layout/dmx-layout.wxss'), 'utf8')
  const dmxLayoutRenderer = fs.readFileSync(path.join(root, 'pages/dmx-layout/layout-renderer.js'), 'utf8')
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
  ;[['page','background:var(--theme-page-bg)'],['.selected-status.selected-status','background:var(--theme-control)'],['.selected-status.selected-status-done','background:rgba(99,211,145,.14)'],['.batch-field-label.batch-field-label','background:transparent'],['.batch-clear-button.batch-clear-button','background:rgba(255,69,58,.14)'],['.address-button.address-button','background:var(--theme-control)'],['.apply-bar-button.apply-bar-button','background:var(--theme-primary-fill)'],['.result-report-preview-subtitle.result-report-preview-subtitle','background:transparent'],['.number-input.number-input','color:var(--theme-text)'],['.bar-count-input.bar-count-input','color:var(--theme-text)'],['.bar-config-row-title.bar-config-row-title','color:var(--theme-text)'],['.bar-group-name.bar-group-name','color:var(--theme-text-secondary)'],['.selected-address.selected-address','color:var(--theme-text)'],['.selected-group.selected-group','color:var(--theme-text-secondary)'],['.selected-meta.selected-meta','color:var(--theme-text-secondary)'],['.palette-group-chip.palette-group-chip','background:var(--theme-control)'],['.palette-fixture-chip.palette-fixture-chip','background:var(--theme-control)'],['.fixture-palette-count.fixture-palette-count','background:var(--theme-control)'],['.bar-config-status-error.bar-config-status-error','color:var(--theme-danger)'],['.generate-button.generate-button[disabled]','background:var(--theme-control)']].forEach(([selector,declaration]) => assertDarkDeclaration(selector,declaration))
  const landscapeDark = fs.readFileSync(path.join(root, 'pages/dmx-layout-landscape/dmx-layout-landscape.wxss'), 'utf8').slice(fs.readFileSync(path.join(root, 'pages/dmx-layout-landscape/dmx-layout-landscape.wxss'), 'utf8').search(/@media\s*\(prefers-color-scheme:\s*dark\)/))
  assert(dmxDark.lastIndexOf('.palette-group-chip.palette-group-chip-active') > dmxDark.lastIndexOf('.palette-group-chip.palette-group-chip,'), '竖屏 active palette 规则被 neutral 覆盖')
  assert(landscapeDark.lastIndexOf('.palette-group.palette-group-active') > landscapeDark.lastIndexOf('.palette-group.palette-group,'), '横屏 active palette 规则被 neutral 覆盖')
  assertFinalDarkDeclaration('.palette-group-chip.palette-group-chip-active', 'border-color:var(--theme-accent)')
  assertFinalDarkDeclaration('.palette-group-chip.palette-group-chip-active', 'background:var(--theme-accent-soft)')
  assertFinalDarkDeclaration('.palette-group-chip.palette-group-chip-active', 'color:var(--theme-accent-text)')
  assertFinalDarkDeclaration('.palette-group.palette-group-active', 'border-color:var(--theme-accent)', landscapeDark)
  assertFinalDarkDeclaration('.palette-group.palette-group-active', 'background:var(--theme-accent-soft)', landscapeDark)
  assertFinalDarkDeclaration('.palette-group.palette-group-active', 'color:var(--theme-accent-text)', landscapeDark)
  assert(/\.compact-field\{min-width:0;?\}/.test(dmxLight), '竖屏 compact-field 缺少基础 min-width:0')
  ;[['.palette-group.palette-group','background:var(--theme-control)'],['.palette-fixture.palette-fixture','background:var(--theme-control)'],['.palette-count.palette-count','background:var(--theme-control)'],['.selected-name.selected-name','color:var(--theme-text-secondary)'],['.selected-meta.selected-meta','color:var(--theme-text-secondary)'],['.batch-sheet-subtitle.batch-sheet-subtitle','color:var(--theme-text-secondary)'],['.batch-preview.batch-preview','background:var(--theme-control)']].forEach(([selector,declaration]) => assertDarkDeclaration(selector,declaration,landscapeDark))
  const { getMarkerTextColor, GROUP_COLORS, CANVAS_THEMES } = require('../pages/dmx-layout/page-factory')
  const contrast = (hex, text) => { const rgb=[0,2,4].map(i=>parseInt(hex.slice(i+1,i+3),16)/255).map(v=>v<=.03928?v/12.92:((v+.055)/1.055)**2.4); const l=rgb.reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0); const t=text==='#000000'?0:1; const a=Math.max(l,t),b=Math.min(l,t); return (a+.05)/(b+.05) }
  GROUP_COLORS.forEach((color) => assert(contrast(color, getMarkerTextColor(color)) >= 4.5, `地址标记文字对比度不足 ${color}`))
  const hexContrast = (a, b) => { const lum = (hex) => { const rgb=[0,2,4].map(i=>parseInt(hex.slice(i+1,i+3),16)/255).map(v=>v<=.03928?v/12.92:((v+.055)/1.055)**2.4); return rgb.reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0) }; const x=lum(a),y=lum(b); return (Math.max(x,y)+.05)/(Math.min(x,y)+.05) }
  assert(hexContrast('#ededf2', '#c43830') >= 4.5, '竖屏清空按钮浅色对比度不足')
  assertDarkDeclaration('.batch-range-arrow.batch-range-arrow', 'color:var(--theme-text-secondary)')
  assertDarkDeclaration('.batch-range-arrow.batch-range-arrow', 'color:var(--theme-text-secondary)', landscapeDark)
  const canvasContrast = (a, b) => { const lum = (hex) => { const rgb=[0,2,4].map(i=>parseInt(hex.slice(i+1,i+3),16)/255).map(v=>v<=.03928?v/12.92:((v+.055)/1.055)**2.4); return rgb.reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0) }; const x=lum(a),y=lum(b); return (Math.max(x,y)+.05)/(Math.min(x,y)+.05) }
  ;[['border','stage'],['border','background'],['rail','stage'],['success','stage']].forEach(([a,b]) => assert(canvasContrast(CANVAS_THEMES.light[a], CANVAS_THEMES.light[b]) >= 3, `浅色 Canvas ${a}/${b} 对比度不足`))
  ;[['border','stage'],['rail','stage'],['success','stage']].forEach(([a,b]) => assert(canvasContrast(CANVAS_THEMES.dark[a], CANVAS_THEMES.dark[b]) >= 3, `深色 Canvas ${a}/${b} 对比度不足`))
  const layoutLandscapeWxss = fs.readFileSync(path.join(root, 'pages/dmx-layout-landscape/dmx-layout-landscape.wxss'), 'utf8')
  const landscapeFirstDark = layoutLandscapeWxss.search(/@media\s*\(prefers-color-scheme:\s*dark\)/)
  assert(!dmxLight.includes('#007aff') && !layoutLandscapeWxss.slice(0, landscapeFirstDark).includes('#007aff'), '布局页浅色区残留低对比 #007aff')
  const appWxss = fs.readFileSync(path.join(root, 'app.wxss'), 'utf8')
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
    ['pages/records/project.wxss', '.project-report-generate[disabled]', 'background:var(--theme-surface-muted)'],
    ['pages/led-screen/led-screen.wxss', '.led-report-copy', 'color:var(--theme-accent-text)'],
    ['pages/knowledge/detail.wxss', '.distance-action-button', 'background:var(--theme-control)'],
    ['pages/limiter/limiter.wxss', '.selector-detail', 'background:var(--theme-accent-soft)'],
    ['pages/spl/spl.wxss', '.selector-detail.selector-detail', 'background:var(--theme-accent-soft)'],
    ['pages/dmx-address/dmx-address.wxss', '.group-result-tab-active', 'background:var(--theme-accent-soft)'],
    ['pages/dmx-address/dmx-address.wxss', '.copy-result-button', 'background:var(--theme-control)'],
  ].forEach(([file, selector, declaration]) => {
    const source = fs.readFileSync(path.join(root, file), 'utf8')
    assertThemeDeclaration(source, selector, declaration, `${file} 缺少 ${selector} 主题控件层级`)
  })
  ;[
    ['app.wxss', '.copy-result-button', 'background:var(--theme-control)', ['background:var(--theme-surface)']],
    ['app.wxss', '.result-image-button', 'background:var(--theme-primary-fill)', ['background:#0066cc']],
    ['pages/dmx-address/dmx-address.wxss', '.allocation-mode-switch', 'background:var(--theme-control)', ['background:#f2f2f7']],
    ['pages/dmx-address/dmx-address.wxss', '.result-view-switch', 'background:var(--theme-control)', ['background:#f2f2f7']],
    ['pages/dmx-address/dmx-address.wxss', '.workspace-switch', 'background:var(--theme-control)', ['background:rgba(242,242,247,.88)']],
    ['pages/dmx-address/dmx-address.wxss', '.group-editor-source-switch', 'background:var(--theme-control)', ['background:#f2f2f7']],
    ['pages/dmx-address/dmx-address.wxss', '.group-editor-fixture-select', 'background:var(--theme-control)', ['background:#f4f9ff']],
    ['pages/dmx-address/dmx-address.wxss', '.group-editor-delete', 'color:var(--theme-danger)', ['color:#b42318']],
    ['pages/dmx-address/dmx-address.wxss', '.fixture-category-chip-active', 'background:var(--theme-primary-fill)', []],
    ['pages/dmx-address/dmx-address.wxss', '.fixture-category-count', 'color:var(--theme-text-secondary)', ['color:#8e8e93']],
    ['pages/dmx-address/dmx-address.wxss', '.fixture-search-name', 'color:var(--theme-text-secondary)', ['color:#7a7a81']],
    ['pages/dmx-address/dmx-address.wxss', 'page .fixture-channel-guide-expand-selected.fixture-channel-guide-expand-selected', 'background:var(--theme-control)', ['background:#007aff']],
    ['pages/dmx-address/dmx-address.wxss', '.fixture-channel-guide-source', 'color:var(--theme-text-secondary)', ['color:#74747b']],
    ['pages/dmx-address/dmx-address.wxss', '.fixture-search-title', 'color:var(--theme-text)', ['color:#1d1d1f']],
    ['pages/dmx-address/dmx-address.wxss', '.fixture-channel-guide-close', 'background:var(--theme-control)', ['background:#eeeef2']],
    ['pages/dmx-address/dmx-address.wxss', '.fixture-channel-guide-detail', 'background:var(--theme-accent-soft)', ['background:#f2f7ff']],
    ['pages/dmx-address/dmx-address.wxss', '.group-editor-done', 'background:var(--theme-primary-fill)', ['background:#007aff']],
    ['pages/dmx-address/dmx-address.wxss', '.dmx-layout-entry-button', 'background:var(--theme-control)', ['background:#f5f9ff']],
    ['pages/dmx-address/dmx-address.wxss', '.dmx-layout-entry-title', 'color:var(--theme-text)', ['color:#1d1d1f']],
    ['pages/dmx-address/dmx-address.wxss', '.dmx-layout-entry-button-pressed', 'background:var(--theme-accent-soft)', ['background:#e8f3ff']],
    ['pages/gain-structure/gain-structure.wxss', '.choice-card', 'background:var(--theme-surface)', []],
    ['pages/gain-structure/gain-structure.wxss', '.choice-description', 'color:var(--theme-text-secondary)', ['color:#86868d']],
    ['pages/gain-structure/gain-structure.wxss', '.project-target-name', 'color:var(--theme-text)', []],
    ['pages/camera/camera.wxss', '.camera-input-tab', 'color:var(--theme-text-secondary)', ['color:#6e6e73']],
    ['pages/camera/camera.wxss', '.equipment-model', 'color:var(--theme-text)', ['color:#1d1d1f']],
    ['pages/led-screen/led-screen.wxss', '.led-report-title', 'color:var(--theme-text)', ['color:#1d1d1f']],
    ['pages/led-screen/led-screen.wxss', '.led-report-share', 'background:var(--theme-primary-fill)', ['background:#007aff']],
    ['pages/records/project.wxss', '.project-action-primary', 'background:var(--theme-primary-fill)', ['background:#007aff']],
    ['pages/records/project.wxss', '.project-report-generate', 'background:var(--theme-primary-fill)', ['background:#007aff']],
    ['pages/records/project.wxss', 'page .record-action.record-action-compare.record-action-selected', 'background:var(--theme-accent-soft)', ['background:#dcecff']],
    ['pages/records/project.wxss', 'page .comparison-head-row', 'background:var(--theme-control)', ['background:#edf4ff']],
    ['pages/records/project.wxss', 'page .comparison-content .comparison-value', 'color:var(--theme-text)', ['color:#1d1d1f']],
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
    ['pages/records/project.wxss', '.comparison-clear', 'color:var(--theme-accent-text)', ['color:#007aff']],
    ['pages/dmx-address/dmx-address.wxss', '.fixture-category-chip-active .fixture-category-count', 'color:#fff', ['color:rgba(255,255,255,.72)']],
    ['pages/camera/camera.wxss', 'button.camera-action-button', 'background:var(--theme-surface)', ['background:#fff']],
    ['pages/records/project.wxss', '.project-notes-text', 'color:var(--theme-text-secondary)', ['color:#3a3a3c']],
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
    ['pages/records/project.wxss', '.module-progress-meta', 'color:var(--theme-text-secondary)', ['color:#85858c']],
    ['pages/records/project.wxss', '.record-group-description', 'color:var(--theme-text-secondary)', ['color:#77777d']],
    ['pages/records/project.wxss', '.record-module', 'color:var(--theme-accent-text)', ['color:#007aff']],
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
    ['pages/led-screen/led-screen.wxss', '.diagram-size-line', 'color:var(--theme-text-tertiary)', ['color:#5f6672']],
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
    ['pages/dmx-address/dmx-address.wxss', '.input-unit', 'color:var(--theme-text-secondary)', ['color:#77777e']],
    ['pages/dmx-address/dmx-address.wxss', '.group-summary-meta', 'color:var(--theme-text-secondary)', ['color:#6e6e73']],
    ['pages/dmx-address/dmx-address.wxss', '.group-summary-edit', 'color:var(--theme-accent-text)', ['color:#007aff']],
    ['pages/dmx-address/dmx-address.wxss', '.group-editor-arrow', 'color:var(--theme-accent-text)', ['color:#007aff']],
    ['pages/dmx-address/dmx-address.wxss', '.batch-fixture-check', 'color:var(--theme-text-secondary)', ['color:#8e8e93']],
    ['pages/records/project.wxss', '.project-detail-label', 'color:var(--theme-text-secondary)', ['color:#86868b']],
    ['pages/records/project.wxss', '.comparison-tip', 'color:var(--theme-text-secondary)', ['color:#66758b']],
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
  assert(recordsWxmlForTheme.includes('class="project-notes"')
    && /\.project-detail-label\{[^}]*color:var\(--ts\)/.test(fs.readFileSync(path.join(root, 'pages/records/project.wxss'), 'utf8')),
  '记录备注标签未使用辅助文字主题色')
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
    ['pages/records/project.wxss', '.project-notes .project-detail-label', 'color:var(--theme-text-secondary)', '记录备注标签文字色被覆盖'],
    ['pages/limiter/limiter.wxss', '.field-label', 'color:var(--theme-text-secondary)', '限制器设备字段标签文字色被覆盖'],
    ['pages/led-screen/led-screen.wxss', '.input-wrap text', 'color:var(--theme-text-secondary)', 'LED 输入单位文字色被覆盖'],
  ].forEach(([file, selector, declaration, message]) => assertFrozenCascade(file, selector, declaration, message, { darkOnly: false }))
  assert(recordsWxmlForTheme.includes('record-action-compare') && recordsWxmlForTheme.includes('record-action-selected'),
    '记录页未保留对比选中态真实结构')
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
    'split-band-warning', 'lighting-mode-chip', 'missing-item', 'not-found', 'coverage-role'].forEach((className) => {
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
    ['.coverage-role', 'color:var(--theme-text-secondary)'],
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
  assert(dmxWxml.includes('class="group-editor-source-switch"')
    && dmxWxml.includes('fixture-category-count') && dmxWxml.includes('fixture-search-name')
    && dmxWxml.includes('fixture-channel-guide-expand'),
  'DMX 本轮深色真实结构缺少回归覆盖')
  assert(limiterWxml.includes('class="result-timing"')
    && limiterWxml.includes('class="result-time-grid"')
    && limiterWxml.includes('class="result-time-item"')
    && limiterWxml.includes('class="result-time-label"')
    && /class="[^"]*\bresult-time-value\b[^"]*"/.test(limiterWxml)
    && limiterWxml.includes('class="result-time-source"'),
  '限制器结果时间卡片缺少本轮深色真实结构')
  ;['universe-tab-meta', 'universe-empty', 'group-result-tab-index', 'universe-detail-title',
    'universe-detail-progress-text', 'fixture-progress-clear', 'fixture-selection-check', 'detail-toggle-trailing',
    'universe-group-row', 'universe-detail-head', 'fixture-progress-track'].forEach((className) => {
    assert(dmxWxml.includes(`class="${className}`), `DMX 结果区缺少真实类 ${className}`)
  })
  ;['demo-card', 'demo-caption', 'demo-step', 'kd-scene', 'kd-limit-line', 'kd-distance', 'kd-cable', 'kd-gain', 'kd-camera', 'kd-dmx', 'kd-led'].forEach((className) => {
    assert((knowledgeWxmlForTheme + demoScenesWxmlForTheme).includes(`class="${className}`), `知识动画缺少真实类 ${className}`)
  })
  assert(/\.fixture-category-chip-active\{[^}]*background:var\(--theme-primary-fill\)[^}]*color:#fff/.test(dmxWxss)
    && /\.fixture-category-chip-active \.fixture-category-count\{[^}]*color:#fff/.test(dmxWxss)
    && /\.fixture-channel-guide-expand-selected\{[^}]*background:var\(--theme-primary-fill\)[^}]*color:#fff/.test(dmxWxss),
  'DMX 浅色选中分类、数量和通道选中态未保持高对比主色组合')
  assert(hexContrast('#0066cc', '#ffffff') >= 4.5, 'DMX 浅色选中态主色与白字对比度不足')
  ;[
    ['.result-time-item', 'background:linear-gradient(145deg,var(--theme-surface),var(--theme-accent-soft))'],
    ['.result-time-label', 'color:var(--theme-text-secondary)'],
    ['.result-time-value', 'color:var(--theme-text)'],
    ['.result-time-source', 'color:var(--theme-text-secondary)'],
  ].forEach(([selector, declaration]) => assertThemeCascade(
    limiterWxssForTheme, selector, declaration, `限制器 dark 结果区缺少最终 ${selector} 覆盖`,
  ))
  ;[
    ['.selected-universe', 'background:var(--theme-surface)'],
    ['.selected-group-address', 'background:var(--theme-control)'],
    ['.group-result-tab-index', 'color:var(--theme-accent-text)'],
    ['.universe-tab-meta', 'color:var(--theme-text-secondary)'],
    ['.universe-empty', 'background:var(--theme-control)'],
    ['.universe-detail-title', 'color:var(--theme-text)'],
    ['.universe-detail-progress-text', 'color:var(--theme-text)'],
    ['.universe-fixture-group', 'background:var(--theme-surface)'],
    ['.universe-fixture-row', 'border-color:#74747a'],
    ['.universe-fixture-row', 'background:var(--theme-control)'],
    ['.universe-fixture-address', 'background:transparent'],
    ['.universe-fixture-row-selected', 'border-color:var(--theme-success)'],
    ['.universe-fixture-row-selected', 'background:#17382a'],
    ['.fixture-selection-check', 'border-color:#74747a'],
    ['.fixture-selection-check', 'background:var(--theme-control)'],
    ['.universe-group-row', 'border-color:var(--theme-divider)'],
    ['.universe-detail-head', 'border-color:var(--theme-divider)'],
    ['.fixture-progress-track', 'background:var(--theme-divider)'],
  ].forEach(([selector, declaration]) => assertThemeCascade(
    dmxWxss, selector, declaration, `DMX dark 结果区缺少最终 ${selector} 覆盖`,
  ))
  assert(dmxWxml.includes('style="--gb: {{fixtureGroup.softColor}}; --gs: {{fixtureGroup.borderColor}};"'),
    'DMX 逐台分组仍直接使用 inline background/border，dark cascade 无法覆盖')
  const gainWxssForTheme = fs.readFileSync(path.join(root, 'pages/gain-structure/gain-structure.wxss'), 'utf8')
  assertDarkNoBrightTail(gainWxssForTheme, [
    { selector: '.result-card', forbidden: ['rgba(240,248,255,.92)'] },
    { selector: '.status-chip', forbidden: ['color:#087f70'] },
    { selector: '.project-row-selected', forbidden: ['background:var(--theme-accent-soft)'] },
  ], '增益结构深色亮色尾部检查')
  assertDarkNoBrightTail(fs.readFileSync(path.join(root, 'pages/records/project.wxss'), 'utf8'), [
    { selector: '.comparison-head-row', forbidden: ['background:#edf4ff', 'color:#fff'] },
    { selector: '.comparison-label', forbidden: ['color:#6e6e73', 'background:#fff'] },
    { selector: '.comparison-value', forbidden: ['color:#1d1d1f', 'background:#fff'] },
  ], '记录对比深色亮色尾部检查')
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
  assertDarkDeclaration('.clear-button', 'color:#c43830', dmxLight)
  assertDarkDeclaration('.selected-status-done', 'background:rgba(52,199,89,.12)', dmxLight)
  assertDarkDeclaration('.selected-status-done', 'color:#1f744c', dmxLight)
  const landscapeLight = layoutLandscapeWxss.slice(0, landscapeFirstDark)
  assertDarkDeclaration('.selected-status-done', 'background:#ebf8ef', landscapeLight)
  assertDarkDeclaration('.selected-status-done', 'color:#1f744c', landscapeLight)
  assert(dmxLayoutWxml.includes('bindtap="openLandscapeLayout"'),
    '竖屏灯具位置图缺少横屏布置入口')
  assert(dmxLayoutWxml.includes('class="landscape-switch"')
    && dmxLayoutWxml.includes('>横屏 <text>›</text>')
    && !dmxLayoutWxml.includes('class="landscape-entry"')
    && !dmxLayoutWxml.includes('更大的舞台画布，适合拖动和现场核对')
    && !dmxLayoutWxss.includes('landscape-entry'),
  '竖屏横屏入口未收敛为紧凑视图切换入口')
  assert(!dmxLayoutWxml.includes('DMX LAYOUT')
    && !dmxLayoutWxml.includes('用位置、分组和地址，把编址结果变成现场可核对的舞台图。')
    && !dmxLayoutWxml.includes('选择灯具组，按住地址拖到灯位')
    && !dmxLayoutWxss.includes('.eyebrow')
    && !dmxLayoutWxss.includes('.page-subtitle')
    && !dmxLayoutWxss.includes('.fixture-palette-note')
    && dmxLayoutWxml.includes('点按选择，按住拖动调整位置')
    && dmxLayoutWxml.includes('每个灯具组需完整分配，可拆分到不同灯位')
     && !dmxLayoutWxml.includes('侧光同一位置的展开仅为地址辨识，不代表安装高度。')
     && dmxLayoutRenderer.includes("'侧光同一位置的展开仅为地址辨识，不代表安装高度。'"),
  '竖屏灯具位置图仍残留冗余宣传文案，或误删了关键操作提示')
  assert(dmxLayoutWxml.includes('hidden="{{previewVisible || batchVisible}}"')
    && dmxLayoutWxml.includes('hidden="{{!exportCanvasActive}}"')
    && dmxLayoutWxml.includes('<cover-view wx:if="{{paletteDragging}}"')
    && dmxLayoutWxml.includes('canvas-id="dmxLayoutExportCanvas"')
    && !dmxLayoutWxss.includes('.export-canvas'),
  '灯具位置图预览没有隔离页面原生 Canvas 与独立导出 Canvas，或残留未使用的 export-canvas 样式')
  assert(dmxLayoutWxml.includes('bindscroll="onPageScroll"'),
    '竖屏位置图没有监听页面滚动以同步 Canvas viewport 坐标')
  assert(portraitLayoutWxml.includes('bindtouchcancel="onCanvasTouchCancel"')
    && landscapeLayoutWxml.includes('bindtouchcancel="onCanvasTouchCancel"'),
  '横竖屏位置图没有使用独立的 Canvas 触摸取消处理')
  assert(/\.fixture-channel-guide-list\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*repeat\(2/s.test(dmxWxss)
    && /\.fixture-channel-guide-row\s*\{[^}]*height:\s*138rpx/s.test(dmxWxss)
    && /\.fixture-channel-guide-row-head\s*\{[^}]*grid-template-columns:\s*55rpx\s+minmax\(0,\s*1fr\)\s+auto/s.test(dmxWxss)
    && /\.fixture-channel-guide-name\s*\{[^}]*font-size:\s*22rpx/s.test(dmxWxss)
    && /\.fixture-channel-guide-expand\s*\{[^}]*min-width:\s*68rpx;[^}]*height:\s*48rpx/s.test(dmxWxss)
    && /\.fixture-channel-guide-detail\s*\{[^}]*flex-shrink:\s*0/s.test(dmxWxss)
    && !dmxWxss.includes('fixture-channel-guide-row-expanded')
    && !dmxWxss.includes('margin: 11rpx 0 0 136rpx'),
    '灯具通道速查弹层没有使用固定尺寸双列卡片或独立详情区')
  assert.strictEqual((dmxWxml.match(/class="universe-fixture-body"/g) || []).length, 2,
    '逐台地址卡片没有在按域与按组结构中统一包裹地址和通道入口')
  assert(/\.universe-fixture-body\s*\{[^}]*display:\s*flex;[^}]*align-items:\s*center/s.test(dmxWxss)
    && /\.universe-fixture-list\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/s.test(dmxWxss)
    && /\.universe-fixture-address\s*\{[^}]*flex:\s*1/s.test(dmxWxss)
    && /\.fixture-channel-guide-button\s*\{[^}]*min-width:\s*88rpx;[^}]*height:\s*88rpx/s.test(dmxWxss),
    '逐台地址卡片的地址与通道入口未保持同排或触控区不足')
  assert(/\.fixture-search-row-selected\s*\{[^}]*background:\s*transparent/s.test(dmxWxss)
    && !/\.fixture-search-row:active\s*,\s*\.fixture-search-row-selected/.test(dmxWxss),
    '型号选择弹层选中行仍保留常驻整行背景')
  dmxLayoutPage.onLoad()
  dmxLayoutPage.onReady()
  dmxLayoutFillStyles.length = 0
  dmxLayoutStrokeStyles.length = 0
  dmxLayoutPage._theme = 'light'
  dmxLayoutPage._checkedKeys = new Set([`${dmxLayoutPage._fixtures[0].groupIndex}:${dmxLayoutPage._fixtures[0].fixtureIndex}:${dmxLayoutPage._fixtures[0].addressText}`])
  dmxLayoutPage.drawLayout()
  assert(dmxLayoutFillStyles.includes('#f5f5f7') && dmxLayoutFillStyles.includes('#ffffff')
    && dmxLayoutFillStyles.includes('#1d1d1f') && dmxLayoutFillStyles.includes('#ffffff')
    && dmxLayoutStrokeStyles.includes('#248a3d'),
  '竖屏 Canvas 浅色主题没有记录背景、舞台、文字、标记或完成色')
  dmxLayoutFillStyles.length = 0
  dmxLayoutStrokeStyles.length = 0
  dmxLayoutPage._theme = 'dark'
  dmxLayoutPage._selectedKey = ''
  dmxLayoutPage.drawLayout()
  assert(dmxLayoutFillStyles.includes('#000000') && dmxLayoutFillStyles.includes('#1c1c1e')
    && dmxLayoutFillStyles.includes('#ffffff')
    && dmxLayoutStrokeStyles.includes('#63d391'),
  '竖屏 Canvas 深色主题没有记录背景、舞台、标记或完成色')
  dmxLayoutPage._theme = 'light'
  dmxLayoutPage.setData({ layoutImagePath: 'temp://old.png', previewVisible: true })
  systemTheme = 'dark'
  assert(themeChangeHandler, '灯具位置图没有注册系统主题变化监听')
  dmxLayoutFillStyles.length = 0
  dmxLayoutStrokeStyles.length = 0
  themeChangeHandler({ theme: 'dark' })
  assert.strictEqual(dmxLayoutPage.data.layoutImagePath, '', '主题切换后仍保留旧位置图')
  assert.strictEqual(dmxLayoutPage.data.previewVisible, false, '主题切换后仍保留旧预览层')
  assert.strictEqual(dmxLayoutPage._theme, 'dark', '主题切换后 Canvas 主题未同步')
  assert(dmxLayoutFillStyles.includes('#000000') && dmxLayoutFillStyles.includes('#1c1c1e'),
    '主题切换后没有实际重绘深色 Canvas 背景与舞台')
  dmxLayoutPage._theme = 'light'
  systemTheme = 'light'
  dmxLayoutPage._checkedKeys = new Set()
  assert.strictEqual(dmxLayoutPage.data.hasPlan, true)
  assert.strictEqual(dmxLayoutPage.data.layoutMode, 'portrait')
  assert.deepStrictEqual(
    [dmxLayoutPage.data.canvasWidth, dmxLayoutPage.data.canvasHeight],
    [700, 900],
    '竖屏灯具位置图逻辑画布基线发生变化',
  )
  assert.strictEqual(dmxLayoutPage.data.totalFixtures, 10)
  assert.strictEqual(dmxLayoutPage.data.addressLabelMode, 'all')
  assert.strictEqual(dmxLayoutPage.data.barRows.length, 3)
  assert.deepStrictEqual(
    dmxLayoutPage.data.paletteGroups.map((group) => group.remainingCount),
    [0, 0],
    '灯具位置图已放置灯具未从待上杆列表排除',
  )
  assert.strictEqual(dmxLayoutPage.data.unplacedFixtureCount, 0,
    '灯具位置图初始待上杆总数不正确')
  dmxLayoutPage.openLandscapeLayout()
  assert.strictEqual(navigatedUrl, '/pages/dmx-layout-landscape/dmx-layout-landscape',
    '竖屏灯具位置图没有进入独立横屏布置页')
  dmxLayoutPreferences.groups.forEach((group, groupIndex) => {
    assert.strictEqual(
      dmxLayoutPage.data.barRows.reduce((sum, bar) => sum + Number(bar.groups[groupIndex].countText), 0),
      Number(group.fixtureCount),
      '灯杆配置没有完整分配灯具组数量',
    )
  })
  assert(!Object.prototype.hasOwnProperty.call(dmxLayoutPage.data, 'fixtures'),
    '灯具位置图仍把完整逐台数据传入视图层')
  assert.strictEqual(Object.keys(dmxLayoutPage._positions).length, 10)
  Object.values(dmxLayoutPage._positions).forEach((position) => {
    assert(position.x >= 0 && position.x <= 1 && position.y >= 0 && position.y <= 1,
      '灯具自动排布位置超出舞台边界')
  })
  const snapFixture = dmxLayoutPage._fixtures[0]
  const snapPositionKey = `${snapFixture.groupIndex}:${snapFixture.fixtureIndex}`
  const snapStage = dmxLayoutPage.getDisplayStageRect()
  dmxLayoutPage._positions[snapPositionKey].y = 0.5
  dmxLayoutPage._dragKey = snapPositionKey
  dmxLayoutPage._canvasRect = { left: 0, top: 0, width: 350, height: 450 }
  dmxLayoutPage.onCanvasTouchMove({
    touches: [{
      x: ((snapStage.left + (snapStage.width / 2)) / 700) * 350,
      y: ((snapStage.top + (snapStage.height * 0.25) + 12 + 96) / 900) * 450,
    }],
  })
  dmxLayoutPage.onCanvasTouchEnd()
  assert(Math.abs(dmxLayoutPage._positions[snapPositionKey].y - 0.25) < 1e-9,
    '灯具拖到灯杆附近时未吸附到灯杆中心线')
  dmxLayoutPage._canvasRect = { left: 0, top: 500, width: 350, height: 450 }
  dmxLayoutPage._pageScrollTop = 0
  dmxLayoutPage._canvasScaleX = .5
  dmxLayoutPage._canvasScaleY = .5
  dmxLayoutPage.onPageScroll({ detail: { scrollTop: 120 } })
  assert.strictEqual(dmxLayoutPage._canvasRect.top, 380,
    '页面滚动 120px 后 Canvas viewport top 没有按 delta 同步')
  dmxLayoutPage.onPageScroll({ detail: { scrollTop: 120 } })
  assert.strictEqual(dmxLayoutPage._canvasRect.top, 380,
    '重复收到相同 scrollTop 时错误重复扣减 Canvas top')
  dmxLayoutPage.onPageScroll({ detail: { scrollTop: 0 } })
  assert.strictEqual(dmxLayoutPage._canvasRect.top, 500,
    '页面回滚后 Canvas viewport top 没有恢复')
  dmxLayoutPage.onPageScroll({ detail: { scrollTop: 120 } })
  const scrolledPosition = dmxLayoutPage._positions[snapPositionKey]
  const scrolledVisualY = dmxLayoutPage.data.frontIndex === 0 ? scrolledPosition.y : 1 - scrolledPosition.y
  dmxLayoutPage.onCanvasTouchStart({
    touches: [{
      clientX: ((snapStage.left + (scrolledPosition.x * snapStage.width)) / 700) * 350,
      clientY: dmxLayoutPage._canvasRect.top + (((snapStage.top + (scrolledVisualY * snapStage.height)) / 900) * 450),
    }],
  })
  assert.strictEqual(dmxLayoutPage.data.selectedFixture.addressText, snapFixture.addressText,
    '页面滚动后点击 Canvas 可见灯具没有选中并显示地址')
  dmxLayoutPage.onCanvasTouchEnd()
  dmxLayoutPage._canvasRect.top = 0
  dmxLayoutPage._pageScrollTop = 0
  assert.strictEqual(typeof dmxLayoutPage.findFixture, 'function', '竖屏位置图缺少稳定灯具命中逻辑')
  dmxLayoutPage._view = { s: 1, x: 0, y: 0 }
  dmxLayoutPage._canvasScaleX = .5
  dmxLayoutPage._canvasScaleY = .5
  const snapPosition = dmxLayoutPage._positions[snapPositionKey]
  const snapClient = {
    x: ((snapStage.left + (snapPosition.x * snapStage.width)) / 700) * 350,
    y: ((snapStage.top + (snapPosition.y * snapStage.height)) / 900) * 450,
  }
  dmxLayoutPage.onCanvasTouchStart({
    touches: [{ clientX: snapClient.x, clientY: snapClient.y - 34 }],
  })
  assert.strictEqual(dmxLayoutPage.data.selectedFixture.addressText, snapFixture.addressText,
    '靠近圆点边缘点按没有选中灯具并显示地址')
  dmxLayoutPage.onCanvasTouchEnd()
  const jitterY = dmxLayoutPage._positions[snapPositionKey].y
  dmxLayoutPage.onCanvasTouchStart({
    touches: [{ clientX: snapClient.x, clientY: snapClient.y }],
  })
  dmxLayoutPage.onCanvasTouchMove({
    touches: [{ clientX: snapClient.x + 4, clientY: snapClient.y + 4 }],
  })
  dmxLayoutPage.onCanvasTouchEnd()
  assert.strictEqual(dmxLayoutPage._positions[snapPositionKey].y, jitterY,
    '轻微手抖被误判为拖动并改变了灯具位置')
  dmxLayoutPage.onCanvasTouchStart({
    touches: [{ clientX: snapClient.x, clientY: snapClient.y }],
  })
  dmxLayoutPage.onCanvasTouchMove({
    touches: [{ clientX: snapClient.x + 12, clientY: snapClient.y + 12 }],
  })
  assert.strictEqual(dmxLayoutPage._dragMoved, true,
    '超过触摸移动阈值后没有进入拖动状态')
  dmxLayoutPage.onCanvasTouchEnd()
  const zoomPosition = dmxLayoutPage._positions[snapPositionKey]
  dmxLayoutPage._view = { s: 2, x: 0, y: 0 }
  const zoomLogicalX = snapStage.left + (zoomPosition.x * snapStage.width)
  const zoomVisualY = dmxLayoutPage.data.frontIndex === 0 ? zoomPosition.y : 1 - zoomPosition.y
  const zoomLogicalY = snapStage.top + (zoomVisualY * snapStage.height)
  const zoomClient = {
    x: (zoomLogicalX / 700) * 350 * 2,
    y: (zoomLogicalY / 900) * 450 * 2,
  }
  dmxLayoutPage.onCanvasTouchStart({
    touches: [{ clientX: zoomClient.x, clientY: zoomClient.y - 42 }],
  })
  assert.strictEqual(dmxLayoutPage.data.selectedFixture.addressText, snapFixture.addressText,
    '缩放后 44px 屏幕命中范围没有稳定选中灯具')
  dmxLayoutPage.onCanvasTouchEnd()
  dmxLayoutPage._view = { s: 1, x: 0, y: 0 }
  dmxLayoutPage.toggleAddressLabels()
  assert.strictEqual(dmxLayoutPage.data.addressLabelMode, 'smart')
  dmxLayoutPage.onCanvasTouchStart({ touches: [{ x: 0, y: 0 }] })
  dmxLayoutPage.onCanvasTouchEnd({ touches: [], changedTouches: [{ x: 0, y: 0 }] })
  assert.strictEqual(dmxLayoutPage.data.addressLabelsVisible, false,
    '点击位置图空白区域后地址角标未隐藏')
  assert.strictEqual(dmxLayoutPage.data.scrollEnabled, true,
    '位置图空白区域没有恢复页面滚动')
  dmxLayoutPage.toggleAddressLabels()
  assert.strictEqual(dmxLayoutPage.data.addressLabelsVisible, true,
    '地址角标隐藏后无法重新显示')
  dmxLayoutPage.selectFixture(snapFixture)
  dmxLayoutPage.onCanvasTouchStart({ touches: [{ clientX: 5, clientY: 5 }] })
  assert.strictEqual(dmxLayoutPage.data.selectedFixture.addressText, snapFixture.addressText,
    '空白区域拖动候选在 touchstart 时错误清除了已选灯具')
  dmxLayoutPage.onCanvasTouchMove({ touches: [{ clientX: 22, clientY: 5 }] })
  dmxLayoutPage.onCanvasTouchEnd({ touches: [], changedTouches: [{ clientX: 22, clientY: 5 }] })
  assert.strictEqual(dmxLayoutPage.data.selectedFixture.addressText, snapFixture.addressText,
    '空白区域拖动后错误清除了已选灯具')
  assert.strictEqual(dmxLayoutPage.data.addressLabelsVisible, true,
    '空白区域拖动后错误隐藏了地址角标')
  dmxLayoutPage.onCanvasTouchStart({ touches: [{ clientX: 5, clientY: 5 }] })
  dmxLayoutPage.onPageScroll({ detail: { scrollTop: 10 } })
  dmxLayoutPage.onCanvasTouchEnd({ touches: [], changedTouches: [{ clientX: 5, clientY: 5 }] })
  assert.strictEqual(dmxLayoutPage.data.selectedFixture.addressText, snapFixture.addressText,
    '页面滑动后错误清除了已选灯具')
  assert.strictEqual(dmxLayoutPage.data.addressLabelsVisible, true,
    '页面滑动后错误隐藏了地址角标')
  dmxLayoutPage.onPageScroll({ detail: { scrollTop: 0 } })
  dmxLayoutPage.onCanvasTouchStart({ touches: [{ clientX: 5, clientY: 5 }] })
  dmxLayoutPage.onCanvasTouchCancel({ touches: [], changedTouches: [{ clientX: 5, clientY: 5 }] })
  assert.strictEqual(dmxLayoutPage.data.selectedFixture.addressText, snapFixture.addressText,
    '空白区域 touchcancel 错误清除了已选灯具')
  assert.strictEqual(dmxLayoutPage.data.addressLabelsVisible, true,
    '空白区域 touchcancel 错误隐藏了地址角标')
  dmxLayoutPage.onCanvasTouchStart({ touches: [{ clientX: 5, clientY: 5 }] })
  dmxLayoutPage.onCanvasTouchMove({
    touches: [
      { clientX: 5, clientY: 5 },
      { clientX: 25, clientY: 5 },
    ],
  })
  dmxLayoutPage.onCanvasTouchEnd({ touches: [] })
  assert.strictEqual(dmxLayoutPage.data.selectedFixture.addressText, snapFixture.addressText,
    '空白区域双指手势结束后错误清除了已选灯具')
  assert.strictEqual(dmxLayoutPage.data.addressLabelsVisible, true,
    '空白区域双指手势结束后错误隐藏了地址角标')
  dmxLayoutPage.onCanvasTouchStart({ touches: [{ clientX: 5, clientY: 5 }] })
  dmxLayoutPage.onCanvasTouchEnd({ touches: [], changedTouches: [{ clientX: 5, clientY: 5 }] })
  assert.strictEqual(dmxLayoutPage.data.selectedFixture, null,
    '空白区域轻点后没有清除选中灯具')
  assert.strictEqual(dmxLayoutPage.data.addressLabelsVisible, false,
    '空白区域轻点后地址角标未隐藏')
  dmxLayoutPage.toggleBarConfiguration()
  assert.strictEqual(dmxLayoutPage.data.barConfigurationExpanded, true)
  dmxLayoutPage.onBarCountInput({
    currentTarget: { dataset: { barIndex: 0, groupIndex: 0 } },
    detail: { value: '4' },
  })
  dmxLayoutPage.onBarCountInput({
    currentTarget: { dataset: { barIndex: 1, groupIndex: 0 } },
    detail: { value: '0' },
  })
  dmxLayoutPage.onBarCountInput({
    currentTarget: { dataset: { barIndex: 2, groupIndex: 0 } },
    detail: { value: '0' },
  })
  assert.strictEqual(dmxLayoutPage.data.barConfigurationValid, true)
  dmxLayoutPage.applyBarConfiguration()
  dmxLayoutPage._fixtures.filter((fixture) => fixture.groupIndex === 0).forEach((fixture) => {
    assert(Math.abs(dmxLayoutPage._positions[`${fixture.groupIndex}:${fixture.fixtureIndex}`].y - 0.25) < 1e-9,
      '按灯杆配置生成位置图后灯具没有进入指定灯杆')
  })
  dmxLayoutPage.clearLayout()
  assert.strictEqual(Object.keys(dmxLayoutPage._positions).length, 0,
    '清空位置图后仍残留已放置灯具')
  assert.strictEqual(dmxLayoutPage.data.unplacedFixtureCount, 10,
    '清空位置图后待上杆灯具数量不正确')
  assert.deepStrictEqual(
    dmxLayoutPage.data.paletteGroups.map((group) => group.remainingCount),
    [4, 6],
    '清空位置图后待上杆灯具组数量不正确',
  )
  dmxLayoutPage.selectPaletteGroup({ currentTarget: { dataset: { groupIndex: 1 } } })
  assert.strictEqual(dmxLayoutPage.data.paletteGroupIndex, 1,
    '灯具位置图无法切换首选灯具组')
  assert.strictEqual(dmxLayoutPage.data.paletteFixtures.length, 6,
    '灯具位置图切换灯具组后数量不正确')
  dmxLayoutPage.selectPaletteGroup({ currentTarget: { dataset: { groupIndex: 0 } } })
  const originalLayoutFixtures = dmxLayoutPage._fixtures
  dmxLayoutPage._fixtures = Array.from({ length: 85 }, (_, fixtureIndex) => ({
    ...snapFixture,
    fixtureIndex,
    groupIndex: 0,
    addressText: `A${String(fixtureIndex + 1).padStart(3, '0')}`,
  }))
  dmxLayoutPage.refreshFixturePalette(0)
  assert.strictEqual(dmxLayoutPage.data.paletteFixtures.length, 80,
    '灯具位置图待上杆灯具没有保持 80 台显示上限')
  assert(dmxLayoutPage.data.paletteMoreText.includes('另有 5 台'),
    '灯具位置图超过 80 台时没有提示剩余数量')
  dmxLayoutPage._fixtures = originalLayoutFixtures
  dmxLayoutPage.refreshFixturePalette(0)
  const paletteTargetX = ((snapStage.left + (snapStage.width / 2)) / 700) * 350
  const paletteTargetY = ((snapStage.top + (snapStage.height * 0.25)) / 900) * 450
  dmxLayoutPage.onPaletteTouchStart({
    currentTarget: { dataset: { key: snapPositionKey } },
    touches: [{ clientX: 20, clientY: 20 }],
  })
  assert.strictEqual(dmxLayoutPage._paletteDragFixture.addressText, 'A001',
    '开始拖动时没有缓存当前灯具')
  const fixtureFindBeforePaletteMove = dmxLayoutPage._fixtures.find
  dmxLayoutPage._fixtures.find = () => { throw new Error('拖动移动阶段不应扫描 _fixtures') }
  dmxLayoutPage.onPaletteTouchMove({
    touches: [{ clientX: paletteTargetX, clientY: paletteTargetY }],
  })
  dmxLayoutPage._fixtures.find = fixtureFindBeforePaletteMove
  assert.strictEqual(dmxLayoutPage._paletteDragPreview.fixture.addressText, 'A001',
    '待上杆灯具进入原生 Canvas 后没有切换为画布内拖动预览')
  assert.strictEqual(dmxLayoutPage.data.paletteDragging, true,
    '待上杆灯具进入原生 Canvas 后没有保持可覆盖画布的跟手浮层')
  dmxLayoutPage.onPaletteTouchEnd({
    changedTouches: [{ clientX: paletteTargetX, clientY: paletteTargetY }],
  })
  assert.strictEqual(dmxLayoutPage._paletteDragFixture, null,
    '拖动结束后仍残留灯具缓存')
  assert(Math.abs(dmxLayoutPage._positions[snapPositionKey].y - 0.25) < 1e-9,
    '从灯具组拖动灯具后没有吸附到目标灯杆')
  assert.strictEqual(dmxLayoutPage.data.unplacedFixtureCount, 9,
    '灯具拖动上杆后待上杆数量没有更新')
  assert.deepStrictEqual(
    dmxLayoutPage.data.paletteGroups.map((group) => group.remainingCount),
    [3, 6],
    '已放置灯具没有从对应灯具组待上杆列表中排除',
  )
  dmxLayoutPage.onPaletteTouchStart({
    currentTarget: { dataset: { key: snapPositionKey } },
    touches: [{ clientX: 20, clientY: 20 }],
  })
  assert(dmxLayoutPage._paletteDragFixture, '再次开始拖动时没有建立灯具缓存')
  dmxLayoutPage.cancelPaletteDrag()
  assert.strictEqual(dmxLayoutPage._paletteDragFixture, null,
    '取消拖动后仍残留灯具缓存')
  dmxLayoutPage.onSearchInput({ detail: { value: 'A001' } })
  dmxLayoutPage.searchFixture()
  assert.strictEqual(dmxLayoutPage.data.selectedFixture.addressText, 'A001')
  dmxLayoutPage.toggleSelectedProgress()
  assert.strictEqual(dmxLayoutPage.data.selectedFixture.completed, true)
  assert.strictEqual(storage.get('audioTool.dmxAddress.progress').keys.length, 1,
    '灯具位置图完成标记未同步到 DMX 逐台进度')
  dmxProgressSyncPage.onShow()
  assert.strictEqual(dmxProgressSyncPage.data.result.selectedUniverse.checkedCount, 1,
    '从灯具位置图返回后 DMX 地址页未刷新现场设置进度')
  dmxLayoutPage.generateLayoutImage()
  assert.strictEqual(dmxLayoutPage.data.layoutImagePath, 'temp://dmx-layout.png')
  assert.strictEqual(dmxLayoutPage.data.previewVisible, true)
  assert.strictEqual(dmxLayoutPage.data.exportCanvasActive, false,
    '灯具位置图导出完成后仍保留可见导出画布')
  assert.strictEqual(exportedDmxLayout.canvasId, 'dmxLayoutExportCanvas',
    '灯具位置图仍复用缩放后的页面画布进行导出')
  assert.strictEqual(exportedDmxLayout.width, 700)
  assert.strictEqual(exportedDmxLayout.height, 900)
  assert(exportedDmxAddressTexts.includes('A001'),
    '生成的灯具位置图没有把完整地址码绘制进灯具圆点')
  assert(exportedDmxLayout.destWidth <= 1500 && exportedDmxLayout.destHeight <= 4096,
    '灯具位置图导出尺寸超过安全上限')
  dmxLayoutPage.closePreview()
  assert.strictEqual(dmxLayoutPage.data.previewVisible, false,
    '关闭灯具位置图预览后仍残留预览层')
  assert.strictEqual(dmxLayoutPage.data.exportCanvasActive, false,
    '关闭灯具位置图预览后导出画布状态异常')
  const finalPaletteFixture = dmxLayoutPage._fixtures[dmxLayoutPage._fixtures.length - 1]
  dmxLayoutPage._positions = Object.create(null)
  dmxLayoutPage._fixtures.slice(0, -1).forEach((fixture, index) => {
    dmxLayoutPage._positions[`${fixture.groupIndex}:${fixture.fixtureIndex}`] = {
      zone: 'top', positionIndex: 0, x: .12 + (index * .06), y: .25,
    }
  })
  dmxLayoutPage.refreshFixturePalette(0)
  assert.strictEqual(dmxLayoutPage.data.unplacedFixtureCount, 1,
    '最后一只待布置灯具动态回归未构造出单项 palette')
  const oldPaletteRect = { left: 0, top: 100, width: 350, height: 450 }
  dmxLayoutPage._canvasRect = { ...oldPaletteRect }
  dmxLayoutPage._canvasScaleX = .5
  dmxLayoutPage._canvasScaleY = .5
  const recoveryStage = dmxLayoutPage.getDisplayStageRect()
  const recoveryPoint = {
    clientX: ((recoveryStage.left + (recoveryStage.width / 2)) / 700) * 350,
    clientY: oldPaletteRect.top + (((recoveryStage.top + (recoveryStage.height * .25)) / 900) * 450),
  }
  dmxLayoutPage._paletteDragKey = `${finalPaletteFixture.groupIndex}:${finalPaletteFixture.fixtureIndex}`
  let recoveryMeasureCount = 0
  let recoveryMeasureSawUpdatedView = false
  const originalRecoveryMeasure = dmxLayoutPage.measureCanvas
  dmxLayoutPage.measureCanvas = (callback) => {
    recoveryMeasureCount += 1
    recoveryMeasureSawUpdatedView = dmxLayoutPage.data.unplacedFixtureCount === 0
      && dmxLayoutPage.data.searchResultText === `已放置 ${finalPaletteFixture.addressText}`
    dmxLayoutPage._canvasRect = { left: 0, top: 260, width: 350, height: 450 }
    if (callback) callback()
  }
  dmxLayoutPage.onPaletteTouchEnd({ changedTouches: [recoveryPoint] })
  assert.strictEqual(recoveryMeasureCount, 1,
    '最后一只灯具上杆导致 palette 消失后没有重新测量 Canvas')
  assert.strictEqual(recoveryMeasureSawUpdatedView, true,
    '最终 Canvas 测量早于 palette/search-result 视图更新，仍可能缓存错误 top')
  assert.strictEqual(dmxLayoutPage.data.unplacedFixtureCount, 0,
    '最后一只灯具上杆后 palette 没有消失')
  dmxLayoutPage.setData({ selectedFixture: null })
  const recoveryPosition = dmxLayoutPage._positions[`${finalPaletteFixture.groupIndex}:${finalPaletteFixture.fixtureIndex}`]
  const recoveryVisualY = dmxLayoutPage.data.frontIndex === 0 ? recoveryPosition.y : 1 - recoveryPosition.y
  const recoveryClick = {
    touches: [{
      clientX: ((recoveryStage.left + (recoveryPosition.x * recoveryStage.width)) / 700) * 350,
      clientY: dmxLayoutPage._canvasRect.top + (((recoveryStage.top + (recoveryVisualY * recoveryStage.height)) / 900) * 450),
    }],
  }
  dmxLayoutPage.onCanvasTouchStart(recoveryClick)
  assert.strictEqual(dmxLayoutPage.data.selectedFixture.addressText, finalPaletteFixture.addressText,
    'palette 消失并重新测量后，按新 viewport 点击灯具仍未选中')
  dmxLayoutPage.onCanvasTouchEnd()
  dmxLayoutPage.setData({ selectedFixture: null })
  dmxLayoutPage._canvasRect.top = 999
  const localRecoveryClick = {
    touches: [{
      x: ((recoveryStage.left + (recoveryPosition.x * recoveryStage.width)) / 700) * 350,
      y: ((recoveryStage.top + (recoveryVisualY * recoveryStage.height)) / 900) * 450,
      clientX: 1,
      clientY: 1,
    }],
  }
  dmxLayoutPage.onCanvasTouchStart(localRecoveryClick)
  assert.strictEqual(dmxLayoutPage.data.selectedFixture.addressText, finalPaletteFixture.addressText,
    'Canvas 局部坐标正确但 viewport client 坐标过期时没有选中灯具')
  dmxLayoutPage.onCanvasTouchEnd()
  dmxLayoutPage.measureCanvas = originalRecoveryMeasure
  dmxLayoutPage._paletteDragFixture = finalPaletteFixture
  dmxLayoutPage.onUnload()
  assert.strictEqual(removedThemeChangeHandler, themeChangeHandler,
    '灯具位置图卸载时没有解绑同一主题监听函数')
  assert.strictEqual(dmxLayoutPage._paletteDragFixture, null,
    '页面卸载后仍残留灯具缓存')
  storage.set('audioTool.dmxAddress.preferences', {
    ...dmxLayoutPreferences,
    allocationMode: 'manual',
    groups: dmxLayoutPreferences.groups.map((group, index) => ({
      ...group,
      targetUniverse: index === 0 ? 'B' : 'A',
    })),
  })
  const manualDmxLayoutPage = loadPage('pages/dmx-layout/dmx-layout.js')
  manualDmxLayoutPage.onLoad()
  assert.strictEqual(manualDmxLayoutPage.data.hasPlan, true)
  assert.strictEqual(manualDmxLayoutPage._fixtures[0].addressText, 'B001',
    '灯具位置图没有透传按组分域的目标域')
  assert.strictEqual(manualDmxLayoutPage._fixtures[4].addressText, 'A001',
    '灯具位置图的不同分组没有分别使用目标域')
  manualDmxLayoutPage.onUnload()

  storage.set('audioTool.dmxAddress.preferences', dmxLayoutPreferences)
  storage.set('audioTool.dmxLayout.v1', {
    stageWidthText: '12',
    stageDepthText: '8',
    rowCount: 3,
    frontIndex: 0,
    preserveUnplaced: true,
    positions: { [snapPositionKey]: { x: 0.37, y: 0.25 } },
  })
  const multiPositionLayoutPage = loadPage('pages/dmx-layout/dmx-layout.js')
  multiPositionLayoutPage.onLoad()
  assert.strictEqual(multiPositionLayoutPage.data.schemeIndex, 0,
    '旧版灯具位置图没有默认迁移为仅顶光方案')
  assert.deepStrictEqual(multiPositionLayoutPage._positions[snapPositionKey], {
    zone: 'top', positionIndex: 0, x: 0.37, y: 0.25,
  }, '旧版仅含 x/y 的灯具位置没有无损迁移为顶光位')
  multiPositionLayoutPage.onSchemeChange({ detail: { value: '2' } })
  assert.strictEqual(multiPositionLayoutPage.data.schemeIndex, 2,
    '灯具位置图无法切换为顶光、面光与侧光完整方案')
  assert.strictEqual(multiPositionLayoutPage.data.sidePairIndex, 1,
    '8 米纵深没有推荐 2 对侧光位')
  const fullDefinitions = multiPositionLayoutPage._positionDefinitions
  assert(fullDefinitions.some((definition) => definition.zone === 'front'),
    '完整灯位方案缺少面光位')
  const leftSides = fullDefinitions.filter((definition) => definition.zone === 'side-left')
  const rightSides = fullDefinitions.filter((definition) => definition.zone === 'side-right')
  assert.deepStrictEqual(
    leftSides.map((definition) => definition.positionIndex),
    rightSides.map((definition) => definition.positionIndex),
    '完整灯位方案的左右侧光没有成对生成',
  )
  assert.strictEqual(leftSides.length, 2, '8 米纵深没有生成 2 对侧光位')
  assert.strictEqual(Object.keys(multiPositionLayoutPage._positions).length, 10,
    '切换完整灯位方案后丢失灯具地址或生成重复灯具键')
  assert.strictEqual(new Set(Object.keys(multiPositionLayoutPage._positions)).size, 10,
    '切换完整灯位方案后生成重复灯具键')

  multiPositionLayoutPage._canvasRect = { left: 0, top: 0, width: 350, height: 450 }
  multiPositionLayoutPage._view = { s: 2, x: 20, y: 30 }
  assert.deepStrictEqual(
    multiPositionLayoutPage.logicalPoint({ x: 195, y: 255 }),
    { x: 175, y: 225 },
    '缩放和平移后，触点没有正确映射回灯具位置图坐标',
  )
  multiPositionLayoutPage.resetCanvasView()
  assert.deepStrictEqual(multiPositionLayoutPage._view, { s: 1, x: 0, y: 0 },
    '适应屏幕没有恢复灯具位置图的默认视图')
  const multiStage = multiPositionLayoutPage.getDisplayStageRect()
  const toClientPoint = (x, y) => ({ x: (x / 700) * 350, y: (y / 900) * 450 })
  const frontPlacement = multiPositionLayoutPage.getPalettePlacement(toClientPoint(
    multiStage.left + (multiStage.width / 2), multiStage.top + multiStage.height + 42,
  ))
  assert.strictEqual(frontPlacement.position.zone, 'front',
    '面光位拖放没有吸附到舞台区域外的观众侧')
  assert(frontPlacement.targetY > multiStage.top + multiStage.height,
    '面光位没有绘制在舞台区域外')
  const sidePlacement = multiPositionLayoutPage.getPalettePlacement(toClientPoint(
    multiStage.left - 42, multiStage.top + (multiStage.height * (2 / 3)),
  ))
  assert.strictEqual(sidePlacement.position.zone, 'side-left',
    '灯具拖到舞台左侧时没有吸附到左侧光位')
  const rightSidePlacement = multiPositionLayoutPage.getPalettePlacement(toClientPoint(
    multiStage.left + multiStage.width + 42, multiStage.top + (multiStage.height * (2 / 3)),
  ))
  assert.strictEqual(rightSidePlacement.position.zone, 'side-right',
    '灯具拖到舞台右侧时没有吸附到右侧光位')
  const topPlacement = multiPositionLayoutPage.getPalettePlacement(toClientPoint(
    multiStage.left + (multiStage.width / 2), multiStage.top + (multiStage.height * 0.25),
  ))
  assert.strictEqual(topPlacement.position.zone, 'top',
    '灯具拖到顶光杆附近时没有吸附到顶光位')
  assert.strictEqual(multiPositionLayoutPage.getPalettePlacement({ clientX: 1, clientY: 1 }), null,
    '缺失有效 x/y 的拖动坐标不应生成 NaN 灯具位置')
  multiPositionLayoutPage.onFrontChange({ detail: { value: 1 } })
  const flippedFrontPlacement = multiPositionLayoutPage.getPalettePlacement(toClientPoint(
    multiStage.left + (multiStage.width / 2), multiStage.top - 42,
  ))
  assert.strictEqual(flippedFrontPlacement.position.zone, 'front',
    '舞台前沿切换到上方后面光位没有跟随观众侧')
  assert(flippedFrontPlacement.targetY < multiStage.top,
    '舞台前沿切换后面光位仍落在舞台内或错误方向')

  multiPositionLayoutPage.onSidePairChange({ detail: { value: '2' } })
  assert.strictEqual(multiPositionLayoutPage._positionDefinitions.filter((item) => item.zone === 'side-left').length, 3,
    '用户无法把完整方案改为 3 对侧光位')
  const positionsBeforeInvalidAllocation = Object.keys(multiPositionLayoutPage._positions).length
  multiPositionLayoutPage.data.barRows.forEach((bar) => {
    multiPositionLayoutPage.onBarCountInput({
      currentTarget: { dataset: { barIndex: bar.barIndex, groupIndex: 0 } },
      detail: { value: '0' },
    })
  })
  assert.strictEqual(multiPositionLayoutPage.data.barConfigurationValid, false,
    '灯位配置没有识别少分配灯具的错误')
  multiPositionLayoutPage.applyBarConfiguration()
  assert.strictEqual(Object.keys(multiPositionLayoutPage._positions).length, positionsBeforeInvalidAllocation,
    '无效灯位配置错误覆盖了现有灯具位置')
  multiPositionLayoutPage.balanceBarConfiguration()
  assert.strictEqual(multiPositionLayoutPage.data.barConfigurationValid, true,
    '均匀分配没有覆盖全部启用灯位并恢复有效配置')
  multiPositionLayoutPage.applyBarConfiguration()

  const sideTargetDefinition = multiPositionLayoutPage._positionDefinitions.find((item) => item.zone === 'side-right')
  const sideTargetY = 1 - ((sideTargetDefinition.positionIndex + 1) / 4)
  multiPositionLayoutPage._dragKey = snapPositionKey
  multiPositionLayoutPage.onCanvasTouchMove({
    touches: [{
      x: ((multiStage.left + multiStage.width + 42) / 700) * 350,
      y: ((multiStage.top + (multiStage.height * (1 - sideTargetY)) + 96) / 900) * 450,
    }],
  })
  multiPositionLayoutPage.onCanvasTouchEnd()
  assert.strictEqual(multiPositionLayoutPage._positions[snapPositionKey].zone, 'side-right',
    '已布置灯具拖到侧光位附近时没有吸附到右侧光位')

  exportedDmxAddressTexts.length = 0
  exportedDmxLayoutTexts.length = 0
  exportedDmxLayoutTextCalls.length = 0
  multiPositionLayoutPage.generateLayoutImage()
  multiPositionLayoutPage._fixtures.forEach((fixture) => {
    assert(exportedDmxAddressTexts.includes(fixture.addressText),
      `完整灯位导图遗漏地址 ${fixture.addressText}`)
  })
  const portraitSideNoteCall = exportedDmxLayoutTextCalls.find((call) => call.text.startsWith('侧光同一位置'))
  const portraitCommonNoteCall = exportedDmxLayoutTextCalls.find((call) => call.text.startsWith('示意图用于位置'))
  assert(exportedDmxLayoutTexts.includes('面光位')
    && exportedDmxLayoutTexts.includes('左1')
    && exportedDmxLayoutTexts.includes('右1')
    && portraitSideNoteCall
    && portraitCommonNoteCall
    && portraitCommonNoteCall.y - portraitSideNoteCall.y >= 20,
  '完整灯位导图缺少面光、侧光位置或侧光展开说明')
  multiPositionLayoutPage.closePreview()
  multiPositionLayoutPage.saveLayout()
  multiPositionLayoutPage.onUnload()
  const reopenedMultiPositionLayoutPage = loadPage('pages/dmx-layout/dmx-layout.js')
  reopenedMultiPositionLayoutPage.onLoad()
  assert.strictEqual(reopenedMultiPositionLayoutPage.data.schemeIndex, 2,
    '完整灯位方案保存后重新打开丢失')
  assert.strictEqual(reopenedMultiPositionLayoutPage.data.sidePairIndex, 2,
    '用户选择的侧光对数保存后重新打开丢失')
  assert.strictEqual(new Set(Object.keys(reopenedMultiPositionLayoutPage._positions)).size, 10,
    '完整灯位方案重新打开后丢失地址或生成重复灯具键')

  const landscapeJson = JSON.parse(fs.readFileSync(
    path.join(root, 'pages/dmx-layout-landscape/dmx-layout-landscape.json'), 'utf8',
  ))
  assert.strictEqual(landscapeJson.pageOrientation, 'landscape',
    '横屏灯具布置页没有固定 landscape 方向')
  const landscapeWxss = fs.readFileSync(
    path.join(root, 'pages/dmx-layout-landscape/dmx-layout-landscape.wxss'), 'utf8',
  )
  assert(/\.landscape-tools\s*\{[^}]*width:\s*210px;?[^}]*flex:\s*0 0 210px;?/s.test(landscapeWxss)
    && /\.landscape-stage\s*\{[^}]*flex:\s*1;?/s.test(landscapeWxss),
  '横屏核心布局没有保持紧凑固定工具栏与自适应主画布')
  assert(/\.tool-action[^}]*min-height:\s*44px;?/s.test(landscapeWxss)
    && !/\.landscape-(?:page|workspace|tools|stage)\s*\{[^}]*\brpx\b/s.test(landscapeWxss),
  '横屏核心尺寸退回 rpx，可能在真机被整体放大')
  assert(/\.landscape-page \.result-report-preview-overlay\s*\{[^}]*align-items:\s*center;?[^}]*justify-content:\s*center;?/s.test(landscapeWxss)
    && /\.landscape-preview-sheet\s*\{[^}]*height:\s*calc\(100vh - 16px - env\(safe-area-inset-top\) - env\(safe-area-inset-bottom\)\);?/s.test(landscapeWxss)
    && /\.landscape-preview-media\s*\{[^}]*height:\s*100%;?[^}]*min-width:\s*0;?[^}]*min-height:\s*0;?[^}]*flex:\s*1;?/s.test(landscapeWxss)
    && /\.landscape-preview-controls\s*\{[^}]*width:\s*140px;?[^}]*min-width:\s*140px;?[^}]*height:\s*100%;?/s.test(landscapeWxss)
    && /\.result-report-preview-image\s*\{[^}]*object-fit:\s*contain;?/s.test(landscapeWxss),
  '横屏预览没有适配安全区并保持完整等比图片')
  const landscapeWxml = fs.readFileSync(
    path.join(root, 'pages/dmx-layout-landscape/dmx-layout-landscape.wxml'), 'utf8',
  )
  assert(landscapeWxml.includes('class="result-report-preview-image" src="{{layoutImagePath}}" mode="aspectFit"'),
    '横屏预览图片没有使用等比完整显示模式')
  assert(!landscapeWxml.includes('class="stage-heading"')
    && !landscapeWxml.includes('class="stage-footnote"'),
  '横屏主画布外仍保留重复标题或说明')
  const landscapeLayoutPage = loadPage('pages/dmx-layout-landscape/dmx-layout-landscape.js')
  assertWxmlHandlers(landscapeLayoutPage, 'pages/dmx-layout-landscape/dmx-layout-landscape.wxml')
  assert.strictEqual(typeof landscapeLayoutPage.drawLayout, 'function',
    '横屏灯具布置页没有复用完整页面控制器')
  landscapeLayoutPage.onLoad()
  landscapeLayoutPage.onReady()
  assert.strictEqual(landscapeLayoutPage.data.layoutMode, 'landscape')
  assert.deepStrictEqual(
    [landscapeLayoutPage.data.canvasWidth, landscapeLayoutPage.data.canvasHeight],
    [1200, 720],
    '横屏灯具布置页没有使用横向逻辑画布',
  )
  assert.strictEqual(typeof landscapeLayoutPage.findFixture, 'function',
    '横屏位置图没有复用稳定灯具命中逻辑')
  const landscapeStage = landscapeLayoutPage.getDisplayStageRect()
  assert(landscapeStage.width >= 450 && landscapeStage.height >= 300,
    '横屏灯具布置页舞台没有占据足够的画布面积')
  landscapeLayoutPage._canvasRect = { left: 100, top: 40, width: 600, height: 360 }
  const landscapeClientPoint = (x, y) => ({
    x: 100 + ((x / 1200) * 600),
    y: 40 + ((y / 720) * 360),
  })
  const landscapeFront = landscapeLayoutPage.getPalettePlacement(landscapeClientPoint(
    landscapeStage.left + (landscapeStage.width / 2),
    landscapeLayoutPage.data.frontIndex === 0
      ? landscapeStage.top + landscapeStage.height + 42
      : landscapeStage.top - 42,
  ))
  const landscapeLeft = landscapeLayoutPage.getPalettePlacement(landscapeClientPoint(
    landscapeStage.left - 42, landscapeStage.top + (landscapeStage.height * .66),
  ))
  const landscapeRight = landscapeLayoutPage.getPalettePlacement(landscapeClientPoint(
    landscapeStage.left + landscapeStage.width + 42, landscapeStage.top + (landscapeStage.height * .66),
  ))
  const landscapeTop = landscapeLayoutPage.getPalettePlacement(landscapeClientPoint(
    landscapeStage.left + (landscapeStage.width / 2), landscapeStage.top + (landscapeStage.height * .25),
  ))
  assert.deepStrictEqual(
    [landscapeFront.position.zone, landscapeLeft.position.zone, landscapeRight.position.zone, landscapeTop.position.zone],
    ['front', 'side-left', 'side-right', 'top'],
    '横屏触摸坐标没有正确吸附到四类灯位',
  )
  let landscapeResizeMeasured = false
  let landscapeResizeDrawn = false
  const originalLandscapeMeasure = landscapeLayoutPage.measureCanvas
  const originalLandscapeDraw = landscapeLayoutPage.drawLayout
  landscapeLayoutPage.measureCanvas = (callback) => { landscapeResizeMeasured = true; callback() }
  landscapeLayoutPage.drawLayout = () => { landscapeResizeDrawn = true }
  landscapeLayoutPage.onResize({ size: { windowWidth: 844, windowHeight: 390 } })
  assert(landscapeResizeMeasured && landscapeResizeDrawn,
    '横屏尺寸变化后没有重新测量并绘制 Canvas')
  landscapeLayoutPage.measureCanvas = originalLandscapeMeasure
  landscapeLayoutPage.drawLayout = originalLandscapeDraw
  {
    const originalQuery = wx.createSelectorQuery
    const originalTimeout = global.setTimeout
    const originalClearTimeout = global.clearTimeout
    const queries = [], timers = []
    wx.createSelectorQuery = () => {
      const query = { select() { return this }, boundingClientRect(callback) { this.callback = callback; return this }, exec() { queries.push(this.callback) } }
      return query
    }
    global.setTimeout = (callback) => { const timer = { callback, cleared: false }; timers.push(timer); return timer }
    global.clearTimeout = (timer) => { if (timer) timer.cleared = true }
    try {
      let redraws = 0
      landscapeLayoutPage._canvasRect = null
      landscapeLayoutPage.measureCanvas(() => { redraws += 1 })
      queries[0]({ left: 0, top: 0, width: 230, height: 150 })
      assert.strictEqual(redraws, 1, '首次有效横屏尺寸没有提交')
      timers[0].callback()
      queries[1]({ left: 0, top: 0, width: 740, height: 340 })
      assert.strictEqual(redraws, 2, '延后取得稳定横屏尺寸后没有触发重绘')
      assert.strictEqual(landscapeLayoutPage._canvasScaleX, 740 / 1200, '窄 rect→宽 rect 后横屏绘制比例未更新')
      timers[1].callback()
      queries[2]({ left: 0, top: 0, width: 740, height: 340 })
      timers[2].callback()
      queries[3]({ left: 0, top: 0, width: 740, height: 340 })
      assert.strictEqual(redraws, 2, '稳定横屏尺寸的后续复测导致无效重绘')
      const hiddenQuery = queries.length
      landscapeLayoutPage.measureCanvas(() => { redraws += 10 })
      const stale = queries[hiddenQuery]
      landscapeLayoutPage.onHide()
      stale({ left: 0, top: 0, width: 350, height: 180 })
      assert.strictEqual(redraws, 2, '页面隐藏后迟到的测量结果仍提交')
      landscapeLayoutPage.onResize({ size: { windowWidth: 844, windowHeight: 390 } })
      const showDraw = landscapeLayoutPage.drawLayout
      landscapeLayoutPage.drawLayout = () => { redraws += 1 }
      landscapeLayoutPage.onShow()
      queries[queries.length - 1]({ left: 0, top: 0, width: 740, height: 340 })
      landscapeLayoutPage.drawLayout = showDraw
      assert.strictEqual(redraws, 3, '隐藏期间发生 resize 后 show 没有重新测量并绘制')
      assert.strictEqual(landscapeLayoutPage._canvasRect.width, 740, '横屏重新显示后没有缓存稳定宽度')
      const canvasCalls = [], originalCreateCanvasContext = wx.createCanvasContext
      wx.createCanvasContext = () => new Proxy({}, { get: (_, name) => (...args) => {
        canvasCalls.push([name, ...args])
        if (name === 'draw' && typeof args[1] === 'function') args[1]()
      } })
      try {
        landscapeLayoutPage.drawLayout()
      } finally {
        wx.createCanvasContext = originalCreateCanvasContext
      }
      assert(canvasCalls.some(([name, x, y]) => name === 'scale'
        && Math.abs(x - (740 / 1200)) < .001 && Math.abs(y - (340 / 720)) < .001),
      '窄宽复测后实际绘制仍使用旧 Canvas 比例')
      assert(canvasCalls.some(([name, x, y, width, height]) => name === 'fillRect'
        && x === 0 && y === 0 && width === 1200 && height === 720),
      '横屏恢复绘制的底色未覆盖终态逻辑画布')
      assert.deepStrictEqual(landscapeLayoutPage.touchPoint({ touches: [{ clientX: 370, clientY: 170 }] }),
        { x: 600, y: 360 }, '横屏终态尺寸下触点没有映射到正确逻辑坐标')
      const earlierQuery = queries.length
      landscapeLayoutPage.measureCanvas(() => { redraws += 100 })
      const earlier = queries[earlierQuery]
      const laterQuery = queries.length
      landscapeLayoutPage.measureCanvas(() => { redraws += 1 })
      const later = queries[laterQuery]
      later({ left: 0, top: 0, width: 740, height: 340 })
      earlier({ left: 0, top: 0, width: 350, height: 180 })
      assert.strictEqual(redraws, 4, '乱序回调覆盖了更新的横屏测量结果')
      assert.strictEqual(landscapeLayoutPage._canvasRect.width, 740, '乱序回调污染了缓存 rect')
    } finally {
      wx.createSelectorQuery = originalQuery
      global.setTimeout = originalTimeout
      global.clearTimeout = originalClearTimeout
    }
  }
  exportedDmxAddressTexts.length = 0
  exportedDmxLayoutTextCalls.length = 0
  const landscapeViewBeforeExport = { s: 2, x: 48, y: -24 }
  landscapeLayoutPage._view = { ...landscapeViewBeforeExport }
  const originalLandscapeLegend = landscapeLayoutPage.data.groupLegend
  landscapeLayoutPage.setData({
    groupLegend: Array.from({ length: 8 }, (_, index) => ({
      name: `回归灯具组${index + 1}`,
      count: 1,
      color: '#5856d6',
    })),
  })
  landscapeLayoutPage._theme = 'dark'
  dmxLayoutFillStyles.length = 0
  dmxLayoutStrokeStyles.length = 0
  landscapeLayoutPage.generateLayoutImage()
  assert.deepStrictEqual(
    [exportedDmxLayout.width, exportedDmxLayout.height, exportedDmxLayout.destWidth, exportedDmxLayout.destHeight],
    [1200, 720, 2400, 1440],
    '横屏灯具位置图没有按完整横向画布导出',
  )
  landscapeLayoutPage._fixtures.forEach((fixture) => {
    assert(exportedDmxAddressTexts.includes(fixture.addressText),
      `横屏导图遗漏地址 ${fixture.addressText}`)
  })
  assert(dmxLayoutFillStyles.includes('#000000') && dmxLayoutFillStyles.includes('#1c1c1e')
    && exportedDmxAddressTexts.length > 0,
  '深色横屏导图没有实际绘制深色背景、舞台或地址')
  const legendCalls = exportedDmxLayoutTextCalls.filter((call) => call.text.startsWith('回归灯具组'))
  const sideNoteCall = exportedDmxLayoutTextCalls.find((call) => call.text.startsWith('侧光同一位置'))
  const commonNoteCall = exportedDmxLayoutTextCalls.find((call) => call.text.startsWith('示意图用于位置'))
  const landscapeTitleCall = exportedDmxLayoutTextCalls.find((call) => call.text === '灯具位置图')
  const landscapeSummaryCall = exportedDmxLayoutTextCalls.find((call) => call.text.includes('宽 12 m ×'))
  assert.strictEqual(legendCalls.length, 8, '横屏导图没有完整绘制八个灯具组图例')
  assert(!sideNoteCall && !commonNoteCall,
    '横屏导图仍绘制底部长句说明，挤占舞台与图例空间')
  assert(!landscapeTitleCall && landscapeSummaryCall
    && landscapeSummaryCall.text.includes('宽 12 m')
    && landscapeSummaryCall.text.includes('纵深 8 m')
    && landscapeSummaryCall.text.includes('001')
    && exportedDmxLayoutTexts.includes('舞台前沿'),
  '横屏导图没有精简标题摘要，或遗漏舞台必要方向尺寸标签')
  landscapeLayoutPage.setData({ groupLegend: originalLandscapeLegend })
  landscapeLayoutPage.closePreview()
  assert.deepStrictEqual(landscapeLayoutPage._view, landscapeViewBeforeExport,
    '关闭横屏预览后主画布缩放或平移状态被改变')
  assert.strictEqual(landscapeLayoutPage.data.previewVisible, false,
    '关闭横屏预览后仍残留预览层')
  assert.strictEqual(landscapeLayoutPage.data.exportCanvasActive, false,
    '关闭横屏预览后导出 Canvas 状态未恢复')
  const layoutModelForExport = require('../pages/dmx-layout/layout-model')
  const denseExportPlan = calculateDmxAddressPlan({ startAddress: 1, groups: [
    { name: '密集导出一', channelCount: 1, fixtureCount: 200 },
    { name: '密集导出二', channelCount: 1, fixtureCount: 200 },
    { name: '密集导出三', channelCount: 1, fixtureCount: 100 },
  ] })
  assert(!denseExportPlan.error, '密集导出测试灯具方案无效')
  const oldDenseExportState = {
    fixtures: landscapeLayoutPage._fixtures,
    positions: landscapeLayoutPage._positions,
    definitions: landscapeLayoutPage._positionDefinitions,
    data: { ...landscapeLayoutPage.data },
  }
  landscapeLayoutPage._fixtures = denseExportPlan.fixtures
  landscapeLayoutPage._positions = Object.create(null)
  denseExportPlan.fixtures.forEach((fixture, index) => {
    landscapeLayoutPage._positions[layoutModelForExport.posKey(fixture)] = {
      zone: 'top', positionIndex: 0, x: .4 + ((index % 10) * .0001), y: .5,
    }
  })
  landscapeLayoutPage._positionDefinitions = layoutModelForExport.posDefs(6, 'top', 1)
  landscapeLayoutPage.setData({
    rowIndex: 5,
    schemeIndex: 0,
    groupLegend: [{ name: '密集导出', count: 500, color: '#5856d6' }],
  })
  exportedDmxAddressTexts.length = 0
  exportedDmxLayoutTextCalls.length = 0
  landscapeLayoutPage.generateLayoutImage()
  assert(exportedDmxLayout.height > 720 && exportedDmxLayout.destWidth <= 2400 && exportedDmxLayout.destHeight <= 4096,
    `密集同杆导出未独立扩高或未限制导出像素尺寸：${JSON.stringify([exportedDmxLayout.width, exportedDmxLayout.height, exportedDmxLayout.destWidth, exportedDmxLayout.destHeight])}`)
  assert.strictEqual(new Set(exportedDmxAddressTexts).size, 500,
    '密集同杆导出没有逐一清晰输出全部 500 个唯一地址')
  assert(exportedDmxLayoutTexts.some((text) => text.startsWith('标签辨址，刻度示真实位置（顶光/面光左→右，侧光上→下）。')),
    '密集杆导出缺少地址展开带用途说明')
  landscapeLayoutPage._fixtures = oldDenseExportState.fixtures
  landscapeLayoutPage._positions = oldDenseExportState.positions
  landscapeLayoutPage._positionDefinitions = oldDenseExportState.definitions
  landscapeLayoutPage.setData({
    rowIndex: oldDenseExportState.data.rowIndex,
    schemeIndex: oldDenseExportState.data.schemeIndex,
    groupLegend: oldDenseExportState.data.groupLegend,
    exportCanvasHeight: oldDenseExportState.data.exportCanvasHeight,
  })
  const landscapeRoundTripKey = Object.keys(landscapeLayoutPage._positions)
    .find((key) => landscapeLayoutPage._positions[key].zone === 'top')
  assert(landscapeRoundTripKey, '横屏往返测试缺少可调整横向位置的顶光灯具')
  landscapeLayoutPage._positions[landscapeRoundTripKey].x = 0.43
  landscapeLayoutPage.saveLayout()
  landscapeLayoutPage.onUnload()
  reopenedMultiPositionLayoutPage._awaitingLandscapeReturn = true
  reopenedMultiPositionLayoutPage.onShow()
  assert.strictEqual(reopenedMultiPositionLayoutPage._positions[landscapeRoundTripKey].x, 0.43,
    '横屏编辑返回竖屏后没有从同一存储安全刷新位置')
  reopenedMultiPositionLayoutPage.onUnload()
  storage.delete('audioTool.dmxLayout.v1')
  storage.set('audioTool.dmxAddress.preferences', dmxLayoutPreferences)
  delete wx.createCanvasContext
  delete wx.canvasToTempFilePath
  delete wx.showLoading
  delete wx.hideLoading

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
  assert(cameraWxml.includes('class="camera-preview-tabs"')
    && cameraWxml.includes('bindtap="onPreviewViewTap"'), '俯视/侧视示意图切换入口不完整')
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
    && cameraCanvasTag[0].includes('{{result.primaryDistanceMeters}}')
    && cameraCanvasTag[0].includes('{{result.heightDisplayLabel}}')
    && cameraCanvasTag[0].includes('{{result.cameraHeightMeters}}'),
  '摄像机全屏主图的无障碍名称应绑定当前真实距离和镜头高度')
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
  assert.strictEqual(cameraPage.data.previewViewIndex, 0, '摄像机示意图初始视角不是俯视')
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
  cameraPage.onPreviewViewTap({ currentTarget: { dataset: { index: 1 } } })
  assert.strictEqual(cameraPage.data.previewViewIndex, 1, '摄像机示意图无法切换到侧视')
  assert(cameraCanvasDrawCount > initialCameraCanvasDrawCount, '切换侧视后没有重绘摄像机示意图')
  assert.strictEqual(cameraCanvasQueryCount, 1, '切换示意图视角时重复查询 Canvas 节点')
  cameraPage.onPreviewViewTap({ currentTarget: { dataset: { index: 0 } } })
  assert.strictEqual(cameraPage.data.previewViewIndex, 0, '摄像机示意图无法切回俯视')
  assert.strictEqual(cameraCanvasQueryCount, 1, '切回俯视时重复查询 Canvas 节点')
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
  assert.strictEqual(cameraPage.data.result.cameraSetbackMeters, 4.83)
  assert.strictEqual(cameraPage.data.result.cameraHeightMeters, 2.3)
  assert.strictEqual(cameraPage.data.result.distanceMeaning, '当前模型下理论最小距离')
  assert.strictEqual(cameraPage.data.result.calculationRows.length, 4)
  assert.strictEqual(cameraPage.data.result.calculationRows[1].value, '4.63 m')
  assert.strictEqual(cameraPage.data.result.calculationRows[3].value, '4.83 m')
  assert.strictEqual(cameraPage.data.result.calculationVisual.horizontalBarPercent, 100)
  assert.strictEqual(cameraPage.data.result.calculationVisual.verticalBarPercent, 100)
  assert.strictEqual(cameraPage.data.result.calculationVisual.limitingAxisLabel, '水平下限处垂直校核通过')
  assert.strictEqual(cameraPage.data.result.calculationVisual.hasDepthMargin, true)
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
  assert(groundCameraText.includes('摄像机距区域前沿：4.83 m'))
  assert(groundCameraText.includes('当前模型双轴校核通过的理论最小距离'))
  assert(groundCameraText.includes('安装点位统一按广角端计算'))
  assert(groundCameraText.includes('计算过程：'))
  assert(groundCameraText.includes('Dₕ = 有效宽度'))
  assert(groundCameraText.includes('垂直包络角'))
  assert(!groundCameraText.includes('max(Dₕ, Dᵥ)'), 'camera result should describe the constrained vertical check rather than independent max distance')
  const groundCameraPayload = cameraPage.getRecordPayload()
  let cameraReportExportCount = 0
  let exportedCameraReport = null
  const cameraReportContext = new Proxy({}, {
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
  const cameraComparison = buildRecordComparison([
    { ...groundCameraPayload, id: 'camera-ground' },
    { ...cameraPage.getRecordPayload(), id: 'camera-plane' },
  ])
  assert(cameraComparison.rows.some((row) => row.label === '拍摄场景'))
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

  const activeProject = recordsApi.createProject('Release active project')
  const project = recordsApi.createProject('Release selected project')
  assert(activeProject && project)
  assert.strictEqual(recordsApi.setActiveProject(activeProject.id).id, activeProject.id)
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
  assert(splPage.data.projectItems.some((item) => item.id === activeProject.id))
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
  assert.strictEqual(recordsApi.getProjectRecords(activeProject.id).length, 0,
    'the result must be saved to the selected project rather than the active project')
  assert.strictEqual(recordsApi.getActiveProject().id, activeProject.id,
    'saving to a selected project must not switch the active project')
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
  const limiterPayload = limiterPage.getRecordPayload()
  recordsApi.addRecordToProject(limiterPayload, project.id)
  assert.strictEqual(recordsApi.getProjectRecords(project.id).length, 2)
  const workspaceSnapshot = recordsApi.getWorkspaceSnapshot()
  assert.strictEqual(workspaceSnapshot.projects.length, 2)
  assert.strictEqual(workspaceSnapshot.activeProject.id, activeProject.id)
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
  const recordComparison = buildRecordComparison([
    { ...limiterPayload, id: 'comparison-1' },
    { ...limiterPayload, id: 'comparison-2', preferences: { ...limiterPayload.preferences, count: 2 } },
  ])
  assert(recordComparison.rows.some((row) => row.label === '每通道数量'))

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
  assert(storedRecords.every((record) => record.favorite || record.projectIds.length))
  assert(storedRecords.some((record) => record.favorite && record.projectIds.includes(project.id)))

  const appConfig = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'))
  assert.deepStrictEqual(
    appConfig.tabBar.list.map((item) => item.pagePath),
    ['pages/index/index', 'pages/tools/tools', 'pages/projects/projects'],
  )
  const tabThemeConfig = JSON.parse(fs.readFileSync(path.join(root, 'theme.json'), 'utf8'))
  appConfig.tabBar.list.forEach((item) => {
    const resolveThemePath = (value) => tabThemeConfig.light[value.slice(1)]
    assert(fs.existsSync(path.join(root, resolveThemePath(item.iconPath))), `${item.text}页签缺少默认图标`)
    assert(fs.existsSync(path.join(root, resolveThemePath(item.selectedIconPath))), `${item.text}页签缺少选中图标`)
  })

  const indexSource = fs.readFileSync(path.join(root, 'pages/index/index.js'), 'utf8')
  assert(!indexSource.includes("require('../../data/equipment')"), '探索页仍在加载完整功放和音箱库')
  assert(!indexSource.includes("require('../../data/cameras')"), '探索页仍在加载完整摄像机库')
  const indexPage = loadPage('pages/index/index.js')
  assertWxmlHandlers(indexPage, 'pages/index/index.wxml')
  assert.strictEqual(indexPage.data.knowledgeItems.length, 8)
  assert(!Object.prototype.hasOwnProperty.call(indexPage.data, 'videoItems'),
    '探索页仍保留停用的视频占位数据')
  const homeItems = indexPage.data.knowledgeItems
  assert.strictEqual(new Set(homeItems.map((item) => item.id)).size, 8, '首页知识文章重复或缺失')
  assert.deepStrictEqual(
    homeItems.map((item) => item.id).sort(),
    knowledgeItems.map((item) => item.id).sort(),
    '首页文章未完整对应知识库',
  )
  homeItems.forEach((item) => {
    assert.deepStrictEqual(Object.keys(item).sort(), ['animationActive', 'category', 'categoryKey', 'headline', 'id', 'path', 'title'])
    assert(['音频', '视频', '灯光'].includes(item.category))
    assert.strictEqual(item.categoryKey, { 音频: 'audio', 视频: 'video', 灯光: 'lighting' }[item.category])
    assert(item.headline)
    assert(item.title && item.path && item.path.includes('/pages/knowledge/detail?id='))
    assert.strictEqual(findKnowledgeById(item.path.split('id=')[1]), knowledgeItems.find((article) => article.id === item.id))
  })
  const indexWxml = fs.readFileSync(path.join(root, 'pages/index/index.wxml'), 'utf8')
  assert(indexWxml.includes('class="knowledge-strip" scroll-x'))
  assert(indexWxml.includes('class="knowledge-track"'))
  assert(indexWxml.includes('class="knowledge-card knowledge-card-{{item.categoryKey}}') && indexWxml.includes('card-active'))
  assert(!indexWxml.includes('knowledge-kind') && !indexWxml.includes('{{item.category}}知识')
    && indexWxml.includes('{{item.headline}}') && indexWxml.includes('阅读文章'))
  assert(!indexWxml.includes('explore-subtitle') && !indexWxml.includes('现场知识'), '探索页标题下不应保留冗余说明')
  assert(!indexWxml.includes('knowledge-featured') && !indexWxml.includes('knowledge-list') && !indexWxml.includes('knowledge-row'))
  assert(!indexWxml.includes('<swiper'))
  assert(!indexWxml.includes('knowledge-summary'))
  assert(!indexWxml.includes('readTime') && !indexWxml.includes('秒') && !indexWxml.includes('分钟'))
  assert(!indexWxml.includes('videoItems') && !indexWxml.includes('class="video-play"') && !indexWxml.includes('播放'),
    '探索页仍保留停用的视频卡片链')
  assert(indexPage.data.knowledgeItems[0].id === 'led-screen-fit', 'LED 文章未排在首页首位')
  assert(indexSource.includes('observeAll: true') && indexSource.includes('animationActive'))
  assert(indexSource.includes('onHide') && indexSource.includes('onUnload') && indexSource.includes('this._ready'))
  assert(indexSource.includes('knowledgeObserverToken') && indexSource.includes('this.knowledgeObserver !== observer'))
  ;['scene-led', 'scene-limiter', 'scene-distance', 'scene-cable', 'scene-fill', 'scene-gain', 'scene-camera', 'scene-dmx']
    .forEach((name) => assert(indexWxml.includes(name), `探索页缺少主题图解：${name}`))
  const indexWxss = fs.readFileSync(path.join(root, 'pages/index/index.wxss'), 'utf8')
  const indexDarkCss = indexWxss.slice(indexWxss.indexOf('@media (prefers-color-scheme: dark)'))
  const indexWxssCompact = indexWxss.replace(/\s+/g, '')
  const indexDarkCssCompact = indexDarkCss.replace(/\s+/g, '')
  assert(indexDarkCss.includes('var(--theme-page-bg)') && /\.knowledge-visual\{[^}]*color:var\(--theme-text-secondary\)/.test(indexWxssCompact) && indexDarkCssCompact.includes('.knowledge-open{background:rgba(10,132,255,.22);color:#b8dcff}'), '探索页深色规则或对比度不足')
  const storyAnimationNames = [...indexWxss.matchAll(/--story\s*:\s*([^;}]+)/g)]
    .flatMap((match) => match[1].split(',').map((name) => name.trim()).filter(Boolean))
  const storyKeyframes = new Set([...indexWxss.matchAll(/@keyframes\s+([\w-]+)/g)].map((match) => match[1]))
  assert(new Set(storyAnimationNames).size >= 8, '探索页至少需要八个场景动画绑定')
  ;[...new Set(storyAnimationNames)].forEach((name) => assert(storyKeyframes.has(name), `探索页动画绑定缺少对应 keyframes：${name}`))
  assert(indexWxss.includes('prefers-reduced-motion') && indexWxss.includes('.card-active .knowledge-visual .motion') && !indexWxss.includes('.knowledge-card *'),
    '探索页 reduced-motion 规则必须使用明确动画目标，禁止通配后代选择器')
  assert(indexWxssCompact.includes('.knowledge-card{') && indexWxss.includes('border:1rpx solid') &&
    indexWxss.includes('.knowledge-card-audio .knowledge-visual') &&
    indexWxss.includes('.knowledge-card-video .knowledge-visual') &&
    indexWxss.includes('.knowledge-card-lighting .knowledge-visual'),
  '探索卡片必须保留边界与分类视觉区层次')
  {
    function loadExploreAnimationPage(mode) {
      const page = loadPage('pages/index/index.js')
      const observers = []
      const patches = []
      const applyData = page.setData.bind(page)
      page.setData = (patch, callback) => {
        patches.push(patch)
        applyData(patch, callback)
      }
      if (mode !== 'missing') page.createIntersectionObserver = (options) => {
        const observer = {
          options, disconnected: 0, references: [],
          relativeTo(selector) { this.references.push(selector); return this },
          relativeToViewport() { this.references.push('viewport'); return this },
          observe(selector, callback) {
            this.callback = callback
            this.selector = selector
            if (mode === 'throw') throw new Error('observation unavailable')
          },
          disconnect() { this.disconnected++ },
        }
        observers.push(observer)
        return observer
      }
      return { page, observers, patches }
    }
    const event = (index, intersectionRatio) => ({ dataset: { index }, intersectionRatio })
    const { page, observers, patches } = loadExploreAnimationPage()
    page.onShow()
    assert.strictEqual(observers.length, 0, '探索页必须等待 ready 后观察卡片')
    page.onReady()
    page.onShow()
    assert.strictEqual(observers.length, 1, '重复 show 不应叠加 observer')
    const first = observers[0]
    assert.strictEqual(first.options.observeAll, true)
    assert.deepStrictEqual(first.references, ['.knowledge-strip', 'viewport'])
    first.callback(event('0', 1))
    assert.strictEqual(page.data.knowledgeItems[0].animationActive, true)
    let submissions = patches.length
    first.callback(event('0', 1))
    assert.strictEqual(patches.length, submissions, '相同可见性不应重复 setData')
    for (const index of ['oops', -1, 8, 1000, null, undefined, '', '0.5']) first.callback(event(index, 0))
    assert.strictEqual(patches.length, submissions, '无效卡片索引不应更新视图')
    first.callback(event('0', 0))
    assert.strictEqual(page.data.knowledgeItems[0].animationActive, false)
    first.callback(event(1, 1))
    page.onHide()
    assert(page.data.knowledgeItems.every((item) => !item.animationActive))
    assert.strictEqual(first.disconnected, 1)
    submissions = patches.length
    first.callback(event(0, 1))
    assert.strictEqual(patches.length, submissions, 'hide 后过期回调必须失效')
    page.onShow()
    assert.strictEqual(observers.length, 2)
    first.callback(event(0, 1))
    assert.strictEqual(patches.length, submissions, '返回页面后旧 observer 回调必须失效')
    observers[1].callback(event(2, 1))
    assert.strictEqual(page.data.knowledgeItems[2].animationActive, true)
    page.onShow()
    assert.strictEqual(observers.length, 2)
    page.onUnload()
    assert.strictEqual(observers[1].disconnected, 1)
    submissions = patches.length
    observers[1].callback(event(3, 1))
    assert.strictEqual(patches.length, submissions, 'unload 后不得更新视图')
    for (const mode of ['missing', 'throw']) {
      const fallback = loadExploreAnimationPage(mode)
      fallback.page.onShow()
      fallback.page.onReady()
      assert(fallback.page.data.knowledgeItems.every((item) => !item.animationActive))
      if (mode === 'throw') {
        assert.strictEqual(fallback.observers[0].disconnected, 1)
        const before = fallback.patches.length
        fallback.observers[0].callback(event(0, 1))
        assert.strictEqual(fallback.patches.length, before, '异常 observer 的回调必须失效')
      }
      fallback.page.onHide()
      fallback.page.onUnload()
    }
  }

  const toolsSource = fs.readFileSync(path.join(root, 'pages/tools/tools.js'), 'utf8')
  assert(!toolsSource.includes("require('../../data/equipment')"), '工具页仍在加载完整功放和音箱库')
  assert(!toolsSource.includes("require('../../data/cameras')"), '工具页仍在加载完整摄像机库')
  const toolsPage = loadPage('pages/tools/tools.js')
  const toolsWxss = fs.readFileSync(path.join(root, 'pages/tools/tools.wxss'), 'utf8')
  const toolsDarkCss = toolsWxss.slice(toolsWxss.indexOf('@media (prefers-color-scheme: dark)'))
  const toolsWxssCompact = toolsWxss.replace(/\s+/g, '')
  assert(toolsDarkCss.includes('var(--theme-surface)'), '工具页未接入主题变量或深色规则')
  assert(toolsWxssCompact.includes('.footer-action') && toolsWxssCompact.includes('color:var(--theme-accent-text)') &&
    toolsWxssCompact.includes('.tools-footer') && toolsWxssCompact.includes('color:var(--theme-text-secondary)') &&
    toolsWxssCompact.includes('.product-library-arrow{margin-left:20rpx;color:var(--theme-text-tertiary)') &&
     toolsWxssCompact.includes('.footer-action-muted{color:var(--theme-text-secondary)'),
  '工具页底部操作与辅助文字未使用语义主题色')
  const toolsWxml = fs.readFileSync(path.join(root, 'pages/tools/tools.wxml'), 'utf8')
  assert(toolsWxml.includes('class="module-visual"'), '工具页入口缺少真实图片容器类')
  assertThemeCascade(toolsWxss, '.module-visual', 'background:var(--theme-surface)',
    '工具页 dark 图片容器仍使用浅色背景')
  const toolImageNames = [
    'module-gain-structure-catalog.png', 'module-limiter-catalog.png', 'module-spl-catalog.png',
    'module-cable-catalog.png', 'module-camera-catalog.png',
    'module-led-screen-catalog.png', 'module-dmx-address-catalog.png',
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
    assert(fs.existsSync(file) && toolsSource.includes(`/assets/home/${name}`), `工具入口缺少 PNG 引用或文件：${name}`)
    const bytes = parsePngHeader(file)
    assert(bytes <= 20 * 1024, `工具透明 PNG 超过 20 KiB：${name}`)
    return total + bytes
  }, 0)
  assert(toolImageBytes <= 112 * 1024, `工具透明 PNG 超过 112 KiB：${formatKiB(toolImageBytes)}`)
  const audioWiringCatalogImage = 'module-audio-wiring-catalog.png'
  const audioWiringCatalogPath = path.join(root, 'assets', 'home', audioWiringCatalogImage)
  assert(fs.existsSync(audioWiringCatalogPath) && toolsSource.includes(`/assets/home/${audioWiringCatalogImage}`),
    '接线助手工具卡缺少透明 PNG 引用或文件')
  const audioWiringCatalogBytes = parsePngHeader(audioWiringCatalogPath)
  assert(audioWiringCatalogBytes <= 20 * 1024,
    '接线助手工具卡透明 PNG 超过 20 KiB')
  assert(toolImageBytes + audioWiringCatalogBytes <= 121 * 1024,
    `八张工具透明 PNG 超过 121 KiB：${formatKiB(toolImageBytes + audioWiringCatalogBytes)}`)
  const projectWiringCatalogImage = 'module-project-wiring-catalog.png'
  const projectWiringCatalogPath = path.join(root, 'assets', 'home', projectWiringCatalogImage)
  assert(fs.existsSync(projectWiringCatalogPath) && toolsSource.includes(`/assets/home/${projectWiringCatalogImage}`),
    '通道与线缆工具卡缺少专属 PNG 引用或文件')
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
  assert(!toolsWxml.includes('page-subtitle') && !toolsWxml.includes('现场常用计算与产品资料'), '工具页标题下不应保留冗余说明')
  assertWxmlHandlers(toolsPage, 'pages/tools/tools.wxml')
  assert.deepStrictEqual(
    toolsPage.data.wiringModules.map((item) => item.id),
    ['audioWiring', 'projectWiring', 'cable'],
  )
  assert.deepStrictEqual(
    toolsPage.data.audioModules.map((item) => item.id),
    ['gainStructure', 'limiter', 'spl'],
  )
  assert.deepStrictEqual(toolsPage.data.videoModules.map((item) => item.id), ['camera', 'ledScreen'])
  assert.deepStrictEqual(toolsPage.data.lightingModules.map((item) => item.id), ['dmxAddress'])
  assert.strictEqual(
    toolsPage.data.wiringModules.length + toolsPage.data.audioModules.length + toolsPage.data.videoModules.length + toolsPage.data.lightingModules.length,
    9,
  )
  const toolModules = [...toolsPage.data.wiringModules, ...toolsPage.data.audioModules,
    ...toolsPage.data.videoModules, ...toolsPage.data.lightingModules]
  assert.strictEqual(new Set(toolModules.map((item) => item.id)).size, 9, '工具入口 id 必须唯一')
  assert.strictEqual(new Set(toolModules.map((item) => item.path)).size, 9, '工具入口路径必须唯一')
  assert.deepStrictEqual(Object.fromEntries(toolModules.map(({ id, path }) => [id, path])), {
    audioWiring: '/pages/audio-wiring/index',
    projectWiring: '/pages/project-wiring/index',
    cable: '/pages/cable/cable',
    gainStructure: '/pages/gain-structure/gain-structure',
    limiter: '/pages/limiter/limiter',
    spl: '/pages/spl/spl',
    camera: '/pages/camera/camera',
    ledScreen: '/pages/led-screen/led-screen',
    dmxAddress: '/pages/dmx-address/dmx-address',
  }, '工具入口路径沿用现有路由')
  toolModules
    .forEach((item) => assert(item.domain && item.path && item.image))
  assert.strictEqual(toolsPage.data.wiringModules[0].title, '接线助手')
  assert.strictEqual(toolsPage.data.wiringModules[1].title, '通道与线缆')
  assert.strictEqual(toolsPage.data.wiringModules[1].path, '/pages/project-wiring/index')
  assert.strictEqual(toolsPage.data.wiringModules[1].image,
    `/assets/home/${projectWiringCatalogImage}`, '通道与线缆入口未使用专属图片')
  const wiringModuleVisual = toolsWxml.match(/<navigator wx:for="{{wiringModules}}"[\s\S]*?<view class="module-visual">([\s\S]*?)<\/view>/)
  assert(wiringModuleVisual && wiringModuleVisual[1].trim() ===
    '<image class="module-image" src="{{item.image}}" mode="aspectFit" lazy-load aria-label="{{item.title}}配图" />',
  '通道与线缆入口未使用统一图片绑定')
  assert(!toolsWxml.includes('project-wiring-visual') && !toolsWxssCompact.includes('.project-wiring-visual{')
    && !toolsWxssCompact.includes('.wiring-device{') && !toolsWxssCompact.includes('.wiring-cable{')
    && !toolsWxssCompact.includes('.wiring-list-mark{'), '通道与线缆入口仍保留 CSS 图形分支')
  assert(toolsWxml.includes('wx:for="{{wiringModules}}"'))
  assert(toolsWxml.includes('wx:for="{{audioModules}}"'))
  const domainTitles = [...toolsWxml.matchAll(/<view class="domain-title(?: library-heading)?">([^<]+)<\/view>/g)]
    .map((match) => match[1])
  assert.deepStrictEqual(domainTitles, ['布线', '音频', '视频', '灯光', '中控', '资料'],
    '工具页六个分区顺序不符')
  assert.strictEqual((toolsWxml.match(/class="module-strip"/g) || []).length, 2,
    '工具页布线和音频横向轨道缺失')
  assert.strictEqual((toolsWxml.match(/class="module-track"/g) || []).length, 2,
    '工具页布线和音频横向轨道内容缺失')
  assert.strictEqual((toolsWxml.match(/class="module-row"/g) || []).length, 3,
    '工具页视频、灯光或中控功能横向分区缺失')
  assert(/<view class="domain-title">中控<\/view>[\s\S]*?url="\/pages\/control-protocol\/index"/.test(toolsWxml)
    && toolsWxml.includes('src="/assets/home/module-control-protocol-catalog.png"')
    && toolsWxml.includes('aria-label="控制协议"') && toolsWxml.includes('<view class="module-title">控制协议</view>'),
    '控制协议入口须位于中控域并显示专属图片与名称')
  assert(toolsWxml.includes('url="/pages/products/library"') &&
    !toolsWxml.includes('product-library-card protocol-library-card'),
    '资料域应保留产品资料库独立入口')
  assert(toolsWxssCompact.includes('.module-strip{width:100%;white-space:nowrap}') &&
    toolsWxssCompact.includes('.module-track{display:inline-flex;') &&
    toolsWxssCompact.includes('.module-row{display:flex;gap:16rpx}'),
    '工具页入口未统一使用横向轨道布局 CSS')
  assert.strictEqual((toolsWxml.match(/scroll-x/g) || []).length, 2,
    '工具页布线和音频入口应各有一个横向滚动容器')
  assert(toolsWxml.includes('wx:for="{{videoModules}}"'))
  assert(toolsWxml.includes('wx:for="{{lightingModules}}"'))
  assert(!toolsWxml.includes('product-library-counts'))
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
  const projectsDarkCss = projectsWxss.slice(projectsWxss.indexOf('@media (prefers-color-scheme: dark)'))
  const projectsWxssCompact = projectsWxss.replace(/\s+/g, '')
  assert(projectsDarkCss.replace(/\s+/g, '').includes('var(--theme-surface)') && projectsWxssCompact.includes('.record-action-danger,.project-action-danger{color:var(--theme-danger)') && projectsWxssCompact.includes('.record-trust{background:#193b60') && projectsWxssCompact.includes('.record-project,.active-project-label{color:var(--theme-success)'), '项目页深色规则或状态颜色未恢复')
  assert(projectsWxssCompact.includes('.record-module{color:var(--theme-accent-text)') &&
    projectsWxssCompact.includes('.record-action-primary{background:#e8f2ff;color:var(--theme-accent-text)') &&
    projectsWxssCompact.includes('background:var(--theme-primary-fill)') &&
    projectsWxssCompact.includes('.project-primary-actions{display:flex;gap:10px;') &&
    projectsWxssCompact.includes('.project-primary-actions.project-action{box-sizing:border-box;flex:1;min-width:0;height:88rpx;min-height:44px;') &&
    projectsWxssCompact.includes('border-radius:22rpx;font-size:27rpx;font-weight:600;') &&
    projectsWxssCompact.includes('.project-action-secondary{background:var(--theme-accent-soft);color:var(--theme-accent-text)') &&
    projectsWxssCompact.includes('.record-time,.project-meta{color:var(--theme-text-secondary)'),
  '项目页小字号与主要操作未使用语义主题色')
  assert(projectsDarkCss.replace(/\s+/g, '').includes('.record-action-primary{background:var(--theme-accent-soft);color:var(--theme-accent-text)') &&
    projectsDarkCss.replace(/\s+/g, '').includes('.project-action-secondary{background:var(--theme-accent-soft);color:var(--theme-accent-text)'),
  '项目页深色主要操作文字对比度不足')
  assert(projectsWxssCompact.includes('.records-tab{') && projectsWxssCompact.includes('color:var(--theme-text-secondary)') &&
    projectsWxssCompact.includes('.record-summary{margin-top:6rpx;color:var(--theme-text-secondary)') &&
    projectsWxssCompact.includes('.records-empty-text{margin-top:9rpx;color:var(--theme-text-tertiary)') &&
    /\.project-detail-preview-dot\{[^}]*margin:\s*0\s+8rpx;[^}]*color:\s*var\(--theme-text-tertiary\)/.test(projectsWxss) &&
    projectsWxssCompact.includes('.project-detail-preview-engineer{width:100%;margin-top:3rpx;color:var(--theme-text-tertiary)'),
  '项目页浅色辅助文字未使用语义主题色')
  assert(projectsWxssCompact.includes('.record-project{margin-top:12rpx;color:var(--theme-success)') &&
    projectsWxssCompact.includes('.active-project-label{color:var(--theme-success)') &&
    projectsWxssCompact.includes('.project-active-chip{') && projectsWxssCompact.includes('color:var(--theme-success);font-size:17rpx'),
  '项目页浅色成功状态未使用语义主题色')
  assertWxmlHandlers(projectsPage, 'pages/projects/projects.wxml')
  projectsPage.onShow()
  assert.deepStrictEqual(projectsPage.data.recordTabs, ['现场项目', '常用收藏'])
  assert.strictEqual(projectsPage.data.projects.length, 2)
  assert.strictEqual(projectsPage.data.recordTabIndex, 0, '项目首页默认展示现场项目')
  assert.strictEqual(projectsPage.data.displayRecords.length, 0, '项目首页不提前展示收藏记录')
  const repeatProjectsSetData = projectsPage.setData
  let unchangedWorkspaceSetDataCount = 0
  projectsPage.setData = function countUnchangedWorkspaceSetData(value, callback) {
    unchangedWorkspaceSetDataCount += 1
    return repeatProjectsSetData.call(this, value, callback)
  }
  projectsPage.onShow()
  projectsPage.setData = repeatProjectsSetData
  assert.strictEqual(unchangedWorkspaceSetDataCount, 0, '项目页工作区未变化时仍执行完整视图更新')
  const projectsSetData = projectsPage.setData
  let recordTabSetDataCount = 0
  projectsPage.setData = function countRecordTabSetData(value, callback) {
    recordTabSetDataCount += 1
    return projectsSetData.call(this, value, callback)
  }
  projectsPage.onRecordTabTap({ currentTarget: { dataset: { index: 1 } } })
  projectsPage.setData = projectsSetData
  assert.strictEqual(recordTabSetDataCount, 1, '项目页记录标签切换仍执行多次视图提交')
  assert.strictEqual(projectsPage.data.recordTabIndex, 1)
  assert(projectsPage.data.displayRecords.every((record) => record.favorite && record.trustLabel))
  const projectsWxml = fs.readFileSync(path.join(root, 'pages/projects/projects.wxml'), 'utf8')
  assert(!projectsWxml.includes('page-subtitle') && !projectsWxml.includes('收藏常用结果'), '项目页标题下不应保留冗余说明')
  assert(!projectsWxml.includes('最近记录'))
  assert(projectsWxml.includes('{{item.wiringLineCount}} 条线路'))
  assert(projectsWxml.includes('catchtap="openProjectWiring"') && projectsWxml.includes('catchtap="openProjectReport"'))
  assert(!projectsWxml.includes('project-open-hint'), '项目卡片不应重复显示报告入口提示')
  projectsPage.selectProject({ currentTarget: { dataset: { id: project.id } } })
  assert.strictEqual(navigatedUrl, `/pages/records/project?id=${project.id}`)

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
  assert.strictEqual(productDetailPage.data.product.profile, null)
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
  assert.strictEqual(profiledDetailPage.data.product.profile.roleText, '主扩、补声/延时')
  assert.strictEqual(profiledDetailPage.data.product.profile.source, 'KF-D10F 产品说明书')

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

  const dmxPreferencesKey = 'audioTool.dmxAddress.preferences'
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
  storage.set(dmxPreferencesKey, {
    startAddressText: '1',
    allocationMode: 'auto',
    groups: [existingDmxGroup],
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
  assert.strictEqual(lightingDetailPage.data.dmxImportExistingGroupCount, 1)

  const cancelFixtureCount = storageWriteCount
  lightingDetailPage.selectDmxImportMode({ currentTarget: { dataset: { channelCount: 16 } } })
  lightingDetailPage.onDmxImportFixtureCountInput({ detail: { value: '2' } })
  lightingDetailPage.selectDmxImportAction({ currentTarget: { dataset: { action: 'append' } } })
  lightingDetailPage.closeDmxProductImport()
  assert.strictEqual(lightingDetailPage.data.dmxImportVisible, false)
  assert.strictEqual(storageWriteCount, cancelFixtureCount, 'cancelling DMX product import must not write preferences')
  assert.deepStrictEqual(storage.get(dmxPreferencesKey).groups, [existingDmxGroup],
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
  assert.strictEqual(navigatedUrl, '/pages/dmx-address/dmx-address')
  assert.strictEqual(storageWriteCount, writesBeforeDmxImportAppend + 1)
  let importedDmxPreferences = storage.get(dmxPreferencesKey)
  assert.strictEqual(importedDmxPreferences.groups.length, 2)
  assert.deepStrictEqual(importedDmxPreferences.groups[0], existingDmxGroup,
    'append must preserve the existing DMX group')
  let lightingGroup = importedDmxPreferences.groups[1]
  assert.strictEqual(lightingGroup.fixtureModel, 'TL-SV3103')
  assert.strictEqual(lightingGroup.name, `${lightingDetailPage._productDetail.model} ${lightingDetailPage._productDetail.name}`)
  assert.strictEqual(lightingGroup.channelCount, '16', 'import must use the selected channel mode')
  assert.strictEqual(lightingGroup.fixtureCount, '2')

  navigatedUrl = ''
  const writesBeforeDmxImportReplace = storageWriteCount
  lightingDetailPage.openCalculator({ currentTarget: { dataset: { module: 'dmxAddress' } } })
  lightingDetailPage.selectDmxImportMode({ currentTarget: { dataset: { channelCount: 18 } } })
  lightingDetailPage.onDmxImportFixtureCountInput({ detail: { value: '3' } })
  lightingDetailPage.selectDmxImportAction({ currentTarget: { dataset: { action: 'replace' } } })
  lightingDetailPage.confirmDmxProductImport()
  assert.strictEqual(navigatedUrl, '/pages/dmx-address/dmx-address')
  assert.strictEqual(storageWriteCount, writesBeforeDmxImportReplace + 1)
  importedDmxPreferences = storage.get(dmxPreferencesKey)
  assert.strictEqual(importedDmxPreferences.groups.length, 1,
    'replace must leave only the imported DMX group')
  lightingGroup = importedDmxPreferences.groups[0]
  assert.strictEqual(lightingGroup.fixtureModel, 'TL-SV3103')
  assert.strictEqual(lightingGroup.channelCount, '18', 'replace must use the selected channel mode')
  assert.strictEqual(lightingGroup.fixtureCount, '3')
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
  assert.strictEqual(projectPage.data.records.length, 2)
  assert.strictEqual(projectPage.data.recordGroups.length, 2)
  const projectSetData = projectPage.setData
  let unchangedProjectSetDataCount = 0
  projectPage.setData = function countUnchangedProjectSetData(value, callback) {
    unchangedProjectSetDataCount += 1
    return projectSetData.call(this, value, callback)
  }
  projectPage.onShow()
  projectPage.onShow()
  projectPage.setData = projectSetData
  assert.strictEqual(unchangedProjectSetDataCount, 0, '项目内容未变化时仍执行完整视图更新')
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
  assert.strictEqual(projectPage.data.moduleProgress.filter((item) => item.complete).length, 2)
  projectPage.copyProject()
  assert(clipboard.includes('现场项目调试报告'))
  assert(clipboard.includes('项目名称：交易集团二楼会议室'))
  assert(clipboard.includes('调试日期：2026-07-16'))
  assert(clipboard.includes('【限幅器｜产品参数计算】'))
  assert(clipboard.includes('【声压级｜自由场理论估算】'))
  assert(clipboard.includes('小程序版本：5.1.0'))
  assert(clipboard.includes('场地尺寸：12 × 8 × 4 m'))
  const projectWxml = fs.readFileSync(path.join(root, 'pages/records/project.wxml'), 'utf8')
  assert(projectWxml.includes('bindtap="generateProjectReportImage"')
    && projectWxml.includes('canvas-id="projectReportCanvas"'),
  '项目详情页缺少汇总长图生成入口或离屏 Canvas')
  assert(projectWxml.includes('bindtap="shareProjectReportImage"')
    && projectWxml.includes('bindtap="saveProjectReportImage"'),
  '项目汇总长图缺少转发或保存入口')
  let exportedProjectCanvas = null
  let projectExportCount = 0
  const projectCanvasContext = new Proxy({}, {
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
    assert.strictEqual(canvasId, 'projectReportCanvas')
    return projectCanvasContext
  }
  wx.canvasToTempFilePath = (options) => {
    projectExportCount += 1
    exportedProjectCanvas = options
    options.success({ tempFilePath: 'temp://project-report.png' })
  }
  wx.showLoading = () => {}
  wx.hideLoading = () => {}
  projectPage.generateProjectReportImage()
  assert.strictEqual(projectPage.data.reportImagePath, 'temp://project-report.png')
  assert.strictEqual(projectPage.data.reportPreviewVisible, true)
  assert(exportedProjectCanvas.destWidth > 0 && exportedProjectCanvas.destWidth <= 1500)
  assert(exportedProjectCanvas.destHeight > 0 && exportedProjectCanvas.destHeight <= 4096)
  projectPage.closeProjectReportPreview()
  assert.strictEqual(projectPage.data.reportPreviewVisible, false)
  projectPage.generateProjectReportImage()
  assert.strictEqual(projectPage.data.reportPreviewVisible, true,
    '相同项目内容没有复用已生成图片')
  assert.strictEqual(projectExportCount, 1, '相同项目内容重复导出了长图')
  const limiterRecord = projectPage.data.records.find((record) => record.module === 'limiter')
  projectPage.removeProjectRecord({ currentTarget: { dataset: { id: limiterRecord.id } } })
  assert.strictEqual(recordsApi.getProjectRecords(project.id).length, 1)
  assert(recordsApi.getRecords().some((record) => record.id === limiterRecord.id))
  assert.strictEqual(projectPage.data.reportImagePath, '', '项目记录变化后仍沿用旧汇总长图')
  delete wx.createCanvasContext
  delete wx.canvasToTempFilePath
  delete wx.showLoading
  delete wx.hideLoading
  const splRecord = recordsApi.getProjectRecords(project.id).find((record) => record.module === 'spl')
  projectPage.removeProjectRecord({ currentTarget: { dataset: { id: splRecord.id } } })
  assert.strictEqual(recordsApi.getProjectRecords(project.id).length, 0)
  assert(!recordsApi.getRecords().some((record) => record.id === splRecord.id))

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
  toolsPage.resetPreferences()
  preferenceKeys.forEach((key) => assert(!storage.has(key), `${key} 未被恢复默认设置清除`))
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
  ;['刷新总耗时', '整理项目记录', 'setData视图更新', '长图绘制', '长图导出'].forEach((name) => {
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
  let previewOptions = null
  let shareOptions = null
  let saveOptions = null
  let modalOptions = null
  let settingsOpened = false
  const toastTitles = []
  const vibrationTypes = []
  try {
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
    shareOptions.fail({ errMsg: 'showShareImageMenu:fail' })
    assert.deepStrictEqual(toastTitles, ['转发未完成，请重试'])
    assert.strictEqual(actions.saveGeneratedImage('temp://report.png'), true)
    assert.strictEqual(saveOptions.filePath, 'temp://report.png')
    saveOptions.success()
    saveOptions.fail({ errMsg: 'saveImageToPhotosAlbum:fail auth deny' })
    assert.strictEqual(modalOptions.title, '需要相册权限')
    assert.strictEqual(settingsOpened, true)
    assert.deepStrictEqual(vibrationTypes, ['medium', 'medium'])
  } finally {
    if (previousWx === undefined) delete global.wx
    else global.wx = previousWx
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
checkProjectReportPlan()
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
  'audit-runtime-regression.js',
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
  'dmx-result-view-test.js',
  'report-drawing-regression.js',
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
  'dmx-first-use-experience-test.js',
  'dmx-search-lifecycle-regression.js',
  'page-lifecycle-regression.js',
  'calculator-renderer-regression.js',
  'camera-first-use-regression.js',
  'camera-refactor-2026-10-11/camera-v3-controller-regression.cjs',
  'camera-refactor-2026-10-11/camera-v4-ui-markup-regression.cjs',
  'camera-refactor-2026-10-11/camera-v4-record-metadata-regression.cjs',
  'camera-refactor-2026-10-11/camera-v4-actions-regression.cjs',
  'calculation-boundary-regression.js',
  'audio-wiring-model-test.js',
  'audio-wiring-page-test.js',
  'audio-wiring-renderer-test.js',
  'project-wiring-model-test.js',
  'project-wiring-storage-test.js',
  'project-wiring-page-test.js',
  'project-wiring-report-test.js',
  'project-wiring-entry-test.js',
  'venue-removal-2026-10-15/removal-regression.cjs',
  'control-protocol-test.js',
  'spl-refactor-2026-10-11/localreport-regression.cjs',
].map((filename) => path.resolve(__dirname, filename))
auditRegressionScripts.forEach((scriptPath) => {
  assert(fs.existsSync(scriptPath), `缺少独立审查回归脚本：${scriptPath}`)
  childProcess.execFileSync(process.execPath, [scriptPath], { stdio: 'inherit' })
})

console.log('开发工作区自检通过：九个工具入口（含七个计算模块、接线助手与通道线缆入口）、38 款功放、148 款音箱、26 款摄像机、149 款舞台灯光设备及既有数值基准均正常。')
