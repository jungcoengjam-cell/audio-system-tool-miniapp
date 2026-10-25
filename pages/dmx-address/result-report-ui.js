'use strict'

function createDmxAddressResultReportUiMethods(dependencies = {}) {
const { resultReportMethods, isPageContextCurrent, vibrate } = dependencies
return {
buildResultReportRecord(result = this._calculationResult, preferences = this.getPreferences()) {
if (!result?.valid) return null
const resultText = result.groups.map((group) => {
const firstFixture = group.fixtures[0]
const lastFixture = group.fixtures[group.fixtures.length - 1]
const endAddress = lastFixture.rangeText.split('–').pop()
const groupDomain = result.allocationMode === 'manual' ? ` · ${group.targetUniverse}域` : ''
return `${group.groupIndex + 1}. ${group.name} · ${group.fixtureCount} 台 × ${group.channelCount} CH${groupDomain} · ${firstFixture.addressText} → ${endAddress}`
}).join('\n')
return {
module: 'dmxAddress',
title: `${result.modeText} · ${result.totalGroups} 组 · ${result.totalFixtures} 台灯具`,
summary: `${result.modeText} · ${result.startText} → ${result.endText} · 下一可用 ${result.nextText}`,
preferences,
resultText,
}
},
...resultReportMethods,
generateResultReportImage() {
this.openSheetModal('resultReportPreview', 'resultReportPreviewClosing')
return resultReportMethods.generateResultReportImage.call(this)
},
closeResultReportPreview() {
this.cancelSheetClose('resultReportPreview', 'resultReportPreviewClosing')
return resultReportMethods.closeResultReportPreview.call(this)
},
onUserCloseResultReportPreview() {
if (!this.data.resultReportPreviewVisible || this.data.resultReportPreviewClosing) return
if (isPageContextCurrent(this)) vibrate('light')
this.beginSheetClose('resultReportPreview', 'resultReportPreviewClosing', () => this.closeResultReportPreview())
},
previewResultReportImage() {
if (this.data.resultReportPreviewClosing) return
return resultReportMethods.previewResultReportImage.call(this)
},
shareResultReportImage() {
if (this.data.resultReportPreviewClosing) return
return resultReportMethods.shareResultReportImage.call(this)
},
saveResultReportImage() {
if (this.data.resultReportPreviewClosing) return
return resultReportMethods.saveResultReportImage.call(this)
}
}
}

module.exports = { createDmxAddressResultReportUiMethods }
