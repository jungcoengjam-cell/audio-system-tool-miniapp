const fs=require('node:fs')
const path=require('node:path')
const crypto=require('node:crypto')
const {spawnSync}=require('node:child_process')
const root=path.resolve(__dirname,'../..')
const output=path.join(__dirname,'evidence/compile')
const binaries='E:/微信web开发者工具/resources/app.asar.unpacked/node_modules/wcc-exec'
const xml=new Set(),css=new Set()
function collect(relative,set,expression){if(set.has(relative))return;set.add(relative);const source=fs.readFileSync(path.join(root,relative),'utf8');for(const [,dependency]of source.matchAll(expression))collect(path.posix.normalize(path.posix.join(path.posix.dirname(relative),dependency)),set,expression)}
for(const entry of ['pages/dmx-address/dmx-address','pages/dmx-address/channel-guide','pages/dmx-layout/dmx-layout','pages/dmx-layout-landscape/dmx-layout-landscape']){
  collect(entry+'.wxml',xml,/<(?:include|import)\s+src=["']([^"']+)["']/g)
  collect(entry+'.wxss',css,/@import\s+["']([^"']+)["']/g)
  JSON.parse(fs.readFileSync(path.join(root,entry+'.json'),'utf8'))
}
collect('app.wxss',css,/@import\s+["']([^"']+)["']/g)
fs.mkdirSync(output,{recursive:true})
const commands=[{name:'wcc',args:['-d','-o',path.join(output,'wxml.compiled.txt'),...xml]},{name:'wcsc',args:['-js','-pc',String(css.size),...css]}]
const results=commands.map(command=>{const exe=path.join(binaries,command.name+'.exe'),result=spawnSync(exe,command.args,{cwd:root,encoding:'utf8',windowsHide:true,maxBuffer:32*1024*1024});fs.writeFileSync(path.join(output,command.name+'.stdout.txt'),result.stdout||'');fs.writeFileSync(path.join(output,command.name+'.stderr.txt'),result.stderr||'');return {...command,exe,exitCode:result.status,error:result.error?.message||null,stderr:result.stderr||'',stdoutBytes:Buffer.byteLength(result.stdout||'')}})
const sources=Object.fromEntries([...xml,...css].sort().map(relative=>[relative,crypto.createHash('sha256').update(fs.readFileSync(path.join(root,relative))).digest('hex')]))
const summary={runAt:new Date().toISOString(),officialSourceCompilation:true,nativeRuntime:'See separate native evidence; compiler result alone does not verify runtime',physicalDevice:'NOT RUN',sources,results}
fs.writeFileSync(path.join(output,'compile.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2))
if(results.some(result=>result.exitCode!==0||result.error))process.exitCode=1

