// Production controllers/WXML/WXSS and real Chromium pixels. Not native WeChat QA.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const {launch,delay} = require('./browser-driver.cjs')
const phase = process.argv[2] || 'all'
const out = path.resolve(process.env.LIGHTING_QA_OUT || path.join(__dirname,'evidence/browser'))
fs.mkdirSync(out,{recursive:true})
const profiles=[{width:390,height:844,theme:'light'},{width:320,height:568,theme:'dark'},{width:844,height:390,theme:'light'},{width:568,height:320,theme:'dark'}]
const layoutProfiles=profiles.filter(({width,height})=>width<=height)

async function run(){
  const browser=await launch(),results=[],scenes=[],exports=[],executedLayoutProfiles=[]
  const browserInfo=await browser.send('Browser.getVersion')
  const evaluate=source=>browser.evaluate(source)
  const dispatch=(method,dataset={},detail={},extra={})=>evaluate(`window.__dispatch(${JSON.stringify(method)},${JSON.stringify(dataset)},${JSON.stringify(detail)},${JSON.stringify(extra)})`)
  const click=selector=>evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});if(!n)throw Error('Missing '+${JSON.stringify(selector)});n.click()})()`)
  const domInput=(selector,value)=>evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});if(!n)throw Error('Missing input '+${JSON.stringify(selector)});n.value=${JSON.stringify(value)};n.dispatchEvent(new Event('input',{bubbles:true}));return n.value})()`)
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

    if(phase==='layout'||phase==='all')for(const profile of layoutProfiles){
      executedLayoutProfiles.push(profile)
      const tag=`${profile.theme}-${profile.width}x${profile.height}`
      await check('layout, placement search and full PNG export '+tag,async()=>{
        await navigate(profile,'layout',{lightingContextName:encodeURIComponent('临时设置')})
        assert.equal(await evaluate('window.__lightingQa.data.contextLabel'),'临时设置')
        await seedPhotoLayout()
        const baselinePositions=await evaluate('JSON.stringify(window.__lightingQa.page._layout.positionsById)')
        const labels=await drawLabels();const addresses=noAddressOverlap(labels,'photo scene '+tag)
        for(const text of ['12 m','8 m','灯杆1','灯杆2','面光杆1','台口','观众区'])assert(labels.some(label=>label.text===text),'photo scene retains basic diagram label '+text+' '+tag)
        const canvasSize=await evaluate(`(()=>{const n=document.getElementById('dmxLayoutCanvas');return{width:n.width,height:n.height}})()`)
        assert(labels.every(label=>label.left>=-1&&label.top>=-1&&label.right<=canvasSize.width+1&&label.bottom<=canvasSize.height+1),'screen diagram text stays inside real canvas bounds '+tag)
        await capture('layout-27-'+tag)
        scenes.push({name:'layout-labels-'+tag,addresses,labels})
        await dispatch('openLayoutSettings')
        await panel('.settings-card',{header:'.settings-heading',scroll:'.settings-scroll',footer:'.settings-actions'})
        assert.equal(await evaluate("!!document.getElementById('dmxLayoutCanvas')"),false,'main canvas unmounted during modal')
        await capture('layout-settings-'+tag)
        await dispatch('closeLayoutSettings');await delay(230)
        await dispatch('openPlacementPanel')
        await panel('.placement-card',{header:'.placement-heading',scroll:'.fixture-selection-list',footer:'.placement-summary'})
        const chips=await evaluate(`(()=>{const list=document.querySelector('.fixture-selection-list'),r=list.getBoundingClientRect(),grids=[...list.querySelectorAll('.fixture-address-grid')];return{left:r.left,right:r.right,scrollWidth:list.scrollWidth,width:list.clientWidth,groups:grids.map(grid=>{const g=grid.getBoundingClientRect();return{left:g.left,right:g.right,chips:[...grid.querySelectorAll('.fixture-address-chip')].map(n=>{const r=n.getBoundingClientRect();return{x:r.x,right:r.right,y:r.y,width:r.width}})}})}})()`)
        const inventory=await evaluate(`(()=>{const p=window.__lightingQa.page;return{source:p._fixtures.map(f=>({id:String(f.stableId),address:f.addressText})),groups:p.data.placementGroups.length,dom:[...document.querySelectorAll('.fixture-address-chip')].map(n=>({id:n.dataset.fixtureId,address:n.querySelector('.fixture-chip-address')?.textContent.trim()}))}})()`)
        const byId=items=>items.map(({id,address})=>({id,address})).sort((a,b)=>a.id.localeCompare(b.id))
        assert.equal(inventory.source.length,27,'the actual fixture setup contains 27 calculated fixtures')
        assert.equal(inventory.groups,3,'all three actual fixture groups are visible')
        assert.deepEqual(byId(inventory.dom),byId(inventory.source),'placement list shows the actual fixture identities and addresses')
        const sourceA001=inventory.source.filter(f=>f.address==='A001')
        assert.equal(sourceA001.length,1,'the real fixture inventory contains one A001')
        assert(chips.groups.length>0)
        const minTouch=44,gap=7
        for(const [index,group] of chips.groups.entries()){
          assert(group.chips.length>0)
          const metrics=await evaluate(`(()=>{const grid=document.querySelectorAll('.fixture-address-grid')[${index}],r=grid.getBoundingClientRect(),style=getComputedStyle(grid),items=[...grid.querySelectorAll('.fixture-address-chip')].map(n=>{const b=n.getBoundingClientRect();return{x:b.x,right:b.right,y:b.y,width:b.width,height:b.height}}),rows=[];for(const item of items){let row=rows.find(candidate=>Math.abs(candidate.y-item.y)<1);if(!row){row={y:item.y,chips:[]};rows.push(row)}row.chips.push(item)}for(const row of rows)row.chips.sort((a,b)=>a.x-b.x);return{width:grid.clientWidth,scrollWidth:grid.scrollWidth,columnGap:parseFloat(style.columnGap),items,rows:rows.map(row=>({count:row.chips.length,widths:row.chips.map(c=>c.width),gaps:row.chips.slice(1).map((c,i)=>c.x-row.chips[i].right)})),gridLeft:r.left,gridRight:r.right}})()`)
          const expectedColumns=Math.floor((metrics.width+gap)/(minTouch+gap))
          assert.equal(metrics.columnGap,gap,'address grid retains the 7px column gap '+tag)
          assert(expectedColumns>=1,'available width fits at least one 44px target '+JSON.stringify(metrics))
          if(index===0)assert.equal(expectedColumns,profile.width===390?6:5,'responsive columns follow available width and minimum touch target '+JSON.stringify(metrics))
          assert(metrics.scrollWidth<=metrics.width+1,'address grid does not overflow '+JSON.stringify(metrics))
          assert(metrics.items.every(c=>c.x>=metrics.gridLeft-1&&c.right<=metrics.gridRight+1&&c.width>=minTouch-0.1&&c.height>=minTouch-0.1),'address chips remain inside the grid and at least 44px '+JSON.stringify(metrics))
          assert.equal(metrics.rows.length,Math.ceil(group.chips.length/expectedColumns),'address rows match the width-derived column count '+JSON.stringify(metrics))
          metrics.rows.forEach((row,rowIndex)=>{
            assert.equal(row.count,Math.min(expectedColumns,group.chips.length-rowIndex*expectedColumns),'each address row uses the available equal columns '+JSON.stringify(metrics))
            assert(row.widths.every(width=>Math.abs(width-row.widths[0])<1),'columns have equal widths '+JSON.stringify(metrics))
            assert(row.gaps.every(actual=>Math.abs(actual-gap)<1),'columns preserve the measured gap '+JSON.stringify(metrics))
          })
          group.layout=metrics
        }
        await capture('layout-placement-bottom-'+tag)
        scenes.push({name:'responsive-address-grid-'+tag,availableWidth:chips.width,expectedColumns:Math.floor((chips.groups[0].layout.width+gap)/(minTouch+gap)),groups:chips.groups.map(group=>({fixtureCount:group.chips.length,...group.layout})),fixtureCount:inventory.source.length,fixtures:inventory.source})
        const inputRect=await evaluate(`(()=>{const rect=${rectSource},buttons=[...document.querySelectorAll('.placement-actions button')];return{input:rect(document.querySelector('.placement-search input')),clearButtons:buttons.map(rect)}})()`)
        assert(inputRect.input.width>=70&&inputRect.input.height>=30,'placement search input remains editable and touchable '+JSON.stringify(inputRect))
        assert.equal(inputRect.clearButtons.length,2,'both real placement controls remain present')
        assert(inputRect.clearButtons.every(r=>r.width>=80&&r.height>=44),'placement action buttons retain their 44px touch height '+JSON.stringify(inputRect))
        const searchInput='.placement-search input'
        assert.equal(await domInput(searchInput,'A001'),'A001','type into the real placement search input')
        await delay(80)
        const a001=await evaluate(`(()=>{const p=window.__lightingQa.page;return{input:document.querySelector('.placement-search input')?.value,filter:p.data.placementFilterText,groups:p.data.placementGroups.flatMap(g=>g.fixtures.map(f=>({id:String(f.id),address:f.addressText}))),dom:[...document.querySelectorAll('.fixture-address-chip')].map(n=>({id:n.dataset.fixtureId,address:n.querySelector('.fixture-chip-address')?.textContent.trim()})),empty:document.querySelector('.no-fixture-results')?.textContent.trim()||''}})()`)
        assert.equal(a001.input,'A001');assert.equal(a001.filter,'A001','the input event reaches onPlacementFilterInput')
        assert.deepEqual(a001.groups,sourceA001,'A001 search returns the real fixture identity')
        assert.deepEqual(a001.dom,sourceA001,'A001 search renders one real DOM fixture')
        assert.equal(a001.empty,'','A001 search does not show the empty-state feedback')
        await capture('layout-placement-search-A001-'+tag)
        scenes.push({name:'placement-search-A001-'+tag,fixtures:a001.dom})
        await domInput(searchInput,'__NO_SUCH_FIXTURE_20261024__');await delay(80)
        const noMatch=await evaluate(`(()=>{const p=window.__lightingQa.page;return{input:document.querySelector('.placement-search input')?.value,filter:p.data.placementFilterText,groups:p.data.placementGroups.flatMap(g=>g.fixtures),dom:document.querySelectorAll('.fixture-address-chip').length,feedback:document.querySelector('.no-fixture-results')?.textContent.trim()||''}})()`)
        assert.equal(noMatch.filter,'__NO_SUCH_FIXTURE_20261024__','no-match query reaches the current input handler')
        assert.equal(noMatch.input,'__NO_SUCH_FIXTURE_20261024__')
        assert.equal(noMatch.groups.length,0);assert.equal(noMatch.dom,0)
        assert.equal(noMatch.feedback,'没有匹配的灯具','the current placement panel explains that there are no matches')
        await capture('layout-placement-search-no-match-'+tag)
        scenes.push({name:'placement-search-no-match-'+tag,feedback:noMatch.feedback,fixtureCount:noMatch.dom})
        await domInput(searchInput,'');await delay(100)
        const restored=await evaluate(`(()=>{const p=window.__lightingQa.page,list=document.querySelector('.fixture-selection-list');list.scrollTop=list.scrollHeight;return{input:document.querySelector('.placement-search input')?.value,filter:p.data.placementFilterText,groups:p.data.placementGroups.length,dom:[...document.querySelectorAll('.fixture-address-chip')].map(n=>({id:n.dataset.fixtureId,address:n.querySelector('.fixture-chip-address')?.textContent.trim()})),scroll:{clientHeight:list.clientHeight,scrollHeight:list.scrollHeight,scrollTop:list.scrollTop}}})()`)
        assert.equal(restored.input,'');assert.equal(restored.filter,'','clearing the real input clears the active filter')
        assert.equal(restored.groups,inventory.groups);assert.deepEqual(byId(restored.dom),byId(inventory.source),'clearing restores every original fixture identity')
        assert(restored.scroll.clientHeight>0&&restored.scroll.scrollTop+restored.scroll.clientHeight>=restored.scroll.scrollHeight-1,'the restored fixture list can reach its bottom '+JSON.stringify(restored.scroll))
        await capture('layout-placement-search-restored-'+tag)
        scenes.push({name:'placement-search-restored-'+tag,fixtureCount:restored.dom.length,scroll:restored.scroll})
        const previewFixture=await evaluate(`(()=>{const p=window.__lightingQa.page,item=p.data.previewItems[0];if(!item)throw Error('No placed fixture on the selected rod');const source=p._fixtures.find(f=>String(f.stableId)===item.id),position=p._layout.positionsById[item.id];if(!document.querySelector('.preview-light-column[data-fixture-id="'+item.id+'"]'))throw Error('Missing current preview fixture '+item.id);return{fixture:{id:item.id,address:item.addressText,sourceId:String(source?.stableId),sourceAddress:source?.addressText},position:{...position,rodId:String(position?.rodId)},activeRodId:String(p._activeRodId)}})()`)
        const writesBeforeSelection=await evaluate('window.__lightingQa.events.writes.length')
        const savedStateBeforeSelection=await evaluate('JSON.stringify([...window.__lightingQa.storage.entries()])')
        await evaluate(`(()=>{const n=document.querySelector('.preview-light-column[data-fixture-id="'+${JSON.stringify(previewFixture.fixture.id)}+'"]');if(!n)throw Error('Missing current preview fixture');n.click()})()`)
        await delay(80)
        const selection=await evaluate(`(()=>{const p=window.__lightingQa.page,marker=document.querySelector('.fixture-address-chip.fixture-address-selected'),previewMarker=document.querySelector('.preview-light-column.preview-light-selected');return{selectedId:p.data.selectedFixtureId,panelScrollIntoView:p.data.panelScrollIntoView,selectedChipId:marker?.dataset.fixtureId,selectedMarker:marker?.querySelector('.fixture-chip-selected-marker')?.textContent.trim()||'',previewSelectedId:previewMarker?.dataset.fixtureId,noticeRow:!!document.querySelector('.placement-notice'),positions:JSON.stringify(p._layout.positionsById),writes:window.__lightingQa.events.writes.length}})()`)
        assert.equal(previewFixture.fixture.id,previewFixture.fixture.sourceId,'preview selection uses an actual calculated fixture')
        assert.equal(previewFixture.fixture.address,previewFixture.fixture.sourceAddress)
        assert.equal(previewFixture.position.rodId,previewFixture.activeRodId,'selected fixture stays on its original active rod')
        assert.equal(selection.selectedId,previewFixture.fixture.id,'real preview click selects the fixture')
        assert.equal(selection.panelScrollIntoView,'fixture-'+previewFixture.fixture.id,'selection requests the matching fixture row into view')
        assert.equal(selection.selectedChipId,previewFixture.fixture.id,'selection marker appears on the matching address chip')
        assert.equal(selection.selectedMarker,'选','the selected address chip gives visible feedback')
        assert.equal(selection.previewSelectedId,previewFixture.fixture.id,'the preview column also shows selected state')
        assert.equal(selection.noticeRow,false,'read-only selection does not recreate the changing instruction row')
        assert.equal(selection.positions,baselinePositions,'read-only selection does not change any positions')
        assert.equal(selection.writes,writesBeforeSelection,'read-only selection does not write layout storage')
        assert.equal(await evaluate('JSON.stringify([...window.__lightingQa.storage.entries()])'),savedStateBeforeSelection,'read-only selection leaves saved positions unchanged')
        await capture('layout-placement-selected-'+tag)
        scenes.push({name:'read-only-preview-selection-'+tag,fixture:previewFixture.fixture,position:previewFixture.position,selectedId:selection.selectedId,panelScrollIntoView:selection.panelScrollIntoView,noticeRow:selection.noticeRow,positionsUnchanged:true,savedPositionsUnchanged:true,storageWritesUnchanged:true})
        assert.equal(await evaluate('JSON.stringify(window.__lightingQa.page._layout.positionsById)'),baselinePositions,'placement search and preview selection preserve positions')
        await click('.placement-overlay');await delay(280)
        const closed=await evaluate(`(()=>{const p=window.__lightingQa.page;return{placementVisible:p.data.placementVisible,overlay:!!document.querySelector('.placement-overlay'),canvas:!!document.getElementById('dmxLayoutCanvas')}})()`)
        assert.equal(closed.placementVisible,false,'real overlay click closes the placement panel')
        assert.equal(closed.overlay,false,'closed placement panel is removed from the page')
        assert.equal(closed.canvas,true,'main layout canvas is mounted again after closing')
        const postSelectionLabels=await drawLabels()
        const postSelectionAddresses=noAddressOverlap(postSelectionLabels,'post-selection scene '+tag)
        assert(postSelectionLabels.some(label=>label.text==='A001'),'main canvas retains fixture addresses after read-only selection')
        for(const text of ['12 m','8 m','灯杆1','灯杆2','面光杆1','台口','观众区'])assert(postSelectionLabels.some(label=>label.text===text),'main canvas retains '+text+' after closing the placement panel')
        scenes.push({name:'post-selection-canvas-'+tag,addresses:postSelectionAddresses,labels:postSelectionLabels,placementVisible:closed.placementVisible,canvasMounted:closed.canvas})
        const shareTarget=await evaluate(`(()=>{const r=document.querySelector('.context-share').getBoundingClientRect();return{width:r.width,height:r.height}})()`)
        assert(shareTarget.width>=44&&shareTarget.height>=44,'visible diagram export control retains its 44px target '+JSON.stringify(shareTarget))
        await click('.context-share');await delay(280)
        const generated=await evaluate(`(()=>{const textCalls=window.__lightingQa.events.rawCanvasTexts.filter(t=>t.canvasId==='dmxLayoutExportCanvas').map(({text,left,right,top,bottom})=>({text,left,right,top,bottom}));return{exports:window.__lightingQa.events.exports.map(({url,...rest})=>({...rest,url})),textCalls,texts:textCalls.map(t=>t.text),pageCount:window.__lightingQa.data.exportPageCount,previewVisible:window.__lightingQa.data.previewVisible}})()`)
        assert.equal(generated.exports.length,1,'one real PNG only')
        assert.equal(generated.pageCount,1,'the layout export remains a single page')
        assert.equal(generated.previewVisible,true,'the actual share control opens the generated image preview')
        assert(generated.exports[0].url.startsWith('data:image/png;base64,'),'PNG is rasterized from raw 2D node')
        assert.equal(await evaluate('JSON.stringify(window.__lightingQa.page._layout.positionsById)'),baselinePositions,'real export interaction preserves positions')
        assert.equal(await evaluate('JSON.stringify([...window.__lightingQa.storage.entries()])'),savedStateBeforeSelection,'real export interaction preserves saved positions')
        assert(generated.texts.includes('灯位图'),'diagram title rendered')
        assert(!generated.texts.some(t=>/灯具编址与灯位图|灯具地址清单|未上杆灯具|通道模式|\bCH\b/.test(t)),'no retired report text '+JSON.stringify(generated.texts))
        assert(generated.texts.some(t=>/^[A-Z]+\d{3,}$/.test(t)),'diagram keeps placed addresses')
        const addressListTitle=generated.textCalls.find(call=>call.text===`完整地址清单（${inventory.source.length} 台）`)
        assert(addressListTitle,'export includes the current full address list')
        const addressListCalls=generated.textCalls.filter(call=>call.top>addressListTitle.bottom)
        for(const section of ['灯杆1（9台）','灯杆2（8台）','面光杆1（10台）'])assert(addressListCalls.some(call=>call.text===section),'export retains rod address section '+section)
        const listedAddresses=inventory.source.filter(fixture=>addressListCalls.some(call=>call.text.split(/\s+/).includes(fixture.address)))
        assert.deepEqual(listedAddresses.map(f=>f.address).sort(),inventory.source.map(f=>f.address).sort(),'address appendix includes every real fixture address')
        for(const text of ['台口','观众区','12 m','8 m'])assert(generated.texts.includes(text),'export keeps '+text)
        await panel('.export-sheet',{header:'.export-heading',scroll:'.export-image-scroll',footer:'.export-actions'})
        await capture('layout-preview-'+tag)
        const file=path.join(out,'layout-with-address-list-'+tag+'.png'),bytes=Buffer.from(generated.exports[0].url.split(',')[1],'base64');fs.writeFileSync(file,bytes)
        assert(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),'export bytes have the real PNG signature')
        assert.equal(bytes.readUInt32BE(16),generated.exports[0].width,'PNG header width matches the exported dimensions')
        assert.equal(bytes.readUInt32BE(20),generated.exports[0].height,'PNG header height matches the exported dimensions')
        assert(generated.exports[0].width>0&&generated.exports[0].height>0,'real PNG has nonzero dimensions')
        exports.push({name:tag,file,width:generated.exports[0].width,height:generated.exports[0].height,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),addressListCount:inventory.source.length,texts:generated.texts})
        assert(bytes.length>8000,'real nonempty diagram PNG')
      })
    }
  }finally{
    fs.writeFileSync(path.join(out,'results-'+phase+'.json'),JSON.stringify({runAt:new Date().toISOString(),phase,browser:browserInfo.product,sourceBackedProduction:true,nativeRuntime:false,physicalDevice:false,profiles,executedLayoutProfiles,results,scenes,exports},null,2));await browser.close()
  }
  console.log(`${results.filter(r=>r.passed).length}/${results.length} browser refinement flows passed`)
  if(results.some(r=>!r.passed))process.exitCode=1
}
run().catch(error=>{console.error(error);process.exitCode=1})
