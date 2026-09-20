const assert = require('assert')
const fs = require('fs')
const Module = require('module')
const path = require('path')
const { buildScheduleReportPages, drawScheduleReport } = require('../pages/project-wiring/report')
const { emptySchedule } = require('../utils/project-wiring')

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
    assert.ok(page.height <= 1800)
    page.rows.forEach((row) => assert.ok(row.y + row.height <= page.height - 88, '内容位于页脚之上'))
  })
  assert.ok(lineRows.some((row) => row.lines.join('').includes(`${count}. A${String(count).padStart(3, '0')}`)),
    '末条线路编号与序号完整可见')
  assert.ok(Object.isFrozen(report.pages[0]) && Object.isFrozen(report.pages[0].rows[0]), '报告布局为不可变对象')

  const labels = buildScheduleReportPages(`大型项目 ${count}`, schedule, 'labels')
  const labelRows = getRows(labels.pages, 'label')
  assert.strictEqual(labelRows.length, count * 2, '每条线路生成两个端点标签')
  const copiesByCode = new Map()
  labelRows.forEach((row) => copiesByCode.set(row.code, (copiesByCode.get(row.code) || 0) + 1))
  assert.ok([...copiesByCode.values()].every((copies) => copies === 2))
  assert.deepStrictEqual(new Set(labelRows.map((row) => row.side)), new Set(['源端标签', '目的端标签']))
}

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
  purpose: '前后场线路用途'.repeat(15),
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
maximumLegal.pages.forEach((page) => assert.ok(page.height <= 1800))
const renderedMaximumText = maximumLegal.pages.flatMap((page) => page.rows)
  .flatMap((row) => row.lines).join('')
assert.strictEqual((renderedMaximumText.match(/现场核对/g) || []).length, 60,
  '换行和最长允许备注在分页续页中均无丢失')

const appConfig = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'))
assert.ok((appConfig.subPackages || []).some((item) => item.root === 'pages/project-wiring'
  && item.pages.includes('index')), '布线页注册为独立分包入口')
const projectPage = fs.readFileSync(path.join(root, 'pages/records/project.wxml'), 'utf8')
assert.ok(projectPage.includes('class="project-wiring-card"') && projectPage.includes('bindtap="openProjectWiring"'))
assert.ok(projectPage.includes('{{project.wiringLineCount}} 条线路') && projectPage.includes('{{project.wiringPendingCount}} 条待核对'))
const detailController = fs.readFileSync(path.join(root, 'pages/records/project.js'), 'utf8')
assert.match(detailController, /const \{ wiringSchedule, \.\.\.projectViewFields \} = project/)
assert.match(detailController, /wiringLineCount: wiringSummary\.lineCount/)
assert.match(detailController, /wiringPendingCount: wiringSummary\.pendingCount/)
assert.match(detailController, /url: `\/pages\/project-wiring\/index\?id=\$\{encodeURIComponent\(this\.projectId\)\}`/)
const projectsController = fs.readFileSync(path.join(root, 'pages/projects/projects.js'), 'utf8')
assert.match(projectsController, /const \{ wiringSchedule, \.\.\.fields \} = project/)
assert.match(projectsController, /activeProject: activeProject \? projectViewFields\(activeProject\) : null/)
assert.ok(fs.readFileSync(path.join(root, 'pages/projects/projects.js'), 'utf8')
  .includes('项目及其布线资料会被删除'))

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
const recordsMock = {
  MODULES: {},
  getWorkspaceSnapshot: () => ({ projects: [mockProject], records: [], activeProject: mockProject }),
  getStorageHealth: () => ({ warning: false, text: '保存在本机', percent: 1 }),
  prepareProjectModule: () => '',
  removeRecordFromProject: () => false,
  restoreRecord: () => '',
  setActiveProject: () => true,
  updateProject: () => true,
  addRecordToProject: () => false,
  createProject: () => null,
  deleteProject: () => true,
  removeRecord: () => false,
  toggleFavoriteById: () => false,
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
  getSystemInfoSync: () => ({ theme: 'light' }),
  getAppBaseInfo: () => ({ theme: 'light' }),
}
Module._load = function loadPageDependencies(request, parent, isMain) {
  if (request === '../../utils/records' && parent && parent.filename.includes('audio-system-tool-miniapp')) {
    return recordsMock
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
  assert.strictEqual(projectsPageRuntime.data.activeProject.id, mockProject.id)
  assert.ok(!Object.prototype.hasOwnProperty.call(projectsPageRuntime.data.projects[0], 'wiringSchedule'))
  assert.ok(!Object.prototype.hasOwnProperty.call(projectsPageRuntime.data.activeProject, 'wiringSchedule'))
  assert.ok(!JSON.stringify(projectsPageRuntime.lastSetData).includes('wiringSchedule'),
    '项目首页 setData 不下发 200 条线路全文')

  const projectDetailRuntime = capturePage('pages/records/project.js')
  projectDetailRuntime.onLoad({ id: mockProject.id })
  assert.strictEqual(projectDetailRuntime.data.records.length, 0, '项目可以没有计算记录')
  assert.strictEqual(projectDetailRuntime.data.project.wiringLineCount, 200)
  assert.strictEqual(projectDetailRuntime.data.project.wiringPendingCount, 133)
  assert.ok(!Object.prototype.hasOwnProperty.call(projectDetailRuntime.data.project, 'wiringSchedule'))
  assert.ok(!JSON.stringify(projectDetailRuntime.lastSetData).includes('wiringSchedule'),
    '项目详情 setData 只下发布线摘要')
  projectDetailRuntime.openProjectWiring()
  assert.strictEqual(global.__projectWiringRoute,
    '/pages/project-wiring/index?id=project-200-lines', '0 计算记录的项目可带 id 进入布线页')
} finally {
  Module._load = originalLoad
  if (previousPage === undefined) delete global.Page
  else global.Page = previousPage
  if (previousWx === undefined) delete global.wx
  else global.wx = previousWx
  delete global.__projectWiringRoute
  delete require.cache[currentPageFile]
  const reportPath = path.join(root, 'pages/records/project-report.js')
  delete require.cache[reportPath]
}

console.log('project wiring report tests passed')
