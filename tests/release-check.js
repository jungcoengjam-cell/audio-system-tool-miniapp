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

function findByModel(items, model) {
  const item = items.find((entry) => entry.model === model)
  assert(item, `缺少产品型号：${model}`)
  return item
}

function assertUnique(items, getKey, label) {
  const keys = items.map(getKey)
  assert.strictEqual(new Set(keys).size, keys.length, `${label}存在重复项`)
}

const { createPackageChecks } = require('./release-check/package-checks.cjs')

const packageChecks = createPackageChecks({
  assert,
  fs,
  path,
  vm,
  root,
  themeAliasMap,
  evaluateDraftProtocolPackageGate,
})

const {
  PACKAGE_BUDGETS,
  getRegisteredPagePaths,
  collectMediaFiles,
  formatKiB,
  checkReleasePackageGates,
  checkSyntax,
} = packageChecks

const { createCalculationChecks } = require('./release-check/calculation-checks.cjs')

const calculationChecks = createCalculationChecks({
  assert,
  buildCatalogCategories,
  buildCatalogOptions,
  filterCatalogItems,
  findCatalogModelIndex,
  calculateLedScreenPlan,
  calculateGainStructure,
  APP_VERSION,
  PRODUCT_COUNTS,
  PRODUCT_DATA_DATE,
  amplifierInputStages,
  amplifiers,
  cameras,
  dmxFixtures,
  stageLightingProducts,
  knowledgeItems,
  findKnowledgeById,
  speakerSpecifications,
  speakers,
  buildProductComparison,
  filterProducts,
  getCalculableCameraViews,
  getCategories,
  getHorizontalCameraViews,
  getProductDetail,
  getProductList,
  resolveLibraryFov,
  PACKAGE_BUDGETS,
  collectMediaFiles,
  formatKiB,
  getRegisteredPagePaths,
  assertUnique,
  findByModel,
  calculateConstantVoltageCable,
  calculateProfessionalSpeakerCable,
  calculateCoverage,
  calculateGroundAreaPlacement,
  calculateHorizontalOnlyPlacement,
  calculateVerticalPlanePlacement,
  calculateLimiter,
  calculateSpeakerSpl,
  getCameraMountLabel,
  getCameraMountType,
  resolveCustomFov,
  resolveLibraryOptics,
  path,
  fs,
  root,
})

const {
  checkCatalogSelector,
  checkLedScreenPlan,
  checkData,
  checkBaselines,
} = calculationChecks

const { createPageControllerChecks } = require('./release-check/page-controller-checks.cjs')

const pageControllerChecks = createPageControllerChecks({
  assert,
  calculateDmxAddressPlan,
  fs,
  path,
  root,
  require,
  expandWxmlIncludes,
  PRODUCT_DATA_DATE,
  RECENT_STORAGE_KEY,
  amplifiers,
  cameras,
  dmxFixtures,
  findByModel,
  formatKiB,
  getCameraMountLabel,
  getProductDetail,
  getRecentProducts,
  recordsApi,
  themeAliasMap,
  assertFinalThemeDeclaration,
  assertThemeCascade,
  assertDarkNoBrightTail,
})

const {
  checkDmxAddressLazyChannelGuide,
  checkSharedResultReportPreviewTemplate,
  checkPageControllers,
} = pageControllerChecks

const { createRuntimeChecks } = require('./release-check/runtime-checks.cjs')

const runtimeChecks = createRuntimeChecks({
  assert,
  childProcess,
  fs,
  path,
  root,
  require,
})

const {
  checkProductLibraryLazyLoading,
  checkPerformanceMeasurements,
  checkAudioPagePerformanceCoverage,
  checkProductLibraryPerformanceCoverage,
  checkLedScreenPerformanceCoverage,
  checkProjectDetailPerformanceCoverage,
  checkHapticFeedback,
  checkReportImageActions,
} = runtimeChecks

checkSyntax()
childProcess.execFileSync(process.execPath, [path.join(root, 'tests/package-reclaim/generate-stage-lighting.cjs'), '--check'], { stdio: 'inherit' })
childProcess.execFileSync(process.execPath, [path.join(root, 'tests/package-reclaim/catalog-equivalence.cjs')], { stdio: 'inherit' })
childProcess.execFileSync(process.execPath, [path.join(root, 'tests/package-reclaim/catalog-generator-test.cjs')], { stdio: 'inherit' })
childProcess.execFileSync(process.execPath, [path.join(root, 'tests/package-reclaim/ui-resources.cjs')], { stdio: 'inherit' })
childProcess.execFileSync(process.execPath, [path.join(root, 'tests/input-layout-stability-2026-10-28.cjs')], { stdio: 'inherit' })
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
  'animation-lifecycle-check.js',
  'animation-native-page-container-check.cjs',
  'overlay-render-commit-regression.cjs',
  'workspace-overlay-commit-timing-check.cjs',
  'disclosure-motion-regression.cjs',
  'dmx-modal-animation-2026-10-28/run.cjs',
  'record-module-boundary-test.cjs',
  'audit-runtime-regression.js',
  'homepage-refactor-2026-10-18/storage-adversarial.cjs',
  'record-storage-refactor-regression.cjs',
  'homepage-refactor-2026-10-18/projects-storage-recovery.cjs',
  'homepage-refactor-2026-10-18/projects-context-lifecycle.cjs',
  'editor-navigation-dependency-regression.cjs',
  'storage-migration-failure-stages-regression.cjs',
  'audit-dmx-regression.js',
  'audit-led-regression.js',
  'report-render-regression.cjs',
  'report-bridge-lifecycle-regression.cjs',
  'homepage-refactor-2026-10-18/revision-2/report-bridge.test.cjs',
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
  'dmx-compile-entry-regression.cjs',
  'dmx-remaining-structure-realm-regression.cjs',
  'dmx-ui-refactor-2026-10-18/native-source-contracts-test.cjs',
  'dmx-ui-native-fixes-2026-10-18/layout-canvas-2d-regression-test.cjs',
  'dmx-placement-panel-2026-10-18/placement-panel-regression.cjs',
  'repair7-owner-decisions-regression.cjs',
  'dmx-ui-refactor-2026-10-18/layout-theme-lifecycle-test.cjs',
  'dmx-address-controller-boundary-regression.cjs',
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
  'project-list-lighting-index-regression.cjs',
  'project-wiring-model-test.js',
  'project-save-controllers-2026-10-24.cjs',
  'project-wiring-storage-test.js',
  'project-wiring-page-test.js',
  'project-wiring-workspace-controller-regression.cjs',
  'project-wiring-editor-boundary-regression-2026-10-24.cjs',
  'project-wiring-report-lifecycle-regression.cjs',
  'project-wiring-report-test.js',
  'project-wiring-entry-test.js',
  'project-delete-modal-regression.cjs',
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
