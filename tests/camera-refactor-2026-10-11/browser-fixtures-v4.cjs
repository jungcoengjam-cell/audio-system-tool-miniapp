'use strict'

const { createDelayedEnvironment } = require('../p2-safety-remediation/minimal/delayed-environment.cjs')
const { cameras } = require('../../data/cameras')
const { getHorizontalCameraViews } = require('../../utils/camera-fov')

const PREFS_KEY = 'audioTool.camera.preferences'
const PROJECTS_KEY = 'audioTool.projects.v1'
const RECORDS_KEY = 'audioTool.records.v1'
const ACTIVE_PROJECT_KEY = 'audioTool.activeProject.v1'
const STORAGE_SCHEMA_KEY = 'audioTool.storageSchemaVersion'

function tap(index) { return { currentTarget: { dataset: { index: String(index) } } } }

function legacyCustomPreferences() {
  return {
    sourceMode: 'custom', cameraModel: 'TV-6124HK', viewIndex: 0, viewLabel: '旧自定义角度',
    definitionMode: 'angles', customMountType: 'fixed', customHorizontalFovText: '73.25',
    customVerticalFovText: '41.75', customSensorWidthText: '17.125', customSensorHeightText: '9.625',
    customFocalLengthText: '22.375', sceneMode: 'ground', heightMode: 'auto', marginPercent: 10,
    groundWidthText: '6', groundDepthText: '4', subjectHeightText: '1.8', planeWidthText: '6',
    planeHeightText: '2.5', planeBottomHeightText: '0.8', fixedCameraHeightText: '2.3',
  }
}

function seedCameraProjects(env) {
  const now = Date.now()
  const project = (id, name, offset) => ({
    id,
    name,
    venueName: '', engineer: '', projectDate: '2026-10-11', notes: '',
    roomLengthText: '', roomWidthText: '', roomHeightText: '',
    standardClassKey: 'conference', gradeKey: 'II',
    createdAt: now - offset, updatedAt: now - offset,
  })
  env.storage.set(STORAGE_SCHEMA_KEY, 3)
  env.storage.set(RECORDS_KEY, [])
  env.storage.set(PROJECTS_KEY, [project('qa-project-a', 'V4 QA Project A', 1000), project('qa-project-b', 'V4 QA Project B', 2000)])
  env.storage.set(ACTIVE_PROJECT_KEY, 'qa-project-a')
}

function createCameraFixtureV4(caseName, width = 390, height = 844, options = {}) {
  const env = createDelayedEnvironment()
  // The browser report bridge supplies a real PNG data URL from production
  // Canvas2D. Let the production local-image access gate recognize that exact
  // in-browser image; native wxfile authorization remains outside this bridge.
  env.wx.getFileSystemManager = () => ({
    access({ path, success, fail } = {}) {
      if (String(path || '').startsWith('data:image/png;base64,')) success?.({ path })
      else fail?.({ errMsg: 'browser fixture only grants access to the generated report PNG data URL' })
    },
  })
  const selectorRects = new Map()
  env.wx.__cameraSelectorRects = selectorRects
  env.wx.createSelectorQuery = () => {
    let selected = ''
    let rectCallback = null
    const query = {
      in() { return query },
      select(selector) {
        selected = String(selector)
        return { boundingClientRect(callback) { rectCallback = callback; return query }, fields() { return query } }
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
  if (caseName === 'legacy-custom') env.storage.set(PREFS_KEY, legacyCustomPreferences())
  if (['project-entry', 'project-list', 'project-create', 'project-confirm', 'project-success'].includes(caseName)) seedCameraProjects(env)
  const page = env.loadPage('pages/camera/camera.js')
  page.onLoad()
  env.flushNextTicks()
  // A real page becomes visible after its initial load; project and report
  // actions are intentionally page-visibility guarded in the production code.
  if (typeof page.onShow === 'function') page.onShow()
  env.flushNextTicks()
  let note = 'Production camera page initialized from library defaults.'
  let pendingAction = null

  if (caseName === 'plane') {
    page.onSceneModeTap(tap(1))
    env.flushNextTicks()
    note = 'Production page selected its vertical-plane library-camera scenario.'
  } else if (caseName === 'long-depth') {
    page.onFieldInput({ currentTarget: { dataset: { field: 'groundDepthText' } }, detail: { value: '1000' } })
    page.onFieldBlur()
    env.flushNextTicks()
    if (page.data.result?.depthMeters !== 1000) throw new Error('1000 m scenario did not settle through production input handlers.')
    note = 'Production field input and blur handlers calculated a legal 1000 m depth.'
  } else if (caseName === 'horizontal-only') {
    page.openCameraSelector()
    const camera = page.data.selectorItems.find((item) => item.model === 'TV-MU650X')
    if (!camera) throw new Error('TV-MU650X H-only library camera is unavailable.')
    page.selectCamera(tap(camera.index))
    env.flushNextTicks()
    note = 'Production selector chose the H-only library camera.'
  } else if (caseName === 'long-model') {
    const model = [...cameras].filter((camera) => getHorizontalCameraViews(camera).length)
      .sort((left, right) => right.model.length - left.model.length)[0]
    page.openCameraSelector()
    const item = page.data.selectorItems.find((camera) => camera.model === model?.model)
    if (!item) throw new Error(`Longest valid library model is missing: ${model?.model}`)
    page.selectCamera(tap(item.index))
    env.flushNextTicks()
    note = `Production selector chose the longest calculable library model ${model.model}.`
  } else if (caseName === 'dual-lens') {
    page.openCameraSelector()
    const camera = page.data.selectorItems.find((item) => item.model === 'TS-0663JSM')
    if (!camera) throw new Error('Dual-view TS-0663JSM library model is unavailable.')
    page.selectCamera(tap(camera.index))
    env.flushNextTicks()
    page.onViewTap(tap(1))
    env.flushNextTicks()
    note = 'Production selector and view handlers selected the second view of the dual-view TS-0663JSM.'
  } else if (caseName === 'eptz-fixed-margin20') {
    page.openCameraSelector()
    const camera = page.data.selectorItems.find((item) => item.model === 'TS-0663XP')
    if (!camera) throw new Error('ePTZ TS-0663XP library model is unavailable.')
    page.selectCamera(tap(camera.index))
    env.flushNextTicks()
    page.onSceneModeTap(tap(1))
    env.flushNextTicks()
    page.onHeightModeTap(tap(1))
    env.flushNextTicks()
    page.onMarginChange({ detail: { value: '4' } })
    env.flushNextTicks()
    note = 'Production handlers selected a library ePTZ model, plane scene, fixed camera height, and 20% margin.'
  } else if (caseName === 'legacy-custom') {
    note = 'Production onLoad recognized a stored legacy custom source and renders it as explicitly unsupported.'
  } else if (caseName === 'structured-unsupported') {
    page.beginStructuredOperation({ horizontalFov: 60, verticalFov: 36, sceneMode: 'ground', widthMeters: 6, depthMeters: 4 }, 'full-area')
    env.flushNextTicks()
    note = 'Production controller rejects the angle-based structured operation as unsupported.'
  } else if (caseName === 'share-overlay') {
    if (!page.data.result || typeof page.getResultReportSignature !== 'function') {
      throw new Error('Share preview fixture requires a calculated library result and report signature handler.')
    }
    pendingAction = { handler: 'generateResultReportImage' }
    note = 'The production report-preview handler starts image generation. The browser bridge paints the production report renderer to a real Canvas and supplies that PNG data URL to the delayed wx export callback; native file export and OS sharing are not simulated.'
  } else if (caseName === 'original-viewer') {
    if (!page.data.result || typeof page.generateResultReportImage !== 'function') {
      throw new Error('Original-image viewer fixture requires a current library result and report handler.')
    }
    pendingAction = { handler: 'generateResultReportImage' }
    note = 'After the production report renderer supplies a real PNG data URL, the browser scenario opens the production original-image viewer.'
  } else if (['project-list', 'project-create', 'project-confirm', 'project-success'].includes(caseName)) {
    if (!page.data.result || typeof page.openCameraProjectDialog !== 'function') {
      throw new Error('Project dialog fixture requires a current library result and production project handler.')
    }
    page.openCameraProjectDialog()
    env.flushNextTicks()
    if (caseName !== 'project-list') {
      if (caseName === 'project-create') {
        page.openCameraProjectCreateForm()
      } else {
        page.selectCameraProjectTarget({ currentTarget: { dataset: { id: 'qa-project-a' } } })
        if (caseName === 'project-success') {
          page.onCameraProjectConfigNameInput({ detail: { value: 'V4 camera setup A' } })
          page.onCameraProjectConfigNoteInput({ detail: { value: 'North wall; verify cable route.' } })
          page.saveCameraProjectTarget()
          env.flushNextTicks()
        }
      }
      env.flushNextTicks()
    }
    note = `Production camera project dialog opened in the ${caseName.replace('project-', '')} state using seeded local workspace storage.`
  } else if (!['ground', 'dual-lens', 'eptz-fixed-margin20', 'project-entry'].includes(caseName)) {
    throw new Error(`Unknown V4 browser fixture: ${caseName}`)
  }

  if (Number.isInteger(options.inputTabIndex) && typeof page.onInputTabTap === 'function') {
    page.onInputTabTap(tap(options.inputTabIndex))
    env.flushNextTicks()
  }
  if (Number.isInteger(options.previewViewIndex) && typeof page.onPreviewViewTap === 'function') {
    page.onPreviewViewTap(tap(options.previewViewIndex))
    env.flushNextTicks()
  }

  return { state: page.data, page, env, viewport: { width, height }, sourceNote: note, pendingAction }
}

module.exports = { createCameraFixtureV4 }
