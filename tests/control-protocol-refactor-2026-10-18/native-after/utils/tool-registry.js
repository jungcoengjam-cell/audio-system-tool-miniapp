'use strict'

const { MODULES: RECORD_MODULES } = require('./records')

function recordRoute(id) {
  const module = RECORD_MODULES[id]
  if (!module || typeof module.path !== 'string') throw new Error(`Missing existing tool route: ${id}`)
  return module.path
}

const TOOLS = Object.freeze([
  {
    id: 'audioWiring', title: '接线助手', category: '布线', subtitle: '接口与信号连接',
    icon: '/assets/home/module-audio-wiring-catalog.png', path: recordRoute('audioWiring'),
  },
  {
    id: 'projectWiring', title: '通道与线缆', category: '布线', subtitle: '通道、端口与线路记录',
    icon: '/assets/home/module-project-wiring-catalog.png', path: '/pages/project-wiring/index',
  },
  {
    id: 'cable', title: '线材选型', category: '布线', subtitle: '按公司资料估算线材规格',
    icon: '/assets/home/module-cable-catalog.png', path: recordRoute('cable'),
    basis: {
      subject: '定压广播线与专业音箱线选型',
      summary: '公司对照表、带载系数与公式校核',
      what: '按单程布线距离、总功率和线材类型给出公司资料范围内的规格参考，并在表格不适用时保留公式下限与复核提示。',
      method: '定压广播线先按总功率 × 1.5 取设计带载功率，再按公司距离、功率档位查表；公式校核为 S ≥ P × L × 5。S 为单芯截面积（mm²），P 为设计带载功率（kW），L 为最远单程距离（km）。专业音箱线按公司表的设计功率档选择，长度用于核对 100 m 上限。',
      inputs: '总功率：W；最远单程距离：m；线材类别与室内/室外环境：用户选择。输出截面积：mm²，或公司表内线型。',
      sourceSummary: '带载 1.5 倍、线材规格对照表、距离档位及 S ≥ P × L × 5 均来自公司提供的《线材标准》，属于公司规则。',
      limits: '定压线距离不得超过 1000 m；表格覆盖范围以公司资料为准。实际工程还需核对敷设方式、温度、品牌参数和当地规范；公司公式不能替代施工校核。',
      sourceFiles: ['utils/cable.js · calculateConstantVoltageCable / calculateProfessionalSpeakerCable', 'docs/cable-selection.md'],
    },
  },
  {
    id: 'gainStructure', title: '增益结构', category: '音频', subtitle: 'DSP 与功放输入级匹配',
    icon: '/assets/home/module-gain-structure-catalog.png', path: recordRoute('gainStructure'),
    basis: {
      subject: 'DSP 输出与功放满功率输入级对齐',
      summary: 'dBFS、dBu、电压与对齐衰减',
      what: '估算 DSP 目标峰值与功放额定输出输入电平之间的差值，并提示将总衰减放在一个可核对的位置。',
      method: '当前设备标定下 DSP 输出 dBu = 电平 dBFS + 18.4。功放满功率输入优先读取说明书输入灵敏度；仅有电压增益时，以 V_amp = √(P_rated × Z_load)、V_in = V_amp ÷ 10^(Gain/20) 反算。系统对齐差值 = DSP 目标 dBu − 功放满功率输入 dBu。',
      inputs: 'DSP 峰值：dBFS；输入级：V、dBu 或 dB；功放额定功率：W；负载：Ω；节目动态余量：dB。中间电压：V RMS。',
      sourceSummary: '功放输入级档位及功率点取各型号说明书；0 dBFS = +18.4 dBu 是本项目用户设备实测标定。默认目标峰值 −6 dBFS、节目动态余量 12 dB 是可调整的初始建议，不是行业固定值。',
      limits: '只建立电子电平关系，不控制设备，也不替代现场电压、削波和噪声测量。只用说明书明确列出的负载功率点，不做插值；未知功放档位需现场确认。',
      sourceFiles: ['utils/gain-structure.js · calculateGainStructure', 'data/amplifier-input-stages.js', 'docs/gain-structure-calculation.md', 'docs/calculation.md'],
    },
  },
  {
    id: 'limiter', title: '限幅器', category: '音频', subtitle: '功率、电压与阈值换算',
    icon: '/assets/home/module-limiter-catalog.png', path: recordRoute('limiter'),
    basis: {
      subject: '由功放、音箱额定参数求 DSP 限幅阈值',
      summary: '负载、目标电压、dBu 与 dBFS',
      what: '按每通道总阻抗、音箱额定功率和功放明确标注的额定功率点，估算保护电压和 DSP 输入阈值。',
      method: 'Z_total 按单只/串并联关系计算；V_speaker = √(P_speaker_total × Z_total)，V_amp = √(P_amp_rated × Z_total)，V_target = min(V_speaker, V_amp)。再按功放输入灵敏度换算 V_limiter = V_sensitivity × V_target ÷ V_amp；dBu = 20 × log10(V_limiter ÷ 0.775)，Threshold_dBFS = dBu − 18.4。',
      inputs: '额定阻抗：Ω；额定功率：W；数量：只；功放模式与接法；输入灵敏度：V；可选 HPF：Hz。输出阈值：dBFS，时间建议：ms。',
      sourceSummary: '功放与音箱参数取所选型号资料及说明书。18.4 dBu 来自用户设备按 1 kHz、0 dBFS、输出增益 0 dB 测得 6.45 V RMS 后换算并采用的一位小数，不适用于所有 DSP。',
      limits: '功放功率表只采用明确给出的阻抗点，不插值。HPF 只影响 Attack/Release 分档建议，不影响阈值；时间建议基于资料中的分档逻辑，不是统一行业标准。现场仍需核对接线和实际电平。',
      sourceFiles: ['utils/limiter.js · calculateLimiter / calculateTiming', 'docs/calculation.md · 设备校准与算法说明'],
    },
  },
  {
    id: 'spl', title: '声压级', category: '音频', subtitle: '距离、功率与声压变化',
    icon: '/assets/home/module-spl-catalog.png', path: recordRoute('spl'),
    basis: {
      subject: '音箱额定灵敏度下的自由场声压估算',
      summary: '灵敏度、额定功率、距离衰减与叠加',
      what: '根据产品资料中的灵敏度、额定功率、用户选择的数量和距离，估算单点理论声压级。',
      method: '1 m 基准 = sensitivityDb + 10 × log10(ratedPower) + summationGainDb；目标距离 SPL = 1 m 基准 − 20 × log10(distanceMeters)。多只音箱的叠加增益由工具选择的模式给出：非相干按 10 × log10(N)，相干按 20 × log10(N)。',
      inputs: '灵敏度：dB SPL；额定功率：W；距离：m（当前函数要求 ≥1 m）；音箱数量：只；叠加增益：dB。',
      sourceSummary: '灵敏度和额定功率取产品资料库中对应型号的说明书参数。采用资料所列的灵敏度口径；不同测试条件不会被换算成同一口径。',
      limits: '这是自由场理论估算，不是现场实测或工程验收。房间反射、指向性、频率、功率压缩、遮挡和多个声源的相位关系会改变结果；结果比较不能替代完整声学测量。',
      sourceFiles: ['utils/spl.js · calculateSpeakerSpl / calculateSplAtDistance', 'data/equipment.js · 型号参数及 source 字段'],
    },
  },
  {
    id: 'camera', title: '摄像机视场角', category: '视频', subtitle: '视场、退距与安装几何',
    icon: '/assets/home/module-camera-catalog.png', path: recordRoute('camera'),
    basis: {
      subject: '地面区域与垂直目标面的完整安装几何',
      summary: '俯仰、目标角点投影、双轴视场与余量',
      what: '依据真实拍摄区域或垂直目标面估算水平退距、镜头中心高度建议，并校核视场角能否容纳目标。',
      method: '算法构造地面区域近/远端与底/顶的 8 个三维角点，或垂直平面的 4 个角点；以真实目标垂直方向角包络中心确定俯仰。将每个角点投影到相机 forward/right/up 坐标：q_right = ((P−C)·r)/((P−C)·f)，q_up = ((P−C)·u)/((P−C)·f)。投影包络按总宽、高余量扩张，再分别校核 ±tan(水平/垂直视场角 ÷ 2)，求最小完整可行退距。每个候选距离都会重算俯仰与投影。',
      inputs: '区域宽度、纵深、目标底/顶高度、安装高度：m；水平/垂直视场角及俯仰：°；构图余量：比例。默认余量 10% 表示总投影宽、高各增加 10%，两侧均分。',
      sourceSummary: '视场角取产品资料库所选镜头说明书中明确列出的水平、垂直参数；目标尺寸、安装位置与构图余量来自用户输入或页面建议。自动镜头高度是便于落地的建议，不是唯一解。',
      limits: '仅当说明书同时给出水平与垂直视场角时才计算完整安装距离。理论值仅适用于页面采用的瞄准规则与针孔模型，不代表其它朝向下的全局最优。只有水平角时只算水平约束并明确标注未完成垂直校核。变焦统一按说明书广角端；不含畸变、防抖裁切、遮挡、分辨率与识别距离。结果需用实际画面复核。',
      sourceFiles: ['utils/camera-fov.js · calculateGroundAreaPlacement / calculateVerticalPlanePlacement', 'utils/camera-framing.js · framingEnvelope / solveFramingDistance', 'data/cameras.js · 型号视场角及说明书来源', 'docs/camera-fov-calculation.md'],
    },
  },
  {
    id: 'ledScreen', title: 'LED 大屏', category: '视频', subtitle: '模组拼接与尺寸预估',
    icon: '/assets/home/module-led-screen-catalog.png', path: recordRoute('ledScreen'),
    basis: {
      subject: '规则墙面上的 LED 屏体整数拼装预估',
      summary: '净屏尺寸、包边余量、点间距与估算分辨率',
      what: '从墙面净空间和单元规格枚举整数行列组合，给出净屏尺寸、安装外尺寸、墙面余量及点间距观看距离参考。',
      method: '屏体宽、高 = 横向、纵向整数数量 × 单元宽、高。候选组合先按目标比例误差 ≤5% 筛选并选面积最大者；无候选时取比例误差最小、面积较大的组合。含包边安装尺寸 = 净屏尺寸 + 两侧包边。估算像素 = 净尺寸 ÷ 标称点间距并取最近整数。推荐点间距从工具内置常规规格中选择满足最近距离 ≥1.7P 的最大值；没有规格满足时选最细规格并提示观看位置偏近。',
      inputs: '墙体、预留、包边及观看距离：m；单元尺寸：mm；目标画面比例；点间距 P：mm。输出净屏和包边尺寸：m，拼装数量：块，分辨率：估算像素。',
      sourceSummary: '模组与箱体尺寸及公司常规点间距采用当前工具的内置规格；墙面尺寸、包边、观看距离和目标画面比例来自用户输入。观看距离是前期参考，不是验收标准。',
      limits: '结果是规则矩形墙面的前期预估，不替代结构、供配电、控制系统和安装深化。整数拼接可能带来比例偏差；估算分辨率依据标称点间距，不能代替厂家实际像素矩阵。点间距观看范围是工具参考，不是验收标准。',
      sourceFiles: ['utils/led-screen.js · calculateLedScreenPlan', 'docs/led-screen-calculation.md'],
    },
  },
  {
    id: 'dmxAddress', title: '灯具编址', category: '灯光', subtitle: '按通道占位顺序编址',
    icon: '/assets/home/module-dmx-address-catalog.png', path: recordRoute('dmxAddress'),
  },
  {
    id: 'controlProtocol', title: '控制协议', category: '中控', subtitle: '查看型号对应的接线与协议资料',
    icon: '/assets/home/module-control-protocol-catalog.png', path: '/pages/control-protocol/index',
  },
])

const CATEGORY_FILTERS = Object.freeze(['全部', '布线', '音频', '视频', '灯光', '中控'])
const TOOL_BY_ID = new Map(TOOLS.map((tool) => [tool.id, tool]))
const BASIS_TOOLS = Object.freeze(TOOLS.filter((tool) => tool.basis))

function getTool(id) {
  return TOOL_BY_ID.get(id) || null
}

function getTools(category = '全部') {
  return category === '全部' ? TOOLS : TOOLS.filter((tool) => tool.category === category)
}

function getBasisTool(id) {
  const tool = getTool(id)
  if (!tool || !tool.basis) return null
  return { ...tool, basisPath: `/pages/basis/detail?tool=${encodeURIComponent(tool.id)}` }
}

function getBasisTools() {
  return BASIS_TOOLS.map((tool) => ({
    id: tool.id,
    title: tool.title,
    category: tool.category,
    icon: tool.icon,
    path: `/pages/basis/detail?tool=${encodeURIComponent(tool.id)}`,
    subject: tool.basis.subject,
    summary: tool.basis.summary,
  }))
}

module.exports = {
  BASIS_TOOLS,
  CATEGORY_FILTERS,
  TOOLS,
  getBasisTool,
  getBasisTools,
  getTool,
  getTools,
}
