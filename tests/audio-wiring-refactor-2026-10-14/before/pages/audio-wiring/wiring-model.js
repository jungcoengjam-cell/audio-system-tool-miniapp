const SOURCE_LIST = {
  neutrikXlr: {
    id: 'neutrikXlr',
    title: 'Neutrik XLR 常见问题',
    url: 'https://www.neutrik.com/en/neutrik/faq/xlr',
    claim: '三针 XLR：1 为屏蔽/地，2 为热端（+），3 为冷端（−）。',
  },
  yamahaCable: {
    id: 'yamahaCable',
    title: 'Yamaha PA 入门指南：线材与接头',
    url: 'https://europe.yamaha.com/en/audio/portable-pa/explore/pa-beginners-guide/equipments/cable.html',
    claim: '说明 XLR、TRS、TS、RCA 的常见音频用途；TRS 可用于立体声耳机或平衡连接，TS 与 RCA 用于非平衡信号，并提示不合适的立体声输出转接可能造成声道相消。',
  },
  rane110: {
    id: 'rane110',
    title: 'RaneNote 110：Sound System Interconnection',
    url: 'https://www.ranecommercial.com/legacy/note110.html',
    claim: '提供平衡互连与设备接口注意事项；平衡和非平衡接口的直连结果取决于具体电路，建议查明两端类型。',
  },
  rane109: {
    id: 'rane109',
    title: 'RaneNote 109：Why Not Wye?',
    url: 'https://www.ranecommercial.com/legacy/note109.html',
    claim: '两个输出不可直接并接；正确求和需要相应的电阻网络。',
  },
  jensenAN003: {
    id: 'jensenAN003',
    title: 'Jensen AN-003：平衡与非平衡设备互连',
    url: 'https://www.jensen-transformers.com/wp-content/uploads/2014/08/an003.pdf',
    claim: '展示非平衡源到平衡输入的适配及屏蔽/信号低端分工；简单直连不提供消费线路到专业线路所需的电平提升，且源阻抗不平衡会降低共模抑制。',
  },
  raneMlm82s: {
    id: 'raneMlm82s',
    title: 'Rane MLM82S 用户指南（接法限制示例）',
    url: 'https://www.ranecommercial.com/documents/userguides/MLM82S-UserGuide-v1.0.pdf',
    claim: '该型号禁止冷端接地，不适用本助手汇接方案。',
  },
  neutrikXlrFemaleDrawing: {
    id: 'neutrikXlrFemaleDrawing',
    title: 'Neutrik NC3FXX 原厂图（母线缆头）',
    url: 'https://www.neutrik.com/media/8223/download/nc3fxx-1.pdf?v=1',
    claim: '定位结构朝上时，插接面为左 2、右 1、下 3；焊接面左右镜像。',
  },
  neutrikXlrMaleDrawing: {
    id: 'neutrikXlrMaleDrawing',
    title: 'Neutrik NC3MXX-HD 原厂图（公线缆头）',
    url: 'https://www.neutrik.com/media/18859/download/Drawing%20NC3MXX-HD-D.pdf?v=1',
    claim: '定位结构朝上时，插接面为左 1、右 2、下 3；焊接面左右镜像。',
  },
}

const OUTPUT_OPTIONS = [
  {
    id: 'xlrBalanced', label: 'XLR 平衡输出', deviceLabel: '调音台',
    signalLabel: 'LINE OUT · 平衡单声道', connectorType: '3 针 XLR',
    image: '/assets/home/module-audio-wiring-catalog.png', side: 'output',
  },
  {
    id: 'trsBalanced', label: '6.35 mm TRS 平衡输出', deviceLabel: '音频设备',
    signalLabel: 'LINE OUT · 平衡单声道', connectorType: '6.35 mm TRS',
    image: '/pages/audio-wiring/assets/trs.png', side: 'output',
  },
  {
    id: 'terminalBalanced', label: '平衡端子输出', deviceLabel: '处理器',
    signalLabel: 'LINE OUT · 平衡单声道', connectorType: '平衡端子',
    image: '/pages/audio-wiring/assets/terminal.png', side: 'output',
  },
  {
    id: 'stereo35', label: '3.5 mm TRS 立体声输出', deviceLabel: '电脑/播放设备',
    signalLabel: '立体声模拟 L/R · 非平衡', connectorType: '3.5 mm TRS',
    image: '/pages/audio-wiring/assets/stereo35.png', side: 'output',
  },
  {
    id: 'rcaMono', label: 'RCA 单声道输出', deviceLabel: '音频设备',
    signalLabel: 'LINE OUT · 非平衡单声道', connectorType: 'RCA',
    image: '/pages/audio-wiring/assets/rca.png', side: 'output',
  },
  {
    id: 'tsMono', label: '6.35 mm TS 单声道 LINE 输出', deviceLabel: '音频设备',
    signalLabel: 'LINE OUT · 非平衡单声道', connectorType: '6.35 mm TS',
    image: '/pages/audio-wiring/assets/ts.png', side: 'output',
  },
]

const INPUT_OPTIONS = [
  {
    id: 'xlrBalanced', label: 'XLR 平衡输入', deviceLabel: '音频设备',
    signalLabel: 'LINE IN · 平衡单声道', connectorType: '3 针 XLR',
    image: '/assets/home/module-audio-wiring-catalog.png', side: 'input',
  },
  {
    id: 'trsBalanced', label: '6.35 mm TRS 平衡输入', deviceLabel: '音频设备',
    signalLabel: 'LINE IN · 平衡单声道', connectorType: '6.35 mm TRS',
    image: '/pages/audio-wiring/assets/trs.png', side: 'input',
  },
  {
    id: 'terminalBalanced', label: '平衡端子输入', deviceLabel: '处理器',
    signalLabel: 'LINE IN · 平衡单声道', connectorType: '平衡端子',
    image: '/pages/audio-wiring/assets/terminal.png', side: 'input',
  },
  {
    id: 'rcaStereo', label: '双 RCA 立体声输入', deviceLabel: '功放/音频设备',
    signalLabel: '立体声 L/R · 非平衡', connectorType: '双 RCA',
    image: '/pages/audio-wiring/assets/rca.png', side: 'input',
  },
  {
    id: 'tsStereo', label: '双 TS 立体声输入', deviceLabel: '音频设备',
    signalLabel: '立体声 L/R · 非平衡', connectorType: '双 6.35 mm TS',
    image: '/pages/audio-wiring/assets/ts.png', side: 'input',
  },
  {
    id: 'rcaMono', label: 'RCA 单声道输入', deviceLabel: '音频设备',
    signalLabel: 'LINE IN · 非平衡单声道', connectorType: 'RCA',
    image: '/pages/audio-wiring/assets/rca.png', side: 'input',
  },
  {
    id: 'tsMono', label: '6.35 mm TS 单声道输入', deviceLabel: '音频设备',
    signalLabel: 'LINE IN · 非平衡单声道', connectorType: '6.35 mm TS',
    image: '/pages/audio-wiring/assets/ts.png', side: 'input',
  },
]

const OUTPUT_BY_ID = Object.fromEntries(OUTPUT_OPTIONS.map((item) => [item.id, item]))
const INPUT_BY_ID = Object.fromEntries(INPUT_OPTIONS.map((item) => [item.id, item]))
const BALANCED_IDS = new Set(['xlrBalanced', 'trsBalanced', 'terminalBalanced'])
const MONO_IDS = new Set(['rcaMono', 'tsMono'])
const DUAL_IDS = new Set(['rcaStereo', 'tsStereo'])
const COLORS = { positive: '#1976d2', negative: '#ed8b23', shield: '#78818c', left: '#1976d2', right: '#7a5ce1' }

function endpoint(option, side, isKnown) {
  if (isKnown) {
    const result = { ...option }
    if (option.id === 'xlrBalanced') {
      result.cableConnectorGender = side === 'output' ? '母头' : '公头'
      result.connectorPart = side === 'output' ? 'Neutrik NC3FXX' : 'Neutrik NC3MXX-HD'
    }
    return result
  }
  const noun = side === 'output' ? '输出' : '输入'
  return {
    id: typeof option === 'string' ? option : '', label: `未知${noun}接口`, deviceLabel: '未识别设备',
    signalLabel: '接口类型未识别', connectorType: '未知接口', image: '', side, cableConnectorGender: '',
  }
}

function pin(id, role, channel = '') {
  if (id === 'xlrBalanced') {
    return role === 'positive' ? ['2', '2 号针（+）']
      : role === 'negative' ? ['3', '3 号针（−）'] : ['1', '1 号针（屏蔽）']
  }
  if (id === 'trsBalanced') {
    return role === 'positive' ? ['T', 'T 尖端（+）']
      : role === 'negative' ? ['R', 'R 环（−）'] : ['S', 'S 套筒（屏蔽）']
  }
  if (id === 'terminalBalanced') {
    return role === 'positive' ? ['+', '+（信号 +）']
      : role === 'negative' ? ['−', '−（信号 −）'] : ['G', 'G（屏蔽）']
  }
  if (id === 'stereo35') {
    if (role === 'left') return ['T', 'T 尖端（左声道 L）']
    if (role === 'right') return ['R', 'R 环（右声道 R）']
    return ['S', 'S 套筒（源端公共回路）']
  }
  if (id === 'rcaMono') {
    return role === 'signal' ? ['中心针', 'RCA 中心针（信号）']
      : ['外壳', 'RCA 外壳（非平衡回路）']
  }
  if (id === 'tsMono') {
    return role === 'signal' ? ['T', 'TS 尖端（信号）']
      : ['S', 'TS 套筒（非平衡回路）']
  }
  if (DUAL_IDS.has(id)) {
    const side = channel === 'right' ? '右' : '左'
    const short = channel === 'right' ? 'R' : 'L'
    const center = id === 'rcaStereo' ? `${short}中心` : `${short}·T`
    const shell = id === 'rcaStereo' ? `${short}外壳` : `${short}·S`
    if (role === 'signal' || role === 'left' || role === 'right') {
      return [center, `${side} ${id === 'rcaStereo' ? 'RCA 中心针' : 'TS T 尖端'}（${short}）`]
    }
    return [shell, `${side} ${id === 'rcaStereo' ? 'RCA 外壳' : 'TS S 套筒'}（${short} 回路）`]
  }
  return role === 'positive' ? ['+', '+（信号）']
    : role === 'negative' ? ['−', '−（信号）'] : ['G', 'G（屏蔽）']
}

function makeConnection(id, from, to, label, color, fromRole, toRole, networkId = id) {
  return {
    id,
    fromPin: from[0], fromLabel: from[1],
    toPin: to[0], toLabel: to[1],
    label, color, networkId, fromRole, toRole,
  }
}

function balancedConnections(outputId, inputId) {
  return ['positive', 'negative', 'shield'].map((role) => {
    const [fromPin, fromLabel] = pin(outputId, role)
    const [toPin, toLabel] = pin(inputId, role)
    const words = role === 'positive' ? ['信号 +', COLORS.positive]
      : role === 'negative' ? ['信号 −', COLORS.negative] : ['屏蔽', COLORS.shield]
    return makeConnection(role, [fromPin, fromLabel], [toPin, toLabel], words[0], words[1], role, role)
  })
}

function stereoBreakoutConnections(inputId) {
  return [
    makeConnection('left', pin('stereo35', 'left'), pin(inputId, 'signal', 'left'), '左声道 L', COLORS.left, 'left', 'left'),
    makeConnection('right', pin('stereo35', 'right'), pin(inputId, 'signal', 'right'), '右声道 R', COLORS.right, 'right', 'right'),
    makeConnection('shield-left', pin('stereo35', 'return'), pin(inputId, 'return', 'left'), '公共回路分支 · 左', COLORS.shield, 'return', 'return', 'shield'),
    makeConnection('shield-right', pin('stereo35', 'return'), pin(inputId, 'return', 'right'), '公共回路分支 · 右', COLORS.shield, 'return', 'return', 'shield'),
  ]
}

function monoConnections(outputId, inputId) {
  return [
    makeConnection('signal', pin(outputId, 'signal'), pin(inputId, 'signal'), '单声道信号', COLORS.positive, 'signal', 'signal'),
    makeConnection('return', pin(outputId, 'return'), pin(inputId, 'return'), '屏蔽/信号回路', COLORS.shield, 'return', 'return'),
  ]
}

function monoOutputBalancedInput(outputId, inputId) {
  return MONO_IDS.has(outputId) && BALANCED_IDS.has(inputId)
}

function monoOutputDualInput(outputId, inputId) {
  return MONO_IDS.has(outputId) && DUAL_IDS.has(inputId)
}

function requiredChoices(outputId, inputId) {
  const choices = []
  if (BALANCED_IDS.has(outputId) && !BALANCED_IDS.has(inputId)) {
    choices.push({
      id: 'outputMode', title: '冷端接法',
      hint: '',
      options: [
        { id: 'coldReturn', label: '冷端与屏蔽在输入端汇接', detail: '确认两台设备手册允许此接法' },
      ],
    })
  }
  if (outputId === 'stereo35' && (BALANCED_IDS.has(inputId) || MONO_IDS.has(inputId))) {
    choices.push({
      id: 'sourceChannel', title: '立体声源声道',
      hint: '本直连接法只取一路，可能遗漏另一声道内容；未选声道不接。',
      options: [
        { id: 'left', label: '左声道 L', detail: '使用 T 尖端；R 环不接。' },
        { id: 'right', label: '右声道 R', detail: '使用 R 环；T 尖端不接。' },
      ],
    })
  }
  if (monoOutputDualInput(outputId, inputId) || (BALANCED_IDS.has(outputId) && DUAL_IDS.has(inputId))) {
    choices.push({
      id: 'destinationChannel', title: '双声道输入分配',
      hint: '选择一个输入侧，或将一个输出分送到两个彼此独立的高阻 LINE 输入。',
      options: [
        { id: 'left', label: '只接左声道 L', detail: '另一侧不接。' },
        { id: 'right', label: '只接右声道 R', detail: '另一侧不接。' },
        { id: 'both', label: '分送到 L 和 R', detail: '一个输出分送两路，须确认允许负载。' },
      ],
    })
  }
  return choices
}

function unsupportedReason(outputId, inputId, knownOutput, knownInput) {
  if (!knownOutput || !knownInput) {
    if (!knownOutput && !knownInput) return '输出和输入接口选项均无法识别。请重新选择有效接口，当前没有生成接线方案。'
    return `所选${knownOutput ? '输入' : '输出'}接口选项无法识别。请重新选择有效接口，当前没有生成接线方案。`
  }
  return `未确认 ${OUTPUT_BY_ID[outputId].connectorType} 到 ${INPUT_BY_ID[inputId].connectorType} 的适用接法；当前没有生成接线方案。请核对两台设备的具体型号说明书。`
}

function getCableSummary(outputId, inputId, selections = {}) {
  if (BALANCED_IDS.has(outputId) && BALANCED_IDS.has(inputId)) return '双芯双绞屏蔽平衡音频线'
  if (outputId === 'stereo35' && DUAL_IDS.has(inputId)) return inputId === 'rcaStereo'
    ? '3.5 mm TRS 转双 RCA 立体声分线缆' : '3.5 mm TRS 转双 TS 立体声分线缆'
  if (MONO_IDS.has(outputId) && MONO_IDS.has(inputId)) return '单芯屏蔽非平衡音频线'
  if (MONO_IDS.has(outputId) && BALANCED_IDS.has(inputId)) return '双芯屏蔽音频线；源端回路汇接到屏蔽'
  if (MONO_IDS.has(outputId) && DUAL_IDS.has(inputId)) {
    return selections.destinationChannel === 'both'
      ? '单声道屏蔽线分送到双路输入（Y 分线）'
      : '单声道屏蔽线接双声道输入的一侧'
  }
  if (outputId === 'stereo35' && (BALANCED_IDS.has(inputId) || MONO_IDS.has(inputId))) {
    return BALANCED_IDS.has(inputId) ? '双芯屏蔽音频线；TRS 公共回路在源端分接' : '3.5 mm TRS 至单声道屏蔽线；只接所选声道'
  }
  if (BALANCED_IDS.has(outputId) && !BALANCED_IDS.has(inputId)) {
    if (selections.outputMode !== 'coldReturn') return '先按两台设备说明书确认冷端接法'
    return '双芯屏蔽音频线；冷端与屏蔽仅按说明书在输入端汇接'
  }
  return '无通用线材建议'
}

function sourcesFor(outputId, inputId, status) {
  if (BALANCED_IDS.has(outputId) && BALANCED_IDS.has(inputId)) {
    const sources = [SOURCE_LIST.neutrikXlr, SOURCE_LIST.yamahaCable, SOURCE_LIST.rane110]
    if (outputId === 'xlrBalanced') sources.push(SOURCE_LIST.neutrikXlrFemaleDrawing)
    if (inputId === 'xlrBalanced') sources.push(SOURCE_LIST.neutrikXlrMaleDrawing)
    return sources
  }
  if (MONO_IDS.has(outputId) && BALANCED_IDS.has(inputId)) return [SOURCE_LIST.jensenAN003, SOURCE_LIST.rane110]
  if (BALANCED_IDS.has(outputId) && !BALANCED_IDS.has(inputId)) {
    return [SOURCE_LIST.rane110, SOURCE_LIST.raneMlm82s,
      ...(DUAL_IDS.has(inputId) ? [SOURCE_LIST.rane109] : [])]
  }
  if (outputId === 'stereo35') return [SOURCE_LIST.yamahaCable, SOURCE_LIST.rane109,
    ...(BALANCED_IDS.has(inputId) ? [SOURCE_LIST.jensenAN003] : [])]
  if (MONO_IDS.has(outputId) && DUAL_IDS.has(inputId)) return [SOURCE_LIST.rane109, SOURCE_LIST.yamahaCable]
  if (MONO_IDS.has(outputId) && MONO_IDS.has(inputId)) return [SOURCE_LIST.yamahaCable, SOURCE_LIST.rane110]
  return status === 'unsupported' ? [SOURCE_LIST.rane110, SOURCE_LIST.rane109] : [SOURCE_LIST.yamahaCable]
}

function notesFor(outputId, inputId, status) {
  const common = ['图示颜色只区分信号功能，不代表实际导线颜色。']
  if (status === 'unsupported') return [
    '接法只由已确认的接口用途决定；设备场景名称不能替代具体型号说明书。', ...common,
  ]
  if (BALANCED_IDS.has(outputId) && BALANCED_IDS.has(inputId)) return [
    '仅适用于两端确认为平衡 LINE 输入/输出用途的设备；实际 pin/端子功能以设备说明书为准。',
    ...(outputId === 'terminalBalanced' || inputId === 'terminalBalanced'
      ? ['Phoenix/欧式端子按 +、−、G 功能丝印确认；实际端子排列因设备而异。'] : []),
    ...common,
  ]
  if (outputId === 'stereo35') return [
    '仅适用于电脑/播放设备的模拟立体声输出或已确认的 LINE 输出；不适用于 TRRS 耳麦、麦克风输入或数字音频口。',
    DUAL_IDS.has(inputId)
      ? 'T/R 分别对应左/右声道并送入 L/R；L/R 不可直接并接。'
      : '本直连接法只取一路，可能遗漏另一声道内容。需要两边内容时先通过播放设备或混音器合成为单声道；L/R 不可直接并接。',
    'T 为左声道、R 为右声道、S 为公共回路。',
    '输入须为 LINE 用途；关闭幻象或插孔馈电。开始播放前先调低音量，再逐步升高。',
    ...common,
  ]
  if (MONO_IDS.has(outputId) && BALANCED_IDS.has(inputId)) return [
    '仅适用于确认的非平衡单声道 LINE 输出接平衡 LINE 输入；两芯分别送入平衡输入 + 与 −，屏蔽接 G。',
    '源端非平衡回路需在源端汇接到信号低端与屏蔽；关闭输入幻象或插孔馈电。',
    '不自动补偿电平差；消费线路电平与专业线路电平可能不同。',
    ...(inputId === 'terminalBalanced' ? ['Phoenix/欧式端子按 +、−、G 功能丝印确认；排列因设备而异。'] : []),
    ...common,
  ]
  if (BALANCED_IDS.has(outputId) && !BALANCED_IDS.has(inputId)) return [
    '仅适用于两端确认为 LINE 用途，且所选冷端处理得到这两台设备说明书明确支持的组合。',
    '不得从平衡接口名称推定冷端接法；必须核对两台设备说明书。',
    '不自动补偿电平差；按设备说明书核对输入/输出接地、屏蔽和允许负载。',
    ...common,
  ]
  if (MONO_IDS.has(outputId) && DUAL_IDS.has(inputId)) return [
    '仅适用于非平衡单声道 LINE 输出与双路高阻 LINE 输入。',
    '分送 L/R 是一台输出驱动两个独立输入，不是混音；先确认两输入并联负载在输出设备允许范围内。',
    '选择单侧时另一侧信号与回路均保持未接。',
    ...common,
  ]
  if (MONO_IDS.has(outputId) && MONO_IDS.has(inputId)) return [
    '仅适用于两端确认为非平衡单声道 LINE 输入/输出用途；被动乐器拾音器不视为线路输出。',
    'RCA 中心针或 TS 尖端承载信号；外壳/套筒是非平衡信号回路。',
    ...common,
  ]
  return ['请按两台设备的具体型号说明书确认接口用途。', ...common]
}

function unconnected(side, pinInfo, reason) {
  return { side, pin: pinInfo[0], label: pinInfo[1], reason }
}

function addUnselectedDestination(unconnectedPins, inputId, selected) {
  const unselected = selected === 'left' ? 'right' : 'left'
  const label = unselected === 'left' ? '左' : '右'
  unconnectedPins.push(unconnected('input', pin(inputId, 'signal', unselected), `${label}声道未选择，保持未接。`))
  unconnectedPins.push(unconnected('input', pin(inputId, 'return', unselected), `${label}声道未选择，回路保持未接。`))
}

function monoToDualConnections(outputId, inputId, selected) {
  const channels = selected === 'both' ? ['left', 'right'] : [selected]
  const wires = []
  channels.forEach((channel) => {
    const label = channel === 'left' ? '分送到左声道 L' : '分送到右声道 R'
    wires.push(makeConnection(`signal-${channel}`, pin(outputId, 'signal'), pin(inputId, 'signal', channel),
      label, channel === 'left' ? COLORS.left : COLORS.right, 'signal', channel, 'signal'))
    wires.push(makeConnection(`return-${channel}`, pin(outputId, 'return'), pin(inputId, 'return', channel),
      `回路分支 · ${channel === 'left' ? '左' : '右'}`, COLORS.shield, 'return', 'return', 'return'))
  })
  return wires
}

function balancedToUnbalancedConnections(outputId, inputId, destination) {
  const channels = destination === 'both' ? ['left', 'right'] : [destination]
  const wires = []
  channels.forEach((channel) => {
    const outputTarget = DUAL_IDS.has(inputId) ? pin(inputId, 'signal', channel) : pin(inputId, 'signal')
    const returnTarget = DUAL_IDS.has(inputId) ? pin(inputId, 'return', channel) : pin(inputId, 'return')
    const suffix = DUAL_IDS.has(inputId) ? `-${channel}` : ''
    const channelLabel = DUAL_IDS.has(inputId) ? (channel === 'left' ? ' · 左 L' : ' · 右 R') : ''
    wires.push(makeConnection(`positive${suffix}`, pin(outputId, 'positive'), outputTarget,
      `信号 +${channelLabel}`, channel === 'right' ? COLORS.right : COLORS.positive, 'positive',
      DUAL_IDS.has(inputId) ? channel : 'signal', `positive${suffix}`))
    wires.push(makeConnection(`negative${suffix}`, pin(outputId, 'negative'), returnTarget,
      `冷端 − 接回路${channelLabel}`, COLORS.negative, 'negative', 'return', `negative${suffix}`))
    wires.push(makeConnection(`shield${suffix}`, pin(outputId, 'shield'), returnTarget,
      `屏蔽接回路${channelLabel}`, COLORS.shield, 'shield', 'return', `shield${suffix}`))
  })
  return wires
}

function monoToBalancedConnections(outputId, inputId) {
  return [
    makeConnection('signal-positive', pin(outputId, 'signal'), pin(inputId, 'positive'), '非平衡信号 → +', COLORS.positive, 'signal', 'positive'),
    makeConnection('return-negative', pin(outputId, 'return'), pin(inputId, 'negative'), '源回路芯线 → −', COLORS.negative, 'return', 'negative'),
    makeConnection('shield', pin(outputId, 'return'), pin(inputId, 'shield'), '屏蔽 → G', COLORS.shield, 'shield', 'shield'),
  ]
}

function stereoToMonoConnections(inputId, channel) {
  const chosenRole = channel === 'left' ? 'left' : 'right'
  const signal = makeConnection(`signal-${channel}`, pin('stereo35', chosenRole),
    pin(inputId, BALANCED_IDS.has(inputId) ? 'positive' : 'signal'),
    `只取${channel === 'left' ? '左声道 L' : '右声道 R'}`, channel === 'left' ? COLORS.left : COLORS.right,
    chosenRole, BALANCED_IDS.has(inputId) ? 'positive' : 'signal')
  if (!BALANCED_IDS.has(inputId)) {
    return [signal, makeConnection('return', pin('stereo35', 'return'), pin(inputId, 'return'),
      'S 公共回路 → 非平衡回路', COLORS.shield, 'return', 'return')]
  }
  return [signal,
    makeConnection('return-negative', pin('stereo35', 'return'), pin(inputId, 'negative'),
      'S 公共回路芯线 → −', COLORS.negative, 'return', 'negative'),
    makeConnection('shield', pin('stereo35', 'return'), pin(inputId, 'shield'),
      'S 公共回路屏蔽 → G', COLORS.shield, 'shield', 'shield'),
  ]
}

function selectionSummaryFor(selections) {
  const summary = []
  if (selections.outputMode === 'coldReturn') summary.push('平衡输出冷端与屏蔽按设备手册在输入回路汇接')
  if (selections.sourceChannel) summary.push(`只取${selections.sourceChannel === 'left' ? '左声道 L' : '右声道 R'}`)
  if (selections.destinationChannel) summary.push(selections.destinationChannel === 'both'
    ? '一个输出分送到 L/R 两个独立输入' : `只接${selections.destinationChannel === 'left' ? '左声道 L' : '右声道 R'}输入`)
  return summary
}

function criticalNotesFor(outputId, inputId, selections) {
  const notes = []
  if (BALANCED_IDS.has(outputId) && !BALANCED_IDS.has(inputId)) {
    notes.push('冷端与屏蔽分别接到输入回路，并只在输入端汇接；仅当这两台设备手册明确允许此具体接法时施工。')
  }
  if (outputId === 'stereo35' && (BALANCED_IDS.has(inputId) || MONO_IDS.has(inputId))) {
    notes.push(`${selections.sourceChannel === 'left' ? '右' : '左'}声道信号输出保持未接；只取一路，不将 L/R 并接。`)
  }
  if (DUAL_IDS.has(inputId) && selections.destinationChannel) {
    if (selections.destinationChannel === 'both') {
      notes.push('同一输出分送到两个独立高阻 LINE 输入，不是混音；须核对两输入并联后的负载。')
    } else {
      notes.push(`${selections.destinationChannel === 'left' ? '右' : '左'}声道输入的信号与回路均保持未接。`)
    }
  }
  if ((MONO_IDS.has(outputId) || outputId === 'stereo35') && BALANCED_IDS.has(inputId)) {
    notes.push('输入须为 LINE 用途并关闭幻象或插孔馈电；不自动补偿 6 dB 或其他电平差。')
  }
  return notes
}

function getWiringModel(outputId, inputId, selections = {}) {
  const knownOutput = typeof outputId === 'string' && Object.prototype.hasOwnProperty.call(OUTPUT_BY_ID, outputId)
  const knownInput = typeof inputId === 'string' && Object.prototype.hasOwnProperty.call(INPUT_BY_ID, inputId)
  const output = endpoint(knownOutput ? OUTPUT_BY_ID[outputId] : outputId, 'output', knownOutput)
  const input = endpoint(knownInput ? INPUT_BY_ID[inputId] : inputId, 'input', knownInput)
  const validSelections = selections && typeof selections === 'object' && !Array.isArray(selections) ? selections : {}
  const requirements = knownOutput && knownInput ? requiredChoices(outputId, inputId).map((requirement) => ({
    ...requirement,
    value: typeof validSelections[requirement.id] === 'string' ? validSelections[requirement.id] : '',
  })) : []
  const validated = requirements.every((requirement) => requirement.options.some((option) => option.id === requirement.value))
  const unsupported = !knownOutput || !knownInput || (!BALANCED_IDS.has(outputId) && !BALANCED_IDS.has(inputId)
    && outputId !== 'stereo35' && !(MONO_IDS.has(outputId) && DUAL_IDS.has(inputId))
    && !(MONO_IDS.has(outputId) && MONO_IDS.has(inputId)))
  const status = unsupported ? 'unsupported' : (requirements.length && !validated ? 'needs-choice' : 'ready')
  const selectedChoices = {}
  requirements.forEach((requirement) => {
    if (requirement.options.some((option) => option.id === requirement.value)) selectedChoices[requirement.id] = requirement.value
  })
  let connections = []
  const unconnectedPins = []
  if (status === 'ready') {
    if (BALANCED_IDS.has(outputId) && BALANCED_IDS.has(inputId)) connections = balancedConnections(outputId, inputId)
    else if (outputId === 'stereo35' && DUAL_IDS.has(inputId)) connections = stereoBreakoutConnections(inputId)
    else if (MONO_IDS.has(outputId) && MONO_IDS.has(inputId)) connections = monoConnections(outputId, inputId)
    else if (MONO_IDS.has(outputId) && BALANCED_IDS.has(inputId)) connections = monoToBalancedConnections(outputId, inputId)
    else if (BALANCED_IDS.has(outputId) && !BALANCED_IDS.has(inputId)) {
      connections = balancedToUnbalancedConnections(outputId, inputId, validSelections.destinationChannel)
      if (DUAL_IDS.has(inputId) && validSelections.destinationChannel !== 'both') {
        addUnselectedDestination(unconnectedPins, inputId, validSelections.destinationChannel)
      }
    } else if (outputId === 'stereo35' && (BALANCED_IDS.has(inputId) || MONO_IDS.has(inputId))) {
      connections = stereoToMonoConnections(inputId, validSelections.sourceChannel)
      unconnectedPins.push(unconnected('output', pin('stereo35', validSelections.sourceChannel === 'left' ? 'right' : 'left'),
        '未选择的声道输出保持未接，不与已选声道并接。'))
    } else if (monoOutputDualInput(outputId, inputId)) {
      connections = monoToDualConnections(outputId, inputId, validSelections.destinationChannel)
      if (validSelections.destinationChannel !== 'both') addUnselectedDestination(unconnectedPins, inputId, validSelections.destinationChannel)
    }
  }
  const supported = status === 'ready' && connections.length > 0
  const reason = status === 'unsupported' ? unsupportedReason(outputId, inputId, knownOutput, knownInput)
    : status === 'needs-choice' ? `需要选择：${requirements.filter((requirement) => !requirement.value ||
      !requirement.options.some((option) => option.id === requirement.value)).map((requirement) => requirement.title).join('、')}。`
      : ''
  const title = knownOutput && knownInput ? `${output.connectorType} → ${input.connectorType}` : '接线方式不可识别'
  const selectionSummary = supported ? selectionSummaryFor(selectedChoices) : []
  const criticalNotes = supported ? criticalNotesFor(outputId, inputId, selectedChoices) : []
  return {
    status, supported, reason, title, output, input, connections, requirements,
    selectionSummary, criticalNotes, unconnectedPins,
    notes: notesFor(outputId, inputId, status),
    sources: sourcesFor(outputId, inputId, status).map((source) => ({ ...source })),
    cableSummary: getCableSummary(outputId, inputId, status === 'ready' ? selectedChoices : {}),
  }
}

function buildWiringText(model) {
  if (!model || model.status !== 'ready' || !model.supported || !Array.isArray(model.connections) || !model.connections.length) {
    throw new Error('该接口组合未完成有效选择或不受支持，不能生成接线文本。')
  }
  const lines = [
    model.title,
    `输出：${model.output.label}（${model.output.signalLabel}）`,
    `输入：${model.input.label}（${model.input.signalLabel}）`,
    `线材：${model.cableSummary}`,
    ...model.selectionSummary.map((summary) => `选择：${summary}`),
    '逐线连接：',
    ...model.connections.map((connection) => `- ${connection.fromLabel} → ${connection.toLabel}：${connection.label}`),
    ...model.unconnectedPins.map((item) => `未连接：${item.side === 'output' ? '输出' : '输入'} ${item.label}（${item.reason}）`),
    ...model.criticalNotes.map((note) => `关键条件：${note}`),
    ...model.notes.map((note) => `提示：${note}`),
    ...model.sources.map((source) => `依据：${source.title} ${source.url}`),
  ]
  return lines.join('\n')
}

module.exports = {
  OUTPUT_OPTIONS,
  INPUT_OPTIONS,
  getWiringModel,
  buildWiringText,
}
