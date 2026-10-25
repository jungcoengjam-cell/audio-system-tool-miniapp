const assert = require('assert')
const fs = require('fs')
const Module = require('module')
const path = require('path')
const { buildScheduleReportPages, drawScheduleReport } = require('../pages/project-wiring/report')
const { CONNECTOR_OPTIONS, emptySchedule, normalizeSchedule } = require('../utils/project-wiring')

const root = path.resolve(__dirname, '..')

function makeLine(index, overrides = {}) {
  return {
    id: `line-${index}`,
    code: `A${String(index).padStart(3, '0')}`,
    purpose: `线路用途 ${index}`,
    fromDevice: '调音台',
    fromPort: `OUT ${index}`,
    toDevice: '功放',
    toPort: `IN ${index}`,
    buildType: 'bulk',
    cableType: 'balanced',
    spec: '2芯屏蔽线',
    connectorA: 'xlrFemale',
    connectorB: 'xlrMale',
    lengthText: '1.5',
    status: 'pending',
    notes: '',
    ...overrides,
  }
}

function createLegacyContext() {
  const calls = []
  const methods = new Set([
    'setFillStyle', 'setStrokeStyle', 'setLineWidth', 'setFontSize', 'setTextAlign',
    'setTextBaseline', 'fillRect', 'fillText', 'beginPath', 'moveTo', 'lineTo',
    'quadraticCurveTo', 'closePath', 'fill', 'stroke',
  ])
  const context = new Proxy({}, {
    get(target, key) {
      if (methods.has(key)) return (...args) => calls.push([key, ...args])
      return target[key]
    },
    set(target, key, value) {
      target[key] = value
      calls.push(['set', key, value])
      return true
    },
  })
  return { context, calls }
}

function getRows(pages, kind) {
  return pages.flatMap((page) => page.rows.filter((row) => row.kind === kind))
}

function getLineRows(pages) {
  return pages.flatMap((page) => page.rows.filter((row) => row.kind === 'line' || row.kind === 'continuation'))
}

const empty = buildScheduleReportPages('空项目', emptySchedule())
assert.deepStrictEqual(empty.pages, [])
assert.ok(empty.text.includes('暂无线路'))

for (const count of [100, 200]) {
  const schedule = { version: 1, revision: count, nextNumber: count + 1,
    lines: Array.from({ length: count }, (_, index) => makeLine(index + 1)) }
  const report = buildScheduleReportPages(`大型项目 ${count}`, schedule, 'lines')
  const lineRows = getRows(report.pages, 'line')
  assert.strictEqual(lineRows.length, count, `${count} 条线路全部出现在分页报告中`)
  assert.deepStrictEqual(lineRows.map((row) => row.code), schedule.lines.map((line) => line.code))
  schedule.lines.forEach((line) => assert.ok(report.text.includes(line.code), `文字清单保留 ${line.code}`))
  assert.ok(report.pages.length > 1, `${count} 条线路应拆分多页`)
  report.pages.forEach((page) => {
    assert.strictEqual(page.width, 720)
    assert.ok(page.height <= 1500, '线路明细页高不超过1500逻辑像素')
    page.rows.forEach((row) => assert.ok(row.y + row.height <= page.height - 112, '线路内容给页脚留足空间'))
    page.rows.forEach((row, index) => {
      const next = page.rows[index + 1]
      if (next) assert.ok(row.y + row.height <= next.y, '同页线路卡片之间不重叠')
      row.drawItems.forEach((item) => {
        assert.ok(item.bounds.x <= item.x && item.x <= item.bounds.x + item.bounds.width,
          `${item.fieldId} text anchor remains in its field bounds`)
        assert.ok(item.bounds.width > 0 && item.bounds.x + item.bounds.width <= 664,
          `${item.fieldId} remains within the left/right column or full-width field`)
      })
    })
  })
  const lastLine = lineRows.find((row) => row.number === count)
  assert.ok(lastLine && lastLine.code === `A${String(count).padStart(3, '0')}`,
    '末条线路编号与序号完整保留')
  assert.ok(lastLine.drawItems.some((item) => item.fieldId === 'code' && item.text === lastLine.code),
    '线号以完整字段绘制')
  assert.ok(Object.isFrozen(report.pages[0]) && Object.isFrozen(report.pages[0].rows[0]), '报告布局为不可变对象')

  const labels = buildScheduleReportPages(`大型项目 ${count}`, schedule, 'labels')
  const labelRows = getRows(labels.pages, 'label')
  assert.strictEqual(labelRows.length, count * 2, '每条线路生成两个端点标签')
  const copiesByCode = new Map()
  labelRows.forEach((row) => copiesByCode.set(row.code, (copiesByCode.get(row.code) || 0) + 1))
  assert.ok([...copiesByCode.values()].every((copies) => copies === 2))
  assert.deepStrictEqual(new Set(labelRows.map((row) => row.side)), new Set(['源端标签', '目的端标签']))
}

const tokenSchedule = {
  version: 1,
  revision: 0,
  nextNumber: 2,
  lines: [makeLine(1, {
    fromDevice: '通道一',
    fromPort: '通道一input-1',
    toDevice: '舞台返送',
    toPort: 'out-a',
    spec: 'RVPE2×0.5',
  })],
}
const tokenReport = buildScheduleReportPages('短token布线', tokenSchedule, 'lines')
const tokenRow = getRows(tokenReport.pages, 'line')[0]
assert.strictEqual(tokenRow.fields.from.port, '通道一input-1')
assert.strictEqual(tokenRow.fields.to.port, 'out-a')
assert.strictEqual(tokenRow.fields.spec, 'RVPE2×0.5')
assert.ok(tokenRow.drawItems.some((item) => item.fieldId === 'from.port.value' && item.text === '通道一input-1'),
  '混合中文与ASCII端口保留input-1完整token')
assert.ok(tokenRow.drawItems.some((item) => item.fieldId === 'to.port.value' && item.text === 'out-a'),
  'ASCII端口保留out-a完整token')
assert.ok(tokenRow.drawItems.some((item) => item.fieldId === 'spec.value' && item.text === 'RVPE2×0.5'),
  '无空格型号保留RVPE2×0.5完整token')
const uppercasePortRow = getRows(buildScheduleReportPages('大写端口', {
  version: 1, revision: 0, nextNumber: 2,
  lines: [makeLine(1, { fromPort: 'MAIN-INPUT-1' })],
}, 'lines').pages, 'line')[0]
assert.ok(uppercasePortRow.drawItems.some((item) => item.fieldId === 'from.port.value' && item.text === 'MAIN-INPUT-1'),
  '列宽足够时完整保留大写 ASCII 端口 token')
assert.ok(tokenRow.drawItems.filter((item) => /\.value$/.test(item.fieldId))
  .filter((item) => ['purpose.value', 'from.device.value', 'from.port.value', 'from.connector.value',
    'to.device.value', 'to.port.value', 'to.connector.value', 'cable.value', 'length.value',
    'spec.value', 'notes.value'].includes(item.fieldId))
  .every((item) => item.fontSize >= 28), '主要线路字段值至少28px')
assert.ok(tokenRow.drawItems.filter((item) => /\.heading$/.test(item.fieldId))
  .every((item) => item.fontSize >= 28), '起点和终点列标题至少28px')
assert.strictEqual(tokenReport.pages[0].subtitleLines[0], '共 1 条 · 已核对 0 条 · 待核对 1 条')
assert.strictEqual(tokenRow.fields.status, '待施工', '单条状态沿用现有状态标签')
assert.ok(tokenReport.pages[0].nameFontSize >= 28, '项目名字号至少28px')
assert.ok(tokenReport.pages[0].summaryFontSize >= 24, '汇总行字号至少24px')
assert.ok(tokenRow.drawItems.find((item) => item.fieldId === 'status').fontSize >= 28,
  '线路状态字号至少28px')
const normalizedTokenLine = normalizeSchedule(tokenSchedule).lines[0]
assert.strictEqual(tokenRow.fields.from.device, normalizedTokenLine.fromDevice)
assert.strictEqual(tokenRow.fields.from.port, normalizedTokenLine.fromPort)
assert.strictEqual(tokenRow.fields.to.device, normalizedTokenLine.toDevice)
assert.strictEqual(tokenRow.fields.to.port, normalizedTokenLine.toPort)
assert.strictEqual(tokenRow.fields.from.connector, CONNECTOR_OPTIONS.find((option) => option.id === normalizedTokenLine.connectorA).label,
  '来源端连接头保留connectorA映射')
assert.strictEqual(tokenRow.fields.to.connector, CONNECTOR_OPTIONS.find((option) => option.id === normalizedTokenLine.connectorB).label,
  '去向端连接头保留connectorB映射')

const longToken = 'OUT-'.repeat(20)
const longTokenReport = buildScheduleReportPages('长无空格端口', {
  version: 1, revision: 0, nextNumber: 2,
  lines: [makeLine(1, { fromPort: longToken })],
}, 'lines')
const longTokenParts = getLineRows(longTokenReport.pages).flatMap((row) => row.drawItems
  .filter((item) => item.fieldId === 'from.port.value').map((item) => item.text))
assert.ok(longTokenParts.length > 1, '超长英文型号在列内按字符换行')
assert.strictEqual(longTokenParts.join(''), longToken, '长无空格英文换行不丢字符或插入连字符')

const materialSchedule = {
  version: 1,
  revision: 3,
  nextNumber: 4,
  lines: [
    makeLine(1, { lengthText: '22', status: 'checked' }),
    makeLine(2, { lengthText: '', connectorA: '', connectorB: '', status: 'connected' }),
    makeLine(3, { spec: '', connectorA: '', connectorB: '', lengthText: '', status: 'pending' }),
    makeLine(4, { buildType: 'finished', connectorA: 'rcaMale', connectorB: 'rcaFemale', lengthText: '3' }),
  ],
}
const materials = buildScheduleReportPages('报告厅布线', materialSchedule, 'materials')
const materialRows = getRows(materials.pages, 'material')
const materialText = [materials.text, ...materials.pages.flatMap((page) => page.rows.flatMap((row) => row.lines))].join('\n')
assert.ok(materialRows.some((row) => row.totalLengthText.includes('22 m') && row.unknownLengthCount > 0),
  '散线汇总保留 22 m 和未知长度数量')
assert.ok(materialText.includes('22 m'))
assert.ok(materialText.includes('长度待确认'))
assert.ok(materialText.includes('规格待确认'))
assert.ok(materialText.includes('接头待确认'))
assert.ok(materialText.includes('成品线（含两端接头）'))
assert.ok(materialText.includes('散线接头（单独核对）'))
const bulkRow = materialRows.find((row) => row.key.startsWith('bulk:'))
assert.ok(bulkRow.lines.join('').includes('已知长度：22 m'))
assert.ok(bulkRow.lines.join('').includes('待确认长度：1 条'))
assert.ok(!bulkRow.lines.join('').includes('总长度：22 m'), '散线长度不重复显示')
const connectorRow = materialRows.find((row) => row.key.startsWith('connector:') && row.quantity !== null)
assert.ok(connectorRow)
assert.strictEqual(connectorRow.lines.filter((line) => line.includes('数量')).length, 1, '接头数量只显示一次')
assert.ok(getRows(materials.pages, 'notice').length, '资料缺项时提示待补全')
const completeMaterials = buildScheduleReportPages('齐全项目', {
  version: 1, revision: 0, nextNumber: 2,
  lines: [makeLine(1, { lengthText: '6' })],
}, 'materials')
assert.strictEqual(getRows(completeMaterials.pages, 'notice').length, 0, '资料完整时不显示缺项提示')

const lineReport = buildScheduleReportPages('报告厅布线', materialSchedule, 'lines')
const { context, calls } = createLegacyContext()
drawScheduleReport(context, lineReport.pages[0], { theme: 'dark' })
assert.ok(calls.some((call) => call[0] === 'setFontSize'), '使用旧版 Canvas setFontSize')
assert.ok(calls.some((call) => call[0] === 'setFillStyle'), '使用旧版 Canvas setFillStyle')
assert.ok(calls.some((call) => call[0] === 'fillText'), '使用旧版 Canvas fillText')
;['setStrokeStyle', 'setLineWidth', 'setTextAlign', 'setTextBaseline', 'fillRect', 'beginPath',
  'moveTo', 'lineTo', 'quadraticCurveTo', 'closePath', 'fill', 'stroke']
  .forEach((method) => assert.ok(calls.some((call) => call[0] === method), `兼容旧版 Canvas ${method}`))
assert.ok(!calls.some((call) => call[0] === 'measureText'), '绘制不依赖 measureText')
assert.ok(!calls.some((call) => ['draw', 'strokeRect'].includes(call[0])))

const maximumLegalLine = makeLine(1, {
  code: `A${'1'.repeat(31)}`,
  purpose: `${'前后场线路用途'.repeat(14)}现场`,
  fromDevice: '调音台'.repeat(30),
  fromPort: '输出端口'.repeat(20),
  toDevice: '处理器'.repeat(30),
  toPort: '输入端口'.repeat(20),
  spec: '2芯屏蔽'.repeat(15),
  connectorA: '自定义接头'.repeat(10),
  connectorB: '自定义接头'.repeat(10),
  notes: '现场核对\n'.repeat(60),
})
const maximumLegal = buildScheduleReportPages('复杂项目名称'.repeat(10), {
  version: 1, revision: 0, nextNumber: 2, lines: [maximumLegalLine],
}, 'lines')
assert.ok(maximumLegal.pages.length >= 1)
maximumLegal.pages.forEach((page) => {
  assert.ok(page.height <= 1500)
  page.rows.forEach((row) => assert.ok(row.y + row.height <= page.height - 112,
    '超长内容续页也为页脚留出空间'))
})
const maximumLegalRows = getLineRows(maximumLegal.pages)
const normalizedMaximumLine = normalizeSchedule({
  version: 1, revision: 0, nextNumber: 2, lines: [maximumLegalLine],
}).lines[0]
assert.strictEqual(maximumLegalRows[0].kind, 'line')
assert.ok(maximumLegalRows.slice(1).every((row) => row.kind === 'continuation'),
  '单条超高内容使用明确的续页卡片')
assert.ok(maximumLegalRows.every((row, index) => row.partIndex === index && row.number === 1),
  '超高线路续页保持相同的线路序号和连续片段顺序')
assert.ok(maximumLegalRows.every((row) => row.fields.code === normalizedMaximumLine.code
  && row.fields.purpose === normalizedMaximumLine.purpose
  && row.fields.from.device === normalizedMaximumLine.fromDevice
  && row.fields.from.port === normalizedMaximumLine.fromPort
  && row.fields.to.device === normalizedMaximumLine.toDevice
  && row.fields.to.port === normalizedMaximumLine.toPort),
'续页保留规范化线路字段，不改起终点或线号')
maximumLegalRows.forEach((row, index) => {
  const codeLines = row.drawItems.filter((item) => item.fieldId === 'code').map((item) => item.text)
  assert.strictEqual(codeLines.join(''), `${normalizedMaximumLine.code}${index ? '（续）' : ''}`,
    '续页标题显示完整线号及续页标记')
})
const renderedMaximumText = maximumLegal.pages.flatMap((page) => page.rows)
  .flatMap((row) => row.lines).join('')
assert.strictEqual((renderedMaximumText.match(/现场核对/g) || []).length, 60,
  '换行和最长允许备注在分页续页中均无丢失')
const renderedMaximumNotes = maximumLegalRows.flatMap((row) => row.drawItems
  .filter((item) => item.fieldId === 'notes.value').map((item) => item.text))
assert.strictEqual((renderedMaximumNotes.join('').match(/现场核对/g) || []).length, 60,
  '备注60行内容跨续页完整且顺序不变')

const appConfig = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'))
assert.ok((appConfig.subPackages || []).some((item) => item.root === 'pages/project-wiring'
  && item.pages.includes('index')), '布线页注册为独立分包入口')
const projectPage = fs.readFileSync(path.join(root, 'pages/records/project.wxml'), 'utf8')
function findViewBlock(source, className) {
  const opening = [...source.matchAll(/<view\b([^>]*)>/g)].find((match) => {
    const classAttribute = /\bclass="([^"]+)"/.exec(match[1])
    return classAttribute && classAttribute[1].split(/\s+/).includes(className)
  })
  assert.ok(opening, `应存在 ${className} 区域`)
  const tags = /<\/?view\b[^>]*>/g
  tags.lastIndex = opening.index
  let depth = 0
  let match
  while ((match = tags.exec(source))) {
    if (/^<\/view\b/.test(match[0])) depth -= 1
    else if (!/\/\s*>$/.test(match[0])) depth += 1
    if (depth === 0) return source.slice(opening.index, tags.lastIndex)
  }
  assert.fail(`未找到 ${className} 区域的结束标签`)
}
function findButton(source, handler) {
  return [...source.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)]
    .map((match) => ({ attributes: match[1], content: match[2] }))
    .find((button) => {
      const binding = /\bbindtap="([^"]+)"/.exec(button.attributes)
      return binding && binding[1] === handler
    })
}
function buttonAriaLabel(button) {
  const label = /\baria-label="([^"]+)"/.exec(button.attributes)
  return label && label[1]
}
const heroBlock = findViewBlock(projectPage, 'interior-hero')
const moduleButton = findButton(heroBlock, 'openAddProjectModule')
assert.strictEqual(moduleButton, undefined, '项目详情hero不显示添加模块按钮')
const wiringStart = projectPage.indexOf('wx:if="{{showWiring}}"')
const wiringEnd = projectPage.indexOf('wx:if="{{showLighting}}"', wiringStart)
const wiringSection = projectPage.slice(wiringStart, wiringEnd)
assert.ok(wiringStart >= 0 && wiringEnd > wiringStart, '项目页应保留线路内容区')
const wiringButton = findButton(wiringSection, 'openProjectWiring')
assert.strictEqual(wiringButton, undefined, '项目详情线路区不显示添加/管理线路按钮')
const wiringLoop = /<view\b(?=[^>]*\bwx:for="\{\{wiringLines\}\}")[^>]*>/.exec(wiringSection)
assert.ok(wiringLoop, '已有线路必须以循环行渲染')
assert.match(wiringLoop[0], /\bwx:key="id"/, '线路循环必须使用稳定线路 ID')
const wiringRowTags = /<\/?view\b[^>]*>/g
wiringRowTags.lastIndex = wiringLoop.index + wiringLoop[0].length
let wiringRowDepth = 1
let wiringRowEnd = -1
let wiringTag
while ((wiringTag = wiringRowTags.exec(wiringSection))) {
  if (/^<\/view\b/.test(wiringTag[0])) wiringRowDepth -= 1
  else if (!/\/\s*>$/.test(wiringTag[0])) wiringRowDepth += 1
  if (wiringRowDepth === 0) {
    wiringRowEnd = wiringRowTags.lastIndex
    break
  }
}
assert.ok(wiringRowEnd > 0, '线路循环行必须有完整内容节点')
const wiringLoopBlock = wiringSection.slice(wiringLoop.index, wiringRowEnd)
assert.match(wiringLoopBlock,
  /data-id="\{\{item\.id\}\}" bindtap="openProjectWiring"/,
  '循环线路行内的稳定 ID 内容节点仍可进入布线页')
assert.ok(wiringSection.includes('{{wiringLines.length}} 条'), '线路区计数应绑定当前可见行数')
assert.ok(projectPage.includes('wx:elif="{{projectTypeEmpty}}"')
  && projectPage.includes('这个项目还没有内容'), '空项目保留清楚的空状态')
const detailController = fs.readFileSync(path.join(root, 'pages/records/project.js'), 'utf8')
assert.match(detailController, /const \{ wiringSchedule, \.\.\.projectViewFields \} = project/)
assert.match(detailController, /wiringLineCount: wiringSummary\.lineCount/)
assert.match(detailController, /wiringPendingCount: wiringSummary\.pendingCount/)
assert.match(detailController, /url: `\/pages\/project-wiring\/index\?id=\$\{encodeURIComponent\(this\.projectId\)\}`/)
assert.match(detailController, /wiringCount = Number\(project\.wiringLineCount\) \|\| 0/)
assert.match(detailController, /独立收藏不会删除/)
assert.match(detailController, /deleteProject\(projectId\)/)
const projectsController = fs.readFileSync(path.join(root, 'pages/projects/projects.js'), 'utf8')
assert.match(projectsController, /function projectLines\(project\)[\s\S]*?Array\.isArray\(lines\) \? lines\.length : 0/)
assert.match(projectsController, /const wiringCount = projectLines\(project\)/)
assert.match(projectsController, /wiringCount \? `\$\{wiringCount\} 条线路` : ''/)

const mockProject = {
  id: 'project-200-lines',
  name: '项目布线测试',
  createdAt: 1000,
  updatedAt: 2000,
  projectDate: '2026-09-20',
  wiringSchedule: {
    version: 1,
    revision: 20,
    nextNumber: 201,
    lines: Array.from({ length: 200 }, (_, index) => ({
      id: `line-${index + 1}`,
      code: `A${String(index + 1).padStart(3, '0')}`,
      status: index % 3 === 0 ? 'checked' : 'pending',
    })),
  },
}
const otherProject = {
  id: 'project-active-b', name: '另一个活动项目', createdAt: 1001, updatedAt: 2001,
  wiringSchedule: { version: 1, revision: 0, nextNumber: 1, lines: [] },
}
const emptyProject = {
  id: 'project-empty-wiring', name: '尚无线缆的项目', createdAt: 1002, updatedAt: 2002,
  wiringSchedule: { version: 1, revision: 0, nextNumber: 1, lines: [] },
}
let workspaceProjects = [mockProject, otherProject]
let activeProjectSnapshot = mockProject
let snapshotReads = 0
let setActiveProjectCalls = 0
const storageMutationCalls = []
const trackMutation = (name, result) => (...args) => {
  storageMutationCalls.push({ name, args })
  return result
}
const recordsMock = {
  MODULES: {},
  getWorkspaceSnapshot: () => {
    snapshotReads += 1
    return { ok: true, projects: workspaceProjects, records: [], favorites: [], recoveryEntries: [], activeProject: activeProjectSnapshot }
  },
  getStorageHealth: () => ({ warning: false, text: '保存在本机', percent: 1 }),
  prepareProjectModule: trackMutation('prepareProjectModule', ''),
  removeRecordFromProject: trackMutation('removeRecordFromProject', false),
  restoreRecord: trackMutation('restoreRecord', ''),
  setActiveProject: (...args) => {
    setActiveProjectCalls += 1
    storageMutationCalls.push({ name: 'setActiveProject', args })
    return true
  },
  updateProject: trackMutation('updateProject', true),
  addRecordToProject: trackMutation('addRecordToProject', false),
  createProject: trackMutation('createProject', null),
  deleteProject: trackMutation('deleteProject', true),
  removeRecord: trackMutation('removeRecord', false),
  toggleFavoriteById: trackMutation('toggleFavoriteById', false),
}
const previousPage = global.Page
const previousWx = global.wx
const originalLoad = Module._load
let pageDefinition = null
let currentPageFile = ''
global.Page = (definition) => { pageDefinition = definition }
global.wx = {
  setNavigationBarTitle: () => {},
  navigateTo: ({ url }) => { global.__projectWiringRoute = url },
  showActionSheet: (options) => { global.__projectActionSheet = options },
  getStorageSync: () => undefined,
  setStorageSync: () => {},
  removeStorageSync: () => {},
  getSystemInfoSync: () => ({ theme: 'light' }),
  getAppBaseInfo: () => ({ theme: 'light' }),
}
Module._load = function loadPageDependencies(request, parent, isMain) {
  if (request === '../../utils/records' && parent && parent.filename === currentPageFile) {
    return recordsMock
  }
  if (request === '../dmx-layout/lighting-workspace' && parent
    && parent.filename === path.join(root, 'pages/records/project.js')) {
    return { readLightingWorkspace: () => ({ ok: true, scheme: null, revision: 0 }), calculateScheme: () => null }
  }
  return originalLoad.call(this, request, parent, isMain)
}
function capturePage(relativeFile) {
  currentPageFile = path.join(root, relativeFile)
  pageDefinition = null
  delete require.cache[require.resolve(currentPageFile)]
  require(currentPageFile)
  assert.ok(pageDefinition, `${relativeFile} 注册页面`)
  return {
    ...pageDefinition,
    data: JSON.parse(JSON.stringify(pageDefinition.data)),
    setData(patch, callback) {
      this.lastSetData = patch
      Object.assign(this.data, patch)
      if (callback) callback()
    },
  }
}
try {
  const projectsPageRuntime = capturePage('pages/projects/projects.js')
  projectsPageRuntime.onShow()
  assert.strictEqual(projectsPageRuntime.data.projects[0].id, mockProject.id)
  assert.strictEqual(projectsPageRuntime.data.projects[0].wiringCount, 200)
  assert.ok(projectsPageRuntime.data.projects[0].contentText.includes('200 条线路'))
  assert.ok(!Object.prototype.hasOwnProperty.call(projectsPageRuntime.data.projects[0], 'wiringSchedule'))
  assert.ok(!Object.prototype.hasOwnProperty.call(projectsPageRuntime.data, 'activeProject'),
    '项目列表不冒充详情页的活动项目选择状态')
  assert.ok(!JSON.stringify(projectsPageRuntime.lastSetData).includes('wiringSchedule'),
    '项目首页 setData 不下发 200 条线路全文')

  const projectDetailRuntime = capturePage('pages/records/project.js')
  projectDetailRuntime.onLoad({ id: mockProject.id })
  assert.strictEqual(projectDetailRuntime.data.records.length, 0, '项目可以没有计算记录')
  assert.strictEqual(projectDetailRuntime.data.project.wiringLineCount, 200)
  assert.strictEqual(projectDetailRuntime.data.project.wiringPendingCount, 133)
  assert.strictEqual(projectDetailRuntime.data.showWiring, true, '已有线路会进入线路内容区')
  assert.strictEqual(projectDetailRuntime.data.wiringLines.length, 200, '线路区展示完整的当前行数')
  assert.ok(!Object.prototype.hasOwnProperty.call(projectDetailRuntime.data.project, 'wiringSchedule'))
  assert.ok(!JSON.stringify(projectDetailRuntime.lastSetData).includes('wiringSchedule'),
    '项目详情 setData 只下发布线摘要')
  activeProjectSnapshot = otherProject
  const firstOnShowReads = snapshotReads
  projectDetailRuntime.onShow()
  assert.strictEqual(snapshotReads, firstOnShowReads, 'onLoad 后首次 onShow 只消费初始化标记')
  const beforeExistingEntry = storageMutationCalls.length
  projectDetailRuntime.openProjectWiring()
  assert.strictEqual(global.__projectWiringRoute,
    '/pages/project-wiring/index?id=project-200-lines', '已有线路项目使用当前项目 id 进入布线页')
  assert.strictEqual(activeProjectSnapshot.id, otherProject.id, '打开布线页不偷偷切换活动项目')
  assert.strictEqual(setActiveProjectCalls, 0, '导航布线页不调用设置活动项目')
  assert.strictEqual(storageMutationCalls.length, beforeExistingEntry, '已有线路导航不写入记录或项目存储')

  const readsBeforeReturn = snapshotReads
  const mutationsBeforeReturn = storageMutationCalls.length
  mockProject.wiringSchedule.lines.push(makeLine(201))
  mockProject.wiringSchedule.revision += 1
  projectDetailRuntime.onShow()
  assert.strictEqual(snapshotReads, readsBeforeReturn + 1, '从布线页返回后刷新一次项目快照')
  assert.strictEqual(projectDetailRuntime.data.wiringLines.length, 201, '返回后显示新保存的线路')
  assert.strictEqual(projectDetailRuntime.data.project.wiringLineCount, 201)
  assert.strictEqual(projectDetailRuntime.data.project.wiringPendingCount, 134)
  assert.strictEqual(projectDetailRuntime.data.records.length, 0, '线路返回刷新不生成重复计算记录')
  assert.strictEqual(activeProjectSnapshot.id, otherProject.id, '返回线路页仍保持原活动项目')
  assert.strictEqual(storageMutationCalls.length, mutationsBeforeReturn, '返回刷新不触发详情页存储写入')

  workspaceProjects = [emptyProject, otherProject]
  activeProjectSnapshot = otherProject
  const emptyDetailRuntime = capturePage('pages/records/project.js')
  emptyDetailRuntime.onLoad({ id: emptyProject.id })
  assert.strictEqual(emptyDetailRuntime.data.records.length, 0)
  assert.strictEqual(emptyDetailRuntime.data.showWiring, false, '零线路项目显示空态而非线路列表')
  assert.strictEqual(emptyDetailRuntime.data.projectTypeEmpty, true, '零内容项目进入项目空状态')
  const activeBeforeAdd = activeProjectSnapshot.id
  const setActiveBeforeAdd = setActiveProjectCalls
  const mutationsBeforeEmptyEntry = storageMutationCalls.length
  emptyDetailRuntime.openAddProjectModule()
  assert.ok(global.__projectActionSheet, '添加模块入口打开现有模块操作菜单')
  assert.ok(global.__projectActionSheet.itemList.includes('通道与线缆'), '模块菜单包含线路入口')
  global.__projectActionSheet.success({ tapIndex: 1 })
  assert.strictEqual(global.__projectWiringRoute,
    '/pages/project-wiring/index?id=project-empty-wiring', '空项目可经添加模块菜单进入线路页')
  assert.strictEqual(activeProjectSnapshot.id, activeBeforeAdd, '空项目布线入口不切换活动项目')
  assert.strictEqual(setActiveProjectCalls, setActiveBeforeAdd, '空项目布线入口不修改活动项目状态')
  assert.strictEqual(storageMutationCalls.length, mutationsBeforeEmptyEntry, '打开空项目线路入口不写入记录或项目存储')
} finally {
  Module._load = originalLoad
  if (previousPage === undefined) delete global.Page
  else global.Page = previousPage
  if (previousWx === undefined) delete global.wx
  else global.wx = previousWx
  delete global.__projectWiringRoute
  delete global.__projectActionSheet
  delete require.cache[currentPageFile]
}

console.log('project wiring report tests passed')
