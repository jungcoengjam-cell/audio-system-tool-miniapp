const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const baseline = require('./ui-test-first.json')

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

function normalizeLineEndings(source) {
  return source.replace(/\r\n?/g, '\n')
}

function expandIncludes(source, fromFile, stack = []) {
  return source.replace(/<include\s+src="([^"]+)"\s*\/>/g, (_match, includePath) => {
    const resolved = path.resolve(path.dirname(fromFile), includePath)
    assert(resolved.startsWith(`${root}${path.sep}`), `WXML include escapes workspace: ${includePath}`)
    assert(!stack.includes(resolved), `WXML include cycle: ${includePath}`)
    return expandIncludes(fs.readFileSync(resolved, 'utf8'), resolved, [...stack, resolved])
  })
}

for (const [relativePath, expectedHash] of Object.entries(baseline.expandedWxmlSha256)) {
  assert.match(expectedHash, /^[0-9a-f]{64}$/, `missing test-first WXML hash: ${relativePath}`)
  const file = path.join(root, relativePath)
  const source = fs.readFileSync(file, 'utf8')
  const expanded = expandIncludes(source, file)
  const dmxLayoutPages = new Set([
    'pages/dmx-layout/dmx-layout.wxml',
    'pages/dmx-layout-landscape/dmx-layout-landscape.wxml'
  ])
  let hashInput = normalizeLineEndings(expanded)
  if (relativePath === 'pages/cable/cable.wxml') {
    const overlay = read('pages/cable/cable-overlays.wxml')
    const controller = read('pages/cable/cable.js')
    const reportUi = read('pages/cable/cable-report.js')
    const styles = read('pages/cable/cable.wxss')
    const sharedPreview = read('templates/result-report-preview.wxml')
    const actions = [...source.matchAll(/<button class="action-button"[^>]*>[\s\S]*?<\/button>/g)]
    const actionNames = actions.map(([button]) => button.match(/bindtap="([^"]+)"/)?.[1] || '')
    const railRule = styles.match(/\.action-rail\s*\{([^}]*)\}/)
    const buttonRule = styles.match(/\.action-button\.action-button\s*\{([^}]*)\}/)
    const actionButtonProperties = {}
    if (buttonRule) {
      buttonRule[1].split(';').forEach((declaration) => {
        const colon = declaration.indexOf(':')
        if (colon >= 0) actionButtonProperties[declaration.slice(0, colon).trim()] = declaration.slice(colon + 1).trim()
      })
    }
    assert(source.indexOf('class="result-pane"') < source.indexOf('class="input-pane"'),
      'cable result pane must precede its input pane')
    assert(source.includes('<include src="./cable-overlays.wxml" />')
      && source.includes('<include src="../../templates/result-report-preview.wxml" />')
      && (source.match(/<include src="\.\.\/\.\.\/templates\/result-report-preview\.wxml"\s*\/>/g) || []).length === 1,
    'cable must include exactly one shared report preview template')
    assert.equal(actions.length, 4, 'cable result rail must keep exactly four actions')
    assert.deepEqual(actionNames, [
      'resetInputs', 'generateResultReportImage', 'toggleCurrentFavorite', 'saveToActiveProject',
    ], 'cable result actions must expose reset, image share, favorite, and project save')
    assert(actions.every(([button]) => button.includes('aria-label="')),
      'cable result actions must have explicit accessible labels')
    assert(actions.every(([button]) => button.includes('disabled="{{')),
      'cable result actions must expose disabled state while inputs are pending or invalid')
    for (const icon of ['icon-reset', 'icon-share', 'icon-bookmark', 'icon-folder']) {
      assert(source.includes(`class="action-icon ${icon}`) && styles.includes(`.${icon}`),
        `cable action rail is missing its ${icon} vector mask`)
    }
    assert(source.includes('result.warnings.length')
      && source.includes('result.formulaMinimumArea')
      && source.includes('result.currentA')
      && source.includes('result.selectedArea')
      && source.includes('result.description')
      && source.includes('class="warning-card"')
      && !source.includes('class="formula-card"')
      && !source.includes('S ≥ P × L × 5'),
    'cable page must remove the standalone formula card while retaining real secondary results, description, and warnings')
    assert(!source.includes('copyResult') && !overlay.includes('copyResult')
      && !/setClipboardData|复制选型文字/.test(source + overlay),
    'cable must not expose a copy action in the page or share sheet')
    assert(source.indexOf('class="cable-spec"') < source.indexOf('class="secondary-card"')
      && source.indexOf('class="secondary-card"') < source.indexOf('class="result-facts"'),
    'cable result hierarchy must show the main and secondary result before compact conditions')
    const pageContent = source.slice(source.indexOf('<scroll-view class="page-scroll"'), source.indexOf('<include src="./cable-overlays.wxml"'))
    assert.equal((pageContent.match(/<scroll-view\b/g) || []).length, 1,
      'cable page content must use one full-page scroll container')
    assert(!pageContent.includes('result-details-scroll') && !pageContent.includes('editor-scroll')
      && styles.includes('.page-scroll{') && styles.includes('.editor-fields{'),
    'cable result and input content must use ordinary views inside the full-page scroller')
    for (const selector of [
      '.cable-spec', '.mode-tab.mode-tab-active .mode-label', '.input-unit', '.result-label',
    ]) assert(styles.includes(selector), 'cable visual regression selector is missing: ' + selector)
    assert(!styles.includes('.formula-title') && !styles.includes('.formula-text'),
      'formula-card-only styles must be removed with the standalone page card')
    assert(railRule?.[1].includes('position:absolute')
      && railRule[1].includes('width:44px'),
    'cable result rail must float above the full-width result card')
    assert(actionButtonProperties['box-sizing'] === 'border-box'
      && actionButtonProperties.display === 'flex'
      && ['width', 'min-width', 'max-width', 'height', 'min-height', 'max-height']
        .every((property) => actionButtonProperties[property] === '44px'),
    'cable native buttons must remain fixed 44px circles')
    assert(styles.includes('mask-image:url("data:image/svg+xml,')
      && styles.includes('-webkit-mask-image:url("data:image/svg+xml,'),
    'cable icons must use local SVG masks without runtime requests')
    assert(overlay.includes('bindinput="onProjectSearch"')
      && overlay.includes('class="project-list"')
      && overlay.includes('class="project-current"')
      && overlay.includes('maxlength="30"')
      && overlay.includes('class="project-target-name"')
      && overlay.includes('class="project-preview"')
      && overlay.includes('projectFrozenTitle') && overlay.includes('projectFrozenSummary')
      && !overlay.includes('projectFrozenResultText')
      && overlay.includes('class="project-config-name"')
      && overlay.includes('maxlength="60"')
      && overlay.includes('bindinput="onProjectConfigNameInput"')
      && overlay.includes('class="project-config-note"')
      && overlay.includes('maxlength="200"')
      && overlay.includes('bindinput="onProjectConfigNoteInput"')
      && overlay.includes('scroll-into-view="{{projectFocusedInputId}}"')
      && overlay.includes('bindtap="saveProjectTarget"')
      && controller.includes('getPreferences(state = this.data)')
      && controller.includes('getResultText(state = this.data, result = state.result)')
      && controller.includes('getRecordPayload(state = this.data, result = state.result)')
      && controller.includes('getRecordLookupPayload()')
      && controller.includes('isProjectSavePayloadCurrent()')
      && controller.includes('getProjectRecordView')
      && controller.includes('name: projectConfigName')
      && controller.includes('note: projectConfigNote'),
    'cable project sheet must search, select, confirm, freeze the record payload, and persist project-scoped metadata')
    assert.equal((overlay.match(/<scroll-view\b/g) || []).length, 4,
      'each cable project step must own one scroll body')
    assert(!overlay.includes('cable-original-image-viewer')
      && !overlay.includes('resultReportImageViewerVisible')
      && !overlay.includes('setResultReportImageViewerScale')
      && !reportUi.includes('resultReportImageViewer')
      && reportUi.includes('previewGeneratedImage(path)')
      && reportUi.includes('stopTap()')
      && reportUi.includes('preventTouchMove()')
      && sharedPreview.includes('catchtap="stopTap"')
      && sharedPreview.includes('catchtouchmove="preventTouchMove"'),
    'cable must remove its page-local viewer while retaining shared preview touch handlers and the native preview helper')
    assert(sharedPreview.includes('bindtap="previewResultReportImage"')
      && sharedPreview.includes('bindtap="shareResultReportImage"')
      && sharedPreview.includes('bindtap="saveResultReportImage"'),
    'shared cable preview must preserve original image preview, share, and save actions')
    assert(!/bindtap="\{\{/.test(source + overlay),
      'cable WXML event names must use static handlers')
  }
  if (relativePath === 'pages/spl/spl.wxml') {
    const styles = read('pages/spl/spl.wxss')
    const controller = read('pages/spl/spl.js')
    const report = read('pages/spl/spl-report.js')
    const actions = [...source.matchAll(/<button\b[^>]*class="action-button"[^>]*>([\s\S]*?)<\/button>/g)]
    const actionNames = actions.map(([button]) => button.match(/bindtap="([^"]+)"/)?.[1] || '')
    assert.equal(actions.length, 4, 'SPL action rail must keep exactly four actions')
    assert.deepEqual(actionNames, [
      'requestReset', 'openSharePreview', 'toggleCurrentFavorite', 'openProjectSheet',
    ], 'SPL action rail must expose reset, share preview, favorite, and project save')
    assert(actions.every(([button]) => button.includes('aria-label="') && button.includes('disabled="{{')),
      'SPL action rail buttons must expose accessible labels and state-dependent disabling')
    for (const icon of ['icon-reset', 'icon-share', 'icon-bookmark', 'icon-folder']) {
      assert(source.includes(`class="action-icon ${icon}`) && styles.includes(`.${icon}`),
        `SPL action rail is missing its ${icon} icon`)
    }
    assert(!source.includes('copyResult') && !/setClipboardData|复制/.test(source),
      'SPL page must not expose the removed copy-result UI')
    assert(source.includes('canvas-id="resultReportCanvas"')
      && source.includes('class="result-report-canvas-offscreen"'),
    'SPL must retain its offscreen result-report canvas')
    assert(source.includes('result.selectedSpl')
      && source.includes('result.oneMeterSpl')
      && source.includes('result.summationGainDb')
      && source.includes('result.speakerCount')
      && source.includes('自由场理论估算')
      && source.includes('该数值不是现场实测声压级'),
    'SPL page must retain its core result and free-field estimate qualification')
    const resultCard = source.indexOf('class="result-card result-card-tabs"')
    const tabList = source.indexOf('class="result-tabs" role="tablist"')
    const splTab = source.indexOf('id="splTabResult"')
    const distanceTab = source.indexOf('id="splTabDistance"')
    const referenceTab = source.indexOf('id="splTabReference"')
    const splPanel = source.indexOf('id="splPanelResult"')
    const distanceListMarkup = source.indexOf('class="distance-list"')
    const references = source.indexOf('class="reference-tab-item"')
    const inputCard = source.indexOf('<view class="card settings-card">')
    assert(resultCard >= 0 && tabList > resultCard && splTab > tabList && distanceTab > splTab
      && referenceTab > distanceTab && splPanel > referenceTab && distanceListMarkup > splPanel
      && references > distanceListMarkup && inputCard > references,
    'SPL result card must contain the three tab controls and full result, distance, and reference panes before inputs')
    for (const [id, target, key] of [
      ['splTabResult', 'splPanelResult', 'spl'],
      ['splTabDistance', 'splPanelDistance', 'distance'],
      ['splTabReference', 'splPanelReference', 'reference'],
    ]) {
      const tab = source.match(new RegExp(`<view id="${id}"[^>]*>`))?.[0] || ''
      const panel = source.match(new RegExp(`<view[^>]*id="${target}"[^>]*role="tabpanel"[^>]*>`))?.[0] || ''
      assert(tab.includes('role="tab"') && tab.includes(`data-tab="${key}"`)
        && tab.includes('aria-selected="{{resultTab ===') && tab.includes(`aria-controls="${target}"`)
        && tab.includes('bindtap="onResultTabTap"') && panel.includes(`aria-labelledby="${id}"`),
      `SPL ${key} tab must bind the production handler and label its matching panel`)
    }
    assert(source.includes('class="result-tabs" role="tablist" aria-label="声压级结果分类"')
      && source.includes('id="splPanelDistance" class="result-tab-panel result-tab-distance" role="tabpanel"')
      && source.includes('id="splPanelReference" class="result-tab-panel result-tab-reference" role="tabpanel"')
      && source.includes('class="reference-tab-footer"')
      && source.includes('class="distance-mode-note"'),
    'SPL tabs must retain semantic panels, the complete distance condition, and reference footer')
    assert(!source.includes('splDetailPanel') && !source.includes('splResultDetails')
      && !source.includes('splDetailClose') && !source.includes('detailsSheetVisible')
      && !controller.includes('openSplDetails') && !controller.includes('closeSplDetails'),
    'the replaced SPL detail drawer must not leave obsolete markup or controller methods')
    assert(controller.includes("resultTab: 'spl'") && controller.includes('onResultTabTap(event)')
      && controller.includes("!['spl', 'distance', 'reference'].includes(tab)")
      && controller.includes("this.setData({ resultTab: tab })")
      && controller.includes("vibrate('light')"),
    'SPL tab selection must default to the main pane and use the guarded light-haptic controller')
    assert(source.includes('class="page-scroll"') && styles.includes('.page-root{overflow:visible}')
      && styles.includes('.page-scroll{height:100vh;overflow:visible}')
      && styles.includes('.result-grid-home{')
      && source.includes('class="metric-value">{{result.oneMeterSpl}} dB SPL</view>')
      && source.includes('class="metric-value">{{result.totalRatedPower}} W</view>'),
    'SPL home must retain one-screen output and both key secondary metrics without clipping the page')
    assert(source.includes('<picker range="{{countPickerOptions}}" value="{{countIndex + 1}}" bindchange="onCountPickerChange">')
      && source.includes("countIndex >= 0 ? counts[countIndex] + ' 只' : '请选择数量'")
      && controller.includes('onCountPickerChange(event)')
      && controller.includes('detail: { value: pickerIndex - 1 }'),
    'blank count placeholder must map through the UI adapter while numeric countIndex stays unchanged')
    assert(source.includes('class="share-image-frame" style="{{shareImageFrameStyle}}"')
      && source.includes('class="share-image" src="{{resultReportImagePath}}" mode="aspectFit"')
      && !source.includes('share-image-scroll')
      && controller.includes('updateShareImageLayout()')
      && !controller.includes('updateShareImageScrollStyle'),
    'SPL preview must fit the entire image in a non-scrolling frame and keep native image preview')
    const resultGrid = /\.result-grid\s*\{([^}]*)\}/.exec(styles)?.[1] || ''
    const resultGridTop = Number(/margin-top\s*:\s*(\d+(?:\.\d+)?)px/.exec(resultGrid)?.[1] || 0)
    assert(resultGridTop >= 52,
      'SPL metric grid must keep enough vertical separation from the four-button action rail')
    const distanceBaseStyleStart = styles.search(/\.distance-list\s*\{/)
    assert(distanceBaseStyleStart >= 0, 'SPL base distance-list CSS rule is missing')
    const distanceStyleSource = styles.slice(distanceBaseStyleStart)
    const cssRule = (selector, source = distanceStyleSource) => source.match(
      new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`)
    )?.[1] || ''
    const distanceList = cssRule('.distance-list')
    const distanceRow = cssRule('.distance-list .distance-row')
    const distanceHead = cssRule('.distance-list .distance-row-head')
    const distanceValue = cssRule('.distance-list .distance-value')
    const distanceSpl = cssRule('.distance-list .distance-spl')
    const distanceResult = cssRule('.distance-list .distance-result')
    const distanceCurrent = cssRule('.distance-list .distance-current')
    const narrowDistanceStart = styles.lastIndexOf('@media(max-width:360px){')
    const narrowDistanceEnd = styles.indexOf('@media(', narrowDistanceStart + 1)
    const narrowDistanceMedia = narrowDistanceStart < 0 ? ''
      : styles.slice(narrowDistanceStart, narrowDistanceEnd < 0 ? styles.length : narrowDistanceEnd)
    const narrowDistanceValue = /\.distance-list\s+\.distance-value\s*\{([^}]*)\}/.exec(narrowDistanceMedia)?.[1] || ''
    const narrowDistanceSpl = /\.distance-list\s+\.distance-spl\s*\{([^}]*)\}/.exec(narrowDistanceMedia)?.[1] || ''
    assert(distanceList.includes('display:flex') && distanceList.includes('flex-direction:column')
      && distanceRow.includes('display:flex') && distanceRow.includes('flex-direction:row')
      && /min-width\s*:\s*0/.test(distanceHead) && /flex\s*:\s*1\s+1\s+auto/.test(distanceHead)
      && /min-width\s*:\s*0/.test(distanceValue) && /flex\s*:\s*0\s+1\s+auto/.test(distanceValue)
      && /white-space\s*:\s*normal/.test(distanceValue) && /overflow-wrap\s*:\s*anywhere/.test(distanceValue)
      && /line-height\s*:\s*1\.35/.test(distanceValue)
      && /font-size\s*:\s*11px/.test(narrowDistanceValue)
      && /min-width\s*:\s*0/.test(distanceSpl) && /flex\s*:\s*0\s+0\s+auto/.test(distanceSpl)
      && /font-size\s*:\s*14px/.test(distanceSpl) && /white-space\s*:\s*nowrap/.test(distanceSpl)
      && /font-size\s*:\s*14px/.test(narrowDistanceSpl)
      && /flex-wrap\s*:\s*nowrap/.test(distanceResult)
      && /flex\s*:\s*none/.test(distanceCurrent)
      && !styles.includes('distance-row-last') && !styles.includes('.distance-grid'),
    'SPL distance comparison must keep a natural-height list, wrap-safe complete labels, aligned row contents, and fixed readable single-line SPL text')
    assert(styles.includes('animation:spl-sheet-slide-in 320ms cubic-bezier(.2,.72,.25,1) both')
      && styles.includes('animation:spl-sheet-slide-out 320ms ease-in both;pointer-events:none')
      && styles.includes('@keyframes spl-sheet-slide-in{from{transform:translateY(calc(100% + env(safe-area-inset-bottom)))}to{transform:translateY(0)}}')
      && styles.includes('@keyframes spl-sheet-slide-out{from{transform:translateY(0)}to{transform:translateY(calc(100% + env(safe-area-inset-bottom)))}}'),
    'SPL sheets must use full-height bottom slide transitions with the 320ms close lifecycle')
    assert(!/@keyframes\s+spl-sheet-slide-(?:in|out)[^{]*\{[^}]*opacity\s*:/.test(styles)
      && /@media\(prefers-reduced-motion:reduce\)\{[^}]*\.spl-sheet[^}]*animation-duration:\.01ms!important/.test(styles),
    'SPL sheet transitions remain translate-only and honor reduced-motion preferences')
    assert(report.includes('REPORT_WIDTH = 750')
      && report.includes('const SIDE_MARGIN = 44')
      && report.includes('const CARD_PADDING = 28')
      && report.includes('const CARD_WIDTH = REPORT_WIDTH - (SIDE_MARGIN * 2)'),
    'SPL local report must use the 750px cable-report side margin and card padding')
    const approvedSplHash = baseline.approvedSplRefactorExpandedWxmlSha256
    assert.match(approvedSplHash || '', /^[0-9a-f]{64}$/, 'missing approved SPL refactor WXML hash')
    assert.equal(sha256(Buffer.from(hashInput)), approvedSplHash,
      'expanded SPL WXML changed after its explicitly approved refactor')
    continue
  }
  if (relativePath === 'pages/gain-structure/gain-structure.wxml') {
    const overlay = read('pages/gain-structure/gain-overlays.wxml')
    const controller = read('pages/gain-structure/gain-structure.js')
    const styles = read('pages/gain-structure/gain-structure.wxss')
    const hasWxmlClass = (className) => [...source.matchAll(/class="([^"]*)"/g)]
      .some((match) => match[1].split(/\s+/).includes(className))
    assert(source.indexOf('class="result-pane"') < source.indexOf('class="input-pane"'),
      'gain output must precede its independent input pane')
    assert(source.includes('<page-container') && source.includes('onPageContainerBeforeLeave')
      && source.includes('onPageContainerAfterLeave') && source.includes('class="sheet-mask {{'),
    'gain overlays must support native back lifecycle and a fallback mask')
    assert(source.includes('<include src="./gain-overlays.wxml" />'),
      'gain page must use its local overlay contract')
    assert(source.includes('class="result-report-canvas-offscreen"')
      && source.includes('canvas-id="resultReportCanvas"'),
    'gain page must keep its local report canvas')
    assert(!source.includes('bindtap="calculate"')
      && !source.includes('calculate-button')
      && !source.includes('重新计算')
      && !source.includes('再计算'),
    'gain page must update complete inputs automatically without a manual calculate CTA')
    assert((source.match(/bindtap="requestReset"|bindtap="openSharePreview"|bindtap="toggleCurrentFavorite"|bindtap="openProjectSheet"/g) || []).length === 4,
      'gain result rail must expose reset, share, favorite, and project actions')
    assert(source.includes('disabled="{{!canReset}}"')
      && source.includes('disabled="{{!hasValidResult}}"'),
    'gain actions must expose their explicit disabled states')
    assert(hasWxmlClass('placement-warning')
      && source.includes('result.placementWarning')
      && hasWxmlClass('amplifier-setting')
      && source.includes('功放输入控制保持 0 dB'),
    'gain result must show output placement and fixed amplifier setting')
    assert(source.includes('calculationState === \'incomplete\'')
      && source.includes('输入完整后结果会自动更新'),
    'gain page must clear stale results and explain when dependencies are incomplete')
    assert(source.includes("result.alignmentMode === 'insufficientDrive'")
      && source.includes('result.primaryValue'),
    'gain result must distinguish insufficient drive in its primary output')
    assert(source.includes("activeGroup === 'load'") && source.includes('wx:if="{{showPowerContext}}"'),
      'gain load controls must be conditional on voltage-gain models')
    assert((source.match(/<view wx:if="\{\{loadReminderActive\}\}"/g) || []).length === 2,
      'gain load reminder must remain visible in both result and input context')
    assert(overlay.includes('bindtap="shareResultReportImage"')
      && overlay.includes('bindtap="saveResultReportImage"')
      && overlay.includes('bindtap="retryResultReport"')
      && overlay.includes('isCheckingResultReportCache'),
    'gain local preview must include send/save, loading, retry, and error handling')
    assert(!overlay.includes('result-report-preview.wxml')
      && !source.includes('../..\/templates\/result-report-preview.wxml'),
    'gain must not duplicate the shared preview overlay')
    const projectConfigElement = (field) => {
      const marker = 'data-project-field="' + field + '"'
      const markerIndex = overlay.indexOf(marker)
      if (markerIndex < 0) return ''
      const start = overlay.lastIndexOf('<', markerIndex)
      const end = overlay.indexOf('>', markerIndex)
      return start < 0 || end < 0 ? '' : overlay.slice(start, end + 1)
    }
    const projectConfigNameElement = projectConfigElement('projectConfigName')
    const projectConfigNoteElement = projectConfigElement('projectConfigNote')
    assert(/wx:(?:if|elif)="\{\{projectStep === 'details'\}\}"/.test(overlay)
      && overlay.includes('bindtap="saveProjectConfiguration"')
      && overlay.includes('bindtap="createProjectFromForm"')
      && overlay.includes('class="project-target-name"')
      && overlay.includes('bindinput="onProjectSearch"')
      && projectConfigNameElement.includes('value="{{projectConfigName}}"')
      && projectConfigNameElement.includes('maxlength="60"')
      && projectConfigNameElement.includes('bindinput="onProjectConfigNameInput"')
      && projectConfigNoteElement.includes('value="{{projectConfigNote}}"')
      && projectConfigNoteElement.includes('maxlength="200"')
      && projectConfigNoteElement.includes('bindinput="onProjectConfigNoteInput"')
      && controller.includes('onProjectConfigNameInput')
      && controller.includes('onProjectConfigNoteInput'),
    'gain project sheet must select/search/create and bind each configuration field to its value, limit, and handler')

    const projectSaveCall = controller.match(/addRecordToProject\(\s*frozen\.payload\s*,\s*(?:target\.id|targetId)\s*,\s*\{([^}]*)\}\s*\)/)
    const metadataArgument = projectSaveCall?.[1] || ''
    assert(projectSaveCall
      && /\bname\s*:\s*configName\b/.test(metadataArgument)
      && /\bnote\s*:\s*configNote\b/.test(metadataArgument),
    'gain project writes must pass an inline metadata object with the explicit name and note fields')
    assert(controller.includes('function getInputReadiness(state)')
      && controller.includes('derivePageResult(pageState, hasDraftInputs)')
      && controller.includes('this._inputRevision === inputRevision'),
    'gain controller must derive complete inputs and reject callbacks from an older input revision')

    const actionButtonRule = styles.match(/\.action-button\.action-button\s*\{([^}]*)\}/)
    const actionButtonProperties = {}
    if (actionButtonRule) {
      actionButtonRule[1].split(';').forEach((declaration) => {
        const colon = declaration.indexOf(':')
        if (colon >= 0) {
          actionButtonProperties[declaration.slice(0, colon).trim()] = declaration.slice(colon + 1).trim()
        }
      })
    }
    assert(styles.includes('.result-pane{position:relative;')
      && styles.includes('.editor-scroll{')
      && styles.includes('.category-chip{display:flex;box-sizing:border-box;min-width:44px;')
      && actionButtonProperties['box-sizing'] === 'border-box'
      && actionButtonProperties.display === 'flex'
      && actionButtonProperties['align-items'] === 'center'
      && actionButtonProperties['justify-content'] === 'center'
      && ['width', 'min-width', 'max-width', 'height', 'min-height', 'max-height']
        .every((property) => actionButtonProperties[property] === '44px'),
    'gain result and input layout must keep their sizing, while action buttons stay centered in a 44px box')
    continue
  }
  if (dmxLayoutPages.has(relativePath)) {
    const newStart = '<view wx:if="{{batchVisible}}" class="batch-sheet-overlay"><view class="batch-sheet-backdrop" bindtap="closeBatchPlacement"></view><scroll-view class="batch-sheet" scroll-y="{{isLandscape}}" enhanced show-scrollbar="{{false}}" catchtap="stopTap"><view class="batch-sheet-content">'
    const oldStart = '<view wx:if="{{batchVisible}}" class="batch-sheet-overlay" bindtap="closeBatchPlacement" catchtouchmove="preventTouchMove"><view class="batch-sheet" catchtap="stopTap">'
    const newEnd = '</view></view></scroll-view></view>'
    const oldEnd = '</view></view></view>'
    assert.equal(hashInput.split(newStart).length - 1, 1,
      `expected one complete approved batch wrapper: ${relativePath}`)
    assert.equal(hashInput.split(newEnd).length - 1, 1,
      `expected one complete approved batch wrapper close: ${relativePath}`)
    assert.equal((hashInput.match(/<scroll-view class="batch-sheet" scroll-y="\{\{isLandscape\}\}" enhanced show-scrollbar="\{\{false\}\}" catchtap="stopTap"><view class="batch-sheet-content">/g) || []).length, 1,
      `expected one approved native batch scroll structure: ${relativePath}`)
    assert.equal((hashInput.match(/<view class="batch-sheet-backdrop" bindtap="closeBatchPlacement"><\/view>/g) || []).length, 1,
      `expected one approved batch backdrop: ${relativePath}`)
    assert.equal((hashInput.match(/物理排列方向/g) || []).length, 1,
      `expected one approved direction label change: ${relativePath}`)
    assert.equal((hashInput.match(/（同杆分组均匀交错）/g) || []).length, 1,
      `expected one approved interleaving label change: ${relativePath}`)
    hashInput = hashInput
      .replace(newStart, oldStart)
      .replace(newEnd, oldEnd)
      .replace('物理排列方向', '物理排列')
      .replace('（同杆分组均匀交错）', '（按地址排序）')
    if (relativePath === 'pages/dmx-layout/dmx-layout.wxml') {
      const newCanvas = 'class="result-report-canvas-offscreen"\nwidth="{{exportCanvasWidth}}"\nheight="{{exportCanvasHeight}}"\nstyle="width:{{exportCanvasWidth}}px;height:{{exportCanvasHeight}}px;"'
      const oldCanvas = 'class="result-report-canvas-offscreen"\nwidth="{{canvasWidth}}"\nheight="{{canvasHeight}}"\nstyle="width:{{canvasWidth}}px;height:{{canvasHeight}}px;"'
      assert.equal(hashInput.split(newCanvas).length - 1, 1, `expected one independent export canvas: ${relativePath}`)
      hashInput = hashInput.replace(newCanvas, oldCanvas)
    } else {
      const newCanvas = 'class="export-canvas" width="{{exportCanvasWidth}}" height="{{exportCanvasHeight}}" style="width:{{exportCanvasWidth}}px;height:{{exportCanvasHeight}}px;"'
      const oldCanvas = 'class="export-canvas" width="{{canvasWidth}}" height="{{canvasHeight}}" style="width:{{canvasWidth}}px;height:{{canvasHeight}}px;"'
      assert.equal(hashInput.split(newCanvas).length - 1, 1, `expected one independent export canvas: ${relativePath}`)
      hashInput = hashInput.replace(newCanvas, oldCanvas)
    }
  }
  assert.equal(sha256(Buffer.from(hashInput)), expectedHash, `expanded WXML changed: ${relativePath}`)
}

assert.match(read('pages/common/operation-confirmation.wxml'), /confirmOperationField/,
  'shared operation confirmation template has no real confirm action')
assert.match(read('pages/common/operation-confirmation.wxml'), /!operationActive/,
  'shared operation confirmation template hides an invalidated operation')
assert.match(read('pages/common/operation-confirmation.wxml'), /endOperation/,
  'shared operation confirmation template has no explicit end action')
assert.match(read('pages/common/operation-confirmation.wxml'), /item\.confirmed/,
  'shared operation confirmation template must show confirmation state accurately')

const keptImagePath = path.join(root, 'assets/home/module-audio-wiring-catalog.png')
assert.equal(sha256(fs.readFileSync(keptImagePath)), baseline.xlrImageSha256, 'kept XLR image bytes changed')
assert(!fs.existsSync(path.join(root, 'pages/audio-wiring/assets/xlr.png')), 'duplicate XLR image still exists')
const wiringModel = read('pages/audio-wiring/wiring-model.js')
assert.equal((wiringModel.match(/image: '\/assets\/home\/module-audio-wiring-catalog\.png'/g) || []).length, 2,
  'XLR input/output options must both use the retained production asset')
assert(!wiringModel.includes('/pages/audio-wiring/assets/xlr.png'), 'wiring model still references the removed duplicate')

console.log('Package reclaim UI/resource equivalence passed (expanded WXML hashes and XLR asset identity).')
