'use strict'

const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const source = require('../pages/products/data/model-cross-reference')
const outputPath = path.join(root, 'data/model-alias-search-index.js')

function isSearchable(value) {
  return value !== null && value !== undefined
    && String(value).trim() !== '' && String(value).trim() !== '/'
}

function assertEncodable(value, model, field) {
  const text = String(value)
  if (/[|\r\n]/.test(text)) {
    throw new Error(`型号对照索引无法编码：型号 ${JSON.stringify(model)} 的${field} ${JSON.stringify(text)} 含保留分隔符 |、CR 或 LF`)
  }
  return text
}

function buildPackedIndex(data) {
  const models = new Map()
  const ensureModel = (model) => {
    const canonicalModel = assertEncodable(model, model, '原型号')
    if (!models.has(canonicalModel)) models.set(canonicalModel, [])
    return canonicalModel
  }
  const addValue = (model, value) => {
    const canonicalModel = ensureModel(model)
    if (value !== null && value !== undefined) {
      assertEncodable(value, canonicalModel, '对照型号')
    }
    if (!isSearchable(value)) return
    const aliases = models.get(canonicalModel)
    const alias = String(value)
    if (!aliases.includes(alias)) aliases.push(alias)
  }

  Object.entries(data.records || {}).forEach(([model, references]) => {
    ensureModel(model)
    ;(Array.isArray(references) ? references : []).forEach((reference) => {
      ;(Array.isArray(reference.values) ? reference.values : []).forEach((pair) => {
        ;(Array.isArray(pair) ? pair : []).forEach((value) => addValue(model, value))
      })
    })
  })
  Object.entries(data.historical || {}).forEach(([model, references]) => {
    ensureModel(model)
    ;(Array.isArray(references) ? references : []).forEach((reference) => {
      addValue(model, reference.targetModel)
    })
  })

  return [...models].map(([model, aliases]) => (
    [model, ...aliases.filter((alias) => alias !== model)].join('|')
  )).join('\n')
}

const packedIndex = buildPackedIndex(source)

if (require.main === module) {
  const mode = process.argv[2]
  if (mode === '--check') {
    const currentIndex = require('../data/model-alias-search-index')
    if (currentIndex !== packedIndex) {
      process.stderr.write('型号对照索引已过期；运行 node tests/generate-model-alias-search-index.cjs 重建。\n')
      process.exitCode = 1
    } else {
      process.stdout.write(`型号对照索引一致（${packedIndex.split('\n').length} 个型号）。\n`)
    }
  } else if (mode === undefined) {
    fs.writeFileSync(outputPath, `module.exports = ${JSON.stringify(packedIndex)}\n`, 'utf8')
    process.stdout.write(`已写入 ${path.relative(root, outputPath)}（${packedIndex.split('\n').length} 个型号）。\n`)
  } else {
    process.stderr.write('用法：node tests/generate-model-alias-search-index.cjs [--check]\n')
    process.exitCode = 2
  }
}

module.exports = { buildPackedIndex }
