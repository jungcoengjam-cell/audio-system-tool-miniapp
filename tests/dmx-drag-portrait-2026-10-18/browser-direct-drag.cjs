// Source-backed actual Chromium touch. This is not a native WeChat/device test.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{launch,delay}=require('../dmx-ui-round3-2026-10-18/browser-driver.cjs')
const out=path.join(__dirname,'evidence/browser');fs.mkdirSync(out,{recursive:true})
async function run(){const b=await launch(),results=[];try{for(const profile of [{width:390,height:844,theme:'light'},{width:320,height:568,theme:'dark'}]){
 await b.viewport(profile.width,profile.height,profile.theme);await b.navigate({page:'layout',theme:profile.theme});await delay(120)
 assert.equal(await b.evaluate('!!document.querySelector("[data-bindtap=\\"openLandscapeLayout\\"],.layout-orientation-button")'),false,'No landscape entry')
 const seed=await b.evaluate(`(()=>{const p=window.__lightingQa.page,l=JSON.parse(JSON.stringify(p._layout)),f=p._fixtures[0];l.positionsById={[f.stableId]:{rodId:l.internalRods[0].id,t:.5}};p._layout=l;p.saveLayoutOnly(l);p.updateLayoutData();p.drawLayout();return{id:f.stableId,address:f.addressText}})()`);await delay(120)
 const points=await b.evaluate(`(()=>{const p=window.__lightingQa.page,g=p.getGeometry(),v=p._view,r=p._canvasRect,pt=(rod,t)=>({x:r.left+(rod.x1+(rod.x2-rod.x1)*t)*v.s+v.x,y:r.top+(rod.y1+(rod.y2-rod.y1)*t)*v.s+v.y}),a=g.rods.find(r=>r.id===p._layout.internalRods[0].id),z=g.rods.find(r=>r.id===p._layout.frontRods[0].id);return{start:pt(a,.5),end:pt(z,.69),target:z.id,before:window.__lightingQa.events.writes.length,fixtures:JSON.stringify(p._fixtures),checks:JSON.stringify(p._scheme.checksById),view:JSON.stringify(p._view)}})()`)
 const touch=q=>({id:1,x:q.x,y:q.y,radiusX:2,radiusY:2,force:1})
 await b.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:2});await b.evaluate('window.__dragStartAt=performance.now()')
 await b.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[touch(points.start)]})
 const first={x:points.start.x+18,y:points.start.y+4};await b.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[touch(first)]})
 const immediate=await b.evaluate('({dragging:window.__lightingQa.page._touchState?.dragging,elapsed:performance.now()-window.__dragStartAt,view:JSON.stringify(window.__lightingQa.page._view),writes:window.__lightingQa.events.writes.length})')
 assert(immediate.elapsed<380,'Drag assertion must precede former long-press timeout');assert.equal(immediate.dragging,true,'First immediate move starts lamp drag');assert.equal(immediate.view,points.view,'Dragging lamp does not pan canvas');assert.equal(immediate.writes,points.before)
 for(let i=1;i<=6;i++){await b.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[touch({x:first.x+(points.end.x-first.x)*i/6,y:first.y+(points.end.y-first.y)*i/6})]});await delay(15)}
 assert.equal(await b.evaluate('window.__lightingQa.events.writes.length'),points.before,'Preview does not persist')
 await b.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await delay(100)
 const after=await b.evaluate(`(()=>{const p=window.__lightingQa.page;return{position:p._layout.positionsById[${JSON.stringify(seed.id)}],writes:window.__lightingQa.events.writes.length,fixtures:JSON.stringify(p._fixtures),checks:JSON.stringify(p._scheme.checksById),view:JSON.stringify(p._view),errors:window.__facts().runtimeErrors}})()`)
 assert.equal(after.position.rodId,points.target);assert(Math.abs(after.position.t-.69)<.01);assert(after.writes>points.before);assert.equal(after.fixtures,points.fixtures);assert.equal(after.checks,points.checks);assert.equal(after.view,points.view);assert.deepEqual(after.errors,[])
 const file=path.join(out,'direct-drag-'+profile.width+'.png');await b.screenshot(file);results.push({profile,seed,points,immediate,after,file,passed:true});console.log('PASS immediate touch drag and cross-rod snap '+profile.width+'x'+profile.height)
}}finally{fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify({runAt:new Date().toISOString(),nativeRuntime:false,physicalDevice:false,results},null,2));await b.close()}}
run().catch(e=>{console.error(e);process.exitCode=1})
