'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createRuntime } = require('./dmx-ui-refactor-2026-10-18/controller-runtime.cjs')

const root = path.resolve(__dirname, '..')
const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'))
const pageJson = JSON.parse(fs.readFileSync(path.join(root, 'pages/dmx-layout/dmx-layout.json'), 'utf8'))
const pageWxml = fs.readFileSync(path.join(root, 'pages/dmx-layout/dmx-layout.wxml'), 'utf8')
const pageWxss = fs.readFileSync(path.join(root, 'pages/dmx-layout/dmx-layout.wxss'), 'utf8')
const pageSource = pageWxml + '\n' + pageWxss

// Fixed migration matrix: source identities come from the frozen release-check
// leaf groups. Current selectors are hand-mapped here; they are never generated
// from the stylesheet under test.
const styleLeaves = [
  { family: 'dark20', id: 'page-background', old: 'page background', status: 'current-related', selectors: ['.layout-page.dark-mode'] },
  { family: 'dark20', id: 'selected-status', old: 'selected verification status', status: 'retired-legacy-surface', selectors: [] },
  { family: 'dark20', id: 'selected-status-done', old: 'completed verification status', status: 'retired-legacy-surface', selectors: [] },
  { family: 'dark20', id: 'batch-field-label', old: 'batch field label', status: 'retired-batch-surface', selectors: [] },
  { family: 'dark20', id: 'batch-clear-button', old: 'batch clear action', status: 'retired-batch-surface', selectors: [] },
  { family: 'dark20', id: 'address-button', old: 'address edit button', status: 'retired-legacy-surface', selectors: [] },
  { family: 'dark20', id: 'apply-bar-button', old: 'per-bar apply action', status: 'no-direct-action', selectors: [] },
  { family: 'dark20', id: 'report-preview-subtitle', old: 'legacy report preview subtitle', status: 'current-related', selectors: ['.export-subtitle'] },
  { family: 'dark20', id: 'number-input', old: 'legacy number input', status: 'current-related', selectors: ['.dimension-input-wrap input', '.rod-distance-input input'] },
  { family: 'dark20', id: 'bar-count-input', old: 'per-bar count input', status: 'no-direct-action', selectors: [] },
  { family: 'dark20', id: 'bar-config-row-title', old: 'bar configuration row title', status: 'current-related', selectors: ['.rod-editor-row'] },
  { family: 'dark20', id: 'bar-group-name', old: 'bar group name', status: 'current-related', selectors: ['.fixture-group-name'] },
  { family: 'dark20', id: 'selected-address', old: 'selected address', status: 'current-related', selectors: ['.fixture-address-selected'] },
  { family: 'dark20', id: 'selected-group', old: 'selected group', status: 'no-direct-action', selectors: [] },
  { family: 'dark20', id: 'selected-meta', old: 'selected group metadata', status: 'current-related', selectors: ['.fixture-group-meta'] },
  { family: 'dark20', id: 'palette-group-chip', old: 'palette group chip', status: 'current-related', selectors: ['.fixture-group-heading'] },
  { family: 'dark20', id: 'palette-fixture-chip', old: 'palette fixture chip', status: 'current-related', selectors: ['.fixture-address-chip'] },
  { family: 'dark20', id: 'fixture-palette-count', old: 'palette fixture count', status: 'current-related', selectors: ['.fixture-group-meta'] },
  { family: 'dark20', id: 'bar-config-status-error', old: 'bar configuration error color', status: 'current-related', selectors: ['.rod-inline-error'] },
  { family: 'dark20', id: 'disabled-generate', old: 'disabled generate action', status: 'current-related', selectors: ['.context-share-disabled'] },

  { family: 'active6', id: 'portrait-group-active-border', old: 'portrait active palette group border', status: 'no-direct-group-active', selectors: ['.fixture-address-selected'] },
  { family: 'active6', id: 'portrait-group-active-background', old: 'portrait active palette group background', status: 'no-direct-group-active', selectors: ['.fixture-chip-placed'] },
  { family: 'active6', id: 'portrait-group-active-color', old: 'portrait active palette group text color', status: 'no-direct-group-active', selectors: ['.fixture-chip-address'] },
  { family: 'active6', id: 'landscape-group-active-border', old: 'landscape active palette group border', status: 'retired-landscape-route', selectors: [] },
  { family: 'active6', id: 'landscape-group-active-background', old: 'landscape active palette group background', status: 'retired-landscape-route', selectors: [] },
  { family: 'active6', id: 'landscape-group-active-color', old: 'landscape active palette group text color', status: 'retired-landscape-route', selectors: [] },

  { family: 'landscape7', id: 'palette-group', old: 'landscape palette group', status: 'retired-landscape-route', selectors: ['.fixture-group-heading'] },
  { family: 'landscape7', id: 'palette-fixture', old: 'landscape palette fixture', status: 'retired-landscape-route', selectors: ['.fixture-address-chip'] },
  { family: 'landscape7', id: 'palette-count', old: 'landscape palette count', status: 'retired-landscape-route', selectors: ['.fixture-group-meta'] },
  { family: 'landscape7', id: 'selected-name', old: 'landscape selected group name', status: 'retired-landscape-route', selectors: ['.fixture-address-selected'] },
  { family: 'landscape7', id: 'landscape-selected-meta', old: 'landscape selected group metadata', status: 'retired-landscape-route', selectors: ['.fixture-group-meta'] },
  { family: 'landscape7', id: 'batch-subtitle', old: 'landscape batch subtitle', status: 'retired-landscape-route', selectors: [] },
  { family: 'landscape7', id: 'batch-preview', old: 'landscape batch preview', status: 'retired-landscape-route', selectors: [] },

  { family: 'compact1', id: 'compact-field-min-width', old: 'compact field min-width', status: 'current-direct', selectors: ['.dimension-field{min-width:0;flex:1'] },
]

function assertIncludes(source, needle, message) {
  assert(source.includes(needle), message + ': ' + needle)
}

function normalizeCssWhitespace(value) {
  // Normalize formatting only; this is not a CSS parser or a color/value coercion.
  return String(value).trim().replace(/\s+/g, ' ').replace(/\s*([(),])\s*/g, '$1')
}

function cssRules(source) {
  const rows = []
  const rulePattern = /([^{}]+)\{([^{}]*)\}/g
  let match
  while ((match = rulePattern.exec(source))) {
    const selectors = match[1].split(',').map(normalizeCssWhitespace)
    const declarations = new Map()
    for (const rawDeclaration of match[2].split(';')) {
      const colon = rawDeclaration.indexOf(':')
      if (colon <= 0) continue
      declarations.set(
        normalizeCssWhitespace(rawDeclaration.slice(0, colon)),
        normalizeCssWhitespace(rawDeclaration.slice(colon + 1))
      )
    }
    rows.push({ selectors, declarations })
  }
  return rows
}

const pageCssRules = cssRules(pageWxss)
function finalCssValue(selector, property) {
  let result
  const normalizedSelector = normalizeCssWhitespace(selector)
  const normalizedProperty = normalizeCssWhitespace(property)
  for (const rule of pageCssRules) {
    if (rule.selectors.includes(normalizedSelector) && rule.declarations.has(normalizedProperty)) result = rule.declarations.get(normalizedProperty)
  }
  return result
}
function assertFinalCss(selector, property, expected, message) {
  assert.equal(
    normalizeCssWhitespace(finalCssValue(selector, property)),
    normalizeCssWhitespace(expected),
    message + ' (' + selector + ' ' + property + ')'
  )
}
function resolveDarkToken(value) {
  const token = /^var\((--[a-z-]+)/.exec(value || '')
  return token ? finalCssValue('.layout-page.dark-mode', token[1]) : value
}

function verifyStyleMatrix() {
  const expectedCounts = { dark20: 20, active6: 6, landscape7: 7, compact1: 1 }
  const registeredPages = [
    ...app.pages,
    ...(app.subpackages || []).flatMap((subpackage) => (subpackage.pages || []).map((page) => subpackage.root + '/' + page)),
  ]
  assert(registeredPages.includes('pages/dmx-layout/dmx-layout'), 'The current DMX layout page remains registered')
  assert(!registeredPages.includes('pages/dmx-layout-landscape/dmx-layout-landscape'), 'The retired landscape page is not registered')
  assert.equal(pageJson.pageOrientation, 'portrait', 'The registered DMX layout page keeps its approved portrait orientation')
  const dispositions = {
    'page-background': 'semantic-tested',
    'selected-status': 'approved-retired',
    'selected-status-done': 'approved-retired',
    'batch-field-label': 'approved-retired',
    'batch-clear-button': 'approved-retired',
    'address-button': 'semantic-tested',
    'apply-bar-button': 'approved-retired',
    'report-preview-subtitle': 'semantic-tested',
    'number-input': 'semantic-tested',
    'bar-count-input': 'approved-retired',
    'bar-config-row-title': 'semantic-tested',
    'bar-group-name': 'semantic-tested',
    'selected-address': 'semantic-tested',
    'selected-group': 'approved-retired',
    'selected-meta': 'semantic-tested',
    'landscape-selected-meta': 'approved-retired',
    'palette-group-chip': 'approved-retired',
    'palette-fixture-chip': 'semantic-tested',
    'fixture-palette-count': 'semantic-tested',
    'bar-config-status-error': 'semantic-tested',
    'disabled-generate': 'semantic-tested',
    'portrait-group-active-border': 'approved-retired',
    'portrait-group-active-background': 'approved-retired',
    'portrait-group-active-color': 'approved-retired',
    'landscape-group-active-border': 'approved-retired',
    'landscape-group-active-background': 'approved-retired',
    'landscape-group-active-color': 'approved-retired',
    'palette-group': 'approved-retired',
    'palette-fixture': 'approved-retired',
    'palette-count': 'approved-retired',
    'selected-name': 'approved-retired',
    'batch-subtitle': 'approved-retired',
    'batch-preview': 'approved-retired',
    'compact-field-min-width': 'semantic-tested',
  }
  assert.equal(styleLeaves.length, 34, 'The fixed legacy style inventory must retain all 34 source identities')
  assert.equal(new Set(styleLeaves.map((row) => row.id)).size, styleLeaves.length, 'Legacy style inventory IDs must be unique')
  for (const [family, count] of Object.entries(expectedCounts)) {
    assert.equal(styleLeaves.filter((row) => row.family === family).length, count, family + ' leaf count changed')
  }
  for (const row of styleLeaves) {
    assert(row.id && row.old, 'Every legacy leaf needs a fixed source identity and purpose')
    assert(['semantic-tested', 'approved-retired', 'no-direct-map-BLOCKED'].includes(dispositions[row.id]), 'Every leaf needs an explicit disposition: ' + row.id)
  }

  // Assertions are tied to exact selectors/properties and approved current semantics;
  // this is intentionally not a browser cascade engine or a claim that all old leaves map.
  assertFinalCss('.layout-page.dark-mode', 'background', '#000', 'Dark page background')
  assertFinalCss('.layout-page.dark-mode', 'color', '#fff', 'Dark page foreground')
  assertFinalCss('.layout-page.dark-mode', '--theme-surface', '#1c1c1e', 'Dark surface token')
  assertFinalCss('.layout-page.dark-mode', '--theme-control', '#2c2c2e', 'Dark control token')
  assertFinalCss('.layout-page.dark-mode', '--theme-text', '#fff', 'Dark primary text token')
  assertFinalCss('.layout-page.dark-mode', '--theme-text-secondary', '#c7c7cc', 'Dark secondary text token')

  assertFinalCss('.export-subtitle', 'color', 'var(--theme-text-secondary,#6e6e73)', 'Export subtitle text is secondary')
  assert.equal(finalCssValue('.export-subtitle', 'background'), undefined, 'Export subtitle has no opaque background; its own box remains transparent')
  assertIncludes(pageWxml, '<view class="export-subtitle">{{contextLabel}}</view>', 'Export subtitle shows the current workspace label')

  for (const selector of ['.dimension-input-wrap input', '.rod-distance-input input']) {
    assertFinalCss(selector, 'color', 'var(--theme-text,#1d1d1f)', 'Numeric inputs use the current text token')
    assertFinalCss(selector, 'min-width', '0', 'Numeric inputs may shrink within their control')
    assertFinalCss(selector, 'flex', '1', 'Numeric inputs use the remaining control width')
  }
  assertFinalCss('.dark-mode .dimension-input-wrap', 'background', 'transparent', 'Dark stage-dimension wrapper uses its final transparent override')
  assertFinalCss('.dark-mode .rod-distance-input', 'background', 'transparent', 'Dark rod-distance wrapper uses its final transparent override')
  assert.equal(resolveDarkToken(finalCssValue('.dimension-input-wrap input', 'color')), '#fff', 'Dark input text resolves to white')
  assertIncludes(pageWxml, '<input type="digit"', 'Current settings retain editable numeric inputs')

  assertFinalCss('.rod-editor-label', 'color', 'var(--theme-text-secondary,#5f5f64)', 'Rod row label has readable secondary text')
  assertFinalCss('.rod-distance-caption', 'color', 'var(--theme-text-secondary,#6e6e73)', 'Rod row caption has readable secondary text')
  assert(/class="rod-editor-row"[\s\S]*?class="rod-editor-label"/.test(pageWxml)
    && /class="rod-editor-row"[\s\S]*?class="rod-distance-caption"/.test(pageWxml),
  'The styled rod row contains actual label and caption text nodes')
  assertFinalCss('.rod-inline-error', 'color', '#a5231d', 'Rod validation error is visible in light mode')
  assertFinalCss('.layout-page.dark-mode .rod-inline-error', 'color', '#ff8b83', 'Rod validation error remains readable in dark mode')
  assertIncludes(pageWxml, 'layoutValidationErrorsById[item.id]', 'Each rod renders its own validation feedback')
  assertIncludes(pageWxml, 'id="rod-error-{{item.id}}"', 'Invalid rod feedback has a scroll target')
  assertIncludes(pageSource, 'layoutErrorScrollIntoView', 'The validation flow can scroll the first invalid rod into view')

  assertFinalCss('.fixture-group-name', 'color', 'var(--theme-text,#1d1d1f)', 'Fixture group name uses the final primary text declaration')
  assertFinalCss('.fixture-group-meta', 'color', 'var(--theme-text-secondary,#6e6e73)', 'Fixture group metadata uses secondary text')
  assert.equal(resolveDarkToken(finalCssValue('.fixture-group-name', 'color')), '#fff', 'Dark group name resolves to white')
  assert.equal(resolveDarkToken(finalCssValue('.fixture-group-meta', 'color')), '#c7c7cc', 'Dark group metadata resolves to secondary gray')
  assert(/class="fixture-group-heading"[\s\S]*?class="fixture-group-name"[\s\S]*?class="fixture-group-meta"/.test(pageWxml)
    && !/class="fixture-group-heading"[^>]*bindtap=/.test(pageWxml),
  'Fixture group heading is a static label, not a selectable legacy palette group')

  assertFinalCss('.fixture-address-chip', 'background', 'var(--theme-control,#f4f4f6)', 'Fixture address cell uses a control surface')
  assertFinalCss('.fixture-address-chip', 'border', '1px solid var(--theme-divider,#dbdbe0)', 'Fixture address cell has a divider border')
  assertFinalCss('.fixture-chip-address', 'text-overflow', 'ellipsis', 'Address text remains bounded inside each cell')
  assertFinalCss('.fixture-chip-placed', 'background', 'var(--fixture-color,#8a2bff)', 'Placed address state uses its fixture color')
  assertFinalCss('.fixture-chip-placed .fixture-chip-address', 'color', '#fff', 'Placed address text stays white for contrast')
  assertFinalCss('.fixture-chip-other-rod', 'background', 'var(--theme-surface,#fff)', 'Other-rod state remains visually distinct')
  assertFinalCss('.fixture-chip-origin', 'color', 'var(--theme-text-tertiary,#86868b)', 'Other-rod origin label uses tertiary text')
  assertFinalCss('.fixture-address-selected', 'box-shadow', '0 0 0 2px rgba(0,122,255,.24)', 'Selected fixture has a distinct focus ring')
  assertIncludes(pageWxml, 'class="fixture-address-chip {{fixture.placedOnSelectedRod ?', 'Address cells bind placed/other-rod state classes')
  assertIncludes(pageWxml, "selectedFixtureId === fixture.id ? 'fixture-address-selected'", 'Address selection styling follows the selected fixture ID')
  assertIncludes(pageWxml, '<text class="fixture-chip-address">{{fixture.addressText}}</text>', 'The address label is the actual visible text child')
  assertIncludes(pageWxml, '{{item.channelCount}} CH · {{item.fixtures.length}} 台', 'Group metadata includes channel and fixture counts')

  assertFinalCss('.context-share-disabled', 'opacity', '.45', 'Disabled share action is visibly dimmed')
  assertIncludes(pageWxml, "isGeneratingImage ? 'context-share-disabled' : ''", 'Generation state controls the visible disabled treatment')
  assertIncludes(pageWxml, 'bindtap="generateLayoutImage"', 'The share action retains its actual handler')
  assertFinalCss('.dimension-field', 'min-width', '0', 'Compact dimension field may shrink')
  assertFinalCss('.dimension-field', 'flex', '1', 'Compact dimension field shares available width')

  const counts = Object.values(dispositions).reduce((result, status) => (result[status] = (result[status] || 0) + 1, result), {})
  assert.equal(counts['semantic-tested'], 13)
  assert.equal(counts['approved-retired'], 21)
  assert.equal(counts['no-direct-map-BLOCKED'] || 0, 0)
  console.log('PASS 13 current semantic style leaves; 21 approved-retired; 0 unresolved mappings (34 old leaves inventoried, not 34 semantic passes)')
}

function verifyOverlayMarkup() {
  const stageCanvasCondition = 'wx:if="{{!layoutPanelVisible && !locateVisible && !placementVisible && !previewVisible && !isGeneratingImage && !exportCanvasActive}}"'
  assertIncludes(pageWxml, stageCanvasCondition, 'Stage canvas must be removed while a blocking panel/export state is active')
  assert(/<canvas[^>]*id="dmxLayoutCanvas"/.test(pageWxml), 'The actual stage canvas element must exist')
  assert(/<view wx:if="\{\{placementVisible\}\}" class="overlay placement-overlay[^"]*"[^>]*bindtap="closePlacementPanel"/.test(pageWxml),
    'Placement overlay must close from its backdrop')
  assert(/<view class="placement-card[^"]*"[^>]*catchtap="stopTap"/.test(pageWxml),
    'Placement card must stop its tap from reaching the backdrop')
  assert(/<view wx:if="\{\{layoutPanelVisible\}\}" class="overlay settings-overlay[^"]*"[^>]*bindtap="closeLayoutSettings"/.test(pageWxml),
    'Settings overlay must close from its backdrop')
  assert(/<view class="settings-card[^"]*"[^>]*catchtap="stopTap"/.test(pageWxml),
    'Settings card must stop its tap from reaching the backdrop')
  assert(/<view wx:if="\{\{reductionConfirm\}\}" class="reduction-overlay[^"]*"/.test(pageWxml),
    'Rod reduction confirmation overlay must remain inside settings')
  assert(/<view class="reduction-card" catchtap="stopTap"/.test(pageWxml),
    'Reduction card must stop its tap')
  assert(/<button class="reduction-cancel" bindtap="cancelLayoutReduction"/.test(pageWxml)
    && /<button class="reduction-confirm" bindtap="confirmLayoutReduction"/.test(pageWxml),
  'Reduction actions must remain reachable')
  assert(/<canvas wx:if="\{\{exportCanvasActive\}\}"[^>]*id="dmxLayoutExportCanvas"/.test(pageWxml),
    'Export canvas must mount only for the generation phase')
  assert(/<view wx:if="\{\{previewVisible\}\}" class="export-overlay/.test(pageWxml),
    'Export preview overlay must be shown after generation')
  assert(/<button class="sheet-close" bindtap="closePreview"/.test(pageWxml),
    'Export preview must keep its explicit close action')
  assertFinalCss('.export-canvas', 'pointer-events', 'none', 'Export canvas must stay noninteractive')
  assertFinalCss('.overlay', 'position', 'fixed', 'Interactive panel backdrops cover the page')
  assertFinalCss('.settings-overlay', 'z-index', '110', 'Settings overlay stacking')
  assertFinalCss('.export-overlay', 'z-index', '130', 'Export overlay stacking')
  assert(!/class="locate-overlay/.test(pageWxml) && !/class="locate-card/.test(pageWxml),
    'Locate state currently blocks canvas but has no visible WXML panel; do not count it as a current overlay')
  console.log('PASS current overlay markup/tap-isolation/stacking contract')
}

function drainFrames(runtime) {
  let passes = 0
  while (runtime.frames.length && passes < 20) {
    runtime.drain(runtime.frames)
    passes += 1
  }
  assert(passes < 20, 'Canvas redraw did not settle')
}

function runOneCloseTimer(action) {
  const originalSetTimeout = global.setTimeout
  const originalClearTimeout = global.clearTimeout
  const queue = []
  let id = 70000
  global.setTimeout = (callback, delay, ...args) => {
    const timer = { id: id++, callback, delay, args, cancelled: false }
    queue.push(timer)
    return timer.id
  }
  global.clearTimeout = (timerId) => {
    const timer = queue.find((item) => item.id === timerId)
    if (timer) timer.cancelled = true
  }
  try {
    action()
    const pending = queue.filter((timer) => !timer.cancelled)
    assert.equal(pending.length, 1, 'Expected one actual sheet close transition timer')
    assert.equal(pending[0].delay, 180, 'Close transition must preserve its existing duration')
    pending[0].callback(...pending[0].args)
  } finally {
    global.setTimeout = originalSetTimeout
    global.clearTimeout = originalClearTimeout
  }
}

function verifyPendingCanvasQueryCannotAttachBehindOverlay() {
  const runtime = createRuntime({ deferSelectors: true })
  runtime.seed()
  const page = runtime.make()
  try {
    assert(runtime.selectors.length > 0, 'Cold entry should have a pending real canvas selector query')
    assert.equal(page._canvasNode, null, 'Deferred query has not mounted a renderer yet')
    page.openLayoutSettings()
    assert.equal(page.data.layoutPanelVisible, true, 'Settings opening activates the actual blocking overlay')
    assert.equal(page._canvasNode, null, 'The stage remains detached before the queued selector resolves')
    const patchesAfterOverlay = page._qaPatches.length
    runtime.drain(runtime.selectors)
    assert.equal(page._canvasNode, null, 'A pre-overlay selector result must not attach a renderer behind the overlay')
    assert.equal(page._canvasAdapter, null, 'A stale selector result must not retain an adapter')
    assert.equal(page._qaPatches.length, patchesAfterOverlay, 'A stale measurement callback must not patch Page state')
    assert.equal(runtime.stats.drawCalls.length, 0, 'No stage drawing may occur behind the overlay')

    runOneCloseTimer(() => page.closeLayoutSettings())
    assert(runtime.selectors.length > 0, 'Closing the overlay requests a fresh stage measurement')
    runtime.drain(runtime.selectors)
    drainFrames(runtime)
    assert(page._canvasNode === runtime.mainCanvas && page._canvasAdapter, 'The fresh post-overlay selector may restore the stage renderer')
    assert(runtime.stats.drawCalls.length > 0, 'The restored renderer draws after overlay close')
    console.log('PASS deferred pre-overlay selector is ignored; fresh post-close selector restores the stage')
  } finally {
    runtime.dispose()
  }
}

function verifyActualPageLifecycleAndMultiFixtureLayout() {
  const runtime = createRuntime()
  runtime.seed()
  const page = runtime.make()
  try {
    drainFrames(runtime)
    assert.equal(page.data.hasPlan, true, 'The actual portrait page should load its synthetic lighting workspace')
    assert(page._canvasNode === runtime.mainCanvas && page._canvasAdapter, 'Actual page should attach and draw the stage canvas on entry')

    const sameModel = page._fixtures.filter((fixture) => fixture.fixtureModel === page._fixtures[0].fixtureModel)
    assert(sameModel.length >= 3, 'Synthetic project must contain multiple fixtures of the same model')
    assert.equal(new Set(sameModel.map((fixture) => fixture.addressText)).size, sameModel.length,
      'Same-model fixtures retain distinct actual DMX addresses')

    page.drawLayout()
    const scheduledId = page._drawFrame
    assert(scheduledId !== null, 'A real page render should queue a canvas frame before opening a blocking sheet')
    const drawsBeforePanel = runtime.stats.drawCalls.length
    page.openLayoutSettings()
    assert.equal(page.data.layoutPanelVisible, true)
    assert.equal(page._canvasNode, null, 'Opening settings should unmount the stage renderer')
    assert.equal(page._canvasAdapter, null, 'Opening settings should discard the current renderer adapter')
    assert(runtime.mainCanvas.cancelledFrames.includes(scheduledId), 'Opening settings should cancel its pending canvas frame')
    const cancelledFrame = runtime.mainCanvas.frameHistory.get(scheduledId)
    assert.equal(cancelledFrame.run(), false, 'A queued frame must not paint after the settings panel opens')
    assert.equal(runtime.stats.drawCalls.length, drawsBeforePanel, 'A cancelled frame must not issue draw commands')

    runOneCloseTimer(() => page.closeLayoutSettings())
    drainFrames(runtime)
    assert.equal(page.data.layoutPanelVisible, false, 'Closing settings should remove the overlay')
    assert(page._canvasNode === runtime.mainCanvas && page._canvasAdapter, 'Closing settings should remount a fresh stage renderer')
    assert(runtime.stats.drawCalls.length > drawsBeforePanel, 'The restored renderer should redraw the same current layout')

    page.openPlacementPanel()
    assert.equal(page.data.placementVisible, true)
    assert.equal(page._canvasNode, null, 'Opening placement should unmount the stage renderer')
    const group = page.data.placementGroups.find((item) => item.fixtureModel === page._fixtures[0].fixtureModel)
    assert(group && group.fixtures.length === sameModel.length, 'The actual placement page should keep every same-model fixture grouped')
    const rodId = page._layout.internalRods[page._layout.internalRods.length - 1].id
    page.onSelectRod(runtime.event({ rodId }))
    for (const fixture of sameModel.slice(0, 3)) {
      page.onPanelFixtureTap(runtime.event({ fixtureId: fixture.stableId }))
    }
    const placed = sameModel.slice(0, 3).map((fixture) => page._layout.positionsById[fixture.stableId])
    assert(placed.every((position) => position && position.rodId === String(rodId)), 'Actual panel taps should place the chosen fixtures on the selected rod')
    assert.equal(new Set(placed.map((position) => position.t)).size, 3, 'Three fixtures of one model must keep distinct stage positions')
    assert.equal(Object.keys(page._layout.positionsById).length, 3, 'Placement should preserve the other fixture addresses without fictitious positions')
    const refreshedGroup = page.data.placementGroups.find((item) => item.fixtureModel === page._fixtures[0].fixtureModel)
    assert(refreshedGroup.fixtures.filter((fixture) => fixture.placedOnSelectedRod).length >= 3,
      'Rendered placement state should report the actual placed fixtures')
    assert.equal(page.data.selectedFixtureId, sameModel[2].stableId, 'The current selection state should follow the last fixture action')

    runOneCloseTimer(() => page.closePlacementPanel())
    drainFrames(runtime)
    assert.equal(page.data.placementVisible, false)
    assert(page._canvasNode === runtime.mainCanvas && page._canvasAdapter, 'Closing placement should restore the stage renderer')

    page.openLayoutSettings()
    page.changeDraftRodCount(runtime.event({ kind: 'internalRods', delta: -1 }))
    page.applyLayoutSettings()
    assert(page.data.reductionConfirm, 'Reducing a rod that holds fixtures should open the nested confirmation')
    assert.equal(page.data.reductionConfirm.fixtures.length, 3, 'The nested confirmation should report all affected fixtures')
    assert.equal(page._canvasNode, null, 'Nested settings confirmation must keep the stage canvas unmounted')
    runOneCloseTimer(() => page.cancelLayoutReduction())
    assert.equal(page.data.reductionConfirm, null, 'Cancel should dismiss the nested confirmation')
    assert.equal(page.data.layoutPanelVisible, true, 'Cancel should return to the parent settings sheet')
    assert.equal(page._canvasNode, null, 'Returning to settings must not remount the stage behind the remaining sheet')
    runOneCloseTimer(() => page.closeLayoutSettings())
    drainFrames(runtime)
    assert(page._canvasNode === runtime.mainCanvas && page._canvasAdapter, 'Closing the parent sheet should restore the stage renderer')

    const pendingNativeExports = []
    const originalExport = global.wx.canvasToTempFilePath
    global.wx.canvasToTempFilePath = (options) => { pendingNativeExports.push(options) }
    try {
      page.generateLayoutImage()
      assert.equal(page.data.isGeneratingImage, true, 'The actual export path should expose its generation state')
      assert.equal(page.data.exportCanvasActive, true, 'The export canvas should mount while the native export is pending')
      assert.equal(page.data.previewVisible, false)
      assert.equal(page._canvasNode, null, 'The main renderer must remain unmounted while export owns the canvas')
      assert.equal(pendingNativeExports.length, 1, 'One real export page should be submitted to the wx boundary')
      const loadingBeforeRepeat = runtime.stats.loading
      page.generateLayoutImage()
      assert.equal(pendingNativeExports.length, 1, 'A second tap during generation must be rejected by the actual Page guard')
      assert.equal(runtime.stats.loading, loadingBeforeRepeat, 'A repeated generation request must not start another loading operation')
      assertIncludes(pageWxml, 'bindtap="generateLayoutImage"', 'The current page should expose the tested export action')
      pendingNativeExports[0].success({ tempFilePath: 'synthetic-layout.png' })
      assert.equal(page.data.isGeneratingImage, false)
      assert.equal(page.data.exportCanvasActive, false, 'The hidden export canvas should unmount after callback success')
      assert.equal(page.data.previewVisible, true, 'The preview should appear only after the export callback succeeds')
      assert.equal(page.data.layoutImagePath, 'synthetic-layout.png')
      assert.equal(page._canvasNode, null, 'The preview overlay must continue blocking the stage renderer')
      assertIncludes(pageWxml, 'catchtap="stopTap"', 'Interactive card content must not bubble into the backdrop')
      runOneCloseTimer(() => page.closePreview())
      drainFrames(runtime)
      assert.equal(page.data.previewVisible, false)
      assert(page._canvasNode === runtime.mainCanvas && page._canvasAdapter, 'Closing preview should restore the stage renderer after the native callback')
    } finally {
      global.wx.canvasToTempFilePath = originalExport
    }

    const drawCountBeforeHide = runtime.stats.drawCalls.length
    page.drawLayout()
    const hiddenFrameId = page._drawFrame
    assert(hiddenFrameId !== null)
    const hiddenFrame = runtime.mainCanvas.frameHistory.get(hiddenFrameId)
    page.onHide()
    assert.equal(hiddenFrame.run(), false, 'Hide should cancel a pending renderer frame')
    assert.equal(runtime.stats.drawCalls.length, drawCountBeforeHide, 'A hidden page frame must not draw')
    page.onShow()
    drainFrames(runtime)
    assert.equal(page._visible, true)
    assert(page._canvasNode === runtime.mainCanvas && page._canvasAdapter, 'Returning to the page should remeasure and remount the stage renderer')
    assert(runtime.stats.drawCalls.length > drawCountBeforeHide, 'Returning should redraw the current layout')

    console.log('PASS actual Page overlays suspend/restore the canvas, preserve multi-fixture placement and complete export lifecycle')
  } finally {
    runtime.dispose()
  }
}

verifyStyleMatrix()
verifyOverlayMarkup()
verifyPendingCanvasQueryCannotAttachBehindOverlay()
verifyActualPageLifecycleAndMultiFixtureLayout()
