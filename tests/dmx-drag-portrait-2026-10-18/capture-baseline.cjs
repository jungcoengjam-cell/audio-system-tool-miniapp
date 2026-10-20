const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto')
const root=path.resolve(__dirname,'../..'),manifest=path.join(__dirname,'baseline-sources.json')
if(fs.existsSync(manifest))throw Error('Baseline already frozen')
const paths=new Set([...Object.keys(require('../dmx-ui-round3-2026-10-18/evidence/source/audit.json').files),'app.json','tests/dmx-ui-refactor-2026-10-18/layout-extra-interactions-test.cjs'])
const files={};for(const p of paths){const bytes=fs.readFileSync(path.join(root,p)),target=path.join(__dirname,'baseline',p);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes);files[p]={bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')}}
fs.writeFileSync(manifest,JSON.stringify({createdAt:new Date().toISOString(),files},null,2));console.log('Frozen '+paths.size+' files before portrait/drag changes')
