'use strict'

const {
  clone,
  createPage,
  installPlatform,
  loadPageDefinition,
} = require('./harness.cjs')

const tinySvg = (height) => `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="750" height="${height}" viewBox="0 0 750 ${height}"><rect width="100%" height="100%" fill="#f4f6fb"/><text x="36" y="56" font-size="28" fill="#20334f">SPL synthetic short-image layout only</text><text x="36" y="102" font-size="22" fill="#52627a">750 × ${height}</text></svg>`,
)}`

const seededProjects = [
  { id: 'qa-active', name: 'SPL 主项目', createdAt: 1700000000000, updatedAt: 1700000000000 },
  { id: 'qa-target', name: '项目保存目标', createdAt: 1700000000000, updatedAt: 1700000000000 },
]

function invokePicker(page, field, value) {
  page.onPickerChange({ currentTarget: { dataset: { field } }, detail: { value } })
}

function currentProjectEvent(page, field, baselineHeight, keyboardMode) {
  const eventHeight = keyboardMode === 'resize' ? Math.max(1, baselineHeight - 280) : baselineHeight
  return {
    currentTarget: {
      dataset: {
        projectField: field,
        projectRevision: page.data.projectRevision,
        projectEpisode: page.data.projectKeyboardEpisode,
      },
    },
    timeStamp: 1000,
    size: { windowHeight: eventHeight },
    detail: { height: 280 },
  }
}

function createFixture(name, viewportWidth = 390, viewportHeight = 671, nativeReport = null, baselineHeight = viewportHeight) {
  const isNativePreview = name === 'share-long' || name === 'share-long-kf'
  const tabFixture = name.match(/^tab-(spl|distance|reference)-(.+)$/)
  const stateKey = tabFixture ? tabFixture[2] : name
  const hasNativeReport = Boolean(nativeReport?.canvasWidth === 750 && nativeReport?.canvasHeight > 0)
  const keyboardMatch = name.match(/^project-keyboard-(select|create|details)-(overlay|resize)$/)
  const isProjectKeyboard = name === 'project-keyboard'
    || ['project-keyboard-select', 'project-keyboard-create', 'project-keyboard-details'].includes(name)
    || Boolean(keyboardMatch)
  const keyboardStep = keyboardMatch?.[1] || name.replace('project-keyboard-', '')
  const keyboardMode = keyboardMatch?.[2] || 'overlay'
  const isProjectFixture = ['project-list', 'project-list-selected', 'project-details'].includes(name) || isProjectKeyboard
  const platform = installPlatform({
    windowWidth: viewportWidth,
    windowHeight: baselineHeight,
    deferDrawCallbacks: name === 'share-generating' || isProjectKeyboard,
    ...(isNativePreview && hasNativeReport
      ? { autoCanvasExportPath: nativeReport.url || '/__report-image' }
      : {}),
    initialStorage: {
      'audioTool.records.v1': [],
      'audioTool.projects.v1': isProjectFixture ? seededProjects : [],
      'audioTool.activeProject.v1': 'qa-active',
      'audioTool.storageSchemaVersion': 3,
    },
  })
  try {
    const definition = loadPageDefinition()
    let page = createPage(definition)
    page.onLoad()
    page.onShow()
    const interaction = {}

    if (stateKey === 'two-distributed') {
      invokePicker(page, 'countIndex', 1)
    } else if (stateKey === 'two-coherent') {
      invokePicker(page, 'countIndex', 1)
      invokePicker(page, 'summationModeIndex', 1)
    } else if (stateKey === 'high-count-16') {
      interaction.countSelectionAccepted = page.onCountPickerChange({ detail: { value: 8 } }) !== false
      interaction.selectedCount = page.data.countIndex >= 0 ? page.data.counts[page.data.countIndex] : null
    } else if (stateKey === 'high-output-16-coherent') {
      interaction.countSelectionAccepted = page.onCountPickerChange({ detail: { value: 8 } }) !== false
      invokePicker(page, 'summationModeIndex', 1)
      page.onDistanceInput({ detail: { value: '1' } })
      page.onDistanceBlur()
      interaction.selectedCount = page.data.countIndex >= 0 ? page.data.counts[page.data.countIndex] : null
      interaction.selectedDistance = page.data.result?.distanceMeters ?? null
    } else if (stateKey === 'single-9.8') {
      page.onDistanceInput({ detail: { value: '9.8' } })
      page.onDistanceBlur()
      interaction.selectedModel = page.data.selectedSpeaker?.model || ''
      interaction.selectedCount = page.data.countIndex >= 0 ? page.data.counts[page.data.countIndex] : null
      interaction.distanceText = page.data.distanceText
      interaction.calculatedDistance = page.data.result?.distanceMeters ?? null
      interaction.calculatedSpl = page.data.result?.selectedSpl ?? null
    } else if (stateKey.startsWith('band-') || stateKey === 'meeting-98-plus') {
      const branchCases = {
        'band-below-60': { target: 55, human: '较安静', meeting: '低于二级数值' },
        'band-60-75': { target: 67, human: '清晰语音', meeting: '低于二级数值' },
        'band-75-85': { target: 80, human: '明显偏响', meeting: '低于二级数值' },
        'band-85-95': { target: 90, human: '很响', meeting: '低于二级数值' },
        'band-95-105': { target: 96, human: '高声压', meeting: '二级数值门槛' },
        'band-above-105': { target: 110, human: '很高声压', meeting: '一级数值门槛' },
        'meeting-98-plus': { target: 100, human: '高声压', meeting: '一级数值门槛' },
      }
      const branch = branchCases[stateKey]
      if (!branch) throw new Error(`Unknown reference branch fixture: ${stateKey}`)
      const oneMeterSpl = Number(page.data.result?.oneMeterSpl)
      const distanceMeters = Math.min(1000, Math.max(1,
        Math.round((10 ** ((oneMeterSpl - branch.target) / 20)) * 10) / 10))
      page.onDistanceInput({ detail: { value: String(distanceMeters) } })
      page.onDistanceBlur()
      interaction.referenceBranchExpected = {
        human: branch.human,
        meeting: branch.meeting,
        selectedSpl: page.data.result?.selectedSpl ?? null,
        distanceMeters,
      }
    } else if (stateKey === 'maximum-distance' || stateKey === 'custom-distance-7.3') {
      const distanceText = stateKey === 'maximum-distance' ? '1000' : '7.3'
      page.onDistanceInput({ detail: { value: distanceText } })
      page.onDistanceBlur()
      interaction.distanceText = page.data.distanceText
      interaction.calculatedDistance = page.data.result?.distanceMeters ?? null
    } else if (stateKey === 'invalid') {
      page.onDistanceInput({ detail: { value: '1001' } })
      page.onDistanceBlur()
    } else if (stateKey === 'pending') {
      page.onDistanceInput({ detail: { value: '5' } })
    } else if (stateKey === 'reset-blank') {
      interaction.resetAccepted = page.requestReset()
      interaction.resetModalCount = platform.modalLog.length
      interaction.persistedPreferences = platform.storage.get('audioTool.spl.preferences')
      page.onUnload()
      page = createPage(definition)
      page.onLoad()
      page.onShow()
      interaction.reopenedPreferences = page.getPreferences()
      interaction.reopenedHasResult = Boolean(page.data.result)
    } else if (stateKey === 'long-model') {
      page.openSpeakerSelector()
      const matches = page._selectorMatches || []
      const longest = matches.slice().sort((a, b) => String(b.model).length - String(a.model).length)[0]
      interaction.longestModel = longest?.model || ''
      interaction.longestModelLength = String(longest?.model || '').length
      if (longest) page.selectSpeaker({ currentTarget: { dataset: { index: longest.index } } })
    } else if (name === 'selector-empty') {
      page.openSpeakerSelector()
      page.onSelectorInput({ detail: { value: '__SPL_QA_NO_MATCH__' } })
    } else if (name === 'selector-list') {
      page.openSpeakerSelector()
      page.appendSelectorItems()
    } else if (name === 'share-generating') {
      page.openSharePreview()
    } else if (name === 'share-error') {
      page.setData({
        shareSheetVisible: true,
        isGeneratingResultReport: false,
        isCheckingResultReportCache: false,
        resultReportPreviewVisible: false,
        resultReportImagePath: '',
        resultReportError: '图片暂未生成，请重试。',
      })
    } else if (name === 'share-short') {
      page.setData({
        shareSheetVisible: true,
        isGeneratingResultReport: false,
        isCheckingResultReportCache: false,
        resultReportPreviewVisible: true,
        resultReportImagePath: tinySvg(600),
        resultReportCanvasHeight: 600,
        resultReportError: '',
      })
      page.updateShareImageLayout()
    } else if (name === 'share-long' || name === 'share-long-kf') {
      if (!hasNativeReport) {
        interaction.nativeReportUnavailable = true
      } else {
        if (name === 'share-long-kf') {
          page.openSpeakerSelector()
          const target = (page._selectorMatches || []).find((item) => item.model === 'KF-D10F')
          interaction.modelSelected = Boolean(target)
            && page.selectSpeaker({ currentTarget: { dataset: { index: target.index } } }) !== false
          interaction.countSelectionAccepted = page.onCountPickerChange({ detail: { value: 2 } }) !== false
          page.onDistanceInput({ detail: { value: '4' } })
          page.onDistanceBlur()
          interaction.selectedBeforeExport = {
            speakerModel: page.data.selectedSpeaker?.model || '',
            speakerCount: page.data.countIndex >= 0 ? page.data.counts[page.data.countIndex] : null,
            distanceText: page.data.distanceText,
          }
        }
        interaction.openAccepted = page.openSharePreview()
        interaction.productionGenerationCompleted = page.data.resultReportPreviewVisible
          && page.data.resultReportImagePath === '/__report-image'
        interaction.currentPayload = page.getRecordPayload()
        page.setData({ resultReportCanvasHeight: nativeReport.canvasHeight })
        page.updateShareImageLayout()
        interaction.nativeReportMetadata = nativeReport
      }
    } else if (name === 'share-closing') {
      page.setData({
        shareSheetVisible: true,
        shareSheetClosing: false,
        isGeneratingResultReport: false,
        isCheckingResultReportCache: false,
        resultReportPreviewVisible: false,
        resultReportImagePath: '',
      })
      interaction.closeAccepted = page.closeSharePreview()
    } else if (isProjectFixture) {
      interaction.openAccepted = page.openProjectSheet()
      if (name === 'project-list-selected') {
        page.setData({ projectTargetId: 'qa-target', projectTargetName: '项目保存目标' })
        interaction.selectedRowVisualStateSeededInMemory = page.data.projectTargetId === 'qa-target'
      }
      if (name === 'project-details') {
        interaction.targetAccepted = page.chooseProject({ currentTarget: { dataset: { id: 'qa-target' } } })
        interaction.stepAccepted = page.data.projectStep === 'details'
      }
      if (isProjectKeyboard) {
        let field = 'projectConfigNote'
        if (keyboardStep === 'select') field = 'projectSearch'
        if (keyboardStep === 'create') {
          interaction.stepAccepted = page.beginNewProject()
          field = 'newProjectName'
        } else if (keyboardStep === 'details' || name === 'project-keyboard') {
          interaction.targetAccepted = page.chooseProject({ currentTarget: { dataset: { id: 'qa-target' } } })
        } else {
          interaction.stepAccepted = page.data.projectStep === 'select'
        }
        if (keyboardStep === 'create') interaction.stepAccepted = page.data.projectStep === 'create'
        if (keyboardStep === 'details' || name === 'project-keyboard') {
          interaction.stepAccepted = page.data.projectStep === 'details'
        }
        interaction.keyboardStep = page.data.projectStep
        interaction.keyboardField = field
        const eventWindowHeight = keyboardMode === 'resize' ? Math.max(1, baselineHeight - 280) : baselineHeight
        if (keyboardMode === 'resize') {
          platform.wx.getWindowInfo = () => ({ windowWidth: viewportWidth, windowHeight: eventWindowHeight })
          platform.wx.getSystemInfoSync = () => ({ windowWidth: viewportWidth, windowHeight: eventWindowHeight })
        }
        const keyboardEvent = currentProjectEvent(page, field, baselineHeight, keyboardMode)
        interaction.focusEventAccepted = page.onProjectInputFocus(keyboardEvent)
        interaction.keyboardEventAccepted = page.onProjectKeyboardHeightChange(keyboardEvent)
        interaction.keyboardEventData = keyboardEvent.currentTarget.dataset
        interaction.keyboardHeight = keyboardEvent.detail.height
        interaction.keyboardMode = keyboardMode
        interaction.baselineWindowHeight = baselineHeight
        interaction.eventWindowHeight = eventWindowHeight
        interaction.platformWindowHeight = platform.wx.getWindowInfo().windowHeight
        interaction.viewportHeight = viewportHeight
        interaction.keyboardStyle = page.data.projectKeyboardPanelStyle
      }
    }

    if (tabFixture) {
      const [, requestedTab] = tabFixture
      const resultBeforeTabs = page.data.result
      const payloadBeforeTabs = JSON.stringify(page.getRecordPayload())
      const signatureBeforeTabs = page.getResultReportSignature()
      page.resultReportSignature = signatureBeforeTabs
      page.setData({
        resultReportImagePath: '/tmp/tab-protected-spl-report.png',
        resultReportCanvasHeight: 1432,
        resultReportPreviewVisible: true,
      })
      const reportCacheBeforeTabs = JSON.stringify({
        signature: page.resultReportSignature,
        imagePath: page.data.resultReportImagePath,
        canvasHeight: page.data.resultReportCanvasHeight,
        previewVisible: page.data.resultReportPreviewVisible,
      })
      const preferencesBeforeTabs = JSON.stringify(page.getPreferences())
      const storedPreferencesBeforeTabs = JSON.stringify(platform.storage.get('audioTool.spl.preferences'))
      const preferenceWritesBeforeTabs = platform.writeLog.filter((entry) => entry.key === 'audioTool.spl.preferences').length
      const vibrationStart = platform.vibrationLog.length
      const requestedSequence = requestedTab === 'spl' ? ['distance', 'spl'] : [requestedTab]
      interaction.tabTransitionResults = requestedSequence.map((tab) => page.onResultTabTap({
        currentTarget: { dataset: { tab } },
      }))
      interaction.requestedTab = requestedTab
      interaction.tabTransitionAccepted = interaction.tabTransitionResults.every(Boolean)
      interaction.selectedTab = page.data.resultTab
      interaction.tabVibrations = platform.vibrationLog.slice(vibrationStart)
      interaction.tabDidNotRecalculate = page.data.result === resultBeforeTabs
      interaction.tabPayloadUnchanged = JSON.stringify(page.getRecordPayload()) === payloadBeforeTabs
      interaction.tabSignatureUnchanged = page.getResultReportSignature() === signatureBeforeTabs
      interaction.tabPreferencesUnchanged = JSON.stringify(page.getPreferences()) === preferencesBeforeTabs
        && JSON.stringify(platform.storage.get('audioTool.spl.preferences')) === storedPreferencesBeforeTabs
        && platform.writeLog.filter((entry) => entry.key === 'audioTool.spl.preferences').length === preferenceWritesBeforeTabs
      interaction.tabReportCacheUnchanged = JSON.stringify({
        signature: page.resultReportSignature,
        imagePath: page.data.resultReportImagePath,
        canvasHeight: page.data.resultReportCanvasHeight,
        previewVisible: page.data.resultReportPreviewVisible,
      }) === reportCacheBeforeTabs
      interaction.tabReportPathUnchanged = page.data.resultReportImagePath === '/tmp/tab-protected-spl-report.png'
      interaction.referenceBranchExpected = stateKey.startsWith('band-') || stateKey === 'meeting-98-plus'
        ? interaction.referenceBranchExpected
        : null
    }

    if (name === 'reset-error') {
      platform.failedWrites.add('audioTool.spl.preferences')
      interaction.resetAccepted = page.requestReset()
      interaction.resetError = page.data.resetError
      interaction.resultPreservedAfterResetError = Boolean(page.data.result)
        && page.data.result.distanceMeters === 4
      interaction.inputsPreservedAfterResetError = page.data.speakerIndex >= 0
        && page.data.countIndex >= 0 && page.data.distanceText === '4'
    } else if (name === 'tab-reset-error') {
      platform.failedWrites.add('audioTool.spl.preferences')
      interaction.resetAccepted = page.requestReset()
      interaction.resetError = page.data.resetError
      interaction.resultPreservedAfterResetError = Boolean(page.data.result)
        && page.data.result.distanceMeters === 4
      interaction.inputsPreservedAfterResetError = page.data.speakerIndex >= 0
        && page.data.countIndex >= 0 && page.data.distanceText === '4'
    }

    return {
      stateName: name,
      viewportWidth,
      viewportHeight,
      state: clone(page.data),
      handlers: Object.keys(definition).filter((key) => typeof definition[key] === 'function').sort(),
      interaction,
      reportAssetMode: isNativePreview
        ? (hasNativeReport ? 'native-wechat-png' : 'missing-native-wechat-png')
        : name === 'share-short' ? 'synthetic-layout-only' : null,
      sourceNote: isNativePreview
        ? (hasNativeReport
          ? 'Production openSharePreview/generateResultReportImage state bridged to the actual WeChat simulator-exported PNG; native PNG pixel and production canvas dimensions are included.'
          : 'Native report PNG is unavailable; this case must fail and is not valid production preview evidence.')
          : name === 'share-short'
          ? 'Synthetic 750px-wide short SVG probes only the aspectFit layout boundary. It is not a production export or image-height pass.'
          : name === 'project-list-selected'
            ? 'The production project list is opened normally; only projectTargetId/projectTargetName are seeded in page memory to exercise selected-row visual styling. No preferences, records, or project storage is written.'
          : name === 'project-details'
            ? 'The production project sheet is opened and an existing seeded target is selected through chooseProject; no keyboard callbacks or storage writes are used.'
          : tabFixture
            ? 'The requested result tab was selected through production onResultTabTap. This Chromium bridge is layout evidence only, not WeChat runtime/device evidence.'
          : name === 'reset-error' || name === 'tab-reset-error'
            ? 'The valid-result reset path was invoked with a simulated preference write failure; state and geometry are checked without changing product storage.'
          : isProjectKeyboard
            ? `Production visible-page project ${keyboardStep === 'select' ? 'selection/search' : keyboardStep === 'create' ? 'project-creation' : 'configuration-details'} flow and real onProjectInputFocus/onProjectKeyboardHeightChange controller callbacks were invoked with current WXML revision/episode data. ${keyboardMode === 'resize' ? `Viewport-resize mode: the Chromium DOM and wx window height are ${viewportHeight}px, while the captured baseline is ${baselineHeight}px.` : `Overlay mode: Chromium DOM and wx window remain ${viewportHeight}px.`} Keyboard height is injected into production handlers; Chromium does not simulate a native keyboard.`
            : 'Production SPL controller state after onLoad/onShow and real controller actions. This Chromium bridge is layout evidence only, not WeChat runtime/device evidence.',
    }
  } finally {
    platform.restore()
  }
}

module.exports = { createFixture }
