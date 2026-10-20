'use strict'

const { getBasisTool } = require('../../utils/tool-registry')
const { buildBasisPresentation } = require('./presentation')

function currentRoute(page) {
  const route = page && typeof page.route === 'string' ? page.route : ''
  return route.replace(/^\//, '')
}

Page({
  data: {
    basisTool: null,
    presentation: null,
    notFound: false,
  },

  onLoad(options = {}) {
    const basisTool = getBasisTool(options.tool)
    if (!basisTool) {
      this.setData({ basisTool: null, presentation: null, notFound: true })
      return
    }
    this.setData({ basisTool, presentation: buildBasisPresentation(basisTool), notFound: false })
  },

  openTool() {
    const tool = this.data.basisTool
    if (!tool) return
    const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : []
    const previous = pages.length > 1 ? pages[pages.length - 2] : null
    if (currentRoute(previous) === tool.path.replace(/^\//, '')) {
      wx.navigateBack({ delta: 1 })
      return
    }
    wx.navigateTo({ url: tool.path })
  },
})
