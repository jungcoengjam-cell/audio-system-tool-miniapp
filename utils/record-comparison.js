const { getModuleMetadata } = require('./records')

const VALUE_LABELS = {
  wiring: { parallel: '并联', series: '串联' },
  mode: { stereo: '立体声/单通道', bridge: '桥接' },
  summationMode: { coherent: '相干叠加', power: '功率叠加', independent: '独立声源' },
  environment: { indoor: '室内', outdoor: '室外' },
  modeCable: { constant: '定压广播', professional: '专业音箱' },
  cameraSourceMode: { library: '库内摄像机', custom: '自定义摄像机' },
  cameraDefinitionMode: { angles: '已知视场角', sensor: '传感器 + 焦距' },
  cameraSceneMode: { ground: '地面区域', plane: '垂直平面' },
  cameraHeightMode: { auto: '自动建议高度', fixed: '已有安装高度' },
  gainMode: { stereo: '立体声/单通道', bridge: '桥接' },
  gainExecutionMode: { dsp: 'DSP 最终输出', amplifier: '功放输入电平控制' },
  ledUnitKey: {
    module: '模组 · 320 × 160 mm',
    cabinetStandard: '常规箱体 · 640 × 480 mm',
    cabinetPremiumA: '高端 A 系列 · 600 × 337.5 mm',
  },
  ledPitch: { recommended: '系统推荐', '1.25': 'P1.25', '1.53': 'P1.53', '1.86': 'P1.86', '2': 'P2.0' },
}

const DEFINITIONS = {
  limiter: [
    ['amplifierModel', '功放型号'], ['speakerModel', '音箱型号'], ['count', '每通道数量', '只'],
    ['wiring', '连接方式', '', 'wiring'], ['mode', '功放模式', '', 'mode'],
    ['sensitivityVoltage', '输入灵敏度', 'V'], ['highPassFrequency', '通道 HPF', 'Hz'],
  ],
  spl: [
    ['speakerModel', '音箱型号'], ['speakerCount', '音箱数量', '只'], ['distanceText', '测量距离', 'm'],
    ['summationMode', '叠加方式', '', 'summationMode'],
  ],
  cable: [
    ['mode', '线路类型', '', 'modeCable'], ['environment', '敷设环境', '', 'environment'],
    ['constantPowerText', '定压总功率', 'W'], ['constantDistanceText', '定压距离', 'm'],
    ['professionalPowerText', '专业音箱功率', 'W'], ['professionalDistanceText', '专业音箱距离', 'm'],
  ],
  camera: [
    ['sourceMode', '参数来源', '', 'cameraSourceMode'], ['cameraModel', '摄像机型号'],
    ['viewLabel', '镜头视角'],
    ['definitionMode', '自定义方式', '', 'cameraDefinitionMode'],
    ['customHorizontalFovText', '水平视场角', '°'], ['customVerticalFovText', '垂直视场角', '°'],
    ['customSensorWidthText', '有效传感器宽度', 'mm'], ['customSensorHeightText', '有效传感器高度', 'mm'],
    ['customFocalLengthText', '实际焦距', 'mm'],
    ['sceneMode', '拍摄场景', '', 'cameraSceneMode'], ['heightMode', '高度方式', '', 'cameraHeightMode'],
    ['marginPercent', '构图安全余量', '%'],
    ['groundWidthText', '区域宽度', 'm'], ['groundDepthText', '区域纵深', 'm'],
    ['subjectHeightText', '人物/物体最高点', 'm'],
    ['planeWidthText', '目标宽度', 'm'], ['planeHeightText', '目标高度', 'm'],
    ['planeBottomHeightText', '目标底边离地', 'm'],
    ['fixedCameraHeightText', '已有镜头中心高度', 'm'],
  ],
  gainStructure: [
    ['amplifierModel', '功放型号'], ['stageValue', '输入级档位'],
    ['mode', '功放模式', '', 'gainMode'], ['loadImpedance', '负载阻抗', 'Ω'],
    ['targetPeakDbfs', 'DSP 目标峰值', 'dBFS'], ['programHeadroomDb', '节目动态余量', 'dB'],
    ['executionMode', '衰减执行位置', '', 'gainExecutionMode'],
  ],
  dmxAddress: [
    ['startAddressText', 'A 域起始地址'],
    ['groupSummary', '灯具分组'],
  ],
  ledScreen: [
    ['wallWidthText', '墙体宽度', 'm'], ['wallHeightText', '墙体高度', 'm'],
    ['topReserveText', '上方预留', 'm'], ['bottomReserveText', '下方预留', 'm'],
    ['frameWidthText', '四周包边', 'cm'], ['viewingDistanceText', '最近观看距离', 'm'],
    ['aspectRatio', '画面比例'],
    ['unitKey', '拼装单元', '', 'ledUnitKey'], ['pitch', '点间距', '', 'ledPitch'],
  ],
}

function formatValue(value, unit, mapKey) {
  if (mapKey === 'discussionPagNagEnabled' && value !== true) return '未启用'
  const label = VALUE_LABELS[mapKey]?.[value]
  if (label) return label
  if (value === undefined || value === null || value === '') return '未设置'
  return `${value}${unit ? ` ${unit}` : ''}`
}

function buildRecordComparison(records) {
  if (!Array.isArray(records) || records.length !== 2 || records[0].module !== records[1].module) return null
  const [first, second] = records
  if (getModuleMetadata(first.module)?.retired) return null
  let definitions = DEFINITIONS[first.module] || []
  if (first.module === 'cable' && first.preferences.mode === second.preferences.mode) {
    definitions = definitions.filter(([key]) => first.preferences.mode === 'constant'
      ? !key.startsWith('professional')
      : key !== 'environment' && !key.startsWith('constant'))
  }
  if (first.module === 'camera' && first.preferences.sourceMode === second.preferences.sourceMode) {
    definitions = definitions.filter(([key]) => first.preferences.sourceMode === 'library'
      ? !key.startsWith('custom') && key !== 'definitionMode'
      : !['cameraModel', 'viewLabel'].includes(key))
    if (first.preferences.sourceMode === 'custom'
      && first.preferences.definitionMode === second.preferences.definitionMode) {
      definitions = definitions.filter(([key]) => first.preferences.definitionMode === 'angles'
        ? !['customSensorWidthText', 'customSensorHeightText', 'customFocalLengthText'].includes(key)
        : !['customHorizontalFovText', 'customVerticalFovText'].includes(key))
    }
  }
  if (first.module === 'camera' && first.preferences.sceneMode === second.preferences.sceneMode) {
    definitions = definitions.filter(([key]) => first.preferences.sceneMode === 'plane'
      ? !['groundWidthText', 'groundDepthText', 'subjectHeightText'].includes(key)
      : !['planeWidthText', 'planeHeightText', 'planeBottomHeightText'].includes(key))
  }
  if (first.module === 'camera'
    && first.preferences.heightMode === second.preferences.heightMode
    && first.preferences.heightMode === 'auto') {
    definitions = definitions.filter(([key]) => key !== 'fixedCameraHeightText')
  }
  const rows = definitions.map(([key, label, unit = '', mapKey = '']) => {
    const firstValue = formatValue(first.preferences[key], unit, mapKey)
    const secondValue = formatValue(second.preferences[key], unit, mapKey)
    return { key, label, firstValue, secondValue, different: firstValue !== secondValue }
  }).filter((row) => row.different)

  return {
    module: first.module,
    firstTitle: first.title,
    secondTitle: second.title,
    rows,
    identical: rows.length === 0,
  }
}

module.exports = { buildRecordComparison }
