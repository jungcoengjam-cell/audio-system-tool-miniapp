'use strict'

const { computeFloatingCardFrame } = require('./viewport')

function isGestureIgnored(event) {
  const target = event?.target || {}
  const targetData = target.dataset || {}
  const tagName = String(target.tagName || target.nodeName || '').toLowerCase()
  return targetData.gestureIgnore === true
    || targetData.gestureIgnore === 'true'
    || ['input', 'picker', 'textarea', 'scroll-view'].includes(tagName)
}

function createDmxCardInteractionMethods(runtime) {
  const { Date, setTimeout, clearTimeout, wx } = runtime
  return {
    onGroupTouchStart(event) {
      if (event.touches?.length > 1) {
        if (this._groupTouchStart) this.onGroupTouchCancel()
        this._suppressFloatingOpenUntil = Date.now() + 550
        return
      }
      if (!this._pageAlive || !this._pageVisible || isGestureIgnored(event)) {
        this._groupTouchStart = null
        return
      }
      const point = event.touches?.[0] || event.changedTouches?.[0] || {}
      const index = Number(event.currentTarget?.dataset?.index)
      const group = this.data.groupCards[index]
      if (!Number.isInteger(index) || !group) return
      const token = ++this._touchGestureToken
      this._groupTouchStart = {
        token,
        index,
        x: Number(point.clientX ?? point.pageX ?? 0),
        y: Number(point.clientY ?? point.pageY ?? 0),
        startOffset: this.data.swipedGroupIndex === index ? -76 : 0,
        startOpenIndex: this.data.swipedGroupIndex,
        axis: 'pending',
        moved: false,
        contextId: this._contextId,
        revision: this._workspaceRevision,
        groupId: group._lightingGroupId,
      }
    },
    onGroupTouchMove(event) {
      const gesture = this._groupTouchStart
      if (event.touches?.length > 1) {
        if (gesture) this.onGroupTouchCancel()
        this._suppressFloatingOpenUntil = Date.now() + 550
        return
      }
      if (!gesture || gesture.token !== this._touchGestureToken || !this._pageAlive || !this._pageVisible) return
      const activeGroup = this.data.groups[gesture.index]
      if (gesture.contextId !== this._contextId || gesture.revision !== this._workspaceRevision
        || !activeGroup || activeGroup._lightingGroupId !== gesture.groupId) {
        this.resetTouchGestures(true)
        return
      }
      const point = event.touches?.[0] || event.changedTouches?.[0] || {}
      const dx = Number(point.clientX ?? point.pageX ?? gesture.x) - gesture.x
      const dy = Number(point.clientY ?? point.pageY ?? gesture.y) - gesture.y
      const absX = Math.abs(dx)
      const absY = Math.abs(dy)
      if (gesture.axis === 'pending') {
        if (Math.max(absX, absY) < 7) return
        if (absY >= absX * 1.2) {
          gesture.axis = 'vertical'
          return
        }
        if (absX < absY * 1.2) return
        gesture.axis = 'horizontal'
      }
      if (gesture.axis !== 'horizontal') return
      gesture.moved = true
      this._suppressFloatingOpenUntil = Date.now() + 550
      const offset = Math.max(-76, Math.min(0, gesture.startOffset + dx))
      this.setData({
        swipeDragIndex: gesture.index,
        swipeDragOffset: offset,
        swipeDragging: true,
        swipedGroupIndex: -1,
      })
    },
    onGroupTouchEnd(event) {
      if ((event.touches?.length || 0) > 0 || (event.changedTouches?.length || 0) > 1) {
        if (this._groupTouchStart) this.onGroupTouchCancel()
        this._suppressFloatingOpenUntil = Date.now() + 550
        return
      }
      const start = this._groupTouchStart
      this._groupTouchStart = null
      this._touchGestureToken += 1
      if (!start || !this._pageAlive || !this._pageVisible) return
      const activeGroup = this.data.groups[start.index]
      if (start.contextId !== this._contextId || start.revision !== this._workspaceRevision
        || !activeGroup || activeGroup._lightingGroupId !== start.groupId) {
        this.resetTouchGestures(true)
        return
      }
      const point = event.changedTouches?.[0] || event.touches?.[0] || {}
      const dx = Number(point.clientX ?? point.pageX ?? start.x) - start.x
      const dy = Number(point.clientY ?? point.pageY ?? start.y) - start.y
      if (start.axis === 'pending' && Math.max(Math.abs(dx), Math.abs(dy)) >= 7) {
        start.axis = Math.abs(dx) >= Math.abs(dy) * 1.2 ? 'horizontal' : 'vertical'
      }
      if (start.axis !== 'horizontal') return
      this._suppressFloatingOpenUntil = Date.now() + 550
      const offset = Math.max(-76, Math.min(0, start.startOffset + dx))
      this.setData({
        swipedGroupIndex: offset <= -38 ? start.index : -1,
        swipeDragIndex: -1,
        swipeDragOffset: 0,
        swipeDragging: false,
      })
    },
    onGroupTouchCancel() {
      const start = this._groupTouchStart
      this._groupTouchStart = null
      this._touchGestureToken += 1
      if (!start) return
      if (start.moved) this._suppressFloatingOpenUntil = Date.now() + 550
      this.setData({
        swipedGroupIndex: start.startOpenIndex,
        swipeDragIndex: -1,
        swipeDragOffset: 0,
        swipeDragging: false,
      })
    },
    resetTouchGestures(closeSwipeRows = false, options = {}) {
      const activeGesture = this._groupTouchStart || this._floatingTouchStart
      this._touchGestureToken = (Number(this._touchGestureToken) || 0) + 1
      this._groupTouchStart = null
      this._floatingTouchStart = null
      if (activeGesture?.moved) this._suppressFloatingOpenUntil = Date.now() + 550
      const patch = {
        swipeDragIndex: -1,
        swipeDragOffset: 0,
        swipeDragging: false,
        floatingSwipeOffset: 0,
        floatingSwipeDragging: false,
        ...(closeSwipeRows ? { swipedGroupIndex: -1 } : {}),
      }
      if (options.submit !== false) this.setData(patch)
      return patch
    },
    openFloatingCard(event) {
      if (!this._pageAlive || !this._pageVisible) return
      if (Date.now() < (Number(this._suppressFloatingOpenUntil) || 0)) return
      const index = Number(event.currentTarget.dataset.index)
      const group = this.data.groupCards[index]
      if (!group) return
      this._floatingClosing = false
      this.cancelFloatingTransition()
      const transitionId = this._floatingTransitionId
      const query = wx.createSelectorQuery?.().in(this)
      const openAt = (measuredRect) => {
        if (!this._pageAlive || !this._pageVisible || transitionId !== this._floatingTransitionId) return
        const rect = measuredRect || {}
        const info = { windowWidth: this.data.windowWidth, windowHeight: this.data.windowHeight }
        const frame = computeFloatingCardFrame(group, info, this.data.overlaySafeTop, this.data.overlaySafeBottom)
        const { targetLeft, targetTop, targetWidth, cardHeight } = frame
        this._floatingOrigin = {
          left: Number.isFinite(Number(rect.left)) && Number(rect.width) > 0 ? Number(rect.left) : targetLeft,
          top: Number.isFinite(Number(rect.top)) && Number(rect.height) > 0 ? Number(rect.top) : targetTop,
          width: Number(rect.width) > 0 ? Number(rect.width) : targetWidth,
          height: Number(rect.height) > 0 ? Number(rect.height) : cardHeight,
        }
        const origin = this._floatingOrigin
        this.setData({
          floatingGroup: group,
          floatingVisible: true,
          floatingSwipeOffset: 0,
          floatingSwipeDragging: false,
          floatingStyle: `left:${origin.left}px;top:${origin.top}px;width:${origin.width}px;height:${origin.height}px;`,
        }, () => {
          if (!this._pageAlive || !this._pageVisible || transitionId !== this._floatingTransitionId) return
          this._floatingTransitionTimer = setTimeout(() => {
            this._floatingTransitionTimer = null
            if (!this._pageAlive || !this._pageVisible || transitionId !== this._floatingTransitionId) return
            this.setData({ floatingStyle: `left:${targetLeft}px;top:${targetTop}px;width:${targetWidth}px;height:${cardHeight}px;` })
          }, 20)
        })
      }
      if (!query) return openAt()
      query.select(`#fixture-card-${index}`).boundingClientRect(openAt).exec()
    },
    repositionFloatingCard(group = this.data.floatingGroup) {
      if (!group || !this._pageAlive || !this._pageVisible || this._floatingClosing) return
      const index = Number(group.groupIndex)
      const transitionId = this._floatingTransitionId
      const positionRequestId = (Number(this._floatingPositionRequestId) || 0) + 1
      this._floatingPositionRequestId = positionRequestId
      const contextId = this._contextId
      const groupId = String(group._lightingGroupId || group.groupId || group.id || '')
      const query = wx.createSelectorQuery?.().in(this)
      const reposition = (rect) => {
        if (!this._pageAlive || !this._pageVisible || this._floatingClosing || transitionId !== this._floatingTransitionId
          || positionRequestId !== this._floatingPositionRequestId || contextId !== this._contextId || !this.data.floatingGroup) return
        const activeGroupId = String(this.data.floatingGroup._lightingGroupId || this.data.floatingGroup.groupId || this.data.floatingGroup.id || '')
        if (groupId && activeGroupId !== groupId) return
        const info = { windowWidth: this.data.windowWidth, windowHeight: this.data.windowHeight }
        const frame = computeFloatingCardFrame(group, info, this.data.overlaySafeTop, this.data.overlaySafeBottom)
        const measured = rect || this._floatingOrigin || {}
        this._floatingOrigin = {
          left: Number(measured.left) || frame.targetLeft,
          top: Number(measured.top) || frame.targetTop,
          width: Number(measured.width) || frame.targetWidth,
          height: Number(measured.height) || frame.cardHeight,
        }
        this.setData({ floatingStyle: `left:${frame.targetLeft}px;top:${frame.targetTop}px;width:${frame.targetWidth}px;height:${frame.cardHeight}px;` })
      }
      if (!query || !Number.isInteger(index)) return reposition()
      query.select(`#fixture-card-${index}`).boundingClientRect(reposition).exec()
    },
    closeFloatingCard(options = {}) {
      if (!this.data.floatingGroup) return
      this.cancelFloatingTransition()
      this._floatingClosing = true
      this._floatingTouchStart = null
      this._touchGestureToken += 1
      const transitionId = this._floatingTransitionId
      const origin = this._floatingOrigin
      if (!origin) {
        this._floatingClosing = false
        this._floatingOrigin = null
        this.setData({ floatingGroup: null, floatingVisible: false, floatingStyle: '', floatingSwipeOffset: 0, floatingSwipeDragging: false })
        return
      }
      this.setData({
        floatingStyle: `left:${origin.left}px;top:${origin.top}px;width:${origin.width}px;height:${origin.height}px;`,
        floatingSwipeOffset: 0,
        floatingSwipeDragging: false,
      })
      this._floatingTransitionTimer = setTimeout(() => {
        this._floatingTransitionTimer = null
        if (!this._pageAlive || !this._pageVisible || transitionId !== this._floatingTransitionId) return
        this._floatingClosing = false
        this._floatingOrigin = null
        this.setData({ floatingGroup: null, floatingVisible: false, floatingStyle: '', floatingSwipeOffset: 0, floatingSwipeDragging: false })
      }, 230)
    },
    cancelFloatingTransition() {
      this._floatingTransitionId = (Number(this._floatingTransitionId) || 0) + 1
      this._floatingPositionRequestId = (Number(this._floatingPositionRequestId) || 0) + 1
      clearTimeout(this._floatingTransitionTimer)
      this._floatingTransitionTimer = null
    },
    onFloatingTouchStart(event) {
      if (event.touches?.length > 1) {
        if (this._floatingTouchStart) this.onFloatingTouchCancel()
        this._suppressFloatingOpenUntil = Date.now() + 550
        return
      }
      if (!this._pageAlive || !this._pageVisible || !this.data.floatingGroup || isGestureIgnored(event)) {
        this._floatingTouchStart = null
        return
      }
      const point = event.touches?.[0] || event.changedTouches?.[0] || {}
      const token = ++this._touchGestureToken
      this._floatingTouchStart = {
        token,
        x: Number(point.clientX ?? point.pageX ?? 0),
        y: Number(point.clientY ?? point.pageY ?? 0),
        axis: 'pending',
        moved: false,
      }
    },
    onFloatingTouchMove(event) {
      const gesture = this._floatingTouchStart
      if (event.touches?.length > 1) {
        if (gesture) this.onFloatingTouchCancel()
        this._suppressFloatingOpenUntil = Date.now() + 550
        return
      }
      if (!gesture || gesture.token !== this._touchGestureToken || !this._pageAlive || !this._pageVisible) return
      const point = event.touches?.[0] || event.changedTouches?.[0] || {}
      const dx = Number(point.clientX ?? point.pageX ?? gesture.x) - gesture.x
      const dy = Number(point.clientY ?? point.pageY ?? gesture.y) - gesture.y
      const absX = Math.abs(dx)
      const absY = Math.abs(dy)
      if (gesture.axis === 'pending') {
        if (Math.max(absX, absY) < 7) return
        if (absY >= absX * 1.2) {
          gesture.axis = 'vertical'
          return
        }
        if (absX < absY * 1.2) return
        gesture.axis = 'horizontal'
      }
      if (gesture.axis !== 'horizontal') return
      gesture.moved = true
      this._suppressFloatingOpenUntil = Date.now() + 550
      this.setData({ floatingSwipeOffset: Math.max(0, dx), floatingSwipeDragging: true })
    },
    onFloatingTouchEnd(event) {
      if ((event.touches?.length || 0) > 0 || (event.changedTouches?.length || 0) > 1) {
        if (this._floatingTouchStart) this.onFloatingTouchCancel()
        this._suppressFloatingOpenUntil = Date.now() + 550
        return
      }
      const start = this._floatingTouchStart
      this._floatingTouchStart = null
      this._touchGestureToken += 1
      if (!start || !this._pageAlive || !this._pageVisible) return
      const point = event.changedTouches?.[0] || event.touches?.[0] || {}
      const dx = Number(point.clientX ?? point.pageX ?? start.x) - start.x
      const dy = Number(point.clientY ?? point.pageY ?? start.y) - start.y
      if (start.axis === 'pending' && Math.max(Math.abs(dx), Math.abs(dy)) >= 7) {
        start.axis = Math.abs(dx) >= Math.abs(dy) * 1.2 ? 'horizontal' : 'vertical'
      }
      if (start.axis === 'horizontal') {
        this._suppressFloatingOpenUntil = Date.now() + 550
        if (dx > 72 && dx > Math.abs(dy) * 1.2) {
          this.closeFloatingCard({ fromSwipe: true })
          return
        }
      }
      this.setData({ floatingSwipeOffset: 0, floatingSwipeDragging: false })
    },
    onFloatingTouchCancel() {
      const start = this._floatingTouchStart
      this._floatingTouchStart = null
      this._touchGestureToken += 1
      if (!start || !this._pageAlive || !this._pageVisible || !this.data.floatingGroup) return
      if (start?.moved) this._suppressFloatingOpenUntil = Date.now() + 550
      this.setData({ floatingSwipeOffset: 0, floatingSwipeDragging: false })
    },
  }
}

module.exports = { createDmxCardInteractionMethods }
