const DSP_MAX_OUTPUT_DBU = 18.4
const DBU_REFERENCE_VOLTAGE = 0.775
const TIMING_RULES = [
  { maximumFrequency: 31, band: '≤31 Hz', attackTimeMs: 45 },
  { maximumFrequency: 63, band: '31–63 Hz', attackTimeMs: 16 },
  { maximumFrequency: 125, band: '63–125 Hz', attackTimeMs: 8 },
  { maximumFrequency: 250, band: '125–250 Hz', attackTimeMs: 4 },
  { maximumFrequency: 500, band: '250–500 Hz', attackTimeMs: 2 },
  { maximumFrequency: 1000, band: '500 Hz–1 kHz', attackTimeMs: 1 },
  { maximumFrequency: 2000, band: '1–2 kHz', attackTimeMs: 0.5 },
  { maximumFrequency: Infinity, band: '≥2 kHz', attackTimeMs: 0.3 },
]
const RELEASE_ATTACK_RATIO = 16

function round(value, digits = 2) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function getLoadImpedance(speakerImpedance, count, wiring) {
  if (count === 1) {
    return speakerImpedance
  }

  return wiring === 'parallel'
    ? speakerImpedance / count
    : speakerImpedance * count
}

function findRatedPower(powerTable, loadImpedance) {
  if (!powerTable || !Number.isFinite(loadImpedance)) {
    return null
  }

  const loadKey = Object.keys(powerTable).find(
    (key) => Math.abs(Number(key) - loadImpedance) < 0.001,
  )

  return loadKey ? powerTable[loadKey] : null
}

function calculateTiming(highPassFrequency) {
  if (!Number.isFinite(highPassFrequency) || highPassFrequency <= 0) {
    return null
  }

  const rule = TIMING_RULES.find(
    (item) => highPassFrequency <= item.maximumFrequency,
  )
  const releaseTimeMs = rule.attackTimeMs * RELEASE_ATTACK_RATIO

  return {
    highPassFrequency,
    timingBand: rule.band,
    attackTimeMs: rule.attackTimeMs,
    releaseTimeMs,
  }
}

function calculateLimiter(options = {}) {
  const {
    amplifier,
    speaker,
    count,
    wiring,
    mode,
    sensitivityVoltage,
    highPassFrequency,
  } = options

  if (
    !amplifier
    || !speaker
    || !Number.isFinite(speaker.impedance)
    || speaker.impedance <= 0
    || !Number.isFinite(speaker.ratedPower)
    || speaker.ratedPower <= 0
    || !Number.isInteger(count)
    || count < 1
    || !Number.isFinite(sensitivityVoltage)
    || sensitivityVoltage <= 0
  ) {
    return {
      valid: false,
      timingReady: false,
      warning: '当前设备或输入参数不完整，无法计算限幅器。请检查功放、音箱、数量和输入灵敏度数据。',
    }
  }

  const loadImpedance = getLoadImpedance(speaker.impedance, count, wiring)
  const totalRatedPower = speaker.ratedPower * count
  const powerTable = mode === 'bridge'
    ? amplifier.bridgePower
    : amplifier.stereoPower
  const timing = calculateTiming(highPassFrequency)

  const base = {
    loadImpedance: round(loadImpedance),
    totalRatedPower,
    wiringLabel: count === 1
      ? '单只音箱'
      : wiring === 'parallel' ? '并联' : '串联',
  }

  const resultBase = timing
    ? { ...base, ...timing, timingReady: true }
    : { ...base, timingReady: false }

  if (!powerTable || Object.keys(powerTable).length === 0) {
    return {
      ...resultBase,
      valid: false,
      warning: `${amplifier.model || '当前功放'}缺少${mode === 'bridge' ? '桥接' : '立体声'}模式功率数据，无法可靠计算。`,
    }
  }

  const amplifierRatedPower = findRatedPower(powerTable, loadImpedance)

  if (!amplifierRatedPower) {
    const supportedLoads = Object.keys(powerTable).join('Ω、')
    return {
      ...resultBase,
      valid: false,
      warning: `${amplifier.model}在${mode === 'bridge' ? '桥接' : '立体声'}模式下仅有${supportedLoads}Ω功率数据，不能可靠计算${round(loadImpedance)}Ω负载。`,
    }
  }

  const speakerAllowedVoltage = Math.sqrt(totalRatedPower * loadImpedance)
  const amplifierRatedVoltage = Math.sqrt(amplifierRatedPower * loadImpedance)
  const targetOutputVoltage = Math.min(
    speakerAllowedVoltage,
    amplifierRatedVoltage,
  )
  const limiterInputVoltage = sensitivityVoltage
    * targetOutputVoltage
    / amplifierRatedVoltage
  const limiterInputDbu = 20 * Math.log10(
    limiterInputVoltage / DBU_REFERENCE_VOLTAGE,
  )
  const thresholdDbfs = limiterInputDbu - DSP_MAX_OUTPUT_DBU
  const limitedByAmplifier = amplifierRatedVoltage < speakerAllowedVoltage

  return {
    ...resultBase,
    valid: true,
    amplifierRatedPower,
    speakerAllowedVoltage: round(speakerAllowedVoltage),
    amplifierRatedVoltage: round(amplifierRatedVoltage),
    targetOutputVoltage: round(targetOutputVoltage),
    limiterInputVoltage: round(limiterInputVoltage, 3),
    limiterInputDbu: round(limiterInputDbu),
    thresholdDbfs: round(thresholdDbfs),
    limitedBy: limitedByAmplifier ? 'amplifier' : 'speaker',
    statusText: limitedByAmplifier
      ? '功放额定输出低于音箱额定承受能力，阈值按功放满功率输入限制。'
      : '阈值按音箱额定功率计算。',
  }
}

module.exports = {
  calculateLimiter,
  calculateTiming,
  getLoadImpedance,
}
