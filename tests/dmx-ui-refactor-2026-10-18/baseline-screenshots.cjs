const fs=require('node:fs')
const path=require('node:path')
const {launch}=require('./browser-driver.cjs')
async function main(){const browser=await launch();try{const results=[];for(const theme of ['light','dark']){await browser.viewport(390,844,theme);await browser.navigate({theme,sourceVersion:'before'});const facts=await browser.evaluate('window.__facts()');await browser.screenshot(path.join(__dirname,'baseline',`main-${theme}-390.png`));results.push({theme,facts})}fs.writeFileSync(path.join(__dirname,'baseline/browser.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results.map(row=>({theme:row.theme,errors:row.facts.errors,runtimeErrors:row.facts.runtimeErrors,overflow:row.facts.pageWidth>row.facts.width}))))}finally{await browser.close()}}
main().catch(error=>{console.error(error);process.exitCode=1})
