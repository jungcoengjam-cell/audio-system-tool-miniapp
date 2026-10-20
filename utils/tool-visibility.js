'use strict'

const { getTools, getTool } = require('./tool-registry')
const TOOL_VISIBILITY_KEY = 'audioTool.toolVisibility.v1'

function readToolVisibility() {
  try {
    const stored = wx.getStorageSync(TOOL_VISIBILITY_KEY)
    if (stored === undefined || stored === null || stored === '') return { ok: true, hiddenIds: [] }
    if (stored.version !== 1 || !Array.isArray(stored.hiddenToolIds)
      || stored.hiddenToolIds.some(id => typeof id !== 'string')) {
      return { ok: false, hiddenIds: [], error: '工具显示设置暂不可用，请在设置中重试或恢复默认。' }
    }
    return { ok: true, hiddenIds: [...new Set(stored.hiddenToolIds)] }
  } catch (error) {
    return { ok: false, hiddenIds: [], error: '读取工具显示设置失败，请重试。' }
  }
}

function getVisibleTools(category, visibility = readToolVisibility()) {
  const hidden = new Set(visibility.ok ? visibility.hiddenIds : [])
  return getTools(category).filter(tool => !hidden.has(tool.id))
}

function setToolVisible(id, visible) {
  if (!getTool(id) || typeof visible !== 'boolean') return false
  const state = readToolVisibility()
  if (!state.ok) return false
  const hidden = new Set(state.hiddenIds)
  if (visible) hidden.delete(id)
  else hidden.add(id)
  try {
    wx.setStorageSync(TOOL_VISIBILITY_KEY, { version: 1, hiddenToolIds: [...hidden] })
    return true
  } catch (error) {
    return false
  }
}

function resetToolVisibility() {
  try {
    wx.removeStorageSync(TOOL_VISIBILITY_KEY)
    return true
  } catch (error) {
    return false
  }
}

module.exports = { TOOL_VISIBILITY_KEY, readToolVisibility, getVisibleTools, setToolVisible, resetToolVisibility }
