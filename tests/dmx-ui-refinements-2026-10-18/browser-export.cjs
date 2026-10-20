// Real raw 2D raster export via the isolated browser adapter, never native QA.
const assert=require('node:assert/strict')
const fs=require('node:fs')
const path=require('node:path')
const crypto=require('node:crypto')
const {launch,delay}=require('./browser-driver.cjs')
const out=path.join(__dirname,'evidence/export')
fs.mkdirSync(out,{recursive:true})
async function run(){
  const browser=await launch(),results=[]
  try{
    for(const direction of ['bottom','top','left','right','dense','unplaced']){
      try{
        await browser.viewport(390,844,'light')
        await browser.navigate({page:'layout',fixture:direction==='dense'?'export-dense':'standard'})
        if(direction!=='unplaced')await browser.evaluate(`(()=>{
          const p=window.__lightingQa.page,l=JSON.parse(JSON.stringify(p._layout)),rods=[...l.internalRods,...l.frontRods]
          l.apronDirection=${JSON.stringify(['dense','unplaced'].includes(direction)?'bottom':direction)}
          l.positionsById={};rods.forEach((r,i)=>{const fixtures=p._fixtures.filter((_,index)=>index%rods.length===i);fixtures.forEach((f,index)=>{l.positionsById[f.stableId]={rodId:r.id,t:(index+1)/(fixtures.length+1)}})})
          p._layout=l;p.saveLayoutOnly(l);p.updateLayoutData();p.drawLayout()
        })()`)
        await delay(200)
        const before=await browser.evaluate(`({positions:JSON.stringify(window.__lightingQa.page._layout.positionsById),fixtures:JSON.stringify(window.__lightingQa.page._fixtures),writes:window.__lightingQa.events.writes.length})`)
        await browser.evaluate('window.__dispatch("generateLayoutImage")')
        await delay(150)
        const result=await browser.evaluate(`(()=>{
          const qa=window.__lightingQa,p=qa.page,n=document.getElementById('dmxLayoutExportCanvas'),ex=qa.events.exports
          const texts=qa.events.rawCanvasTexts.filter(t=>t.canvasId==='dmxLayoutExportCanvas')
          const node=document.createElement('canvas'),ctx=node.getContext('2d'),image=new Image()
          return new Promise((resolve,reject)=>{if(ex.length!==1)return reject(Error('Expected one actual canvasToTempFilePath export, got '+ex.length));image.onload=()=>{
            node.width=image.width;node.height=image.height;ctx.drawImage(image,0,0);const data=ctx.getImageData(0,0,node.width,node.height).data
            let colored=0,dark=0;for(let i=0;i<data.length;i+=16){if(data[i+3]&&Math.max(data[i],data[i+1],data[i+2])-Math.min(data[i],data[i+1],data[i+2])>35)colored++;if(data[i]+data[i+1]+data[i+2]<500)dark++}
            resolve({url:ex[0].url,width:image.width,height:image.height,coloredSamples:colored,darkSamples:dark,texts,positions:JSON.stringify(p._layout.positionsById),fixtures:JSON.stringify(p._fixtures),writes:qa.events.writes.length,paths:p.data.layoutImagePaths.length,errors:qa.events.errors})
          };image.onerror=reject;image.src=ex[0].url})
        })()`)
        assert.deepEqual(result.errors,[])
        assert.equal(result.paths,1)
        assert.equal(result.positions,before.positions)
        assert.equal(result.fixtures,before.fixtures)
        assert.equal(result.writes,before.writes,'export does not persist anything')
        assert(result.width>700&&result.width<=4096&&result.height>700&&result.height<=4096)
        assert(result.coloredSamples>200&&result.darkSamples>150,'diagram pixels, dimensions and fixtures must be nonempty')
        const text=result.texts.map(t=>t.text),addresses=result.texts.filter(t=>/^[A-Z]+\d{3,}$/.test(t.text))
        for(const label of ['灯位图','台口','观众区','12 m','8 m'])assert(text.includes(label),direction+' diagram includes '+label)
        assert(!text.some(t=>/灯具地址清单|灯具编址与灯位图|未上杆|\bCH\b/.test(t)),direction+' diagram must omit address report')
        if(direction==='unplaced')assert.equal(addresses.length,0,'unplaced fixtures must not be drawn on rods')
        else assert(addresses.length>0,'placed addresses retained')
        assert(result.texts.every(t=>t.left>=-1&&t.top>=-1&&t.right<=result.width+1&&t.bottom<=result.height+1),'all actual text pixels stay inside PNG bounds')
        for(let i=0;i<addresses.length;i++)for(let j=i+1;j<addresses.length;j++){
          const a=addresses[i],b=addresses[j]
          assert(!(a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top),'export address pixels must not overlap: '+JSON.stringify({a,b}))
        }
        const file=path.join(out,'diagram-'+direction+'.png'),bytes=Buffer.from(result.url.split(',')[1],'base64');fs.writeFileSync(file,bytes)
        results.push({direction,passed:true,file,width:result.width,height:result.height,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),fixtureCount:JSON.parse(result.fixtures).length,drawnAddressCount:addresses.length,coloredSamples:result.coloredSamples,darkSamples:result.darkSamples,texts:result.texts})
        console.log('PASS raw diagram PNG '+direction+' '+result.width+'x'+result.height+' '+addresses.length+' addresses')
      }catch(error){results.push({direction,passed:false,error:error.stack});console.error('FAIL raw diagram PNG '+direction+': '+error.message)}
    }
  }finally{fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify({runAt:new Date().toISOString(),nativeRuntime:false,physicalDevice:false,results},null,2));await browser.close()}
  if(results.some(r=>!r.passed))process.exitCode=1
}
run().catch(error=>{console.error(error);process.exitCode=1})
