// Only pin the two explicitly changed DMX page templates; retain all earlier resource hashes.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto')
const root=path.resolve(__dirname,'../..'),f=path.join(root,'tests/package-reclaim/ui-test-first.json'),data=JSON.parse(fs.readFileSync(f,'utf8'))
function expand(file){return fs.readFileSync(file,'utf8').replace(/<include\s+src="([^"]+)"\s*\/>/g,(_,p)=>expand(path.resolve(path.dirname(file),p)))}
data.approvedDmxBatchSelectionExpandedWxmlSha256=Object.fromEntries(['pages/dmx-layout/dmx-layout.wxml','pages/dmx-layout-landscape/dmx-layout-landscape.wxml'].map(p=>[p,crypto.createHash('sha256').update(expand(path.join(root,p)).replace(/\r\n?/g,'\n')).digest('hex')]))
fs.writeFileSync(f,JSON.stringify(data,null,2)+'\n');console.log(JSON.stringify(data.approvedDmxBatchSelectionExpandedWxmlSha256))
