// The page modules, handlers, WXML and WXSS below all come from production files.
// wx platform services are isolated doubles; do not label this a native-device test.
let page, modules = {}, moduleCache = {}, entryPath
let dirty = false, callbackQueue = []
const storage = new Map(), pendingModals = [], pendingSheets = []
const events = { writes: [], toasts: [], modals: [], sheets: [], navigations: [], exports: [], errors: [], canvasTexts: [], rawCanvasTexts: [] }
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value))
const qa = { failRead: [], failWrite: [], events, storage }
window.__lightingQa = qa
function setPath(target, key, value) {
  const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.')
  for (const part of parts.slice(0, -1)) target = target[part] || (target[part] = {})
  target[parts.at(-1)] = clone(value)
}
function patchElement(old, fresh) {
  if (!old || old.nodeType !== fresh.nodeType || old.nodeName !== fresh.nodeName) return fresh
  if (old.nodeType === 3) { if (old.textContent !== fresh.textContent) old.textContent = fresh.textContent; return old }
  for (const attr of [...old.attributes]) {
    const canvasBackingSize = old.tagName === 'CANVAS' && ['width', 'height'].includes(attr.name)
    if (!fresh.hasAttribute(attr.name) && !canvasBackingSize) old.removeAttribute(attr.name)
  }
  for (const attr of [...fresh.attributes]) if (old.getAttribute(attr.name) !== attr.value) old.setAttribute(attr.name, attr.value)
  if (old instanceof HTMLInputElement && document.activeElement !== old) old.value = fresh.getAttribute('value') || ''
  if (old.tagName === 'CANVAS') return old
  const oldNodes = [...old.childNodes], keyed = new Map(oldNodes.filter(n => n.nodeType === 1 && n.hasAttribute('data-qa-template-key')).map(n => [n.getAttribute('data-qa-template-key'), n]))
  const next = [...fresh.childNodes].map((child, index) => {
    const hasTemplateKey = child.nodeType === 1 && child.hasAttribute('data-qa-template-key')
    const existing = hasTemplateKey ? keyed.get(child.getAttribute('data-qa-template-key')) : oldNodes[index]
    return patchElement(existing, child)
  })
  for (let index = 0; index < next.length; index++) if (old.childNodes[index] !== next[index]) old.insertBefore(next[index], old.childNodes[index] || null)
  while (old.childNodes.length > next.length) old.lastChild.remove()
  return old
}
function render() {
  errors = []
  const html = renderNodes(ast, page.data)
  const template = document.createElement('template'); template.innerHTML = '<page>' + html + '</page>'
  const next = patchElement(app.firstChild, template.content.firstChild)
  if (app.firstChild !== next) app.replaceChildren(next)
  document.getElementById('production-style').textContent = rpx(productionCss)
  for (const scroll of app.querySelectorAll('scroll-view')) {
    const leftAttribute=scroll.getAttribute('scroll-left')
    if (leftAttribute!==null&&scroll.__qaScrollLeftAttribute!==leftAttribute)scroll.scrollLeft=Number(leftAttribute)||0
    scroll.__qaScrollLeftAttribute=leftAttribute
    const target = scroll.getAttribute('scroll-into-view')
    if(target&&scroll.__qaScrollTarget!==target){const node=document.getElementById(target);if(node&&scroll.contains(node)){const child=node.getBoundingClientRect(),parent=scroll.getBoundingClientRect();if(scroll.hasAttribute('scroll-x'))scroll.scrollLeft=Math.max(0,scroll.scrollLeft+child.left-parent.left-scroll.clientWidth/2+child.width/2);else if(scroll.hasAttribute('scroll-y'))scroll.scrollTop=Math.max(0,scroll.scrollTop+child.top-parent.top-scroll.clientHeight/2+child.height/2)}}
    scroll.__qaScrollTarget=target
  }
  document.documentElement.dataset.theme = theme
  qa.data = page.data; qa.page = page; qa.errors = errors
}
function update() {
  if (dirty) return
  dirty = true
  queueMicrotask(() => { dirty = false; try { render(); const callbacks = callbackQueue; callbackQueue = []; for (const callback of callbacks) callback() } catch (error) { reportError(error) } })
}
function reportError(error) {
  events.errors.push(error.stack || String(error)); document.getElementById('error').textContent = error.stack || String(error)
  document.documentElement.dataset.error = error.stack || String(error)
}
function resolveModule(name, from) {
  const segments = name.startsWith('.') ? (from.split('/').slice(0, -1).join('/') + '/' + name).split('/') : name.split('/')
  const out = []
  for (const segment of segments) { if (segment === '..') out.pop(); else if (segment && segment !== '.') out.push(segment) }
  let result = out.join('/'); if (!/\.js$/.test(result)) result += '.js'
  return result
}
function loadModule(name, from = '') {
  const resolved = resolveModule(name, from)
  if (moduleCache[resolved]) return moduleCache[resolved].exports
  if (!modules[resolved]) throw Error('Source module missing: ' + resolved)
  const module = { exports: {} }; moduleCache[resolved] = module
  Function('require', 'module', 'exports', modules[resolved] + '\n//# sourceURL=production/' + resolved)(dependency => loadModule(dependency, resolved), module, module.exports)
  return module.exports
}
function canvasNode(id) {
  return [...document.querySelectorAll('canvas')].find(node => node.id === id || node.getAttribute('canvas-id') === id)
}
function canvasContext(id) {
  const node = canvasNode(id) || document.createElement('canvas'), context = node.getContext('2d')
  const setters = { setFillStyle: 'fillStyle', setStrokeStyle: 'strokeStyle', setLineWidth: 'lineWidth', setLineCap: 'lineCap', setLineJoin: 'lineJoin', setTextAlign: 'textAlign', setTextBaseline: 'textBaseline', setGlobalAlpha: 'globalAlpha' }
  return new Proxy(context, {
    get(target, key) {
      if (setters[key]) return value => { target[setters[key]] = value }
      if (key === 'setFontSize') return size => { target.font = size + 'px "Microsoft YaHei",sans-serif' }
      if (key === 'setShadow') return (x,y,blur,color) => { target.shadowOffsetX=x;target.shadowOffsetY=y;target.shadowBlur=blur;target.shadowColor=color }
      if (key === 'fillText') return (value,x,y,...rest) => {const metrics=target.measureText(String(value)),width=metrics.width,align=target.textAlign;const left=align==='center'?x-width/2:align==='right'||align==='end'?x-width:x;events.canvasTexts.push({id,text:String(value),x,y,width,left,right:left+width,top:y-metrics.actualBoundingBoxAscent,bottom:y+metrics.actualBoundingBoxDescent,font:target.font});target.fillText(value,x,y,...rest)}
      if (key === 'draw') return (_reserve, callback) => callback?.()
      const value = Reflect.get(target, key, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
    set(target, key, value) { Reflect.set(target,key,value,target); return true }
  })
}
const systemInfo = () => ({ theme, windowWidth: innerWidth, windowHeight: innerHeight, screenWidth: innerWidth, screenHeight: innerHeight, pixelRatio: 1, statusBarHeight: 24, safeArea: { left:0,top:24,right:innerWidth,bottom:innerHeight,height:innerHeight-24,width:innerWidth }, platform:'devtools', SDKVersion:'3.16.2', benchmarkLevel:50, system:'QA browser' })
window.wx = {
  getStorageSync(key) { if (qa.failRead.includes(key)) throw Error('Injected read failure: '+key); return clone(storage.get(key)) },
  setStorageSync(key, value) { if (qa.failWrite.includes(key)) throw Error('Injected write failure: '+key); storage.set(key, clone(value)); events.writes.push({key,value:clone(value)}) },
  removeStorageSync(key) { if (qa.failWrite.includes(key)) throw Error('Injected removal failure'); storage.delete(key) },
  getStorageInfoSync: () => ({keys:[...storage.keys()],currentSize:0,limitSize:10240}),
  getSystemInfoSync: systemInfo, getWindowInfo: systemInfo, getAppBaseInfo: systemInfo, getDeviceInfo: systemInfo,
  getMenuButtonBoundingClientRect: () => ({left:innerWidth-97,right:innerWidth-10,top:28,bottom:60,width:87,height:32}),
  onThemeChange: cb => {qa.themeListener=cb}, offThemeChange: () => {}, onWindowResize:()=>{}, offWindowResize:()=>{},
  nextTick: callback => requestAnimationFrame(callback), vibrateShort:()=>{}, vibrateLong:()=>{},
  showToast: options => events.toasts.push(clone(options)), showLoading:()=>{}, hideLoading:()=>{},
  showModal(options) { events.modals.push({title:options.title,content:options.content}); pendingModals.push(options) },
  showActionSheet(options) { events.sheets.push(clone(options.itemList)); pendingSheets.push(options) },
  navigateTo: options => {events.navigations.push(options.url);options.success?.()}, navigateBack: options => options?.success?.(), redirectTo: options => {events.navigations.push(options.url);options.success?.()}, switchTab:()=>{},
  setNavigationBarTitle: options => {qa.navigationTitle=options.title}, setNavigationBarColor:()=>{}, setBackgroundColor:()=>{}, setPageOrientation: options => options.success?.(),
  enableAlertBeforeUnload:()=>{}, disableAlertBeforeUnload:()=>{}, pageScrollTo:()=>{}, hideKeyboard:()=>{},
  setClipboardData: options => {qa.clipboard=options.data;options.success?.()},
  createCanvasContext: canvasContext,
  createOffscreenCanvas: options => {const node=document.createElement('canvas');node.width=options.width||300;node.height=options.height||150;return node},
  createSelectorQuery() {
    const requests=[]; let selector, all=false
    const request = {
      in:()=>request,
      select(s){selector=s;all=false;return request},
      selectAll(s){selector=s;all=true;return request},
      boundingClientRect(cb){requests.push({selector,all,cb,type:'rect'});return request},
      fields(fields,cb){requests.push({selector,all,cb,type:'fields',fields});return request},
      selectViewport(){selector='page';return request},
      scrollOffset(cb){requests.push({selector,all:false,cb,type:'scroll'});return request},
      exec(callback){
        const result=requests.map(item=>{
          const make=node=>{
            if(!node)return null
            const rect=node.getBoundingClientRect()
            if(item.type==='scroll')return{scrollLeft:node.scrollLeft,scrollTop:node.scrollTop}
            const value={...Object.fromEntries(['left','top','right','bottom','width','height','x','y'].map(key=>[key,rect[key]])),dataset:{...node.dataset}}
            if(item.type==='fields'){
              if(item.fields?.node){
                value.node=node
                if(node instanceof HTMLCanvasElement){
                  if(typeof node.requestAnimationFrame!=='function')node.requestAnimationFrame=callback=>window.requestAnimationFrame(callback)
                  if(typeof node.cancelAnimationFrame!=='function')node.cancelAnimationFrame=id=>window.cancelAnimationFrame(id)
                  if(!node.__qaTextCaptureInstalled){
                    node.__qaTextCaptureInstalled=true
                    const context=node.getContext('2d')
                    if(context&&typeof context.fillText==='function'){
                      const fillText=context.fillText.bind(context)
                      try{context.fillText=(text,...args)=>{events.rawCanvasTexts.push({canvasId:node.id,text:String(text)});return fillText(text,...args)}}catch(_){ }
                    }
                  }
                }
              }
              if(item.fields?.size){value.width=rect.width;value.height=rect.height}
            }
            return value
          }
          const value=item.all?[...document.querySelectorAll(item.selector)].map(make):make(document.querySelector(item.selector))
          item.cb?.(value)
          return value
        })
        callback?.(result)
        return request
      },
    }
    return request
  },
  canvasToTempFilePath(options) {try {const node=options.canvas||canvasNode(options.canvasId);if(!node)throw Error('Canvas not mounted: '+options.canvasId);const output=document.createElement('canvas');const width=Number(options.width)||node.width,height=Number(options.height)||node.height;output.width=Number(options.destWidth)||width;output.height=Number(options.destHeight)||height;output.getContext('2d').drawImage(node,Number(options.x)||0,Number(options.y)||0,width,height,0,0,output.width,output.height);const url=output.toDataURL('image/png');events.exports.push({width:output.width,height:output.height,url});options.success?.({tempFilePath:url})}catch(error){options.fail?.(error)}},
  getImageInfo(options){const img=new Image();img.onload=()=>options.success?.({path:options.src,width:img.width,height:img.height});img.onerror=()=>options.fail?.({errMsg:'image missing'});img.src=options.src},
  previewImage: options=>{qa.preview=clone(options)},saveImageToPhotosAlbum: options=>options.success?.(),showShareImageMenu: options=>options.success?.(),
  getSetting: options=>options.success?.({authSetting:{'scope.writePhotosAlbum':true}}),authorize:options=>options.success?.(),openSetting:options=>options.success?.(),
  getPerformance:()=>performance,canIUse:()=>true
}
window.getApp = () => ({ globalData: {theme}, getTheme:()=>theme })
window.getCurrentPages = () => page ? [page] : []
window.Page = definition => { page={...definition,data:clone(definition.data||{})};page.setData=(patch,callback)=>{for(const [key,value]of Object.entries(patch))setPath(page.data,key,value);if(callback)callbackQueue.push(callback);update()};page.selectComponent=()=>null;page.createSelectorQuery=()=>wx.createSelectorQuery();qa.page=page }
window.__dispatch = async (method, dataset={}, detail={}, extra={}) => {
  if (typeof page[method]!=='function') throw Error('Production page method missing: '+method)
  const result=page[method]({currentTarget:{dataset},target:{dataset},detail,...extra})
  if(result?.then)await result
  await new Promise(resolve=>setTimeout(resolve,20))
  return clone(page.data)
}
window.__answerModal = async confirm => {const options=pendingModals.shift();if(!options)throw Error('No modal pending');options.success?.({confirm,cancel:!confirm});options.complete?.({confirm,cancel:!confirm});await new Promise(resolve=>setTimeout(resolve,30));return clone(page.data)}
window.__answerSheet = async tapIndex => {const options=pendingSheets.shift();if(!options)throw Error('No action sheet pending');options.success?.({tapIndex});await new Promise(resolve=>setTimeout(resolve,30));return clone(page.data)}
function nativeEvent(target,type,detail,extra={}) {
  for(let node=target;node&&node!==app;node=node.parentElement){const catchMethod=node.getAttribute('data-catch'+type),method=catchMethod||node.getAttribute('data-bind'+type);if(method&&typeof page[method]==='function'){page[method]({currentTarget:{dataset:{...node.dataset},id:node.id},target:{dataset:{...target.dataset}},detail,...extra});if(catchMethod)return}}
}
app.addEventListener('click',event=>nativeEvent(event.target,'tap',{x:event.clientX,y:event.clientY}))
for(const type of ['input','change','blur','focus','scroll'])app.addEventListener(type,event=>{const node=event.target;nativeEvent(node,type,{value:node.tagName==='SELECT'?Number(node.value):node.value,scrollLeft:node.scrollLeft,scrollTop:node.scrollTop,scrollWidth:node.scrollWidth,scrollHeight:node.scrollHeight})},true)
for(const type of ['touchstart','touchmove','touchend','touchcancel'])app.addEventListener(type,event=>nativeEvent(event.target,type,{}, {touches:[...event.touches].map(t=>({identifier:t.identifier,clientX:t.clientX,clientY:t.clientY,pageX:t.pageX,pageY:t.pageY,x:t.clientX,y:t.clientY})),changedTouches:[...event.changedTouches].map(t=>({identifier:t.identifier,clientX:t.clientX,clientY:t.clientY,pageX:t.pageX,pageY:t.pageY,x:t.clientX,y:t.clientY})),timeStamp:event.timeStamp}),{passive:false})
window.__facts = () => ({width:innerWidth,height:innerHeight,pageWidth:document.documentElement.scrollWidth,errors:[...new Set(errors)],runtimeErrors:events.errors,background:getComputedStyle(document.querySelector('page>view')||app).backgroundColor,controls:[...app.querySelectorAll('button,input,picker')].filter(node=>node.getClientRects().length).map(node=>{const r=node.getBoundingClientRect();return {className:node.className,text:node.textContent.trim(),width:r.width,height:r.height,x:r.x,y:r.y}}),text:app.innerText})
async function expandedXml(url) {
  let source=await loadText(url)
  for(const match of [...source.matchAll(/<(?:include|import)\s+src=["']([^"']+)["']\s*\/?>/g)])source=source.replace(match[0],await expandedXml(new URL(match[1],location.origin+url).pathname))
  return source
}
window.__openPage = async (entry,loadOptions={}) => {
  page?.onUnload?.();entryPath=entry;moduleCache={};callbackQueue=[];app.replaceChildren()
  modules=await fetch('/__bundle?'+new URLSearchParams({entry,before:query.get('sourceVersion')==='before'?'1':'0'})).then(r=>r.json())
  const base='/'+entry.replace(/\.js$/,'')
  ast=parse(await expandedXml(base+'.wxml'));templateMap=new Map()
  function templates(nodes){for(const node of nodes){if(node.tag==='template'&&node.attrs.name)templateMap.set(node.attrs.name,node);if(node.children)templates(node.children)}}templates(ast)
  productionCss=await cssFile('/app.wxss')+'\n'+await cssFile(base+'.wxss')
  loadModule(entry);render();page.onLoad?.(loadOptions);await new Promise(resolve=>setTimeout(resolve,40));render();page.onShow?.();page.onReady?.();await new Promise(resolve=>setTimeout(resolve,180));render();document.documentElement.dataset.ready='true'
  return clone(page.data)
}
async function boot(){
  const productBundle=await fetch('/__bundle?entry=pages/dmx-address/dmx-address.js').then(r=>r.json());modules=productBundle
  const {createGroup,buildPreferences}=loadModule('pages/dmx-address/group-input.js')
  const fixture=query.get('fixture')||'standard',count=fixture==='export-dense'?160:fixture==='dense'?30:12
  const groups=[createGroup(1,{fixtureSource:'library',fixtureModel:'TL-SL323',libraryChannelCount:2,fixtureCount:count}),createGroup(2,{fixtureSource:'library',fixtureModel:'TL-SK3101',libraryChannelCount:2,fixtureCount:7}),createGroup(3,{fixtureSource:'library',fixtureModel:'TL-SL113',fixtureCount:8})]
  if(fixture!=='empty')storage.set('audioTool.dmxAddress.preferences',buildPreferences({startAddressText:'1',allocationMode:'auto',groups}))
  const now=Date.now();storage.set('audioTool.projects.v1',[{id:'project-1',name:'礼堂灯光',createdAt:now,updatedAt:now,recordIds:[]},{id:'project-2',name:'多功能厅',createdAt:now,updatedAt:now,recordIds:[]}]);storage.set('audioTool.storage.schemaVersion',2)
  const loadOptions=Object.fromEntries([...query.entries()].filter(([key])=>key.startsWith('lighting')))
  await window.__openPage(query.get('page')==='layout'?'pages/dmx-layout/dmx-layout.js':'pages/dmx-address/dmx-address.js',loadOptions)
}
boot().catch(reportError)
