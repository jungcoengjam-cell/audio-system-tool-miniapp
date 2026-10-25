'use strict'

function createLayoutPlacementMethods(dependencies = {}) {
  const { LOCATE_RESULT_ROW_HEIGHT, classifyFixtureVisualType, clone, fixtureSort, layoutFingerprint, layoutFixturePoint, pointFromTouch, pointOnRod, projectPointToRod, rodName, rodRows, touchDistance, transformViewPointInverse, vibrate, zoomViewAt, wx, Date, setTimeout, clearTimeout } = dependencies
  return {
    openPlacementPanel() {
      if (!this._layout) return
      this.cancelSheetClose('placement')
      const rods = rodRows(this._layout)
      if (!rods.some((rod) => String(rod.id) === String(this._activeRodId))) this._activeRodId = rods[0] ? rods[0].id : ''
      this.suspendStageCanvas()
      this.setData({ placementVisible: true, placementClosing: false, placementFilterText: '', placementNotice: '点选灯具即可上杆或下杆' }, () => this.measurePreviewViewport())
      this.updateLayoutData()
      this.drawLayout()
    },
    closePlacementPanel() {
      if (!this.data.placementVisible || this.data.placementClosing) return
      this.invalidatePendingClear()
      this._previewMeasureToken += 1
      this.beginSheetClose('placement', 'placementClosing', () => {
        this.setData({ placementVisible: false, placementClosing: false }, () => this.restoreStageCanvas())
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
      const validRodIds = new Set(rodRows(this._layout).map((rod) => String(rod.id)))
      const targetRodId = scopeRodId === null || scopeRodId === undefined || scopeRodId === '' ? '' : String(scopeRodId)
      if (targetRodId && !validRodIds.has(targetRodId)) return
      const placedCount = this._fixtures.filter((fixture) => {
        const position = this._layout.positionsById && this._layout.positionsById[String(fixture.stableId)]
        return Boolean(position && validRodIds.has(String(position.rodId)) && (!targetRodId || String(position.rodId) === targetRodId))
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
        const notice = '清空确认失败，请重试'
        this.setData({ placementNotice: notice })
        wx.showToast({ title: '确认失败', icon: 'none' })
      }
      this._clearLayoutPending = true
      this.setData({ clearLayoutPending: true })
      try {
        wx.showModal({
          title: targetRodId ? '清空当前灯杆灯位' : '清空整个灯位图',
          content: targetRodId
            ? '将 ' + rodName(this._layout, targetRodId) + ' 上的 ' + placedCount + ' 台灯具移回未上杆。其他灯杆、灯组、地址和核对状态保留。'
            : '将 ' + placedCount + ' 台灯具全部移回未上杆。灯组、地址、核对状态和灯杆保留。',
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
              placementNotice: saved ? (targetRodId ? '当前灯杆灯位已清空' : '灯位图已清空') : '清空未保存，请关闭后重试保存',
              panelScrollIntoView: '',
            })
            this.updateLayoutData()
            this.drawLayout()
            if (!saved) wx.showToast({ title: '清空未保存，请重试', icon: 'none' })
          },
          fail: showModalFailure,
        })
      } catch (_) {
        showModalFailure()
      }
    },
    onSelectRod(event) {
      if (!this._alive || !this._visible || !this.data.placementVisible || this.data.placementClosing) return
      const rodId = event.currentTarget.dataset.rodId
      if (!rodRows(this._layout).some((rod) => String(rod.id) === String(rodId))) return
      this._activeRodId = rodId
      this._previewScrollLeft = 0
      this.setData({ placementNotice: '点选灯具即可上杆或下杆' })
      this.updateLayoutData()
      const firstItem = (this.data.previewItems || [])[0]
      if (firstItem) this.requestPreviewScrollIntoView(firstItem.id)
      this.drawLayout()
    },
    onPreviewFixtureTap(event) {
      if (!this._alive || !this._visible || !this.data.placementVisible || this.data.placementClosing) return
      const fixtureId = String(event && event.currentTarget && event.currentTarget.dataset.fixtureId || '')
      const position = this._layout && this._layout.positionsById && this._layout.positionsById[fixtureId]
      if (!fixtureId || !position || String(position.rodId) !== String(this._activeRodId)) return
      if (!(this.data.previewItems || []).some((item) => item.id === fixtureId)) return
      this.setData({
        selectedFixtureId: fixtureId,
        panelScrollIntoView: 'fixture-' + fixtureId,
      })
    },
    onPanelFixtureTap(event) {
      if (!this._alive || !this._visible || !this.data.placementVisible || this.data.placementClosing) return
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
        const contextId = this._contextId
        const layoutStateFingerprint = layoutFingerprint(this._layout)
        const targetRodId = String(this._activeRodId)
        wx.showModal({
          title: '确认移动灯具',
          content: fixture.addressText + ' 当前位于' + from + '，要移动到' + to + '吗？',
          confirmText: '移动',
          cancelText: '取消',
          success: (result) => {
            if (result.confirm && this._alive && this._visible && this.data.placementVisible && !this.data.placementClosing
              && this._visibilityToken === visibilityToken && this._contextId === contextId
              && layoutFingerprint(this._layout) === layoutStateFingerprint
              && String(this._activeRodId) === targetRodId) {
              this.assignFixtureToRod(fixture, targetRodId)
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
        panelScrollIntoView: 'fixture-' + String(fixture.stableId),
        selectedFixtureId: String(fixture.stableId),
        highlightFixtureId: String(fixture.stableId),
      }, () => this.requestPreviewScrollIntoView(String(fixture.stableId)))
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
      const candidate = this.findDropRodAt(screenPoint)
      if (!candidate) {
        this._layout.positionsById[fixtureId] = clone(original)
        state.dragTarget = null
        this._dragPosition = false
        return null
      }
      const rodId = String(candidate.rod.id)
      const nextPosition = { rodId, t: candidate.t }
      const changed = Boolean(original.legacyPoint)
        || String(original.rodId) !== rodId
        || Math.abs(Number(original.t) - candidate.t) > .001
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
      this.setData({ manipulationText: '拖动到目标灯杆，松手吸附', selectedFixtureId: id })
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
        if (this.beginFixtureDrag(state.fixtureId, false)) {
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
      if (state.dragging && state.fixtureId) {
        const changedTouch = event.changedTouches && event.changedTouches.length
          ? event.changedTouches[event.changedTouches.length - 1]
          : null
        const releasePoint = changedTouch ? this.canvasPoint(event, changedTouch) : state.last || state.start
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
      if (state.moved) {
        this.drawLayout()
        return
      }
      const point = state.last || state.start
      const fixture = state.fixtureId ? this._fixtures.find((item) => String(item.stableId) === state.fixtureId) : this.findFixtureAt(point)
      if (fixture) {
        const current = this._layout.positionsById[fixture.stableId]
        this.cancelSheetClose('placement')
        const previousRodId = String(this._activeRodId || '')
        if (current && current.rodId) this._activeRodId = current.rodId
        if (previousRodId !== String(this._activeRodId || '')) this._previewScrollLeft = 0
        this.suspendStageCanvas()
        this.setData({ selectedFixtureId: fixture.stableId, placementVisible: true, placementClosing: false })
        this.updateLayoutData({
          placementNotice: current
            ? fixture.addressText + ' · ' + rodName(this._layout, current.rodId)
            : fixture.addressText + ' 尚未上杆',
        })
        if (current && String(current.rodId) === String(this._activeRodId)) {
          this.requestPreviewScrollIntoView(String(fixture.stableId))
        }
        return
      }
      const rod = state.rodId
        ? this.getGeometry().rods.find((item) => String(item.id) === state.rodId)
        : this.findRodAt(point)
      if (rod) {
        this.cancelSheetClose('placement')
        if (String(this._activeRodId) !== String(rod.id)) this._previewScrollLeft = 0
        this._activeRodId = rod.id
        this.suspendStageCanvas()
        this.setData({ placementVisible: true, placementClosing: false, placementNotice: rod.label + ' · 点选灯具即可上杆或下杆' })
        this.updateLayoutData()
        const firstItem = (this.data.previewItems || [])[0]
        if (firstItem) this.requestPreviewScrollIntoView(firstItem.id)
      }
    },
    onCanvasTouchCancel(event) {
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
            rodName: position && position.rodId ? rodName(this._layout, position.rodId) : '',
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
    }
  }
}

module.exports = { createLayoutPlacementMethods, createLayoutLocateMethods }

