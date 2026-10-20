'use strict'

const { createDelayedEnvironment } = require('../p2-safety-remediation/minimal/delayed-environment.cjs')
const { cameras } = require('../../data/cameras')
const { getHorizontalCameraViews } = require('../../utils/camera-fov')

function tap(index) { return { currentTarget: { dataset: { index: String(index) } } } }

function createCameraFixture(caseName, width = 375, height = 812, options = {}) {
  const env = createDelayedEnvironment()
  const selectorRects = new Map()
  env.wx.__cameraSelectorRects = selectorRects
  env.wx.createSelectorQuery = () => {
    let selected = ''
    let rectCallback = null
    const query = {
      in() { return query },
      select(selector) {
        selected = String(selector)
        return {
          boundingClientRect(callback) { rectCallback = callback; return query },
          fields() { return query },
        }
      },
      exec(callback) {
        const rect = selectorRects.get(selected) || null
        if (rectCallback) rectCallback(rect)
        if (callback) callback([rect ? { ...rect, node: null } : null])
        return query
      },
    }
    return query
  }
  const page = env.loadPage('pages/camera/camera.js')
  page.onLoad()
  env.flushNextTicks()
  let note = 'Production camera page initialized from its default preferences.'
  let pendingAction = null

  if (caseName === 'custom' || caseName.startsWith('custom-tab-')) {
    page.onSourceModeTap(tap(1))
    env.flushNextTicks()
    note = 'Production page switched to custom angle entry (60 / 36 degrees).'
  } else if (caseName === 'custom-sensor') {
    page.onSourceModeTap(tap(1))
    env.flushNextTicks()
    page.onDefinitionModeTap(tap(1))
    env.flushNextTicks()
    note = 'Production page switched to custom sensor and focal length entry.'
  } else if (caseName === 'plane' || caseName === 'extreme-plane') {
    if (caseName === 'plane') {
      page.onSceneModeTap(tap(1))
      env.flushNextTicks()
      note = 'Production page switched to its default vertical-plane scenario.'
    } else {
      page.onSourceModeTap(tap(1))
      env.flushNextTicks()
      page.commitCalculatedState({
        customHorizontalFovText: '71',
        customVerticalFovText: '80',
        sceneModeIndex: 1,
        planeWidthText: '6',
        planeHeightText: '2.5',
        planeBottomHeightText: '50',
        heightModeIndex: 1,
        fixedCameraHeightText: '0.5',
        marginIndex: 2,
      })
      env.flushNextTicks()
      note = 'Production page methods generated the documented extreme vertical-plane geometry result.'
    }
  } else if (caseName === 'plane-decimal-caption') {
    page.onSceneModeTap(tap(1))
    env.flushNextTicks()
    page.commitCalculatedState({
      planeWidthText: '6',
      planeHeightText: '0.2',
      planeBottomHeightText: '0.1',
    })
    env.flushNextTicks()
    note = 'Production page recalculated a vertical plane whose 0.1 m bottom and 0.2 m height should display a rounded 0.3 m top.'
  } else if (caseName === 'horizontal-only') {
    page.openCameraSelector()
    const camera = page.data.selectorItems.find((item) => item.model === 'TV-MU650X')
    if (!camera) throw new Error('TV-MU650X fixture is unavailable')
    page.selectCamera(tap(camera.index))
    env.flushNextTicks()
    note = 'Production page selected the H-only TV-MU650X library model.'
  } else if (caseName === 'dual-fixed') {
    page.openCameraSelector()
    const camera = page.data.selectorItems.find((item) => item.model === 'TS-0650JSM')
    if (!camera) throw new Error('TS-0650JSM fixture is unavailable')
    page.selectCamera(tap(camera.index))
    env.flushNextTicks()
    page.onViewTap(tap(1))
    env.flushNextTicks()
    note = 'Production page selected the fixed/H-only second view of TS-0650JSM.'
  } else if (caseName === 'fixed' || caseName === 'eptz') {
    const model = caseName === 'fixed' ? 'TV-6124UK' : 'TS-0663JP'
    page.openCameraSelector()
    const camera = page.data.selectorItems.find((item) => item.model === model)
    if (!camera) throw new Error(`${caseName} fixture is unavailable: ${model}`)
    page.selectCamera(tap(camera.index))
    env.flushNextTicks()
    note = `Production page selected ${caseName} model ${model}.`
  } else if (caseName === 'long-model') {
    const camera = [...cameras]
      .filter((item) => getHorizontalCameraViews(item).length)
      .sort((left, right) => right.model.length - left.model.length)[0]
    page.openCameraSelector()
    const selected = page.data.selectorItems.find((item) => item.model === camera.model)
    if (!selected) throw new Error(`Long model fixture is unavailable: ${camera.model}`)
    page.selectCamera(tap(selected.index))
    env.flushNextTicks()
    note = `Production page selected the longest calculable library model (${camera.model}).`
  } else if (caseName === 'empty') {
    pendingAction = { handler: 'onFieldInput', dataset: { field: 'groundWidthText' }, detail: { value: '' } }
    note = 'The browser first measures the actual result hero, then the production page clears the active ground width and immediately invalidates the result.'
  } else if (caseName === 'long-depth') {
    page.onFieldInput({ currentTarget: { dataset: { field: 'groundDepthText' } }, detail: { value: '1000' } })
    env.flushNextTicks()
    page.onFieldBlur()
    env.flushNextTicks()
    if (page.data.result?.depthMeters !== 1000) throw new Error('Production page did not flush the legal 1000 m ground depth fixture.')
    note = 'Production input and blur handlers recalculated a legal 1000 m ground depth to verify the dimension label remains within the canvas.'
  } else if (caseName === 'operation') {
    page.beginStructuredOperation({
      horizontalFov: 60,
      verticalFov: 36,
      sceneMode: 'ground',
      widthMeters: 6,
      depthMeters: 4,
      subjectHeightMeters: 1.8,
      heightMode: 'auto',
      marginPercent: 10,
    }, 'full-area')
    env.flushNextTicks()
    note = 'Production page confirms a complete structured operation with unspecified mount type.'
  }

  const tabMatch = caseName.match(/(?:^custom-tab-|^tab-)(camera|target|install)$/)
  if (tabMatch) {
    const index = { camera: 0, target: 1, install: 2 }[tabMatch[1]]
    page.onInputTabTap(tap(index))
    env.flushNextTicks()
  }
  if (caseName.endsWith('-elevation') || caseName === 'elevation') {
    page.onPreviewViewTap(tap(1))
    env.flushNextTicks()
  }
  if (Number.isInteger(options.inputTabIndex)) {
    page.onInputTabTap(tap(options.inputTabIndex))
    env.flushNextTicks()
  }
  if (Number.isInteger(options.previewViewIndex)) {
    page.onPreviewViewTap(tap(options.previewViewIndex))
    env.flushNextTicks()
  }
  if (options.calculationExpanded && !page.data.calculationExpanded) {
    page.toggleCalculationDetails()
    env.flushNextTicks()
  }
  if (page.data.calculationExpanded === undefined) page.data.calculationExpanded = false

  return {
    state: page.data,
    page,
    env,
    viewport: { width, height },
    sourceNote: note,
    pendingAction,
  }
}

module.exports = { createCameraFixture }
