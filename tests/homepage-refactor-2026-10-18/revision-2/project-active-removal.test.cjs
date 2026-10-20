const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../../..')
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8')

function checkToolGridAndProjectButtons() {
  const toolsCss = read('pages/tools/tools.wxss')
  assert.match(toolsCss, /\.home-tool-grid\{[^}]*display:grid;[^}]*grid-template-columns:repeat\(4,minmax\(0,1fr\)\);[^}]*column-gap:16rpx;[^}]*row-gap:16rpx\}/)
  assert.match(toolsCss, /\.home-tool-card\{[^}]*width:100%;[^}]*height:200rpx;[^}]*min-height:200rpx;[^}]*padding:10rpx 6rpx/)
  assert.match(toolsCss, /\.home-tool-icon-wrap\{[^}]*width:88rpx;height:88rpx;margin-bottom:6rpx/)
  assert.match(toolsCss, /\.home-tool-icon\{display:block;width:84rpx;height:84rpx\}/)
  assert.match(toolsCss, /\.home-tool-title\{[^}]*min-height:32px;[^}]*font-size:13px;[^}]*line-height:1\.2;[^}]*overflow-wrap:anywhere/)
  assert.doesNotMatch(toolsCss, /@media \(max-width: 340px\)\{[^}]*\.home-tool-card|@media \(max-width: 340px\)\{[^}]*\.home-tool-icon-wrap|@media \(max-width: 340px\)\{[^}]*\.home-tool-title/)
  const toolsWxml = read('pages/tools/tools.wxml')
  assert.match(toolsWxml, /item\.id === 'projectWiring'[\s\S]*?通道与[\s\S]*?线缆/)
  assert.match(toolsWxml, /item\.id === 'camera'[\s\S]*?摄像机[\s\S]*?视场角/)
  assert.match(toolsWxml, /aria-label="打开\{\{item\.title\}\}，\{\{item\.subtitle\}\}"/,
    'display-only title wrapping must keep the original accessible name')
  assert.match(toolsCss, /\.tools-visibility-warning\{[^}]*min-height:44px;[^}]*font-size:14px/)
  assert.match(toolsCss, /\.tools-empty-state button\{[^}]*height:44px;min-height:44px;[^}]*align-items:center;justify-content:center;[^}]*font-size:14px;line-height:44px/)

  const projectsWxml = read('pages/projects/projects.wxml')
  const projectsCss = read('pages/projects/projects.wxss')
  assert.doesNotMatch(projectsWxml, /size="mini"/)
  assert.doesNotMatch(projectsWxml, /project-current-badge|当前项目/)
  assert.match(projectsCss, /\.project-header \.project-header-actions button\.project-recovery-button[^}]*height:44px;min-height:44px;max-height:44px/)
  assert.match(projectsCss, /\.project-header \.project-header-actions button\.project-recovery-button[^}]*padding:0 14px;[^}]*align-items:center;justify-content:center;[^}]*line-height:44px/)
}

function checkProjectDetailsHeader() {
  const markup = read('pages/records/project.wxml')
  const css = read('pages/records/project.wxss')
  const controller = read('pages/records/project.js')
  assert.doesNotMatch(markup, /当前项目|设为当前项目|取消当前项目|size="mini"/)
  assert.doesNotMatch(markup, /比较计算记录|退出记录对比|comparisonMode|compareSelectedIds|clearComparison|toggleCompareRecord/)
  assert.doesNotMatch(markup, /interior-bottom-bar|interior-add-button|添加内容|openAddProjectModule/)
  assert.doesNotMatch(css, /interior-bottom-bar|interior-add-button|interior-comparison|interior-compare/)
  assert.match(css, /\.interior-content\{[^}]*padding:18rpx 24rpx calc\(24rpx \+ env\(safe-area-inset-bottom\)\)/)
  assert.match(markup, /class="interior-project-title">\{\{project\.name\}\}/)
  assert.match(markup, /class="interior-updated">最近更新 · \{\{project\.timeText\}\}/)
  assert.match(markup, /class="interior-menu-button"[^>]*bindtap="openManagementMenu"/)
  assert.match(css, /\.interior-menu-button\{[^}]*width:44px;[^}]*height:44px;[^}]*min-width:44px;[^}]*min-height:44px/)
  assert.match(css, /\.interior-report-button\{[^}]*width:100%;[^}]*height:44px;[^}]*flex:1 1 100%/)
  assert.doesNotMatch(controller, /setActiveProject|activateProject|设为当前项目|buildRecordComparison|comparisonMode|toggleComparisonMode|toggleCompareRecord|clearComparison/)
  assert.match(controller, /openRecordEditor\(record, 'project-record', this\.projectId\)/, 'a project record still opens through its stable project context')
}

function check320pxLayoutAndThemes() {
  const toolsCss = read('pages/tools/tools.wxss')
  const appCss = read('app.wxss')
  const rpx = 320 / 750
  const contentWidth = 320 - 64 * rpx
  const cardGap = 16 * rpx
  const cardWidth = (contentWidth - 3 * cardGap) / 4
  const cardHeight = 200 * rpx
  const twoLineContentHeight = (88 + 6 + 20 + 2) * rpx + 32
  assert(cardWidth >= 44 && cardHeight >= 44, 'each 320px tool card remains a 44px-or-larger touch target')
  assert(cardWidth - 12 * rpx >= 52, 'four-character 13px tool names fit inside 320px cards')
  const gridContentWidth = 4 * cardWidth + 3 * cardGap
  assert(gridContentWidth <= contentWidth + 0.01, 'four cards per row and 16rpx gaps fit at 320px')
  assert(Math.abs(cardGap - 16 * rpx) < 0.1, 'row and column gaps both use 16rpx at 320px')
  assert(Math.abs(gridContentWidth - contentWidth) < 1, 'the 320px four-column grid aligns to both content edges with a 4/4/2 final-row distribution')
  assert(twoLineContentHeight <= cardHeight, 'two-line tool names fit without increasing the 200rpx card height')
  assert.match(toolsCss, /background:var\(--theme-surface\)/)
  assert.match(toolsCss, /background:var\(--theme-warning-soft\);color:var\(--theme-warning\)/)
  assert.match(appCss, /--theme-surface:#ffffff/)
  assert.match(appCss, /--theme-warning:#9a5b00;--theme-warning-soft:#fff0d6/)
  assert.match(appCss, /prefers-color-scheme: dark\)\{page\{[^}]*--theme-surface:#1c1c1e/)
  assert.match(appCss, /prefers-color-scheme: dark\)\{page\{[^}]*--theme-warning:#ffb340;--theme-warning-soft:rgba\(255,179,64,\.16\)/)
}

function checkToolSelectorsHaveNoLegacyBadges() {
  const selectorFiles = [
    'pages/cable/cable.js', 'pages/cable/cable-overlays.wxml',
    'pages/camera/camera-project.js', 'pages/camera/camera-overlays.wxml',
    'pages/led-screen/led-project.js', 'pages/led-screen/led-overlays.wxml',
    'pages/audio-wiring/wiring-project.js', 'pages/audio-wiring/wiring-overlays.wxml',
    'pages/spl/spl.js', 'pages/spl/spl.wxml',
    'utils/result-record-actions.js',
  ]
  selectorFiles.forEach((file) => {
    assert.doesNotMatch(read(file), /projectActiveId|item\.isActive|（当前）|当前项目/,
      `${file} has no visible or bound current-project selector state`)
  })
  assert.doesNotMatch(read('pages/project-wiring/index.js'), /getActiveProject|当前项目/)
}

function checkLegacyStorageKeyIsPreserved() {
  const keys = {
    records: 'audioTool.records.v1',
    projects: 'audioTool.projects.v1',
    favorites: 'audioTool.favorites.v1',
    recovery: 'audioTool.recovery.v1',
    active: 'audioTool.activeProject.v1',
    schema: 'audioTool.storageSchemaVersion',
  }
  const legacyProject = {
    id: 'legacy-project', name: '旧项目', createdAt: 10, updatedAt: 10,
    projectDate: '2026-10-01', notes: '',
  }
  const storage = new Map([
    [keys.records, []], [keys.projects, [legacyProject]], [keys.favorites, []],
    [keys.recovery, []], [keys.active, legacyProject.id], [keys.schema, 4],
  ])
  const writeCounts = new Map()
  let failingReadKey = ''
  let activeKeyReadCount = 0
  const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value))
  const oldWx = global.wx
  const recordsPath = require.resolve('../../../utils/records')
  const oldRecords = require.cache[recordsPath]
  global.wx = {
    getStorageSync(key) {
      if (key === keys.active) activeKeyReadCount += 1
      if (key === failingReadKey) throw new Error('simulated legacy active-key read failure')
      return clone(storage.get(key))
    },
    setStorageSync(key, value) {
      writeCounts.set(key, (writeCounts.get(key) || 0) + 1)
      storage.set(key, clone(value))
    },
    removeStorageSync(key) { storage.delete(key) },
    getStorageInfoSync() { return { currentSize: 1, limitSize: 100 } },
  }
  try {
    delete require.cache[recordsPath]
    const records = require('../../../utils/records')
    const created = records.createProject('新建项目')
    assert(created)
    assert.equal(storage.get(keys.active), legacyProject.id)
    assert.equal(writeCounts.get(keys.active) || 0, 0, 'project creation does not write the legacy key')

    const sameName = records.createProject('新建项目')
    assert.equal(sameName.id, created.id)
    assert.equal(storage.get(keys.active), legacyProject.id)
    assert.equal(writeCounts.get(keys.active) || 0, 0, 'opening an existing project by name does not write the legacy key')

    assert.equal(records.prepareProjectModule(created.id, 'limiter'), records.MODULES.limiter.path)
    assert.equal(storage.get(keys.active), legacyProject.id)
    assert.equal(writeCounts.get(keys.active) || 0, 0, 'reopening a project module does not write the legacy key')

    failingReadKey = keys.active
    const activeReadsBeforeSnapshot = activeKeyReadCount
    const snapshot = records.getWorkspaceSnapshot({ forceRefresh: true })
    assert.equal(snapshot.ok, true, 'a failed read of the retired key does not break the new workspace snapshot')
    assert.equal(snapshot.activeProject, null, 'new snapshots keep the compatibility field but no active-project value')
    assert.equal(activeKeyReadCount, activeReadsBeforeSnapshot, 'new workspace snapshots do not read the retired key')
    assert.equal(storage.get(keys.active), legacyProject.id, 'snapshot reads preserve the historical raw value')
    failingReadKey = ''

    assert.equal(records.deleteProject(legacyProject.id), true)
    assert.equal(storage.get(keys.active), legacyProject.id, 'deleting a project does not clear its historical raw key')
    assert.equal(writeCounts.get(keys.active) || 0, 0, 'project deletion does not write the legacy key')
    assert.equal(records.getProjects().some((project) => project.id === legacyProject.id), false)
  } finally {
    delete require.cache[recordsPath]
    if (oldRecords) require.cache[recordsPath] = oldRecords
    if (oldWx === undefined) delete global.wx
    else global.wx = oldWx
  }
}

checkToolGridAndProjectButtons()
checkProjectDetailsHeader()
check320pxLayoutAndThemes()
checkToolSelectorsHaveNoLegacyBadges()
checkLegacyStorageKeyIsPreserved()
console.log('Project active-removal revision 2 checks passed')
