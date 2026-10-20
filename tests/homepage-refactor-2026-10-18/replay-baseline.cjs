'use strict'
// Read-only diagnostic: run existing tests against the captured production source.
// Does not edit the baseline, expected values, or the production release gate.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module')
const root=path.resolve(__dirname,'../..'),baseline=path.join(__dirname,'baseline')
const read=fs.readFileSync.bind(fs),exists=fs.existsSync.bind(fs),resolve=Module._resolveFilename
function remap(file){
 if(typeof file!=='string'||!path.isAbsolute(file))return file
 const relative=path.relative(root,file).replaceAll('\\','/')
 if(!/^(pages|utils|data|styles|templates|assets)\//.test(relative))return file
 const captured=path.join(baseline,relative)
 return exists(captured)?captured:file
}
fs.readFileSync=(file,...args)=>read(remap(file),...args)
Module._resolveFilename=function(...args){return remap(resolve.apply(this,args))}
