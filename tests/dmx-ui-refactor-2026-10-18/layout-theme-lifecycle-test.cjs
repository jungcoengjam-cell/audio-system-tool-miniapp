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
    page.setData({
      layoutImagePath: 'stale.png',
      layoutImagePaths: ['stale.png'],
      previewVisible: true,
      isGeneratingImage: true,
      exportCanvasActive: true,
    })
    const previousDrawCount = runtime.stats.draw
    const previousGeneration = page._generationToken
    const previousWrites = runtime.stats.writes
    runtime.theme = 'dark'
    handler({ theme: 'dark' })
    runtime.drain(runtime.frames)
    assert.equal(page.data.darkMode, true)
    assert.equal(page.data.layoutImagePath, '')
    assert.deepEqual(page.data.layoutImagePaths, [])
    assert.equal(page.data.previewVisible, false)
    assert.equal(page.data.isGeneratingImage, false)
    assert(page._generationToken > previousGeneration, 'Theme change did not invalidate pending export callbacks')
    assert(runtime.stats.draw > previousDrawCount, 'Theme change did not redraw the active canvas')
    const darkDraws = runtime.stats.drawCalls.filter((call) => call.canvas === 'main')
    const fillStyles = darkDraws.map((call) => call.fillStyle)
    assert(fillStyles.includes('#000000') && fillStyles.includes('#1c1c1e'),
      'The raw 2D redraw did not use the refreshed dark canvas palette')
    assert.equal(runtime.stats.writes, previousWrites, 'Theme change unexpectedly wrote lighting storage')
  } finally {
    runtime.dispose()
  }
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
