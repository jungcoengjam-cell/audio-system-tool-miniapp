const { formalManual: smartPlcF300Manual } = require('./formal-smartplc-f300-manual')
const { formalManual: kylinK100RManual } = require('./formal-kylin-k100r-manual')

const CATEGORIES = [
  { key: 'all', label: '全部' },
  { key: 'led-power', label: 'LED 配电' },
  { key: 'audio', label: '音频' },
  { key: 'video', label: '视频' },
  { key: 'camera', label: '摄像机' },
  { key: 'lighting', label: '灯光' },
  { key: 'power', label: '电源' },
]

const visualCheck = '主代理实际查看原图：型号标识可读，未见客户姓名、地址、联系人、二维码、MAC、账号或序列号；APP1=0，未见 EXIF/XMP。该检查用于记录本次公开用途判断，不构成严格身份识别来源或具名复核。'

const referenceManuals = [
  {
    id: 'reference-smartplc-f300-01',
    title: 'SmartPLC-F300 控制卡',
    categoryKey: 'led-power',
    categoryLabel: 'LED 配电控制卡',
    aliases: ['SmartPLC-F300', 'F300', '配电箱控制卡'],
    controllerModel: 'SmartPLC-F300',
    controllerBrand: '未知',
    deviceModel: 'itC KZX（本次用户确认的样本柜）',
    controllerFirmwareVersion: '未知',
    protocolVersion: '说明书未标注，未知',
    sourceTitle: 'QN-PLC（全球款）配电柜说明书',
    documentVersion: '202511 V1.0',
    sourceSha256: '3DEF2C2A5844F3D2D1424DE76B2BD77A6FFD13E6FD5322E9DF7F8F859CD0F6E4',
    publicUseBasis: 'user-request-2026-10-05',
    applicabilityNote: '用户确认这台 itC KZX 机柜内的 SmartPLC-F300 样本协议已验证且准确。本参考仅对应这台现场样本，不代表适用于其他同型号控制卡或机柜。',
    photo: {
      id: 'reference-smartplc-f300-photo',
      path: '/pages/control-protocol/assets/smartplc-f300-reference.jpg',
      angleLabel: 'SmartPLC-F300 型号与控制卡外观',
      sha256: '2F4EEDFE79FDF8D7334970D7A4A5827D05A33C475FA1B48E5B7F5186D6AD9960',
      purpose: '仅供人工辨认控制卡标识，不用于自动识别或协议准入。',
      publicUseBasis: 'user-request-2026-10-05',
      visualCheck,
    },
    manual: smartPlcF300Manual,
  },
  {
    id: 'reference-kylin-k100r-01',
    title: '麒麟 Kylin K100R 控制卡',
    categoryKey: 'led-power',
    categoryLabel: 'LED 配电控制卡',
    aliases: ['麒麟', 'Kylin', 'K100R', '配电箱控制卡'],
    controllerModel: 'K100R',
    controllerBrand: '麒麟 Kylin（照片可见标识）',
    deviceModel: '未知',
    controllerFirmwareVersion: '未知',
    protocolVersion: '协议文档未单独标注，未知',
    sourceTitle: '麒麟 PLC 电箱中控协议',
    documentVersion: 'V1.1（2025-04-03）',
    sourceSha256: 'FB90C408CD18559C8534EF3721A1F13B4B563DB0A94F2EA43E0B01EE362D1FBA',
    publicUseBasis: 'user-request-2026-10-05',
    applicabilityNote: '用户确认本协议已现场验证且适用于照片中可见标识为麒麟 Kylin K100R 的这张控制卡。安装设备/机柜型号未知；本参考不代表适用于其他同型号控制卡或机柜。',
    photo: {
      id: 'reference-kylin-k100r-photo',
      path: '/pages/control-protocol/assets/kylin-k100r-reference.jpg',
      angleLabel: '麒麟 Kylin K100R 型号与控制卡外观',
      sha256: 'B32D37BDE592DB722F9F20E5BD68C0AF562F6ADA06A840FC23C3D3CD0E4695CF',
      purpose: '仅供人工辨认控制卡标识，不用于自动识别或协议准入。',
      publicUseBasis: 'user-request-2026-10-05',
      visualCheck,
    },
    manual: kylinK100RManual,
  },
]

const catalog = {
  appearanceGroups: [],
  deviceVariants: [],
  photos: [],
  controllerVariants: [],
  sources: [],
  protocols: [],
  referenceManuals,
}

module.exports = { CATEGORIES, catalog }
