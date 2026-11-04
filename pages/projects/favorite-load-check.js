'use strict'

const { getModuleMetadata, MODULES } = require('../../utils/records')
const { amplifiers, speakers } = require('../../data/equipment')
const { cameras } = require('../../data/cameras')
const { amplifierInputStages } = require('../../data/amplifier-input-stages')
const { getHorizontalCameraViews } = require('../../utils/camera-fov')

const selectableSpeakers = speakers.filter((item) => !item.calculationDisabled)
const ledAspectRatios = new Set(['16:9', '4:3', '21:9', '16:10', '32:9'])
const ledUnits = new Set(['module', 'cabinetStandard', 'cabinetPremiumA'])
const ledPitches = new Set(['recommended', 1.25, 1.53, 1.86, 2])
// Stable endpoint IDs are mirrored here to avoid loading the audio-wiring subpackage from the main package.
const audioWiringOutputIds = new Set([
  'xlrBalanced', 'trsBalanced', 'terminalBalanced', 'stereo35', 'rcaMono', 'tsMono', 'stereo635',
])
const audioWiringInputIds = new Set([
  'xlrBalanced', 'trsBalanced', 'terminalBalanced', 'rcaStereo', 'tsStereo', 'rcaMono', 'tsMono', 'stereo635', 'stereo35',
])

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function checkFavoriteLoad(favorite) {
  const metadata = getModuleMetadata(favorite?.module)
  if (!metadata || metadata.retired || !MODULES[favorite.module] || favorite.module === 'dmxAddress') {
    return { canLoad: false, reason: '此历史模块不支持安全重算，原始参数和结果仍可查看。' }
  }
  const preferences = favorite.preferences
  if (!isPlainObject(preferences)) return { canLoad: false, reason: '保存的参数格式不完整，无法安全载入。' }
  if (favorite.module === 'limiter') {
    if (!amplifiers.some((item) => item.model === preferences.amplifierModel)) {
      return { canLoad: false, reason: `功放型号“${preferences.amplifierModel || '未记录'}”当前不可用，已阻止静默替换。` }
    }
    if (!selectableSpeakers.some((item) => item.model === preferences.speakerModel)) {
      return { canLoad: false, reason: `音箱型号“${preferences.speakerModel || '未记录'}”当前不可用，已阻止静默替换。` }
    }
  }
  if (favorite.module === 'spl'
    && !selectableSpeakers.some((item) => item.model === preferences.speakerModel && Number.isFinite(item.sensitivityDb))) {
    return { canLoad: false, reason: `音箱型号“${preferences.speakerModel || '未记录'}”当前不可用于声压计算。` }
  }
  if (favorite.module === 'gainStructure'
    && (!amplifiers.some((item) => item.model === preferences.amplifierModel)
      || !amplifierInputStages[preferences.amplifierModel])) {
    return { canLoad: false, reason: `功放型号“${preferences.amplifierModel || '未记录'}”当前不可用于增益计算。` }
  }
  if (favorite.module === 'camera') {
    if (preferences.cameraCalculationVersion !== undefined
      && ![1, 2].includes(preferences.cameraCalculationVersion)) {
      return { canLoad: false, reason: '摄像机参数版本较新，当前工具无法安全重算。' }
    }
    if (preferences.sourceMode === 'library') {
      const camera = cameras.find((item) => item.model === preferences.cameraModel)
      const viewIndex = Number(preferences.viewIndex)
      const views = camera ? getHorizontalCameraViews(camera) : []
      if (!camera || !Number.isInteger(viewIndex) || viewIndex < 0 || viewIndex >= views.length) {
        return { canLoad: false, reason: `摄像机型号或视角“${preferences.cameraModel || '未记录'}”当前不可用。` }
      }
    } else {
      return { canLoad: false, reason: '摄像机参数来源无法识别，已阻止静默套用默认值。' }
    }
  }
  if (favorite.module === 'cable' && (!['constant', 'professional'].includes(preferences.mode)
    || !['indoor', 'outdoor'].includes(preferences.environment))) {
    return { canLoad: false, reason: '线材参数版本或选项无法识别，已阻止静默套用默认值。' }
  }
  if (favorite.module === 'ledScreen' && (!ledAspectRatios.has(preferences.aspectRatio)
    || !ledUnits.has(preferences.unitKey) || !ledPitches.has(preferences.pitch))) {
    return { canLoad: false, reason: 'LED 参数中存在当前版本无法识别的比例、拼装单元或点间距。' }
  }
  if (favorite.module === 'audioWiring') {
    const outputKnown = audioWiringOutputIds.has(preferences.outputId)
    const inputKnown = audioWiringInputIds.has(preferences.inputId)
    const manualSelected = preferences.manualSelected
    const controlsKnown = manualSelected && typeof manualSelected === 'object' && !Array.isArray(manualSelected)
      && typeof manualSelected.output === 'boolean' && typeof manualSelected.input === 'boolean'
      && ['wiring', 'connectors'].includes(preferences.viewMode)
      && ['mating', 'solder'].includes(preferences.face)
    if (preferences.version !== 1 || !outputKnown || !inputKnown || !controlsKnown) {
      return { canLoad: false, reason: '接线参数版本或接口型号当前不可用，已保留完整历史结果。' }
    }
  }
  return { canLoad: true, reason: '' }
}

module.exports = { checkFavoriteLoad }
