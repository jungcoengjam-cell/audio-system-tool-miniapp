const WORKSPACE_OVERLAY_OPEN_MS = 300
const WORKSPACE_OVERLAY_CLOSE_MS = 240

function advanceWorkspaceOverlayToOpening(page, name, epoch, runtime) {
  const advance = () => {
    if (page._destroyed || page._workspaceOverlayEpochs[name] !== epoch
      || !page.data.workspaceOverlayPhases || page.data.workspaceOverlayPhases[name] !== 'preparing') return
    page.setData({ [`workspaceOverlayPhases.${name}`]: 'opening' }, () => {
      if (page._destroyed || page._workspaceOverlayEpochs[name] !== epoch
        || !page.data.workspaceOverlayPhases || page.data.workspaceOverlayPhases[name] !== 'opening') return
      page.scheduleWorkspaceOverlayPhase(name, 'opening', epoch)
    })
  }
  if (typeof runtime.wx !== 'undefined' && typeof runtime.wx.nextTick === 'function') runtime.wx.nextTick(advance)
  else runtime.setTimeout(advance, 0)
}

function createWorkspaceOverlayMethods(base, runtime) {
  const { wx, setTimeout, clearTimeout } = runtime
  return {
    prepareWorkspaceOverlayPhase(name) {
      if (this._workspaceOverlayTimers[name]) clearTimeout(this._workspaceOverlayTimers[name])
      this._workspaceOverlayTimers[name] = null
      const epoch = (this._workspaceOverlayEpochs[name] || 0) + 1
      this._workspaceOverlayEpochs[name] = epoch
      return epoch
    },

    scheduleWorkspaceOverlayPhase(name, phase, epoch, onFinished) {
      const duration = phase === 'closing' ? WORKSPACE_OVERLAY_CLOSE_MS : WORKSPACE_OVERLAY_OPEN_MS
      this._workspaceOverlayTimers[name] = setTimeout(() => {
        if (this._destroyed || this._workspaceOverlayEpochs[name] !== epoch) return
        this._workspaceOverlayTimers[name] = null
        if (this.data.workspaceOverlayPhases && this.data.workspaceOverlayPhases[name] === phase) {
          this.setData({ [`workspaceOverlayPhases.${name}`]: '' }, () => {
            if (typeof onFinished === 'function' && !this._destroyed && this._workspaceOverlayEpochs[name] === epoch) onFinished()
          })
        }
      }, duration)
    },

    beginWorkspaceOverlay(name, changes = {}) {
      if (!name || this._destroyed) return
      this.closeWorkspaceSwipeRow()
      this.clearWorkspaceRetiringRow()
      const currentPhase = this.data.workspaceOverlayPhases && this.data.workspaceOverlayPhases[name]
      const alreadyMounted = currentPhase === 'closing' || currentPhase === 'opening' || currentPhase === 'preparing' || this.workspaceOverlayIsVisible(name)
      const epoch = this.prepareWorkspaceOverlayPhase(name)
      const phase = alreadyMounted ? 'opening' : 'preparing'
      this.setData({ ...changes, [`workspaceOverlayPhases.${name}`]: phase }, () => {
        if (this._destroyed || this._workspaceOverlayEpochs[name] !== epoch
          || !this.data.workspaceOverlayPhases || this.data.workspaceOverlayPhases[name] !== phase) return
        if (phase === 'preparing') advanceWorkspaceOverlayToOpening(this, name, epoch, { wx, setTimeout })
        else this.scheduleWorkspaceOverlayPhase(name, 'opening', epoch)
      })
    },

    endWorkspaceOverlay(name, onFinished, changes = {}) {
      return this.endWorkspaceOverlays([name], changes, onFinished)
    },

    endWorkspaceOverlays(names, changes = {}, onFinished) {
      if (this._destroyed) return
      const activeNames = [...new Set((names || []).filter((name) => name && this.data.workspaceOverlayPhases
        && (this.data.workspaceOverlayPhases[name] || this.workspaceOverlayIsVisible(name))))]
      if (!activeNames.length) {
        if (Object.keys(changes).length) this.setData(changes)
        if (typeof onFinished === 'function') onFinished()
        return
      }
      const phases = { ...changes }
      const epochs = Object.create(null)
      activeNames.forEach((name) => {
        epochs[name] = this.prepareWorkspaceOverlayPhase(name)
        phases[`workspaceOverlayPhases.${name}`] = 'closing'
      })
      this.setData(phases, () => this.scheduleWorkspaceOverlayClosures(activeNames, epochs, onFinished))
    },

    scheduleWorkspaceOverlayClosures(names, epochs, onFinished) {
      if (this._destroyed || !names.length) return
      const activeNames = names.filter((name) => this._workspaceOverlayEpochs[name] === epochs[name]
        && this.data.workspaceOverlayPhases && this.data.workspaceOverlayPhases[name] === 'closing')
      if (!activeNames.length) return
      let remaining = names.length
      const finished = () => {
        remaining -= 1
        if (remaining === 0 && typeof onFinished === 'function' && !this._destroyed
          && names.every((name) => this._workspaceOverlayEpochs[name] === epochs[name])) onFinished()
      }
      activeNames.forEach((name) => this.scheduleWorkspaceOverlayPhase(name, 'closing', epochs[name], finished))
    },

    workspaceOverlayIsVisible(name) {
      const fields = {
        projectPicker: 'projectPickerVisible', newProject: 'newProjectVisible',
        deviceEditor: 'deviceEditorVisible', lineDetails: 'detailVisible',
        lineEditor: 'editorVisible', continuous: 'continuousVisible', report: 'reportPreviewVisible',
      }
      return Boolean(this.data && this.data[fields[name]])
    },

    workspaceOnlyOverlayClosing(name) {
      const phases = this.data && this.data.workspaceOverlayPhases || {}
      return phases[name] === 'closing' && Object.keys(phases).every((other) => other === name
        || (!phases[other] && !this.workspaceOverlayIsVisible(other)))
    },

    nextWorkspaceTransitionRevision() {
      this._workspaceTransitionRevision = (this._workspaceTransitionRevision || 0) + 1
      return this._workspaceTransitionRevision
    },

    cleanupWorkspaceOverlayContents(names = []) {
      if (this._destroyed || !this.data.workspaceOverlayPhases) return
      const closing = new Set(names)
      const changes = {}
      const settled = (name) => closing.has(name) && !this.workspaceOverlayIsVisible(name)
        && !this.data.workspaceOverlayPhases[name]
      if (settled('projectPicker')) changes.projectPickerLoading = false
      if (settled('newProject')) {
        changes.projectPickerName = ''
        changes.projectPickerError = ''
      }
      if (settled('lineDetails')) changes.detailLine = null
      if (settled('continuous')) {
        changes.continuousPairs = []
        changes.continuousError = ''
      }
      if (settled('lineEditor') && !this.data.continuousVisible) {
        changes.draft = null
        changes.draftPairs = []
        changes.pairErrors = []
        changes.formError = ''
        changes.formFieldErrors = {}
        changes.saveError = ''
        this._draftTouched = false
        this._draftBaseline = ''
      }
      if (settled('deviceEditor')) {
        changes.deviceFormError = ''
        changes.batchError = ''
      }
      if (Object.keys(changes).length) this.setData(changes)
      if (settled('lineEditor') || settled('deviceEditor')) {
        if (!this.data.editorVisible && !this.data.deviceEditorVisible && !this.data.continuousVisible) {
          if (typeof base.resetFormKeyboardAvoidance === 'function') base.resetFormKeyboardAvoidance.call(this)
          this.clearUnloadWarning()
        }
      }
      if (settled('report')) this.finishWorkspaceReportClear()
    },

    transitionWorkspaceOverlays(closeNames, openName, changes = {}, onClosed) {
      if (this._destroyed) return
      const closes = [...new Set((closeNames || []).filter((name) => name && this.data.workspaceOverlayPhases
        && (this.data.workspaceOverlayPhases[name] || this.workspaceOverlayIsVisible(name))))]
      const openPhase = this.data.workspaceOverlayPhases && this.data.workspaceOverlayPhases[openName]
      const openWasMounted = openPhase === 'closing' || openPhase === 'opening' || openPhase === 'preparing' || this.workspaceOverlayIsVisible(openName)
      const epochs = Object.create(null)
      const phases = { ...changes }
      closes.forEach((name) => {
        epochs[name] = this.prepareWorkspaceOverlayPhase(name)
        phases[`workspaceOverlayPhases.${name}`] = 'closing'
      })
      if (openName) {
        epochs[openName] = this.prepareWorkspaceOverlayPhase(openName)
        phases[`workspaceOverlayPhases.${openName}`] = openWasMounted ? 'opening' : 'preparing'
      }
      this.setData(phases, () => {
        if (this._destroyed) return
        if (closes.length) this.scheduleWorkspaceOverlayClosures(closes, epochs, onClosed)
        if (!openName || this._workspaceOverlayEpochs[openName] !== epochs[openName]
          || !this.data.workspaceOverlayPhases) return
        const phase = openWasMounted ? 'opening' : 'preparing'
        if (this.data.workspaceOverlayPhases[openName] !== phase) return
        if (phase === 'preparing') advanceWorkspaceOverlayToOpening(this, openName, epochs[openName], { wx, setTimeout })
        else this.scheduleWorkspaceOverlayPhase(openName, 'opening', epochs[openName])
      })
      if (!closes.length && typeof onClosed === 'function') onClosed()
    },

    cancelWorkspaceOverlayTimers(clearPhases = false) {
      Object.keys(this._workspaceOverlayTimers || {}).forEach((name) => {
        if (this._workspaceOverlayTimers[name]) clearTimeout(this._workspaceOverlayTimers[name])
        this._workspaceOverlayTimers[name] = null
        this._workspaceOverlayEpochs[name] = (this._workspaceOverlayEpochs[name] || 0) + 1
      })
      if (clearPhases && !this._destroyed && this.data && this.data.workspaceOverlayPhases) {
        const phases = {}
        Object.keys(this.data.workspaceOverlayPhases).forEach((name) => { phases[`workspaceOverlayPhases.${name}`] = '' })
        if (this.data.workspaceOverlayPhases.lineDetails === 'closing' && !this.data.detailVisible) phases.detailLine = null
        if (this.data.workspaceOverlayPhases.lineEditor === 'closing' && !this.data.editorVisible) {
          phases.draft = null
          phases.draftPairs = []
          phases.pairErrors = []
        }
        if (this.data.workspaceOverlayPhases.continuous === 'closing' && !this.data.continuousVisible) {
          phases.continuousPairs = []
          phases.continuousError = ''
        }
        if (this.data.workspaceOverlayPhases.newProject === 'closing' && !this.data.newProjectVisible) {
          phases.projectPickerName = ''
          phases.projectPickerError = ''
        }
        this.setData(phases)
      }
    },

  }
}

module.exports = { createWorkspaceOverlayMethods }
