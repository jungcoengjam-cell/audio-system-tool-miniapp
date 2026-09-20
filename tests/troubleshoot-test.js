const assert = require('assert/strict')
let config
global.Page = (value) => { config = value }
global.wx = { navigateTo: ({ url }) => { assert.equal(url, '/pages/dmx-address/dmx-address') } }
const file = require.resolve('../pages/troubleshoot/index.js')
delete require.cache[file]
require(file)
// 流程依据：Yamaha 无声排查 https://hub.yamaha.com/proaudio/livesound/live-sound-troubleshooting-tips-part-1/
// DMX 配接顺序参考 ETC HOG https://www.etcconnect.com/webdocs/Controls/HOG/HTML/en/sect-patching_fixtures.htm

function page(type) {
  const p = { data: JSON.parse(JSON.stringify(config.data)) }
  Object.keys(config).forEach((key) => { if (key !== 'data') p[key] = config[key] })
  p.setData = (patch, callback) => { Object.assign(p.data, patch); if (callback) callback() }
  p.onLoad({ type })
  return p
}

function tap(p, index, node = p.data.node) {
  p.answer({ currentTarget: { dataset: { node, index } } })
}

function follow(type, choices) {
  const p = page(type)
  choices.forEach((index) => tap(p, index))
  return p
}

for (const type of ['audio', 'lighting']) {
  const states = new Set()
  const visit = (choices, active = []) => {
    const p = page(type)
    choices.forEach((index) => p.answer({ currentTarget: { dataset: { node: p.data.node, index } } }))
    const state = `${p.data.node}:${choices.join(',')}`
    assert(!states.has(state), `${type} 节点图出现环：${state}`)
    states.add(state)
    assert(!active.includes(p.data.node), `${type} 节点图存在回环：${active.join('>')} > ${p.data.node}`)
    if (p.data.result) return
    assert(p.data.options.length > 0)
    p.data.options.forEach((option, index) => visit(choices.concat(index), active.concat(p.data.node)))
  }
  visit([])
  const first = page(type)
  const oldTap = { currentTarget: { dataset: { node: first.data.node, index: 0 } } }
  first.answer(oldTap)
  assert.equal(first.data.history.length, 1)
  first.answer(oldTap)
  assert.equal(first.data.history.length, 1, `${type} 重复点击不应重复记录`)
  first.back()
  assert.equal(first.data.history.length, 0)
  assert.equal(first.data.selectedIndex, 0)
  assert.equal(first.data.options[0].selected, true)
  first.answer({ currentTarget: { dataset: { node: first.data.node, index: 0 } } })
  first.restart()
  assert.equal(first.data.history.length, 0)
  assert.equal(first.data.node, type === 'audio' ? 'as' : 'ls')
  const done = page(type)
  ;(type === 'audio' ? [0, 0, 0, 0] : [0, 0, 0]).forEach((index) => done.answer({ currentTarget: { dataset: { node: done.data.node, index } } }))
  assert(done.data.result)
  done.back()
  assert.equal(done.data.result, null)
  done.restart()
  assert.equal(done.data.history.length, 0)
}

for (const [type, choices] of Object.entries({ audio: [0, 1], lighting: [0, 1] })) {
  const p = follow(type, choices)
  assert(p.data.result && p.data.result.feedbackEnabled)
  assert(p.data.result.checks.length >= 2)
  p.feedback({ currentTarget: { dataset: { node: p.data.node, state: 'restored' } } })
  assert.equal(p.data.feedback, 'restored')
  p.feedback({ currentTarget: { dataset: { node: 'old-node', state: 'ongoing' } } })
  assert.equal(p.data.feedback, 'restored')
  p.feedback({ currentTarget: { dataset: { node: p.data.node, state: 'ongoing' } } })
  assert.equal(p.data.feedback, 'ongoing')
  p.togglePath({ currentTarget: { dataset: { node: p.data.node } } })
  assert.equal(p.data.pathExpanded, true)
  p.togglePath({ currentTarget: { dataset: { node: p.data.node } } })
  assert.equal(p.data.pathExpanded, false)
  p.editStep({ currentTarget: { dataset: { node: p.data.node, step: 0 } } })
  assert(p.data.result)
  p.togglePath({ currentTarget: { dataset: { node: p.data.node } } })
  p.editStep({ currentTarget: { dataset: { node: p.data.node, step: 0 } } })
  assert.equal(p.data.result, null)
  assert.equal(p.data.history.length, 0)
  assert.equal(p.data.selectedIndex, choices[0])
  tap(p, 1)
  assert.equal(p.data.history.length, 1, `${type} 编辑后应丢弃旧分支`)
  assert.equal(p.data.history[0].index, 1)
}

for (const choices of [[0, 2], [0, 0, 0, 0]]) {
  const p = follow('audio', choices)
  assert.equal(p.data.result.feedbackEnabled, false)
  p.feedback({ currentTarget: { dataset: { node: p.data.node, state: 'restored' } } })
  assert.equal(p.data.feedback, null)
}

const invalidEventPage = page('audio')
for (const index of [null, '', false, [], ' ', -1, 99]) {
  tap(invalidEventPage, index)
  assert.equal(invalidEventPage.data.history.length, 0, `非法选项参数被接受：${String(index)}`)
}
tap(invalidEventPage, 0)
const invalidEditPage = follow('audio', [0, 1])
invalidEditPage.togglePath({ currentTarget: { dataset: { node: invalidEditPage.data.node } } })
const beforeInvalidEdit = JSON.stringify(invalidEditPage.data)
for (const step of [null, '', false, [], ' ', -1, 99]) {
  invalidEditPage.editStep({ currentTarget: { dataset: { node: invalidEditPage.data.node, step } } })
}
assert.equal(JSON.stringify(invalidEditPage.data), beforeInvalidEdit)

for (const invalid of [undefined, '', 'bad', 'constructor', 'toString', '__proto__']) {
  const p = page(invalid)
  assert.equal(p.data.invalid, true, `非法 type 应友好失败：${invalid}`)
}
const audio = page('audio')
const lighting = page('lighting')
audio.answer({ currentTarget: { dataset: { node: audio.data.node, index: 0 } } })
lighting.answer({ currentTarget: { dataset: { node: lighting.data.node, index: 0 } } })
assert.equal(audio.data.category, '音频')
assert.equal(lighting.data.category, '灯光')
assert.notDeepEqual(audio.data.history, lighting.data.history)
audio.answer({ currentTarget: { dataset: { node: 'forged', index: 0 } } })
assert.equal(audio.data.history.length, 1)
console.log('troubleshoot tree and controller PASS')
