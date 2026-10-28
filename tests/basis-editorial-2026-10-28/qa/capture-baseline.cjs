'use strict'

// One-time baseline capture. It refuses to replace any existing fixture.
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const crypto = require('node:crypto')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')

const root = path.resolve(__dirname, '../../..')
const outputDir = path.join(__dirname, 'baseline')
const contentPath = path.join(outputDir, 'content.json')
const imagePath = path.join(outputDir, 'images.json')
const registryPath = path.join(root, 'utils/tool-registry.js')
const presentationPath = path.join(root, 'pages/basis/presentation.js')
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
const ids = ['cable', 'gainStructure', 'limiter', 'spl', 'camera', 'ledScreen']

if (fs.existsSync(contentPath) || fs.existsSync(imagePath)) {
  console.log(JSON.stringify({ skipped: true, reason: 'Existing frozen baseline files are preserved', contentPath, imagePath }, null, 2))
  process.exit(0)
}

const { getTool } = require(path.join(root, 'utils/tool-registry.js'))
// `presentation.js` is clean in the starting revision, while it is being edited
// in parallel for this task. Load its original version from HEAD to keep the
// fixture independent from the live presentation refactor.
const originalPresentationSource = execFileSync('git', ['show', 'HEAD:pages/basis/presentation.js'], { cwd: root, encoding: 'utf8' })
const originalPresentationModule = new Module(presentationPath, module)
originalPresentationModule.filename = presentationPath
originalPresentationModule.paths = Module._nodeModulePaths(path.dirname(presentationPath))
originalPresentationModule._compile(originalPresentationSource, presentationPath)
const { buildBasisPresentation } = originalPresentationModule.exports
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex')

const tools = ids.map((id) => {
  const tool = getTool(id)
  assert(tool && tool.basis, `Missing calculation basis: ${id}`)
  return {
    id,
    title: tool.title,
    category: tool.category,
    route: tool.path,
    icon: tool.icon,
    basis: tool.basis,
    presentation: buildBasisPresentation(tool),
  }
})

const content = {
  schemaVersion: 1,
  baselineRevision: revision,
  capturedFrom: 'utils/tool-registry.js + pages/basis/presentation.js',
  sourceSha256: {
    registry: sha256(fs.readFileSync(registryPath)),
    presentation: sha256(originalPresentationSource),
  },
  tools,
}

const images = {
  schemaVersion: 1,
  capturedFrom: 'pages/basis/assets/<tool-id>.png before editorial image replacement',
  images: ids.map((id) => {
    const relative = `pages/basis/assets/${id}.png`
    const file = path.join(root, relative)
    const bytes = fs.readFileSync(file)
    assert.equal(bytes.toString('hex', 0, 8), '89504e470d0a1a0a', `Not a PNG: ${relative}`)
    return {
      id,
      path: relative,
      width: bytes.readUInt32BE(16),
      height: bytes.readUInt32BE(20),
      byteLength: bytes.length,
      sha256: sha256(bytes),
    }
  }),
}

fs.mkdirSync(outputDir, { recursive: true })
fs.writeFileSync(contentPath, `${JSON.stringify(content, null, 2)}\n`, { flag: 'wx' })
fs.writeFileSync(imagePath, `${JSON.stringify(images, null, 2)}\n`, { flag: 'wx' })
console.log(JSON.stringify({ contentPath, imagePath, tools: tools.length, images: images.images }, null, 2))
