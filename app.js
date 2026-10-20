const { initializePrimaryNavigation } = require('./utils/primary-navigation')

App({
  globalData: {
    primaryNavigation: { launchPath: '', restoreAllowed: false, restoreChecked: true },
  },
  onLaunch(options = {}) {
    this.globalData.primaryNavigation = initializePrimaryNavigation(options)
  },
})
