const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const harnessRoot = __dirname
const root = path.resolve(harnessRoot, '../..')
const evidenceRoot = path.join(harnessRoot, 'evidence/module-refinements-2026-10-16')
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex')

function listSources() {
  const pageDir = path.join(root, 'pages/project-wiring')
  const names = fs.readdirSync(pageDir)
    .filter((name) => /\.(?:js|wxml|wxss|json)$/.test(name))
    .map((name) => 'pages/project-wiring/' + name)
  names.push('utils/project-wiring.js', 'utils/records.js', 'app.wxss', 'styles/theme-page-shared.wxss')
  return [...new Set(names)].sort()
}

function sourceManifest() {
  return Object.fromEntries(listSources().map((name) => {
    const bytes = fs.readFileSync(path.join(root, name))
    return [name, { sha256: hash(bytes), bytes: bytes.length }]
  }))
}

function nativeProfile() {
  const priorPath = path.join(harnessRoot, 'evidence/native-fix-2026-10-16/installed-native-source.json')
  const prior = JSON.parse(fs.readFileSync(priorPath, 'utf8'))
  const result = {
    evidenceBasis: 'Freshly re-read the installed WeChat v2 source named in the prior native profile; prior screenshot bundles were not changed.',
    sourcePath: prior.sourcePath,
    expectedSha256: prior.sha256,
    currentSha256: null,
    currentBytes: null,
    matchedPriorNativeSource: false,
    profile: null,
  }
  try {
    const bytes = fs.readFileSync(prior.sourcePath)
    const source = bytes.toString('utf8')
    result.currentSha256 = hash(bytes)
    result.currentBytes = bytes.length
    result.matchedPriorNativeSource = result.currentSha256 === prior.sha256
    const lightDefaultWidth = 'wx-button:not([size=mini]){margin-left:auto;margin-right:auto;width:184px}'
    const darkDisabled = 'wx-button[disabled]:not([type]),wx-button[disabled][type=default]{background-color:hsla(0,0%,100%,.08);color:hsla(0,0%,100%,.2)}'
    const maskLayer = source.match(/\.wx-picker__mask\{[^{}]*background-position:top,bottom[^{}]*\}/g) || []
    const passthrough = source.match(/\.wx-picker__indicator,\.wx-picker__mask\{[^{}]*pointer-events:none[^{}]*\}/g) || []
    result.profile = {
      defaultButtonWidth184px: source.includes(lightDefaultWidth),
      darkDisabledButtonRule: source.includes(darkDisabled),
      pickerMaskGradientLayers: maskLayer.map((rule) => ({ rule, sha256: hash(rule) })),
      pickerOverlayPointerEventsNone: passthrough.map((rule) => ({ rule, sha256: hash(rule) })),
      pickerColumnMaskAndIndicatorMethods: source.includes('_setMaskStyle(') && source.includes('_setIndicatorStyle('),
    }
  } catch (error) {
    result.readError = error.message
  }
  return result
}

function writeJson(name, value) {
  fs.mkdirSync(evidenceRoot, { recursive: true })
  const filename = path.join(evidenceRoot, name)
  fs.writeFileSync(filename, JSON.stringify(value, null, 2))
  return filename
}

module.exports = { root, harnessRoot, evidenceRoot, hash, listSources, sourceManifest, nativeProfile, writeJson }
