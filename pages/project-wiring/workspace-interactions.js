const SWIPE_ACTION_WIDTH = 72
const SWIPE_LOCK_THRESHOLD = 12
const SWIPE_START_THRESHOLD = 7
const WORKSPACE_INTERACTION_TRACE_BUILD = 'workspace-touch-2026-10-16-r1'
const WORKSPACE_INTERACTION_TRACE_LIMIT = 80
const WORKSPACE_SUPPRESSED_TOUCH_MS = 300
const WORKSPACE_TRACE_ENUMS = {
  control: new Set(['action', 'connect', 'device', 'line', 'delete-device', 'delete-line']),
  reason: new Set(['explicit', 'recent-drag', 'no-action-touch', 'action-touch-moved', 'action-touch-match',
    'action-touch-target-mismatch', 'action-touch-not-matched', 'cancelled', 'background-tap', 'list-scroll',
    'stale-target', 'busy', 'ready', 'capture-rejected', 'target-missing', 'destroyed', 'hidden',
    'project-mismatch', 'revision-mismatch', 'load-revision-mismatch', 'token-mismatch', 'requested', 'accepted', 'modal-unavailable',
    'modal-failed', 'already-submitted', 'started', 'response-ok', 'response-failed', 'context-stale',
    'response-invalid', 'applied', 'editor-opened', 'editor-not-open']),
  axis: new Set(['tap', 'horizontal', 'vertical']),
  phase: new Set(['hide', 'show', 'unload', 'enter', 'exit']),
}
const WORKSPACE_TRACE_STAGES = new Set(['trace-start', 'trace-stop', 'action-tap', 'action-tap-result',
  'row-touch-start', 'row-touch-axis', 'row-touch-end', 'row-touch-cancel', 'swipe-row-close',
  'delete-guard', 'delete-capture', 'delete-modal', 'delete-modal-callback', 'delete-save',
  'delete-save-result', 'delete-apply', 'page-lifecycle', 'delete-render', 'connect-guard', 'connect-open'])

function createWorkspaceInteractionMethods(runtime) {
  const { Date, text, dataset, datasetBoolean, firstTouch, touchIdentifier, isInlineRenameInputTarget } = runtime
  return {
    startWorkspaceInteractionTrace() {
      this._workspaceInteractionTraceEnabled = true
      this._workspaceInteractionTraceEvents = []
      this._workspaceInteractionTraceSequence = 0
      this._workspaceInteractionTraceStartedAt = Date.now()
      this.traceWorkspaceInteraction('trace-start', { reason: 'explicit' })
      return this.getWorkspaceInteractionTrace()
    },

    getWorkspaceInteractionTrace() {
      return {
        build: WORKSPACE_INTERACTION_TRACE_BUILD,
        enabled: Boolean(this._workspaceInteractionTraceEnabled),
        events: (this._workspaceInteractionTraceEvents || []).map((event) => ({ ...event })),
      }
    },

    stopWorkspaceInteractionTrace() {
      const result = this.getWorkspaceInteractionTrace()
      this.traceWorkspaceInteraction('trace-stop', { reason: 'explicit' })
      this._workspaceInteractionTraceEnabled = false
      result.enabled = false
      result.events = (this._workspaceInteractionTraceEvents || []).map((event) => ({ ...event }))
      return result
    },

    traceWorkspaceInteraction(stage, details = {}) {
      if (!this._workspaceInteractionTraceEnabled) return
      const boolFields = ['touchPresent', 'identifierPresent', 'identifierZero', 'targetPresent', 'tapArrived',
        'projectMatch', 'revisionMatch', 'loadRevisionMatch', 'tokenMatch', 'busy', 'suppressed',
        'accepted', 'confirmed', 'saveOk', 'rendered', 'destroyed', 'hidden']
      const enumFields = ['control', 'reason', 'axis', 'phase']
      const entry = {
        sequence: ++this._workspaceInteractionTraceSequence,
        elapsedMs: Math.max(0, Date.now() - this._workspaceInteractionTraceStartedAt),
        stage: WORKSPACE_TRACE_STAGES.has(stage) ? stage : 'other',
      }
      boolFields.forEach((key) => {
        if (typeof details[key] === 'boolean') entry[key] = details[key]
      })
      enumFields.forEach((key) => {
        if (typeof details[key] === 'string' && WORKSPACE_TRACE_ENUMS[key] && WORKSPACE_TRACE_ENUMS[key].has(details[key])) {
          entry[key] = details[key]
        }
      })
      const events = this._workspaceInteractionTraceEvents || (this._workspaceInteractionTraceEvents = [])
      events.push(entry)
      if (events.length > WORKSPACE_INTERACTION_TRACE_LIMIT) events.splice(0, events.length - WORKSPACE_INTERACTION_TRACE_LIMIT)
    },

    workspaceActionControl(event) {
      const data = dataset(event)
      if (data.actionType === 'connect') return 'connect'
      if (data.actionType === 'rename-device') return 'device'
      if (data.deleteType === 'device') return 'delete-device'
      if (data.deleteType === 'line') return 'delete-line'
      return 'action'
    },

    workspaceActionRowKey(event) {
      const data = dataset(event)
      const type = data.deleteType || (data.actionType === 'connect' || data.actionType === 'rename-device' ? 'device' : '')
      const id = text(data.id)
      return type && id ? `${type}:${id}` : ''
    },

    workspaceActionTargetPresent(event) {
      const data = dataset(event)
      const id = text(data.id)
      if (!id || !this._workspace) return false
      if (data.deleteType === 'line') return this._workspace.groups.some((group) => group.lines.some((line) => line.id === id))
      if (data.actionType === 'rename-device' || data.actionType === 'connect' || data.deleteType === 'device') {
        const matches = this._workspace.devices.filter((device) => device.id === id)
        const key = text(data.deviceKey)
        if (key) return matches.some((device) => device.key === key)
        return matches.length === 1
      }
      return this._workspace.devices.some((device) => device.id === id)
    },

    rememberWorkspaceSuppressedTouch(event, targetKey = '') {
      const key = text(targetKey)
      if (!key) return
      const identifier = touchIdentifier(firstTouch(event, 'changedTouches')) || touchIdentifier(firstTouch(event))
      const now = Date.now()
      Object.keys(this._workspaceSuppressedTouches || {}).forEach((key) => {
        const record = this._workspaceSuppressedTouches[key]
        if (!record || record.expires < now) delete this._workspaceSuppressedTouches[key]
      })
      const record = { key, expires: now + WORKSPACE_SUPPRESSED_TOUCH_MS }
      this._workspaceSuppressedTapTarget = record
      if (identifier !== '') this._workspaceSuppressedTouches[identifier] = record
    },

    clearWorkspaceSuppressedTouchForStart(event) {
      const identifier = touchIdentifier(firstTouch(event))
      if (identifier !== '' && this._workspaceSuppressedTouches) delete this._workspaceSuppressedTouches[identifier]
      this._workspaceSuppressedTapTarget = null
      this._workspaceActionTouch = null
    },

    consumeWorkspaceSuppressedTouch(event, targetKey = '') {
      const identifier = touchIdentifier(firstTouch(event, 'changedTouches'))
      const key = text(targetKey)
      const now = Date.now()
      if (identifier !== '' && this._workspaceSuppressedTouches) {
        const record = this._workspaceSuppressedTouches[identifier]
        delete this._workspaceSuppressedTouches[identifier]
        if (record && this._workspaceSuppressedTapTarget === record) this._workspaceSuppressedTapTarget = null
        if (record && record.expires >= now && record.key === key) {
          return true
        }
      }
      const fallback = this._workspaceSuppressedTapTarget
      if (fallback && fallback.expires < now) {
        this._workspaceSuppressedTapTarget = null
        Object.keys(this._workspaceSuppressedTouches || {}).forEach((touchId) => {
          if (this._workspaceSuppressedTouches[touchId] === fallback) delete this._workspaceSuppressedTouches[touchId]
        })
      }
      else if (fallback && fallback.key === key) {
        this._workspaceSuppressedTapTarget = null
        Object.keys(this._workspaceSuppressedTouches || {}).forEach((touchId) => {
          if (this._workspaceSuppressedTouches[touchId] === fallback) delete this._workspaceSuppressedTouches[touchId]
        })
        return true
      }
      return false
    },

    workspaceActionTouchKey(event) {
      const data = dataset(event)
      return [data.actionType || data.deleteType || 'action', text(data.projectId), text(data.id), text(data.revision)].join(':')
    },

    consumeWorkspaceActionTap(event) {
      const control = this.workspaceActionControl(event)
      const data = dataset(event)
      const targetPresent = this.workspaceActionTargetPresent(event)
      const projectMatch = Boolean(data.projectId && String(data.projectId) === String(this.projectId)
        && this.data.project && String(this.data.project.id) === String(data.projectId))
      const revisionMatch = Boolean(this._schedule && Number(data.revision) === Number(this._schedule.revision))
      this.traceWorkspaceInteraction('action-tap', {
        control, tapArrived: true, targetPresent, projectMatch, revisionMatch,
        busy: Boolean(this.data.loading || this.data.saving || this.data.projectCreating
          || this._workspaceDeletion || this._workspaceDeletionInFlight),
      })
      if (this.consumeWorkspaceSuppressedTouch(event, this.workspaceActionRowKey(event))) {
        this.traceWorkspaceInteraction('action-tap-result', { control, accepted: false, suppressed: true, reason: 'recent-drag' })
        return false
      }
      const touch = this._workspaceActionTouch
      if (!touch) {
        this.traceWorkspaceInteraction('action-tap-result', { control, accepted: true, suppressed: false, reason: 'no-action-touch' })
        return true
      }
      const identifier = touchIdentifier(firstTouch(event, 'changedTouches'))
      if (identifier && touch.identifier && identifier === touch.identifier && touch.moved) {
        this._workspaceActionTouch = null
        this.traceWorkspaceInteraction('action-tap-result', { control, accepted: false, suppressed: true, reason: 'action-touch-moved' })
        return false
      }
      const key = this.workspaceActionTouchKey(event)
      if (touch.key === key && (!touch.completed || !touch.moved)) {
        this._workspaceActionTouch = null
        this.traceWorkspaceInteraction('action-tap-result', { control, accepted: true, suppressed: false, reason: 'action-touch-match' })
        return true
      }
      if (identifier && touch.identifier && identifier === touch.identifier && touch.key !== key) {
        this._workspaceActionTouch = null
        this.traceWorkspaceInteraction('action-tap-result', { control, accepted: false, suppressed: true, reason: 'action-touch-target-mismatch' })
        return false
      }
      this.traceWorkspaceInteraction('action-tap-result', { control, accepted: true, suppressed: false, reason: 'action-touch-not-matched' })
      return true
    },

    onSwipeTouchStart(event) {
      this.clearWorkspaceSuppressedTouchForStart(event)
      if (isInlineRenameInputTarget(event)) { this._workspaceSwipeGesture = null; return }
      const point = firstTouch(event)
      const type = dataset(event).swipeType
      const id = text(dataset(event).swipeId)
      const busy = Boolean(this.data.saving || !this.data.project || datasetBoolean(dataset(event).retiring))
      this.traceWorkspaceInteraction('row-touch-start', {
        control: type === 'line' ? 'line' : 'device', touchPresent: Boolean(point),
        identifierPresent: Boolean(point && touchIdentifier(point) !== ''),
        identifierZero: Boolean(point && touchIdentifier(point) === '0'),
        targetPresent: Boolean(id), busy,
      })
      if (busy) return
      if (!['device', 'line'].includes(type) || !id || !point) return
      const key = `${type}:${id}`
      if (this._workspaceOpenSwipe && this._workspaceOpenSwipe.key !== key) this.closeWorkspaceSwipeRow()
      const openOffset = this._workspaceOpenSwipe && this._workspaceOpenSwipe.key === key
        ? this._workspaceOpenSwipe.offset : 0
      this._workspaceSwipeGesture = {
        key, type, id,
        groupIndex: Number(dataset(event).groupIndex),
        startX: Number(point.clientX), startY: Number(point.clientY),
        lastX: Number(point.clientX), lastY: Number(point.clientY),
        startOffset: openOffset, lastOffset: openOffset, axis: '',
        touchId: touchIdentifier(point),
      }
    },

    onSwipeTouchMove(event) {
      const gesture = this._workspaceSwipeGesture
      const point = event && event.touches && event.touches[0]
      if (!gesture || !point) return
      const x = Number(point.clientX)
      const y = Number(point.clientY)
      const deltaX = x - gesture.startX
      const deltaY = y - gesture.startY
      gesture.lastX = x
      gesture.lastY = y
      if (!gesture.axis) {
        if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) < SWIPE_START_THRESHOLD) return
        if (Math.abs(deltaX) >= Math.abs(deltaY) * 1.3) {
          gesture.axis = 'horizontal'
        } else if (Math.abs(deltaY) >= Math.abs(deltaX)) {
          gesture.axis = 'vertical'
          this.traceWorkspaceInteraction('row-touch-axis', { control: gesture.type, axis: 'vertical' })
          return
        } else return
        this.traceWorkspaceInteraction('row-touch-axis', { control: gesture.type, axis: gesture.axis })
      }
      if (gesture.axis !== 'horizontal') return
      const nextOffset = Math.max(0, Math.min(SWIPE_ACTION_WIDTH, gesture.startOffset - deltaX))
      gesture.lastOffset = nextOffset
      this.applyWorkspaceSwipeOffset(gesture, nextOffset, true)
    },

    applyWorkspaceSwipeOffset(gesture, offset, dragging) {
      const open = offset > 0
      const value = Math.max(0, Math.min(SWIPE_ACTION_WIDTH, offset))
      if (open) this._workspaceOpenSwipe = { key: gesture.key, type: gesture.type, id: gesture.id, offset: value }
      else this._workspaceOpenSwipe = null
      let path = ''
      if (gesture.type === 'device') {
        const index = this.data.devices.findIndex((item) => item && item.id === gesture.id && !item.retiring)
        if (index >= 0) path = `devices[${index}]`
      } else {
        const groupIndex = this.data.groups.findIndex((item) => item && Array.isArray(item.lines)
          && item.lines.some((line) => line && line.id === gesture.id && !line.retiring))
        const group = this.data.groups[groupIndex]
        const index = group && group.lines.findIndex((item) => item && item.id === gesture.id && !item.retiring)
        if (group && index >= 0) path = `groups[${groupIndex}].lines[${index}]`
      }
      if (!path) return
      this.setData({
        [`${path}.swipeOpen`]: open,
        [`${path}.swipeOffset`]: value,
        [`${path}.swipeDragging`]: Boolean(dragging),
      })
    },

    onSwipeTouchEnd(event) {
      const gesture = this._workspaceSwipeGesture
      if (!gesture) return
      if (gesture.axis === 'horizontal') {
        const offset = gesture.lastOffset >= SWIPE_ACTION_WIDTH / 2 ? SWIPE_ACTION_WIDTH : 0
        this.applyWorkspaceSwipeOffset(gesture, offset, false)
        this.rememberWorkspaceSuppressedTouch(event, gesture.key)
      } else if (gesture.axis === 'vertical') {
        this.applyWorkspaceSwipeOffset(gesture, 0, false)
        this.rememberWorkspaceSuppressedTouch(event, gesture.key)
      }
      this.traceWorkspaceInteraction('row-touch-end', {
        control: gesture.type, axis: gesture.axis || 'tap',
        touchPresent: Boolean(firstTouch(event, 'changedTouches') || firstTouch(event)),
        identifierPresent: Boolean(touchIdentifier(firstTouch(event, 'changedTouches')) || touchIdentifier(firstTouch(event))),
        identifierZero: (touchIdentifier(firstTouch(event, 'changedTouches')) || touchIdentifier(firstTouch(event))) === '0',
        suppressed: gesture.axis === 'horizontal' || gesture.axis === 'vertical',
      })
      this._workspaceSwipeGesture = null
    },

    onSwipeTouchCancel(event) {
      const gesture = this._workspaceSwipeGesture
      this.traceWorkspaceInteraction('row-touch-cancel', {
        control: gesture && gesture.type === 'line' ? 'line' : 'device',
        touchPresent: Boolean(firstTouch(event, 'changedTouches') || firstTouch(event)),
        suppressed: false, reason: 'cancelled',
      })
      this.cancelWorkspaceSwipeGesture()
      this.closeWorkspaceSwipeRow()
    },

    onSwipeScrollTouchStart(event) {
      this.cancelWorkspaceSwipeGesture()
      this.clearWorkspaceSuppressedTouchForStart(event)
      const point = firstTouch(event)
      this._workspaceScrollGesture = point ? { startX: Number(point.clientX), startY: Number(point.clientY), moved: false, tapKey: text(dataset(event).tapKey) } : null
    },

    onSwipeScrollTouchMove(event) {
      const gesture = this._workspaceScrollGesture
      const point = firstTouch(event)
      if (!gesture || !point) return
      const deltaX = Number(point.clientX) - gesture.startX
      const deltaY = Number(point.clientY) - gesture.startY
      if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) > 6) {
        gesture.moved = true
        if (Math.abs(deltaY) > Math.abs(deltaX)) this.closeWorkspaceSwipeRow()
      }
    },

    onSwipeScrollTouchEnd(event) {
      if (this._workspaceScrollGesture && this._workspaceScrollGesture.moved) this.rememberWorkspaceSuppressedTouch(event, this._workspaceScrollGesture.tapKey)
      this._workspaceScrollGesture = null
    },
    onSwipeScrollTouchCancel() { this._workspaceScrollGesture = null },

    onSwipeActionTouchStart(event) {
      this.cancelWorkspaceSwipeGesture()
      this.clearWorkspaceSuppressedTouchForStart(event)
      const point = firstTouch(event)
      this._workspaceActionTouch = point ? {
        key: this.workspaceActionTouchKey(event), identifier: touchIdentifier(point),
        startX: Number(point.clientX), startY: Number(point.clientY), moved: false, completed: false,
      } : null
    },

    onSwipeActionTouchMove(event) {
      const touch = this._workspaceActionTouch
      const point = firstTouch(event)
      if (!touch || !point) return
      if (Math.max(Math.abs(Number(point.clientX) - touch.startX), Math.abs(Number(point.clientY) - touch.startY)) > SWIPE_LOCK_THRESHOLD) touch.moved = true
    },

    onSwipeActionTouchEnd(event) {
      const touch = this._workspaceActionTouch
      if (!touch) return
      if (touch.moved) this.rememberWorkspaceSuppressedTouch(event, touch.key)
      touch.completed = true
    },

    onSwipeActionTouchCancel() { this._workspaceActionTouch = null },

    onWorkspaceBackgroundTap(event) {
      if (this._inlineRename && !isInlineRenameInputTarget(event)) {
        this.queueInlineRenameAction({ kind: 'background', data: {} })
        return
      }
      if (this._workspaceOpenSwipe) {
        this.traceWorkspaceInteraction('swipe-row-close', { control: this._workspaceOpenSwipe.type, reason: 'background-tap' })
      }
      this.closeWorkspaceSwipeRow()
    },
    onWorkspaceListScroll() {
      if (this._workspaceOpenSwipe) {
        this.traceWorkspaceInteraction('swipe-row-close', { control: this._workspaceOpenSwipe.type, reason: 'list-scroll' })
      }
      this.closeWorkspaceSwipeRow()
    },
    onWorkspaceRowTap(event) {
      if (isInlineRenameInputTarget(event)) return
      if (this._inlineRename) {
        this.queueInlineRenameAction({ kind: 'row', data: { tapKey: text(dataset(event).tapKey) } })
        return
      }
      const key = `device:${text(dataset(event).tapKey).replace(/^device:/, '')}`
      if (this.consumeWorkspaceSuppressedTouch(event, key)) return
      this.closeWorkspaceSwipeRow()
    },

    onWorkspaceRootTap(event) {
      if (isInlineRenameInputTarget(event)) return
      if (this._inlineRename) {
        this.queueInlineRenameAction({ kind: 'background', data: {} })
        return
      }
      this.onWorkspaceBackgroundTap(event)
    },

    closeWorkspaceSwipeRow() {
      this.cancelWorkspaceSwipeGesture()
      const openSwipe = this._workspaceOpenSwipe
      if (!openSwipe) return
      const gesture = {
        key: openSwipe.key, type: openSwipe.type, id: openSwipe.id,
        groupIndex: this.data.groups.findIndex((group) => group.lines.some((line) => line.id === openSwipe.id)),
      }
      this._workspaceOpenSwipe = null
      const index = this.data.devices.findIndex((item) => item.id === openSwipe.id && !item.retiring)
      if (openSwipe.type === 'device' && index >= 0) {
        this.setData({ [`devices[${index}].swipeOpen`]: false, [`devices[${index}].swipeOffset`]: 0, [`devices[${index}].swipeDragging`]: false })
        return
      }
      if (openSwipe.type === 'line' && gesture.groupIndex >= 0) {
        const lineIndex = this.data.groups[gesture.groupIndex].lines.findIndex((line) => line.id === openSwipe.id && !line.retiring)
        if (lineIndex >= 0) this.setData({
          [`groups[${gesture.groupIndex}].lines[${lineIndex}].swipeOpen`]: false,
          [`groups[${gesture.groupIndex}].lines[${lineIndex}].swipeOffset`]: 0,
          [`groups[${gesture.groupIndex}].lines[${lineIndex}].swipeDragging`]: false,
        })
      }
    },

    cancelWorkspaceSwipeGesture() {
      this._workspaceSwipeGesture = null
    },

  }
}

module.exports = { createWorkspaceInteractionMethods }
