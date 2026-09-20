const assert = require('assert')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const { dmxFixtures, stageLightingProducts } = require('../data/stage-lighting')
const { stageLightingChannelProfiles } = require('../pages/dmx-address/data/stage-lighting-channels')
const { stageLightingChannelProfilesExtra } = require('../pages/dmx-address/data/stage-lighting-channels-extra')
const { stageLightingChannelProfilesFinalA } = require('../pages/dmx-address/data/stage-lighting-channels-final-a')
const { stageLightingChannelProfilesFinalB } = require('../pages/dmx-address/data/stage-lighting-channels-final-b')
const { stageLightingChannelProfilesExtra: canonicalExtra } = require('./dmx-channel-sources/stage-lighting-channels-extra.source')
const { stageLightingChannelProfilesFinalA: canonicalFinalA } = require('./dmx-channel-sources/stage-lighting-channels-final-a.source')
const { stageLightingChannelProfilesFinalB: canonicalFinalB } = require('./dmx-channel-sources/stage-lighting-channels-final-b.source')
const { calculateDmxAddressPlan } = require('../utils/dmx-address')
const { buildActualDmxChannelGuide, buildDmxChannelGuide, getDmxChannelProfile, hasDmxChannelProfile } = require('../pages/dmx-address/utils/dmx-channel-guide')
const { getProductDetail } = require('../utils/products')

const root = path.resolve(__dirname, '..')
function checkDmxAddressPlan() {
  const plan = calculateDmxAddressPlan({
    startAddress: 1,
    groups: [
      { id: 'moving', name: '摇头灯', channelCount: 16, fixtureCount: 4 },
      { id: 'wash', name: '染色灯', channelCount: 8, fixtureCount: 6 },
      { id: 'follow', name: '追光灯', channelCount: 200, fixtureCount: 3 },
    ],
  })
  assert.strictEqual(plan.error, undefined)
  assert.strictEqual(plan.totalGroups, 3)
  assert.strictEqual(plan.totalFixtures, 13)
  assert.strictEqual(plan.totalChannels, 712)
  assert.deepStrictEqual(
    plan.groups[0].fixtures.map((fixture) => fixture.startAddress),
    [1, 17, 33, 49],
  )
  assert.deepStrictEqual(
    plan.groups[1].fixtures.map((fixture) => fixture.startAddress),
    [65, 73, 81, 89, 97, 105],
  )
  assert.deepStrictEqual(
    plan.groups[2].fixtures.map(({ universe, startAddress }) => [universe, startAddress]),
    [[1, 113], [1, 313], [2, 1]],
  )
  assert.strictEqual(plan.startText, 'A001')
  assert.strictEqual(plan.endText, 'B200')
  assert.strictEqual(plan.nextText, 'B201')
  assert.strictEqual(plan.groups[2].fixtures[2].rangeText, 'B001–B200')
  assert.strictEqual(plan.unusedTailChannels, 0)
  assert.strictEqual(plan.allocationMode, 'auto')

  const rollover = calculateDmxAddressPlan({
    startAddress: 500,
    groups: [{ name: '光束灯', channelCount: 16, fixtureCount: 2 }],
  })
  assert.strictEqual(rollover.fixtures[0].addressText, 'B001')
  assert.strictEqual(rollover.fixtures[1].addressText, 'B017')
  assert.strictEqual(rollover.unusedTailChannels, 13)
  assert.strictEqual(rollover.skippedRanges[0].rangeText, 'A500–A512')
  assert.strictEqual(rollover.nextText, 'B033')

  const manual = calculateDmxAddressPlan({
    startAddress: 65,
    allocationMode: 'manual',
    groups: [
      { name: 'A组', channelCount: 16, fixtureCount: 2, targetUniverse: 'A' },
      { name: 'B组', channelCount: 32, fixtureCount: 3, targetUniverse: 'B' },
    ],
  })
  assert.strictEqual(manual.error, undefined)
  assert.strictEqual(manual.modeText, '按组分域')
  assert.deepStrictEqual(
    manual.fixtures.map((fixture) => fixture.addressText),
    ['A065', 'A081', 'B001', 'B033', 'B065'],
  )
  assert.strictEqual(manual.startText, 'A065')
  assert.strictEqual(manual.endText, 'B096')
  assert.strictEqual(manual.universeCount, 2)
  assert.strictEqual(manual.nextText, 'A097 / B097')
  assert.strictEqual(manual.universeSummaries.length, 2)

  const interleavedManual = calculateDmxAddressPlan({
    startAddress: 500,
    allocationMode: 'manual',
    groups: [
      { name: '先分B', channelCount: 16, fixtureCount: 2, targetUniverse: 'B' },
      { name: '后分A', channelCount: 12, fixtureCount: 1, targetUniverse: 'A' },
    ],
  })
  assert.strictEqual(interleavedManual.error, undefined)
  assert.deepStrictEqual(
    interleavedManual.fixtures.map((fixture) => fixture.addressText),
    ['B001', 'B017', 'A500'],
    '按组分域不应受页面分组顺序限制域顺序',
  )
  assert.strictEqual(interleavedManual.nextText, 'A512 / B033')

  const manualCapacityError = calculateDmxAddressPlan({
    startAddress: 1,
    allocationMode: 'manual',
    groups: [{ name: '超容量组', channelCount: 300, fixtureCount: 2, targetUniverse: 'B' }],
  })
  assert(manualCapacityError.error.includes('第 1 组'))
  assert(manualCapacityError.error.includes('B 域'))
  assert(manualCapacityError.error.includes('拆分'))

  const fourUniverses = calculateDmxAddressPlan({
    startAddress: 1,
    groups: [{ name: '满域灯具', channelCount: 512, fixtureCount: 4 }],
  })
  assert.deepStrictEqual(
    fourUniverses.fixtures.map((fixture) => fixture.addressText),
    ['A001', 'B001', 'C001', 'D001'],
  )
  assert.strictEqual(fourUniverses.nextText, '已到 D512 上限')
  assert(calculateDmxAddressPlan({
    startAddress: 1,
    groups: [{ name: '超域灯具', channelCount: 512, fixtureCount: 5 }],
  }).error)

  assert(calculateDmxAddressPlan({
    startAddress: 1,
    groups: [{ name: '错误灯具', channelCount: 513, fixtureCount: 1 }],
  }).error)
  assert(calculateDmxAddressPlan({
    startAddress: 1,
    groups: [{ name: '错误灯具', channelCount: 16, fixtureCount: 0 }],
  }).error)
}

function checkDmxChannelGuide() {
  const expectedModes = {
    'TL-SW6001': [5, 9],
    'TL-SW6002': [5, 9],
    'TL-SL333': [6, 3],
    'TL-SL113': [21, 25],
    'TL-SL210B': [5, 7, 9],
    'TL-SM3401': [39],
    'TL-SL201': [4, 8],
    'TL-SL203': [3, 7],
    'TL-SL204': [4, 8],
    'TL-SL205': [6, 10],
    'TL-SL206': [4, 8, 9],
    'TL-SL208': [4, 8, 9],
    'TL-SL208B': [4, 8, 9],
    'TL-SL209': [4, 6, 8],
    'TL-SL210': [5, 7, 9],
    'TL-SL336': [3, 7],
    'TL-SL342': [2, 6, 7],
    'TL-SL342B': [2, 6, 7],
    'TL-SL343': [2, 6, 7],
    'TL-SL326': [1],
    'TL-SL202': [2],
    'TL-SL321': [2],
    'TL-SL323': [2],
    'TL-SL327': [2],
    'TL-SL601': [2],
    'TL-SL611': [2],
    'TL-SL613': [2],
    'TL-SL614': [2],
    'TL-SL621': [2],
    'TL-SL641': [2],
    'TL-SK3101': [2, 5],
    'TL-SL301': [2, 5],
    'TL-SL311': [3, 6],
    'TL-SK9303': [4, 6],
    'TL-SL306': [6, 4],
    'TL-SL335': [5],
    'TL-SL651': [3],
    'TL-SL302': [2, 6, 7],
    'TL-SL312': [4, 8, 9],
    'TL-SL314': [3, 6, 7],
    'TL-SL315': [5, 9, 10],
    'TL-SL392': [12],
    'TL-SL393': [6],
    'TL-SL432': [8],
    'TL-SL313': [2, 5, 6],
    'TL-SL326B': [3],
    'TL-SL334': [3],
    'TL-SL344': [2, 4, 6, 8, 12],
    'TL-SL421': [17, 12],
    'TL-SL450': [31, 38],
    'TL-SL602': [11],
    'TL-SL631': [6],
    'TL-SK9702': [8],
    'TL-SL308': [11, 14],
    'TL-SL328': [11, 13],
    'TL-SL361': [4, 9, 10],
    'TL-SV3101': [14, 10],
    'TL-SV3102': [10, 14],
    'TL-SV3302': [15, 11],
    'TL-SV6101': [10, 11],
    'TL-SL101': [13, 15],
    'TL-SL101C': [15],
    'TL-SL112': [18, 22],
    'TL-SL156': [16, 9],
    'TL-SL157': [12, 14],
    'TL-SL162': [17, 15],
    'TL-SL171': [15, 13],
    'TL-SL172': [13, 15],
    'TL-SL105': [13, 16],
    'TL-SL182': [17, 15],
    'TL-SL184': [17, 15],
    'TL-SL185': [25, 21],
    'TL-SL186': [21, 25],
    'TL-SL155': [16, 24],
    'TL-SW03': [17, 12, 10, 6],
    'TL-SM3801': [13, 15],
    'TL-SM3402': [13, 25],
    'TL-SM6602': [20, 16],
    'TL-SM3502IP': [16, 18],
    'TL-SM9051': [27, 33],
    'TL-SM9210': [21, 27],
    'TL-SM9402IP': [32, 36],
    'TL-SL3102': [16, 36],
    'TL-SL3103': [16, 36],
    'TL-SM3101': [18],
    'TL-SM3102': [16],
    'TL-SM3502': [23],
    'TL-SM3503': [12, 14],
    'TL-SM3505': [12, 14],
    'TL-SV3301': [17, 14, 13],
    'TL-SV3103': [14, 16, 18],
    'TL-SV3104': [20, 21],
    'TL-SV3303': [14, 16, 18],
    'TL-SV3304': [17, 18],
    'TL-SV6102': [13, 17],
    'TL-SK9201': [5, 8],
    'TL-SK9202': [13, 17],
    'TL-SK9203': [5, 8],
    'TL-SK9204': [13, 17],
    'TL-SK9205': [6, 11],
    'TL-SK9301': [12, 15],
    'TL-SK9302': [12, 15],
    'TL-SK9305': [5, 9],
    'TL-SE3401': [4, 16, 88, 168],
    'TL-SK9401': [7, 9, 11, 14, 17, 22],
    'TL-SL192': [38, 26],
    'TL-SL193': [38, 15],
    'TL-SL309': [11, 20, 204],
    'TL-SL3101': [7, 16],
    'TL-SL501': [17],
    'TL-SL534': [5, 17, 18, 27, 28, 53],
    'TL-SL535': [5, 17, 18, 27, 28, 53],
    'TL-SL612': [4],
    'TL-SM3601': [17, 27, 99, 108, 168, 170],
    'TL-SM3602': [26, 68],
    'TL-SM9001': [23, 47],
    'TL-SM9002': [25, 61],
    'TL-SM9403': [33, 39],
    'TL-SV3105': [19, 21],
    'TL-SV3106': [19, 21],
    'TL-SV6302': [28, 67],
  }
  const newlyCataloguedModels = new Set([
    'TL-SL201', 'TL-SL203', 'TL-SL204', 'TL-SL205', 'TL-SL206', 'TL-SL208', 'TL-SL208B',
    'TL-SL209', 'TL-SL210', 'TL-SL336', 'TL-SL342', 'TL-SL342B', 'TL-SL343',
    'TL-SL326', 'TL-SL202', 'TL-SL321', 'TL-SL323', 'TL-SL327', 'TL-SL601',
    'TL-SL611', 'TL-SL613', 'TL-SL614', 'TL-SL621', 'TL-SL641',
    'TL-SK3101', 'TL-SL301', 'TL-SL311', 'TL-SK9303', 'TL-SL306', 'TL-SL335', 'TL-SL651',
    'TL-SL302', 'TL-SL312', 'TL-SL314', 'TL-SL315', 'TL-SL392', 'TL-SL393', 'TL-SL432',
    'TL-SK9201', 'TL-SK9202', 'TL-SK9203', 'TL-SK9204', 'TL-SK9205', 'TL-SK9301', 'TL-SK9302', 'TL-SK9305',
    'TL-SL313', 'TL-SL326B', 'TL-SL344', 'TL-SL421', 'TL-SL450', 'TL-SL602', 'TL-SL631',
    'TL-SL361', 'TL-SV3101', 'TL-SV3102', 'TL-SV6101',
    'TL-SL101', 'TL-SL101C', 'TL-SL112', 'TL-SL156', 'TL-SL157', 'TL-SL162', 'TL-SL171', 'TL-SL172',
    'TL-SL105', 'TL-SL182', 'TL-SL184', 'TL-SL185', 'TL-SL186',
    'TL-SL155', 'TL-SW03', 'TL-SM3801', 'TL-SM3402', 'TL-SM6602',
    'TL-SM3502IP', 'TL-SM9051', 'TL-SM9210', 'TL-SM9402IP',
    'TL-SM3101', 'TL-SM3102', 'TL-SM3502', 'TL-SM3503', 'TL-SM3505', 'TL-SV3301',
    'TL-SV3103', 'TL-SV3104', 'TL-SV3303', 'TL-SV3304', 'TL-SV6102', 'TL-SL3102', 'TL-SL3103',
    'TL-SE3401', 'TL-SK9401', 'TL-SL192', 'TL-SL193', 'TL-SL309', 'TL-SL3101', 'TL-SL501',
    'TL-SL534', 'TL-SL535', 'TL-SL612', 'TL-SM3601', 'TL-SM3602', 'TL-SM9001', 'TL-SM9002',
    'TL-SM9403', 'TL-SV3105', 'TL-SV3106', 'TL-SV6302',
  ])
  assert.strictEqual(Object.keys(expectedModes).length, 121)
  assert.strictEqual(Object.keys(stageLightingChannelProfiles).length, 121)
  assert.deepStrictEqual(canonicalExtra, stageLightingChannelProfilesExtra, 'canonical extra 与运行 extra 不一致')
  assert.deepStrictEqual(canonicalFinalA, stageLightingChannelProfilesFinalA, 'canonical final-a 与运行 final-a 不一致')
  assert.deepStrictEqual(canonicalFinalB, stageLightingChannelProfilesFinalB, 'canonical final-b 与运行 final-b 不一致')
  const legacyModels = Object.keys(canonicalExtra).filter((model) => !['TL-SL3102', 'TL-SL3103'].includes(model))
  const legacyHash = crypto.createHash('sha256').update(JSON.stringify(Object.fromEntries(legacyModels.map((model) => [model, canonicalExtra[model]])))).digest('hex')
  assert.strictEqual(legacyHash, '4f4b7feb510dbc32d9d46b3f6e6fa120417f3cf603dcf0fe0aab278231e2760f', '旧14型号数据哈希变化')
  const finalProfiles = { ...stageLightingChannelProfilesFinalA, ...stageLightingChannelProfilesFinalB }
  const preFinalProfiles = Object.fromEntries(Object.entries(stageLightingChannelProfiles)
    .filter(([model]) => !Object.prototype.hasOwnProperty.call(finalProfiles, model)))
  const preFinalHash = crypto.createHash('sha256').update(JSON.stringify(preFinalProfiles)).digest('hex')
  assert.strictEqual(preFinalHash, 'f7c682ce6aafecb3f0d04131e6b18c896291eb9195f5124b7b6e183f5c9587d6',
    '新增最终分片时改变了原有103型号运行资料')
  Object.entries(finalProfiles).forEach(([model, finalProfile]) => {
    assert.deepStrictEqual(stageLightingChannelProfiles[model], finalProfile, `${model} 最终分片未并入运行资料`)
  })
  assert.strictEqual(hasDmxChannelProfile('TL-SE3401'), true, '已知型号未被 hasDmxChannelProfile 识别')
  assert.strictEqual(hasDmxChannelProfile('not-supported'), false, '未知型号错误地被 hasDmxChannelProfile 识别')
  const isolatedProfile = getDmxChannelProfile('TL-SE3401')
  const sourceProfileSnapshot = JSON.stringify(stageLightingChannelProfiles['TL-SE3401'])
  const isolatedChannel = isolatedProfile.modes[0].channels[0]
  isolatedChannel.name = '__mutated__'
  if (isolatedChannel.ranges?.[0]) isolatedChannel.ranges[0].description = '__mutated__'
  assert.strictEqual(
    JSON.stringify(stageLightingChannelProfiles['TL-SE3401']),
    sourceProfileSnapshot,
    'getDmxChannelProfile 返回值仍可污染源 profile',
  )
  const missingModels = dmxFixtures.filter((item) => item.dmxAddressable && item.channelModes.length && !hasDmxChannelProfile(item.model))
  assert.strictEqual(missingModels.length, 0, `仍有灯具缺少通道资料：${missingModels.map((item) => item.model).join('、')}`)
  const expectedNewSources = {
    'TL-SL201': ['TL-SL201-UM-CN.pdf', 'PDF第5页'],
    'TL-SL203': ['TL-SL203-UM-CN.pdf', 'PDF第5页'],
    'TL-SL204': ['TL-SL204-UM-CN.pdf', 'PDF第5页'],
    'TL-SL205': ['TL-SL205-UM-CN.pdf', 'PDF第5–7页'],
    'TL-SL206': ['itc产品说明书 TL-SL206-UM-CN@V20250430.pdf', 'PDF第5页'],
    'TL-SL208': ['TL-SL208-UM-CN.pdf', 'PDF第4页'],
    'TL-SL208B': ['TL-SL208B-UM-CN.pdf', 'PDF第4页'],
    'TL-SL209': ['TL-SL209-UM-CN.pdf', 'PDF第5页'],
    'TL-SL210': ['TL-SL210-UM-CN.pdf', 'PDF第6页'],
    'TL-SL336': ['TL-SL336-UM-CN.pdf', 'PDF第6页'],
    'TL-SL342': ['TL-SL342-UM-CN.pdf', 'PDF第4页'],
    'TL-SL342B': ['TL-SL342B-UM-CN.pdf', 'PDF第4页'],
    'TL-SL343': ['TL-SL343-UM-CN.pdf', 'PDF第4页'],
    'TL-SL326': ['itc产品说明书 TL-SL326-UM-CN@V20240812.pdf', 'PDF第4页'],
    'TL-SL202': ['TL-SL202-UM-CN.pdf', 'PDF第4页'],
    'TL-SL321': ['TL-SL321-UM-CN.pdf', 'PDF第3页'],
    'TL-SL323': ['TL-SL323-UM-CN.pdf', 'PDF第3页'],
    'TL-SL327': ['itc产品说明书 TL-SL327-UM-CN.pdf', 'PDF第6页'],
    'TL-SL601': ['TL-SL601-UM-CN.pdf', 'PDF第4页'],
    'TL-SL611': ['itc产品说明书 TL-SL611-UM-CN@V20260608.pdf', 'PDF第3页'],
    'TL-SL613': ['itc产品说明书 TL-SL613-UM-CN@V20241024.pdf', 'PDF第3页'],
    'TL-SL614': ['TL-SL614-UM-CN.pdf', 'PDF第2页'],
    'TL-SL621': ['TL-SL621-UM-CN.pdf', 'PDF第4页'],
    'TL-SL641': ['TL-SL641-UM-CN.pdf', 'PDF第2页'],
    'TL-SK3101': ['itc-产品说明书 TL-SK3101-UM-CN@20250903.pdf', 'PDF第9页'],
    'TL-SL301': ['itc产品说明书 TL-SL301-UM-CN.pdf', 'PDF第4页'],
    'TL-SL311': ['TL-SL311-UM-CN.pdf', 'PDF第4页'],
    'TL-SK9303': ['itc产品说明书 TL-SK9303-UM-CN.pdf', 'PDF第11–12页'],
    'TL-SL306': ['itc产品说明书 TL-SL306-UM-CN@V20250515.pdf', 'PDF第11页'],
    'TL-SL335': ['itc产品说明书 TL-SL335-UM-CN.pdf', 'PDF第4页'],
    'TL-SL651': ['TL-SL651-UM-CN.pdf', 'PDF第3页'],
    'TL-SL302': ['TL-SL302-UM-CN.pdf', 'PDF第3–4页'],
    'TL-SL312': ['TL-SL312-UM-CN.pdf', 'PDF第3–4页'],
    'TL-SL314': ['TL-SL314-UM-CN.pdf', 'PDF第4页'],
    'TL-SL315': ['TL-SL315-UM-CN.pdf', 'PDF第3–4页'],
    'TL-SL392': ['TL-SL392-UM-CN.pdf', 'PDF第4页'],
    'TL-SL393': ['TL-SL393-UM-CN.pdf', 'PDF第5页'],
    'TL-SL432': ['itc产品说明书 TL-SL432-UM-CN@V20241107.pdf', 'PDF第8页'],
    'TL-SK9201': ['itc产品说明书 TL-SK9201-UM-CN.pdf', 'PDF第11–12页'],
    'TL-SK9202': ['itc产品说明书 TL-SK9202-UM-CN.pdf', 'PDF第12–14页'],
    'TL-SK9203': ['itc产品说明书 TL-SK9203-UM-CN.pdf', 'PDF第11–12页'],
    'TL-SK9204': ['itc产品说明书 TL-SK9204-UM-CN.pdf', 'PDF第12–14页'],
    'TL-SK9205': ['itc产品说明书 TL-SK9205-UM-CN.pdf', 'PDF第11–12页'],
    'TL-SK9301': ['itc产品说明书 TL-SK9301-UM-CN.pdf', 'PDF第12–14页'],
    'TL-SK9302': ['itc产品说明书 TL-SK9302-UM-CN.pdf', 'PDF第12–14页'],
    'TL-SK9305': ['itc产品说明书 TL-SK9305-UM-CN.pdf', 'PDF第11–12页'],
    'TL-SL313': ['TL-SL313-UM-CN.pdf', 'PDF第4页'],
    'TL-SL326B': ['TL-SL326B-UM-CN.pdf', 'PDF第5页'],
    'TL-SL334': ['itc产品说明书 TL-SL334-UM-CN@V20240812.pdf', 'PDF第5页'],
    'TL-SL344': ['itc-产品说明书TL-SL344-UM-CN @20250812.pdf', 'PDF第3–5页'],
    'TL-SL421': ['TL-SL421-UM-CN.pdf', 'PDF第4–5页'],
    'TL-SL450': ['itc产品说明书 TL-SL450-UM-CN@V20240731.pdf', 'PDF第7–9页'],
    'TL-SL602': ['TL-SL602-UM-CN.pdf', 'PDF第7–8页'],
    'TL-SL631': ['TL-SL631-UM-CN.pdf', 'PDF第2页（说明书标注第5页）'],
    'TL-SK9702': ['itc产品说明书 TL-SK9702-UM-CN@V20250618.pdf', 'PDF第8页（说明书标注第7页）'],
    'TL-SL308': ['itc产品说明书 TL-SL308-UM-CN@V20240812.pdf', 'PDF第11页（说明书标注第9页）'],
    'TL-SL328': ['TL-SL328-UM-CN.pdf', 'PDF第5–7页（说明书标注第12–14页）'],
    'TL-SL361': ['itc产品说明书 TL-SL361-UM-CN@V20250326.pdf', 'PDF第8页（说明书标注第6页）'],
    'TL-SV3101': ['itc产品说明书 TL-SV3101-UM-CN.pdf', 'PDF第9页（说明书标注第8页）'],
    'TL-SV3102': ['itc产品说明书 TL-SV3102-UM-CN@V20250614.pdf', 'PDF第9页（说明书标注第8页）'],
    'TL-SV3302': ['itc产品说明书 TL-SV3302-UM-CN.pdf', 'PDF第9页（说明书标注第8页）'],
    'TL-SV6101': ['TL-SV6101-UM-CN@V20250115.pdf', 'PDF第9页（说明书标注第8页）'],
    'TL-SL101': ['TL-SL101-UM-CN.pdf', 'PDF第17–20页'],
    'TL-SL101C': ['itc产品说明书 TL-SL101C-UM-CN@V20250326.pdf', 'PDF第17–20页'],
    'TL-SL112': ['itc产品说明书 TL-SL112-UM-CN@V20241024.pdf', 'PDF第18–22页'],
    'TL-SL156': ['itc产品说明书 TL-SL156-UM-CN@V20241127.pdf', 'PDF第9页'],
    'TL-SL157': ['itc产品说明书 TL-SL157-UM-CN@V20240812.pdf', 'PDF第15–16页'],
    'TL-SL162': ['itc产品说明书 TL-SL162-UM-CN@V20241108.pdf', 'PDF第19–22页'],
    'TL-SL171': ['itc产品说明书 TL-SL171-UM-CN@V20241206.pdf', 'PDF第18–21页'],
    'TL-SL172': ['itc产品说明书 TL-SL172-UM-CN@V20260706.pdf', 'PDF第18–21页'],
    'TL-SL105': ['itc产品说明书 TL-SL105-UM-CN@V20240928.pdf', 'PDF第19–22页'],
    'TL-SL182': ['itc产品说明书 TL-SL182-UM-CN@V20241206.pdf', 'PDF第19–21页'],
    'TL-SL184': ['itc产品说明书 TL-SL184-UM-CN@V20240905.pdf', 'PDF第19–21页'],
    'TL-SL185': ['TL-SL185-UM-CN.pdf', 'PDF第20–23页'],
    'TL-SL186': ['itc产品说明书 TL-SL186-UM-CN.pdf', 'PDF第20–23页'],
    'TL-SL155': ['TL-SL155-UM-CN.pdf', 'PDF第4–5页'],
    'TL-SW03': ['itc产品说明书 TL-SW03-UM-CN@V20240812.pdf', 'PDF第3–4页'],
    'TL-SM3801': ['itc产品说明书 TL-SM3801-UM-CN@V20250430.pdf', 'PDF第18–21页'],
    'TL-SM3402': ['itc产品说明书 TL-SM3402-UM-CN@V20260629.pdf', 'PDF第15–17页'],
    'TL-SM6602': ['itc产品说明书 TL-SM6602-UM-CN@V20250331.pdf', 'PDF第19–22页'],
    'TL-SM3502IP': ['itc产品说明书TL-SM3502IP-UM-CN.pdf', 'PDF第16–21页'],
    'TL-SM9051': ['itc产品说明书 TL-SM9051-UM-CN.pdf', 'PDF第17–21页'],
    'TL-SM9210': ['itc产品说明 TL-SM9210-UM-CN.pdf', 'PDF第16–20页'],
    'TL-SM9402IP': ['itc产品说明 TL-SM9402IP-UM-CN.pdf', 'PDF第16–20页'],
    'TL-SL3102': ['itc-产品说明书 TL-SL3102-UM-CN.pdf', 'PDF第10–12页'],
    'TL-SL3103': ['itc产品说明书 TL-SL3103.pdf', 'PDF第10–12页'],
    'TL-SM3101': ['itc产品说明书 TL-SM3101-UM-CN@V20240826.pdf', 'PDF第17–19页'],
    'TL-SM3102': ['itc产品说明书 TL-SM3102-UM-CN@V20240826.pdf', 'PDF第13–16页'],
    'TL-SM3502': ['itc产品说明书 TL-SM3502-UM-CN@V20240826.pdf', 'PDF第17–19页'],
    'TL-SM3503': ['itc产品说明书 TL-SM3503-UM-CN.pdf', 'PDF第17–20页'],
    'TL-SM3505': ['TL-SM3505.pdf', 'PDF第17–20页'],
    'TL-SV3301': ['itc产品说明书 TL-SV3301-UM-CN.pdf', 'PDF第8–9页'],
    'TL-SV3103': ['itc产品说明书 TL-SV3103-UM-CN.pdf', 'PDF第8–9页'],
    'TL-SV3104': ['itc产品说明书 TL-SV3104-UM-CN.pdf', 'PDF第8–9页'],
    'TL-SV3303': ['itc产品说明书 TL-SV3303.pdf', 'PDF第8–9页'],
    'TL-SV3304': ['itc产品说明书 TL-SV3304-UM-CN.pdf', 'PDF第8–11页'],
    'TL-SV6102': ['itc产品说明书 TL-SV6102-UM-CN.pdf', 'PDF第9页'],
    'TL-SE3401': ['itc产品说明书 TL-SE3401.pdf', 'PDF第10–13页'],
    'TL-SK9401': ['itc产品说明书 TL-SK9401-UM-CN@V20241030.pdf', 'PDF第9–17页'],
    'TL-SL192': ['TL-SL192-UM-CN@V20250115.pdf', 'PDF第19–24页'],
    'TL-SL193': ['TL-SL193-UM-CN.pdf', 'PDF第6–8页'],
    'TL-SL309': ['TL-SL309-UM-CN.pdf', 'PDF第12–15页'],
    'TL-SL3101': ['itc产品说明书 TL-SL3101-UM-CN@V20250719.pdf', 'PDF第8–10页'],
    'TL-SL501': ['TL-SL501-UM-CN.pdf', 'PDF第2–3页'],
    'TL-SL534': ['itc产品说明书 TL-SL534-UM-CN@V20241119.pdf', 'PDF第15–22页'],
    'TL-SL535': ['itc产品说明书 TL-SL535-UM-CN@V20241119.pdf', 'PDF第18–26页'],
    'TL-SL612': ['itc产品说明书 TL-SL612-UM-CN@V20241207.pdf', 'PDF第3页'],
    'TL-SM3601': ['itc产品说明书 TL-SM3601-UM-CN@V20240925.pdf', 'PDF第11–21页'],
    'TL-SM3602': ['itc产品说明书 TL-SM3602-UM-CN@V20240925.pdf', 'PDF第8–10页'],
    'TL-SM9001': ['itc产品说明 TL-SM9001-UM-CN@V20250719.pdf', 'PDF第13–16页'],
    'TL-SM9002': ['itc产品说明书 TL-SM9002-UM-CN@V20250719.pdf', 'PDF第14–17页'],
    'TL-SM9403': ['itc产品说明 TL-SM9403-UM-CN@V20250719.pdf', 'PDF第17–21页'],
    'TL-SV3105': ['itc-产品说明书 TL-SV3105-UM-CN.pdf', 'PDF第8–11页'],
    'TL-SV3106': ['itc产品说明书 TL-SV3106-UM-CN.pdf', 'PDF第8–11页'],
    'TL-SV6302': ['itc产品说明书 TL-SV6302-UM-CN.pdf', 'PDF第11–15页'],
  }
  Object.entries(expectedModes).forEach(([model, channelCounts]) => {
    const profile = getDmxChannelProfile(model)
    const product = stageLightingProducts.find((item) => item.model === model)
    assert(profile, `缺少灯具通道资料：${model}`)
    assert(product, `缺少资料库产品：${model}`)
    assert.strictEqual(profile.verification, 'checked')
    assert(profile.sourcePageText)
    if (expectedNewSources[model]) {
      assert.deepStrictEqual([profile.source, profile.sourcePageText], expectedNewSources[model],
        `${model} 来源文件或页码不一致`)
    }
    assert.deepStrictEqual(profile.modes.map((mode) => mode.channelCount), channelCounts)
    if (newlyCataloguedModels.has(model)) {
      assert.deepStrictEqual(profile.modes.map((mode) => mode.channelCount), product.channelModes,
        `${model} 资料模式与产品 channelModes 不一致`)
    }
    profile.modes.forEach((mode) => assert.strictEqual(
      mode.channels.length,
      mode.channelCount,
      `${model} ${mode.channelCount}CH 通道数不一致`,
    ))
    if (newlyCataloguedModels.has(model) && !['TL-SL3102', 'TL-SL3103'].includes(model)) {
      profile.modes.forEach((mode) => mode.channels.forEach((channel) => {
        if (channel.ranges.length === 1 && channel.ranges[0].range === '保留/未定义') {
          assert(channel.ranges[0].description,
            `${model} CH${channel.channel} 未定义通道缺少说明`)
          return
        }
        let next = 0
        channel.ranges.forEach((range) => {
          const bounds = range.range.split('–').map(Number)
          const start = bounds[0]
          const end = bounds.length === 1 ? start : bounds[1]
          const documentedOverlap = (model === 'TL-SL421' && channel.name === '频闪' && range.range === '251–255')
            || (model === 'TL-SL344' && channel.name === '功能选择' && range.range === '170–185')
            || ((model === 'TL-SV3101' || model === 'TL-SV3102') && channel.name === '色盘' && range.range === '140–255')
            || (model === 'TL-SL3101' && channel.name === '图案渐绘' && range.range === '205–255')
          assert(Number.isInteger(start) && Number.isInteger(end) && (start === next || documentedOverlap),
            `${model} CH${channel.channel} 数值段不连续：${range.range}`)
          next = end + 1
        })
        assert.strictEqual(next, 256, `${model} CH${channel.channel} 数值段未覆盖 0–255`)
      }))
    }
  })
  const eighthBatchChannelNames = {
    'TL-SL101': [['X轴', 'Y轴', 'XY轴速度', '调光', '频闪', '色盘', '固定盘', '棱镜1/2', '棱镜1旋转', '棱镜2旋转', '雾化', '调焦', '宏功能'], ['X轴', 'X轴微调', 'Y轴', 'Y轴微调', 'XY轴速度', '调光', '频闪', '色盘', '固定盘', '棱镜1/2', '棱镜1旋转', '棱镜2旋转', '雾化', '调焦', '宏功能']],
    'TL-SL101C': [['X轴', 'X轴微调', 'Y轴', 'Y轴微调', 'XY轴速度', '调光', '频闪', '色盘', '固定盘', '棱镜1/2', '棱镜1旋转', '棱镜2旋转', '雾化', '调焦', '宏功能']],
    'TL-SL112': [['X轴', 'Y轴', 'XY轴速度', '调光', '频闪', '色盘', '固定盘', '旋转盘', '旋转盘旋转', '效果盘', '棱镜1/2', '棱镜1/2旋转', '棱镜3/4', '棱镜3/4旋转', '雾化', '调焦', '变焦', '宏功能'], ['X轴', 'X轴微调', 'Y轴', 'Y轴微调', 'XY轴速度', '调光', '频闪', '色盘', '固定盘', '旋转盘', '旋转盘旋转', '效果盘', '棱镜1/2', '棱镜1/2旋转', '棱镜3/4', '棱镜3/4旋转', '雾化', '调焦', '调焦微调', '变焦', '变焦微调', '宏功能']],
    'TL-SL156': [['X轴', 'Y轴', 'XY速度', '红色', '绿色', '蓝色', '白色', '总调光', '频闪', '调焦', '内置程序', '颜色变化', '颜色宏', 'X轴微调', 'Y轴微调', '复位'], ['X轴', 'Y轴', 'XY速度', '红色', '绿色', '蓝色', '白色', '总调光', '频闪']],
    'TL-SL157': [['X轴', 'Y轴', 'XY轴速度', '调光', '频闪', '红色', '绿色', '蓝色', '白色', '流水效果', '变焦', '宏功能'], ['X轴', 'X轴微调', 'Y轴', 'Y轴微调', 'XY轴速度', '调光', '频闪', '红色', '绿色', '蓝色', '白色', '流水效果', '变焦', '宏功能']],
    'TL-SL162': [['X轴', 'X轴微调', 'Y轴', 'Y轴微调', 'XY轴速度', '调光', '频闪', '色盘', '固定盘', '旋转盘', '旋转盘旋转', '棱镜', '棱镜1旋转', '雾化', '调焦', '变焦', '宏功能'], ['X轴', 'Y轴', 'XY轴速度', '调光', '频闪', '色盘', '固定盘', '旋转盘', '旋转盘旋转', '棱镜', '棱镜1旋转', '雾化', '调焦', '变焦', '宏功能']],
    'TL-SL171': [['X轴', 'X轴微调', 'Y轴', 'Y轴微调', 'XY轴速度', '调光', '频闪', '色盘', '固定盘', '棱镜1/2', '棱镜1旋转', '棱镜2旋转', '雾化', '调焦', '宏功能'], ['X轴', 'Y轴', 'XY轴速度', '调光', '频闪', '色盘', '固定盘', '棱镜1/2', '棱镜1旋转', '棱镜2旋转', '雾化', '调焦', '宏功能']],
    'TL-SL172': [['X轴', 'Y轴', 'XY轴速度', '调光', '频闪', '色盘', '固定盘', '棱镜1/2', '棱镜1旋转', '棱镜2旋转', '雾化', '调焦', '宏功能'], ['X轴', 'X轴微调', 'Y轴', 'Y轴微调', 'XY轴速度', '调光', '频闪', '色盘', '固定盘', '棱镜1/2', '棱镜1旋转', '棱镜2旋转', '雾化', '调焦', '宏功能']],
  }
  Object.entries(eighthBatchChannelNames).forEach(([model, modes]) => assert.deepStrictEqual(getDmxChannelProfile(model).modes.map((item) => item.channels.map((channel) => channel.name)), modes, `${model} 通道顺序不一致`))
  const sl3102Channel = (model, modeIndex, channelIndex) => getDmxChannelProfile(model).modes[modeIndex].channels[channelIndex]
  for (const model of ['TL-SL3102', 'TL-SL3103']) {
    assert.deepStrictEqual(sl3102Channel(model, 0, 0).ranges.map((item) => item.range), ['0', '1–255'])
    assert.deepStrictEqual(sl3102Channel(model, 0, 4).ranges.map((item) => item.range), ['0–3', '4–31', '32–35', '36–39', '40–43', '44–239', '240–255'])
    assert.deepStrictEqual(sl3102Channel(model, 0, 8).ranges.map((item) => item.range), ['1–127', '128–255'])
    assert.deepStrictEqual(sl3102Channel(model, 0, 14).ranges.map((item) => item.range), ['1–255'])
    assert.deepStrictEqual(sl3102Channel(model, 1, 10).ranges.map((item) => item.range), ['1–255'])
    assert.deepStrictEqual(sl3102Channel(model, 1, 18).ranges.map((item) => item.range), ['1–127', '128–255'])
    assert.deepStrictEqual(sl3102Channel(model, 1, 19).ranges.map((item) => item.range), ['0–255'])
  }
  const eighthChannel = (model, modeIndex, name) => getDmxChannelProfile(model).modes[modeIndex].channels.find((channel) => channel.name === name)
  const eighthRanges = (model, modeIndex, name) => eighthChannel(model, modeIndex, name).ranges.map((item) => item.range)
  const movingStrobeRanges = ['0–10', '11–21', '22–62', '63–73', '74–114', '115–125', '126–166', '167–177', '178–218', '219–255']
  for (const model of ['TL-SL101', 'TL-SL101C', 'TL-SL112', 'TL-SL157', 'TL-SL162', 'TL-SL171', 'TL-SL172']) {
    assert.deepStrictEqual(eighthRanges(model, 0, '频闪'), movingStrobeRanges, `${model} 频闪范围不一致`)
  }

  const prismRotateRanges = ['0–127', '128–189', '190–193', '194–255']
  const fogRanges = ['0–10', '11–255']
  for (const model of ['TL-SL101', 'TL-SL101C', 'TL-SL171', 'TL-SL172']) {
    assert.deepStrictEqual(eighthRanges(model, 0, '棱镜1旋转'), prismRotateRanges, `${model} 棱镜1旋转范围不一致`)
    assert.deepStrictEqual(eighthRanges(model, 0, '棱镜2旋转'), prismRotateRanges, `${model} 棱镜2旋转范围不一致`)
    assert.deepStrictEqual(eighthRanges(model, 0, '雾化'), fogRanges, `${model} 雾化范围不一致`)
    assert.deepStrictEqual(eighthRanges(model, 0, '棱镜1/2'), ['0–10', '11–127', '128–191', '192–255'], `${model} 棱镜范围不一致`)
  }

  assert.deepStrictEqual(eighthRanges('TL-SL101', 0, '色盘').slice(-5), ['162–163', '164–202', '203–204', '205–244', '245–255'])
  assert.strictEqual(eighthRanges('TL-SL101', 0, '色盘').length, 35, 'TL-SL101 色盘区间数量不一致')
  assert.deepStrictEqual(eighthRanges('TL-SL101', 0, '固定盘').slice(-6), ['163–166', '167–171', '172–205', '206–207', '208–244', '245–255'])
  assert.strictEqual(eighthRanges('TL-SL101', 0, '固定盘').length, 37, 'TL-SL101 固定盘区间数量不一致')

  assert.strictEqual(eighthRanges('TL-SL112', 0, '色盘').length, 33, 'TL-SL112 色盘区间数量不一致')
  assert.strictEqual(eighthRanges('TL-SL112', 0, '固定盘').length, 37, 'TL-SL112 固定盘区间数量不一致')
  assert.strictEqual(eighthRanges('TL-SL112', 0, '旋转盘').length, 23, 'TL-SL112 旋转盘区间数量不一致')
  assert.deepStrictEqual(eighthRanges('TL-SL112', 0, '旋转盘旋转'), prismRotateRanges)
  assert.deepStrictEqual(eighthRanges('TL-SL112', 0, '效果盘'), ['0–10', '11–85', '86–95', '96–170', '171–180', '181–255'])
  assert.deepStrictEqual(eighthRanges('TL-SL112', 0, '棱镜1/2'), ['0–10', '11–127', '128–255'])
  assert.deepStrictEqual(eighthRanges('TL-SL112', 0, '棱镜3/4'), ['0–10', '11–127', '128–255'])
  assert.deepStrictEqual(eighthRanges('TL-SL112', 0, '雾化'), fogRanges)

  assert.deepStrictEqual(eighthChannel('TL-SL156', 0, '频闪').ranges, [{ range: '0–5', description: '空' }, { range: '6–255', description: '频闪，由慢到快' }])
  assert.deepStrictEqual(eighthRanges('TL-SL156', 0, '内置程序'), ['0–49', '50–99', '100–149', '150–199', '200–255'])
  assert.deepStrictEqual(eighthRanges('TL-SL156', 0, '颜色变化'), ['0–5', '6–127', '128–191', '192–255'])
  assert.deepStrictEqual(eighthRanges('TL-SL156', 0, '颜色宏'), ['0–9', '10–63', '64–255'])
  assert.deepStrictEqual(eighthRanges('TL-SL156', 0, '复位'), ['0–249', '250–255'])

  assert.strictEqual(eighthRanges('TL-SL157', 0, '流水效果').length, 23, 'TL-SL157 流水效果区间数量不一致')
  assert.deepStrictEqual(eighthRanges('TL-SL157', 0, '流水效果').slice(-3), ['201–210', '211–220', '221–255'])
  const noLampMacroRanges = ['0–10', '11–21', '22–27', '28–33', '34–42', '43–48', '49–54', '55–60', '61–66', '67–72', '73–78', '79–84', '85–105', '106–111', '112–117', '118–123', '124–129', '130–135', '136–145', '146–151', '152–157', '158–163', '164–184', '185–190', '191–199', '200–210', '211–255']
  assert.deepStrictEqual(eighthRanges('TL-SL157', 0, '宏功能'), noLampMacroRanges)

  assert.strictEqual(eighthRanges('TL-SL162', 0, '色盘').length, 23, 'TL-SL162 色盘区间数量不一致')
  assert.strictEqual(eighthRanges('TL-SL162', 0, '固定盘').length, 27, 'TL-SL162 固定盘区间数量不一致')
  assert.strictEqual(eighthRanges('TL-SL162', 0, '旋转盘').length, 19, 'TL-SL162 旋转盘区间数量不一致')
  assert.deepStrictEqual(eighthRanges('TL-SL162', 0, '棱镜'), ['0–10', '11–255'])
  assert.deepStrictEqual(eighthRanges('TL-SL162', 0, '棱镜1旋转'), prismRotateRanges)
  assert.deepStrictEqual(eighthRanges('TL-SL162', 0, '雾化'), fogRanges)
  assert.deepStrictEqual(eighthRanges('TL-SL162', 0, '宏功能'), noLampMacroRanges)

  assert.strictEqual(eighthRanges('TL-SL171', 0, '色盘').length, 29, 'TL-SL171 色盘区间数量不一致')
  assert.strictEqual(eighthRanges('TL-SL171', 0, '固定盘').length, 33, 'TL-SL171 固定盘区间数量不一致')
  assert.deepStrictEqual(eighthRanges('TL-SL171', 0, '色盘').slice(-4), ['164–202', '203–204', '205–244', '245–255'])
  assert.deepStrictEqual(eighthRanges('TL-SL172', 0, '色盘').slice(-4), ['164–202', '203–204', '205–244', '245–255'])
  assert.match(eighthChannel('TL-SL171', 0, '色盘').ranges.at(-4).description, /顺时针/)
  assert.match(eighthChannel('TL-SL172', 0, '色盘').ranges.at(-4).description, /逆时针/)
  assert.deepStrictEqual(eighthRanges('TL-SL171', 0, '宏功能'), noLampMacroRanges)
  assert.deepStrictEqual(eighthRanges('TL-SL172', 0, '宏功能'), noLampMacroRanges)

  const ninthBatchChannelNames = {
    'TL-SM3101': [[
      '色盘', '频闪', '调光', '图盘', '棱镜1', '棱镜2', '棱镜自转', '雾化/效果', '调焦',
      'X轴', 'X轴微调', 'Y轴', 'Y轴微调', 'XY速度', '效果', '灯圈', '灯圈速度', '复位/功能',
    ]],
    'TL-SM3102': [[
      '颜色盘', '频闪', '调光', '图案盘', '棱镜1', '棱镜1旋转', '棱镜2', '棱镜2旋转',
      '调焦', 'X轴', 'X轴微调', 'Y轴', 'Y轴微调', 'XY速度', '雾化&七彩镜', '复位',
    ]],
    'TL-SM3502': [[
      'X轴', 'X轴微调', 'Y轴', 'Y轴微调', 'XY速度', '调光', '频闪', '色盘', 'CTO', 'C', 'Y', 'M',
      '固定图案盘', '变焦', '调焦', '旋转图案盘', '图案旋转', '棱镜1', '棱镜1旋转',
      '棱镜2', '棱镜2旋转', '雾化', '复位',
    ]],
    'TL-SM3503': [
      ['X轴', 'Y轴', 'XY速度', '调光', '频闪', '色盘', '图案盘', '棱镜1/2', '棱镜旋转', '雾化', '调焦', '宏功能'],
      ['X轴', 'X轴微调', 'Y轴', 'Y轴微调', 'XY速度', '调光', '频闪', '色盘', '图案盘', '棱镜1/2', '棱镜旋转', '雾化', '调焦', '宏功能'],
    ],
    'TL-SM3505': [
      ['X轴', 'Y轴', 'XY速度', '调光', '频闪', '色盘', '图案盘', '棱镜1/2', '棱镜旋转', '雾化&彩镜', '调焦', '宏功能'],
      ['X轴', 'X轴微调', 'Y轴', 'Y轴微调', 'XY速度', '调光', '频闪', '色盘', '图案盘', '棱镜1/2', '棱镜旋转', '雾化&彩镜', '调焦', '宏功能'],
    ],
    'TL-SV3301': [
      ['水平运转', '水平微调', '垂直运转', '垂直微调', 'XY速度', '总调光', '图案灯珠调光', '染色红色', '染色绿色', '染色蓝色', '空', '频闪', '色盘', '图案盘', '效果', '自走速度', '复位'],
      ['水平运转', '垂直运转', 'XY速度', '染色调光', '染色频闪', '染色红色', '染色绿色', '染色蓝色', '空', '图案灯珠调光', '图案频闪', '色盘', '图案盘', '复位/声控'],
      ['水平运转', '垂直运转', 'XY速度', '总调光', '频闪', '图案灯珠调光', '染色红色', '染色绿色', '染色蓝色', '空', '色盘', '图案盘', '复位'],
    ],
  }
  Object.entries(ninthBatchChannelNames).forEach(([model, modes]) => {
    const actualModes = getDmxChannelProfile(model).modes
    assert.deepStrictEqual(actualModes.map((item) => item.channels.map((channel) => channel.name)), modes, `${model} 通道顺序不一致`)
    actualModes.forEach((item) => item.channels.forEach((channel) => assert(!/^CH\d+$/.test(channel.name), `${model} 存在占位通道名 ${channel.name}`)))
  })

  assert.deepStrictEqual(eighthRanges('TL-SM3101', 0, '色盘').slice(-4), ['140–144', '145–149', '150–202', '203–255'])
  assert.deepStrictEqual(eighthRanges('TL-SM3101', 0, '频闪'), ['0–3', '4–128', '129–199', '200–249', '250–255'])
  assert.deepStrictEqual(eighthRanges('TL-SM3101', 0, '棱镜自转'), ['0–127', '128–190', '191–192', '193–255'])
  assert.deepStrictEqual(eighthRanges('TL-SM3101', 0, '雾化/效果'), ['0–127', '128–191', '192–255'])
  assert.deepStrictEqual(eighthRanges('TL-SM3101', 0, '复位/功能'), ['0–25', '26–76', '77–127', '128–255'])

  assert.deepStrictEqual(eighthRanges('TL-SM3102', 0, '颜色盘').slice(-4), ['120–124', '125–129', '130–200', '201–255'])
  assert.deepStrictEqual(eighthRanges('TL-SM3102', 0, '频闪'), ['0–3', '4–103', '104–107', '108–207', '208–212', '213–251', '252–255'])
  assert.deepStrictEqual(eighthRanges('TL-SM3102', 0, '图案盘').slice(-5), ['145–149', '150–154', '155–159', '160–200', '201–255'])
  assert.deepStrictEqual(eighthRanges('TL-SM3102', 0, '雾化&七彩镜'), ['0–127', '128–191', '192–255'])
  assert.deepStrictEqual(eighthRanges('TL-SM3102', 0, '复位'), ['0–25', '26–50', '51–60', '61–85', '86–250', '251–255'])

  assert.deepStrictEqual(eighthRanges('TL-SM3502', 0, '频闪'), ['0–3', '4–103', '104–107', '108–207', '208–212', '213–251', '252–255'])
  assert.deepStrictEqual(eighthRanges('TL-SM3502', 0, '色盘').slice(-3), ['180–215', '216–220', '221–255'])
  assert.deepStrictEqual(eighthRanges('TL-SM3502', 0, '固定图案盘').slice(-4), ['120–127', '128–190', '191–192', '193–255'])
  assert.deepStrictEqual(eighthRanges('TL-SM3502', 0, '图案旋转'), ['0–127', '128–187', '188–195', '196–255'])
  assert.deepStrictEqual(eighthRanges('TL-SM3502', 0, '复位'), ['0–0', '1–209', '210–215', '216–219', '220–235', '236–239', '240–255'])

  const sm350xStrobeRanges = ['0–10', '11–21', '22–62', '63–73', '74–114', '115–125', '126–166', '167–177', '178–218', '219–255']
  for (const model of ['TL-SM3503', 'TL-SM3505']) {
    assert.deepStrictEqual(eighthRanges(model, 0, '频闪'), sm350xStrobeRanges)
    assert.deepStrictEqual(eighthRanges(model, 0, '棱镜1/2'), ['0–10', '11–127', '128–191', '192–255'])
    assert.deepStrictEqual(eighthRanges(model, 0, '棱镜旋转'), ['0–127', '128–189', '190–193', '194–255'])
    assert(!getDmxChannelProfile(model).modes.some((item) => item.channels.some((channel) => channel.name === '变焦')), `${model} 不应包含变焦通道`)
    assert.strictEqual(getDmxChannelProfile(model).modes[0].channels.at(-1).name, '宏功能')
  }
  assert.deepStrictEqual(eighthRanges('TL-SM3503', 0, '色盘').slice(-5), ['162–163', '164–202', '203–204', '205–244', '245–255'])
  assert.deepStrictEqual(eighthRanges('TL-SM3505', 0, '色盘').slice(-5), ['162–163', '164–202', '203–204', '205–244', '245–255'])
  assert.deepStrictEqual(eighthRanges('TL-SM3503', 0, '图案盘').slice(0, 3), ['0–10', '11–15', '16–21'])
  assert.deepStrictEqual(eighthRanges('TL-SM3505', 0, '图案盘').slice(0, 3), ['0–10', '11–16', '17–21'])
  assert.deepStrictEqual(eighthRanges('TL-SM3503', 0, '雾化'), ['0–10', '11–255'])
  assert.deepStrictEqual(eighthRanges('TL-SM3505', 0, '雾化&彩镜'), ['0–10', '11–127', '128–255'])
  assert.notDeepStrictEqual(getDmxChannelProfile('TL-SM3503').modes, getDmxChannelProfile('TL-SM3505').modes)

  const sv3301StrobeRanges = ['0–15', '16–132', '133–140', '141–180', '181–194', '195–230', '231–239', '240–247', '248–255']
  const sv3301Strobe14Ranges = ['0–15', '16–131', '132–139', '140–181', '182–189', '190–231', '232–239', '240–247', '248–255']
  assert.deepStrictEqual(eighthRanges('TL-SV3301', 0, '频闪'), sv3301StrobeRanges)
  assert.deepStrictEqual(eighthRanges('TL-SV3301', 1, '染色频闪'), sv3301Strobe14Ranges)
  assert.deepStrictEqual(eighthRanges('TL-SV3301', 1, '图案频闪'), sv3301Strobe14Ranges)
  assert.deepStrictEqual(eighthRanges('TL-SV3301', 2, '频闪'), sv3301StrobeRanges)
  assert.deepStrictEqual(eighthRanges('TL-SV3301', 0, '复位'), ['0–199', '200–209', '210–255'])
  assert.deepStrictEqual(eighthRanges('TL-SV3301', 1, '复位/声控'), ['0–199', '200–209', '210–249', '250–255'])
  assert.deepStrictEqual(eighthRanges('TL-SV3301', 2, '复位'), ['0–199', '200–209', '210–255'])

  const tenthBatchChannelNames = {
    'TL-SV3103': [
      ['水平运转', '垂直运转', '水平垂直运转速度', '总调光', '频闪', '图案灯珠调光', '染色红色', '染色绿色', '染色蓝色', '空', '颜色盘', '图案盘', '棱镜', '复位/声控'],
      ['水平运转', '垂直运转', '水平垂直运转速度', '染色调光', '染色频闪', '染色红色', '染色绿色', '染色蓝色', '空', '图案灯珠调光', '图案频闪', '颜色盘', '图案盘', '棱镜', '棱镜旋转', '复位/声控'],
      ['水平运转', '水平微调', '垂直运转', '垂直微调', '水平垂直运转速度', '总调光', '图案灯珠调光', '染色红色', '染色绿色', '染色蓝色', '空', '频闪', '颜色盘', '图案盘', '棱镜', '效果', '效果速度', '复位/声控'],
    ],
    'TL-SV3104': [
      ['X轴', 'Y轴', 'XY速度', '颜色盘', '图案盘', '染色灯珠总调光', '染色红色', '染色绿色', '染色蓝色', '染色白色', '图案灯珠调光', '频闪', '染色色温', '调光曲线', '颜色效果', '宏功能', '速度/声控灵敏度', '棱镜', '棱镜自转速度', '复位'],
      ['X轴', 'Y轴', 'XY速度', '颜色盘', '图案盘', '染色灯珠总调光', '染色红色', '染色绿色', '染色蓝色', '染色白色', '图案灯珠调光', '频闪', '染色色温', '颜色效果', '宏功能', '速度/声控灵敏度', '棱镜', '棱镜自转速度', 'X轴微调', 'Y轴微调', '复位'],
    ],
    'TL-SV3303': [
      ['水平运转', '垂直运转', '水平垂直运转速度', '总调光', '频闪', '图案灯珠调光', '染色红色', '染色绿色', '染色蓝色', '染色白色', '颜色盘', '图案盘', '棱镜', '复位/声控'],
      ['水平运转', '垂直运转', '水平垂直运转速度', '染色调光', '染色频闪', '染色红色', '染色绿色', '染色蓝色', '染色白色', '图案灯珠调光', '图案频闪', '颜色盘', '图案盘', '棱镜', '棱镜旋转', '复位/声控'],
      ['水平运转', '水平微调', '垂直运转', '垂直微调', '水平垂直运转速度', '总调光', '图案灯珠调光', '染色红色', '染色绿色', '染色蓝色', '染色白色', '频闪', '颜色盘', '图案盘', '棱镜', '效果', '效果速度', '复位/声控'],
    ],
    'TL-SV3304': [
      ['X轴', 'Y轴', 'XY速度', '总调光', '红色', '绿色', '蓝色', '白色', '频闪', '保留', '颜色', '调焦', '旋转', '旋转速度', '宏功能', '速度和灵敏度', '复位'],
      ['X轴', 'Y轴', 'XY速度', '总调光', '红色', '绿色', '蓝色', '白色', '频闪', '颜色', '调焦', '旋转', '旋转速度', '宏功能', '速度和灵敏度', 'X轴微调', 'Y轴微调', '复位'],
    ],
    'TL-SV6102': [
      ['水平运转', '垂直运转', '水平垂直运转速度', '总调光', '频闪', '图案灯珠调光', '染色红色', '染色绿色', '染色蓝色', '染色白色', '颜色盘', '图案盘', '复位/声控'],
      ['水平运转', '水平微调', '垂直运转', '垂直微调', '水平垂直运转速度', '总调光', '图案灯珠调光', '染色红色', '染色绿色', '染色蓝色', '染色白色', '频闪', '颜色盘', '图案盘', '自走', '自走速度', '复位'],
    ],
  }
  Object.entries(tenthBatchChannelNames).forEach(([model, modes]) => {
    const actualModes = getDmxChannelProfile(model).modes
    assert.deepStrictEqual(actualModes.map((item) => item.channels.map((channel) => channel.name)), modes, `${model} 通道顺序不一致`)
    actualModes.forEach((item) => item.channels.forEach((channel) => assert(!/^CH\d+$/.test(channel.name), `${model} 存在占位通道名 ${channel.name}`)))
  })

  const svSimpleStrobeRanges = ['0–15', '16–132', '133–239', '240–247', '248–255']
  const svSoundResetRanges = ['0–199', '200–209', '210–249', '250–255']
  for (const model of ['TL-SV3103', 'TL-SV3303']) {
    assert.deepStrictEqual(eighthRanges(model, 0, '频闪'), svSimpleStrobeRanges)
    assert.deepStrictEqual(eighthRanges(model, 1, '染色频闪'), sv3301Strobe14Ranges)
    assert.deepStrictEqual(eighthRanges(model, 1, '图案频闪'), sv3301Strobe14Ranges)
    assert.deepStrictEqual(eighthRanges(model, 2, '频闪'), svSimpleStrobeRanges)
    assert.deepStrictEqual(eighthRanges(model, 0, '棱镜'), ['0–15', '16–127', '128–255'])
    assert.deepStrictEqual(eighthRanges(model, 1, '棱镜'), ['0–127', '128–255'])
    assert.deepStrictEqual(eighthRanges(model, 1, '棱镜旋转'), ['0–0', '1–255'])
    assert.deepStrictEqual(eighthRanges(model, 2, '棱镜'), ['0–15', '16–127', '128–255'])
    assert.deepStrictEqual(eighthRanges(model, 0, '复位/声控'), svSoundResetRanges)
    assert.deepStrictEqual(eighthRanges(model, 1, '复位/声控'), svSoundResetRanges)
    assert.deepStrictEqual(eighthRanges(model, 2, '复位/声控'), svSoundResetRanges)
    assert.strictEqual(eighthChannel(model, 1, '复位/声控').ranges[2].description, '说明书未标注')
  }
  assert.strictEqual(getDmxChannelProfile('TL-SV3103').modes[0].channels[9].name, '空')
  assert.strictEqual(getDmxChannelProfile('TL-SV3303').modes[0].channels[9].name, '染色白色')

  assert.deepStrictEqual(eighthRanges('TL-SV3104', 0, '频闪'), ['0–7', '8–63', '64–127', '128–191', '192–255'])
  assert.deepStrictEqual(eighthRanges('TL-SV3104', 1, '频闪'), ['0–7', '8–255'])
  assert.deepStrictEqual(eighthRanges('TL-SV3104', 0, '颜色盘'), ['0–9', '10–19', '20–29', '30–39', '40–49', '50–59', '60–69', '70–79', '80–89', '90–255'])
  assert.deepStrictEqual(eighthRanges('TL-SV3104', 0, '图案盘').slice(-2), ['100–109', '110–255'])
  assert.deepStrictEqual(eighthRanges('TL-SV3104', 0, '棱镜'), ['0–31', '32–249', '250–255'])
  assert.deepStrictEqual(eighthRanges('TL-SV3104', 0, '复位'), ['0–200', '201–240', '241–255'])
  assert(eighthChannel('TL-SV3104', 0, '调光曲线'))
  assert(!eighthChannel('TL-SV3104', 1, '调光曲线'))
  assert(eighthChannel('TL-SV3104', 1, 'X轴微调'))
  assert(eighthChannel('TL-SV3104', 1, 'Y轴微调'))

  for (const modeIndex of [0, 1]) {
    assert.deepStrictEqual(eighthRanges('TL-SV3304', modeIndex, '频闪'), ['0–7', '8–63', '64–127', '128–191', '192–255'])
    assert.deepStrictEqual(eighthRanges('TL-SV3304', modeIndex, '颜色'), ['0–19', '20–219', '220–235', '236–255'])
    assert.deepStrictEqual(eighthRanges('TL-SV3304', modeIndex, '旋转'), ['0–239', '240–244', '245–255'])
    assert.deepStrictEqual(eighthRanges('TL-SV3304', modeIndex, '复位'), ['0–200', '201–240', '241–255'])
  }
  assert.deepStrictEqual(eighthChannel('TL-SV3304', 0, '保留').ranges, [{ range: '0–255', description: '无功能' }])

  for (const modeIndex of [0, 1]) {
    assert.deepStrictEqual(eighthRanges('TL-SV6102', modeIndex, '频闪'), sv3301Strobe14Ranges)
    assert.deepStrictEqual(eighthRanges('TL-SV6102', modeIndex, '颜色盘'), ['0–79', '80–162', '163–255'])
    assert.deepStrictEqual(eighthRanges('TL-SV6102', modeIndex, '图案盘'), ['0–39', '40–79', '80–162', '163–255'])
  }
  assert.deepStrictEqual(eighthRanges('TL-SV6102', 0, '复位/声控'), svSoundResetRanges)
  assert.deepStrictEqual(eighthRanges('TL-SV6102', 1, '自走'), ['0–15', '16–255'])
  assert.deepStrictEqual(eighthRanges('TL-SV6102', 1, '复位'), ['0–199', '200–209', '210–255'])
  assert(!eighthChannel('TL-SV6102', 1, '复位').ranges.some((item) => /声控/.test(item.description)))

  const eleventhBatchChannelNames = {
    'TL-SL105': [
      ['X轴', 'Y轴', '调光', '频闪', '色盘', '固定盘', '棱镜1', '棱镜1旋转', '棱镜2/3', '棱镜2/3旋转', '雾化', '调焦', '宏功能'],
      ['X轴', 'X轴微调', 'Y轴', 'Y轴微调', 'XY轴速度', '调光', '频闪', '色盘', '固定盘', '棱镜1', '棱镜1旋转', '棱镜2/3', '棱镜2/3旋转', '雾化', '调焦', '宏功能'],
    ],
    'TL-SL182': [
      ['X轴', 'X轴微调', 'Y轴', 'Y轴微调', 'XY轴速度', '调光', '频闪', '色盘', '固定盘', '旋转图案', '旋转图案自转', '棱镜', '棱镜旋转', '雾化', '调焦', '变焦', '宏功能'],
      ['X轴', 'Y轴', 'XY轴速度', '调光', '频闪', '色盘', '固定盘', '旋转图案', '旋转图案自转', '棱镜', '棱镜旋转', '雾化', '调焦', '变焦', '宏功能'],
    ],
    'TL-SL184': [
      ['X轴', 'X轴微调', 'Y轴', 'Y轴微调', 'XY轴速度', '调光', '频闪', '色盘', '固定盘', '旋转图案', '旋转图案自转', '棱镜', '棱镜旋转', '雾化', '调焦', '变焦', '宏功能'],
      ['X轴', 'Y轴', 'XY轴速度', '调光', '频闪', '色盘', '固定盘', '旋转图案', '旋转图案自转', '棱镜', '棱镜旋转', '雾化', '调焦', '变焦', '宏功能'],
    ],
    'TL-SL185': [
      ['X轴', 'X轴微调', 'Y轴', 'Y轴微调', 'XY轴速度', '调光', '频闪', '色盘', '色温', '青色', '品红', '黄色', '固定盘', '旋转图案', '旋转图案自转', '效果盘', '效果盘旋转', '棱镜', '棱镜旋转', '雾化', '调焦', '调焦微调', '变焦', '变焦微调', '宏功能'],
      ['X轴', 'Y轴', 'XY轴速度', '调光', '频闪', '色盘', '色温', '青色', '品红', '黄色', '固定盘', '旋转图案', '旋转图案自转', '效果盘', '效果盘旋转', '棱镜', '棱镜旋转', '雾化', '调焦', '变焦', '宏功能'],
    ],
    'TL-SL186': [
      ['X轴', 'Y轴', 'XY轴速度', '调光', '频闪', '色盘', '色温', '青色', '品红', '黄色', 'CMY宏', '固定盘', '旋转图案', '旋转图案自转', '效果盘', '棱镜', '棱镜旋转', '雾化', '调焦', '变焦', '宏功能'],
      ['X轴', 'X轴微调', 'Y轴', 'Y轴微调', 'XY轴速度', '调光', '频闪', '色盘', '色温', '青色', '品红', '黄色', 'CMY宏', '固定盘', '旋转图案', '旋转图案自转', '效果盘', '棱镜', '棱镜旋转', '雾化', '调焦', '调焦微调', '变焦', '变焦微调', '宏功能'],
    ],
  }
  Object.entries(eleventhBatchChannelNames).forEach(([model, modes]) => {
    const actualModes = getDmxChannelProfile(model).modes
    assert.deepStrictEqual(actualModes.map((item) => item.channels.map((channel) => channel.name)), modes, `${model} 通道顺序不一致`)
    actualModes.forEach((item) => item.channels.forEach((channel) => assert(!/^CH\d+$/.test(channel.name), `${model} 存在占位通道名 ${channel.name}`)))
  })
  assert.deepStrictEqual(eighthRanges('TL-SL105', 0, '频闪'), movingStrobeRanges)
  assert.deepStrictEqual(eighthRanges('TL-SL105', 0, '色盘').slice(0, 6), ['0–10', '11–15', '16–20', '21–25', '26–30', '31–36'])
  assert.deepStrictEqual(eighthRanges('TL-SL105', 1, '固定盘').slice(-5), ['168–171', '172–205', '206–207', '208–244', '245–255'])
  assert.strictEqual(eighthChannel('TL-SL105', 0, '宏功能').ranges[6].description, '反曲线')
  assert.strictEqual(eighthChannel('TL-SL105', 1, '宏功能').ranges[6].description, '反曲线')
  assert.deepStrictEqual(eighthRanges('TL-SL182', 0, '色盘').slice(0, 5), ['0–10', '11–20', '21–30', '31–40', '41–50'])
  assert.deepStrictEqual(eighthRanges('TL-SL182', 0, '宏功能'), noLampMacroRanges)
  assert.strictEqual(eighthChannel('TL-SL182', 0, '宏功能').ranges[1].description, '无功能')
  assert.strictEqual(eighthChannel('TL-SL182', 0, '宏功能').ranges[6].description, '反平方曲线')
  assert.strictEqual(eighthChannel('TL-SL182', 0, '宏功能').ranges.at(-2).description, '无功能')
  assert.strictEqual(eighthChannel('TL-SL184', 0, '宏功能').ranges[1].description, '灯泡开')
  assert.strictEqual(eighthChannel('TL-SL184', 0, '宏功能').ranges[6].description, '反平方曲线')
  assert.strictEqual(eighthChannel('TL-SL184', 0, '宏功能').ranges.at(-2).description, '灯泡关')
  assert.notDeepStrictEqual(getDmxChannelProfile('TL-SL182').modes, getDmxChannelProfile('TL-SL184').modes)
  assert.deepStrictEqual(eighthRanges('TL-SL185', 0, '色盘').slice(0, 5), ['0–10', '11–17', '18–23', '24–30', '31–36'])
  assert.deepStrictEqual(eighthRanges('TL-SL185', 0, '效果盘'), ['0–10', '11–255'])
  assert(eighthChannel('TL-SL185', 0, '色温'))
  assert(!eighthChannel('TL-SL185', 0, 'CMY宏'))
  assert.deepStrictEqual(eighthRanges('TL-SL186', 0, '色盘').slice(0, 5), ['0–10', '11–22', '23–33', '34–45', '46–56'])
  assert.deepStrictEqual(eighthRanges('TL-SL186', 0, 'CMY宏'), ['0–10', '11–24', '25–38', '39–52', '53–66', '67–80', '81–94', '95–108', '109–122', '123–136', '137–150', '151–164', '165–178', '179–192', '193–206', '207–220', '221–255'])
  assert.deepStrictEqual(eighthRanges('TL-SL186', 0, '效果盘'), ['0–10', '11–85', '86–95', '96–170', '171–180', '181–255'])
  assert.notDeepStrictEqual(getDmxChannelProfile('TL-SL185').modes, getDmxChannelProfile('TL-SL186').modes)

  const twelfthBatchChannelNames = {
    'TL-SL155': [
      ['X轴', 'X轴微调', 'Y轴', 'Y轴微调', 'XY速度', '总调光', '频闪', 'R调光', 'G调光', 'B调光', 'W调光', '调焦', '灯光效果展示', '灯光效果速度', '宏功能', '复位'],
      ['X轴', 'X轴微调', 'Y轴', 'Y轴微调', 'XY速度', '调焦', '总调光', '频闪', 'R1调光', 'G1调光', 'B1调光', 'W1调光', 'R2调光', 'G2调光', 'B2调光', 'W2调光', 'R3调光', 'G3调光', 'B3调光', 'W3调光', '灯光效果展示', '灯光效果速度', '宏功能', '复位'],
    ],
    'TL-SW03': [
      ['总调', '总调微调', '频闪', '辅光总调', '红色', '绿色', '蓝色', '白色', '色温控制', '颜色宏和自走模式', '自走速度', '辅光红色', '辅光绿色', '辅光蓝色', '辅光自走效果', '辅光自走速度', '参数设置'],
      ['总调', '频闪', '红色', '绿色', '蓝色', '白色', '色温控制', '辅光红色', '辅光绿色', '辅光蓝色', '辅光自走效果', '辅光自走速度'],
      ['红色', '绿色', '蓝色', '白色', '色温控制', '辅光红色', '辅光绿色', '辅光蓝色', '辅光自走效果', '辅光自走速度'],
      ['红色', '绿色', '蓝色', '白色', '辅光自走效果', '辅光自走速度'],
    ],
    'TL-SM3801': [
      ['X轴', 'Y轴', 'XY轴速度', '调光', '频闪', '色盘', '固定盘', '棱镜1/2', '棱镜1旋转', '棱镜2旋转', '雾化', '调焦', '宏功能'],
      ['X轴', 'X轴微调', 'Y轴', 'Y轴微调', 'XY轴速度', '调光', '频闪', '色盘', '固定盘', '棱镜1/2', '棱镜1旋转', '棱镜2旋转', '雾化', '调焦', '宏功能'],
    ],
    'TL-SM3402': [
      ['X轴', 'Y轴', 'XY轴速度', '调光', '频闪', '黄色&色温', '品红&色盘', '青色&旋转图案', '旋转图案自转', '调焦', '变焦', '切割宏', '宏功能'],
      ['X轴', 'X轴微调', 'Y轴', 'Y轴微调', 'XY轴速度', '调光', '频闪', '黄色&色温', '品红&色盘', '青色&旋转图案', '旋转图案自转', '调焦', '调焦微调', '变焦', '变焦微调', '切割1', '切割2', '切割3', '切割4', '切割5', '切割6', '切割7', '切割8', '切割宏', '宏功能'],
    ],
    'TL-SM6602': [
      ['X轴', 'X轴微调', 'Y轴', 'Y轴微调', 'XY轴速度', '调光', '频闪', '色盘', '固定盘', '旋转盘', '旋转盘旋转', '棱镜1/2', '棱镜1旋转', '棱镜2旋转', '雾化', '调焦', '调焦微调', '变焦', '变焦微调', '宏功能'],
      ['X轴', 'Y轴', 'XY轴速度', '调光', '频闪', '色盘', '固定盘', '旋转盘', '旋转盘旋转', '棱镜1/2', '棱镜1旋转', '棱镜2旋转', '雾化', '调焦', '变焦', '宏功能'],
    ],
  }
  Object.entries(twelfthBatchChannelNames).forEach(([model, modes]) => {
    const actualModes = getDmxChannelProfile(model).modes
    assert.deepStrictEqual(actualModes.map((item) => item.channels.map((channel) => channel.name)), modes, `${model} 通道顺序不一致`)
    actualModes.forEach((item) => item.channels.forEach((channel) => assert(!/^CH\d+$/.test(channel.name), `${model} 存在占位通道名 ${channel.name}`)))
  })
  assert.deepStrictEqual(eighthRanges('TL-SL155', 0, '频闪'), ['0–3', '4–95', '96–176', '177–255'])
  assert.deepStrictEqual(eighthRanges('TL-SL155', 1, '灯光效果展示'), ['0–24', '25–49', '50–74', '75–99', '100–124', '125–149', '150–174', '175–199', '200–224', '225–255'])
  assert.deepStrictEqual(eighthRanges('TL-SL155', 0, '宏功能'), ['0–49', '50–99', '100–149', '150–199', '200–255'])
  assert.deepStrictEqual(eighthRanges('TL-SL155', 1, '复位'), ['0–250', '251–255'])
  assert.deepStrictEqual(eighthRanges('TL-SW03', 0, '参数设置'), ['0–42', '43–48', '49–54', '55–60', '61–66', '67–72', '73–78', '79–84', '85–135', '136–145', '146–151', '152–255'])
  assert.deepStrictEqual(eighthRanges('TL-SW03', 0, '辅光自走效果').slice(-3), ['210–224', '225–239', '240–255'])
  assert.deepStrictEqual(eighthRanges('TL-SW03', 0, '颜色宏和自走模式').slice(-5), ['188–201', '202–215', '216–225', '226–235', '236–255'])
  assert.deepStrictEqual(eighthRanges('TL-SW03', 1, '辅光自走效果'), eighthRanges('TL-SW03', 0, '辅光自走效果'))
  assert.deepStrictEqual(eighthRanges('TL-SM3801', 0, '色盘').slice(0, 5), ['0–10', '11–16', '17–22', '23–28', '29–34'])
  assert.strictEqual(eighthRanges('TL-SM3801', 0, '色盘').length, 31)
  assert.deepStrictEqual(eighthRanges('TL-SM3801', 0, '固定盘').slice(0, 5), ['0–10', '11–13', '14–16', '17–20', '21–23'])
  assert.deepStrictEqual(eighthRanges('TL-SM3801', 0, '棱镜1/2'), ['0–10', '11–127', '128–191', '192–255'])
  assert.strictEqual(eighthChannel('TL-SM3801', 0, '宏功能').ranges[9].description, '风机常规模式')
  assert.strictEqual(eighthChannel('TL-SM3801', 0, '宏功能').ranges[10].description, '风机低速模式')
  assert.deepStrictEqual(eighthRanges('TL-SM3402', 0, '黄色&色温').slice(0, 5), ['0–10', '11–30', '31–40', '41–161', '162–163'])
  assert.deepStrictEqual(eighthRanges('TL-SM3402', 1, '切割宏').slice(0, 4), ['0–10', '11–15', '16–21', '22–27'])
  assert.deepStrictEqual(eighthRanges('TL-SM3402', 1, '切割宏').slice(-3), ['214–219', '220–225', '226–255'])
  assert.deepStrictEqual(eighthRanges('TL-SM6602', 0, '棱镜1/2'), ['0–10', '11–127', '128–255'])
  assert.deepStrictEqual(eighthRanges('TL-SM6602', 0, '宏功能').slice(0, 3), ['0–10', '11–21', '22–27'])
  assert.strictEqual(eighthChannel('TL-SM6602', 0, '宏功能').ranges[1].description, '灯泡开')
  assert.strictEqual(eighthChannel('TL-SM6602', 0, '宏功能').ranges.at(-2).description, '灯泡关')
  assert.strictEqual(eighthChannel('TL-SM6602', 0, '宏功能').ranges[9].description, '无功能')
  assert.notDeepStrictEqual(getDmxChannelProfile('TL-SM6602').modes, getDmxChannelProfile('TL-SL155').modes)

  const thirteenthBatchChannelNames = {
    'TL-SM3502IP': [
      ['X轴', 'Y轴', 'X轴微调', 'Y轴微调', 'XY速度', '雾化', '频闪', '调光', '色盘', '图盘', '棱镜1', '棱镜自转', '棱镜2', '棱镜2自转', '调焦', '复位/功能'],
      ['X轴', 'Y轴', 'XY速度', '模式', '空', '雾化', '频闪', '调光', '色盘', '图盘', '棱镜1', '棱镜自转', '棱镜2', '棱镜2自转', '调焦', '复位/功能', 'X轴微调', 'Y轴微调'],
    ],
    'TL-SM9051': [
      ['X轴', 'Y轴', '总调光', '频闪', '色盘1', '色盘2', '青色', '品红色', '黄色', '色温', 'CMY颜色宏', '光圈', '光圈宏功能', '雾化1/雾化2', '放大', '调焦', '切割1', '切割2', '切割3', '切割4', '切割5', '切割6', '切割7', '切割8', '切割宏', '切割旋转', '宏功能'],
      ['X轴', 'X轴微调', 'Y轴', 'Y轴微调', 'XY轴速度', '总调光', '总调光微调', '频闪', '色盘1', '色盘2', '青色', '品红色', '黄色', '色温', 'CMY颜色宏', '光圈', '光圈宏功能', '雾化1/雾化2', '放大', '放大微调', '调焦', '调焦微调', '切割1', '切割2', '切割3', '切割4', '切割5', '切割6', '切割7', '切割8', '切割宏', '切割旋转', '宏功能'],
    ],
    'TL-SM9210': [
      ['X轴', 'Y轴', '总调光', '频闪', '色盘1', '色盘2', '固定盘', '旋转图案盘1', '图案旋转1', '旋转图案盘2', '图案旋转2', '效果盘', '光圈', '光圈宏功能', '棱镜1/棱镜2', '棱镜1旋转', '棱镜2旋转', '雾化1/雾化2', '放大', '调焦', '宏功能'],
      ['X轴', 'X轴微调', 'Y轴', 'Y轴微调', 'XY轴速度', '总调光', '总调光微调', '频闪', '色盘1', '色盘2', '固定盘', '旋转图案盘1', '图案旋转1', '旋转图案盘2', '图案旋转2', '效果盘', '光圈', '光圈宏功能', '棱镜1/棱镜2', '棱镜1旋转', '棱镜2旋转', '雾化1/雾化2', '放大', '放大微调', '调焦', '调焦微调', '宏功能'],
    ],
    'TL-SM9402IP': [
      ['X轴', 'Y轴', '总调光', '频闪', '色盘', '青色', '品红色', '黄色', '色温', 'CMY颜色宏', '固定盘', '旋转图案盘', '图案旋转', '效果盘', '光圈', '光圈宏功能', '棱镜', '棱镜1旋转', '雾化1', '放大', '调焦', '切割1', '切割2', '切割3', '切割4', '切割5', '切割6', '切割7', '切割8', '切割宏', '切割旋转', '宏功能'],
      ['X轴', 'X轴微调', 'Y轴', 'Y轴微调', 'XY轴速度', '总调光', '频闪', '色盘', '青色', '品红色', '黄色', '色温', 'CMY颜色宏', '固定盘', '旋转图案盘', '图案旋转', '效果盘', '光圈', '光圈宏功能', '棱镜', '棱镜1旋转', '雾化1', '放大', '调焦', '调焦微调', '切割1', '切割2', '切割3', '切割4', '切割5', '切割6', '切割7', '切割8', '切割宏', '切割旋转', '宏功能'],
    ],
  }
  Object.entries(thirteenthBatchChannelNames).forEach(([model, modes]) => {
    const actualModes = getDmxChannelProfile(model).modes
    assert.deepStrictEqual(actualModes.map((item) => item.channels.map((channel) => channel.name)), modes, `${model} 通道顺序不一致`)
    actualModes.forEach((item) => item.channels.forEach((channel) => assert(!/^CH\d+$/.test(channel.name), `${model} 存在占位通道名 ${channel.name}`)))
  })
  assert.deepStrictEqual(eighthRanges('TL-SM3502IP', 0, '频闪'), ['0–3', '4–103', '104–107', '108–207', '208–212', '213–251', '252–255'])
  assert.deepStrictEqual(eighthRanges('TL-SM3502IP', 0, '复位/功能'), ['0–99', '100–105', '106–199', '200–205', '206–209', '210–215', '216–219', '220–235', '236–239', '240–255'])
  assert.deepStrictEqual(eighthRanges('TL-SM3502IP', 0, '雾化'), ['0–127', '128–191', '192–255'])
  assert.deepStrictEqual(eighthRanges('TL-SM9051', 0, '切割宏').slice(-3), ['214–219', '220–225', '226–255'])
  assert.deepStrictEqual(eighthRanges('TL-SM9051', 0, '雾化1/雾化2'), ['0–10', '11–127', '128–255'])
  assert.strictEqual(eighthChannel('TL-SM9051', 0, '光圈宏功能').ranges[0].description, '开')
  assert.deepStrictEqual(eighthRanges('TL-SM9051', 0, '宏功能').slice(0, 10), ['0–10', '11–21', '22–27', '28–33', '34–42', '43–48', '49–54', '55–60', '61–66', '67–72'])
  assert.deepStrictEqual(eighthRanges('TL-SM9210', 0, '色盘2').slice(8, 12), ['61–67', '68–74', '75–81', '82–89'])
  assert.strictEqual(eighthChannel('TL-SM9210', 0, '色盘2').ranges[8].description, '6500K')
  assert.deepStrictEqual(eighthRanges('TL-SM9210', 0, '效果盘'), ['0–10', '11–127', '128–138', '139–255'])
  assert.deepStrictEqual(eighthRanges('TL-SM9210', 0, '棱镜1/棱镜2'), ['0–10', '11–127', '128–255'])
  assert.deepStrictEqual(eighthRanges('TL-SM9210', 0, '雾化1/雾化2'), ['0–10', '11–127', '128–255'])
  assert.strictEqual(eighthChannel('TL-SM9210', 0, '光圈宏功能').ranges[0].description, '开')
  assert.deepStrictEqual(eighthRanges('TL-SM9402IP', 0, '切割旋转'), ['0–255'])
  assert.deepStrictEqual(eighthRanges('TL-SM9402IP', 0, '棱镜'), ['0–10', '11–127', '128–255'])
  assert.strictEqual(eighthChannel('TL-SM9402IP', 0, '光圈宏功能').ranges[0].description, '开')
  assert.strictEqual(eighthChannel('TL-SM9402IP', 0, '切割旋转').ranges[0].description, '滑步0°–90°')
  assert.deepStrictEqual(eighthRanges('TL-SM9402IP', 0, '切割宏').slice(-3), ['214–219', '220–225', '226–255'])
  assert.notDeepStrictEqual(getDmxChannelProfile('TL-SM9210').modes, getDmxChannelProfile('TL-SM9402IP').modes)

  const sl113TwentyOne = buildDmxChannelGuide({ model: 'TL-SL113', channelCount: 21 })
  const sl113TwentyFive = buildDmxChannelGuide({ model: 'TL-SL113', channelCount: 25 })
  assert.deepStrictEqual(sl113TwentyOne.channels.map((channel) => channel.name), [
    'X轴', 'Y轴', 'XY速度', '调光', '频闪', '颜色盘', '青色', '品红', '黄色',
    '固定图案', '旋转图案', '图案旋转', '效果盘', '棱镜1/2', '棱镜1/2旋转',
    '棱镜3/4', '棱镜3/4旋转', '雾化', '调焦', '变焦', '宏功能',
  ])
  assert.deepStrictEqual(sl113TwentyFive.channels.map((channel) => channel.name), [
    'X轴', 'X轴微调', 'Y轴', 'Y轴微调', 'XY速度', '调光', '频闪', '颜色盘',
    '青色', '品红', '黄色', '固定图案', '旋转图案', '图案旋转', '效果盘',
    '棱镜1/2', '棱镜1/2旋转', '棱镜3/4', '棱镜3/4旋转', '雾化', '调焦',
    '调焦微调', '变焦', '变焦微调', '宏功能',
  ])
  const knownRange = buildDmxChannelGuide({ model: 'TL-SW6001', channelCount: 9 })
  assert.deepStrictEqual(
    knownRange.channels.slice(1, 5).map((channel) => [channel.summary, channel.ranges[0].description]),
    [['红色', '由暗至亮'], ['绿色', '由暗至亮'], ['蓝色', '由暗至亮'], ['白色', '由暗至亮']],
    'TL-SW6001 RGBW 摘要或范围与既有资料不一致',
  )
  assert.strictEqual(knownRange.channels[5].ranges[0].range, '0–10')
  assert.strictEqual(knownRange.channels[6].ranges[19].description, '声控')
  assert.strictEqual(buildDmxChannelGuide({ model: 'TL-SW6001', channelCount: 16 }), null)
  assert.strictEqual(buildDmxChannelGuide({ model: 'TL-SW6001', channelCount: 0 }), null)
  assert.strictEqual(buildDmxChannelGuide({ model: 'not-supported', channelCount: 5 }), null)

  const sl210b = buildDmxChannelGuide({ model: 'TL-SL210B', channelCount: 9 })
  assert.deepStrictEqual(sl210b.channels.map((channel) => channel.name), [
    '主调光', 'LED R', 'LED G', 'LED B', 'LED W', '主频闪', '场景和程序',
    '程序速度/咪头灵敏度', '放大电机',
  ])
  assert.strictEqual(sl210b.channels[5].ranges[0].range, '0–009')
  assert.strictEqual(sl210b.channels[6].ranges[25].description, '声控模式')
  assert.strictEqual(sl210b.channels[7].ranges[0].description, '慢到快/小到大')
  assert.deepStrictEqual(
    buildDmxChannelGuide({ model: 'TL-SL210B', channelCount: 7 }).channels.map((channel) => channel.name),
    ['主调光', 'LED R', 'LED G', 'LED B', 'LED W', '主频闪', '放大电机'],
  )

  const sl201 = getDmxChannelProfile('TL-SL201')
  const sl204 = getDmxChannelProfile('TL-SL204')
  assert.deepStrictEqual(sl201.modes, sl204.modes, 'TL-SL201 与 TL-SL204 未复用相同模式')
  assert.deepStrictEqual(sl201.modes[1].channels.map((channel) => channel.name),
    ['调光', 'Red', 'Green', 'Blue', 'White', '频闪', '宏', '速度'])
  const sl203Macro = getDmxChannelProfile('TL-SL203').modes[1].channels[5].ranges
  assert.deepStrictEqual([sl203Macro[0], sl203Macro[1], sl203Macro.at(-1)], [
    { range: '0–5', description: '无效' },
    { range: '6–35', description: 'R' },
    { range: '246–255', description: '声控' },
  ])
  const sl205Macro = getDmxChannelProfile('TL-SL205').modes[1].channels[8].ranges
  assert.deepStrictEqual([sl205Macro[0], sl205Macro[1], sl205Macro[63], sl205Macro[64]], [
    { range: '0–2', description: '无效' },
    { range: '3–5', description: '颜色1' },
    { range: '189–191', description: '颜色63' },
    { range: '192–225', description: '自动跳变' },
  ])
  const sl206Nine = getDmxChannelProfile('TL-SL206').modes[2]
  const sl206Macro = sl206Nine.channels[6].ranges
  assert.deepStrictEqual([sl206Macro[0], sl206Macro[1], sl206Macro[15], sl206Macro.at(-1)], [
    { range: '0–5', description: '无效' },
    { range: '6–17', description: '颜色1' },
    { range: '174–185', description: '颜色15' },
    { range: '246–255', description: '声控频闪' },
  ])
  assert.deepStrictEqual(sl206Nine.channels[8].ranges, [
    { range: '0–66', description: '无效' },
    { range: '67–72', description: '正常模式' },
    { range: '73–78', description: '低噪模式' },
    { range: '79–84', description: '静音模式' },
    { range: '85–255', description: '无效' },
  ])
  const sl208 = getDmxChannelProfile('TL-SL208')
  assert.deepStrictEqual(sl208.modes, getDmxChannelProfile('TL-SL208B').modes,
    'TL-SL208 与 TL-SL208B 未复用相同模式')
  assert.deepStrictEqual(sl208.modes[2].channels[8].ranges, [
    { range: '0–200', description: '正常模式' },
    { range: '201–205', description: '静音模式' },
    { range: '206–255', description: '低速模式' },
  ])
  const sl209Program = getDmxChannelProfile('TL-SL209').modes[2].channels[6].ranges
  assert.deepStrictEqual([sl209Program[0], sl209Program[1], sl209Program[15], sl209Program[16], sl209Program[19], sl209Program.at(-1)], [
    { range: '0–9', description: '无功能' },
    { range: '10–19', description: 'R' },
    { range: '150–159', description: 'RGBW' },
    { range: '160–169', description: 'Prg1' },
    { range: '190–239', description: 'Prg4' },
    { range: '241–255', description: '声控' },
  ])
  assert.deepStrictEqual(getDmxChannelProfile('TL-SL210').modes, getDmxChannelProfile('TL-SL210B').modes,
    'TL-SL210 未复用已核对的 TL-SL210B 模式')
  const sl336 = getDmxChannelProfile('TL-SL336')
  assert.deepStrictEqual(sl336.modes[0].channels.map((channel) => channel.name), ['WW暖白', 'CW冷白', '调焦'])
  assert.deepStrictEqual(sl336.modes[1].channels.slice(1, 2)[0].ranges, [
    { range: '0–5', description: '关闭' },
    { range: '6–255', description: '常规频闪慢至快' },
  ])
  assert.deepStrictEqual(sl336.modes[1].channels[6].ranges, [
    { range: '0–200', description: '正常模式' },
    { range: '201–205', description: '静音模式' },
    { range: '206–255', description: '低速模式' },
  ])
  const sl342 = getDmxChannelProfile('TL-SL342')
  assert.deepStrictEqual(sl342.modes, getDmxChannelProfile('TL-SL342B').modes)
  assert.deepStrictEqual(sl342.modes, getDmxChannelProfile('TL-SL343').modes)
  assert.deepStrictEqual(sl342.modes[2].channels[4].ranges, [
    { range: '0–5', description: '关闭' },
    { range: '6–75', description: '颜色1' },
    { range: '76–145', description: '颜色2' },
    { range: '146–215', description: '颜色3' },
    { range: '216–225', description: '自动跳变' },
    { range: '226–235', description: '自动脉变' },
    { range: '236–255', description: '自动渐变' },
  ])
  assert.strictEqual(getDmxChannelProfile('TL-SL201').sourcePageText, 'PDF第5页')
  assert.strictEqual(getDmxChannelProfile('TL-SL205').sourcePageText, 'PDF第5–7页')
  assert.strictEqual(getDmxChannelProfile('TL-SL206').source, 'itc产品说明书 TL-SL206-UM-CN@V20250430.pdf')
  assert.strictEqual(getDmxChannelProfile('TL-SL210').sourcePageText, 'PDF第6页')
  assert.strictEqual(getDmxChannelProfile('TL-SL326').modes[0].channels[0].ranges[0].description, '由暗到亮')
  assert.deepStrictEqual(getDmxChannelProfile('TL-SL202').modes, getDmxChannelProfile('TL-SL323').modes)
  assert.deepStrictEqual(getDmxChannelProfile('TL-SL321').modes[0].channels[1].ranges, [
    { range: '0–255', description: '调节频闪速度' },
  ])
  const sl327StrobeRanges = getDmxChannelProfile('TL-SL327').modes[0].channels[1].ranges
  assert.deepStrictEqual([sl327StrobeRanges[0], sl327StrobeRanges.at(-1)], [
    { range: '0–10', description: '关闭' },
    { range: '219–255', description: '开' },
  ])
  assert.deepStrictEqual(getDmxChannelProfile('TL-SL601').modes[0].channels[0].ranges.at(-1),
    { range: '101–255', description: '烟量由少到多' })
  assert.deepStrictEqual(getDmxChannelProfile('TL-SL611').modes[0].channels[1].ranges.at(-1),
    { range: '0–255', description: '调整风量大小' })
  assert.deepStrictEqual(getDmxChannelProfile('TL-SL613').modes[0].channels[0].ranges, [
    { range: '0–0', description: '无输出' }, { range: '1–255', description: '由小到大' },
  ])
  assert.deepStrictEqual(getDmxChannelProfile('TL-SL614').modes[0].channels.map((channel) => channel.name), ['雾量', '风量'])
  assert.deepStrictEqual(getDmxChannelProfile('TL-SL621').modes[0].channels.map((channel) => channel.name), ['烟量', '风量'])
  assert.deepStrictEqual(getDmxChannelProfile('TL-SL641').modes[0].channels[1].ranges, [
    { range: '0–100', description: '关闭' }, { range: '101–255', description: '风力由小到大' },
  ])
  assert.deepStrictEqual(getDmxChannelProfile('TL-SK3101').modes,
    getDmxChannelProfile('TL-SL301').modes,
    'TL-SK3101 与 TL-SL301 未复用相同暖白/冷白模式')
  assert.deepStrictEqual(getDmxChannelProfile('TL-SK3101').modes[1].channels.map((channel) => channel.name),
    ['总调', '频闪', '暖白', '冷白', '色温调节'])
  const sl311 = getDmxChannelProfile('TL-SL311')
  assert.deepStrictEqual(sl311.modes[0].channels.map((channel) => channel.name), ['冷白', '暖白', '角度调节'])
  assert.deepStrictEqual(sl311.modes[1].channels[1].ranges, [
    { range: '0–5', description: '关闭' }, { range: '6–255', description: '常规频闪慢至快' },
  ])
  const sk9303 = getDmxChannelProfile('TL-SK9303')
  assert.deepStrictEqual([sk9303.modes[0].channels[1].ranges[0], sk9303.modes[0].channels[1].ranges.at(-1)], [
    { range: '0–10', description: '关' }, { range: '219–255', description: '开' },
  ])
  assert.deepStrictEqual([sk9303.modes[0].channels[3].ranges[0], sk9303.modes[0].channels[3].ranges.at(-1)], [
    { range: '0–10', description: '无功能' }, { range: '211–255', description: '无功能' },
  ])
  assert.deepStrictEqual(getDmxChannelProfile('TL-SL306').modes[0].channels.map((channel) => channel.name),
    ['总调', '频闪', '色温控制', '自走', '自走速度', '宏功能'])
  assert.deepStrictEqual(getDmxChannelProfile('TL-SL335').modes[0].channels[3].ranges, [
    { range: '0–63', description: '平方曲线' }, { range: '64–127', description: '反曲线' },
    { range: '128–191', description: '直线' }, { range: '192–255', description: 'S型曲线' },
  ])
  assert.deepStrictEqual(getDmxChannelProfile('TL-SL651').modes[0].channels[1].ranges, [
    { range: '0–99', description: '关' }, { range: '100–199', description: '1挡' },
    { range: '200–254', description: '2挡' }, { range: '255–255', description: '3挡' },
  ])
  const sl302 = getDmxChannelProfile('TL-SL302')
  assert.deepStrictEqual(sl302.modes[0].channels.map((channel) => channel.name), ['暖白', '冷白'])
  assert.deepStrictEqual(sl302.modes[1].channels[4].ranges[18], { range: '196–205', description: '6500K' })
  assert.strictEqual(sl302.modes[1].channels[4].ranges.some((range) => range.description === '6600K'), false)
  assert.deepStrictEqual(sl302.modes[2].channels.slice(-1)[0].ranges, [
    { range: '0–200', description: '常规模式' }, { range: '201–205', description: '静音模式' },
    { range: '206–255', description: '低速模式' },
  ])
  const sl314 = getDmxChannelProfile('TL-SL314')
  assert.deepStrictEqual(sl314.modes[1].channels[4].ranges.slice(-2), [
    { range: '236–245', description: '7200K' }, { range: '246–255', description: '全亮' },
  ])
  assert.deepStrictEqual(getDmxChannelProfile('TL-SL315').modes[0].channels.map((channel) => channel.name),
    ['红色', '绿色', '蓝色', '白色', '角度调节'])
  const sl392 = getDmxChannelProfile('TL-SL392')
  assert.deepStrictEqual(sl392.modes[0].channels.map((channel) => channel.name), [
    '总调', '频闪', '色盘', '色温', '光圈', '放大', '调焦', '调焦微调', '图案盘', '图案旋转', '图案旋转微调', '电机复位',
  ])
  assert.deepStrictEqual(sl392.modes[0].channels[11].ranges, [
    { range: '0–200', description: '无功能' }, { range: '201–205', description: '电机复位' },
    { range: '206–255', description: '无功能' },
  ])
  assert.deepStrictEqual(getDmxChannelProfile('TL-SL393').modes[0].channels.map((channel) => channel.name),
    ['总调', '频闪', '色盘', '色温', '光圈', '电机复位'])
  const sl432 = getDmxChannelProfile('TL-SL432').modes[0]
  assert.deepStrictEqual(sl432.channels.slice(5).map((channel) => channel.ranges[0]), [
    { range: '0–9', description: '无' }, { range: '0–5', description: '电机停止转动' },
    { range: '0–9', description: '通道1-7有效' },
  ])
  assert.deepStrictEqual(sl432.channels[7].ranges.at(-1), { range: '221–255', description: '宏功能(声控效果2)' })
  assert.deepStrictEqual(getDmxChannelProfile('TL-SK9702').modes[0].channels.map((channel) => channel.name), ['颜色', '调光', '色温', '光圈', '频闪', '放大', '调焦', '复位'])
  assert.deepStrictEqual(getDmxChannelProfile('TL-SL308').modes[0].channels.map((channel) => channel.name), ['总调', '总调微调', '频闪', '红色', '绿色', '蓝色', '暖白', '青色', '柠檬黄', '色温控制', '宏功能'])
  assert.deepStrictEqual(getDmxChannelProfile('TL-SL308').modes[1].channels.map((channel) => channel.name), ['总调', '总调微调', '频闪', '红色', '绿色', '蓝色', '暖白', '青色', '柠檬黄', '色温控制', '颜色宏和自走', '自走速度', '宏功能', 'CH14'])
  assert.deepStrictEqual(getDmxChannelProfile('TL-SL308').modes[1].channels[10].ranges, [{ range: '0–2', description: '无效' }, { range: '3–191', description: '颜色宏效果' }, { range: '192–225', description: '自走跳变效果' }, { range: '226–235', description: '自走脉变效果' }, { range: '236–255', description: '自走渐变效果' }])
  assert.deepStrictEqual(getDmxChannelProfile('TL-SL328').modes[1].channels.map((channel) => channel.name), ['总调', '频闪', '红色', '绿色', '蓝色', '青色', '琥珀色', '黄绿色', '色温', '颜色宏和自走', '自走速度调节', '调焦', '宏功能'])
  assert.deepStrictEqual(getDmxChannelProfile('TL-SL328').modes[0].channels.map((channel) => channel.name), ['总调', '频闪', '红色', '绿色', '蓝色', '青色', '琥珀色', '黄绿色', '色温', '调焦', '宏功能'])
  assert.deepStrictEqual(getDmxChannelProfile('TL-SL328').modes[1].channels[1].ranges, [{ range: '0–5', description: '关闭' }, { range: '6–255', description: '慢到快' }])
  assert.deepStrictEqual(getDmxChannelProfile('TL-SL361').modes[2].channels.at(-1).ranges, [
    { range: '0–200', description: '正常模式' }, { range: '201–205', description: '静音模式' }, { range: '206–255', description: '低速模式' },
  ])
  assert.deepStrictEqual(getDmxChannelProfile('TL-SL361').modes[1].channels.map((channel) => channel.name), ['总调光', '红色', '绿色', '蓝色', '白色', '频闪', '颜色宏和自走', '自走速度', '色温'])
  assert.deepStrictEqual(getDmxChannelProfile('TL-SL361').modes[1].channels[6].ranges, [
    { range: '0–5', description: '无效' }, { range: '6–19', description: '颜色1' }, { range: '20–33', description: '颜色2' },
    { range: '34–47', description: '颜色3' }, { range: '48–61', description: '颜色4' }, { range: '62–75', description: '颜色5' },
    { range: '76–89', description: '颜色6' }, { range: '90–103', description: '颜色7' }, { range: '104–117', description: '颜色8' },
    { range: '118–131', description: '颜色9' }, { range: '132–145', description: '颜色10' }, { range: '146–159', description: '颜色11' },
    { range: '160–173', description: '颜色12' }, { range: '174–187', description: '颜色13' }, { range: '188–201', description: '颜色14' },
    { range: '202–215', description: '颜色15' }, { range: '216–225', description: '自走跳变' }, { range: '226–235', description: '自走脉变' },
    { range: '236–245', description: '自走渐变' }, { range: '246–255', description: '声控' },
  ])
  assert.strictEqual(getDmxChannelProfile('TL-SV3101').modes[0].channels[7].ranges.at(-1).range, '140–255')
  assert.deepStrictEqual(getDmxChannelProfile('TL-SV3101').modes[0].channels.map((channel) => channel.name), ['水平运动', '水平微调', '垂直运动', '垂直微调', '水平垂直运动速度', '调光', '频闪', '色盘', '图案盘', '棱镜', '雾化', '自走', '自走速度', '复位'])
  assert.deepStrictEqual(getDmxChannelProfile('TL-SV3101').modes[1].channels.map((channel) => channel.name), ['水平运动', '垂直运动', '水平垂直运动速度', '调光', '频闪', '色盘', '图案盘', '棱镜', '雾化', '复位'])
  assert.deepStrictEqual(getDmxChannelProfile('TL-SV3101').modes[0].channels[8].ranges, [{ range: '0–63', description: '8种图案选择' }, { range: '64–127', description: '图案抖动' }, { range: '128–190', description: '图案旋转由快到慢' }, { range: '191–255', description: '图案旋转由慢到快' }])
  assert.deepStrictEqual(getDmxChannelProfile('TL-SV3102').modes.map((mode) => mode.channels.map((channel) => channel.name)), [['水平运动', '垂直运动', '水平垂直运动速度', '调光', '频闪', '色盘', '图案盘', '棱镜', '无功能', '复位'], ['水平运动', '水平微调', '垂直运动', '垂直微调', '水平垂直运动速度', '调光', '频闪', '色盘', '图案盘', '棱镜', '无功能', '自走', '自走速度', '复位']])
  assert.deepStrictEqual(getDmxChannelProfile('TL-SV3102').modes[1].channels[11].ranges, [{ range: '0–29', description: '无效果' }, { range: '30–149', description: '自走' }, { range: '150–255', description: '无效果' }])
  assert.deepStrictEqual(getDmxChannelProfile('TL-SV3102').modes[0].channels[8].ranges, [{ range: '0–255', description: '' }])
  assert.strictEqual(getDmxChannelProfile('TL-SV3302').modes[0].channels[1].ranges, undefined)
  assert.deepStrictEqual(getDmxChannelProfile('TL-SV3302').modes[1].channels.map((channel) => channel.name), ['X电机', 'Y电机', 'XY速度调节', '染色角度调节', '调光', '频闪', '红光调光', '绿光调光', '蓝光调光', '白光调光', '复位'])
  assert.deepStrictEqual(getDmxChannelProfile('TL-SV3302').modes[0].channels[12].ranges, [{ range: '0–29', description: '无' }, { range: '30–149', description: '自走' }, { range: '150–255', description: '声控' }])
  assert.deepStrictEqual(getDmxChannelProfile('TL-SV6101').modes[1].channels.at(-1).ranges.at(-1), { range: '248–255', description: '随机声控效果' })
  assert.deepStrictEqual(getDmxChannelProfile('TL-SL313').modes[0].channels.map((channel) => channel.name), ['WW暖白', 'CW冷白'])
  assert.deepStrictEqual(getDmxChannelProfile('TL-SL326B').modes[0].channels[2].ranges, [
    { range: '0–9', description: '无效' }, { range: '10–255', description: '常规频闪慢至快' },
  ])
  assert.deepStrictEqual(getDmxChannelProfile('TL-SL334').modes[0].channels[2].ranges, [{ range: '245–255', description: '复位功能' }])
  assert.strictEqual(getDmxChannelProfile('TL-SL344').modes[4].channels[2].ranges[13].range, '170–185')
  assert.strictEqual(getDmxChannelProfile('TL-SL421').modes[0].channels[10].ranges[2].range, '251–255')
  assert.deepStrictEqual(getDmxChannelProfile('TL-SL450').modes[1].channels.slice(25, 35).map((channel) => channel.name),
    ['暖白1', '冷白1', '暖白2', '冷白2', '暖白3', '冷白3', '暖白4', '冷白4', '暖白5', '冷白5'])
  assert.deepStrictEqual(getDmxChannelProfile('TL-SL602').modes[0].channels[8].ranges.slice(0, 2), [
    { range: '0–2', description: '无效' }, { range: '3–5', description: '颜色1' },
  ])
  assert.deepStrictEqual(getDmxChannelProfile('TL-SL631').modes[0].channels[1].ranges, [
    { range: '0–5', description: '关' }, { range: '6–255', description: '开且数值越大雪花量越大' },
  ])
  const sl612 = getDmxChannelProfile('TL-SL612')
  assert.strictEqual(sl612.modes[0].channels.length, 4)
  assert.deepStrictEqual(sl612.modes[0].channels[3].ranges,
    [{ range: '0–255', description: '保留/未定义' }])
  const sl312 = getDmxChannelProfile('TL-SL312')
  assert.deepStrictEqual(sl312.modes[0].channels.map((channel) => channel.name), ['红色', '绿色', '蓝色', '白色'])
  assert.deepStrictEqual(sl312.modes[2].channels.slice(-1)[0].ranges, [
    { range: '0–200', description: '常规模式' }, { range: '201–205', description: '静音模式' },
    { range: '206–255', description: '低速模式' },
  ])
  assert.deepStrictEqual(sl312.modes[1].channels[6].ranges.slice(-4), [
    { range: '202–215', description: '颜色15' }, { range: '216–225', description: '自走跳变效果' },
    { range: '226–235', description: '自走脉变效果' }, { range: '236–255', description: '自走渐变效果' },
  ])
  const sl501 = getDmxChannelProfile('TL-SL501')
  assert.strictEqual(sl501.modes[0].channels.length, 17)
  assert.deepStrictEqual(sl501.modes[0].channels.slice(14).map((channel) => channel.ranges[0].range),
    ['保留/未定义', '保留/未定义', '保留/未定义'])
  const se3401Mode168 = getDmxChannelProfile('TL-SE3401').modes.find((item) => item.channelCount === 168)
  assert.deepStrictEqual([se3401Mode168.channels[0].name, se3401Mode168.channels[141].name,
    se3401Mode168.channels[144].name, se3401Mode168.channels[167].name],
  ['第01段红色灯珠线性调光', '第48段红色灯珠线性调光', '第1段白色灯珠线性调光', '第24段白色灯珠线性调光'])
  const sl309Mode204 = getDmxChannelProfile('TL-SL309').modes.find((item) => item.channelCount === 204)
  assert.deepStrictEqual([sl309Mode204.channels[3].name, sl309Mode204.channels[99].name,
    sl309Mode204.channels[104].name, sl309Mode204.channels[199].name, sl309Mode204.channels[203].name],
  ['第1组红色', '色温', '第1组辅光红色', '第24组辅光白色', '宏功能'])
  const sm3601Mode170 = getDmxChannelProfile('TL-SM3601').modes.find((item) => item.channelCount === 170)
  assert.deepStrictEqual([sm3601Mode170.channels[98].name, sm3601Mode170.channels[167].name,
    sm3601Mode170.channels[169].name], ['频闪灯红色1', '频闪灯红色24', '频闪灯蓝色24'])
  const sv6302Mode67 = getDmxChannelProfile('TL-SV6302').modes.find((item) => item.channelCount === 67)
  assert.deepStrictEqual([sv6302Mode67.channels[8].name, sv6302Mode67.channels[55].name,
    sv6302Mode67.channels[66].name], ['LED1-R', 'LED12-W', '频闪彩光效果速度'])

  const sw6001Profile = getDmxChannelProfile('TL-SW6001')
  const sw6002Profile = getDmxChannelProfile('TL-SW6002')
  assert.deepStrictEqual(sw6002Profile.modes, sw6001Profile.modes,
    'TL-SW6002 没有复用 TL-SW6001 的 5/9CH 模式定义')
  assert.strictEqual(sw6002Profile.sourcePageText, 'PDF第6页')

  const sk9201Profile = getDmxChannelProfile('TL-SK9201')
  const sk9203Profile = getDmxChannelProfile('TL-SK9203')
  assert.deepStrictEqual(sk9201Profile.modes, sk9203Profile.modes,
    'TL-SK9201 与 TL-SK9203 通道表不一致')
  assert.deepStrictEqual(sk9201Profile.modes[0].channels.map((channel) => channel.name),
    ['总调光', '频闪', '调焦', '变焦', '宏功能'])
  assert.deepStrictEqual(sk9201Profile.modes[1].channels.slice(0, 2).map((channel) => channel.name),
    ['总调光', '总调光微调'])
  assert.deepStrictEqual(sk9201Profile.modes[1].channels.slice(3, 7).map((channel) => [
    channel.summary, channel.ranges[0].description,
  ]), [
    ['调焦', ''], ['调焦微调', ''], ['变焦', ''], ['变焦微调', ''],
  ])
  assert.deepStrictEqual(sk9201Profile.modes[0].channels[1].ranges.slice(0, 3), [
    { range: '0–10', description: '关' },
    { range: '11–21', description: '开' },
    { range: '22–62', description: '频闪，由慢到快' },
  ])

  const sk9202Profile = getDmxChannelProfile('TL-SK9202')
  const sk9204Profile = getDmxChannelProfile('TL-SK9204')
  assert.deepStrictEqual(sk9202Profile.modes, sk9204Profile.modes,
    'TL-SK9202 与 TL-SK9204 通道表不一致')
  assert.deepStrictEqual(sk9202Profile.modes[1].channels.slice(8, 11).map((channel) => channel.name),
    ['色温', 'DUV', '颜色宏和自走'])
  assert.deepStrictEqual(sk9202Profile.modes[1].channels[8].ranges, [
    { range: '0–26', description: '无功能' }, { range: '27–255', description: '色温由低到高' },
  ])
  assert.deepStrictEqual(sk9202Profile.modes[1].channels[16].ranges.filter(({ range }) => (
    ['136–145', '146–151'].includes(range)
  )), [
    { range: '136–145', description: 'CCI校正：开' }, { range: '146–151', description: 'CCI校正：关' },
  ])

  const sk9301Macro = getDmxChannelProfile('TL-SK9301').modes[1].channels[14].ranges
  const sk9302Profile = getDmxChannelProfile('TL-SK9302')
  const sk9302Macro = sk9302Profile.modes[1].channels[14].ranges
  assert.notDeepStrictEqual(sk9301Macro, sk9302Macro, 'TL-SK9301 与 TL-SK9302 不应共用宏')
  assert.deepStrictEqual(sk9302Macro.slice(-11), [
    { range: '130–135', description: '无功能' },
    { range: '136–140', description: 'CCI校正：最佳亮度' },
    { range: '141–145', description: 'CCI校正：最优显指' },
    { range: '146–151', description: 'CCI校正：关' },
    { range: '152–157', description: '无功能' }, { range: '158–163', description: '无功能' },
    { range: '164–184', description: '无功能' }, { range: '185–190', description: '无功能' },
    { range: '191–199', description: '无功能' }, { range: '200–210', description: '无功能' },
    { range: '211–255', description: '无功能' },
  ])
  assert.deepStrictEqual(sk9302Profile.modes[1].channels[9].ranges, [
    { range: '0–54', description: '无功能' }, { range: '55–155', description: '' },
    { range: '156–255', description: '' },
  ])
  assert.deepStrictEqual(sk9301Macro.filter(({ range }) => (
    ['136–145', '146–151'].includes(range)
  )), [
    { range: '136–145', description: 'CCI校正：开' },
    { range: '146–151', description: 'CCI校正：关' },
  ])
  assert.deepStrictEqual(getDmxChannelProfile('TL-SK9301').modes[1].channels.slice(3, 8).map((channel) => [
    channel.summary, channel.ranges[0].description,
  ]), [
    ['红色', ''], ['绿色', ''], ['蓝色', ''], ['琥珀色', ''], ['柠檬黄', ''],
  ])

  const sk9205Profile = getDmxChannelProfile('TL-SK9205')
  const sk9305Profile = getDmxChannelProfile('TL-SK9305')
  assert.notDeepStrictEqual(sk9205Profile.modes, sk9305Profile.modes,
    'TL-SK9205 与 TL-SK9305 的模式结构不应完全相同')
  assert.deepStrictEqual(sk9205Profile.modes[1].channels[10].ranges,
    sk9305Profile.modes[1].channels[8].ranges,
    'TL-SK9205 与 TL-SK9305 应共用无风扇宏')
  assert.deepStrictEqual(sk9205Profile.modes[1].channels[5].ranges, [
    { range: '0–39', description: '无功能' }, { range: '40–255', description: '色温由低到高' },
  ])
  assert.deepStrictEqual(sk9205Profile.modes[0].channels[2].ranges, [
    { range: '0–39', description: '无功能' }, { range: '40–255', description: '色温由低到高' },
  ])
  assert.deepStrictEqual(sk9305Profile.modes[0].channels[2].ranges, [
    { range: '0–39', description: '无功能' }, { range: '40–255', description: '色温由低到高' },
  ])
  assert.deepStrictEqual(sk9205Profile.modes[1].channels.slice(3, 5).map((channel) => [
    channel.summary, channel.ranges[0].description,
  ]), [['冷白', ''], ['暖白', '']])
  assert.deepStrictEqual(sk9305Profile.modes[1].channels.slice(3, 5).map((channel) => [
    channel.summary, channel.ranges[0].description,
  ]), [['冷白', ''], ['暖白', '']])

  const sm3401 = buildDmxChannelGuide({ model: 'TL-SM3401', channelCount: 39 })
  const sm3401Names = sm3401.channels.map((channel) => channel.name)
  assert.deepStrictEqual(
    [1, 6, 7, 11, 12, 16, 19, 21, 22, ...Array.from({ length: 10 }, (_, index) => index + 23), 34, 35, 36, 37, 38, 39]
      .map((channel) => sm3401Names[channel - 1]),
    ['青色', '色盘', '频闪', '图盘', '旋转图盘', '棱镜自转', '雾化1', '调焦', '放大',
      '切片1', '切片2', '切片3', '切片4', '切片5', '切片6', '切片7', '切片8', '切片旋转', '切片宏',
      'X轴', 'X轴微调', 'Y轴', 'Y轴微调', '复位/功能', '功能'],
  )
  assert.strictEqual(sm3401.channels[5].ranges.at(-1).range, '128–255')
  assert.strictEqual(sm3401.channels[6].ranges[0].range, '0–3')
  assert.strictEqual(sm3401.channels[10].ranges[0].description, '白光')
  assert.strictEqual(sm3401.channels[10].ranges.at(-1).description, '由慢到快抖动图案1')
  assert.strictEqual(sm3401.channels[11].ranges.at(-1).description, '由慢到快抖动图案7')
  assert.strictEqual(sm3401.channels[15].ranges[2].range, '191–192')
  assert.deepStrictEqual(sm3401.channels[15].ranges, [
    { range: '0–127', description: '0-360度' },
    { range: '128–190', description: '由快到慢正向流水' },
    { range: '191–192', description: '停止' },
    { range: '193–255', description: '由慢到快反向流水' },
  ])
  assert.strictEqual(sm3401.channels[18].ranges[1].description, '线性雾化')
  assert.strictEqual(sm3401.channels[20].ranges[0].description, '由远到近')
  assert.strictEqual(sm3401.channels[21].ranges[0].description, '由大到小')
  assert.strictEqual(sm3401.channels[33].ranges[0].description, '0-540度')
  assert.strictEqual(sm3401.channels[37].ranges[3].description, '3秒后复位整灯')
  const sm3401CrossDomain = buildActualDmxChannelGuide({
    fixtureModel: 'TL-SM3401', channelCount: 39, universe: 1, universeLabel: 'A', startAddress: 480,
  })
  assert.deepStrictEqual(
    [sm3401CrossDomain.channels[0].actualAddress, sm3401CrossDomain.channels[32].actualAddress, sm3401CrossDomain.channels[38].actualAddress],
    ['A480', 'A512', 'B006'],
    'TL-SM3401 高通道实际地址跨域映射错误',
  )

  const plan = calculateDmxAddressPlan({
    startAddress: 37,
    groups: [{ name: '静音染色灯', fixtureModel: 'TL-SW6001', channelCount: 5, fixtureCount: 1 }],
  })
  assert.strictEqual(plan.groups[0].fixtureModel, 'TL-SW6001')
  assert.strictEqual(plan.fixtures[0].fixtureModel, 'TL-SW6001')
  assert.deepStrictEqual(
    buildActualDmxChannelGuide(plan.fixtures[0]).channels.map((channel) => channel.actualAddress),
    ['A037', 'A038', 'A039', 'A040', 'A041'],
  )
  const crossDomain = buildActualDmxChannelGuide({
    fixtureModel: 'TL-SL333',
    channelCount: 3,
    universe: 1,
    universeLabel: 'A',
    startAddress: 511,
  })
  assert.deepStrictEqual(crossDomain.channels.map((channel) => channel.actualAddress), ['A511', 'A512', 'B001'])

  const lightingDetail = getProductDetail('lighting', 'TL-SW6001')
  assert(lightingDetail.dmxChannelGuide)
  assert.deepStrictEqual(lightingDetail.dmxChannelGuide.modes.map((mode) => mode.channelCount), [5, 9])
  assert.strictEqual(lightingDetail.dmxChannelGuide.channels, undefined)
  assert(getProductDetail('lighting', 'TL-SW6002').dmxChannelGuide)
  const detailWxml = fs.readFileSync(path.join(root, 'pages/products/detail.wxml'), 'utf8')
  const dmxWxml = fs.readFileSync(path.join(root, 'pages/dmx-address/dmx-address.wxml'), 'utf8')
  const dmxJs = fs.readFileSync(path.join(root, 'pages/dmx-address/dmx-address.js'), 'utf8')
  assert(detailWxml.includes('灯具通道速查'))
  assert(detailWxml.includes('!product.dmxChannelGuide'))
  assert(detailWxml.includes('{{product.dmxChannelGuide.source}}'))
  assert(detailWxml.includes('查看完整通道表'))
  assert(detailWxml.includes('通道模式'))
  assert(!detailWxml.includes('dmx-guide-mode-active'))
  assert(!detailWxml.includes('当前默认模式'))
  assert(!detailWxml.includes('进入 DMX 地址页查看'))
  assert(!detailWxml.includes('完整逐通道资料请在 DMX 地址页查看'))
  assert(dmxWxml.includes('openFixtureChannelGuide'))
  assert(dmxWxml.includes('{{fixtureChannelGuide.source}}'))
  assert(dmxWxml.includes('selectFixtureChannelGuideDetail')
    && dmxWxml.includes('{{fixtureChannelGuideDetail}}')
    && dmxWxml.includes('closeFixtureChannelGuideDetail'))
  assert(!dmxWxml.includes('toggleFixtureChannelGuideRanges')
    && !dmxJs.includes('toggleFixtureChannelGuideRanges'))
  assert(!dmxWxml.includes('switchFixtureChannelGuideMode'))
  assert(!dmxJs.includes('switchFixtureChannelGuideMode'))
}

checkDmxAddressPlan()
checkDmxChannelGuide()
