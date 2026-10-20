// Focused visual/browser-adapter checks for the lighting UI. This is not WeChat native QA.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { launch, delay } = require('./browser-driver.cjs')

const output = path.resolve(__dirname, '../dmx-ui-native-fixes-2026-10-18/evidence/browser-fixes')
const phase = process.argv[2] || 'main'
fs.mkdirSync(output, { recursive: true })

async function run() {
  const browser = await launch()
  const results = [], scenes = [], exports = []
  const evaluate = expression => browser.evaluate(expression)
  const dispatch = (method, dataset = {}, detail = {}, extra = {}) => evaluate(`window.__dispatch(${JSON.stringify(method)},${JSON.stringify(dataset)},${JSON.stringify(detail)},${JSON.stringify(extra)})`)
  const click = selector => evaluate(`(()=>{const node=document.querySelector(${JSON.stringify(selector)});if(!node)throw Error('Missing browser target: '+${JSON.stringify(selector)});node.click()})()`)

  async function capture(name) {
    await delay(220)
    const facts = await evaluate('window.__facts()')
    assert.deepEqual(facts.errors, [], name + ': WXML evaluation errors')
    assert.deepEqual(facts.runtimeErrors, [], name + ': controller/runtime errors')
    assert(facts.pageWidth <= facts.width + 1, name + ': page has horizontal overflow')
    const file = path.join(output, name + '.png')
    await browser.screenshot(file)
    scenes.push({ name, file, width: facts.width, height: facts.height, pageWidth: facts.pageWidth, background: facts.background })
    console.log('CAPTURE ' + name)
    return facts
  }

  async function check(name, body) {
    try { await body(); results.push({ name, passed: true }); console.log('PASS ' + name) }
    catch (error) { results.push({ name, passed: false, error: error.stack || String(error) }); console.error('FAIL ' + name + ': ' + error.message) }
  }

  async function openAddPreview(theme, width, quantity) {
    await browser.viewport(width, 844, theme)
    await browser.navigate({ theme, fixture: 'empty' })
    await click('.add-group-button')
    await delay(80)
    await dispatch('onFixtureSearchInput', {}, { value: 'TL-SL323' })
    await dispatch('flushFixtureSearch')
    await delay(60)
    await click('.fixture-search-row')
    await delay(60)
    await dispatch('onPendingQuantityInput', {}, { value: String(quantity) })
    await dispatch('onPendingQuantityBlur')
    await delay(100)
    return await evaluate(`(()=>{
      const chips=[...document.querySelectorAll('.add-preview-chips .address-chip')]
      const box=document.querySelector('.add-preview-chips')
      const scroll=document.querySelector('.add-preview-chip-scroll')
      const sheet=document.querySelector('.add-confirm-sheet')
      const rects=chips.map(n=>{const r=n.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height}})
      const grid=box&&getComputedStyle(box),sr=sheet?.getBoundingClientRect(),cr=scroll?.getBoundingClientRect()
      return {
        count:chips.length,
        columns:grid?grid.gridTemplateColumns.trim().split(/\\s+/).length:0,
        display:grid?.display,
        rects,
        scroll:scroll?{x:cr.x,right:cr.right,clientWidth:scroll.clientWidth,scrollWidth:scroll.scrollWidth,clientHeight:scroll.clientHeight,scrollHeight:scroll.scrollHeight,scrollTop:scroll.scrollTop}:null,
        sheet:sr?{x:sr.x,y:sr.y,right:sr.right,bottom:sr.bottom,width:sr.width,height:sr.height}:null,
        viewport:{width:innerWidth,height:innerHeight},
        valid:window.__lightingQa.data.pendingChange?.valid,
        quantity:window.__lightingQa.data.pendingChange?.addPreview?.fixtureCountValue,
        totalChannels:window.__lightingQa.data.pendingChange?.addPreview?.totalChannels
      }
    })()`)
  }

  try {
    if (phase === 'main' || phase === 'all') {
      for (const theme of ['light', 'dark']) for (const width of [320, 390]) {
        await check(`${theme} ${width}px add preview uses eight columns for twelve fixtures`, async () => {
          const metrics = await openAddPreview(theme, width, 12)
          await capture(`add-12-${theme}-${width}`)
          assert.equal(metrics.count, 12, 'preview should contain twelve actual calculated chips')
          assert.equal(metrics.columns, 8, 'preview uses eight equal grid columns')
          assert.equal(metrics.display, 'grid')
          assert(metrics.scroll, 'the preview chip scroll view should be present')
          assert(metrics.rects.every(chip => chip.width > 0 && chip.x >= metrics.scroll.x - 1 && chip.right <= metrics.scroll.right + 1), 'each chip must fit within the preview viewport')
          const firstRowY = metrics.rects[0].y
          assert(metrics.rects.slice(0, 8).every(chip => Math.abs(chip.y - firstRowY) < 1), 'the first row should contain eight chips')
          assert(metrics.rects.slice(8).every(chip => chip.y > firstRowY + 10), 'the remaining four chips should wrap to row two')
          assert(metrics.sheet.x >= -1 && metrics.sheet.right <= width + 1, 'add preview sheet should fit this viewport width')
          assert(metrics.scroll.scrollWidth <= metrics.scroll.clientWidth + 1, 'preview chip grid should not scroll horizontally')
          assert.equal(metrics.valid, true)
          assert.equal(metrics.quantity, 12)
          assert.equal(metrics.totalChannels, 24)
        })
      }

      await check('dark fixture search result model uses readable text color', async () => {
        await browser.viewport(390, 844, 'dark')
        await browser.navigate({ theme: 'dark', fixture: 'empty' })
        await click('.add-group-button')
        await delay(80)
        await dispatch('onFixtureSearchInput', {}, { value: 'TL-SL323' })
        await dispatch('flushFixtureSearch')
        await delay(70)
        const color = await evaluate(`getComputedStyle(document.querySelector('.fixture-result-model')).color`)
        await capture('search-model-dark-390')
        assert.equal(color, 'rgb(255, 255, 255)')
      })

      for (const theme of ['light', 'dark']) {
        await check(`${theme} 200-fixture preview scrolls vertically inside the sheet`, async () => {
          const metrics = await openAddPreview(theme, 390, 200)
          assert.equal(metrics.count, 200)
          assert.equal(metrics.quantity, 200)
          assert.equal(metrics.totalChannels, 400)
          assert(metrics.scroll.clientHeight > 0, 'preview scroll viewport must have nonzero height')
          assert(metrics.scroll.scrollHeight > metrics.scroll.clientHeight, '200 chips should require vertical scrolling')
          const scrolled = await evaluate(`(()=>{const n=document.querySelector('.add-preview-chip-scroll');n.scrollTop=n.scrollHeight;n.dispatchEvent(new Event('scroll',{bubbles:true}));const r=document.querySelector('.add-confirm-sheet').getBoundingClientRect();return{scrollTop:n.scrollTop,clientHeight:n.clientHeight,scrollHeight:n.scrollHeight,scrollWidth:n.scrollWidth,clientWidth:n.clientWidth,sheet:{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height},viewport:{width:innerWidth,height:innerHeight}}})()`)
          await capture(`add-200-scrolled-${theme}-390`)
          assert(scrolled.scrollTop > 0, 'scroll position should advance for the 200-fixture list')
          assert(scrolled.scrollWidth <= scrolled.clientWidth + 1, '200-fixture preview should not overflow horizontally')
          assert(scrolled.sheet.x >= -1 && scrolled.sheet.right <= 391 && scrolled.sheet.y >= -1 && scrolled.sheet.bottom <= 845, 'scrolling chips should remain inside the sheet and viewport')
          scenes.push({ name: `add-200-scroll-metrics-${theme}-390`, ...scrolled })
        })
      }

      for (const theme of ['light', 'dark']) {
        await check(`${theme} actual touch swipe reveals the red delete action`, async () => {
          await browser.viewport(390, 844, theme)
          await browser.navigate({ theme })
          const bounds = await evaluate(`(()=>{const n=document.querySelector('.fixture-card');const r=n.getBoundingClientRect();return{x:r.right-24,y:r.y+r.height/2,left:r.left,right:r.right,width:r.width,height:r.height}})()`)
          await browser.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 })
          const point = (x, y) => ({ id: 1, x: Math.round(x), y: Math.round(y), radiusX: 2, radiusY: 2, force: 1 })
          await browser.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point(bounds.x, bounds.y)] })
          await delay(40)
          await browser.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point(bounds.x - 100, bounds.y)] })
          await delay(50)
          await browser.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
          await delay(380)
          const state = await evaluate(`(()=>{
            const wrap=document.querySelector('.group-swipe-wrap'),card=document.querySelector('.fixture-card'),button=document.querySelector('.swipe-delete')
            const wr=wrap.getBoundingClientRect(),cr=card.getBoundingClientRect(),br=button?.getBoundingClientRect(),style=button&&getComputedStyle(button)
            return {
              index:window.__lightingQa.data.swipedGroupIndex,
              touchStart:window.__lightingQa.page._groupTouchStart,
              wrapperMarkup:wrap.outerHTML.slice(0,700),
              wrapper:{left:wr.left,right:wr.right},
              card:{left:cr.left,right:cr.right,transform:getComputedStyle(card).transform},
              button:br?{left:br.left,right:br.right,width:br.width,background:style.backgroundColor,color:style.color}:null
            }
          })()`)
          await capture(`swipe-delete-${theme}-390`)
          assert.equal(state.index, 0)
          assert(state.button, 'swipe should reveal the delete button: ' + JSON.stringify(state))
          assert.equal(state.button.background, 'rgb(255, 59, 48)')
          assert.equal(state.button.color, 'rgb(255, 255, 255)')
          assert(Math.abs(state.button.width - 76) < 1, 'delete target should retain its full 76 CSS-pixel width')
          assert(state.card.right <= state.button.left + 1, 'the fixture card should slide far enough to expose the full delete target: ' + JSON.stringify(state))
          assert(state.button.right <= state.wrapper.right + 1, 'delete action should stay within its row')
        })
      }
    }

    if (phase === 'layout' || phase === 'all') {
      for (const theme of ['light', 'dark']) {
        await check(`${theme} layout panorama, settings, locator and raw 2D export`, async () => {
          await browser.viewport(390, 844, theme)
          await browser.navigate({ theme, page: 'layout' })
          await delay(180)
          const beforeProbe = await evaluate(`(()=>{const n=document.getElementById('dmxLayoutCanvas');return{width:n?.width,height:n?.height,widthAttr:n?.getAttribute('width'),heightAttr:n?.getAttribute('height')}})()`)
          await evaluate(`window.__lightingQa.page.setData({__qaCanvasBackingProbe:true})`)
          await delay(70)
          const panorama = await evaluate(`(()=>{
            const page=window.__lightingQa.page,node=document.getElementById('dmxLayoutCanvas'),shell=document.getElementById('dmxLayoutCanvasShell'),r=shell.getBoundingClientRect(),cr=node.getBoundingClientRect(),geometry=page._geometry||{},stage=geometry.stage||{}
            const textCalls=window.__lightingQa.events.rawCanvasTexts.filter(item=>item.canvasId==='dmxLayoutCanvas').map(item=>item.text)
            return{node:!!node,raw2d:!!node?.getContext('2d'),hasRaf:typeof node?.requestAnimationFrame==='function',canvas:{width:node?.width,height:node?.height,clientWidth:cr.width,clientHeight:cr.height,widthAttr:node?.getAttribute('width'),heightAttr:node?.getAttribute('height')},shell:{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height},view:{...page._view},fixtures:page._fixtures.length,rods:{internal:page._layout.internalRods||[],front:page._layout.frontRods||[]},positions:Object.keys(page._layout.positionsById||{}).length,stage:{left:stage.left,top:stage.top,right:stage.left+stage.width,bottom:stage.top+stage.height,canvasWidth:geometry.canvasWidth,canvasHeight:geometry.canvasHeight},annotations:{apron:geometry.apronLabel?.text,audience:geometry.audience?.text,textCalls}}
          })()`)
          await capture(`layout-panorama-${theme}-390`)
          assert(panorama.node && panorama.raw2d && panorama.hasRaf, 'layout should bind its real HTML canvas and browser RAF shim: ' + JSON.stringify(panorama))
          assert(panorama.shell.width > 0 && panorama.shell.height > 0 && panorama.canvas.width > 0 && panorama.canvas.height > 0, 'default stage panorama should have a measured canvas')
          assert.deepEqual({width:panorama.canvas.width,height:panorama.canvas.height},{width:beforeProbe.width,height:beforeProbe.height},'unrelated setData must retain the configured backing dimensions')
          assert(Math.abs(panorama.canvas.width-panorama.shell.width)<=1&&Math.abs(panorama.canvas.height-panorama.shell.height)<=1,'canvas backing dimensions should match its measured stage viewport at the test pixel ratio')
          assert(panorama.stage.left>=0&&panorama.stage.top>=0&&panorama.stage.right<=panorama.canvas.width+1&&panorama.stage.bottom<=panorama.canvas.height+1,'stage bounds should remain inside the canvas viewport')
          assert(panorama.shell.x>=0&&panorama.shell.y>=0&&panorama.shell.right<=391&&panorama.shell.bottom<=845,'stage canvas shell should fit inside the browser viewport')
          for(const label of ['台口','观众区','12 m','8 m'])assert(panorama.annotations.textCalls.includes(label),`raw canvas draw should include the ${label} stage annotation`)
          assert.equal(panorama.fixtures, 27)
          scenes.push({name:`layout-panorama-geometry-${theme}-390`,beforeProbe,...panorama})

          await dispatch('openLayoutSettings')
          await capture(`layout-settings-${theme}-390`)
          const settings = await evaluate(`(()=>{
            const n=document.querySelector('.settings-card'),scroll=document.querySelector('.settings-scroll'),apply=document.querySelector('.settings-apply'),r=n.getBoundingClientRect()
            scroll.scrollTop=scroll.scrollHeight
            const sr=scroll.getBoundingClientRect(),ar=apply.getBoundingClientRect(),choices=[...document.querySelectorAll('.arrangement-choice')].map(choice=>{const b=choice.getBoundingClientRect();return{text:choice.textContent.trim(),visible:b.width>0&&b.height>0&&b.top>=sr.top-1&&b.bottom<=sr.bottom+1}})
            return{visible:!!n&&r.width>0&&r.height>0,rect:{x:r.x,y:r.y,right:r.right,bottom:r.bottom},scroll:{top:scroll.scrollTop,height:scroll.clientHeight,scrollHeight:scroll.scrollHeight,rect:{top:sr.top,bottom:sr.bottom}},choices,apply:{x:ar.x,right:ar.right,width:ar.width,parentWidth:document.querySelector('.settings-actions').getBoundingClientRect().width}}
          })()`)
          assert(settings.visible, 'layout settings should be visible')
          assert.equal(settings.choices.length, 2, 'settings should retain both arrangement choices')
          assert(settings.choices.every(choice => choice.visible), 'both arrangement choices should be visible at the bottom of the settings scroll area')
          assert(settings.apply.width >= settings.apply.parentWidth - 40, 'apply button should span the padded settings action area: ' + JSON.stringify(settings))
          assert(settings.apply.width > 250 && settings.apply.x >= settings.rect.x && settings.apply.right <= settings.rect.right, 'apply button should remain a wide in-bounds action')
          await capture(`layout-settings-bottom-${theme}-390`)
          scenes.push({name:`layout-settings-bottom-metrics-${theme}-390`,...settings})

          await dispatch('closeLayoutSettings')
          await delay(250)
          const beforePlacement = await evaluate(`(()=>{const page=window.__lightingQa.page;return{rodCount:(page._layout.internalRods||[]).length+(page._layout.frontRods||[]).length,positionCount:Object.keys(page._layout.positionsById||{}).length}})()`)
          await dispatch('openPlacementPanel')
          const placementPanel = await evaluate(`(()=>({visible:!!document.querySelector('.placement-card'),chips:document.querySelectorAll('.fixture-address-chip').length}))()`)
          assert(placementPanel.visible && placementPanel.chips > 0, 'placement panel should expose fixture chips through the real placement flow')
          await click('.fixture-address-chip')
          await delay(180)
          const placement = await evaluate(`(()=>{const page=window.__lightingQa.page,id=page.data.selectedFixtureId;return{id,placed:!!page._layout.positionsById?.[id],positionCount:Object.keys(page._layout.positionsById||{}).length,rodCount:(page._layout.internalRods||[]).length+(page._layout.frontRods||[]).length,placementVisible:page.data.placementVisible,positions:JSON.stringify(page._layout.positionsById||{})}})()`)
          assert(beforePlacement.rodCount > 0, 'default workspace should expose at least one rod for placement')
          assert(placement.id && placement.placed && placement.positionCount === beforePlacement.positionCount + 1, 'a fixture should be placed through the visible placement chip')
          scenes.push({name:`layout-placement-metrics-${theme}-390`,beforePlacement,placement})
          const target = placement.id
          await dispatch('closePlacementPanel')
          await delay(250)
          const positionsBeforeLocate = await evaluate('JSON.stringify(window.__lightingQa.page._layout.positionsById||{})')
          const viewBeforeLocate = await evaluate('JSON.stringify(window.__lightingQa.page._view)')
          await dispatch('openLocatePanel')
          const targetAddress = await evaluate(`window.__lightingQa.page._fixtures.find(fixture=>String(fixture.stableId)===${JSON.stringify(target)})?.addressText`)
          await dispatch('onSearchInput', {}, { value: targetAddress })
          await dispatch('searchFixture')
          await capture(`layout-locator-${theme}-390`)
          const searchResults = await evaluate('window.__lightingQa.data.searchResults.length')
          assert(searchResults > 0, 'locator should show matching fixtures')
          await dispatch('onLocateResultTap', { fixtureId: target })
          await delay(420)
          await capture(`layout-located-${theme}-390`)
          assert.equal(await evaluate('window.__lightingQa.data.selectedFixtureId'), target)
          assert.equal(await evaluate('window.__lightingQa.data.highlightFixtureId'), target)
          assert.equal(await evaluate('window.__lightingQa.data.locateVisible'), false)
          const locateEffect = await evaluate(`(()=>({view:JSON.stringify(window.__lightingQa.page._view),positions:JSON.stringify(window.__lightingQa.page._layout.positionsById||{})}))()`)
          assert.notEqual(locateEffect.view, viewBeforeLocate, 'locating a placed fixture should change the canvas view')
          assert.equal(locateEffect.positions, positionsBeforeLocate, 'locating a fixture must not mutate its saved position')
          scenes.push({name:`layout-locate-effect-${theme}-390`,positionsBeforeLocate,viewBeforeLocate,...locateEffect})

          await dispatch('generateLayoutImage')
          await delay(650)
          await capture(`layout-raw2d-export-${theme}-390`)
          const imageInfos = await evaluate(`window.__lightingQa.events.exports.map(item=>({width:item.width,height:item.height,url:item.url}))`)
          assert(imageInfos.length > 0, 'raw 2D export should produce a PNG page')
          for (const [index, item] of imageInfos.entries()) {
            assert(item.url.startsWith('data:image/png;base64,'), 'export should be a PNG data URL')
            const file = path.join(output, `layout-export-${theme}-${index + 1}.png`)
            fs.writeFileSync(file, Buffer.from(item.url.split(',')[1], 'base64'))
            const pixels = await evaluate(`(async()=>{const src=${JSON.stringify(item.url)};const image=new Image();await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=reject;image.src=src});const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;const context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(image,0,0);const data=context.getImageData(0,0,canvas.width,canvas.height).data;let opaque=0,nonWhite=0;const colors=new Set();for(let i=0;i<data.length;i+=4){if(data[i+3])opaque++;if(data[i]<245||data[i+1]<245||data[i+2]<245)nonWhite++;if(colors.size<4096)colors.add(data[i]+','+data[i+1]+','+data[i+2]+','+data[i+3])}return{width:image.naturalWidth,height:image.naturalHeight,pixels:canvas.width*canvas.height,opaquePixels:opaque,nonWhitePixels:nonWhite,sampledDistinctRgba:colors.size}})()`)
            assert(pixels.width > 0 && pixels.height > 0 && pixels.opaquePixels > 0 && pixels.nonWhitePixels > 0, 'export PNG must contain actual nonblank pixels')
            exports.push({ theme, index: index + 1, file, width: item.width, height: item.height, pixels })
          }
        })
      }
    }
  } finally {
    fs.writeFileSync(path.join(output, `${phase}-summary.json`), JSON.stringify({ runAt: new Date().toISOString(), phase, browserAdapter: true, nativeRuntime: false, physicalDevice: false, passed: results.every(item => item.passed), results, scenes, exports }, null, 2))
    await browser.close()
  }
  assert(results.every(item => item.passed), 'Focused browser checks failed; see evidence/browser-fixes/' + phase + '-summary.json')
}

run().catch(error => { console.error(error); process.exitCode = 1 })
