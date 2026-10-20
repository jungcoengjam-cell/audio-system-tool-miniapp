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
const EXPORT_HEIGHT = 2400

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
      draftDirectionOptions: [
        { value: 'top', text: '上' },
        { value: 'right', text: '右' },
        { value: 'bottom', text: '下' },
        { value: 'left', text: '左' },
      ],
      placementGroups: [],
      selectedRodId: '',
      selectedRodName: '',
      selectedRodCount: 0,
      selectedRodOverview: [],
      previewViewportLeft: 0,
      previewViewportWidth: 100,
      previewScrollLeft: 0,
      previewRangeText: '暂无灯具',
      previewScrollIntoView: '',
      panelScrollIntoView: '',
      placementNotice: '点选灯具即可上杆或下杆',
      searchText: '',
      searchResultText: '',
      searchFixtureType: '',
      searchResults: [],
      searchErrorText: '',
      locateVisible: false,
      locateClosing: false,
      lightingContexts: [],
      contextPickerIndex: 0,
      placementFilterText: '',
      arrangementMode: 'preserve',
      layoutUndoVisible: false,
      highlightFixtureId: '',
      manipulationText: '',
      reductionConfirm: null,
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
      this._viewAnimationToken = 0
      this._canvasNode = null
      this._canvasContext = null
      this._canvasAdapter = null
      this._canvasPixelRatio = 1
      this._drawFrame = null
      this._drawToken = 0
      this._measureToken = 0
      const info = typeof wx.getSystemInfoSync === 'function' ? wx.getSystemInfoSync() : {}
      const windowWidth = Number(info.windowWidth) || (isLandscape ? 844 : 390)
      const windowHeight = Number(info.windowHeight) || (isLandscape ? 390 : 844)
      const statusBarHeight = Math.max(0, Number(info.statusBarHeight || info.safeArea && info.safeArea.top) || 0)
      let capsule = null
      try {
        capsule = typeof wx.getMenuButtonBoundingClientRect === 'function' ? wx.getMenuButtonBoundingClientRect() : null
      } catch (error) {
        capsule = null
      }
      const navigationBodyHeight = capsule
        ? Math.max(44, Number(capsule.bottom || statusBarHeight + 44) - statusBarHeight + 8)
        : 44
      const navigationHeight = statusBarHeight + navigationBodyHeight
      const shareTop = statusBarHeight + Math.max(3, (navigationBodyHeight - 38) / 2)
      const shareRight = capsule ? Math.max(8, windowWidth - Number(capsule.left || windowWidth - 92) + 8) : 12
      const shareLeft = windowWidth - shareRight - 38
      const navTitleCenter = Math.max(76, Math.min(windowWidth / 2, shareLeft - 40))
      const canvasShellHeight = Math.max(isLandscape ? 180 : 360, windowHeight - (isLandscape ? 124 : 164))
      this._canvasRect = { left: 0, top: 0, width: windowWidth, height: canvasShellHeight }
      this._previewViewportWidth = Math.min(640, Math.max(180, windowWidth - 56))
      this._previewMeasureToken = 0
      this._lastPreviewRodId = ''
      this._previewScrollLeft = 0
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
        statusBarHeight,
        navigationHeight,
        navTitleCenter,
        shareTop,
        shareRight,
        canvasShellHeight,
        canvasWidth: windowWidth,
        canvasHeight: canvasShellHeight,
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
      this._generationToken += 1
      this._exportSnapshot = null
      this._exportPages = []
      this._exportPaths = []
      this._exportCanvasNode = null
      this._exportCanvasContext = null
      this._exportCanvasAdapter = null
      if (!this.data || !this._alive) return
      const wasGenerating = Boolean(this.data.isGeneratingImage)
      this.setData({
        previewVisible: false,
        exportCanvasActive: false,
        layoutImagePath: '',
        layoutImagePaths: [],
        exportPageIndex: 0,
        exportPageCount: 0,
        isGeneratingImage: false,
      })
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

    onResize() {
      this.measureCanvas(() => {
        this.drawLayout()
        if (this.data.placementVisible) this.measurePreviewViewport()
      })
    },

    onHide() {
      this._visible = false
      this._visibilityToken += 1
      this._measureToken += 1
      this._previewMeasureToken += 1
      this._workspaceLoadToken += 1
      this._viewAnimationToken += 1
      this.cancelCanvasFrame()
      if (this._highlightTimer) clearTimeout(this._highlightTimer)
      this._highlightTimer = null
      if (this._layoutPanelTimer) clearTimeout(this._layoutPanelTimer)
      this._layoutPanelTimer = null
      if (this._undoTimer) clearTimeout(this._undoTimer)
      this._undoTimer = null
      this.clearPendingGesture()
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
      let title = this._requestedContextLabel || ''
      const contexts = getLightingContexts()
      const contextRows = contexts.ok && Array.isArray(contexts.rows) ? contexts.rows : []
      const contextPickerIndex = Math.max(0, contextRows.findIndex((item) => String(item.id) === String(this._contextId)))
      if (!title) {
        if (this._contextId === TEMPORARY_CONTEXT_ID) title = '临时设置'
        else {
          const row = contextRows.find((item) => String(item.id) === String(this._contextId))
          title = row ? row.name : '项目灯光方案'
        }
      }
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
      if (!this._alive || !this._visible) return
      const measureToken = ++this._measureToken
      const visibilityToken = this._visibilityToken
      const activeMeasure = () => this._alive && this._visible
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
          this._geometryKey = ''
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
      }
      return this._geometry
    },

    updateLayoutData(extra = {}) {
      const layout = this._layout || {}
      const groups = makeGroups(this._groups, this._fixtures, this._scheme, layout)
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
      const previewTrackWidth = Math.max(1, previewItems.length * 56 + 28)
      const selectedRodId = String(this._activeRodId || '')
      const sameRod = selectedRodId === String(this._lastPreviewRodId || '')
      const viewportPixels = Math.max(1, Number(this._previewViewportWidth)
        || Math.max(180, (Number(this._canvasRect && this._canvasRect.width) || 390) - 56))
      const viewportWidth = previewItems.length ? Math.min(100, viewportPixels / previewTrackWidth * 100) : 100
      const maxScroll = Math.max(0, previewTrackWidth - viewportPixels)
      const previewScrollLeft = sameRod ? Math.max(0, Math.min(maxScroll, Number(this._previewScrollLeft) || 0)) : 0
      const rangeStart = previewItems.length ? Math.min(previewItems.length, Math.floor(previewScrollLeft / 56) + 1) : 0
      const rangeEnd = previewItems.length
        ? Math.min(previewItems.length, Math.max(rangeStart, Math.ceil((previewScrollLeft + viewportPixels) / 56)))
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
        selectedRodId: this._activeRodId,
        selectedRodName: activeRod ? rodName(layout, activeRod.id) : '选择一根灯杆',
        selectedRodCount: previewItems.length,
        selectedRodOverview: previewItems,
        previewItems,
        previewViewportLeft,
        previewViewportWidth: viewportWidth,
        previewScrollLeft,
        previewRangeText: previewItems.length
          ? '当前 ' + rangeStart + '–' + rangeEnd + ' / 共 ' + previewItems.length + ' 台'
          : '暂无灯具',
        geometryDirectionText: layout.apronDirection || 'bottom',
      })
    },

    onPreviewScroll(event) {
      const count = Number(this.data.selectedRodCount) || 0
      if (!count) return
      const detail = event.detail || {}
      const scrollLeft = Math.max(0, Number(detail.scrollLeft) || 0)
      const viewportWidth = Math.max(1, Number(detail.width || detail.viewWidth)
        || Number(this._previewViewportWidth)
        || Math.max(180, (Number(this._canvasRect && this._canvasRect.width) || 390) - 56))
      const scrollWidth = Math.max(viewportWidth, Number(detail.scrollWidth) || count * 56 + 28)
      const widthPercent = Math.min(100, viewportWidth / scrollWidth * 100)
      const maxScroll = Math.max(1, scrollWidth - viewportWidth)
      const leftPercent = Math.max(0, Math.min(100 - widthPercent, scrollLeft / maxScroll * (100 - widthPercent)))
      const start = Math.min(count, Math.floor(scrollLeft / 56) + 1)
      const end = Math.min(count, Math.max(start, Math.ceil((scrollLeft + viewportWidth) / 56)))
      this._previewViewportWidth = viewportWidth
      this._previewScrollLeft = scrollLeft
      this.setData({
        previewViewportLeft: leftPercent,
        previewViewportWidth: widthPercent,
        previewScrollLeft: scrollLeft,
        previewRangeText: '当前 ' + start + '–' + end + ' / 共 ' + count + ' 台',
      })
    },

    drawLayout() {
      if (!this._alive || !this._visible || !this._layout || !this._canvasNode || !this._canvasAdapter) return
      if (this._drawFrame !== null) return
      const node = this._canvasNode
      const drawToken = ++this._drawToken
      const visibilityToken = this._visibilityToken
      this._drawFrame = node.requestAnimationFrame(() => {
        this._drawFrame = null
        if (!this._alive || !this._visible || this._visibilityToken !== visibilityToken
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
      vibrate('light')
      if (!this._layoutDirty) {
        this.measureCanvas(() => this.drawLayout())
        return
      }
      this.saveLayoutOnly(this._layout)
    },

    openLayoutSettings() {
      if (!this._layout) return
      vibrate('light')
      this.setData({
        layoutPanelVisible: true,
        layoutPanelClosing: false,
        layoutDraft: withDistanceTexts(this._layout),
        arrangementMode: 'preserve',
        reductionConfirm: null,
      })
    },

    closeLayoutSettings() {
      if (!this.data.layoutPanelVisible || this.data.layoutPanelClosing) return
      const visibilityToken = this._visibilityToken
      this.setData({ layoutPanelClosing: true })
      this._layoutPanelTimer = setTimeout(() => {
        if (!this._alive || !this._visible || this._visibilityToken !== visibilityToken) return
        this.setData({ layoutPanelVisible: false, layoutPanelClosing: false, reductionConfirm: null })
      }, 180)
    },

    onDraftStageInput(event) {
      const key = event.currentTarget.dataset.key
      const value = event.detail.value
      if (!['stageWidthText', 'stageDepthText'].includes(key)) return
      this.setData({ ['layoutDraft.' + key]: value })
    },

    onDraftDirectionTap(event) {
      const direction = event.currentTarget.dataset.direction
      if (!['bottom', 'right', 'top', 'left'].includes(direction)) return
      this.setData({ 'layoutDraft.apronDirection': direction })
    },

    onDraftArrangementTap(event) {
      const mode = String(event.currentTarget.dataset.mode || '')
      if (!['preserve', 'uniform'].includes(mode)) return
      this.setData({ arrangementMode: mode })
    },

    onDraftDistanceInput(event) {
      const kind = event.currentTarget.dataset.kind
      const index = Number(event.currentTarget.dataset.index)
      const value = event.detail.value
      if (!['internalRods', 'frontRods'].includes(kind) || !Number.isInteger(index)) return
      this.setData({ ['layoutDraft.' + kind + '[' + index + '].distanceText']: value })
    },

    addDraftRod(event) {
      const kind = event.currentTarget.dataset.kind
      if (!['internalRods', 'frontRods'].includes(kind)) return
      const draft = clone(this.data.layoutDraft)
      if (draft[kind].length >= 16) {
        wx.showToast({ title: '每类灯杆最多 16 根', icon: 'none' })
        return
      }
      const axis = stageAxisLength(draft)
      const distance = kind === 'frontRods' ? Math.max(.2, Math.min(1, axis * .15)) : Math.max(.2, axis * .35)
      draft[kind].push({ id: makeId(kind === 'frontRods' ? 'front' : 'internal'), distance, distanceText: String(distance) })
      this.setData({ layoutDraft: draft })
    },

    changeDraftRodCount(event) {
      const kind = String(event.currentTarget.dataset.kind || '')
      const delta = Number(event.currentTarget.dataset.delta)
      if (!['internalRods', 'frontRods'].includes(kind) || ![-1, 1].includes(delta)) return
      const draft = clone(this.data.layoutDraft)
      const rods = draft[kind] || []
      if (delta < 0) {
        if (rods.length) rods.pop()
      } else {
        if (rods.length >= 16) {
          wx.showToast({ title: '每类灯杆最多 16 根', icon: 'none' })
          return
        }
        const axis = stageAxisLength(draft)
        const raw = kind === 'frontRods' ? Math.max(.2, Math.min(1, axis * .15)) : Math.max(.2, Math.min(axis, axis * .35))
        const distance = Number(raw.toFixed(2))
        rods.push({ id: makeId(kind === 'frontRods' ? 'front' : 'internal'), distance, distanceText: String(distance) })
      }
      draft[kind] = rods
      this.setData({ layoutDraft: draft })
    },

    removeDraftRod(event) {
      const kind = event.currentTarget.dataset.kind
      const index = Number(event.currentTarget.dataset.index)
      if (!['internalRods', 'frontRods'].includes(kind) || !Number.isInteger(index)) return
      const draft = clone(this.data.layoutDraft)
      draft[kind].splice(index, 1)
      this.setData({ layoutDraft: draft })
    },

    applyLayoutSettings() {
      const draft = clone(this.data.layoutDraft)
      if (!draft) return
      const width = Number(draft.stageWidthText)
      const depth = Number(draft.stageDepthText)
      if (!(width > 0) || !(depth > 0) || width > 200 || depth > 200) {
        wx.showToast({ title: '舞台宽度和纵深需为 0–200 m', icon: 'none' })
        return
      }
      const axis = draft.apronDirection === 'left' || draft.apronDirection === 'right' ? width : depth
      const parseRods = (rods, maximum) => (rods || []).map((rod) => {
        const distance = Number(rod.distanceText)
        return Number.isFinite(distance) && distance > 0 && distance <= maximum
          ? { id: rod.id, distance }
          : null
      })
      const internalRods = parseRods(draft.internalRods, axis)
      const frontRods = parseRods(draft.frontRods, 200)
      if (internalRods.includes(null) || frontRods.includes(null)) {
        wx.showToast({ title: '舞台内灯杆需在舞台尺寸内，面光杆距离需不超过 200 m', icon: 'none' })
        return
      }
      const next = {
        ...this._layout,
        stageWidthText: String(draft.stageWidthText),
        stageDepthText: String(draft.stageDepthText),
        apronDirection: draft.apronDirection,
        internalRods,
        frontRods,
        positionsById: clone(this._layout.positionsById || {}),
      }
      const retained = new Set(rodRows(next).map((rod) => String(rod.id)))
      const removed = rodRows(this._layout).filter((rod) => !retained.has(String(rod.id)))
      const removedIds = new Set(removed.map((rod) => String(rod.id)))
      const affected = Object.entries(next.positionsById)
        .filter(([, position]) => removedIds.has(String(position.rodId)))
        .map(([id]) => this._fixtures.find((fixture) => String(fixture.stableId) === id))
        .filter(Boolean)
      if (affected.length) {
        this._pendingSettingsLayout = next
        this._pendingRemovedRodIds = removedIds
        this._pendingUniformArrange = this.data.arrangementMode === 'uniform'
        this.setData({
          reductionConfirm: {
            rods: removed.map((rod) => rodName(this._layout, rod.id)),
            fixtures: affected.map((fixture) => ({ id: fixture.stableId, addressText: fixture.addressText, groupName: fixture.groupName })),
            uniformArrange: this.data.arrangementMode === 'uniform',
          },
        })
        return
      }
      const uniformArrange = this.data.arrangementMode === 'uniform'
      const placedCount = Object.values(next.positionsById).filter((position) => !removedIds.has(String(position.rodId))).length
      if (uniformArrange && placedCount) {
        const visibilityToken = this._visibilityToken
        wx.showModal({
          title: '重新均匀排列',
          content: '将重新排列 ' + placedCount + ' 台已上杆灯具的位置。',
          confirmText: '重新排列',
          cancelText: '保留现状',
          success: (result) => {
            if (!result.confirm || !this._alive || !this._visible || this._visibilityToken !== visibilityToken) return
            this.applySettingsLayout(next, removedIds, true)
          },
        })
        return
      }
      this.applySettingsLayout(next, removedIds, uniformArrange)
    },

    confirmLayoutReduction() {
      if (!this._pendingSettingsLayout) return
      const next = this._pendingSettingsLayout
      const removedIds = this._pendingRemovedRodIds || new Set()
      const uniformArrange = Boolean(this._pendingUniformArrange)
      this._pendingSettingsLayout = null
      this._pendingRemovedRodIds = null
      this._pendingUniformArrange = false
      this.setData({ reductionConfirm: null })
      this.applySettingsLayout(next, removedIds, uniformArrange)
    },

    cancelLayoutReduction() {
      this._pendingSettingsLayout = null
      this._pendingRemovedRodIds = null
      this._pendingUniformArrange = false
      this.setData({ reductionConfirm: null })
    },

    applySettingsLayout(next, removedIds, uniformArrange = false) {
      const previousLayout = clone(this._layout)
      const oldGeometry = this.getGeometry()
      const tolerance = oldGeometry && oldGeometry.stage
        ? Math.min(oldGeometry.stage.width, oldGeometry.stage.height) * .012
        : 0
      Object.keys(next.positionsById || {}).forEach((id) => {
        if (removedIds.has(String(next.positionsById[id].rodId))) delete next.positionsById[id]
      })
      const size = this.canvasDimensions()
      const nextGeometry = createStageGeometry(next, size.width, size.height)
      const frameChanged = stageFrameChanged(previousLayout, next)
      Object.keys(next.positionsById || {}).forEach((id) => {
        const position = next.positionsById[id]
        if (!position || !position.legacyPoint || !oldGeometry) return
        const oldRod = oldGeometry.rods.find((rod) => String(rod.id) === String(position.rodId))
        const newRod = nextGeometry.rods.find((rod) => String(rod.id) === String(position.rodId))
        if (!oldRod || !newRod) return
        const priorPoint = layoutFixturePoint(oldGeometry, oldRod, position)
        if (frameChanged || rodFrameChanged(previousLayout, next, position.rodId)) {
          const relative = {
            x: (priorPoint.x - oldGeometry.stage.left) / Math.max(1, oldGeometry.stage.width),
            y: (priorPoint.y - oldGeometry.stage.top) / Math.max(1, oldGeometry.stage.height),
          }
          const pointOnNewStage = {
            x: nextGeometry.stage.left + relative.x * nextGeometry.stage.width,
            y: nextGeometry.stage.top + relative.y * nextGeometry.stage.height,
          }
          position.t = projectPointToRod(newRod, pointOnNewStage)
          delete position.legacyPoint
          return
        }
        const onRodPoint = pointOnRod(oldRod, position.t)
        if (touchDistance(priorPoint, onRodPoint) <= tolerance) delete position.legacyPoint
      })
      if (uniformArrange) {
        nextGeometry.rods.forEach((rod) => {
          const entries = Object.entries(next.positionsById || {})
            .filter(([, position]) => String(position.rodId) === String(rod.id))
            .sort((a, b) => Number(a[1].t) - Number(b[1].t))
          if (!entries.length) return
          const start = rod.type === 'legacy-side' ? Number(rod.startT) + .02 : .04
          const end = rod.type === 'legacy-side' ? Number(rod.endT) - .02 : .96
          entries.forEach(([id], index) => {
            next.positionsById[id] = { rodId: String(rod.id), t: start + ((index + 1) / (entries.length + 1)) * (end - start) }
          })
        })
      }
      this._layout = clone(next)
      if (!rodRows(next).some((rod) => String(rod.id) === String(this._activeRodId))) {
        this._activeRodId = rodRows(next)[0] ? rodRows(next)[0].id : ''
      }
      const saved = this.saveLayoutOnly(next)
      this.setData({ layoutPanelVisible: false, layoutPanelClosing: false, reductionConfirm: null })
      if (uniformArrange && saved) {
        this._layoutUndoSnapshot = previousLayout
        this._layoutUndoExpiresAt = Date.now() + 6000
        this.setData({ layoutUndoVisible: true })
        this.scheduleLayoutUndoExpiry()
      } else {
        this.clearLayoutUndo()
      }
      vibrate('medium')
    },

    undoLayoutArrangement() {
      if (!this._layoutUndoSnapshot || !this._alive || !this._visible) return
      this.invalidateExportPreview()
      const undoLayout = clone(this._layoutUndoSnapshot)
      const expectedLayoutFingerprint = this._persistedLayoutFingerprint
      let latest = readLightingWorkspace(this._contextId)
      if (!latest.ok) {
        this.setData({ saveNotice: latest.error || '撤销失败，灯位图读取失败。' })
        return
      }
      if (layoutFingerprint(latest.scheme.layout) !== expectedLayoutFingerprint) {
        this.clearLayoutUndo()
        this.setData({ saveNotice: '灯位图已在其他页面更新，撤销已取消；当前布局保持不变。' })
        return
      }
      let saved = saveLightingScheme(
        latest.contextId,
        { ...latest.scheme, layout: undoLayout },
        latest.revision,
      )
      if (!saved.ok && saved.error === 'conflict'
        && saved.currentScheme
        && layoutFingerprint(saved.currentScheme.layout) === expectedLayoutFingerprint) {
        latest = { ...latest, scheme: saved.currentScheme, revision: saved.revision }
        saved = saveLightingScheme(
          latest.contextId,
          { ...latest.scheme, layout: undoLayout },
          latest.revision,
        )
      }
      if (!saved.ok) {
        if (saved.error === 'conflict') {
          this.clearLayoutUndo()
          this.setData({ saveNotice: '灯位图已在其他页面更新，撤销已取消；当前布局保持不变。' })
        } else {
          this.setData({ saveNotice: saved.error || '撤销失败，当前布局保持不变。' })
        }
        return
      }
      const calculated = calculateScheme(saved.scheme || { ...latest.scheme, layout: undoLayout })
      if (!calculated.ok || !calculated.valid) {
        this.setData({ saveNotice: calculated.error || '撤销后的灯光方案刷新失败。' })
        return
      }
      this._scheme = calculated.scheme
      this._fixtures = calculated.result.fixtures || []
      this._groups = calculated.result.groups || []
      this._revision = saved.revision
      this._layout = clone(this._scheme.layout || undoLayout)
      this._persistedLayoutFingerprint = layoutFingerprint(this._scheme.layout)
      this._loadedSchemeFingerprint = schemeFingerprint(saved.scheme || this._scheme)
      this.setLayoutDirty(false)
      this.clearLayoutUndo()
      this.setData({ saveNotice: '', saveRetryVisible: false })
      this.updateLayoutData()
      this.drawLayout()
      wx.showToast({ title: '已撤销灯具排列', icon: 'none' })
    },

    openPlacementPanel() {
      if (!this._layout) return
      const rods = rodRows(this._layout)
      if (!rods.some((rod) => String(rod.id) === String(this._activeRodId))) this._activeRodId = rods[0] ? rods[0].id : ''
      this.setData({ placementVisible: true, placementClosing: false, placementFilterText: '', placementNotice: '点选灯具即可上杆或下杆' }, () => this.measurePreviewViewport())
      this.updateLayoutData()
      this.drawLayout()
    },

    closePlacementPanel() {
      if (!this.data.placementVisible || this.data.placementClosing) return
      this._previewMeasureToken += 1
      const visibilityToken = this._visibilityToken
      this.setData({ placementClosing: true })
      setTimeout(() => {
        if (!this._alive || !this._visible || this._visibilityToken !== visibilityToken) return
        this.setData({ placementVisible: false, placementClosing: false })
        this.drawLayout()
      }, 180)
    },

    onSelectRod(event) {
      const rodId = event.currentTarget.dataset.rodId
      if (!rodRows(this._layout).some((rod) => String(rod.id) === String(rodId))) return
      this._activeRodId = rodId
      this.setData({ placementNotice: '点选灯具即可上杆或下杆', previewScrollIntoView: '' })
      this.updateLayoutData()
      this.drawLayout()
    },

    onPanelFixtureTap(event) {
      const fixtureId = String(event.currentTarget.dataset.fixtureId || '')
      const fixture = this._fixtures.find((item) => String(item.stableId) === fixtureId)
      if (!fixture || !this._activeRodId) {
        wx.showToast({ title: '请先添加或选择一根灯杆', icon: 'none' })
        return
      }
      this.setData({ selectedFixtureId: fixtureId, panelScrollIntoView: 'fixture-' + fixtureId })
      const existing = this._layout.positionsById && this._layout.positionsById[fixtureId]
      if (existing && String(existing.rodId) === String(this._activeRodId)) {
        const next = clone(this._layout)
        delete next.positionsById[fixtureId]
        this._layout = next
        this.saveLayoutOnly(next)
        this.setData({ placementNotice: fixture.addressText + ' 已从灯杆移至未上杆' })
        return
      }
      if (existing && String(existing.rodId) !== String(this._activeRodId)) {
        const from = rodName(this._layout, existing.rodId)
        const to = rodName(this._layout, this._activeRodId)
        const visibilityToken = this._visibilityToken
        wx.showModal({
          title: '确认移动灯具',
          content: fixture.addressText + ' 当前位于' + from + '，要移动到' + to + '吗？',
          confirmText: '移动',
          cancelText: '取消',
          success: (result) => {
            if (result.confirm && this._alive && this._visible && this._visibilityToken === visibilityToken) {
              this.assignFixtureToRod(fixture, this._activeRodId)
            }
          },
        })
        return
      }
      this.assignFixtureToRod(fixture, this._activeRodId)
    },

    assignFixtureToRod(fixture, rodId) {
      const rod = this.getGeometry() && this._geometry.rods.find((item) => String(item.id) === String(rodId))
      if (!rod) {
        wx.showToast({ title: '请先在布局设置中添加灯杆', icon: 'none' })
        return
      }
      const next = clone(this._layout)
      const position = { rodId: String(rodId), t: this.nextRodPosition(next, rod) }
      delete position.legacyPoint
      next.positionsById[String(fixture.stableId)] = position
      this._layout = next
      this.saveLayoutOnly(next)
      this.setData({
        placementNotice: fixture.addressText + ' 已上杆 · ' + rodName(next, rodId),
        previewScrollIntoView: 'preview-' + String(fixture.stableId),
        panelScrollIntoView: 'fixture-' + String(fixture.stableId),
        selectedFixtureId: String(fixture.stableId),
        highlightFixtureId: String(fixture.stableId),
      })
      if (this._highlightTimer) clearTimeout(this._highlightTimer)
      const visibilityToken = this._visibilityToken
      this._highlightTimer = setTimeout(() => {
        if (!this._alive || !this._visible || this._visibilityToken !== visibilityToken) return
        this.setData({ highlightFixtureId: '' })
        this.drawLayout()
      }, 1200)
      vibrate('light')
    },

    nextRodPosition(layout, geometryRod, exceptId) {
      const isSide = geometryRod.type === 'legacy-side'
      const start = isSide ? Number(geometryRod.startT) + .02 : .04
      const end = isSide ? Number(geometryRod.endT) - .02 : .96
      const values = Object.entries(layout.positionsById || {})
        .filter(([id, position]) => id !== exceptId && String(position.rodId) === String(geometryRod.id))
        .map(([, position]) => Number(position.t))
        .filter((value) => Number.isFinite(value) && value >= start && value <= end)
        .sort((a, b) => a - b)
      const bounds = [start, ...values, end]
      let bestStart = start
      let bestEnd = start
      let bestGap = -1
      for (let index = 1; index < bounds.length; index += 1) {
        const gap = bounds[index] - bounds[index - 1]
        if (gap > bestGap) {
          bestGap = gap
          bestStart = bounds[index - 1]
          bestEnd = bounds[index]
        }
      }
      return (bestStart + bestEnd) / 2
    },

    canvasPoint(event, touch) {
      const item = touch || (event.touches && event.touches[0]) || (event.changedTouches && event.changedTouches[0]) || {}
      const size = this.canvasDimensions()
      return pointFromTouch(item, this._canvasRect, size.width, size.height)
    },

    findFixtureAt(screenPoint) {
      const geometry = this.getGeometry()
      if (!geometry) return null
      const point = transformViewPointInverse(screenPoint, this._view)
      const fixtureById = new Map(this._fixtures.map((fixture) => [String(fixture.stableId), fixture]))
      let best = null
      let bestDistance = Infinity
      Object.entries(this._layout.positionsById || {}).forEach(([id, position]) => {
        const fixture = fixtureById.get(String(id))
        const rod = geometry.rods.find((item) => String(item.id) === String(position.rodId))
        if (!fixture || !rod) return
        const marker = layoutFixturePoint(geometry, rod, position)
        const distance = touchDistance(point, marker)
        if (distance < bestDistance) {
          best = fixture
          bestDistance = distance
        }
      })
      return bestDistance <= 42 / Math.max(.6, this._view.s) ? best : null
    },

    findRodAt(screenPoint) {
      const geometry = this.getGeometry()
      if (!geometry) return null
      const point = transformViewPointInverse(screenPoint, this._view)
      let best = null
      let bestDistance = Infinity
      geometry.rods.forEach((rod) => {
        const t = projectPointToRod(rod, point)
        const projected = pointOnRod(rod, t)
        const distance = touchDistance(point, projected)
        if (distance < bestDistance) {
          bestDistance = distance
          best = rod
        }
      })
      return bestDistance <= 28 / Math.max(.6, this._view.s) ? best : null
    },

    clearPendingGesture() {
      if (this._pressTimer) clearTimeout(this._pressTimer)
      this._pressTimer = null
      if (this._dragOriginalLayout) this._layout = clone(this._dragOriginalLayout)
      this._dragOriginalLayout = null
      this._gesture = null
      this._touchState = null
      this._dragPosition = null
      if (this.data) this.setData({ manipulationText: '', scrollEnabled: true })
    },

    onCanvasTouchStart(event) {
      if (!this._alive || !this._visible) return
      const touches = event.touches || []
      if (touches.length) this._viewAnimationToken += 1
      this.setData({ scrollEnabled: false })
      if (touches.length >= 2) {
        if (this._pressTimer) clearTimeout(this._pressTimer)
        this._pressTimer = null
        if (this._touchState && this._touchState.dragging) {
          if (this._dragOriginalLayout) this._layout = clone(this._dragOriginalLayout)
          this._dragOriginalLayout = null
          this._dragPosition = null
          this.setData({ manipulationText: '', selectedFixtureId: '' })
          this.drawLayout()
        }
        const first = this.canvasPoint(event, touches[0])
        const second = this.canvasPoint(event, touches[1])
        this._gesture = {
          type: 'pinch',
          distance: Math.max(1, touchDistance(first, second)),
          center: { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 },
          view: { ...this._view },
        }
        this._touchState = null
        return
      }
      const point = this.canvasPoint(event)
      const fixture = this.findFixtureAt(point)
      const rod = fixture ? null : this.findRodAt(point)
      this._touchState = {
        start: point,
        last: point,
        fixtureId: fixture ? String(fixture.stableId) : '',
        rodId: rod ? String(rod.id) : '',
        moved: false,
        dragging: false,
        dragT: null,
      }
      this._gesture = { type: 'single', start: point, view: { ...this._view } }
      if (fixture) {
        this._pressTimer = setTimeout(() => {
          if (!this._alive || !this._visible || !this._touchState || this._touchState.fixtureId !== String(fixture.stableId) || this._touchState.moved) return
          this._dragOriginalLayout = clone(this._layout)
          this._touchState.dragging = true
          this._activeRodId = String((this._layout.positionsById[fixture.stableId] || {}).rodId || this._activeRodId)
          this.setData({ manipulationText: '拖动灯具沿当前灯杆微调位置', selectedFixtureId: fixture.stableId })
          this.drawLayout()
        }, 380)
      }
    },

    onCanvasTouchMove(event) {
      if (!this._alive || !this._visible) return
      const touches = event.touches || []
      if (touches.length >= 2) {
        if (this._pressTimer) clearTimeout(this._pressTimer)
        this._pressTimer = null
        const first = this.canvasPoint(event, touches[0])
        const second = this.canvasPoint(event, touches[1])
        const center = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 }
        if (!this._gesture || this._gesture.type !== 'pinch') {
          this._gesture = {
            type: 'pinch',
            distance: Math.max(1, touchDistance(first, second)),
            center,
            view: { ...this._view },
          }
          return
        }
        const gesture = this._gesture
        const distance = Math.max(1, touchDistance(first, second))
        const scale = gesture.view.s * distance / gesture.distance
        const zoomed = zoomViewAt(gesture.view, scale, gesture.center, .65, 5)
        this._view = {
          ...zoomed,
          x: zoomed.x + center.x - gesture.center.x,
          y: zoomed.y + center.y - gesture.center.y,
        }
        this.drawLayout()
        return
      }
      if (!this._touchState) return
      const point = this.canvasPoint(event)
      const state = this._touchState
      state.last = point
      const delta = touchDistance(state.start, point)
      if (delta > 8) state.moved = true
      if (state.dragging && state.fixtureId) {
        const original = this._dragOriginalLayout && this._dragOriginalLayout.positionsById[state.fixtureId]
        const geometryRod = this.getGeometry().rods.find((rod) => String(rod.id) === String(original && original.rodId))
        if (!geometryRod) return
        const world = transformViewPointInverse(point, this._view)
        const t = projectPointToRod(geometryRod, world)
        this._layout.positionsById[state.fixtureId] = { rodId: original.rodId, t }
        this._dragPosition = true
        state.dragT = t
        this.drawLayout()
        return
      }
      if (this._pressTimer && delta > 12) {
        clearTimeout(this._pressTimer)
        this._pressTimer = null
      }
      if (this._gesture && this._gesture.type === 'single' && !state.fixtureId && delta > 5) {
        state.moved = true
        this._view = {
          ...this._gesture.view,
          x: this._gesture.view.x + point.x - state.start.x,
          y: this._gesture.view.y + point.y - state.start.y,
        }
        this.drawLayout()
      }
    },

    onCanvasTouchEnd(event) {
      if (!this._visible) {
        this.clearPendingGesture()
        return
      }
      if ((event.touches || []).length > 0) return
      if (this._pressTimer) clearTimeout(this._pressTimer)
      this._pressTimer = null
      const state = this._touchState
      const wasPinch = this._gesture && this._gesture.type === 'pinch'
      this._gesture = null
      this._touchState = null
      this.setData({ scrollEnabled: true, manipulationText: '' })
      if (wasPinch || !state) {
        this.drawLayout()
        return
      }
      if (state.dragging && state.fixtureId) {
        if (this._dragPosition) {
          this._dragPosition = null
          this._dragOriginalLayout = null
          this.saveLayoutOnly(this._layout)
          vibrate('light')
        } else {
          this._layout = clone(this._dragOriginalLayout || this._layout)
          this._dragOriginalLayout = null
          this._dragPosition = null
          this.drawLayout()
        }
        return
      }
      if (state.moved) {
        this.drawLayout()
        return
      }
      const point = state.last || state.start
      const fixture = state.fixtureId ? this._fixtures.find((item) => String(item.stableId) === state.fixtureId) : this.findFixtureAt(point)
      if (fixture) {
        const current = this._layout.positionsById[fixture.stableId]
        if (current && current.rodId) this._activeRodId = current.rodId
        this.setData({ selectedFixtureId: fixture.stableId, placementVisible: true, placementClosing: false })
        this.updateLayoutData({
          placementNotice: current
            ? fixture.addressText + ' · ' + rodName(this._layout, current.rodId)
            : fixture.addressText + ' 尚未上杆',
          previewScrollIntoView: current && String(current.rodId) === String(this._activeRodId)
            ? 'preview-' + String(fixture.stableId)
            : '',
        })
        this.drawLayout()
        return
      }
      const rod = state.rodId
        ? this.getGeometry().rods.find((item) => String(item.id) === state.rodId)
        : this.findRodAt(point)
      if (rod) {
        this._activeRodId = rod.id
        this.setData({ placementVisible: true, placementClosing: false, placementNotice: rod.label + ' · 点选灯具即可上杆或下杆' })
        this.updateLayoutData()
      }
      this.drawLayout()
    },

    onCanvasTouchCancel(event) {
      this.clearPendingGesture()
      if (this._visible) this.drawLayout()
    },

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
        this._viewAnimationToken += 1
        if (this._highlightTimer) clearTimeout(this._highlightTimer)
        this._highlightTimer = null
        this.clearPendingGesture()
        this._view = { s: 1, x: 0, y: 0 }
        this._activeRodId = ''
        this.setData({ selectedFixtureId: '', highlightFixtureId: '', manipulationText: '', scrollEnabled: true })
      }
      this.invalidateExportPreview()
      this._requestedContextId = nextId
      this._requestedContextLabel = row && row.name || ''
      this.setLayoutDirty(false)
      this.loadWorkspace()
    },

    openLocatePanel() {
      this.setData({
        locateVisible: true,
        locateClosing: false,
        searchText: '',
        searchResults: [],
        searchErrorText: '',
      })
    },

    closeLocatePanel() {
      if (!this.data.locateVisible || this.data.locateClosing) return
      const visibilityToken = this._visibilityToken
      this.setData({ locateClosing: true })
      setTimeout(() => {
        if (!this._alive || !this._visible || this._visibilityToken !== visibilityToken) return
        this.setData({ locateVisible: false, locateClosing: false })
      }, 180)
    },

    onPlacementFilterInput(event) {
      this.setData({ placementFilterText: event.detail.value || '' })
      this.updateLayoutData()
    },

    onSearchInput(event) {
      this.setData({ searchText: event.detail.value || '', searchErrorText: '', searchResults: [] })
    },

    searchFixture() {
      const keyword = String(this.data.searchText || '').trim().toLocaleLowerCase()
      if (!keyword) {
        this.setData({ searchErrorText: '请输入地址、灯具组或型号' })
        return
      }
      const matches = this._fixtures.filter((fixture) => [fixture.addressText, fixture.groupName, fixture.fixtureModel, fixture.name]
        .some((value) => String(value || '').toLocaleLowerCase().includes(keyword)))
        .sort(fixtureSort)
        .map((fixture) => {
          const id = String(fixture.stableId)
          const position = this._layout.positionsById[id]
          return {
            id,
            addressText: fixture.addressText,
            groupName: fixture.groupName || '',
            fixtureModel: fixture.fixtureModel || '',
            channelCount: fixture.channelCount || 0,
            fixtureType: classifyFixtureVisualType(fixture),
            rodName: position && position.rodId ? rodName(this._layout, position.rodId) : '',
          }
        })
      this.setData({ searchResults: matches, searchErrorText: matches.length ? '' : '没有找到匹配灯具' })
    },

    animateViewTo(target) {
      const size = this.canvasDimensions()
      const start = { ...this._view }
      const scale = Math.min(5, Math.max(start.s, 1.65))
      const end = { s: scale, x: size.width / 2 - target.x * scale, y: size.height / 2 - target.y * scale }
      const token = ++this._viewAnimationToken
      const visibilityToken = this._visibilityToken
      const startedAt = Date.now()
      const duration = 240
      const step = () => {
        if (!this._alive || !this._visible || this._visibilityToken !== visibilityToken || token !== this._viewAnimationToken) return
        const progress = Math.min(1, (Date.now() - startedAt) / duration)
        const eased = 1 - Math.pow(1 - progress, 3)
        this._view = {
          s: start.s + (end.s - start.s) * eased,
          x: start.x + (end.x - start.x) * eased,
          y: start.y + (end.y - start.y) * eased,
        }
        this.drawLayout()
        if (progress < 1) setTimeout(step, 16)
      }
      step()
    },

    onLocateResultTap(event) {
      const id = String(event.currentTarget.dataset.fixtureId || '')
      const fixture = this._fixtures.find((item) => String(item.stableId) === id)
      if (!fixture) return
      const position = this._layout.positionsById[id]
      this.setData({
        locateClosing: true,
        selectedFixtureId: id,
        highlightFixtureId: position ? id : '',
      })
      const visibilityToken = this._visibilityToken
      setTimeout(() => {
        if (this._alive && this._visible && this._visibilityToken === visibilityToken) this.setData({ locateVisible: false, locateClosing: false })
      }, 180)
      if (position && position.rodId) {
        this._activeRodId = String(position.rodId)
        const geometry = this.getGeometry()
        const rod = geometry.rods.find((item) => String(item.id) === String(position.rodId))
        if (rod) this.animateViewTo(layoutFixturePoint(geometry, rod, position))
      } else {
        wx.showToast({ title: fixture.addressText + ' 尚未上杆，当前没有画布位置', icon: 'none' })
        this.drawLayout()
      }
      if (this._highlightTimer) clearTimeout(this._highlightTimer)
      const highlightVisibilityToken = this._visibilityToken
      this._highlightTimer = setTimeout(() => {
        if (!this._alive || !this._visible || this._visibilityToken !== highlightVisibilityToken) return
        this.setData({ highlightFixtureId: '' })
        this.drawLayout()
      }, 1800)
      vibrate('light')
    },

    openLandscapeLayout() {
      if (this._layoutDirty && !this.saveLayoutOnly(this._layout)) return
      if (isLandscape) {
        if (typeof wx.navigateBack === 'function') wx.navigateBack({ delta: 1 })
        return
      }
      if (typeof wx.navigateTo !== 'function') return
      const query = 'lightingContextId=' + encodeURIComponent(this._contextId || TEMPORARY_CONTEXT_ID)
        + '&lightingContextName=' + encodeURIComponent(this.data.contextLabel || '')
      wx.navigateTo({ url: '/pages/dmx-layout-landscape/dmx-layout-landscape?' + query })
    },

    buildExportSnapshot() {
      const latest = this._contextId ? readLightingWorkspace(this._contextId) : null
      if (!latest || !latest.ok) {
        this.invalidateExportPreview()
        this.setData({ saveNotice: latest && latest.error || '读取最新灯光方案失败，暂不能导出。' })
        return null
      }
      if (this._loadedSchemeFingerprint && schemeFingerprint(latest.scheme) !== this._loadedSchemeFingerprint) {
        this.invalidateExportPreview()
      }
      if (this._layoutDirty && layoutFingerprint(latest.scheme.layout) !== this._persistedLayoutFingerprint) {
        this.invalidateExportPreview()
        this.setData({ saveNotice: '灯位图已在其他页面更新；当前编辑仍保留，暂不能导出。' })
        return null
      }
      const calculated = calculateScheme(latest.scheme)
      if (!calculated.ok || !calculated.valid) {
        this.setData({ saveNotice: calculated.error || '读取最新灯光方案失败，暂不能导出。' })
        return null
      }
      this._scheme = calculated.scheme
      this._fixtures = calculated.result.fixtures || []
      this._groups = calculated.result.groups || []
      this._revision = latest.revision
      this._loadedSchemeFingerprint = schemeFingerprint(latest.scheme)
      const savedLayout = calculated.scheme.layout
      if (savedLayout) this._layout = clone(savedLayout)
      else if (!this._layout) this._layout = migrateLegacyLayout(calculated.scheme.legacySideLayout, this._fixtures, this._groups).layout
        || createDefaultStageLayout('12', '8', () => makeId('rod'))
      this._persistedLayoutFingerprint = layoutFingerprint(savedLayout)
      const geometry = createStageGeometry(this._layout, EXPORT_WIDTH - 104, 730)
      const groups = this._groups || []
      const groupById = new Map(groups.map((group) => [String(group.stableId || group.id), group]))
      const fixtures = this._fixtures.map((fixture) => {
        const group = groupById.get(String(fixture.groupId || ''))
        return {
          ...fixture,
          id: fixture.stableId,
          groupName: fixture.groupName || group && group.name || '',
          fixtureModel: fixture.fixtureModel || group && group.fixtureModel || '',
          modeName: (fixture.channelCount || group && group.channelCount || 0) + ' CH',
        }
      })
      const placed = fixtures.filter((fixture) => {
        const position = this._layout.positionsById[String(fixture.stableId)]
        return position && rodRows(this._layout).some((rod) => rod.id === position.rodId)
      }).length
      return {
        layout: this._layout,
        fixtures,
        geometry,
        contextLabel: this.data.contextLabel,
        siteLabel: this.data.contextLabel + ' · ' + this._layout.stageWidthText + ' × ' + this._layout.stageDepthText + ' m',
        groupCount: groups.length,
        universeCount: new Set(fixtures.map((fixture) => fixture.universeLabel || fixture.universe)).size,
        unplacedCount: fixtures.length - placed,
        theme: CANVAS_THEMES.light,
      }
    },

    generateLayoutImage() {
      if (!this._alive || !this._visible || this.data.isGeneratingImage || !this._layout || typeof wx.canvasToTempFilePath !== 'function') return
      if (this._layoutDirty && !this.saveLayoutOnly(this._layout)) return
      const snapshot = this.buildExportSnapshot()
      if (!snapshot || !this._alive || !this._visible) return
      this._generationToken += 1
      const token = this._generationToken
      const visibilityToken = this._visibilityToken
      const active = () => this._alive && this._visible
        && this._visibilityToken === visibilityToken
        && this._generationToken === token
      this._exportSnapshot = snapshot
      this._exportPages = buildLightingExportPages(this._exportSnapshot, { width: EXPORT_WIDTH, height: EXPORT_HEIGHT })
      this._exportPaths = []
      this._exportCanvasNode = null
      this._exportCanvasContext = null
      this._exportCanvasAdapter = null
      vibrate('medium')
      if (typeof wx.showLoading === 'function') wx.showLoading({ title: '正在生成', mask: true })
      const fail = (message) => {
        if (!active()) return
        if (typeof wx.hideLoading === 'function') wx.hideLoading()
        this._exportCanvasNode = null
        this._exportCanvasContext = null
        this._exportCanvasAdapter = null
        this._exportSnapshot = null
        this._exportPages = []
        this._exportPaths = []
        this.setData({
          isGeneratingImage: false,
          exportCanvasActive: false,
          layoutImagePath: '',
          layoutImagePaths: [],
          exportPageIndex: 0,
          exportPageCount: 0,
        })
        if (typeof wx.showToast === 'function') wx.showToast({ title: message || '生成失败，请重试', icon: 'none' })
      }
      const renderNext = (index) => {
        if (!active()) return
        if (index >= this._exportPages.length) {
          if (typeof wx.hideLoading === 'function') wx.hideLoading()
          this._exportCanvasNode = null
          this._exportCanvasContext = null
          this._exportCanvasAdapter = null
          this.setData({
            isGeneratingImage: false,
            exportCanvasActive: false,
            layoutImagePaths: this._exportPaths.slice(),
            layoutImagePath: this._exportPaths[0] || '',
            exportPageCount: this._exportPaths.length,
            exportPageIndex: 0,
            previewVisible: true,
          })
          return
        }
        const page = this._exportPages[index]
        const node = this._exportCanvasNode
        if (!node || !active()) return
        try {
          const configured = configureCanvas2DNode(node, page.width, page.height, 1)
          this._exportCanvasContext = configured.context
          this._exportCanvasAdapter = createCanvas2DAdapter(configured.context)
          renderLightingExportPage(this._exportCanvasAdapter, this._exportSnapshot, page)
          if (!active() || this._exportCanvasNode !== node) return
          wx.canvasToTempFilePath({
            canvas: node,
            x: 0,
            y: 0,
            width: page.width,
            height: page.height,
            destWidth: page.width,
            destHeight: page.height,
            fileType: 'png',
            quality: 1,
            success: ({ tempFilePath }) => {
              if (!active() || this._exportCanvasNode !== node) return
              if (!tempFilePath) {
                fail('导出图片为空，请重试')
                return
              }
              this._exportPaths.push(tempFilePath)
              renderNext(index + 1)
            },
            fail: () => fail('生成失败，请重试'),
          })
        } catch (error) {
          fail('生成失败，请重试')
        }
      }
      this.setData({ isGeneratingImage: true, exportCanvasActive: true, layoutImagePaths: [], layoutImagePath: '' }, () => {
        if (!active()) return
        if (typeof wx.createSelectorQuery !== 'function') {
          fail('导出画布暂不可用，请重试')
          return
        }
        const query = wx.createSelectorQuery().in(this)
        let canvasInfo = null
        query.select('#' + EXPORT_CANVAS_ID).fields({ node: true, size: true }, (fields) => { canvasInfo = fields })
        query.exec(() => {
          if (!active()) return
          const node = canvasInfo && canvasInfo.node
          if (!node || typeof node.getContext !== 'function') {
            fail('导出画布暂不可用，请重试')
            return
          }
          this._exportCanvasNode = node
          renderNext(0)
        })
      })
    },

    closePreview() {
      this.setData({ previewVisible: false, exportCanvasActive: false })
      this.measureCanvas(() => this.drawLayout())
    },

    cancelExportGeneration() {
      if (!this.data || !this.data.isGeneratingImage) return
      this._generationToken += 1
      this._exportCanvasNode = null
      this._exportCanvasContext = null
      this._exportCanvasAdapter = null
      this._exportSnapshot = null
      this._exportPages = []
      this._exportPaths = []
      if (this._alive) this.setData({
        isGeneratingImage: false,
        exportCanvasActive: false,
        layoutImagePath: '',
        layoutImagePaths: [],
        exportPageIndex: 0,
        exportPageCount: 0,
      })
      if (typeof wx.hideLoading === 'function') wx.hideLoading()
    },

    stopTap() {},
    preventTouchMove() {},

    previewImage() {
      const paths = this.data.layoutImagePaths || []
      const current = this.data.layoutImagePath
      if (paths.length > 1 && typeof wx.previewImage === 'function') wx.previewImage({ current, urls: paths })
      else previewGeneratedImage(current)
    },

    shareImage() {
      shareGeneratedImage(this.data.layoutImagePath)
    },

    saveImage() {
      saveGeneratedImage(this.data.layoutImagePath)
    },

    saveAllImages() {
      if (!this._alive || !this._visible) return
      const paths = this.data.layoutImagePaths || []
      if (!paths.length || typeof wx.saveImageToPhotosAlbum !== 'function') {
        wx.showToast({ title: '暂不支持保存图片', icon: 'none' })
        return
      }
      const saveToken = ++this._saveImagesToken
      const visibilityToken = this._visibilityToken
      const active = () => this._alive && this._visible
        && this._visibilityToken === visibilityToken
        && this._saveImagesToken === saveToken
      this._savingAllImages = true
      let index = 0
      const saveNext = () => {
        if (!active()) return
        if (index >= paths.length) {
          this._savingAllImages = false
          if (typeof wx.hideLoading === 'function') wx.hideLoading()
          wx.showToast({ title: '全部 ' + paths.length + ' 张已保存', icon: 'success' })
          return
        }
        wx.saveImageToPhotosAlbum({
          filePath: paths[index],
          success: () => { if (!active()) return; index += 1; saveNext() },
          fail: ({ errMsg = '' } = {}) => {
            if (!active()) return
            this._savingAllImages = false
            if (typeof wx.hideLoading === 'function') wx.hideLoading()
            if (/auth|authorize|permission|deny/i.test(errMsg) && typeof wx.openSetting === 'function') {
              wx.showModal({
                title: '需要相册权限',
                content: '请在设置中允许保存图片到相册，再重新保存。',
                confirmText: '去设置',
                success: ({ confirm }) => { if (confirm && active()) wx.openSetting() },
              })
            } else if (!/cancel/i.test(errMsg)) {
              wx.showToast({ title: '第 ' + (index + 1) + ' 张保存失败，可单独保存当前页', icon: 'none' })
            }
          },
        })
      }
      if (typeof wx.showLoading === 'function') wx.showLoading({ title: '正在保存', mask: true })
      saveNext()
    },

    cancelSaveAllImages() {
      this._saveImagesToken = Number(this._saveImagesToken || 0) + 1
      const wasSaving = Boolean(this._savingAllImages)
      this._savingAllImages = false
      if (wasSaving && typeof wx.hideLoading === 'function') wx.hideLoading()
    },

    previousExportPage() {
      const index = Math.max(0, Number(this.data.exportPageIndex) - 1)
      this.setData({ exportPageIndex: index, layoutImagePath: this.data.layoutImagePaths[index] || '' })
    },

    nextExportPage() {
      const index = Math.min(this.data.exportPageCount - 1, Number(this.data.exportPageIndex) + 1)
      this.setData({ exportPageIndex: index, layoutImagePath: this.data.layoutImagePaths[index] || '' })
    },

    noOp() {},
  }
  return page
}

module.exports = { createDmxLayoutPage, GROUP_COLORS, LAYOUT_GROUP_COLORS, CANVAS_THEMES }
