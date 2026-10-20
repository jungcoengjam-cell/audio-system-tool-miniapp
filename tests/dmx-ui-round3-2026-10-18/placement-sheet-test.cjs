// Preserve the old compact placement-sheet checks after removing the locator UI.
const assert=require('node:assert/strict'),{launch,delay}=require('./browser-driver.cjs')
async function run(){const b=await launch();try{for(const [width,height,theme]of [[390,844,'light'],[844,390,'light'],[568,320,'dark']]){
 await b.viewport(width,height,theme);await b.navigate({page:'landscape',theme});await b.evaluate('window.__dispatch("openPlacementPanel")');await delay(80)
 const m=await b.evaluate(`(()=>{const rect=n=>{const r=n.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height}},panel=document.querySelector('.placement-card'),body=panel.querySelector('.fixture-selection-list'),summary=panel.querySelector('.placement-summary'),mask=document.querySelector('.placement-overlay'),p=window.__lightingQa.page;return{panel:rect(panel),body:rect(body),summary:rect(summary),mask:rect(mask),hit:mask.contains(document.elementFromPoint(24,20)),navs:window.__lightingQa.events.navigations.length,safeTop:p.data.overlaySafeTop,safeBottom:p.data.overlaySafeBottom}})()`)
 assert(m.panel.height>0&&m.body.height>0);assert(m.panel.y>=m.safeTop-1&&m.panel.bottom<=height-m.safeBottom+1);assert(m.body.bottom<=m.summary.y+1);assert(m.summary.y>=m.panel.y&&m.summary.bottom<=m.panel.bottom+1);assert.deepEqual([m.mask.x,m.mask.y,m.mask.width,m.mask.height],[0,0,width,height]);assert(m.hit)
 await b.evaluate('document.elementFromPoint(24,20).click()');await delay(240);assert.equal(await b.evaluate('window.__lightingQa.events.navigations.length'),m.navs);assert.equal(await b.evaluate('!!document.querySelector(".locate-overlay")'),false)
 console.log('PASS compact placement sheet '+width+'x'+height)
}}finally{await b.close()}}
run().catch(e=>{console.error(e);process.exitCode=1})
