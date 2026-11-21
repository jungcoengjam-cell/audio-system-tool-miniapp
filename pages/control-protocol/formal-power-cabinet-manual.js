// User-supplied Modbus examples, limited to the six-channel field sample.
// Frames are copy-only and are never sent to a device.
const PDF_SHA256 = 'A7B2410B881F96287D71E8EE87BEBFC10287475D5A6D21B87C5487B5E5D6D6B4'
const XLSX_SHA256 = '14C76E03FF23C83F9050C4B463CDC956040B9AE890BD017E0396836BED553C8C'
const PDF_SECTION = '附录B：电力控制设备中控代码示例'

const sourceRows = [
  ['all-on', '全开', '全开', 5, '01 06 00 00 00 01 48 0A', '00 00 00 00 00 06 01 06 00 00 00 01'],
  ['all-off', '全关', '全关', 6, '01 06 00 00 00 00 89 CA', '00 00 00 00 00 06 01 06 00 00 00 00'],
  ['channel-01-on', '第1路通电', '第一台通道1电源通电', 7, '01 06 00 01 00 01 19 CA', '00 00 00 00 00 06 01 06 00 01 00 01'],
  ['channel-02-on', '第2路通电', '第一台通道2电源通电', 8, '01 06 00 02 00 01 E9 CA', '00 00 00 00 00 06 01 06 00 02 00 01'],
  ['channel-03-on', '第3路通电', '第一台通道3电源通电', 9, '01 06 00 03 00 01 B8 0A', '00 00 00 00 00 06 01 06 00 03 00 01'],
  ['channel-04-on', '第4路通电', '第一台通道4电源通电', 10, '01 06 00 04 00 01 09 CB', '00 00 00 00 00 06 01 06 00 04 00 01'],
  ['channel-05-on', '第5路通电', '第一台通道5电源通电', 11, '01 06 00 05 00 01 58 0B', '00 00 00 00 00 06 01 06 00 05 00 01'],
  ['channel-06-on', '第6路通电', '第一台通道6电源通电', 12, '01 06 00 06 00 01 A8 0B', '00 00 00 00 00 06 01 06 00 06 00 01'],
  ['channel-01-off', '第1路断电', '第一台通道1电源断电', 19, '01 06 00 01 00 00 D8 0A', '00 00 00 00 00 06 01 06 00 01 00 00'],
  ['channel-02-off', '第2路断电', '第一台通道2电源断电', 20, '01 06 00 02 00 00 28 0A', '00 00 00 00 00 06 01 06 00 02 00 00'],
  ['channel-03-off', '第3路断电', '第一台通道3电源断电', 21, '01 06 00 03 00 00 79 CA', '00 00 00 00 00 06 01 06 00 03 00 00'],
  ['channel-04-off', '第4路断电', '第一台通道4电源断电', 22, '01 06 00 04 00 00 C8 0B', '00 00 00 00 00 06 01 06 00 04 00 00'],
  ['channel-05-off', '第5路断电', '第一台通道5电源断电', 23, '01 06 00 05 00 00 99 CB', '00 00 00 00 00 06 01 06 00 05 00 00'],
  ['channel-06-off', '第6路断电', '第一台通道6电源断电', 24, '01 06 00 06 00 00 69 CB', '00 00 00 00 00 06 01 06 00 06 00 00'],
]

function commandsFor(transportId) {
  const isRs485 = transportId === 'rs485'
  return sourceRows.map(([idSuffix, label, sourceLabel, rs485Row, rs485Frame, udpFrame]) => ({
    id: `${transportId}-${idSuffix}`,
    label,
    sourceLabel,
    sourceWorkbookSheet: 'Sheet1',
    sourceWorkbookRow: isRs485 ? rs485Row : rs485Row + 30,
    sourcePdfPage: 9,
    sourcePdfSection: PDF_SECTION,
    frame: isRs485 ? rs485Frame : udpFrame,
    copyable: true,
    category: 'write',
  }))
}

const formalManual = {
  title: '六路智能配电箱操作参考',
  statusLabel: '用户提供的协议资料，仅作人工参考',
  sourceTitle: '中控协议',
  manualVersion: 'V1.1（2026-01-06）',
  protocolVersionLabel: '通信协议未单独标注版本；来源文档 V1.1（2026-01-06）',
  sourceSha256: PDF_SHA256,
  sourceFiles: [
    {
      fileName: '2-Light-R-D-CP-CN.pdf',
      sha256: PDF_SHA256,
      references: '第3–5页通信参数与寄存器；第9页附录B命令示例',
    },
    {
      fileName: '1-电箱中控代码整理.xlsx',
      sha256: XLSX_SHA256,
      references: 'Sheet1：RS485第5–12、19–24行；UDP第35–42、49–54行',
    },
  ],
  sourceWorkbookSha256: XLSX_SHA256,
  applicabilityNote: '仅限本次用户提供的六路电箱现场样本；柜体与控制卡品牌型号未知，协议通道与面板标记的对应关系未提供。',
  safetyNote: '仅复制静态 Modbus 请求帧至剪贴板，不连接或发送设备。现场使用前由维护人员确认设备地址、UDP IP 与通道映射。',
  versionNote: '来源文档 V1.1（2026-01-06）；未标明控制器硬件、固件或独立通信协议版本。',
  quickCommandCount: 2,
  loopCount: 6,
  loopActions: ['通电', '断电'],
  transports: [
    {
      id: 'rs485',
      name: 'RS485',
      parameters: 'Modbus-RTU · 8 数据位 · 1 停止位 · 无校验 · 波特率 4800/9600/19200/38400/115200（默认 9600） · 示例设备地址 1（0x01）',
      commands: commandsFor('rs485'),
    },
    {
      id: 'udp',
      name: 'UDP',
      parameters: 'Modbus-UDP · 端口 502 · 示例设备地址 1（0x01） · 使用现场实际 IP',
      commands: commandsFor('udp'),
    },
  ],
}

module.exports = { formalManual }
