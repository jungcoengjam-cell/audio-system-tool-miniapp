const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const baseline = require('./ui-test-first.json')
const repair7CurrentContract = require('./repair7-current-contract.json')
assert.equal(repair7CurrentContract.previousApprovedExpandedWxmlSha256?.['pages/dmx-layout/dmx-layout.wxml'],
  '9cf15b5d90ce081d1395c5aa6e7294c1bb4a1951588e3d941d7e8a755d9a0a62',
  'the previous approved lighting WXML digest must remain available for audit')
assert.equal(repair7CurrentContract.previousPlacementFlowExpandedWxmlSha256?.['pages/dmx-layout/dmx-layout.wxml'],
  '364a454a6ba43f233dbe4c6ac9d7f2a30c0cb0c3f174fcdefcb00c8c732e081d',
  'the previous placement-flow digest must remain available for audit')
const retiredLandscapePage = 'pages/dmx-layout-landscape/dmx-layout-landscape'
const retiredLandscapeWxml = retiredLandscapePage + '.wxml'
const registeredPages = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8')).pages

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

function cssRuleBody(source, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return source.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`))?.[1] || ''
}

function hasLocalSvgMask(rule) {
  return /-webkit-mask-image\s*:\s*url\("data:image\/svg\+xml,/.test(rule)
    && /mask-image\s*:\s*url\("data:image\/svg\+xml,/.test(rule)
}

function assertSharedActionIconCascade() {
  const globalStyles = read('app.wxss')
  const consolidatedPages = [
    'pages/cable/cable.wxss',
    'pages/gain-structure/gain-structure.wxss',
    'pages/led-screen/led-screen.wxss',
    'pages/limiter/limiter.wxss',
    'pages/spl/spl.wxss',
  ]

  for (const icon of ['icon-reset', 'icon-share']) {
    const globalRule = cssRuleBody(globalStyles, `.${icon}`)
    assert(hasLocalSvgMask(globalRule),
    `app.wxss must provide the shared local SVG mask for .${icon}`)
    for (const relativePath of consolidatedPages) {
      assert.equal(cssRuleBody(read(relativePath), `.${icon}`), '',
        `${relativePath} must use the shared .${icon} rule from app.wxss`)
    }
  }

  const audioStyles = read('pages/audio-wiring/index.wxss')
  for (const icon of ['icon-reset', 'icon-share']) {
    assert(hasLocalSvgMask(cssRuleBody(audioStyles, `.${icon}`)),
      `audio-wiring must retain its local .${icon} cascade override`)
  }
  assert(read('pages/camera/camera.wxss').includes('.camera-action-icon.icon-reset{')
    && read('pages/camera/camera.wxss').includes('.camera-action-icon.icon-share{'),
  'camera must retain its more-specific local reset/share mask overrides')
  assert(read('pages/project-wiring/workspace.wxss').includes('.workspace-share-icon.icon-share{'),
    'project-wiring must retain its more-specific local share mask override')
}

assertSharedActionIconCascade()

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

function normalizeLineEndings(source) {
  return source.replace(/\r\n?/g, '\n')
}

// Keep the frozen WXML snapshots intact while allowing only the approved
// shared result-panel role classes. Their exact counts and element semantics
// are asserted before these tokens are removed for the historical hashes.
const resultPanelRoleCounts = {
  'pages/cable/cable.wxml': {
    'result-sheet-overlay': 1, 'result-sheet': 2, 'result-share': 1, 'result-save': 1,
    'result-header': 2, 'result-title': 2, 'result-copy': 1, 'result-scroll': 1,
    'result-footer': 2, 'result-row': 1, 'result-row-name': 1, 'result-placeholder': 4,
  },
  'pages/gain-structure/gain-structure.wxml': {
    'result-sheet': 4, 'result-share': 2, 'result-save': 2, 'result-header': 4,
    'result-title': 4, 'result-copy': 6, 'result-scroll': 2, 'result-footer': 10,
    'result-row': 2, 'result-row-name': 2, 'result-placeholder': 8,
  },
  'pages/spl/spl.wxml': {
    'result-sheet-overlay': 1, 'result-sheet': 2, 'result-share': 1, 'result-save': 1,
    'result-header': 2, 'result-title': 2, 'result-copy': 2, 'result-scroll': 1,
    'result-footer': 5, 'result-row': 1, 'result-row-name': 1, 'result-placeholder': 4,
  },
  'pages/dmx-layout/dmx-layout.wxml': {
    'result-sheet-overlay': 1, 'result-sheet': 1, 'result-share': 1, 'result-header': 1,
    'result-title': 1, 'result-copy': 1, 'result-scroll': 1, 'result-footer': 1,
  },
}

const resultPanelRoleElements = {
  'result-sheet-overlay': ['view'],
  'result-sheet': ['view'],
  'result-share': ['view'],
  'result-save': ['view'],
  'result-header': ['view'],
  'result-title': ['view', 'text'],
  'result-copy': ['view', 'text'],
  'result-image-frame': ['view'],
  'result-scroll': ['scroll-view'],
  'result-footer': ['view'],
  'result-row': ['view', 'button'],
  'result-row-name': ['view', 'text'],
  'result-placeholder': ['input', 'textarea'],
}

function assertResultPanelRoles(source, relativePath) {
  const expected = resultPanelRoleCounts[relativePath]
  if (!expected) return
  const counts = Object.fromEntries(Object.keys(expected).map((role) => [role, 0]))
  const elements = []
  for (const match of source.matchAll(/<([a-z-]+)\b([^>]*)>/g)) {
    const [, tag, attributes] = match
    const classValue = attributes.match(/\bclass="([^"]*)"/)?.[1] || ''
    const placeholderValue = attributes.match(/\bplaceholder-class="([^"]*)"/)?.[1] || ''
    const classTokens = new Set(classValue.split(/\s+/).filter(Boolean))
    const placeholderTokens = new Set(placeholderValue.split(/\s+/).filter(Boolean))
    for (const role of Object.keys(expected)) {
      const attached = role === 'result-placeholder'
        ? placeholderTokens.has(role)
        : classTokens.has(role)
      if (!attached) continue
      counts[role] += 1
      elements.push({ role, tag, classTokens })
      assert(resultPanelRoleElements[role].includes(tag),
        `${relativePath} attaches ${role} to unexpected <${tag}>`)
    }
  }
  assert.deepEqual(counts, expected, `shared result-panel role counts changed: ${relativePath}`)
  for (const { role, classTokens } of elements) {
    if (role === 'result-share' || role === 'result-save') {
      assert(classTokens.has('result-sheet'), `${relativePath} ${role} must be attached to a result sheet`)
    }
  }
}

function withoutResultPanelRoles(source, relativePath) {
  const roles = Object.keys(resultPanelRoleCounts[relativePath] || {})
  if (!roles.length) return source
  return source.replace(/([ \t]+)(class|placeholder-class)="([^"]*)"/g, (_match, separator, name, value) => {
    let normalized = value
    for (const role of roles) {
      normalized = normalized.replace(new RegExp(`(^|\\s)${role}(?=\\s|$)`), '')
    }
    normalized = normalized.trim()
    if (normalized) return `${separator}${name}="${normalized}"`
    return separator.slice(0, -1)
  })
}

function normalizeSplScrollablePreviewForHistoricalHash(source) {
  const current = `      <scroll-view wx:elif="{{resultReportPreviewVisible && resultReportImagePath && !resultReportError}}" class="share-image-scroll" scroll-y enhanced show-scrollbar="{{false}}">
        <image class="share-image" src="{{resultReportImagePath}}" mode="widthFix" aria-label="声压级结果图片" bindtap="previewResultReportImage"></image>
      </scroll-view>`
  const historical = `      <view wx:elif="{{resultReportPreviewVisible && resultReportImagePath && !resultReportError}}" id="splShareImageFrame" class="share-image-frame" style="{{shareImageFrameStyle}}">
        <image class="share-image" src="{{resultReportImagePath}}" mode="aspectFit" style="{{shareImageStyle}}" aria-label="声压级结果图片" bindload="onResultReportImageLoad" bindtap="previewResultReportImage"></image>
      </view>`
  assert.equal(source.split(current).length - 1, 1,
    'normalized SPL markup must contain exactly one approved scrollable preview block')
  assert.equal(source.split(historical).length - 1, 0,
    'normalized SPL markup must not retain the old measured aspectFit preview block')
  return source.replace(current, historical)
}

const projectNoteTextareaContracts = [
  ['pages/cable/cable-overlays.wxml', 'data-field', 'onProjectConfigNoteInput'],
  ['pages/camera/camera-overlays.wxml', 'data-field', 'onCameraProjectConfigNoteInput'],
  ['pages/audio-wiring/wiring-overlays.wxml', 'data-field', 'onProjectConfigNoteInput'],
  ['pages/led-screen/led-overlays.wxml', 'data-field', 'onProjectConfigNoteInput'],
  ['pages/gain-structure/gain-overlays.wxml', 'data-project-field', 'onProjectConfigNoteInput'],
  ['pages/limiter/limiter-overlays.wxml', 'data-project-field', 'onProjectConfigNoteInput'],
  ['pages/spl/spl.wxml', 'data-project-field', 'onProjectConfigNoteInput'],
]

function assertProjectNoteTextareaFixed() {
  for (const [relativePath, fieldAttribute, inputHandler] of projectNoteTextareaContracts) {
    const source = read(relativePath)
    const notes = [...source.matchAll(/<textarea\b[^>]*>/g)]
      .filter(([tag]) => new RegExp(`\\b${fieldAttribute}="projectConfigNote"`).test(tag))
    assert.equal(notes.length, 1, `${relativePath} must keep one projectConfigNote textarea`)
    const tag = notes[0][0]
    assert.equal((tag.match(/\bfixed="\{\{true\}\}"/g) || []).length, 1,
      `${relativePath} project note textarea must set native fixed=true exactly once`)
    assert(tag.includes(`bindinput="${inputHandler}"`), `${relativePath} project note input binding changed`)
    assert(tag.includes('adjust-position="{{false}}"') && tag.includes('value="{{projectConfigNote}}"'),
      `${relativePath} project note keyboard/value bindings changed`)
  }
}

function withoutApprovedProjectNoteFixed(source, relativePath) {
  const frozenPages = {
    'pages/cable/cable.wxml': ['data-field', 'onProjectConfigNoteInput'],
    'pages/gain-structure/gain-structure.wxml': ['data-project-field', 'onProjectConfigNoteInput'],
    'pages/spl/spl.wxml': ['data-project-field', 'onProjectConfigNoteInput'],
  }
  const contract = frozenPages[relativePath]
  if (!contract) return source
  const [fieldAttribute, inputHandler] = contract
  const matchingTags = [...source.matchAll(/<textarea\b[^>]*>/g)]
    .filter(([tag]) => new RegExp(`\\b${fieldAttribute}="projectConfigNote"`).test(tag)
      && tag.includes(`bindinput="${inputHandler}"`))
  assert.equal(matchingTags.length, 1, `${relativePath}: expected one approved project note textarea`)
  const tag = matchingTags[0][0]
  assert.equal((tag.match(/\bfixed="\{\{true\}\}"/g) || []).length, 1,
    `${relativePath}: approved fixed attribute must occur exactly once on the project note`)
  const normalizedTag = tag.replace(' fixed="{{true}}"', '')
  assert.notEqual(normalizedTag, tag, `${relativePath}: fixed attribute must be a standalone WXML attribute`)
  return source.replace(tag, normalizedTag)
}

assertProjectNoteTextareaFixed()

function withoutDmxLayoutExportScrollHeight(source) {
  const current = '<scroll-view class="export-image-scroll" scroll-y enhanced show-scrollbar="{{false}}">'
  const frozen = '<scroll-view class="export-image-scroll" style="height:{{(canvasWidth > 706 ? 654 : canvasWidth - 50) * exportCanvasHeight / exportCanvasWidth}}px;" scroll-y enhanced show-scrollbar="{{false}}">'
  assert.equal(source.split(current).length - 1, 1,
    '灯位图 preview scroll keeps one result scroll after role normalization')
  return source.replace(current, frozen)
}

// Normalize only the approved result-image action labels for the frozen WXML
// snapshots. Exact button markup keeps every condition and event binding covered.
const approvedResultImageCopy = {
  'pages/cable/cable.wxml': [
    ['<button class="result-report-preview-action result-report-preview-action-primary" bindtap="shareResultReportImage">分享图片</button>',
      '<button class="result-report-preview-action result-report-preview-action-primary" bindtap="shareResultReportImage">转发图片</button>'],
  ],
  'pages/gain-structure/gain-structure.wxml': [
    ['<button class="share-action share-action-primary" disabled="{{isGeneratingResultReport || isCheckingResultReportCache}}" bindtap="shareResultReportImage">分享图片</button>',
      '<button class="share-action share-action-primary" disabled="{{isGeneratingResultReport || isCheckingResultReportCache}}" bindtap="shareResultReportImage">发送给微信好友</button>', 2],
    ['<button class="share-action" disabled="{{isGeneratingResultReport || isCheckingResultReportCache}}" bindtap="saveResultReportImage">保存到相册</button>',
      '<button class="share-action" disabled="{{isGeneratingResultReport || isCheckingResultReportCache}}" bindtap="saveResultReportImage">保存到手机</button>', 2],
  ],
  'pages/spl/spl.wxml': [
    ['<button class="share-action share-action-primary" disabled="{{!resultReportImagePath || isGeneratingResultReport || isCheckingResultReportCache || isCalculationPending}}" bindtap="shareResultReportImage">分享图片</button>',
      '<button class="share-action share-action-primary" disabled="{{!resultReportImagePath || isGeneratingResultReport || isCheckingResultReportCache || isCalculationPending}}" bindtap="shareResultReportImage">转发图片</button>'],
  ],
  'pages/dmx-layout/dmx-layout.wxml': [
    ['<button class="export-share" bindtap="shareImage">分享图片</button>',
      '<button class="export-share" bindtap="shareImage">转发图片</button>'],
    ['<button class="export-save-current" bindtap="saveImage">保存到相册</button>',
      '<button class="export-save-current" bindtap="saveImage">保存图片</button>'],
  ],
}

function withoutApprovedResultImageCopy(source, relativePath) {
  let normalized = source
  for (const [current, frozen, expectedCount = 1] of approvedResultImageCopy[relativePath] || []) {
    assert.equal(normalized.split(current).length - 1, expectedCount,
      `${relativePath}: expected ${expectedCount} approved result-image button label(s)`)
    assert.equal(normalized.split(frozen).length - 1, 0,
      `${relativePath}: old result-image button label unexpectedly remains`)
    normalized = normalized.split(current).join(frozen)
  }
  return normalized
}

// Keep the historical expanded-page hashes while allowing only the approved
// project-selection body to become a compact, independently scrolling list.
// The current branch is pinned by its exact hash; its accessible states and
// event bindings are separately checked by compact-selection-regression.cjs.
const approvedCompactProjectSelection = {
  'pages/cable/cable.wxml': {
    start: '<view wx:if="{{projectDialogStep == \'select\'}}" class="project-body project-step project-select-body"',
    next: '<scroll-view wx:elif="{{projectDialogStep == \'create\'}}"',
    currentSha256: '656789bb0c17dc06c40f2eba220ed3978b241dc363aae3c0902887890ca8db4f',
    legacy: `<scroll-view wx:if="{{projectDialogStep == 'select'}}" class="project-body project-step project-select-body" scroll-y scroll-into-view="{{projectFocusedInputId}}" enhanced show-scrollbar="{{false}}" aria-label="选择项目">
      <input id="projectSearchText" class="project-search" type="text" value="{{projectSearchText}}" placeholder="搜索项目" placeholder-class="project-search-placeholder result-placeholder" data-field="projectSearchText" data-step="select" data-dialog-revision="{{projectDialogRevision}}" data-focus-episode="{{projectFocusEpisode}}" bindinput="onProjectSearch" bindfocus="beginProjectInputFocus" bindblur="endProjectInputFocus" bindkeyboardheightchange="onProjectKeyboardHeightChange" adjust-position="{{false}}" cursor-spacing="12" />
      <view wx:if="{{projectLoadFailed}}" class="project-read-error">
        <view>读取项目列表失败</view>
        <view class="project-empty-detail">请检查本地存储后重试</view>
      </view>
      <view wx:elif="{{projectProjects.length}}" class="project-list" aria-label="项目列表">
        <view class="project-list-content">
          <view wx:for="{{filteredProjects}}" wx:key="id" class="project-row result-row" data-id="{{item.id}}" bindtap="selectProjectTarget">
            <view class="project-row-copy">
              <view class="project-row-name result-row-name">{{item.name}}</view>
            </view>
            <view class="project-row-mark">›</view>
          </view>
          <view wx:if="{{!filteredProjects.length}}" class="project-empty">没有匹配的项目</view>
        </view>
      </view>
      <view wx:elif="{{!projectLoadFailed}}" class="project-empty">
        <view>还没有现场项目</view>
        <view class="project-empty-detail">新建后可将本次选型保存到项目</view>
      </view>
      <view wx:if="{{projectError}}" class="project-error">{{projectError}}</view>
    </scroll-view>

`,
  },
  'pages/gain-structure/gain-structure.wxml': {
    start: '<view wx:if="{{projectStep === \'select\'}}" class="project-sheet-body project-select-body"',
    next: '<scroll-view wx:elif="{{projectStep === \'create\'}}"',
    panelModifier: ` {{projectStep === 'select' ? 'project-select-sheet' : ''}}`,
    currentSha256: 'd4d7923d6cfd8b0448795da7da80087155b27dacf496aeffd5fa2b885fd74fd4',
    legacy: `<scroll-view wx:if="{{projectStep === 'select'}}" class="project-sheet-body" scroll-y enhanced show-scrollbar="{{false}}">
    <input class="selector-search" data-project-field="projectSearch" data-project-episode="{{projectKeyboardEpisode}}" adjust-position="{{false}}" value="{{projectSearch}}" placeholder="搜索项目" placeholder-style="font-size:16px;line-height:52px;" confirm-type="search" bindfocus="onProjectInputFocus" bindblur="onProjectInputBlur" bindkeyboardheightchange="onProjectKeyboardHeightChange" bindinput="onProjectSearch"  placeholder-class="result-placeholder"/>
    <view wx:if="{{projectLoadState === 'loading'}}" class="project-state">正在读取项目…</view>
    <view wx:elif="{{projectLoadState === 'error'}}" class="project-state project-state-error"><text>{{projectError}}</text><button class="share-retry" bindtap="refreshProjects">重试</button></view>
    <view wx:elif="{{projectItems.length === 0 && projectSearch}}" class="project-state">没有匹配项目。</view>
    <view wx:elif="{{projectItems.length === 0}}" class="project-state">还没有项目，可新建项目保存当前结果。</view>
    <view wx:if="{{projectSaveError}}" class="form-error" role="alert">{{projectSaveError}}</view>
    <view wx:if="{{projectItems.length}}" class="project-list">
      <button wx:for="{{projectItems}}" wx:key="id" class="project-row result-row {{projectTargetId === item.id ? 'project-row-selected' : ''}}" data-id="{{item.id}}" aria-pressed="{{projectTargetId === item.id}}" bindtap="chooseProject">
        <text class="result-row-name">{{item.name}}</text><text class="field-arrow">›</text>
      </button>
    </view>
  </scroll-view>

`,
  },
  'pages/spl/spl.wxml': {
    start: '<view wx:if="{{projectStep === \'select\'}}" class="project-sheet-body project-select-body"',
    next: '<scroll-view wx:elif="{{projectStep === \'create\'}}"',
    panelModifier: ` {{projectStep === 'select' ? 'project-select-sheet' : ''}}`,
    currentSha256: '13d775d40263da2f9fc371d3cbdd58fb33d71958477a0d4c2f6ad25771bb8c7b',
    legacy: `<scroll-view wx:if="{{projectStep === 'select'}}" class="project-sheet-body" scroll-y enhanced show-scrollbar="{{false}}">
        <input class="project-search" data-project-field="projectSearch" data-project-revision="{{projectRevision}}" data-project-episode="{{projectKeyboardEpisode}}" adjust-position="{{false}}" value="{{projectSearch}}" placeholder="搜索项目" confirm-type="search" bindfocus="onProjectInputFocus" bindblur="onProjectInputBlur" bindkeyboardheightchange="onProjectKeyboardHeightChange" bindinput="onProjectSearch"  placeholder-class="result-placeholder"/>
        <view wx:if="{{projectLoadState === 'loading'}}" class="project-state">正在读取项目…</view>
        <view wx:elif="{{projectLoadState === 'error'}}" class="project-state project-state-error"><text>{{projectError}}</text><button class="share-retry" bindtap="refreshProjects">重试</button></view>
        <view wx:elif="{{projectItems.length === 0 && projectSearch}}" class="project-state">没有匹配项目。</view>
        <view wx:elif="{{projectItems.length === 0}}" class="project-state">还没有项目，可新建项目保存当前结果。</view>
        <view wx:if="{{projectSaveError}}" class="form-error" role="alert">{{projectSaveError}}</view>
        <view wx:if="{{projectItems.length}}" class="project-list">
          <button wx:for="{{projectItems}}" wx:key="id" class="project-row result-row {{projectTargetId === item.id ? 'project-row-selected' : ''}}" data-id="{{item.id}}" aria-pressed="{{projectTargetId === item.id}}" bindtap="chooseProject">
            <text class="result-row-name">{{item.name}}</text><text class="field-arrow">›</text>
          </button>
        </view>
      </scroll-view>

`,
  },
}

function withoutApprovedCompactProjectSelection(source, relativePath) {
  const contract = approvedCompactProjectSelection[relativePath]
  if (!contract) return source
  if (contract.panelModifier) {
    assert.equal(source.split(contract.panelModifier).length - 1, 1,
      `${relativePath}: expected one approved compact-selection sheet modifier`)
    source = source.replace(contract.panelModifier, '')
  }
  assert.equal(source.split(contract.start).length - 1, 1,
    `${relativePath}: expected one compact project-selection branch`)
  const start = source.indexOf(contract.start)
  const nextStep = source.indexOf(contract.next, start)
  assert(nextStep > start, `${relativePath}: compact selection must end before project creation`)
  const end = source.lastIndexOf('\n', nextStep) + 1
  const current = source.slice(start, end)
  assert.equal(sha256(Buffer.from(current)), contract.currentSha256,
    `${relativePath}: compact selection markup changed beyond the approved list layout`)
  return source.slice(0, start) + contract.legacy + source.slice(end)
}

// Preserve the pre-approved save-details wording and target-row markup in the
// historical page hashes. The separate project-save regression asserts the
// current single back action and its binding.
function withoutApprovedProjectDetailsReturnChanges(source, relativePath) {
  const replacements = {
    'pages/gain-structure/gain-structure.wxml': [
      ['<text class="project-target-name">{{projectTargetName}}</text>\n    </view>',
        '<text class="project-target-name">{{projectTargetName}}</text>\n      <button class="text-action" bindtap="backToProjectList">更换项目</button>\n    </view>'],
      ['<button class="share-action" bindtap="backToProjectList">返回项目列表</button>',
        '<button class="share-action" bindtap="backToProjectList">返回</button>'],
    ],
    'pages/spl/spl.wxml': [
      ['<view class="project-target"><text class="project-target-label">保存到</text><text class="project-target-name">{{projectTargetName}}</text></view>',
        '<view class="project-target"><text class="project-target-label">保存到</text><text class="project-target-name">{{projectTargetName}}</text><button class="text-action" bindtap="backToProjectList">更换项目</button></view>'],
      ['<button class="share-action" disabled="{{isSavingProject}}" bindtap="backToProjectList">返回项目列表</button>',
        '<button class="share-action" disabled="{{isSavingProject}}" bindtap="backToProjectList">返回</button>'],
    ],
  }
  let normalized = source
  for (const [current, frozen] of replacements[relativePath] || []) {
    assert.equal(normalized.split(current).length - 1, 1,
      `${relativePath}: expected one approved project-details return change`)
    normalized = normalized.replace(current, frozen)
  }
  return normalized
}

// The approved 2026-10-18 homepage handoff adds editor actions, a native-return
// guard and a calculation-basis link. Keep the original calculator markup
// frozen after removing only these separately regression-tested additions.
function withoutHomepageEditorSurfaces(source) {
  return source
    .replace(/^[ \t]*<include src="\.\.\/\.\.\/templates\/(?:result-record-actions|editor-navigation-guard)\.wxml"\s*\/>[ \t]*(?:\r?\n)?/gm, '')
    .replace(/^[ \t]*<navigator class="basis-detail-link" url="\/pages\/basis\/detail\?tool=[A-Za-z]+">查看计算依据<\/navigator>[ \t]*(?:\r?\n)?/gm, '')
    .replace(/^[ \t]*<page-container\b(?=[^>]*class="editor-navigation-guard")[^>]*(?:\/>|>\s*<\/page-container>)[ \t]*(?:\r?\n)?/gm, '')
}

// The animation lifecycle update adds only these two reactive class tokens to
// the approved SPL selector. Strip exactly those tokens when checking the
// frozen production markup hash; all other WXML changes still fail the hash.
function withoutSplSelectorAnimationClasses(source) {
  const maskClass = `class="selector-mask {{selectorClosing ? 'selector-closing' : ''}}"`
  const panelClass = `class="selector-panel {{selectorClosing ? 'selector-panel-closing' : ''}}"`
  assert.equal(source.split(maskClass).length - 1, 1, 'SPL selector mask closing class must occur exactly once')
  assert.equal(source.split(panelClass).length - 1, 1, 'SPL selector panel closing class must occur exactly once')
  return source
    .replace(maskClass, 'class="selector-mask"')
    .replace(panelClass, 'class="selector-panel"')
}

// The shared picker skin adds a bounded set of presentation-only classes to
// the SPL selector. Validate every token count, then remove only those tokens
// before comparing the frozen historical markup hash.
function withoutSplDevicePickerClasses(source) {
  const tokens = [
    ['device-picker-scope', 1],
    ['device-picker-standard', 1],
    ['device-picker-header', 1],
    ['device-picker-title', 1],
    ['device-picker-close', 1],
    ['device-picker-search', 1],
    ['device-picker-category-scroll', 1],
    ['device-picker-category', 1],
    ['device-picker-category-active', 1],
    ['device-picker-count', 1],
    ['device-picker-list', 1],
    ['device-picker-row', 1],
    ['device-picker-item-title', 1],
    ['device-picker-item-meta', 1],
    ['device-picker-detail', 1],
    ['device-picker-arrow', 1],
    ['device-picker-empty', 1],
  ]
  for (const [token, expectedCount] of tokens) {
    const actualCount = (source.match(new RegExp("\\s" + token + "(?=\\s|['\"])", 'g')) || []).length
    assert.equal(actualCount, expectedCount,
      'SPL picker class ' + token + ' must occur exactly ' + expectedCount + ' time(s)')
  }
  const expectedPanelClass = 'class="selector-panel device-picker-scope device-picker-standard {{selectorClosing ? \'selector-panel-closing\' : \'\'}}"'
  assert(source.includes(expectedPanelClass),
    'shared picker scope must stay on the existing SPL selector panel')
  assert(source.includes('bindinput="onSelectorInput"')
    && source.includes('catchtap="onSelectorCategoryTap"')
    && source.includes('bindscrolltolower="appendSelectorItems"')
    && source.includes('catchtap="selectSpeaker"')
    && source.includes('catchtap="openSpeakerDetail"'),
  'shared picker styling must preserve SPL search, category, pagination, selection, and detail actions')
  return source.replace(/\s+device-picker-[a-z-]+/g, '')
}

// The input-stability fix adds one exact inline min-height binding to each
// result card. Assert the binding stays on the matching card, then remove only
// that attribute before checking the frozen historical markup hashes.
function withoutResultAreaStyles(source, relativePath) {
  const bindings = {
    'pages/cable/cable.wxml': {
      className: 'result-card result-card-{{calculationState}}',
      attribute: `style="{{canUseResultActions ? '' : resultAreaStyle}}"`,
    },
    'pages/spl/spl.wxml': {
      className: 'result-card result-card-tabs',
      attribute: `style="{{canUseResultActions && !isCalculationPending ? '' : resultAreaStyle}}"`,
    },
    'pages/led-screen/led-screen.wxml': {
      className: 'result-card',
      attribute: `style="{{result && !inputPending && !inputError ? '' : resultAreaStyle}}"`,
    },
  }
  const binding = bindings[relativePath]
  if (!binding) return source
  const openingTag = `<view class="${binding.className}" ${binding.attribute}>`
  assert.equal(source.split(binding.attribute).length - 1, 1,
    `result-area style binding must occur exactly once: ${relativePath}`)
  assert.equal(source.split(openingTag).length - 1, 1,
    `result-area style binding must be attached to its result-card: ${relativePath}`)
  return source.replace(openingTag, `<view class="${binding.className}">`)
}

// The approved docked layout sheets move the placement overlay's bottom inset
// into the sheet itself. Check all three overlay spacing bindings, then restore
// only those exact attributes to their frozen form for the historical markup hash.
function withoutDmxLayoutDockedInsets(source) {
  const current = 'style="padding-top:{{overlaySafeTop + 12}}px;"'
  const frozen = 'style="padding-top:{{overlaySafeTop + 12}}px;padding-bottom:{{overlaySafeBottom + 12}}px;"'
  assert.equal(source.split(current).length - 1, 3,
    'placement, settings, and export overlays must all move the bottom inset into their sheets')
  assert.match(source, /class="overlay placement-overlay[^\"]*" style="padding-top:\{\{overlaySafeTop \+ 12\}\}px;"/)
  assert.match(source, /class="overlay settings-overlay[^\"]*" style="padding-top:\{\{overlaySafeTop \+ 12\}\}px;"/)
  assert.match(source, /class="export-overlay[^\"]*" style="padding-top:\{\{overlaySafeTop \+ 12\}\}px;"/)
  return source.replaceAll(current, frozen)
}

// Preserve approved historical markup hashes while allowing this narrowly
// scoped close-control presentation update. Exact snippet matches keep
// handlers, disabled bindings, and labels covered.
const panelClosePresentation = {
  'pages/dmx-layout/dmx-layout.wxml': [
    { current: '<button class="sheet-close panel-close-control" aria-label="关闭灯位图预览" bindtap="closePreview"><view class="panel-close-icon" aria-hidden="true"></view></button>',
      frozen: '<button class="sheet-close" bindtap="closePreview">关闭</button>' },
  ],
  'pages/cable/cable.wxml': [
    { current: '<button class="result-report-preview-close panel-close-control" aria-label="关闭结果图片预览" bindtap="closeResultReportPreview"><view class="panel-close-icon" aria-hidden="true"></view></button>',
      frozen: '<button class="result-report-preview-close" bindtap="closeResultReportPreview">关闭</button>' },
    { current: '<button class="project-close panel-close-control" aria-label="关闭项目保存" disabled="{{projectSaving}}" bindtap="closeProjectDialog"><view class="panel-close-icon" aria-hidden="true"></view></button>',
      frozen: '<button class="project-close" aria-label="关闭项目保存" disabled="{{projectSaving}}" bindtap="closeProjectDialog">×</button>' },
  ],
  'pages/gain-structure/gain-structure.wxml': [
    { current: '<button class="sheet-close panel-close-control" aria-label="关闭功放型号选择" bindtap="closeAmplifierSelector"><view class="panel-close-icon" aria-hidden="true"></view></button>',
      frozen: '<button class="sheet-close" aria-label="关闭" bindtap="closeAmplifierSelector">×</button>' },
    { current: '<button class="sheet-close panel-close-control" aria-label="取消并关闭结果图片预览" bindtap="closeSharePreview"><view class="panel-close-icon" aria-hidden="true"></view></button>',
      frozen: '<button class="sheet-close" aria-label="取消并关闭" bindtap="closeSharePreview">×</button>' },
    { current: '<button class="sheet-close panel-close-control" aria-label="关闭项目保存面板" bindtap="closeProjectSheet"><view class="panel-close-icon" aria-hidden="true"></view></button>',
      frozen: '<button class="sheet-close" aria-label="关闭" bindtap="closeProjectSheet">×</button>' },
  ],
  'pages/spl/spl.wxml': [
    { current: '<button class="selector-close panel-close-control" aria-label="关闭音箱型号选择" catchtap="closeSpeakerSelector"><view class="panel-close-icon" aria-hidden="true"></view></button>',
      frozen: '<button class="selector-close" aria-label="关闭" catchtap="closeSpeakerSelector">×</button>' },
    { current: '<button class="sheet-close panel-close-control" aria-label="关闭结果图片预览" bindtap="closeSharePreview"><view class="panel-close-icon" aria-hidden="true"></view></button>',
      frozen: '<button class="sheet-close" aria-label="关闭预览" bindtap="closeSharePreview">×</button>' },
    { current: '<button class="sheet-close panel-close-control" aria-label="关闭项目保存面板" disabled="{{isSavingProject}}" bindtap="closeProjectSheet"><view class="panel-close-icon" aria-hidden="true"></view></button>',
      frozen: '<button class="sheet-close" aria-label="关闭保存面板" disabled="{{isSavingProject}}" bindtap="closeProjectSheet">×</button>' },
  ],
}

function withoutPanelClosePresentation(source, relativePath) {
  let normalized = source
  for (const { current, frozen } of panelClosePresentation[relativePath] || []) {
    assert.equal(normalized.split(current).length - 1, 1,
      'close presentation must be an exact single match in ' + relativePath)
    normalized = normalized.replace(current, frozen)
  }
  return normalized
}

function expandIncludes(source, fromFile, stack = []) {
  return source.replace(/<include\s+src="([^"]+)"\s*\/>/g, (_match, includePath) => {
    const resolved = path.resolve(path.dirname(fromFile), includePath)
    assert(resolved.startsWith(`${root}${path.sep}`), `WXML include escapes workspace: ${includePath}`)
    assert(!stack.includes(resolved), `WXML include cycle: ${includePath}`)
    return expandIncludes(fs.readFileSync(resolved, 'utf8'), resolved, [...stack, resolved])
  })
}

for (const [relativePath, expectedHash] of Object.entries({
  ...baseline.expandedWxmlSha256,
  ...(repair7CurrentContract.approvedExpandedWxmlSha256 || {}),
})) {
  assert.match(expectedHash, /^[0-9a-f]{64}$/, `missing test-first WXML hash: ${relativePath}`)
  const file = path.join(root, relativePath)
  if (relativePath === retiredLandscapeWxml) {
    assert(!registeredPages.includes(retiredLandscapePage), 'retired landscape page must remain unregistered')
    assert.equal(fs.existsSync(file), false, 'retired landscape WXML must be removed')
    continue
  }
  const source = fs.readFileSync(file, 'utf8')
  const expanded = expandIncludes(withoutHomepageEditorSurfaces(source), file)
  const dmxLayoutPages = new Set([
    'pages/dmx-layout/dmx-layout.wxml',
  ])
  let hashInput = withoutResultAreaStyles(normalizeLineEndings(expanded), relativePath)
  assertResultPanelRoles(hashInput, relativePath)
  if (relativePath === 'pages/cable/cable.wxml') {
    const overlay = read('pages/cable/cable-overlays.wxml')
    const pageController = read('pages/cable/cable.js')
    const projectController = read('pages/cable/cable-project.js')
    assert(pageController.includes("require('./cable-project')")
      && pageController.includes('...cableProjectMethods'),
    'cable page must compose its project controller methods')
    const controller = `${pageController}\n${projectController}`
    const reportUi = read('pages/cable/cable-report.js')
    const styles = read('pages/cable/cable.wxss')
    const sharedPreview = read('templates/result-report-preview.wxml')
    const nativeImagePreview = read('pages/native-image-preview.js')
    const actions = [...source.matchAll(/<button class="action-button"[^>]*>[\s\S]*?<\/button>/g)]
    const actionNames = actions.map(([button]) => button.match(/bindtap="([^"]+)"/)?.[1] || '')
    const railRule = styles.match(/\.action-rail\s*\{([^}]*)\}/)
    const buttonRule = styles.match(/\.action-button\.action-button\s*\{([^}]*)\}/)
    const actionButtonProperties = {}
    if (buttonRule) {
      buttonRule[1].split(';').forEach((declaration) => {
        const colon = declaration.indexOf(':')
        if (colon >= 0) actionButtonProperties[declaration.slice(0, colon).trim()] = declaration.slice(colon + 1).trim()
      })
    }
    assert(source.indexOf('class="result-pane"') < source.indexOf('class="input-pane"'),
      'cable result pane must precede its input pane')
    assert(source.includes('<include src="./cable-overlays.wxml" />')
      && source.includes('<include src="../../templates/result-report-preview.wxml" />')
      && (source.match(/<include src="\.\.\/\.\.\/templates\/result-report-preview\.wxml"\s*\/>/g) || []).length === 1,
    'cable must include exactly one shared report preview template')
    assert.equal(actions.length, 4, 'cable result rail must keep exactly four actions')
    assert.deepEqual(actionNames, [
      'resetInputs', 'generateResultReportImage', 'toggleCurrentFavorite', 'saveToActiveProject',
    ], 'cable result actions must expose reset, image share, favorite, and project save')
    assert(actions.every(([button]) => button.includes('aria-label="')),
      'cable result actions must have explicit accessible labels')
    assert(actions.every(([button]) => button.includes('disabled="{{')),
      'cable result actions must expose disabled state while inputs are pending or invalid')
    const effectiveIconStyles = `${read('app.wxss')}\n${styles}`
    for (const icon of ['icon-reset', 'icon-share', 'icon-bookmark', 'icon-folder']) {
      assert(source.includes(`class="action-icon ${icon}`) && effectiveIconStyles.includes(`.${icon}`),
        `cable action rail is missing its ${icon} vector mask`)
    }
    assert(source.includes('result.warnings.length')
      && source.includes('result.formulaMinimumArea')
      && source.includes('result.currentA')
      && source.includes('result.selectedArea')
      && source.includes('result.description')
      && source.includes('class="warning-card"')
      && !source.includes('class="formula-card"')
      && !source.includes('S ≥ P × L × 5'),
    'cable page must remove the standalone formula card while retaining real secondary results, description, and warnings')
    assert(!source.includes('copyResult') && !overlay.includes('copyResult')
      && !/setClipboardData|复制选型文字/.test(source + overlay),
    'cable must not expose a copy action in the page or share sheet')
    assert(source.indexOf('class="cable-spec"') < source.indexOf('class="secondary-card"')
      && source.indexOf('class="secondary-card"') < source.indexOf('class="result-facts"'),
    'cable result hierarchy must show the main and secondary result before compact conditions')
    const pageContent = source.slice(source.indexOf('<scroll-view class="page-scroll"'), source.indexOf('<include src="./cable-overlays.wxml"'))
    assert.equal((pageContent.match(/<scroll-view\b/g) || []).length, 1,
      'cable page content must use one full-page scroll container')
    assert(!pageContent.includes('result-details-scroll') && !pageContent.includes('editor-scroll')
      && styles.includes('.page-scroll{') && styles.includes('.editor-fields{'),
    'cable result and input content must use ordinary views inside the full-page scroller')
    for (const selector of [
      '.cable-spec', '.mode-tab.mode-tab-active .mode-label', '.input-unit', '.result-label',
    ]) assert(styles.includes(selector), 'cable visual regression selector is missing: ' + selector)
    assert(!styles.includes('.formula-title') && !styles.includes('.formula-text'),
      'formula-card-only styles must be removed with the standalone page card')
    assert(railRule?.[1].includes('position:absolute')
      && railRule[1].includes('width:44px'),
    'cable result rail must float above the full-width result card')
    assert(actionButtonProperties['box-sizing'] === 'border-box'
      && actionButtonProperties.display === 'flex'
      && ['width', 'min-width', 'max-width', 'height', 'min-height', 'max-height']
        .every((property) => actionButtonProperties[property] === '44px'),
    'cable native buttons must remain fixed 44px circles')
    assert(effectiveIconStyles.includes('mask-image:url("data:image/svg+xml,')
      && effectiveIconStyles.includes('-webkit-mask-image:url("data:image/svg+xml,'),
    'cable icons must use local SVG masks without runtime requests')
    const selectStepStart = overlay.indexOf('<view wx:if="{{projectDialogStep == \'select\'}}" class="project-body project-step project-select-body" aria-label="选择项目">')
    const createStepStart = overlay.indexOf('<scroll-view wx:elif="{{projectDialogStep == \'create\'}}" class="project-body project-step project-create-body"')
    const selectStepMarkup = selectStepStart >= 0 && createStepStart > selectStepStart
      ? overlay.slice(selectStepStart, createStepStart)
      : ''
    assert(selectStepMarkup.includes('<input id="projectSearchText" class="project-search"')
      && selectStepMarkup.includes('<view wx:elif="{{projectProjects.length}}" class="project-list-wrap">')
      && selectStepMarkup.includes('<scroll-view wx:if="{{filteredProjects.length}}" class="project-list project-select-list" scroll-y enhanced show-scrollbar="{{filteredProjects.length > 1}}" aria-label="项目列表">')
      && selectStepMarkup.includes('<view wx:for="{{filteredProjects}}" wx:key="id" class="project-row project-select-row result-row" data-id="{{item.id}}" bindtap="selectProjectTarget">')
      && selectStepMarkup.includes('<view wx:else class="project-empty">没有匹配的项目</view>')
      && selectStepMarkup.includes('class="project-select-hint">上下滑动查看更多</view>')
      && !/<scroll-view\b[^>]*class="project-body project-step project-select-body"/.test(selectStepMarkup)
      && (selectStepMarkup.match(/<scroll-view\b/g) || []).length === 1,
    'cable project selection must keep search and empty states visible while the project list scrolls independently')
    assert(overlay.includes('bindinput="onProjectSearch"')
      && !overlay.includes('class="project-current"')
      && overlay.includes('maxlength="30"')
      && overlay.includes('class="project-target-name"')
      && overlay.includes('class="project-preview"')
      && overlay.includes('projectFrozenTitle') && overlay.includes('projectFrozenSummary')
      && !overlay.includes('projectFrozenResultText')
      && overlay.includes('class="project-config-name"')
      && overlay.includes('maxlength="60"')
      && overlay.includes('bindinput="onProjectConfigNameInput"')
      && overlay.includes('class="project-config-note"')
      && overlay.includes('maxlength="200"')
      && overlay.includes('bindinput="onProjectConfigNoteInput"')
      && overlay.includes('scroll-into-view="{{projectFocusedInputId}}"')
      && overlay.includes('bindtap="saveProjectTarget"')
      && controller.includes('getPreferences(state = this.data)')
      && controller.includes('getResultText(state = this.data, result = state.result)')
      && controller.includes('getRecordPayload(state = this.data, result = state.result)')
      && controller.includes('getRecordLookupPayload()')
      && controller.includes('isProjectSavePayloadCurrent()')
      && controller.includes('getProjectRecordView')
      && controller.includes('name: projectConfigName')
      && controller.includes('note: projectConfigNote'),
    'cable project sheet must search, select, confirm, freeze the record payload, and persist project-scoped metadata')
    assert.equal((overlay.match(/<scroll-view\b/g) || []).length, 4,
      'each cable project step must own one scroll body')
    assert(!overlay.includes('cable-original-image-viewer')
      && !overlay.includes('resultReportImageViewerVisible')
      && !overlay.includes('setResultReportImageViewerScale')
      && !reportUi.includes('resultReportImageViewer')
      && reportUi.includes("require('../native-image-preview')")
      && /nativeImagePreview\.preview\(this, path,\s*\(\) => this\.setData\(this\.hideResultReportPreview\(\)\)\)/.test(reportUi)
      && nativeImagePreview.includes('if (state.hidden)')
      && nativeImagePreview.includes('if (onFailure) onFailure()')
      && reportUi.includes('stopTap()')
      && reportUi.includes('preventTouchMove()')
      && sharedPreview.includes('catchtap="stopTap"')
      && sharedPreview.includes('catchtouchmove="preventTouchMove"'),
    'cable must remove its page-local viewer while retaining shared preview touch handlers and the native preview helper')
    assert(sharedPreview.includes('bindtap="previewResultReportImage"')
      && sharedPreview.includes('bindtap="shareResultReportImage"')
      && sharedPreview.includes('bindtap="saveResultReportImage"'),
    'shared cable preview must preserve original image preview, share, and save actions')
    assert(!/bindtap="\{\{/.test(source + overlay),
      'cable WXML event names must use static handlers')
  }
  if (relativePath === 'pages/spl/spl.wxml') {
    const styles = read('pages/spl/spl.wxss')
    const controller = read('pages/spl/spl.js')
    const report = read('pages/spl/spl-report.js')
    const actions = [...source.matchAll(/<button\b[^>]*class="action-button"[^>]*>([\s\S]*?)<\/button>/g)]
    const actionNames = actions.map(([button]) => button.match(/bindtap="([^"]+)"/)?.[1] || '')
    assert.equal(actions.length, 4, 'SPL action rail must keep exactly four actions')
    assert.deepEqual(actionNames, [
      'requestReset', 'openSharePreview', 'toggleCurrentFavorite', 'openProjectSheet',
    ], 'SPL action rail must expose reset, share preview, favorite, and project save')
    assert(actions.every(([button]) => button.includes('aria-label="') && button.includes('disabled="{{')),
      'SPL action rail buttons must expose accessible labels and state-dependent disabling')
    const effectiveIconStyles = `${read('app.wxss')}\n${styles}`
    for (const icon of ['icon-reset', 'icon-share', 'icon-bookmark', 'icon-folder']) {
      assert(source.includes(`class="action-icon ${icon}`) && effectiveIconStyles.includes(`.${icon}`),
        `SPL action rail is missing its ${icon} icon`)
    }
    assert(!source.includes('copyResult') && !/setClipboardData|复制/.test(source),
      'SPL page must not expose the removed copy-result UI')
    assert(source.includes('canvas-id="resultReportCanvas"')
      && source.includes('class="result-report-canvas-offscreen"'),
    'SPL must retain its offscreen result-report canvas')
    assert(source.includes('result.selectedSpl')
      && source.includes('result.oneMeterSpl')
      && source.includes('result.summationGainDb')
      && source.includes('result.speakerCount')
      && source.includes('自由场理论估算')
      && source.includes('该数值不是现场实测声压级'),
    'SPL page must retain its core result and free-field estimate qualification')
    const resultCard = source.indexOf('class="result-card result-card-tabs"')
    const tabList = source.indexOf('class="result-tabs" role="tablist"')
    const splTab = source.indexOf('id="splTabResult"')
    const distanceTab = source.indexOf('id="splTabDistance"')
    const referenceTab = source.indexOf('id="splTabReference"')
    const splPanel = source.indexOf('id="splPanelResult"')
    const distanceListMarkup = source.indexOf('class="distance-list"')
    const references = source.indexOf('class="reference-tab-item"')
    const inputCard = source.indexOf('<view class="card settings-card">')
    assert(resultCard >= 0 && tabList > resultCard && splTab > tabList && distanceTab > splTab
      && referenceTab > distanceTab && splPanel > referenceTab && distanceListMarkup > splPanel
      && references > distanceListMarkup && inputCard > references,
    'SPL result card must contain the three tab controls and full result, distance, and reference panes before inputs')
    for (const [id, target, key] of [
      ['splTabResult', 'splPanelResult', 'spl'],
      ['splTabDistance', 'splPanelDistance', 'distance'],
      ['splTabReference', 'splPanelReference', 'reference'],
    ]) {
      const tab = source.match(new RegExp(`<view id="${id}"[^>]*>`))?.[0] || ''
      const panel = source.match(new RegExp(`<view[^>]*id="${target}"[^>]*role="tabpanel"[^>]*>`))?.[0] || ''
      assert(tab.includes('role="tab"') && tab.includes(`data-tab="${key}"`)
        && tab.includes('aria-selected="{{resultTab ===') && tab.includes(`aria-controls="${target}"`)
        && tab.includes('bindtap="onResultTabTap"') && panel.includes(`aria-labelledby="${id}"`),
      `SPL ${key} tab must bind the production handler and label its matching panel`)
    }
    assert(source.includes('class="result-tabs" role="tablist" aria-label="声压级结果分类"')
      && source.includes('id="splPanelDistance" class="result-tab-panel result-tab-distance" role="tabpanel"')
      && source.includes('id="splPanelReference" class="result-tab-panel result-tab-reference" role="tabpanel"')
      && source.includes('class="reference-tab-footer"')
      && source.includes('class="distance-mode-note"'),
    'SPL tabs must retain semantic panels, the complete distance condition, and reference footer')
    assert(!source.includes('splDetailPanel') && !source.includes('splResultDetails')
      && !source.includes('splDetailClose') && !source.includes('detailsSheetVisible')
      && !controller.includes('openSplDetails') && !controller.includes('closeSplDetails'),
    'the replaced SPL detail drawer must not leave obsolete markup or controller methods')
    assert(controller.includes("resultTab: 'spl'") && controller.includes('onResultTabTap(event)')
      && controller.includes("!['spl', 'distance', 'reference'].includes(tab)")
      && controller.includes("this.setData({ resultTab: tab }, () => measure(this))")
      && controller.includes("vibrate('light')"),
    'SPL tab selection must default to the main pane and use the guarded light-haptic controller')
    assert(source.includes('class="page-scroll"') && styles.includes('.page-root{overflow:visible}')
      && styles.includes('.page-scroll{height:100vh;overflow:visible}')
      && styles.includes('.result-grid-home{')
      && source.includes('class="metric-value">{{result.oneMeterSpl}} dB SPL</view>')
      && source.includes('class="metric-value">{{result.totalRatedPower}} W</view>'),
    'SPL home must retain one-screen output and both key secondary metrics without clipping the page')
    assert(source.includes('<picker range="{{countPickerOptions}}" value="{{countIndex + 1}}" bindchange="onCountPickerChange">')
      && source.includes("countIndex >= 0 ? counts[countIndex] + ' 只' : '请选择数量'")
      && controller.includes('onCountPickerChange(event)')
      && controller.includes('detail: { value: pickerIndex - 1 }'),
    'blank count placeholder must map through the UI adapter while numeric countIndex stays unchanged')
    assert(source.includes('class="share-image-scroll result-scroll" scroll-y enhanced show-scrollbar="{{false}}"')
      && source.includes('class="share-image" src="{{resultReportImagePath}}" mode="widthFix"')
      && source.includes('bindtap="previewResultReportImage"')
      && !source.includes('share-image-frame')
      && controller.includes('fileSystem.access({ path, success: showCached, fail: regenerate })')
      && !controller.includes('updateShareImageLayout')
      && !controller.includes('shareImageFrameStyle')
      && styles.includes('.share-image{display:block;max-width:100%;max-height:none;flex:none}'),
    'SPL preview must keep a full-height scrollable image, avoid CSS height clamping, and retain native image preview')
    const resultGrid = /\.result-grid\s*\{([^}]*)\}/.exec(styles)?.[1] || ''
    const resultGridTop = Number(/margin-top\s*:\s*(\d+(?:\.\d+)?)px/.exec(resultGrid)?.[1] || 0)
    assert(resultGridTop >= 52,
      'SPL metric grid must keep enough vertical separation from the four-button action rail')
    const distanceBaseStyleStart = styles.search(/\.distance-list\s*\{/)
    assert(distanceBaseStyleStart >= 0, 'SPL base distance-list CSS rule is missing')
    const distanceStyleSource = styles.slice(distanceBaseStyleStart)
    const cssRule = (selector, source = distanceStyleSource) => source.match(
      new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`)
    )?.[1] || ''
    const distanceList = cssRule('.distance-list')
    const distanceRow = cssRule('.distance-list .distance-row')
    const distanceHead = cssRule('.distance-list .distance-row-head')
    const distanceValue = cssRule('.distance-list .distance-value')
    const distanceSpl = cssRule('.distance-list .distance-spl')
    const distanceResult = cssRule('.distance-list .distance-result')
    const distanceCurrent = cssRule('.distance-list .distance-current')
    const narrowDistanceStart = styles.lastIndexOf('@media(max-width:360px){')
    const narrowDistanceEnd = styles.indexOf('@media(', narrowDistanceStart + 1)
    const narrowDistanceMedia = narrowDistanceStart < 0 ? ''
      : styles.slice(narrowDistanceStart, narrowDistanceEnd < 0 ? styles.length : narrowDistanceEnd)
    const narrowDistanceValue = /\.distance-list\s+\.distance-value\s*\{([^}]*)\}/.exec(narrowDistanceMedia)?.[1] || ''
    const narrowDistanceSpl = /\.distance-list\s+\.distance-spl\s*\{([^}]*)\}/.exec(narrowDistanceMedia)?.[1] || ''
    assert(distanceList.includes('display:flex') && distanceList.includes('flex-direction:column')
      && distanceRow.includes('display:flex') && distanceRow.includes('flex-direction:row')
      && /min-width\s*:\s*0/.test(distanceHead) && /flex\s*:\s*1\s+1\s+auto/.test(distanceHead)
      && /min-width\s*:\s*0/.test(distanceValue) && /flex\s*:\s*0\s+1\s+auto/.test(distanceValue)
      && /white-space\s*:\s*normal/.test(distanceValue) && /overflow-wrap\s*:\s*anywhere/.test(distanceValue)
      && /line-height\s*:\s*1\.35/.test(distanceValue)
      && /font-size\s*:\s*11px/.test(narrowDistanceValue)
      && /min-width\s*:\s*0/.test(distanceSpl) && /flex\s*:\s*0\s+0\s+auto/.test(distanceSpl)
      && /font-size\s*:\s*14px/.test(distanceSpl) && /white-space\s*:\s*nowrap/.test(distanceSpl)
      && /font-size\s*:\s*14px/.test(narrowDistanceSpl)
      && /flex-wrap\s*:\s*nowrap/.test(distanceResult)
      && /flex\s*:\s*none/.test(distanceCurrent)
      && !styles.includes('distance-row-last') && !styles.includes('.distance-grid'),
    'SPL distance comparison must keep a natural-height list, wrap-safe complete labels, aligned row contents, and fixed readable single-line SPL text')
    assert(styles.includes('animation:spl-sheet-slide-in 320ms cubic-bezier(.2,.72,.25,1) both')
      && styles.includes('animation:spl-sheet-slide-out 320ms ease-in both;pointer-events:none')
      && styles.includes('@keyframes spl-sheet-slide-in{from{transform:translateY(calc(100% + env(safe-area-inset-bottom)))}to{transform:translateY(0)}}')
      && styles.includes('@keyframes spl-sheet-slide-out{from{transform:translateY(0)}to{transform:translateY(calc(100% + env(safe-area-inset-bottom)))}}'),
    'SPL sheets must use full-height bottom slide transitions with the 320ms close lifecycle')
    assert(!/@keyframes\s+spl-sheet-slide-(?:in|out)[^{]*\{[^}]*opacity\s*:/.test(styles)
      && /@media\(prefers-reduced-motion:reduce\)\{[^}]*\.spl-sheet[^}]*animation-duration:\.01ms!important/.test(styles),
    'SPL sheet transitions remain translate-only and honor reduced-motion preferences')
    assert(report.includes('REPORT_WIDTH = 750')
      && report.includes('const SIDE_MARGIN = 44')
      && report.includes('const CARD_PADDING = 28')
      && report.includes('const CARD_WIDTH = REPORT_WIDTH - (SIDE_MARGIN * 2)'),
    'SPL local report must use the 750px cable-report side margin and card padding')
    const approvedSplHash = baseline.approvedSplRefactorExpandedWxmlSha256
    assert.match(approvedSplHash || '', /^[0-9a-f]{64}$/, 'missing approved SPL refactor WXML hash')
    const splMarkupWithoutPickerClasses = withoutSplDevicePickerClasses(hashInput)
    const splMarkupWithoutAnimationTokens = withoutSplSelectorAnimationClasses(splMarkupWithoutPickerClasses)
    const splMarkupWithoutClosePresentation = withoutPanelClosePresentation(splMarkupWithoutAnimationTokens, relativePath)
    const splMarkupWithoutCompactSelection = withoutApprovedCompactProjectSelection(splMarkupWithoutClosePresentation, relativePath)
    const splMarkupWithoutSharedRoles = withoutResultPanelRoles(splMarkupWithoutCompactSelection, relativePath)
    const splMarkupWithoutScrollablePreviewChange = normalizeSplScrollablePreviewForHistoricalHash(splMarkupWithoutSharedRoles)
    const splMarkupWithoutProjectNoteFixed = withoutApprovedProjectNoteFixed(splMarkupWithoutScrollablePreviewChange, relativePath)
    const splMarkupWithoutResultImageCopy = withoutApprovedResultImageCopy(splMarkupWithoutProjectNoteFixed, relativePath)
    const splMarkupWithoutDetailsReturnChanges = withoutApprovedProjectDetailsReturnChanges(splMarkupWithoutResultImageCopy, relativePath)
    assert.equal(sha256(Buffer.from(splMarkupWithoutDetailsReturnChanges)), approvedSplHash,
      'expanded SPL WXML changed beyond the approved picker scope, selector animation, and close presentation updates')
    continue
  }
  if (relativePath === 'pages/gain-structure/gain-structure.wxml') {
    const overlay = read('pages/gain-structure/gain-overlays.wxml')
    const pageController = read('pages/gain-structure/gain-structure.js')
    const projectController = read('pages/gain-structure/gain-project.js')
    assert(pageController.includes("require('./gain-project')")
      && pageController.includes('...gainProjectMethods'),
    'gain page must compose its project controller methods')
    const controller = `${pageController}\n${projectController}`
    const styles = read('pages/gain-structure/gain-structure.wxss')
    const hasWxmlClass = (className) => [...source.matchAll(/class="([^"]*)"/g)]
      .some((match) => match[1].split(/\s+/).includes(className))
    assert(source.indexOf('class="result-pane"') < source.indexOf('class="input-pane"'),
      'gain output must precede its independent input pane')
    assert(source.includes('<page-container') && source.includes('onPageContainerBeforeLeave')
      && source.includes('onPageContainerAfterLeave') && source.includes('class="sheet-mask {{'),
    'gain overlays must support native back lifecycle and a fallback mask')
    assert(source.includes('<include src="./gain-overlays.wxml" />'),
      'gain page must use its local overlay contract')
    assert(source.includes('class="result-report-canvas-offscreen"')
      && source.includes('canvas-id="resultReportCanvas"'),
    'gain page must keep its local report canvas')
    assert(!source.includes('bindtap="calculate"')
      && !source.includes('calculate-button')
      && !source.includes('重新计算')
      && !source.includes('再计算'),
    'gain page must update complete inputs automatically without a manual calculate CTA')
    assert((source.match(/bindtap="requestReset"|bindtap="openSharePreview"|bindtap="toggleCurrentFavorite"|bindtap="openProjectSheet"/g) || []).length === 4,
      'gain result rail must expose reset, share, favorite, and project actions')
    assert(source.includes('disabled="{{!canReset}}"')
      && source.includes('disabled="{{!hasValidResult}}"'),
    'gain actions must expose their explicit disabled states')
    assert(hasWxmlClass('placement-warning')
      && source.includes('result.placementWarning')
      && hasWxmlClass('amplifier-setting')
      && source.includes('功放输入控制保持 0 dB'),
    'gain result must show output placement and fixed amplifier setting')
    assert(source.includes('calculationState === \'incomplete\'')
      && source.includes('输入完整后结果会自动更新'),
    'gain page must clear stale results and explain when dependencies are incomplete')
    assert(source.includes("result.alignmentMode === 'insufficientDrive'")
      && source.includes('result.primaryValue'),
    'gain result must distinguish insufficient drive in its primary output')
    assert(source.includes("activeGroup === 'load'") && source.includes('wx:if="{{showPowerContext}}"'),
      'gain load controls must be conditional on voltage-gain models')
    assert((source.match(/<view wx:if="\{\{loadReminderActive\}\}"/g) || []).length === 2,
      'gain load reminder must remain visible in both result and input context')
    assert(overlay.includes('bindtap="shareResultReportImage"')
      && overlay.includes('bindtap="saveResultReportImage"')
      && overlay.includes('bindtap="retryResultReport"')
      && overlay.includes('isCheckingResultReportCache'),
    'gain local preview must include send/save, loading, retry, and error handling')
    assert(!overlay.includes('result-report-preview.wxml')
      && !source.includes('../..\/templates\/result-report-preview.wxml'),
    'gain must not duplicate the shared preview overlay')
    const projectConfigElement = (field) => {
      const marker = 'data-project-field="' + field + '"'
      const markerIndex = overlay.indexOf(marker)
      if (markerIndex < 0) return ''
      const start = overlay.lastIndexOf('<', markerIndex)
      const end = overlay.indexOf('>', markerIndex)
      return start < 0 || end < 0 ? '' : overlay.slice(start, end + 1)
    }
    const projectConfigNameElement = projectConfigElement('projectConfigName')
    const projectConfigNoteElement = projectConfigElement('projectConfigNote')
    assert(/wx:(?:if|elif)="\{\{projectStep === 'details'\}\}"/.test(overlay)
      && overlay.includes('bindtap="saveProjectConfiguration"')
      && overlay.includes('bindtap="createProjectFromForm"')
      && overlay.includes('class="project-target-name"')
      && overlay.includes('bindinput="onProjectSearch"')
      && projectConfigNameElement.includes('value="{{projectConfigName}}"')
      && projectConfigNameElement.includes('maxlength="60"')
      && projectConfigNameElement.includes('bindinput="onProjectConfigNameInput"')
      && projectConfigNoteElement.includes('value="{{projectConfigNote}}"')
      && projectConfigNoteElement.includes('maxlength="200"')
      && projectConfigNoteElement.includes('bindinput="onProjectConfigNoteInput"')
      && controller.includes('onProjectConfigNameInput')
      && controller.includes('onProjectConfigNoteInput'),
    'gain project sheet must select/search/create and bind each configuration field to its value, limit, and handler')

    const projectSaveCall = controller.match(/addRecordToProject\(\s*frozen\.payload\s*,\s*(?:target\.id|targetId)\s*,\s*\{([^}]*)\}\s*\)/)
    const metadataArgument = projectSaveCall?.[1] || ''
    assert(projectSaveCall
      && /\bname\s*:\s*configName\b/.test(metadataArgument)
      && /\bnote\s*:\s*configNote\b/.test(metadataArgument),
    'gain project writes must pass an inline metadata object with the explicit name and note fields')
    assert(controller.includes('function getInputReadiness(state)')
      && controller.includes('derivePageResult(pageState, hasDraftInputs)')
      && controller.includes('this._inputRevision === inputRevision'),
    'gain controller must derive complete inputs and reject callbacks from an older input revision')

    const actionButtonRule = styles.match(/\.action-button\.action-button\s*\{([^}]*)\}/)
    const actionButtonProperties = {}
    if (actionButtonRule) {
      actionButtonRule[1].split(';').forEach((declaration) => {
        const colon = declaration.indexOf(':')
        if (colon >= 0) {
          actionButtonProperties[declaration.slice(0, colon).trim()] = declaration.slice(colon + 1).trim()
        }
      })
    }
    assert(styles.includes('.result-pane{position:relative;')
      && styles.includes('.editor-scroll{')
      && styles.includes('.category-chip{display:flex;box-sizing:border-box;min-width:44px;')
      && actionButtonProperties['box-sizing'] === 'border-box'
      && actionButtonProperties.display === 'flex'
      && actionButtonProperties['align-items'] === 'center'
      && actionButtonProperties['justify-content'] === 'center'
      && ['width', 'min-width', 'max-width', 'height', 'min-height', 'max-height']
        .every((property) => actionButtonProperties[property] === '44px'),
    'gain result and input layout must keep their sizing, while action buttons stay centered in a 44px box')
    continue
  }
  if (dmxLayoutPages.has(relativePath)) {
    // This refinement keeps the real 2D nodes and overlay lifecycle, while
    // showing the user's single diagram export. Preserve all earlier hash maps.
    // Repair7 keeps its current portrait snapshot separate from historical maps.
    const approvedHash = repair7CurrentContract.approvedExpandedWxmlSha256?.[relativePath]
      || baseline.approvedDmxPlacementHeaderExpandedWxmlSha256?.[relativePath]
    assert.match(approvedHash || '', /^[0-9a-f]{64}$/, `missing approved lighting refactor hash: ${relativePath}`)
    assert(hashInput.includes('id="dmxLayoutCanvasShell"')
      && /<canvas\b[^>]*type="2d"[^>]*id="dmxLayoutCanvas"/.test(hashInput)
      && ['onCanvasTouchStart', 'onCanvasTouchMove', 'onCanvasTouchEnd', 'onCanvasTouchCancel']
        .every((handler) => hashInput.includes(`="${handler}"`)),
    `lighting canvas needs its real coordinate anchor and touch lifecycle: ${relativePath}`)
    const stageCanvas = hashInput.match(/<canvas\b[^>]*id="dmxLayoutCanvas"[^>]*>/)?.[0] || ''
    assert(['layoutPanelVisible', 'locateVisible', 'placementVisible', 'previewVisible', 'isGeneratingImage', 'exportCanvasActive']
      .every((flag) => stageCanvas.includes(`!${flag}`)) && stageCanvas.includes('wx:if='),
    `lighting overlays must unmount the native stage surface: ${relativePath}`)
    const exportCanvas = hashInput.match(/<canvas\b[^>]*id="dmxLayoutExportCanvas"[^>]*>/)?.[0] || ''
    const pageFactory = read('pages/dmx-layout/page-factory.js')
    const exportController = read('pages/dmx-layout/layout-export-controller.js')
    assert(pageFactory.includes("require('./layout-export-controller')")
      && pageFactory.includes('createLayoutExportMethods({')
      && pageFactory.includes('...layoutExportMethods'),
    'lighting page must create and compose the layout export controller')
    const canvasController = `${pageFactory}\n${exportController}`
    assert(exportCanvas.includes('type="2d"')
      && exportCanvas.includes('style="width:1px;height:1px;"')
      && canvasController.includes('configureCanvas2DNode(node, page.width, page.height, 1)')
      && /canvasToTempFilePath\(\{\s*canvas:\s*node,/.test(canvasController),
    `lighting export needs a non-occluding 2D node with independent backing dimensions: ${relativePath}`)
    assert(/<scroll-view\b[^>]*class="placement-preview-strip"[^>]*scroll-x\b[^>]*bindscroll="onPreviewScroll"/.test(hashInput)
      && /<scroll-view\b[^>]*class="placement-body"[^>]*scroll-y\b[^>]*scroll-into-view="\{\{placementScrollIntoView\}\}"/.test(hashInput)
      && /<view\b[^>]*id="placement-list-anchor" class="fixture-selection-list"/.test(hashInput)
      && hashInput.includes('class="overview-viewport"')
      && hashInput.includes('bindtap="onPanelFixtureTap"'),
    `lighting placement must keep its independent horizontal/vertical scroll and live chips: ${relativePath}`)
    assert(['layoutDraft.stageWidthText', 'layoutDraft.stageDepthText', 'layoutDraft.internalRods', 'layoutDraft.frontRods',
      'onDraftDirectionTap', 'onDraftDistanceInput', 'changeDraftRodCount', 'applyLayoutSettings', 'confirmLayoutReduction']
      .every((binding) => hashInput.includes(binding)),
    `lighting stage and front rods must remain editable with one confirmed apply: ${relativePath}`)
    assert(/<picker\b[^>]*mode="selector"[^>]*range="\{\{lightingContexts\}\}"/.test(hashInput)
      && hashInput.includes('class="context-row"')
      && hashInput.includes('class="context-share')
      && !hashInput.includes('bindtap="openLocatePanel"')
      && !hashInput.includes('class="locate-overlay')
      && !hashInput.includes('bindtap="openLandscapeLayout"')
      && !hashInput.includes('layout-orientation-button')
      && hashInput.includes('placementTargetSummary')
      && ['generateLayoutImage', 'previewImage', 'shareImage', 'saveImage']
        .every((handler) => hashInput.includes(`="${handler}"`)),
    `lighting context/share row, diagram export, preview and save stay reachable, with locator removed: ${relativePath}`)
    assert(!hashInput.includes('export-page-nav') && !hashInput.includes('saveAllImages')
      && /<scroll-view\b[^>]*class="export-image-scroll result-scroll"[^>]*scroll-y/.test(hashInput),
    `single lighting diagram must not expose obsolete report pagination or save-all controls: ${relativePath}`)
    if (relativePath === 'pages/dmx-layout/dmx-layout.wxml') {
      const placementController = read('pages/dmx-layout/layout-interactions.js')
      assert(!hashInput.includes('bindtap="openPlacementPanel"')
        && hashInput.includes('class="canvas-tap-tip">点击舞台或灯杆进行操作</view>')
        && !hashInput.includes('class="placement-target-row"')
        && !hashInput.includes('bindtap="togglePlacementPreview"')
        && hashInput.includes('class="placement-preview-top"')
        && hashInput.includes('bindtap="onPreviewFixtureTap"')
        && hashInput.includes('bindtap="openPlacementActions"')
        && hashInput.includes('bindtap="togglePlacementSearch"'),
      'placement enters from the canvas and provides a top preview, search, and organized actions without picker/toggle controls')
      assert(hashInput.includes('class="placement-gesture-hint">单击放置或撤出当前目标；双击只切换地址勾</view>')
        && !hashInput.includes('placement-notice')
        && hashInput.includes('class="fixture-chip-address-checked" aria-hidden="true">✓</view>')
        && !hashInput.includes('class="fixture-chip-check"')
        && !hashInput.includes('bindtap="unplaceSelectedFixture"')
        && !hashInput.includes('placement-unplace-action'),
      'placement guidance separates single-tap placement/withdrawal from the address-only double tap without a separate unplace action')
      assert(placementController.includes('showCrossTargetFeedback(wx, fixture, from)')
        && placementController.includes("const title = '到' + from + '撤出'")
        && placementController.includes("showPlacementModal(wx, fixture.addressText + ' 已在' + from + '，位置保持不变。请到' + from + '单击撤出。')")
        && placementController.includes("if (!saved) wx.showToast({ title: '撤出未保存', icon: 'none' })")
        && !placementController.includes('placementNotice'),
      'cross-target source and failed withdrawal feedback remain visible without a shifting inline row')
      assert(placementController.includes('wx.showActionSheet({')
        && placementController.includes("title: '按地址排序'")
        && placementController.includes("title: '清空当前灯杆'")
        && placementController.includes("title: '清空全图'")
        && placementController.includes('this.clearLayoutPositions(targetRodId)')
        && placementController.includes("this.clearLayoutPositions('')")
        && placementController.includes('this.sortSelectedRodByAddress()'),
      'placement actions keep sorting and both confirmed clear scopes separate, with no blank-rod clear')
      const previewClose = '<button class="sheet-close panel-close-control" aria-label="关闭灯位图预览" bindtap="closePreview"><view class="panel-close-icon" aria-hidden="true"></view></button>'
      assert.equal(hashInput.split(previewClose).length - 1, 1,
        '灯位图 preview close keeps its accessible label and CSS-drawn close icon')
      assert(hashInput.includes('<button class="sheet-close" bindtap="closeLayoutSettings">取消</button>'),
        'layout settings Cancel remains a separate unchanged action')
      assert(hashInput.includes('scroll-into-view="{{layoutErrorScrollIntoView}}"')
        && hashInput.includes('id="rod-error-{{item.id}}" class="rod-inline-error"')
        && hashInput.includes('layoutValidationErrorsById[item.id]'),
      'repair7 layout markup must bind per-rod errors and the first-error scroll target')
      assert(hashInput.includes('class="fixture-chip-selected-marker">选</view>')
        && hashInput.includes("fixture.placed ? 'fixture-chip-placed'")
        && hashInput.includes("fixture.checked}}")
        && hashInput.includes('class="fixture-chip-origin">{{fixture.shortRodName}}</text>'),
      'layout markup must distinguish selection, solid placement color, separate address marks, and other-target source text')
    }
    let placementPriorityNormalizedHashInput = hashInput
    if (relativePath === 'pages/dmx-layout/dmx-layout.wxml') {
      const priorityOpening = '<view wx:for="{{placementGroups}}" wx:key="renderId" class="fixture-group">\n            <view wx:if="{{item.showPriorityDivider}}" class="fixture-priority-divider"></view>\n'
      const approvedOpening = '<view wx:for="{{placementGroups}}" wx:key="id" class="fixture-group">\n'
      assert.equal(placementPriorityNormalizedHashInput.split(priorityOpening).length - 1, 1,
        'placement priority must add the unique render key and divider exactly once')
      placementPriorityNormalizedHashInput = placementPriorityNormalizedHashInput.replace(priorityOpening, approvedOpening)
    }
    const closeNormalizedHashInput = withoutPanelClosePresentation(placementPriorityNormalizedHashInput, relativePath)
    const sharedRolesNormalizedHashInput = withoutResultPanelRoles(closeNormalizedHashInput, relativePath)
    const exportHeightNormalizedHashInput = relativePath === 'pages/dmx-layout/dmx-layout.wxml'
      ? withoutDmxLayoutExportScrollHeight(sharedRolesNormalizedHashInput)
      : sharedRolesNormalizedHashInput
    const dockedInsetsNormalizedHashInput = relativePath === 'pages/dmx-layout/dmx-layout.wxml'
      ? withoutDmxLayoutDockedInsets(exportHeightNormalizedHashInput)
      : exportHeightNormalizedHashInput
    const equivalentHashInput = withoutApprovedResultImageCopy(dockedInsetsNormalizedHashInput, relativePath)
    assert.equal(sha256(Buffer.from(equivalentHashInput)), approvedHash, `approved lighting markup changed: ${relativePath}`)
    continue
  }
  const closeNormalizedHashInput = withoutPanelClosePresentation(hashInput, relativePath)
  const compactSelectionNormalizedHashInput = withoutApprovedCompactProjectSelection(closeNormalizedHashInput, relativePath)
  const sharedRolesNormalizedHashInput = withoutResultPanelRoles(compactSelectionNormalizedHashInput, relativePath)
  const projectNoteFixedNormalized = withoutApprovedProjectNoteFixed(sharedRolesNormalizedHashInput, relativePath)
  const resultImageCopyNormalized = withoutApprovedResultImageCopy(projectNoteFixedNormalized, relativePath)
  const detailsReturnNormalized = withoutApprovedProjectDetailsReturnChanges(resultImageCopyNormalized, relativePath)
  assert.equal(sha256(Buffer.from(detailsReturnNormalized)), expectedHash, `expanded WXML changed: ${relativePath}`)
}

const ledScreenWxml = 'pages/led-screen/led-screen.wxml'
withoutResultAreaStyles(normalizeLineEndings(expandIncludes(
  withoutHomepageEditorSurfaces(read(ledScreenWxml)), path.join(root, ledScreenWxml),
)), ledScreenWxml)

assert.match(read('pages/common/operation-confirmation.wxml'), /confirmOperationField/,
  'shared operation confirmation template has no real confirm action')
assert.match(read('pages/common/operation-confirmation.wxml'), /!operationActive/,
  'shared operation confirmation template hides an invalidated operation')
assert.match(read('pages/common/operation-confirmation.wxml'), /endOperation/,
  'shared operation confirmation template has no explicit end action')
assert.match(read('pages/common/operation-confirmation.wxml'), /item\.confirmed/,
  'shared operation confirmation template must show confirmation state accurately')

const keptImagePath = path.join(root, 'assets/home/module-audio-wiring-catalog.png')
assert.equal(sha256(fs.readFileSync(keptImagePath)), baseline.xlrImageSha256, 'kept XLR image bytes changed')
assert(!fs.existsSync(path.join(root, 'pages/audio-wiring/assets/xlr.png')), 'duplicate XLR image still exists')
const wiringModel = read('pages/audio-wiring/wiring-model.js')
assert.equal((wiringModel.match(/image: '\/assets\/home\/module-audio-wiring-catalog\.png'/g) || []).length, 2,
  'XLR input/output options must both use the retained production asset')
assert(!wiringModel.includes('/pages/audio-wiring/assets/xlr.png'), 'wiring model still references the removed duplicate')

console.log('Package reclaim UI/resource equivalence passed (expanded WXML hashes and XLR asset identity).')
