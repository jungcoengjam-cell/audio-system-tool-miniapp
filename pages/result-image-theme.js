'use strict'

function isSupportedTheme(theme) {
  return theme === 'light' || theme === 'dark'
}

const DARK_RESULT_COLORS = {
  '#f5f5f7': '#111214', '#ffffff': '#1c1d20', '#e5e5ea': '#3b3e42',
  '#eaf7f5': '#18332f', '#c5e5de': '#2c6257', '#eef6ff': '#1b2d3e',
  '#d6e5f4': '#38536d', '#1d1d1f': '#f2f3f5', '#6e6e73': '#c4c7cc',
  '#087f70': '#5bd0b9', '#fff4e5': '#382817', '#8a5700': '#ffd08a',
  '#f0d4ad': '#70512d',
}

function getResultImageTheme(wxApi = typeof wx === 'undefined' ? null : wx) {
  if (!wxApi) return 'light'
  for (const method of ['getAppBaseInfo', 'getSystemInfoSync']) {
    try {
      const info = typeof wxApi[method] === 'function' ? wxApi[method]() : null
      if (isSupportedTheme(info && info.theme)) return info.theme
    } catch (error) {}
  }
  return 'light'
}

module.exports = { DARK_RESULT_COLORS, getResultImageTheme }
