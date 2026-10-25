'use strict'
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path')
const root=path.resolve(__dirname,'../../..')
const registry=require(path.join(root,'utils/tool-registry'))
const visibility=require(path.join(root,'utils/tool-visibility'))
const storage=new Map(),toasts=[];let modal=null,failWrite=false,failRead=false
global.getApp=()=>({globalData:{primaryNavigation:{restoreChecked:true}}})
global.wx={
 getStorageSync:key=>{if(failRead&&key===visibility.TOOL_VISIBILITY_KEY)throw Error('read');return storage.get(key)},
 setStorageSync:(key,value)=>{if(failWrite&&key===visibility.TOOL_VISIBILITY_KEY)throw Error('quota');storage.set(key,JSON.parse(JSON.stringify(value)))},
 removeStorageSync:key=>storage.delete(key),showToast:value=>toasts.push(value),showModal:value=>{modal=value},vibrateShort(){},
}
function page(relative){let definition;global.Page=value=>{definition=value};const file=path.join(root,relative);delete require.cache[require.resolve(file)];require(file);const result={...definition,data:JSON.parse(JSON.stringify(definition.data))};result.setData=(next,callback)=>{Object.assign(result.data,next);callback?.()};return result}
const tools=page('pages/tools/tools.js'),settings=page('pages/settings/settings.js'),basis=page('pages/index/index.js')
const preserved=[['audioTool.projects.v1',[{id:'kept-project'}]],['audioTool.records.v1',[{id:'kept-record'}]],['audioTool.favorites.v1',[{id:'kept-favorite'}]],['audioTool.dmxLightingWorkspace.v2',{id:'kept-lighting'}],['audioTool.activeProject.v1','kept-legacy-id'],['audioTool.audioWiring.preferences',{face:'mating'}]]
preserved.forEach(([key,value])=>storage.set(key,value));const before=JSON.stringify(preserved)
const basisBaseline=JSON.parse(JSON.stringify(registry.getBasisTools()))
assert.deepEqual(basis.data.basisTools,[],'basis starts empty so hidden entries cannot flash before onShow')
settings.onShow();tools.onShow();assert.equal(settings.data.toolRows.length,registry.TOOLS.length);assert.equal(tools.data.tools.length,registry.TOOLS.length)
basis.onShow();assert.deepEqual(basis.data.basisTools,basisBaseline,'basis initially shows its full registry list')
const change=(id,value)=>settings.onToolVisibilityChange({currentTarget:{dataset:{id}},detail:{value}})
change('camera',false);tools.onShow();assert(!tools.data.tools.some(tool=>tool.id==='camera'));assert(!settings.data.toolRows.find(tool=>tool.id==='camera').visible)
basis.onShow();assert(!basis.data.basisTools.some(tool=>tool.id==='camera'),'basis reflects a hidden tool when shown again')
const restartedTools=page('pages/tools/tools.js');restartedTools.onShow();assert(!restartedTools.data.tools.some(tool=>tool.id==='camera'),'hide survives page recreation')
tools.onCategoryTap({currentTarget:{dataset:{category:'视频'}}});assert.deepEqual(tools.data.tools.map(tool=>tool.id),['ledScreen'])
change('camera',true);tools.onShow();basis.onShow();assert(tools.data.tools.some(tool=>tool.id==='camera'),'settings change is reflected when returning');assert(basis.data.basisTools.some(tool=>tool.id==='camera'),'re-enabled tool basis returns onShow')
change('productLibrary',false);assert(storage.get(visibility.TOOL_VISIBILITY_KEY).hiddenToolIds.includes('productLibrary'),'产品资料库隐藏状态写入持久化设置');tools.onShow();assert(!tools.data.tools.some(tool=>tool.id==='productLibrary'),'隐藏产品资料库后工具目录不再显示入口');assert(!settings.data.toolRows.find(tool=>tool.id==='productLibrary').visible,'设置页反映产品资料库关闭状态');tools.onCategoryTap({currentTarget:{dataset:{category:'资料'}}});assert.deepEqual(tools.data.tools,[],'资料分类在入口隐藏后为空');const restartedLibraryTools=page('pages/tools/tools.js');restartedLibraryTools.onShow();restartedLibraryTools.onCategoryTap({currentTarget:{dataset:{category:'资料'}}});assert.deepEqual(restartedLibraryTools.data.tools,[],'产品资料库隐藏状态在工具页重建后仍生效');basis.onShow();assert.deepEqual(basis.data.basisTools,basisBaseline,'隐藏产品资料库不改变计算依据列表');change('productLibrary',true);restartedLibraryTools.onShow();restartedLibraryTools.onCategoryTap({currentTarget:{dataset:{category:'资料'}}});assert.deepEqual(restartedLibraryTools.data.tools.map(tool=>tool.id),['productLibrary'],'重新启用后资料分类恢复产品资料库入口');assert.deepEqual(basis.data.basisTools,basisBaseline,'产品资料库始终不进入计算依据')
for(const tool of registry.TOOLS)change(tool.id,false)
tools.onCategoryTap({currentTarget:{dataset:{category:'全部'}}});basis.onShow();assert.equal(tools.data.tools.length,0);assert.equal(typeof tools.openSettings,'function');assert.equal(basis.data.basisTools.length,0,'all hidden tools also hide every basis entry');assert.equal(typeof basis.openSettings,'function')
const opened=[];global.wx.navigateTo=options=>opened.push(options.url);basis.openSettings();assert.deepEqual(opened,['/pages/settings/settings'],'basis empty state can open settings')
failWrite=true;const oldRaw=JSON.stringify(storage.get(visibility.TOOL_VISIBILITY_KEY));change('camera',true);assert.equal(JSON.stringify(storage.get(visibility.TOOL_VISIBILITY_KEY)),oldRaw);assert(!settings.data.toolRows.find(tool=>tool.id==='camera').visible);assert.match(toasts.at(-1).title,/失败/);failWrite=false
assert.equal(visibility.setToolVisible('unknown-tool',true),false)
storage.set(visibility.TOOL_VISIBILITY_KEY,{version:2,hiddenToolIds:['camera']});assert.equal(visibility.readToolVisibility().ok,false);assert.equal(visibility.setToolVisible('camera',true),false);tools.onShow();assert(tools.data.visibilityError);assert.equal(tools.data.tools.length,registry.TOOLS.length,'storage failure keeps tools usable and warns')
failRead=true;settings.onShow();basis.onShow();assert(settings.data.visibilityError);assert(basis.data.visibilityError);assert.equal(basis.data.basisTools.length,basisBaseline.length,'read failure keeps all basis entries available');failRead=false
const originalKeys=['limiter','spl','cable','camera','ledScreen','gainStructure','dmxAddress'].map(id=>`audioTool.${id}.preferences`)
originalKeys.forEach(key=>storage.set(key,{keptUntilConfirm:true}));settings.resetPreferences();modal.success({confirm:false});assert(storage.has(originalKeys[0]));assert(storage.has(visibility.TOOL_VISIBILITY_KEY))
settings.resetPreferences();modal.success({confirm:true});assert(originalKeys.every(key=>!storage.has(key)));assert(!storage.has(visibility.TOOL_VISIBILITY_KEY));assert(settings.data.toolRows.every(tool=>tool.visible));assert.equal(toasts.at(-1).icon,'success')
assert.equal(JSON.stringify(preserved.map(([key])=>[key,storage.get(key)])),before,'visibility and reset never alter project/favorite/result/lighting/legacy-active/audio wiring data')
assert.deepEqual(registry.getBasisTools(),basisBaseline,'basis filtering never mutates registry content')
const basisWxml=fs.readFileSync(path.join(root,'pages/index/index.wxml'),'utf8'),basisWxss=fs.readFileSync(path.join(root,'pages/index/index.wxss'),'utf8')
assert.match(basisWxml,/visibilityReady && !basisTools\.length/);assert.match(basisWxml,/class="home-secondary-button basis-settings-button"/);assert.match(basisWxml,/class="basis-visibility-warning"/)
assert.match(basisWxss,/basis-settings-button\{[^}]*min-height:44px/);assert.match(basisWxss,/var\(--theme-warning-soft\)/);assert.match(basisWxss,/var\(--theme-warning\)/)
console.log('settings visibility PASS: persistent tool/basis/library hide-show, all-hidden recovery, read/write failure, future-version refusal, reset cancel/confirm, themed >=44px basis settings access, and data isolation')
