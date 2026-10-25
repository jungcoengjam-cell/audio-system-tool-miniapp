'use strict'

function createLayoutExportMethods(dependencies = {}) {
  const { CANVAS_THEMES, EXPORT_CANVAS_ID, EXPORT_HEIGHT, EXPORT_WIDTH, buildLightingExportPages, calculateScheme, clone, configureCanvas2DNode, createCanvas2DAdapter, createDefaultStageLayout, createStageGeometry, layoutFingerprint, makeId, migrateLegacyLayout, previewGeneratedImage, readLightingWorkspace, renderLightingExportPage, saveGeneratedImage, schemeFingerprint, shareGeneratedImage, vibrate, wx, Date, setTimeout, clearTimeout } = dependencies
  return {
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
      const geometry = createStageGeometry(this._layout, EXPORT_WIDTH - 72, EXPORT_HEIGHT - 170)
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
      return {
        layout: clone(this._layout),
        fixtures,
        geometry,
        contextLabel: this.data.contextLabel,
        theme: CANVAS_THEMES.light,
      }
    },
    generateLayoutImage() {
      if (!this._alive || !this._visible || this.data.isGeneratingImage || !this._layout || typeof wx.canvasToTempFilePath !== 'function') return
      this.cancelSheetClose('export')
      if (this.data.previewClosing) this.setData({ previewClosing: false })
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
      this.suspendStageCanvas()
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
        }, () => this.restoreStageCanvas())
        if (typeof wx.showToast === 'function') wx.showToast({ title: message || '生成失败，请重试', icon: 'none' })
      }
      const renderNext = (index) => {
        if (!active()) return
        if (index >= this._exportPages.length) {
          if (typeof wx.hideLoading === 'function') wx.hideLoading()
          this._exportCanvasNode = null
          this._exportCanvasContext = null
          this._exportCanvasAdapter = null
          this.cancelSheetClose('export')
          this.setData({
            isGeneratingImage: false,
            exportCanvasActive: false,
            previewClosing: false,
            layoutImagePaths: this._exportPaths.slice(),
            layoutImagePath: this._exportPaths[0] || '',
            exportPageCount: this._exportPaths.length,
            exportPageIndex: 0,
            previewVisible: true,
          }, () => { if (active()) vibrate('medium') })
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
      const exportPage = this._exportPages[0]
      this.setData({
        isGeneratingImage: true,
        exportCanvasActive: true,
        exportCanvasWidth: exportPage.width,
        exportCanvasHeight: exportPage.height,
        layoutImagePaths: [],
        layoutImagePath: '',
      }, () => {
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
      if (!this.data.previewVisible || this.data.previewClosing) return
      this.beginSheetClose('export', 'previewClosing', () => {
        this.setData({ previewVisible: false, previewClosing: false, exportCanvasActive: false }, () => this.restoreStageCanvas())
      })
    },
    cancelExportGeneration() {
      if (!this.data || !this.data.isGeneratingImage) return
      this.cancelSheetClose('export')
      this._generationToken += 1
      this._exportCanvasNode = null
      this._exportCanvasContext = null
      this._exportCanvasAdapter = null
      this._exportSnapshot = null
      this._exportPages = []
      this._exportPaths = []
      if (this._alive) this.setData({
        isGeneratingImage: false,
        previewClosing: false,
        exportCanvasActive: false,
        layoutImagePath: '',
        layoutImagePaths: [],
        exportPageIndex: 0,
        exportPageCount: 0,
      }, () => this.restoreStageCanvas())
      if (typeof wx.hideLoading === 'function') wx.hideLoading()
    },
    stopTap() {},
    preventTouchMove() {},
    previewImage() {
      if (!this.data.previewVisible || this.data.previewClosing) return
      const paths = this.data.layoutImagePaths || []
      const current = this.data.layoutImagePath
      if (paths.length > 1 && typeof wx.previewImage === 'function') wx.previewImage({ current, urls: paths })
      else previewGeneratedImage(current)
    },
    shareImage() {
      if (!this.data.previewVisible || this.data.previewClosing) return
      shareGeneratedImage(this.data.layoutImagePath)
    },
    saveImage() {
      if (!this.data.previewVisible || this.data.previewClosing) return
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
          if (active()) vibrate('medium')
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
    noOp() {}
  }
}

module.exports = { createLayoutExportMethods }

