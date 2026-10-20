// Injected touch events against the source-backed browser adapter.
// The adapter is Chromium, not native WeChat or a phone.
const assert = require('node:assert/strict')
const { launch, delay } = require('./browser-driver.cjs')

async function main() {
  const browser = await launch()
  try {
    await browser.viewport(390, 844, 'light')
    await browser.navigate({ page: 'main', theme: 'light' })
    await browser.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 })
    const point = (id, x, y) => ({ id, x: Math.round(x), y: Math.round(y), radiusX: 2, radiusY: 2, force: 1 })
    const dispatchTouches = (type, points) => browser.send('Input.dispatchTouchEvent', { type, touchPoints: points })
    const baseline = await browser.evaluate(`(()=>({writes:window.__lightingQa.events.writes.length,result:JSON.stringify(window.__lightingQa.page._calculationResult)}))()`)
    const groupPoint = await browser.evaluate(`(()=>{const r=document.querySelector('.fixture-card').getBoundingClientRect();return{x:r.x+100,y:r.y+45,left:r.left}})()`)
    await dispatchTouches('touchStart', [point(1, groupPoint.x, groupPoint.y)])
    await dispatchTouches('touchStart', [point(1, groupPoint.x, groupPoint.y), point(2, groupPoint.x + 20, groupPoint.y + 4)])
    await dispatchTouches('touchMove', [point(1, groupPoint.x - 50, groupPoint.y), point(2, groupPoint.x - 30, groupPoint.y + 4)])
    await delay(50)
    const group = await browser.evaluate(`(()=>({drag:window.__lightingQa.data.swipeDragIndex,offset:window.__lightingQa.data.swipeDragOffset,open:window.__lightingQa.data.swipedGroupIndex,left:document.querySelector('.fixture-card').getBoundingClientRect().left}))()`)
    assert.equal(group.drag, -1, 'multi-touch cancels the row drag')
    assert.equal(group.offset, 0, 'multi-touch resets row displacement')
    assert.equal(group.open, -1, 'multi-touch does not leave delete exposed')
    assert.equal(group.left, groupPoint.left, 'multi-touch restores the row to rest')
    await dispatchTouches('touchEnd', [])
    await browser.evaluate("window.__dispatch('openModelPicker',{index:0},{},{})")
    assert.equal(await browser.evaluate('window.__lightingQa.data.fixtureSearchOpen'), false, 'post-multitouch click suppression must also guard model editing')
    await delay(600)

    await browser.evaluate("window.__dispatch('openFloatingCard',{index:0},{},{})")
    await delay(260)
    const floatingPoint = await browser.evaluate(`(()=>{const r=document.querySelector('.floating-card').getBoundingClientRect();return{x:r.x+100,y:r.y+45,left:r.left}})()`)
    await dispatchTouches('touchStart', [point(1, floatingPoint.x, floatingPoint.y)])
    await dispatchTouches('touchStart', [point(1, floatingPoint.x, floatingPoint.y), point(2, floatingPoint.x + 20, floatingPoint.y + 4)])
    await dispatchTouches('touchMove', [point(1, floatingPoint.x + 70, floatingPoint.y), point(2, floatingPoint.x + 90, floatingPoint.y + 4)])
    await delay(50)
    const floating = await browser.evaluate(`(()=>({visible:window.__lightingQa.data.floatingVisible,offset:window.__lightingQa.data.floatingSwipeOffset,dragging:window.__lightingQa.data.floatingSwipeDragging,left:document.querySelector('.floating-card').getBoundingClientRect().left,writes:window.__lightingQa.events.writes.length,result:JSON.stringify(window.__lightingQa.page._calculationResult)}))()`)
    assert.equal(floating.visible, true, 'multi-touch must not dismiss the floating card')
    assert.equal(floating.offset, 0, 'multi-touch resets floating displacement')
    assert.equal(floating.dragging, false)
    assert.equal(floating.left, floatingPoint.left, 'multi-touch restores the floating card')
    assert.equal(floating.writes, baseline.writes, 'gesture does not write storage')
    assert.equal(floating.result, baseline.result, 'gesture does not recalculate addresses')
    await dispatchTouches('touchEnd', [])
    console.log(JSON.stringify({ passed: true, nativeRuntime: false, physicalDevice: false, group, floating: { visible: floating.visible, offset: floating.offset, dragging: floating.dragging, left: floating.left, writesUnchanged: floating.writes === baseline.writes, calculationUnchanged: floating.result === baseline.result } }, null, 2))
  } finally {
    await browser.close()
  }
}

main().catch(error => {
  console.error(error.stack || error)
  process.exitCode = 1
})
