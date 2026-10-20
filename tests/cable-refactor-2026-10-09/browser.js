const app = document.getElementById('app')
const params = new URLSearchParams(location.search)
const initialState = params.get('state') || 'valid'
const themeName = params.get('theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
if (params.get('toolbar') === '0') document.documentElement.classList.add('harness-hide-controls')
if (themeName === 'dark') app.classList.add('theme-dark')
const productionWxssStyles = []
const productionWxssSourcePaths = new Set()
const wxssUrlToken = /(url\(\s*(?:"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|[^)]*)\s*\))/gi

function convertRpxToViewportPx(source, viewportWidth = innerWidth) {
  const scale = viewportWidth / 750
  return String(source).split(wxssUrlToken).map((part) => {
    if (/^url\(/i.test(part)) return part
    return part.replace(/(-?(?:\d+\.?\d*|\.\d+))rpx\b/g, (_match, raw) => {
      const pixels = Number(raw) * scale
      return `${Number(pixels.toFixed(5))}px`
    })
  }).join('')
}

function countUnconvertedRpx(source) {
  return String(source).split(wxssUrlToken)
    .filter((part) => !/^url\(/i.test(part))
    .join('')
    .match(/-?(?:\d+\.?\d*|\.\d+)rpx\b/gi)?.length || 0
}

function createRpxConversionProbe(viewportWidth) {
  const input = '.probe{margin-left:-22rpx;padding:calc(-22rpx + 1rpx + env(safe-area-inset-bottom));border-radius:15rpx;width:calc(100% - 8rpx);height:52px;opacity:50%;background-image:url("data:image/svg+xml,%3Csvg%20width%3D%22100rpx%22%3E")}'
  return { input, output: convertRpxToViewportPx(input, viewportWidth) }
}

async function loadExpandedWxss(sourceUrl, ancestry = []) {
  const url = new URL(sourceUrl, location.origin)
  if (ancestry.includes(url.pathname)) throw new Error(`WXSS import cycle: ${url.pathname}`)
  const response = await fetch(url.pathname, { cache: 'no-store' })
  if (!response.ok) throw new Error(`Failed to load ${url.pathname}`)
  productionWxssSourcePaths.add(url.pathname)
  let css = await response.text()
  const importExpression = /@import\s+(?:url\()?(["'])(.*?)\1\)?\s*[^;]*;/g
  const imports = [...css.matchAll(importExpression)]
  for (const [full, _quote, importPath] of imports) {
    const importedUrl = new URL(importPath, url)
    const importedCss = await loadExpandedWxss(importedUrl.href, [...ancestry, url.pathname])
    css = css.replace(full, importedCss)
  }
  css = css.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi, (full, quote, assetPath) => {
    const target = assetPath.trim()
    if (/^(?:data:|https?:|\/|#)/i.test(target)) return full
    return `url("${new URL(target, url).href}")`
  })
  return css
}

async function installProductionWxss() {
  const links = [...document.querySelectorAll('link[rel="stylesheet"]')]
    .filter((link) => ['/app.wxss', '/pages/cable/cable.wxss'].includes(new URL(link.href).pathname))
  for (const link of links) {
    const sourceUrl = new URL(link.href).pathname
    const source = await loadExpandedWxss(sourceUrl)
    const style = document.createElement('style')
    style.dataset.productionWxss = sourceUrl
    style.textContent = convertRpxToViewportPx(source)
    link.replaceWith(style)
    productionWxssStyles.push({ style, source })
  }
  window.__productionWxssConversion = {
    enabled: true,
    viewportWidth: innerWidth,
    rpxScale: innerWidth / 750,
    topLevelSources: productionWxssStyles.map(({ style }) => style.dataset.productionWxss),
    loadedSourcePaths: [...productionWxssSourcePaths].sort(),
    convertedStylesheetCount: productionWxssStyles.length,
    remainingRawRpxTokens: productionWxssStyles.reduce((sum, { source }) =>
      sum + countUnconvertedRpx(convertRpxToViewportPx(source, innerWidth)), 0),
    remainingProductionStylesheetLinks: [...document.querySelectorAll('link[rel="stylesheet"]')]
      .filter((link) => ['/app.wxss', '/pages/cable/cable.wxss'].includes(new URL(link.href).pathname)).length,
    probe: createRpxConversionProbe(innerWidth),
    recursiveImportsExpanded: true,
    inlineStylesConverted: true,
  }
}

window.addEventListener('resize', () => {
  productionWxssStyles.forEach(({ style, source }) => {
    style.textContent = convertRpxToViewportPx(source, innerWidth)
  })
  if (window.__productionWxssConversion) {
    window.__productionWxssConversion.viewportWidth = innerWidth
    window.__productionWxssConversion.rpxScale = innerWidth / 750
    window.__productionWxssConversion.remainingRawRpxTokens = productionWxssStyles
      .reduce((sum, { source }) => sum + countUnconvertedRpx(convertRpxToViewportPx(source, innerWidth)), 0)
    window.__productionWxssConversion.probe = createRpxConversionProbe(innerWidth)
  }
})

function evaluate(expression, scope) {
  try {
    const code = String(expression).replace(/^\{\{\s*|\s*\}\}$/g, '').trim()
    return Function('scope', `with(scope){return (${code})}`)(scope)
  } catch (error) {
    return ''
  }
}

function interpolate(value, scope) {
  return String(value).replace(/\{\{\s*([\s\S]*?)\s*\}\}/g, (_match, expression) => {
    const result = evaluate(expression, scope)
    return result === undefined || result === null ? '' : String(result)
  })
}

async function loadExpandedWxml(relativePath) {
  const response = await fetch(relativePath, { cache: 'no-store' })
  if (!response.ok) throw new Error(`Failed to load ${relativePath}`)
  let source = await response.text()
  const includes = [...source.matchAll(/<include\s+src="([^"]+)"\s*\/>/g)]
  for (const [include, target] of includes) {
    const targetPath = new URL(target, new URL(relativePath, location.origin)).pathname
    source = source.replace(include, await loadExpandedWxml(targetPath))
  }
  return source
}

function shouldRender(condition, scope) {
  if (condition === null || condition === '') return true
  return Boolean(evaluate(condition, scope))
}

function appendChildren(sourceParent, targetParent, scope) {
  let branch = null
  for (const child of [...sourceParent.childNodes]) {
    if (child.nodeType === Node.TEXT_NODE) {
      if (child.textContent.trim()) targetParent.append(document.createTextNode(interpolate(child.textContent, scope)))
      continue
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue

    const condition = child.getAttribute('wx:if')
    const alternate = child.getAttribute('wx:elif')
    const otherwise = child.hasAttribute('wx:else')
    if (condition !== null) {
      branch = { matched: shouldRender(condition, scope) }
      if (branch.matched) renderElement(child, scope, targetParent)
      continue
    }
    if (alternate !== null) {
      if (branch && !branch.matched && shouldRender(alternate, scope)) {
        branch.matched = true
        renderElement(child, scope, targetParent)
      }
      continue
    }
    if (otherwise) {
      if (branch && !branch.matched) {
        branch.matched = true
        renderElement(child, scope, targetParent)
      }
      continue
    }
    branch = null
    renderElement(child, scope, targetParent)
  }
}

function renderElement(sourceElement, scope, targetParent) {
  const forExpression = sourceElement.getAttribute('wx:for')
  if (forExpression !== null) {
    const items = evaluate(forExpression, scope)
    const itemName = sourceElement.getAttribute('wx:for-item') || 'item'
    const indexName = sourceElement.getAttribute('wx:for-index') || 'index'
    ;(Array.isArray(items) ? items : []).forEach((item, index) => {
      const clone = sourceElement.cloneNode(true)
      clone.removeAttribute('wx:for')
      clone.removeAttribute('wx:for-item')
      clone.removeAttribute('wx:for-index')
      clone.removeAttribute('wx:key')
      renderElement(clone, { ...scope, [itemName]: item, [indexName]: index }, targetParent)
    })
    return
  }

  const sourceName = sourceElement.tagName.toLowerCase()
  if (sourceName === 'block') {
    appendChildren(sourceElement, targetParent, scope)
    return
  }
  const tagNames = { view: 'div', 'scroll-view': 'div', text: 'span', picker: 'div', image: 'img' }
  const output = document.createElement(tagNames[sourceName] || sourceName)
  for (const attribute of [...sourceElement.attributes]) {
    const name = attribute.name
    if (name.startsWith('wx:') || name === 'range' || name === 'range-key'
      || name === 'enhanced' || name === 'show-scrollbar' || name === 'scroll-y'
      || name === 'adjust-position' || name === 'cursor-spacing') continue
    if (name.startsWith('bind') || name.startsWith('catch')) {
      output.dataset.wxEvent = attribute.value
      output.setAttribute('data-wx-' + name, attribute.value)
      continue
    }
    const value = interpolate(attribute.value, scope)
    if (name === 'value' && sourceName === 'textarea') {
      output.value = value
      continue
    }
    if (name === 'disabled' || name === 'aria-pressed') {
      if (value === 'false' || value === '') continue
    }
    if (name === 'type' && sourceName === 'input' && value === 'digit') {
      output.setAttribute('type', 'text')
      continue
    }
    output.setAttribute(name, name === 'style' ? convertRpxToViewportPx(value) : value)
  }
  if (sourceName === 'image' && !output.hasAttribute('alt')) output.setAttribute('alt', 'report preview')
  targetParent.append(output)
  if (!['input', 'textarea', 'img'].includes(output.tagName.toLowerCase())) {
    appendChildren(sourceElement, output, scope)
  }
}

function runInlineStyleConversionProbe(viewportWidth) {
  const source = createRpxConversionProbe(viewportWidth).input
    .match(/^\.[^{]+\{([\s\S]*)\}$/)?.[1] || ''
  const sourceElement = document.createElement('view')
  sourceElement.setAttribute('style', source)
  const host = document.createElement('div')
  renderElement(sourceElement, {}, host)
  const output = host.firstElementChild?.getAttribute('style') || ''
  return { input: source, output, passed: output === convertRpxToViewportPx(source, viewportWidth), viewportWidth }
}

function box(element) {
  if (!element) return null
  const rect = element.getBoundingClientRect()
  return {
    x: Math.round(rect.x * 10) / 10,
    y: Math.round(rect.y * 10) / 10,
    width: Math.round(rect.width * 10) / 10,
    height: Math.round(rect.height * 10) / 10,
    centerX: Math.round((rect.left + rect.width / 2) * 10) / 10,
    bottom: Math.round(rect.bottom * 10) / 10,
    right: Math.round(rect.right * 10) / 10,
  }
}

const previewLayoutStyleFields = {
  '.result-report-preview-overlay': ['paddingTop', 'paddingBottom'],
  '.result-report-preview-sheet': ['paddingTop', 'paddingBottom', 'borderTopWidth', 'borderBottomWidth'],
  '.result-report-preview-scroll': ['borderTopWidth', 'borderBottomWidth', 'borderLeftWidth', 'borderRightWidth'],
}

async function applyProductionPreviewLayout(state) {
  if (window.__cableQaPreviewMeasurementFailure || !state.resultReportPreviewVisible || !state.qaLayoutToken) return null
  const root = document.querySelector('.page-root')
  if (!root) throw new Error('Preview layout needs the real .page-root element')
  root.style.removeProperty('--cable-report-sheet-max-height')
  root.style.removeProperty('--cable-report-scroll-height')
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  const selectors = [
    '.page-root',
    '.result-report-preview-overlay',
    '.result-report-preview-sheet',
    '.result-report-preview-header',
    '.result-report-preview-actions',
    '.result-report-preview-scroll',
    '.result-report-preview-image',
  ]
  const snapshot = {}
  for (const selector of selectors) {
    const element = document.querySelector(selector)
    if (!element) {
      snapshot[selector] = null
      continue
    }
    const rect = element.getBoundingClientRect()
    const computed = getComputedStyle(element)
    const computedStyle = {}
    for (const field of previewLayoutStyleFields[selector] || []) computedStyle[field] = computed[field]
    snapshot[selector] = {
      rect: {
        left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
        x: rect.x, y: rect.y, width: rect.width, height: rect.height,
      },
      computedStyle,
    }
  }
  const response = await fetch('/__preview-layout', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: state.qaLayoutToken, selectors: snapshot }),
  })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error || 'Production preview layout query failed')
  state.qaPreviewLayout = result
  if (result.methodCalled && result.methodResult && result.resultReportPreviewStyle) {
    state.resultReportPreviewStyle = result.resultReportPreviewStyle
    root.setAttribute('style', result.resultReportPreviewStyle)
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  }
  return result
}

window.__cableQaApplyProductionPreviewLayout = applyProductionPreviewLayout

async function captureGeometry(state) {
  const card = document.querySelector('.result-card')
  const spec = document.querySelector('.cable-spec')
  const rail = document.querySelector('.action-rail')
  const buttons = [...document.querySelectorAll('.action-button')]
  const pageScroll = document.querySelector('.page-scroll')
  const secondaryCard = document.querySelector('.secondary-card')
  const projectOverlay = document.querySelector('.cable-project-overlay')
  const projectSheet = document.querySelector('.project-sheet')
  const projectBody = document.querySelector('.project-body')
  const projectFooter = document.querySelector('.project-footer')
  const projectClose = document.querySelector('.project-close')
  const preferenceSaveNotice = document.querySelector('.preference-save-retry')
  const preview = document.querySelector('.result-report-preview-sheet')
  const modeTabWrapper = document.querySelector('.mode-tabs')
  const inputCard = document.querySelector('.input-card')
  const editorModeTabs = [...document.querySelectorAll('.mode-tab')]
  const editorFields = document.querySelector('.editor-fields')
  const settingsCard = document.querySelector('.settings-card')
  const editorHeading = document.querySelector('.editor-heading')
  const list = document.querySelector('.project-list')
  const projectSearch = document.querySelector('.project-search')
  const image = document.querySelector('.result-report-preview-image')
  const previewScroll = document.querySelector('.result-report-preview-scroll')
  const originalViewer = document.querySelector('.cable-original-image-viewer')
  const originalViewerScroll = document.querySelector('.cable-original-viewer-scroll')
  const originalViewerImage = document.querySelector('.cable-original-viewer-image')
  const originalViewerBack = document.querySelector('.cable-original-viewer-back')
  const originalViewerScales = [...document.querySelectorAll('.cable-original-viewer-scale')]
  const projectInput = state.projectFocusedInputId
    ? document.getElementById(state.projectFocusedInputId)
    : document.getElementById('projectSearchText') || document.getElementById('projectNameText')
  const projectPreview = document.querySelector('.project-preview')
  const overlaps = (left, right) => {
    if (!left || !right) return null
    const a = left.getBoundingClientRect()
    const b = right.getBoundingClientRect()
    if (!a.width || !a.height || !b.width || !b.height) return false
    return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
  }
  const projectSelectCloseClearance = state.projectDialogStep === 'select' ? {
    searchOverlaps: overlaps(projectClose, projectSearch),
    listOverlaps: overlaps(projectClose, list),
    lastRowOverlaps: null,
  } : null
  let resultEndReachable = null
  let inputLastReachable = null
  let projectListEndReachable = null
  let previewImageEndReachable = null
  let originalViewerImageBottomReachable = null
  let originalViewerImageRightReachable = null
  let originalViewerUnderlyingScrollStable = null
  let projectPreviewEndReachable = null
  let focusedInputReachable = null
  let resultCanScroll = false
  let projectBodyCanScroll = false
  let resultCardInitiallyVisible = false
  if (pageScroll) {
    const initialTop = pageScroll.scrollTop
    resultCanScroll = pageScroll.scrollHeight > pageScroll.clientHeight + 1
    resultCardInitiallyVisible = Boolean(card && Math.abs(initialTop) < 1
      && card.getBoundingClientRect().top >= pageScroll.getBoundingClientRect().top - 1
      && card.getBoundingClientRect().bottom <= pageScroll.getBoundingClientRect().bottom + 1)
    const resultContent = document.querySelector('.result-content')
    const lastDetail = resultContent?.querySelector('.warning-text:last-child')
      || resultContent?.lastElementChild
    if (lastDetail) {
      pageScroll.scrollTop = pageScroll.scrollHeight
      await new Promise((resolve) => requestAnimationFrame(resolve))
      resultEndReachable = lastDetail.getBoundingClientRect().bottom <= pageScroll.getBoundingClientRect().bottom + 1
      pageScroll.scrollTop = 0
    }
    const inputPane = document.querySelector('.input-pane')
    const lastInputGroup = inputPane?.querySelector('.environment-field,.field-error-group,.field-grid .field:last-child')
    if (lastInputGroup) {
      pageScroll.scrollTop = pageScroll.scrollHeight
      await new Promise((resolve) => requestAnimationFrame(resolve))
      inputLastReachable = lastInputGroup.getBoundingClientRect().bottom <= pageScroll.getBoundingClientRect().bottom + 1
      pageScroll.scrollTop = 0
    }
  }
  if (projectBody) {
    const initialTop = projectBody.scrollTop
    projectBodyCanScroll = projectBody.scrollHeight > projectBody.clientHeight + 1
    const lastProject = list?.querySelector('.project-row:last-child')
    if (lastProject) {
      projectBody.scrollTop = projectBody.scrollHeight
      await new Promise((resolve) => requestAnimationFrame(resolve))
      projectListEndReachable = lastProject.getBoundingClientRect().bottom <= projectBody.getBoundingClientRect().bottom + 1
      if (projectSelectCloseClearance) {
        projectSelectCloseClearance.lastRowOverlaps = overlaps(projectClose, lastProject)
      }
      projectBody.scrollTop = initialTop
    }
  }
  if (previewScroll && image) {
    if (previewScroll.scrollHeight > previewScroll.clientHeight + 1) {
      previewScroll.scrollTop = previewScroll.scrollHeight
      await new Promise((resolve) => requestAnimationFrame(resolve))
      previewImageEndReachable = image.getBoundingClientRect().bottom <= previewScroll.getBoundingClientRect().bottom + 1
      previewScroll.scrollTop = 0
    } else {
      previewImageEndReachable = image.getBoundingClientRect().bottom <= previewScroll.getBoundingClientRect().bottom + 1
    }
  }
  if (originalViewerScroll && originalViewerImage) {
    if (typeof originalViewerImage.decode === 'function') {
      await originalViewerImage.decode().catch(() => {})
    }
    const initialTop = originalViewerScroll.scrollTop
    const initialLeft = originalViewerScroll.scrollLeft
    const pageScrollTop = pageScroll?.scrollTop ?? null
    const shareScrollTop = previewScroll?.scrollTop ?? null
    originalViewerScroll.scrollTop = originalViewerScroll.scrollHeight
    originalViewerScroll.scrollLeft = originalViewerScroll.scrollWidth
    await new Promise((resolve) => requestAnimationFrame(resolve))
    const imageRect = originalViewerImage.getBoundingClientRect()
    const scrollRect = originalViewerScroll.getBoundingClientRect()
    originalViewerImageBottomReachable = imageRect.bottom <= scrollRect.bottom + 1
    originalViewerImageRightReachable = imageRect.right <= scrollRect.right + 1
    originalViewerUnderlyingScrollStable = (pageScroll?.scrollTop ?? null) === pageScrollTop
      && (previewScroll?.scrollTop ?? null) === shareScrollTop
    originalViewerScroll.scrollTop = initialTop
    originalViewerScroll.scrollLeft = initialLeft
  }
  let projectBodyRestoreTop = projectBody?.scrollTop || 0
  if (projectBody && projectInput) {
    const bodyRect = projectBody.getBoundingClientRect()
    const focusedRect = projectInput.getBoundingClientRect()
    if (focusedRect.top < bodyRect.top || focusedRect.bottom > bodyRect.bottom) {
      projectBody.scrollTop = Math.max(0, projectBody.scrollTop + focusedRect.top - bodyRect.top)
      await new Promise((resolve) => requestAnimationFrame(resolve))
    }
    const visibleRect = projectInput.getBoundingClientRect()
    focusedInputReachable = visibleRect.top >= projectBody.getBoundingClientRect().top - 1
      && visibleRect.bottom <= projectBody.getBoundingClientRect().bottom + 1
      && visibleRect.bottom <= projectFooter?.getBoundingClientRect().top + 1
    projectBodyRestoreTop = projectBody.scrollTop
  }
  if (projectBody && projectPreview) {
    projectBody.scrollTop = projectBody.scrollHeight
    await new Promise((resolve) => requestAnimationFrame(resolve))
    const summary = projectPreview.querySelector('.project-preview-summary')
    projectPreviewEndReachable = summary
      ? summary.getBoundingClientRect().bottom <= projectBody.getBoundingClientRect().bottom + 1
      : false
    projectBody.scrollTop = projectBodyRestoreTop
  }
  const measurements = {
    case: state.stateName,
    theme: themeName,
    viewport: {
      width: innerWidth,
      height: innerHeight,
      wxssRpxScale: innerWidth / 750,
      devicePixelRatio,
      outerWidth,
      outerHeight,
      screenWidth: screen.width,
      visualViewportWidth: visualViewport?.width || innerWidth,
    },
    controller: {
      result: Boolean(state.result),
      modeIndex: Number(state.modeIndex) || 0,
      canUseResultActions: Boolean(state.canUseResultActions),
      resultHasFormula: Boolean(state.result?.hasFormula),
      resultWarningCount: Array.isArray(state.result?.warnings) ? state.result.warnings.length : 0,
      resultWarnings: Array.isArray(state.result?.warnings) ? state.result.warnings : [],
      resultDescription: state.result?.description || '',
      formulaMinimumArea: state.result?.formulaMinimumArea || '',
      inputError: Boolean(state.inputError),
      inputPending: Boolean(state.inputPending),
      projectDialogVisible: Boolean(state.projectDialogVisible),
      projectDialogStep: state.projectDialogStep,
      projectKeyboardOpen: Boolean(state.projectKeyboardOpen),
      keyboardHeight: state.projectKeyboardHeight || 0,
      resultReportPreviewVisible: Boolean(state.resultReportPreviewVisible),
      resultReportImageViewerVisible: Boolean(state.resultReportImageViewerVisible),
      resultReportImageViewerScale: state.resultReportImageViewerScale || 100,
      resultReportCanvasWidth: state.resultReportCanvasWidth || 0,
      resultReportCanvasHeight: state.resultReportCanvasHeight || 0,
      resultReportPreviewStyle: state.resultReportPreviewStyle || '',
    },
    resultCard: box(card),
    resultSpec: box(spec),
    resultPrimary: box(document.querySelector('.result-primary')),
    resultFormulaCard: box(document.querySelector('.formula-card')),
    resultFormulaText: document.querySelector('.formula-card')?.textContent.replace(/\s+/g, ' ').trim() || '',
    resultSecondaryTexts: [...document.querySelectorAll('.secondary-value')].map((value) => value.textContent.replace(/\s+/g, ' ').trim()),
    resultWarningRowCount: document.querySelectorAll('.warning-row').length,
    resultWarningTexts: [...document.querySelectorAll('.warning-row')].map((row) => row.textContent.trim()),
    renderedResultDescription: document.querySelector('.result-content .result-subtitle')?.textContent.trim() || '',
    secondaryCard: box(secondaryCard),
    secondaryValues: [...document.querySelectorAll('.secondary-value')].map(box),
    resultFacts: [...document.querySelectorAll('.result-fact')].map((fact) => ({
      box: box(fact),
      label: fact.querySelector('.metric-label')?.textContent || '',
      value: fact.querySelector('.metric-value')?.textContent || '',
      background: getComputedStyle(fact).backgroundColor,
      labelBackground: fact.querySelector('.metric-label')
        ? getComputedStyle(fact.querySelector('.metric-label')).backgroundColor : '',
      valueBackground: fact.querySelector('.metric-value')
        ? getComputedStyle(fact.querySelector('.metric-value')).backgroundColor : '',
    })),
    actionRail: box(rail),
    actionButtons: buttons.map(box),
    actionDisabled: buttons.map((button) => Boolean(button.disabled)),
    pageScroll: pageScroll ? {
      box: box(pageScroll), clientHeight: pageScroll.clientHeight, scrollHeight: pageScroll.scrollHeight,
      scrollTop: pageScroll.scrollTop, canScroll: resultCanScroll,
      resultCardInitiallyVisible, lastResultDetailReachable: resultEndReachable,
      lastInputReachable: inputLastReachable,
    } : null,
    projectOverlay: box(projectOverlay),
    projectSheet: box(projectSheet),
    projectTitle: document.querySelector('.project-title') ? {
      box: box(document.querySelector('.project-title')),
      fontSize: getComputedStyle(document.querySelector('.project-title')).fontSize,
      lineHeight: getComputedStyle(document.querySelector('.project-title')).lineHeight,
    } : null,
    projectHeaderCopy: box(document.querySelector('.project-header-copy')),
    projectClose: box(projectClose),
    projectCloseEvent: projectClose?.dataset.wxEvent || '',
    projectSelectSheet: Boolean(projectSheet?.classList.contains('project-select-sheet')),
    projectSelectCloseClearance,
    projectFields: [...document.querySelectorAll('.project-search,.project-name-input,.project-config-name,.project-config-note')].map((field) => ({
      id: field.id,
      box: box(field),
      fontSize: getComputedStyle(field).fontSize,
    })),
    projectLabels: [...document.querySelectorAll('.project-metadata-label,.project-row-name,.project-preview-title,.project-preview-summary')]
      .map((label) => ({ text: label.textContent.trim(), fontSize: getComputedStyle(label).fontSize })),
    projectBody: projectBody ? {
      box: box(projectBody), clientHeight: projectBody.clientHeight, scrollHeight: projectBody.scrollHeight,
      scrollTop: projectBody.scrollTop, canScroll: projectBodyCanScroll,
    } : null,
    projectFooter: box(projectFooter),
    projectButtons: [...document.querySelectorAll('.project-button')].map((button) => ({
      text: button.textContent.trim(), disabled: Boolean(button.disabled),
      event: button.dataset.wxEvent || '', box: box(button), fontSize: getComputedStyle(button).fontSize,
    })),
    projectInput: box(projectInput),
    projectFocusedInputReachable: focusedInputReachable,
    projectPreview: projectPreview ? {
      box: box(projectPreview), lastSummaryReachable: projectPreviewEndReachable,
    } : null,
    projectList: list ? {
      box: box(list), clientHeight: projectBody?.clientHeight || 0, scrollHeight: projectBody?.scrollHeight || 0,
      canScroll: projectBodyCanScroll, lastProjectReachable: projectListEndReachable,
    } : null,
    reportPreview: box(preview),
    reportPreviewActions: box(document.querySelector('.result-report-preview-actions')),
    previewMeasurementFailureSimulated: Boolean(window.__cableQaPreviewMeasurementFailure),
    previewRootInlineDimensions: (() => { const root = document.querySelector('.page-root'); return root ? {
      sheet: root.style.getPropertyValue('--cable-report-sheet-max-height'),
      scroll: root.style.getPropertyValue('--cable-report-scroll-height'),
    } : null })(),
    reportPreviewScrollComputed: previewScroll ? {
      height: getComputedStyle(previewScroll).height,
      maxHeight: getComputedStyle(previewScroll).maxHeight,
      borderTopWidth: getComputedStyle(previewScroll).borderTopWidth,
      borderBottomWidth: getComputedStyle(previewScroll).borderBottomWidth,
    } : null,
    reportImage: box(image),
    reportImageOuterBBoxGap: previewScroll && image
      ? Math.round((previewScroll.getBoundingClientRect().height - image.getBoundingClientRect().height) * 100) / 100
      : null,
    reportImageContentGap: previewScroll && image
      ? Math.round((previewScroll.clientHeight - image.getBoundingClientRect().height) * 100) / 100
      : null,
    previewLayoutMeasurement: state.qaPreviewLayout || null,
    reportPreviewScroll: previewScroll ? {
      box: box(previewScroll),
      clientHeight: previewScroll.clientHeight,
      scrollHeight: previewScroll.scrollHeight,
      canScroll: previewScroll.scrollHeight > previewScroll.clientHeight + 1,
      lastImageReachable: previewImageEndReachable,
      imageLoaded: Boolean(image?.complete && image.naturalWidth > 0),
      imageNaturalWidth: image?.naturalWidth || 0,
      imageNaturalHeight: image?.naturalHeight || 0,
      originalPreviewBinding: image?.dataset.wxEvent || '',
    } : null,
    originalViewer: box(originalViewer),
    originalViewerBack: originalViewerBack ? {
      box: box(originalViewerBack),
      text: originalViewerBack.textContent.trim(),
      event: originalViewerBack.dataset.wxEvent || '',
    } : null,
    originalViewerScaleButtons: originalViewerScales.map((button) => ({
      id: button.id,
      label: button.getAttribute('aria-label') || '',
      text: button.textContent.trim(),
      event: button.dataset.wxEvent || '',
      box: box(button),
      active: button.classList.contains('cable-original-viewer-scale-active'),
    })),
    originalViewerTouchMoveEvent: originalViewer?.dataset.wxEvent || '',
    originalViewerImage: box(originalViewerImage),
    originalViewerScroll: originalViewerScroll ? {
      box: box(originalViewerScroll),
      clientWidth: originalViewerScroll.clientWidth,
      clientHeight: originalViewerScroll.clientHeight,
      scrollWidth: originalViewerScroll.scrollWidth,
      scrollHeight: originalViewerScroll.scrollHeight,
      canScrollX: originalViewerScroll.scrollWidth > originalViewerScroll.clientWidth + 1,
      canScrollY: originalViewerScroll.scrollHeight > originalViewerScroll.clientHeight + 1,
      imageLoaded: Boolean(originalViewerImage?.complete && originalViewerImage.naturalWidth > 0),
      imageNaturalWidth: originalViewerImage?.naturalWidth || 0,
      imageNaturalHeight: originalViewerImage?.naturalHeight || 0,
      imageErrorBinding: originalViewerImage?.getAttribute('data-wx-binderror') || '',
      imageBottomReachable: originalViewerImageBottomReachable,
      imageRightReachable: originalViewerImageRightReachable,
      underlyingScrollStable: originalViewerUnderlyingScrollStable,
    } : null,
    pageRoot: box(document.querySelector('.page-root')),
    pageVisibleText: document.querySelector('.page-root')?.innerText.replace(/\s+/g, ' ').trim() || '',
    preferenceSaveNotice: box(preferenceSaveNotice),
    preferenceSaveNoticeText: preferenceSaveNotice?.innerText.trim() || '',
    preferenceSaveNoticeEvent: preferenceSaveNotice?.dataset.wxEvent || '',
    preferenceSaveNoticeComputed: preferenceSaveNotice ? {
      fontSize: getComputedStyle(preferenceSaveNotice).fontSize,
      minHeight: getComputedStyle(preferenceSaveNotice).minHeight,
      lineHeight: getComputedStyle(preferenceSaveNotice).lineHeight,
      display: getComputedStyle(preferenceSaveNotice).display,
    } : null,
    wxssConversion: { ...window.__productionWxssConversion },
    inlineStyleConversion: runInlineStyleConversionProbe(innerWidth),
    projectSheetComputed: projectSheet ? {
      paddingTop: getComputedStyle(projectSheet).paddingTop,
      paddingRight: getComputedStyle(projectSheet).paddingRight,
      paddingBottom: getComputedStyle(projectSheet).paddingBottom,
      paddingLeft: getComputedStyle(projectSheet).paddingLeft,
      borderRadius: getComputedStyle(projectSheet).borderTopLeftRadius,
      borderWidth: getComputedStyle(projectSheet).borderTopWidth,
    } : null,
    projectFooterComputed: projectFooter ? { gap: getComputedStyle(projectFooter).gap } : null,
    projectButtonComputed: document.querySelector('.project-button') ? {
      borderRadius: getComputedStyle(document.querySelector('.project-button')).borderTopLeftRadius,
      minHeight: getComputedStyle(document.querySelector('.project-button')).minHeight,
    } : null,
    pageHeader: box(document.querySelector('.page-header')),
    workspace: box(document.querySelector('.workspace')),
    resultPane: box(document.querySelector('.result-pane')),
    inputPane: box(document.querySelector('.input-pane')),
    editorHeading: editorHeading ? { text: editorHeading.innerText.trim(), box: box(editorHeading) } : null,
    modeTabLayout: modeTabWrapper ? {
      container: inputCard ? {
        box: box(inputCard),
        backgroundColor: getComputedStyle(inputCard).backgroundColor,
        borderTopWidth: getComputedStyle(inputCard).borderTopWidth,
        borderTopColor: getComputedStyle(inputCard).borderTopColor,
        borderTopLeftRadius: getComputedStyle(inputCard).borderTopLeftRadius,
        borderTopRightRadius: getComputedStyle(inputCard).borderTopRightRadius,
        paddingTop: getComputedStyle(inputCard).paddingTop,
        paddingRight: getComputedStyle(inputCard).paddingRight,
        paddingBottom: getComputedStyle(inputCard).paddingBottom,
        paddingLeft: getComputedStyle(inputCard).paddingLeft,
        boxShadow: getComputedStyle(inputCard).boxShadow,
      } : null,
      tabsParentIsContainer: modeTabWrapper.parentElement === inputCard,
      fieldsParentIsContainer: editorFields?.parentElement === inputCard,
      wrapper: box(modeTabWrapper),
      wrapperComputed: {
        backgroundColor: getComputedStyle(modeTabWrapper).backgroundColor,
        borderTopWidth: getComputedStyle(modeTabWrapper).borderTopWidth,
        borderRightWidth: getComputedStyle(modeTabWrapper).borderRightWidth,
        borderBottomWidth: getComputedStyle(modeTabWrapper).borderBottomWidth,
        borderLeftWidth: getComputedStyle(modeTabWrapper).borderLeftWidth,
        paddingTop: getComputedStyle(modeTabWrapper).paddingTop,
        paddingRight: getComputedStyle(modeTabWrapper).paddingRight,
        paddingBottom: getComputedStyle(modeTabWrapper).paddingBottom,
        paddingLeft: getComputedStyle(modeTabWrapper).paddingLeft,
        gap: getComputedStyle(modeTabWrapper).gap,
        borderTopLeftRadius: getComputedStyle(modeTabWrapper).borderTopLeftRadius,
      },
      editorFieldsClass: editorFields?.className || '',
      tabs: editorModeTabs.map((tab, index) => {
        const style = getComputedStyle(tab)
        return {
          index, active: tab.classList.contains('mode-tab-active'), box: box(tab),
          computed: {
            backgroundColor: style.backgroundColor,
            borderWidth: style.borderTopWidth,
            borderTopLeftRadius: style.borderTopLeftRadius,
            borderTopRightRadius: style.borderTopRightRadius,
            borderBottomLeftRadius: style.borderBottomLeftRadius,
            borderBottomRightRadius: style.borderBottomRightRadius,
            minHeight: style.minHeight,
            boxShadow: style.boxShadow,
          },
        }
      }),
      card: settingsCard ? {
        box: box(settingsCard),
        backgroundColor: getComputedStyle(settingsCard).backgroundColor,
        borderTopWidth: getComputedStyle(settingsCard).borderTopWidth,
        paddingTop: getComputedStyle(settingsCard).paddingTop,
        paddingRight: getComputedStyle(settingsCard).paddingRight,
        paddingBottom: getComputedStyle(settingsCard).paddingBottom,
        paddingLeft: getComputedStyle(settingsCard).paddingLeft,
        borderTopLeftRadius: getComputedStyle(settingsCard).borderTopLeftRadius,
        boxShadow: getComputedStyle(settingsCard).boxShadow,
      } : null,
    } : null,
    rootClasses: document.querySelector('.page-root')?.className || '',
  }
  const response = await fetch('/__geometry', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(measurements),
  })
  const provenance = await response.json()
  measurements.loadedSourceHashes = provenance.loadedSourceHashes
  measurements.currentProductionSourceHashes = provenance.currentProductionSourceHashes
  measurements.qaServerStartedAt = provenance.qaServerStartedAt
  window.__cableQa = { measurements, saved: response.ok }
  return measurements
}

async function render() {
  await installProductionWxss()
  const viewportHeight = Number(params.get('keyboardViewport')) || innerHeight
  const query = new URLSearchParams({
    state: initialState,
    viewportHeight: String(viewportHeight),
    reportCase: params.get('reportCase') || 'constant',
  })
  const stateResponse = await fetch(`/__state?${query}`, { cache: 'no-store' })
  const state = await stateResponse.json()
  window.__cableQaState = state
  state.stateName = params.get('caseName') || initialState
  const expanded = await loadExpandedWxml('/pages/cable/cable.wxml')
  const browserMarkup = expanded.replace(/(<textarea\b[^>]*?)\s*\/>/g, '$1></textarea>')
  const parsed = new DOMParser().parseFromString(browserMarkup, 'text/html')
  app.replaceChildren()
  appendChildren(parsed.body, app, state)
  if (params.get('simulatePreviewMeasureFailure') === '1') {
    const root = document.querySelector('.page-root')
    root?.style.removeProperty('--cable-report-sheet-max-height')
    root?.style.removeProperty('--cable-report-scroll-height')
    window.__cableQaPreviewMeasurementFailure = true
  }
  if (state.projectKeyboardOpen && state.projectKeyboardHeight > 0) {
    const keyboard = document.createElement('div')
    keyboard.className = 'qa-keyboard'
    keyboard.style.height = `${state.projectKeyboardHeight}px`
    keyboard.setAttribute('aria-label', 'Browser-only simulated keyboard')
    keyboard.innerHTML = '<div class="qa-keyboard-toolbar">浏览器模拟键盘</div><div class="qa-keyboard-row"><span>123</span><span>空格</span><span>返回</span></div><div class="qa-keyboard-row"><span>完成</span><span>确认</span><span>⌕</span></div>'
    document.body.append(keyboard)
  }
  const projectBody = document.querySelector('.project-body')
  const scrollIntoViewTarget = projectBody?.getAttribute('scroll-into-view')
  if (scrollIntoViewTarget) {
    document.getElementById(scrollIntoViewTarget)?.scrollIntoView({ block: 'nearest', behavior: 'auto' })
  }
  const selector = document.getElementById('state-select')
  selector.value = initialState
  selector.addEventListener('change', () => {
    const next = new URL(location.href)
    next.searchParams.set('state', selector.value)
    location.href = next.href
  })
  document.getElementById('theme-toggle').addEventListener('click', () => {
    const next = new URL(location.href)
    next.searchParams.set('theme', themeName === 'dark' ? 'light' : 'dark')
    location.href = next.href
  })
  if (params.get('toolbar') === '0') document.documentElement.classList.add('harness-hide-controls')
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  if (params.get('capture') === '1') await applyProductionPreviewLayout(state)
  if (params.get('capture') === '1') {
    await new Promise((resolve) => setTimeout(resolve, 350))
    await captureGeometry(state)
  }
  document.documentElement.dataset.ready = 'true'
  document.title = `Cable QA ${initialState} ${innerWidth}x${innerHeight} ${themeName}`
}

window.addEventListener('resize', () => {
  if (window.__cableQaResizeTimer) clearTimeout(window.__cableQaResizeTimer)
  window.__cableQaResizeTimer = setTimeout(() => {
    if (document.documentElement.dataset.ready !== 'true' || !window.__cableQaState || params.get('capture') !== '1') return
    applyProductionPreviewLayout(window.__cableQaState).then(() => captureGeometry(window.__cableQaState)).catch((error) => {
      window.__cableQaResizeError = String(error && error.stack || error)
    })
  }, 100)
})

render().catch((error) => {
  console.error(error)
  document.documentElement.dataset.error = String(error)
  document.body.textContent = String(error.stack || error)
})
