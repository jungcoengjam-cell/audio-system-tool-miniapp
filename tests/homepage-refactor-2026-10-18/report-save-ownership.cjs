const assert = require('node:assert/strict')

let reportPageDefinition
const pendingSaves = []
const saveCalls = []
global.Page = (definition) => { reportPageDefinition = definition }
global.wx = {
  saveImageToPhotosAlbum: ({ filePath, success, fail }) => {
    saveCalls.push(filePath)
    pendingSaves.push({ success, fail })
  },
  showToast: () => {},
}
require('../../pages/records/report')

function makePage() {
  const page = Object.create(reportPageDefinition)
  page.data = {
    ...JSON.parse(JSON.stringify(reportPageDefinition.data)),
    mode: 'preview',
    pageCount: 2,
    reportPages: [{ path: 'temp://old-1' }, { path: 'temp://old-2' }],
    savedPageIndexes: [],
  }
  page.reportSignature = 'signature-old'
  page._reportPages = [{ path: 'temp://old-1' }, { path: 'temp://old-2' }]
  page.setData = (changes, callback) => {
    page.data = { ...page.data, ...changes }
    if (typeof callback === 'function') callback()
  }
  return page
}

const nextTurn = () => new Promise((resolve) => setImmediate(resolve))

async function verifySaveCanceledOnReturn() {
  saveCalls.length = 0
  pendingSaves.length = 0
  const page = makePage()
  page.saveAllReportPages()
  await nextTurn()
  assert.deepEqual(saveCalls, ['temp://old-1'], 'the first page should be in flight')
  page.backToSelection()
  assert.equal(page.data.mode, 'select')
  assert.equal(page.data.isSaving, false, 'returning to selection should cancel the remaining save task')
  assert.match(page.data.pageStatus, /已停止后续页面保存/)

  page.reportSignature = 'signature-new'
  page._reportPages = [{ path: 'temp://new-1' }, { path: 'temp://new-2' }]
  page.data = { ...page.data, mode: 'preview', savedPageIndexes: [], saveProgressText: '' }
  pendingSaves[0].success({})
  await page._savePromise
  assert.deepEqual(saveCalls, ['temp://old-1'], 'stale save callbacks must not start the next page')
  assert.deepEqual(page.data.savedPageIndexes, [], 'a stale callback must not mark pages in the new report as saved')
  assert.equal(page.data.saveProgressText, '', 'a stale callback must not overwrite the new report state')
}

async function verifySaveStopsOnUnload() {
  saveCalls.length = 0
  pendingSaves.length = 0
  const page = makePage()
  page.saveAllReportPages()
  await nextTurn()
  assert.deepEqual(saveCalls, ['temp://old-1'])
  page.onUnload()
  pendingSaves[0].success({})
  await page._savePromise
  assert.deepEqual(saveCalls, ['temp://old-1'], 'unload must prevent starting another album save')
}

verifySaveCanceledOnReturn().then(verifySaveStopsOnUnload).then(() => {
  console.log('Project report save ownership checks passed (return-to-selection and unload stop pending multi-page saves).')
}).catch((error) => {
  console.error(error)
  process.exitCode = 1
})
