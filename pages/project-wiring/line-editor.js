const { BUILD_OPTIONS, CABLE_OPTIONS, CONNECTOR_OPTIONS, STATUS_OPTIONS } = require('../../utils/project-wiring')
const { buildWorkspace, circleLabel, generatePortPairs } = require('./workspace-model')
const { vibrate } = require('../../utils/haptics')

const CABLE_SPEC_OPTIONS = {
  balanced: [],
  unbalanced: [],
  speaker: ['RVV 2×1.5 mm²', 'RVV 2×2.5 mm²'],
}
const DEFAULT_AUDIO_SPEC = 'RVPE 2×0.5 mm²'
const DRAFT_FIELDS = new Set([
  'purpose', 'fromDevice', 'fromPort', 'toDevice', 'toPort', 'buildType', 'cableType',
  'spec', 'connectorA', 'connectorB', 'lengthText', 'status', 'notes',
])
const REQUIRED_ROUTE_FIELDS = [
  { field: 'fromDevice', label: '来源设备', target: 'wiring-field-from-device' },
  { field: 'fromPort', label: '来源端口', target: 'wiring-field-from-port' },
  { field: 'toDevice', label: '去向设备', target: 'wiring-field-to-device' },
  { field: 'toPort', label: '去向端口', target: 'wiring-field-to-port' },
]
const ROUTE_ENDPOINT_FIELDS = ['fromDevice', 'fromPort', 'toDevice', 'toPort']

function optionIndex(options, id, fallback = 0) {
  const found = options.findIndex((option) => option.id === id)
  return found >= 0 ? found : Math.min(fallback, Math.max(options.length - 1, 0))
}

function getCableSpecOptions(cableType) {
  return CABLE_SPEC_OPTIONS[cableType] || []
}

function getDefaultSpec(cableType) {
  return ['balanced', 'unbalanced'].includes(cableType) ? DEFAULT_AUDIO_SPEC : ''
}

function getCableSpecOptionViews(cableType) {
  return getCableSpecOptions(cableType).map((value) => {
    const match = String(value).match(/^(\S+)\s+(.+)$/)
    return {
      value,
      model: match ? match[1] : value,
      size: match ? match[2] : '',
    }
  })
}

function findOptionId(options, pattern, fallback) {
  const option = options.find((item) => pattern.test(item.label))
  return option ? option.id : fallback
}

function connectorPickerIndex(value) {
  const exact = CONNECTOR_PICKER_OPTIONS.findIndex((option) => option.id === value)
  return exact >= 0 ? exact : CUSTOM_CONNECTOR_INDEX
}

function uniqueValues(lines, fields, limit = 8) {
  const values = []
  const seen = new Set()
  lines.forEach((line) => fields.forEach((field) => {
    const value = String(line[field] || '').trim()
    if (value && !seen.has(value)) {
      seen.add(value)
      values.push(value)
    }
  }))
  return values.slice(0, limit)
}

function formatCode(value) {
  return `A${String(Math.max(1, Number(value) || 1)).padStart(3, '0')}`
}

function getNextPreviewCode(schedule) {
  const used = new Set(schedule.lines.map((line) => String(line.code || '').toLocaleLowerCase()))
  let number = schedule.nextNumber
  let code = formatCode(number)
  while (used.has(code.toLocaleLowerCase())) {
    number += 1
    code = formatCode(number)
  }
  return code
}

function safeToast(title) {
  if (typeof wx !== 'undefined' && typeof wx.showToast === 'function') wx.showToast({ title, icon: 'none' })
}

const CONNECTOR_PICKER_OPTIONS = [{ id: '', label: '待确认' }, ...CONNECTOR_OPTIONS]
const CUSTOM_CONNECTOR_INDEX = CONNECTOR_PICKER_OPTIONS.findIndex((option) => option.id === 'custom')
const endpointFields = ['fromDevice', 'fromPort', 'toDevice', 'toPort']
const text = (value) => String(value === undefined || value === null ? '' : value)
const dataset = (event) => event && event.currentTarget && event.currentTarget.dataset || {}
const inputValue = (event) => text(event && event.detail && event.detail.value)
const endpointPlaceholder = () => ({ id: '', name: '请选择设备', choiceLabel: '请选择设备' })
function endpointChoices(side, draft, devices) {
  const sourceId = side === 'to' && draft && draft.fromDeviceId ? String(draft.fromDeviceId) : ''
  const choices = (devices || []).filter((device) => !sourceId || device.id !== sourceId)
  return [endpointPlaceholder(), ...choices]
}
function resolveEndpointChoiceIndex(choices, side, draft) {
  if (!draft) return 0
  const id = draft[`${side}DeviceId`]
  const index = (choices || []).findIndex((device) => id
    ? device.id === id
    : Boolean(device.legacy && device.name === draft[`${side}Device`]))
  return Math.max(0, index)
}
const notify = (title) => { if (typeof wx !== 'undefined' && typeof wx.showToast === 'function') wx.showToast({ title, icon: 'none' }) }

function createLineEditor(base, { applyScheduleChange, saveProjectWiring }) {
  // Core methods preserve the original base behavior; actions below are the
  // effective Page methods and call core methods explicitly where required.
  const core = {
    makeDefaultDraft() {
      return {
        purpose: '',
        fromDevice: '',
        fromPort: '',
        toDevice: '',
        toPort: '',
        buildType: 'finished',
        cableType: 'balanced',
        spec: DEFAULT_AUDIO_SPEC,
        connectorA: findOptionId(CONNECTOR_OPTIONS, /XLR\s*母/, 'xlrFemale'),
        connectorB: findOptionId(CONNECTOR_OPTIONS, /XLR\s*公/, 'xlrMale'),
        lengthText: '',
        status: 'pending',
        notes: '',
      }
    },

    getHistoryData(draft) {
      const lines = this._schedule.lines
      return {
        fromDeviceHistory: uniqueValues(lines, ['fromDevice', 'toDevice']),
        fromPortHistory: uniqueValues(draft.fromDevice
          ? lines.filter((line) => line.fromDevice === draft.fromDevice || line.toDevice === draft.fromDevice)
          : lines, ['fromPort', 'toPort']),
        toDeviceHistory: uniqueValues(lines, ['toDevice', 'fromDevice']),
        toPortHistory: uniqueValues(draft.toDevice
          ? lines.filter((line) => line.toDevice === draft.toDevice || line.fromDevice === draft.toDevice)
          : lines, ['toPort', 'fromPort']),
      }
    },

    setDraft(draft, { isNew = false, isCopy = false, touched = false } = {}) {
      this.beginFormKeyboardAvoidance('editor')
      const normalizedDraft = { ...this.makeDefaultDraft(), ...draft }
      const existingLine = !isNew && normalizedDraft.id
        ? this._schedule.lines.find((line) => line.id === normalizedDraft.id)
        : null
      this._draftBaseline = existingLine ? JSON.stringify(existingLine) : ''
      this._draftTouched = touched
      this._draftIsCopy = isCopy
      this._draftDefaultSpec = isNew && !isCopy
      const knownConnectorIds = new Set(CONNECTOR_OPTIONS.filter((option) => option.id !== 'custom').map((option) => option.id))
      const customConnectorA = normalizedDraft.connectorA && normalizedDraft.connectorA !== 'custom' && !knownConnectorIds.has(normalizedDraft.connectorA)
        ? normalizedDraft.connectorA : ''
      const customConnectorB = normalizedDraft.connectorB && normalizedDraft.connectorB !== 'custom' && !knownConnectorIds.has(normalizedDraft.connectorB)
        ? normalizedDraft.connectorB : ''
      this._customConnectors = { connectorA: customConnectorA, connectorB: customConnectorB }
      this._connectorTouched = { connectorA: false, connectorB: false }
      this._optionIndexes = {
        buildType: optionIndex(BUILD_OPTIONS, normalizedDraft.buildType),
        cableType: optionIndex(CABLE_OPTIONS, normalizedDraft.cableType),
        connectorA: connectorPickerIndex(normalizedDraft.connectorA),
        connectorB: connectorPickerIndex(normalizedDraft.connectorB),
        status: optionIndex(STATUS_OPTIONS, normalizedDraft.status),
      }
      this.setData({
        editorVisible: true,
        draftIsNew: isNew,
        draftCode: normalizedDraft.code || getNextPreviewCode(this._schedule),
        draft: normalizedDraft,
        specOptions: getCableSpecOptions(normalizedDraft.cableType),
        specOptionViews: getCableSpecOptionViews(normalizedDraft.cableType),
        formScrollTarget: '',
        formScrollTop: 0,
        buildIndex: this._optionIndexes.buildType,
        cableIndex: this._optionIndexes.cableType,
        connectorAIndex: this._optionIndexes.connectorA,
        connectorBIndex: this._optionIndexes.connectorB,
        customConnectorA,
        customConnectorB,
        statusIndex: this._optionIndexes.status,
        formError: '',
        formFieldErrors: {},
        saveError: '',
        saving: false,
        ...this.getHistoryData(normalizedDraft),
      })
    },

    openNewLine() {
      if (!this.data.project || this.data.loading) return
      this.invalidateExport(false)
      this._draftIsCopy = false
      this.setDraft(this.makeDefaultDraft(), { isNew: true })
    },

    editLine(event) {
      const id = event.currentTarget.dataset.id
      const line = this._schedule.lines.find((item) => item.id === id)
      if (!line) return
      this.invalidateExport(false)
      this.setDraft({ ...line }, { isNew: false })
    },

    onDraftInput(event) {
      const field = event.currentTarget.dataset.field
      if (!DRAFT_FIELDS.has(field) || !this.data.draft) return
      const value = event.detail.value === undefined ? '' : String(event.detail.value)
      if (field === 'spec') this._draftDefaultSpec = false
      this._draftTouched = true
      const draft = { ...this.data.draft, [field]: value }
      const formFieldErrors = { ...this.data.formFieldErrors }
      delete formFieldErrors[field]
      this.setData({
        draft,
        ...(field === 'fromDevice' || field === 'fromPort' || field === 'toDevice' || field === 'toPort'
          ? this.getHistoryData(draft)
          : {}),
        formError: '',
        formFieldErrors,
        saveError: '',
        formScrollTarget: '',
      })
    },

    chooseSpecPreset(event) {
      const value = String(event.currentTarget.dataset.value || '')
      if (!this.data.draft || !this.data.specOptions.includes(value)) return
      this.onDraftInput({ currentTarget: { dataset: { field: 'spec' } }, detail: { value } })
    },

    chooseHistoryValue(event) {
      const field = event && event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.field
      const historyByField = {
        fromDevice: 'fromDeviceHistory',
        fromPort: 'fromPortHistory',
        toDevice: 'toDeviceHistory',
        toPort: 'toPortHistory',
      }
      if (!Object.prototype.hasOwnProperty.call(historyByField, field)) return
      const historyField = historyByField[field]
      if (!historyField || !this.data.draft || this.data.saving || !event.detail) return
      const rawIndex = event.detail.value
      if (typeof rawIndex !== 'number' && typeof rawIndex !== 'string') return
      if (rawIndex === null || rawIndex === undefined || (typeof rawIndex === 'string' && rawIndex.trim() === '')) return
      const index = Number(rawIndex)
      const history = this.data[historyField]
      if (!Array.isArray(history) || !Number.isInteger(index) || index < 0 || index >= history.length) return
      const value = history[index]
      this._draftTouched = true
      const draft = { ...this.data.draft, [field]: value }
      const formFieldErrors = { ...this.data.formFieldErrors }
      delete formFieldErrors[field]
      this.setData({ draft, ...this.getHistoryData(draft), formError: '', formFieldErrors, saveError: '' })
    },

    onOptionChange(event) {
      const field = event.currentTarget.dataset.field
      const optionsByField = {
        buildType: BUILD_OPTIONS,
        cableType: CABLE_OPTIONS,
        connectorA: CONNECTOR_PICKER_OPTIONS,
        connectorB: CONNECTOR_PICKER_OPTIONS,
        status: STATUS_OPTIONS,
      }
      const options = optionsByField[field]
      const index = Number(event.detail.value)
      if (!options || !Number.isInteger(index) || !options[index]) return
      this._draftTouched = true
      let draft = { ...this.data.draft, [field]: options[index].id }
      const changes = {}
      if (field === 'cableType') {
        changes.specOptions = getCableSpecOptions(draft.cableType)
        changes.specOptionViews = getCableSpecOptionViews(draft.cableType)
        if (this._draftDefaultSpec) draft.spec = getDefaultSpec(draft.cableType)
      }
      if (field === 'cableType' && this.data.draftIsNew && options[index].id !== 'balanced') {
        ;['connectorA', 'connectorB'].forEach((connectorField) => {
          if (!this._connectorTouched[connectorField] && ['xlrFemale', 'xlrMale'].includes(draft[connectorField])) {
            draft[connectorField] = ''
            this._optionIndexes[connectorField] = optionIndex(CONNECTOR_PICKER_OPTIONS, '')
            changes[connectorField === 'connectorA' ? 'connectorAIndex' : 'connectorBIndex'] = this._optionIndexes[connectorField]
            changes[connectorField === 'connectorA' ? 'customConnectorA' : 'customConnectorB'] = ''
          }
        })
      }
      if (field === 'connectorA' || field === 'connectorB') {
        this._connectorTouched[field] = true
        if (options[index].id === 'custom') draft[field] = this._customConnectors[field] || ''
        else {
          draft[field] = options[index].id
          this._customConnectors[field] = ''
          changes[field === 'connectorA' ? 'customConnectorA' : 'customConnectorB'] = ''
        }
      }
      this._optionIndexes[field] = index
      const indexField = {
        buildType: 'buildIndex', cableType: 'cableIndex', connectorA: 'connectorAIndex',
        connectorB: 'connectorBIndex', status: 'statusIndex',
      }[field]
      this.setData({ draft, [indexField]: index, ...changes, formError: '', saveError: '' })
    },

    onCustomConnectorInput(event) {
      const field = event.currentTarget.dataset.field
      if (!['connectorA', 'connectorB'].includes(field)) return
      const value = String(event.detail.value || '')
      this._connectorTouched[field] = true
      this._customConnectors[field] = value
      this._draftTouched = true
      this.setData({
        draft: { ...this.data.draft, [field]: value },
        [field === 'connectorA' ? 'customConnectorA' : 'customConnectorB']: value,
      })
    },

    hasUnsavedDraft() {
      if (!this._draftTouched) return false
      if (this.data.draftIsNew || !this._draftBaseline) return true
      const baseline = JSON.parse(this._draftBaseline)
      return [...DRAFT_FIELDS].some((field) => this.data.draft[field] !== baseline[field])
    },

    requestCloseEditor() {
      if (this.data.saving) return
      if (!this.hasUnsavedDraft()) {
        this.closeEditor()
        return
      }
      wx.showModal({
        title: '放弃未保存修改？',
        content: '关闭后，本次填写的线路内容不会保存。',
        confirmText: '放弃修改',
        confirmColor: '#d70015',
        success: ({ confirm }) => {
          if (confirm && !this._destroyed) this.closeEditor()
        },
      })
    },

    closeEditor() {
      this.resetFormKeyboardAvoidance()
      this._draftTouched = false
      this._draftBaseline = ''
      this.setData({ editorVisible: false, draft: null, formError: '', formFieldErrors: {}, saveError: '', saving: false })
    },

    showMissingRouteFields(missingFields) {
      const formFieldErrors = {}
      missingFields.forEach(({ field, label }) => { formFieldErrors[field] = `请填写${label}` })
      const firstMissing = missingFields[0]
      if (!firstMissing) return
      this.setData({
        formError: `还缺少：${missingFields.map(({ label }) => label).join('、')}。`,
        formFieldErrors,
        formScrollTarget: '',
      }, () => {
        if (this._destroyed || this._hidden || !this.data.editorVisible) return
        this.setData({ formScrollTop: 0, formScrollTarget: firstMissing.target })
      })
    },

    saveLine() {
      const draft = this.data.draft
      if (!draft || this.data.saving) return
      const missingFields = REQUIRED_ROUTE_FIELDS.filter(({ field }) => !String(draft[field] || '').trim())
      if (missingFields.length) {
        this.showMissingRouteFields(missingFields)
        return
      }
      const line = { ...draft }
      if (this.data.draftIsNew) {
        delete line.id
        delete line.code
      }
      this.saveCommand({ type: 'upsert', line }, (result) => {
        const savedLine = result.schedule.lines.find((item) => item.id === (line.id || result.lineIds?.[0]))
        this.closeEditor()
        this.acceptSavedSchedule(result)
        if (savedLine) {
          const label = require('./workspace-model').circleLabel(savedLine, result.schedule)
          wx.showToast({ title: `${label} 已保存`, icon: 'success' })
        }
      })
    },

    deleteLine() {
      if (this.data.draftIsNew || !this.data.draft || this.data.saving) return
      const code = require('./workspace-model').circleLabel(this.data.draft, this._schedule)
      wx.showModal({
        title: '删除线路？',
        content: `将从本项目布线表中删除 ${code}。`,
        confirmText: '删除',
        confirmColor: '#d70015',
        success: ({ confirm }) => {
          if (!confirm || this._destroyed) return
          this.saveCommand({ type: 'delete', id: this.data.draft.id }, (result) => {
            this.closeEditor()
            this.acceptSavedSchedule(result)
            wx.showToast({ title: '线路已删除', icon: 'success' })
          })
        },
      })
    },

    duplicateLine() {
      if (this.data.draftIsNew || !this.data.draft || this.data.saving) return
      const duplicate = { ...this.data.draft, id: '', code: '', status: 'pending' }
      this._draftIsCopy = true
      this.setDraft(duplicate, { isNew: true, isCopy: true, touched: true })
      safeToast('复制内容已打开为新线路，原线路未修改；请确认两端端口后保存')
    },

    saveScheduleCommand(command, onSuccess) {
      if (!this.projectId || !this.data.project || this.data.saving) return false
      this.invalidateExport(true)
      this.setData({ saving: true, saveError: '', formError: '', batchError: '' })
      let result
      try {
        result = saveProjectWiring(this.projectId, command, this._schedule.revision)
      } catch (error) {
        result = { ok: false, error: error && error.message ? error.message : '保存失败，请重试。' }
      }
      const handleResult = (response) => {
        if (this._destroyed) return
        if (!response || response.ok !== true || !response.schedule) {
          const error = response && response.error ? String(response.error) : '保存失败，请重试。'
          this.setData({
            saving: false,
            saveError: this.data.editorVisible ? error : '',
            batchError: this.data.batchVisible ? error : '',
          })
          if (!this.data.editorVisible && !this.data.batchVisible) safeToast(error)
          return
        }
        onSuccess(response)
      }
      if (result && typeof result.then === 'function') result.then(handleResult).catch((error) => handleResult({
        ok: false,
        error: error && error.message ? error.message : '保存失败，请重试。',
      }))
      else handleResult(result)
      return true
    },
  }
  return {
    getHistoryData: core.getHistoryData,
    editLine: core.editLine,
    chooseSpecPreset: core.chooseSpecPreset,
    chooseHistoryValue: core.chooseHistoryValue,
    showMissingRouteFields: core.showMissingRouteFields,
    duplicateLine: core.duplicateLine,

    editDetailLine() {
      const id = this.data.detailLine && this.data.detailLine.id
      if (!id || !this.data.project || !this._schedule) return
      const intent = this.nextWorkspaceTransitionRevision()
      const context = { projectId: String(this.projectId || ''), revision: this._schedule.revision, loadRevision: this._projectLoadRevision }
      this.closeLineDetails(() => {
        if (this._destroyed || intent !== this._workspaceTransitionRevision
          || String(this.projectId || '') !== context.projectId
          || !this.data.project || String(this.data.project.id) !== context.projectId
          || !this._schedule || this._schedule.revision !== context.revision
          || this._projectLoadRevision !== context.loadRevision
          || this.data.editorVisible || this.data.deviceEditorVisible || this.data.projectPickerVisible
          || this.data.newProjectVisible || this.data.reportPreviewVisible) return
        this.editLine({ currentTarget: { dataset: { id } } })
      })
    },

    openNewLine(event) {
      if (this._inlineRename) {
        this.queueInlineRenameAction({ kind: 'add-line', data: dataset(event) })
        return
      }
      return core.openNewLine.call(this)
    },

    connectDevice(event) {
      if (!this.consumeWorkspaceActionTap(event)) return
      const target = dataset(event)
      if (this._inlineRename) {
        if (!this.queueInlineRenameAction({ kind: 'connect', data: { ...target } })) notify('项目已更新，请重新操作')
        return
      }
      const targetCurrent = this.isWorkspaceDeletionTargetCurrent(target.projectId, target.revision)
      const busy = Boolean(this.data.loading || this.data.saving || this.data.projectCreating)
      const targetPresent = this.workspaceActionTargetPresent(event)
      this.traceWorkspaceInteraction('connect-guard', {
        control: 'connect', targetPresent,
        projectMatch: Boolean(target.projectId && String(target.projectId) === String(this.projectId)
          && this.data.project && String(this.data.project.id) === String(target.projectId)),
        revisionMatch: Boolean(this._schedule && Number(target.revision) === Number(this._schedule.revision)),
        busy, accepted: targetCurrent && !busy && targetPresent,
        reason: !targetCurrent ? 'stale-target' : busy ? 'busy' : !targetPresent ? 'target-missing' : 'ready',
      })
      if (!targetCurrent) {
        notify('项目已更新，请重新操作')
        return
      }
      if (busy) {
        notify('项目正在处理中，请稍后重试')
        return
      }
      this.closeWorkspaceSwipeRow()
      const candidates = (this._workspace || buildWorkspace(this._schedule)).devices.filter((item) => item.id === text(target.id))
      const deviceKey = text(target.deviceKey)
      const device = deviceKey ? candidates.find((item) => item.key === deviceKey) : candidates.length === 1 ? candidates[0] : null
      if (!device) {
        notify('项目已更新，请重新操作')
        return
      }
      this.openNewLine()
      this.assignEndpoint('from', device)
      this.traceWorkspaceInteraction('connect-open', {
        control: 'connect', accepted: Boolean(this.data.editorVisible || this.data.continuousVisible),
        reason: this.data.editorVisible || this.data.continuousVisible ? 'editor-opened' : 'editor-not-open', targetPresent: true,
      })
    },

    makeDefaultDraft() {
      return { ...core.makeDefaultDraft.call(this), spec: '', connectorA: '', connectorB: '' }
    },

    makePair(pair = {}) {
      this._draftPairSerial = (this._draftPairSerial || 0) + 1
      return { key: `pair-${this._draftPairSerial}`, fromPort: text(pair.fromPort), toPort: text(pair.toPort), lengthText: text(pair.lengthText) }
    },

    endpointChoiceIndex(side, draft) {
      const choices = endpointChoices(side, draft, this._workspace && this._workspace.devices || this.data.devices)
      return resolveEndpointChoiceIndex(choices, side, draft)
    },

    refreshEndpointChoices(draft = this.data.draft) {
      const devices = this._workspace && this._workspace.devices || this.data.devices
      const fromChoices = endpointChoices('from', draft, devices)
      const toChoices = endpointChoices('to', draft, devices)
      this.setData({ deviceChoices: fromChoices, fromDeviceChoices: fromChoices, toDeviceChoices: toChoices,
        fromDeviceIndex: resolveEndpointChoiceIndex(fromChoices, 'from', draft),
        toDeviceIndex: resolveEndpointChoiceIndex(toChoices, 'to', draft) })
    },

    setDraft(draft, options = {}) {
      this.invalidateWorkspaceEditorDelete()
      this._workspaceEditorSessionId = (this._workspaceEditorSessionId || 0) + 1
      this._draftStoredEndpointNames = options.isNew ? null : {
        fromDeviceId: text(draft && draft.fromDeviceId), fromDevice: text(draft && draft.fromDevice),
        toDeviceId: text(draft && draft.toDeviceId), toDevice: text(draft && draft.toDevice),
      }
      const overlayChanges = {
        editorVisible: true, continuousVisible: false, detailVisible: false,
        draft: null, draftPairs: [], pairErrors: [],
      }
      if (this.data.detailVisible || (this.data.workspaceOverlayPhases && this.data.workspaceOverlayPhases.lineDetails)) {
        this.transitionWorkspaceOverlays(['lineDetails'], 'lineEditor', overlayChanges,
          () => this.cleanupWorkspaceOverlayContents(['lineDetails']))
      } else {
        if (!this.data.workspaceOverlayPhases || this.data.workspaceOverlayPhases.lineDetails !== 'closing') overlayChanges.detailLine = null
        this.beginWorkspaceOverlay('lineEditor', overlayChanges)
      }
      core.setDraft.call(this, draft, options)
      this._draftDefaultSpec = false
      const presentationDraft = { ...this.data.draft }
      const devices = this._workspace && this._workspace.devices || this.data.devices
      if (presentationDraft.fromDeviceId) {
        const source = devices.find((device) => device.id === presentationDraft.fromDeviceId)
        if (source) presentationDraft.fromDevice = source.name
      }
      if (presentationDraft.toDeviceId) {
        const destination = devices.find((device) => device.id === presentationDraft.toDeviceId)
        if (destination) presentationDraft.toDevice = destination.name
      }
      this.setData({ draft: presentationDraft })
      const draftPairs = [this.makePair(presentationDraft)]
      const draftCircleLabel = circleLabel(presentationDraft, this._schedule)
      const fromDeviceChoices = endpointChoices('from', presentationDraft, devices)
      const toDeviceChoices = endpointChoices('to', presentationDraft, devices)
      this.setData({ draftPairs, pairErrors: [], continuousVisible: false,
        deviceChoices: fromDeviceChoices, fromDeviceChoices, toDeviceChoices,
        draftCircleLabel, draftCircleNumeric: /^\d{1,4}$/.test(draftCircleLabel),
        fromDeviceIndex: resolveEndpointChoiceIndex(fromDeviceChoices, 'from', this.data.draft),
        toDeviceIndex: resolveEndpointChoiceIndex(toDeviceChoices, 'to', this.data.draft) })
      this._workspaceDraftBaseline = this.workspaceDraftSignature()
      this.syncUnloadWarning()
    },

    workspaceDraftSignature() { return JSON.stringify({ draft: this.data.draft, pairs: this.data.draftPairs }) },

    hasUnsavedDraft() {
      if (!this.data.draft) return false
      return Boolean(this._draftTouched || this.workspaceDraftSignature() !== this._workspaceDraftBaseline)
    },

    onDraftInput(event) {
      if (this.data.saving) return
      core.onDraftInput.call(this, event)
      const field = dataset(event).field
      if (['fromPort', 'toPort', 'lengthText'].includes(field) && this.data.draftPairs.length) {
        const draftPairs = this.data.draftPairs.map((pair, index) => field === 'lengthText' || !index ? { ...pair, [field]: inputValue(event) } : pair)
        this.setData({ draftPairs })
      }
      this.syncUnloadWarning()
    },

    selectEndpoint(event) {
      const side = dataset(event).side
      if (!['from', 'to'].includes(side) || this.data.saving) return
      const choices = side === 'from' ? this.data.fromDeviceChoices : this.data.toDeviceChoices
      const index = Number(event.detail && event.detail.value)
      const device = Number.isInteger(index) ? choices[index] : null
      if (!device || !device.id) return
      const previous = this.data.draft || {}
      const previousId = text(previous[`${side}DeviceId`])
      const previousName = text(previous[`${side}Device`])
      this.assignEndpoint(side, device)
      const updated = this.data.draft || {}
      if (text(updated[`${side}DeviceId`]) !== previousId || text(updated[`${side}Device`]) !== previousName) {
        vibrate('light')
      }
    },

    assignEndpoint(side, device) {
      if (!['from', 'to'].includes(side) || !device || !device.id) return
      const draft = { ...this.data.draft, [`${side}Device`]: device.name }
      if (device.legacy) draft[`${side}DeviceId`] = null
      else draft[`${side}DeviceId`] = device.id
      const invalidatedDestination = side === 'from' && Boolean(draft.toDeviceId)
        && draft.toDeviceId === device.id
      const formFieldErrors = { ...this.data.formFieldErrors }
      delete formFieldErrors[`${side}Device`]
      if (invalidatedDestination) {
        draft.toDevice = ''
        delete draft.toDeviceId
        formFieldErrors.toDevice = '\u8bf7\u91cd\u65b0\u9009\u62e9\u4e0d\u540c\u7684\u53bb\u5411\u8bbe\u5907'
      } else if (side === 'from' && draft.toDeviceId) delete formFieldErrors.toDevice
      if (side === 'to' && draft.fromDeviceId && draft.fromDeviceId === device.id) {
        formFieldErrors.toDevice = '\u6765\u6e90\u8bbe\u5907\u548c\u53bb\u5411\u8bbe\u5907\u4e0d\u80fd\u76f8\u540c'
        this.setData({ formFieldErrors, formError: formFieldErrors.toDevice })
        return
      }
      this._draftTouched = true
      const fromDeviceChoices = endpointChoices('from', draft, this._workspace && this._workspace.devices || this.data.devices)
      const toDeviceChoices = endpointChoices('to', draft, this._workspace && this._workspace.devices || this.data.devices)
      const formError = invalidatedDestination ? formFieldErrors.toDevice : ''
      this.setData({ draft, deviceChoices: fromDeviceChoices, fromDeviceChoices, toDeviceChoices,
        fromDeviceIndex: resolveEndpointChoiceIndex(fromDeviceChoices, 'from', draft),
        toDeviceIndex: resolveEndpointChoiceIndex(toDeviceChoices, 'to', draft),
        formFieldErrors, formError, saveError: '' })
      this.syncUnloadWarning()
    },

    onPairInput(event) {
      const { index, field } = dataset(event)
      if (!['fromPort', 'toPort', 'lengthText'].includes(field) || !this.data.draftPairs[Number(index)] || this.data.saving) return
      const draftPairs = this.data.draftPairs.map((pair, position) => position === Number(index) ? { ...pair, [field]: inputValue(event) } : pair)
      this._draftTouched = true
      const draft = Number(index) === 0 ? { ...this.data.draft, [field]: inputValue(event) } : this.data.draft
      const pairErrors = this.data.pairErrors.map((error, position) => position === Number(index) ? { ...error, [field]: false } : error)
      this.setData({ draftPairs, draft, pairErrors, formError: '', saveError: '' })
      this.syncUnloadWarning()
    },

    addDraftPair() {
      if (!this.data.draftIsNew || this.data.saving) return
      if (this.data.draftPairs.length >= 32) { notify('一次最多添加 32 条线路'); return }
      this._draftTouched = true
      this.setData({ draftPairs: [...this.data.draftPairs, this.makePair({ lengthText: this.data.draft.lengthText })], pairErrors: [], formError: '' })
      this.syncUnloadWarning()
      vibrate('light')
    },

    removeDraftPair(event) {
      const index = Number(dataset(event).index)
      if (!this.data.draftIsNew || this.data.draftPairs.length <= 1 || !this.data.draftPairs[index] || this.data.saving) return
      const draftPairs = this.data.draftPairs.filter((pair, position) => index !== position)
      this._draftTouched = true
      this.setData({ draftPairs, draft: { ...this.data.draft, ...draftPairs[0] }, pairErrors: [], formError: '' })
      this.syncUnloadWarning()
      vibrate('light')
    },

    onOptionChange(event) {
      if (this.data.saving) return
      const field = dataset(event).field
      const previousValue = this.data.draft && this.data.draft[field]
      const previousIndex = this._optionIndexes && this._optionIndexes[field]
      core.onOptionChange.call(this, event)
      if (previousValue !== (this.data.draft && this.data.draft[field])
        || previousIndex !== (this._optionIndexes && this._optionIndexes[field])) vibrate('light')
      this.syncUnloadWarning()
    },

    onCustomConnectorInput(event) {
      if (this.data.saving) return
      core.onCustomConnectorInput.call(this, event)
      this.syncUnloadWarning()
    },

    requestCloseEditor() {
      if (this.data.saving || !this.data.editorVisible || this.data.continuousVisible) return
      const intent = this.nextWorkspaceTransitionRevision()
      const context = this.captureWorkspaceEditorContext()
      const closeIfCurrent = () => {
        if (intent === this._workspaceTransitionRevision && this.isWorkspaceEditorContextCurrent(context)) this.closeEditor()
      }
      if (!this.hasUnsavedDraft()) { closeIfCurrent(); return }
      wx.showModal({ title: '\u653e\u5f03\u672a\u4fdd\u5b58\u4fee\u6539\uff1f', content: '\u5173\u95ed\u540e\uff0c\u672c\u6b21\u586b\u5199\u7684\u7ebf\u8def\u5185\u5bb9\u4e0d\u4f1a\u4fdd\u5b58\u3002',
        confirmText: '\u653e\u5f03\u4fee\u6539', confirmColor: '#d70015',
        success: ({ confirm }) => { if (confirm) closeIfCurrent() } })
    },

    closeEditor() {
      if (!this.data.editorVisible && !(this.data.workspaceOverlayPhases && this.data.workspaceOverlayPhases.lineEditor)) return
      this.nextWorkspaceTransitionRevision()
      this.invalidateWorkspaceEditorDelete()
      base.resetFormKeyboardAvoidance.call(this, false)
      this._draftTouched = false
      this._draftBaseline = ''
      this._draftStoredEndpointNames = null
      const closing = ['lineEditor']
      if (this.data.continuousVisible || (this.data.workspaceOverlayPhases && this.data.workspaceOverlayPhases.continuous)) closing.push('continuous')
      this.endWorkspaceOverlays(closing, { editorVisible: false, continuousVisible: false, saving: false }, () =>
        this.cleanupWorkspaceOverlayContents(closing))
      this.syncUnloadWarning()
    },

    openContinuous() {
      if (!this.data.draftIsNew || this.data.saving || !this.data.editorVisible || this.data.continuousVisible) return
      const last = this.data.draftPairs[this.data.draftPairs.length - 1] || {}
      this.beginFormKeyboardAvoidance('editor')
      this.transitionWorkspaceOverlays(['lineEditor'], 'continuous', {
        editorVisible: true, continuousVisible: true,
        continuousDraft: { fromPort: last.fromPort || '', toPort: last.toPort || '', count: '2' },
      })
      this.refreshContinuousPreview()
    },

    onContinuousInput(event) {
      const field = dataset(event).field
      if (!['fromPort', 'toPort', 'count'].includes(field)) return
      this.setData({ continuousDraft: { ...this.data.continuousDraft, [field]: inputValue(event) } })
      this.refreshContinuousPreview()
    },

    onContinuousCountStep(event) {
      const previous = text(this.data.continuousDraft.count)
      const count = Math.min(32, Math.max(1, (Number(this.data.continuousDraft.count) || 1) + Number(dataset(event).delta || 0)))
      this.onContinuousInput({ currentTarget: { dataset: { field: 'count' } }, detail: { value: text(count) } })
      if (text(count) !== previous) vibrate('light')
    },

    refreshContinuousPreview() {
      const draft = this.data.continuousDraft
      const result = generatePortPairs(draft.fromPort, draft.toPort, draft.count)
      this.setData({ continuousPairs: result.ok ? result.pairs : [], continuousError: result.ok ? '' : result.error })
    },

    closeContinuous() {
      if (!this.data.continuousVisible && !(this.data.workspaceOverlayPhases && this.data.workspaceOverlayPhases.continuous)) return
      this.nextWorkspaceTransitionRevision()
      this.beginFormKeyboardAvoidance('editor')
      this.transitionWorkspaceOverlays(['continuous'], 'lineEditor', {
        editorVisible: true, continuousVisible: false,
      }, () => this.cleanupWorkspaceOverlayContents(['continuous']))
    },

    fillContinuous() {
      const draft = this.data.continuousDraft
      const result = generatePortPairs(draft.fromPort, draft.toPort, draft.count)
      if (!result.ok) { this.setData({ continuousError: result.error }); return }
      const existing = this.data.draftPairs
      const replaceEmpty = existing.length === 1 && !existing[0].fromPort && !existing[0].toPort
      const retained = replaceEmpty ? [] : existing
      if (retained.length + result.pairs.length > 32) { this.setData({ continuousError: '本次保存最多添加 32 条线路，请减少数量。' }); return }
      const draftPairs = [...retained, ...result.pairs.map((pair) => this.makePair({ ...pair, lengthText: this.data.draft.lengthText }))]
      this._draftTouched = true
      this.setData({ draftPairs, draft: { ...this.data.draft, fromPort: draftPairs[0].fromPort, toPort: draftPairs[0].toPort,
        lengthText: draftPairs[0].lengthText }, pairErrors: [], formError: '', saveError: '' })
      vibrate('light')
      this.closeContinuous()
      this.syncUnloadWarning()
    },

    saveLine() {
      if (!this.data.draft || this.data.saving || this.data.continuousVisible) return
      const draft = this.data.draft
      const pairs = this.data.draftPairs
      const isNew = this.data.draftIsNew
      if (draft.fromDeviceId && draft.fromDeviceId === draft.toDeviceId) {
        const message = '\u6765\u6e90\u8bbe\u5907\u548c\u53bb\u5411\u8bbe\u5907\u4e0d\u80fd\u76f8\u540c\uff0c\u8bf7\u91cd\u65b0\u9009\u62e9'
        this.setData({ formError: message, formFieldErrors: { ...this.data.formFieldErrors, toDevice: message } })
        return
      }
      const missing = endpointFields.filter((field) => field.endsWith('Device') && !text(draft[field]).trim())
      const pairErrors = pairs.map((pair) => ({ fromPort: !text(pair.fromPort).trim(), toPort: !text(pair.toPort).trim() }))
      if (missing.length || pairErrors.some((error) => error.fromPort || error.toPort)) {
        const formFieldErrors = Object.fromEntries(missing.map((field) => [field, '请选择设备']))
        this.setData({ formError: '请选择两端设备，并填写每条线路的两端端口。', formFieldErrors, pairErrors })
        return
      }
      const lines = pairs.map((pair) => {
        const line = { ...draft, fromPort: pair.fromPort, toPort: pair.toPort, lengthText: pair.lengthText }
        const stored = this._draftStoredEndpointNames
        if (!this.data.draftIsNew && stored) {
          if (stored.fromDeviceId && text(line.fromDeviceId) === stored.fromDeviceId) line.fromDevice = stored.fromDevice
          if (stored.toDeviceId && text(line.toDeviceId) === stored.toDeviceId) line.toDevice = stored.toDevice
        }
        delete line.key
        if (this.data.draftIsNew) { delete line.id; delete line.code }
        return line
      })
      const command = this.data.draftIsNew ? { type: 'append-lines', lines } : { type: 'upsert', line: lines[0] }
      const preview = applyScheduleChange(this._schedule, command)
      if (!preview.ok) { this.setData({ formError: preview.error }); return }
      this.saveCommand(command, (result) => {
        const count = lines.length
        if (!this._destroyed && !this._hidden) vibrate('medium')
        this.closeEditor()
        this.acceptSavedSchedule(result)
        notify(isNew ? `已添加 ${count} 条线路` : '线路已保存')
      })
    },

    deleteLine() {
      if (this.data.draftIsNew || !this.data.draft || this.data.saving || !this.data.editorVisible) return
      const snapshot = this.captureWorkspaceEditorContext()
      if (!snapshot || !this.isWorkspaceEditorContextCurrent(snapshot)) {
        notify('项目已更新，请重新操作')
        return
      }
      if (this._workspaceEditorDelete) return
      const token = ++this._workspaceEditorDeleteToken
      snapshot.token = token
      this._workspaceEditorDelete = snapshot
      this.setData({ workspaceEditorDeleting: true })
      const clearPending = () => {
        if (this._workspaceEditorDelete !== snapshot || token !== this._workspaceEditorDeleteToken) return false
        this._workspaceEditorDelete = null
        this.setData({ workspaceEditorDeleting: false })
        return true
      }
      if (typeof wx === 'undefined' || typeof wx.showModal !== 'function') {
        clearPending()
        notify('暂时无法确认删除')
        return
      }
      const label = circleLabel(this.data.draft, this._schedule)
      wx.showModal({
        title: '删除线路？',
        content: `将从本项目布线表中删除 ${label}。`,
        confirmText: '删除',
        confirmColor: '#d70015',
        success: ({ confirm }) => {
          if (!clearPending() || !confirm) return
          if (!this.isWorkspaceEditorContextCurrent(snapshot)) {
            if (!this._destroyed && !this._hidden && this.data.editorVisible) notify('项目已更新，请重新操作')
            return
          }
          this.saveCommand({ type: 'delete', id: snapshot.lineId }, (result) => {
            if (this._destroyed || this.projectId !== snapshot.projectId
              || !this.data.project || this.data.project.id !== snapshot.projectId) return
            const sameEditor = this.isWorkspaceEditorContextCurrent(snapshot, true)
            if (this._hidden) {
              this._workspaceEditorDeleteNeedsRefresh = snapshot
              if (sameEditor) {
                base.resetFormKeyboardAvoidance.call(this, false)
                this.setData({ editorVisible: false, continuousVisible: false, saving: false,
                  draft: null, draftPairs: [], pairErrors: [], formError: '', formFieldErrors: {}, saveError: '',
                  'workspaceOverlayPhases.lineEditor': '', 'workspaceOverlayPhases.continuous': '' })
                this._draftTouched = false
                this._draftBaseline = ''
                this.acceptSavedSchedule(result)
              }
              return
            }
            if (!sameEditor) {
              this._workspaceDeleteNeedsRefresh = true
              return
            }
            this.closeEditor()
            this.acceptSavedSchedule(result)
            if (!this._destroyed && !this._hidden) vibrate('medium')
            notify('线路已删除')
          })
        },
        fail: () => { clearPending() },
      })
    },

    saveCommand(command, onSuccess) {
      return core.saveScheduleCommand.call(this, command, (result) => { this.setData({ saving: false }); onSuccess(result) })
    },
  }
}

module.exports = {
  createLineEditor,
  CABLE_SPEC_OPTIONS,
  DEFAULT_AUDIO_SPEC,
  ROUTE_ENDPOINT_FIELDS,
  optionIndex,
  getCableSpecOptions,
  getDefaultSpec,
  getCableSpecOptionViews,
  safeToast,
}
