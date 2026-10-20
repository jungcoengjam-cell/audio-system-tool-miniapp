'use strict'
const fs = require('node:fs'), path = require('node:path')
const host = 'C:/Users/wxx/.codex/visualizations/2026/10/18/01a14dd7-7462-7bc1-a9ac-b00cd5523d7b'
const automator = require(path.join(host, 'qa-automation-sdk/node_modules/miniprogram-automator'))
// This IDE returns only its own version from Tool.getInfo. Preserve the SDK's
// minimum-version check by verifying the actual runtime systemInfo instead.
const MiniProgram = require(path.join(host, 'qa-automation-sdk/node_modules/miniprogram-automator/out/MiniProgram')).default
const originalVersionCheck = MiniProgram.prototype.checkVersion
const output = path.join(__dirname, 'evidence/sdk-readiness.json')
const deadline = (promise, ms, label) => Promise.race([promise, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error(label + ' timeout')), ms); timer.unref() })])
MiniProgram.prototype.checkVersion = async function () {
  try { return await originalVersionCheck.call(this) } catch (error) {
    if (!String(error.message).includes("reading 'split'")) throw error
    const info = await deadline(this.systemInfo(), 10000, 'runtime version verification')
    const version = String(info?.SDKVersion || '')
    if (!/^\d+\.\d+\.\d+/.test(version)) throw new Error('Cannot verify the actual runtime SDK version; no UI actions allowed.')
    const parts = version.split('.').map(Number)
    if (parts[0] < 2 || (parts[0] === 2 && parts[1] < 7) || (parts[0] === 2 && parts[1] === 7 && parts[2] < 3)) throw new Error('Runtime SDK is older than the official 2.7.3 minimum.')
  }
}
let miniProgram
async function run() {
  const result = { at: new Date().toISOString(), sdk: 'miniprogram-automator 0.13.0', project: path.join(host, 'homepage-native-qa'), physicalDevice: false }
  try {
    miniProgram = await deadline(automator.connect({ wsEndpoint: 'ws://127.0.0.1:9437' }), 10000, 'connect')
    const page = await deadline(miniProgram.currentPage(), 10000, 'currentPage')
    result.page = page ? { path: page.path, query: page.query } : null
    result.systemInfo = await deadline(miniProgram.systemInfo(), 10000, 'systemInfo')
    result.ok = true
  } catch (error) {
    result.ok = false
    result.error = error.message
  } finally {
    fs.mkdirSync(path.dirname(output), { recursive: true })
    fs.writeFileSync(output, JSON.stringify(result, null, 2))
    console.log(JSON.stringify(result, null, 2))
    if (miniProgram) try { await deadline(miniProgram.disconnect(), 2000, 'disconnect') } catch (_) {}
    process.exit(result.ok ? 0 : 1)
  }
}
run()
