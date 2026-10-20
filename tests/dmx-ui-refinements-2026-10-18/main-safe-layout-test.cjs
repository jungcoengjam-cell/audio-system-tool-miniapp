// Source-backed browser checks for the compact catalog and short landscape add sheet.
// This is not a WeChat native-runtime or physical-device test.
const assert = require('node:assert/strict')
const { launch, delay } = require('./browser-driver.cjs')

async function main() {
  const browser = await launch()
  try {
    const evaluate = source => browser.evaluate(source)
    const click = selector => evaluate(`(()=>{const node=document.querySelector(${JSON.stringify(selector)});if(!node)throw Error('Missing '+${JSON.stringify(selector)});node.click()})()`)
    const dispatch = (method, dataset = {}, detail = {}) => evaluate(`window.__dispatch(${JSON.stringify(method)},${JSON.stringify(dataset)},${JSON.stringify(detail)})`)

    await browser.viewport(320, 568, 'dark')
    await browser.navigate({ page: 'main', theme: 'dark' })
    await click('.add-group-button')
    await delay(80)
    const catalog = await evaluate(`(()=>{const panel=document.querySelector('.fixture-search-sheet'),body=panel.querySelector('.fixture-search-content-scroll'),results=panel.querySelector('.fixture-search-results');return{panel:{width:panel.clientWidth,scrollWidth:panel.scrollWidth},body:{width:body.clientWidth,scrollWidth:body.scrollWidth},results:{width:results.clientWidth,scrollWidth:results.scrollWidth}}})()`)
    assert(catalog.panel.width > 0)
    assert(catalog.body.scrollWidth <= catalog.body.width + 1, 'catalog content must not force horizontal scrolling: ' + JSON.stringify(catalog))
    assert(catalog.results.scrollWidth <= catalog.results.width + 1, 'catalog rows must fit the narrow sheet: ' + JSON.stringify(catalog))

    await browser.viewport(568, 320, 'dark')
    await browser.navigate({ page: 'main', theme: 'dark' })
    await click('.add-group-button')
    await dispatch('onFixtureSearchInput', {}, { value: 'TL-SL323' })
    await dispatch('flushFixtureSearch')
    await click('.fixture-search-row')
    await dispatch('onPendingQuantityInput', {}, { value: '200' })
    await dispatch('onPendingQuantityBlur')
    await delay(90)
    const getMetrics = () => evaluate(`(()=>{const rect=n=>{const r=n.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height}},panel=document.querySelector('.add-confirm-sheet'),body=panel.querySelector('.add-confirm-content-scroll'),footer=panel.querySelector('.pending-confirm'),capsule=wx.getMenuButtonBoundingClientRect(),safeArea=wx.getSystemInfoSync().safeArea;return{panel:rect(panel),body:rect(body),bodyScroll:{clientWidth:body.clientWidth,scrollWidth:body.scrollWidth,clientHeight:body.clientHeight,scrollHeight:body.scrollHeight,scrollTop:body.scrollTop},chips:rect(panel.querySelector('.add-preview-chips')),footer:rect(footer),capsule,safeArea,viewport:{width:innerWidth,height:innerHeight}}})()`)
    const initial = await getMetrics()
    assert(initial.panel.y >= initial.capsule.bottom + 5, 'add panel must clear the native capsule: ' + JSON.stringify(initial))
    assert(initial.panel.bottom <= initial.safeArea.bottom + 1, 'add panel must remain above the safe-area bottom: ' + JSON.stringify(initial))
    assert(initial.bodyScroll.clientHeight > 0 && initial.bodyScroll.scrollHeight > initial.bodyScroll.clientHeight, 'large preview must scroll within its body: ' + JSON.stringify(initial))
    assert(initial.bodyScroll.scrollWidth <= initial.bodyScroll.clientWidth + 1, 'preview body must not overflow horizontally: ' + JSON.stringify(initial))
    assert(initial.body.y >= initial.panel.y && initial.body.bottom <= initial.footer.y + 1, 'scroll body must end before the fixed action: ' + JSON.stringify(initial))
    assert(initial.footer.height >= 44 && initial.footer.y >= initial.panel.y && initial.footer.bottom <= initial.panel.bottom, 'add action must remain reachable at touch size: ' + JSON.stringify(initial))
    await evaluate("{const n=document.querySelector('.add-confirm-content-scroll');n.scrollTop=n.scrollHeight}")
    await delay(40)
    const scrolled = await getMetrics()
    assert(scrolled.bodyScroll.scrollTop > 0, 'preview body must scroll to the tail')
    assert(scrolled.body.y >= scrolled.panel.y && scrolled.body.bottom <= scrolled.footer.y + 1, 'scrolling must not cover the fixed action: ' + JSON.stringify(scrolled))
    assert(scrolled.footer.height >= 44 && scrolled.footer.bottom <= scrolled.panel.bottom, 'fixed action must remain inside the sheet after scrolling: ' + JSON.stringify(scrolled))
    console.log(JSON.stringify({ passed: true, nativeRuntime: false, physicalDevice: false, catalog, addPanel: initial, addPanelAfterScroll: scrolled }, null, 2))
  } finally {
    await browser.close()
  }
}

main().catch(error => {
  console.error(error.stack || error)
  process.exitCode = 1
})
