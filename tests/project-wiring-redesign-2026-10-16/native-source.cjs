const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const evidence = path.join(__dirname, 'evidence/native-fix-2026-10-16')
const sourcePath = fs.readFileSync(path.resolve(__dirname, '../../docs/verification/project-wiring-dark-buttons-2026-10-03/root-preview.cjs'), 'utf8').match(/const nativeFile = '([^']+)'/)[1]
const source = fs.readFileSync(sourcePath, 'utf8')
const hash = text => crypto.createHash('sha256').update(text).digest('hex')
const rules = [
  'wx-button{border-radius:4px;font-size:17px;font-weight:700;line-height:1.41176471;padding:8px 24px}',
  'wx-button:not([size=mini]){margin-left:auto;margin-right:auto;width:184px}',
  'wx-button[disabled]:not([type]),wx-button[disabled][type=default]{background-color:#fafafa;color:rgba(0,0,0,.18)}',
]
for (const rule of rules) if (!source.includes(rule)) throw Error('Installed native default rule changed: ' + rule)
const keys = ['is:"wx-picker-view-column"', '_setMaskStyle(e,t)', '_setMaskStyle(', 'wx-picker-view-column{', 'mask-top', 'mask-bottom', 'indicator{']
const excerpts = keys.map(key => { const at = source.indexOf(key); const text = at < 0 ? '' : source.slice(Math.max(0, at - 100), at + 2800); return { key, offset: at, text, sha256: hash(text) } })
const pickerRules = [...source.matchAll(/[^{}]{0,120}\.wx-picker__mask[^{}]{0,80}\{[^{}]+\}/g)].map(match => ({ offset: match.index, rule: match[0], sha256: hash(match[0]) }))
const disabledDark = 'wx-button[disabled]:not([type]),wx-button[disabled][type=default]{background-color:hsla(0,0%,100%,.08);color:hsla(0,0%,100%,.2)}'
if (!source.includes(disabledDark)) throw Error('Installed dark disabled rule changed')
const result = { sourcePath, sha256: hash(source), byteSize: fs.statSync(sourcePath).size, buttonRules: rules.map(rule => ({ rule, sha256: hash(rule), selectorSpecificity: rule.includes('[disabled]') ? [0, 2, 1] : rule.startsWith('wx-button:not') ? [0, 1, 1] : [0, 0, 1] })), disabledDark: { rule: disabledDark, sha256: hash(disabledDark) }, mappedButtonCss: rules.join('\n').replaceAll('wx-button', 'button') + '\n@media(prefers-color-scheme:dark){' + disabledDark.replaceAll('wx-button', 'button') + '}', pickerExcerpts: excerpts, pickerRules }
fs.mkdirSync(evidence, { recursive: true }); fs.writeFileSync(path.join(evidence, 'installed-native-source.json'), JSON.stringify(result, null, 2))
console.log(JSON.stringify(result, null, 2))
