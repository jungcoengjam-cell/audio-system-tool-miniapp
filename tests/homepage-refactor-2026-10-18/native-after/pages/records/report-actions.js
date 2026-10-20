function saveReportPages(options = {}) {
  const pages = Array.isArray(options.pages) ? options.pages : []
  const saveImage = options.saveImage
  const savedIndexes = new Set(Array.isArray(options.savedIndexes) ? options.savedIndexes : [])
  if (!pages.length || typeof saveImage !== 'function') {
    return Promise.resolve({
      savedIndexes: [...savedIndexes],
      complete: false,
      failedIndex: null,
      canceled: false,
      error: '当前环境暂不支持保存报告图片。',
    })
  }

  let index = 0
  const saveNext = () => {
    while (index < pages.length && savedIndexes.has(index)) index += 1
    if (index >= pages.length) {
      return Promise.resolve({
        savedIndexes: [...savedIndexes].sort((a, b) => a - b),
        complete: true,
        failedIndex: null,
        canceled: false,
        error: '',
      })
    }
    const currentIndex = index
    let shouldContinue = true
    const guards = [options.isCurrent, options.shouldContinue].filter((guard) => typeof guard === 'function')
    for (const guard of guards) {
      try {
        if (guard() === false) shouldContinue = false
      } catch (error) {
        shouldContinue = false
      }
    }
    if (!shouldContinue) {
      return Promise.resolve({
        savedIndexes: [...savedIndexes].sort((a, b) => a - b),
        complete: false,
        failedIndex: currentIndex,
        canceled: true,
        error: '保存任务已停止。',
      })
    }
    const page = pages[currentIndex]
    if (!page?.path) {
      return Promise.resolve({
        savedIndexes: [...savedIndexes].sort((a, b) => a - b),
        complete: false,
        failedIndex: currentIndex,
        canceled: false,
        error: '报告图片路径无效。',
      })
    }
    if (typeof options.onProgress === 'function') {
      options.onProgress({ currentIndex, completedCount: savedIndexes.size, pageCount: pages.length })
    }
    return Promise.resolve()
      .then(() => saveImage(page.path, currentIndex))
      .then(() => {
        savedIndexes.add(currentIndex)
        index = currentIndex + 1
        if (typeof options.onSaved === 'function') {
          options.onSaved({ currentIndex, completedCount: savedIndexes.size, pageCount: pages.length })
        }
        return saveNext()
      }, (error) => {
        const errMsg = String(error?.errMsg || error?.message || '')
        return {
          savedIndexes: [...savedIndexes].sort((a, b) => a - b),
          complete: false,
          failedIndex: currentIndex,
          canceled: /cancel/i.test(errMsg),
          error: errMsg || '保存失败。',
        }
      })
  }
  return saveNext()
}

function saveWxImageToAlbum(imagePath) {
  return new Promise((resolve, reject) => {
    if (!imagePath || typeof wx.saveImageToPhotosAlbum !== 'function') {
      reject(new Error('当前微信版本暂不支持保存图片。'))
      return
    }
    wx.saveImageToPhotosAlbum({
      filePath: imagePath,
      success: resolve,
      fail: reject,
    })
  })
}

function saveErrorNeedsSettings(error) {
  if (typeof error === 'string') {
    return /auth|authorize|permission|deny|scope\.writePhotosAlbum/i.test(error)
  }
  return /auth|authorize|permission|deny|scope\.writePhotosAlbum/i.test(
    String(error?.errMsg || error?.message || ''),
  )
}

module.exports = {
  saveErrorNeedsSettings,
  saveReportPages,
  saveWxImageToAlbum,
}
