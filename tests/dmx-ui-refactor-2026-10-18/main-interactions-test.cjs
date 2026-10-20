const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createRuntime, clone, stageLightingProductIndex } = require('./controller-runtime.cjs')
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
function seed(r) {
  r.seed([['TL-SL323', 4, 2], ['TL-SK3101', 3, 2]].map(([model, count, mode]) => ({ name: stageLightingProductIndex.get(model).name, fixtureSource: 'library', fixtureModel: model, channelCount: String(mode), libraryChannelCount: String(mode), fixtureCount: String(count), targetUniverse: 'A' })))
  r.storage.set('audioTool.projects.v1', [{ id: 'project-p', name: '独立项目', createdAt: 1, updatedAt: 1, recordIds: [] }])
}
function deleteGroup(r,main,index){
  main.requestDeleteGroup(r.event({index}))
  assert.equal(main.data.pendingChange?.kind,'delete','Deletion must expose its full recalculation impact before applying')
  assert.equal(main.data.pendingChange.valid,true)
  main.confirmPendingChange()
}
const cases = [
  ['undo restores deleted placements while retaining later independent checks', () => {
    const r = createRuntime(); seed(r)
    try {
      const main = r.make('main'), layout = r.make()
      r.place(layout, 6); main.onShow()
      const first = main._calculationResult.fixtures[0], removed = main._calculationResult.fixtures[6]
      const beforePosition = clone(main._scheme.layout.positionsById[removed.stableId])
      deleteGroup(r,main,1)
      assert.equal(main._calculationResult.fixtures.length, 4)
      r.checkMain(main, first); assert(main._scheme.checksById[first.stableId])
      main.undoDelete()
      assert.equal(main._calculationResult.fixtures.length, 7)
      assert(main._scheme.checksById[first.stableId], 'Undo discarded a later independent check')
      assert.deepEqual(main._scheme.layout.positionsById[removed.stableId], beforePosition)
    } finally { r.dispose() }
  }],
  ['switching context clears deletion undo without copying the temporary draft', () => {
    const r = createRuntime(); seed(r)
    try {
      const main = r.make('main')
      deleteGroup(r,main,1)
      main.onLightingContextChange(r.event({}, { value: main.data.contextRows.findIndex(item => item.id === 'project-p') }))
      assert.equal(main._contextId, 'project-p')
      assert.equal(main.data.groups.length, 0)
      const before = clone(r.workspace.readLightingWorkspace('project-p').scheme), writes = r.stats.writes
      main.undoDelete()
      assert.deepEqual(r.workspace.readLightingWorkspace('project-p').scheme, before)
      assert.equal(r.stats.writes, writes, 'Undo from a different context wrote the new project')
      assert.equal(main.data.undoDeleteAvailable, false)
    } finally { r.dispose() }
  }],
  ['late native check-clear confirmations cannot write after hide, return or unload', () => {
    for (const lifecycle of ['hide', 'return', 'unload']) {
      const r = createRuntime(); seed(r)
      try {
        const main = r.make('main');r.checkMain(main,main._calculationResult.fixtures[0]);main.clearSelectedUniverseChecks();assert.equal(r.modals.length,1)
        if (lifecycle === 'unload') { main.onUnload(); main._qaActive = false } else { main.onHide(); if (lifecycle === 'return') main.onShow() }
        const before = clone(r.workspace.readLightingWorkspace().scheme), writes = r.stats.writes, patches = main._qaPatches.length
        r.answer(true)
        assert.deepEqual(r.workspace.readLightingWorkspace().scheme, before, lifecycle + ': late confirmation changed the scheme')
        assert.equal(r.stats.writes, writes, lifecycle + ': late confirmation wrote storage')
        assert.equal(main._qaPatches.length, patches, lifecycle + ': late confirmation changed view state')
      } finally { r.dispose() }
    }
  }],
  ['deletion preview cancels without writes and undo never resurrects later unchecked survivors',()=>{
    const r=createRuntime();seed(r)
    try{
      const main=r.make('main'),first=main._calculationResult.fixtures[0]
      r.checkMain(main,first)
      const before=clone(r.workspace.readLightingWorkspace().scheme),writes=r.stats.writes
      main.requestDeleteGroup(r.event({index:0}))
      assert.equal(main.data.pendingChange.kind,'delete')
      assert.equal(main.data.pendingChange.deleteSummary.fixtureCount,4)
      assert(main.data.pendingChange.affectedGroups.some(row=>row.id===main._scheme.groupIds[1]&&row.beforeRange.includes('A009')&&row.afterRange.includes('A001')))
      main.cancelPendingChange();assert.equal(r.stats.writes,writes);assert.deepEqual(r.workspace.readLightingWorkspace().scheme,before)
      deleteGroup(r,main,1);r.checkMain(main,first)
      assert(!main._scheme.checksById[first.stableId])
      main.undoDelete();assert.equal(main._calculationResult.fixtures.length,7)
      assert(!main._scheme.checksById[first.stableId],'Undo resurrected a deliberately removed check')
    }finally{r.dispose()}
  }],
  ['deleting the final group creates an intentional empty scheme and can be undone',()=>{
    const r=createRuntime();r.seed()
    try{
      const main=r.make('main');deleteGroup(r,main,0)
      assert.equal(main.data.groups.length,0)
      assert.equal(r.workspace.readLightingWorkspace().scheme.preferences.groups.length,0)
      main.undoDelete();assert.equal(main._calculationResult.fixtures.length,4)
    }finally{r.dispose()}
  }],
  ['failed check save keeps the editable draft and retry visible after return', () => {
    const r = createRuntime(); seed(r)
    try {
      const main = r.make('main'), first = main._calculationResult.fixtures[0]
      main.openFloatingCard(r.event({ index: 0 })); r.state.failWrites = true
      main.toggleFixtureCheck(r.event({ stableId: first.stableId }))
      assert(main._scheme.checksById[first.stableId])
      assert.equal(main.data.floatingGroup.fixtureChips[0].checked, true, 'Failed-save floating card does not show its actual draft')
      assert(!r.workspace.readLightingWorkspace().scheme.checksById[first.stableId])
      r.state.failWrites = false; main.onHide(); main.onShow()
      assert(main._scheme.checksById[first.stableId], 'Return replaced the editable draft with stale storage')
      assert.equal(main.data.saveRetryAvailable, true)
      assert(main.data.contextError, 'Return hid the unsaved-draft error and retry entry')
      main.retryUnsavedScheme()
      assert(r.workspace.readLightingWorkspace().scheme.checksById[first.stableId])
      assert.equal(main.data.saveRetryAvailable, false)
    } finally { r.dispose() }
  }],
  ['an invalid batch candidate cannot erase a prior valid unsaved draft',()=>{
    const r=createRuntime();r.seed([{name:'200W成像灯',fixtureSource:'library',fixtureModel:'TL-SL323',channelCount:'2',libraryChannelCount:'2',fixtureCount:'200',targetUniverse:'A'}])
    try{
      const main=r.make('main'),first=main._calculationResult.fixtures[0]
      r.state.failWriteKeys=['audioTool.dmxLightingWorkspace.journal.v1'];r.checkMain(main,first)
      assert.equal(main._unsavedScheme,true)
      r.state.failWriteKeys=[]
      main.openBatchFixtureSearch();main.selectFixture(r.event({model:'TL-SL323'}));main.confirmBatchAdd()
      assert.equal(main._unsavedScheme,true,'Invalid candidate cleared an existing unsaved draft')
      assert(main._draftScheme.checksById[first.stableId])
      assert.equal(main.data.saveRetryAvailable,true)
      main.onHide();main.onShow()
      assert(main._scheme.checksById[first.stableId])
      assert(main.data.contextError,'Invalid candidate hid recovery controls')
      main.retryUnsavedScheme()
      const saved=r.workspace.readLightingWorkspace().scheme
      assert(saved.checksById[first.stableId])
      assert.equal(r.workspace.calculateScheme(saved).result.fixtures.length,200)
    }finally{r.dispose()}
  }],
  ['failed saves block explicit navigation and stale exports until retry succeeds',()=>{
    const r=createRuntime();seed(r)
    try{
      const main=r.make('main'),first=main._calculationResult.fixtures[0]
      r.state.failWrites=true;r.checkMain(main,first)
      assert.equal(main._unsavedScheme,true)
      assert.equal(r.stats.alertEnabled,true,'Native exit warning was not registered for the dirty draft')
      for(const method of ['onHeaderBack','openFixtureLayout','onOpenCombinedExport'])main[method]()
      assert.equal(r.navigation.length,0,'Failed save allowed navigation into stale data or discarded memory')
      assert.equal(main.data.saveRetryAvailable,true)
      r.state.failWrites=false;main.retryUnsavedScheme()
      assert.equal(r.stats.alertEnabled,false)
      assert(r.workspace.readLightingWorkspace().scheme.checksById[first.stableId])
      main.onHeaderBack();assert.equal(r.navigation.at(-1).type,'navigateBack')
    }finally{r.dispose()}
  }],
  ['invalid intermediate quantity never prunes or persists fixture identities', () => {
    const r = createRuntime(); seed(r)
    try {
      const main = r.make('main'), first = main._calculationResult.fixtures[0]
      r.checkMain(main, first)
      const before = clone(r.workspace.readLightingWorkspace().scheme), writes = r.stats.writes
      main.onCardQuantityInput(r.event({ index: 0 }, { value: '' }))
      assert.equal(r.stats.writes, writes)
      main.onCardQuantityBlur(r.event({ index: 0 }, { value: '' }))
      assert.deepEqual(r.workspace.readLightingWorkspace().scheme, before)
      assert.equal(main.data.groups[0].fixtureCount, '4')
      assert.equal(main.data.pendingChange, null)
    } finally { r.dispose() }
  }],
  ['new project lighting failure is truthful and retries the same project without duplication', () => {
    const r=createRuntime();seed(r)
    try{
      const main=r.make('main'),temporary=clone(r.workspace.readLightingWorkspace('temporary').scheme)
      const beforeProjects=r.storage.get('audioTool.projects.v1').length
      main.onSaveNewProjectToggle();main.onNewProjectNameEntry();main.onProjectNameInput(r.event({},{value:'新建并故障恢复'}))
      r.state.failWriteKeys=['audioTool.dmxLightingWorkspace.journal.v1'];main.saveLightingAsNewProject()
      const projectId=main.data.pendingProjectSaveId
      assert(projectId,'Recoverable creation did not keep its pending project ID')
      assert.equal(r.storage.get('audioTool.projects.v1').length,beforeProjects+1)
      assert.equal(main._contextId,'temporary')
      assert.match(main.data.projectSaveError,/项目已创建.*尚未保存/)
      assert.deepEqual(r.workspace.readLightingWorkspace('temporary').scheme,temporary)
      r.state.failWriteKeys=[];main.retryProjectSave()
      assert.equal(main._contextId,projectId)
      assert.equal(r.storage.get('audioTool.projects.v1').length,beforeProjects+1,'Retry created another project')
      assert.equal(r.workspace.readLightingWorkspace(projectId).scheme.preferences.groups.length,2)
      assert.deepEqual(r.workspace.readLightingWorkspace('temporary').scheme,temporary)
      main.onCardQuantityInput(r.event({index:0},{value:'5'}));main.onCardQuantityBlur(r.event({index:0},{value:'5'}));main.confirmPendingChange()
      assert.equal(r.workspace.readLightingWorkspace(projectId).scheme.preferences.groups[0].fixtureCount,'5')
      assert.equal(r.workspace.readLightingWorkspace('temporary').scheme.preferences.groups[0].fixtureCount,'4')
    }finally{r.dispose()}
  }],
  ['continuous recalculation preserves stable IDs and invalidates only affected checks', () => {
    const r = createRuntime(); seed(r)
    try {
      const main = r.make('main'), fixtures = main._calculationResult.fixtures
      r.checkMain(main, fixtures[0]); r.checkMain(main, fixtures[4])
      const ids = clone(main._scheme.fixtureIdsByGroup), beforeSecond = fixtures[4].addressText
      main.onCardQuantityInput(r.event({ index: 0 }, { value: '5' })); main.onCardQuantityBlur(r.event({ index: 0 }, { value: '5' }))
      assert.equal(main._calculationResult.fixtures.length, 7, 'Preview applied a changed count')
      const writes = r.stats.writes; assert(main.data.pendingChange.valid)
      assert.equal(r.stats.writes, writes)
      main.confirmPendingChange()
      assert.equal(main._calculationResult.fixtures.length, 8)
      const latest = main._calculationResult.fixtures
      assert.deepEqual(main._scheme.fixtureIdsByGroup[main._scheme.groupIds[0]].slice(0,4), ids[main._scheme.groupIds[0]])
      assert.deepEqual(main._scheme.fixtureIdsByGroup[main._scheme.groupIds[1]], ids[main._scheme.groupIds[1]])
      assert(main._scheme.checksById[fixtures[0].stableId])
      assert(!main._scheme.checksById[fixtures[4].stableId])
      assert.notEqual(latest.find(item => item.stableId === fixtures[4].stableId).addressText, beforeSecond)
      assert.equal(latest.find(item => item.stableId === fixtures[4].stableId).addressText, 'A011')
    } finally { r.dispose() }
  }],
  ['quantity reduction previews every removed tail fixture and downstream range', () => {
    const r = createRuntime(); seed(r)
    try {
      const main=r.make('main'),layout=r.make();r.place(layout,3);main.onShow()
      const before=main._calculationResult.fixtures,tail=before.slice(2,4),writes=r.stats.writes
      main.onCardQuantityInput(r.event({index:0},{value:'2'}));main.onCardQuantityBlur(r.event({index:0},{value:'2'}))
      const preview=main.data.pendingChange
      assert.equal(preview.removedFixtureCount,2)
      assert.equal(preview.removedPlacedCount,1)
      assert.deepEqual(preview.removedFixtures.map(item=>item.stableId),tail.map(item=>item.stableId))
      assert.deepEqual(preview.removedFixtures.map(item=>item.addressText),['A005','A007'])
      assert(preview.removedFixtures.find(item=>item.stableId===tail[1].stableId).placementText)
      assert(preview.affectedGroups.some(item=>item.id===main._scheme.groupIds[1]&&item.beforeRange.includes('A009')&&item.afterRange.includes('A005')),'Downstream continuous address changes were hidden')
      assert.equal(r.stats.writes,writes,'Impact preview persisted changes')
      main.cancelPendingChange();assert.equal(main._calculationResult.fixtures.length,7)
      assert(r.workspace.readLightingWorkspace().scheme.layout.positionsById[tail[1].stableId])
    }finally{r.dispose()}
  }],
  ['floating cards tolerate a missing source rectangle and cancel stale transitions', async () => {
    const r = createRuntime(); seed(r)
    try {
      const main = r.make('main'); r.state.deferSelectors = true
      main.openFloatingCard(r.event({ index: 0 })); assert(r.selectors.length)
      r.selectors.shift().run(null); await wait(35)
      assert.equal(main.data.floatingVisible, true)
      main.closeFloatingCard(); main.openFloatingCard(r.event({ index: 1 })); r.selectors.shift().run(r.rect)
      await wait(280)
      assert.equal(main.data.floatingVisible, true)
      assert.equal(main.data.floatingGroup._lightingGroupId, main.data.groupCards[1]._lightingGroupId, 'Old close timer cleared a newly opened card')
      main.closeFloatingCard(); main.onUnload(); main._qaActive = false
      const patches = main._qaPatches.length, writes = r.stats.writes
      await wait(280)
      assert.equal(main._qaPatches.length, patches, 'An unloaded floating transition still called setData')
      assert.equal(r.stats.writes, writes)
    } finally { r.dispose() }
  }],
  ['vertical scrolling cannot trigger group deletion or floating dismissal', async()=>{
    const r=createRuntime();seed(r)
    try{
      const main=r.make('main'),start={clientX:200,clientY:200}
      main.onGroupTouchStart(r.event({index:0},{},{touches:[start],changedTouches:[start]}))
      main.onGroupTouchEnd(r.event({index:0},{},{touches:[],changedTouches:[{clientX:140,clientY:430}]}))
      assert.equal(main.data.swipedGroupIndex,-1,'Vertical list scroll revealed delete')
      main.onGroupTouchStart(r.event({index:0},{},{touches:[start],changedTouches:[start]}))
      main.onGroupTouchEnd(r.event({index:0},{},{touches:[],changedTouches:[{clientX:100,clientY:205}]}))
      assert.equal(main.data.swipedGroupIndex,0,'Intentional horizontal group swipe did not reveal delete')
      main.openFloatingCard(r.event({index:0}));await wait(35)
      const style=main.data.floatingStyle
      main.onFloatingTouchStart({touches:[start],changedTouches:[start]})
      main.onFloatingTouchEnd({touches:[],changedTouches:[{clientX:290,clientY:430}]})
      assert.equal(main.data.floatingStyle,style,'Vertical floating-card scroll began dismissal')
      main.onFloatingTouchStart({touches:[start],changedTouches:[start]})
      main.onFloatingTouchEnd({touches:[],changedTouches:[{clientX:300,clientY:203}]})
      await wait(260);assert.equal(main.data.floatingVisible,false)
    }finally{r.dispose()}
  }],
]
;(async () => {
  const results = []
  for (const [name, body] of cases) {
    try { await body(); results.push({name,passed:true}); console.log('PASS ' + name) }
    catch (error) { results.push({name,passed:false,error:error.stack}); console.error('FAIL ' + name + '\n' + error.stack) }
  }
  const result={passed:results.every(item=>item.passed),results}
  fs.mkdirSync(path.join(__dirname,'evidence'),{recursive:true});fs.writeFileSync(path.join(__dirname,'evidence/main-interactions.json'),JSON.stringify(result,null,2))
  assert(result.passed, 'Main controller regressions failed')
})().catch(error => { console.error(error); process.exitCode=1 })
