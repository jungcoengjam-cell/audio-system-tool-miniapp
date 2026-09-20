const assert = require('assert/strict')

const originalPage = global.Page
const originalWx = global.wx

function fresh(modulePath) {
  delete require.cache[require.resolve(modulePath)]
  return require(modulePath)
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function installPage(modulePath) {
  let page
  global.Page = (config) => { page = config }
  global.wx = {
    getStorageSync: () => undefined,
    setStorageSync: () => {},
    setNavigationBarTitle: () => {},
    ...global.wx,
  }
  fresh(modulePath)
  page.data = clone(page.data)
  page.setData = (changes, callback) => {
    Object.entries(changes).forEach(([key, value]) => {
      const match = key.match(/^([^\[]+)\[(\d+)\]\.(.+)$/)
      if (!match) {
        page.data[key] = value
        return
      }
      const [, collection, index, property] = match
      page.data[collection][Number(index)] = {
        ...page.data[collection][Number(index)],
        [property]: value,
      }
    })
    if (callback) callback()
  }
  return page
}

function calculateVenue(input) {
  const { calculateVenueEstimate } = require('../utils/venue')
  return calculateVenueEstimate({
    lengthMeters: '12',
    widthMeters: '8',
    heightMeters: '4',
    firstListeningDistanceMeters: '3',
    lastListeningDistanceMeters: '11',
    listeningWidthMeters: '7',
    layout: 'short',
    standardClassKey: 'conference',
    gradeKey: 'II',
    ...input,
  })
}

function calculateLed(input = {}) {
  const { calculateLedScreenPlan } = require('../utils/led-screen')
  return calculateLedScreenPlan({
    wallWidthMeters: '6',
    wallHeightMeters: '3',
    topReserveMeters: '0.2',
    bottomReserveMeters: '0.2',
    frameWidthMeters: '0.05',
    viewingDistanceMeters: '3',
    aspectRatioKey: '16:9',
    unitKey: 'module',
    pixelPitch: 'recommended',
    ...input,
  })
}

try {
  const heightBoundaryResults = ['0.1', '0.3'].map((heightMeters) => (
    calculateVenue({ heightMeters })
  ))
  heightBoundaryResults.forEach((result) => {
    assert.match(result.error, /层高必须高于 0\.3 m/)
  })
  const justAboveHeight = calculateVenue({ heightMeters: '0.31' })
  assert.equal(justAboveHeight.error, undefined)
  assert.equal(justAboveHeight.speakerCenterHeight, 0)
  assert.equal(calculateVenue({ heightMeters: '4' }).speakerCenterHeight, 2.5)

  const areaAtLimit = calculateVenue({ lengthMeters: '20', widthMeters: '15' })
  assert.equal(areaAtLimit.error, undefined)
  assert.equal(areaAtLimit.floorAreaSquareMeters, 300)
  ;['15.002', '15.004'].forEach((widthMeters) => {
    const result = calculateVenue({ lengthMeters: '20', widthMeters })
    assert.match(result.error, /面积不超过 300 m²/)
  })

  const noFill = calculateVenue({ firstListeningDistanceMeters: '3', lastListeningDistanceMeters: '6' })
  const oneFillGroup = calculateVenue({ firstListeningDistanceMeters: '3', lastListeningDistanceMeters: '8' })
  const twoFillGroups = calculateVenue({
    firstListeningDistanceMeters: '1',
    lastListeningDistanceMeters: '11',
    listeningWidthMeters: '6',
  })
  assert.equal(noFill.fillCount, 0)
  assert.deepEqual(noFill.speakerRecommendation.fillPlacementGroups, [])
  assert.equal(oneFillGroup.fillCount, 2)
  assert.deepEqual(oneFillGroup.speakerRecommendation.fillPlacementGroups.map((group) => group.mainToFillDistanceMeters), [6.4])
  assert.equal(twoFillGroups.fillCount, 4)
  assert.deepEqual(twoFillGroups.speakerRecommendation.fillPlacementGroups.map((group) => group.mainToFillDistanceMeters), [3, 6.4])
  // The selected baseline layout can remain geometrically valid even when
  // other finite candidates exceed 120°; keep this as a review-only case.
  const shallowListeningGeometry = calculateVenue({
    firstListeningDistanceMeters: '0.1',
    lastListeningDistanceMeters: '0.15',
  })
  assert.equal(shallowListeningGeometry.error, undefined)
  assert.equal(shallowListeningGeometry.fillCount, 0)
  assert(shallowListeningGeometry.minimumHorizontalCoverageRaw < 120)
  assert.equal(shallowListeningGeometry.speakerRecommendation.hasMainMatch, false)
  assert.match(shallowListeningGeometry.reviewWarnings[0], /标称角仅作几何筛选/)
  assert.match(shallowListeningGeometry.reviewWarnings[1], /没有同时满足/)

  const overLimitFillGeometry = calculateVenue({
    lengthMeters: '18',
    widthMeters: '10',
    layout: 'long',
    firstListeningDistanceMeters: '1',
    lastListeningDistanceMeters: '2.4',
    listeningWidthMeters: '18',
  })
  assert.match(overLimitFillGeometry.error, /超过自动布置上限 120°/)
  assert.equal(overLimitFillGeometry.fillCount, undefined)
  const roundedToZeroFillGeometry = calculateVenue({
    lengthMeters: '2',
    widthMeters: '2',
    heightMeters: '3',
    firstListeningDistanceMeters: '0.01',
    lastListeningDistanceMeters: '0.6',
    listeningWidthMeters: '0.01',
  })
  assert.equal(roundedToZeroFillGeometry.error, undefined)
  assert.equal(roundedToZeroFillGeometry.fillCount, 0)
  const overlappingFillGeometry = calculateVenue({
    lengthMeters: '2',
    widthMeters: '2',
    heightMeters: '1.5',
    firstListeningDistanceMeters: '0.01',
    lastListeningDistanceMeters: '0.6',
    listeningWidthMeters: '0.01',
  })
  assert.match(overlappingFillGeometry.error, /补声几何条件不足/)
  const shortDepthWithoutFill = calculateVenue({
    lengthMeters: '2',
    widthMeters: '2',
    heightMeters: '3',
    firstListeningDistanceMeters: '0.19',
    lastListeningDistanceMeters: '0.2',
    listeningWidthMeters: '0.01',
  })
  assert.equal(shortDepthWithoutFill.error, undefined)
  assert.equal(shortDepthWithoutFill.fillCount, 0)

  ;['topReserveMeters', 'bottomReserveMeters', 'frameWidthMeters'].forEach((field) => {
    ;['', '   '].forEach((value) => {
      const result = calculateLed({ [field]: value })
      assert.match(result.error, /请填写有效的/)
    })
    const negative = calculateLed({ [field]: '-0.1' })
    assert.match(negative.error, /不能小于 0/)
  })
  ;[0, '0', ' 0 '].forEach((value) => {
    assert.equal(calculateLed({ topReserveMeters: value }).error, undefined)
    assert.equal(calculateLed({ bottomReserveMeters: value }).error, undefined)
    assert.equal(calculateLed({ frameWidthMeters: value }).error, undefined)
  })
  assert.equal(calculateLed({ frameWidthMeters: undefined }).frameWidthMeters, 0.05)

  // Report-page input -> blur must clear the old result on invalid input and restore it afterwards.
  const venuePage = installPage('../pages/venue/venue')
  venuePage.onLoad()
  assert(venuePage.data.result)
  venuePage.onInput({ currentTarget: { dataset: { field: 'heightText' } }, detail: { value: '0.1' } })
  venuePage.flushCalculate()
  assert.equal(venuePage.data.result, null)
  assert.match(venuePage.data.inputError, /层高必须高于 0\.3 m/)
  venuePage.onInput({ currentTarget: { dataset: { field: 'heightText' } }, detail: { value: '4' } })
  venuePage.flushCalculate()
  assert(venuePage.data.result)
  assert.equal(venuePage.data.inputError, '')
  venuePage.onPickerChange({ currentTarget: { dataset: { field: 'layoutIndex' } }, detail: { value: 1 } })
  venuePage.onInput({ currentTarget: { dataset: { field: 'lengthText' } }, detail: { value: '18' } })
  venuePage.onInput({ currentTarget: { dataset: { field: 'widthText' } }, detail: { value: '10' } })
  venuePage.onInput({ currentTarget: { dataset: { field: 'firstListeningDistanceText' } }, detail: { value: '1' } })
  venuePage.onInput({ currentTarget: { dataset: { field: 'lastListeningDistanceText' } }, detail: { value: '2.4' } })
  venuePage.onInput({ currentTarget: { dataset: { field: 'listeningWidthText' } }, detail: { value: '18' } })
  venuePage.flushCalculate()
  assert.equal(venuePage.data.result, null)
  assert.match(venuePage.data.inputError, /超过自动布置上限 120°/)
  venuePage.onPickerChange({ currentTarget: { dataset: { field: 'layoutIndex' } }, detail: { value: 0 } })
  venuePage.onInput({ currentTarget: { dataset: { field: 'lengthText' } }, detail: { value: '12' } })
  venuePage.onInput({ currentTarget: { dataset: { field: 'widthText' } }, detail: { value: '8' } })
  venuePage.onInput({ currentTarget: { dataset: { field: 'listeningWidthText' } }, detail: { value: '7' } })
  venuePage.onInput({ currentTarget: { dataset: { field: 'firstListeningDistanceText' } }, detail: { value: '3' } })
  venuePage.onInput({ currentTarget: { dataset: { field: 'lastListeningDistanceText' } }, detail: { value: '11' } })
  venuePage.flushCalculate()
  assert(venuePage.data.result)

  venuePage.data.planImagePath = 'temp://old-plan.png'
  venuePage.data.planStats = { statusText: '旧方案' }
  venuePage.data.planElevation = { requiredVerticalCoverageDeg: 30 }
  venuePage.data.resultReportImagePath = 'temp://old-report.png'
  venuePage.data.resultReportPreviewVisible = true
  venuePage.data.isGeneratingResultReport = true
  venuePage.resultReportSignature = 'old-result-report'
  venuePage.resultReportPendingSignature = 'old-result-report'
  venuePage.onInput({ currentTarget: { dataset: { field: 'lengthText' } }, detail: { value: '20' } })
  venuePage.onInput({ currentTarget: { dataset: { field: 'widthText' } }, detail: { value: '15.002' } })
  venuePage.flushCalculate()
  assert.equal(venuePage.data.result, null)
  assert.match(venuePage.data.inputError, /面积不超过 300 m²/)
  assert.equal(venuePage.data.planImagePath, '')
  assert.equal(venuePage.data.planStats, null)
  assert.equal(venuePage.data.planElevation, null)
  assert.equal(venuePage.data.resultReportImagePath, '')
  assert.equal(venuePage.data.resultReportPreviewVisible, false)
  assert.equal(venuePage.data.isGeneratingResultReport, false)
  assert.equal(venuePage.resultReportSignature, '')
  assert.equal(venuePage.resultReportPendingSignature, '')
  venuePage.onInput({ currentTarget: { dataset: { field: 'lengthText' } }, detail: { value: '12' } })
  venuePage.onInput({ currentTarget: { dataset: { field: 'widthText' } }, detail: { value: '8' } })
  venuePage.flushCalculate()
  assert(venuePage.data.result)

  // LED-page input -> blur follows the same invalid-result clearing and recovery contract.
  const ledPage = installPage('../pages/led-screen/led-screen')
  ledPage.onLoad()
  assert(ledPage.data.result)
  ledPage.data.reportImagePath = 'temp://old-led-report.png'
  ledPage.data.reportPreviewVisible = true
  ledPage.data.isGeneratingReport = true
  ledPage.reportSignature = 'old-led-report'
  ledPage.reportPendingSignature = 'old-led-report'
  ledPage.onFieldInput({ currentTarget: { dataset: { field: 'topReserveText' } }, detail: { value: '' } })
  ledPage.onFieldBlur()
  assert.equal(ledPage.data.result, null)
  assert.match(ledPage.data.inputError, /请填写有效的上方预留空间/)
  assert.equal(ledPage.data.reportImagePath, '')
  assert.equal(ledPage.data.reportPreviewVisible, false)
  assert.equal(ledPage.data.isGeneratingReport, false)
  assert.equal(ledPage.reportSignature, '')
  assert.equal(ledPage.reportPendingSignature, '')
  ledPage.onFieldInput({ currentTarget: { dataset: { field: 'topReserveText' } }, detail: { value: '0' } })
  ledPage.onFieldBlur()
  assert(ledPage.data.result)
  assert.equal(ledPage.data.inputError, '')
  ledPage.onFieldInput({ currentTarget: { dataset: { field: 'frameWidthText' } }, detail: { value: '' } })
  ledPage.onFieldBlur()
  assert.equal(ledPage.data.result, null)
  assert.match(ledPage.data.inputError, /请填写有效的四周包边尺寸/)
  ledPage.onFieldInput({ currentTarget: { dataset: { field: 'frameWidthText' } }, detail: { value: '5' } })
  ledPage.onFieldBlur()
  assert(ledPage.data.result)
  venuePage.onUnload()
  ledPage.onUnload()
  assert.equal(venuePage.venueCalculateTimer, null)
  assert.equal(ledPage.inputCalculationTimer, null)

  console.log('calculation boundary regression PASS')
} finally {
  global.Page = originalPage
  global.wx = originalWx
}
