// Reuse the prior source-backed adapter without changing historical QA files.
// This remains a browser/controller test, not a WeChat or phone test.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const previous = path.resolve(__dirname, '../dmx-ui-refactor-2026-10-18')
const read = name => fs.readFileSync(path.join(previous, name), 'utf8')
const write = (name, source) => fs.writeFileSync(path.join(__dirname, name), source)
write('browser-driver.cjs', read('browser-driver.cjs').replaceAll('tests/dmx-ui-refactor-2026-10-18/browser.html', 'tests/dmx-ui-refinements-2026-10-18/browser.html'))
write('browser-host.cjs', read('browser-host.cjs').replace("'baseline/source'", "'baseline'").replaceAll('tests/dmx-ui-refactor-2026-10-18/browser.html', 'tests/dmx-ui-refinements-2026-10-18/browser.html'))
write('browser.html', read('browser.html').replace('</body>', '<aside id="qa-capsule" aria-label="Simulated capsule exclusion area" style="position:fixed;z-index:999999;pointer-events:none;border-radius:20px;border:1px dashed #607080;background:#f8fbffb8;box-sizing:border-box;text-align:center;font:10px/30px sans-serif;color:#607080">QA capsule</aside></body>'))
const parser = read('browser.js').split('// The page modules, handlers, WXML and WXSS below all come from production files.')[0]
let runtime = read('browser-runtime.js')
const oldSystem = runtime.slice(runtime.indexOf('const systemInfo ='), runtime.indexOf('window.wx ='))
runtime = runtime.replace(oldSystem, `const systemInfo = () => {
  const landscape=innerWidth>innerHeight, top=landscape?0:44, bottom=landscape?21:34
  return {theme,windowWidth:innerWidth,windowHeight:innerHeight,screenWidth:innerWidth,screenHeight:innerHeight,pixelRatio:1,statusBarHeight:top,safeArea:{left:0,top,right:innerWidth,bottom:innerHeight-bottom,height:innerHeight-top-bottom,width:innerWidth},platform:'devtools',SDKVersion:'3.16.2',benchmarkLevel:50,system:'QA browser'}
}
const capsuleInfo = () => {
  const landscape=innerWidth>innerHeight, top=landscape?8:52, rect={left:innerWidth-97,right:innerWidth-10,top,bottom:top+32,width:87,height:32}
  const marker=document.getElementById('qa-capsule');if(marker)Object.assign(marker.style,{left:rect.left+'px',top:rect.top+'px',width:rect.width+'px',height:rect.height+'px'})
  return rect
}
`)
runtime = runtime.replace('getMenuButtonBoundingClientRect: () => ({left:innerWidth-97,right:innerWidth-10,top:28,bottom:60,width:87,height:32}),', 'getMenuButtonBoundingClientRect: capsuleInfo,')
runtime = runtime.replace("try{context.fillText=(text,...args)=>{events.rawCanvasTexts.push({canvasId:node.id,text:String(text)});return fillText(text,...args)}}catch(_){ }", `try{context.fillText=(text,x,y,...args)=>{
  const metrics=context.measureText(String(text)),m=context.getTransform(),font=context.font,align=context.textAlign,baseline=context.textBaseline
  const left=x-(align==='center'?metrics.width/2:align==='right'||align==='end'?metrics.width:0),top=y-metrics.actualBoundingBoxAscent,bottom=y+metrics.actualBoundingBoxDescent
  const corners=[[left,top],[left+metrics.width,top],[left,bottom],[left+metrics.width,bottom]].map(([px,py])=>({x:m.a*px+m.c*py+m.e,y:m.b*px+m.d*py+m.f}))
  events.rawCanvasTexts.push({canvasId:node.id,text:String(text),font,align,baseline,left:Math.min(...corners.map(p=>p.x)),right:Math.max(...corners.map(p=>p.x)),top:Math.min(...corners.map(p=>p.y)),bottom:Math.max(...corners.map(p=>p.y))})
  return fillText(text,x,y,...args)
}}catch(_){ }`)
runtime = runtime.replace("await window.__openPage(query.get('page')==='layout'?'pages/dmx-layout/dmx-layout.js':'pages/dmx-address/dmx-address.js',loadOptions)", "await window.__openPage(query.get('page')==='landscape'?'pages/dmx-layout-landscape/dmx-layout-landscape.js':query.get('page')==='layout'?'pages/dmx-layout/dmx-layout.js':'pages/dmx-address/dmx-address.js',loadOptions)")
runtime = runtime.replace('boot().catch(reportError)', "window.addEventListener('resize',()=>{capsuleInfo();page?.onResize?.({size:{windowWidth:innerWidth,windowHeight:innerHeight,width:innerWidth,height:innerHeight}})})\nboot().catch(reportError)")
write('browser-runtime.js', runtime)
write('browser.js', parser + runtime)
write('compile.cjs', read('compile.cjs'))
const references = path.join(__dirname, 'references')
fs.mkdirSync(references, {recursive:true})
const photos = 'C:/Users/wxx/.codex/codex-remote-attachments/01a14ae2-45ed-76d1-aeba-1959deacbdd4/39106820-8A40-488B-B17E-EDA74C91E6EA'
const entries = []
for(let i=1;i<=7;i++){
  const from=path.join(photos,`${i}-相片-${i}.jpg`),to=path.join(references,`photo-${i}.jpg`)
  fs.copyFileSync(from,to)
  entries.push({original:from,local:path.relative(__dirname,to).replaceAll('\\','/'),sha256:crypto.createHash('sha256').update(fs.readFileSync(to)).digest('hex')})
}
fs.writeFileSync(path.join(references,'sources.json'),JSON.stringify({copiedAt:new Date().toISOString(),entries},null,2))
console.log('Prepared isolated refinement browser adapter and preserved seven user references.')
