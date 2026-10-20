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

const QUICK_EXPLANATIONS = Object.freeze({
  cable: {
    purpose: '按单程布线距离、总功率和线材类别，提供公司资料范围内的规格参考。',
    method: '定压设计功率 P表=总功率×1.5；公司表按单程距离 m、功率 W 查档。公式中 P[kW]=P表[W]÷1000、L[km]=距离[m]÷1000，再按 S≥P×L×5 复核；专业线按公司档选，核对 100 m 上限。',
    parameters: [
      { label: '单程距离', value: '输入 m；公式 L 用 km' },
      { label: '单芯截面积', value: 'S（mm²）' },
      { label: '设计功率', value: '查表 W；公式 P 用 kW' },
      { label: '线材类别', value: '用户选择' },
    ],
    source: '带载系数、对照表和公式来自公司提供的《线材标准》，属于公司规则。',
    limit: '定压线单程距离不得超过 1000 m；公式和表格不能替代现场敷设与施工校核。',
    figureCaption: '量最远单程距离（m）；公司表按 m 与功率 W 查档，公式复核前换成 P[kW]、L[km]。',
    figureAlt: '功放到音箱的单程布线路径标出输入距离（m）；公司表用距离 m、设计功率 W 查档，公式复核前将 P表[W] 除以 1000 换成 P[kW]，将单程距离[m] 除以 1000 换成 L[km]，再按 S 大于等于 P 乘 L 乘 5 复核线芯截面积。',
  },
  gainStructure: {
    purpose: '估算 DSP 目标峰值与功放额定输出输入电平的差值，明确总衰减的核对位置。',
    method: '当前设备标定下 dBu = dBFS + 18.4；优先读取功放说明书的满功率输入级，系统对齐差值 = DSP 目标 dBu − 功放满功率输入 dBu。',
    parameters: [
      { label: 'DSP 峰值', value: 'dBFS' },
      { label: '功放输入级', value: 'V / dBu / dB' },
      { label: '额定功率 / 负载', value: 'W / Ω' },
      { label: '动态余量', value: 'dB' },
    ],
    source: '功放输入级取型号说明书；+18.4 dBu 是本项目用户设备实测标定。',
    limit: '只估算电子电平关系，不替代现场电压、削波和噪声测量；+18.4 dBu 不通用于其他设备。',
    figureCaption: 'DSP 的 dBFS 按本项目设备标定换成 dBu，再与功放满功率输入级对齐。',
    figureAlt: 'DSP 输出电平刻度通过本项目设备实测标定对应到 dBu，并与功放说明书中的满功率输入参考线比较，得到系统对齐差值和总衰减位置。',
  },
  limiter: {
    purpose: '按每通道总阻抗、音箱额定功率和功放明确的额定功率点，估算保护电压与 DSP 阈值。',
    method: 'V_target = min(√(P_speaker × Z_total), √(P_amp × Z_total))；按功放输入灵敏度换成限幅电压，再计算 dBu 与 dBFS 阈值。',
    parameters: [
      { label: '每通道总阻抗', value: 'Ω' },
      { label: '额定功率 / 数量', value: 'W / 只' },
      { label: '输入灵敏度', value: 'V' },
      { label: '阈值', value: 'dBFS' },
    ],
    source: '功放与音箱参数取所选型号资料及说明书；电平换算沿用本项目设备标定。',
    limit: '只使用说明书明确给出的功率点，不插值；+18.4 dBu 标定不适用于所有 DSP，阈值仍需现场核对。',
    figureCaption: '音箱保护电压与功放能力取较低者，再按输入灵敏度回推 DSP 限幅阈值。',
    figureAlt: '音箱保护电压 V speaker 与功放能力 V amp 取较小的保护目标电压；按输入灵敏度转为限幅电压、dBu 和 dBFS。',
  },
  spl: {
    purpose: '根据产品灵敏度、额定功率、音箱数量与距离，估算单点理论声压级。',
    method: '1 m 基准 = 灵敏度 + 10 × log₁₀(额定功率) + 叠加增益；目标 SPL = 1 m 基准 − 20 × log₁₀(距离)。',
    parameters: [
      { label: '灵敏度', value: 'dB SPL' },
      { label: '额定功率', value: 'W' },
      { label: '目标距离', value: 'm（≥ 1）' },
      { label: '数量 / 叠加模式', value: '只 / dB' },
    ],
    source: '灵敏度和额定功率取产品资料库的对应型号说明书，并按原标注口径计算。',
    limit: '自由场理论估算不包含房间反射、遮挡、指向性和复杂相位关系，不是现场实测或验收结果。',
    figureCaption: '以 1 m 灵敏度参考点为起点，沿自由场传播距离估算衰减。',
    figureAlt: '音箱周围的自由场波前以 1 米灵敏度参考点和目标距离 d 表示；通过距离衰减及多只音箱叠加增益计算目标声压。',
  },
  camera: {
    purpose: '根据拍摄区域或垂直目标面估算退距和镜头中心高度，并校核目标是否落入视场。',
    method: '投影地面区域 8 个角点或垂直目标面 4 个角点，扩张投影包络并分别校核水平、垂直视场；每个候选退距都重算俯仰与投影。',
    parameters: [
      { label: '目标尺寸 / 安装高度', value: 'm' },
      { label: '水平 / 垂直视场角', value: '°' },
      { label: '俯仰角', value: '°' },
      { label: '构图余量', value: '比例' },
    ],
    source: '视场角取所选镜头说明书；目标尺寸、安装位置和构图余量取用户输入或页面建议。',
    limit: '图为非比例几何示意；完整退距要求同时有水平与垂直视场角，结果还需用实际画面复核。',
    figureCaption: '非比例示意：完整几何角点投影、扩张包络后分别检查水平与垂直视场。',
    figureAlt: '非比例安装几何示意：地面区域按近远、底顶建立八个角点，垂直目标面有四个角点；相机按退距和俯仰将角点投影成包络，再分别校核水平及垂直视场边界。',
  },
  ledScreen: {
    purpose: '在墙面净空间内筛选整数模组行列，估算净屏尺寸、安装外尺寸和分辨率。',
    method: '屏体宽高 = 对应方向整数数量 × 单元尺寸；安装外尺寸 = 净屏尺寸 + 两侧包边，估算像素 = 净尺寸 ÷ 标称点间距 P。',
    parameters: [
      { label: '墙面尺寸 / 观看距离', value: 'm' },
      { label: '包边', value: 'cm / 边' },
      { label: '单元尺寸', value: 'mm' },
      { label: '目标比例 / 点间距', value: 'P（mm）' },
    ],
    source: '模组、箱体与常规点间距取工具内置规格；墙面、包边、观看距离和比例来自用户输入。',
    limit: '仅作规则矩形墙面的前期预估；不能替代结构、供配电、控制系统深化或厂家实际像素矩阵。',
    figureCaption: '墙面尺寸扣除上下预留与包边后，以整数行列拼出净屏。',
    figureAlt: '矩形墙面标出上下预留、LED 净屏和按厘米每边输入的包边；内部网格表示整数行列模组，净屏尺寸以米计。',
  },
})

function buildBasisPresentation(tool) {
  if (!tool || !tool.basis) return null
  const { basis } = tool
  const quick = QUICK_EXPLANATIONS[tool.id] || null
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
    quick,
    figure: quick ? {
      src: '/assets/basis/' + tool.id + '.png',
      alt: quick.figureAlt,
      caption: quick.figureCaption,
    } : null,
    completeExplanation: {
      what: basis.what,
      method: basis.method,
      inputs: basis.inputs,
      sourceSummary: basis.sourceSummary,
      limits: basis.limits,
    },
  }
}

module.exports = { buildBasisPresentation, makeInputRows, sourceTags, splitPreservingPunctuation, splitLimits, splitMethodGroup }
