'use strict'
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict')
const {launch,delay}=require('./browser-driver.cjs')
const output=path.join(__dirname,'evidence/browser-workflows')
fs.mkdirSync(output,{recursive:true})
const summary=[]
async function run(){
 const browser=await launch()
 async function shot(name){const facts=await browser.evaluate('__facts()');await browser.screenshot(path.join(output,name+'.png'));fs.writeFileSync(path.join(output,name+'.json'),JSON.stringify(facts,null,2));summary.push({name,errors:facts.errors,runtimeErrors:facts.runtimeErrors,width:facts.width,pageWidth:facts.pageWidth});return facts}
 try{
  for(const theme of ['light','dark']){
   await browser.viewport(390,844,theme)
   await browser.navigate({theme,entry:'pages/projects/projects.js'})
   await shot('projects-'+theme)
   await browser.evaluate(`__dispatch('onTabTap',{index:1}).then(()=>true)`)
   await shot('favorites-'+theme)
   const favoriteId=await browser.evaluate(`__homepageQa.page.data.favorites[0]?.id`)
   if(favoriteId){await browser.evaluate(`__openPage('pages/projects/favorite-detail.js',{id:${JSON.stringify(favoriteId)}}).then(()=>true)`);await shot('favorite-detail-'+theme)}
   await browser.evaluate(`__openPage('pages/records/project.js',{id:'qa-project-hall'}).then(()=>true)`)
   await shot('project-all-'+theme)
   for(const key of ['calculations','wiring','lighting']){
    await browser.evaluate(`__dispatch('onProjectViewFilterTap',{key:${JSON.stringify(key)}}).then(()=>true)`)
    await shot('project-'+key+'-'+theme)
   }
   await browser.viewport(320,844,theme)
   await browser.evaluate(`__dispatch('onProjectViewFilterTap',{key:'all'}).then(()=>true)`)
   await shot('project-narrow-'+theme)
   await browser.viewport(390,844,theme)
   await browser.evaluate(`__openPage('pages/projects/recovery.js').then(()=>true)`)
   await shot('recovery-'+theme)
   await browser.navigate({theme,entry:'pages/records/report.js',id:'project-report-a',seed:'report'})
   await shot('report-select-'+theme)
   await browser.evaluate(`__homepageQa.page.generateReport();true`)
   for(let n=0;n<100;n++){const status=await browser.evaluate(`({mode:__homepageQa.page.data.mode,error:__homepageQa.page.data.pageStatus})`);if(status.mode!=='rendering')break;await delay(100)}
   const report=await browser.evaluate(`({mode:__homepageQa.page.data.mode,count:__homepageQa.page.data.pageCount,error:__homepageQa.page.data.pageStatus})`)
   assert.equal(report.mode,'preview',report.error)
   await shot('report-preview-'+theme)
   const exports=await browser.evaluate('__homepageQa.events.exports.map(({width,height})=>({width,height}))')
   for(const index of [...new Set([0,1,2,3,exports.length-1])].filter(index=>index>=0&&index<exports.length)){
    const url=await browser.evaluate(`__homepageQa.events.exports[${index}].url`)
    fs.writeFileSync(path.join(output,`report-document-${theme}-${index+1}.png`),Buffer.from(url.split(',')[1],'base64'))
   }
   summary.push({name:'report-full-'+theme,pages:report.count,exports})
  }
 }finally{await browser.close();fs.writeFileSync(path.join(output,'summary.json'),JSON.stringify(summary,null,2))}
 console.log(JSON.stringify(summary,null,2))
}
run().catch(error=>{console.error(error);process.exitCode=1})
