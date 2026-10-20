// Production WXML/WXSS in isolated Chromium; native WeChat/device acceptance is separate.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{launch,delay}=require('../dmx-ui-round3-2026-10-18/browser-driver.cjs')
const out=path.join(__dirname,'evidence/corners');fs.mkdirSync(out,{recursive:true})
async function run(){const b=await launch(),results=[];const ev=s=>b.evaluate(s),dispatch=(m,d={},v={})=>ev(`window.__dispatch(${JSON.stringify(m)},${JSON.stringify(d)},${JSON.stringify(v)})`)
async function inspect(selector,tag){await delay(260);const m=await ev(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});if(!n)throw Error('Missing '+${JSON.stringify(selector)});const r=n.getBoundingClientRect(),s=getComputedStyle(n);return{rect:{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom},radii:[s.borderTopLeftRadius,s.borderTopRightRadius,s.borderBottomLeftRadius,s.borderBottomRightRadius],overflow:s.overflow,cornerHits:[document.elementFromPoint(r.x+1,r.bottom-1),document.elementFromPoint(r.right-1,r.bottom-1)].map(p=>!!p&&n.contains(p)),viewport:{w:innerWidth,h:innerHeight},errors:window.__facts().runtimeErrors}})()`)
 assert(m.radii.every(r=>parseFloat(r)>0),'four rounded corners '+selector+' '+JSON.stringify(m));assert(['hidden','clip'].includes(m.overflow),'rounded panel clips its contents '+selector);assert(m.rect.x>=-1&&m.rect.right<=m.viewport.w+1&&m.rect.y>=-1&&m.rect.bottom<=m.viewport.h+1,'panel fits viewport '+selector);assert(m.cornerHits.every(v=>!v),'actual lower corner pixels hit backdrop '+selector);assert.deepEqual(m.errors,[]);const file=path.join(out,tag+'.png');await b.screenshot(file);results.push({tag,selector,...m,file});console.log('PASS four corners '+tag)}
try{for(const p of [{width:390,height:844,theme:'light'},{width:320,height:568,theme:'dark'},{width:568,height:320,theme:'dark'}]){
 const tag=p.width+'x'+p.height+'-'+p.theme,open=async page=>{await b.viewport(p.width,p.height,p.theme);await b.navigate({page,theme:p.theme});await delay(120)}
 await open('main');await dispatch('addGroup');await inspect('.fixture-search-sheet','catalog-'+tag)
 await dispatch('selectFixture',{model:'TL-SL323'});await inspect('.add-confirm-sheet','add-'+tag)
 await open('main');await dispatch('requestDeleteGroup',{index:0});await inspect('.pending-sheet','delete-'+tag)
 await open('main');await dispatch('onSaveNewProjectToggle');await inspect('.save-project-sheet','save-'+tag)
 await open('main');const gi=await ev('window.__lightingQa.page._calculationResult.fixtures[0].globalIndex');await dispatch('openFixtureChannelGuide',{globalIndex:gi});await inspect('.fixture-channel-guide-sheet','guide-'+tag)
 await open('main');await dispatch('openFloatingCard',{index:0});await inspect('.floating-card','floating-'+tag)
 await open('layout');await dispatch('openPlacementPanel');await inspect('.placement-card','placement-'+tag)
 await open('layout');await dispatch('openLayoutSettings');await inspect('.settings-card','settings-'+tag)
 // A real placed fixture on the last internal rod triggers the real reduction confirmation.
 await open('layout');await ev(`(()=>{const p=window.__lightingQa.page,l=JSON.parse(JSON.stringify(p._layout));l.positionsById={[p._fixtures[0].stableId]:{rodId:l.internalRods.at(-1).id,t:.5}};p._layout=l;p.saveLayoutOnly(l);p.updateLayoutData()})()`)
 await dispatch('openLayoutSettings');await dispatch('changeDraftRodCount',{kind:'internalRods',delta:-1});await dispatch('applyLayoutSettings');await inspect('.reduction-card','reduction-'+tag)
 await open('layout');await dispatch('generateLayoutImage');await inspect('.export-sheet','image-'+tag)
 const close=await ev(`(()=>{const n=document.querySelector('.export-heading button.sheet-close'),p=document.querySelector('.export-sheet'),r=n.getBoundingClientRect(),s=p.getBoundingClientRect();return{button:{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height},sheet:{x:s.x,right:s.right,top:s.y}}})()`);assert(close.button.height>=44&&close.button.width<=70&&close.sheet.right-close.button.right<=24,'image close fixed at header right '+JSON.stringify(close))
 }}finally{fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify({runAt:new Date().toISOString(),nativeRuntime:false,physicalDevice:false,results},null,2));await b.close()}}
run().catch(e=>{console.error(e);process.exitCode=1})
