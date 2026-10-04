const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { buildResultReportPayload } = require('../utils/result-report')

const originalPage = global.Page
const originalWx = global.wx
const storage = new Map()
let pageDefinition
let clipboard = ''
let deferredNextTicks = null
let storageWrites = 0
let pendingPlanMeasurements = []

global.Page = (definition) => { pageDefinition = definition }
global.wx = {
  getStorageSync: (key) => storage.get(key),
  setStorageSync: (key, value) => { storageWrites += 1; storage.set(key, value) },
  removeStorageSync: (key) => storage.delete(key),
  getSystemInfoSync: () => ({ theme: 'light' }),
  onThemeChange() {},
  offThemeChange() {},
  vibrateShort() {},
  showToast() {},
  showModal() {},
  setClipboardData: ({ data }) => { clipboard = data },
  nextTick(callback) {
    if (deferredNextTicks) deferredNextTicks.push(callback)
    else callback()
  },
  createSelectorQuery() {
    const query = {
      select() { return this },
      boundingClientRect(callback) { pendingPlanMeasurements.push(callback); return this },
      exec() {},
    }
    return query
  },
}

delete require.cache[require.resolve('../pages/venue/venue')]
require('../pages/venue/venue')

function createPage(preferences) {
  storage.clear()
  if (preferences) storage.set('audioTool.venue.preferences', preferences)
  const page = { ...pageDefinition, data: JSON.parse(JSON.stringify(pageDefinition.data)) }
  page._pageVisible = false
  page.setData = (changes, callback) => {
    for (const [key, value] of Object.entries(changes)) {
      const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.')
      let target = page.data
      for (const part of parts.slice(0, -1)) {
        if (!target[part]) target[part] = {}
        target = target[part]
      }
      target[parts[parts.length - 1]] = value
    }
    if (callback) callback()
  }
  page.onLoad()
  return page
}

function deferNextTicks() {
  const previous = deferredNextTicks
  const queue = []
  deferredNextTicks = queue
  return {
    queue,
    flush() {
      while (queue.length) queue.shift()()
    },
    restore() { deferredNextTicks = previous },
  }
}

function createBlockedPagNagPage() {
  const page = createPage()
  page._pageVisible = true
  page.onSceneModeTap({ currentTarget: { dataset: { index: 1 } } })
  page.onDiscussionPagNagToggle({ detail: { value: true } })
  return page
}

function createFocusedPagNagPage() {
  const page = createBlockedPagNagPage()
  page.onPagNagReturnToInput()
  assert.equal(page.data.pagNagInputFocused, true)
  return page
}

function assertPagNagNavigationInvalidated(name, invalidate) {
  const page = createBlockedPagNagPage()
  const ticks = deferNextTicks()
  try {
    page.onPagNagReturnToInput()
    assert.equal(ticks.queue.length, 1, `${name}: return should defer focus`)
    invalidate(page)
    ticks.flush()
    assert.equal(page.data.scrollTargetId, '', `${name}: stale callback must not add the anchor`)
    assert.equal(page.data.pagNagInputFocused, false, `${name}: stale callback must not focus the input`)
  } finally {
    ticks.restore()
  }
}

function queuePlanMeasurement(page) {
  pendingPlanMeasurements = []
  page._pageVisible = true
  page.isVenuePlanReady = true
  page.isVenuePlanMeasured = false
  page.data.planImagePath = ''
  page.toggleVenuePlan()
  assert.equal(page.data.showVenuePlan, true, '展开布局开关应显示布局')
  const callback = pendingPlanMeasurements.shift()
  assert.equal(typeof callback, 'function', '展开布局应等待实际画布测量回调')
  return callback
}

function assertPlanMeasurementInvalidated(name, invalidate) {
  const page = createPage()
  const callback = queuePlanMeasurement(page)
  const initialWidth = page.data.planCanvasWidth
  invalidate(page)
  callback({ width: initialWidth + 70 })
  assert.equal(page.data.planCanvasWidth, initialWidth, `${name}: stale measurement must not update canvas size`)
  assert.equal(page.isVenuePlanMeasured, false, `${name}: stale measurement must not mark the hidden plan measured`)
  return page
}

const wxml = fs.readFileSync(path.join(__dirname, '../pages/venue/venue.wxml'), 'utf8')
const wxss = fs.readFileSync(path.join(__dirname, '../pages/venue/venue.wxss'), 'utf8')
const venueJs = fs.readFileSync(path.join(__dirname, '../pages/venue/venue.js'), 'utf8')

const fresh = createPage()
assert.equal(fresh.data.showDefaultExample, true)
assert.equal(fresh.data.showVenueInputHelp, false)
assert.equal(fresh.data.showPagNagGuideHelp, false)
assert.equal(fresh.data.sceneModeIndex, 0)
assert.equal(fresh.data.gradeIndex, 0)
assert.equal(fresh.data.result.kind, 'report')
assert.equal(fresh.data.result.mainCount, 2)
assert(fresh.data.result.reviewWarnings.includes('标称角仅作几何筛选；频段指向性与最大声压测试口径尚待核验。'))
assert.equal(fresh.getPreferences().gradeKey, 'II')
assert.equal('showDefaultExample' in fresh.getPreferences(), false)
assert.equal('inputErrorDetail' in fresh.getPreferences(), false)
assert.equal('showDefaultExample' in storage.get('audioTool.venue.preferences'), false)
assert(wxml.includes('演示参数，请按实际场地填写。'))
assert(wxml.includes('wx:if="{{showVenueInputHelp}}"'))
assert(wxml.includes('wx:if="{{showPagNagGuideHelp}}"'))
assert(wxml.includes('填写说明'))
assert(wxml.includes('测量说明'))
assert(wxml.includes('最大声压级是系统能力目标，不是日常使用音量'))
assert(wxml.includes('报告型测量口径 · 不按比例'))
assert(wxml.includes('居中坐席区'))
assert(wxml.includes('同一只音箱'))
assert(wxml.includes('多音箱取点'))
assert(wxml.includes('id="pag-nag-input"'))
assert(wxml.indexOf('class="pag-nag-mode-options"') < wxml.indexOf('wx:if="{{showPagNagGuideHelp}}"'), 'PAG 模式入口应在折叠外')
assert(wxml.indexOf('class="pag-nag-guide-tabs"') < wxml.indexOf('wx:if="{{showPagNagGuideHelp}}"'), 'PAG 测量项应在折叠外')
assert(wxml.indexOf('wx:if="{{showPagNagGuideHelp}}"') < wxml.indexOf('class="pag-nag-guide-caption"'))
assert(wxml.indexOf('class="pag-nag-guide-caption"') < wxml.indexOf('id="pag-nag-input"'), 'PAG 输入应在说明折叠外')
assert(wxml.includes('wx:if="{{item != \'标称角仅作几何筛选；频段指向性与最大声压测试口径尚待核验。\'}}"'))
assert(wxml.includes('wx:if="{{item == \'标称角仅作几何筛选；频段指向性与最大声压测试口径尚待核验。\'}}"'))
assert(wxml.includes('wx:if="{{item != \'图中为标称角几何范围；有效覆盖和声学均匀度尚待产品指向性与现场核验。\'}}"'))
assert(wxml.includes('wx:if="{{item == \'图中为标称角几何范围；有效覆盖和声学均匀度尚待产品指向性与现场核验。\'}}"'))
assert(wxml.includes('可先评估自然声是否够用。'))
assert(!wxml.includes('仍待填写'))
assert(!wxml.includes('pag-nag-missing-item'))

const helpSideEffectPage = createPage()
let helpCalculationCalls = 0
let helpPlanBuilds = 0
const helpResult = helpSideEffectPage.data.result
helpSideEffectPage.calculate = () => { helpCalculationCalls += 1 }
helpSideEffectPage.buildVenuePlanForResult = () => { helpPlanBuilds += 1 }
storageWrites = 0
helpSideEffectPage.toggleVenueInputHelp()
assert.equal(helpSideEffectPage.data.showVenueInputHelp, true)
assert.equal(helpSideEffectPage.data.showDefaultExample, true, '展开填写说明不应隐藏演示参数')
helpSideEffectPage.toggleVenueInputHelp()
assert.equal(helpSideEffectPage.data.showVenueInputHelp, false)
assert.equal(helpCalculationCalls, 0, '说明开关不应触发计算')
assert.equal(helpPlanBuilds, 0, '说明开关不应生成布局计划')
assert.equal(storageWrites, 0, '说明开关不应写入偏好或存储')
assert.equal(helpSideEffectPage.data.result, helpResult, '说明开关不应替换当前结果对象')

const pagHelpSideEffectPage = createBlockedPagNagPage()
let pagHelpCalculationCalls = 0
let pagHelpPlanBuilds = 0
const pagHelpResult = pagHelpSideEffectPage.data.result
pagHelpSideEffectPage.calculate = () => { pagHelpCalculationCalls += 1 }
pagHelpSideEffectPage.buildVenuePlanForResult = () => { pagHelpPlanBuilds += 1 }
storageWrites = 0
pagHelpSideEffectPage.togglePagNagGuideHelp()
assert.equal(pagHelpSideEffectPage.data.showPagNagGuideHelp, true)
pagHelpSideEffectPage.togglePagNagGuideHelp()
assert.equal(pagHelpSideEffectPage.data.showPagNagGuideHelp, false)
assert.equal(pagHelpCalculationCalls, 0, '测量说明开关不应触发计算')
assert.equal(pagHelpPlanBuilds, 0, '测量说明开关不应生成布局计划')
assert.equal(storageWrites, 0, '测量说明开关不应写入偏好或存储')
assert.equal(pagHelpSideEffectPage.data.result, pagHelpResult, '测量说明开关不应替换当前结果对象')

const inputHelpClosure = createPage()
inputHelpClosure.toggleVenueInputHelp()
inputHelpClosure.onSceneModeTap({ currentTarget: { dataset: { index: 1 } } })
assert.equal(inputHelpClosure.data.showVenueInputHelp, false, '切换场景后收起填写说明')

const pagHelpClosure = createBlockedPagNagPage()
pagHelpClosure.togglePagNagGuideHelp()
assert.equal(pagHelpClosure.data.showPagNagGuideHelp, true)
pagHelpClosure.onPagNagGuideSelect({ currentTarget: { dataset: { key: 'd2' } } })
assert.equal(pagHelpClosure.data.showPagNagGuideHelp, false, '切换测量项后收起测量说明')
pagHelpClosure.togglePagNagGuideHelp()
pagHelpClosure.onDiscussionPagNagSpeakerModeChange({ currentTarget: { dataset: { mode: 'multiple' } } })
assert.equal(pagHelpClosure.data.showPagNagGuideHelp, false, '切换音箱取点模式后收起测量说明')
pagHelpClosure.togglePagNagGuideHelp()
pagHelpClosure.onDiscussionPagNagToggle({ detail: { value: false } })
assert.equal(pagHelpClosure.data.showPagNagGuideHelp, false, '关闭传声增益检查后收起测量说明')
const pagSceneHelpClosure = createBlockedPagNagPage()
pagSceneHelpClosure.togglePagNagGuideHelp()
pagSceneHelpClosure.onSceneModeTap({ currentTarget: { dataset: { index: 0 } } })
assert.equal(pagSceneHelpClosure.data.showPagNagGuideHelp, false, '切换场景后收起测量说明')

const returnHelpClosure = createBlockedPagNagPage()
returnHelpClosure.togglePagNagGuideHelp()
returnHelpClosure.onPagNagReturnToInput()
assert.equal(returnHelpClosure.data.showPagNagGuideHelp, false, '返回填写后收起测量说明')
const operationHelpClosure = createBlockedPagNagPage()
operationHelpClosure.togglePagNagGuideHelp()
operationHelpClosure.beginStructuredOperation({})
assert.equal(operationHelpClosure.data.showPagNagGuideHelp, false, '结构化操作开始后收起测量说明')

fresh.onInput({ currentTarget: { dataset: { field: 'lengthText' } }, detail: { value: '13' } })
assert.equal(fresh.data.showDefaultExample, false, '编辑后应立即隐藏演示标记，不等待180ms计算')
fresh.flushCalculate()
fresh.onInput({ currentTarget: { dataset: { field: 'lengthText' } }, detail: { value: '12' } })
assert.equal(fresh.data.showDefaultExample, false, '改回默认值也不应重新显示演示标记')
fresh.flushCalculate()
assert.equal('showDefaultExample' in fresh.getPreferences(), false)

const exampleDismissers = [
  (page) => page.onGradeTap({ currentTarget: { dataset: { index: 1 } } }),
  (page) => page.onPickerChange({ currentTarget: { dataset: { field: 'layoutIndex' } }, detail: { value: '1' } }),
  (page) => page.onSceneModeTap({ currentTarget: { dataset: { index: 1 } } }),
  (page) => page.onPickerChange({ currentTarget: { dataset: { field: 'discussionTableShapeIndex' } }, detail: { value: '1' } }),
  (page) => page.onPickerChange({ currentTarget: { dataset: { field: 'discussionInstallationConditionIndex' } }, detail: { value: '1' } }),
]
for (const dismiss of exampleDismissers) {
  const page = createPage()
  assert.equal(page.data.showDefaultExample, true)
  dismiss(page)
  assert.equal(page.data.showDefaultExample, false)
}

const saved = createPage({
  sceneMode: 'discussion',
  standardClassKey: 'conference',
  gradeKey: 'II',
  lengthText: '12',
  widthText: '8',
  heightText: '4',
  participantCountText: '12',
})
assert.equal(saved.data.sceneModeIndex, 1)
assert.equal(saved.data.showDefaultExample, false, '已有偏好时不显示首次演示标记')

const structured = createPage()
structured.beginStructuredOperation({})
assert.equal(structured.data.showDefaultExample, false, '开始结构化操作后不显示演示标记')
structured.endOperation()
assert.equal(structured.data.showDefaultExample, false, '结构化操作结束后不恢复演示标记')
const invalidated = createPage()
invalidated.beginStructuredOperation({})
invalidated.onSceneModeTap({ currentTarget: { dataset: { index: 1 } } })
assert.equal(invalidated.data.showDefaultExample, false, '结构化操作失效后不恢复演示标记')

const invalidInputs = createPage()
invalidInputs.calculate({ lengthText: '' })
assert.equal(invalidInputs.data.result, null)
assert(invalidInputs.data.inputErrorDetail.includes('场地长度当前未填'))
invalidInputs.calculate({ lengthText: '0' })
assert(invalidInputs.data.inputErrorDetail.includes('场地长度当前 0 m'))
invalidInputs.calculate({ lengthText: '6', widthText: '8', lastListeningDistanceText: '11' })
assert.equal(invalidInputs.data.inputError, '最后一排距离应大于 0，且不能超过当前主扩方向下的场地纵深。')
assert(invalidInputs.data.inputErrorDetail.includes('11 m'))
assert(invalidInputs.data.inputErrorDetail.includes('纵深 8 m'))
invalidInputs.calculate({ lengthText: '12', lastListeningDistanceText: '7', listeningWidthText: '9' })
assert.equal(invalidInputs.data.inputError, '有效听音区宽度应大于 0，且不能超过当前主扩方向下的场地宽度。')
assert(invalidInputs.data.inputErrorDetail.includes('9 m'))
assert(invalidInputs.data.inputErrorDetail.includes('场地宽度 8 m'))
invalidInputs.calculate({ lengthText: '20.1', widthText: '15', listeningWidthText: '7' })
assert(invalidInputs.data.inputErrorDetail.includes('面积 301.5 m² > 300 m²'))
assert(invalidInputs.data.inputErrorDetail.includes('当前方向纵深 20.1 m > 20 m'))
invalidInputs.calculate({ lengthText: '12', widthText: '8', heightText: '7' })
assert(invalidInputs.data.inputErrorDetail.includes('层高 7 m > 6 m'))
invalidInputs.calculate({ lengthText: '12', widthText: '8', heightText: '4' })
assert.equal(invalidInputs.data.inputErrorDetail, '', '恢复有效值后清除错误详情')
assert(invalidInputs.data.result)

const discussion = createPage()
discussion.calculate({ sceneModeIndex: 1 })
assert(discussion.data.result.kind === 'discussion')
assert(discussion.data.result.reviewWarnings.includes('图中为标称角几何范围；有效覆盖和声学均匀度尚待产品指向性与现场核验。'))
assert(discussion.data.discussionNaturalSoundWarning.includes('最远坐席间距约 4.2 m'))
assert(discussion.data.discussionNaturalSoundWarning.includes('建议先评估自然声是否已足够'))
assert(wxml.includes('discussionNaturalSoundWarning'))
assert(wxml.includes('wx:if="{{discussionNaturalSoundWarning}}" class="discussion-warning venue-natural-sound-warning">可先评估自然声是否够用。</view>'))
discussion.copyResult()
assert(clipboard.includes(discussion.data.discussionNaturalSoundWarning), '复制文字保留完整自然声提醒')

const discussionErrors = createPage()
discussionErrors.calculate({ sceneModeIndex: 1, participantCountText: '0' })
assert.equal(discussionErrors.data.inputError, '参会人数请输入 4～40 的整数。')
assert(discussionErrors.data.inputErrorDetail.includes('当前人数为 0'))
discussionErrors.calculate({ participantCountText: '12', heightText: '6.1' })
assert(discussionErrors.data.inputErrorDetail.includes('层高 6.1 m > 6 m'))
discussionErrors.calculate({ heightText: '2.2' })
assert(discussionErrors.data.inputErrorDetail.includes('当前层高为 2.2 m'))
discussionErrors.calculate({ heightText: '4', tableDiameterText: '100' })
assert(discussionErrors.data.inputErrorDetail.includes('圆桌直径 100 m'))

discussion.calculate({ discussionTableShapeIndex: 1, tableLengthText: '4.8', tableWidthText: '1.8' })
assert(discussion.data.discussionNaturalSoundWarning.includes('最远坐席间距约 6.7 m'))

const noNaturalSoundWarning = createPage()
noNaturalSoundWarning.calculate({
  sceneModeIndex: 1,
  lengthText: '20',
  widthText: '15',
  heightText: '4',
  tableDiameterText: '8',
})
assert(noNaturalSoundWarning.data.result.kind === 'discussion')
assert.equal(noNaturalSoundWarning.data.discussionNaturalSoundWarning, '')

const emptyPag = createPage()
emptyPag.onSceneModeTap({ currentTarget: { dataset: { index: 1 } } })
emptyPag.onDiscussionPagNagToggle({ detail: { value: true } })
assert.equal(emptyPag.data.pagNagOutputBlocked, true)
assert.equal(emptyPag.data.result.kind, 'discussion')
assert.equal(emptyPag.data.discussionPagNagErrorField, 'ds')
assert.equal(emptyPag.data.discussionPagNagErrorKind, 'missing')
assert.deepEqual(emptyPag.data.pagNagMissingItems.map((item) => item.key), ['ds', 'd0', 'dn', 'd1', 'd2', 'nom'])
assert.equal(emptyPag.getRecordPayload(), null)
assert.equal(emptyPag.buildResultReportRecord(), null)
assert(wxml.includes('disabled="{{isGeneratingResultReport || pagNagOutputBlocked}}"'))
assert(wxml.includes('bindtap="onPagNagReturnToInput"'))
assert.equal((wxml.match(/bindblur="onPagNagInputBlur"/g) || []).length, 6)
emptyPag._pageVisible = true
emptyPag.onPagNagReturnToInput()
assert.equal(emptyPag.data.pagNagGuideKey, 'ds')
assert.equal(emptyPag.data.pagNagInputFocused, true)
assert.equal(emptyPag.data.scrollTargetId, 'pag-nag-input')
emptyPag.onPagNagReturnToInput()
assert.equal(emptyPag.data.pagNagInputFocused, true, '重复返回仍会重新请求聚焦')

const sceneFocus = createFocusedPagNagPage()
sceneFocus.onSceneModeTap({ currentTarget: { dataset: { index: 0 } } })
assert.equal(sceneFocus.data.pagNagInputFocused, false, '离开围桌场景时清除焦点请求')
sceneFocus.onSceneModeTap({ currentTarget: { dataset: { index: 1 } } })
assert.equal(sceneFocus.data.pagNagInputFocused, false, '返回围桌场景不应继承旧焦点')

const pagToggleFocus = createFocusedPagNagPage()
pagToggleFocus.onDiscussionPagNagToggle({ detail: { value: false } })
assert.equal(pagToggleFocus.data.pagNagInputFocused, false, '关闭PAG时清除焦点请求')
pagToggleFocus.onDiscussionPagNagToggle({ detail: { value: true } })
assert.equal(pagToggleFocus.data.pagNagInputFocused, false, '重新开启PAG不应继承旧焦点')

const speakerFocus = createFocusedPagNagPage()
speakerFocus.onDiscussionPagNagSpeakerModeChange({ currentTarget: { dataset: { mode: 'multiple' } } })
assert.equal(speakerFocus.data.pagNagInputFocused, false, '切换音箱测点模式时清除焦点请求')

const hiddenFocus = createFocusedPagNagPage()
hiddenFocus.onHide()
assert.equal(hiddenFocus.data.pagNagInputFocused, false, '页面隐藏时清除焦点请求')
hiddenFocus.onShow()
assert.equal(hiddenFocus.data.pagNagInputFocused, false, '页面重新显示不应继承旧焦点')

const structuredFocus = createFocusedPagNagPage()
structuredFocus.beginStructuredOperation({})
assert.equal(structuredFocus.data.pagNagInputFocused, false, '开始结构化操作时清除焦点请求')
structuredFocus.endOperation()
assert.equal(structuredFocus.data.pagNagInputFocused, false, '结构化操作结束不应恢复旧焦点')

const blurFocus = createFocusedPagNagPage()
blurFocus.onPagNagInputBlur()
assert.equal(blurFocus.data.pagNagInputFocused, false, '输入框失焦时清除焦点请求')

const typingFocus = createFocusedPagNagPage()
typingFocus.onInput({
  currentTarget: { dataset: { field: 'discussionPagNagDsText' } },
  detail: { value: '0.3' },
})
assert.equal(typingFocus.data.pagNagInputFocused, true, '正常输入不得主动撤销当前焦点请求')
typingFocus.onInput({
  currentTarget: { dataset: { field: 'discussionPagNagDsText' } },
  detail: { value: '0.31' },
})
typingFocus.flushCalculate()
assert.equal(typingFocus.data.pagNagInputFocused, true, '连续输入与重新计算不得强制失焦')

emptyPag.calculate({ discussionPagNagDsText: '0' })
assert.equal(emptyPag.data.discussionPagNagErrorField, 'ds')
assert.equal(emptyPag.data.discussionPagNagErrorKind, 'invalid')
assert.deepEqual(emptyPag.data.pagNagMissingItems.map((item) => item.key), ['d0', 'dn', 'd1', 'd2', 'nom'])
emptyPag.onPagNagReturnToInput()
assert.equal(emptyPag.data.pagNagGuideKey, 'ds', 'Ds=0时优先返回实际错误项，不跳到首个空字段')

const validPagValues = {
  discussionPagNagEnabled: true,
  discussionPagNagDsText: '0.2',
  discussionPagNagD0Text: '6',
  discussionPagNagDnText: '1',
  discussionPagNagD1Text: '3',
  discussionPagNagD2Text: '4',
  discussionPagNagNomText: '2',
}
emptyPag.calculate(validPagValues)
assert.equal(emptyPag.data.pagNagOutputBlocked, false)
assert.equal(emptyPag.data.discussionPagNagErrorField, '')
assert.equal(emptyPag.data.discussionPagNagErrorKind, '')
assert.equal(emptyPag.data.pagNagMissingItems.length, 0)
const validPagReport = buildResultReportPayload(emptyPag.buildResultReportRecord())
assert(validPagReport.lines.length <= 20, `PAG围桌图片摘要超过20行：${validPagReport.lines.length}`)
assert(validPagReport.lines.some((line) => line.includes('自然声评估')))
assert(validPagReport.lines.some((line) => line.includes('Voice Lift通常优先参考的7.5m')))
assert(validPagReport.lines.some((line) => line.includes('Ds嘴到话筒 0.2 m')))
assert(validPagReport.lines.some((line) => line.includes('NOM同时开放话筒 2 支')))
assert(validPagReport.lines.some((line) => line.includes('NAG目标：近、远听众声音相当')))
assert(validPagReport.lines.some((line) => line.includes('Mix-Minus')))
assert(validPagReport.lines.some((line) => line.includes('资料边界')))

emptyPag.onDiscussionPagNagSpeakerModeChange({ currentTarget: { dataset: { mode: 'multiple' } } })
assert.equal(emptyPag.data.discussionPagNagD1Text, '')
assert.equal(emptyPag.data.discussionPagNagD2Text, '')
assert.equal(emptyPag.data.pagNagOutputBlocked, true)
assert.deepEqual(emptyPag.data.pagNagMissingItems.map((item) => item.key), ['d1', 'd2'])
assert(emptyPag.data.discussionPagNagError.includes('送声箱 A'))
emptyPag.calculate({ discussionPagNagD1Text: '3', discussionPagNagD2Text: '4' })
assert.equal(emptyPag.data.pagNagOutputBlocked, false)
const validMultipleReport = buildResultReportPayload(emptyPag.buildResultReportRecord())
assert(validMultipleReport.lines.length <= 20)
assert(validMultipleReport.lines.some((line) => line.includes('自然声评估')))
assert(validMultipleReport.lines.some((line) => line.includes('多音箱取点')))
emptyPag.calculate({ discussionPagNagD0Text: '2', discussionPagNagDnText: '4' })
assert.equal(emptyPag.data.discussionPagNagErrorField, 'geometry')
assert.equal(emptyPag.data.discussionPagNagErrorKind, 'inconsistent')
assert.equal(emptyPag.data.pagNagMissingItems.length, 0, '完整参数的几何错误不应被列成待填写项')
const currentGuide = emptyPag.data.pagNagGuideKey
emptyPag.onPagNagReturnToInput()
assert.equal(emptyPag.data.pagNagGuideKey, currentGuide, '几何错误应返回当前测量项')
assert.equal(emptyPag.data.pagNagInputFocused, true, '几何错误也聚焦当前输入')

const warningFreeImage = buildResultReportPayload(noNaturalSoundWarning.buildResultReportRecord())
assert.equal(warningFreeImage.lines.some((line) => line.includes('自然声评估')), false)

const accordion = createPage()
let planBuilds = 0
const buildPlan = accordion.buildVenuePlanForResult
accordion.buildVenuePlanForResult = function buildVenuePlanForResult(result) {
  planBuilds += 1
  return buildPlan.call(this, result)
}
const accordionResult = accordion.data.result
accordion.toggleVenuePlan()
assert.equal(accordion.data.showVenuePlan, true)
assert.equal(planBuilds, 1)
const cachedPlan = accordion.pendingVenuePlan
accordion.toggleVenuePlan()
assert.equal(accordion.data.showVenuePlan, false, '再次点击布局开关应收起布局')
assert.equal(planBuilds, 1, '关闭布局不应重新生成计划')
accordion.toggleVenuePlan()
assert.equal(accordion.data.showVenuePlan, true, '关闭后可重新打开布局')
assert.equal(planBuilds, 1, '同一结果重开应复用布局缓存')
assert.equal(accordion.pendingVenuePlan, cachedPlan)
assert.equal(accordion.data.result, accordionResult)
accordion.toggleVenueDetails()
assert.equal(accordion.data.showVenueDetails, true)
assert.equal(accordion.data.showVenuePlan, false, '打开详情应关闭布局')
accordion.toggleVenuePlan()
assert.equal(accordion.data.showVenueDetails, false, '打开布局应关闭详情')
assert.equal(accordion.data.showVenuePlan, true)
assert.equal(planBuilds, 1, '详情与布局互斥切换不应丢失同结果计划缓存')

assert(!wxml.includes('onVenueNextStep'))
assert(!venueJs.includes('onVenueNextStep('))
assert(!wxml.includes('venue-next-step-row'))
assert(!wxml.includes('venue-next-step-button'))
assert.equal((wxml.match(/bindtap="toggleVenueDetails"/g) || []).length, 2, '每种结果保留下方一个详情开关')
assert.equal((wxml.match(/bindtap="toggleVenuePlan"/g) || []).length, 2, '每种结果保留下方一个布局开关')
assert(!wxss.includes('.venue-next-step-row'))
assert(!wxss.includes('.venue-discussion-next-step-row'))
assert(!wxss.includes('.venue-next-step-button'))
assert(wxss.includes('.pag-nag-return-button{display:flex;box-sizing:border-box;flex:1;min-width:0;min-height:44px'))

assertPagNagNavigationInvalidated('switch to report', (page) => {
  page.onSceneModeTap({ currentTarget: { dataset: { index: 0 } } })
})
assertPagNagNavigationInvalidated('switch guide to D2', (page) => {
  page.onPagNagGuideSelect({ currentTarget: { dataset: { key: 'd2' } } })
})
assertPagNagNavigationInvalidated('begin structured operation', (page) => {
  page.beginStructuredOperation({})
})
assertPagNagNavigationInvalidated('hide page', (page) => page.onHide())
assertPagNagNavigationInvalidated('unload page', (page) => page.onUnload())

assertPlanMeasurementInvalidated('switch to details', (page) => page.toggleVenueDetails())
assertPlanMeasurementInvalidated('input flush', (page) => {
  page.onInput({ currentTarget: { dataset: { field: 'heightText' } }, detail: { value: '5' } })
  page.flushCalculate()
})
assertPlanMeasurementInvalidated('hide page', (page) => page.onHide())
assertPlanMeasurementInvalidated('unload page', (page) => page.onUnload())
const planCloseReopen = createPage()
const stalePlanMeasurement = queuePlanMeasurement(planCloseReopen)
const initialPlanWidth = planCloseReopen.data.planCanvasWidth
planCloseReopen.toggleVenuePlan()
assert.equal(planCloseReopen.data.showVenuePlan, false)
const currentPlanMeasurement = queuePlanMeasurement(planCloseReopen)
assert.notEqual(currentPlanMeasurement, stalePlanMeasurement)
stalePlanMeasurement({ width: initialPlanWidth + 70 })
assert.equal(planCloseReopen.data.planCanvasWidth, initialPlanWidth, '关闭并重开后旧测量回调不得改写尺寸')
assert.equal(planCloseReopen.isVenuePlanMeasured, false, '关闭并重开后旧测量回调不得标记新布局已测量')

assert(wxss.includes('min-height:44px'))
assert(wxss.includes('.venue-mode-scope'))
assert(wxss.includes('.pag-nag-blocked-title'))

global.Page = originalPage
global.wx = originalWx
console.log('会议室首次体验回归通过：说明入口、输入详情、自然声提醒、PAG阻断与返回定位、布局开合互斥和异步取消均正常。')
