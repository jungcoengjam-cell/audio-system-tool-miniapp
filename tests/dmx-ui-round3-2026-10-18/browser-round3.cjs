// Source-backed controller/WXML/WXSS with injected Chromium touch events and real pixels.
// This is not native WeChat or physical-device acceptance.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path')
const {launch,delay}=require('./browser-driver.cjs')
const phase=process.argv[2]||'all',out=path.join(__dirname,'evidence/browser')
fs.mkdirSync(out,{recursive:true})
const profiles=[{width:390,height:844,theme:'light'},{width:320,height:568,theme:'dark'},{width:844,height:390,theme:'light'},{width:568,height:320,theme:'dark'}]
async function run(){
 const b=await launch(),results=[],scenes=[]
 const ev=s=>b.evaluate(s),dispatch=(m,d={},v={},e={})=>ev(`window.__dispatch(${JSON.stringify(m)},${JSON.stringify(d)},${JSON.stringify(v)},${JSON.stringify(e)})`)
 const click=s=>ev(`(()=>{const n=document.querySelector(${JSON.stringify(s)});if(!n)throw Error('Missing '+${JSON.stringify(s)});n.click()})()`)
 const rect=`n=>{if(!n)return null;const r=n.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height}}`
 async function check(name,fn){try{await fn();results.push({name,passed:true});console.log('PASS '+name)}catch(e){results.push({name,passed:false,error:e.stack});console.error('FAIL '+name+': '+e.message)}}
 async function open(p,page='main',extra={}){await b.viewport(p.width,p.height,p.theme);await b.navigate({page,theme:p.theme,...extra});await delay(150)}
 async function shot(name){const f=await ev('window.__facts()');assert.deepEqual(f.errors,[]);assert.deepEqual(f.runtimeErrors,[]);assert(f.pageWidth<=f.width+1,'page horizontal overflow');const file=path.join(out,name+'.png');await b.screenshot(file);scenes.push({name,file,width:f.width,height:f.height})}
 async function scrollMetrics(selector){return ev(`(()=>{const r=${rect},n=document.querySelector(${JSON.stringify(selector)});if(!n)return null;return{rect:r(n),clientHeight:n.clientHeight,scrollHeight:n.scrollHeight,scrollTop:n.scrollTop,clientWidth:n.clientWidth,scrollWidth:n.scrollWidth,style:n.getAttribute('style'),computedHeight:getComputedStyle(n).height}})()`)}
 async function swipeScroll(selector,up=true){
  const m=await scrollMetrics(selector);assert(m?.clientHeight>30,'real scroll viewport exists '+JSON.stringify(m))
  const r=m.rect,x=r.x+Math.min(r.width-20,90),low=r.bottom-14,high=r.y+14,from=up?low:high,to=up?high:low
  const p=(x,y)=>({id:1,x:Math.round(x),y:Math.round(y),radiusX:2,radiusY:2,force:1})
  await b.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1})
  await b.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[p(x,from)]})
  for(let i=1;i<=6;i++){await b.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[p(x,from+(to-from)*i/6)]});await delay(22)}
  await b.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await delay(180)
  return{before:m,after:await scrollMetrics(selector)}
 }
 async function safe(selector){const m=await ev(`(()=>{const r=${rect},n=document.querySelector(${JSON.stringify(selector)});return{panel:r(n),capsule:wx.getMenuButtonBoundingClientRect(),safe:wx.getWindowInfo().safeArea,w:innerWidth,h:innerHeight}})()`);assert(m.panel&&m.panel.y>=m.capsule.bottom+5&&m.panel.bottom<=m.safe.bottom+1&&m.panel.x>=-1&&m.panel.right<=m.w+1,'safe panel '+JSON.stringify(m));return m}
 async function photoSeed(){await ev(`(()=>{const p=window.__lightingQa.page,l=JSON.parse(JSON.stringify(p._layout));l.internalRods=l.internalRods.slice(0,2);l.frontRods=l.frontRods.slice(0,1);l.internalRods[0].distance=5.333333333333334;l.internalRods[1].distance=2.666666666666667;l.frontRods[0].distance=1.1454545454545455;l.positionsById={};const rods=[...l.frontRods,...l.internalRods],groups=[p._fixtures.slice(0,10),p._fixtures.slice(10,19),p._fixtures.slice(19)];groups.forEach((g,i)=>g.forEach((f,j)=>l.positionsById[f.stableId]={rodId:rods[i].id,t:(j+1)/(g.length+1)}));p._layout=l;p.saveLayoutOnly(l);p.updateLayoutData();p.drawLayout()})()`);await delay(180)}
 async function layoutMetrics(){return ev(`(()=>{const r=${rect},p=window.__lightingQa.page,g=p.getGeometry(),v=p._view,s=g.stage;return{window:{width:innerWidth,height:innerHeight},nav:r(document.querySelector('.layout-nav')),context:r(document.querySelector('.context-row')),picker:r(document.querySelector('.context-native-picker')),share:r(document.querySelector('[data-bindtap="generateLayoutImage"]')),canvas:r(document.getElementById('dmxLayoutCanvas')),toolbar:r(document.querySelector('.bottom-toolbar')),stage:{x:s.left*v.s+v.x,y:s.top*v.s+v.y,width:s.width*v.s,height:s.height*v.s},data:{navigationHeight:p.data.navigationHeight,canvasShellHeight:p.data.canvasShellHeight,statusBarHeight:p.data.statusBarHeight}}})()`)}
 try{
  if(phase==='main'||phase==='all')for(const p of profiles)await check('native-sized catalog and add touch-scroll '+p.width+'x'+p.height,async()=>{
   const tag=p.theme+'-'+p.width+'x'+p.height;await open(p)
   assert.equal(await ev("!!document.querySelector('.header-export')"),false,'main share removed')
   await click('.add-group-button');await delay(200);await safe('.fixture-search-sheet')
   const selector=await ev(`(()=>{const n=document.querySelector('.fixture-search-sheet scroll-view[scroll-y]');if(!n)return null;if(n.classList.contains('fixture-search-results'))return '.fixture-search-results';return '.fixture-search-content-scroll'})()`)
   const m=await scrollMetrics(selector),panel=await safe('.fixture-search-sheet');assert(m.rect.y>=panel.panel.y&&m.rect.bottom<=panel.panel.bottom+1,'catalog scroll viewport fits inside sheet');assert(m.scrollHeight>m.clientHeight+200,'catalog actually overflows vertically');assert(m.scrollWidth<=m.clientWidth+1,'catalog fits horizontally')
   const fixtureBefore=await ev('JSON.stringify(window.__lightingQa.page._calculationResult)'),writes=await ev('window.__lightingQa.events.writes.length')
   await shot('catalog-top-'+tag);const motion=await swipeScroll(selector)
   assert(motion.after.scrollTop>motion.before.scrollTop+20,'injected touch actually scrolls catalog '+JSON.stringify(motion))
   assert.equal(await ev('window.__lightingQa.data.fixtureSearchOpen'),true,'scroll cannot select fixture')
   assert.equal(await ev('window.__lightingQa.events.writes.length'),writes)
   assert.equal(await ev('JSON.stringify(window.__lightingQa.page._calculationResult)'),fixtureBefore)
   await shot('catalog-after-touch-'+tag);scenes.push({name:'catalog-motion-'+tag,motion})
   await dispatch('onFixtureSearchInput',{}, {value:'TL-SL323'});await dispatch('flushFixtureSearch');await click('.fixture-search-row')
   await dispatch('onPendingQuantityInput',{}, {value:'200'});await dispatch('onPendingQuantityBlur');await safe('.add-confirm-sheet')
   const add=await swipeScroll('.add-confirm-content-scroll');assert(add.after.scrollTop>add.before.scrollTop+10,'add preview scrolls through touch')
   const footer=await ev(`(()=>{const r=${rect};return{panel:r(document.querySelector('.add-confirm-sheet')),button:r(document.querySelector('.add-confirm-sheet .pending-confirm'))}})()`)
   assert(footer.button.height>=44&&footer.button.bottom<=footer.panel.bottom+1,'fixed add action stays visible');await shot('add-after-touch-'+tag)
  })
  if(phase==='layout'||phase==='all')for(const p of profiles)await check('layout context/share, color, icon, compact fit '+p.width+'x'+p.height,async()=>{
   const landscape=p.width>p.height,tag=p.theme+'-'+p.width+'x'+p.height
   let before=null
   if(landscape){await open(p,'landscape',{sourceVersion:'before',staleLandscape:'1'});await photoSeed();before=await layoutMetrics();await shot('layout-before-'+tag)}
   await open(p,landscape?'landscape':'layout',landscape?{staleLandscape:'1'}:{});await photoSeed()
   const m=await layoutMetrics();assert(m.context&&m.share&&m.picker,'project/share row exists')
   assert(m.share.x>=m.picker.right-1&&m.share.right<=p.width+1,'share is the right sibling of picker')
   assert(Math.abs((m.share.y+m.share.height/2)-(m.context.y+m.context.height/2))<=2,'share vertically centered on project row')
   assert.equal(await ev("!!document.querySelector('[data-bindtap=\"generateLayoutImage\"]').closest('picker')"),false,'share cannot open project picker')
   assert.equal(await ev("!!document.querySelector('[data-bindtap=\"openLocatePanel\"]')"),false,'locator removed')
   assert.equal(await ev("!!document.querySelector('.locate-card')"),false)
   assert(m.canvas.y>=m.context.bottom-1&&m.canvas.bottom<=m.toolbar.y+1,'canvas uses the remaining non-overlapping space')
   assert(Math.abs(m.canvas.height-m.data.canvasShellHeight)<=2,'native-size budget matches actual canvas')
   if(landscape){assert(m.data.statusBarHeight<=8,'portrait status44 does not inflate landscape header');assert(m.stage.width>=before.stage.width*1.12,'landscape subject grows at least 12% over exact baseline '+JSON.stringify({before,m}))}
   await ev('window.__lightingQa.events.rawCanvasTexts=[];window.__lightingQa.page.drawLayout()');await delay(150)
   const labels=await ev(`(()=>{const p=window.__lightingQa.page,palette=['#8a2bff','#007aff','#00b8ba'];return window.__lightingQa.events.rawCanvasTexts.filter(t=>t.canvasId==='dmxLayoutCanvas').map(t=>({...t,expected:palette[(p._fixtures.find(f=>f.addressText===t.text)?.groupIndex||0)%3]}))})()`)
   const addresses=labels.filter(t=>/^[A-Z]+\d{3,}$/.test(t.text));assert(addresses.length>0)
   if(landscape)assert(labels.every(t=>t.left>=-1&&t.top>=-1&&t.right<=m.canvas.width+1&&t.bottom<=m.canvas.height+1),'every landscape annotation fits actual canvas '+JSON.stringify(labels.filter(t=>t.left< -1||t.top< -1||t.right>m.canvas.width+1||t.bottom>m.canvas.height+1)))
   for(const l of addresses)assert.equal(l.color.toLowerCase(),l.expected,'address follows its fixture color '+l.text)
   for(const t of ['12 m','8 m','灯杆1','灯杆2','面光杆1','台口','观众区'])assert(labels.some(l=>l.text===t),'base label retained '+t)
   if(!landscape){const icon=await ev(`(()=>{const r=${rect},n=document.querySelector('.layout-orientation-button');return{box:r(n),children:[...n.querySelectorAll('view')].map(r),old:!!n.querySelector('.orientation-device,.orientation-arrow')}})()`);assert(icon.box.width>=44&&icon.box.height>=44&&!icon.old,'isolated non-stretching icon');assert(icon.children.every(c=>c.width>0&&c.height>0&&c.x>=icon.box.x&&c.right<=icon.box.right&&c.y>=icon.box.y&&c.bottom<=icon.box.bottom),'glyph fits its target')}
   await shot('layout-'+tag);scenes.push({name:'layout-metrics-'+tag,before,after:m,addresses})
   const unchanged=await ev('JSON.stringify(window.__lightingQa.page._layout.positionsById)')
   await dispatch('openLayoutSettings');await dispatch('onDraftArrangementTap',{mode:'uniform'});await dispatch('applyLayoutSettings');await ev('window.__answerModal(true)');await delay(250)
   const undo=await ev(`(()=>{const n=document.querySelector('.layout-undo-action');if(!n)return null;const r=n.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(n);const t=range.getBoundingClientRect();return{box:{x:r.x,y:r.y,width:r.width,height:r.height},text:{x:t.x,y:t.y,width:t.width,height:t.height}}})()`)
   assert(undo&&undo.box.height>=44,'undo has a touch-size target')
   assert(Math.abs(undo.box.x+undo.box.width/2-undo.text.x-undo.text.width/2)<=2&&Math.abs(undo.box.y+undo.box.height/2-undo.text.y-undo.text.height/2)<=3,'undo text centered '+JSON.stringify(undo))
   await shot('undo-'+tag);await click('.layout-undo-action');assert.equal(await ev('JSON.stringify(window.__lightingQa.page._layout.positionsById)'),unchanged,'undo restores physical positions')
  })
 }finally{fs.writeFileSync(path.join(out,'results-'+phase+'.json'),JSON.stringify({runAt:new Date().toISOString(),nativeRuntime:false,physicalDevice:false,profiles,results,scenes},null,2));await b.close()}
 console.log(results.filter(r=>r.passed).length+'/'+results.length+' round-three browser flows passed');if(results.some(r=>!r.passed))process.exitCode=1
}
run().catch(e=>{console.error(e);process.exitCode=1})
