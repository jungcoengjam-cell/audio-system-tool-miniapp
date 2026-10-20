'use strict'

const { getBasisTools } = require('../../utils/tool-registry')
const { activatePrimaryTab } = require('../../utils/primary-navigation')

Page({
  data: {
    basisTools: getBasisTools(),
  },

  onShow() {
    activatePrimaryTab('basis')
  },
})
