const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { launch, delay } = require('./cdp.cjs')
const phase = process.argv.includes('--before') ? 'before' : 'after'
const output = path.resolve(process.env.WIRING_QA_NATIVE_FIX_OUTPUT || path.join(__dirname, 'evidence/native-fix-2026-10-16', phase))
const checks = [], captures = []
const check = (name, passed, evidence) => { checks.push({ name, passed: Boolean(passed), evidence }); if (!passed) console.log(`${phase === 'before' ? 'EXPECTED DEFECT' : 'FAIL'} ${name}: ${JSON.stringify(evidence).slice(0, 900)}`) }
const measureExpression = `(() => {
  const visible=n=>n&&n.getClientRects().length&&getComputedStyle(n).visibility!=='hidden';
  const box=n=>{if(!n)return null;const r=n.getBoundingClientRect(),s=getComputedStyle(n);const range=document.createRange();range.selectNodeContents(n);const text=range.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height,clientWidth:n.clientWidth,scrollWidth:n.scrollWidth,scrollHeight:n.scrollHeight,centerX:r.x+r.width/2,centerY:r.y+r.height/2,color:s.color,background:s.backgroundColor,backgroundImage:s.backgroundImage,backgroundSize:s.backgroundSize,backgroundRepeat:s.backgroundRepeat,backgroundPosition:s.backgroundPosition,opacity:s.opacity,fontSize:s.fontSize,lineHeight:s.lineHeight,display:s.display,position:s.position,marginLeft:s.marginLeft,marginRight:s.marginRight,paddingLeft:parseFloat(s.paddingLeft)||0,paddingRight:parseFloat(s.paddingRight)||0,whiteSpace:s.whiteSpace,text:n.textContent.trim(),textHeight:text.height,textWidth:text.width,textBounds:{x:text.x,y:text.y,right:text.right,bottom:text.bottom,width:text.width,height:text.height},disabled:n.disabled===true}};
  const select=q=>box(document.querySelector(q));
  const sheet=document.querySelector('.workspace-editor-sheet,.workspace-wheel-sheet,.workspace-device-sheet');
  const inner=n=>{if(!n)return null;const r=n.getBoundingClientRect(),s=getComputedStyle(n);return{left:r.left+parseFloat(s.borderLeftWidth)+parseFloat(s.paddingLeft),right:r.right-parseFloat(s.borderRightWidth)-parseFloat(s.paddingRight),width:n.clientWidth-parseFloat(s.paddingLeft)-parseFloat(s.paddingRight)}};
  const title=sheet?sheet.querySelector('.workspace-editor-title,.workspace-wheel-toolbar [class*=title],.workspace-sheet-title'):document.querySelector('.workspace-title');
  return{viewport:{width:innerWidth,height:innerHeight},pageWidth:document.documentElement.scrollWidth,geometry:window.__geometry(),nav:select('.workspace-nav'),navTitle:select('.workspace-title'),back:select('.workspace-back'),share:select('.workspace-share,.workspace-project-share'),projectRow:select('.workspace-project-row'),tabs:[...document.querySelectorAll('.workspace-tab')].map(box),sheet:box(sheet),sheetInner:inner(sheet),title:box(title),close:select('.workspace-close-button'),save:select('.workspace-sheet-save'),addPair:select('.workspace-add-pair'),addPairParent:inner(document.querySelector('.workspace-add-pair')?.parentElement),wheel:select('picker-view'),wheelContract:window.__qaNativePickerContracts?.at(-1),indicator:select('.qa-native-picker-indicator'),mask:select('.qa-native-picker-mask'),selected:select('.workspace-wheel-item-selected'),toolbar:select('.workspace-wheel-toolbar'),wheelButtons:[...document.querySelectorAll('.workspace-wheel-toolbar button')].map(box),selectedType:select('.workspace-type-selected'),unselectedType:box([...document.querySelectorAll('.workspace-type-tile')].find(n=>!n.classList.contains('workspace-type-selected'))),bodyBackground:getComputedStyle(document.querySelector('.wiring-page')).backgroundColor};
})()`
function color(value) { return (String(value).match(/[\d.]+/g) || []).map(Number) }
function alpha(value) { const c = color(value); return c.length > 3 ? c[3] : 1 }
function contrast(first, second) { const lum = value => { const c = color(value).slice(0, 3).map(n => { const x=n/255; return x<=.04045?x/12.92:((x+.055)/1.055)**2.4 }); return .2126*c[0]+.7152*c[1]+.0722*c[2] }; const values=[lum(first),lum(second)].sort((a,b)=>b-a);return(values[0]+.05)/(values[1]+.05) }
function overlap(a, b, gap=0) { return a && b && a.x < b.right + gap && a.right > b.x - gap && a.y < b.bottom + gap && a.bottom > b.y - gap }
async function main() {
  fs.mkdirSync(output, { recursive: true }); const browser = await launch()
  try {
    for (const noGrid of [false, true]) {
      const profile = noGrid ? 'native-v2-no-grid' : 'native-v2'
      for (const width of [320, 390, 393]) {
        const name = `${profile}-${width}`, menu = { left: width - 96, top: 26, bottom: 58 }, viewport = { width, height: width === 320 ? 780 : 844 }
        await browser.viewport(viewport.width, viewport.height, 'dark')
        await browser.navigate('tests/project-wiring-redesign-2026-10-16/native-browser.html?' + new URLSearchParams({ theme: 'dark', capsule: '1', menuLeft: menu.left, menuTop: menu.top, menuBottom: menu.bottom, statusHeight: 20, noGrid: noGrid ? '1' : '0', sourceVersion: phase }))
        await browser.evaluate('window.__dispatch("onWorkspaceTab",{tab:"lines"})')
        const calibration = await browser.evaluate(`(()=>{const host=document.createElement('div');host.style.cssText='position:fixed;left:-2000px;width:300px;opacity:0';const button=document.createElement('button');button.textContent='Native width probe';host.append(button);document.querySelector('page').append(host);const r=button.getBoundingClientRect(),s=getComputedStyle(button);const result={width:r.width,marginLeft:s.marginLeft,marginRight:s.marginRight,paddingLeft:s.paddingLeft};host.remove();return result})()`)
        check(name + ': exact installed native-v2 button profile is active', Math.abs(calibration.width - 184) <= 1, calibration)
        const snapshot = async scene => {
          await delay(80); const measured=await browser.evaluate(measureExpression), state=await browser.evaluate('window.__wiringQa.session')
          const file=path.join(output, `${scene}-${name}-dark.png`);await browser.screenshot(file)
          const data={scene,profile,phase,viewport,menu,measured,sources:state.sources,controllerState:{draftIsNew:state.data.draftIsNew,editorVisible:state.data.editorVisible,projectPickerVisible:state.data.projectPickerVisible},file,sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}
          fs.writeFileSync(path.join(output, `${scene}-${name}-dark.json`), JSON.stringify(data,null,2));captures.push({scene,profile,viewport,menu,file,sha256:data.sha256,sources:state.sources})
          check(`${scene}-${name}: production WXML expressions resolve`, measured.geometry.errors.length===0, measured.geometry.errors)
          check(`${scene}-${name}: no page horizontal overflow`, measured.pageWidth<=width+1, measured.pageWidth)
          const inputs=measured.geometry.controls.filter(control=>/workspace-control|workspace-step-input|workspace-search-input/.test(control.className))
          check(`${scene}-${name}: form inputs keep at least 44 pixel touch height`,inputs.every(control=>control.height>=43.5&&control.width>=43.5),inputs.filter(control=>control.height<43.5||control.width<43.5))
          return measured
        }
        let m=await snapshot('groups-nav-capsule')
        check(name+': navigation title is screen-centered and single line', Math.abs(m.navTitle.centerX-width/2)<=1 && m.navTitle.scrollWidth<=m.navTitle.clientWidth+1 && m.navTitle.textHeight<=parseFloat(m.navTitle.lineHeight)+2,m.navTitle)
        check(name+': back and share touch targets explicit and do not overlap title glyphs',m.back.width>=44&&m.back.height>=44&&m.share.width>=44&&m.share.height>=44&&!overlap(m.back,m.navTitle.textBounds)&&!overlap(m.share,m.navTitle.textBounds),{back:m.back,share:m.share,title:m.navTitle})
        const capsule={x:menu.left,y:menu.top,right:width-8,bottom:menu.bottom}
        check(name+': share avoids capsule by 8 pixels or uses separate vertical lane',!overlap(m.share,capsule,0)&&(m.share.bottom<=menu.top||m.share.y>=menu.bottom||m.share.right<=menu.left-8),{share:m.share,capsule})
        check(name+': active tab color survives inherited native/global styles',m.tabs[1].color!==m.tabs[0].color&&color(m.tabs[1].color)[2]>180,m.tabs)
        await browser.evaluate('window.__dispatch("openNewLine")');m=await snapshot('add-line')
        check(name+': Save fills sheet inner width and aligns both edges',Math.abs(m.save.width-m.sheetInner.width)<=2&&Math.abs(m.save.x-m.sheetInner.left)<=2&&Math.abs(m.save.right-m.sheetInner.right)<=2,{save:m.save,inner:m.sheetInner})
        check(name+': Add one line fills its section width',Math.abs(m.addPair.width-m.addPairParent.width)<=2&&Math.abs(m.addPair.x-m.addPairParent.left)<=2,{button:m.addPair,parent:m.addPairParent})
        check(name+': editor title centered independent of native close-button width',Math.abs(m.title.centerX-m.sheet.centerX)<=1&&m.title.textHeight<=parseFloat(m.title.lineHeight)+2&&m.close.width>=44&&m.close.width<=45&&!overlap(m.close,m.title),{title:m.title,close:m.close,sheet:m.sheet})
        check(name+': enabled Save keeps white text on blue background',color(m.save.background)[2]>180&&contrast(m.save.color,m.save.background)>=3.0&&Number(m.save.opacity)===1,m.save)
        await browser.evaluate('window.__dispatch("requestCloseEditor")');await browser.evaluate('window.__dispatch("requestProjectPicker")');m=await snapshot('project-wheel')
        const c=m.wheelContract
        check(name+': wheel has explicit positive pixel height and indicator contract',/height\s*:\s*\d+(?:\.\d+)?px/.test(c.sourceInlineHeight)&&/height\s*:\s*(?:44|48)px/.test(c.sourceIndicatorStyle)&&c.height>0&&[44,48].includes(c.pitch),c)
        check(name+': native column direct children use plain block rows',c.columnCount===1&&c.rowTags.every(tag=>tag==='view')&&c.rowDisplays.every(display=>display==='block')&&c.rowLineHeights.every(value=>Math.abs(parseFloat(value)-c.pitch)<1),c)
        check(name+': wheel header title and actions stay one line without overlap',m.wheelButtons.every(button=>button.width>=44&&button.width<=76&&button.height>=44&&button.textHeight<=parseFloat(button.lineHeight)+2)&&Math.abs(m.title.centerX-m.sheet.centerX)<=1&&m.title.textHeight<=parseFloat(m.title.lineHeight)+2&&m.wheelButtons.every(button=>!overlap(button,m.title)),{title:m.title,buttons:m.wheelButtons,toolbar:m.toolbar})
        check(name+': selected row is centered and not covered by an opaque indicator',Math.abs(m.selected.centerY-m.indicator.centerY)<=1&&alpha(m.indicator.background)===0&&Number(m.indicator.opacity)===1,{selected:m.selected,indicator:m.indicator})
        check(name+': native masks leave center band clear with two edge gradients',(m.mask.backgroundImage.match(/linear-gradient/g)||[]).length===2&&m.mask.backgroundRepeat.split(',').every(value=>value.trim()==='no-repeat')&&m.mask.backgroundSize.includes(c.padding+'px'),{mask:m.mask,contract:c})
        check(name+': dark selected text has at least 4.5 contrast',contrast(m.selected.color,m.sheet.background)>=4.5,{ratio:contrast(m.selected.color,m.sheet.background),selected:m.selected,sheet:m.sheet})
        await browser.evaluate('window.__dispatch("cancelProjectPicker")');await browser.evaluate('window.__dispatch("openDeviceEditor")');await browser.evaluate('window.__dispatch("onDeviceType",{type:"custom"})');m=await snapshot('device-disabled')
        check(name+': disabled primary keeps themed muted colors rather than native pale defaults',m.save.disabled&&Number(m.save.opacity)<1&&m.save.background!==m.selectedType.background&&m.save.background!=='rgb(250, 250, 250)'&&color(m.save.background).slice(0,3).every(value=>value<80)&&contrast(m.save.color,m.save.background)>=2.5,m.save)
        check(name+': selected device tile preserves blue state despite inherited button styles',m.selectedType.color!==m.unselectedType.color&&color(m.selectedType.color)[2]>180&&m.selectedType.background!==m.unselectedType.background,{selected:m.selectedType,unselected:m.unselectedType})
      }
    }
  } catch(error) { check('runner completed',false,error.stack) }
  finally { await browser.close() }
  const result={phase,runAt:new Date().toISOString(),profile:'Installed native-v2 button selectors and source-derived picker stacking; optional CSS grid unsupported profile.',nativeRuntime:false,limits:'Chromium adversarial profile, not WeChat native runtime or physical iPhone acceptance.',checks,captures,passed:checks.filter(item=>item.passed).length,failed:checks.filter(item=>!item.passed).length}
  fs.writeFileSync(path.join(output,'checks.json'),JSON.stringify(result,null,2));fs.writeFileSync(path.join(output,'run.log'),checks.map(item=>`${item.passed?'PASS':'FAIL'} ${item.name}`).join('\n')+'\n')
  console.log(JSON.stringify({phase,passed:result.passed,failed:result.failed,captures:captures.length,output},null,2))
  if(phase==='after'&&result.failed)process.exitCode=1
  if(phase==='before'&&!checks.some(item=>!item.passed&&item.name.includes('Save fills')))process.exitCode=1
}
module.exports={measureExpression,contrast,alpha,overlap}
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1})
