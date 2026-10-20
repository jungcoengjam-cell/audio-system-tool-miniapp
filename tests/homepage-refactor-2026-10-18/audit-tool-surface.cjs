'use strict'
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict')
const root=path.resolve(__dirname,'../..')
const entries=['pages/limiter/limiter.wxml','pages/spl/spl.wxml','pages/cable/cable.wxml','pages/camera/camera.wxml','pages/led-screen/led-screen.wxml','pages/gain-structure/gain-structure.wxml','pages/audio-wiring/index.wxml']
function removeHomepageAdditions(source){
 return source.replace(/^[ \t]*<include src="\.\.\/\.\.\/templates\/(?:result-record-actions|editor-navigation-guard)\.wxml"\s*\/>[ \t]*(?:\r?\n)?/gm,'')
 .replace(/^[ \t]*<navigator class="basis-detail-link" url="\/pages\/basis\/detail\?tool=[A-Za-z]+">查看计算依据<\/navigator>[ \t]*(?:\r?\n)?/gm,'')
}
function canonical(source){return source.replace(/\r\n?/g,'\n').replace(/>\s+</g,'><').trim()}
const results=entries.map(file=>{
 const current=fs.readFileSync(path.join(root,file),'utf8'),before=fs.readFileSync(path.join(__dirname,'baseline',file),'utf8')
 const retiredBadge='<text wx:if="{{item.isActive}}" class="project-active-label">当前项目</text>'
 assert(!current.includes(retiredBadge),file+' must not reintroduce the retired global-project badge')
 return {file,onlyScopedAdditions:canonical(removeHomepageAdditions(current))===canonical(before.replace(retiredBadge,''))}
})
console.log(JSON.stringify(results,null,2))
assert.ok(results.every(result=>result.onlyScopedAdditions),'a calculator layout changed beyond the reviewed editor actions, basis link and retired global-project badge')
const guardPath=path.join(root,'templates/editor-navigation-guard.wxml')
if(fs.existsSync(guardPath)){
 const guard=fs.readFileSync(guardPath,'utf8')
 assert.equal((guard.match(/<page-container\b/g)||[]).length,1)
 assert.deepEqual([...guard.matchAll(/<([a-z-]+)\b/g)].map(x=>x[1]),['page-container','view'],'the return guard must not contain visible calculator UI or interactive controls')
 assert.equal(guard.replace(/<[^>]*>/g,'').trim(),'','the guard has no visible text')
 for(const contract of ['show="{{editorGuardArmed}}"','overlay="{{false}}"','duration="0"','height:0','width:0','pointer-events:none','bind:beforeleave="onEditorNavigationBeforeLeave"','bind:afterleave="onEditorNavigationAfterLeave"'])assert.ok(guard.includes(contract),contract)
 for(const file of entries){const source=fs.readFileSync(path.join(root,file),'utf8');assert.equal((source.match(/<include src="\.\.\/\.\.\/templates\/editor-navigation-guard\.wxml"\s*\/>/g)||[]).length,1,file+' must own exactly one return guard')}
}
module.exports={removeHomepageAdditions}
