const assert = require('node:assert/strict')
const { createDelayedEnvironment } = require('./p2-safety-remediation/minimal/delayed-environment.cjs')
const { amplifiers, speakers } = require('../data/equipment')
const { cameras } = require('../data/cameras')
const { stageLightingProductIndex } = require('../data/stage-lighting')
const event = (data) => ({ currentTarget: { dataset: data } })
const input = (value) => ({ detail: { value } })
function pageOf(file) {
  const env = createDelayedEnvironment()
  const page = env.loadPage(file)
  page.onLoad({})
  env.flushNextTicks()
  if (page.onShow) { page.onShow(); env.flushNextTicks() }
  return { env, page }
}
function flush(env) { env.flushNextTicks() }
function one(page, model, alias) {
  const row = page.data.selectorItems.find((item) => item.model === model)
  assert(row, `未找到 ${model}`)
  assert(String(row.aliasMatch).includes(alias), `未显示匹配 ${alias}`)
  return row
}
{
  const { env, page } = pageOf('pages/limiter/limiter.js')
  page.openEquipmentSelector(event({ type: 'amplifier' })); flush(env)
  page.onSelectorInput(input('ak-2c2000')); flush(env)
  const row = one(page, 'TC-22000', 'AK-2C2000')
  page.selectEquipment(event({ index: row.index })); flush(env)
  assert.equal(page.data.selectedAmplifier.model, 'TC-22000')
  assert.deepEqual(amplifiers[page.data.selectedAmplifier.index].stereoPower,
    amplifiers.find((item) => item.model === 'TC-22000').stereoPower)
  page.onUnload(); flush(env)
}
{
  const { env, page } = pageOf('pages/limiter/limiter.js')
  page.openEquipmentSelector(event({ type: 'speaker' })); flush(env)
  page.onSelectorInput(input('ak-6566d')); flush(env)
  const row = one(page, 'KA-2100H', 'AK-6566D')
  page.selectEquipment(event({ index: row.index })); flush(env)
  assert.equal(page.data.selectedSpeaker.model, 'KA-2100H')
  const limiterSpeakers = speakers.filter((item) => !item.calculationDisabled)
  assert.equal(limiterSpeakers[page.data.selectedSpeaker.index].sensitivityDb,
    limiterSpeakers.find((item) => item.model === 'KA-2100H').sensitivityDb)
  page.onUnload(); flush(env)
}
{
  const { env, page } = pageOf('pages/gain-structure/gain-structure.js')
  page.openAmplifierSelector(); flush(env)
  page.onSelectorInput(input('ak-2c2000')); flush(env)
  const row = one(page, 'TC-22000', 'AK-2C2000')
  page.selectAmplifier(event({ index: row.index })); flush(env)
  assert.equal(page.data.selectedAmplifier.model, 'TC-22000')
  assert.deepEqual(amplifiers[page.data.selectedAmplifier.index].stereoPower,
    amplifiers.find((item) => item.model === 'TC-22000').stereoPower)
  page.onUnload(); flush(env)
}
{
  const { env, page } = pageOf('pages/spl/spl.js')
  page.openSpeakerSelector(); flush(env)
  page.onSelectorInput(input('ak-6566d')); flush(env)
  const row = one(page, 'KA-2100H', 'AK-6566D')
  page.selectSpeaker(event({ index: row.index })); flush(env)
  assert.equal(page.data.selectedSpeaker.model, 'KA-2100H')
  const splSpeakers = speakers.filter((item) => !item.calculationDisabled && Number.isFinite(item.sensitivityDb))
  assert.equal(splSpeakers[page.data.selectedSpeaker.index].sensitivityDb,
    splSpeakers.find((item) => item.model === 'KA-2100H').sensitivityDb)
  page.onUnload(); flush(env)
}
{
  const { env, page } = pageOf('pages/camera/camera.js')
  page.openCameraSelector(); flush(env)
  page.onSelectorInput(input('ak-6016vuh')); flush(env)
  const row = one(page, 'TS-0650JSM', 'AK-6016VUH')
  page.selectCamera(event({ index: row.index })); flush(env)
  assert.equal(page.data.selectedCamera.model, 'TS-0650JSM')
  assert.equal(page.data.selectedCamera.sensor, cameras.find((item) => item.model === 'TS-0650JSM').sensor)
  page.onUnload(); flush(env)
}
{
  const { env, page } = pageOf('pages/dmx-address/dmx-address.js')
  page.openBatchFixtureSearch(); flush(env)
  page.onFixtureSearchInput(input('ea-tu9646')); flush(env)
  page.flushFixtureSearch(); flush(env)
  const rows = page.data.fixtureSearchResults
  for (const model of ['TL-SK9202', 'TL-SK9204']) {
    const row = rows.find((item) => item.model === model)
    assert(row && row.aliasMatch.includes('EA-TU9646'), `未找到灯具 ${model}`)
    assert.equal(row.modeText, '13 CH / 17 CH')
    assert.deepEqual(stageLightingProductIndex.get(model).channelModes, [13, 17])
    page.toggleBatchFixture(event({ model })); flush(env)
  }
  assert.deepEqual(page.data.batchSelectedItems.map((item) => item.model), ['TL-SK9202', 'TL-SK9204'])
  page.onUnload(); flush(env)
}
{
  const { createRuntime } = require('./dmx-ui-refactor-2026-10-18/controller-runtime.cjs')
  const runtime = createRuntime()
  try {
    runtime.seed(['TL-SK9202', 'TL-SK9204'].map((fixtureModel, index) => ({
      name: `灯组${index + 1}`, fixtureSource: 'library', fixtureModel,
      channelCount: '13', libraryChannelCount: '13', fixtureCount: '1', targetUniverse: 'A',
    })))
    const page = runtime.make('portrait')
    const before = JSON.stringify(page._layout)
    page.openPlacementPanel(page._layout.internalRods[0].id)
    page.onPlacementFilterInput(input('ea-tu9646'))
    const models = page.data.placementGroups.flatMap((group) => group.fixtures.map((fixture) => fixture.fixtureModel))
    assert.deepEqual([...new Set(models)].sort(), ['TL-SK9202', 'TL-SK9204'])
    assert.equal(JSON.stringify(page._layout), before)
    page.onSearchInput(input('EA-TU9646'))
    page.searchFixture()
    assert.deepEqual([...new Set(page.data.searchResults.map((fixture) => fixture.fixtureModel))].sort(), ['TL-SK9202', 'TL-SK9204'])
    assert.equal(JSON.stringify(page._layout), before)
  } finally { runtime.dispose() }
}
console.log('独立页面交互检查通过：限幅器功放/音箱、增益架构、声压级、摄像机和DMX编址均找到其他型号并选择对应真实型号。')
