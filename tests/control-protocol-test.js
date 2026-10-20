const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { catalog: productionCatalog } = require('../pages/control-protocol/catalog')
const { developmentSampleCatalog } = require('./fixtures/control-protocol/development-sample')
const { developmentManual } = require('./fixtures/control-protocol/development-manual')
const { developmentK100RManual } = require('./fixtures/control-protocol/development-k100r-manual')
const { formalManual: formalSmartPlcF300Manual } = require('../pages/control-protocol/formal-smartplc-f300-manual')
const { formalManual: formalKylinK100RManual } = require('../pages/control-protocol/formal-kylin-k100r-manual')
const {
  getDevelopmentDraftPhotos,
  getDevelopmentDraftPhotosForAppearanceGroup,
  getReferenceManualDetail,
  searchGallery,
  searchReferenceManuals,
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
  referenceManuals: [],
}
const automaticCatalog = Object.fromEntries(Object.keys(emptyCatalog)
  .filter((key) => key !== 'referenceManuals')
  .map((key) => [key, productionCatalog[key]]))
assert.deepEqual(automaticCatalog, Object.fromEntries(Object.keys(emptyCatalog)
  .filter((key) => key !== 'referenceManuals')
  .map((key) => [key, []])), '生产目录自动准入六个数组必须保持为空')
assert.equal(productionCatalog.referenceManuals.length, 2, '生产目录只增加两条人工协议参考')
assert.deepEqual(productionCatalog.referenceManuals.map((reference) => reference.id), [
  'reference-smartplc-f300-01', 'reference-kylin-k100r-01',
], '正式参考 ID 稳定且不使用开发草稿 ID')
assert.equal(searchGallery(productionCatalog).length, 0, '新增参考不得进入自动控制卡图库')
assert.equal(searchReferenceManuals(productionCatalog).length, 2, '两条人工参考应可搜索展示')
assert.deepEqual(searchReferenceManuals(productionCatalog, { keyword: 'K100R' }).map((item) => item.referenceId),
  ['reference-kylin-k100r-01'], '人工参考搜索支持控制卡型号别名')
assert.deepEqual(searchReferenceManuals(productionCatalog, { keyword: 'SmartPLC-F300', category: 'led-power' })
  .map((item) => item.referenceId), ['reference-smartplc-f300-01'], '人工参考可按标题/别名与类别组合筛选')
assert.deepEqual(searchReferenceManuals(productionCatalog, { keyword: '麒麟', category: 'led-power' })
  .map((item) => item.referenceId), ['reference-kylin-k100r-01'], '人工参考继续匹配品牌别名与类别')
assert.deepEqual(searchReferenceManuals(productionCatalog, { category: 'audio' }), [], '类别筛选仅显示匹配参考')
const compactReferenceItems = searchReferenceManuals(productionCatalog)
assert.deepEqual(compactReferenceItems.map((item) => Object.keys(item).sort()), [
  ['photo', 'referenceId', 'title'], ['photo', 'referenceId', 'title'],
], '图库参考项只包含轻量展示字段')
assert(compactReferenceItems.every((item) => item.photo === null
  || JSON.stringify(Object.keys(item.photo).sort()) === JSON.stringify(['path'])),
'图库参考照片只保留路径')
const compactReferenceJson = JSON.stringify(compactReferenceItems)
assert(Buffer.byteLength(compactReferenceJson, 'utf8') <= 1024, '图库参考列表 JSON 不得超过 1 KiB')
assert(!/"(?:manual|commands|transports|reference)"\s*:/.test(compactReferenceJson),
  '图库参考列表不得重复携带完整手册、命令或参考对象')

const productionReferences = productionCatalog.referenceManuals
assert.equal(productionReferences[0].controllerBrand, '未知', 'F300 未知品牌不能由目录推断')
assert.equal(productionReferences[0].controllerFirmwareVersion, '未知', 'F300 固件版本保持未知')
assert.equal(productionReferences[0].protocolVersion, '说明书未标注，未知', 'F300 协议版本保持未知')
assert.equal(productionReferences[0].deviceModel, 'itC KZX（本次用户确认的样本柜）', 'F300 参考仅记录用户确认的样本柜')
assert.equal(productionReferences[1].deviceModel, '未知', 'K100R 安装设备型号保持未知')
assert.equal(productionReferences[1].controllerFirmwareVersion, '未知', 'K100R 固件版本保持未知')
assert.equal(productionReferences[0].publicUseBasis, 'user-request-2026-10-05')
assert.equal(productionReferences[1].publicUseBasis, 'user-request-2026-10-05')
productionReferences.forEach((reference) => {
  assert.equal(reference.photo.publicUseBasis, reference.publicUseBasis, '照片公开依据必须与所属参考一致')
  assert.match(reference.photo.visualCheck, /主代理实际查看原图/)
  assert.equal(reference.status, undefined, '人工参考不能伪造已审核状态')
  assert.equal(reference.reviewerId, undefined, '人工参考不能伪造具名复核人')
  assert.equal(reference.photo.authorizationConfirmed, undefined, '人工照片不能伪造来源核验标志')
  assert.equal(reference.photo.redactionReviewed, undefined, '人工照片不能伪造脱敏审核标志')
})
assert.equal(getReferenceManualDetail(productionCatalog, 'missing-reference'), null, '未知参考 ID 必须阻断')
assert.equal(getReferenceManualDetail({ ...productionCatalog, referenceManuals: [productionReferences[0], productionReferences[0]] },
  productionReferences[0].id), null, '重复参考 ID 必须阻断')
assert.equal(searchReferenceManuals({ ...productionCatalog, referenceManuals: [productionReferences[0], productionReferences[0]] }).length,
  0, '重复参考 ID 不得作为可点击图库卡展示')
const missingPublicationBasis = { ...productionReferences[0], photo: { ...productionReferences[0].photo, publicUseBasis: '' } }
assert.equal(getReferenceManualDetail({ ...productionCatalog, referenceManuals: [missingPublicationBasis] }, missingPublicationBasis.id), null,
  '缺失照片公开依据时参考必须失败关闭')
const mismatchedPublicationBasis = { ...productionReferences[0], photo: { ...productionReferences[0].photo, publicUseBasis: 'different-basis' } }
assert.equal(getReferenceManualDetail({ ...productionCatalog, referenceManuals: [mismatchedPublicationBasis] }, mismatchedPublicationBasis.id), null,
  '不一致的照片公开依据必须失败关闭')

function commandRows(manual) {
  return manual.transports.flatMap((transport) => transport.commands.map((command) => ({
    transport: transport.id,
    id: command.id,
    frame: command.frame,
    sourceParagraph: command.sourceParagraph,
    sourceLabel: command.sourceLabel,
    copyable: command.copyable,
  })))
}
assert.deepEqual(commandRows(formalSmartPlcF300Manual), commandRows(developmentManual),
  'F300 正式参考保留 fixture 全部168条命令的传输、帧、ID、段落、原文标签和复制标记')
assert.deepEqual(commandRows(formalKylinK100RManual), commandRows(developmentK100RManual),
  'K100R 正式参考保留 fixture 全部36条命令的传输、帧、ID、段落、原文标签和复制标记')
assert.equal(commandRows(formalSmartPlcF300Manual).length + commandRows(formalKylinK100RManual).length, 204,
  '生产人工参考仅包含核对过的204条控制请求')
assert.equal(formalSmartPlcF300Manual.sourceSha256, '3DEF2C2A5844F3D2D1424DE76B2BD77A6FFD13E6FD5322E9DF7F8F859CD0F6E4',
  'F300 正式参考追溯到实际说明书原件哈希')
assert.equal(formalKylinK100RManual.sourceSha256, 'FB90C408CD18559C8534EF3721A1F13B4B563DB0A94F2EA43E0B01EE362D1FBA',
  'K100R 正式参考追溯到实际协议原件哈希')
const formalPhotoFiles = [
  ['smartplc-f300-reference.jpg', 'smartplc-f300-sample.jpg', '2F4EEDFE79FDF8D7334970D7A4A5827D05A33C475FA1B48E5B7F5186D6AD9960'],
  ['kylin-k100r-reference.jpg', 'kylin-k100r-card-sample.jpg', 'B32D37BDE592DB722F9F20E5BD68C0AF562F6ADA06A840FC23C3D3CD0E4695CF'],
]
formalPhotoFiles.forEach(([formalName, fixtureName, expectedHash]) => {
  const formalBytes = fs.readFileSync(path.join(__dirname, '../pages/control-protocol/assets', formalName))
  const fixtureBytes = fs.readFileSync(path.join(__dirname, 'fixtures/control-protocol/draft-assets', fixtureName))
  assert.deepEqual(formalBytes, fixtureBytes, formalName + ' 正式照片逐字节等于原样本照片')
  assert.equal(crypto.createHash('sha256').update(formalBytes).digest('hex').toUpperCase(), expectedHash,
    formalName + ' SHA-256 保持用户核验值')
})
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

function capturePageInEnvironment(pageRelativePath, envVersion, injectedCatalog = null) {
  const Module = require('node:module')
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
    if (injectedCatalog) {
      const runtimeModule = new Module(runtimePath, module)
      runtimeModule.filename = runtimePath
      runtimeModule.paths = Module._nodeModulePaths(path.dirname(runtimePath))
      runtimeModule.exports = { ...productionCatalogModule, catalog: injectedCatalog }
      require.cache[runtimePath] = runtimeModule
    }
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
const productionCatalogModule = require('../pages/control-protocol/runtime-catalog')
assert.deepEqual(productionCatalogModule.catalog, productionCatalog,
  '生产 runtime catalog 必须直接使用含独立人工参考的正式目录')
for (const envVersion of ['develop', 'trial', 'release', 'unknown']) {
  const entryRoutes = []
  global.wx = { redirectTo: (options) => entryRoutes.push(options) }
  const formalEnvironmentPage = capturePageInEnvironment('../pages/control-protocol/index', envVersion)
  const formalEnvironmentState = {
    ...formalEnvironmentPage,
    data: { ...formalEnvironmentPage.data },
    setData(patch, callback) { this.data = { ...this.data, ...patch }; if (callback) callback() },
  }
  formalEnvironmentPage.onLoad.call(formalEnvironmentState)
  assert.equal(entryRoutes[0].url, '/pages/control-protocol/detail', `${envVersion} entry redirects to the sole reader`)
  assert.equal(formalEnvironmentState.data.items, undefined, `${envVersion} 入口不再维护第二份阅读器数据`)
  delete global.wx
}
for (const envVersion of ['develop', 'trial', 'release', 'unknown']) {
  const effects = { navigation: [], clipboard: [], photoPreview: [], photoCopies: [], networkCalls: 0, storageCalls: 0, storage: {} }
  global.wx = {
    env: { USER_DATA_PATH: '/user-data' },
    getFileSystemManager: () => ({ copyFile: (options) => { effects.photoCopies.push(options); options.success() } }),
    navigateTo: (options) => effects.navigation.push(options),
    redirectTo: (options) => effects.navigation.push(options),
    setClipboardData: (options) => { effects.clipboard.push(options.data); if (options.success) options.success() },
    previewImage: (options) => effects.photoPreview.push(options),
    showToast: () => {},
    request: () => { effects.networkCalls += 1 },
    connectSocket: () => { effects.networkCalls += 1 },
    sendSocketMessage: () => { effects.networkCalls += 1 },
    getStorageSync: (key) => effects.storage[key],
    setStorageSync: (key, value) => { effects.storageCalls += 1; effects.storage[key] = value },
  }
  const indexPage = capturePageInEnvironment('../pages/control-protocol/index', envVersion)
  const indexState = {
    ...indexPage,
    data: { ...indexPage.data },
    setData(patch, callback) { this.data = { ...this.data, ...patch }; if (callback) callback() },
  }
  indexPage.onLoad.call(indexState)
  assert.match(effects.navigation[0].url, /^\/pages\/control-protocol\/detail$/,
    `${envVersion} no-argument tool entry opens the sole reader`)
  const detailPage = capturePageInEnvironment('../pages/control-protocol/detail', envVersion)
  productionCatalog.referenceManuals.forEach((reference) => {
    indexPage.onLoad.call(indexState, { referenceId: reference.id })
    assert.match(effects.navigation.at(-1).url, new RegExp(`referenceId=${reference.id}`),
      `${envVersion} routes by explicit reference ID`)
    const detailState = {
      ...detailPage,
      data: { ...detailPage.data },
      setData(patch) { this.data = { ...this.data, ...patch } },
    }
    detailPage.onLoad.call(detailState, { referenceId: reference.id })
    assert.equal(detailState.data.reference.id, reference.id, `${envVersion} detail selects the requested reference`)
    assert.equal(detailState.data.protocol, null, `${envVersion} manual reference remains outside strict protocol data`)
    assert.equal(detailState.data.manual !== null, true, `${envVersion} detail loads neutral manual data`)
    assert(detailState.data.manual.transports.some((transport) => transport.commands.length > 0),
      `${envVersion} resolves full command data by reference ID`)
    assert.equal(detailState.data.developmentManual, undefined, 'Page state uses the neutral manual property')
    assert.equal(detailState.data.photos[0].path, reference.photo.path)
    assert.equal(detailState.data.photos[0].angleLabel, reference.photo.angleLabel,
      'Page preserves the source photo metadata without display decoration')
    detailPage.copyManualCommand.call(detailState, {
      currentTarget: { dataset: { commandId: detailState.data.commonManualCommands[0].id } },
    })
    assert.equal(effects.clipboard.at(-1), detailState.data.commonManualCommands[0].frame,
      `${envVersion} copies only the selected reference command`)
    detailPage.previewPhoto.call(detailState, {
      currentTarget: { dataset: { path: reference.photo.path } },
    })
    assert.equal(effects.photoCopies.at(-1).srcPath, reference.photo.path.replace(/^\/+/, ''),
      `${envVersion} copies the matching original photo bytes from the package asset`)
    assert.equal(effects.photoPreview.at(-1).current, effects.photoCopies.at(-1).destPath,
      `${envVersion} previews the local readable copy`)
    assert(effects.photoPreview.at(-1).current.startsWith('/user-data/'))
    assert.notEqual(effects.photoPreview.at(-1).current, reference.photo.path)
    if (reference.id === 'reference-kylin-k100r-01') {
      detailPage.selectManualTransport.call(detailState, { currentTarget: { dataset: { index: '1' } } })
      assert(detailState.data.commonManualCommands.every((command) => !command.copyEnabled),
        `${envVersion} blocks K100R UDP frames without a current MAC`)
      const visibleUdpFrames = detailState.data.commonManualCommands.concat(detailState.data.selectedLoopCommands)
        .map((command) => command.displayFrame)
      assert(visibleUdpFrames.every((frame) => !frame.includes('66 88 31 F3 7F 1C')),
        `${envVersion} never displays the source example MAC`)
      const clipboardBeforeBlocked = effects.clipboard.length
      detailPage.copyManualCommand.call(detailState, {
        currentTarget: { dataset: { commandId: 'udp-relay-01-close' } },
      })
      assert.equal(effects.clipboard.length, clipboardBeforeBlocked, `${envVersion} blocks UDP copy with no MAC`)
      detailPage.onDeviceMacInput.call(detailState, { detail: { value: 'A1:B2:C3:D4:E5:F6' } })
      assert.equal(detailState.data.deviceMacValid, false, `${envVersion} rejects separated MAC input`)
      detailPage.onDeviceMacInput.call(detailState, { detail: { value: 'A1B2C3D4E5F6' } })
      const udpCommand = detailState.data.selectedLoopCommands.find((command) => command.id === 'udp-relay-01-close')
      assert.equal(udpCommand.displayFrame, '43 53 52 59 A1 B2 C3 D4 E5 F6 31',
        `${envVersion} replaces exactly six UDP address bytes`)
      detailPage.copyManualCommand.call(detailState, {
        currentTarget: { dataset: { commandId: 'udp-relay-01-close' } },
      })
      assert.equal(effects.clipboard.at(-1), udpCommand.displayFrame, `${envVersion} copies the corrected UDP frame`)
      detailPage.clearDeviceMac.call(detailState)
      assert(detailState.data.selectedLoopCommands.every((command) => !command.copyEnabled),
        `${envVersion} blocks UDP copy again after clearing MAC`)
      const clipboardAfterValidCopy = effects.clipboard.length
      detailPage.copyManualCommand.call(detailState, {
        currentTarget: { dataset: { commandId: 'udp-relay-01-close' } },
      })
      assert.equal(effects.clipboard.length, clipboardAfterValidCopy, `${envVersion} cannot copy after clearing MAC`)
    }
  })
  assert.equal(effects.networkCalls, 0, `${envVersion} never sends or connects to a device`)
  const remembered = effects.storage['controlProtocolViewerState.v1']
  assert.equal(JSON.stringify(remembered).includes('deviceMac'), false, `${envVersion} never persists the entered MAC`)
  assert.equal(JSON.stringify(remembered).includes('A1B2C3D4E5F6'), false, `${envVersion} never persists MAC bytes`)
  delete global.wx
}

const invalidReferencePage = capturePageInEnvironment('../pages/control-protocol/detail', 'release')
const invalidReferenceState = {
  ...invalidReferencePage,
  data: { ...invalidReferencePage.data },
  setData(patch) { this.data = { ...this.data, ...patch } },
}
let invalidReferenceCopy = ''
global.wx = { setClipboardData: ({ data }) => { invalidReferenceCopy = data } }
invalidReferencePage.onLoad.call(invalidReferenceState, { referenceId: productionCatalog.referenceManuals[0].id })
assert(invalidReferenceState.data.manual, 'valid reference loads before stale-state regression')
invalidReferencePage.onLoad.call(invalidReferenceState, {
  referenceId: 'missing-reference', appearanceGroupId: productionCatalog.referenceManuals[1].id,
})
assert.equal(invalidReferenceState.data.invalidGroup, true)
assert.equal(invalidReferenceState.data.group, null)
assert.equal(invalidReferenceState.data.reference, null)
assert.equal(invalidReferenceState.data.manual, null, 'invalid ID clears a previously loaded manual')
assert.equal(invalidReferenceState.data.protocol, null)
assert.deepEqual(invalidReferenceState.data.photos, [])
assert.equal(invalidReferenceState.data.manualTransport, null)
invalidReferencePage.copyManualCommand.call(invalidReferenceState, {
  currentTarget: { dataset: { commandId: 'rtu-write-01' } },
})
assert.equal(invalidReferenceCopy, '', 'invalid ID cannot copy a previously loaded command')
invalidReferencePage.onLoad.call(invalidReferenceState, {
  referenceId: '', appearanceGroupId: productionCatalog.referenceManuals[0].id,
})
assert.equal(invalidReferenceState.data.manual, null, 'empty reference ID cannot fall back to another route')
delete global.wx
const duplicateReferenceCatalog = {
  ...productionCatalog,
  referenceManuals: [...productionCatalog.referenceManuals, { ...productionCatalog.referenceManuals[0] }],
}
const duplicateReferencePage = capturePageInEnvironment(
  '../pages/control-protocol/detail', 'release', duplicateReferenceCatalog,
)
const duplicateReferenceState = {
  ...duplicateReferencePage,
  data: { ...duplicateReferencePage.data },
  setData(patch) { this.data = { ...this.data, ...patch } },
}
duplicateReferencePage.onLoad.call(duplicateReferenceState, { referenceId: productionCatalog.referenceManuals[0].id })
assert.equal(duplicateReferenceState.data.manual, null, 'duplicate reference ID fails closed')

const developmentIndexPage = capturePageInEnvironment(
  '../pages/control-protocol/index', 'develop', developmentSampleCatalog,
)
const developmentEntryRoutes = []
global.wx = { redirectTo: (options) => developmentEntryRoutes.push(options) }
developmentIndexPage.onLoad.call({ data: { ...developmentIndexPage.data } })
assert.deepEqual(developmentEntryRoutes, [{ url: '/pages/control-protocol/detail' }], '开发版旧工具入口直接打开唯一阅读器')
delete global.wx
assert.deepEqual(searchGallery(developmentSampleCatalog, { keyword: 'K100R' }).map((item) => item.group.id), ['draft-kylin-k100r-sample'],
  '按型号搜索只返回 K100R 卡片')
assert.deepEqual(searchGallery(developmentSampleCatalog, { keyword: 'F300' }).map((item) => item.group.id), ['draft-smartplc-f300-sample'],
  'F300 搜索不会串到 K100R')
const releaseIndexPage = capturePageInEnvironment('../pages/control-protocol/index', 'release')
const releaseEntryRoutes = []
global.wx = { redirectTo: (options) => releaseEntryRoutes.push(options) }
const releaseGalleryState = {
  ...releaseIndexPage,
  data: { ...releaseIndexPage.data },
  setData(patch, callback) { this.data = { ...this.data, ...patch }; if (callback) callback() },
}
releaseIndexPage.onLoad.call(releaseGalleryState)
assert.equal(releaseGalleryState.data.items, undefined, '正式版入口不维护第二套图库数据')
assert.equal(releaseEntryRoutes[0].url, '/pages/control-protocol/detail', '正式版入口直接恢复唯一阅读器')
delete global.wx

const developmentDetailPage = capturePageInEnvironment(
  '../pages/control-protocol/detail', 'develop', developmentSampleCatalog,
)
let copiedText = null
let previewRequest = null
global.wx = {
  getAccountInfoSync: () => ({ miniProgram: { envVersion: 'develop' } }),
  env: { USER_DATA_PATH: '/user-data' },
  getFileSystemManager: () => ({ copyFile: (options) => { options.success() } }),
  setClipboardData: (options) => { copiedText = options.data; if (options.success) options.success() },
  showToast: () => {},
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
assert.equal(detailState.data.photos[0].developmentOnly, true,
  '开发照片保留数据层的 development-only 标记')
assert.equal(detailState.data.photos[0].status, 'draft',
  '开发照片保留数据层的 draft 状态')
assert.equal(detailState.data.photos[0].angleLabel, 'SmartPLC-F300 控制卡外观与标签',
  '详情保留原始照片角度元数据')
assert.equal(detailState.data.protocol, null, '缺少映射/固件/复核数据时不得展示命令区')
assert.ok(detailState.data.manual, '开发版详情应展示独立的静态手册协议摘录')
assert.equal(detailState.data.selectedLoopLabel, '第1路', '默认定位第一路回路')
assert.equal(detailState.data.manualTransport.id, 'rtu', 'F300 默认显示串口 RTU')
assert.deepEqual(detailState.data.manualTransportTabs.map((tab) => [tab.label, tab.sourceIndex]), [
  ['串口协议（RS485）', 1], ['网络协议（TCP/IP）', 0],
], 'F300 标签按串口在左、网络在右显示，并保留手册源索引')
assert.match(fs.readFileSync(path.join(__dirname, '../pages/control-protocol/detail.wxml'), 'utf8'),
  /tab\.id == manualTransport\.id/, '选中态应按传输ID标记映射后的协议标签')
assert.match(fs.readFileSync(path.join(__dirname, '../pages/control-protocol/detail.wxml'), 'utf8'),
  /data-index="\{\{tab\.sourceIndex\}\}"/, '标签点击应传回协议手册中的源索引')
assert.deepEqual(detailState.data.selectedLoopCommands.map((command) => command.label), ['第1路启动', '第1路关闭'],
  '默认串口应仅展示第1路的启动和关闭命令')
assert.match(detailState.data.statusMessage, /开发预览/,
  '详情状态清楚说明当前是仅复制的开发预览')
assert.match(detailState.data.group.manualMappingNote, /用户确认这台 itC KZX 柜内 SmartPLC-F300 样本所用控制协议已验证且准确无误/,
  '底层样本映射仍保留用户确认的协议适用边界')
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
assert(previewRequest.current.startsWith('/user-data/'), '原图先复制到本地再交给原生预览')
assert.notEqual(previewRequest.current, detailState.data.photos[0].path, '原生预览不接收不支持的包内资源路径')
assert(previewRequest.urls.every((photoPath) => photoPath.startsWith('/user-data/')),
  '所有可滑动原图均映射为本地可读路径')
detailState.data.protocol = {
  commands: [{ id: 'formal-command', value: 'formal frame' }],
}
developmentDetailPage.copyProtocolCommand.call(detailState, { currentTarget: { dataset: { commandId: 'formal-command' } } })
assert.equal(copiedText, 'formal frame', '正式命令的紧凑复制控件应复制单条帧')
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
assert.equal(releaseDetailState.data.manual, null, '未命中目录的正式详情不得加载开发手册摘录')
releaseDetailPage.onLoad.call(releaseDetailState, { appearanceGroupId: 'draft-kylin-k100r-sample' })
assert.equal(releaseDetailState.data.group, null, '正式版详情页不得加载 K100R 开发草稿')
assert.equal(releaseDetailState.data.manual, null, '正式版不得借用 K100R 开发协议摘录')
const formalDevelopmentDetailPage = capturePageInEnvironment('../pages/control-protocol/detail', 'develop')
const formalDevelopmentDetailState = {
  ...formalDevelopmentDetailPage,
  data: { ...formalDevelopmentDetailPage.data },
  setData(patch) { this.data = { ...this.data, ...patch } },
}
formalDevelopmentDetailPage.onLoad.call(formalDevelopmentDetailState, {
  appearanceGroupId: 'draft-smartplc-f300-sample',
})
assert.equal(formalDevelopmentDetailState.data.group, null, '未注入 fixture 的开发自动解析详情仍不创建外观组')
assert.equal(formalDevelopmentDetailState.data.manual, null, '自动解析详情不得加载 fixture 手册摘录')
assert.deepEqual(formalDevelopmentDetailState.data.photos, [], '真实开发详情页不得加载 fixture 照片')
const trialDetailPage = capturePageInEnvironment('../pages/control-protocol/detail', 'trial')
const trialDetailState = {
  ...trialDetailPage,
  data: { ...trialDetailPage.data },
  setData(patch) { this.data = { ...this.data, ...patch } },
}
trialDetailPage.onLoad.call(trialDetailState, { appearanceGroupId: 'draft-smartplc-f300-sample' })
assert.equal(trialDetailState.data.manual, null, '体验版自动解析详情不得加载开发手册摘录')
trialDetailPage.onLoad.call(trialDetailState, { appearanceGroupId: 'draft-kylin-k100r-sample' })
assert.equal(trialDetailState.data.manual, null, '体验版不得加载 K100R 开发协议摘录')

const detailTemplate = fs.readFileSync(path.join(__dirname, '../pages/control-protocol/detail.wxml'), 'utf8')
const detailStyles = fs.readFileSync(path.join(__dirname, '../pages/control-protocol/detail.wxss'), 'utf8')
const detailScript = fs.readFileSync(path.join(__dirname, '../pages/control-protocol/detail.js'), 'utf8')
const detailConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '../pages/control-protocol/detail.json'), 'utf8'))
assert.equal(detailConfig.navigationBarTitleText, '控制协议', '唯一阅读器使用工具入口标题')
assert(detailTemplate.includes('class="device-header"')
  && detailTemplate.includes('class="transport-segment"')
  && detailTemplate.includes('class="parameter-summary"')
  && detailTemplate.includes('class="command-list"'),
  '唯一阅读器保留设备、传输、参数和命令层级')
assert(!detailTemplate.includes('info-sheet')
  && !detailTemplate.includes('openInfoSheet')
  && !detailScript.includes('openInfoSheet')
  && !detailScript.includes('  copyProtocol() {')
  && !detailTemplate.includes('class="info-')
  && !detailTemplate.includes('{{reference.sourceTitle}}')
  && !detailTemplate.includes('{{reference.documentVersion}}')
  && !detailTemplate.includes('{{manual.safetyNote}}')
  && !detailTemplate.includes('{{transport.note}}')
  && !detailTemplate.includes('class="transport-note"')
  && !detailTemplate.includes('class="read-only-note"')
  && !detailTemplate.includes('class="material-status"')
  && !detailTemplate.includes('class="directory-empty-copy"')
  && !detailTemplate.includes('人工选择 · 不自动识别'),
  '阅读器不显示资料 sheet 或冗余状态说明')
assert(detailTemplate.includes('适用：{{scopeSummary}}')
  && !detailTemplate.includes('适用范围：{{scopeSummary}}')
  && !detailTemplate.includes('class="device-subline"'),
  '主屏只保留简短适用边界，不显示副标题行')
assert(detailTemplate.includes('data-index="{{tab.sourceIndex}}"')
  && detailTemplate.includes('bindtap="selectManualTransport"')
  && detailTemplate.includes('bindchange="selectManualLoop"')
  && detailTemplate.includes('bindtap="toggleManualWrites"')
  && detailTemplate.includes("showManualWrites ? '收起指令' : '其他指令'")
  && detailTemplate.includes('（{{manualWriteCommands.length}}）'),
  '所有真实控制写请求仍能通过传输、回路和展开状态查阅')
assert(detailTemplate.includes('copyManualCommand') && detailTemplate.includes('copyProtocolCommand')
  && detailTemplate.includes('previewDirectoryPhoto') && detailTemplate.includes('selectDevice')
  && !detailTemplate.includes('class="directory-row {{item.selected ? \'directory-row-selected\' : \'\'}}" data-type')
  && detailTemplate.includes('class="directory-list" style="height:{{directoryListHeight}}rpx"'),
  '命令复制、目录选择和原生照片预览保持独立操作')
assert(detailTemplate.includes('mode="aspectFit"') && detailTemplate.includes('bindtap="previewPhoto"')
  && detailTemplate.includes('binderror="onPhotoError"')
  && detailTemplate.includes('class="device-photo-touch" wx:if="{{mainPhoto && !mainPhoto.imageFailed}}" data-path="{{mainPhoto.path}}" bindtap="previewPhoto"')
  && detailTemplate.includes('class="directory-photo-wrap" data-path="{{item.photoPath}}" bindtap="previewDirectoryPhoto"'),
  '主图与目录照片使用原生预览并保留失败恢复态')
assert(detailTemplate.includes('现场控制器 MAC 地址')
  && detailTemplate.includes('placeholder="输入12位十六进制字符"')
  && detailTemplate.includes('wx:if="{{deviceMacValid}}" class="mac-input-hint">{{deviceMacFormatted}}')
  && !detailTemplate.includes('不保存') && !detailTemplate.includes('待填写')
  && detailScript.includes("/^[0-9a-fA-F]{12}$/")
  && detailScript.includes("transport.id !== 'udp'")
  && detailScript.includes('bytes.splice(start, macBytes.length, ...macBytes)'),
  'UDP MAC 输入、校验和六字节替换仍保持原有临时复制逻辑')
assert(detailScript.includes('setStorageSync') === false
  && detailScript.includes('wx.request') === false
  && detailScript.includes('wx.connectSocket') === false
  && detailScript.includes('wx.sendSocketMessage') === false,
  '阅读器不直接访问网络或绕过 preferences 存储')
assert(detailStyles.includes('.device-sheet{height:auto}')
  && detailStyles.includes('max-height:50vh')
  && !detailStyles.includes('.info-')
  && !detailStyles.includes('.photo-info-')
  && !detailStyles.includes('.hash-value')
  && !detailStyles.includes('.copy-summary-button')
  && !detailStyles.includes('.sheet-close')
  && !detailStyles.includes('.read-only-note')
  && !detailStyles.includes('.transport-note')
  && !detailStyles.includes('.material-status')
  && !detailStyles.includes('.directory-empty-copy')
  && !detailStyles.includes('min-height:174rpx')
  && detailStyles.includes('.command-label{') && detailStyles.includes('font-size:15px')
  && detailStyles.includes('.command-frame{') && detailStyles.includes('font-size:14px')
  && detailStyles.includes('word-break:break-all')
  && detailStyles.includes('.directory-copy{min-width:0;min-height:44px;flex:1}')
  && detailStyles.includes('.directory-select-control{display:flex;box-sizing:border-box;width:44px;min-width:44px;height:44px;')
  && detailStyles.includes('.selected-check{display:flex;box-sizing:border-box;width:20px;height:20px;')
  && detailStyles.includes('min-width:48px!important;max-width:48px;height:48px!important')
  && !detailStyles.includes('.bottom-sheet button.sheet-close')
  && detailStyles.includes('.bottom-sheet button.sheet-cancel{display:flex;box-sizing:border-box;width:100%!important')
  && detailStyles.includes('.protocol-page .mac-input-row button.mac-clear{')
  && detailStyles.includes('width:64px!important;min-width:64px!important'),
  '窄屏保留自然换行、清晰字号、44px以上触控和内容高度目录')
const indexScript = fs.readFileSync(path.join(__dirname, '../pages/control-protocol/index.js'), 'utf8')
assert(indexScript.includes("wx.redirectTo({ url: query ? `${DETAIL_URL}?${query}` : DETAIL_URL })")
  && indexScript.includes("['referenceId', 'appearanceGroupId']"),
  '轻量入口默认恢复唯一阅读器，并兼容旧显式设备参数')

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
;[
  ['smartplc-f300-sample.jpg', '2F4EEDFE79FDF8D7334970D7A4A5827D05A33C475FA1B48E5B7F5186D6AD9960'],
  ['kylin-k100r-card-sample.jpg', 'B32D37BDE592DB722F9F20E5BD68C0AF562F6ADA06A840FC23C3D3CD0E4695CF'],
].forEach(([filename, expectedHash]) => {
  const fixtureBytes = fs.readFileSync(path.join(__dirname, 'fixtures/control-protocol/draft-assets', filename))
  assert.equal(crypto.createHash('sha256').update(fixtureBytes).digest('hex').toUpperCase(), expectedHash,
    `${filename} fixture 与来源照片不一致`)
})
const packageDraftResources = [
  'pages/control-protocol/development-sample.js',
  'pages/control-protocol/development-manual.js',
  'pages/control-protocol/development-k100r-manual.js',
  'pages/control-protocol/draft-assets/smartplc-f300-sample.jpg',
  'pages/control-protocol/draft-assets/kylin-k100r-card-sample.jpg',
]
assert.equal(fs.existsSync(path.join(__dirname, 'fixtures/control-protocol/draft-assets/itc-kzx-cabinet-front.png')), false,
  '机柜正面照只留在 docs/source-copy，不进入小程序资源目录')
assert.equal(evaluateDraftProtocolPackageGate([]).allowed, true, '无草稿资源时发布门禁应允许通过')
assert.equal(evaluateDraftProtocolPackageGate(packageDraftResources).allowed, false,
  '普通发布检查必须拒绝含开发样本的包')

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

console.log('Control protocol checks passed (six empty automatic arrays; two independent manual references; strict auto-resolution gates).')
