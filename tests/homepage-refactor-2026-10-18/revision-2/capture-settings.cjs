'use strict'
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict')
const {launch,delay}=require('../browser-driver.cjs')
const out=path.join(__dirname,'evidence/settings');fs.mkdirSync(out,{recursive:true})
async function main(){const browser=await launch(),scenes=[];try{
 for(const theme of ['light','dark'])for(const width of [320,360,390]){
  await browser.viewport(width,844,theme);await browser.navigate({theme,entry:'pages/settings/settings.js'})
  const facts=await browser.evaluate(`(()=>{const b=document.querySelector('[open-type="feedback"]'),c=b.querySelector('.settings-row-copy'),x=b.getBoundingClientRect(),y=c.getBoundingClientRect();return {...__facts(),feedback:{width:x.width,height:x.height,centerOffset:Math.abs(x.y+x.height/2-y.y-y.height/2)},switches:document.querySelectorAll('switch').length}})()`)
  assert.equal(facts.errors.length,0);assert.equal(facts.runtimeErrors.length,0);assert.equal(facts.pageWidth,width);assert(facts.feedback.width>width*.85);assert(facts.feedback.height>=44);assert(facts.feedback.centerOffset<1);assert.equal(facts.switches,10)
  const name=`settings-${theme}-${width}`;await browser.screenshot(path.join(out,name+'-top.png'))
  await browser.evaluate(`(()=>{const e=document.querySelector('.home-scroll');e.scrollTop=350})()`);await delay(50);await browser.screenshot(path.join(out,name+'-tools.png'))
  await browser.evaluate(`document.querySelector('switch[data-id="camera"]').click();true`);await delay(50)
  assert.equal(await browser.evaluate(`__homepageQa.page.data.toolRows.find(t=>t.id==='camera').visible`),false)
  await browser.evaluate(`__openPage('pages/tools/tools.js').then(()=>true)`)
  assert.equal(await browser.evaluate(`__homepageQa.page.data.tools.some(t=>t.id==='camera')`),false)
  assert.equal(await browser.evaluate(`__homepageQa.page.data.tools.length`),9)
  scenes.push({name,feedback:facts.feedback,switches:facts.switches,hiddenCameraAfterReturn:true})
 }
}finally{await browser.close();fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify(scenes,null,2))}console.log(JSON.stringify(scenes,null,2))}
main().catch(error=>{console.error(error);process.exitCode=1})
