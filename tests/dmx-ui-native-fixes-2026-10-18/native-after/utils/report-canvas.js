function drawAndExportReport(page, options) {
  const {
    canvasId,
    isCurrent,
    width,
    height,
    draw,
    getExportOptions,
    startExportMeasurement,
    onSuccess,
    onFailure,
  } = options
  const context = wx.createCanvasContext(canvasId, page)
  draw(context)
  context.draw(false, () => {
    if (!isCurrent()) return
    const exportOptions = getExportOptions()
    const finishExport = startExportMeasurement(exportOptions)
    wx.canvasToTempFilePath({
      canvasId,
      width,
      height,
      ...exportOptions,
      fileType: 'png',
      quality: 1,
      success: ({ tempFilePath }) => {
        if (!isCurrent()) return
        finishExport({ success: Boolean(tempFilePath) })
        if (tempFilePath) onSuccess(tempFilePath)
        else onFailure()
      },
      fail: () => {
        if (!isCurrent()) return
        finishExport({ success: false })
        onFailure()
      },
    }, page)
  })
}

module.exports = { drawAndExportReport }
