'use strict'

function createLayoutSettingsMethods(dependencies = {}) {
  const { calculateScheme, clone, createStageGeometry, layoutFingerprint, layoutFixturePoint, makeId, pointOnRod, projectPointToRod, readLightingWorkspace, rodFrameChanged, rodName, rodRows, saveLightingScheme, schemeFingerprint, stageAxisLength, stageFrameChanged, touchDistance, vibrate, withDistanceTexts, wx, Date, setTimeout, clearTimeout } = dependencies
  return {
    canEditLayoutSettings() {
      return Boolean(this._alive && this._visible && this.data.layoutPanelVisible
        && !this.data.layoutPanelClosing && !this.data.reductionConfirm)
    },
    openLayoutSettings() {
      if (!this._alive || !this._visible || !this._layout) return
      this.cancelSheetClose('settings')
      this.cancelSheetClose('reduction')
      this.invalidatePendingSettingsConfirm()
      vibrate('light')
      this.suspendStageCanvas()
      const draft = withDistanceTexts(this._layout)
      this.setData({
        layoutPanelVisible: true,
        layoutPanelClosing: false,
        layoutDraft: draft,
        layoutValidationErrorsById: {},
        layoutErrorScrollIntoView: '',
        arrangementMode: 'preserve',
        reductionConfirm: null,
        reductionClosing: false,
      })
    },
    closeLayoutSettings() {
      if (!this._alive || !this._visible || !this.data.layoutPanelVisible || this.data.layoutPanelClosing) return
      this.invalidatePendingSettingsConfirm()
      if (this.data.reductionConfirm) this.setData({ reductionClosing: true })
      this.beginSheetClose('settings', 'layoutPanelClosing', () => {
        this.setData({ layoutPanelVisible: false, layoutPanelClosing: false, reductionConfirm: null, reductionClosing: false }, () => this.restoreStageCanvas())
      })
    },
    onDraftStageInput(event) {
      if (!this.canEditLayoutSettings()) return
      const key = event.currentTarget.dataset.key
      const value = event.detail.value
      if (!['stageWidthText', 'stageDepthText'].includes(key)) return
      this.setData({ ['layoutDraft.' + key]: value, layoutValidationErrorsById: {}, layoutErrorScrollIntoView: '' })
    },
    onDraftDirectionTap(event) {
      if (!this.canEditLayoutSettings()) return
      const direction = event.currentTarget.dataset.direction
      if (!['bottom', 'right', 'top', 'left'].includes(direction)) return
      this.setData({ 'layoutDraft.apronDirection': direction, layoutValidationErrorsById: {}, layoutErrorScrollIntoView: '' })
    },
    onDraftArrangementTap(event) {
      if (!this.canEditLayoutSettings()) return
      const mode = String(event.currentTarget.dataset.mode || '')
      if (!['preserve', 'uniform'].includes(mode)) return
      this.setData({ arrangementMode: mode })
    },
    onDraftDistanceInput(event) {
      if (!this.canEditLayoutSettings()) return
      const kind = event.currentTarget.dataset.kind
      const index = Number(event.currentTarget.dataset.index)
      const value = event.detail.value
      if (!['internalRods', 'frontRods'].includes(kind) || !Number.isInteger(index)) return
      const rodId = String((this.data.layoutDraft[kind][index] || {}).id || '')
      const errors = { ...(this.data.layoutValidationErrorsById || {}) }
      delete errors[rodId]
      this.setData({ ['layoutDraft.' + kind + '[' + index + '].distanceText']: value, layoutValidationErrorsById: errors, layoutErrorScrollIntoView: '' })
    },
    addDraftRod(event) {
      if (!this.canEditLayoutSettings()) return
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
      this.setData({ layoutDraft: draft, layoutValidationErrorsById: {}, layoutErrorScrollIntoView: '' })
    },
    changeDraftRodCount(event) {
      if (!this.canEditLayoutSettings()) return
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
      this.setData({ layoutDraft: draft, layoutValidationErrorsById: {}, layoutErrorScrollIntoView: '' })
    },
    removeDraftRod(event) {
      if (!this.canEditLayoutSettings()) return
      const kind = event.currentTarget.dataset.kind
      const index = Number(event.currentTarget.dataset.index)
      if (!['internalRods', 'frontRods'].includes(kind) || !Number.isInteger(index)) return
      const draft = clone(this.data.layoutDraft)
      draft[kind].splice(index, 1)
      this.setData({ layoutDraft: draft, layoutValidationErrorsById: {}, layoutErrorScrollIntoView: '' })
    },
    applyLayoutSettings() {
      if (!this.canEditLayoutSettings()) return
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
      const validationErrors = {}
      let firstInvalidRodId = ''
      const collectRodErrors = (kind, rods, parsed, maximum) => (rods || []).forEach((rod, index) => {
        if (parsed[index]) return
        const rodId = String(rod.id)
        if (!firstInvalidRodId) firstInvalidRodId = rodId
        validationErrors[rodId] = kind === 'internalRods'
          ? '距离须大于 0 且不超过舞台内尺寸 ' + maximum + ' m。'
          : '距离须大于 0 且不超过 200 m。'
      })
      collectRodErrors('internalRods', draft.internalRods, internalRods, axis)
      collectRodErrors('frontRods', draft.frontRods, frontRods, 200)
      if (firstInvalidRodId) {
        this.setData({
          layoutValidationErrorsById: validationErrors,
          layoutErrorScrollIntoView: 'rod-error-' + firstInvalidRodId,
        })
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
      const arrangementMode = String(this.data.arrangementMode || 'preserve')
      if (!['preserve', 'uniform'].includes(arrangementMode)) return
      const guard = {
        token: (Number(this._settingsIntentToken) || 0) + 1,
        contextId: this._contextId,
        visibilityToken: this._visibilityToken,
        layoutFingerprint: layoutFingerprint(this._layout),
        draftFingerprint: JSON.stringify(this.data.layoutDraft),
        arrangementMode,
      }
      this._settingsIntentToken = guard.token
      if (affected.length) {
        this._pendingSettingsLayout = next
        this._pendingRemovedRodIds = removedIds
        this._pendingUniformArrange = arrangementMode === 'uniform'
        this._pendingSettingsGuard = guard
        const note = '以下灯具会移至未上杆；灯具地址和核对状态保留。' + (arrangementMode === 'uniform' ? ' 其他已上杆灯具也会重新均匀排列。' : '')
        this.setData({
          reductionClosing: false,
          reductionConfirm: {
            rods: removed.map((rod) => rodName(this._layout, rod.id)),
            fixtures: affected.map((fixture) => ({ id: fixture.stableId, addressText: fixture.addressText, groupName: fixture.groupName })),
            uniformArrange: arrangementMode === 'uniform',
            note,
            confirmText: arrangementMode === 'uniform' ? '确认并重新排列' : '确认并移至未上杆',
          },
        })
        return
      }
      const uniformArrange = arrangementMode === 'uniform'
      const placedCount = Object.values(next.positionsById).filter((position) => !removedIds.has(String(position.rodId))).length
      if (uniformArrange && placedCount) {
        wx.showModal({
          title: '重新均匀排列',
          content: '将重新排列 ' + placedCount + ' 台已上杆灯具的位置。',
          confirmText: '重新排列',
          cancelText: '保留现状',
          success: (result) => {
            if (!result.confirm || !this.isSettingsIntentValid(guard)) return
            this.applySettingsLayout(next, removedIds, uniformArrange)
          },
        })
        return
      }
      this.applySettingsLayout(next, removedIds, uniformArrange)
    },
    isSettingsIntentValid(guard, allowReduction = false) {
      if (!guard || !this._alive || !this._visible || !this.data.layoutPanelVisible || this.data.layoutPanelClosing
        || (!allowReduction && this.data.reductionConfirm) || this._settingsIntentToken !== guard.token
        || this._visibilityToken !== guard.visibilityToken || this._contextId !== guard.contextId
        || layoutFingerprint(this._layout) !== guard.layoutFingerprint
        || String(this.data.arrangementMode || 'preserve') !== guard.arrangementMode
        || JSON.stringify(this.data.layoutDraft) !== guard.draftFingerprint) return false
      return true
    },
    confirmLayoutReduction() {
      if (!this._pendingSettingsLayout || !this.data.reductionConfirm || this.data.reductionClosing) return
      const guard = this._pendingSettingsGuard
      if (!this.isSettingsIntentValid(guard, true)) {
        this.invalidatePendingSettingsConfirm()
        this.beginSheetClose('reduction', 'reductionClosing', () => {
          this.setData({ reductionConfirm: null, reductionClosing: false })
        })
        wx.showToast({ title: '布局草稿已变化，请重新应用', icon: 'none' })
        return
      }
      const next = this._pendingSettingsLayout
      const removedIds = this._pendingRemovedRodIds || new Set()
      const uniformArrange = Boolean(this._pendingUniformArrange)
      this.invalidatePendingSettingsConfirm()
      this.applySettingsLayout(next, removedIds, uniformArrange)
    },
    cancelLayoutReduction() {
      if (!this._alive || !this._visible || !this.data.reductionConfirm || this.data.reductionClosing) return
      this.invalidatePendingSettingsConfirm()
      this.beginSheetClose('reduction', 'reductionClosing', () => {
        this.setData({ reductionConfirm: null, reductionClosing: false })
      })
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
      this.cancelSheetClose('settings')
      this.cancelSheetClose('reduction')
      const closeSettings = () => this.beginSheetClose('settings', 'layoutPanelClosing', () => {
        this.setData({
          layoutPanelVisible: false,
          layoutPanelClosing: false,
          reductionConfirm: null,
          reductionClosing: false,
        }, () => this.restoreStageCanvas())
      })
      if (this.data.reductionConfirm && !this.data.reductionClosing) {
        this.setData({ reductionClosing: true }, closeSettings)
      } else {
        closeSettings()
      }
      if (uniformArrange && saved) {
        this._layoutUndoSnapshot = previousLayout
        this._layoutUndoExpiresAt = Date.now() + 6000
        this.setData({
          layoutUndoVisible: true,
          layoutUndoLabel: '灯具已均匀排列',
        })
        this.scheduleLayoutUndoExpiry()
      } else {
        this.clearLayoutUndo()
      }
      if (saved && this._alive && this._visible) vibrate('medium')
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
    }
  }
}

module.exports = { createLayoutSettingsMethods }

