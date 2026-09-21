const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '../..')
const sourcePath = path.join(root, 'docs/catalog-source/stage-lighting.json')
const outputPath = path.join(root, 'data/stage-lighting.js')

function render(source) {
  if (!Array.isArray(source) || !source.every((product) => product && typeof product === 'object' && !Array.isArray(product))) {
    throw new Error('Catalog source must be an array of ordinary product objects')
  }
  const schemas = []
  const schemaIds = new Map()
  const rows = source.map((product, rowIndex) => {
    const keys = Object.keys(product)
    const schemaSignature = JSON.stringify(keys)
    let schemaIndex = schemaIds.get(schemaSignature)
    if (schemaIndex === undefined) {
      schemaIndex = schemas.length
      schemaIds.set(schemaSignature, schemaIndex)
      schemas.push(keys)
    }
    const values = keys.map((key) => product[key])
    if (values.length !== keys.length) throw new Error(`Invalid catalog row ${rowIndex}`)
    return [schemaIndex, values]
  })

  const lines = [
    '// Generated from docs/catalog-source/stage-lighting.json. Do not edit directly.',
    '// Regenerate with: node tests/package-reclaim/generate-stage-lighting.cjs',
    `const propertySchemas = ${JSON.stringify(schemas)}`,
    'const productRows = [',
    ...rows.map((row) => `  ${JSON.stringify(row)},`),
    ']',
    'const stageLightingProducts = productRows.map(([schemaIndex, values]) => {',
    '  const product = {}',
    '  const keys = propertySchemas[schemaIndex]',
    '  keys.forEach((key, index) => { product[key] = values[index] })',
    '  return product',
    '})',
    "const stageLightingProductIndex = new Map(stageLightingProducts.map((item) => [item.model, item]))",
    "const dmxFixtures = stageLightingProducts.filter((item) => item.categoryKey === 'fixture' && item.channelModes.length)",
    'module.exports = {',
    '  dmxFixtures,',
    '  stageLightingProductIndex,',
    '  stageLightingProducts,',
    '}',
  ]
  return `${lines.join('\n')}\n`
}

function main(args) {
  const sourceIndex = args.indexOf('--source')
  const outputIndex = args.indexOf('--output')
  const sourceFile = sourceIndex >= 0 ? args[sourceIndex + 1] : sourcePath
  const outputFile = outputIndex >= 0 ? args[outputIndex + 1] : outputPath
  const expected = render(JSON.parse(fs.readFileSync(sourceFile, 'utf8')))
  if (args.includes('--check')) {
    const actual = fs.readFileSync(outputFile, 'utf8')
    if (actual !== expected) {
      console.error(`${path.relative(root, outputFile)} is stale; run the catalog generator`)
      process.exitCode = 1
    } else {
      console.log('stage-lighting generated data is current')
    }
  } else {
    fs.writeFileSync(outputFile, expected, 'utf8')
    console.log(`generated ${path.relative(root, outputFile)} (${Buffer.byteLength(expected)} bytes)`)
  }
}

module.exports = { render }
if (require.main === module) main(process.argv.slice(2))
