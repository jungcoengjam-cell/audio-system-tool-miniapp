'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { validateAll, hashDataset, expectedFileHashes, constants } = require('./validate.cjs')

const output = constants.FREEZE_PATH
const result = validateAll()
if (!result.valid) {
  process.stderr.write(`Refusing to freeze: ${result.errors.length} validation error(s).\n`)
  for (const error of result.errors) process.stderr.write(`ERROR ${error}\n`)
  process.exit(1)
}

const manifest = {
  version: '1.0',
  phase: 'P2-A',
  baseCommit: 'e89d57a492bb776fed35809eed91741715e828b0',
  caseCount: result.cases.length,
  datasetSha256: hashDataset(result.cases),
  canonicalization: 'Cases sorted by id; recursively sort object keys; preserve array order; compact UTF-8 JSON with final LF',
  inferenceExecuted: false,
  files: expectedFileHashes(result.cases)
}

try {
  const fd = fs.openSync(output, 'wx')
  try { fs.writeFileSync(fd, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8') } finally { fs.closeSync(fd) }
} catch (error) {
  if (error.code === 'EEXIST') {
    process.stderr.write(`Refusing to overwrite existing freeze manifest: ${path.basename(output)}\n`)
    process.exit(1)
  }
  throw error
}
process.stdout.write(`Created ${path.basename(output)} for ${manifest.caseCount} validated synthetic cases.\n`)
