'use strict'

const ADDRESS_DOMAIN_ORDER = { A: 0, B: 1, C: 2, D: 3 }
const PLACEMENT_TAP_DELAY = 320

function isGroundPosition(position) {
  return Boolean(position && (position.kind === 'ground' || position.ground === true))
}

function showPlacementModal(wx, content) {
  const fallback = () => wx.showToast({ title: '操作未完成', icon: 'none' })
  try {
    wx.showModal({ title: '灯具位置提示', content, showCancel: false, confirmText: '知道了', fail: fallback })
  } catch (_) {
    fallback()
  }
}

function showCrossTargetFeedback(wx, fixture, from) {
  const title = '到' + from + '撤出'
  if (Array.from(title).length <= 7) {
    wx.showToast({ title, icon: 'none', duration: 2500 })
    return
  }
  showPlacementModal(wx, fixture.addressText + ' 已在' + from + '，位置保持不变。请到' + from + '单击撤出。')
}

function fixtureAddressParts(fixture) {
  const match = /^\s*([A-D])\s*0*(\d+)\s*$/i.exec(String(fixture && fixture.addressText || ''))
  return match ? [ADDRESS_DOMAIN_ORDER[match[1].toUpperCase()], Number(match[2])] : null
}

function compareFixtureAddresses(a, b, fixtureSort) {
  const aParts = fixtureAddressParts(a)
  const bParts = fixtureAddressParts(b)
  if (aParts && bParts) return aParts[0] - bParts[0] || aParts[1] - bParts[1] || fixtureSort(a, b)
  if (aParts) return -1
  if (bParts) return 1
  return fixtureSort(a, b)
}

function nextGroundPosition(layout, stage, exceptId = '') {
  if (!stage || !(Number(stage.width) > 0) || !(Number(stage.height) > 0)) return { kind: 'ground', x: .5, y: .5 }
  const width = Number(stage.width)
  const height = Number(stage.height)
  const padX = Math.min(.12, 24 / width)
  const padY = Math.min(.12, 24 / height)
  const columns = Math.max(1, Math.floor(Math.max(1, width - 48) / 40))
  const rows = Math.max(1, Math.floor(Math.max(1, height - 48) / 40))
  const candidates = []
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x = padX + ((column + .5) / columns) * (1 - 2 * padX)
      const y = padY + ((row + .5) / rows) * (1 - 2 * padY)
      candidates.push({ x, y, centerDistance: (x - .5) ** 2 + (y - .5) ** 2 })
    }
  }
  candidates.sort((a, b) => a.centerDistance - b.centerDistance || a.y - b.y || a.x - b.x)
  const occupied = Object.entries(layout && layout.positionsById || {})
    .filter(([id, position]) => id !== String(exceptId) && isGroundPosition(position))
    .map(([, position]) => ({ x: Number(position.x) * width, y: Number(position.y) * height }))
  let best = candidates[0] || { x: .5, y: .5 }
  let bestDistance = -1
  for (const candidate of candidates) {
    const point = { x: candidate.x * width, y: candidate.y * height }
    const minDistance = occupied.reduce((minimum, other) => Math.min(minimum, Math.hypot(point.x - other.x, point.y - other.y)), Infinity)
    if (minDistance > bestDistance) {
      bestDistance = minDistance
      best = candidate
    }
    if (minDistance >= 34) {
      best = candidate
      break
    }
  }
  if (bestDistance < .5) {
    const keys = new Set(occupied.map((point) => Math.round(point.x * 1000) + ':' + Math.round(point.y * 1000)))
    for (let index = 1; index <= occupied.length + 2048; index += 1) {
      const x = padX + ((index * .61803398875) % 1) * (1 - 2 * padX)
      const y = padY + ((index * .75487766625) % 1) * (1 - 2 * padY)
      const key = Math.round(x * width * 1000) + ':' + Math.round(y * height * 1000)
      if (!keys.has(key)) return { kind: 'ground', x, y }
    }
  }
  return { kind: 'ground', x: Math.max(0, Math.min(1, best.x)), y: Math.max(0, Math.min(1, best.y)) }
}

function createLayoutPlacementMethods(dependencies = {}) {
  const { LOCATE_RESULT_ROW_HEIGHT, calculateScheme, classifyFixtureVisualType, clone, fixtureFingerprint, fixtureSort,
    layoutFingerprint, layoutFixturePoint, pointFromTouch, pointOnRod, projectPointToRod, readLightingWorkspace,
    rodName, rodRows, saveLightingScheme, schemeFingerprint, touchDistance, transformViewPointInverse,
    vibrate, zoomViewAt, wx, Date, setTimeout, clearTimeout } = dependencies
  return {
    openPlacementPanel(targetRodId) {
      if (!this._layout) return
      this.cancelSheetClose('placement')
      this.cancelPendingFixtureTap()
      const rods = rodRows(this._layout)
      if (String(targetRodId || '') === 'ground') this._activeRodId = ''
      else if (targetRodId && rods.some((rod) => String(rod.id) === String(targetRodId))) this._activeRodId = String(targetRodId)
      else if (!rods.some((rod) => String(rod.id) === String(this._activeRodId))) this._activeRodId = rods[0] ? rods[0].id : ''
      this._placementOrderSnapshot = null
      this.suspendStageCanvas()
      this._placementTargetNeedsReselect = false
      this.consumePlacementCancelledNotice()
      this.setData({ placementVisible: true, placementClosing: false, placementFilterText: '', placementSearchExpanded: false, placementPreviewFocus: false, placementScrollIntoView: '' }, () => this.measurePreviewViewport())
      this.updateLayoutData()
      this.drawLayout()
    },
    closePlacementPanel() {
      if (!this.data.placementVisible || this.data.placementClosing) return
      this.settlePendingFixtureTap()
      if (this._placementTransferPending) return
      this.invalidatePendingClear()
      this._previewMeasureToken += 1
      this.beginSheetClose('placement', 'placementClosing', () => {
        this._placementOrderSnapshot = null
        this.setData({ placementVisible: false, placementClosing: false, selectedFixtureId: '', placementPreviewFocus: false, placementScrollIntoView: '' }, () => this.restoreStageCanvas())
      })
    },
    clearSelectedRodLayout() {
      if (!this._activeRodId) return
      this.clearLayoutPositions(this._activeRodId)
    },
    clearLayoutImage() {
      this.clearLayoutPositions('')
    },
    clearLayoutPositions(scopeRodId) {
      if (!this._alive || !this._visible || !this.data.placementVisible || this.data.placementClosing
        || this._clearLayoutPending || !this._layout) return
      this.settlePendingFixtureTap()
      if (this._placementTransferPending) return
      const validRodIds = new Set(rodRows(this._layout).map((rod) => String(rod.id)))
      const targetRodId = scopeRodId === null || scopeRodId === undefined || scopeRodId === '' ? '' : String(scopeRodId)
      if (targetRodId && !validRodIds.has(targetRodId)) return
      const placedCount = this._fixtures.filter((fixture) => {
        const position = this._layout.positionsById && this._layout.positionsById[String(fixture.stableId)]
        if (!position) return false
        if (targetRodId) return validRodIds.has(String(position.rodId)) && String(position.rodId) === targetRodId
        return isGroundPosition(position) || validRodIds.has(String(position.rodId))
      }).length
      if (!placedCount) return
      const requestToken = ++this._clearLayoutToken
      const visibilityToken = this._visibilityToken
      const contextId = this._contextId
      const fingerprint = layoutFingerprint(this._layout)
      const selectedRodId = String(this._activeRodId || '')
      const releasePending = () => {
        if (requestToken !== this._clearLayoutToken) return false
        this._clearLayoutToken += 1
        this._clearLayoutPending = false
        if (this._alive && this.data) this.setData({ clearLayoutPending: false })
        return true
      }
      const showModalFailure = () => {
        if (!releasePending()) return
        if (!this._alive || !this.data) return
        wx.showToast({ title: '确认失败', icon: 'none' })
      }
      this._clearLayoutPending = true
      this.setData({ clearLayoutPending: true })
      try {
        wx.showModal({
          title: targetRodId ? '清空当前灯杆灯位' : '清空整个灯位图',
          content: targetRodId
            ? '将 ' + rodName(this._layout, targetRodId) + ' 上的 ' + placedCount + ' 台灯具移回未上杆。其他灯杆、灯组、地址和核对状态保留。'
            : '将 ' + placedCount + ' 台灯具全部移回未放置。灯组、地址、核对状态和灯杆保留。',
          confirmText: '确认清空',
          cancelText: '取消',
          success: (result) => {
            if (!releasePending()) return
            if (!result.confirm) return
            if (!this._alive || !this._visible || !this.data.placementVisible || this.data.placementClosing
              || this._visibilityToken !== visibilityToken || this._contextId !== contextId
              || String(this._activeRodId || '') !== selectedRodId
              || !this._layout || layoutFingerprint(this._layout) !== fingerprint) return
            const next = clone(this._layout)
            if (targetRodId) {
              Object.keys(next.positionsById || {}).forEach((fixtureId) => {
                if (String(next.positionsById[fixtureId]?.rodId) === targetRodId) delete next.positionsById[fixtureId]
              })
            } else {
              next.positionsById = {}
            }
            this._layout = next
            const saved = this.saveLayoutOnly(next)
            this.setData({
              selectedFixtureId: '',
              highlightFixtureId: '',
              panelScrollIntoView: '',
            })
            this.updateLayoutData()
            this.drawLayout()
            if (!saved) wx.showToast({ title: '清空未保存', icon: 'none' })
          },
          fail: showModalFailure,
        })
      } catch (_) {
        showModalFailure()
      }
    },
    onSelectRod(event) {
      if (!this._alive || !this._visible || !this.data.placementVisible || this.data.placementClosing) return
      this.settlePendingFixtureTap()
      if (this._placementTransferPending) return
      const rodId = String(event.currentTarget.dataset.rodId || '')
      if (rodId !== 'ground' && !rodRows(this._layout).some((rod) => String(rod.id) === rodId)) return
      this._placementTargetNeedsReselect = false
      this._activeRodId = rodId === 'ground' ? '' : rodId
      this._previewScrollLeft = 0
      this.updateLayoutData()
      this.drawLayout()
    },
    togglePlacementSearch() {
      if (!this._alive || !this._visible || !this.data.placementVisible || this.data.placementClosing || this._placementTransferPending) return
      this.settlePendingFixtureTap()
      if (this._placementTransferPending) return
      this.setData({ placementSearchExpanded: !this.data.placementSearchExpanded })
    },
    togglePlacementPreview() {
      if (!this._alive || !this._visible || !this.data.placementVisible || this.data.placementClosing || this._placementTransferPending) return
      this.settlePendingFixtureTap()
      if (this._placementTransferPending) return
      const showingPreview = !!this.data.placementPreviewFocus
      let targetId = 'placement-preview-anchor'
      if (showingPreview) {
        const selectedId = String(this.data.selectedFixtureId || '')
        const selectedVisible = selectedId && (this.data.placementGroups || []).some((group) =>
          (group.fixtures || []).some((fixture) => String(fixture.id) === selectedId))
        targetId = selectedVisible ? 'fixture-' + selectedId : 'placement-list-anchor'
      }
      this.setData({ placementScrollIntoView: '' }, () => {
        if (!this._alive || !this._visible || !this.data.placementVisible || this.data.placementClosing) return
        this.setData({ placementPreviewFocus: !showingPreview, placementScrollIntoView: targetId })
      })
    },
    openPlacementActions() {
      if (!this._alive || !this._visible || !this.data.placementVisible || this.data.placementClosing || this._placementTransferPending) return
      this.settlePendingFixtureTap()
      if (this._placementTransferPending) return
      const targetRodId = String(this._activeRodId || '')
      const contextId = this._contextId
      const visibilityToken = this._visibilityToken
      const actions = []
      if (targetRodId && Number(this.data.selectedRodCount) > 1) actions.push({ title: '按地址排序', kind: 'sort' })
      if (targetRodId && Number(this.data.selectedRodCount) > 0) actions.push({ title: '清空当前灯杆', kind: 'clearRod' })
      if (Number(this.data.placedFixtureCount) > 0) actions.push({ title: '清空全图', kind: 'clearAll' })
      if (!actions.length) {
        wx.showToast({ title: targetRodId ? '当前灯杆没有可整理的灯位' : '当前没有已放置灯具', icon: 'none' })
        return
      }
      try {
        wx.showActionSheet({
          itemList: actions.map((action) => action.title),
          success: (result) => {
            if (!this._alive || !this._visible || !this.data.placementVisible || this.data.placementClosing
              || this._visibilityToken !== visibilityToken || this._contextId !== contextId
              || String(this._activeRodId || '') !== targetRodId) {
              if (this._alive && this.data && this.data.placementVisible) showPlacementModal(wx, '操作目标已变化，请重新选择后再试。')
              return
            }
            const action = actions[Number(result && result.tapIndex)]
            if (!action) return
            if (action.kind === 'sort') this.sortSelectedRodByAddress()
            else if (action.kind === 'clearRod') this.clearLayoutPositions(targetRodId)
            else if (action.kind === 'clearAll') this.clearLayoutPositions('')
          },
          fail: () => {},
        })
      } catch (_) {
        wx.showToast({ title: '操作菜单打开失败，请重试', icon: 'none' })
      }
    },
    sortSelectedRodByAddress() {
      if (!this._alive || !this._visible || !this.data.placementVisible || this.data.placementClosing || !this._layout) return
      this.settlePendingFixtureTap()
      if (this._placementTransferPending) return
      const rodId = String(this._activeRodId || '')
      const geometry = this.getGeometry()
      const rod = geometry && geometry.rods.find((item) => String(item.id) === rodId)
      if (!rod) return
      const fixtureById = new Map(this._fixtures.map((fixture) => [String(fixture.stableId), fixture]))
      const entries = Object.entries(this._layout.positionsById || {})
        .filter(([, position]) => String(position && position.rodId || '') === rodId)
        .map(([id, position]) => ({ id, position, fixture: fixtureById.get(String(id)) }))
        .filter((entry) => entry.fixture)
        .sort((a, b) => compareFixtureAddresses(a.fixture, b.fixture, fixtureSort))
      if (entries.length < 2) {
        wx.showToast({ title: '当前灯杆至少需要两台灯具', icon: 'none' })
        return
      }
      const visibilityToken = this._visibilityToken
      const contextId = this._contextId
      const fingerprint = layoutFingerprint(this._layout)
      const axis = Math.abs(rod.x2 - rod.x1) >= Math.abs(rod.y2 - rod.y1) ? 'x' : 'y'
      const startT = rod.type === 'legacy-side' ? Number(rod.startT) + .02 : .04
      const endT = rod.type === 'legacy-side' ? Number(rod.endT) - .02 : .96
      const start = pointOnRod(rod, startT)[axis]
      const end = pointOnRod(rod, endT)[axis]
      const reverse = start > end
      wx.showModal({
        title: '按地址排序当前灯杆',
        content: '仅重新排列 ' + entries.length + ' 台当前灯杆灯具，按 A、B、C、D 域及地址升序等距排列；其他灯位和地址不变。',
        confirmText: '确认排序',
        cancelText: '取消',
        success: (result) => {
          if (!result.confirm || !this._alive || !this._visible || !this.data.placementVisible || this.data.placementClosing
            || this._visibilityToken !== visibilityToken || this._contextId !== contextId
            || String(this._activeRodId || '') !== rodId || !this._layout
            || layoutFingerprint(this._layout) !== fingerprint) return
          const previous = clone(this._layout)
          const next = clone(this._layout)
          entries.forEach((entry, index) => {
            const visualIndex = reverse ? entries.length - 1 - index : index
            next.positionsById[entry.id] = {
              rodId,
              t: startT + ((visualIndex + 1) / (entries.length + 1)) * (endT - startT),
            }
          })
          this._layout = next
          const saved = this.saveLayoutOnly(next)
          if (saved) {
            this._layoutUndoSnapshot = previous
            this._layoutUndoExpiresAt = Date.now() + 6000
            this.setData({
              layoutUndoVisible: true,
              layoutUndoLabel: '已按地址排序（仅当前杆）',
            })
            this.scheduleLayoutUndoExpiry()
            vibrate('medium')
          } else {
            wx.showToast({ title: '排序未保存', icon: 'none' })
          }
        },
      })
    },
    onPreviewFixtureTap(event) {
      if (!this._alive || !this._visible || !this.data.placementVisible || this.data.placementClosing) return
      this.settlePendingFixtureTap()
      if (this._placementTransferPending) return
      const fixtureId = String(event && event.currentTarget && event.currentTarget.dataset.fixtureId || '')
      const position = this._layout && this._layout.positionsById && this._layout.positionsById[fixtureId]
      const matchesPreview = this._activeRodId
        ? Boolean(position && !isGroundPosition(position) && String(position.rodId) === String(this._activeRodId)
          && (this.data.previewItems || []).some((item) => item.id === fixtureId))
        : Boolean(isGroundPosition(position) && (this.data.groundPreviewItems || []).some((item) => item.id === fixtureId))
      if (!fixtureId || !matchesPreview) return
      this.setData({ selectedFixtureId: fixtureId })
      this.updateLayoutData()
    },
    cancelPendingFixtureTap() {
      if (this._fixtureTapTimer) clearTimeout(this._fixtureTapTimer)
      if (this._placementScrollTimer) clearTimeout(this._placementScrollTimer)
      this._fixtureTapTimer = null
      this._placementScrollTimer = null
      this._pendingFixtureTap = null
      this._queuedPanelFixtureTaps = []
    },
    cancelPlacementTransfer() {
      this._placementTransferToken = (this._placementTransferToken || 0) + 1
      this._placementTransferPending = false
      this._queuedPanelFixtureTaps = []
    },
    preparePlacementForHide() {
      if (this._pendingFixtureTap) this.settlePendingFixtureTap()
    },
    settlePendingFixtureTap() {
      const tap = this._pendingFixtureTap
      if (!tap) return
      this.cancelPendingFixtureTap()
      this.commitPlacementTap(tap)
    },
    onPlacementListScroll() {
      // A completed chip tap stays pending through native/inertial scroll callbacks
      // so a following same-chip tap can still be recognized as a double tap.
    },
    refreshAfterPlacementConflict(message) {
      if (!this._alive || !this._visible || !this.data.placementVisible) return
      if (this._layoutDirty) {
        showPlacementModal(wx, message + '灯位图有未保存编辑，已保留；请先处理保存提示。')
        return
      }
      const targetId = String(this._activeRodId || '')
      this.loadWorkspace()
      if (targetId && rodRows(this._layout).some(rod => String(rod.id) === targetId)) {
        this._activeRodId = targetId
        this._placementTargetNeedsReselect = false
      } else if (!targetId) {
        this._activeRodId = ''
        this._placementTargetNeedsReselect = false
      } else {
        this._placementTargetNeedsReselect = true
        message += '原目标灯杆已删除，请重新选择灯杆或舞台地面。'
      }
      this.updateLayoutData()
      showPlacementModal(wx, message)
    },
    consumePlacementCancelledNotice() {
      if (this._placementTapCancelled) showPlacementModal(wx, '上次操作未执行，请重试。')
      this._placementTapCancelled = false
    },
    createPlacementTapSnapshot(fixtureId, targetId, requireCurrentTarget = true) {
      const fixture = this._fixtures.find((item) => String(item.stableId) === String(fixtureId))
      return fixture && this._layout ? {
        fixtureId: String(fixture.stableId), fixtureFingerprint: fixtureFingerprint(fixture),
        targetId: String(targetId || '') || 'ground', contextId: String(this._contextId),
        visibilityToken: this._visibilityToken, layoutFingerprint: layoutFingerprint(this._layout),
        requireCurrentTarget,
      } : null
    },
    isPlacementTapCurrent(tap) {
      if (!tap || !this._alive || !this._visible || !this.data.placementVisible || this.data.placementClosing
        || this._visibilityToken !== tap.visibilityToken || String(this._contextId) !== tap.contextId
        || tap.requireCurrentTarget !== false && (String(this._activeRodId || '') || 'ground') !== tap.targetId || !this._layout
        || layoutFingerprint(this._layout) !== tap.layoutFingerprint) return false
      const latest = readLightingWorkspace(tap.contextId)
      if (!latest.ok || layoutFingerprint(latest.scheme.layout) !== this._persistedLayoutFingerprint) return false
      const current = calculateScheme(latest.scheme)
      const fresh = current.ok && current.valid && current.result.fixtures.find((item) => String(item.stableId) === tap.fixtureId)
      const local = this._fixtures.find((item) => String(item.stableId) === tap.fixtureId)
      return Boolean(fresh && local && fixtureFingerprint(fresh) === tap.fixtureFingerprint
        && fixtureFingerprint(local) === tap.fixtureFingerprint)
    },
    onPanelFixtureTap(event) {
      if (!this._alive || !this._visible || !this.data.placementVisible || this.data.placementClosing) return
      if (this._placementTargetNeedsReselect) {
        showPlacementModal(wx, '原目标灯杆已删除，请重新选择放置目标。')
        return
      }
      const fixtureId = String(event.currentTarget.dataset.fixtureId || '')
      if (this._placementTransferPending) {
        this._queuedPanelFixtureTaps = [...(this._queuedPanelFixtureTaps || []), fixtureId]
        return
      }
      const fixture = this._fixtures.find((item) => String(item.stableId) === fixtureId)
      if (!fixture) return
      const targetId = String(this._activeRodId || '') || 'ground'
      const previous = this._pendingFixtureTap
      if (previous && previous.fixtureId === fixtureId && previous.targetId === targetId
        && Date.now() - previous.startedAt <= PLACEMENT_TAP_DELAY) {
        this.cancelPendingFixtureTap()
        this.setData({ selectedFixtureId: fixtureId })
        this.updateLayoutData()
        const tap = this.createPlacementTapSnapshot(fixtureId, targetId)
        this.toggleSelectedFixtureMark(fixtureId, tap)
        return
      }
      if (previous) {
        this.cancelPendingFixtureTap()
        this.commitPlacementTap(previous)
      }
      if (this._placementTransferPending) {
        this._queuedPanelFixtureTaps = [...(this._queuedPanelFixtureTaps || []), fixtureId]
        return
      }
      const tap = this.createPlacementTapSnapshot(fixtureId, targetId)
      if (!tap) return
      tap.startedAt = Date.now()
      this._pendingFixtureTap = tap
      this.setData({ selectedFixtureId: fixtureId })
      this.updateLayoutData()
      this._fixtureTapTimer = setTimeout(() => {
        if (this._pendingFixtureTap !== tap) return
        this.cancelPendingFixtureTap()
        this.commitPlacementTap(tap)
      }, PLACEMENT_TAP_DELAY)
    },
    commitPlacementTap(tap) {
      if (!this.isPlacementTapCurrent(tap)) {
        this.refreshAfterPlacementConflict('灯具或灯位已更新，未执行放置；请检查未保存编辑')
        return
      }
      const fixture = this._fixtures.find((item) => String(item.stableId) === tap.fixtureId)
      const existing = this._layout.positionsById[tap.fixtureId]
      const isCurrentTarget = tap.targetId === 'ground' ? isGroundPosition(existing)
        : Boolean(existing && !isGroundPosition(existing) && String(existing.rodId) === tap.targetId)
      if (isCurrentTarget) {
        const next = clone(this._layout)
        delete next.positionsById[tap.fixtureId]
        this._layout = next
        const saved = this.saveLayoutOnly(next)
        if (!saved) wx.showToast({ title: '撤出未保存', icon: 'none' })
        if (saved) vibrate('light')
        return
      }
      if (existing) {
        const from = isGroundPosition(existing) ? '舞台地面' : rodName(this._layout, existing.rodId)
        showCrossTargetFeedback(wx, fixture, from)
        return
      }
      const place = () => {
        if (!this.isPlacementTapCurrent(tap)) {
          this.refreshAfterPlacementConflict('灯具或灯位已更新，未执行放置；请检查未保存编辑')
          return
        }
        const geometry = this.getGeometry()
        const next = clone(this._layout)
        if (tap.targetId === 'ground') {
          if (!geometry || !geometry.stage) return
          next.positionsById[tap.fixtureId] = nextGroundPosition(next, geometry.stage, tap.fixtureId)
        } else {
          const rod = geometry && geometry.rods.find((item) => String(item.id) === tap.targetId)
          if (!rod) return
          next.positionsById[tap.fixtureId] = { rodId: tap.targetId, t: this.nextRodPosition(next, rod, tap.fixtureId) }
        }
        this._layout = next
        const saved = this.saveLayoutOnly(next)
        if (!saved) wx.showToast({ title: '位置未保存', icon: 'none' })
        if (saved) vibrate('light')
      }
      place()
    },
    toggleSelectedFixtureMark(fixtureId, tap) {
      if (!tap && this._pendingFixtureTap) this.cancelPendingFixtureTap()
      if (!this._alive || !this._visible || !this.data.placementVisible || this.data.placementClosing) return
      fixtureId = String(fixtureId || this.data.selectedFixtureId || '')
      const selectedFixture = this._fixtures.find((item) => String(item.stableId) === fixtureId)
      if (!selectedFixture || !this._contextId) return
      if (tap && !this.isPlacementTapCurrent(tap)) {
        this.refreshAfterPlacementConflict('灯具或方案已更新，地址标记未更改；请检查未保存编辑')
        return
      }
      if (this._layoutDirty && !this.saveLayoutOnly(this._layout)) {
        wx.showToast({ title: '地址标记未保存', icon: 'none' })
        return
      }
      const visibilityToken = this._visibilityToken
      const contextId = this._contextId
      const latest = readLightingWorkspace(contextId)
      if (!latest.ok) return wx.showToast({ title: latest.error || '读取灯光方案失败，标记未更改', icon: 'none' })
      const current = calculateScheme(latest.scheme)
      const fixture = current.ok && current.valid ? current.result.fixtures.find((item) => String(item.stableId) === fixtureId) : null
      if (!fixture || fixtureFingerprint(fixture) !== fixtureFingerprint(selectedFixture)
        || tap && fixtureFingerprint(fixture) !== tap.fixtureFingerprint) {
        this.refreshAfterPlacementConflict('灯具地址或型号已变化，地址标记未更改')
        return
      }
      const checksById = { ...(current.scheme.checksById || {}) }
      const checked = checksById[fixtureId] && checksById[fixtureId].fingerprint === fixtureFingerprint(fixture)
      if (checked) delete checksById[fixtureId]
      else checksById[fixtureId] = { fingerprint: fixtureFingerprint(fixture) }
      const saved = saveLightingScheme(contextId, { ...current.scheme, checksById }, latest.revision)
      if (!saved.ok) {
        this.loadWorkspace()
        return wx.showToast({ title: saved.error === 'conflict' ? '方案已在其他页面更新，标记未覆盖' : saved.error || '标记保存失败', icon: 'none' })
      }
      const refreshed = calculateScheme(saved.scheme || { ...current.scheme, checksById })
      if (!refreshed.ok || !refreshed.valid || this._visibilityToken !== visibilityToken || this._contextId !== contextId) return
      this._scheme = refreshed.scheme
      this._fixtures = refreshed.result.fixtures || []
      this._groups = refreshed.result.groups || []
      this._revision = saved.revision
      this._loadedSchemeFingerprint = schemeFingerprint(saved.scheme || refreshed.scheme)
      if (refreshed.scheme.layout) {
        this._layout = clone(refreshed.scheme.layout)
        this._persistedLayoutFingerprint = layoutFingerprint(refreshed.scheme.layout)
      }
      this.setLayoutDirty(false)
      this.updateLayoutData()
      this.drawLayout()
      vibrate('light')
    },
    moveSelectedFixtureToGround() {
      this.cancelPendingFixtureTap()
      const fixture = this._fixtures.find((item) => String(item.stableId) === String(this.data.selectedFixtureId || ''))
      if (!fixture) return
      const tap = this.createPlacementTapSnapshot(fixture.stableId, 'ground', false)
      this.commitPlacementTap(tap)
    },
    moveSelectedFixtureToRod() {
      this.cancelPendingFixtureTap()
      const fixture = this._fixtures.find((item) => String(item.stableId) === String(this.data.selectedFixtureId || ''))
      if (!fixture || !this._activeRodId) return
      const tap = this.createPlacementTapSnapshot(fixture.stableId, this._activeRodId)
      this.commitPlacementTap(tap)
    },
    unplaceSelectedFixture() {
      if (!this._alive || !this._visible || !this.data.placementVisible || this.data.placementClosing || !this._layout) return
      this.settlePendingFixtureTap()
      if (this._placementTransferPending) return
      const fixtureId = String(this.data.selectedFixtureId || '')
      const fixture = this._fixtures.find((item) => String(item.stableId) === fixtureId)
      const existing = this._layout.positionsById && this._layout.positionsById[fixtureId]
      if (!fixture || !existing) return
      const from = isGroundPosition(existing) ? '舞台地面' : rodName(this._layout, existing.rodId)
      const visibilityToken = this._visibilityToken
      const contextId = this._contextId
      const fingerprint = layoutFingerprint(this._layout)
      const tap = this.createPlacementTapSnapshot(fixtureId, String(this._activeRodId || '') || 'ground')
      const fail = () => wx.showToast({ title: '确认失败', icon: 'none' })
      try {
        wx.showModal({
          title: '移回未放置',
          content: '将 ' + fixture.addressText + ' 从' + from + '移回未放置。地址和已设置标记保留。',
          confirmText: '确认移回',
          cancelText: '取消',
          success: (result) => {
            if (!result.confirm || !this._alive || !this._visible || !this.data.placementVisible || this.data.placementClosing
              || this._visibilityToken !== visibilityToken || this._contextId !== contextId
              || String(this.data.selectedFixtureId || '') !== fixtureId || !this._layout
              || layoutFingerprint(this._layout) !== fingerprint || !this.isPlacementTapCurrent(tap)) {
              if (result.confirm && this._alive && this.data.placementVisible) {
                this.refreshAfterPlacementConflict('灯具或灯位已更新，未移回未放置；请检查未保存编辑')
              }
              return
            }
            const next = clone(this._layout)
            delete next.positionsById[fixtureId]
            this._layout = next
            const saved = this.saveLayoutOnly(next)
            if (!saved) wx.showToast({ title: '位置未保存', icon: 'none' })
            if (saved) vibrate('light')
          },
          fail,
        })
      } catch (_) { fail() }
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
      const saved = this.saveLayoutOnly(next)
      this.setData({
        panelScrollIntoView: 'fixture-' + String(fixture.stableId),
        selectedFixtureId: String(fixture.stableId),
        highlightFixtureId: String(fixture.stableId),
      }, () => this.requestPreviewScrollIntoView(String(fixture.stableId)))
      if (!saved) wx.showToast({ title: '位置未保存', icon: 'none' })
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
      const positionsById = this._layout.positionsById || {}
      const entries = Object.entries(positionsById)
      const drawOrder = []
      geometry.rods.forEach((rod) => {
        entries
          .filter(([, position]) => !isGroundPosition(position) && String(position && position.rodId || '') === String(rod.id))
          .map(([id, position], index) => ({ id, position, index, rod }))
          .sort((a, b) => Number(a.position.t) - Number(b.position.t) || a.index - b.index)
          .forEach((entry) => drawOrder.push(entry))
      })
      entries.forEach(([id, position], index) => {
        if (isGroundPosition(position)) drawOrder.push({ id, position, index, rod: null })
      })
      const hitRadius = 24 / Math.max(.6, this._view.s)
      let bestFixture = null
      let bestDistance = hitRadius
      let bestDrawIndex = -1
      drawOrder.forEach(({ id, position, rod }, drawIndex) => {
        const fixture = fixtureById.get(String(id))
        if (!fixture) return
        const marker = layoutFixturePoint(geometry, rod, position)
        const distance = touchDistance(point, marker)
        if (distance > hitRadius) return
        const equidistant = Math.abs(distance - bestDistance) < .001
        if (distance < bestDistance - .001 || (equidistant && drawIndex > bestDrawIndex)) {
          bestFixture = fixture
          bestDistance = distance
          bestDrawIndex = drawIndex
        }
      })
      return bestFixture
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
      return bestDistance <= 12 / Math.max(.6, this._view.s) ? best : null
    },
    findDropRodAt(screenPoint) {
      const geometry = this.getGeometry()
      if (!geometry) return null
      const worldPoint = transformViewPointInverse(screenPoint, this._view)
      let best = null
      let bestScreenDistance = Infinity
      geometry.rods.forEach((rod) => {
        const t = projectPointToRod(rod, worldPoint)
        const projected = pointOnRod(rod, t)
        const screenDistance = touchDistance(worldPoint, projected) * Math.max(.6, this._view.s)
        if (screenDistance < bestScreenDistance) {
          bestScreenDistance = screenDistance
          best = { rod, t }
        }
      })
      return best && bestScreenDistance <= 36 ? { ...best, screenDistance: bestScreenDistance } : null
    },
    updateFixtureDragPreview(screenPoint) {
      const state = this._touchState
      const originalLayout = this._dragOriginalLayout
      const fixtureId = state && String(state.fixtureId || '')
      const original = originalLayout && originalLayout.positionsById
        && originalLayout.positionsById[fixtureId]
      if (!state || !state.dragging || !fixtureId || !original) return null
      const candidate = isGroundPosition(original) ? null : this.findDropRodAt(screenPoint)
      let nextPosition = null
      if (candidate) {
        nextPosition = { rodId: String(candidate.rod.id), t: candidate.t }
      } else if (isGroundPosition(original)) {
        const geometry = this.getGeometry()
        const worldPoint = transformViewPointInverse(screenPoint, this._view)
        const stage = geometry && geometry.stage
        if (stage) {
          const stageRight = stage.left + stage.width
          const stageBottom = stage.top + stage.height
          const clampedPoint = {
            x: Math.max(stage.left, Math.min(stageRight, worldPoint.x)),
            y: Math.max(stage.top, Math.min(stageBottom, worldPoint.y)),
          }
          const edgeOvershoot = touchDistance(worldPoint, clampedPoint) * Math.max(.6, this._view.s)
          if (edgeOvershoot <= 12) {
            nextPosition = {
              kind: 'ground',
              x: Math.max(0, Math.min(1, (clampedPoint.x - stage.left) / stage.width)),
              y: Math.max(0, Math.min(1, (clampedPoint.y - stage.top) / stage.height)),
            }
          }
        }
      }
      if (!nextPosition) {
        this._layout.positionsById[fixtureId] = clone(original)
        state.dragTarget = null
        this._dragPosition = false
        return null
      }
      const originalGround = isGroundPosition(original)
      const nextGround = isGroundPosition(nextPosition)
      const changed = originalGround !== nextGround
        || (originalGround && nextGround
          ? Math.abs(Number(original.x) - nextPosition.x) > .001 || Math.abs(Number(original.y) - nextPosition.y) > .001
          : Boolean(original.legacyPoint) || String(original.rodId) !== String(nextPosition.rodId)
            || Math.abs(Number(original.t) - Number(nextPosition.t)) > .001)
      this._layout.positionsById[fixtureId] = nextPosition
      state.dragTarget = nextPosition
      this._dragPosition = changed
      return nextPosition
    },
    beginFixtureDrag(fixtureId, draw = true) {
      const state = this._touchState
      const id = String(fixtureId || '')
      if (!this._alive || !this._visible || !state || !id || state.fixtureId !== id) return false
      if (state.dragging) return true
      const currentPosition = this._layout && this._layout.positionsById && this._layout.positionsById[id]
      if (!currentPosition) return false
      if (this._pressTimer) clearTimeout(this._pressTimer)
      this._pressTimer = null
      if (!this._dragOriginalLayout) this._dragOriginalLayout = clone(this._layout)
      this._dragPosition = false
      state.dragging = true
      this._activeRodId = String(currentPosition.rodId || this._activeRodId)
      this.setData({
        manipulationText: isGroundPosition(currentPosition)
          ? '长按并拖动可在舞台内调整；转移到灯杆请用面板按钮'
          : '拖动到目标灯杆，松手吸附',
        selectedFixtureId: id,
      })
      if (draw) this.drawLayout()
      return true
    },
    rollbackFixtureDrag() {
      if (!this._dragOriginalLayout) return false
      this._layout = clone(this._dragOriginalLayout)
      this._dragOriginalLayout = null
      this._dragPosition = null
      if (this._touchState) {
        this._touchState.dragging = false
        this._touchState.dragTarget = null
        this._touchState.dragT = null
      }
      this.setData({ manipulationText: '', selectedFixtureId: '' })
      this.drawLayout()
      return true
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
        this.rollbackFixtureDrag()
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
        startedAt: Date.now(),
        touchId: touches[0] && touches[0].identifier,
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
          this.beginFixtureDrag(fixture.stableId)
        }, 380)
      }
    },
    onCanvasTouchMove(event) {
      if (!this._alive || !this._visible) return
      const touches = event.touches || []
      if (touches.length >= 2) {
        if (this._pressTimer) clearTimeout(this._pressTimer)
        this._pressTimer = null
        this.rollbackFixtureDrag()
        this._touchState = null
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
        this._viewAutoFit = false
        this._viewManuallyAdjusted = true
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
      if (state.fixtureId && !state.dragging && delta > 8) {
        if (this._pressTimer) clearTimeout(this._pressTimer)
        this._pressTimer = null
        const position = this._layout.positionsById && this._layout.positionsById[state.fixtureId]
        if (!isGroundPosition(position) && this.beginFixtureDrag(state.fixtureId, false)) {
          const candidate = this.updateFixtureDragPreview(point)
          state.dragT = candidate ? candidate.t : null
          this.drawLayout()
          return
        }
      }
      if (state.dragging && state.fixtureId) {
        const candidate = this.updateFixtureDragPreview(point)
        state.dragT = candidate ? candidate.t : null
        this.drawLayout()
        return
      }
      if (this._pressTimer && delta > 12) {
        clearTimeout(this._pressTimer)
        this._pressTimer = null
      }
      if (this._gesture && this._gesture.type === 'single' && !state.fixtureId && delta > 5) {
        state.moved = true
        this._viewAutoFit = false
        this._viewManuallyAdjusted = true
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
      this.setData({ scrollEnabled: true, manipulationText: '' })
      if (wasPinch || !state) {
        this._touchState = null
        this.drawLayout()
        return
      }
      const changedTouches = event.changedTouches || []
      const changedTouch = state.touchId === undefined
        ? changedTouches.length === 1 ? changedTouches[0] : null
        : changedTouches.find((touch) => touch.identifier === state.touchId)
      const releasePoint = changedTouch ? this.canvasPoint(event, changedTouch) : state.last || state.start
      if (state.dragging && state.fixtureId) {
        this.updateFixtureDragPreview(releasePoint)
        this._touchState = null
        if (this._dragPosition) {
          this._dragPosition = null
          this._dragOriginalLayout = null
          if (this.saveLayoutOnly(this._layout) && this._alive && this._visible) vibrate('light')
        } else {
          this._layout = clone(this._dragOriginalLayout || this._layout)
          this._dragOriginalLayout = null
          this._dragPosition = null
          this.drawLayout()
        }
        return
      }
      this._touchState = null
      if (!changedTouch) {
        this.drawLayout()
        return
      }
      if (state.moved || touchDistance(state.start, releasePoint) > 5 || Date.now() - state.startedAt >= 380) {
        this.drawLayout()
        return
      }
      const startFixture = state.fixtureId
        ? this._fixtures.find((item) => String(item.stableId) === state.fixtureId)
        : this.findFixtureAt(state.start)
      const endFixture = this.findFixtureAt(releasePoint)
      if (startFixture || endFixture) {
        if (!startFixture || !endFixture || String(startFixture.stableId) !== String(endFixture.stableId)) return this.drawLayout()
        const fixture = startFixture
        const current = this._layout.positionsById[fixture.stableId]
        this._placementTargetNeedsReselect = false
        this.consumePlacementCancelledNotice()
        this.cancelSheetClose('placement')
        const previousRodId = String(this._activeRodId || '')
        if (isGroundPosition(current)) this._activeRodId = ''
        else if (current && current.rodId) this._activeRodId = String(current.rodId)
        if (previousRodId !== String(this._activeRodId || '')) this._previewScrollLeft = 0
        this._placementOrderSnapshot = null
        this.cancelPendingFixtureTap()
        this.suspendStageCanvas()
        this.setData({ selectedFixtureId: fixture.stableId, placementVisible: true, placementClosing: false, placementFilterText: '', placementSearchExpanded: false, placementPreviewFocus: false, placementScrollIntoView: '' })
        this.updateLayoutData()
        if (current && String(current.rodId || '') === String(this._activeRodId || '') && !isGroundPosition(current)) {
          this.requestPreviewScrollIntoView(String(fixture.stableId))
        }
        return
      }
      const startRod = state.rodId
        ? this.getGeometry().rods.find((item) => String(item.id) === state.rodId)
        : this.findRodAt(state.start)
      const endRod = this.findRodAt(releasePoint)
      if (startRod || endRod) {
        if (!startRod || !endRod || String(startRod.id) !== String(endRod.id)) return this.drawLayout()
        const rod = startRod
        this._placementTargetNeedsReselect = false
        this.consumePlacementCancelledNotice()
        this.cancelSheetClose('placement')
        this.cancelPendingFixtureTap()
        if (String(this._activeRodId) !== String(rod.id)) this._previewScrollLeft = 0
        this._activeRodId = rod.id
        this._placementOrderSnapshot = null
        this.suspendStageCanvas()
        this.setData({ selectedFixtureId: '', placementVisible: true, placementClosing: false, placementFilterText: '', placementSearchExpanded: false, placementPreviewFocus: false, placementScrollIntoView: '' })
        this.updateLayoutData()
        return
      }
      const geometry = this.getGeometry()
      const stage = geometry && geometry.stage
      const inside = (screenPoint) => {
        const point = transformViewPointInverse(screenPoint, this._view)
        return Boolean(stage && point.x >= stage.left && point.x <= stage.left + stage.width
          && point.y >= stage.top && point.y <= stage.top + stage.height)
      }
      if (!inside(state.start) || !inside(releasePoint)) return this.drawLayout()
      this.cancelSheetClose('placement')
      this.cancelPendingFixtureTap()
      this._previewScrollLeft = 0
      this._activeRodId = ''
      this._placementOrderSnapshot = null
      this._placementTargetNeedsReselect = false
      this.consumePlacementCancelledNotice()
      this.suspendStageCanvas()
      this.setData({ selectedFixtureId: '', placementVisible: true, placementClosing: false, placementFilterText: '', placementSearchExpanded: false, placementPreviewFocus: false, placementScrollIntoView: '' })
      this.updateLayoutData()
    },
    onCanvasTouchCancel(event) {
      this.cancelPendingFixtureTap()
      this.clearPendingGesture()
      if (this._visible) this.drawLayout()
    }
  }
}


'use strict'

function createLayoutLocateMethods(dependencies = {}) {
  const { LOCATE_RESULT_ROW_HEIGHT, classifyFixtureVisualType, clone, fixtureSort, layoutFingerprint, layoutFixturePoint, pointFromTouch, pointOnRod, projectPointToRod, rodName, rodRows, touchDistance, transformViewPointInverse, vibrate, zoomViewAt, wx, Date, setTimeout, clearTimeout } = dependencies
  return {
    openLocatePanel() {
      this.suspendStageCanvas()
      this.setData({
        locateVisible: true,
        locateClosing: false,
        searchText: '',
        searchResults: [],
        locateResultsHeight: 0,
        searchErrorText: '',
      })
    },
    closeLocatePanel() {
      if (!this.data.locateVisible || this.data.locateClosing) return
      const visibilityToken = this._visibilityToken
      this.setData({ locateClosing: true })
      setTimeout(() => {
        if (!this._alive || !this._visible || this._visibilityToken !== visibilityToken) return
        this.setData({ locateVisible: false, locateClosing: false }, () => this.restoreStageCanvas())
      }, 180)
    },
    onPlacementFilterInput(event) {
      if (!this._alive || !this._visible || !this.data.placementVisible || this.data.placementClosing) return
      this.settlePendingFixtureTap()
      if (this._placementTransferPending) return
      this.setData({ placementFilterText: event.detail.value || '' })
      this.updateLayoutData()
    },
    onSearchInput(event) {
      this.setData({ searchText: event.detail.value || '', searchErrorText: '', searchResults: [], locateResultsHeight: 0 })
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
            rodName: isGroundPosition(position) ? '舞台地面' : position && position.rodId ? rodName(this._layout, position.rodId) : '',
          }
        })
      this.setData({
        searchResults: matches,
        locateResultsHeight: matches.length * LOCATE_RESULT_ROW_HEIGHT,
        searchErrorText: matches.length ? '' : '没有找到匹配灯具',
      })
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
        if (this._alive && this._visible && this._visibilityToken === visibilityToken) {
          this.setData({ locateVisible: false, locateClosing: false }, () => this.restoreStageCanvas())
        }
      }, 180)
      if (position && (position.rodId || isGroundPosition(position))) {
        const geometry = this.getGeometry()
        const rod = position.rodId
          ? geometry.rods.find((item) => String(item.id) === String(position.rodId))
          : null
        if (rod || isGroundPosition(position)) {
          if (rod) this._activeRodId = String(position.rodId)
          this.animateViewTo(layoutFixturePoint(geometry, rod, position))
        }
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
    }
  }
}

module.exports = { createLayoutPlacementMethods, createLayoutLocateMethods }

