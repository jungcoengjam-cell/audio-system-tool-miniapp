const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { catalog: productionCatalog } = require('../pages/control-protocol/catalog')
const { developmentSampleCatalog } = require('../pages/control-protocol/development-sample')
const { developmentManual } = require('../pages/control-protocol/development-manual')
const { developmentK100RManual } = require('../pages/control-protocol/development-k100r-manual')
const { selectProtocolCatalog } = require('../pages/control-protocol/runtime-catalog')
const {
  getDevelopmentDraftPhotos,
  getDevelopmentDraftPhotosForAppearanceGroup,
  searchGallery,
  resolveAppearanceGroupProtocol,
} = require('../pages/control-protocol/model')
const { evaluateDraftProtocolPackageGate } = require('./control-protocol-package-gate')

const emptyCatalog = {
  appearanceGroups: [],
  deviceVariants: [],
  photos: [],
  controllerVariants: [],
  sources: [],
  protocols: [],
}
assert.deepEqual(productionCatalog, emptyCatalog, '生产目录应为空，不得填入虚构设备、照片或协议')
assert.equal(searchGallery(productionCatalog).length, 0, '空目录不应渲染虚构图库数据')
assert.strictEqual(selectProtocolCatalog('develop'), developmentSampleCatalog,
  '开发版应使用独立草稿样本目录')
for (const envVersion of ['trial', 'release', '', 'unknown']) {
  assert.strictEqual(selectProtocolCatalog(envVersion), productionCatalog,
    `${envVersion || '未知'} 环境不得展示开发草稿`)
}
const draftGallery = searchGallery(developmentSampleCatalog)
assert.equal(draftGallery.length, 2, '开发版图库应展示两个相互独立的控制卡样本')
assert.equal(draftGallery[0].group.title, 'SmartPLC-F300 控制卡', '图库主标题必须突出柜内控制卡型号')
assert.equal(draftGallery[0].group.sampleStatusLabel, '柜内 F300 样本协议已验证 · 开发预览', '开发图库需表达本样本协议已验证且仍为开发预览')
assert.equal(draftGallery[0].photo.id, 'draft-smartplc-f300-interior-photo', '开发版卡片封面必须是柜内控制卡照片')
assert.equal(draftGallery[0].photo.ownerType, 'controllerVariant', '图库封面照片归属控制卡变体')
assert.equal(draftGallery[0].photo.authorizationConfirmed, false, '不得虚构照片授权确认')
assert.equal(draftGallery[0].photo.redactionReviewed, false, '不得虚构脱敏复核')
assert.equal(draftGallery[0].entryLabel, '查看协议', '开发版图库入口应直接查看协议')
assert.equal(developmentSampleCatalog.controllerVariants.length, 2, '两个样本各自对应一个独立控制卡记录')
assert.equal(developmentSampleCatalog.appearanceGroups[1].id, 'draft-kylin-k100r-sample', 'K100R 使用独立外观组')
assert.equal(developmentSampleCatalog.appearanceGroups[1].developmentManual, developmentK100RManual, 'K100R 单独关联其协议摘录')
assert.equal(developmentSampleCatalog.deviceVariants[1].model, '', 'K100R 安装设备型号保持未知')
assert.equal(developmentSampleCatalog.controllerVariants[1].model, 'K100R', '控制卡型号来自可见标签')
assert.equal(developmentSampleCatalog.controllerVariants[1].version, '', '不得虚构控制卡固件版本')
assert.equal(developmentSampleCatalog.photos[1].ownerId, 'draft-controller-kylin-k100r', 'K100R 照片只归属对应控制卡变体')
assert.equal(developmentSampleCatalog.photos[1].authorizationConfirmed, false, '不得虚构 K100R 照片授权')
assert.equal(developmentSampleCatalog.sources.find((source) => source.id === 'draft-kylin-k100r-protocol-source').reviewerId, '', '不得虚构 K100R 协议复核人')
assert.equal(developmentSampleCatalog.protocols.length, 0, '开发样本不得填入可执行协议')
assert.strictEqual(developmentSampleCatalog.appearanceGroups[0].developmentManual, developmentManual,
  '只有开发样本组关联静态手册摘录数据')
assert.match(developmentSampleCatalog.appearanceGroups[0].manualMappingNote, /用户确认这台 itC KZX 柜内 SmartPLC-F300 样本所用控制协议已验证且准确无误/,
  '样本资料应限定用户确认的协议适用范围到这台柜内 F300 样本')
assert.match(developmentManual.statusLabel, /用户确认该样本协议已验证/)
assert.match(developmentManual.applicabilityNote, /已验证且准确无误/)
assert.equal(draftGallery[0].deviceVariants[0].brand, 'itC', '适用柜体品牌保留来源资料')
assert.equal(draftGallery[0].deviceVariants[0].model, 'KZX', '适用柜体型号保留来源资料')
assert.equal(draftGallery[0].deviceVariants[0].version, '', '不得虚构设备固件版本')
assert(!/itC|KZX/.test(draftGallery[0].group.title), '不得用机柜外壳身份作为控制卡图库主标题')
const draftGroupPhotos = getDevelopmentDraftPhotosForAppearanceGroup(developmentSampleCatalog, 'draft-smartplc-f300-sample')
assert.deepEqual(draftGroupPhotos.map((photo) => photo.id), ['draft-smartplc-f300-interior-photo'],
  '详情页只展示关联到 SmartPLC-F300 控制卡的柜内照片')
assert.equal(draftGroupPhotos[0].ownerId, 'draft-controller-smartplc-f300', '照片必须仅归属 F300 控制卡变体')
assert(!developmentSampleCatalog.photos.some((photo) => /itc-kzx-cabinet-front/.test(photo.id)),
  '柜体正面照不得进入开发样本 photos 数组')
assert.equal(getDevelopmentDraftPhotos(developmentSampleCatalog, 'appearanceGroup', 'draft-smartplc-f300-sample').length, 0,
  '机柜外壳照片不进入控制卡图库或详情展示')
const originalDevelopmentPhotos = developmentSampleCatalog.photos
const originalDevelopmentSources = developmentSampleCatalog.sources
const fixtureShellDraftPhoto = {
  id: 'fixture-shell-draft-photo', ownerType: 'appearanceGroup', ownerId: 'draft-smartplc-f300-sample',
  status: 'draft', developmentOnly: true, path: '/fixture/shell-draft.jpg', sourceId: 'fixture-shell-draft-source',
  authorizationConfirmed: false, redactionReviewed: false,
}
const fixtureShellApprovedPhoto = {
  id: 'fixture-shell-approved-photo', ownerType: 'appearanceGroup', ownerId: 'draft-smartplc-f300-sample',
  status: 'ready', path: '/fixture/shell-approved.jpg', sourceId: 'fixture-shell-approved-source',
  authorizationConfirmed: true, redactionReviewed: true,
}
developmentSampleCatalog.photos = [...originalDevelopmentPhotos, fixtureShellDraftPhoto, fixtureShellApprovedPhoto]
developmentSampleCatalog.sources = [...originalDevelopmentSources, {
  id: 'fixture-shell-approved-source', title: 'Fixture cabinet photo', status: 'verified',
  reviewerId: 'fixture-reviewer', authorizationConfirmed: true,
}]
assert.deepEqual(
  getDevelopmentDraftPhotosForAppearanceGroup(developmentSampleCatalog, 'draft-smartplc-f300-sample').map((photo) => photo.id),
  ['draft-smartplc-f300-interior-photo'],
  '开发样本照片 helper 必须只返回唯一控制卡变体的 draft 照片，不返回外观组/机柜照',
)
assert.equal(searchGallery(developmentSampleCatalog)[0].photo.id, 'draft-smartplc-f300-interior-photo',
  '开发图库封面不得被同组 draft 或已审核外壳照片抢先')
developmentSampleCatalog.photos = originalDevelopmentPhotos
developmentSampleCatalog.sources = originalDevelopmentSources
assert.equal(resolveAppearanceGroupProtocol(developmentSampleCatalog, 'draft-smartplc-f300-sample').reason,
  'appearance-mapping-unreviewed', '缺失映射复核时开发样本不得开放协议')
const reviewedButStillDraftPhoto = {
  ...developmentSampleCatalog,
  appearanceGroups: developmentSampleCatalog.appearanceGroups.map((group) => ({
    ...group, directMappingReviewed: true, mappingReviewerId: 'fixture-only-reviewer',
  })),
}
assert.equal(resolveAppearanceGroupProtocol(reviewedButStillDraftPhoto, 'draft-smartplc-f300-sample').reason,
  'appearance-photo-missing', '仅有 draft 照片时不得计入协议准入的审核照片')

assert.deepEqual(developmentManual.transports.map((transport) => transport.id), ['tcp', 'rtu'])
assert.equal(developmentManual.transports[0].parameters, '默认 IP 192.168.1.200 · 端口 502')
assert.match(developmentManual.transports[0].note, /手册示例帧中的 Unit ID 为 0x32/)
assert.equal(developmentManual.transports[1].parameters, '站号 50 · 9600 baud · 8 数据位 · 1 停止位 · 无校验')
assert.equal(developmentManual.transports.reduce((count, transport) => count + transport.commands.length, 0), 168,
  '开发预览静态摘录只保留 TCP/RTU 各 84 条控制写入请求')
for (const transport of developmentManual.transports) {
  assert.equal(transport.commands.filter((command) => command.category === 'write').length, 84,
    `${transport.name} 写命令数应为84`)
  assert.equal(transport.commands.some((command) => command.category === 'read'), false,
    `${transport.name} 详情静态摘录不得包含读取请求`)
}
developmentManual.transports[0].commands.forEach((command) => {
  const bytes = command.frame.split(/\s+/).map((part) => Number.parseInt(part, 16))
  assert.equal(bytes.length, 12, `${command.id} TCP 帧应为12字节`)
  assert.equal((bytes[4] << 8) | bytes[5], 6, `${command.id} TCP MBAP length 应为6`)
})
const allManualCommandIds = developmentManual.transports.flatMap((transport) => transport.commands.map((command) => command.id))
assert.equal(new Set(allManualCommandIds).size, 168, 'TCP与RTU控制命令 ID 必须全局唯一，复制不可串帧')
const canonicalManualRows = developmentManual.transports.flatMap((transport) => transport.commands.map((command) => [
  transport.id, command.id, command.sourceParagraph, command.sourceLabel, command.frame, command.copyable,
]))
assert.equal(crypto.createHash('sha256').update(JSON.stringify(canonicalManualRows)).digest('hex').toUpperCase(),
  '77C0240A8B89F011DF445E9B53AE036003213D026BAB35B5D317E6001D198AA1',
  '168条控制写入命令的来源段落、原文标签、帧内容与复制状态摘要须与核对后的DOCX摘录一致')
assert.equal(developmentManual.transports[0].commands[3].label, '急停取消', '按钮标签应忠实保留手册术语')
function modbusCrc16(bytes) {
  let crc = 0xFFFF
  bytes.forEach((byte) => {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? ((crc >>> 1) ^ 0xA001) : (crc >>> 1)
  })
  return crc
}
developmentManual.transports[1].commands.filter((command) => command.copyable).forEach((command) => {
  const bytes = command.frame.split(/\s+/).map((part) => Number.parseInt(part, 16))
  assert(bytes.length >= 4, `${command.id} RTU帧长度异常`)
  const suppliedCrc = bytes.at(-2) | (bytes.at(-1) << 8)
  assert.equal(suppliedCrc, modbusCrc16(bytes.slice(0, -2)), `${command.id} RTU CRC16不匹配`)
})

const k100rCommands = developmentK100RManual.transports.flatMap((transport) => transport.commands.map((command) => [
  transport.id, command.id, command.sourceParagraph, command.sourceLabel, command.frame, command.copyable,
]))
assert.equal(k100rCommands.length, 36, 'K100R 只摘录 8 路各两种操作及两条一键操作、分别对应两种传输')
assert.equal(new Set(k100rCommands.map((row) => row[1])).size, 36, 'K100R 36 条命令 ID 必须唯一')
assert.equal(developmentK100RManual.transports.reduce((count, transport) => count + transport.commands.length, 0), 36)
assert(developmentK100RManual.transports.every((transport) => transport.commands.every((command) => command.category === 'write')),
  'K100R 只录入控制请求，不含查询/读取或控制器返回')
assert.equal(developmentK100RManual.transports[0].commands.length, 18, 'RS485 含 16 条单路及 2 条一键控制请求')
assert.equal(developmentK100RManual.transports[1].commands.length, 18, 'UDP 含 16 条单路及 2 条一键控制请求')
assert.equal(developmentK100RManual.transports[0].commands[0].frame, '32 06 00 00 00 01 4D C9', 'RS485 一键闭合使用功能码 06')
assert.equal(developmentK100RManual.transports[0].commands[2].frame, '32 05 00 00 FF 00 89 F9', 'RS485 单路闭合使用功能码 05')
assert.equal(developmentK100RManual.transports[1].commands[0].frame, '43 52 4C 59 66 88 31 F3 7F 1C', 'UDP 一键示例帧为 10 字节')
assert.equal(developmentK100RManual.transports[1].commands[2].frame, '43 53 52 59 66 88 31 F3 7F 1C 31', 'UDP 单路示例帧为 11 字节')
assert(developmentK100RManual.transports[1].commands.every((command) => command.requiresDeviceMac === true && command.copyable === false),
  'UDP 原始示例帧始终不可直接复制，必须替换现场 MAC')
assert.equal(developmentK100RManual.sourceSha256, 'FB90C408CD18559C8534EF3721A1F13B4B563DB0A94F2EA43E0B01EE362D1FBA', '协议摘录须记录来源文件哈希')
assert.equal(crypto.createHash('sha256').update(JSON.stringify(k100rCommands)).digest('hex').toUpperCase(), 'D00502DB2297C8C9AA1FB5E7CD2E8FB898CC4670B50919B48D80568796F98171',
  '36 条 K100R 控制请求的来源段落、标签、源帧及复制状态摘要')

function capturePageInEnvironment(pageRelativePath, envVersion) {
  const runtimePath = require.resolve('../pages/control-protocol/runtime-catalog')
  const pagePath = require.resolve(pageRelativePath)
  const priorRuntime = require.cache[runtimePath]
  const priorPage = require.cache[pagePath]
  const priorWx = global.wx
  const priorPageApi = global.Page
  let definition
  try {
    global.wx = { getAccountInfoSync: () => ({ miniProgram: { envVersion } }) }
    global.Page = (value) => { definition = value }
    delete require.cache[runtimePath]
    delete require.cache[pagePath]
    require(pagePath)
    return definition
  } finally {
    if (priorRuntime) require.cache[runtimePath] = priorRuntime
    else delete require.cache[runtimePath]
    if (priorPage) require.cache[pagePath] = priorPage
    else delete require.cache[pagePath]
    if (priorWx === undefined) delete global.wx
    else global.wx = priorWx
    if (priorPageApi === undefined) delete global.Page
    else global.Page = priorPageApi
  }
}
const developmentIndexPage = capturePageInEnvironment('../pages/control-protocol/index', 'develop')
const galleryState = {
  ...developmentIndexPage,
  data: { ...developmentIndexPage.data },
  setData(patch, callback) { this.data = { ...this.data, ...patch }; if (callback) callback() },
}
developmentIndexPage.onLoad.call(galleryState)
assert.equal(galleryState.data.items.length, 2, '开发版图库显示 F300 和 K100R 两张独立卡片')
assert.equal(galleryState.data.items[0].group.sampleStatusLabel, '柜内 F300 样本协议已验证 · 开发预览',
  '开发版图库页面必须限定显示为柜内 F300 样本协议状态')
assert.equal(galleryState.data.items[0].photo.id, 'draft-smartplc-f300-interior-photo',
  '图库封面必须选取控制卡照片')
assert.equal(galleryState.data.items[0].photo.status, 'draft',
  '图库可见的开发样本图片必须保持 draft 状态')
assert.equal(galleryState.data.items[1].group.title, '麒麟 Kylin K100R 控制卡', '第二张卡以可见控制卡品牌和型号命名')
assert.equal(galleryState.data.items[1].photo.id, 'draft-kylin-k100r-card-photo', 'K100R 封面使用其自己的控制卡照片')
assert.deepEqual(searchGallery(developmentSampleCatalog, { keyword: 'K100R' }).map((item) => item.group.id), ['draft-kylin-k100r-sample'],
  '按型号搜索只返回 K100R 卡片')
assert.deepEqual(searchGallery(developmentSampleCatalog, { keyword: 'F300' }).map((item) => item.group.id), ['draft-smartplc-f300-sample'],
  'F300 搜索不会串到 K100R')
const releaseIndexPage = capturePageInEnvironment('../pages/control-protocol/index', 'release')
const releaseGalleryState = {
  ...releaseIndexPage,
  data: { ...releaseIndexPage.data },
  setData(patch, callback) { this.data = { ...this.data, ...patch }; if (callback) callback() },
}
releaseIndexPage.onLoad.call(releaseGalleryState)
assert.deepEqual(releaseGalleryState.data.items, [], '正式版实际图库页面不得显示开发草稿')

const developmentDetailPage = capturePageInEnvironment('../pages/control-protocol/detail', 'develop')
let copiedText = null
let previewRequest = null
global.wx = {
  getAccountInfoSync: () => ({ miniProgram: { envVersion: 'develop' } }),
  setClipboardData: ({ data }) => { copiedText = data },
  previewImage: (options) => { previewRequest = options },
}
const detailState = {
  ...developmentDetailPage,
  data: { ...developmentDetailPage.data },
  setData(patch) { this.data = { ...this.data, ...patch } },
}
developmentSampleCatalog.photos = [...originalDevelopmentPhotos, fixtureShellDraftPhoto, fixtureShellApprovedPhoto]
developmentSampleCatalog.sources = [...originalDevelopmentSources, {
  id: 'fixture-shell-approved-source', title: 'Fixture cabinet photo', status: 'verified',
  reviewerId: 'fixture-reviewer', authorizationConfirmed: true,
}]
const shellPhotoDetailState = {
  ...developmentDetailPage,
  data: { ...developmentDetailPage.data },
  setData(patch) { this.data = { ...this.data, ...patch } },
}
developmentDetailPage.onLoad.call(shellPhotoDetailState, { appearanceGroupId: 'draft-smartplc-f300-sample' })
assert.deepEqual(shellPhotoDetailState.data.photos.map((photo) => photo.id), ['draft-smartplc-f300-interior-photo'],
  '开发详情不得优先展示 resolution.photos 中同组已审核外壳照片')
developmentSampleCatalog.photos = originalDevelopmentPhotos
developmentSampleCatalog.sources = originalDevelopmentSources
developmentDetailPage.onLoad.call(detailState, { appearanceGroupId: 'draft-smartplc-f300-sample' })
assert.equal(detailState.data.photos.length, 1, '开发版详情页只显示柜内控制卡照片')
assert.match(detailState.data.photos[0].displayAngle, /^开发预览照片（不参与正式协议准入）/,
  '详情照片须区分开发预览与正式协议准入')
assert.equal(detailState.data.protocol, null, '缺少映射/固件/复核数据时不得展示命令区')
assert.ok(detailState.data.developmentManual, '开发版详情应展示单独的手册协议摘录')
assert.equal(detailState.data.selectedLoopLabel, '第1路', '默认定位第一路回路')
assert.equal(detailState.data.manualTransport.id, 'rtu', 'F300 默认显示串口 RTU')
assert.deepEqual(detailState.data.manualTransportTabs.map((tab) => [tab.label, tab.sourceIndex]), [
  ['串口协议（RS485）', 1], ['网络协议（TCP/IP）', 0],
], 'F300 标签按串口在左、网络在右显示，并保留手册源索引')
assert.match(fs.readFileSync(path.join(__dirname, '../pages/control-protocol/detail.wxml'), 'utf8'),
  /tab\.sourceIndex == manualTransportIndex/, '选中态应按手册源索引标记映射后的协议标签')
assert.match(fs.readFileSync(path.join(__dirname, '../pages/control-protocol/detail.wxml'), 'utf8'),
  /data-index="\{\{tab\.sourceIndex\}\}"/, '标签点击应传回协议手册中的源索引')
assert.deepEqual(detailState.data.selectedLoopCommands.map((command) => command.label), ['第1路启动', '第1路关闭'],
  '默认串口应仅展示第1路的启动和关闭命令')
assert.match(detailState.data.statusMessage, /用户确认这台 itC KZX 柜内 SmartPLC-F300 样本所用控制协议已验证且准确无误/,
  '详情状态必须清楚表达用户确认协议已验证')
developmentDetailPage.copyProtocol.call(detailState)
assert.equal(copiedText, null, '尚未满足正式收录门槛时不得开放正式协议摘要复制')
const copyableManualCommand = developmentManual.transports[0].commands[0]
developmentDetailPage.selectManualTransport.call(detailState, { currentTarget: { dataset: { index: '0' } } })
assert.equal(detailState.data.manualTransport.id, 'tcp', '点击右侧网络标签应切到源索引0的 TCP')
developmentDetailPage.copyManualCommand.call(detailState, { currentTarget: { dataset: { commandId: copyableManualCommand.id } } })
assert.equal(copiedText, copyableManualCommand.frame, '已验证手册控制请求帧应逐条复制，不得执行发送')
const hiddenTcpLoop40 = developmentManual.transports[0].commands.find((command) => command.label === '第40路启动')
copiedText = 'unchanged'
developmentDetailPage.copyManualCommand.call(detailState, { currentTarget: { dataset: { commandId: hiddenTcpLoop40.id } } })
assert.equal(copiedText, 'unchanged', '未展开且未选中的回路命令不可通过隐藏 ID 复制')
developmentDetailPage.selectManualLoop.call(detailState, { detail: { value: '39' } })
assert.equal(detailState.data.selectedLoopLabel, '第40路', 'picker 可定位第40路')
assert.deepEqual(detailState.data.selectedLoopCommands.map((command) => command.label), ['第40路启动', '第40路关闭'],
  '第40路必须展示其自身的启动和关闭帧')
assert.deepEqual(developmentDetailPage.getLoopCommands.call(detailState, [hiddenTcpLoop40], 40), [],
  '启动或关闭帧任一缺失时不得展示不完整回路组')
developmentDetailPage.selectManualTransport.call(detailState, { currentTarget: { dataset: { index: '1' } } })
assert.equal(detailState.data.manualTransport.id, 'rtu', 'TCP/RTU 切换应定位到 RTU')
assert.equal(detailState.data.commonManualCommands.length, 4, '切换传输后常用操作仍置顶')
assert.equal(detailState.data.selectedLoopLabel, '第40路', 'TCP/RTU 切换应保留当前回路号')
assert.deepEqual(detailState.data.selectedLoopCommands.map((command) => command.label), ['第40路启动', '第40路关闭'],
  '切换 RTU 后仍应展示相同回路号的启动和关闭帧')
copiedText = 'unchanged'
developmentDetailPage.copyManualCommand.call(detailState, { currentTarget: { dataset: { commandId: copyableManualCommand.id } } })
assert.equal(copiedText, 'unchanged', '当前 RTU 视图不得跨传输复制 TCP 命令')
developmentDetailPage.toggleManualWrites.call(detailState)
assert.equal(detailState.data.showManualWrites, true, '40路开关清单可展开')
assert.equal(detailState.data.manualWriteCommands.length, 80, '全部开关请求应可浏览80条')
assert.equal(detailState.data.commonManualCommands.length + detailState.data.manualWriteCommands.length, 84,
  '开发详情每种传输只显示4条常用和80条控制操作')
const rtuStartCommand = detailState.data.commonManualCommands[0]
developmentDetailPage.copyManualCommand.call(detailState, { currentTarget: { dataset: { commandId: rtuStartCommand.id } } })
assert.equal(copiedText, rtuStartCommand.frame, 'RTU 按钮必须复制 RTU 自身帧，不能串成 TCP 帧')
const rtuLoop40 = detailState.data.selectedLoopCommands[0]
developmentDetailPage.copyManualCommand.call(detailState, { currentTarget: { dataset: { commandId: rtuLoop40.id } } })
assert.equal(copiedText, rtuLoop40.frame, '切换 RTU 后第40路应复制对应 RTU 帧')

const k100rDetailState = {
  ...developmentDetailPage,
  data: { ...developmentDetailPage.data },
  setData(patch) { this.data = { ...this.data, ...patch } },
}
developmentDetailPage.onLoad.call(k100rDetailState, { appearanceGroupId: 'draft-kylin-k100r-sample' })
assert.equal(k100rDetailState.data.photos[0].id, 'draft-kylin-k100r-card-photo', 'K100R 详情使用 K100R 控制卡照片')
assert.equal(k100rDetailState.data.loopOptions.length, 8, 'K100R picker 只显示8路')
assert.deepEqual(k100rDetailState.data.commonManualCommands.map((command) => command.id), ['rs485-all-close', 'rs485-all-open'],
  'K100R 首屏展示两条一键控制请求')
assert.equal(k100rDetailState.data.manualTransport.id, 'rs485', 'K100R 默认显示串口 RS485')
assert.deepEqual(k100rDetailState.data.manualTransportTabs.map((tab) => [tab.label, tab.sourceIndex]), [
  ['串口协议（RS485）', 0], ['网络协议（UDP）', 1],
], 'K100R 标签按串口在左、网络在右显示')
assert.deepEqual(k100rDetailState.data.selectedLoopCommands.map((command) => command.label), ['第1路闭合', '第1路断开'],
  'K100R 首屏按本手册的闭合/断开动作名称展示第1路')
assert.equal(k100rDetailState.data.selectedLoopCommands[0].displayFrame, '32 05 00 00 FF 00 89 F9', 'K100R RS485 单路闭合帧准确')
developmentDetailPage.copyManualCommand.call(k100rDetailState, { currentTarget: { dataset: { commandId: 'rs485-all-close' } } })
assert.equal(copiedText, '32 06 00 00 00 01 4D C9', 'K100R RS485 一键操作可复制正确功能码06帧')
developmentDetailPage.selectManualTransport.call(k100rDetailState, { currentTarget: { dataset: { index: '1' } } })
assert.equal(k100rDetailState.data.deviceMacValid, false, 'UDP MAC 初始为空且无效')
assert(k100rDetailState.data.commonManualCommands.every((command) => !command.copyEnabled), '无 MAC 时 UDP 一键命令不可复制')
assert(k100rDetailState.data.selectedLoopCommands.every((command) => !command.copyEnabled && command.displayFrame.includes('__')),
  '无 MAC 时 UDP 单路命令只显示占位符')
copiedText = 'unchanged'
developmentDetailPage.copyManualCommand.call(k100rDetailState, { currentTarget: { dataset: { commandId: 'udp-relay-01-close' } } })
assert.equal(copiedText, 'unchanged', 'UDP MAC 为空时复制处理器拒绝示例帧')
developmentDetailPage.onDeviceMacInput.call(k100rDetailState, { detail: { value: '66:88:31:F3:7F:1C' } })
assert.equal(k100rDetailState.data.deviceMacValid, false, '带分隔符 MAC 不符合12位连续十六进制格式')
assert(k100rDetailState.data.selectedLoopCommands.every((command) => !command.copyEnabled), '错误 MAC 后仍不可复制')
developmentDetailPage.onDeviceMacInput.call(k100rDetailState, { detail: { value: 'a1b2c3d4e5f6' } })
assert.equal(k100rDetailState.data.deviceMacFormatted, 'A1 B2 C3 D4 E5 F6', '有效小写 MAC 格式化为大写分隔字节')
assert.equal(k100rDetailState.data.selectedLoopCommands[0].displayFrame, '43 53 52 59 A1 B2 C3 D4 E5 F6 31', 'UDP 单路只替换 MAC 六字节')
developmentDetailPage.copyManualCommand.call(k100rDetailState, { currentTarget: { dataset: { commandId: 'udp-relay-01-close' } } })
assert.equal(copiedText, '43 53 52 59 A1 B2 C3 D4 E5 F6 31', '有效现场 MAC 可复制动态 UDP 单路帧')
developmentDetailPage.copyManualCommand.call(k100rDetailState, { currentTarget: { dataset: { commandId: 'udp-all-close' } } })
assert.equal(copiedText, '43 52 4C 59 A1 B2 C3 D4 E5 F6', '有效现场 MAC 同样替换 UDP 一键帧')
developmentDetailPage.onDeviceMacInput.call(k100rDetailState, { detail: { value: '001122334455' } })
assert.equal(k100rDetailState.data.selectedLoopCommands[0].displayFrame, '43 53 52 59 00 11 22 33 44 55 31', '第二个有效 MAC 可重新生成单路帧')
developmentDetailPage.clearDeviceMac.call(k100rDetailState)
assert.equal(k100rDetailState.data.deviceMacInput, '', '清空操作只清除本页临时输入')
assert(k100rDetailState.data.selectedLoopCommands.every((command) => !command.copyEnabled && command.displayFrame.includes('__')),
  '清空 MAC 后 UDP 回到不可复制占位帧')
developmentDetailPage.selectManualTransport.call(k100rDetailState, { currentTarget: { dataset: { index: '0' } } })
copiedText = 'unchanged'
developmentDetailPage.copyManualCommand.call(k100rDetailState, { currentTarget: { dataset: { commandId: 'udp-relay-01-close' } } })
assert.equal(copiedText, 'unchanged', 'RS485 页面不可跨传输复制 UDP 命令')
developmentDetailPage.selectManualLoop.call(k100rDetailState, { detail: { value: '7' } })
assert.deepEqual(k100rDetailState.data.selectedLoopCommands.map((command) => command.label), ['第8路闭合', '第8路断开'], 'K100R 可定位第8路')
assert.equal(k100rDetailState.data.selectedLoopCommands[0].frame, '32 05 00 07 FF 00 38 38', '第8路 RS485 帧来源准确')
developmentDetailPage.previewPhoto.call(detailState, { currentTarget: { dataset: { path: detailState.data.photos[0].path } } })
assert.deepEqual(previewRequest, {
  current: detailState.data.photos[0].path,
  urls: detailState.data.photos.map((photo) => photo.path),
}, '点控制卡照片应调用原生预览并放大查看原图')
detailState.data.protocol = {
  copyText: 'formal summary',
  commands: [{ id: 'formal-command', value: 'formal frame' }],
}
developmentDetailPage.copyProtocolCommand.call(detailState, { currentTarget: { dataset: { commandId: 'formal-command' } } })
assert.equal(copiedText, 'formal frame', '正式命令的紧凑复制控件应复制单条帧')
developmentDetailPage.copyProtocol.call(detailState)
assert.equal(copiedText, 'formal summary', '正式协议摘要复制仍保留既有摘要语义')
detailState.data.protocol = null
delete global.wx
const releaseDetailPage = capturePageInEnvironment('../pages/control-protocol/detail', 'release')
const releaseDetailState = {
  ...releaseDetailPage,
  data: { ...releaseDetailPage.data },
  setData(patch) { this.data = { ...this.data, ...patch } },
}
releaseDetailPage.onLoad.call(releaseDetailState, { appearanceGroupId: 'draft-smartplc-f300-sample' })
assert.equal(releaseDetailState.data.group, null, '正式版详情页不得加载开发草稿记录')
assert.equal(releaseDetailState.data.developmentManual, null, '正式/体验版不得加载开发手册摘录')
releaseDetailPage.onLoad.call(releaseDetailState, { appearanceGroupId: 'draft-kylin-k100r-sample' })
assert.equal(releaseDetailState.data.group, null, '正式版详情页不得加载 K100R 开发草稿')
assert.equal(releaseDetailState.data.developmentManual, null, '正式版不得加载 K100R 开发协议摘录')
const trialDetailPage = capturePageInEnvironment('../pages/control-protocol/detail', 'trial')
const trialDetailState = {
  ...trialDetailPage,
  data: { ...trialDetailPage.data },
  setData(patch) { this.data = { ...this.data, ...patch } },
}
trialDetailPage.onLoad.call(trialDetailState, { appearanceGroupId: 'draft-smartplc-f300-sample' })
assert.equal(trialDetailState.data.developmentManual, null, '体验版不得加载开发手册摘录')
trialDetailPage.onLoad.call(trialDetailState, { appearanceGroupId: 'draft-kylin-k100r-sample' })
assert.equal(trialDetailState.data.developmentManual, null, '体验版不得加载 K100R 开发协议摘录')

const detailTemplate = fs.readFileSync(path.join(__dirname, '../pages/control-protocol/detail.wxml'), 'utf8')
const detailStyles = fs.readFileSync(path.join(__dirname, '../pages/control-protocol/detail.wxss'), 'utf8')
assert(detailTemplate.includes('wx:if="{{protocol}}" class="protocol-card"'),
  '命令与复制入口必须继续受已核验 protocol 状态控制')
assert(detailTemplate.includes('wx:if="{{developmentManual}}" class="development-manual-card"')
  && detailTemplate.indexOf('development-manual-card') < detailTemplate.indexOf('appearance-photos'),
  '开发版协议摘录必须独立于正式目录协议，且显示在照片之前')
assert(detailTemplate.includes('class="manual-copy-button"')
  && !detailTemplate.includes('applicability-summary') && !detailTemplate.includes('manual-intro-line'))
assert(!detailTemplate.includes('返回图库') && detailTemplate.includes('返回控制卡图库')
  && !detailTemplate.includes('手册来源、版本与安全说明')
  && !detailTemplate.includes('manual-source-block')
  && !detailTemplate.includes('showManualInfo')
  && !detailStyles.includes('.back-link') && !detailStyles.includes('.manual-source-block'),
  '详情页隐藏多余返回按钮和手册来源说明，保留无效资料时的图库返回入口')
assert(detailTemplate.includes('wx:if="{{group.sampleStatusLabel && !developmentManual}}" class="draft-material-card"'),
  '详情应说明草稿资料版本、映射和传输线索都待核')
assert(detailTemplate.includes('selectManualTransport') && detailTemplate.includes('selectManualLoop')
  && detailTemplate.includes('toggleManualWrites') && detailTemplate.includes('wx:for-index="commandIndex"')
          && detailTemplate.includes('其余控制请求（{{manualWriteCommands.length}}）')
  && !detailTemplate.includes('读取请求') && !detailTemplate.includes('statusManualCommands')
  && !detailTemplate.includes('environmentManualCommands') && !detailTemplate.includes('toggleManualStatus'),
  '详情只提供控制写入请求导航，不呈现来源留档中的读取指令')
assert(detailTemplate.includes('copyProtocolCommand') && detailTemplate.includes('bindtap="copyProtocol"'),
  '正式协议命令应可紧凑复制，摘要入口仍保留原 copyProtocol 处理')
assert(detailStyles.includes('.manual-command-frame{') && detailStyles.includes('.command-value{')
  && (detailStyles.match(/font-size:28rpx/g) || []).length >= 2
  && !detailStyles.includes('word-break:break-all')
  && detailStyles.includes('min-width:44px') && detailStyles.includes('height:44px'),
  '命令帧应缩小以容纳完整TCP请求，复制按钮保持44px触控区')
assert(detailTemplate.includes('mode="widthFix"') && detailTemplate.includes('bindtap="previewPhoto"'),
  '详情图片须完整显示并支持点图原生放大')
assert(detailTemplate.includes('点图放大'), '详情图片应提示可放大查看')
assert(detailTemplate.includes('请填写当前控制卡的有效 MAC，才能复制 UDP 指令'), 'UDP 需提示填写现场 MAC')
const indexTemplate = fs.readFileSync(path.join(__dirname, '../pages/control-protocol/index.wxml'), 'utf8')
const indexStyles = fs.readFileSync(path.join(__dirname, '../pages/control-protocol/index.wxss'), 'utf8')
const indexConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '../pages/control-protocol/index.json'), 'utf8'))
assert.equal(indexConfig.navigationBarTitleText, '控制协议', '图库页面导航标题应与工具入口统一')
assert(indexTemplate.includes('控制协议') && indexTemplate.includes('控制卡图库')
  && !indexTemplate.includes('同一机柜外壳可能装有不同控制卡')
  && indexTemplate.includes('class="gallery-image" src="{{item.photo.path}}" mode="aspectFit"')
  && !indexTemplate.includes('gallery-photo-tag'),
  '控制卡图库须以控制卡为识别对象、完整显示照片且不遮挡标签')
assert(indexTemplate.includes('class="gallery-scroll" scroll-x')
  && indexTemplate.includes('<view class="gallery-track">')
  && indexStyles.includes('.gallery-track{display:flex;')
  && indexStyles.includes('align-items:stretch')
  && indexStyles.includes('flex:0 0 72vw')
  && indexStyles.includes('.gallery-photo{display:flex;box-sizing:border-box;width:100%;height:520rpx;')
  && indexStyles.includes('.gallery-image{display:block;width:100%;height:100%}')
  && indexStyles.includes('.gallery-photo-missing{display:flex;width:100%;height:100%;')
  && indexStyles.includes('flex-basis:76vw'),
  '图库须保持单行横向滑动、卡片可露出下一张且照片在统一展示框内完整显示')

const sourceCopyRoot = path.join(__dirname, '../docs/control-protocol-draft/source-copy')
const expectedSourceHashes = [
  ['QN-PLC-global-cabinet-manual-202511-v1.0.docx', '3DEF2C2A5844F3D2D1424DE76B2BD77A6FFD13E6FD5322E9DF7F8F859CD0F6E4'],
  ['smartplc-f300-original.jpg', '2F4EEDFE79FDF8D7334970D7A4A5827D05A33C475FA1B48E5B7F5186D6AD9960'],
  ['itc-kzx-cabinet-front-original.png', 'D59E968407A13DB11270D7C81A4E07957B378E6FE8AE40F5E4609AF3C29CFEB2'],
  ['kylin-k100r-control-protocol-v1.1-2025-04-03.docx', 'FB90C408CD18559C8534EF3721A1F13B4B563DB0A94F2EA43E0B01EE362D1FBA'],
  ['kylin-k100r-card-original.jpg', 'B32D37BDE592DB722F9F20E5BD68C0AF562F6ADA06A840FC23C3D3CD0E4695CF'],
]
expectedSourceHashes.forEach(([filename, expectedHash]) => {
  const sourceBytes = fs.readFileSync(path.join(sourceCopyRoot, filename))
  assert.equal(crypto.createHash('sha256').update(sourceBytes).digest('hex').toUpperCase(), expectedHash,
    `${filename} 本地来源副本哈希不匹配`)
})
const packageDraftResources = [
  'pages/control-protocol/development-sample.js',
  'pages/control-protocol/development-manual.js',
  'pages/control-protocol/development-k100r-manual.js',
  'pages/control-protocol/draft-assets/smartplc-f300-sample.jpg',
  'pages/control-protocol/draft-assets/kylin-k100r-card-sample.jpg',
]
assert.equal(fs.existsSync(path.join(__dirname, '../pages/control-protocol/draft-assets/itc-kzx-cabinet-front.png')), false,
  '机柜正面照只留在 docs/source-copy，不进入小程序资源目录')
assert.equal(evaluateDraftProtocolPackageGate([], false).allowed, true, '无草稿资源时发布门禁应允许通过')
assert.equal(evaluateDraftProtocolPackageGate(packageDraftResources, false).allowed, false,
  '普通发布检查必须拒绝含开发样本的包')
assert.equal(evaluateDraftProtocolPackageGate(packageDraftResources, true).bypassed, true,
  '显式本地样本回归标记只应绕过草稿资源这一项门禁')

const reviewerId = 'fixture-reviewer'
const mappingReviewerId = 'fixture-mapping-reviewer'
const fixture = {
  appearanceGroups: [{
    id: 'fixture-group', categoryKey: 'led-power', title: 'Fixture appearance',
    directMappingReviewed: true, mappingReviewerId,
  }],
  deviceVariants: [{
    id: 'fixture-device-v1', appearanceGroupId: 'fixture-group', brand: 'Fixture maker', model: 'Fixture cabinet', version: 'v1',
  }],
  photos: [
    {
      id: 'fixture-photo-front', ownerType: 'appearanceGroup', ownerId: 'fixture-group', angleLabel: 'Fixture front',
      path: '/fixture-only/appearance-front.png', status: 'ready', sourceId: 'fixture-photo-source',
      authorizationConfirmed: true, redactionReviewed: true,
    },
    {
      id: 'fixture-photo-label', ownerType: 'deviceVariant', ownerId: 'fixture-device-v1', angleLabel: 'Fixture label',
      path: '/fixture-only/device-label.png', status: 'ready', sourceId: 'fixture-photo-source',
      authorizationConfirmed: true, redactionReviewed: true,
    },
    {
      id: 'fixture-photo-card', ownerType: 'controllerVariant', ownerId: 'fixture-card-a', angleLabel: 'Fixture card',
      path: '/fixture-only/controller-card.png', status: 'ready', sourceId: 'fixture-photo-source',
      authorizationConfirmed: true, redactionReviewed: true,
    },
  ],
  controllerVariants: [{
    id: 'fixture-card-a', deviceVariantId: 'fixture-device-v1', brand: 'Fixture cards', model: 'Card A', version: '1.0',
    status: 'verified', reviewerId, identificationMethod: 'maintainer-document', identificationSourceId: 'fixture-card-a-source',
  }],
  sources: [
    { id: 'fixture-photo-source', status: 'verified', reviewerId, authorizationConfirmed: true },
    { id: 'fixture-card-a-source', status: 'verified', reviewerId, authorizationConfirmed: true },
    { id: 'fixture-protocol-a-source', status: 'verified', reviewerId, authorizationConfirmed: true },
  ],
  protocols: [{
    id: 'fixture-protocol-a', controllerVariantId: 'fixture-card-a',
    controllerBrand: 'Fixture cards', controllerModel: 'Card A', controllerVersion: '1.0',
    protocolVersion: 'Fixture protocol version', title: 'Fixture protocol title',
    transportSummary: 'Fixture transport settings', copyText: 'Fixture summary text',
    commands: [{ id: 'fixture-on', label: 'Fixture on', value: 'Fixture command placeholder' }],
    status: 'verified', reviewerId, reviewerName: 'Fixture reviewer', sourceTitle: 'Fixture source',
    updatedAt: 'Fixture date', sourceId: 'fixture-protocol-a-source',
  }],
}

const resolved = resolveAppearanceGroupProtocol(fixture, 'fixture-group')
assert.equal(resolved.allowed, true, '唯一设备、控制卡和完整已核验协议应由图库点击直接解析')
assert.equal(resolved.protocol.id, 'fixture-protocol-a', '唯一匹配应直显关联协议')
assert.equal(searchGallery(fixture)[0].entryLabel, '查看协议', '唯一匹配的图库卡显示查看协议状态')
assert.deepEqual(resolved.photos.map((photo) => photo.id), [
  'fixture-photo-front', 'fixture-photo-label', 'fixture-photo-card',
], '详情需保留多个归属层级的已审核照片')
assert.equal(resolved.protocol.displaySourceTitle, 'Fixture source')
assert.equal(resolved.protocol.displayReviewerName, 'Fixture reviewer')

assert.equal(resolveAppearanceGroupProtocol(fixture, 'unknown-group').reason, 'unknown-appearance-group',
  '未知外观组必须显示不可用状态')
assert.equal(resolveAppearanceGroupProtocol(fixture, '').reason, 'unknown-appearance-group',
  '空 ID 不得误匹配缺少 ID 的记录')
const unreviewedMapping = {
  ...fixture,
  appearanceGroups: fixture.appearanceGroups.map((group) => ({ ...group, directMappingReviewed: false })),
}
assert.equal(resolveAppearanceGroupProtocol(unreviewedMapping, 'fixture-group').reason, 'appearance-mapping-unreviewed',
  '外观与唯一协议映射未复核时不得自动展示命令')
const missingMappingReviewer = {
  ...fixture,
  appearanceGroups: fixture.appearanceGroups.map((group) => ({ ...group, mappingReviewerId: '' })),
}
assert.equal(resolveAppearanceGroupProtocol(missingMappingReviewer, 'fixture-group').reason, 'appearance-mapping-unreviewed',
  '缺少外观映射复核人时不得自动展示命令')

const twoCards = {
  ...fixture,
  controllerVariants: [
    ...fixture.controllerVariants,
    {
      id: 'fixture-card-b', deviceVariantId: 'fixture-device-v1', brand: 'Fixture cards', model: 'Card B', version: '2.0',
      status: 'verified', reviewerId, identificationMethod: 'maintainer-document', identificationSourceId: 'fixture-card-b-source',
    },
  ],
  sources: [...fixture.sources, { id: 'fixture-card-b-source', status: 'verified', reviewerId, authorizationConfirmed: true }],
  protocols: [...fixture.protocols, {
    ...fixture.protocols[0], id: 'fixture-protocol-b', controllerVariantId: 'fixture-card-b',
    controllerModel: 'Card B', controllerVersion: '2.0', sourceId: 'fixture-protocol-b-source',
  }],
}
assert.equal(resolveAppearanceGroupProtocol(twoCards, 'fixture-group').reason, 'controller-variant-ambiguous',
  '同一外观下 A/B 两种控制卡不得自动选择首项')
assert.equal(searchGallery(twoCards)[0].entryLabel, '无法自动匹配', 'A/B 多卡的图库卡明确提示无法自动匹配')

const twoDevices = {
  ...fixture,
  deviceVariants: [...fixture.deviceVariants, {
    ...fixture.deviceVariants[0], id: 'fixture-device-v2', model: 'Fixture cabinet alternate', version: 'v2',
  }],
}
assert.equal(resolveAppearanceGroupProtocol(twoDevices, 'fixture-group').reason, 'device-variant-ambiguous',
  '同一外观下多个设备型号不得自动选择首项')

const twoProtocols = {
  ...fixture,
  protocols: [...fixture.protocols, { ...fixture.protocols[0], id: 'fixture-protocol-a-second' }],
}
assert.equal(resolveAppearanceGroupProtocol(twoProtocols, 'fixture-group').reason, 'protocol-ambiguous',
  '同一控制卡多份协议不得自动选择首项')

const missingPhotos = { ...fixture, photos: [] }
assert.equal(resolveAppearanceGroupProtocol(missingPhotos, 'fixture-group').reason, 'appearance-photo-missing',
  '缺少审核照片时不得自动开放协议')

for (const field of ['authorizationConfirmed', 'redactionReviewed']) {
  const rejectedPhotos = {
    ...fixture,
    photos: fixture.photos.map((photo) => photo.ownerType === 'appearanceGroup'
      ? { ...photo, [field]: false }
      : photo),
  }
  assert.equal(searchGallery(rejectedPhotos)[0].photo, null, `照片缺少 ${field} 时图库不应展示图片`)
  assert.equal(resolveAppearanceGroupProtocol(rejectedPhotos, 'fixture-group').reason, 'appearance-photo-missing',
    `照片缺少 ${field} 时不应开放协议`)
}

const unverifiedIdentification = {
  ...fixture,
  sources: fixture.sources.map((source) => source.id === 'fixture-card-a-source'
    ? { ...source, status: 'pending' }
    : source),
}
assert.equal(resolveAppearanceGroupProtocol(unverifiedIdentification, 'fixture-group').reason, 'controller-source-unverified',
  '控制卡识别依据未核验时不得开放协议')

const unverifiedProtocolSource = {
  ...fixture,
  sources: fixture.sources.map((source) => source.id === 'fixture-protocol-a-source'
    ? { ...source, status: 'pending' }
    : source),
}
assert.equal(resolveAppearanceGroupProtocol(unverifiedProtocolSource, 'fixture-group').reason, 'protocol-source-unverified',
  '协议来源未核验时不得开放协议')

const unverifiedProtocol = {
  ...fixture,
  protocols: fixture.protocols.map((protocol) => ({ ...protocol, status: 'pending' })),
}
assert.equal(resolveAppearanceGroupProtocol(unverifiedProtocol, 'fixture-group').reason, 'protocol-not-verified',
  '协议未经复核时不得开放')

const wrongVersion = {
  ...fixture,
  protocols: fixture.protocols.map((protocol) => ({ ...protocol, controllerVersion: 'v-old' })),
}
assert.equal(resolveAppearanceGroupProtocol(wrongVersion, 'fixture-group').reason, 'protocol-version-mismatch',
  '协议适用版本不一致时不得开放')

for (const [field, label] of [
  ['title', '标题'], ['sourceTitle', '来源名称'], ['reviewerName', '复核人'], ['updatedAt', '最近更新日期'],
  ['transportSummary', '传输参数'], ['copyText', '复制摘要'],
]) {
  const incomplete = { ...fixture, protocols: fixture.protocols.map((protocol) => ({ ...protocol, [field]: '' })) }
  assert.equal(resolveAppearanceGroupProtocol(incomplete, 'fixture-group').reason, 'protocol-incomplete',
    `缺少协议${label}时不得开放`)
}
const noCommands = { ...fixture, protocols: fixture.protocols.map((protocol) => ({ ...protocol, commands: [] })) }
assert.equal(resolveAppearanceGroupProtocol(noCommands, 'fixture-group').reason, 'protocol-incomplete',
  '协议没有完整指令时不得开放')

const duplicateControllerId = {
  ...fixture,
  controllerVariants: [...fixture.controllerVariants, { ...fixture.controllerVariants[0] }],
}
assert.equal(resolveAppearanceGroupProtocol(duplicateControllerId, 'fixture-group').reason, 'controller-variant-ambiguous',
  '重复控制卡 ID 必须视为多项并拒绝自动解析')
const duplicateSourceId = {
  ...fixture,
  sources: [...fixture.sources, { ...fixture.sources.find((source) => source.id === 'fixture-protocol-a-source') }],
}
assert.equal(resolveAppearanceGroupProtocol(duplicateSourceId, 'fixture-group').reason, 'protocol-source-unverified',
  '重复来源 ID 必须视为不唯一并拒绝开放')
const duplicateDeviceId = {
  ...fixture,
  deviceVariants: [...fixture.deviceVariants, { ...fixture.deviceVariants[0] }],
}
assert.equal(resolveAppearanceGroupProtocol(duplicateDeviceId, 'fixture-group').reason, 'device-variant-ambiguous',
  '重复设备型号 ID 必须拒绝自动解析')
const duplicateGroupId = {
  ...fixture,
  appearanceGroups: [...fixture.appearanceGroups, { ...fixture.appearanceGroups[0] }],
}
assert.equal(resolveAppearanceGroupProtocol(duplicateGroupId, 'fixture-group').reason, 'unknown-appearance-group',
  '重复外观组 ID 必须拒绝自动解析')

console.log('Control protocol auto-resolution checks passed (empty production catalog; fixture-only unique/ambiguous/photo/source/protocol gates).')
