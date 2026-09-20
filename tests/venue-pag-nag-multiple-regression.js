const assert = require('assert/strict')
const fs = require('fs')
const path = require('path')

const { calculatePagNagReview } = require('../utils/venue-pag-nag')
const { getPagNagDescription, getPagNagInputLines, getPagNagResultLines } = require('../pages/venue/pag-nag')
const { buildRecordComparison } = require('../utils/record-comparison')
const { buildResultReportPayload } = require('../utils/result-report')

const input = { ds: 0.2, d0: 10, dn: 1, d1: 1, d2: 1, nom: 2 }
const legacy = calculatePagNagReview(input)
assert.equal(legacy.errorKind, 'inconsistent')
const multi = calculatePagNagReview({ ...input, speakerMode: 'multiple' })
assert.equal(multi.basis, 'omnidirectional-multiple-speakers')
assert.equal(multi.verification, 'unverified')
assert.deepEqual(multi.distancesMeters, { ds: .2, d0: 10, dn: 1, d1: 1, d2: 1 })
assert.equal(multi.openMicrophoneCount, 2)
assert.equal(multi.feedbackStabilityMarginDb, 6)
assert(Number.isFinite(multi.marginDb))
assert.equal(calculatePagNagReview({ ...input, speakerMode: 'multiple', d1: 100 }).errorKind, 'inconsistent')
assert.equal(calculatePagNagReview({ ...input, speakerMode: 'multiple', d1: 100 }).field, 'geometry')
assert.equal(calculatePagNagReview({ ...input, d1: 7.9, d2: 2.4 }).basis, 'omnidirectional-single-path')
for (const speakerMode of [null, '', true, false, 1, {}, [], 'unknown']) {
  const invalid = calculatePagNagReview({ ...input, speakerMode })
  assert.equal(invalid.field, 'speakerMode')
  assert.equal(invalid.errorKind, 'invalid')
}
assert.equal(calculatePagNagReview({ ...input, speakerMode: 'multiple', ds: 1e308, d0: 1e308, d1: 1e308, d2: 1 }).basis,
  'omnidirectional-multiple-speakers')
assert(getPagNagDescription(multi).includes('音箱 A'))
assert(getPagNagDescription(multi).includes('音箱 B'))
assert(getPagNagDescription(multi).includes('Mix-Minus'))
assert(getPagNagInputLines(multi)[1].includes('D1话筒到音箱A'))
assert(getPagNagInputLines(multi)[2].includes('D2音箱B到最远听众'))
assert(getPagNagResultLines(multi)[1].includes('现场复核'))

const storage = new Map()
let config
let timerCleared = false
let toast = ''
global.Page = (value) => { config = value }
global.wx = {
  getStorageSync: (key) => storage.get(key),
  setStorageSync: (key, value) => storage.set(key, value),
  removeStorageSync: (key) => storage.delete(key),
  getSystemInfoSync: () => ({ theme: 'light' }),
  onThemeChange: () => {},
  offThemeChange: () => {},
  showToast: (value) => { toast = value.title },
  showModal: () => {},
  vibrateShort: () => {},
  setClipboardData: () => {},
}
delete require.cache[require.resolve('../pages/venue/venue')]
require('../pages/venue/venue')
function makePage() {
  const page = { ...config, data: JSON.parse(JSON.stringify(config.data)) }
  page.setData = (value, callback) => {
    Object.entries(value).forEach(([key, nextValue]) => {
      const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.')
      let target = page.data
      parts.slice(0, -1).forEach((part) => {
        if (!target[part]) target[part] = {}
        target = target[part]
      })
      target[parts[parts.length - 1]] = nextValue
    })
    if (callback) callback()
  }
  page._pageVisible = false
  return page
}
const page = makePage()
page.calculate({ sceneModeIndex: 1, discussionPagNagEnabled: true,
  discussionPagNagDsText: '0.2', discussionPagNagD0Text: '10', discussionPagNagDnText: '1',
  discussionPagNagD1Text: '1', discussionPagNagD2Text: '1', discussionPagNagNomText: '2' })
page.data.pagNagGuideKey = 'd2'
page.venueCalculateTimer = setTimeout(() => {}, 10000)
page.onDiscussionPagNagSpeakerModeChange({ currentTarget: { dataset: { mode: 'multiple' } } })
assert.equal(page.data.discussionPagNagSpeakerMode, 'multiple')
assert.equal(page.data.discussionPagNagD1Text, '')
assert.equal(page.data.discussionPagNagD2Text, '')
assert.equal(page.data.pagNagGuideKey, 'd1')
assert.equal(page.data.pagNagOutputBlocked, true)
assert.equal(page.data.result.pagNagReview, undefined)
assert.equal(page.getRecordPayload(), null)
assert.equal(page.getRecordLookupPayload(), null)
assert.equal(page.getResultText(), '')
assert.equal(page.buildResultReportRecord(), null)
assert.equal(page.data.resultReportImagePath, '')
assert.equal(storage.has('audioTool.venue.preferences'), false)
assert.equal(toast, 'D1、D2 已清空，请重新测量')
assert.equal(page.data.discussionPagNagDsText, '0.2')
assert.equal(page.data.discussionPagNagNomText, '2')
const snapshot = JSON.stringify(page.data)
page.onDiscussionPagNagSpeakerModeChange({ currentTarget: { dataset: { mode: 'multiple' } } })
page.onDiscussionPagNagSpeakerModeChange({ currentTarget: { dataset: { mode: 'bogus' } } })
assert.equal(JSON.stringify(page.data), snapshot)

page.calculate({ discussionPagNagD1Text: '1', discussionPagNagD2Text: '1' })
assert.equal(page.data.result.pagNagReview.basis, 'omnidirectional-multiple-speakers')
assert.equal(page.data.pagNagOutputBlocked, false)
const multipleRecord = page.getRecordPayload()
assert(multipleRecord.resultText.includes('多音箱取点'))
assert(multipleRecord.resultText.includes('音箱 A'))
assert(multipleRecord.resultText.includes('音箱 B'))
assert(multipleRecord.resultText.includes('D1话筒到音箱A'))
assert(multipleRecord.preferences.discussionPagNagSpeakerMode === 'multiple')
assert.equal(storage.get('audioTool.venue.preferences').discussionPagNagSpeakerMode, 'multiple')
const report = page.buildResultReportRecord()
assert(report.resultText.includes('A距话筒最近'))
assert(report.resultText.includes('Mix-Minus'))

page.calculate({ discussionPagNagSpeakerMode: 'single' })
assert.equal('discussionPagNagSpeakerMode' in page.getPreferences(), false)
page.calculate({ discussionPagNagEnabled: false })
assert.equal('discussionPagNagSpeakerMode' in page.getPreferences(), false)

const base = { module: 'venue', title: 'a', preferences: { sceneMode: 'discussion', discussionPagNagEnabled: true } }
const comparison = buildRecordComparison([
  base,
  { ...base, title: 'b', preferences: { ...base.preferences, discussionPagNagSpeakerMode: 'multiple' } },
])
const modeRow = comparison.rows.find((row) => row.key === 'discussionPagNagSpeakerMode')
assert.equal(modeRow.firstValue, '同一只音箱')
assert.equal(modeRow.secondValue, '多音箱取点')
const invalidComparison = buildRecordComparison([
  { ...base, preferences: { ...base.preferences, discussionPagNagSpeakerMode: 'multiple' } },
  { ...base, title: 'invalid', preferences: { ...base.preferences, discussionPagNagSpeakerMode: null } },
])
assert.equal(invalidComparison.rows.find((row) => row.key === 'discussionPagNagSpeakerMode').secondValue, '资料无效')
for (const mode of ['constructor', '__proto__']) {
  const bad = buildRecordComparison([
    { ...base, preferences: { ...base.preferences, discussionPagNagSpeakerMode: 'multiple' } },
    { ...base, title: 'invalid', preferences: { ...base.preferences, discussionPagNagSpeakerMode: mode } },
  ])
  assert.equal(bad.rows.find((row) => row.key === 'discussionPagNagSpeakerMode').secondValue, '资料无效')
}
page.calculate({ discussionPagNagEnabled: true, discussionPagNagSpeakerMode: 'multiple',
  discussionPagNagDsText: '0.2', discussionPagNagD0Text: '10', discussionPagNagDnText: '1',
  discussionPagNagD1Text: '1.2345678901234', discussionPagNagD2Text: '8.1234567890123',
  discussionPagNagNomText: '2' })
const reportPayload = buildResultReportPayload(page.buildResultReportRecord())
assert(reportPayload.lines.length <= 20)
assert(reportPayload.lines.some((line) => line.includes('1.2345678901234')))
assert(reportPayload.lines.some((line) => line.includes('8.1234567890123')))
for (const line of reportPayload.lines) {
  const width = [...line].reduce((sum, char) => sum + (/^[\x00-\xff]$/.test(char) ? 0.55 : 1), 0)
  assert(Math.ceil(width / 27) <= 2, `report line exceeds two rows: ${line}`)
}
assert(fs.readFileSync(path.join(__dirname, '../pages/venue/venue.wxml'), 'utf8').includes('pag-nag-guide-line-d1-multiple'))

storage.set('audioTool.venue.preferences', {
  sceneMode: 'discussion', discussionPagNagEnabled: true,
  discussionPagNagSpeakerMode: 'invalid',
})
const restored = makePage()
restored.onLoad()
assert.equal(restored.data.discussionPagNagSpeakerMode, 'invalid')
assert.equal(restored.data.discussionPagNagError.includes('音箱模式'), true)

console.log('venue PAG/NAG multiple-speaker regression passed')
