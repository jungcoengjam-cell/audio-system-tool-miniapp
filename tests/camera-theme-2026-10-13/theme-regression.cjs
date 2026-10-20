'use strict'

const assert = require('node:assert/strict')
const renderer = require('../../pages/camera/preview-renderer')
const originalRenderer = require('./before/preview-renderer')
const { createDelayedEnvironment } = require('../p2-safety-remediation/minimal/delayed-environment.cjs')

function createRecorder() {
  const commands = []
  let fillStyle = ''
  let strokeStyle = ''
  let lineWidth = 1
  let fontSize = 12
  let textAlign = 'left'
  const record = (op, ...args) => commands.push({ op, args })
  return {
    commands,
    context: {
      supportsArc: false,
      setFillStyle(value) { fillStyle = value; record('setFillStyle', value) },
      setStrokeStyle(value) { strokeStyle = value; record('setStrokeStyle', value) },
      setLineWidth(value) { lineWidth = value; record('setLineWidth', value) },
      setFontSize(value) { fontSize = Number(value); record('setFontSize', fontSize) },
      setTextAlign(value) { textAlign = value; record('setTextAlign', value) },
      measureText(value) { return [...String(value)].length * fontSize * 0.62 },
      setLineDash(value) { record('setLineDash', [...value]) },
      beginPath() { record('beginPath') },
      closePath() { record('closePath') },
      moveTo(...args) { record('moveTo', ...args) },
      lineTo(...args) { record('lineTo', ...args) },
      arc(...args) { record('arc', ...args) },
      rect(...args) { record('rect', ...args) },
      clip() { record('clip') },
      save() { record('save') },
      restore() { record('restore') },
      fill() { record('fill', fillStyle) },
      stroke() { record('stroke', strokeStyle, lineWidth) },
      fillRect(...args) { record('fillRect', ...args, fillStyle) },
      strokeRect(...args) { record('strokeRect', ...args, strokeStyle, lineWidth) },
      fillText(...args) { record('fillText', ...args, fillStyle, fontSize, textAlign) },
    },
  }
}

function render(drawer, result, view, theme) {
  const recorder = createRecorder()
  drawer.drawPreviewAtSize(recorder.context, result, 331, 220, view, theme)
  return recorder.commands
}

function geometryOnly(commands) {
  return commands
    .filter(({ op }) => op !== 'setFillStyle' && op !== 'setStrokeStyle')
    .map(({ op, args }) => {
      if (op === 'fill') return { op, args: [] }
      if (op === 'stroke') return { op, args: args.slice(1) }
      if (op === 'fillRect') return { op, args: args.slice(0, 4) }
      if (op === 'strokeRect') return { op, args: [...args.slice(0, 4), ...args.slice(5)] }
      if (op === 'fillText') return { op, args: [...args.slice(0, 3), ...args.slice(4)] }
      return { op, args }
    })
}

function stateColors(commands) {
  return new Set(commands
    .filter(({ op }) => op === 'setFillStyle' || op === 'setStrokeStyle')
    .map(({ args }) => args[0]))
}

function loadCameraPage() {
  const env = createDelayedEnvironment()
  let currentTheme = 'light'
  const listeners = new Set()
  const removed = []
  env.wx.getAppBaseInfo = () => ({ theme: currentTheme })
  env.wx.getSystemInfoSync = () => ({ theme: currentTheme === 'light' ? 'dark' : 'light' })
  env.wx.onThemeChange = (listener) => listeners.add(listener)
  env.wx.offThemeChange = (listener) => { removed.push(listener); listeners.delete(listener) }
  const page = env.loadPage('pages/camera/camera.js')
  page.onLoad()
  env.flushNextTicks()
  assert(page.data.result, 'the production camera page calculates its normal default result')
  return {
    env,
    page,
    listeners,
    removed,
    get theme() { return currentTheme },
    set theme(value) { currentTheme = value },
  }
}

function testRendererThemeAndLegacyDefault(result) {
  const cases = []
  for (const view of ['plan', 'elevation']) {
    const original = render(originalRenderer, result, view)
    const currentDefault = render(renderer, result, view)
    const explicitDark = render(renderer, result, view, 'dark')
    const light = render(renderer, result, view, 'light')
    assert.deepEqual(currentDefault, original, `${view}: omitted theme preserves the original dark drawing commands`)
    assert.deepEqual(explicitDark, original, `${view}: explicit dark theme preserves the original drawing commands`)
    assert.deepEqual(geometryOnly(light), geometryOnly(explicitDark), `${view}: theme changes only drawing colors`)
    assert.notDeepEqual(stateColors(light), stateColors(explicitDark), `${view}: light theme uses its own palette`)
    cases.push({ view, commands: original.length, lightColors: stateColors(light).size })
  }
  return cases
}

function testPageThemeLifecycle() {
  const { env, page, listeners, removed, theme: initialTheme } = loadCameraPage()
  let drawCount = 0
  page.drawPreview = () => { drawCount += 1 }
  assert.equal(initialTheme, 'light')
  page.onShow()
  assert.equal(drawCount, 1, 'onShow redraws the visible result')
  assert.equal(page.data.theme, 'light', 'getAppBaseInfo takes precedence over a conflicting older system API')
  const [themeListener] = listeners
  assert.equal(typeof themeListener, 'function', 'onLoad subscribes to WeChat theme changes')

  env.wx.getAppBaseInfo = () => ({ theme: 'dark' })
  themeListener({ theme: 'dark' })
  env.flushNextTicks()
  assert.equal(page.data.theme, 'dark')
  assert.equal(drawCount, 2, 'a visible theme change redraws the diagram')

  page.onHide()
  const hiddenDrawCount = drawCount
  env.wx.getAppBaseInfo = () => ({ theme: 'light' })
  themeListener({ theme: 'light' })
  env.flushNextTicks()
  assert.equal(page.data.theme, 'light', 'a hidden theme change updates state')
  assert.equal(drawCount, hiddenDrawCount, 'a hidden theme change does not draw to the canvas')
  page.onShow()
  assert.equal(drawCount, hiddenDrawCount + 1, 'onShow redraws the latest theme')

  page.onHide()
  env.wx.getAppBaseInfo = () => ({ theme: 'dark' })
  page.onShow()
  env.flushNextTicks()
  assert.equal(page.data.theme, 'dark', 'onShow rereads the current system theme if no event was delivered')
  assert.equal(drawCount, hiddenDrawCount + 2, 'the onShow theme refresh paints once')

  page.onUnload()
  assert(removed.includes(themeListener), 'onUnload unregisters its theme listener')
  const unloadedDrawCount = drawCount
  themeListener({ theme: 'light' })
  env.flushNextTicks()
  assert.equal(drawCount, unloadedDrawCount, 'an obsolete theme callback cannot draw after unload')
}

function testOlderSystemThemeFallback() {
  const env = createDelayedEnvironment()
  env.wx.getAppBaseInfo = () => ({ theme: 'unknown' })
  env.wx.getSystemInfoSync = () => ({ theme: 'dark' })
  const page = env.loadPage('pages/camera/camera.js')
  page.onLoad()
  env.flushNextTicks()
  assert.equal(page.data.theme, 'dark', 'an unknown app theme falls back to getSystemInfoSync')
  page.onUnload()

  const fallbackEnv = createDelayedEnvironment()
  fallbackEnv.wx.getAppBaseInfo = () => ({})
  fallbackEnv.wx.getSystemInfoSync = () => ({})
  const fallbackPage = fallbackEnv.loadPage('pages/camera/camera.js')
  fallbackPage.onLoad()
  fallbackEnv.flushNextTicks()
  assert.equal(fallbackPage.data.theme, 'light', 'unknown or unavailable theme APIs fall back to light')
  fallbackPage.onUnload()
}

function run() {
  const { page } = loadCameraPage()
  const rendererCases = testRendererThemeAndLegacyDefault(page.data.result)
  page.onUnload()
  return {
    status: 'passed',
    suite: 'camera preview theme regression',
    renderer: rendererCases,
    pageLifecycle: testPageThemeLifecycle(),
    themeFallback: testOlderSystemThemeFallback(),
  }
}

if (require.main === module) process.stdout.write(`${JSON.stringify(run(), null, 2)}\n`)

module.exports = { run }
