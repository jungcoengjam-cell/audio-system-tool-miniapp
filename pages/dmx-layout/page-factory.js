const { vibrate } = require('../../utils/haptics')
const { previewGeneratedImage, saveGeneratedImage, shareGeneratedImage } = require('../../utils/report-image-actions')
const {
  readLightingWorkspace,
  getLightingContexts,
  saveLightingScheme,
  switchLightingContext,
  calculateScheme,
  TEMPORARY_CONTEXT_ID,
} = require('./lighting-workspace')
const {
  createDefaultStageLayout,
  createStageGeometry,
  getSceneBounds,
  transformViewPointInverse,
  pointOnRod,
  projectPointToRod,
  layoutFixturePoint,
  zoomViewAt,
  fixtureSort,
  clamp,
} = require('./layout-model')
const { migrateLegacyLayout } = require('./layout-storage')
const { getDevicePixelRatio, createCanvas2DAdapter, configureCanvas2DNode } = require('./layout-canvas-adapter')
const { readLayoutViewportMetrics } = require('./layout-viewport')
const { createLayoutExportMethods } = require('./layout-export-controller')
const { createLayoutSettingsMethods } = require('./layout-settings')
const { createLayoutPlacementMethods, createLayoutLocateMethods } = require('./layout-interactions')
const {
  GROUP_COLORS,
  LAYOUT_GROUP_COLORS,
  CANVAS_THEMES,
  getCanvasTheme,
  classifyFixtureVisualType,
  renderStageDiagram,
  buildLightingExportPages,
  renderLightingExportPage,
} = require('./layout-renderer')

const CANVAS_ID = 'dmxLayoutCanvas'
const EXPORT_CANVAS_ID = 'dmxLayoutExportCanvas'
const EXPORT_WIDTH = 1120
const EXPORT_HEIGHT = 1160
const LOCATE_RESULT_ROW_HEIGHT = 74

function decodeRouteDisplayLabel(value) {
  const label = String(value || '')
  if (!/%[0-9a-f]{2}/i.test(label)) return label
  try { return decodeURIComponent(label) } catch (_) { return label }
}

function landscapeContentBounds(geometry) {
  const stage = geometry && geometry.stage
  if (!stage) return null
  const xs = [stage.left, stage.left + stage.width, stage.left - 62]
  const ys = [stage.top, stage.top + stage.height, stage.top - 33]
  ;(geometry.rods || []).forEach((rod) => {
    xs.push(rod.x1, rod.x2)
    ys.push(rod.y1, rod.y2, (rod.y1 + rod.y2) / 2 - 16)
  })
  if (geometry.audience) {
    xs.push(geometry.audience.x)
    ys.push(geometry.audience.y)
  }
  if (geometry.apronLabel) {
    xs.push(geometry.apronLabel.x)
    ys.push(geometry.apronLabel.y)
  }
  const padding = 6
  return {
    left: Math.min(...xs) - padding,
    top: Math.min(...ys) - padding,
    right: Math.max(...xs) + padding,
    bottom: Math.max(...ys) + padding,
  }
}

function fitLandscapeView(geometry, width, height, preferredScale = 1.14) {
  const bounds = landscapeContentBounds(geometry)
  if (!bounds || !(width > 0) || !(height > 0)) return { s: 1, x: 0, y: 0 }
  const inset = 5
  const scale = Math.min(preferredScale,
    (width - inset * 2) / Math.max(1, bounds.right - bounds.left),
    (height - inset * 2) / Math.max(1, bounds.bottom - bounds.top))
  const safeScale = Math.max(.65, scale)
  const centerX = (bounds.left + bounds.right) / 2
  const centerY = (bounds.top + bounds.bottom) / 2
  return {
    s: safeScale,
    x: width / 2 - centerX * safeScale,
    y: height / 2 - centerY * safeScale,
  }
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

function layoutFingerprint(layout) {
  return JSON.stringify(layout === undefined ? null : layout)
}

function schemeFingerprint(scheme) {
  return JSON.stringify(scheme === undefined ? null : scheme)
}

function makeId(kind) {
  return kind + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)
}

function getThemeName() {
  try {
    const appInfo = typeof wx.getAppBaseInfo === 'function' ? wx.getAppBaseInfo() : null
    const system = typeof wx.getSystemInfoSync === 'function' ? wx.getSystemInfoSync() : {}
    return (appInfo && appInfo.theme) || system.theme || 'light'
  } catch (error) {
    return 'light'
  }
}

function rodRows(layout) {
  return [
    ...(layout && Array.isArray(layout.internalRods) ? layout.internalRods : []),
    ...(layout && Array.isArray(layout.frontRods) ? layout.frontRods : []),
    ...(layout && Array.isArray(layout.legacySideRods) ? layout.legacySideRods : []),
  ]
}

function stageFrameChanged(previous, next) {
  return Number(previous && previous.stageWidthText) !== Number(next && next.stageWidthText)
    || Number(previous && previous.stageDepthText) !== Number(next && next.stageDepthText)
    || String(previous && previous.apronDirection || 'bottom') !== String(next && next.apronDirection || 'bottom')
}

function rodFrame(layout, rodId) {
  const row = rodRows(layout).find((rod) => String(rod.id) === String(rodId))
  if (!row) return null
  return {
    type: (layout.internalRods || []).some((rod) => String(rod.id) === String(rodId))
      ? 'internal'
      : (layout.frontRods || []).some((rod) => String(rod.id) === String(rodId))
        ? 'front'
        : 'legacy-side',
    distance: Number(row.distance),
    side: row.side || '',
    startT: Number(row.startT),
    endT: Number(row.endT),
    positionIndex: Number(row.positionIndex),
  }
}

function rodFrameChanged(previous, next, rodId) {
  return JSON.stringify(rodFrame(previous, rodId)) !== JSON.stringify(rodFrame(next, rodId))
}

function rodName(layout, rodId) {
  const rod = rodRows(layout).find((item) => String(item.id) === String(rodId))
  if (!rod) return '未知灯杆'
  const index = (layout.internalRods || []).findIndex((item) => item.id === rod.id)
  if (index >= 0) return '灯杆' + (index + 1)
  const frontIndex = (layout.frontRods || []).findIndex((item) => item.id === rod.id)
  if (frontIndex >= 0) return '面光杆' + (frontIndex + 1)
  return (rod.side === 'left' ? '左侧光' : '右侧光') + (Number(rod.positionIndex) + 1)
}

function conciseFixtureGroupTitle(group = {}) {
  const model = String(group.fixtureModel || '').trim()
  let name = String(group.fixtureName || group.name || '灯具组').trim()
  if (!group.fixtureName && model && name.toLocaleLowerCase().startsWith(model.toLocaleLowerCase())) {
    name = name.slice(model.length).trim()
  }
  let displayName = /平板柔光灯/.test(name)
    ? '平板柔光灯'
    : /成像灯/.test(name)
      ? '成像灯'
      : /摇头灯/.test(name)
        ? '摇头灯'
        : /柔光灯/.test(name)
          ? '柔光灯'
          : name.replace(/^\s*\d+(?:\.\d+)?\s*W\s*/i, '').replace(/\s*[（(].*?[）)]/g, '').trim() || name
  if (!model || displayName.toLocaleLowerCase().includes(model.toLocaleLowerCase())) return displayName
  return displayName + ' · ' + model
}

function makeGroups(groups, fixtures, scheme, layout) {
  const byGroup = new Map()
  ;(groups || []).forEach((group, index) => {
    byGroup.set(String(group.stableId || group.id || index), {
      id: String(group.stableId || group.id || index),
      groupIndex: index,
      name: group.name || '灯具组 ' + (index + 1),
      fixtureModel: group.fixtureModel || '',
      fixtureType: classifyFixtureVisualType({ fixtureModel: group.fixtureModel, groupName: group.name }),
      fixtureDisplayTitle: conciseFixtureGroupTitle(group),
      channelCount: Number(group.channelCount) || 0,
      color: LAYOUT_GROUP_COLORS[index % LAYOUT_GROUP_COLORS.length],
      fixtures: [],
    })
  })
  ;(fixtures || []).forEach((fixture) => {
    const group = byGroup.get(String(fixture.groupId || '')) || [...byGroup.values()][fixture.groupIndex]
    if (!group) return
    const id = String(fixture.stableId || '')
    const position = layout && layout.positionsById && layout.positionsById[id]
    group.fixtures.push({
      ...fixture,
      id,
      color: group.color,
      fixtureType: classifyFixtureVisualType({ ...fixture, groupName: fixture.groupName || group.name, fixtureModel: fixture.fixtureModel || group.fixtureModel }),
      placed: Boolean(position && position.rodId && rodRows(layout).some((rod) => rod.id === position.rodId)),
      rodId: position && position.rodId || '',
      rodName: position && position.rodId ? rodName(layout, position.rodId) : '',
      checked: Boolean(scheme && scheme.checksById && scheme.checksById[id]),
    })
  })
  return [...byGroup.values()].map((group) => ({ ...group, fixtures: group.fixtures.slice().sort(fixtureSort) }))
}

function makeCanvasLegend(groups, canvasShellHeight) {
  const populatedGroups = (groups || []).filter((group) => Array.isArray(group.fixtures) && group.fixtures.length)
  const availableHeight = Math.max(0, Number(canvasShellHeight) || 0)
  const visibleCount = Math.max(1, Math.min(8, Math.floor(Math.max(0, availableHeight - 42) / 18)))
  return {
    layoutLegend: populatedGroups.slice(0, visibleCount).map((group) => ({
      id: String(group.id),
      groupName: String(group.name || ''),
      fixtureModel: String(group.fixtureModel || ''),
      fixtureType: String(group.fixtureType || 'profile'),
      fixtureDisplayTitle: String(group.fixtureDisplayTitle || group.name || '灯具组'),
      color: String(group.color || '#8a2bff'),
      count: group.fixtures.length,
    })),
    layoutLegendOverflowCount: Math.max(0, populatedGroups.length - visibleCount),
  }
}

function allFixtureCount(groups) {
  return (groups || []).reduce((sum, group) => sum + group.fixtures.length, 0)
}

function pointFromTouch(touch, rect, canvasWidth, canvasHeight) {
  const hasClient = Number.isFinite(Number(touch.clientX)) || Number.isFinite(Number(touch.pageX))
  const x = hasClient ? Number(touch.clientX !== undefined ? touch.clientX : touch.pageX) - rect.left : Number(touch.x) || 0
  const y = hasClient ? Number(touch.clientY !== undefined ? touch.clientY : touch.pageY) - rect.top : Number(touch.y) || 0
  return {
    x: x * (canvasWidth / Math.max(1, rect.width)),
    y: y * (canvasHeight / Math.max(1, rect.height)),
  }
}

function touchDistance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function stageAxisLength(layout) {
  const sideApron = layout.apronDirection === 'left' || layout.apronDirection === 'right'
  return Number(sideApron ? layout.stageWidthText : layout.stageDepthText) || (sideApron ? 12 : 8)
}

function withDistanceTexts(layout) {
  return {
    ...clone(layout),
    internalRods: (layout.internalRods || []).map((rod) => ({ ...rod, distanceText: String(rod.distance) })),
    frontRods: (layout.frontRods || []).map((rod) => ({ ...rod, distanceText: String(rod.distance) })),
  }
}

function createDmxLayoutPage(options = {}) {
  const isLandscape = options.mode === 'landscape'
  const canvasWidth = isLandscape ? 1200 : 760
  const canvasHeight = isLandscape ? 650 : 760
  const layoutMethodRuntime = {
    wx: new Proxy({}, {
      get(_target, key) {
        const currentWx = wx
        const value = currentWx[key]
        return typeof value === 'function' ? value.bind(currentWx) : value
      },
    }),
    Date: { now: () => Date.now() },
    setTimeout: (...args) => setTimeout(...args),
    clearTimeout: (...args) => clearTimeout(...args),
  }
  const layoutSettingsMethods = createLayoutSettingsMethods({
    ...layoutMethodRuntime,
    calculateScheme, clone, createStageGeometry, layoutFingerprint, layoutFixturePoint, makeId,
    pointOnRod, projectPointToRod, readLightingWorkspace, rodFrameChanged, rodName, rodRows,
    saveLightingScheme, schemeFingerprint, stageAxisLength, stageFrameChanged, touchDistance, vibrate, withDistanceTexts,
  })
  const layoutInteractionDependencies = {
    ...layoutMethodRuntime,
    LOCATE_RESULT_ROW_HEIGHT, classifyFixtureVisualType, clone, fixtureSort, layoutFingerprint, layoutFixturePoint,
    pointFromTouch, pointOnRod, projectPointToRod, rodName, rodRows, touchDistance,
    transformViewPointInverse, vibrate, zoomViewAt,
  }
  const layoutPlacementMethods = createLayoutPlacementMethods(layoutInteractionDependencies)
  const layoutLocateMethods = createLayoutLocateMethods(layoutInteractionDependencies)
  const layoutExportMethods = createLayoutExportMethods({
    ...layoutMethodRuntime,
    CANVAS_THEMES, EXPORT_CANVAS_ID, EXPORT_HEIGHT, EXPORT_WIDTH, buildLightingExportPages, calculateScheme, clone,
    configureCanvas2DNode, createCanvas2DAdapter, createDefaultStageLayout, createStageGeometry, layoutFingerprint, makeId,
    migrateLegacyLayout, previewGeneratedImage, readLightingWorkspace, renderLightingExportPage, saveGeneratedImage,
    schemeFingerprint, shareGeneratedImage, vibrate,
  })
  const page = {
    data: {
      isLandscape,
      hasPlan: false,
      errorText: '',
      contextLabel: '临时设置',
      totalGroups: 0,
      totalFixtures: 0,
      placedFixtureCount: 0,
      unplacedFixtureCount: 0,
      layout: null,
      selectedFixtureId: '',
      planSummary: '',
      canvasWidth,
      canvasHeight,
      canvasShellHeight: isLandscape ? 0 : 420,
      toolbarHeight: isLandscape ? 58 : 62,
      toolbarContentBottomPadding: 4,
      scrollEnabled: true,
      darkMode: false,
      layoutPanelVisible: false,
      layoutPanelClosing: false,
      placementVisible: false,
      placementClosing: false,
      previewVisible: false,
      exportCanvasActive: false,
      exportCanvasWidth: EXPORT_WIDTH,
      exportCanvasHeight: EXPORT_HEIGHT,
      layoutImagePath: '',
      layoutImagePaths: [],
      exportPageIndex: 0,
      exportPageCount: 0,
      isGeneratingImage: false,
      saveNotice: '',
      saveRetryVisible: false,
      layoutDraft: null,
      layoutValidationErrorsById: {},
      layoutErrorScrollIntoView: '',
      draftDirectionOptions: [
        { value: 'top', text: '上' },
        { value: 'right', text: '右' },
        { value: 'bottom', text: '下' },
        { value: 'left', text: '左' },
      ],
      placementGroups: [],
      layoutLegend: [],
      layoutLegendOverflowCount: 0,
      selectedRodId: '',
      selectedRodName: '',
      selectedRodCount: 0,
      selectedRodOverview: [],
      previewViewportLeft: 0,
      previewViewportWidth: 100,
      previewRangeText: '暂无灯具',
      previewScrollIntoView: '',
      panelScrollIntoView: '',
      placementNotice: '点选灯具即可上杆或下杆',
      searchText: '',
      searchResultText: '',
      searchFixtureType: '',
      searchResults: [],
      locateResultsHeight: 0,
      searchErrorText: '',
      locateVisible: false,
      locateClosing: false,
      lightingContexts: [],
      contextPickerIndex: 0,
      placementFilterText: '',
      arrangementMode: 'preserve',
      layoutUndoVisible: false,
      layoutUndoLabel: '灯具已均匀排列',
      highlightFixtureId: '',
      manipulationText: '',
      reductionConfirm: null,
      reductionClosing: false,
      previewClosing: false,
      clearLayoutPending: false,
      overlaySafeTop: 96,
      overlaySafeBottom: 0,
      overlayAvailableHeight: 700,
      placementCardMaxHeight: 580,
      settingsBodyMaxHeight: 580,
    },

    onLoad(options = {}) {
      this._alive = true
      this._visible = true
      this._theme = getThemeName() === 'dark' ? 'dark' : 'light'
      this._themeChangeHandler = ({ theme } = {}) => this.handleThemeChange(theme)
      if (typeof wx.onThemeChange === 'function') wx.onThemeChange(this._themeChangeHandler)
      this._visibilityToken = 0
      this._measureToken = 0
      this._workspaceLoadToken = 0
      this._requestedContextId = String(options.lightingContextId || options.lightingProjectId || '')
      this._requestedContextLabel = String(options.lightingContextName || options.lightingProjectName || '')
      this._openExportOnLoad = String(options.openExport || '') === '1'
      this._contextId = ''
      this._revision = null
      this._loadedSchemeFingerprint = ''
      this._scheme = null
      this._fixtures = []
      this._groups = []
      this._layout = null
      this._persistedLayoutFingerprint = layoutFingerprint(null)
      this._geometry = null
      this._geometryKey = ''
      this._view = { s: 1, x: 0, y: 0 }
      this._viewAutoFit = isLandscape
      this._viewAnimationToken = 0
      this._canvasNode = null
      this._canvasContext = null
      this._canvasAdapter = null
      this._canvasPixelRatio = 1
      this._drawFrame = null
      this._drawToken = 0
      this._measureToken = 0
      const viewport = readLayoutViewportMetrics(wx, isLandscape)
      const { windowWidth } = viewport
      this._viewManuallyAdjusted = false
      this._canvasRect = { left: 0, top: 0, width: viewport.canvasWidth, height: viewport.canvasHeight }
      this._previewViewportWidth = Math.min(640, Math.max(180, windowWidth - 56))
      this._previewColumnStep = viewport.windowHeight <= 460 ? 48 : 56
      this._previewTrackPadding = viewport.windowHeight <= 460 ? 20 : 28
      this._previewMeasureToken = 0
      this._lastPreviewRodId = ''
      this._previewScrollLeft = 0
      this._previewScrollCommandToken = 0
      this._previewScrollMetricsTimer = null
      this._previewScrollCommandTimer = null
      this._previewPendingScroll = null
      this._sheetCloseTimers = Object.create(null)
      this._sheetCloseTokens = Object.create(null)
      this._clearLayoutToken = 0
      this._clearLayoutPending = false
      this._activeRodId = ''
      this._highlightTimer = null
      this._pressTimer = null
      this._touchState = null
      this._gesture = null
      this._dragPosition = null
      this._layoutPanelTimer = null
      this._undoTimer = null
      this._layoutUndoExpiresAt = 0
      this._saveImagesToken = 0
      this._savingAllImages = false
      this._layoutDirty = false
      this._unloadAlertEnabled = null
      this.syncLayoutUnloadAlert()
      this._generationToken = 0
      this._exportSnapshot = null
      this._exportPages = []
      this._exportPaths = []
      this.setData({
        darkMode: this._theme === 'dark',
        ...viewport,
      })
      this.loadWorkspace()
    },

    onShow() {
      this._visible = true
      this._visibilityToken += 1
      const nextTheme = getThemeName() === 'dark' ? 'dark' : 'light'
      if (nextTheme !== this._theme || Boolean(this.data.darkMode) !== (nextTheme === 'dark')) {
        this._theme = nextTheme
        this.clearImage()
      }
      if (this._layoutUndoSnapshot && Date.now() >= Number(this._layoutUndoExpiresAt || 0)) {
        this._layoutUndoSnapshot = null
        this._layoutUndoExpiresAt = 0
      }
      this.setData({
        darkMode: this._theme === 'dark',
        layoutPanelClosing: false,
        placementClosing: false,
        locateClosing: false,
        previewClosing: false,
        reductionClosing: false,
        layoutUndoVisible: Boolean(this._layoutUndoSnapshot),
      })
      if (this._layoutUndoSnapshot) this.scheduleLayoutUndoExpiry()
      if (!this._alive || !this._layout || !this._contextId) return
      const latest = readLightingWorkspace(this._contextId)
      if (!latest.ok) {
        this.invalidateExportPreview()
        this.setData({ saveNotice: latest.error || '灯光工作区读取失败。', saveRetryVisible: false })
        this.drawLayout()
        return
      }
      if (this._revision !== null && (latest.revision !== this._revision
        || schemeFingerprint(latest.scheme) !== this._loadedSchemeFingerprint)) {
        this.invalidateExportPreview()
      }
      if (this._layoutUndoSnapshot && layoutFingerprint(latest.scheme.layout) !== this._persistedLayoutFingerprint) {
        this.clearLayoutUndo()
      }
      if (this._layoutDirty && layoutFingerprint(latest.scheme.layout) !== this._persistedLayoutFingerprint) {
        this.setData({ saveNotice: '灯位图已在其他页面更新；当前编辑仍保留，请先重新载入最新布局。', saveRetryVisible: false })
        this.updateLayoutData()
        this.drawLayout()
        return
      }
      if (this._layoutDirty && !this.saveLayoutOnly(this._layout)) return
      this._requestedContextId = this._contextId
      this.loadWorkspace()
    },

    handleThemeChange(theme) {
      if (!this._alive || !this._visible) return
      const nextTheme = theme === 'dark' ? 'dark' : 'light'
      if (nextTheme === this._theme && Boolean(this.data.darkMode) === (nextTheme === 'dark')) return
      this._theme = nextTheme
      this.clearImage()
      const visibilityToken = this._visibilityToken
      this.setData({ darkMode: nextTheme === 'dark' }, () => {
        if (!this._alive || !this._visible || this._visibilityToken !== visibilityToken) return
        this.measureCanvas(() => {
          if (!this._alive || !this._visible || this._visibilityToken !== visibilityToken) return
          this.drawLayout()
        })
      })
    },

    clearImage() {
      this.invalidateExportPreview()
    },

    invalidateExportPreview() {
      this.cancelSheetClose('export')
      this._generationToken += 1
      this._exportSnapshot = null
      this._exportPages = []
      this._exportPaths = []
      this._exportCanvasNode = null
      this._exportCanvasContext = null
      this._exportCanvasAdapter = null
      if (!this.data || !this._alive) return
      const wasGenerating = Boolean(this.data.isGeneratingImage)
      const restoreStage = this.isStageCanvasBlocked()
      this.setData({
        previewVisible: false,
        previewClosing: false,
        exportCanvasActive: false,
        layoutImagePath: '',
        layoutImagePaths: [],
        exportPageIndex: 0,
        exportPageCount: 0,
        isGeneratingImage: false,
      }, () => { if (restoreStage) this.restoreStageCanvas() })
      if (wasGenerating && typeof wx.hideLoading === 'function') wx.hideLoading()
    },

    setLayoutDirty(dirty) {
      this._layoutDirty = Boolean(dirty)
      this.syncLayoutUnloadAlert()
    },

    syncLayoutUnloadAlert() {
      const shouldEnable = Boolean(this._layoutDirty)
      if (this._unloadAlertEnabled === shouldEnable) return
      try {
        if (shouldEnable && typeof wx.enableAlertBeforeUnload === 'function') {
          wx.enableAlertBeforeUnload({ message: '灯位图更改尚未保存，离开后可能丢失。' })
        } else if (!shouldEnable && typeof wx.disableAlertBeforeUnload === 'function') {
          wx.disableAlertBeforeUnload()
        }
        this._unloadAlertEnabled = shouldEnable
      } catch (error) {
        this._unloadAlertEnabled = null
        // Explicit navigation still retries the save and blocks leaving if it fails.
      }
    },

    clearLayoutUndo() {
      if (this._undoTimer) clearTimeout(this._undoTimer)
      this._undoTimer = null
      this._layoutUndoSnapshot = null
      this._layoutUndoExpiresAt = 0
      if (this.data && this._alive) this.setData({ layoutUndoVisible: false })
    },

    cancelSheetClose(key) {
      if (!this._sheetCloseTokens) this._sheetCloseTokens = Object.create(null)
      if (!this._sheetCloseTimers) this._sheetCloseTimers = Object.create(null)
      if (this._sheetCloseTimers[key]) clearTimeout(this._sheetCloseTimers[key])
      this._sheetCloseTimers[key] = null
      this._sheetCloseTokens[key] = (Number(this._sheetCloseTokens[key]) || 0) + 1
    },

    cancelAllSheetCloses() {
      Object.keys(this._sheetCloseTokens || {}).forEach((key) => this.cancelSheetClose(key))
    },

    beginSheetClose(key, closingField, finalize) {
      if (!this._alive || !this._visible) return
      this.cancelSheetClose(key)
      const token = this._sheetCloseTokens[key]
      const visibilityToken = this._visibilityToken
      const contextId = this._contextId
      this.setData({ [closingField]: true })
      this._sheetCloseTimers[key] = setTimeout(() => {
        if (!this._alive || !this._visible
          || this._visibilityToken !== visibilityToken
          || this._contextId !== contextId
          || this._sheetCloseTokens[key] !== token) return
        this._sheetCloseTimers[key] = null
        finalize()
      }, 180)
    },

    invalidatePendingSettingsConfirm() {
      this._settingsIntentToken = (Number(this._settingsIntentToken) || 0) + 1
      this._pendingSettingsLayout = null
      this._pendingRemovedRodIds = null
      this._pendingUniformArrange = false
      this._pendingSettingsGuard = null
    },

    invalidatePendingClear() {
      this._clearLayoutToken = (Number(this._clearLayoutToken) || 0) + 1
      this._clearLayoutPending = false
      if (this._alive && this.data && this.data.clearLayoutPending) this.setData({ clearLayoutPending: false })
    },

    cancelPreviewScrollCommand() {
      this._previewScrollCommandToken = (Number(this._previewScrollCommandToken) || 0) + 1
      if (this._previewScrollMetricsTimer) clearTimeout(this._previewScrollMetricsTimer)
      if (this._previewScrollCommandTimer) clearTimeout(this._previewScrollCommandTimer)
      this._previewScrollMetricsTimer = null
      this._previewScrollCommandTimer = null
      this._previewPendingScroll = null
      if (this._alive && this.data && this.data.previewScrollIntoView) {
        this.setData({ previewScrollIntoView: '' })
      }
    },

    scheduleLayoutUndoExpiry() {
      if (this._undoTimer) clearTimeout(this._undoTimer)
      this._undoTimer = null
      if (!this._layoutUndoSnapshot || !this._alive || !this._visible) return
      const visibilityToken = this._visibilityToken
      const delay = Math.max(0, Number(this._layoutUndoExpiresAt || 0) - Date.now())
      this._undoTimer = setTimeout(() => {
        if (!this._alive || !this._visible || this._visibilityToken !== visibilityToken) return
        this._undoTimer = null
        this._layoutUndoSnapshot = null
        this._layoutUndoExpiresAt = 0
        this.setData({ layoutUndoVisible: false })
      }, delay)
    },

    cancelCanvasFrame() {
      this._drawToken += 1
      const node = this._canvasNode
      const frame = this._drawFrame
      this._drawFrame = null
      if (node && frame !== null && typeof node.cancelAnimationFrame === 'function') {
        try { node.cancelAnimationFrame(frame) } catch (_) {}
      }
    },

    isStageCanvasBlocked() {
      const data = this.data || {}
      return Boolean(data.layoutPanelVisible || data.locateVisible || data.placementVisible
        || data.previewVisible || data.isGeneratingImage || data.exportCanvasActive)
    },

    suspendStageCanvas() {
      this._measureToken += 1
      this.cancelCanvasFrame()
      this._canvasNode = null
      this._canvasContext = null
      this._canvasAdapter = null
    },

    restoreStageCanvas() {
      if (!this._alive || !this._visible || this.isStageCanvasBlocked()) return
      const visibilityToken = this._visibilityToken
      this.measureCanvas(() => {
        if (!this._alive || !this._visible || this._visibilityToken !== visibilityToken || this.isStageCanvasBlocked()) return
        this.drawLayout()
      })
    },

    onResize(event = {}) {
      if (!this._alive || !this._visible) return
      if (this._touchState || this._gesture || this._pressTimer || this._dragOriginalLayout) this.clearPendingGesture()
      const viewport = readLayoutViewportMetrics(wx, isLandscape, event && event.size || {})
      if (!this._viewManuallyAdjusted) {
        this._viewAutoFit = viewport.windowWidth > viewport.windowHeight
        if (!this._viewAutoFit) this._view = { s: 1, x: 0, y: 0 }
      }
      this._canvasRect = { left: 0, top: 0, width: viewport.canvasWidth, height: viewport.canvasHeight }
      this._previewViewportWidth = Math.min(640, Math.max(180, viewport.windowWidth - 56))
      this._previewColumnStep = viewport.windowHeight <= 460 ? 48 : 56
      this._previewTrackPadding = viewport.windowHeight <= 460 ? 20 : 28
      this.setData(viewport, () => {
        if (!this._alive || !this._visible) return
        if (this._layout) this.updateLayoutData()
        if (this.data.placementVisible) this.measurePreviewViewport()
        if (this.isStageCanvasBlocked()) return
        this.measureCanvas(() => {
          if (!this._alive || !this._visible || this.isStageCanvasBlocked()) return
          this.drawLayout()
        })
      })
    },

    onHide() {
      this._visible = false
      this._visibilityToken += 1
      this._measureToken += 1
      this._previewMeasureToken += 1
      this._workspaceLoadToken += 1
      this._viewAnimationToken += 1
      this.cancelAllSheetCloses()
      this.invalidatePendingSettingsConfirm()
      this.invalidatePendingClear()
      this.cancelPreviewScrollCommand()
      this.cancelCanvasFrame()
      if (this._highlightTimer) clearTimeout(this._highlightTimer)
      this._highlightTimer = null
      if (this._layoutPanelTimer) clearTimeout(this._layoutPanelTimer)
      this._layoutPanelTimer = null
      if (this._undoTimer) clearTimeout(this._undoTimer)
      this._undoTimer = null
      this.clearPendingGesture()
      this.invalidateExportPreview()
      this.setData({
        layoutPanelVisible: false,
        layoutPanelClosing: false,
        placementVisible: false,
        placementClosing: false,
        reductionConfirm: null,
        reductionClosing: false,
        previewVisible: false,
        previewClosing: false,
      })
      this.cancelExportGeneration()
      this.cancelSaveAllImages()
    },

    onUnload() {
      this._alive = false
      this._visible = false
      this._visibilityToken += 1
      this._measureToken += 1
      this._previewMeasureToken += 1
      this._workspaceLoadToken += 1
      this._generationToken += 1
      this._viewAnimationToken += 1
      this.cancelAllSheetCloses()
      this.invalidatePendingSettingsConfirm()
      this.invalidatePendingClear()
      this.cancelPreviewScrollCommand()
      this.cancelCanvasFrame()
      this.clearPendingGesture()
      this.cancelExportGeneration()
      this.cancelSaveAllImages()
      if (this._highlightTimer) clearTimeout(this._highlightTimer)
      if (this._layoutPanelTimer) clearTimeout(this._layoutPanelTimer)
      if (this._undoTimer) clearTimeout(this._undoTimer)
      this._layoutUndoSnapshot = null
      this._layoutUndoExpiresAt = 0
      if (this._themeChangeHandler && typeof wx.offThemeChange === 'function') {
        try { wx.offThemeChange(this._themeChangeHandler) } catch (_) {}
      }
      this._themeChangeHandler = null
      this._canvasNode = null
      this._canvasContext = null
      this._canvasAdapter = null
      this._exportCanvasNode = null
      this._exportCanvasContext = null
      this._exportCanvasAdapter = null
      if (typeof wx.hideLoading === 'function') wx.hideLoading()
    },

    loadWorkspace() {
      if (!this._alive || !this._visible) return
      const loadToken = ++this._workspaceLoadToken
      const activeLoad = () => this._alive && this._visible && this._workspaceLoadToken === loadToken
      const previousContextId = this._contextId
      const previousRevision = this._revision
      const previousSchemeFingerprint = this._loadedSchemeFingerprint
      const workspace = readLightingWorkspace(this._requestedContextId || undefined)
      if (!workspace.ok) {
        this.invalidateExportPreview()
        this.setData({ hasPlan: false, errorText: workspace.error || '灯光工作区读取失败。' })
        return
      }
      const calculated = calculateScheme(workspace.scheme)
      if (!calculated.ok || !calculated.valid) {
        this.setData({ hasPlan: false, errorText: calculated.error || '请先完成灯具编址。' })
        return
      }
      if (previousSchemeFingerprint && (String(previousContextId) !== String(workspace.contextId)
        || previousRevision !== workspace.revision
        || previousSchemeFingerprint !== schemeFingerprint(workspace.scheme))) {
        this.invalidateExportPreview()
        if (this._layoutUndoSnapshot && (String(previousContextId) !== String(workspace.contextId)
          || layoutFingerprint(workspace.scheme.layout) !== this._persistedLayoutFingerprint)) {
          this.clearLayoutUndo()
        }
      }
      this._contextId = workspace.contextId || TEMPORARY_CONTEXT_ID
      this._revision = workspace.revision
      this._scheme = calculated.scheme
      this._loadedSchemeFingerprint = schemeFingerprint(workspace.scheme)
      this._persistedLayoutFingerprint = layoutFingerprint(workspace.scheme.layout)
      this._fixtures = calculated.result.fixtures || []
      this._groups = calculated.result.groups || []
      let layout = clone(calculated.scheme.layout)
      let migrated = null
      if (!layout) {
        migrated = migrateLegacyLayout(calculated.scheme.legacySideLayout, this._fixtures, this._groups)
        layout = migrated.layout || createDefaultStageLayout('12', '8', () => makeId('rod'))
      }
      this._layout = layout
      this._activeRodId = rodRows(layout)[0] ? rodRows(layout)[0].id : ''
      this.setLayoutDirty(false)
      const contexts = getLightingContexts()
      const contextRows = contexts.ok && Array.isArray(contexts.rows) ? contexts.rows : []
      const contextPickerIndex = Math.max(0, contextRows.findIndex((item) => String(item.id) === String(this._contextId)))
      const activeContext = contextRows.find((item) => String(item.id) === String(this._contextId))
      const title = String(activeContext && activeContext.name
        || decodeRouteDisplayLabel(this._requestedContextLabel)
        || (this._contextId === TEMPORARY_CONTEXT_ID ? '临时设置' : '项目灯光方案'))
      const totalFixtures = this._fixtures.length
      const totalGroups = this._groups.length
      this.setData({
        hasPlan: true,
        errorText: '',
        contextId: this._contextId,
        contextLabel: title,
        lightingContexts: contextRows,
        contextPickerIndex,
        totalGroups,
        totalFixtures,
        planSummary: totalGroups + ' 组 · ' + totalFixtures + ' 台灯具',
        saveNotice: migrated && migrated.migrated
          ? '已将旧灯位转换为新布局，原始记录仍保留。'
          : '',
        saveRetryVisible: false,
      }, () => {
        if (!activeLoad()) return
        this.updateLayoutData()
        this.measureCanvas(() => {
          if (!activeLoad()) return
          this.drawLayout()
          if (migrated && migrated.migrated) this.saveLayoutOnly(layout)
          if (this._openExportOnLoad) {
            this._openExportOnLoad = false
            this.generateLayoutImage()
          }
        })
      })
    },

    measureCanvas(callback) {
      if (!this._alive || !this._visible || this.isStageCanvasBlocked()) return
      const measureToken = ++this._measureToken
      const visibilityToken = this._visibilityToken
      const activeMeasure = () => this._alive && this._visible
        && !this.isStageCanvasBlocked()
        && this._measureToken === measureToken
        && this._visibilityToken === visibilityToken
      if (typeof wx.createSelectorQuery !== 'function') {
        this.showCanvasMeasureRetry()
        return
      }
      const query = wx.createSelectorQuery().in(this)
      let shellRect = null
      let canvasInfo = null
      query.select('#dmxLayoutCanvasShell').boundingClientRect((rect) => { shellRect = rect })
      query.select('#' + CANVAS_ID).fields({ node: true, size: true }, (fields) => { canvasInfo = fields })
      query.exec(() => {
        if (!activeMeasure()) return
        const node = canvasInfo && canvasInfo.node
        const widthValue = canvasInfo && canvasInfo.width !== undefined
          ? Number(canvasInfo.width)
          : Number(shellRect && shellRect.width)
        const heightValue = canvasInfo && canvasInfo.height !== undefined
          ? Number(canvasInfo.height)
          : Number(shellRect && shellRect.height)
        if (!node || !shellRect || !Number.isFinite(widthValue) || widthValue <= 0
          || !Number.isFinite(heightValue) || heightValue <= 0
          || typeof node.requestAnimationFrame !== 'function') {
          this.showCanvasMeasureRetry()
          return
        }
        const width = widthValue
        const height = heightValue
        if (this._canvasNode && this._canvasNode !== node) this.cancelCanvasFrame()
        const pixelRatio = getDevicePixelRatio(wx)
        try {
          const configured = configureCanvas2DNode(node, width, height, pixelRatio)
          this._canvasNode = node
          this._canvasContext = configured.context
          this._canvasAdapter = configured.rendererContext
          this._canvasPixelRatio = configured.pixelRatio
          this._canvasRect = {
            left: Number(shellRect.left) || 0,
            top: Number(shellRect.top) || 0,
            width,
            height,
          }
        } catch (error) {
          this.showCanvasMeasureRetry()
          return
        }
        const patch = {}
        if (width !== Number(this.data.canvasWidth) || height !== Number(this.data.canvasHeight)) {
          patch.canvasWidth = width
          patch.canvasHeight = height
        }
        if (this.data.saveNotice === '舞台画布尺寸无效，请稍后重试。') {
          patch.saveNotice = ''
          patch.saveRetryVisible = false
        }
        const done = () => { if (callback && activeMeasure()) callback() }
        if (Object.keys(patch).length) this.setData(patch, done)
        else done()
      })
    },

    showCanvasMeasureRetry() {
      if (!this._alive || !this._visible) return
      this.setData({ saveNotice: '舞台画布尺寸无效，请稍后重试。', saveRetryVisible: true })
    },

    measurePreviewViewport() {
      if (!this._alive || !this._visible || !this.data.placementVisible
        || typeof wx.createSelectorQuery !== 'function') return
      const measureToken = ++this._previewMeasureToken
      const visibilityToken = this._visibilityToken
      const active = () => this._alive && this._visible && this.data.placementVisible
        && this._visibilityToken === visibilityToken
        && this._previewMeasureToken === measureToken
      const query = wx.createSelectorQuery()
      query.select('.placement-preview-strip').boundingClientRect((rect) => {
        if (!active() || !rect || !Number(rect.width)) return
        const width = Number(rect.width)
        if (Math.abs(width - this._previewViewportWidth) < 1) return
        this._previewViewportWidth = width
        this.updateLayoutData()
      }).exec()
    },

    canvasDimensions() {
      return {
        width: Number(this._canvasRect && this._canvasRect.width) || Number(this.data.canvasWidth) || canvasWidth,
        height: Number(this._canvasRect && this._canvasRect.height) || Number(this.data.canvasHeight) || canvasHeight,
      }
    },

    getGeometry() {
      if (!this._layout) return null
      const size = this.canvasDimensions()
      const key = JSON.stringify([
        size.width,
        size.height,
        this._layout.stageWidthText,
        this._layout.stageDepthText,
        this._layout.apronDirection,
        (this._layout.internalRods || []).map((rod) => [rod.id, rod.distance]),
        (this._layout.frontRods || []).map((rod) => [rod.id, rod.distance]),
        (this._layout.legacySideRods || []).map((rod) => [rod.id, rod.side, rod.distance, rod.startT, rod.endT, rod.positionIndex]),
      ])
      if (!this._geometry || key !== this._geometryKey) {
        this._geometry = createStageGeometry(this._layout, size.width, size.height)
        this._geometryKey = key
        if (this._viewAutoFit) {
          this._view = fitLandscapeView(this._geometry, size.width, size.height)
        }
      }
      return this._geometry
    },

    updateLayoutData(extra = {}) {
      const layout = this._layout || {}
      const groups = makeGroups(this._groups, this._fixtures, this._scheme, layout)
      const legend = makeCanvasLegend(groups, this.data.canvasShellHeight)
      const validRodIds = new Set(rodRows(layout).map((rod) => String(rod.id)))
      let placed = 0
      Object.values(layout.positionsById || {}).forEach((position) => {
        if (position && validRodIds.has(String(position.rodId))) placed += 1
      })
      const fixturesByRod = (layout.positionsById || {})[this._activeRodId]
      const activeRod = rodRows(layout).find((rod) => rod.id === this._activeRodId)
      const fixtureById = new Map(this._fixtures.map((fixture) => [String(fixture.stableId), fixture]))
      const preview = Object.entries(layout.positionsById || {})
        .filter(([, position]) => String(position.rodId) === String(this._activeRodId))
        .map(([id, position]) => ({ fixture: fixtureById.get(id), position }))
        .filter((entry) => entry.fixture)
        .sort((a, b) => Number(a.position.t) - Number(b.position.t))
      const previewItems = preview.map(({ fixture, position }, index) => ({
        id: String(fixture.stableId),
        addressText: fixture.addressText,
        groupName: fixture.groupName,
        fixtureType: classifyFixtureVisualType(fixture),
        color: LAYOUT_GROUP_COLORS[Math.max(0, Number(fixture.groupIndex) || 0) % LAYOUT_GROUP_COLORS.length],
        index: index + 1,
        t: Number(position.t),
        scrollId: 'preview-' + String(fixture.stableId),
      }))
      const filter = String(this.data.placementFilterText || '').trim().toLocaleLowerCase()
      const filteredGroups = filter
        ? groups.map((group) => ({
          ...group,
          fixtures: group.fixtures.filter((fixture) => [fixture.addressText, fixture.groupName, fixture.fixtureModel]
            .some((value) => String(value || '').toLocaleLowerCase().includes(filter))),
        })).filter((group) => group.fixtures.length)
        : groups
      const visibleGroups = filteredGroups.map((group) => ({
        ...group,
        fixtures: group.fixtures.map((fixture) => ({
          ...fixture,
          placedOnSelectedRod: fixture.placed && String(fixture.rodId) === String(this._activeRodId),
          placedElsewhere: fixture.placed && String(fixture.rodId) !== String(this._activeRodId),
          shortRodName: fixture.rodName.replace('灯杆', '杆').replace('面光杆', '面光'),
        })),
      }))
      const previewStep = Math.max(1, Number(this._previewColumnStep) || 56)
      const previewTrackWidth = Math.max(1, previewItems.length * previewStep + (Number(this._previewTrackPadding) || 28))
      const selectedRodId = String(this._activeRodId || '')
      const sameRod = selectedRodId === String(this._lastPreviewRodId || '')
      const viewportPixels = Math.max(1, Number(this._previewViewportWidth)
        || Math.max(180, (Number(this._canvasRect && this._canvasRect.width) || 390) - 56))
      const viewportWidth = previewItems.length ? Math.min(100, viewportPixels / previewTrackWidth * 100) : 100
      const maxScroll = Math.max(0, previewTrackWidth - viewportPixels)
      const previewScrollLeft = sameRod ? Math.max(0, Math.min(maxScroll, Number(this._previewScrollLeft) || 0)) : 0
      const rangeStart = previewItems.length ? Math.min(previewItems.length, Math.floor(previewScrollLeft / previewStep) + 1) : 0
      const rangeEnd = previewItems.length
        ? Math.min(previewItems.length, Math.max(rangeStart, Math.ceil((previewScrollLeft + viewportPixels) / previewStep)))
        : 0
      const previewViewportLeft = maxScroll ? previewScrollLeft / maxScroll * Math.max(0, 100 - viewportWidth) : 0
      this._lastPreviewRodId = selectedRodId
      this._previewScrollLeft = previewScrollLeft
      this.setData({
        ...extra,
        layout: clone(layout),
        placedFixtureCount: placed,
        unplacedFixtureCount: Math.max(0, this._fixtures.length - placed),
        placementGroups: visibleGroups,
        ...legend,
        selectedRodId: this._activeRodId,
        selectedRodName: activeRod ? rodName(layout, activeRod.id) : '选择一根灯杆',
        selectedRodCount: previewItems.length,
        selectedRodOverview: previewItems,
        previewItems,
        previewViewportLeft,
        previewViewportWidth: viewportWidth,
        previewRangeText: previewItems.length
          ? '当前 ' + rangeStart + '–' + rangeEnd + ' / 共 ' + previewItems.length + ' 台'
          : '暂无灯具',
        geometryDirectionText: layout.apronDirection || 'bottom',
      })
    },

    requestPreviewScrollIntoView(fixtureId) {
      if (!this._alive || !this._visible || !this.data.placementVisible || this.data.placementClosing) return
      const id = String(fixtureId || '')
      const item = (this.data.previewItems || []).find((previewItem) => previewItem.id === id)
      if (!item) return
      const token = ++this._previewScrollCommandToken
      const visibilityToken = this._visibilityToken
      const contextId = this._contextId
      if (this._previewScrollCommandTimer) clearTimeout(this._previewScrollCommandTimer)
      this._previewScrollCommandTimer = null
      this._previewPendingScroll = null
      this.setData({ previewScrollIntoView: '' }, () => {
        if (!this._alive || !this._visible || !this.data.placementVisible || this.data.placementClosing
          || this._visibilityToken !== visibilityToken || this._contextId !== contextId
          || this._previewScrollCommandToken !== token) return
        this.setData({ previewScrollIntoView: item.scrollId })
        this._previewScrollCommandTimer = setTimeout(() => {
          if (!this._alive || !this._visible || this._visibilityToken !== visibilityToken
            || this._contextId !== contextId || this._previewScrollCommandToken !== token) return
          this._previewScrollCommandTimer = null
          this.setData({ previewScrollIntoView: '' })
        }, 240)
      })
    },

    flushPreviewScrollMetrics() {
      this._previewScrollMetricsTimer = null
      const pending = this._previewPendingScroll
      this._previewPendingScroll = null
      if (!pending || !this._alive || !this._visible || !this.data.placementVisible || this.data.placementClosing
        || pending.visibilityToken !== this._visibilityToken || pending.contextId !== this._contextId
        || pending.rodId !== String(this._activeRodId || '')) return
      const count = Number(this.data.selectedRodCount) || 0
      if (!count) return
      const step = Math.max(1, Number(this._previewColumnStep) || 56)
      const scrollWidth = Math.max(pending.viewportWidth, pending.scrollWidth)
      const widthPercent = Math.min(100, pending.viewportWidth / scrollWidth * 100)
      const maxScroll = Math.max(1, scrollWidth - pending.viewportWidth)
      const leftPercent = Math.max(0, Math.min(100 - widthPercent,
        pending.scrollLeft / maxScroll * (100 - widthPercent)))
      const start = Math.min(count, Math.floor(pending.scrollLeft / step) + 1)
      const end = Math.min(count, Math.max(start, Math.ceil((pending.scrollLeft + pending.viewportWidth) / step)))
      const rangeText = '当前 ' + start + '–' + end + ' / 共 ' + count + ' 台'
      const patch = {}
      if (Math.abs(Number(this.data.previewViewportLeft) - leftPercent) > .15) patch.previewViewportLeft = leftPercent
      if (Math.abs(Number(this.data.previewViewportWidth) - widthPercent) > .15) patch.previewViewportWidth = widthPercent
      if (String(this.data.previewRangeText || '') !== rangeText) patch.previewRangeText = rangeText
      if (Object.keys(patch).length) this.setData(patch)
    },

    onPreviewScroll(event) {
      if (!this._alive || !this._visible || !this.data.placementVisible || this.data.placementClosing) return
      const count = Number(this.data.selectedRodCount) || 0
      if (!count) return
      const detail = event.detail || {}
      const scrollLeft = Math.max(0, Number(detail.scrollLeft) || 0)
      const step = Math.max(1, Number(this._previewColumnStep) || 56)
      const fallbackScrollWidth = count * step + (Number(this._previewTrackPadding) || 28)
      const viewportWidth = Math.max(1, Number(detail.width || detail.viewWidth)
        || Number(this._previewViewportWidth)
        || Math.max(180, (Number(this._canvasRect && this._canvasRect.width) || 390) - 56))
      const scrollWidth = Math.max(viewportWidth, Number(detail.scrollWidth) || fallbackScrollWidth)
      this._previewViewportWidth = viewportWidth
      this._previewScrollLeft = scrollLeft
      this._previewPendingScroll = {
        scrollLeft,
        viewportWidth,
        scrollWidth,
        visibilityToken: this._visibilityToken,
        contextId: this._contextId,
        rodId: String(this._activeRodId || ''),
      }
      if (!this._previewScrollMetricsTimer) {
        this._previewScrollMetricsTimer = setTimeout(() => this.flushPreviewScrollMetrics(), 40)
      }
    },

    drawLayout() {
      if (!this._alive || !this._visible || this.isStageCanvasBlocked() || !this._layout || !this._canvasNode || !this._canvasAdapter) return
      if (this._drawFrame !== null) return
      const node = this._canvasNode
      const drawToken = ++this._drawToken
      const visibilityToken = this._visibilityToken
      this._drawFrame = node.requestAnimationFrame(() => {
        this._drawFrame = null
        if (!this._alive || !this._visible || this._visibilityToken !== visibilityToken
          || this.isStageCanvasBlocked()
          || this._drawToken !== drawToken || this._canvasNode !== node || !this._layout || !this._canvasAdapter) return
        const size = this.canvasDimensions()
        const snapshot = {
          layout: this._layout,
          fixtures: this._fixtures,
          geometry: this.getGeometry(),
          theme: getCanvasTheme(this._theme || (this.data.darkMode ? 'dark' : 'light')),
          selectedFixtureId: this.data.selectedFixtureId || '',
          highlightFixtureId: this.data.highlightFixtureId || '',
          selectedRodId: this.data.placementVisible ? this._activeRodId : '',
          draggingFixtureId: this._touchState && this._touchState.dragging ? this._touchState.fixtureId : '',
        }
        renderStageDiagram(this._canvasAdapter, snapshot, {
          view: this._view,
          background: this.data.darkMode ? '#000000' : '#ffffff',
          backgroundWidth: size.width,
          backgroundHeight: size.height,
          pixelRatio: 1,
        })
      })
    },

    saveLayoutOnly(nextLayout) {
      if (!this._contextId) return false
      this.invalidateExportPreview()
      this.clearLayoutUndo()
      const latest = readLightingWorkspace(this._contextId)
      if (!latest.ok) {
        this._layout = clone(nextLayout)
        this.setLayoutDirty(true)
        this.setData({ saveNotice: latest.error || '布局保存失败，当前编辑仍保留。', saveRetryVisible: true })
        return false
      }
      if (layoutFingerprint(latest.scheme.layout) !== this._persistedLayoutFingerprint) {
        this._layout = clone(nextLayout)
        this.setLayoutDirty(true)
        this.setData({
          saveNotice: '灯位图已在其他页面更新；当前编辑仍保留，避免覆盖最新布局。',
          saveRetryVisible: false,
        })
        this.updateLayoutData()
        this.drawLayout()
        return false
      }
      const saved = saveLightingScheme(
        latest.contextId,
        { ...latest.scheme, layout: clone(nextLayout) },
        latest.revision,
      )
      if (!saved.ok) {
        this._layout = clone(nextLayout)
        this.setLayoutDirty(true)
        const notice = saved.error === 'conflict'
          ? '灯光方案已在其他页面更新；当前布局编辑仍保留，点此重试保存。'
          : saved.error || '布局保存失败，当前编辑仍保留。'
        this.setData({ saveNotice: notice, saveRetryVisible: true })
        this.updateLayoutData()
        this.drawLayout()
        return false
      }
      const calculated = calculateScheme(saved.scheme || { ...latest.scheme, layout: clone(nextLayout) })
      if (!calculated.ok || !calculated.valid) {
        this._layout = clone(nextLayout)
        this.setLayoutDirty(true)
        this.setData({ saveNotice: calculated.error || '灯光方案刷新失败，当前布局编辑仍保留。', saveRetryVisible: false })
        return false
      }
      this._scheme = calculated.scheme
      this._fixtures = calculated.result.fixtures || []
      this._groups = calculated.result.groups || []
      this._revision = saved.revision
      this._layout = clone(this._scheme.layout || nextLayout)
      this._persistedLayoutFingerprint = layoutFingerprint(this._scheme.layout)
      this._loadedSchemeFingerprint = schemeFingerprint(saved.scheme || this._scheme)
      this.setLayoutDirty(false)
      this.setData({
        saveNotice: '',
        saveRetryVisible: false,
        totalGroups: this._groups.length,
        totalFixtures: this._fixtures.length,
        planSummary: this._groups.length + ' 组 · ' + this._fixtures.length + ' 台灯具',
      })
      this.updateLayoutData()
      this.drawLayout()
      return true
    },

    retryLayoutSave() {
      if (!this._layout) return
      if (!this._layoutDirty) {
        this.measureCanvas(() => this.drawLayout())
        return
      }
      if (this.saveLayoutOnly(this._layout) && this._alive && this._visible) vibrate('medium')
    },

    ...layoutSettingsMethods,

    ...layoutPlacementMethods,

    goBack() {
      if (this._layoutDirty && !this.saveLayoutOnly(this._layout)) return
      if (typeof wx.navigateBack === 'function') wx.navigateBack({ delta: 1 })
    },

    onLightingContextPickerChange(event) {
      const index = Number(event && event.detail && event.detail.value)
      const rows = this.data.lightingContexts || []
      const row = Number.isInteger(index) ? rows[index] : null
      if (!row) {
        const currentIndex = Math.max(0, rows.findIndex((item) => String(item.id) === String(this._contextId)))
        this.setData({ contextPickerIndex: currentIndex })
        return
      }
      this.selectLightingContext({ currentTarget: { dataset: { contextId: row.id } } })
    },

    selectLightingContext(event) {
      const nextId = String(event.currentTarget.dataset.contextId || '')
      if (!nextId || nextId === this._contextId) {
        const currentIndex = Math.max(0, (this.data.lightingContexts || []).findIndex((item) => String(item.id) === String(this._contextId)))
        this.setData({ contextPickerIndex: currentIndex })
        return
      }
      if (this._layoutDirty && !this.saveLayoutOnly(this._layout)) {
        const currentIndex = Math.max(0, (this.data.lightingContexts || []).findIndex((item) => String(item.id) === String(this._contextId)))
        this.setData({ contextPickerIndex: currentIndex })
        return
      }
      const row = (this.data.lightingContexts || []).find((item) => String(item.id) === nextId)
      const current = readLightingWorkspace(this._contextId)
      if (!current.ok) {
        const currentIndex = Math.max(0, (this.data.lightingContexts || []).findIndex((item) => String(item.id) === String(this._contextId)))
        this.setData({ contextPickerIndex: currentIndex })
        wx.showToast({ title: current.error || '读取灯光方案失败', icon: 'none' })
        return
      }
      const switched = switchLightingContext(nextId, current.scheme, current.revision, current.contextId)
      if (!switched.ok) {
        const currentIndex = Math.max(0, (this.data.lightingContexts || []).findIndex((item) => String(item.id) === String(this._contextId)))
        this.setData({ contextPickerIndex: currentIndex })
        wx.showToast({ title: switched.error === 'conflict' ? '灯光方案已更新，请重新打开后再切换' : switched.error || '切换失败', icon: 'none' })
        return
      }
      if (String(switched.contextId || nextId) !== String(current.contextId)) {
        this.cancelAllSheetCloses()
        this.invalidatePendingSettingsConfirm()
        this.invalidatePendingClear()
        this.cancelPreviewScrollCommand()
        this._viewAnimationToken += 1
        if (this._highlightTimer) clearTimeout(this._highlightTimer)
        this._highlightTimer = null
        this.clearPendingGesture()
        this._view = { s: 1, x: 0, y: 0 }
        this._viewAutoFit = isLandscape
        this._viewManuallyAdjusted = false
        this._activeRodId = ''
        this.setData({
          selectedFixtureId: '',
          highlightFixtureId: '',
          manipulationText: '',
          scrollEnabled: true,
          layoutPanelVisible: false,
          layoutPanelClosing: false,
          placementVisible: false,
          placementClosing: false,
          reductionConfirm: null,
          reductionClosing: false,
          previewVisible: false,
          previewClosing: false,
        })
      }
      this.invalidateExportPreview()
      this._requestedContextId = nextId
      this._requestedContextLabel = row && row.name || ''
      this.setLayoutDirty(false)
      this.loadWorkspace()
    },

    ...layoutLocateMethods,

    ...layoutExportMethods,

  }
  return page
}

module.exports = { createDmxLayoutPage, GROUP_COLORS, LAYOUT_GROUP_COLORS, CANVAS_THEMES }
