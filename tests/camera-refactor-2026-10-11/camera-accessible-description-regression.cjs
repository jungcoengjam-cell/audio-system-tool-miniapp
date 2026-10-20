'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const cameraPath = path.join(root, 'pages/camera/camera.js')
const cameraWxml = fs.readFileSync(path.join(root, 'pages/camera/camera.wxml'), 'utf8')
const canvasTag = cameraWxml.match(/<canvas type="2d" id="cameraFovCanvas"[^>]*>/)
assert.ok(canvasTag)
for (const binding of [
  '{{result.displayModel}}', '{{result.distanceReferenceText}}', '{{result.primaryDistanceMeters}}',
  '{{result.heightDisplayLabel}}', '{{result.cameraHeightMeters}}', '{{result.marginPercent}}',
  'result.horizontalOnly ? ',
]) assert.ok(canvasTag[0].includes(binding), `accessible canvas name is missing ${binding}`)
assert.ok(!canvasTag[0].includes('镜头中心高 {{result.cameraHeightMeters}}'),
  'accessible canvas name must use the calculated suggested/existing height label')

const previousPage = global.Page
const previousWx = global.wx
let definition
global.Page = (value) => { definition = value }
global.wx = {
  getStorageSync: () => ({}),
  setStorageSync: () => {},
  removeStorageSync: () => {},
  getAppBaseInfo: () => ({ theme: 'light' }),
  getSystemInfoSync: () => ({ theme: 'light' }),
}

try {
  delete require.cache[cameraPath]
  require(cameraPath)
  assert.ok(definition, 'camera Page definition is captured')
  const catalog = require(path.join(root, 'data/cameras.js')).cameras
  const { getHorizontalCameraViews } = require(path.join(root, 'utils/camera-fov.js'))
  const selectable = catalog.filter((camera) => getHorizontalCameraViews(camera).length)
  const horizontalOnlyIndex = selectable.findIndex((camera) => camera.model === 'TV-MU650X')
  assert.ok(horizontalOnlyIndex >= 0, 'the library horizontal-only model remains available')
  const cases = []

  for (const sceneModeIndex of [0, 1]) {
    for (const heightModeIndex of [0, 1]) {
      for (const horizontalOnly of [false, true]) {
        const page = {
          ...definition,
          _cameraUnloaded: false,
          _pageVisible: false,
          data: { ...structuredClone(definition.data), fixedCameraHeightText: '3.1' },
          setData(patch, callback) {
            Object.assign(this.data, patch)
            if (callback) callback()
          },
          cancelPendingCalculation() {},
          invalidatePreviewCanvas() {},
          captureResultHeroHeight() {},
          drawPreview() {},
          getOperationSnapshot() { return null },
          getRecordPayload() { return {} },
          getPreferences(state = this.data) { return state },
        }
        const result = page.commitCalculatedState({
          cameraIndex: horizontalOnly ? horizontalOnlyIndex : definition.data.cameraIndex,
          sceneModeIndex,
          heightModeIndex,
          cameraCalculationVersion: 2,
        })
        const stateName = `scene=${page.data.sceneModes[sceneModeIndex].value}, height=${page.data.heightModes[heightModeIndex].value}, horizontalOnly=${horizontalOnly}`
        assert.ok(result, `${stateName} returns a valid calculated result`)
        assert.equal(Boolean(result.horizontalOnly), horizontalOnly, `${stateName} keeps its optical-data mode`)
        assert.equal(result.displayModel, horizontalOnly ? 'TV-MU650X' : definition.data.selectedCamera.model,
          `${stateName} uses the intended catalog model`)
        assert.ok(Number.isFinite(result.primaryDistanceMeters) && result.primaryDistanceMeters > 0,
          `${stateName} has a valid distance`)
        assert.ok(Number.isFinite(result.cameraHeightMeters) && result.cameraHeightMeters > 0,
          `${stateName} has a valid camera height`)
        assert.ok(Number.isFinite(result.marginPercent), `${stateName} has a valid margin`)

        const heightLabel = heightModeIndex === 1 ? '已有镜头中心高度' : '建议镜头中心高度'
        assert.equal(result.heightDisplayLabel,
          `${heightLabel}${horizontalOnly ? ' · 仅水平参考' : ''}`, `${stateName} uses the right height label`)
        assert.equal(result.distanceReferenceText, sceneModeIndex === 0
          ? '镜头中心至拍摄区实际前沿（水平）'
          : '镜头中心至目标平面（水平）', `${stateName} names the correct horizontal distance reference`)

        const description = `${result.displayModel}，统一正交三维示意。${result.distanceReferenceText} ${result.primaryDistanceMeters} 米；${result.heightDisplayLabel} ${result.cameraHeightMeters} 米；取景余量 ${result.marginPercent}%。${result.horizontalOnly ? '垂直角未提供，垂直覆盖未校核。' : '蓝色水平截面与紫色垂直截面共用镜头中心，止于实际前沿。'}`
        assert.ok(!/undefined|null|NaN/.test(description), `${stateName} accessible description has no missing values`)
        assert.ok(description.includes(heightLabel), `${stateName} description distinguishes suggested from existing height`)
        assert.equal(description.includes('垂直覆盖未校核'), horizontalOnly,
          `${stateName} description communicates the vertical-coverage status`)
        cases.push({ scene: page.data.sceneModes[sceneModeIndex].value,
          height: page.data.heightModes[heightModeIndex].value, horizontalOnly })
      }
    }
  }

  assert.equal(cases.length, 8, 'all scene × height × optical-information states are covered')
  process.stdout.write(`camera accessible description regression: PASS (${cases.length} calculated states)\n`)
} finally {
  if (previousPage === undefined) delete global.Page
  else global.Page = previousPage
  if (previousWx === undefined) delete global.wx
  else global.wx = previousWx
  delete require.cache[cameraPath]
}
