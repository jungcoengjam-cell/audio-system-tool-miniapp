const assert = require('node:assert/strict')
const { createRuntime } = require('./controller-runtime.cjs')

function themedRuntime() {
  const runtime = createRuntime()
  let theme = 'light'
  let themeHandler = null
  let removedHandler = null
  const originalInfo = global.wx.getSystemInfoSync
  global.wx.getAppBaseInfo = () => ({ theme })
  global.wx.getSystemInfoSync = () => ({ ...originalInfo(), theme })
  global.wx.onThemeChange = (handler) => { themeHandler = handler }
  global.wx.offThemeChange = (handler) => { removedHandler = handler }
  runtime.seed()
  return {
    ...runtime,
    get themeHandler() { return themeHandler },
    get removedHandler() { return removedHandler },
    set theme(value) { theme = value },
  }
}

{
  const runtime = themedRuntime()
  try {
    const page = runtime.make()
    runtime.drain(runtime.frames)
    const handler = runtime.themeHandler
    assert.equal(typeof handler, 'function', 'The layout page did not subscribe to system theme changes')
    const imagePaths = ['snapshot-light.png', 'snapshot-light-2.png']
    const snapshot = { signature: 'completed-light-export' }
    page._exportSnapshot = snapshot
    page._exportPages = [{ index: 0 }, { index: 1 }]
    page._exportPaths = imagePaths.slice()
    page.setData({
      layoutImagePath: imagePaths[0],
      layoutImagePaths: imagePaths.slice(),
      previewVisible: true,
      isGeneratingImage: false,
      exportCanvasActive: false,
    })
    const previousDrawCount = runtime.stats.draw
    const previousGeneration = page._generationToken
    const previousWrites = runtime.stats.writes
    runtime.theme = 'dark'
    handler({ theme: 'dark' })
    runtime.drain(runtime.frames)
    assert.equal(page.data.darkMode, true)
    assert.equal(page.data.layoutImagePath, imagePaths[0])
    assert.deepEqual(page.data.layoutImagePaths, imagePaths)
    assert.equal(page.data.previewVisible, true, 'Theme changes must preserve the completed export window')
    assert.equal(page.data.isGeneratingImage, false)
    assert.equal(page._exportSnapshot, snapshot, 'Theme changes must retain the completed export snapshot')
    assert.deepEqual(page._exportPaths, imagePaths)
    assert.equal(page._generationToken, previousGeneration, 'A completed snapshot must not be treated as an active export')
    assert.equal(runtime.stats.draw, previousDrawCount,
      'Theme change should leave the hidden canvas untouched while the completed report remains open')
    assert.equal(runtime.stats.writes, previousWrites, 'Theme change unexpectedly wrote lighting storage')

    const beforeOnShowDraws = runtime.stats.draw
    runtime.theme = 'light'
    page.onShow()
    runtime.drain(runtime.frames)
    assert.equal(page.data.darkMode, false)
    assert.equal(page.data.previewVisible, true, 'onShow theme refresh must preserve the completed export window')
    assert.equal(page.data.layoutImagePath, imagePaths[0])
    assert.deepEqual(page.data.layoutImagePaths, imagePaths)
    assert.equal(page._exportSnapshot, snapshot)
    assert.equal(page._generationToken, previousGeneration)
    assert.equal(runtime.stats.draw, beforeOnShowDraws,
      'onShow should leave the hidden canvas untouched while the completed report remains open')
    assert.equal(runtime.stats.writes, previousWrites, 'onShow theme refresh unexpectedly wrote lighting storage')
  } finally {
    runtime.dispose()
  }
}

{
  const runtime = themedRuntime()
  try {
    const page = runtime.make()
    runtime.drain(runtime.frames)
    const handler = runtime.themeHandler
    const startGeneration = (path) => {
      page._exportSnapshot = { signature: path }
      page._exportPages = [{ path }]
      page._exportPaths = [path]
      page.setData({
        layoutImagePath: path,
        layoutImagePaths: [path],
        previewVisible: false,
        isGeneratingImage: true,
        exportCanvasActive: true,
      })
      return page._generationToken
    }

    const previousWrites = runtime.stats.writes
    let previousGeneration = startGeneration('pending-theme-event.png')
    const beforeThemeDraw = runtime.stats.draw
    runtime.theme = 'dark'
    handler({ theme: 'dark' })
    runtime.drain(runtime.frames)
    assert(page._generationToken > previousGeneration, 'Theme event did not cancel the active export generation')
    assert.equal(page.data.isGeneratingImage, false)
    assert.equal(page.data.exportCanvasActive, false)
    assert.equal(page.data.layoutImagePath, '')
    assert.deepEqual(page.data.layoutImagePaths, [])
    assert.equal(page._exportSnapshot, null)
    assert.deepEqual(page._exportPaths, [])
    assert(runtime.stats.draw > beforeThemeDraw, 'Theme change did not redraw the active canvas after canceling export')
    const darkDraws = runtime.stats.drawCalls.filter((call) => call.canvas === 'main')
    const fillStyles = darkDraws.map((call) => call.fillStyle)
    assert(fillStyles.includes('#000000') && fillStyles.includes('#1c1c1e'),
      'The raw 2D redraw did not use the refreshed dark canvas palette')
    assert.equal(runtime.stats.writes, previousWrites, 'Canceling a theme-mismatched export wrote lighting storage')

    previousGeneration = startGeneration('pending-on-show.png')
    runtime.theme = 'light'
    const beforeOnShowDraw = runtime.stats.draw
    page.onShow()
    runtime.drain(runtime.frames)
    assert(page._generationToken > previousGeneration, 'onShow did not cancel the active theme-mismatched export')
    assert.equal(page.data.isGeneratingImage, false)
    assert.equal(page.data.exportCanvasActive, false)
    assert.equal(page.data.layoutImagePath, '')
    assert.deepEqual(page.data.layoutImagePaths, [])
    assert.equal(page._exportSnapshot, null)
    assert.deepEqual(page._exportPaths, [])
    assert(runtime.stats.draw > beforeOnShowDraw, 'onShow did not redraw after canceling the active export')
    assert.equal(runtime.stats.writes, previousWrites, 'onShow export cancellation wrote lighting storage')
  } finally {
    runtime.dispose()
  }
  console.log('PASS theme changes preserve completed reports and cancel active exports')
}

{
  const runtime = themedRuntime()
  try {
    const page = runtime.make()
    runtime.drain(runtime.frames)
    const imagePaths = ['before-layout-change.png']
    page._exportSnapshot = { signature: 'saved-layout-snapshot' }
    page._exportPages = [{ index: 0 }]
    page._exportPaths = imagePaths.slice()
    page.setData({
      layoutImagePath: imagePaths[0],
      layoutImagePaths: imagePaths.slice(),
      previewVisible: true,
      isGeneratingImage: false,
      exportCanvasActive: false,
    })
    const previousWrites = runtime.stats.writes
    const nextLayout = { ...page._layout, stageWidthText: String(Number(page._layout.stageWidthText) + 1) }
    assert.equal(page.saveLayoutOnly(nextLayout), true)
    assert.equal(page.data.previewVisible, false, 'Ordinary layout changes must invalidate completed exports')
    assert.equal(page.data.layoutImagePath, '')
    assert.deepEqual(page.data.layoutImagePaths, [])
    assert.equal(page._exportSnapshot, null)
    assert.deepEqual(page._exportPaths, [])
    assert(runtime.stats.writes > previousWrites, 'Ordinary layout changes were not persisted')
  } finally {
    runtime.dispose()
  }
  console.log('PASS ordinary layout changes still invalidate completed reports')
}

{
  const runtime = themedRuntime()
  const page = runtime.make()
  runtime.drain(runtime.frames)
  const handler = runtime.themeHandler
  page.onHide()
  const patches = page._qaPatches.length
  const writes = runtime.stats.writes
  const draws = runtime.stats.draw
  runtime.theme = 'dark'
  handler({ theme: 'dark' })
  assert.equal(page._qaPatches.length, patches, 'A late hidden theme event changed page data')
  assert.equal(runtime.stats.writes, writes, 'A late hidden theme event wrote storage')
  assert.equal(runtime.stats.draw, draws, 'A hidden theme event redrew an inactive canvas')
  runtime.dispose()
  console.log('PASS hidden theme callbacks do not write view or storage')
}

{
  const runtime = themedRuntime()
  const page = runtime.make()
  runtime.drain(runtime.frames)
  const handler = runtime.themeHandler
  page.onUnload()
  const patches = page._qaPatches.length
  const writes = runtime.stats.writes
  assert.equal(runtime.removedHandler, handler, 'Unload did not remove the registered theme callback')
  runtime.theme = 'dark'
  handler({ theme: 'dark' })
  assert.equal(page._qaPatches.length, patches, 'A late unloaded theme event changed page data')
  assert.equal(runtime.stats.writes, writes, 'A late unloaded theme event wrote storage')
  console.log('PASS unload removes the theme callback and late events are inert')
}

console.log('Layout theme lifecycle tests passed')
