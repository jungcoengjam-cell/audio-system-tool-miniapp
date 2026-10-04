const { catalog } = require('./catalog')
const { developmentSampleCatalog } = require('./development-sample')

function selectProtocolCatalog(envVersion, formalCatalog = catalog, developmentCatalog = developmentSampleCatalog) {
  return envVersion === 'develop' ? developmentCatalog : formalCatalog
}

function getCurrentEnvVersion() {
  try {
    return wx.getAccountInfoSync().miniProgram.envVersion
  } catch (error) {
    return ''
  }
}

const runtimeCatalog = selectProtocolCatalog(getCurrentEnvVersion())

module.exports = {
  catalog: runtimeCatalog,
  selectProtocolCatalog,
}
