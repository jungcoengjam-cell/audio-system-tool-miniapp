'use strict'

const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const root = path.resolve(__dirname, '..')
const beforeRoot = path.join(root, 'tmp/architecture-continuation-2026-10-25/before')
const tracePath = path.join(root, 'tmp/architecture-continuation-2026-10-25/phase7-compile/before-entry-traces.json')
const helperPath = path.join(root, 'tests/helpers/dmx-compile.cjs')
const entryDirectories = [
  'dmx-ui-refactor-2026-10-18',
  'dmx-ui-refinements-2026-10-18',
  'dmx-ui-native-fixes-2026-10-18',
  'dmx-ui-round3-2026-10-18',
]
const nativeRuntimeByDirectory = {
  'dmx-ui-refactor-2026-10-18': 'NOT RUN',
  'dmx-ui-refinements-2026-10-18': 'NOT RUN',
  'dmx-ui-native-fixes-2026-10-18': 'See separate native evidence; compiler result alone does not verify runtime',
  'dmx-ui-round3-2026-10-18': 'NOT RUN',
}
const compileOutputRoot = 'tmp/architecture-continuation-2026-10-25/phase7-compile/contract'
const FIXED_NOW = '2026-10-25T12:34:56.000Z'
// Includes app.json's Wi-Fi preloadRule and the approved disclosure-motion UI source compilation.
// wcsc adds the shared styles/disclosure-motion.wxss input (-pc 5 -> 6).
// Authorized UI inputs: app.wxss, pages/dmx-address/dmx-address.wxml/.wxss,
// pages/dmx-layout/dmx-layout.wxml/.wxss, and styles/disclosure-motion.wxss.
// Previous trace digest after the Wi-Fi preloadRule: 1c3d8d27a747f8967d8c895b3b993bec3ec9bd8ffa3183194d0174e0a098ec0c
// Prior frozen digest before the identical reset/share mask rules moved from five page sheets into app.wxss.
// Trace field changes were limited to app.wxss content hashes; compile commands, inputs, exits, and other hashes match.
// Previous frozen digest: b0ded4aa08fb16dca2c2c39fd5ca935b75c50da9194f0bc1cc7367f5cc82a41a
// 2026-10-30 approved placement/marking UI update: all 16 traces were compared against the task-start source snapshot.
// Only the four DMX WXML/WXSS source hashes changed; commands, input paths, outputs, exit codes, and other hashes match.
// Previous frozen digest: 1ad376442c62e48a0c32d4375f921dbd65b0e6680a63db0824f2f65ec6609458
// 2026-10-30 overview-only style correction: compiler entry behavior remains unchanged (--compare-before).
// Previous frozen digest before the DMX overview WXSS source hash change: 22d9eb9ab2c8a749f0f235db2ae297b636edb14596324af704d9041d1b3672d9
// 2026-10-31 approved placement-panel markup/style update: --compare-before passes all 16 traces.
// Substituting the task-start dmx-layout hashes (WXML bad76b0e5d251321f6cf9bdff77d3923f7192fd089febb63507086ee074db8f2,
// WXSS 8e4da9205f413975e43da3ce41f71a3bfbcc2b38ccdb2e038d42c229e61e02ad) reproduces the previous digest exactly,
// confirming other source hashes and all compiler inputs, commands, outputs, and exits match.
// Previous frozen digest before this approved dmx-layout WXML/WXSS update: b5de3c051765f567bdaf381ea37f10e6fc663795fc5f7ff5f898eace237575c6
// 2026-10-31 canvas-locked single/double-tap panel revision: --compare-before passed all 16 traces.
// Against the task-start snapshot, compiler inputs changed only in the authorized placement WXML/WXSS
// and the paired address-mark WXSS; commands, outputs, and exit codes remained identical.
// Previous frozen digest before this approved placement/address-mark UI update: 692354c75927182db4f2842f78241389d9b8fc4b0524df659f69530811ae1faf
// 2026-10-31 approved removal of the shifting placement notice; --compare-before passes all 16 traces.
// The compiler commands, input paths, outputs, and exits are unchanged; only the authorized layout WXML/WXSS source hashes changed.
// Previous frozen digest before this placement notice update: 78ba62af39c69e5f5db3244b1170ccccb6a1550197c3b2ef36211a9256b194ac
// 2026-10-31 approved address-check corner alignment; compiler commands, paths, outputs, and exits are unchanged.
// Only the authorized DMX address-page WXSS source hash changed.
// Previous frozen digest before this address-chip alignment: 821af340a44db1729b7744aadb13aab70a9e574e4b456fdb15e4c6a6d3a461db
// 2026-10-31 approved products subpackage and control-protocol on-demand loading: --compare-before passes all 16 traces.
// Only the app.json hash changes in the frozen digest; compiler commands, inputs, outputs, and exit codes match.
// Previous/current app.json SHA-256: d6ebafed9ef4c9edb2b6ab06787026e56b79baac2de3c7b882db93d5fc5479ba / 1488791e84c1b4d5337351f7291b408c0364050ed5e7e26f2ff3fe29ab22281d.
// Previous frozen digest before this app.json update: 8fa90aee0114bc6bd0149b051170ce7e37568c23c49a022955f7450b04cbf946
const FROZEN_TRACE_SHA256 = '900bcacbbb5cc43f9dc4730e5f9c78f2bde6fa386f5095680b92ebb3ddacfba6'
// Hash of the approved result-subwindow CSS block in app.wxss. Any further
// changes in that block require review before this narrowly scoped removal.
const RESULT_PANEL_CSS_SHA256 = '7b8246563970fd68ac61a2ae4401b4810f564c936bc93d1df66b19ab89d63589'
const APPROVED_PROJECT_SELECT_STYLE_BLOCK = `
/* Project selection keeps the search and actions visible while only the list scrolls. */
.result-sheet.result-save.result-save.project-select-sheet{height:auto;max-height:calc(100vh - env(safe-area-inset-top) - 12px)}
.result-sheet.result-save.result-save.project-select-sheet.project-select-sheet{--project-select-row:96px}
.result-sheet.result-save.result-save.project-select-sheet .project-select-body{display:flex;box-sizing:border-box;width:100%;height:auto;min-height:0;max-height:none;flex:0 1 auto;flex-direction:column;overflow:visible}
.result-sheet.result-save.result-save.project-select-sheet .project-select-body>input{flex:none}
.result-sheet.result-save.result-save.project-select-sheet.project-select-sheet .project-select-list{display:block;height:var(--project-select-row);max-height:var(--project-select-row);flex:0 1 auto;padding-top:0;padding-bottom:0}
.result-sheet.result-save.result-save.project-select-sheet.project-select-sheet .project-select-row{min-height:var(--project-select-row);margin:0}
.result-sheet.result-save.result-save.project-select-sheet.project-select-sheet .project-select-list-with-status{--project-select-row:112px}
.result-sheet.result-save.result-save.project-select-sheet.project-keyboard-open,.result-sheet.result-save.result-save.project-select-sheet.camera-project-keyboard-open{--project-select-row:88px;padding-top:calc(8px + env(safe-area-inset-top));padding-bottom:8px}
.result-sheet.result-save.result-save.project-select-sheet.project-keyboard-open .result-header,.result-sheet.result-save.result-save.project-select-sheet.camera-project-keyboard-open .result-header{min-height:44px;margin:0;padding:0}
.result-sheet.result-save.result-save.project-select-sheet .project-select-hint{flex:none;margin:4px 8px 0;color:var(--rs-tertiary);font:400 12px/1.3 var(--rs-font);text-align:right}
.result-sheet.result-save.project-select-sheet.project-keyboard-open,.result-sheet.result-save.project-select-sheet.camera-project-keyboard-open{height:300px}
.result-sheet.result-save.project-select-sheet.project-keyboard-open .project-select-body,.result-sheet.result-save.project-select-sheet.camera-project-keyboard-open .project-select-body{height:0;min-height:0;flex:1 1 0;overflow-x:hidden;overflow-y:auto;-webkit-overflow-scrolling:touch}
.project-select-sheet.project-keyboard-open .project-select-body .project-list-wrap,.project-select-sheet.camera-project-keyboard-open .project-select-body .project-list-wrap,.project-select-sheet.camera-project-keyboard-open .project-select-body .camera-project-list-wrap,.project-select-sheet.project-keyboard-open .project-select-body .led-project-list-wrap,.project-select-sheet.camera-project-keyboard-open .project-select-body .led-project-list-wrap{display:flex;box-sizing:border-box;width:100%;height:0;min-height:0;max-height:none;flex:1 1 0;flex-direction:column;overflow:visible}
.project-select-sheet.project-keyboard-open .project-select-body .project-step-select,.project-select-sheet.camera-project-keyboard-open .project-select-body .project-step-select{display:flex;box-sizing:border-box;width:100%;height:0;min-height:0;max-height:none;flex:1 1 0;flex-direction:column;overflow:visible}
.result-sheet.result-save.result-save.project-select-sheet.project-keyboard-open .project-select-list,.result-sheet.result-save.result-save.project-select-sheet.camera-project-keyboard-open .project-select-list{display:block;box-sizing:border-box;width:100%;height:0;min-height:0;max-height:88px;flex:1 1 0;margin:0;padding-top:0;padding-bottom:0;overflow-y:auto;-webkit-overflow-scrolling:touch}
.result-sheet.result-save.project-select-sheet.project-keyboard-open .sheet-header,.result-sheet.result-save.project-select-sheet.camera-project-keyboard-open .sheet-header{min-height:44px;margin:0;padding:0}
`

const resultPanelRoleCounts = {
  'pages/dmx-address/dmx-address.wxml': {
    'result-sheet-overlay': 1, 'result-sheet': 2, 'result-share': 1, 'result-save': 1,
    'result-header': 2, 'result-title': 2, 'result-scroll': 1, 'result-footer': 1,
    'result-row': 1, 'result-row-name': 1, 'result-placeholder': 1,
  },
  'pages/dmx-layout/dmx-layout.wxml': {
    'result-sheet-overlay': 1, 'result-sheet': 1, 'result-share': 1,
    'result-header': 1, 'result-title': 1, 'result-copy': 1, 'result-scroll': 1,
    'result-footer': 1,
  },
}
const resultPanelRoleNames = [
  'result-sheet-overlay', 'result-sheet', 'result-share', 'result-save', 'result-header',
  'result-title', 'result-copy', 'result-scroll', 'result-scroll-swiper', 'result-image-frame',
  'result-footer', 'result-row', 'result-row-name', 'result-placeholder',
]

function withoutApprovedResultPanelRoles(relativePath, source) {
  const expected = resultPanelRoleCounts[relativePath]
  if (!expected) return source
  const attributes = [...source.matchAll(/(?:class|placeholder-class)="([^"]*)"/g)]
  for (const name of resultPanelRoleNames) {
    const actual = attributes.reduce((count, match) => count
      + ([...match[1].matchAll(new RegExp(`(?:^|\\s)${name}(?=\\s|$)`, 'g'))].length), 0)
    assert.equal(actual, expected[name] || 0,
      `${relativePath}: expected only ${expected[name] || 0} approved ${name} role token(s)`)
  }
  return source.replace(/\s((?:class|placeholder-class))="([^"]*)"/g, (_match, name, value) => {
    let normalized = value
    for (const name of resultPanelRoleNames) {
      normalized = normalized.replace(new RegExp(`\\s${name}(?=\\s|$)`, 'g'), '')
    }
    if (resultPanelRoleNames.includes(normalized)) return ''
    return ` ${name}="${normalized}"`
  })
}

function withoutApprovedDmxResultImageCopy(relativePath, source) {
  const replacements = {
    'pages/dmx-address/dmx-address.wxml': [
      ['<button class="result-report-preview-action result-report-preview-action-primary" bindtap="shareResultReportImage">分享图片</button>',
        '<button class="result-report-preview-action result-report-preview-action-primary" bindtap="shareResultReportImage">转发图片</button>'],
    ],
    'pages/dmx-layout/dmx-layout.wxml': [
      ['<button class="export-share" bindtap="shareImage">分享图片</button>',
        '<button class="export-share" bindtap="shareImage">转发图片</button>'],
      ['<button class="export-save-current" bindtap="saveImage">保存到相册</button>',
        '<button class="export-save-current" bindtap="saveImage">保存图片</button>'],
    ],
  }
  let normalized = source
  for (const [current, frozen] of replacements[relativePath] || []) {
    assert.equal(normalized.split(current).length - 1, 1,
      `${relativePath}: expected one approved result-image action label`)
    assert.equal(normalized.split(frozen).length - 1, 0,
      `${relativePath}: old result-image action label unexpectedly remains`)
    normalized = normalized.replace(current, frozen)
  }
  return normalized
}

function withoutApprovedDmxProjectSelection(relativePath, source) {
  if (relativePath !== 'pages/dmx-address/dmx-address.wxml') return source
  const modifier = ` {{!showNewProjectNameInput ? 'project-select-sheet' : ''}}`
  assert.equal(source.split(modifier).length - 1, 1,
    'DMX save sheet must add one selection-only compact layout modifier')
  source = source.replace(modifier, '')

  const currentList = '<scroll-view wx:if="{{!showNewProjectNameInput && projectSaveRows.length}}" class="project-save-list project-select-list project-select-list-with-status" scroll-y enhanced show-scrollbar="{{projectSaveRows.length > 1}}" aria-label="项目列表">'
  const legacyList = '<scroll-view wx:if="{{!showNewProjectNameInput && projectSaveRows.length}}" class="project-save-list" scroll-y enhanced show-scrollbar="{{false}}">'
  const currentRow = 'class="project-save-row project-select-row"'
  const legacyRow = 'class="project-save-row"'
  const hint = '<view wx:if="{{!showNewProjectNameInput && projectSaveRows.length > 1}}" class="project-select-hint">上下滑动查看更多</view>'
  const hintLine = `\n      ${hint}\n`
  assert.equal(source.split(currentList).length - 1, 1,
    'DMX save selection must have one compact project-list scroller')
  assert.equal(source.split(legacyList).length - 1, 0,
    'DMX save selection must not retain the legacy list scroller before normalization')
  assert.equal(source.split(currentRow).length - 1, 1,
    'DMX save selection must make exactly one project row fill the compact viewport')
  assert.equal(source.split(hint).length - 1, 1,
    'DMX save selection must have one multi-row scroll hint')
  assert.equal(source.split(hintLine).length - 1, 1,
    'DMX compact-list hint must occupy exactly one indented line')
  source = source.replace(currentList, legacyList)
  source = source.replace(currentRow, legacyRow)
  source = source.replace(hintLine, '\n')
  assert(!source.includes('project-select-list')
    && !source.includes('project-select-row')
    && !source.includes('project-select-hint'),
  'DMX compact-list-only classes must be fully normalized')
  return source
}

const approvedDmxDevicePickerClassCounts = {
      'device-picker-scope': 1,
      'device-picker-header': 1,
      'device-picker-title': 1,
      'device-picker-dismiss': 1,
      'device-picker-search-control': 1,
      'device-picker-search-input': 1,
      'device-picker-category-scroll': 1,
      'device-picker-category': 1,
      'device-picker-category-active': 1,
      'device-picker-count': 1,
      'device-picker-list': 1,
      'device-picker-row': 1,
      'device-picker-row-selected': 1,
      'device-picker-item-title': 1,
      'device-picker-item-meta': 1,
      'device-picker-empty': 1,
}

function assertApprovedDmxDevicePickerMarkup(source) {
  const attributes = [...source.matchAll(/(?:class|placeholder-class)="([^"]*)"/g)]
  const actualNames = attributes.flatMap((match) => [...match[1].matchAll(/(?:^|\s)(device-picker-[\w-]+)(?=\s|['"]|$)/g)]
    .map((token) => token[1]))
  for (const [name, expected] of Object.entries(approvedDmxDevicePickerClassCounts)) {
    assert.equal(actualNames.filter((actual) => actual === name).length, expected,
      `DMX picker markup must keep exactly ${expected} approved ${name} role token(s)`)
  }
  assert.deepEqual([...new Set(actualNames)].sort(), Object.keys(approvedDmxDevicePickerClassCounts).sort(),
    'DMX picker markup added an unreviewed shared device-picker role token')
}

function withoutApprovedDevicePickerClasses(relativePath, source) {
  if (relativePath === 'pages/dmx-address/dmx-address.wxml') {
    if (!source.includes('device-picker-')) return source
    assertApprovedDmxDevicePickerMarkup(source)
    source = source.replace(/\s((?:class|placeholder-class)="([^"]*)")/g, (match, attribute, value) => {
      if (!value.includes('device-picker-')) return match
      const normalized = value.replace(/(?:^|\s)device-picker-[\w-]+(?=\s|['"]|$)/g, '')
      if (!normalized.trim()) return ''
      return ` ${attribute.replace(value, normalized)}`
    })
  } else if (relativePath === 'pages/dmx-address/dmx-address.wxss') {
    const sharedPickerImport = '@import "../../styles/device-picker-shared.wxss";\n'
    const imports = source.split(sharedPickerImport).length - 1
    assert(imports <= 1, 'DMX picker must not import shared device-picker styles more than once')
    if (imports === 1) source = source.replace(sharedPickerImport, '')
  }
  return source
}

function verifyApprovedDmxDevicePickerChanges() {
  const wxmlPath = path.join(root, 'pages/dmx-address/dmx-address.wxml')
  const wxssPath = path.join(root, 'pages/dmx-address/dmx-address.wxss')
  const wxml = fs.readFileSync(wxmlPath, 'utf8')
  const wxss = fs.readFileSync(wxssPath, 'utf8')
  assertApprovedDmxDevicePickerMarkup(wxml)
  assert.equal(wxss.split('@import "../../styles/device-picker-shared.wxss";').length - 1, 1,
    'DMX picker must import the reviewed shared visual styles exactly once')
}

function normalizeApprovedDevicePickerCompileInput(trace) {
  const sharedPickerStyle = 'styles/device-picker-shared.wxss'
  const args = trace.summary.results[1].args
  const occurrences = args.slice(3).filter((file) => file === sharedPickerStyle).length
  if (occurrences === 0) return trace
  assert.equal(occurrences, 1, 'DMX compiler input must include one shared picker stylesheet')
  assert.equal(args[2], '7', 'DMX compiler input count must include exactly one shared picker stylesheet')
  assert.equal(args[6], sharedPickerStyle,
    'shared picker stylesheet must follow the page theme stylesheet in compiler inputs')
  assert.ok(Object.hasOwn(trace.summary.sources, sharedPickerStyle),
    'compiler summary must record the shared picker stylesheet source hash')
  assert.deepEqual(trace.spawnCalls[1].args, args,
    'the executed style compiler input list must match its recorded summary')

  const normalizedTrace = JSON.parse(JSON.stringify(trace))
  const normalizedArgs = normalizedTrace.summary.results[1].args
  normalizedArgs.splice(6, 1)
  normalizedArgs[2] = '6'
  normalizedTrace.spawnCalls[1].args = normalizedArgs.slice()
  delete normalizedTrace.summary.sources[sharedPickerStyle]
  const serializedSummary = JSON.stringify(normalizedTrace.summary, null, 2)
  normalizedTrace.consoleCalls[0] = serializedSummary
  const compileWrite = normalizedTrace.writes.find((write) => write.path.endsWith('compile.json'))
  assert(compileWrite, 'compiler trace must keep its compile summary output')
  compileWrite.contents = serializedSummary
  return normalizedTrace
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function normalizeAuthorizedAnimationSource(relativePath, source) {
  const replaceExactlyOnce = (marker, replacement) => {
    const occurrences = source.split(marker).length - 1
    assert.equal(occurrences, 1, `${relativePath}: expected one authorized animation marker`)
    source = source.replace(marker, replacement)
  }

  if (relativePath === 'pages/dmx-address/dmx-address.wxml') {
    replaceExactlyOnce(
      `class="floating-backdrop {{floatingClosing ? 'floating-backdrop-closing' : ''}}"`,
      'class="floating-backdrop"',
    )
    replaceExactlyOnce(
      '<button class="result-report-preview-close panel-close-control" aria-label="关闭灯位地址方案图预览" bindtap="onUserCloseResultReportPreview"><view class="panel-close-icon" aria-hidden="true"></view></button>',
      '<button class="result-report-preview-close" bindtap="onUserCloseResultReportPreview">关闭</button>',
    )
    replaceExactlyOnce(
      '<view class="sheet-dismiss panel-close-control" aria-label="关闭项目保存面板" bindtap="onUserCloseSaveProjectDialog"><view class="panel-close-icon" aria-hidden="true"></view></view>',
      '<view class="sheet-dismiss" bindtap="onUserCloseSaveProjectDialog">完成</view>',
    )
  } else if (relativePath === 'pages/dmx-address/dmx-address.wxss') {
    replaceExactlyOnce(
      '.floating-backdrop.floating-backdrop-closing{animation:backdrop-out .23s ease-in both}\n',
      '',
    )
    replaceExactlyOnce('@keyframes backdrop-out{from{opacity:1}to{opacity:0}}\n', '')
    replaceExactlyOnce(
      '.floating-backdrop,.floating-backdrop.floating-backdrop-closing,.floating-card,.fixture-card,.address-chip,.add-group-button',
      '.floating-backdrop,.floating-card,.fixture-card,.address-chip,.add-group-button',
    )
    replaceExactlyOnce(
      '\n.result-report-preview-close.panel-close-control{box-sizing:border-box;display:flex;width:44px;min-width:44px;max-width:44px;height:44px;min-height:44px;max-height:44px;margin:0;padding:0;align-items:center;justify-content:center;border:0;border-radius:50%;background:var(--theme-panel-close-bg);color:var(--theme-panel-close-color);font-size:0;line-height:1}\n',
      '',
    )
  } else if (relativePath === 'pages/dmx-layout/dmx-layout.wxml') {
    replaceExactlyOnce(
      '<view wx:for="{{placementGroups}}" wx:key="renderId" class="fixture-group">\n            <view wx:if="{{item.showPriorityDivider}}" class="fixture-priority-divider"></view>\n',
      '<view wx:for="{{placementGroups}}" wx:key="id" class="fixture-group">\n',
    )
    replaceExactlyOnce(
      '<button class="sheet-close panel-close-control" aria-label="关闭灯位图预览" bindtap="closePreview"><view class="panel-close-icon" aria-hidden="true"></view></button>',
      '<button class="sheet-close" bindtap="closePreview">关闭</button>',
    )
    assert.equal((source.match(/class="export-overlay[^\"]*" style="padding-top:\{\{overlaySafeTop \+ 12\}\}px;"/g) || []).length, 1,
      '灯位图顶部安全区/胶囊避让绑定必须保留一次')
  } else if (relativePath === 'pages/dmx-layout/dmx-layout.wxss') {
    replaceExactlyOnce(
      '.fixture-priority-divider{height:1px;margin:10px 8px 7px;background:var(--theme-divider,#dbdbe0)}\n',
      '',
    )
    replaceExactlyOnce(
      '\n.export-heading button.sheet-close.panel-close-control{box-sizing:border-box;display:flex;flex:0 0 44px;width:44px;min-width:44px;max-width:44px;height:44px;min-height:44px;max-height:44px;margin:0;padding:0;align-items:center;justify-content:center;border:0;border-radius:50%;background:var(--theme-panel-close-bg);color:var(--theme-panel-close-color);font-size:0;line-height:1}\n',
      '',
    )
  } else if (relativePath === 'app.wxss') {
    replaceExactlyOnce(
      '--theme-control:#e8e8ed;--theme-panel-close-bg:var(--theme-control);--theme-panel-close-color:var(--theme-text-secondary);--theme-accent:#007aff;',
      '--theme-control:#e8e8ed;--theme-accent:#007aff;',
    )
    replaceExactlyOnce(
      '\n/* Shared close control for panel headers; the hit target stays 44px in both themes. */\n.panel-close-control{display:flex;box-sizing:border-box;width:44px;min-width:44px;max-width:44px;height:44px;min-height:44px;max-height:44px;flex:0 0 44px;margin:0;padding:0;align-items:center;justify-content:center;border:0;border-radius:50%;background:var(--theme-panel-close-bg);color:var(--theme-panel-close-color);font-size:0;line-height:1}\n.panel-close-control::after{border:0}\n.panel-close-icon{position:relative;display:block;box-sizing:border-box;flex:0 0 20px;width:20px;height:20px}\n.panel-close-icon::before,.panel-close-icon::after{position:absolute;top:50%;left:50%;display:block;width:18px;height:2px;border-radius:2px;background:currentColor;content:"";transform:translate(-50%,-50%) rotate(45deg)}\n.panel-close-icon::after{transform:translate(-50%,-50%) rotate(-45deg)}\n',
      '',
    )
    const resultPanelMarker = '/* Shared only by result share and project-save panels. */'
    assert.equal(source.split(resultPanelMarker).length - 1, 1,
      'app.wxss must contain one reviewed result-subwindow style block')
    const resultPanelStart = source.indexOf(resultPanelMarker)
    const resultPanelBlock = source.slice(resultPanelStart)
    const projectSelectMarker = '/* Project selection keeps the search and actions visible while only the list scrolls. */'
    assert.equal(resultPanelBlock.split(projectSelectMarker).length - 1, 1,
      'app.wxss must contain one approved compact project-selection style block')
    const projectSelectStart = resultPanelBlock.indexOf(projectSelectMarker)
    const approvedProjectSelectBlock = resultPanelBlock.slice(projectSelectStart - 1)
    assert.equal(approvedProjectSelectBlock, APPROVED_PROJECT_SELECT_STYLE_BLOCK,
      'compact project-selection CSS changed beyond the approved responsive list rules')
    const frozenResultPanelBlock = resultPanelBlock.slice(0, projectSelectStart - 1)
    const resultPanelHash = crypto.createHash('sha256').update(frozenResultPanelBlock).digest('hex')
    assert.equal(resultPanelHash, RESULT_PANEL_CSS_SHA256,
      'shared result-subwindow CSS changed beyond the frozen approved styles')
    assert.equal(source[resultPanelStart - 1], '\n',
      'result-subwindow styles must start after the single approved line break')
    source = source.slice(0, resultPanelStart - 1)
  }
  source = withoutApprovedResultPanelRoles(relativePath, source)
  source = withoutApprovedDmxResultImageCopy(relativePath, source)
  source = withoutApprovedDmxProjectSelection(relativePath, source)
  source = withoutApprovedDevicePickerClasses(relativePath, source)
  if (relativePath === 'pages/dmx-layout/dmx-layout.wxml') {
    const currentScroll = '<scroll-view class="export-image-scroll" scroll-y enhanced show-scrollbar="{{false}}">'
    const frozenScroll = '<scroll-view class="export-image-scroll" style="height:{{(canvasWidth > 706 ? 654 : canvasWidth - 50) * exportCanvasHeight / exportCanvasWidth}}px;" scroll-y enhanced show-scrollbar="{{false}}">'
    assert.equal(source.split(currentScroll).length - 1, 1,
      '灯位图 export must retain exactly one flex scroll-view without an inline height')
    source = source.replace(currentScroll, frozenScroll)
  }
  return source
}

function buildNormalizedHashMap(traces) {
  const normalizedHashes = new Map()
  const addFileHash = (relativePath) => {
    const contents = fs.readFileSync(path.join(root, relativePath))
    const rawHash = crypto.createHash('sha256').update(contents).digest('hex')
    const lfContents = contents.toString('utf8').replace(/\r\n?/g, '\n')
    const normalizedContents = normalizeAuthorizedAnimationSource(relativePath, lfContents)
    const normalizedHash = crypto.createHash('sha256').update(normalizedContents).digest('hex')
    const previous = normalizedHashes.get(rawHash)
    assert.ok(previous === undefined || previous === normalizedHash,
      `conflicting canonical hash for ${relativePath}`)
    normalizedHashes.set(rawHash, normalizedHash)
  }
  addFileHash('app.json')
  traces.forEach((trace) => Object.keys(trace.summary.sources).forEach(addFileHash))
  return normalizedHashes
}

function normalizeTraceForDigest(value, normalizedHashes) {
  const escapedRoot = JSON.stringify(root).slice(1, -1)
  const normalizeString = (text) => {
    let normalized = text
    normalizedHashes.forEach((canonicalHash, rawHash) => {
      normalized = normalized.split(rawHash).join(canonicalHash)
    })
    return normalized
      .split(escapedRoot).join('<CHECKOUT_ROOT>')
      .split(root).join('<CHECKOUT_ROOT>')
  }

  if (typeof value === 'string') return normalizeString(value)
  if (Array.isArray(value)) return value.map((item) => normalizeTraceForDigest(item, normalizedHashes))
  if (value && typeof value === 'object') {
    const normalizedInput = Array.isArray(value.spawnCalls) && value.summary
      ? normalizeApprovedDevicePickerCompileInput(value)
      : value
    return Object.fromEntries(Object.entries(normalizedInput).map(([key, item]) => [
      normalizeString(key), normalizeTraceForDigest(item, normalizedHashes),
    ]))
  }
  return value
}

function evaluateModule(context, source, filename, moduleRequire) {
  const wrapper = vm.runInContext(
    `(function (exports, require, module, __filename, __dirname) {\n${source}\n})`,
    context,
    { filename, timeout: 10000 },
  )
  const module = { exports: {} }
  wrapper(module.exports, moduleRequire, module, filename, path.dirname(filename))
  return module.exports
}

function makeFixedDate() {
  const fixedMilliseconds = Date.parse(FIXED_NOW)
  return class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : [fixedMilliseconds])) }
    static now() { return fixedMilliseconds }
  }
}

function makeOutputOverride(directory, scenario) {
  return path.posix.join(compileOutputRoot, directory, scenario)
}

function runEntry({ directory, sourcePath, source, scenario, spawnMode, override }) {
  const entryPath = path.join(root, 'tests', directory, 'compile.cjs')
  const entryDirectory = path.dirname(entryPath)
  const projectRoot = path.resolve(entryDirectory, '../..')
  const writes = []
  const directories = []
  const spawnCalls = []
  const consoleCalls = []
  const processMock = {
    env: override ? { DMX_COMPILE_OUTPUT_DIR: override } : {},
    exitCode: undefined,
  }
  const fsMock = new Proxy(fs, {
    get(target, property) {
      if (property === 'mkdirSync') return (directoryPath, options) => {
        directories.push({ path: path.resolve(directoryPath), options: clone(options) })
      }
      if (property === 'writeFileSync') return (filePath, contents, options) => {
        writes.push({ path: path.resolve(filePath), contents: String(contents), options: clone(options) })
      }
      const value = Reflect.get(target, property, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  const childProcessMock = {
    spawnSync(exe, args, options) {
      const call = { exe, args: Array.from(args), options: clone(options) }
      spawnCalls.push(call)
      const commandName = path.basename(exe, '.exe')
      if (spawnMode === 'missing-wcc' && commandName === 'wcc') {
        return { status: null, error: { message: 'spawnSync ENOENT' }, stdout: undefined, stderr: undefined }
      }
      if (spawnMode === 'nonzero-wcsc' && commandName === 'wcsc') {
        return { status: 7, error: undefined, stdout: 'wcsc stdout failure fixture', stderr: 'wcsc stderr failure fixture' }
      }
      return { status: 0, error: undefined, stdout: `${commandName} stdout fixture`, stderr: '' }
    },
  }
  const context = vm.createContext({
    Buffer,
    Date: makeFixedDate(),
    process: processMock,
    console: { log(value) { consoleCalls.push(String(value)) } },
  })
  const builtins = {
    'node:fs': fsMock,
    'node:path': path,
    'node:crypto': crypto,
    'node:child_process': childProcessMock,
  }
  const builtinRequire = (specifier) => {
    assert.ok(Object.prototype.hasOwnProperty.call(builtins, specifier), `unexpected compiler tool dependency: ${specifier}`)
    return builtins[specifier]
  }
  let helperExports = null
  const entryRequire = (specifier) => {
    if (specifier !== '../helpers/dmx-compile.cjs') return builtinRequire(specifier)
    if (!helperExports) {
      const helperSource = fs.readFileSync(helperPath, 'utf8')
      helperExports = evaluateModule(context, helperSource, helperPath, builtinRequire)
    }
    return helperExports
  }
  evaluateModule(context, source, entryPath, entryRequire)

  const compileWrite = writes.find((write) => path.basename(write.path) === 'compile.json')
  const summary = compileWrite ? JSON.parse(compileWrite.contents) : null
  const trace = {
    directory,
    scenario,
    spawnMode,
    override: override || null,
    projectRoot,
    exitCode: processMock.exitCode ?? null,
    spawnCalls,
    directories,
    writes,
    consoleCalls,
    summary,
  }
  return trace
}

function runSuite(sourceKind) {
  const traces = []
  for (const directory of entryDirectories) {
    const relative = path.join('tests', directory, 'compile.cjs')
    const sourcePath = sourceKind === 'before'
      ? path.join(beforeRoot, relative)
      : path.join(root, relative)
    const source = fs.readFileSync(sourcePath, 'utf8')
    const overrideName = makeOutputOverride(directory, 'override-success')
    traces.push(runEntry({ directory, sourcePath, source, scenario: 'default-success', spawnMode: 'success' }))
    traces.push(runEntry({ directory, sourcePath, source, scenario: 'override-success', spawnMode: 'success', override: overrideName }))
    traces.push(runEntry({
      directory, sourcePath, source, scenario: 'missing-wcc', spawnMode: 'missing-wcc',
      override: makeOutputOverride(directory, 'missing-wcc'),
    }))
    traces.push(runEntry({
      directory, sourcePath, source, scenario: 'nonzero-wcsc', spawnMode: 'nonzero-wcsc',
      override: makeOutputOverride(directory, 'nonzero-wcsc'),
    }))
  }
  return traces
}

function expectedDmxRoutes() {
  const appConfig = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'))
  return [...(appConfig.pages || []), ...(appConfig.subPackages || []).flatMap((pkg) =>
    (pkg.pages || []).map((page) => path.posix.join(pkg.root, page)))].filter((entry) => /^pages\/dmx-/.test(entry))
}

function verifyTrace(trace) {
  const nativeRuntime = nativeRuntimeByDirectory[trace.directory]
  const entryDirectory = path.join(root, 'tests', trace.directory)
  const projectRoot = path.resolve(entryDirectory, '../..')
  const output = trace.override
    ? path.resolve(projectRoot, trace.override)
    : path.join(entryDirectory, 'evidence/compile')
  const summary = trace.summary
  assert.ok(summary, `${trace.directory}/${trace.scenario}: compile summary should be written`)
  assert.deepEqual(Object.keys(summary), [
    'runAt', 'registeredDmxPages', 'appJsonSha256', 'officialSourceCompilation',
    'nativeRuntime', 'physicalDevice', 'sources', 'results',
  ])
  assert.equal(summary.runAt, FIXED_NOW)
  assert.deepEqual(summary.registeredDmxPages, expectedDmxRoutes())
  assert.equal(summary.appJsonSha256, crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'app.json'))).digest('hex'))
  assert.equal(summary.officialSourceCompilation, true)
  assert.equal(summary.nativeRuntime, nativeRuntime)
  assert.equal(summary.physicalDevice, 'NOT RUN')
  assert.equal(summary.results.length, 2)
  assert.deepEqual(trace.directories, [{ path: output, options: { recursive: true } }])
  assert.equal(trace.spawnCalls.length, 2, 'both compilers must run even if one fails')

  const [wcc, wcsc] = summary.results
  const expectedBinaryDirectory = 'E:/微信web开发者工具/resources/app.asar.unpacked/node_modules/wcc-exec'
  const wxmlOutput = path.join(output, 'wxml.compiled.txt')
  assert.equal(wcc.name, 'wcc')
  assert.equal(wcc.exe, path.join(expectedBinaryDirectory, 'wcc.exe'))
  assert.deepEqual(wcc.args.slice(0, 3), ['-d', '-o', wxmlOutput])
  assert.equal(wcsc.name, 'wcsc')
  assert.equal(wcsc.exe, path.join(expectedBinaryDirectory, 'wcsc.exe'))
  assert.deepEqual(wcsc.args.slice(0, 3), ['-js', '-pc', String(wcsc.args.length - 3)])
  assert.equal(Number(wcsc.args[2]), wcsc.args.length - 3)
  assert.equal(wcsc.args[2], '7', 'DMX compiler must count the shared picker stylesheet input')
  assert.equal(wcsc.args.slice(3).filter((file) => file === 'styles/device-picker-shared.wxss').length, 1,
    'DMX compiler must include exactly one shared picker stylesheet')
  assert.equal(wcsc.args[6], 'styles/device-picker-shared.wxss',
    'shared picker stylesheet must follow the page theme stylesheet')
  assert.ok(wcc.args.length > 3)
  assert.ok(wcsc.args.length > 3)
  assert.ok(wcc.args.slice(3).every((file) => file.endsWith('.wxml')))
  assert.ok(wcsc.args.slice(3).every((file) => file.endsWith('.wxss')))
  assert.ok(wcc.args.slice(3).every((file) => Object.hasOwn(summary.sources, file)))
  assert.ok(wcsc.args.slice(3).every((file) => Object.hasOwn(summary.sources, file)))
  for (const [file, expectedHash] of Object.entries(summary.sources)) {
    assert.equal(expectedHash, crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex'), `${file} input hash changed`)
  }
  assert.ok(wcc.args.slice(3).some((file) => expectedDmxRoutes().some((route) => file === `${route}.wxml`)))
  assert.ok(wcsc.args.slice(3).some((file) => expectedDmxRoutes().some((route) => file === `${route}.wxss`)))

  trace.spawnCalls.forEach((call, index) => {
    const command = summary.results[index]
    assert.equal(call.exe, command.exe)
    assert.deepEqual(call.args, command.args)
    assert.deepEqual(call.options, {
      cwd: projectRoot, encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024,
    })
  })

  const expectedWrites = [
    path.join(output, 'wcc.stdout.txt'), path.join(output, 'wcc.stderr.txt'),
    path.join(output, 'wcsc.stdout.txt'), path.join(output, 'wcsc.stderr.txt'),
    path.join(output, 'compile.json'),
  ]
  assert.deepEqual(trace.writes.map((write) => write.path), expectedWrites)
  assert.equal(trace.writes.find((write) => write.path.endsWith('compile.json')).contents, trace.consoleCalls[0])
  assert.equal(trace.consoleCalls.length, 1)
  assert.equal(trace.consoleCalls[0], JSON.stringify(summary, null, 2))

  if (trace.spawnMode === 'success') {
    assert.equal(trace.exitCode, null)
    assert.deepEqual(summary.results.map((result) => [result.exitCode, result.error, result.stdoutBytes]), [
      [0, null, Buffer.byteLength('wcc stdout fixture')],
      [0, null, Buffer.byteLength('wcsc stdout fixture')],
    ])
    assert.deepEqual(trace.writes.map((write) => write.contents), [
      'wcc stdout fixture', '', 'wcsc stdout fixture', '', trace.writes[4].contents,
    ])
  } else if (trace.spawnMode === 'missing-wcc') {
    assert.equal(trace.exitCode, 1)
    assert.deepEqual(summary.results.map((result) => [result.exitCode, result.error]), [
      [null, 'spawnSync ENOENT'], [0, null],
    ])
    assert.equal(trace.writes[0].contents, '')
    assert.equal(trace.writes[1].contents, '')
  } else {
    assert.equal(trace.exitCode, 1)
    assert.deepEqual(summary.results.map((result) => [result.exitCode, result.error, result.stderr]), [
      [0, null, ''], [7, null, 'wcsc stderr failure fixture'],
    ])
    assert.equal(trace.writes[2].contents, 'wcsc stdout failure fixture')
    assert.equal(trace.writes[3].contents, 'wcsc stderr failure fixture')
  }
}

function main() {
  if (process.argv.includes('--capture-before')) {
    const beforeTraces = runSuite('before')
    beforeTraces.forEach(verifyTrace)
    const beforeHash = digest(beforeTraces)
    fs.mkdirSync(path.dirname(tracePath), { recursive: true })
    fs.writeFileSync(tracePath, `${JSON.stringify(beforeTraces, null, 2)}\n`)
    process.stdout.write(`captured ${beforeHash} to ${path.relative(root, tracePath)}\n`)
    return
  }
  verifyApprovedDmxDevicePickerChanges()
  const traces = runSuite('current')
  traces.forEach(verifyTrace)
  const traceHash = digest(traces)
  if (process.argv.includes('--compare-before')) {
    const beforeTraces = runSuite('before')
    beforeTraces.forEach(verifyTrace)
    assert.deepEqual(traces, beforeTraces, 'compiler commands, summaries, output files, and exit codes changed from before')
    process.stdout.write(`PASS --compare-before ${traceHash}\n`)
    return
  }
  const normalizedHashes = buildNormalizedHashMap(traces)
  const normalizedTraceHash = digest(normalizeTraceForDigest(traces, normalizedHashes))
  assert.equal(normalizedTraceHash, FROZEN_TRACE_SHA256,
    `DMX compile entry contract changed: ${normalizedTraceHash}`)
  process.stdout.write(`PASS DMX compile entry contract ${normalizedTraceHash}\n`)
}

main()
