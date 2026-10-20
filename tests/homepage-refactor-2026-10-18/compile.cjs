'use strict'
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto')
const {spawnSync}=require('node:child_process')
const root=path.resolve(__dirname,'../..'), reportOnly=process.argv.includes('--report-only'), output=path.join(__dirname,reportOnly?'evidence/report-compile':'evidence/compile')
const binaries='E:/微信web开发者工具/resources/app.asar.unpacked/node_modules/wcc-exec'
const xml=new Set(),css=new Set(),scripts=new Set()
function collect(relative,set,expression) {
 if(set.has(relative))return
 set.add(relative)
 const source=fs.readFileSync(path.join(root,relative),'utf8')
 for(const [,dependency]of source.matchAll(expression))collect(path.posix.normalize(path.posix.join(path.posix.dirname(relative),dependency)),set,expression)
}
const config=JSON.parse(fs.readFileSync(path.join(root,'app.json'),'utf8'))
const entries=reportOnly?['pages/records/report']:config.pages.filter(x=>/pages\/(tools|projects|index|records|settings|basis)\//.test(x))
for(const pack of config.subPackages||[])for(const page of pack.pages||[]){const entry=pack.root+'/'+page;if(entry.endsWith('/report-bridge'))entries.push(entry)}
if(!reportOnly)for(const entry of ['pages/limiter/limiter','pages/gain-structure/gain-structure','pages/spl/spl','pages/camera/camera','pages/cable/cable','pages/led-screen/led-screen','pages/audio-wiring/index'])entries.push(entry)
for(const entry of entries){
 collect(entry+'.wxml',xml,/<(?:include|import)\s+src=["']([^"']+)["']/g)
 collect(entry+'.wxss',css,/@import\s+["']([^"']+)["']/g)
 scripts.add(entry+'.js')
 JSON.parse(fs.readFileSync(path.join(root,entry+'.json'),'utf8'))
}
collect('app.wxss',css,/@import\s+["']([^"']+)["']/g)
for(const directory of ['utils','pages/records','pages/basis'])for(const file of fs.readdirSync(path.join(root,directory)))if(file.endsWith('.js'))scripts.add(directory+'/'+file)
fs.mkdirSync(output,{recursive:true})
const results=[]
for(const command of [{name:'wcc',args:['-d','-o',path.join(output,'wxml.compiled.txt'),...xml]},{name:'wcsc',args:['-js','-pc',String(css.size),...css]}]){
 const executable=path.join(binaries,command.name+'.exe')
 const result=spawnSync(executable,command.args,{cwd:root,encoding:'utf8',windowsHide:true,maxBuffer:32*1024*1024})
 fs.writeFileSync(path.join(output,command.name+'.stdout.txt'),result.stdout||'')
 fs.writeFileSync(path.join(output,command.name+'.stderr.txt'),result.stderr||'')
 results.push({name:command.name,executable,exitCode:result.status,error:result.error?.message||null,stderr:result.stderr||'',stdoutBytes:Buffer.byteLength(result.stdout||'')})
}
for(const file of scripts){const result=spawnSync(process.execPath,['--check',file],{cwd:root,encoding:'utf8',windowsHide:true});results.push({name:'node --check '+file,exitCode:result.status,error:result.error?.message||null,stderr:result.stderr||''})}
const sources=Object.fromEntries([...xml,...css,...scripts].sort().map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex')]))
fs.writeFileSync(path.join(output,'compile.json'),JSON.stringify({runAt:new Date().toISOString(),kind:'official WXML/WXSS compiler executables; JS syntax only, not full official package or physical device',sources,results},null,2))
console.log(JSON.stringify({templates:xml.size,styles:css.size,scripts:scripts.size,failed:results.filter(x=>x.exitCode!==0||x.error)},null,2))
if(results.some(x=>x.exitCode!==0||x.error))process.exitCode=1
