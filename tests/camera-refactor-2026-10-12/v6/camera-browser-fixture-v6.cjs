'use strict'

const { createCameraFixtureV5 } = require('../browser-fixtures-v5.cjs')

function installMeasuredCanvasAdapter(env) {
  const createCanvasContext = env.wx.createCanvasContext
  const adapterState = { contexts: [] }
  env.__cameraV6CanvasAdapter = adapterState
  env.wx.createCanvasContext = (...args) => {
    const context = createCanvasContext(...args)
    const contextState = { canvasId: String(args[0] || ''), measureCalls: 0 }
    adapterState.contexts.push(contextState)
    const originalSetFontSize = context.setFontSize.bind(context)
    let fontSize = 14
    context.setFontSize = (value) => {
      const parsed = Number(value)
      if (Number.isFinite(parsed) && parsed > 0) fontSize = parsed
      return originalSetFontSize(value)
    }
    context.measureText = (value) => {
      contextState.measureCalls += 1
      const width = [...String(value)].reduce((sum, character) => {
        return sum + (/^[\u2e80-\u9fff\uff00-\uffef]$/.test(character) ? fontSize : fontSize * 0.56)
      }, 0)
      return {
        width,
        actualBoundingBoxAscent: fontSize * 0.8,
        actualBoundingBoxDescent: fontSize * 0.22,
      }
    }
    return context
  }
}

function createCameraFixtureV6(caseName, width = 390, height = 844, options = {}) {
  const fixture = createCameraFixtureV5(caseName, width, height, options)
  installMeasuredCanvasAdapter(fixture.env)
  return fixture
}

module.exports = { createCameraFixtureV6 }
