// Real Chromium touch dispatch into production canvas handlers. Not native-device validation.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{launch,delay}=require('./browser-driver.cjs')
async function run(){const b=await launch(),out=path.join(__dirname,'evidence/browser');fs.mkdirSync(out,{recursive:true});try{
 await b.viewport(390,844,'light');await b.navigate({page:'layout'});await delay(150)
 const seed=await b.evaluate(`(()=>{const p=window.__lightingQa.page,l=JSON.parse(JSON.stringify(p._layout)),f=p._fixtures[0];l.positionsById={[f.stableId]:{rodId:l.internalRods[0].id,t:.5}};p._layout=l;p.saveLayoutOnly(l);p.updateLayoutData();p.drawLayout();return{id:f.stableId,address:f.addressText}})()`);await delay(160)
 const points=await b.evaluate(`(()=>{const p=window.__lightingQa.page,g=p.getGeometry(),v=p._view,r=p._canvasRect,pt=(rod,t)=>({x:r.left+(rod.x1+(rod.x2-rod.x1)*t)*v.s+v.x,y:r.top+(rod.y1+(rod.y2-rod.y1)*t)*v.s+v.y}),a=g.rods.find(r=>r.id===p._layout.internalRods[0].id),z=g.rods.find(r=>r.id===p._layout.frontRods[0].id);return{start:pt(a,.5),end:pt(z,.69),target:z.id,before:window.__lightingQa.events.writes.length,fixtures:JSON.stringify(p._fixtures),checks:JSON.stringify(p._scheme.checksById)}})()`)
 const touch=q=>({id:1,x:q.x,y:q.y,radiusX:2,radiusY:2,force:1})
 await b.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:2});await b.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[touch(points.start)]});await delay(440)
 assert.equal(await b.evaluate('window.__lightingQa.page._touchState?.dragging'),true,'actual long press starts drag')
 for(let i=1;i<=8;i++){const q={x:points.start.x+(points.end.x-points.start.x)*i/8,y:points.start.y+(points.end.y-points.start.y)*i/8};await b.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[touch(q)]});await delay(22)}
 assert.equal(await b.evaluate('window.__lightingQa.events.writes.length'),points.before,'real touch preview is write-free')
 await b.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await delay(150)
 const after=await b.evaluate(`(()=>{const p=window.__lightingQa.page;return{position:p._layout.positionsById[${JSON.stringify(seed.id)}],writes:window.__lightingQa.events.writes.length,fixtures:JSON.stringify(p._fixtures),checks:JSON.stringify(p._scheme.checksById),errors:window.__facts().runtimeErrors}})()`)
 assert.equal(after.position.rodId,points.target);assert(Math.abs(after.position.t-.69)<.01);assert(after.writes>points.before);assert.equal(after.fixtures,points.fixtures);assert.equal(after.checks,points.checks);assert.deepEqual(after.errors,[])
 await b.screenshot(path.join(out,'cross-rod-touch.png'));fs.writeFileSync(path.join(out,'cross-rod-touch.json'),JSON.stringify({runAt:new Date().toISOString(),passed:true,nativeRuntime:false,physicalDevice:false,seed,points,after},null,2));console.log('PASS actual long-press touch drag across rods and snap on release')
}finally{await b.close()}}
run().catch(e=>{console.error(e);process.exitCode=1})
