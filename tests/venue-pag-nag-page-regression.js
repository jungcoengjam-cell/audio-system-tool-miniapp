const assert = require('assert/strict')
const fs = require('fs')
const path = require('path')

const { calculatePagNagReview } = require('../utils/venue-pag-nag')
const { buildResultReportPayload } = require('../utils/result-report')
const { buildRecordComparison } = require('../utils/record-comparison')

const storage = new Map()
let pageConfig
let clipboard = ''
global.Page = (config) => { pageConfig = config }
global.wx = {
  getStorageSync: (key) => storage.get(key),
  setStorageSync: (key, value) => storage.set(key, value),
  removeStorageSync: (key) => storage.delete(key),
  getSystemInfoSync: () => ({ theme: 'light' }),
  onThemeChange: () => {},
  offThemeChange: () => {},
  showToast: () => {},
  showModal: () => {},
  vibrateShort: () => {},
  setClipboardData: ({ data }) => { clipboard = data },
}

delete require.cache[require.resolve('../pages/venue/venue')]
require('../pages/venue/venue')

function createPage() {
  const page = {
    ...pageConfig,
    data: JSON.parse(JSON.stringify(pageConfig.data)),
  }
  page.setData = (changes, callback) => {
    Object.entries(changes).forEach(([key, value]) => {
      const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.')
      let target = page.data
      parts.slice(0, -1).forEach((part) => {
        if (!target[part]) target[part] = {}
        target = target[part]
      })
      target[parts[parts.length - 1]] = value
    })
    if (callback) callback()
  }
  page._pageVisible = false
  return page
}

const validFields = {
  discussionPagNagEnabled: true,
  discussionPagNagDsText: '1',
  discussionPagNagD0Text: '10',
  discussionPagNagDnText: '2',
  discussionPagNagD1Text: '3',
  discussionPagNagD2Text: '7',
  discussionPagNagNomText: '2',
}

assert.deepEqual(pageConfig.data.discussionPagNagEnabled, false)
for (const field of [
  'discussionPagNagDsText', 'discussionPagNagD0Text', 'discussionPagNagDnText',
  'discussionPagNagD1Text', 'discussionPagNagD2Text', 'discussionPagNagNomText',
]) assert.equal(pageConfig.data[field], '')
const initialWxml = fs.readFileSync(path.join(__dirname, '../pages/venue/venue.wxml'), 'utf8')
assert(initialWxml.includes('bindchange="onDiscussionPagNagToggle"'))
assert(initialWxml.includes('discussionPagNagDsText'))
assert(initialWxml.includes('disabled="{{isGeneratingResultReport || pagNagOutputBlocked}}"'))

const pureReview = calculatePagNagReview({ ds: 1, d0: 10, dn: 2, d1: 3, d2: 7, nom: 2 })
assert.equal(pureReview.basis, 'omnidirectional-single-path')
assert.equal(pureReview.verification, 'unverified')
assert.equal(pureReview.feedbackStabilityMarginDb, 6)
assert(Number.isFinite(pureReview.marginDb))

const page = createPage()
page.calculate({ sceneModeIndex: 1 })
const oldDiscussionPreferences = page.getPreferences()
assert.equal('discussionPagNagEnabled' in oldDiscussionPreferences, false)
const baseResult = page.data.result
assert.equal(baseResult.pagNagReview, undefined)

page.calculate({ discussionPagNagEnabled: true })
assert.equal(page.data.result.kind, 'discussion')
assert.equal(page.data.result.pagNagReview, undefined)
assert.equal(page.data.pagNagOutputBlocked, true)
assert(page.data.discussionPagNagError)
assert.equal(page.getRecordPayload(), null)
assert.equal(page.getRecordLookupPayload(), null)
assert.equal(page.getResultText(), '')
assert.equal(page.buildResultReportRecord(), null)
const invalidPreferenceSnapshot = JSON.stringify([...storage.entries()])
page.toggleCurrentFavorite()
page.saveToActiveProject()
assert.equal(JSON.stringify([...storage.entries()]), invalidPreferenceSnapshot)

page.calculate(validFields)
assert(page.data.result.pagNagReview)
assert.equal(page.data.pagNagOutputBlocked, false)
const enabledPreferences = page.getPreferences()
assert.equal(enabledPreferences.discussionPagNagEnabled, true)
assert.equal(enabledPreferences.discussionPagNagD0Text, '10')
const enabledRecord = page.getRecordPayload()
assert(enabledRecord.resultText.includes('Ds嘴到话筒 1 m'))
assert(enabledRecord.resultText.includes('潜在增益 PAG'))
assert(enabledRecord.resultText.includes('模型缺口 -'))
assert(enabledRecord.resultText.includes('全向近似，已扣6 dB稳定余量；单链路结果需现场复核'))
assert(enabledRecord.resultText.includes('布局估算注意：该结果'))
const enabledReport = page.buildResultReportRecord()
const reportPayload = buildResultReportPayload(enabledReport)
assert(reportPayload.lines.length <= 20)
assert(reportPayload.lines.some((line) => line.includes('Ds嘴到话筒')))
assert(reportPayload.lines.some((line) => line.includes('D1话筒到音箱')))
assert(reportPayload.lines.some((line) => line.includes('潜在增益 PAG')))
assert(reportPayload.lines.some((line) => line.includes('资料边界')))
page.copyResult()
assert(clipboard.includes('NOM同时开放话筒 2 支'))

const precisionFields = {
  discussionPagNagDsText: '11.8528429935882',
  discussionPagNagD0Text: '2.6897292091784304',
  discussionPagNagDnText: '1.8361237541412105',
  discussionPagNagD1Text: '3.193579035467197',
  discussionPagNagD2Text: '14.53900011875516',
  discussionPagNagNomText: '1',
}
page.calculate(precisionFields)
const precisePayload = buildResultReportPayload(page.buildResultReportRecord())
for (const text of Object.values(precisionFields)) assert(precisePayload.lines.some((line) => line.includes(text)))
for (const line of precisePayload.lines) {
  const units = [...line].reduce((total, character) => total + (/^[\x00-\xff]$/.test(character) ? 0.55 : 1), 0)
  assert(Math.ceil(units / 27) <= 2, `长图摘要单行超过两行：${line}`)
}
page.calculate(validFields)

page.onInput({
  currentTarget: { dataset: { field: 'discussionPagNagNomText' } },
  detail: { value: '' },
})
const clipboardBeforeInvalidCopy = clipboard
page.copyResult()
assert.equal(clipboard, clipboardBeforeInvalidCopy)
assert.equal(page.getRecordPayload(), null)
assert.equal(page.getRecordLookupPayload(), null)
assert.equal(page.getResultText(), '')
assert.equal(page.buildResultReportRecord(), null)
page.onInput({
  currentTarget: { dataset: { field: 'discussionPagNagNomText' } },
  detail: { value: '2' },
})
assert(page.buildResultReportRecord().resultText.includes('NOM同时开放话筒 2 支'))

page.data.resultReportImagePath = 'temp://old.png'
page.data.resultReportSignature = 'old-signature'
page.calculate({ discussionPagNagD0Text: '' })
assert.equal(page.data.resultReportImagePath, '')
assert.equal(page.data.currentFavorite, false)
assert.equal(page.data.pagNagOutputBlocked, true)
assert.equal(page.getRecordPayload(), null)
page.calculate({ discussionPagNagD0Text: '10' })
assert(page.data.result.pagNagReview)

page.calculate({ discussionPagNagEnabled: false })
assert.equal(page.data.result.pagNagReview, undefined)
assert.equal(page.data.pagNagOutputBlocked, false)
assert.equal('discussionPagNagEnabled' in page.getPreferences(), false)
assert.equal(page.buildResultReportRecord().resultText.includes('潜在增益 PAG'), false)
assert(page.getRecordPayload().resultText.includes('注意：该结果'))

page.calculate({ sceneModeIndex: 0 })
assert.equal(page.data.result.kind, 'report')
assert.equal('discussionPagNagEnabled' in page.getPreferences(), false)
page.calculate({ sceneModeIndex: 1 })
assert.equal(page.data.result.kind, 'discussion')
assert.equal(page.data.discussionPagNagEnabled, false)

const comparisonBase = {
  module: 'venue',
  title: '旧记录',
  preferences: {
    sceneMode: 'discussion', participantCountText: '12',
    standardClassKey: 'conference', gradeKey: 'II', layout: 'short',
    lengthText: '12', widthText: '8', heightText: '4',
    discussionTableShape: 'round', discussionInstallationCondition: 'flat',
  },
}
const oldComparison = buildRecordComparison([
  comparisonBase,
  { ...comparisonBase, title: '旧记录2', preferences: { ...comparisonBase.preferences, participantCountText: '13' } },
])
assert.deepEqual(oldComparison.rows.map((row) => row.key), ['participantCountText'])
const enabledComparison = buildRecordComparison([
  { ...comparisonBase, title: '已启用', preferences: { ...comparisonBase.preferences, discussionPagNagEnabled: true, discussionPagNagDsText: '1' } },
  comparisonBase,
])
assert(enabledComparison.rows.some((row) => row.key === 'discussionPagNagEnabled'))
assert(enabledComparison.rows.some((row) => row.key === 'discussionPagNagDsText'))
assert(enabledComparison.rows.find((row) => row.key === 'discussionPagNagEnabled').secondValue === '未启用')
const residualPagNag = {
  discussionPagNagDsText: '999', discussionPagNagD0Text: '10', discussionPagNagDnText: '2',
  discussionPagNagD1Text: '3', discussionPagNagD2Text: '7', discussionPagNagNomText: '2',
}
const residualComparison = buildRecordComparison([
  { ...comparisonBase, title: '启用记录', preferences: { ...comparisonBase.preferences, ...residualPagNag, discussionPagNagEnabled: true } },
  { ...comparisonBase, title: '关闭但残留', preferences: { ...comparisonBase.preferences, ...residualPagNag, discussionPagNagEnabled: false } },
])
assert.equal(residualComparison.rows.filter((row) => row.key.startsWith('discussionPagNag')).length, 7)
assert(residualComparison.rows.every((row) => row.secondValue === '未启用'))
const reportComparison = buildRecordComparison([
  { ...comparisonBase, title: '报告型', preferences: { ...comparisonBase.preferences, sceneMode: 'report' } },
  { ...comparisonBase, title: '围桌启用', preferences: { ...comparisonBase.preferences, discussionPagNagEnabled: true, discussionPagNagDsText: '1' } },
])
assert(reportComparison.rows.some((row) => row.key === 'discussionPagNagEnabled'))
assert.equal(reportComparison.rows.find((row) => row.key === 'discussionPagNagEnabled').firstValue, '不适用')

console.log('venue pag/nag page regression passed')
