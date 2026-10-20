'use strict'

const STORAGE_KEY = 'audioTool.primaryTab.v1'
const DEFAULT_LAUNCH_ROUTE = 'pages/tools/tools'
const PRIMARY_TABS = Object.freeze([
  { id: 'tools', label: '工具', route: '/pages/tools/tools' },
  { id: 'projects', label: '项目', route: '/pages/projects/projects' },
  { id: 'basis', label: '依据', route: '/pages/index/index' },
])
const TAB_BY_ID = new Map(PRIMARY_TABS.map((tab) => [tab.id, tab]))
const TAB_BY_ROUTE = new Map(PRIMARY_TABS.map((tab) => [tab.route, tab]))

function resolvePrimaryTab(value) {
  if (typeof value !== 'string') return null
  const normalized = value.trim().replace(/^\//, '').split('?')[0]
  if (!normalized) return null
  return TAB_BY_ID.get(normalized) || TAB_BY_ROUTE.get(`/${normalized}`) || null
}

function normalizeLaunchPath(value) {
  if (typeof value !== 'string') return ''
  return value.trim().replace(/^\/+/, '').split('?')[0].replace(/\/+$/, '')
}

function initializePrimaryNavigation(options = {}) {
  if (!options || typeof options !== 'object') options = {}
  const launchPath = normalizeLaunchPath(options.path)
  const query = options.query && typeof options.query === 'object' ? options.query : null
  const hasQuery = Boolean((query && Object.keys(query).length) || (typeof options.path === 'string' && options.path.includes('?')))
  // Distinct deep links have a different path or query. A bare deep link to
  // this exact default route is indistinguishable from ordinary app entry by
  // path/query alone; avoid maintaining an incomplete scene-value allowlist.
  const defaultEntry = launchPath === DEFAULT_LAUNCH_ROUTE && !hasQuery
  return {
    launchPath,
    restoreAllowed: defaultEntry,
    restoreChecked: !defaultEntry,
  }
}

function readLastPrimaryTab() {
  try {
    if (typeof wx === 'undefined' || typeof wx.getStorageSync !== 'function') return null
    return resolvePrimaryTab(wx.getStorageSync(STORAGE_KEY))
  } catch (error) {
    return null
  }
}

function savePrimaryTab(value) {
  const tab = resolvePrimaryTab(value)
  if (!tab) return false
  try {
    if (typeof wx === 'undefined' || typeof wx.setStorageSync !== 'function') return false
    wx.setStorageSync(STORAGE_KEY, tab.id)
    return true
  } catch (error) {
    return false
  }
}

/**
 * Call at the top of each primary tab's onShow. Only a default app launch may
 * restore the last valid tab. Explicit page launches keep their route and the
 * next user-selected tab becomes the new preference. This never reads or
 * writes project or calculator state.
 */
function activatePrimaryTab(value) {
  const current = resolvePrimaryTab(value)
  if (!current) return false

  let app = null
  try {
    if (typeof getApp === 'function') app = getApp()
  } catch (error) {
    app = null
  }
  if (app && app.globalData) {
    if (!app.globalData.primaryNavigation) {
      app.globalData.primaryNavigation = { launchPath: '', restoreAllowed: false, restoreChecked: true }
    }
    const state = app.globalData.primaryNavigation
    if (!state.restoreChecked) {
      state.restoreChecked = true
      const saved = state.restoreAllowed ? readLastPrimaryTab() : null
      if (saved && saved.id !== current.id && typeof wx !== 'undefined' && typeof wx.switchTab === 'function') {
        try {
          wx.switchTab({
            url: saved.route,
            fail: () => savePrimaryTab(current.id),
          })
          return false
        } catch (error) {
          // The current tab remains usable when an older route cannot be restored.
        }
      }
    }
  }

  savePrimaryTab(current.id)
  return true
}

module.exports = {
  PRIMARY_TABS,
  STORAGE_KEY,
  activatePrimaryTab,
  initializePrimaryNavigation,
  normalizeLaunchPath,
  readLastPrimaryTab,
  resolvePrimaryTab,
  savePrimaryTab,
}
