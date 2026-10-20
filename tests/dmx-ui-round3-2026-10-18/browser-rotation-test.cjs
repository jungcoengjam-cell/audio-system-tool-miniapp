// Exercise actual page onResize through Chromium viewport changes.
const assert=require('node:assert/strict')
const fs=require('node:fs')
const path=require('node:path')
const {launch,delay}=require('./browser-driver.cjs')
const out=path.join(__dirname,'evidence/rotation')
fs.mkdirSync(out,{recursive:true})
async function main(){
  const browser=await launch(),scenes=[]
  try{
    await browser.viewport(390,844,'light')
    // WeChat can load the landscape route before the actual rotation callback.
    await browser.navigate({page:'landscape',lightingContextName:encodeURIComponent('临时设置')})
    assert.equal(await browser.evaluate('window.__lightingQa.data.contextLabel'),'临时设置')
    await browser.evaluate(`(()=>{const p=window.__lightingQa.page;window.__qaBeforeRotation=JSON.stringify({scheme:p._scheme,layout:p._layout});window.__qaCanvasBeforeRotation=p._canvasNode})()`)
    for(const [width,height]of [[844,390],[568,320],[390,844]]){
      await browser.viewport(width,height,'light');await delay(300)
      const metrics=await browser.evaluate(`(()=>{const p=window.__lightingQa.page,n=document.getElementById('dmxLayoutCanvas'),r=n.getBoundingClientRect(),g=p.getGeometry(),s=g.stage,v=p._view;return{data:{windowWidth:p.data.windowWidth,windowHeight:p.data.windowHeight,canvasShellHeight:p.data.canvasShellHeight},canvas:{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height,backingWidth:n.width,backingHeight:n.height},stage:{left:s.left*v.s+v.x,top:s.top*v.s+v.y,right:(s.left+s.width)*v.s+v.x,bottom:(s.top+s.height)*v.s+v.y},stateUnchanged:JSON.stringify({scheme:p._scheme,layout:p._layout})===window.__qaBeforeRotation,errors:window.__lightingQa.events.errors}})()`)
      assert.deepEqual(metrics.errors,[])
      assert.equal(metrics.data.windowWidth,width)
      assert.equal(metrics.data.windowHeight,height)
      assert(metrics.canvas.width>0&&metrics.canvas.height>0)
      assert(metrics.canvas.x>=-1&&metrics.canvas.y>=-1&&metrics.canvas.right<=width+1&&metrics.canvas.bottom<=height+1,'canvas remains in actual resized window')
      assert(Math.abs(metrics.canvas.backingWidth-metrics.canvas.width)<=1&&Math.abs(metrics.canvas.backingHeight-metrics.canvas.height)<=1,'raw node backing remeasured after rotation')
      assert(metrics.stage.left>=-1&&metrics.stage.top>=-1&&metrics.stage.right<=metrics.canvas.width+1&&metrics.stage.bottom<=metrics.canvas.height+1,'stage uses the new real canvas viewport')
      assert(metrics.stateUnchanged,'rotation cannot alter scheme or physical lamp positions')
      const file=path.join(out,`landscape-route-${width}x${height}.png`);await browser.screenshot(file);scenes.push({file,...metrics})
    }
    await browser.evaluate('window.__dispatch("openLayoutSettings")')
    await browser.viewport(568,320,'light');await delay(300)
    const blocked=await browser.evaluate(`(()=>{const p=window.__lightingQa.page,r=document.querySelector('.settings-card').getBoundingClientRect();return{node:!!document.getElementById('dmxLayoutCanvas'),boundNode:!!p._canvasNode,top:r.top,bottom:r.bottom,safeTop:p.data.overlaySafeTop,safeBottom:p.data.overlaySafeBottom,height:innerHeight}})()`)
    assert.equal(blocked.node,false)
    assert.equal(blocked.boundNode,false)
    assert(blocked.top>=blocked.safeTop-1&&blocked.bottom<=blocked.height-blocked.safeBottom+1,'modal reflows while the native stage stays unmounted')
    await browser.evaluate('window.__dispatch("closeLayoutSettings")');await delay(300)
    const restored=await browser.evaluate(`(()=>{const p=window.__lightingQa.page;return{node:!!p._canvasNode,fresh:p._canvasNode!==window.__qaCanvasBeforeRotation,stateUnchanged:JSON.stringify({scheme:p._scheme,layout:p._layout})===window.__qaBeforeRotation}})()`)
    assert(restored.node&&restored.fresh&&restored.stateUnchanged)
    console.log('Real browser rotation, encoded label, safe modal and fresh canvas restore passed')
  }finally{fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify({runAt:new Date().toISOString(),nativeRuntime:false,physicalDevice:false,scenes},null,2));await browser.close()}
}
main().catch(error=>{console.error(error);process.exitCode=1})
