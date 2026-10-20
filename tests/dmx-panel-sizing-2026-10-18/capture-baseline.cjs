const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto')
const root=path.resolve(__dirname,'../..'),manifest=path.join(__dirname,'baseline-sources.json');if(fs.existsSync(manifest))throw Error('Already captured')
const paths=Object.keys(require('../dmx-drag-portrait-2026-10-18/baseline-sources.json').files),files={}
for(const p of paths){const b=fs.readFileSync(path.join(root,p)),target=path.join(__dirname,'baseline',p);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,b);files[p]={bytes:b.length,sha256:crypto.createHash('sha256').update(b).digest('hex')}}
fs.writeFileSync(manifest,JSON.stringify({createdAt:new Date().toISOString(),files},null,2));console.log('Frozen '+paths.length+' files')
