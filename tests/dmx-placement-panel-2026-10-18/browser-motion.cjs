const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{launch,delay}=require('../dmx-ui-round3-2026-10-18/browser-driver.cjs')
const out=path.join(__dirname,'evidence/motion');fs.mkdirSync(out,{recursive:true})
async function run(){const b=await launch(),results=[];const ev=s=>b.evaluate(s),d=(m,data={})=>ev(`window.__dispatch(${JSON.stringify(m)},${JSON.stringify(data)})`),click=s=>ev(`document.querySelector(${JSON.stringify(s)}).click()`)
async function state(s){return ev(`(()=>{const n=document.querySelector(${JSON.stringify(s)});if(!n)return null;const c=getComputedStyle(n),r=n.getBoundingClientRect();let opacity=1;for(let a=n;a;a=a.parentElement)opacity*=Number(getComputedStyle(a).opacity);return{animation:c.animationName,duration:c.animationDuration,opacity,x:r.x,y:r.y,width:r.width,height:r.height,writes:window.__lightingQa.events.writes.length}})()`)}
const scenarios=[
 {name:'catalog',page:'main',panel:'.fixture-search-sheet',close:'.fixture-search-sheet .sheet-dismiss',open:()=>d('addGroup')},
 {name:'add',page:'main',panel:'.add-confirm-sheet',close:'.pending-overlay',open:async()=>{await d('addGroup');await d('selectFixture',{model:'TL-SL323'})}},
 {name:'delete',page:'main',panel:'.pending-sheet',close:'.pending-sheet .sheet-dismiss',open:()=>d('requestDeleteGroup',{index:0}),commit:'.pending-confirm'},
 {name:'save',page:'main',panel:'.save-project-sheet',close:'.save-project-sheet .sheet-dismiss',open:()=>d('onSaveNewProjectToggle')},
 {name:'guide',page:'main',panel:'.fixture-channel-guide-sheet',close:'.fixture-channel-guide-sheet .sheet-dismiss',open:async()=>{const n=await ev('window.__lightingQa.page._calculationResult.fixtures[0].globalIndex');await d('openFixtureChannelGuide',{globalIndex:n})}},
 {name:'placement',page:'layout',panel:'.placement-card',close:'.placement-overlay',open:()=>d('openPlacementPanel')},
 {name:'settings',page:'layout',panel:'.settings-card',close:'.settings-heading .sheet-close',open:()=>d('openLayoutSettings')},
 {name:'export',page:'layout',panel:'.export-sheet',close:'.export-heading .sheet-close',open:()=>d('generateLayoutImage')},
]
try{for(const reduced of [false,true])for(const s of scenarios){await b.viewport(390,844,'light',reduced?'reduce':'no-preference');await b.navigate({page:s.page});await delay(70);await s.open();const entering=await state(s.panel);assert(entering,'panel opens '+s.name)
 if(reduced)assert.equal(entering.animation,'none','reduced motion '+s.name);else assert(entering.animation!=='none'&&entering.duration.split(',').some(t=>parseFloat(t)>=.16),'visible entry animation '+s.name+' '+JSON.stringify(entering))
 assert(Math.abs(entering.x+entering.width/2-195)<=1,'entry retains horizontal alignment '+s.name)
 await delay(240);const settled=await state(s.panel);assert(settled&&settled.opacity>.98);const writes=settled.writes;await click(s.close)
 if(s.commit)await click(s.commit)
 await delay(35);const exiting=await state(s.panel);assert(exiting,'panel retained during exit '+s.name);if(!reduced)assert(exiting.opacity<.99&&exiting.opacity>=0,'visible exit animation '+s.name+' '+JSON.stringify(exiting))
 await delay(220);assert.equal(await state(s.panel),null,'panel removed after exit '+s.name);if(s.page==='layout')assert.equal(await ev('!!document.getElementById("dmxLayoutCanvas")'),true,'fresh stage canvas returns after exit '+s.name);assert.equal(await ev('window.__lightingQa.events.writes.length'),writes,'user close cannot commit '+s.name);assert.deepEqual(await ev('window.__facts().runtimeErrors'),[])
 results.push({name:s.name,reduced,entering,settled,exiting});console.log('PASS open/close motion '+s.name+' reduced='+reduced)
 }
 await b.viewport(390,844,'light');await b.navigate({page:'main'});await d('addGroup');await click('.fixture-search-sheet .sheet-dismiss');await d('addGroup');await delay(260);assert(await state('.fixture-search-sheet'),'late close must not remove reopened catalog');results.push({name:'rapid-reopen',passed:true})
 await b.navigate({page:'main'});await d('addGroup');await d('selectFixture',{model:'TL-SL323'});await click('.add-confirm-reselect');assert.equal(await ev('window.__lightingQa.page.data.fixtureSearchOpen'),true,'reselect is synchronous');assert.equal(await state('.add-confirm-sheet'),null,'internal reselect does not wait for close animation');results.push({name:'internal-reselect-sync',passed:true})
}finally{fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify({runAt:new Date().toISOString(),nativeRuntime:false,physicalDevice:false,results},null,2));await b.close()}}
run().catch(e=>{console.error(e);process.exitCode=1})
