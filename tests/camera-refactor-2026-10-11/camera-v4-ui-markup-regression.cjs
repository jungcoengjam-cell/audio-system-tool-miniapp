'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const cameraWxml = fs.readFileSync(path.join(root, 'pages/camera/camera.wxml'), 'utf8')
const overlaysWxml = fs.readFileSync(path.join(root, 'pages/camera/camera-overlays.wxml'), 'utf8')
const reportPreviewWxml = fs.readFileSync(path.join(root, 'templates/result-report-preview.wxml'), 'utf8')
const cameraJs = fs.readFileSync(path.join(root, 'pages/camera/camera.js'), 'utf8')
const cameraProjectJs = fs.readFileSync(path.join(root, 'pages/camera/camera-project.js'), 'utf8')
const cameraReportUi = fs.readFileSync(path.join(root, 'pages/camera/camera-report-ui.js'), 'utf8')
const cameraWxss = fs.readFileSync(path.join(root, 'pages/camera/camera.wxss'), 'utf8')

const currentMarkup = `${cameraWxml}\n${overlaysWxml}`

assert(!/<(?:view|text)[^>]*class="[^"]*(?:page-header|page-title)/.test(cameraWxml),
  'camera page should not render the retired standalone page title')
assert(cameraWxml.includes('aria-label="摄像机安装计算"'),
  'camera scroll container should retain its accessible name')
assert(cameraWxml.includes('id="cameraResultPane"')
  && cameraWxml.includes('id="cameraResultHero"')
  && cameraWxml.includes('id="cameraInputCard"'),
'camera result and input regions should remain available')
assert(cameraWxml.indexOf('id="cameraResultHero"') < cameraWxml.indexOf('id="cameraInputCard"'),
  'the result graph should remain before the input card')

const resultHeroStart = cameraWxml.indexOf('id="cameraResultHero"')
const resultInputStart = cameraWxml.indexOf('id="cameraInputCard"', resultHeroStart)
const resultHeroMarkup = cameraWxml.slice(resultHeroStart, resultInputStart)
assert(!resultHeroMarkup.includes('camera-summary-secondary')
  && !resultHeroMarkup.includes('camera-summary-meta'),
  'the result hero should not add scene/margin/mount or limitation metadata rows')
const resultCanvasEnd = resultHeroMarkup.indexOf('</canvas>')
const resultPendingStart = resultHeroMarkup.indexOf('<view wx:if="{{resultUpdating}}"', resultCanvasEnd)
const resultPostChartMarkup = resultHeroMarkup.slice(resultPendingStart).trim()
const presentationMarkup = resultHeroMarkup.slice(resultCanvasEnd, resultPendingStart)
assert(resultCanvasEnd >= 0 && resultPendingStart > resultCanvasEnd
  && presentationMarkup.includes('class="camera-presentation-summary"')
  && presentationMarkup.includes('class="camera-presentation-status')
  && resultPostChartMarkup.startsWith('<view wx:if="{{resultUpdating}}"'),
  'the graph may include the required displayed tuple and its status, but no separate metadata section')

const canvasTag = cameraWxml.match(/<canvas type="2d" id="cameraFovCanvas"[^>]*>/)
assert(canvasTag
  && canvasTag[0].includes('{{result.displayModel}}')
  && canvasTag[0].includes('{{result.distanceReferenceText}}')
  && canvasTag[0].includes('{{result.presentationDistanceText}}')
  && canvasTag[0].includes('{{result.heightDisplayLabel}}')
  && canvasTag[0].includes('{{result.presentationHeightText}}')
  && canvasTag[0].includes('{{result.presentationPitchLabel}}')
  && canvasTag[0].includes('{{result.presentationStatusText}}'),
  'the accessible preview name should be bound to the displayed distance/height/pitch tuple and its status')
assert(!cameraWxml.includes('bindtap="onPreviewViewTap"')
  && !cameraWxml.includes('aria-label="示意图视角"')
  && cameraJs.includes("{ value: 'spatial', label: '三维示意' }"),
  'the approved unified spatial preview should not restore the removed plan/elevation controls')

assert(cameraWxml.includes('id="cameraInputTabs"')
  && cameraWxml.includes('id="cameraModelPicker"')
  && cameraWxml.includes('bindtap="openCameraSelector"'),
'catalog camera selection and grouped inputs should remain reachable')
assert(cameraWxml.includes('data-field="groundWidthText"')
  && cameraWxml.includes('data-field="groundDepthText"')
  && cameraWxml.includes('data-field="subjectHeightText"')
  && cameraWxml.includes('data-field="planeWidthText"')
  && cameraWxml.includes('data-field="planeHeightText"')
  && cameraWxml.includes('data-field="planeBottomHeightText"')
  && cameraWxml.includes('data-field="fixedCameraHeightText"'),
  'ground, target-plane, and existing-height inputs should remain in the current library flow')
assert(cameraWxml.includes('水平距离从镜头中心量到实际拍摄区前沿；区域按宽度中心线居中。')
  && cameraWxml.includes('水平距离从镜头中心量到目标平面。'),
  'input guidance should retain the established horizontal-distance references')

const railStart = cameraWxml.indexOf('id="cameraResultRail"')
const railEnd = cameraWxml.indexOf('id="cameraResultHero"', railStart)
const rail = cameraWxml.slice(railStart, railEnd)
const actions = [
  ['cameraReset', 'resetToDefaults'],
  ['cameraShare', 'generateResultReportImage'],
  ['cameraFavorite', 'toggleCurrentFavorite'],
  ['cameraProject', 'saveToActiveProject'],
]
assert(railStart >= 0 && railEnd > railStart, 'camera result action rail is missing')
actions.forEach(([id, handler]) => {
  assert(new RegExp(`<button id="${id}"[^>]*bindtap="${handler}"`).test(rail),
    `camera result rail is missing ${id}/${handler}`)
})
assert.equal((rail.match(/<button id="camera(?:Reset|Share|Favorite|Project)"/g) || []).length, 4,
  'the result rail should expose reset, report, favorite, and project actions')

assert(currentMarkup.includes('id="cameraLegacyUnsupported"')
  && currentMarkup.includes('id="cameraLegacySelectorButton"')
  && currentMarkup.includes('旧配置无法在当前版本计算'),
  'legacy custom preferences should remain explicitly unsupported with an opt-in catalog recovery path')
assert(currentMarkup.includes('id="cameraOperationUnsupported"'),
  'unbound structured operations should remain explicitly unsupported')
assert(cameraJs.includes("sourceMode: 'library'")
  && cameraJs.includes('legacyCustomUnsupported'),
  'the page should keep library-only calculation and legacy blocking semantics')

;[
  'cameraSourceTabs', 'cameraCustomPanel', 'cameraCopySummary', 'cameraCopyFull',
  'cameraResultTail', 'cameraDetailsContent', 'camera-details-card',
  'camera-formula-equation', 'camera-geometry-section', 'camera-primary-results',
  'camera-copy-actions', 'sourceModeIndex', 'customHorizontalFovText',
].forEach((marker) => assert(!cameraWxml.includes(marker),
  `retired camera custom/copy/derivation UI remains in the main page: ${marker}`))
assert(!cameraWxml.includes('bindtap="copyResult"')
  && !cameraWxml.includes('bindtap="copyInstallSummary"')
  && !cameraWxml.includes('bindtap="toggleCalculationDetails"')
  && !cameraWxml.includes('wx:for="{{result.calculationRows}}"'),
  'camera page should not restore standalone copy controls or derivation details')
assert(!cameraWxml.includes('镜头变焦端点')
  && !cameraWxml.includes('安装后转向'),
  'retired custom-zoom and post-install rotation UI should stay absent')

assert(cameraWxml.includes('<include src="./camera-overlays.wxml" />'),
  'the camera page should include its V4 project overlay')
;[
  'camera-project-overlay', 'camera-project-sheet', 'projectSearchText',
  'openCameraProjectCreateForm', 'createCameraProjectFromForm',
  'projectConfigName', 'projectConfigNote', 'onCameraProjectConfigNameInput',
  'onCameraProjectConfigNoteInput', 'saveCameraProjectTarget',
  'returnToCameraProjectSelection', 'retryCameraProjectRead',
].forEach((marker) => assert(overlaysWxml.includes(marker),
  `V4 project overlay is missing its selection/configuration flow: ${marker}`))
assert(cameraProjectJs.includes('addRecordToProject')
  && cameraProjectJs.includes('getProjectRecordView')
  && cameraProjectJs.includes('projectConfigName')
  && cameraProjectJs.includes('projectConfigNote'),
  'project-specific camera metadata should use the shared records API and scoped projection')

assert(cameraWxml.includes('<include src="../../templates/result-report-preview.wxml" />')
  && reportPreviewWxml.includes('bindtap="previewResultReportImage"')
  && reportPreviewWxml.includes('bindtap="shareResultReportImage"')
  && reportPreviewWxml.includes('bindtap="saveResultReportImage"')
  && cameraReportUi.includes('previewGeneratedImage(path)')
  && cameraReportUi.includes('accessLocalImage(path, openPreview, invalidate)')
  && !/resultReportImageViewer|setResultReportImageViewerScale|closeResultReportImageViewer/.test(
    overlaysWxml + cameraReportUi + cameraJs + cameraWxss,
  )
  && !cameraWxss.includes('camera-original-image-viewer'),
  'report preview must retain native original-image, share, and save actions without a page-local viewer')

if (require.main === module) process.stdout.write('camera V4 UI markup regression: PASS\n')

module.exports = { run: () => true }
