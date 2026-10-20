const assert=require('node:assert/strict')
const fs=require('node:fs')
const path=require('node:path')
const {createRuntime,clone}=require('./controller-runtime.cjs')
const tests=[
  ['legacy coordinates survive no-op settings and follow their rod after explicit geometry edits',()=>{
    for(const edit of ['distance','direction','size']){
      const r=createRuntime()
      const legacy={stageWidthText:'12',stageDepthText:'8',rowCount:3,schemeId:'top',frontDirection:'down',preserveUnplaced:true,positions:{'0:1':{zone:'top',positionIndex:0,x:.31,y:.29}},barCounts:[[1],[0],[0]]}
      r.seed(undefined,legacy)
      try{
        const page=r.make(),id=page._fixtures[0].stableId,before=clone(page._layout.positionsById[id])
        assert(before.legacyPoint,'Test requires a real migrated coordinate override')
        page.openLayoutSettings();page.applyLayoutSettings()
        assert.deepEqual(page._layout.positionsById[id],before,'A no-op discarded legitimate historical coordinates')
        page.openLayoutSettings()
        if(edit==='distance')page.onDraftDistanceInput(r.event({kind:'internalRods',index:0},{value:'2'}))
        if(edit==='direction')page.onDraftDirectionTap(r.event({direction:'right'}))
        if(edit==='size')page.onDraftStageInput(r.event({key:'stageDepthText'},{value:'10'}))
        page.applyLayoutSettings()
        const position=page._layout.positionsById[id],geometry=page.getGeometry(),rod=geometry.rods.find(item=>item.id===position.rodId)
        const actual=r.model.layoutFixturePoint(geometry,rod,position),onRod=r.model.pointOnRod(rod,position.t)
        assert(Math.hypot(actual.x-onRod.x,actual.y-onRod.y)<1e-7,edit+': geometry changed but fixture remained off its associated rod')
        assert.deepEqual(r.workspace.readLightingWorkspace().scheme.legacySideLayout,legacy,'Geometry editing overwrote the recovery snapshot')
      }finally{r.dispose()}
    }
  }],
  ['dense rod viewport measures actual width and survives unrelated lower-list filtering',()=>{
    const r=createRuntime();r.seed([{name:'200W成像灯',fixtureSource:'library',fixtureModel:'TL-SL323',channelCount:'2',libraryChannelCount:'2',fixtureCount:'30',targetUniverse:'A'}])
    r.state.selectorRects['.placement-preview-strip']={left:20,top:200,width:280,height:100}
    try{
      const page=r.make()
      for(const fixture of page._fixtures)page.assignFixtureToRod(fixture,page._layout.internalRods[0].id)
      page.openPlacementPanel()
      assert(r.stats.selectors.includes('.placement-preview-strip'),'Preview width was guessed instead of measured')
      const patchesBeforeScroll=page._qaPatches.length
      page.onPreviewScroll(r.event({},{scrollLeft:560,scrollWidth:1708,scrollTop:0,scrollHeight:100}))
      page.flushPreviewScrollMetrics()
      assert.equal(page._previewScrollLeft,560)
      assert(page._qaPatches.slice(patchesBeforeScroll).every(patch=>!Object.hasOwn(patch,'previewScrollLeft')&&!Object.hasOwn(patch,'previewScrollIntoView')),'Native scrolling must not write scroll commands back')
      assert.match(page.data.previewRangeText,/11–15/)
      assert(Math.abs(page.data.previewViewportWidth-280/1708*100)<1e-8,'Overview width ignored actual scroll viewport')
      const viewport={left:page.data.previewViewportLeft,width:page.data.previewViewportWidth,range:page.data.previewRangeText}
      page.onPlacementFilterInput(r.event({},{value:'A00'}))
      assert.equal(page._previewScrollLeft,560,'Lower-list filtering reset the independent upper rail')
      assert.equal(page.data.previewRangeText,viewport.range)
      assert.equal(page.data.previewViewportLeft,viewport.left)
      assert.equal(page.data.previewViewportWidth,viewport.width)
      page.onSelectRod(r.event({rodId:page._layout.frontRods[0].id}))
      assert.equal(page._previewScrollLeft,0,'Changing physical rods retained a stale detail offset')
    }finally{r.dispose()}
  }],
  ['failed layout saves block back and export until recovery succeeds',()=>{
    for(const kind of ['portrait','landscape']){
      const r=createRuntime();r.seed()
      try{
        const page=r.make(kind);r.state.failWrites=true;r.place(page)
        assert.equal(page._layoutDirty,true)
        assert.equal(r.stats.alertEnabled,true,'Dirty layout did not register its native exit warning')
        assert.equal(typeof page.openLandscapeLayout,'undefined','Removed landscape feature must not expose a navigation method')
        page.goBack();page.generateLayoutImage()
        assert.equal(r.navigation.length,0,'Unsaved layout silently navigated away')
        assert.equal(r.exports.length,0,'Unsaved layout exported stale data')
        assert.equal(page.data.saveRetryVisible,true)
        r.state.failWrites=false;page.retryLayoutSave()
        assert.equal(page._layoutDirty,false);assert.equal(r.stats.alertEnabled,false)
        page.goBack();assert(r.navigation.length>0)
      }finally{r.dispose()}
    }
  }],
  ['concise UI titles preserve real follow-spot and spot-light product names',()=>{
    const {stageLightingProductIndex}=require('./controller-runtime.cjs')
    for(const [catalogModel,word]of [['TL-SK9702','追光灯'],['TL-SK9305','聚光灯']]){
      const product=stageLightingProductIndex.get(catalogModel),r=createRuntime()
      assert(product,'Actual catalog fixture missing')
      r.seed([{name:product.model+' '+product.name,fixtureSource:'library',fixtureModel:product.model,channelCount:String(product.channelModes[0]),libraryChannelCount:String(product.channelModes[0]),fixtureCount:'1',targetUniverse:'A'}])
      try{
        const main=r.make('main'),layout=r.make()
        assert(main.data.groupCards[0].primaryName.includes(word))
        assert(layout.data.placementGroups[0].fixtureDisplayTitle.includes(word),'Visual icon classification renamed the actual product type')
        assert(!layout.data.placementGroups[0].fixtureDisplayTitle.includes('成像灯'))
      }finally{r.dispose()}
    }
  }],
]
const results=[]
for(const [name,body]of tests){try{body();results.push({name,passed:true});console.log('PASS '+name)}catch(error){results.push({name,passed:false,error:error.stack});console.error('FAIL '+name+'\n'+error.stack)}}
const result={passed:results.every(item=>item.passed),results}
fs.mkdirSync(path.join(__dirname,'evidence'),{recursive:true});fs.writeFileSync(path.join(__dirname,'evidence/layout-extra-interactions.json'),JSON.stringify(result,null,2))
assert(result.passed,'Additional actual layout controller checks failed')
