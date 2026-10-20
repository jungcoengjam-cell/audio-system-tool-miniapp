function getDraftProtocolPackageResources(packageFiles) {
  return (Array.isArray(packageFiles) ? packageFiles : []).filter((file) => {
    const normalized = String(file).replace(/\\/g, '/')
    return /(?:^|\/)pages\/control-protocol\/development-sample\.js$/.test(normalized)
      || /(?:^|\/)pages\/control-protocol\/development-manual\.js$/.test(normalized)
      || /(?:^|\/)pages\/control-protocol\/development-k100r-manual\.js$/.test(normalized)
      || /(?:^|\/)pages\/control-protocol\/draft-assets\//.test(normalized)
  })
}

function evaluateDraftProtocolPackageGate(packageFiles) {
  const resources = getDraftProtocolPackageResources(packageFiles)
  return {
    resources,
    allowed: resources.length === 0,
  }
}

module.exports = { getDraftProtocolPackageResources, evaluateDraftProtocolPackageGate }
