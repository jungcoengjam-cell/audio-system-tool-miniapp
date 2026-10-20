'use strict'

function replaceOnce(source, search, replacement, label) {
  const first = source.indexOf(search)
  if (first < 0 || source.indexOf(search, first + search.length) >= 0) {
    throw new Error(`Expected one ${label || search} anchor in the source-backed browser runtime`)
  }
  return source.slice(0, first) + replacement + source.slice(first + search.length)
}

function replaceSection(source, start, end, replacement, label) {
  const first = source.indexOf(start)
  const last = source.indexOf(end, first + start.length)
  if (first < 0 || last < 0) throw new Error(`Missing ${label || start} runtime section`)
  return source.slice(0, first) + replacement + source.slice(last)
}

module.exports = function patchBrowserRuntime(source) {
  source = replaceOnce(source,
    'let dirty = false, callbackQueue = []',
    `let dirty = false, callbackQueue = []
let currentContext = null, pageStack = [], imageCache = new Map(), lastExportTextIndex = 0
function makePageContext(entryPath = '') {
  return { page:null, entryPath, modules:{}, moduleCache:{}, ast:null, productionCss:'', templateMap:new Map(), errors:[], callbackQueue:[], dirty:false, updateQueued:false, dom:null, openerChannel:null, backInProgress:false }
}
function saveCurrentContext(context = currentContext) {
  if (!context) return
  context.page = page; context.modules = modules; context.moduleCache = moduleCache; context.entryPath = entryPath
  context.ast = ast; context.productionCss = productionCss; context.templateMap = templateMap; context.errors = errors
  context.callbackQueue = callbackQueue; context.dirty = dirty
}
function activateContext(context) {
  currentContext = context
  page = context.page; modules = context.modules; moduleCache = context.moduleCache; entryPath = context.entryPath
  ast = context.ast; productionCss = context.productionCss; templateMap = context.templateMap; errors = context.errors
  callbackQueue = context.callbackQueue; dirty = context.dirty
  if (page) { qa.page = page; qa.data = page.data }
}
function makeEventChannel(childPath) {
  const listeners = new Map()
  const trace = (action, name, value) => {
    const event = { action, name, page:currentContext?.entryPath || '', child:childPath }
    if (action === 'emit' && name === 'report-bridge-result' && value && typeof value === 'object') {
      event.result = {
        bridge:value.bridge, ok:value.ok, revision:value.revision,
        itemIds:Array.isArray(value.items) ? value.items.map(item => item?.id).filter(Boolean) : [],
        lineIds:Array.isArray(value.items) ? value.items.flatMap(item => Array.isArray(item?.lineIds) ? item.lineIds : []) : [],
        pageCount:Array.isArray(value.items) ? value.items.reduce((count,item) => count + (Array.isArray(item?.pages) ? item.pages.length : 0),0) : 0,
      }
    }
    events.eventChannels.push(event)
  }
  const channel = {
    on(name, handler) { if (typeof handler !== 'function') return channel; const group = listeners.get(name) || []; group.push(handler); listeners.set(name, group); trace('on', name); return channel },
    once(name, handler) { const onceHandler = value => { channel.off(name, onceHandler); handler(value) }; return channel.on(name, onceHandler) },
    off(name, handler) { const group = listeners.get(name) || []; listeners.set(name, handler ? group.filter(item => item !== handler) : []); trace('off', name); return channel },
    emit(name, value) { trace('emit', name, value); for (const handler of [...(listeners.get(name) || [])]) handler(value); return channel },
  }
  return channel
}
function logLifecycle(context, action) { events.pageLifecycle.push({ page:context.entryPath, action }) }
function flushPageCallbacks(context) {
  if (currentContext !== context) return
  let guard = 0
  while (context.callbackQueue.length && guard++ < 100) {
    const callbacks = context.callbackQueue.splice(0)
    callbackQueue = context.callbackQueue
    for (const callback of callbacks) {
      try { callback() } catch (error) { reportError(error) }
    }
  }
}`,
    'page-context globals')

  source = replaceSection(source, 'function render() {', 'function reportError(error) {', `function render() {
  if (!currentContext || !page || !ast) return
  errors = []; currentContext.errors = errors
  const html = renderNodes(ast, page.data)
  const template = document.createElement('template'); template.innerHTML = '<page>' + html + '</page>'
  const next = patchElement(app.firstChild, template.content.firstChild)
  if (app.firstChild !== next) app.replaceChildren(next)
  document.getElementById('production-style').textContent = rpx(productionCss)
  for (const scroll of app.querySelectorAll('scroll-view')) {
    const topAttribute=scroll.getAttribute('scroll-top')
    if(topAttribute!==null&&scroll.__qaScrollTopAttribute!==topAttribute)scroll.scrollTop=Number(topAttribute)||0
    scroll.__qaScrollTopAttribute=topAttribute
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
function update(owner = currentContext) {
  if (!owner) return
  owner.dirty = true
  if (owner.updateQueued) return
  owner.updateQueued = true
  queueMicrotask(() => {
    owner.updateQueued = false
    if (currentContext !== owner) return
    owner.dirty = false; dirty = false
    try { render(); flushPageCallbacks(owner) } catch (error) { reportError(error) }
  })
}
`, 'reportError(error) {', 'page render/update')

  source = replaceOnce(source,
    'function loadModule(name, from = \'\') {\n  const resolved = resolveModule(name, from)\n  if (moduleCache[resolved]) return moduleCache[resolved].exports\n  if (!modules[resolved]) throw Error(\'Source module missing: \' + resolved)\n  const module = { exports: {} }; moduleCache[resolved] = module\n  Function(\'require\', \'module\', \'exports\', modules[resolved] + \'\\n//# sourceURL=production/\' + resolved)(dependency => loadModule(dependency, resolved), module, module.exports)\n  return module.exports\n}',
    `function loadModule(name, from = '', owner = currentContext) {
  const resolved = resolveModule(name, from)
  const cache = owner?.moduleCache || moduleCache, sourceModules = owner?.modules || modules
  if (cache[resolved]) return cache[resolved].exports
  if (!sourceModules[resolved]) throw Error('Source module missing: ' + resolved)
  const module = { exports: {} }; cache[resolved] = module
  Function('require', 'module', 'exports', sourceModules[resolved] + '\\n//# sourceURL=production/' + resolved)(dependency => loadModule(dependency, resolved, owner), module, module.exports)
  return module.exports
}`,
    'page-context module loader')

  source = replaceSection(source, 'function canvasNode(id) {', 'const systemInfo = () =>', `function canvasNode(id, ownerPage) {
  const owner = ownerPage?.__qaContext || currentContext
  const root = owner && owner !== currentContext ? owner.dom : app
  const canvases = root ? [...root.querySelectorAll('canvas')] : []
  return canvases.find(node => node.id === id || node.getAttribute('canvas-id') === id)
}
function canvasContext(id, ownerPage) {
  const owner = ownerPage?.__qaContext || currentContext
  const node = canvasNode(id, ownerPage) || document.createElement('canvas')
  const sizeKeys = id === 'projectReportExportCanvas' ? ['reportCanvasWidth','reportCanvasHeight']
    : id === 'audioWiringReportBridgeCanvas' || id === 'projectWiringReportBridgeCanvas' ? ['canvasWidth','canvasHeight'] : null
  if (sizeKeys) {
    const requestedWidth = Number(ownerPage?.data?.[sizeKeys[0]]), requestedHeight = Number(ownerPage?.data?.[sizeKeys[1]])
    if (requestedWidth > 0 && node.width !== requestedWidth) node.width = requestedWidth
    if (requestedHeight > 0 && node.height !== requestedHeight) node.height = requestedHeight
  }
  const context = node.getContext('2d')
  events.canvasContexts.push({ id, page:owner?.entryPath || '', found:Boolean(canvasNode(id, ownerPage)), width:node.width, height:node.height,
    attributeWidth:node.getAttribute('width'), attributeHeight:node.getAttribute('height'),
    boundWidth:ownerPage?.data?.reportCanvasWidth, boundHeight:ownerPage?.data?.reportCanvasHeight })
  const setters = { setFillStyle:'fillStyle', setStrokeStyle:'strokeStyle', setLineWidth:'lineWidth', setLineCap:'lineCap', setLineJoin:'lineJoin', setTextAlign:'textAlign', setTextBaseline:'textBaseline', setGlobalAlpha:'globalAlpha' }
  return new Proxy(context, {
    get(target, key) {
      if (setters[key]) return value => { target[setters[key]] = value }
      if (key === 'setFontSize') return size => { target.font = size + 'px "Microsoft YaHei",sans-serif' }
      if (key === 'setShadow') return (x,y,blur,color) => { target.shadowOffsetX=x;target.shadowOffsetY=y;target.shadowBlur=blur;target.shadowColor=color }
      if (key === 'fillText') return (value,x,y,...rest) => {const metrics=target.measureText(String(value)),width=metrics.width,align=target.textAlign;const left=align==='center'?x-width/2:align==='right'||align==='end'?x-width:x;events.canvasTexts.push({id,text:String(value),x,y,width,left,right:left+width,top:y-metrics.actualBoundingBoxAscent,bottom:y+metrics.actualBoundingBoxDescent,font:target.font});target.fillText(value,x,y,...rest)}
      if (key === 'drawImage') return (image,...args) => {
        let drawable = image
        if (typeof image === 'string') {
          const absolute = new URL(image, location.origin).href
          drawable = imageCache.get(image) || imageCache.get(absolute) || imageCache.get(new URL(absolute).pathname)
          if (!drawable) throw Error('Image has not been loaded by wx.getImageInfo: ' + image)
        }
        events.canvasDrawImages.push({ id, page:owner?.entryPath || '', source:typeof image === 'string' ? image : (image?.src || ''), loaded:Boolean(drawable && (drawable instanceof HTMLImageElement || drawable instanceof HTMLCanvasElement)) })
        return target.drawImage(drawable, ...args)
      }
      if (key === 'draw') return (_reserve, callback) => callback?.()
      const value = Reflect.get(target, key, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
    set(target, key, value) { Reflect.set(target,key,value,target); return true }
  })
}
`, 'const systemInfo = () =>', 'owner-bound canvas helpers')

  source = replaceOnce(source,
    "const events = { writes: [], toasts: [], modals: [], sheets: [], navigations: [], exports: [], errors: [], canvasTexts: [], rawCanvasTexts: [] }",
    "const events = { writes: [], toasts: [], modals: [], sheets: [], navigations: [], exports: [], errors: [], canvasTexts: [], rawCanvasTexts: [], pageLifecycle: [], eventChannels: [], canvasContexts: [], canvasDrawImages: [], imageInfo: [], navigationStack: [] }",
    'QA event log')

  source = replaceOnce(source,
    'navigateTo: options => {events.navigations.push(options.url);options.success?.()}, navigateBack: options => options?.success?.(), redirectTo:',
    'navigateTo: options => navigateToPage(options), navigateBack: options => navigateBackPage(options), redirectTo:',
    'report bridge navigation APIs')
  source = replaceOnce(source, 'createCanvasContext: canvasContext,', 'createCanvasContext: (id, ownerPage) => canvasContext(id, ownerPage),', 'owner-bound createCanvasContext')

  source = replaceOnce(source,
    "  canvasToTempFilePath(options) {try {const node=options.canvas||canvasNode(options.canvasId);if(!node)throw Error('Canvas not mounted: '+options.canvasId);const output=document.createElement('canvas');const width=Number(options.width)||node.width,height=Number(options.height)||node.height;output.width=Number(options.destWidth)||width;output.height=Number(options.destHeight)||height;output.getContext('2d').drawImage(node,Number(options.x)||0,Number(options.y)||0,width,height,0,0,output.width,output.height);const url=output.toDataURL('image/png');events.exports.push({width:output.width,height:output.height,url});options.success?.({tempFilePath:url})}catch(error){options.fail?.(error)}},",
    `  canvasToTempFilePath(options, ownerPage) {try {const node=options.canvas||canvasNode(options.canvasId,ownerPage);if(!node)throw Error('Canvas not mounted: '+options.canvasId);const output=document.createElement('canvas');const width=Number(options.width)||node.width,height=Number(options.height)||node.height;output.width=Number(options.destWidth)||width;output.height=Number(options.destHeight)||height;output.getContext('2d').drawImage(node,Number(options.x)||0,Number(options.y)||0,width,height,0,0,output.width,output.height);const url=output.toDataURL('image/png');const newTexts=events.canvasTexts.slice(lastExportTextIndex);lastExportTextIndex=events.canvasTexts.length;const addressTextDraws=newTexts.filter(item=>/^[A-Z]\\d{3,4}$/.test(String(item.text||'').trim())).map(({id,text,x,y,width,left,right,top,bottom,font})=>({id,text,x,y,width,left,right,top,bottom,font}));const addressLabels=[...new Set(addressTextDraws.map(item=>String(item.text||'').trim()))];events.exports.push({width:output.width,height:output.height,sourceWidth:node.width,sourceHeight:node.height,sourceAttributeWidth:node.getAttribute('width'),sourceAttributeHeight:node.getAttribute('height'),url,canvasId:options.canvasId,page:ownerPage?.__qaContext?.entryPath||currentContext?.entryPath||'',addressLabels,addressTextDraws});options.success?.({tempFilePath:url})}catch(error){options.fail?.(error)}},`,
    'owner-bound canvas export and loaded-image cache')

  source = replaceOnce(source,
    "getImageInfo(options){const img=new Image();img.onload=()=>options.success?.({path:options.src,width:img.width,height:img.height});img.onerror=()=>options.fail?.({errMsg:'image missing'});img.src=options.src},",
    "getImageInfo(options){const raw=String(options.src||'');const img=new Image();img.onload=()=>{const absolute=new URL(raw,location.origin).href;for(const key of [raw,absolute,new URL(absolute).pathname])imageCache.set(key,img);events.imageInfo.push({src:raw,width:img.width,height:img.height,loaded:true});options.success?.({path:raw,width:img.width,height:img.height})};img.onerror=()=>{events.imageInfo.push({src:raw,loaded:false});options.fail?.({errMsg:'image missing'})};img.src=new URL(raw,location.origin).href},",
    'source-backed wx.getImageInfo')

  source = replaceSection(source, 'window.getCurrentPages = () =>', 'window.__dispatch = async', `window.getCurrentPages = () => [...pageStack.map(context => context.page).filter(Boolean), ...(page ? [page] : [])]
window.Page = definition => {
  const owner = currentContext
  if (!owner) throw Error('Page registered without an active page context')
  const instance = { ...definition, data:clone(definition.data || {}) }
  Object.defineProperty(instance, '__qaContext', { value:owner })
  instance.setData = (patch, callback) => {
    for (const [key,value] of Object.entries(patch)) setPath(instance.data,key,value)
    if (callback) owner.callbackQueue.push(callback)
    update(owner)
  }
  instance.getOpenerEventChannel = () => owner.openerChannel
  instance.selectComponent = () => null
  instance.createSelectorQuery = () => wx.createSelectorQuery()
  owner.page = instance
  page = instance; qa.page = instance; qa.data = instance.data
}
window.__qaNavigationState = () => ({ current:currentContext?.entryPath || '', stack:pageStack.map(context => context.entryPath), lifecycle:clone(events.pageLifecycle), channels:clone(events.eventChannels) })
`, 'window.__dispatch = async', 'page lifecycle and Page binding')

  source = replaceSection(source, 'async function expandedXml(url) {', 'async function boot() {', `async function expandedXml(url) {
  let source=await loadText(url)
  for(const match of [...source.matchAll(/<(?:include|import)\\s+src=["']([^"']+)["']\\s*\\/?>/g)])source=source.replace(match[0],await expandedXml(new URL(match[1],location.origin+url).pathname))
  return source
}
async function loadContext(context, entry, loadOptions = {}) {
  activateContext(context)
  context.entryPath = entry; context.modules = {}; context.moduleCache = {}; context.callbackQueue = []; context.dirty = false
  entryPath = entry; modules = context.modules; moduleCache = context.moduleCache; callbackQueue = context.callbackQueue; dirty = false
  const before = query.get('sourceVersion') === 'before' ? '1' : '0'
  modules = await fetch('/__bundle?' + new URLSearchParams({ entry, before })).then(result => result.json())
  context.modules = modules
  const base='/' + entry.replace(/\\.js$/,'')
  ast=parse(await expandedXml(base+'.wxml'));templateMap=new Map()
  function templates(nodes){for(const node of nodes){if(node.tag==='template'&&node.attrs.name)templateMap.set(node.attrs.name,node);if(node.children)templates(node.children)}}templates(ast)
  productionCss=await cssFile('/app.wxss')+'\\n'+await cssFile(base+'.wxss')
  context.ast=ast;context.templateMap=templateMap;context.productionCss=productionCss
  loadModule(entry, '', context); render()
  if (page?.onLoad) { logLifecycle(context,'onLoad'); page.onLoad(loadOptions) }
  await new Promise(resolve=>setTimeout(resolve,40));render()
  if (page?.onShow) { logLifecycle(context,'onShow'); page.onShow() }
  if (page?.onReady) { logLifecycle(context,'onReady'); page.onReady() }
  await new Promise(resolve=>setTimeout(resolve,180));render()
  document.documentElement.dataset.ready='true'
  return clone(page?.data)
}
async function navigateToPage(options = {}) {
  events.navigations.push(options.url)
  const parsed = new URL(options.url || '', location.origin)
  const route = parsed.pathname.replace(/^\\/+|\\/+$/g, '')
  const bridges = new Set(['pages/audio-wiring/report-bridge','pages/project-wiring/report-bridge'])
  if (!bridges.has(route)) { options.success?.(); return }
  const parent = currentContext
  if (!parent?.page) { options.fail?.({ errMsg:'No opener page' }); return }
  saveCurrentContext(parent)
  logLifecycle(parent,'onHide'); parent.page.onHide?.()
  const fragment = document.createDocumentFragment()
  while (app.firstChild) fragment.append(app.firstChild)
  parent.dom = fragment
  pageStack.push(parent)
  const child = makePageContext(route + '.js')
  child.openerChannel = makeEventChannel(child.entryPath)
  events.navigationStack.push({ from:parent.entryPath, to:child.entryPath, action:'navigateTo' })
  for (const [name, handler] of Object.entries(options.events || {})) {
    if (typeof handler === 'function') child.openerChannel.on(name, handler)
  }
  try {
    await loadContext(child, child.entryPath, Object.fromEntries(parsed.searchParams))
    options.success?.({ eventChannel:child.openerChannel })
  } catch (error) {
    events.errors.push(error.stack || String(error))
    child.backInProgress = true; child.page?.onUnload?.()
    pageStack.pop()
    if (parent.dom) app.replaceChildren(...parent.dom.childNodes)
    parent.dom = null; activateContext(parent)
    logLifecycle(parent,'onShow'); parent.page.onShow?.(); render(); flushPageCallbacks(parent)
    options.fail?.({ errMsg:String(error) })
  }
}
function navigateBackPage(options = {}) {
  const child = currentContext
  if (!pageStack.length || !child) { options.success?.(); options.complete?.(); return }
  if (child.backInProgress) return
  child.backInProgress = true
  logLifecycle(child,'onUnload')
  child.page?.onUnload?.()
  const parent = pageStack.pop()
  events.navigationStack.push({ from:child.entryPath, to:parent?.entryPath || '', action:'navigateBack' })
  if (!parent) { options.success?.(); options.complete?.(); return }
  if (parent.dom) app.replaceChildren(...parent.dom.childNodes)
  parent.dom = null
  activateContext(parent)
  document.documentElement.dataset.ready='true'
  if (parent.page?.onShow) { logLifecycle(parent,'onShow'); parent.page.onShow() }
  render(); flushPageCallbacks(parent)
  options.success?.()
  options.complete?.()
}
window.__openPage = async (entry,loadOptions={}) => {
  if (currentContext?.page) {
    const closing = [currentContext, ...pageStack.slice().reverse()]
    pageStack = []
    for (const context of closing) {
      context.backInProgress = true
      logLifecycle(context,'onUnload'); context.page?.onUnload?.()
    }
  }
  app.replaceChildren(); document.documentElement.dataset.ready='false'
  imageCache.clear()
  const context=makePageContext(entry)
  activateContext(context)
  await loadContext(context,entry,loadOptions)
  return clone(page?.data)
}
`, 'async function boot() {', 'page-stack navigation runtime')

  return source
}
