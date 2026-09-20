const PAG_NAG_INPUTS = [
  { key: 'ds', label: '嘴到话筒', unit: 'm' },
  { key: 'd0', label: '发言人到最远听众', unit: 'm' },
  { key: 'dn', label: '发言人到最近听众', unit: 'm' },
  { key: 'd1', label: '话筒到音箱', unit: 'm' },
  { key: 'd2', label: '音箱到同一最远听众', unit: 'm' },
  { key: 'nom', label: '同时开放话筒数', unit: '支' },
]

function finiteNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string' || !value.trim()) return null
  const number = Number(value.trim())
  return Number.isFinite(number) ? number : null
}

function formatRaw(value) {
  const number = finiteNumber(value)
  return number === null ? '资料不足' : String(number)
}

function formatDb(value) {
  const number = finiteNumber(value)
  if (number === null) return '资料不足'
  if (number > 0 && number < 0.1) return '+<0.1 dB'
  if (number < 0 && number > -0.1) return '-<0.1 dB'
  if (Object.is(number, -0) || number === 0) return '0.0 dB'
  return `${number.toFixed(2)} dB`
}

function formatMargin(value) {
  const number = finiteNumber(value)
  if (number === null) return '模型差值资料不足'
  if (number > 0 && number < 0.1) return '模型余量 <0.1 dB'
  if (number < 0 && number > -0.1) return '模型缺口 -<0.1 dB'
  if (Object.is(number, -0) || number === 0) return '模型差值 0.0 dB'
  return number > 0
    ? `模型余量 +${number.toFixed(2)} dB`
    : `模型缺口 -${Math.abs(number).toFixed(2)} dB`
}

function isMultipleSpeakers(review) {
  return review?.basis === 'omnidirectional-multiple-speakers'
}

function getPagNagInputs(review) {
  if (!review) return []
  const distances = review.distancesMeters || {}
  const multiple = isMultipleSpeakers(review)
  return PAG_NAG_INPUTS.map((field) => ({
    ...field,
    ...(multiple && field.key === 'd1' ? { label: '话筒到最近送声箱' } : {}),
    ...(multiple && field.key === 'd2' ? { label: '最近送声箱到最远听众' } : {}),
    value: formatRaw(field.key === 'nom' ? review.openMicrophoneCount : distances[field.key]),
  }))
}

function getPagNagInputLines(review) {
  const values = getPagNagInputs(review)
  if (!values.length) return []
  const lines = [
    `Ds嘴到话筒 ${values[0].value} m · D0发言人到最远听众 ${values[1].value} m`,
    `Dn发言人到最近听众 ${values[2].value} m · D1话筒到音箱 ${values[3].value} m`,
    `D2音箱到同一最远听众 ${values[4].value} m · NOM同时开放话筒 ${values[5].value} 支`,
  ]
  if (!isMultipleSpeakers(review)) return lines
  return [
    `Ds嘴到话筒 ${values[0].value} m · D0发言人到最远听众 ${values[1].value} m`,
    `Dn发言人到最近听众 ${values[2].value} m · D1话筒到音箱A ${values[3].value} m`,
    `D2音箱B到最远听众 ${values[4].value} m · NOM同时开放话筒 ${values[5].value} 支`,
  ]
}

function getPagNagResultLines(review) {
  if (!review) return []
  return [
    `潜在增益 PAG ${formatDb(review.pagDb)} · 所需增益 NAG ${formatDb(review.nagDb)}`,
    `${formatMargin(review.marginDb)}。全向近似，已扣6 dB稳定余量；${isMultipleSpeakers(review) ? '最近声程估算，声级/指向性差异与路由须现场复核。' : '单链路结果需现场复核。'}`,
  ]
}

function getPagNagDescription(review) {
  if (isMultipleSpeakers(review)) {
    return '多音箱取点：D1量离话筒最近且播放本话筒的音箱 A；D2量离同一最远听众最近且播放本话筒的音箱 B。排除未播放本话筒的音箱（含 Mix-Minus 排除箱）；A、B可相同。NAG以近、远听众声音相当为目标；仅作几何估算，须现场核对路由与分区。'
  }
  return '请填写同一发言人、实际送声音箱与同一最远听众之间的直线距离；NAG以近、远听众声音相当为目标。'
}

module.exports = {
  PAG_NAG_INPUTS,
  formatDb,
  formatMargin,
  formatRaw,
  getPagNagDescription,
  getPagNagInputLines,
  getPagNagInputs,
  getPagNagResultLines,
  isMultipleSpeakers,
}
