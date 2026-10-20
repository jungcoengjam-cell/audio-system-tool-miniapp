'use strict'
const fs = require('node:fs')
const path = require('node:path')
const {launch,delay} = require('./browser-driver.cjs')
async function main() {
 const browser = await launch()
 const evidence = path.join(__dirname,'evidence/browser')
 fs.mkdirSync(evidence,{recursive:true})
 const scenes = []
 try {
  const phase = process.argv[2] || 'before'
  const entries = phase === 'before' ? ['pages/tools/tools.js','pages/projects/projects.js','pages/index/index.js'] : ['pages/tools/tools.js','pages/projects/projects.js','pages/index/index.js','pages/settings/settings.js','pages/basis/detail.js']
  for (const theme of ['light','dark']) for (const entry of entries) for (const width of (phase==='before'?[390]:[320,390,430])) {
   const name=phase+'-'+entry.split('/')[1]+'-'+theme+'-'+width
   await browser.viewport(width,844,theme)
   await browser.navigate({theme,entry,...(entry==='pages/basis/detail.js'?{tool:'camera'}:{}),...(phase==='before'?{sourceVersion:'before'}:{})})
   await delay(250)
   const facts=await browser.evaluate('__facts()')
   await browser.screenshot(path.join(evidence,name+'.png'))
   fs.writeFileSync(path.join(evidence,name+'.json'),JSON.stringify(facts,null,2))
   scenes.push({name,errors:facts.errors,runtimeErrors:facts.runtimeErrors,pageWidth:facts.pageWidth})
  }
 } finally {await browser.close()}
 console.log(JSON.stringify(scenes,null,2))
 fs.writeFileSync(path.join(evidence,'capture-summary.json'),JSON.stringify(scenes,null,2))
}
main().catch(error=>{console.error(error);process.exitCode=1})
