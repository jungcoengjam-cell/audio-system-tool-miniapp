const base = require('../qa-seed-report.cjs')
const { createDefaultStageLayout } = require('../../../pages/dmx-layout/layout-model')

const projectId = base.projectId
const otherProjectId = base.otherProjectId
const snapshots = [
  {
    id: 'record-report-limiter', module: 'limiter', title: 'TC-2200B + TS-803C', summary: '阈值 -17.44 dBFS · Attack 16 ms · Release 256 ms',
    preferences: { amplifierModel: 'TC-2200B', speakerModel: 'TS-803C', count: 1, wiring: 'parallel', mode: 'stereo', sensitivityVoltage: 1, highPassFrequency: 40 },
    resultText: '限幅器参数计算\n结果性质：产品参数计算\n功放：TC-2200B\n音箱：TS-803C × 1 只/通道\n连接：单只连接 · 立体声/单通道\n功放输入灵敏度：1 V（2.2 dBu）\n总负载：4 Ω · 300 W\n限幅阈值：-17.44 dBFS（0 dBFS = +18.4 dBu）\n通道 HPF：40 Hz\n建立时间 Attack：16 ms\n释放时间 Release：256 ms\n阈值按音箱额定功率计算。\n注：按说明书额定功率作理论计算，现场仍需核对接线、标定和实际电平。',
  },
  {
    id: 'record-report-gain', module: 'gainStructure', title: 'TC-2200B · 1 V', summary: '目标峰值 -6 dBFS · 对齐衰减 10.19 dB',
    preferences: { amplifierModel: 'TC-2200B', stageValue: 1, mode: 'stereo', loadImpedance: null, targetPeakDbfs: -6 },
    resultText: '系统增益结构助手\n结果性质：厂家输入级参数与 DSP 标定计算\n功放：TC-2200B\n输入级档位：1 V（2.2 dBu）\n工作条件：按厂家输入灵敏度标定\nDSP 标定：0 dBFS = +18.4 dBu\n目标峰值：-6 dBFS = 12.4 dBu\n功放额定输出输入点：1 V = 2.21 dBu\n系统对齐衰减：10.19 dB\n衰减执行位置：DSP 最终输出\nDSP 输入表目标：节目峰值约 -6 dBFS；平均电平随节目内容与动态变化\nDSP 最终输出增益：-10.19 dB\n功放输入电平控制：0 dB 衰减\n本次衰减只在 DSP 最终输出执行，功放输入电平控制不要重复衰减。\n结果边界：系统对齐衰减只建立电气基准；相同衰减不代表相同功放功率、音箱端电压或现场声压级。\n后续步骤：先按功放、音箱和连接方式设置限幅保护，再在代表性听音位置校准现场声压。\n现场响度：让调音台工作在正常范围；如需长期大幅降低总推子，应记录并调整独立的 DSP 分区/扬声器组校准衰减，并重新复核限幅保护。\n现场复核：用测试信号、电平表和功放指示灯核对；理论值不替代实际校准。',
  },
  {
    id: 'record-report-spl', module: 'spl', title: 'TS-803C × 1 只', summary: '4 m · 107.7 dB SPL · 常规叠加',
    preferences: { speakerModel: 'TS-803C', distanceText: '4', speakerCount: 1, summationMode: 'distributed' },
    resultText: '声压级与功率估算\n结果性质：自由场理论估算\n音箱：TS-803C × 1 只\n测量距离：4 m\n叠加方式：常规叠加\n说明书灵敏度：95 dB @ 1W/1m\n总额定功率：300 W\n叠加增益：+0 dB\n1 m 理论声压级：119.8 dB SPL\n4 m 理论声压级：107.7 dB SPL\n注：自由场理论估算，实际结果受节目电平、摆位、覆盖角度、相位和房间反射影响。',
  },
  {
    id: 'record-report-cable', module: 'cable', title: '定压广播 · RVV2×0.5 mm²', summary: '100 m · 设计功率 150 W · 符合表格条件',
    preferences: { mode: 'constant', environment: 'indoor', constantPowerText: '100', constantDistanceText: '100', professionalPowerText: '300', professionalDistanceText: '50' },
    resultText: '定压广播线材选型\n结果性质：公司标准推荐\n输入总功率：100 W\n最远单程距离：100 m\n敷设环境：室内\n设计带载功率：150 W\n推荐线材：RVV2×0.5 mm²\n状态：符合表格条件\n按 100 m / 250 W 档位查表，规格只能选大不能选小。\n公司公式校核下限：0.08 mm²\n注：按公司线材标准作选型参考，实际施工仍需结合敷设方式、环境和当地规范复核。',
  },
  {
    id: 'record-report-camera', module: 'camera', title: 'TV-6124HK · 地面区域', summary: '广角端全景 · 距拍摄区前沿 4.65 m · 机械云台',
    preferences: { cameraCalculationVersion: 2, sourceMode: 'library', cameraModel: 'TV-6124HK', viewIndex: 0, viewLabel: '主镜头', definitionMode: 'angles', customMountType: 'ptz', customHorizontalFovText: '60', customVerticalFovText: '36', customSensorWidthText: '6.4', customSensorHeightText: '3.6', customFocalLengthText: '4.5', sceneMode: 'ground', heightMode: 'auto', marginPercent: 10, groundWidthText: '6', groundDepthText: '4', subjectHeightText: '1.8', planeWidthText: '6', planeHeightText: '2.5', planeBottomHeightText: '0.8', fixedCameraHeightText: '2.3' },
    resultText: '摄像机安装反算｜地面区域\n结果性质：当前模型双轴校核通过的理论最小距离\n摄像机：TV-6124HK｜主镜头｜广角端全景\n镜头端点说明：安装点位统一按广角端计算，确保能够拍全目标区域；长焦端参数仅在产品资料库中保留，用于查阅特写能力。\n拍摄区域：宽 6 m × 纵深 4 m；人物最高 1.8 m\n摄像机距区域前沿：4.65 m\n摄像机距区域中心：6.65 m\n建议镜头中心高度：2.3 m（人物最高点 + 0.5 m 安装余量）\n安装结构：机械云台\n取景方式：机械云台可在现场调整水平与俯仰；示意角度不作为固定安装要求。\n构图余量：10%\n镜头视场角：水平 71°｜垂直 42.7°\n目标最低所需视场角：水平 71°｜垂直 25.2°\n距离判定：水平下限处垂直校核通过\n计算过程：\n1. 确定真实目标边界：场地纵深保持输入值，投影目标各角点到相机取景截面；代入 宽 6 m，纵深 4 m；结果 使用镜头中心与俯仰基底\n2. 加入取景余量：投影包络总宽、总高分别 × (1 + 余量)，两侧均分；代入 1 + 10%；结果 每侧 5%\n3. 求解前沿退距：扩张后的水平、垂直投影包络同时位于镜头视场角内；代入 水平 71°，垂直 42.7°；结果 4.65 m\n计算结论：相机坐标下双轴包络校核通过，理论最小前沿退距 4.65 m；场地纵深未增加。\n资料来源：itc产品说明书 TV-6124HK.pdf｜参数页 5\n注：使用理想镜头的相机坐标包络；未计遮挡和镜头畸变，最终安装应通过样机画面复核。',
  },
  {
    id: 'record-report-led', module: 'ledScreen', title: '4.48 × 2.4 m · 模组', summary: '16:9 · 系统推荐 P1.53 · 观看 3 m',
    preferences: { wallWidthText: '6', wallHeightText: '3', topReserveText: '0.2', bottomReserveText: '0.2', frameWidthText: '5', viewingDistanceText: '3', aspectRatio: '16:9', unitKey: 'module', pitch: 'recommended' },
    resultText: 'LED 大屏尺寸预估\n现场墙面：6 × 3 m\n上/下最低预留：0.2 / 0.2 m\n目标画面比例：16:9\n实际比例：1.87:1（偏差 5.0%）\n完整单元拼装会产生比例偏差，内容按实际比例适配。\n实际屏体：4.48 × 2.4 m\n四周包边：5 cm / 边\n含包边安装外尺寸：4.58 × 2.5 m\n拼装数量：横向模组 14 × 纵向模组 15，总共 210 块\n拼装单元：320 × 160 mm\n左右余量：0.71 m / 侧\n上/下实际余量：0.25 / 0.25 m\n点间距：系统推荐 P1.53\n估算分辨率：约 2928 × 1569\n最近观看距离：3 m\n舒适观看范围：2.6～4.59 m\n观看校核：观看距离匹配\n结果为前期尺寸预估，最终以实际模组/箱体像素矩阵及结构深化为准。',
  },
  {
    id: 'record-report-dmx', module: 'dmxAddress', title: '连续自动 · 1 组 · 2 台灯具', summary: '连续自动 · A001 → A012 · 下一可用 A013',
    preferences: { startAddressText: '1', allocationMode: 'auto', groupSummary: '舞台染色灯组×2（6CH）', groups: [{ name: '舞台染色灯组', fixtureSource: 'custom', fixtureModel: '', libraryChannelCount: '', customName: '舞台染色灯组', customChannelCount: '6', channelCount: '6', fixtureCount: '2', targetUniverse: 'A' }] },
    resultText: '灯具地址码计算\n编址方式：连续自动\n起始位置：A001\n规模：1 组 · 2 台 · 12 个通道\n已用范围：A001 → A012\n下一可用：A013\n\n1. 舞台染色灯组 · 2 台 · 6 CH/台\n   #1  A001  占用 A001–A006\n   #2  A007  占用 A007–A012\n\n按分组顺序连续编址；单台灯具的全部通道必须位于同一个 DMX 域内。\n现场复核：灯具通道模式必须与本次填写一致；换模式后应重新编址，并在控台 Patch、节点域号和灯具地址菜单中逐台核对。',
  },
  {
    id: 'record-report-audio-wiring', module: 'audioWiring', title: 'XLR 平衡输出 → XLR 平衡输入', summary: '3 条连接 · 两端均已手动选择',
    preferences: { version: 1, outputId: 'xlrBalanced', inputId: 'xlrBalanced', manualSelected: { output: true, input: true }, viewMode: 'connectors', face: 'solder', selections: {} },
    resultText: '结果性质：接线参考\n\n3 针 XLR → 3 针 XLR\n输出：XLR 平衡输出（LINE OUT · 平衡单声道）\n输入：XLR 平衡输入（LINE IN · 平衡单声道）\n线材：双芯双绞屏蔽平衡音频线\n逐线连接：\n- 2 号针（+） → 2 号针（+）：信号 +\n- 3 号针（−） → 3 号针（−）：信号 −\n- 1 号针（屏蔽） → 1 号针（屏蔽）：屏蔽\n提示：仅适用于两端确认为平衡 LINE 输入/输出用途的设备；实际 pin/端子功能以设备说明书为准。\n提示：图示颜色只区分信号功能，不代表实际导线颜色。\n依据：Neutrik XLR 常见问题 https://www.neutrik.com/en/neutrik/faq/xlr\n依据：Yamaha PA 入门指南：线材与接头 https://europe.yamaha.com/en/audio/portable-pa/explore/pa-beginners-guide/equipments/cable.html\n依据：RaneNote 110：Sound System Interconnection https://www.ranecommercial.com/legacy/note110.html\n依据：Neutrik NC3FXX 原厂图（母线缆头） https://www.neutrik.com/media/8223/download/nc3fxx-1.pdf?v=1\n依据：Neutrik NC3MXX-HD 原厂图（公线缆头） https://www.neutrik.com/media/18859/download/Drawing%20NC3MXX-HD-D.pdf?v=1\n\n施工前请按具体设备型号说明书核对端口用途、端子标识和接线要求。',
  },
].map((record, index) => ({
  ...record,
  signature: JSON.stringify([record.module, record.preferences]),
  favorite: false,
  archived: false,
  projectIds: [projectId],
  projectMetadata: { [projectId]: { name: record.title, note: '', savedAt: 1792301000000 + index } },
  createdAt: 1792301000000 + index,
  updatedAt: 1792301000000 + index,
}))

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function createReportQaStorage(schemaVersion = 4) {
  const storage = base.createReportQaStorage(schemaVersion)
  const lighting = clone(storage['audioTool.dmxLightingWorkspace.v2'])
  // Mirror the persisted envelope used by lighting-workspace.js, including
  // fields that the report-model's narrower reader does not require.
  lighting.globalRevision = 1
  lighting.lastContextId = projectId
  lighting.backups = []
  lighting.legacyMirrorSignature = '[null,null,null]'
  lighting.legacyMirrorSnapshot = { preferences: 'null', progress: 'null', layout: 'null' }
  const scheme = lighting.contexts[projectId].scheme
  const fixtureIds = Object.values(scheme.fixtureIdsByGroup).flat()
  const layout = createDefaultStageLayout('12', '8', (kind, index) => `rod-report-${kind}-${index + 1}`)
  const rodId = layout.internalRods[0].id
  layout.positionsById = {
    [fixtureIds[0]]: { rodId, t: 1 / 3 },
    [fixtureIds[1]]: { rodId, t: 2 / 3 },
  }
  scheme.layout = layout
  storage['audioTool.dmxLightingWorkspace.v2'] = lighting
  storage['audioTool.records.v1'] = clone(snapshots)
  return storage
}

module.exports = {
  projectId,
  otherProjectId,
  snapshots: clone(snapshots),
  createReportQaStorage,
}
