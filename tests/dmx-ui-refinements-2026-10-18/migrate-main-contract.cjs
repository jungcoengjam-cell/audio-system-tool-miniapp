const assert=require('node:assert/strict')
const fs=require('node:fs')
const path=require('node:path')
const root=path.resolve(__dirname,'../..'),relative='tests/dmx-ui-native-fixes-2026-10-18/main-native-structure-test.cjs'
const file=path.join(root,relative),backup=path.join(__dirname,'baseline/test-migrations',relative)
if(!fs.existsSync(backup)){fs.mkdirSync(path.dirname(backup),{recursive:true});fs.copyFileSync(file,backup)}
const source=fs.readFileSync(file,'utf8')
const start=source.indexOf("check('swipe delete is a full-width red layer matching the card translation'")
const end=source.indexOf("check('new-fixture confirmation",start)
assert(start>=0&&end>start,'Only the obsolete fixed swipe contract is migrated')
const revised=String.raw`check('swipe delete retains its red width and tracks actual move events', () => {
  assert.match(wxss, /\.swipe-delete\{[^}]*width:76px[^}]*background:#ff3b30/s)
  assert.match(wxss, /\.group-swipe-wrap\{[^}]*background:transparent/s)
  assert.match(wxml, /bindtouchmove="onGroupTouchMove"/)
  assert.match(wxml, /transform: translateX\(\{\{[^}]*swipeDragOffset[^}]*-76[^}]*\}\}px\)/)
  const runtime = createRuntime()
  runtime.seed()
  try {
    const main = runtime.make('main'), before = clone(main._calculationResult), writes = runtime.stats.writes
    const gesture = (x, end = false) => runtime.event({index:0}, {}, {target:{dataset:{}}, touches:end?[]:[{clientX:x,clientY:200}], changedTouches:[{clientX:x,clientY:200}]})
    main.onGroupTouchStart(gesture(200))
    main.onGroupTouchMove(gesture(180))
    assert.equal(main.data.swipeDragIndex, 0)
    assert.equal(main.data.swipeDragOffset, -20, 'first touchmove must produce a live offset')
    main.onGroupTouchMove(gesture(155))
    assert.equal(main.data.swipeDragOffset, -45, 'later touchmove must update before release')
    assert.equal(main.data.swipeDragging, true)
    main.onGroupTouchEnd(gesture(124, true))
    assert.equal(main.data.swipedGroupIndex, 0, 'release snaps open by the existing 76px delete layer')
    assert.equal(main.data.swipeDragging, false)
    main.openFloatingCard(runtime.event({index:0}))
    assert.equal(main.data.floatingVisible, false, 'a synthetic tap immediately after swipe cannot open the floating card')
    main.openModelPicker(runtime.event({index:0}))
    assert.equal(main.data.fixtureSearchOpen, false, 'a synthetic tap immediately after swipe cannot open the model picker')
    assert.deepEqual(main._calculationResult, before)
    assert.equal(runtime.stats.writes, writes)
  } finally { runtime.dispose() }
})

`
fs.writeFileSync(file,source.slice(0,start)+revised+source.slice(end))
console.log('Migrated fixed CSS/timer regex into actual move, snap, input and persistence checks.')
