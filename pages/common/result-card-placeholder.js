'use strict'

const STYLE = 'resultAreaStyle'

function current(p, r, n) {
  const d = p && p.data
  return !!(d && p._pageVisible && !p._isUnloaded && !p._ledUnloaded
    && p._resultCardMeasure === n && d.result === r && !d.inputPending
    && !d.isCalculationPending && d.canUseResultActions !== false)
}

function measure(p) {
  const r = p && p.data && p.data.result
  if (!r || typeof wx === 'undefined' || !wx.createSelectorQuery) return
  const n = p._resultCardMeasure = (p._resultCardMeasure || 0) + 1
  if (!current(p, r, n)) return
  try {
    wx.createSelectorQuery().in(p).select('.result-card').boundingClientRect((rect) => {
      if (!current(p, r, n)) return
      const h = Number(rect && rect.height)
      if (Number.isFinite(h) && h > 0) {
        const s = `min-height:${Math.ceil(h)}px;`
        if (p.data[STYLE] !== s) p.setData({ [STYLE]: s })
      }
    }).exec()
  } catch (error) {}
}

module.exports = measure
