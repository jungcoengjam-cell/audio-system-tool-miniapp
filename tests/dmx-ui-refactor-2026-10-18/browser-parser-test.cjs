const assert=require('node:assert/strict')
const fs=require('node:fs')
const path=require('node:path')
const vm=require('node:vm')
const generated=fs.readFileSync(path.join(__dirname,'browser.js'),'utf8')
const prefix=generated.slice(0,generated.indexOf('// The page modules'))
for(const [markup,scope,expected]of [
  ['<view>{{x < 0 ? "negative" : "positive"}}</view>',{x:-1},'negative'],
  ['<view wx:if="{{x < 0}}">{{x > -2 ? "inside" : "outside"}}</view>',{x:-1},'inside'],
  ['<text>{{fixtureBatchOpen ? "batch" : (fixtureSearchGroupIndex < 0 ? "添加灯组" : "选择灯具型号")}}</text>',{fixtureBatchOpen:false,fixtureSearchGroupIndex:-1},'添加灯组'],
]){
  const context={location:{search:''},document:{getElementById:()=>({})},URLSearchParams,innerWidth:390}
  const result=vm.runInNewContext(prefix+'\nJSON.stringify({html:renderNodes(parse('+JSON.stringify(markup)+'),'+JSON.stringify(scope)+'),errors})',context,{timeout:1000})
  const actual=JSON.parse(result)
  assert.deepEqual(actual.errors,[])
  assert(actual.html.includes(expected))
  assert(!actual.html.includes('{{'))
}
console.log('browser parser: comparison operators inside WXML expressions passed')

const runtime = fs.readFileSync(path.join(__dirname,'browser-runtime.js'),'utf8')
const patchSource = runtime.match(/function patchElement\(old, fresh\) \{[\s\S]*?\n\}/)?.[0]
assert(patchSource, 'browser runtime patchElement implementation should be available')
class Element {
  constructor(name, key, children=[]) {
    this.nodeType=1;this.nodeName=name;this.tagName=name;this.attributes=[];this.attrs=new Map();this.childNodes=children
    if(key)this.setAttribute('data-qa-template-key',key)
  }
  hasAttribute(name){return this.attrs.has(name)}
  getAttribute(name){return this.attrs.get(name)??null}
  setAttribute(name,value){this.attrs.set(name,String(value));if(!this.attributes.some(attribute=>attribute.name===name))this.attributes.push({name})}
  removeAttribute(name){this.attrs.delete(name);this.attributes=this.attributes.filter(attribute=>attribute.name!==name)}
  insertBefore(node,reference){const at=reference?this.childNodes.indexOf(reference):-1;if(at<0)this.childNodes.push(node);else this.childNodes.splice(at,0,node)}
  get lastChild(){return this.childNodes.at(-1)}
}
class Text { constructor(value){this.nodeType=3;this.nodeName='#text';this.textContent=value} }
const oldText=new Text('\n  '),oldFixture=new Element('VIEW','fixture-row'),oldRoot=new Element('VIEW','root',[oldText,oldFixture])
const newText=new Text('\n  '),newDelete=new Element('VIEW','delete-button'),newFixture=new Element('VIEW','fixture-row'),newRoot=new Element('VIEW','root',[newText,newDelete,newFixture])
const patchContext={HTMLInputElement:class {},document:{activeElement:null}}
vm.runInNewContext(`${patchSource}\npatchElement(oldRoot,newRoot)`,{...patchContext,oldRoot,newRoot}, {timeout:1000})
assert.equal(oldRoot.childNodes.length,3,'adding a wx:if sibling inserts rather than overwrites an existing same-tag child')
assert.equal(oldRoot.childNodes[1],newDelete,'new conditional sibling occupies its own DOM node')
assert.equal(oldRoot.childNodes[2],oldFixture,'existing keyed fixture node is retained exactly once')
console.log('browser runtime reconciliation: conditional same-tag sibling preserves keyed fixture node')
const oldCanvas=new Element('CANVAS','canvas-stage'),newCanvas=new Element('CANVAS','canvas-stage')
oldCanvas.setAttribute('width','390');oldCanvas.setAttribute('height','672');oldCanvas.setAttribute('class','layout-canvas')
newCanvas.setAttribute('class','layout-canvas')
vm.runInNewContext(`${patchSource}\npatchElement(oldCanvas,newCanvas)`,{...patchContext,oldCanvas,newCanvas},{timeout:1000})
assert.equal(oldCanvas.getAttribute('width'),'390','unrelated WXML rerender preserves the configured canvas backing width')
assert.equal(oldCanvas.getAttribute('height'),'672','unrelated WXML rerender preserves the configured canvas backing height')
console.log('browser runtime canvas: configured backing dimensions survive WXML attributes reconciliation')
