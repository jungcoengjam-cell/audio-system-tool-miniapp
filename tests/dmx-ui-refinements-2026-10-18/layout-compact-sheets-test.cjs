const assert = require('node:assert/strict')
const { launch, delay } = require('./browser-driver.cjs')

const profiles = [
  { width: 390, height: 844, theme: 'light' },
  { width: 844, height: 390, theme: 'light' },
  { width: 568, height: 320, theme: 'dark' },
]

async function run() {
  const browser = await launch()
  try {
    for (const profile of profiles) {
      await browser.viewport(profile.width, profile.height, profile.theme)
      await browser.navigate({
        page: 'landscape',
        lightingContextName: encodeURIComponent('临时设置'),
      })
      await browser.evaluate("window.__dispatch('openPlacementPanel')")
      const placement = await browser.evaluate(`(()=>{
        const rect=n=>{const r=n.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height}}
        const panel=document.querySelector('.placement-card'),body=panel?.querySelector('.fixture-selection-list'),summary=panel?.querySelector('.placement-summary')
        if(body)body.scrollTop=body.scrollHeight
        return{panel:panel&&rect(panel),body:body&&{...rect(body),clientHeight:body.clientHeight,scrollHeight:body.scrollHeight,scrollTop:body.scrollTop},summary:summary&&rect(summary)}
      })()`)
      const mask = await browser.evaluate(`(()=>{
        const node=document.querySelector('.placement-overlay'),r=node?.getBoundingClientRect(),target=document.elementFromPoint(24,20)
        return{rect:r&&{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height},hit:!!node&&node.contains(target),navigationCount:window.__lightingQa.events.navigations.length}
      })()`)
      assert(placement.panel && placement.panel.height > 0, 'placement sheet should be visible')
      assert(placement.body && placement.body.clientHeight > 0, 'fixture selector should get the sheet’s flexible scroll area')
      assert(placement.summary.y >= placement.panel.y && placement.summary.bottom <= placement.panel.bottom + 1, 'placed count remains inside the sheet')
      assert(placement.body.bottom <= placement.summary.y + 1, 'fixture scroll ends before the fixed summary')
      assert(mask.rect?.x === 0 && mask.rect?.y === 0 && mask.rect?.width === profile.width && mask.rect?.height === profile.height, 'placement backdrop covers the full viewport')
      assert(mask.hit, 'nav/back region is hit-tested by the placement backdrop')
      await browser.evaluate('document.elementFromPoint(24,20).click()')
      await delay(230)
      assert.equal(await browser.evaluate('window.__lightingQa.events.navigations.length'), mask.navigationCount, 'backdrop tap must not activate the background navigation')

      await browser.evaluate("window.__dispatch('openLocatePanel')")
      await browser.evaluate("window.__dispatch('onSearchInput',{}, {value:'A001'})")
      await browser.evaluate("window.__dispatch('searchFixture')")
      await delay(250)
      const locate = await browser.evaluate(`(()=>{
        const rect=n=>{const r=n.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height}}
        const panel=document.querySelector('.locate-card'),list=panel?.querySelector('.locate-results'),mask=document.querySelector('.locate-overlay'),rows=list?[...list.querySelectorAll('.locate-result-row')]:[]
        const last=rows.at(-1)
        return{panel:panel&&rect(panel),list:list&&{...rect(list),clientHeight:list.clientHeight,scrollHeight:list.scrollHeight},rows:rows.length,last:last&&rect(last),mask:mask&&rect(mask)}
      })()`)
      assert(locate.rows > 0, 'search should produce location rows')
      assert.equal(locate.rows, 1, 'exact address search should produce one locator row for the compact-height regression')
      assert(locate.list && locate.list.clientHeight > 0, 'search results must have a visible scroll area')
      assert(locate.list.y >= locate.panel.y && locate.list.bottom <= locate.panel.bottom + 1, 'search results stay inside the safe sheet')
      if (locate.rows === 1) {
        assert(locate.panel.height < 320, 'a single locator result should not stretch the sheet to viewport height')
        assert(locate.panel.bottom - locate.last.bottom <= 36, 'a single locator result should leave only the sheet’s normal bottom padding')
      }
      assert(locate.mask?.x === 0 && locate.mask?.y === 0 && locate.mask?.width === profile.width && locate.mask?.height === profile.height, 'locator backdrop covers the full viewport')

      await browser.evaluate(`(()=>{
        const page=window.__lightingQa.page,seed=page._fixtures[0]
        page._fixtures=Array.from({length:40},(_,index)=>({...seed,stableId:'locate-test-'+index,addressText:'TEST'+String(index+1).padStart(3,'0'),groupName:'Long locator result set'}))
        page.setData({searchText:'TEST'})
        page.searchFixture()
      })()`)
      const many = await browser.evaluate(`(()=>{
        const rect=n=>{const r=n.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height}}
        const panel=document.querySelector('.locate-card'),list=panel?.querySelector('.locate-results'),overlay=document.querySelector('.locate-overlay'),rows=list?[...list.querySelectorAll('.locate-result-row')]:[],last=rows.at(-1),info=wx.getWindowInfo(),capsule=wx.getMenuButtonBoundingClientRect()
        return{panel:panel&&rect(panel),list:list&&{...rect(list),clientHeight:list.clientHeight,scrollHeight:list.scrollHeight,scrollWidth:list.scrollWidth},rows:rows.length,last:last&&rect(last),safeTop:capsule.bottom+20,safeBottom:info.safeArea.bottom,viewport:innerHeight}
      })()`)
      assert.equal(many.rows, 40, 'long locator data renders every match')
      assert(many.list.clientHeight > 0 && many.list.scrollHeight > many.list.clientHeight, 'long result sets scroll inside the locator sheet')
      assert(many.panel.y >= many.safeTop - 1 && many.panel.bottom <= many.safeBottom + 1, 'long locator sheet stays inside safe viewport bounds')
    }
  } finally {
    await browser.close()
  }
  console.log('Compact landscape placement and locator sheets passed')
}

run().catch((error) => { console.error(error); process.exitCode = 1 })
