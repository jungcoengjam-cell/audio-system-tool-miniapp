const BALANCED_IDS = new Set(['xlrBalanced', 'trsBalanced', 'terminalBalanced'])
const MONO_IDS = new Set(['rcaMono', 'tsMono'])
const DUAL_IDS = new Set(['rcaStereo', 'tsStereo'])

function selectedChoice(model, id) {
  const requirement = (model && Array.isArray(model.requirements) ? model.requirements : [])
    .find((item) => item && item.id === id)
  return requirement && requirement.value || ''
}

function getWiringGuide(model) {
  const outputId = model?.output?.id
  const inputId = model?.input?.id
  if (outputId === 'stereo35' && DUAL_IDS.has(inputId)) return 'T → L、R → R；S 为公共回路。'
  if (outputId === 'stereo35' && (BALANCED_IDS.has(inputId) || MONO_IDS.has(inputId))) {
    return '固定取 T（左声道 L），R 不接。'
  }
  if (BALANCED_IDS.has(outputId) && BALANCED_IDS.has(inputId)) return '平衡端按 +、−、G 功能一一对应。'
  if (MONO_IDS.has(outputId) && BALANCED_IDS.has(inputId)) return '信号接 +，回路芯线接 −，屏蔽接 G。'
  if (BALANCED_IDS.has(outputId) && (MONO_IDS.has(inputId) || DUAL_IDS.has(inputId))) {
    return DUAL_IDS.has(inputId)
      ? '冷端 − 与屏蔽在输入端汇接，再分送 L/R。'
      : '冷端 − 与屏蔽只在输入端汇接。'
  }
  if (MONO_IDS.has(outputId) && DUAL_IDS.has(inputId)) return '固定 1 分 2 到 L/R。'
  if (MONO_IDS.has(outputId) && MONO_IDS.has(inputId)) return '信号与非平衡回路分别对应连接。'
  return ''
}

function getCompactWiringConditions(model) {
  if (!model || !model.supported) return []
  const outputId = model.output && model.output.id
  const inputId = model.input && model.input.id
  const conditions = []
  if (selectedChoice(model, 'outputMode') === 'coldReturn') {
    conditions.push('仅在两台设备手册允许时施工。')
  }
  if (DUAL_IDS.has(inputId) && selectedChoice(model, 'destinationChannel') === 'both') {
    conditions.push('仅接两路独立高阻 LINE 输入；核对并联负载。')
  }
  if ((MONO_IDS.has(outputId) || outputId === 'stereo35') && BALANCED_IDS.has(inputId)) {
    conditions.push('LINE 输入须关闭幻象/插孔馈电；不补偿电平差。')
  }
  return conditions.slice(0, 2)
}

module.exports = { getWiringGuide, getCompactWiringConditions }
