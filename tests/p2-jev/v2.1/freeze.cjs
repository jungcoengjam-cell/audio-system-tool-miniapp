'use strict'

// Creates the V2.1 integrity manifest only after a successful offline validation.
// This file is intentionally never invoked during authoring; the parent task owns freeze approval.
const fs = require('node:fs')
const path = require('node:path')
const v = require('./validate.cjs')
const dir = __dirname
const files = ['schema.json', 'validate.cjs', 'freeze.cjs', 'README.md', 'human-review.json', ...v.constants.datasetPaths.map((p) => path.basename(p))].sort()
const manifest = {
  version: '2.1',
  phase: 'P2-A-V2.1/offline-dataset',
  base_commit: v.constants.V1_COMMIT,
  v1_dataset_sha256: v.constants.V1_HASH,
  v2_dataset_sha256: v.constants.V2_HASH,
  case_count: 144,
  dataset_sha256: null,
  canonicalization: 'Cases sorted by id; recursively sort object keys; preserve array order; compact UTF-8 JSON with final LF',
  inference_executed: false,
  files: {}
}
function main() {
  if (fs.existsSync(v.constants.manifestPath)) throw new Error('Refusing to overwrite existing V2.1 freeze.json')
  const result = v.validateInputs()
  if (!result.valid) throw new Error(`V2 validation failed:\n${result.errors.join('\n')}`)
  const cases = v.constants.datasetPaths.flatMap((p) => JSON.parse(fs.readFileSync(p, 'utf8')))
  manifest.dataset_sha256 = v.sha(Buffer.from(v.canonicalDataset(cases), 'utf8'))
  for (const file of files) manifest.files[file] = v.fileSha(path.join(dir, file))
  const fd = fs.openSync(v.constants.manifestPath, 'wx')
  try { fs.writeFileSync(fd, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8') } finally { fs.closeSync(fd) }
  console.log(`Created V2.1 freeze manifest for ${manifest.case_count} cases (${manifest.dataset_sha256})`)
}
if (require.main === module) { try { main() } catch (e) { console.error(e.message); process.exit(1) } }
module.exports = { main, manifest }
