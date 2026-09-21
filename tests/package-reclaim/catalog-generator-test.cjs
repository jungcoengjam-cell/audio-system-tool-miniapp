const assert = require('assert')
const childProcess = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { render } = require('./generate-stage-lighting.cjs')

const root = path.resolve(__dirname, '../..')
const source = JSON.parse(fs.readFileSync(path.join(root, 'docs/catalog-source/stage-lighting.json'), 'utf8'))
const generatedFile = path.join(root, 'data/stage-lighting.js')
const generated = fs.readFileSync(generatedFile, 'utf8')
assert.strictEqual(render(source), render(source), 'same source must produce byte-identical output')
assert.strictEqual(generated, render(source), 'checked-in output must equal deterministic render')

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'stage-lighting-generator-'))
try {
  const sourceFile = path.join(temporaryDirectory, 'source.json')
  const outputFile = path.join(temporaryDirectory, 'generated.js')
  fs.writeFileSync(sourceFile, JSON.stringify(source))
  fs.writeFileSync(outputFile, generated)
  const runCheck = () => childProcess.spawnSync(process.execPath, [
    path.join(__dirname, 'generate-stage-lighting.cjs'), '--check', '--source', sourceFile, '--output', outputFile,
  ], { encoding: 'utf8' })
  const initialStat = fs.statSync(outputFile)
  const writeMetadata = ({ size, mtimeMs, ctimeMs, birthtimeMs }) => ({ size, mtimeMs, ctimeMs, birthtimeMs })
  assert.strictEqual(runCheck().status, 0, 'fresh generated output must pass --check')
  assert.deepStrictEqual(writeMetadata(fs.statSync(outputFile)), writeMetadata(initialStat), '--check must not rewrite current output')

  fs.writeFileSync(outputFile, `${generated}// altered\n`)
  const tamperedBytes = fs.readFileSync(outputFile)
  assert.notStrictEqual(runCheck().status, 0, 'tampered generated output must fail --check')
  assert.deepStrictEqual(fs.readFileSync(outputFile), tamperedBytes, '--check must not repair tampered output')

  fs.writeFileSync(outputFile, generated)
  const changedSource = [...source, { model: '__generator_test__' }]
  fs.writeFileSync(sourceFile, JSON.stringify(changedSource))
  const staleBytes = fs.readFileSync(outputFile)
  assert.notStrictEqual(runCheck().status, 0, 'changed source with stale output must fail --check')
  assert.deepStrictEqual(fs.readFileSync(outputFile), staleBytes, '--check must not rewrite stale output')
} finally {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true })
}

console.log('catalog generator checks passed: deterministic output, stale/tampered detection, read-only --check')
