const assert = require('node:assert/strict')

const storage = new Map()
const calls = { calculateDiscussionEstimate: 0, buildDiscussionPlan: 0 }
const patches = []
const discussion = require('../utils/venue-discussion')
const discussionPlan = require('../utils/venue-discussion-plan')
for (const [module, name] of [
  [discussion, 'calculateDiscussionEstimate'],
  [discussionPlan, 'buildDiscussionPlan'],
]) {
  const original = module[name]
  module[name] = (...args) => {
    calls[name] += 1
    return original(...args)
  }
}

let pageDefinition
global.Page = (definition) => { pageDefinition = definition }
global.wx = {
  getStorageSync: (key) => storage.get(key),
  setStorageSync: (key, value) => storage.set(key, value),
  getSystemInfoSync: () => ({ theme: 'light' }),
  onThemeChange() {},
  offThemeChange() {},
  vibrateShort() {},
  showToast() {},
  showModal() {},
}
delete require.cache[require.resolve('../pages/venue/venue')]
require('../pages/venue/venue')

const page = {
  ...pageDefinition,
  data: JSON.parse(JSON.stringify(pageDefinition.data)),
  _pageVisible: false,
  setData(changes, callback) {
    patches.push(changes)
    for (const [key, value] of Object.entries(changes)) {
      const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.')
      let target = this.data
      for (const part of parts.slice(0, -1)) {
        if (!target[part]) target[part] = {}
        target = target[part]
      }
      target[parts.at(-1)] = value
    }
    callback?.()
  },
}

page.calculate({
  sceneModeIndex: 1,
  discussionTableShapeIndex: 1,
  lengthText: '20',
  widthText: '14',
  heightText: '5.5',
  participantCountText: '40',
  tableLengthText: '12',
  tableWidthText: '4',
  discussionPagNagEnabled: true,
  discussionPagNagSpeakerMode: 'multiple',
  discussionPagNagDsText: '0.2',
  discussionPagNagD0Text: '10',
  discussionPagNagDnText: '1',
  discussionPagNagD1Text: '1',
  discussionPagNagD2Text: '1',
  discussionPagNagNomText: '2',
})
assert(page.data.result?.pagNagReview)
page._pageVisible = true
page.data.showVenuePlan = true
const existingPlan = page.ensureVenuePlan({ syncView: false })
page.venuePlanResult = page.data.result
page.data.planImagePath = 'temp://existing-layout.png'
page.data.resultReportImagePath = 'temp://existing-report.png'
page.resultReportSignature = page.getResultReportSignature(page.buildResultReportRecord())
const originalResult = page.data.result
const originalReview = page.data.result.pagNagReview
calls.calculateDiscussionEstimate = 0
calls.buildDiscussionPlan = 0
patches.length = 0

for (let index = 0; index < 40; index += 1) {
  page.calculate({ discussionPagNagDsText: String(0.2 + ((index + 1) * 0.001)) })
}

assert.equal(calls.calculateDiscussionEstimate, 0)
assert.equal(calls.buildDiscussionPlan, 0)
assert.equal(page.pendingVenuePlan, existingPlan)
assert.equal(page.venuePlanResult, page.data.result)
assert.equal(page.data.planImagePath, 'temp://existing-layout.png')
assert.equal(page.data.resultReportImagePath, '')
assert.notEqual(page.data.result.pagNagReview, originalReview)
assert.equal(page.data.result, originalResult, 'PAG 结果更新应通过嵌套 setData 保留核心结果对象')
assert(patches.length >= 40)
const patchSizes = patches.map((patch) => Buffer.byteLength(JSON.stringify(patch)))
assert(Math.max(...patchSizes) < 2048, `PAG 单次桥接载荷过大：${Math.max(...patchSizes)} bytes`)

const reviewBeforeInvalid = page.data.result.pagNagReview
page.calculate({ discussionPagNagD0Text: '' })
assert.equal(page.data.pagNagOutputBlocked, true)
assert.equal(page.data.result.pagNagReview, undefined)
assert.equal('pagNagReview' in page.data.result, false)
assert.notEqual(page.data.result, originalResult, '移除嵌套结果应提交不含 PAG 的核心结果')
assert(page.pendingVenuePlan === existingPlan, 'PAG 校验错误不应重建现有布局')
assert.equal(page.venuePlanResult, page.data.result)
assert.notEqual(reviewBeforeInvalid, page.data.result.pagNagReview)

page.calculate({ discussionPagNagD0Text: '10' })
assert(page.data.result.pagNagReview)
assert.equal(page.pendingVenuePlan, existingPlan)
assert.equal(page.venuePlanResult, page.data.result)

page.calculate({ discussionPagNagEnabled: false })
assert.equal(page.data.result.pagNagReview, undefined)
assert.equal('pagNagReview' in page.data.result, false)
assert.equal(page.pendingVenuePlan, existingPlan)
assert.equal(page.venuePlanResult, page.data.result)

// A real core input change must still calculate and rebuild the plan, while a
// later edit returning to the last cached core can safely reuse it.
const estimatorCallsBeforeCoreEdit = calls.calculateDiscussionEstimate
page.calculate({ widthText: '14.1' })
assert.equal(calls.calculateDiscussionEstimate, estimatorCallsBeforeCoreEdit + 1)
assert.notEqual(page.pendingVenuePlan, existingPlan)
assert.equal(page.data.planImagePath, '')

console.log('venue PAG performance regression PASS')
