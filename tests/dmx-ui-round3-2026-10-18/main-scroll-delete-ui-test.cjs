const assert = require('node:assert/strict')
const path = require('node:path')
const { launch, delay } = require('./browser-driver.cjs')

async function tapScroll(page, selector) {
  const rect = await page.evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect();return r?{x:r.left+r.width/2,top:r.top,width:r.width,height:r.height}:null})()`)
  assert(rect && rect.width > 0 && rect.height > 0, `${selector} has no visible touch area`)
  const startY = rect.top + Math.max(10, rect.height - 16)
  const endY = rect.top + Math.min(18, rect.height / 3)
  const x = rect.x
  await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: startY, id: 1, radiusX: 3, radiusY: 3, force: 1 }] })
  for (let step = 1; step <= 6; step++) {
    const y = startY + (endY - startY) * step / 6
    await page.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y, id: 1, radiusX: 3, radiusY: 3, force: 1 }] })
    await delay(20)
  }
  await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await delay(100)
}

async function runSearchScroll(width, height, theme) {
  const page = await launch()
  try {
    await page.viewport(width, height, theme)
    await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 })
    await page.navigate({ theme, fixture: 'standard' })
    await page.evaluate("window.__dispatch('addGroup')")
    await delay(60)
    const before = await page.evaluate(`(()=>{const sheet=document.querySelector('.fixture-search-sheet'),scroller=document.querySelector('.fixture-search-content-scroll');if(!sheet||!scroller)return null;const s=sheet.getBoundingClientRect(),r=scroller.getBoundingClientRect();return {sheet:{top:s.top,bottom:s.bottom,height:s.height},scroll:{top:r.top,bottom:r.bottom,height:r.height,clientHeight:scroller.clientHeight,scrollHeight:scroller.scrollHeight,scrollTop:scroller.scrollTop,inlineHeight:scroller.style.height},chrome:[...sheet.querySelectorAll('.sheet-title-row,.fixture-search-box,.fixture-category-scroll,.fixture-search-count')].map(node=>{const r=node.getBoundingClientRect();return {className:node.className,top:r.top,bottom:r.bottom,height:r.height}})}})()`)
    assert(before, `${width}x${height}: search sheet and results scroller should render`)
    assert.match(before.scroll.inlineHeight, /^\d+(?:\.\d+)?px$/, 'Results scroller must have an explicit pixel height')
    assert(before.scroll.clientHeight > 0, 'Results scroller must have an actual viewport')
    assert(before.scroll.scrollHeight > before.scroll.clientHeight, 'Catalog must contain scrollable rows')
    assert(before.scroll.top >= before.sheet.top - 1 && before.scroll.bottom <= before.sheet.bottom + 1, 'Results scroller must stay inside the sheet')
    assert(before.chrome.every(item => item.top >= before.sheet.top - 1 && item.bottom <= before.scroll.top + 1), 'Search controls must stay above the scroll region')
    await tapScroll(page, '.fixture-search-content-scroll')
    const after = await page.evaluate("(()=>{const node=document.querySelector('.fixture-search-content-scroll');return {scrollTop:node?.scrollTop,scrollHeight:node?.scrollHeight,clientHeight:node?.clientHeight}})()")
    assert(after.scrollTop > 0, 'A real CDP touch swipe must move the catalog scroll view')
    await page.evaluate("window.__dispatch('closeFixturePicker')")
    await page.evaluate("window.__dispatch('openBatchFixtureSearch')")
    await delay(50)
    await page.evaluate("document.querySelector('.fixture-search-row')?.click()")
    await delay(50)
    const batch = await page.evaluate(`(()=>{const sheet=document.querySelector('.fixture-search-sheet'),results=document.querySelector('.fixture-search-content-scroll'),footer=document.querySelector('.batch-footer'),button=footer?.querySelector('.batch-confirm');if(!sheet||!results||!footer||!button)return null;const s=sheet.getBoundingClientRect(),r=results.getBoundingClientRect(),f=footer.getBoundingClientRect(),b=button.getBoundingClientRect();return {selected:window.__lightingQa.page.data.batchSelectedItems.length,sheet:{top:s.top,bottom:s.bottom},results:{top:r.top,bottom:r.bottom,height:r.height,inlineHeight:results.style.height},footer:{top:f.top,bottom:f.bottom,height:f.height,inlineHeight:footer.style.height},button:{top:b.top,bottom:b.bottom,height:b.height}}})()`)
    assert(batch && batch.selected === 1, 'Batch selection should reveal its footer')
    assert.match(batch.results.inlineHeight, /^\d+(?:\.\d+)?px$/)
    assert(batch.results.height > 0 && batch.results.bottom <= batch.footer.top + 1, 'The results viewport should fit above the batch footer')
    assert(batch.footer.bottom <= batch.sheet.bottom + 1, 'Batch footer should remain within the sheet')
    assert(batch.button.height >= 42 && batch.button.bottom <= batch.sheet.bottom + 1, 'Batch confirmation must remain reachable')
    return { viewport: `${width}x${height}`, theme, before, after, batch }
  } finally { await page.close() }
}

async function runDeletePreview() {
  const page = await launch()
  try {
    await page.viewport(390, 844, 'light')
    await page.navigate({ theme: 'light', fixture: 'standard' })
    const pending = await page.evaluate("window.__dispatch('requestDeleteGroup',{index:0})")
    assert.equal(pending.pendingChange.kind, 'delete')
    assert.equal(pending.pendingChange.deletePreview.fixtureCountValue, 12)
    assert.equal(pending.pendingChange.remainingAffectedGroups.length, 2)
    assert(pending.pendingChange.remainingAffectedGroups.every(item => item.afterCount > 0))
    const before = await page.evaluate(`(()=>{const sheet=document.querySelector('.pending-sheet-delete'),body=sheet?.querySelector('.pending-content-scroll');return {text:sheet?.innerText,body:body?{clientHeight:body.clientHeight,scrollHeight:body.scrollHeight}:null,rows:sheet?.querySelectorAll('.pending-delete-group-row').length,removed:sheet?.querySelectorAll('.pending-removed-row').length,disclosure:!!sheet?.querySelector('.pending-removed-disclosure')}})()`)
    assert(before.text.includes('删除 12 台') && before.text.includes('整组移除'), 'Delete target and count should be explicit')
    assert.equal(before.rows, 2, 'Both remaining affected groups should show their address changes')
    assert(before.text.includes('剩余灯组地址调整') && before.text.includes('下一可用地址'))
    assert.equal(before.removed, 0, 'Per-fixture delete details should start collapsed')
    assert(before.disclosure, 'The collapsed details disclosure should be visible')
    await page.screenshot(path.resolve(__dirname, 'evidence/browser/delete-preview-collapsed-390.png'))
    const writes = await page.evaluate('window.__lightingQa.events.writes.length')
    await page.evaluate("document.querySelector('.pending-removed-disclosure').click()")
    await delay(40)
    const expanded = await page.evaluate(`(()=>{const sheet=document.querySelector('.pending-sheet-delete'),body=sheet?.querySelector('.pending-content-scroll');return {expanded:window.__lightingQa.page.data.removedDetailsExpanded,rows:sheet?.querySelectorAll('.pending-removed-row').length,clientHeight:body?.clientHeight,scrollHeight:body?.scrollHeight}})()`)
    assert.equal(expanded.expanded, true)
    assert.equal(expanded.rows, 12, 'Expanding should expose every removed fixture row')
    assert(expanded.scrollHeight > expanded.clientHeight, 'Expanded details should use the shared body scroll window')
    await page.screenshot(path.resolve(__dirname, 'evidence/browser/delete-preview-expanded-390.png'))
    assert.equal(await page.evaluate('window.__lightingQa.events.writes.length'), writes, 'Preview expansion must not write project storage')
    await page.evaluate("window.__dispatch('cancelPendingChange')")
    assert.equal(await page.evaluate('window.__lightingQa.page.data.pendingChange'), null)
    assert.equal(await page.evaluate('window.__lightingQa.events.writes.length'), writes, 'Cancelling delete preview must remain write-free')

    const finalGroupPreview = await page.evaluate("window.__dispatch('requestDeleteGroup',{index:2})")
    assert.equal(finalGroupPreview.pendingChange.remainingAffectedGroups.length, 0)
    assert.equal(finalGroupPreview.pendingChange.remainingGroupCount, 2)
    const unchanged = await page.evaluate(`(()=>{const sheet=document.querySelector('.pending-sheet-delete');return {text:sheet?.innerText,rows:sheet?.querySelectorAll('.pending-delete-group-row').length}})()`)
    assert(unchanged.text.includes('其余灯组地址保持不变'))
    assert(!unchanged.text.includes('删除后暂无灯组'))
    assert.equal(unchanged.rows, 0)
    await page.evaluate("window.__dispatch('cancelPendingChange')")
    assert.equal(await page.evaluate('window.__lightingQa.events.writes.length'), writes, 'Cancelling an unchanged-range delete preview must remain write-free')

    for (let count = 0; count < 2; count++) {
      await page.evaluate("window.__dispatch('requestDeleteGroup',{index:0})")
      await page.evaluate("window.__dispatch('confirmPendingChange')")
    }
    const onlyGroup = await page.evaluate("window.__dispatch('requestDeleteGroup',{index:0})")
    assert.equal(onlyGroup.pendingChange.remainingGroupCount, 0)
    const empty = await page.evaluate(`(()=>{const sheet=document.querySelector('.pending-sheet-delete');return sheet?.innerText||''})()`)
    assert(empty.includes('删除后暂无灯组'))
    assert(!empty.includes('其余灯组地址保持不变'))
    await page.evaluate("window.__dispatch('cancelPendingChange')")
    return { target: pending.pendingChange.deletePreview, remaining: pending.pendingChange.remainingAffectedGroups.map(item => ({ name: item.primaryName, before: item.beforeRange, after: item.afterRange, invalidated: item.invalidatedCheckCount })), collapsed: before, expanded, unchanged, empty }
  } finally { await page.close() }
}

async function main() {
  const results = []
  results.push(await runSearchScroll(390, 844, 'light'))
  results.push(await runSearchScroll(568, 320, 'dark'))
  const deletion = await runDeletePreview()
  process.stdout.write(JSON.stringify({ results, deletion }, null, 2) + '\n')
}

main().catch(error => { process.stderr.write((error.stack || String(error)) + '\n'); process.exitCode = 1 })
