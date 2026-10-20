const STANDARD_AREAS = [0.5, 0.75, 1, 1.5, 2, 2.5, 4, 6, 10]

const CONSTANT_VOLTAGE_ROWS = [
  { distanceMeters: 100, areas: [0.5, 0.5, 0.5, 0.5, 0.75, 0.75, 1, 1.5] },
  { distanceMeters: 250, areas: [0.5, 0.5, 0.75, 0.75, 1, 1, 1.5, 2.5] },
  { distanceMeters: 500, areas: [0.5, 0.75, 1, 1, 1.5, 2, 2.5, 4] },
  { distanceMeters: 750, areas: [0.75, 1, 1, 1.5, 2, 2.5, 4, 6] },
  { distanceMeters: 1000, areas: [1, 1.5, 1.5, 2, 2.5, 4, 6, 10] },
]

const CONSTANT_VOLTAGE_LOADS = [60, 120, 250, 350, 450, 650, 1000, 1500]

const PROFESSIONAL_SPEAKER_ROWS = [
  { designPowerW: 50, conductor: '100 芯×2', area: 0.8, currentA: 4 },
  { designPowerW: 300, conductor: '200 芯×2', area: 1.6, currentA: 8 },
  { designPowerW: 600, conductor: '300 芯×2', area: 2.4, currentA: 12 },
  { designPowerW: 800, conductor: '400 芯×2', area: 3.2, currentA: 16 },
  { designPowerW: 1500, conductor: '500 芯×2', area: 4, currentA: 20 },
]

function round(value, digits = 2) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function findFirst(items, predicate) {
  return items.find(predicate) || null
}

function findStandardArea(minimumArea) {
  return findFirst(STANDARD_AREAS, (area) => area >= minimumArea)
}

function parsePositiveNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : null
}

function calculateConstantVoltageCable({ totalPowerW, distanceMeters, environment } = {}) {
  const power = parsePositiveNumber(totalPowerW)
  const distance = parsePositiveNumber(distanceMeters)

  if (!power || !distance) {
    return { error: '请输入大于 0 的总功率和最远布线距离。' }
  }

  if (distance > 1000) {
    return { error: '公司标准规定：定压广播功放到最远喇叭的距离不能超过 1000 m。' }
  }

  const rawPower = power * 1.5
  const designPowerW = round(rawPower, 1)
  const distanceRow = findFirst(CONSTANT_VOLTAGE_ROWS, (row) => distance <= row.distanceMeters)
  const loadIndex = CONSTANT_VOLTAGE_LOADS.findIndex((load) => rawPower <= load)
  const rawArea = (rawPower / 1000) * (distance / 1000) * 5
  const formulaMinimumArea = round(rawArea, 2)

  if (loadIndex < 0) {
    const formulaArea = findStandardArea(rawArea)

    return {
      type: 'constant',
      isWithinStandard: false,
      status: '需工程复核',
      spec: formulaArea ? `RVV2×${formulaArea} mm²（公式下限）` : '超出公司线径表范围',
      selectedArea: formulaArea || 0,
      designPowerW,
      distanceMeters: distance,
      distanceBracket: `${distanceRow.distanceMeters} m`,
      formulaMinimumArea,
      hasFormula: true,
      description: '设计带载功率超过公司对照表 1500 W 上限，不能直接按表推荐线材。',
      warnings: [
        `设计带载功率为 ${designPowerW} W，已超过公司表格的 1500 W 上限。`,
        formulaArea
          ? `按公司公式计算，线芯截面积不应小于 ${formulaMinimumArea} mm²；显示规格仅为公式下限，需由工程师复核。`
          : `按公司公式计算，线芯截面积不应小于 ${formulaMinimumArea} mm²，现有常用规格表无法覆盖。`,
      ],
    }
  }

  const indoorArea = distanceRow.areas[loadIndex]
  const isOutdoor = environment === 'outdoor'
  const outdoorArea = isOutdoor ? findStandardArea(indoorArea + 1) : null
  const selectedArea = isOutdoor ? (outdoorArea || indoorArea) : indoorArea
  const warnings = []

  if (isOutdoor && !outdoorArea) {
    warnings.push('公司规定室外线材宜比室内粗约 1 mm²；当前公司常用规格表没有大于 10 mm² 的对应项，请工程复核。')
  }

  return {
    type: 'constant',
    isWithinStandard: warnings.length === 0,
    status: warnings.length === 0 ? '符合表格条件' : '需工程复核',
    spec: `RVV2×${selectedArea} mm²`,
    selectedArea,
    indoorArea,
    designPowerW,
    distanceMeters: distance,
    distanceBracket: `${distanceRow.distanceMeters} m`,
    powerBracket: `${CONSTANT_VOLTAGE_LOADS[loadIndex]} W`,
    formulaMinimumArea,
    hasFormula: true,
    description: isOutdoor
      ? `按 ${distanceRow.distanceMeters} m / ${CONSTANT_VOLTAGE_LOADS[loadIndex]} W 档位查表，并按室外要求加粗约 1 mm²。`
      : `按 ${distanceRow.distanceMeters} m / ${CONSTANT_VOLTAGE_LOADS[loadIndex]} W 档位查表，规格只能选大不能选小。`,
    warnings,
  }
}

function calculateProfessionalSpeakerCable({ totalPowerW, distanceMeters } = {}) {
  const power = parsePositiveNumber(totalPowerW)
  const distance = parsePositiveNumber(distanceMeters)

  if (!power || !distance) {
    return { error: '请输入大于 0 的音箱总功率和最远布线距离。' }
  }

  const designPowerW = round(power * 1.5, 1)
  const row = findFirst(PROFESSIONAL_SPEAKER_ROWS, (item) => designPowerW <= item.designPowerW)
  const warnings = []

  if (distance > 100) {
    warnings.push('公司规定专业音箱的定阻传输距离不应超过 100 m；超过后衰减较大，不能按本表直接推荐。')
  }

  if (!row) {
    warnings.push(`设计带载功率为 ${designPowerW} W，已超过公司金银线对照表 1500 W 上限。`)
  }

  return {
    type: 'professional',
    isWithinStandard: warnings.length === 0,
    status: warnings.length === 0 ? '符合表格条件' : '需工程复核',
    spec: row ? `秋叶原 ${row.conductor} 金银线` : '超出公司线材表范围',
    selectedArea: row ? row.area : 0,
    designPowerW,
    distanceMeters: distance,
    currentA: row ? row.currentA : 0,
    hasFormula: false,
    description: row
      ? `按音箱总功率 × 1.5 的 ${row.designPowerW} W 档位选择；本公司表中该规格最长适用于 100 m。`
      : '公司金银线对照表仅覆盖设计带载功率不超过 1500 W 的系统。',
    warnings,
  }
}

module.exports = {
  calculateConstantVoltageCable,
  calculateProfessionalSpeakerCable,
}
