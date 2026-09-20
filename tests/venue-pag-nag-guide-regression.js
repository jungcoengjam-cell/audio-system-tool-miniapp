const assert = require('assert/strict')
const fs = require('fs')
const path = require('path')

let pageConfig
global.Page = (config) => { pageConfig = config }
global.wx = {
  getStorageSync: () => null,
  setStorageSync: () => {},
  removeStorageSync: () => {},
  getSystemInfoSync: () => ({ theme: 'light' }),
  onThemeChange: () => {},
  offThemeChange: () => {},
  vibrateShort: () => {},
}

delete require.cache[require.resolve('../pages/venue/venue')]
require('../pages/venue/venue')

const wxml = fs.readFileSync(path.join(__dirname, '../pages/venue/venue.wxml'), 'utf8')
for (const key of ['ds', 'd0', 'dn', 'd1', 'd2', 'nom']) {
  assert(wxml.includes(`data-key="${key}"`))
  assert(wxml.includes(`pagNagGuideKey == '${key}'`))
}
for (const field of [
  'discussionPagNagDsText', 'discussionPagNagD0Text', 'discussionPagNagDnText',
  'discussionPagNagD1Text', 'discussionPagNagD2Text', 'discussionPagNagNomText',
]) assert(wxml.includes(`data-field="${field}"`))
assert(wxml.includes('测量示意 · 不按比例'))
assert(!wxml.includes('<br'))
assert(wxml.includes('pag-nag-guide-head') && wxml.includes('pag-nag-guide-mic-neck'))
assert(wxml.includes('wx:if="{{pagNagGuideKey == \'ds\'}}" class="pag-nag-guide-line'))
assert(wxml.includes('计入'))
assert(wxml.includes('不是参会人数或总安装数'))

const page = {
  ...pageConfig,
  data: JSON.parse(JSON.stringify(pageConfig.data)),
}
let setDataCount = 0
page.setData = (changes) => {
  setDataCount += 1
  Object.assign(page.data, changes)
}
page.onPagNagGuideSelect({ currentTarget: { dataset: { key: 'd2' } } })
assert.equal(page.data.pagNagGuideKey, 'd2')
assert.equal(setDataCount, 1)
page.onPagNagGuideSelect({ currentTarget: { dataset: { key: 'd2' } } })
page.onPagNagGuideSelect({ currentTarget: { dataset: { key: 'invalid' } } })
assert.equal(setDataCount, 1)
assert.equal(page.data.pagNagGuideKey, 'd2')

console.log('venue pag/nag guide regression passed')
