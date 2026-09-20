const assert = require('assert/strict')
const { demos } = require('../pages/knowledge/demo-scenes')

const close = (actual, expected, tolerance = 0.02) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`)
}
const signed = (value) => Number(String(value).replace('−', '-'))

assert.deepStrictEqual(Object.keys(demos).sort(), ['cable', 'camera', 'distance', 'dmx', 'gain', 'led', 'limiter'])
for (const step of demos.limiter.steps) {
  close(step.requestH, Number.parseFloat(step.request) * 3)
  close(step.actualH, Math.min(40, Number.parseFloat(step.request)) * 3)
  close(step.overH, Math.max(0, step.requestH - 120))
}
for (const step of demos.distance.steps) {
  const distance = Number.parseFloat(step.distance)
  close(step.personX - 10, distance * 10)
  close(step.range, distance * 10)
  close(Number(step.reading), 100 - 20 * Math.log10(distance), 0.07)
}
for (const step of demos.cable.steps) {
  const resistance = 2 * 0.0175 * Number.parseFloat(step.length) / Number.parseFloat(step.area)
  const voltage = 20 * 8 / (8 + resistance)
  close(Number(step.resistance), resistance)
  close(Number(step.voltage), voltage, 0.06)
  close(step.ratio, voltage / 20 * 100, 0.1)
}
for (const step of demos.gain.steps) {
  close(signed(step.input), 12.4 + signed(step.dsp) + signed(step.amp))
  close(step.level, (signed(step.input) + 6) / 18.4 * 100)
}
for (const step of demos.camera.steps) {
  const distance = Number.parseFloat(step.distance)
  const width = 2 * distance * Math.tan(Math.PI / 6)
  close(Number.parseFloat(step.coverage), width, 0.01)
  close(step.cameraX + step.coneW, 80)
  close(step.coneTop + step.coneH / 2, 50)
  close(step.coneH / step.coneW, 4 * Math.tan(Math.PI / 6))
}
for (const [index, step] of demos.dmx.steps.entries()) {
  close(step.aFill, [16, 32, 512, 512][index] / 512 * 100)
  close(step.bFill, [0, 0, 0, 16][index] / 512 * 100)
  assert.match(step.address, /^[AB]\d{3}–[AB]\d{3}$/)
}
for (const [index, step] of demos.led.steps.entries()) {
  close(step.wallW, [2.6, 2.6, 2.7][index] / 3 * 100)
  close(step.wallH, 1.6 / 2 * 100)
  close(step.outerW, (index === 0 ? 2.56 : 2.66) / 3 * 100)
  close(step.outerH, (index === 0 ? 1.44 : 1.54) / 2 * 100)
  assert.equal(step.alert, index === 1)
}

console.log('knowledge demo numerical geometry PASS')
