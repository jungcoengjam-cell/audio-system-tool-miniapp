'use strict'

const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const seed = require('./qa-report-seed.cjs')
const { launch, delay } = require('../browser-driver.cjs')

const root = path.resolve(__dirname, '../../..')
const evidence = path.join(__dirname, 'evidence', 'report-bridges')
const productionFiles = [
  'app.wxss', 'pages/records/report.js', 'pages/records/report-model.js', 'pages/records/report-snapshot-adapter.js',
  'pages/records/report-renderer.js', 'pages/records/report.wxml', 'pages/records/report.wxss',
  'pages/audio-wiring/report-bridge.js', 'pages/audio-wiring/wiring-photos.js', 'pages/audio-wiring/wiring-renderer.js',
  'pages/project-wiring/report-bridge.js', 'pages/project-wiring/report.js',
  'pages/dmx-layout/layout-model.js', 'pages/dmx-layout/layout-renderer.js', 'pages/dmx-layout/lighting-workspace.js',
  'utils/report-drawing.js',
  'tests/homepage-refactor-2026-10-18/prepare-qa.cjs', 'tests/homepage-refactor-2026-10-18/browser-host.cjs',
  'tests/homepage-refactor-2026-10-18/browser.html', 'tests/homepage-refactor-2026-10-18/browser.js',
  'tests/homepage-refactor-2026-10-18/revision-2/browser-runtime-patches.cjs',
  'tests/homepage-refactor-2026-10-18/qa-seed-report.cjs', 'tests/homepage-refactor-2026-10-18/revision-2/qa-report-seed.cjs',
]

function getProductionHashes() {
  return Object.fromEntries(productionFiles.map(file => [file,
    crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')]))
}

function getCombinedHash(fileHashes) {
  return crypto.createHash('sha256').update(JSON.stringify(fileHashes)).digest('hex')
}

async function waitForPageImage(browser, expectedIndex, expectedCount) {
  let facts
  for (let attempt = 0; attempt < 50; attempt++) {
    facts = await browser.evaluate(`(() => {
      const page=__homepageQa.page, image=document.querySelector('.report-preview-image'), index=page.data.currentPageIndex
      const expected=page.data.reportPages?.[index]?.path||''
      return {index,number:page.data.currentPageNumber,count:page.data.pageCount,
        itemId:page.data.reportPages?.[index]?.itemId||'',
        pageWidth:Number(page.data.reportPages?.[index]?.width)||0,
        pageHeight:Number(page.data.reportPages?.[index]?.height)||0,
        pathPresent:Boolean(page.data.currentPagePath),sourceMatches:page.data.currentPagePath===expected,
        elementMatches:image?.getAttribute('src')===expected,complete:Boolean(image?.complete),
        naturalWidth:image?.naturalWidth||0,naturalHeight:image?.naturalHeight||0}
    })()`)
    if (facts.index === expectedIndex && facts.number === expectedIndex + 1 && facts.count === expectedCount
      && facts.pathPresent && facts.sourceMatches && facts.elementMatches && facts.complete
      && facts.naturalWidth > 0 && facts.naturalHeight > 0) return facts
    await delay(50)
  }
  throw new Error(`Report page ${expectedIndex + 1}/${expectedCount} image did not load: ${JSON.stringify(facts)}`)
}

async function clickNextReportPage(browser) {
  const clicked = await browser.evaluate(`(() => {
    const button=document.querySelector('.report-page-nav button:last-child')
    if(!button||button.disabled)return false
    button.click();return true
  })()`)
  assert.equal(clicked, true, 'next page button should be available before the last page')
}

async function inspectAllReportPages(browser, pageCount) {
  const pages = []
  for (let index = 0; index < pageCount; index++) {
    const facts = await waitForPageImage(browser, index, pageCount)
    pages.push(facts)
    if (index < pageCount - 1) {
      await clickNextReportPage(browser)
      await delay(25)
    }
  }
  return pages
}

async function captureUiVariant(browser, width, theme, pageCount, variantHash) {
  const name = `${width}-${theme}`
  await browser.viewport(width, 844, theme)
  await delay(80)
  let mode = await browser.evaluate('__homepageQa.page.data.mode')
  if (mode === 'preview') {
    await browser.evaluate(`document.querySelector('.report-return-selection').click();true`)
    await delay(70)
  }
  const selection = await browser.evaluate(`(() => {
    const page=__homepageQa.page, button=document.querySelector('.report-generate-button'), row=document.querySelector('.report-selection-footer')
    const box=button?.getBoundingClientRect()
    return {mode:page.data.mode,selectedCount:page.data.selectedCount,totalCount:page.data.totalCount,
      button:box?{width:box.width,height:box.height,computedWidth:getComputedStyle(button).width}:null,
      scrollWidth:document.documentElement.scrollWidth,viewportWidth:innerWidth}
  })()`)
  assert.equal(selection.mode, 'select', `${name} selection page should be visible`)
  assert.equal(selection.selectedCount, selection.totalCount, `${name} selection page should retain all report items`)
  assert(selection.button && selection.button.width > 184 && selection.button.height >= 44,
    `${name} generate button should override the WeChat default: ${JSON.stringify(selection)}`)
  assert(selection.scrollWidth <= selection.viewportWidth, `${name} selection page should not overflow horizontally`)
  await browser.screenshot(path.join(evidence, `selection-${name}.png`))

  await browser.evaluate(`document.querySelector('.report-generate-button').click();true`)
  const firstPage = await waitForPageImage(browser, 0, pageCount)
  await browser.screenshot(path.join(evidence, `first-${name}.png`))
  for (let index = 1; index < pageCount; index++) {
    await clickNextReportPage(browser)
    await delay(25)
  }
  const lastPage = await waitForPageImage(browser, pageCount - 1, pageCount)
  const preview = await browser.evaluate(`(() => {
    const row=document.querySelector('.report-preview-actions'), buttons=[...document.querySelectorAll('.report-preview-action')]
    const rowBox=row?.getBoundingClientRect()
    return {mode:__homepageQa.page.data.mode,pageNumber:__homepageQa.page.data.currentPageNumber,
      pageCount:__homepageQa.page.data.pageCount,row:rowBox?{left:rowBox.left,right:rowBox.right,width:rowBox.width}:null,
      buttons:buttons.map(button=>{const box=button.getBoundingClientRect();return {width:box.width,height:box.height,left:box.left,right:box.right}}),
      scrollWidth:document.documentElement.scrollWidth,viewportWidth:innerWidth}
  })()`)
  assert.equal(preview.mode, 'preview')
  assert.equal(preview.pageNumber, pageCount)
  assert.equal(preview.pageCount, pageCount)
  assert.equal(preview.buttons.length, 2)
  assert(preview.buttons.every(button => button.height >= 44 && button.width < 184),
    `${name} preview actions should fit the row and override the native width: ${JSON.stringify(preview.buttons)}`)
  assert(Math.abs(preview.buttons[0].left - preview.row.left) < 2)
  assert(Math.abs(preview.buttons[1].right - preview.row.right) < 2)
  assert(preview.scrollWidth <= preview.viewportWidth, `${name} preview should not overflow horizontally`)
  await browser.screenshot(path.join(evidence, `last-${name}.png`))
  return { width, theme, sourceHash:variantHash, selection, firstPage, lastPage, preview,
    screenshots:[`selection-${name}.png`,`first-${name}.png`,`last-${name}.png`] }
}

async function saveRealEventExports(browser, exportCount) {
  const exportDir = path.join(evidence, 'png-exports')
  fs.mkdirSync(exportDir, { recursive: true })
  for (const name of fs.readdirSync(exportDir)) {
    if (/^event-export-\d+\.png$/.test(name)) fs.unlinkSync(path.join(exportDir, name))
  }
  const metadata = await browser.evaluate(`__homepageQa.events.exports.map(({width,height,sourceWidth,sourceHeight,sourceAttributeWidth,sourceAttributeHeight,canvasId,page,addressLabels,addressTextDraws})=>({width,height,sourceWidth,sourceHeight,sourceAttributeWidth,sourceAttributeHeight,canvasId,page,addressLabels,addressTextDraws}))`)
  assert.equal(metadata.length, exportCount, 'every recorded canvas export should be available for preservation')
  const files = []
  for (let index = 0; index < metadata.length; index++) {
    const dataUrl = await browser.evaluate(`__homepageQa.events.exports[${index}].url`)
    const match = /^data:image\/png;base64,([\s\S]+)$/.exec(dataUrl || '')
    assert(match, `canvas export ${index + 1} must be the original PNG data URL`)
    const bytes = Buffer.from(match[1], 'base64')
    assert(bytes.length > 24 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])),
      `canvas export ${index + 1} must contain a valid PNG signature`)
    const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20)
    assert.equal(width, metadata[index].width, `canvas export ${index + 1} width`)
    assert.equal(height, metadata[index].height, `canvas export ${index + 1} height`)
    const file = `event-export-${String(index + 1).padStart(2, '0')}.png`
    fs.writeFileSync(path.join(exportDir, file), bytes)
    files.push({ index, ...metadata[index], file:`png-exports/${file}`, bytes:bytes.length,
      sha256:crypto.createHash('sha256').update(bytes).digest('hex') })
  }
  return files
}

async function inspectLightingPngPixels(browser, exportIndex) {
  return browser.evaluate(`(async()=>{
    const source=__homepageQa.events.exports[${exportIndex}], image=new Image()
    image.src=source.url; await image.decode()
    const canvas=document.createElement('canvas'); canvas.width=image.naturalWidth; canvas.height=image.naturalHeight
    const context=canvas.getContext('2d'); context.drawImage(image,0,0)
    const x=image.naturalWidth-1,y=Math.min(580,image.naturalHeight-1)
    return {width:image.naturalWidth,height:image.naturalHeight,rightEdge:{x,y,rgba:[...context.getImageData(x,y,1,1).data]},
      addressLabels:source.addressLabels,addressTextDraws:source.addressTextDraws||[]}
  })()`)
}

async function main() {
  fs.mkdirSync(evidence, { recursive: true })
  const sourceHashes = getProductionHashes()
  const sourceHash = getCombinedHash(sourceHashes)
  const browser = await launch()
  try {
    await browser.viewport(390, 844, 'light')
    await browser.navigate({ entry:'pages/records/report.js', seed:'report-v2', id:seed.projectId })
    const initial = await browser.evaluate(`(() => {
      const button=document.querySelector('.report-generate-button'), row=document.querySelector('.report-selection-footer')
      const rect=button?.getBoundingClientRect(), parent=row?.getBoundingClientRect()
      return {ready:document.documentElement.dataset.ready,mode:__lightingQa.page?.data?.mode,hasSelection:__lightingQa.page?.data?.hasSelection,
        button:button?{width:rect.width,height:rect.height,computedWidth:getComputedStyle(button).width,disabled:button.disabled}:null,
        footer:parent?{width:parent.width,left:parent.left}:null,errors:__lightingQa.events.errors}
    })()`)
    assert.equal(initial.ready, 'true')
    assert.equal(initial.mode, 'select')
    assert.equal(initial.hasSelection, true)
    assert.ok(initial.button && initial.footer, 'the real report-selection UI must render')
    assert.ok(initial.button.width > 184, `generate action was squeezed by the 184px button default: ${initial.button.width}px`)
    assert.ok(initial.button.height >= 44, `generate action is shorter than 44px: ${initial.button.height}px`)
    console.log('Rendered report selection UI:', JSON.stringify(initial))

    await browser.evaluate(`document.querySelector('.report-generate-button').click()`)
    let result
    for (let attempt = 0; attempt < 360; attempt++) {
      result = await browser.evaluate(`(() => {
        const page=__lightingQa.page, data=page?.data||{}, state=__qaNavigationState(), ev=__lightingQa.events
        return {mode:data.mode,isGenerating:data.isGenerating,pageCount:data.pageCount,hasCurrentPagePath:Boolean(data.currentPagePath),
          pageStatus:data.pageStatus,renderProgressText:data.renderProgressText,selectedCount:data.selectedCount,
          current:state.current,stack:state.stack,lifecycle:state.lifecycle,channels:state.channels,
          events:{navigations:ev.navigations,navigationStack:ev.navigationStack,
            canvasContexts:ev.canvasContexts,canvasDrawImages:ev.canvasDrawImages,imageInfo:ev.imageInfo,
            canvasExports:ev.exports.map(({width,height,sourceWidth,sourceHeight,sourceAttributeWidth,sourceAttributeHeight,canvasId,page,addressLabels,addressTextDraws})=>({width,height,sourceWidth,sourceHeight,sourceAttributeWidth,sourceAttributeHeight,canvasId,page,addressLabels,addressTextDraws})),
            exportCount:ev.exports.length,errors:ev.errors,toasts:ev.toasts},
          adapterErrors:__facts().errors,errorText:document.getElementById('error').textContent}
      })()`)
      if (result.mode === 'preview' && result.pageCount > 0 && result.hasCurrentPagePath && !result.isGenerating) break
      if (result.events.errors.length) throw new Error('Browser adapter runtime error: ' + result.events.errors.join('\n'))
      await delay(500)
    }
    assert.equal(result.mode, 'preview', `the production report page should reach its preview after both bridge batches; final state: ${JSON.stringify(result)}`)
    assert.ok(result.pageCount > 0)
    assert.equal(result.current, 'pages/records/report.js')
    assert.deepEqual(result.stack, [], 'the parent report page should be restored as the sole active page')
    for (const route of ['pages/audio-wiring/report-bridge.js', 'pages/project-wiring/report-bridge.js']) {
      assert.ok(result.events.navigationStack.some(item => item.to === route && item.action === 'navigateTo'), `${route} should be loaded by real wx.navigateTo`)
      assert.ok(result.lifecycle.some(item => item.page === route && item.action === 'onLoad'), `${route} onLoad should run`)
      assert.ok(result.lifecycle.some(item => item.page === route && item.action === 'onUnload'), `${route} onUnload should run`)
    }
    assert.ok(result.lifecycle.filter(item => item.page === 'pages/records/report.js' && item.action === 'onHide').length >= 2)
    assert.ok(result.lifecycle.filter(item => item.page === 'pages/records/report.js' && item.action === 'onShow').length >= 2)
    assert.deepEqual(result.events.navigationStack.map(item => `${item.action}:${item.action === 'navigateTo' ? item.to : item.from}`), [
      'navigateTo:pages/audio-wiring/report-bridge.js',
      'navigateBack:pages/audio-wiring/report-bridge.js',
      'navigateTo:pages/project-wiring/report-bridge.js',
      'navigateBack:pages/project-wiring/report-bridge.js',
    ], 'the first child must pop before the next bridge opens')
    const audioUnload = result.lifecycle.findIndex(item => item.page === 'pages/audio-wiring/report-bridge.js' && item.action === 'onUnload')
    const parentShowAfterAudio = result.lifecycle.findIndex((item, index) => index > audioUnload && item.page === 'pages/records/report.js' && item.action === 'onShow')
    const projectLoad = result.lifecycle.findIndex(item => item.page === 'pages/project-wiring/report-bridge.js' && item.action === 'onLoad')
    assert(audioUnload >= 0 && parentShowAfterAudio > audioUnload && projectLoad > parentShowAfterAudio,
      'the report page must resume onShow after audio pop before starting the project bridge')
    const bridgeResults = result.channels.filter(item => item.action === 'emit' && item.name === 'report-bridge-result')
      .map(item => item.result)
    const audioResult = bridgeResults.find(item => item.bridge === 'audioWiring')
    const projectResult = bridgeResults.find(item => item.bridge === 'projectWiring')
    assert.equal(bridgeResults.length, 2, 'both report bridge batches should emit one terminal result')
    assert(audioResult?.ok && audioResult.itemIds.includes('record:record-report-audio-wiring') && audioResult.pageCount > 0,
      `the selected audio wiring item should return its image pages: ${JSON.stringify(audioResult)}`)
    assert(projectResult?.ok && projectResult.itemIds.includes('__projectWiring__') && projectResult.pageCount > 0,
      `the selected project wiring bundle should return its image pages: ${JSON.stringify(projectResult)}`)
    assert.equal(projectResult.lineIds.length, 2, 'both selected project wiring lines should be present in the returned image bundle')
    assert.ok(result.events.canvasContexts.some(item => item.id === 'audioWiringReportBridgeCanvas' && item.page === 'pages/audio-wiring/report-bridge.js' && item.found))
    assert.ok(result.events.canvasContexts.some(item => item.id === 'projectWiringReportBridgeCanvas' && item.page === 'pages/project-wiring/report-bridge.js' && item.found))
    assert.ok(result.events.canvasDrawImages.some(item => item.page === 'pages/audio-wiring/report-bridge.js' && item.loaded),
      'the audio bridge should draw a source-backed image loaded through wx.getImageInfo')
    assert.ok(result.events.imageInfo.some(item => item.loaded), 'real local solder photos should load in the browser adapter')
    assert.ok(result.events.exportCount > 0, 'bridge canvases and report pages should export images')
    for (const name of ['generate-report', 'report-bridge-result']) {
      assert.ok(result.channels.some(item => item.name === name && item.action === 'on'), `EventChannel should register ${name}`)
      assert.ok(result.channels.some(item => item.name === name && item.action === 'emit'), `EventChannel should send ${name}`)
    }

    const coverage = await browser.evaluate(`(() => {
      const page=__homepageQa.page, selected=page._buildingPayload.selectedItems, plan=page._buildingImagePlan
      const reportPages=page.data.reportPages||[], reportPaths=new Set(reportPages.map(item=>item.path))
      const exports=__homepageQa.events.exports
      const reportExports=exports.filter(entry=>entry.page==='pages/records/report.js')
      const bridgeExports=exports.filter(entry=>entry.page!=='pages/records/report.js')
      const audioIds=new Set(Object.keys(page._bridgeResults.audioWiring||{}))
      const projectPages=page._bridgeResults.projectWiring||[]
      const projectBridgeLineIds=new Set((plan.bridges.projectWiring||[]).map(item=>item.line?.id).filter(Boolean))
      const items=selected.map(item=>{
        let covered=false
        if(item.type==='wiring') covered=projectBridgeLineIds.has(item.line?.id)&&projectPages.length>0&&projectPages.every(image=>reportPaths.has(image.path))
        else if(item.type==='calculation'&&item.record?.module==='audioWiring') covered=audioIds.has(item.id)&&(page._bridgeResults.audioWiring[item.id]||[]).every(image=>reportPaths.has(image.path))
        else covered=Boolean(plan.tasksById[item.id]?.length)&&reportPages.some(image=>image.itemId===item.id&&Boolean(image.path))
        return {id:item.id,type:item.type,module:item.record?.module||'',covered}
      })
      const canvas=document.getElementById('projectReportExportCanvas')
      return {selectedCount:page.data.selectedCount,totalCount:page.data.totalCount,selectedIds:page.data.selectedItemIds,
        canvasState:{boundWidth:page.data.reportCanvasWidth,boundHeight:page.data.reportCanvasHeight,
          width:canvas?.width,height:canvas?.height,attributeWidth:canvas?.getAttribute('width'),attributeHeight:canvas?.getAttribute('height')},
        reportExportCount:reportExports.length,bridgeExportCount:bridgeExports.length,
        reportPages:reportPages.map(item=>{
          const exportIndex=exports.findIndex(entry=>entry.url===item.path), output=exports[exportIndex]
          return {path:Boolean(item.path),itemId:item.itemId||'',pageNumber:item.pageNumber||0,
            width:Number(item.width)||0,height:Number(item.height)||0,exportIndex,
            exportWidth:output?.width||0,exportHeight:output?.height||0,
            sourceWidth:output?.sourceWidth||0,sourceHeight:output?.sourceHeight||0,
            exportPage:output?.page||'',addressLabels:output?.addressLabels||[],addressTextDraws:output?.addressTextDraws||[]}
        }),items}
    })()`)
    assert.equal(coverage.selectedCount, coverage.totalCount, 'the generated report should retain every initially selected item')
    assert.equal(coverage.selectedIds.length, coverage.totalCount)
    assert(coverage.items.length > 0 && coverage.items.every(item => item.covered),
      `each selected item must have a task or bridge image in the report: ${JSON.stringify(coverage.items)}`)
    assert(coverage.reportPages.length > 0 && coverage.reportPages.every(item => item.path),
      'all final report pages should have exported image paths')
    assert.equal(coverage.reportPages.length, result.pageCount, 'every displayed page should have a corresponding exported image')
    assert.equal(coverage.reportExportCount + coverage.bridgeExportCount, coverage.reportPages.length,
      'every final report page must match one report-owned or bridge-owned original canvas export')
    assert(coverage.reportPages.every(item => item.exportIndex >= 0),
      'each reportPages entry must map to its exact events.exports PNG')
    assert.equal(new Set(coverage.reportPages.map(item => item.exportIndex)).size, coverage.reportPages.length,
      'report page paths should map one-to-one to original canvas exports')
    for (const item of coverage.reportPages) {
      const output=result.events.canvasExports[item.exportIndex]
      assert.equal(item.exportWidth, output.width)
      assert.equal(item.exportHeight, output.height)
      assert.equal(item.sourceWidth, item.width, `source canvas width for page ${item.pageNumber}`)
      assert.equal(item.sourceHeight, item.height, `source canvas height for page ${item.pageNumber}`)
      assert.equal(item.exportPage, output.page)
    }
    assert.equal(coverage.reportPages.filter(item=>item.itemId==='record:record-report-audio-wiring'
      && item.exportPage==='pages/audio-wiring/report-bridge.js').length, 1,
    'the selected audio image should retain its exact source-backed bridge export')
    assert.equal(coverage.reportPages.filter(item=>item.itemId==='line:line-report-a-001'
      && item.exportPage==='pages/project-wiring/report-bridge.js').length, 1,
    'the selected project wiring image should retain its exact source-backed bridge export')
    const lightingPages = coverage.reportPages.filter(item => item.itemId.startsWith('lighting:'))
    assert.equal(lightingPages.length, 1, 'the selected lighting item should have one report image page')
    for (const address of ['A001', 'A007']) {
      assert(lightingPages[0].addressLabels.includes(address),
        `the actual lighting export should draw address ${address}: ${JSON.stringify(lightingPages[0].addressLabels)}`)
    }

    const exportPngs = await saveRealEventExports(browser, result.events.exportCount)
    const reportExportPngs = exportPngs.filter(item => item.page === 'pages/records/report.js')
    const bridgeExportPngs = exportPngs.filter(item => item.page !== 'pages/records/report.js')
    assert.equal(reportExportPngs.length, coverage.reportExportCount)
    assert.equal(bridgeExportPngs.length, coverage.bridgeExportCount)
    const lightingPixels = await inspectLightingPngPixels(browser, lightingPages[0].exportIndex)
    assert.deepEqual(lightingPixels.rightEdge.rgba, [255,255,255,255],
      `lighting image should render to its full source width, not leave a clipped dark tail: ${JSON.stringify(lightingPixels.rightEdge)}`)
    assert.deepEqual(new Set(lightingPixels.addressTextDraws.map(item=>item.text)), new Set(['A001','A007']),
      `the native lighting canvas must draw both fixture addresses: ${JSON.stringify(lightingPixels.addressTextDraws)}`)
    const reportPageLoads = await inspectAllReportPages(browser, result.pageCount)
    assert.equal(reportPageLoads.length, result.pageCount)
    assert(reportPageLoads.every(item => item.complete && item.sourceMatches && item.elementMatches
      && item.naturalWidth > 0 && item.naturalHeight > 0), 'every actual report image must load through the report preview')
    const uiVariants = []
    for (const [width, theme] of [[320,'light'],[320,'dark'],[390,'light'],[390,'dark']]) {
      uiVariants.push(await captureUiVariant(browser, width, theme, result.pageCount, sourceHash))
    }
    const finalSourceHashes = getProductionHashes()
    assert.deepEqual(finalSourceHashes, sourceHashes, 'the same frozen production source must serve all viewports and themes')
    const evidenceSummary = {
      status:'passed', adapter:'source-backed Chromium; WeChat v2 button UA rules simulated', sourceHash, sourceHashes,
      bridges:['pages/audio-wiring/report-bridge.js','pages/project-wiring/report-bridge.js'],
      exports:result.events.exportCount, solderPhotoLoads:result.events.imageInfo.filter(item=>item.loaded).length,
      bridgeResults, selectedCount:coverage.selectedCount, coveredItems:coverage.items,
      reportPageCount:coverage.reportPages.length, reportPageCoverage:coverage.reportPages,
      reportPageLoads, reportExportPngs, bridgeExportPngs, exportPngs, uiVariants, finalSourceHashes,
      canvasState:coverage.canvasState,
      lightingAddressLabels:lightingPages[0].addressLabels,
      lightingAddressTextDraws:lightingPixels.addressTextDraws,lightingPixels,
    }
    fs.writeFileSync(path.join(evidence, 'summary.json'), JSON.stringify(evidenceSummary, null, 2))
    console.log(JSON.stringify({ status:evidenceSummary.status,sourceHash,reportPageCount:evidenceSummary.reportPageCount,
      loadedReportPages:reportPageLoads.filter(item=>item.complete&&item.sourceMatches&&item.elementMatches&&item.naturalWidth>0&&item.naturalHeight>0).length,
      rawCanvasExports:exportPngs.length,solderPhotoLoads:evidenceSummary.solderPhotoLoads,
      bridgeResults:evidenceSummary.bridgeResults,lightingAddressTextDraws:lightingPixels.addressTextDraws,
      uiVariants:uiVariants.map(item=>({width:item.width,theme:item.theme,generateButton:item.selection.button,
        screenshotFiles:item.screenshots})),evidencePath:evidence}, null, 2))
  } finally {
    await browser.close()
  }
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1 })
