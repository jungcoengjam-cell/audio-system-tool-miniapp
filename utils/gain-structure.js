const DSP_MAX_OUTPUT_DBU = 18.4
const DBU_REFERENCE_VOLTAGE = 0.775
const DEFAULT_TARGET_PEAK_DBFS = -6
const DEFAULT_PROGRAM_HEADROOM_DB = 12
const ALIGNMENT_TOLERANCE_DB = 0.05

function round(value, digits = 2) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function voltageToDbu(voltage) {
  return 20 * Math.log10(voltage / DBU_REFERENCE_VOLTAGE)
}

function dbuToVoltage(dbu) {
  return DBU_REFERENCE_VOLTAGE * (10 ** (dbu / 20))
}

function hasFiniteNumericFields(result) {
  return Object.values(result)
    .filter((value) => typeof value === 'number')
    .every(Number.isFinite)
}

function findRatedPower(powerTable, loadImpedance) {
  const loadKey = Object.keys(powerTable || {}).find(
    (key) => Math.abs(Number(key) - loadImpedance) < 0.001,
  )
  return loadKey ? powerTable[loadKey] : null
}

function resolveStageValue(inputStage, selectedStageValue) {
  const options = inputStage?.options || []
  const value = Number.isFinite(selectedStageValue)
    ? selectedStageValue
    : Number.isFinite(inputStage?.defaultValue)
      ? inputStage.defaultValue
      : options.length === 1 ? options[0] : null

  if (!Number.isFinite(value)) {
    return {
      valid: false,
      warning: '该功放有多个输入级档位，请先核对后面板拨码或屏幕设置。',
    }
  }

  if (!options.some((option) => Math.abs(option - value) < 0.001)) {
    return {
      valid: false,
      warning: '所选输入级档位不在该型号说明书的可选范围内。',
    }
  }

  return {
    valid: true,
    value,
    selectionSource: Number.isFinite(selectedStageValue)
      ? 'user'
      : Number.isFinite(inputStage.defaultValue) ? 'manualDefault' : 'fixed',
  }
}

function resolveFullPowerInput({
  amplifier,
  inputStage,
  selectedStageValue,
  mode,
  loadImpedance,
}) {
  const selection = resolveStageValue(inputStage, selectedStageValue)
  if (!selection.valid) return selection

  if (inputStage.controlType === 'inputSensitivity') {
    const fullPowerInputVoltage = inputStage.unit === 'V'
      ? selection.value
      : inputStage.unit === 'dBu' ? dbuToVoltage(selection.value) : null

    if (!Number.isFinite(fullPowerInputVoltage) || fullPowerInputVoltage <= 0) {
      return {
        valid: false,
        warning: '输入灵敏度须换算为有限正电压。',
      }
    }

    const result = {
      ...selection,
      valid: true,
      fullPowerInputVoltage,
      fullPowerInputDbu: inputStage.unit === 'dBu'
        ? selection.value
        : voltageToDbu(fullPowerInputVoltage),
      calculationBasis: 'manufacturerSensitivity',
    }
    return hasFiniteNumericFields(result)
      ? result
      : { valid: false, warning: '输入灵敏度无法得到有限的满功率输入电平。' }
  }

  if (inputStage.controlType !== 'voltageGain' || inputStage.unit !== 'dB') {
    return {
      valid: false,
      warning: '该功放输入级参数类型暂不支持计算。',
    }
  }

  if (!amplifier || !Number.isFinite(loadImpedance) || loadImpedance <= 0) {
    return {
      valid: false,
      warning: '按电压增益计算时，需要功放型号、工作模式和有效负载阻抗。',
    }
  }

  const powerTable = mode === 'bridge' ? amplifier.bridgePower : amplifier.stereoPower
  const amplifierRatedPower = findRatedPower(powerTable, loadImpedance)
  if (!amplifierRatedPower) {
    const supportedLoads = Object.keys(powerTable || {}).join('Ω、')
    return {
      valid: false,
      warning: `${amplifier.model}在${mode === 'bridge' ? '桥接' : '立体声'}模式下仅有${supportedLoads || '未录入'}Ω功率数据，无法反算${loadImpedance}Ω的满功率输入电平。`,
    }
  }

  const amplifierRatedVoltage = Math.sqrt(amplifierRatedPower * loadImpedance)
  const fullPowerInputVoltage = amplifierRatedVoltage / (10 ** (selection.value / 20))

  const result = {
    ...selection,
    valid: true,
    amplifierRatedPower,
    amplifierRatedVoltage,
    fullPowerInputVoltage,
    fullPowerInputDbu: voltageToDbu(fullPowerInputVoltage),
    calculationBasis: 'ratedPowerAndVoltageGain',
  }
  return hasFiniteNumericFields(result)
    ? result
    : { valid: false, warning: '功放功率或输入级参数无法得到有限的满功率输入电平。' }
}

function calculateGainStructure(options = {}) {
  const {
    amplifier,
    inputStage,
    selectedStageValue,
    mode = 'stereo',
    loadImpedance,
    dspMaxOutputDbu = DSP_MAX_OUTPUT_DBU,
    targetPeakDbfs = DEFAULT_TARGET_PEAK_DBFS,
    programHeadroomDb = DEFAULT_PROGRAM_HEADROOM_DB,
  } = options

  if (
    !inputStage
    || !Number.isFinite(dspMaxOutputDbu)
    || !Number.isFinite(targetPeakDbfs)
    || targetPeakDbfs > 0
    || !Number.isFinite(programHeadroomDb)
    || programHeadroomDb <= 0
  ) {
    return {
      valid: false,
      warning: '输入级资料、DSP 输出基准、目标峰值或节目动态余量无效。',
    }
  }

  const fullPower = resolveFullPowerInput({
    amplifier,
    inputStage,
    selectedStageValue,
    mode,
    loadImpedance,
  })
  if (!fullPower.valid) return fullPower

  const targetDspOutputDbu = dspMaxOutputDbu + targetPeakDbfs
  const levelDifferenceDb = targetDspOutputDbu - fullPower.fullPowerInputDbu
  const needsAttenuation = levelDifferenceDb > ALIGNMENT_TOLERANCE_DB
  const hasDriveShortfall = levelDifferenceDb < -ALIGNMENT_TOLERANCE_DB
  const recommendedAttenuationDb = needsAttenuation ? levelDifferenceDb : 0
  const driveShortfallDb = hasDriveShortfall ? -levelDifferenceDb : 0
  const nominalDspDbfs = targetPeakDbfs - programHeadroomDb
  const nominalDspOutputDbu = dspMaxOutputDbu + nominalDspDbfs
  const nominalPostAttenuationDbu = nominalDspOutputDbu - recommendedAttenuationDb
  const naturalFullPowerDbfs = fullPower.fullPowerInputDbu - dspMaxOutputDbu
  const alignedFullPowerDbfs = naturalFullPowerDbfs + recommendedAttenuationDb
  const alignmentMode = needsAttenuation
    ? 'attenuate'
    : hasDriveShortfall ? 'insufficientDrive' : 'direct'

  const statusText = alignmentMode === 'attenuate'
    ? `目标峰值对应 ${round(targetDspOutputDbu)} dBu，需要约 ${round(recommendedAttenuationDb)} dB 系统对齐衰减；应在 DSP 最终输出或功放输入衰减中择一执行，使额定输出点对齐 ${round(targetPeakDbfs)} dBFS。`
    : alignmentMode === 'insufficientDrive'
      ? `目标峰值对应 ${round(targetDspOutputDbu)} dBu，距离功放额定输出输入电平仍差约 ${round(driveShortfallDb)} dB；应调整功放档位或提高目标峰值，不能靠负衰减补足。`
      : `DSP 目标峰值与功放额定输出输入电平基本匹配，可从 0 dB 系统对齐衰减开始校准。`

  const result = {
    ...fullPower,
    valid: true,
    dspMaxOutputDbu: round(dspMaxOutputDbu),
    targetPeakDbfs: round(targetPeakDbfs),
    targetDspOutputDbu: round(targetDspOutputDbu),
    programHeadroomDb: round(programHeadroomDb),
    nominalDspDbfs: round(nominalDspDbfs),
    nominalDspOutputDbu: round(nominalDspOutputDbu),
    nominalPostAttenuationDbu: round(nominalPostAttenuationDbu),
    fullPowerInputVoltage: round(fullPower.fullPowerInputVoltage, 3),
    fullPowerInputDbu: round(fullPower.fullPowerInputDbu),
    naturalFullPowerDbfs: round(naturalFullPowerDbfs),
    alignedFullPowerDbfs: round(alignedFullPowerDbfs),
    recommendedAttenuationDb: round(recommendedAttenuationDb),
    driveShortfallDb: round(driveShortfallDb),
    availableAmplifierHeadroomDb: round(
      fullPower.fullPowerInputDbu - nominalPostAttenuationDbu,
    ),
    alignmentMode,
    statusText,
    fieldVerificationRequired: true,
  }
  return hasFiniteNumericFields(result)
    ? result
    : { valid: false, warning: '计算结果超出有限数值范围，请核对功放功率、输入级与输出基准。' }
}

module.exports = {
  calculateGainStructure,
  dbuToVoltage,
  resolveFullPowerInput,
  resolveStageValue,
  voltageToDbu,
}
