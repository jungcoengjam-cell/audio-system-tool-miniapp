const MODULES = {
  limiter: {
    label: '限幅器',
    path: '/pages/limiter/limiter',
    preferenceKey: 'audioTool.limiter.preferences',
    theme: 'cyan',
    trustLabel: '产品参数计算',
    trustDescription: '基于产品说明书额定参数与 DSP 电平标定计算，现场需复核接线、增益结构和实际电平。',
  },
  spl: {
    label: '声压级',
    path: '/pages/spl/spl',
    preferenceKey: 'audioTool.spl.preferences',
    theme: 'violet',
    trustLabel: '自由场理论估算',
    trustDescription: '基于说明书灵敏度、额定功率和自由场距离衰减估算，不等同于现场实测声压级。',
  },
  cable: {
    label: '线材',
    path: '/pages/cable/cable',
    preferenceKey: 'audioTool.cable.preferences',
    theme: 'amber',
    trustLabel: '公司标准推荐',
    trustDescription: '依据公司线材标准和公式校核推荐，实际施工仍需结合环境、敷设方式和当地规范复核。',
  },
  camera: {
    label: '摄像机',
    path: '/pages/camera/camera',
    preferenceKey: 'audioTool.camera.preferences',
    theme: 'blue',
    trustLabel: '光学几何估算',
    trustDescription: '基于说明书视场角或用户输入的光学参数计算覆盖范围，不代表人脸、文字或细节的有效识别距离。',
  },
  gainStructure: {
    label: '增益结构',
    path: '/pages/gain-structure/gain-structure',
    preferenceKey: 'audioTool.gainStructure.preferences',
    theme: 'teal',
    trustLabel: '厂家输入级参数计算',
    trustDescription: '基于功放说明书输入灵敏度或电压增益，以及 DSP 电平标定计算；现场仍需用测试信号和电平指示复核。',
  },
  dmxAddress: {
    label: '灯光编址',
    path: '/pages/dmx-address/dmx-address',
    preferenceKey: 'audioTool.dmxAddress.preferences',
    theme: 'indigo',
    trustLabel: 'DMX512 顺序编址',
    trustDescription: '按灯具通道模式、数量和分组顺序自动分配首地址；现场需核对灯具模式、控台 Patch 和节点域号。',
  },
  ledScreen: {
    label: 'LED 大屏',
    path: '/pages/led-screen/led-screen',
    preferenceKey: 'audioTool.ledScreen.preferences',
    theme: 'violet',
    trustLabel: '前期尺寸预估',
    trustDescription: '基于墙体尺寸、整数拼装、画面比例和点间距作前期估算，最终需结合实际像素矩阵、结构、供配电和安装深化复核。',
  },
  audioWiring: {
    label: '接线助手',
    path: '/pages/audio-wiring/index',
    preferenceKey: 'audioWiringPreferencesV1',
    theme: 'teal',
    trustLabel: '接线参考',
    trustDescription: '依据已建模的模拟音频接口组合生成接线参考；施工前须按具体设备型号说明书核对端口用途、端子标识和接线要求。',
  },
}

const LEGACY_MODULES = {
  venue: {
    label: '会议室',
    theme: 'green',
    trustLabel: '历史结果',
    trustDescription: '会议室扩声模块已移除；此历史记录仅供查看和复制，不支持恢复计算。',
    retired: true,
  },
}

function getModuleMetadata(key) {
  if (Object.prototype.hasOwnProperty.call(MODULES, key)) return MODULES[key]
  if (Object.prototype.hasOwnProperty.call(LEGACY_MODULES, key)) return LEGACY_MODULES[key]
  return undefined
}

module.exports = {
  MODULES,
  LEGACY_MODULES,
  getModuleMetadata,
}
