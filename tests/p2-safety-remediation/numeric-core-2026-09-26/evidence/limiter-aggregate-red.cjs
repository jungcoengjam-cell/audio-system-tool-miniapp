const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { execFileSync } = require('node:child_process')
const root = path.resolve(__dirname, '../../../..')
const current = require(path.join(root, 'utils/limiter'))
const source = execFileSync('git', ['show', 'HEAD:utils/limiter.js'], { cwd: root, encoding: 'utf8' })
const oldModule = { exports: {} }
vm.runInNewContext(source, { module: oldModule, exports: oldModule.exports })
const input = {
  amplifier: { model: 'Synthetic', stereoPower: { 8: Number.MAX_VALUE } },
  speaker: { impedance: 4, ratedPower: Number.MAX_VALUE }, count: 2, wiring: 'series',
  mode: 'stereo', sensitivityVoltage: 1,
}
const before = oldModule.exports.calculateLimiter(input)
const after = current.calculateLimiter(input)
assert.equal(before.valid, true)
assert.equal(before.totalRatedPower, Infinity)
assert.equal(after.valid, false)
const report = {
  preFixSource: 'git HEAD (production file had no task edits at baseline)',
  input,
  preFix: { valid: before.valid, totalRatedPower: String(before.totalRatedPower), loadImpedance: before.loadImpedance },
  postFix: after,
}
const raw = JSON.stringify(report, null, 2) + '\n'
report.sha256 = crypto.createHash('sha256').update(raw).digest('hex')
fs.writeFileSync(path.join(__dirname, 'limiter-aggregate-red.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' })
console.log(JSON.stringify({ preFixValid: before.valid, preFixTotalRatedPower: String(before.totalRatedPower), postFixValid: after.valid }, null, 2))
