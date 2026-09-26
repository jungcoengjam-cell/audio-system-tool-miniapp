const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { execFileSync } = require('node:child_process')
const root = path.resolve(__dirname, '../../../..')
const source = execFileSync('git', ['show', 'HEAD:utils/gain-structure.js'], { cwd: root, encoding: 'utf8' })
const oldModule = { exports: {} }
vm.runInNewContext(source, { module: oldModule, exports: oldModule.exports })
const gain = oldModule.exports
const inputs = {
  sensitivityVoltageOverflow: {
    inputStage: { controlType: 'inputSensitivity', unit: 'V', options: [Number.MAX_VALUE] },
    selectedStageValue: Number.MAX_VALUE,
  },
  voltageGainUnderflow: {
    amplifier: { model: 'Synthetic', stereoPower: { 4: 100 } },
    inputStage: { controlType: 'voltageGain', unit: 'dB', options: [10000] },
    selectedStageValue: 10000, mode: 'stereo', loadImpedance: 4,
  },
  roundedTopLevelOverflow: {
    inputStage: { controlType: 'inputSensitivity', unit: 'V', options: [1] },
    selectedStageValue: 1, dspMaxOutputDbu: Number.MAX_VALUE, targetPeakDbfs: 0,
  },
}
const outputs = {
  sensitivityVoltageOverflow: gain.resolveFullPowerInput(inputs.sensitivityVoltageOverflow),
  voltageGainUnderflow: gain.resolveFullPowerInput(inputs.voltageGainUnderflow),
  roundedTopLevelOverflow: gain.calculateGainStructure(inputs.roundedTopLevelOverflow),
}
assert.ok(Object.values(outputs).every((result) => result.valid === true))
assert.equal(outputs.sensitivityVoltageOverflow.fullPowerInputDbu, Infinity)
assert.equal(outputs.voltageGainUnderflow.fullPowerInputVoltage, 0)
assert.equal(outputs.voltageGainUnderflow.fullPowerInputDbu, -Infinity)
assert.equal(outputs.roundedTopLevelOverflow.targetDspOutputDbu, Infinity)
function tagged(value) {
  if (typeof value === 'number' && !Number.isFinite(value)) return Number.isNaN(value) ? 'NaN' : value > 0 ? '+Infinity' : '-Infinity'
  if (Array.isArray(value)) return value.map(tagged)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, tagged(item)]))
  return value
}
const report = { preFixSource: 'git HEAD', inputs, outputs: tagged(outputs) }
const raw = JSON.stringify(report, null, 2) + '\n'
report.sha256 = crypto.createHash('sha256').update(raw).digest('hex')
fs.writeFileSync(path.join(__dirname, 'gain-derived-red.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' })
console.log('Pre-fix Gain resolver/top-level vectors reproduced: 3 successful non-finite results')
