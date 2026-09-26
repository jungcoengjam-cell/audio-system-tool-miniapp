const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const root = path.resolve(__dirname, '../../../..')
const config = JSON.parse(fs.readFileSync(path.join(root, 'project.config.json'), 'utf8'))
const appConfig = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'))
const productionPaths = ['utils/gain-structure.js', 'utils/limiter.js', 'utils/spl.js', 'utils/camera-fov.js']
const budgets = { total: 2067 * 1024, mainJavaScript: 818 * 1024, subPackageJavaScript: 794 * 1024, wxss: 261 * 1024, wxml: 246 * 1024, media: 338 * 1024, singleJavaScript: 100 * 1024 }
const subPackages = appConfig.subPackages || []
const ignore = config.packOptions?.ignore || []
function walk(directory, files = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === '.git') continue
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) walk(absolute, files)
    else files.push(absolute)
  }
  return files
}
function relative(file) { return path.relative(root, file).replaceAll(path.sep, '/') }
function ignored(file) {
  const value = relative(file)
  return ignore.some((rule) => rule.type === 'folder'
    ? value === rule.value || value.startsWith(`${rule.value}/`)
    : value === rule.value)
}
const files = walk(root).filter((file) => !ignored(file))
const productionDelta = Object.fromEntries(productionPaths.map((name) => {
  const current = fs.statSync(path.join(root, name)).size
  const before = execFileSync('git', ['show', `HEAD:${name}`], { cwd: root }).length
  return [name, { beforeBytes: before, afterBytes: current, deltaBytes: current - before }]
}))
const deltaBytes = Object.values(productionDelta).reduce((sum, item) => sum + item.deltaBytes, 0)
const totalBytes = files.reduce((sum, file) => sum + fs.statSync(file).size, 0)
const mainPackageFiles = files.filter((file) => !subPackages.some((item) => (
  relative(file) === item.root || relative(file).startsWith(`${item.root}/`)
)))
const jsBytes = (group) => group.filter((file) => path.extname(file).toLowerCase() === '.js')
  .reduce((sum, file) => sum + fs.statSync(file).size, 0)
const mainJsBytes = jsBytes(mainPackageFiles)
const extensionBytes = Object.fromEntries(['.wxss', '.wxml'].map((extension) => [extension,
  files.filter((file) => path.extname(file).toLowerCase() === extension)
    .reduce((sum, file) => sum + fs.statSync(file).size, 0),
]))
const mediaBytes = files.filter((file) => /\.(png|jpe?g|gif|bmp|webp|mp3|wav|aac|m4a)$/i.test(file))
  .reduce((sum, file) => sum + fs.statSync(file).size, 0)
const javascriptFiles = files.filter((file) => path.extname(file).toLowerCase() === '.js')
  .map((file) => ({ path: relative(file), bytes: fs.statSync(file).size }))
  .sort((left, right) => right.bytes - left.bytes)
const result = {
  accounting: 'same effective file and package grouping rules as tests/release-check.js',
  packageFiles: files.length,
  totalBytes: { before: totalBytes - deltaBytes, after: totalBytes, delta: deltaBytes, limit: budgets.total, remaining: budgets.total - totalBytes },
  mainPackageJavaScriptBytes: { before: mainJsBytes - deltaBytes, after: mainJsBytes, delta: deltaBytes, limit: budgets.mainJavaScript, remaining: budgets.mainJavaScript - mainJsBytes },
  subPackages: Object.fromEntries(subPackages.map((item) => [item.root, {
    javascriptBytes: jsBytes(files.filter((file) => relative(file) === item.root || relative(file).startsWith(`${item.root}/`))),
    deltaBytes: 0,
  }])),
  wxssBytes: { before: extensionBytes['.wxss'], after: extensionBytes['.wxss'], delta: 0, limit: budgets.wxss, remaining: budgets.wxss - extensionBytes['.wxss'] },
  wxmlBytes: { before: extensionBytes['.wxml'], after: extensionBytes['.wxml'], delta: 0, limit: budgets.wxml, remaining: budgets.wxml - extensionBytes['.wxml'] },
  mediaBytes: { before: mediaBytes, after: mediaBytes, delta: 0, limit: budgets.media, remaining: budgets.media - mediaBytes },
  largestJavaScript: { ...javascriptFiles[0], deltaBytes: 0, limit: budgets.singleJavaScript, remaining: budgets.singleJavaScript - javascriptFiles[0].bytes },
  productionFiles: productionDelta,
}
result.sha256 = crypto.createHash('sha256').update(JSON.stringify(result, null, 2) + '\n').digest('hex')
fs.writeFileSync(path.join(__dirname, 'package-accounting.json'), JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify({ totalBytes: result.totalBytes, mainPackageJavaScriptBytes: result.mainPackageJavaScriptBytes, largestJavaScript: result.largestJavaScript, productionFiles: result.productionFiles }, null, 2))
