// Production controllers/WXML/WXSS and real Chromium pixels. Not native WeChat QA.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const {launch,delay} = require('./browser-driver.cjs')
const phase = process.argv[2] || 'all'
const out = path.join(__dirname,'evidence/browser')
fs.mkdirSync(out,{recursive:true})
const profiles=[{width:390,height:844,theme:'light'},{width:320,height:568,theme:'dark'},{width:844,height:390,theme:'light'},{width:568,height:320,theme:'dark'}]

async function run(){
  const browser=await launch(),results=[],scenes=[],exports=[]
  const evaluate=source=>browser.evaluate(source)
  const dispatch=(method,dataset={},detail={},extra={})=>evaluate(`window.__dispatch(${JSON.stringify(method)},${JSON.stringify(dataset)},${JSON.stringify(detail)},${JSON.stringify(extra)})`)
  const click=selector=>evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});if(!n)throw Error('Missing '+${JSON.stringify(selector)});n.click()})()`)
  const rectSource=`n=>{if(!n)return null;const r=n.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height}}`
  async function check(name,body){try{await body();results.push({name,passed:true});console.log('PASS '+name)}catch(error){results.push({name,passed:false,error:error.stack});console.error('FAIL '+name+': '+error.message)}}
  async function capture(name){
    await delay(70)
    const facts=await evaluate('window.__facts()')
    assert.deepEqual(facts.errors,[],name+' WXML evaluation')
    assert.deepEqual(facts.runtimeErrors,[],name+' controller errors')
    assert(facts.pageWidth<=facts.width+1,name+' page overflow: '+JSON.stringify(facts))
    const file=path.join(out,name+'.png');await browser.screenshot(file)
    scenes.push({name,file,width:facts.width,height:facts.height})
  }
  async function panel(selector,{header,close,footer,scroll}={}){
    await delay(250)
    const metrics=await evaluate(`(()=>{
      const rect=${rectSource},n=document.querySelector(${JSON.stringify(selector)}),sc=n?.querySelector(${JSON.stringify(scroll||'scroll-view[scroll-y]')}),info=wx.getWindowInfo(),capsule=wx.getMenuButtonBoundingClientRect()
      if(sc)sc.scrollTop=sc.scrollHeight
      const mask=n?.closest('.overlay,.export-overlay'),nav=document.querySelector('.layout-page .nav-back'),nr=nav?.getBoundingClientRect(),hit=nr&&document.elementFromPoint(nr.x+nr.width/2,nr.y+nr.height/2)
      return{panel:rect(n),mask:rect(mask),backgroundNavBlocked:mask&&hit?mask.contains(hit):null,header:rect(n?.querySelector(${JSON.stringify(header||'.sheet-title-row,.add-confirm-header,.fixture-channel-guide-head,.settings-heading,.sheet-header,.placement-header')})),close:rect(n?.querySelector(${JSON.stringify(close||'.sheet-dismiss,.sheet-close,.add-confirm-reselect,.panel-close')})),footer:rect(n?.querySelector(${JSON.stringify(footer||'.pending-confirm,.settings-actions,.placement-summary,.preview-actions,.new-project-entry')})),scroll:sc?{...rect(sc),clientWidth:sc.clientWidth,scrollWidth:sc.scrollWidth,clientHeight:sc.clientHeight,scrollHeight:sc.scrollHeight,scrollTop:sc.scrollTop}:null,capsule,safeArea:info.safeArea,viewport:{width:innerWidth,height:innerHeight}}
    })()`)
    assert(metrics.panel?.width>0&&metrics.panel.height>0,selector+' visible '+JSON.stringify(metrics))
    assert(metrics.panel.x>=-1&&metrics.panel.right<=metrics.viewport.width+1,selector+' horizontal bounds '+JSON.stringify(metrics))
    assert(metrics.panel.y>=metrics.capsule.bottom+5,selector+' capsule exclusion '+JSON.stringify(metrics))
    assert(metrics.panel.bottom<=metrics.safeArea.bottom+1,selector+' safe bottom '+JSON.stringify(metrics))
    if(metrics.mask){
      assert(Math.abs(metrics.mask.x)<1&&Math.abs(metrics.mask.y)<1&&Math.abs(metrics.mask.right-metrics.viewport.width)<1&&Math.abs(metrics.mask.bottom-metrics.viewport.height)<1,selector+' backdrop covers the entire viewport '+JSON.stringify(metrics))
      if(metrics.backgroundNavBlocked!==null)assert.equal(metrics.backgroundNavBlocked,true,selector+' backdrop blocks the background navigation')
    }
    for(const key of ['header','close','footer'])if(metrics[key]){
      const r=metrics[key]
      assert(r.y>=metrics.panel.y-1&&r.bottom<=metrics.panel.bottom+1&&r.x>=metrics.panel.x-1&&r.right<=metrics.panel.right+1,selector+' '+key+' visible '+JSON.stringify(metrics))
    }
    if(metrics.scroll){
      const r=metrics.scroll
      assert(r.clientHeight>0,selector+' scroll height '+JSON.stringify(metrics))
      assert(r.scrollWidth<=r.clientWidth+1,selector+' scroll horizontal bounds '+JSON.stringify(metrics))
      assert(r.y>=metrics.panel.y-1&&r.bottom<=metrics.panel.bottom+1,selector+' scroll inside panel '+JSON.stringify(metrics))
    }
    scenes.push({name:selector,metrics})
    return metrics
  }
  async function navigate(profile,page='main',extra={}){await browser.viewport(profile.width,profile.height,profile.theme);await browser.navigate({theme:profile.theme,page,...extra});await delay(120)}
  async function addPreview(quantity=12){
    await click('.add-group-button');await dispatch('onFixtureSearchInput',{}, {value:'TL-SL323'});await dispatch('flushFixtureSearch');await click('.fixture-search-row')
    await dispatch('onPendingQuantityInput',{}, {value:String(quantity)});await dispatch('onPendingQuantityBlur')
  }
  async function seedPhotoLayout(){
    // Fixture setup only: the 27 existing calculated fixtures are distributed on
    // the existing two internal rods/front rod, using the user's photographed distances.
    await evaluate(`(()=>{
      const p=window.__lightingQa.page,l=JSON.parse(JSON.stringify(p._layout))
      l.internalRods=l.internalRods.slice(0,2);l.frontRods=l.frontRods.slice(0,1)
      const rods=[...l.internalRods,...l.frontRods]
      if(l.internalRods.length!==2||l.frontRods.length!==1)throw Error('Photo fixture needs two internal rods and one front rod')
      l.internalRods[0].distance=5.333333333333334;l.internalRods[1].distance=2.666666666666667;l.frontRods[0].distance=1.1454545454545455
      l.positionsById={};const groups=[p._fixtures.slice(0,10),p._fixtures.slice(10,19),p._fixtures.slice(19)]
      groups.forEach((fixtures,index)=>fixtures.forEach((f,i)=>{l.positionsById[f.stableId]={rodId:rods[index===0?2:index-1].id,t:(i+1)/(fixtures.length+1)}}))
      p._layout=l;p.setLayoutDirty(true);p.saveLayoutOnly(l);p.updateLayoutData();p.drawLayout()
    })()`);await delay(160)
  }
  async function drawLabels(){
    await evaluate('window.__lightingQa.events.rawCanvasTexts=[];window.__lightingQa.page.drawLayout()');await delay(120)
    return evaluate(`window.__lightingQa.events.rawCanvasTexts.filter(t=>t.canvasId==='dmxLayoutCanvas')`)
  }
  function noAddressOverlap(labels,description){
    const addresses=labels.filter(t=>/^[A-Z]+\d{3,}$/.test(t.text))
    assert(addresses.length>0,description+' address labels retained')
    for(let i=0;i<addresses.length;i++)for(let j=i+1;j<addresses.length;j++){
      const a=addresses[i],b=addresses[j]
      assert(!(a.left<b.right+1&&a.right+1>b.left&&a.top<b.bottom+1&&a.bottom+1>b.top),description+' address overlap '+JSON.stringify({a,b}))
    }
    return addresses
  }

  try{
    if(phase==='main'||phase==='all')for(const profile of profiles){
      const tag=`${profile.theme}-${profile.width}x${profile.height}`
      await check('main modal safe rectangle '+tag,async()=>{
        await navigate(profile)
        await click('.add-group-button')
        await panel('.fixture-search-sheet')
        await capture('main-catalog-'+tag)
        await dispatch('closeFixturePicker')
        await addPreview(200)
        await panel('.add-confirm-sheet',{scroll:'.add-confirm-content-scroll',header:'.add-confirm-header'})
        assert.equal(await evaluate('window.__lightingQa.data.pendingChange.addPreview.fixtureCountValue'),200)
        await capture('main-add-200-'+tag)
        await dispatch('cancelPendingChange')
        await dispatch('openModelPicker',{index:0});await dispatch('onFixtureSearchInput',{}, {value:'TL-SE3401'});await dispatch('flushFixtureSearch');await click('.fixture-search-row')
        await panel('.pending-sheet')
        await capture('main-change-'+tag)
        await dispatch('cancelPendingChange')
        await dispatch('onSaveNewProjectToggle')
        await panel('.save-project-sheet')
        await dispatch('onNewProjectNameEntry')
        await panel('.save-project-sheet',{footer:'.save-project-submit'})
        await dispatch('closeSaveProjectDialog')
        await dispatch('openFloatingCard',{index:0});await delay(250)
        await panel('.floating-card',{scroll:'.floating-chip-scroll',header:'.floating-card-main'})
        await capture('main-floating-'+tag)
        await dispatch('closeFloatingCard');await delay(260)
        const guide=await evaluate(`(()=>{const p=window.__lightingQa.page;for(const f of p._calculationResult.fixtures){p.openFixtureChannelGuide({currentTarget:{dataset:{globalIndex:f.globalIndex}}});if(p.data.fixtureChannelGuide)return true}return false})()`)
        assert(guide,'real catalog guide should open')
        await panel('.fixture-channel-guide-sheet',{header:'.fixture-channel-guide-head',scroll:'.fixture-channel-guide-scroll'})
        await capture('main-guide-'+tag)
        await dispatch('closeFixtureChannelGuide')
      })
    }

    if(phase==='swipe'||phase==='all')for(const theme of ['light','dark'])await check('actual touch follows finger before release '+theme,async()=>{
      await navigate({width:390,height:844,theme})
      await browser.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1})
      const original=await evaluate(`(()=>{const r=document.querySelector('.fixture-card').getBoundingClientRect();return{x:r.x+95,y:r.y+45,left:r.left,writes:window.__lightingQa.events.writes.length,calculation:JSON.stringify(window.__lightingQa.page._calculationResult)}})()`)
      const point=(x,y)=>({id:1,x:Math.round(x),y:Math.round(y),radiusX:2,radiusY:2,force:1})
      await browser.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point(original.x,original.y)]})
      const positions=[]
      for(const dx of [20,45,76]){
        await browser.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[point(original.x-dx,original.y)]});await delay(80)
        const current=await evaluate(`(()=>{const n=document.querySelector('.fixture-card'),r=n.getBoundingClientRect();return{left:r.left,transform:getComputedStyle(n).transform,transition:getComputedStyle(n).transitionDuration}})()`)
        assert(Math.abs(current.left-(original.left-dx))<=2,`touchmove ${dx} must move before release: `+JSON.stringify(current))
        assert.equal(current.transition,'0s','no easing during drag')
        const redLayer=await evaluate(`(()=>{const n=document.querySelector('.swipe-delete');return n?{color:getComputedStyle(n).backgroundColor,width:n.getBoundingClientRect().width}:null})()`)
        assert(redLayer&&redLayer.color==='rgb(255, 59, 48)'&&redLayer.width===76,'red delete layer must be present while the finger is moving')
        positions.push({dx,...current});await capture(`swipe-${dx}-before-release-${theme}`)
      }
      await browser.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await delay(300)
      assert.equal(await evaluate('window.__lightingQa.data.swipedGroupIndex'),0)
      const end=await evaluate(`(()=>{const r=document.querySelector('.fixture-card').getBoundingClientRect(),n=document.querySelector('.swipe-delete'),b=n.getBoundingClientRect();return{left:r.left,button:{x:b.x,right:b.right,width:b.width},writes:window.__lightingQa.events.writes.length,calculation:JSON.stringify(window.__lightingQa.page._calculationResult)}})()`)
      assert(Math.abs(end.left-(original.left-76))<=1)
      assert.equal(end.button.width,76)
      assert.equal(end.writes,original.writes,'swipe cannot persist data')
      assert.equal(end.calculation,original.calculation,'swipe cannot change calculated fixtures')
      scenes.push({name:'live-swipe-'+theme,original,positions,end:{...end,calculation:undefined}})
      // A new physical gesture closes the opened row while moving right.
      const cx=original.x-60
      await browser.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point(cx,original.y)]})
      await browser.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[point(cx+40,original.y)]});await delay(80)
      assert(Math.abs((await evaluate("document.querySelector('.fixture-card').getBoundingClientRect().left"))-(original.left-36))<=2,'open row tracks reverse swipe')
      await browser.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await delay(280)
      assert.equal(await evaluate('window.__lightingQa.data.swipedGroupIndex'),-1)
      await delay(520);await dispatch('openFloatingCard',{index:0});await delay(260)
      const floating=await evaluate(`(()=>{const r=document.querySelector('.floating-card').getBoundingClientRect();return{x:r.x+95,y:r.y+45,left:r.left}})()`)
      await browser.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point(floating.x,floating.y)]})
      for(const dx of [24,60]){await browser.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[point(floating.x+dx,floating.y)]});await delay(80);const left=await evaluate("document.querySelector('.floating-card').getBoundingClientRect().left");assert(Math.abs(left-floating.left-dx)<=2,'floating tracks finger '+dx)}
      await capture('floating-swipe-60-before-release-'+theme)
      await browser.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await delay(300)
      assert.equal(await evaluate('window.__lightingQa.data.floatingVisible'),true,'short floating swipe rebounds')
      assert(Math.abs((await evaluate("document.querySelector('.floating-card').getBoundingClientRect().left"))-floating.left)<=1)
    })

    if(phase==='layout'||phase==='all')for(const profile of profiles){
      const tag=`${profile.theme}-${profile.width}x${profile.height}`,landscape=profile.width>profile.height
      await check('layout modals, icon, real diagram PNG '+tag,async()=>{
        await navigate(profile,landscape?'landscape':'layout',{lightingContextName:encodeURIComponent('临时设置')})
        assert.equal(await evaluate('window.__lightingQa.data.contextLabel'),'临时设置')
        await seedPhotoLayout()
        const baselinePositions=await evaluate('JSON.stringify(window.__lightingQa.page._layout.positionsById)')
        const labels=await drawLabels();const addresses=noAddressOverlap(labels,'photo scene '+tag)
        for(const text of ['12 m','8 m','灯杆1','灯杆2','面光杆1','台口','观众区'])assert(labels.some(label=>label.text===text),'photo scene retains basic diagram label '+text+' '+tag)
        const canvasSize=await evaluate(`(()=>{const n=document.getElementById('dmxLayoutCanvas');return{width:n.width,height:n.height}})()`)
        assert(labels.every(label=>label.left>=-1&&label.top>=-1&&label.right<=canvasSize.width+1&&label.bottom<=canvasSize.height+1),'screen diagram text stays inside real canvas bounds '+tag)
        const icon=await evaluate(`(()=>{const n=document.querySelector('.canvas-orientation');if(!n)return null;const r=n.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height}})()`)
        if(!landscape)assert(icon?.width>=44&&icon.height>=44,'rotation target is at least 44px')
        await capture('layout-27-'+tag)
        scenes.push({name:'layout-labels-'+tag,addresses,labels,icon})
        await dispatch('openLayoutSettings')
        await panel('.settings-card',{header:'.settings-heading',scroll:'.settings-scroll',footer:'.settings-actions'})
        assert.equal(await evaluate("!!document.getElementById('dmxLayoutCanvas')"),false,'main canvas unmounted during modal')
        await capture('layout-settings-'+tag)
        await dispatch('closeLayoutSettings');await delay(230)
        await dispatch('openPlacementPanel')
        await panel('.placement-card',{header:'.placement-heading',scroll:'.fixture-selection-list',footer:'.placement-summary'})
        const chips=await evaluate(`(()=>{const list=document.querySelector('.fixture-selection-list'),r=list.getBoundingClientRect(),grids=[...list.querySelectorAll('.fixture-address-grid')];return{left:r.left,right:r.right,scrollWidth:list.scrollWidth,width:list.clientWidth,groups:grids.map(grid=>{const g=grid.getBoundingClientRect();return{left:g.left,right:g.right,chips:[...grid.querySelectorAll('.fixture-address-chip')].map(n=>{const r=n.getBoundingClientRect();return{x:r.x,right:r.right,y:r.y,width:r.width}})}})}})()`)
        assert(chips.groups.length>0)
        for(const group of chips.groups){assert(group.chips.length>0);assert(group.chips.every(c=>c.x>=chips.left-1&&c.right<=chips.right+1),'sixth column fits '+JSON.stringify(chips));const firstY=group.chips[0].y;assert.equal(group.chips.filter(c=>Math.abs(c.y-firstY)<1).length,Math.min(6,group.chips.length),'six equal columns')}
        await capture('layout-placement-bottom-'+tag)
        scenes.push({name:'six-col-'+tag,chips})
        await dispatch('closePlacementPanel');await delay(250)
        await dispatch('openLocatePanel')
        await panel('.locate-card',{header:'.locate-heading',scroll:'.locate-results'})
        const buttons=await evaluate(`(()=>{const rect=${rectSource};return{close:rect(document.querySelector('.locate-card .sheet-close')),search:rect(document.querySelector('.search-button')),input:rect(document.querySelector('.search-row input'))}})()`)
        assert(buttons.close.width<=64&&buttons.close.width>=44,'close compact touch target '+JSON.stringify(buttons))
        assert(buttons.search.width<=70&&buttons.search.width>=44,'search compact touch target '+JSON.stringify(buttons))
        assert(buttons.input.width>=70,'locator input editable width '+JSON.stringify(buttons))
        await dispatch('onSearchInput',{}, {value:'A001'});await dispatch('searchFixture')
        await panel('.locate-card',{header:'.locate-heading',scroll:'.locate-results'})
        const oneResult=await evaluate(`(()=>{const panel=document.querySelector('.locate-card'),rows=[...panel.querySelectorAll('.locate-result-row')],p=panel.getBoundingClientRect(),last=rows.at(-1)?.getBoundingClientRect();return{count:rows.length,height:p.height,tailGap:last?p.bottom-last.bottom:null}})()`)
        assert.equal(oneResult.count,1,'A001 search has one real result')
        assert(oneResult.height<=280&&oneResult.tailGap>=-1&&oneResult.tailGap<=32,'one-result locator should shrink to content '+JSON.stringify(oneResult))
        await capture('layout-locator-'+tag)
        const locatedId=await evaluate('window.__lightingQa.data.searchResults[0].id')
        await dispatch('onLocateResultTap',{fixtureId:locatedId});await delay(600)
        assert.equal(await evaluate('window.__lightingQa.data.highlightFixtureId'),locatedId,'actual locator highlights the selected fixture')
        const locatedLabels=await drawLabels()
        assert(locatedLabels.some(label=>label.text==='A001'),'located address is prioritized on the actual canvas')
        assert.equal(await evaluate('JSON.stringify(window.__lightingQa.page._layout.positionsById)'),baselinePositions,'display interactions preserve positions')
        await dispatch('generateLayoutImage');await delay(220)
        const generated=await evaluate(`({exports:window.__lightingQa.events.exports.map(({url,...rest})=>({...rest,url})),texts:window.__lightingQa.events.rawCanvasTexts.filter(t=>t.canvasId==='dmxLayoutExportCanvas').map(t=>t.text),pageCount:window.__lightingQa.data.previewPageCount,previewVisible:window.__lightingQa.data.previewVisible})`)
        assert.equal(generated.exports.length,1,'one real PNG only')
        assert(generated.exports[0].url.startsWith('data:image/png;base64,'),'PNG is rasterized from raw 2D node')
        assert(generated.texts.includes('灯位图'),'diagram title rendered')
        assert(!generated.texts.some(t=>/灯具编址与灯位图|灯具地址清单|未上杆灯具|通道模式|\bCH\b|地址清单/.test(t)),'no report/list text '+JSON.stringify(generated.texts))
        assert(generated.texts.some(t=>/^[A-Z]+\d{3,}$/.test(t)),'diagram keeps placed addresses')
        for(const text of ['台口','观众区','12 m','8 m'])assert(generated.texts.includes(text),'export keeps '+text)
        await panel('.export-sheet',{header:'.export-heading',scroll:'.export-image-scroll',footer:'.export-actions'})
        await capture('layout-preview-'+tag)
        const file=path.join(out,'diagram-only-'+tag+'.png'),bytes=Buffer.from(generated.exports[0].url.split(',')[1],'base64');fs.writeFileSync(file,bytes)
        exports.push({name:tag,file,width:generated.exports[0].width,height:generated.exports[0].height,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),texts:generated.texts})
        assert(bytes.length>8000,'real nonempty diagram PNG')
      })
    }
  }finally{
    fs.writeFileSync(path.join(out,'results-'+phase+'.json'),JSON.stringify({runAt:new Date().toISOString(),nativeRuntime:false,physicalDevice:false,profiles,results,scenes,exports},null,2));await browser.close()
  }
  console.log(`${results.filter(r=>r.passed).length}/${results.length} browser refinement flows passed`)
  if(results.some(r=>!r.passed))process.exitCode=1
}
run().catch(error=>{console.error(error);process.exitCode=1})
