// Reuse the source-backed adapter; native WeChat remains a separate acceptance step.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto')
const previous=path.resolve(__dirname,'../dmx-ui-refinements-2026-10-18')
const names=['browser-driver.cjs','browser-host.cjs','browser.html','browser-runtime.js','browser.js','compile.cjs']
for(const name of names){
  let source=fs.readFileSync(path.join(previous,name),'utf8').replaceAll('dmx-ui-refinements-2026-10-18','dmx-ui-round3-2026-10-18')
  if(['browser-runtime.js','browser.js'].includes(name)){
    source=source.replace("const landscape=innerWidth>innerHeight, top=landscape?0:44, bottom=landscape?21:34", "const landscape=innerWidth>innerHeight, top=landscape?(query.get('staleLandscape')==='1'?44:0):44, bottom=landscape?21:34")
    source=source.replace('font=context.font,align=context.textAlign,baseline=context.textBaseline','font=context.font,color=context.fillStyle,align=context.textAlign,baseline=context.textBaseline')
    source=source.replace('text:String(text),font,align,baseline,left:', 'text:String(text),font,color,align,baseline,left:')
    source=source.replace('if(catchMethod)return}}', 'if(catchMethod)return true}}')
    source=source.replace("app.addEventListener(type,event=>nativeEvent(event.target,type,{}, {touches:", "app.addEventListener(type,event=>{const blocked=nativeEvent(event.target,type,{}, {touches:")
    source=source.replace("timeStamp:event.timeStamp}),{passive:false})", "timeStamp:event.timeStamp});if(blocked&&type==='touchmove')event.preventDefault()},{passive:false})")
  }
  fs.writeFileSync(path.join(__dirname,name),source)
}
const original='C:/Users/wxx/.codex/codex-remote-attachments/01a14ae2-45ed-76d1-aeba-1959deacbdd4/EC022F6F-148B-4A7C-9C02-25466D21AD6F'
const references=path.join(__dirname,'references');fs.mkdirSync(references,{recursive:true})
const photos=[]
for(let i=1;i<=5;i++){
  const from=path.join(original,`${i}-相片-${i}.jpg`),to=path.join(references,`photo-${i}.jpg`)
  fs.copyFileSync(from,to);photos.push({original:from,local:`photo-${i}.jpg`,sha256:crypto.createHash('sha256').update(fs.readFileSync(to)).digest('hex')})
}
fs.writeFileSync(path.join(references,'sources.json'),JSON.stringify({copiedAt:new Date().toISOString(),photos},null,2))
console.log('Round-three browser adapter prepared; five user reference images preserved.')
