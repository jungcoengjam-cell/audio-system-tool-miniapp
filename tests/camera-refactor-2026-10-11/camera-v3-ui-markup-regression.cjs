'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const cameraWxml = fs.readFileSync(path.join(root, 'pages/camera/camera.wxml'), 'utf8')
const cameraWxss = fs.readFileSync(path.join(root, 'pages/camera/camera.wxss'), 'utf8')
const reportPreviewWxml = fs.readFileSync(path.join(root, 'templates/result-report-preview.wxml'), 'utf8')

function lastDeclaration(selector, property) {
  const rules = [...cameraWxss.replace(/\s+/g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, selectors]) => selectors.split(',').some((item) => item.trim() === selector))
  const declarations = rules.flatMap(([, , body]) => body.split(';')
    .map((item) => item.trim())
    .filter((item) => item.startsWith(`${property}:`)))
  return declarations.at(-1)?.slice(property.length + 1)
}

assert(!/<(?:view|text)[^>]*class="[^"]*(?:page-header|page-title)/.test(cameraWxml),
  'camera V3 should not render the retired page title')
assert(cameraWxml.includes('aria-label="摄像机安装计算"'),
  'camera scroll container should retain its accessible name')
assert(cameraWxml.includes('id="cameraResultPane" class="camera-result-pane"'),
  'camera result pane is missing')
assert(cameraWxml.includes('id="cameraResultHero" class="camera-result-screen"'),
  'camera main result graph is missing')
assert(cameraWxml.includes('id="cameraInputCard" class="card camera-input-card"'),
  'camera input card is missing')
assert(cameraWxml.indexOf('id="cameraResultHero"') < cameraWxml.indexOf('id="cameraInputCard"'),
  'camera graph should precede the input card')
assert(cameraWxml.includes('id="cameraInputTabs"')
  && cameraWxml.includes('id="cameraModelPicker"')
  && cameraWxml.includes('bindtap="openCameraSelector"'),
'library model and input controls should remain reachable')
assert(cameraWxml.includes('input-wrap-error') && cameraWxml.includes('class="input-error"'),
  'active input validation should keep field-local styling')
assert(cameraWxml.includes('水平距离从镜头中心量到实际拍摄区前沿；区域按宽度中心线居中。')
  && cameraWxml.includes('水平距离从镜头中心量到目标平面。'),
'camera input guidance should explain the horizontal distance origin and target for both scenes')
assert(cameraWxml.includes('<canvas type="2d" id="cameraFovCanvas"')
  && !cameraWxml.includes('canvas-id="cameraFovCanvas"'),
  'camera graph should use the current 2D Canvas API')
assert(cameraWxml.includes('class="camera-preview-tabs"')
  && cameraWxml.includes('bindtap="onPreviewViewTap"'),
  'plan/elevation preview tabs are missing')

const railStart = cameraWxml.indexOf('id="cameraResultRail"')
const heroStart = cameraWxml.indexOf('id="cameraResultHero"')
const rail = cameraWxml.slice(railStart, heroStart)
assert(railStart >= 0 && heroStart > railStart && rail.includes('class="camera-result-rail"'),
  'floating result action rail should be inside the result pane before the graph')
const actionBindings = [
  ['cameraReset', 'resetToDefaults'],
  ['cameraShare', 'generateResultReportImage'],
  ['cameraFavorite', 'toggleCurrentFavorite'],
  ['cameraProject', 'saveToActiveProject'],
]
actionBindings.forEach(([id, handler]) => {
  assert(new RegExp(`<button id="${id}" class="camera-action-button"(?=[^>]*bindtap="${handler}")[^>]*>`).test(rail),
    `camera action rail is missing ${id}/${handler}`)
})
assert.equal((rail.match(/<button id="camera(?:Reset|Share|Favorite|Project)"/g) || []).length, 4,
  'floating rail should contain exactly reset/share/favorite/project')
assert.equal(lastDeclaration('.camera-result-rail', 'position'), 'absolute',
  'result action rail should overlay the result pane')
assert.equal(lastDeclaration('button.camera-action-button', 'width'), '44px',
  'action buttons should remain at least a 44px touch target')
assert.equal(lastDeclaration('button.camera-action-button', 'height'), '44px',
  'action buttons should remain at least a 44px touch target')
assert.equal(lastDeclaration('button.camera-action-button', 'border-radius'), '50%',
  'action buttons should remain circular')
assert.equal(lastDeclaration('.camera-result-screen', 'margin-right'), '0',
  'the main graph should not reserve an offset column for the action rail')

const canvasTag = cameraWxml.match(/<canvas type="2d" id="cameraFovCanvas"[^>]*>/)
assert(canvasTag
  && canvasTag[0].includes('{{result.distanceReferenceText}}')
  && canvasTag[0].includes('{{result.primaryDistanceMeters}}')
  && canvasTag[0].includes('{{result.heightDisplayLabel}}')
  && canvasTag[0].includes('{{result.cameraHeightMeters}}'),
'graph accessibility text should expose the live distance and camera-height values')

assert(cameraWxml.includes('id="cameraLegacyUnsupported"')
  && cameraWxml.includes('id="cameraLegacySelectorButton"')
  && cameraWxml.includes('旧配置无法在当前版本计算'),
'legacy custom preferences should expose an explicit unsupported recovery path')
assert(cameraWxml.includes('id="cameraOperationUnsupported"'),
  'unbound structured operations should have an explicit unsupported state')
assert(cameraWxml.includes('<include src="../../templates/result-report-preview.wxml" />')
  && cameraWxml.includes('bindtap="generateResultReportImage"')
  && reportPreviewWxml.includes('bindtap="shareResultReportImage"')
  && reportPreviewWxml.includes('bindtap="saveResultReportImage"'),
'result image generation, share, and save actions should remain available')

;[
  'cameraSourceTabs', 'cameraCustomPanel', 'cameraCopySummary', 'cameraCopyFull',
  'cameraResultTail', 'cameraDetailsContent', 'camera-details-card',
  'camera-formula-equation', 'camera-geometry-section', 'camera-primary-results',
  'camera-copy-actions', 'sourceModeIndex', 'customHorizontalFovText',
].forEach((marker) => assert(!cameraWxml.includes(marker),
  `retired camera source/copy/derivation UI remains in WXML: ${marker}`))
assert(!cameraWxml.includes('bindtap="copyResult"')
  && !cameraWxml.includes('bindtap="copyInstallSummary"')
  && !cameraWxml.includes('bindtap="toggleCalculationDetails"')
  && !cameraWxml.includes('wx:for="{{result.calculationRows}}"'),
'camera page should not render standalone copy or derivation controls')
assert(!cameraWxml.includes('安装后转向')
  && !cameraWxml.includes('镜头变焦端点')
  && !cameraWxml.includes('光学几何估算')
  && !cameraWxml.includes('区域中心距摄像机'),
'retired camera labels and distance language should stay absent')

if (require.main === module) process.stdout.write('camera V3 UI markup regression PASS\n')

module.exports = { run: () => true }
