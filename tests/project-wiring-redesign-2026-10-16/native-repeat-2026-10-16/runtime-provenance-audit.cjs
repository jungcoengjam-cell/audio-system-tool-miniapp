const fs = require('node:fs')
const crypto = require('node:crypto')
const path = require('node:path')
const actualFile = path.resolve(__dirname, '../runtime.cjs')
const sha = value => crypto.createHash('sha256').update(value).digest('hex')
const current = fs.readFileSync(actualFile, 'utf8')
let candidate = current
  .replace("  const compact = name === 'compact'\n", '')
  .replace(' : compact ? `OUT${index + 1}`', '')
  .replace(' : compact ? `IN${index + 1}`', '')
  .replace("compact ? 'RVPE 2×0.5 mm²' : ", '')
  .replaceAll('compact || !(index % 2)', '!(index % 2)')
  .replace(/\\u([0-9a-f]{4})/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
const target = '6111651de429552b585e7588cf7610f1ed62bd16e930cfebd53a14c9ff4888c6'
const variants = [candidate]
variants.push(candidate.replace("connectorA: !(index % 2) ? 'xlrFemale' : '', connectorB: !(index % 2) ? 'xlrMale' : '',", "connectorA: index % 2 ? '' : 'xlrFemale', connectorB: index % 2 ? '' : 'xlrMale',").replace("lengthText: !(index % 2) ? '3' : ''", "lengthText: index % 2 ? '' : '3'"))
for (const value of [...variants]) {
  variants.push(value.replace("    toDeviceId: index === count - 1 && count === 4 ? devices[3].id : devices[1].id, toDevice: devices[1].name,", "    toDeviceId: index === count - 1 && count === 4 ? devices[3].id : devices[1].id,\n    toDevice: devices[1].name,"))
  variants.push(value.replace("    toDeviceId: index === count - 1 && count === 4 ? devices[3].id : devices[1].id, toDevice: devices[1].name,", "    toDeviceId: index === count - 1 && count === 4 ? devices[3].id : devices[1].id, toDevice: devices[1].name,"))
}
console.log(JSON.stringify({ current: sha(current), target, candidates: variants.map(sha), exactBaselineRecovered: variants.some(value => sha(value) === target) }, null, 2))
const exact = variants.find(value => sha(value) === target)
if (exact) fs.writeFileSync(path.join(__dirname, 'runtime-recovered-baseline.cjs'), exact)
