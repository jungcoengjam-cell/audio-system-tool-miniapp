const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { launch, delay } = require('./browser-driver.cjs')
const phase = process.argv[2] || 'review'
const output = path.join(__dirname, 'evidence/browser-' + phase)
fs.mkdirSync(output, { recursive: true })

async function run() {
  const browser = await launch(), scenes = [], results = []
  const dispatch = (method, dataset = {}, detail = {}, extra = {}) => browser.evaluate(`window.__dispatch(${JSON.stringify(method)},${JSON.stringify(dataset)},${JSON.stringify(detail)},${JSON.stringify(extra)})`)
  const click = selector => browser.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`)
  async function capture(name) {
    await delay(260)
    const facts = await browser.evaluate('window.__facts()')
    const bounds = await browser.evaluate(`(()=>{const sels=['.fixture-name','.fixture-model','.fixture-controls','.page-title','.header-export','.nav-title','.nav-share','.floating-card','.settings-card','.placement-card','.locate-card','.save-project-sheet','.pending-sheet'];return Object.fromEntries(sels.map(s=>[s,[...document.querySelectorAll(s)].map(n=>{const r=n.getBoundingClientRect();return {text:n.innerText,x:r.x,y:r.y,w:r.width,h:r.height,right:r.right,bottom:r.bottom}})]))})()`)
    await browser.screenshot(path.join(output, name + '.png'))
    scenes.push({ name, facts, bounds })
    assert.deepEqual(facts.errors, [], name + ': WXML evaluation errors')
    assert.deepEqual(facts.runtimeErrors, [], name + ': page runtime errors')
    assert(!facts.text.includes('{{')&&!facts.text.includes('}}'),name+': unparsed WXML expression in browser adapter')
    assert(facts.pageWidth <= facts.width + 1, name + ': horizontal page overflow')
    for (const selector of ['.floating-card', '.settings-card', '.placement-card', '.locate-card', '.save-project-sheet', '.pending-sheet']) for (const item of bounds[selector]) {
      assert(item.x >= -1 && item.right <= facts.width + 1 && item.y >= -1 && item.bottom <= facts.height + 1, name + ': clipped ' + selector)
    }
    for(const [heading,action]of [['.page-title','.header-export'],['.nav-title','.nav-share']])if(bounds[heading].length&&bounds[action].length){const a=bounds[heading][0],b=bounds[action][0];assert(a.right<=b.x||b.right<=a.x||a.bottom<=b.y||b.bottom<=a.y,name+': title collides with share icon')}
    console.log('CAPTURE ' + name)
    return facts
  }
  async function test(name, body) { try { await body(); results.push({ name, passed: true }); console.log('PASS ' + name) } catch (error) { results.push({ name, passed: false, error: error.stack }); console.error('FAIL ' + name + ': ' + error.message) } }
  try {
    for (const theme of ['light', 'dark']) {
      await test(theme + ': main, lifted checks, add, impact preview and save', async () => {
        await browser.viewport(390, 844, theme); await browser.navigate({ theme })
        await capture(theme + '-main-390')
        const count = await browser.evaluate('window.__lightingQa.page._calculationResult.fixtures.length')
        await click('.address-chip'); await capture(theme + '-floating')
        assert.equal(await browser.evaluate('window.__lightingQa.data.floatingVisible'), true)
        await click('.floating-chips .address-chip'); await capture(theme + '-floating-checked')
        assert.equal(await browser.evaluate('window.__lightingQa.data.floatingGroup.checkedCount'), 1)
        await dispatch('openFixtureChannelGuide',{globalIndex:3});await capture(theme+'-channel-guide');await dispatch('closeFixtureChannelGuide')
        await click('.floating-backdrop'); await delay(300)
        assert.equal(await browser.evaluate('window.__lightingQa.data.floatingVisible'), false)
        await click('.add-group-button'); await capture(theme + '-add-picker')
        await dispatch('onFixtureSearchInput', {}, { value: 'TL-SL323' }); await dispatch('flushFixtureSearch')
        await click('.fixture-search-row'); await capture(theme + '-add-preview')
        await dispatch('onPendingQuantityInput', {}, { value: '3' }); await dispatch('onPendingQuantityBlur'); await dispatch('confirmPendingChange')
        assert.equal(await browser.evaluate('window.__lightingQa.page._calculationResult.fixtures.length'), count + 3)
        await dispatch('onCardQuantityInput', { index: 0 }, { value: '10' }); await dispatch('onCardQuantityBlur', { index: 0 }, { value: '10' })
        await capture(theme + '-reduce-preview'); await dispatch('cancelPendingChange')
        await dispatch('onCardModeChange', { index: 1 }, { value: 1 }); await capture(theme + '-mode-preview'); await dispatch('cancelPendingChange')
        await dispatch('requestDeleteGroup',{index:3});await capture(theme+'-delete-preview');await dispatch('cancelPendingChange')
        await dispatch('requestDeleteGroup',{index:3});await dispatch('confirmPendingChange')
        assert.equal(await browser.evaluate('window.__lightingQa.page._calculationResult.fixtures.length'),count)
        await dispatch('undoDelete');assert.equal(await browser.evaluate('window.__lightingQa.page._calculationResult.fixtures.length'),count+3)
        await click('.save-project-trigger'); await capture(theme + '-save-project')
        await dispatch('onSaveToExistingProject', { projectId: 'project-1' })
        assert.equal(await browser.evaluate('window.__lightingQa.page._contextId'), 'project-1')
        assert.equal(await browser.evaluate('window.__lightingQa.data.currentContextTemporary'), false)
      })
      await test(theme + ': dense real-time placement, locator, settings and export', async () => {
        await browser.viewport(390, 844, theme); await browser.navigate({ theme, page: 'layout', fixture: 'dense' })
        const ids = await browser.evaluate('window.__lightingQa.page._fixtures.slice(0,30).map(f=>f.stableId)')
        const rodId = await browser.evaluate('window.__lightingQa.page._layout.frontRods[0].id')
        await dispatch('onSelectRod', { rodId }); await dispatch('openPlacementPanel')
        for (const fixtureId of ids) await dispatch('onPanelFixtureTap', { fixtureId })
        assert.equal(await browser.evaluate('window.__lightingQa.data.selectedRodCount'), 30)
        await browser.evaluate('document.querySelector(".fixture-selection-list").scrollTop=0')
        await browser.evaluate(`(()=>{const n=document.querySelector('.placement-preview-strip');n.scrollLeft=0;n.dispatchEvent(new Event('scroll',{bubbles:true}));})()`)
        await capture(theme + '-dense-placement')
        const beforeScroll=await browser.evaluate('({left:document.querySelector(".placement-preview-strip").scrollLeft,range:window.__lightingQa.data.previewRangeText})')
        await browser.evaluate(`(()=>{const n=document.querySelector('.placement-preview-strip');n.scrollLeft=560;n.dispatchEvent(new Event('scroll',{bubbles:true}));})()`)
        await capture(theme + '-dense-placement-scroll')
        const afterScroll=await browser.evaluate('({left:document.querySelector(".placement-preview-strip").scrollLeft,dataLeft:window.__lightingQa.data.previewScrollLeft,viewport:window.__lightingQa.data.previewViewportLeft,range:window.__lightingQa.data.previewRangeText})')
        assert(afterScroll.left>beforeScroll.left+100,'The detail rail did not scroll')
        assert(Math.abs(afterScroll.left-afterScroll.dataLeft)<2&&afterScroll.viewport>0,'Detail DOM, data offset and overview viewport diverged')
        assert.notEqual(afterScroll.range,beforeScroll.range,'Visible fixture range did not update')
        await dispatch('closePlacementPanel'); await delay(230)
        await capture(theme + '-layout-placed')
        await dispatch('openLocatePanel'); await dispatch('onSearchInput', {}, { value: 'A001' }); await dispatch('searchFixture'); await capture(theme + '-locate-results')
        assert(await browser.evaluate('window.__lightingQa.data.searchResults.length > 0'))
        await dispatch('onLocateResultTap', { fixtureId: ids[0] }); await delay(380)
        assert.equal(await browser.evaluate('window.__lightingQa.data.placementVisible'), false, 'Locator unexpectedly opened placement')
        assert.equal(await browser.evaluate('window.__lightingQa.data.highlightFixtureId'), ids[0])
        await capture(theme + '-located')
        await dispatch('openLayoutSettings'); await capture(theme + '-layout-settings'); await dispatch('closeLayoutSettings'); await delay(220)
        await dispatch('generateLayoutImage'); await delay(700); await capture(theme + '-export-preview')
        const exported = await browser.evaluate('window.__lightingQa.events.exports.map(e=>({width:e.width,height:e.height,url:e.url}))')
        const plan = await browser.evaluate('({pages:window.__lightingQa.page._exportPages.length,ids:window.__lightingQa.page._exportPages.flatMap(p=>p.rows.filter(r=>r.type==="addresses").flatMap(r=>r.fixtures.map(f=>f.stableId)))})')
        assert.equal(exported.length, plan.pages, 'Planned export pages were not all rendered')
        assert.equal(new Set(plan.ids).size,45,'Export lists lost or duplicated a fixture')
        for (const [index, item] of exported.entries()) fs.writeFileSync(path.join(output, theme + '-export-' + (index + 1) + '.png'), Buffer.from(item.url.split(',')[1], 'base64'))
      })
      await test(theme + ': dense paginated export', async () => {
        await browser.viewport(390,844,theme); await browser.navigate({theme,page:'layout',fixture:'export-dense'})
        await dispatch('generateLayoutImage'); await delay(900)
        const exportInfo=await browser.evaluate('({pages:window.__lightingQa.page._exportPages.length,paths:window.__lightingQa.data.layoutImagePaths.length,ids:window.__lightingQa.page._exportPages.flatMap(p=>p.rows.filter(r=>r.type==="addresses").flatMap(r=>r.fixtures.map(f=>f.stableId)))})')
        assert(exportInfo.pages>1,'Dense export was not paginated')
        assert.equal(exportInfo.paths,exportInfo.pages)
        assert.equal(new Set(exportInfo.ids).size,175)
        await capture(theme+'-export-dense-preview')
        const images=await browser.evaluate('window.__lightingQa.events.exports')
        for(const [index,item]of images.entries())fs.writeFileSync(path.join(output,theme+'-dense-export-'+(index+1)+'.png'),Buffer.from(item.url.split(',')[1],'base64'))
      })
      for (const [width, height] of [[320,568],[430,932]]) await test(`${theme}: responsive ${width}`, async () => {
        await browser.viewport(width,height,theme); await browser.navigate({theme}); await capture(`${theme}-main-${width}`)
        await click('.address-chip'); await capture(`${theme}-floating-${width}`)
        await browser.navigate({theme,page:'layout'}); await capture(`${theme}-layout-${width}`)
        await dispatch('openLayoutSettings'); await capture(`${theme}-settings-${width}`)
      })
      await test(theme+': large floating card stays inside a short viewport',async()=>{
        await browser.viewport(320,568,theme);await browser.navigate({theme,fixture:'export-dense'})
        await click('.address-chip');await capture(theme+'-floating-160-short')
        const box=await browser.evaluate('(()=>{const n=document.querySelector(".floating-chip-scroll");return {height:n.clientHeight,content:n.scrollHeight}})()')
        assert(box.height>40&&box.content>box.height,'Dense floating checks need a usable independent scroll area')
      })
      await test(theme+': empty and search-empty states',async()=>{
        await browser.viewport(390,844,theme);await browser.navigate({theme,fixture:'empty'});await capture(theme+'-empty')
        assert.equal(await browser.evaluate('window.__lightingQa.data.groupCards.length'),0)
        await click('.add-group-button');await dispatch('onFixtureSearchInput',{},{value:'NO_SUCH_LIGHTING_MODEL_12345'});await dispatch('flushFixtureSearch');await capture(theme+'-search-empty')
        assert.equal(await browser.evaluate('window.__lightingQa.data.fixtureSearchResults.length'),0)
      })
      await test(theme+': four apron directions and long dimension labels',async()=>{
        await browser.viewport(390,844,theme);await browser.navigate({theme,page:'layout'})
        for(const direction of ['top','right','bottom','left']){
          await dispatch('openLayoutSettings');await dispatch('onDraftDirectionTap',{direction});await dispatch('applyLayoutSettings')
          await capture(theme+'-stage-'+direction)
        }
        await dispatch('openLayoutSettings');await dispatch('onDraftDirectionTap',{direction:'bottom'});await dispatch('onDraftStageInput',{key:'stageWidthText'},{value:'200'});await dispatch('onDraftStageInput',{key:'stageDepthText'},{value:'100'});await dispatch('applyLayoutSettings')
        await capture(theme+'-stage-large-dimensions')
        const diagramLabels=await browser.evaluate('(()=>{window.__lightingQa.events.canvasTexts.length=0;window.__lightingQa.page.drawLayout();return window.__lightingQa.events.canvasTexts.filter(t=>t.id==="dmxLayoutCanvas")})()')
        const labels=diagramLabels.filter(t=>t.text==='100 m')
        assert.equal(labels.length,1)
        assert(labels[0].left>=14,'Long dimension label clips the actual canvas font')
        for(let i=0;i<diagramLabels.length;i++)for(let j=i+1;j<diagramLabels.length;j++){
          const a=diagramLabels[i],b=diagramLabels[j]
          const overlapX=Math.min(a.right,b.right)-Math.max(a.left,b.left),overlapY=Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)
          assert(overlapX<=1||overlapY<=1,'Large-stage text overlaps with the actual canvas font: '+a.text+' / '+b.text)
        }
        await browser.evaluate('(()=>{const page=window.__lightingQa.page,stage=page.getGeometry().stage,size=page.canvasDimensions();page._view={s:5,x:size.width/2-(stage.left+stage.width/2)*5,y:size.height/2-(stage.top+stage.height)*5};page.drawLayout()})()')
        await capture(theme+'-stage-large-zoomed')
        const zoomLabels=await browser.evaluate('(()=>{window.__lightingQa.events.canvasTexts.length=0;window.__lightingQa.page.drawLayout();return window.__lightingQa.events.canvasTexts.filter(t=>t.id==="dmxLayoutCanvas")})()')
        for(const text of ['灯杆1','灯杆2','灯杆3'])assert(zoomLabels.some(label=>label.text===text),'Allowed 5x zoom must restore '+text)
        for(let i=0;i<zoomLabels.length;i++)for(let j=i+1;j<zoomLabels.length;j++){
          const a=zoomLabels[i],b=zoomLabels[j]
          const overlapX=Math.min(a.right,b.right)-Math.max(a.left,b.left),overlapY=Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)
          assert(overlapX<=1||overlapY<=1,'Allowed zoom text overlaps with the actual canvas font: '+a.text+' / '+b.text)
        }
      })
      await test(theme + ': landscape', async () => {
        await browser.viewport(844,390,theme); await browser.navigate({theme,page:'layout'})
        await browser.evaluate(`window.__openPage('pages/dmx-layout-landscape/dmx-layout-landscape.js')`)
        await capture(theme+'-landscape'); await dispatch('openLayoutSettings'); await capture(theme+'-landscape-settings')
      })
      await test(theme + ': supported reduced-motion CSS fallback', async () => {
        const expectNoMotion = async (selectors) => {
          const values = await browser.evaluate(`(()=>{const selectors=${JSON.stringify(selectors)};return selectors.map(selector=>{const node=document.querySelector(selector);if(!node)return {selector,missing:true};const style=getComputedStyle(node);return {selector,transition:style.transitionDuration,animation:style.animationDuration}})})()`)
          for (const value of values) {
            assert(!value.missing, 'Missing actual motion node: ' + value.selector)
            for (const duration of [value.transition, value.animation].join(',').split(',')) assert.equal(parseFloat(duration), 0, 'Reduced motion still animates ' + value.selector)
          }
        }
        await browser.viewport(390,844,theme,'reduce'); await browser.navigate({theme})
        await click('.address-chip'); await capture(theme+'-reduced-motion-floating')
        await expectNoMotion(['.floating-card','.floating-backdrop','.fixture-card'])
        await browser.navigate({theme,page:'layout'}); await dispatch('openLayoutSettings'); await capture(theme+'-reduced-motion-settings')
        await expectNoMotion(['.overlay','.settings-card'])
        await browser.viewport(844,390,theme,'reduce'); await browser.navigate({theme,page:'layout'})
        await browser.evaluate(`window.__openPage('pages/dmx-layout-landscape/dmx-layout-landscape.js')`)
        await dispatch('openLayoutSettings'); await expectNoMotion(['.overlay','.settings-card'])
      })
    }
  } finally {
    fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify({ runAt: new Date().toISOString(), passed: results.every(item => item.passed), results, scenes }, null, 2))
    await browser.close()
  }
  assert(results.every(item => item.passed), 'Browser adapter checks failed; see summary.json')
}
run().catch(error => { console.error(error); process.exitCode = 1 })
