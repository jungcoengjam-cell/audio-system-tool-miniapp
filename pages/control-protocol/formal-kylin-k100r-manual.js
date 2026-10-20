// Static control-request frames transcribed from the user-supplied K100R protocol.
// Read/query requests and controller responses are intentionally excluded.
// UDP frames retain the source example MAC as provenance only; the UI must replace it
// with an explicitly entered现场 MAC before exposing a copyable frame.
const sourceMac = '66 88 31 F3 7F 1C'
const relayRows = [
  { loop: 1, closeParagraph: 39, openParagraph: 41, udpCloseParagraph: 44, udpOpenParagraph: 46, closeRtu: '32 05 00 00 FF 00 89 F9', openRtu: '32 05 00 00 00 00 C8 09' },
  { loop: 2, closeParagraph: 50, openParagraph: 52, udpCloseParagraph: 55, udpOpenParagraph: 57, closeRtu: '32 05 00 01 FF 00 D8 39', openRtu: '32 05 00 01 00 00 99 C9' },
  { loop: 3, closeParagraph: 61, openParagraph: 63, udpCloseParagraph: 66, udpOpenParagraph: 68, closeRtu: '32 05 00 02 FF 00 28 39', openRtu: '32 05 00 02 00 00 69 C9' },
  { loop: 4, closeParagraph: 73, openParagraph: 75, udpCloseParagraph: 78, udpOpenParagraph: 80, closeRtu: '32 05 00 03 FF 00 79 F9', openRtu: '32 05 00 03 00 00 38 09' },
  { loop: 5, closeParagraph: 85, openParagraph: 87, udpCloseParagraph: 90, udpOpenParagraph: 92, closeRtu: '32 05 00 04 FF 00 C8 38', openRtu: '32 05 00 04 00 00 89 C8' },
  { loop: 6, closeParagraph: 97, openParagraph: 99, udpCloseParagraph: 102, udpOpenParagraph: 104, closeRtu: '32 05 00 05 FF 00 99 F8', openRtu: '32 05 00 05 00 00 D8 08' },
  { loop: 7, closeParagraph: 109, openParagraph: 111, udpCloseParagraph: 114, udpOpenParagraph: 116, closeRtu: '32 05 00 06 FF 00 69 F8', openRtu: '32 05 00 06 00 00 28 08' },
  { loop: 8, closeParagraph: 121, openParagraph: 123, udpCloseParagraph: 126, udpOpenParagraph: 128, closeRtu: '32 05 00 07 FF 00 38 38', openRtu: '32 05 00 07 00 00 79 C8' },
]

function command(id, label, sourceLabel, sourceParagraph, frame, extra = {}) {
  return { id, label, sourceLabel, sourceParagraph, frame, copyable: extra.requiresDeviceMac !== true, category: 'write', ...extra }
}

const rs485Commands = []
const udpCommands = []
relayRows.forEach((row) => {
  const suffix = String(row.loop).padStart(2, '0')
  const loopAddress = (0x30 + row.loop).toString(16).toUpperCase().padStart(2, '0')
  const loopLabel = `第${row.loop}路`
  rs485Commands.push(command(`rs485-relay-${suffix}-close`, `${loopLabel}闭合`, '闭合', row.closeParagraph, row.closeRtu))
  rs485Commands.push(command(`rs485-relay-${suffix}-open`, `${loopLabel}断开`, '断开', row.openParagraph, row.openRtu))
  udpCommands.push(command(`udp-relay-${suffix}-close`, `${loopLabel}闭合`, '闭合', row.udpCloseParagraph, `43 53 52 59 ${sourceMac} ${loopAddress}`, { macByteStart: 4, requiresDeviceMac: true }))
  udpCommands.push(command(`udp-relay-${suffix}-open`, `${loopLabel}断开`, '断开', row.udpOpenParagraph, `4F 53 52 59 ${sourceMac} ${loopAddress}`, { macByteStart: 4, requiresDeviceMac: true }))
})

rs485Commands.push(
  command('rs485-all-close', '一键闭合继电器', '一键闭合继电器', 133, '32 06 00 00 00 01 4D C9', { group: 'common' }),
  command('rs485-all-open', '一键断开继电器', '一键断开继电器', 135, '32 06 00 01 00 01 1C 09', { group: 'common' }),
)
udpCommands.push(
  command('udp-all-close', '一键闭合继电器', '一键闭合继电器', 145, `43 52 4C 59 ${sourceMac}`, { group: 'common', macByteStart: 4, requiresDeviceMac: true }),
  command('udp-all-open', '一键断开继电器', '一键断开继电器', 147, `4F 52 4C 59 ${sourceMac}`, { group: 'common', macByteStart: 4, requiresDeviceMac: true }),
)

const formalManual = {
  title: '麒麟 K100R 控制卡操作参考',
  statusLabel: '用户确认该现场样本协议已验证',
  sourceTitle: '麒麟 PLC 电箱中控协议',
  manualVersion: 'V1.1（2025-04-03）',
  protocolVersionLabel: '协议版本未单独标注',
  sourceSha256: 'FB90C408CD18559C8534EF3721A1F13B4B563DB0A94F2EA43E0B01EE362D1FBA',
  applicabilityNote: '用户确认本协议已现场验证且适用于照片中可见标识为麒麟 Kylin K100R 的这张控制卡；此参考不能外推至其他同型号控制卡或机柜。安装设备/机柜型号和控制卡硬件/固件版本未知。',
  safetyNote: '只将静态控制请求帧复制到剪贴板，不连接或发送设备。操作前确认设备处于自动模式；连续操作多个继电器时建议至少间隔 3 秒。',
  versionNote: 'V1.1 是协议文档版本，不代表设备硬件或固件版本。',
  quickCommandCount: 2,
  loopCount: 8,
  loopActions: ['闭合', '断开'],
  sourceMacExample: sourceMac,
  transports: [
    {
      id: 'rs485', name: 'RS485', parameters: '9600 baud · 8 数据位 · 1 停止位 · 无校验 · 默认站号 50',
      note: 'Modbus RTU 请求帧；站号 50（0x32）。', commands: [...rs485Commands.slice(-2), ...rs485Commands.slice(0, -2)],
    },
    {
      id: 'udp', name: 'UDP', parameters: '主机 IP 192.168.1.101 · 端口 1460',
      note: '文档中的 MAC 为示范控制器示例值，必须按当前控制器调整。当前照片的实际 MAC 尚未确认。',
      macByteStart: 4, commands: [...udpCommands.slice(-2), ...udpCommands.slice(0, -2)],
    },
  ],
}

module.exports = { formalManual }
