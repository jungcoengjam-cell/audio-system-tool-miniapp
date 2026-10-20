const fs=require('node:fs')
const path=require('node:path')
const {launch}=require('./browser-driver.cjs')
async function main(){
  const page=process.argv[2]||'main',phase=process.argv[3]||'review'
  const browser=await launch(),results=[]
  try{
    for(const theme of ['light','dark']){
      await browser.viewport(390,844,theme)
      await browser.navigate({theme,page:page==='layout'?'layout':'main'})
      const name=`${page}-${phase}-${theme}-390`
      const facts=await browser.evaluate('window.__facts()')
      const data=await browser.evaluate('window.__lightingQa.data')
      await browser.screenshot(path.join(__dirname,'evidence/screenshots',name+'.png'))
      const result={name,facts,data};results.push(result)
      console.log(JSON.stringify({name,errors:facts.errors,runtimeErrors:facts.runtimeErrors,overflow:facts.pageWidth>facts.width}))
    }
    fs.mkdirSync(path.join(__dirname,'evidence/scenes'),{recursive:true})
    fs.writeFileSync(path.join(__dirname,'evidence/scenes',`${page}-${phase}.json`),JSON.stringify(results,null,2))
  }finally{await browser.close()}
}
main().catch(error=>{console.error(error);process.exitCode=1})
