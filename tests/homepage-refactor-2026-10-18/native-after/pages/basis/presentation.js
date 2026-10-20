'use strict'

function splitPreservingPunctuation(text, punctuation = /[；。]/) {
  const parts = []
  let start = 0
  for (let index = 0; index < text.length; index += 1) {
    if (!punctuation.test(text[index])) continue
    parts.push(text.slice(start, index + 1))
    start = index + 1
  }
  if (start < text.length) parts.push(text.slice(start))
  return parts.filter((part) => part.length > 0)
}

function splitLimits(text) {
  let parts = splitPreservingPunctuation(text, /。/)
  if (parts.length === 1) parts = splitPreservingPunctuation(text, /[；。]/)
  while (parts.length > 4) {
    const last = parts.pop()
    parts[parts.length - 1] += last
  }
  return parts
}

function makeInputRows(text) {
  return splitPreservingPunctuation(text, /[；。]/).map((part, index) => {
    const ending = /[；。]$/.test(part) ? part.slice(-1) : ''
    const body = ending ? part.slice(0, -1) : part
    const colonAt = body.indexOf('：')
    return {
      id: `input-${index + 1}`,
      full: colonAt < 0,
      label: colonAt < 0 ? '' : body.slice(0, colonAt),
      separator: colonAt < 0 ? '' : '：',
      meaning: colonAt < 0 ? `${body}${ending}` : body.slice(colonAt + 1),
      ending: colonAt < 0 ? '' : ending,
    }
  })
}

function splitMethodGroup(text) {
  const assignment = /[A-Za-z_][A-Za-z0-9_]*\s*(?:=|≥|≤)/.exec(text)
  if (assignment) {
    return { lead: text.slice(0, assignment.index), equation: text.slice(assignment.index) }
  }
  const operator = /[=≥≤]/.exec(text)
  if (operator) return { lead: '', equation: text }
  return { lead: '', equation: '' }
}

function sourceTags(sourceSummary) {
  const rules = [
    [/用户设备[^。；]*实测|用户设备按[^。；]*测得/, '用户设备实测'],
    [/公司[^。；]*线材标准/, '公司线材标准'],
    [/说明书/, '所选型号说明书'],
    [/用户输入/, '用户输入'],
    [/用户选择/, '用户选择'],
    [/内置规格/, '工具内置规格'],
  ]
  return rules.filter(([pattern]) => pattern.test(sourceSummary)).map(([, label]) => label)
}

const PATH_STEPS = Object.freeze({
  cable: ['设计带载功率', '公司距离与功率档位查表', '公式下限与长度边界复核'],
  gainStructure: ['DSP 输出标定', '功放满功率输入级', '计算系统对齐差值'],
  limiter: ['汇总负载与功率', '比较目标电压', '换算输入灵敏度与 dBu', '得到 dBFS 阈值'],
  spl: ['读取灵敏度与额定功率', '按数量模式叠加', '按目标距离衰减'],
  camera: ['建立目标角点', '投影到相机坐标', '扩张投影包络', '校核水平与垂直视场'],
  ledScreen: ['枚举整数行列', '筛选画面比例', '计算尺寸与估算像素'],
})

function buildBasisPresentation(tool) {
  if (!tool || !tool.basis) return null
  const { basis } = tool
  const pathSteps = (PATH_STEPS[tool.id] || []).map((label, index) => ({ number: index + 1, label }))
  const methodGroups = splitPreservingPunctuation(basis.method).map((text, index) => ({
    number: index + 1,
    text,
    ...splitMethodGroup(text),
  }))
  return {
    pathSteps,
    pathRows: Array.from({ length: Math.ceil(pathSteps.length / 2) }, (_, index) => ({
      number: index + 1,
      first: pathSteps[index * 2],
      second: pathSteps[index * 2 + 1] || null,
    })),
    methodGroups,
    inputRows: makeInputRows(basis.inputs),
    sourceTags: sourceTags(basis.sourceSummary),
    limitRows: splitLimits(basis.limits).map((text, index) => ({ number: index + 1, text })),
  }
}

module.exports = { buildBasisPresentation, makeInputRows, sourceTags, splitPreservingPunctuation, splitLimits, splitMethodGroup }
