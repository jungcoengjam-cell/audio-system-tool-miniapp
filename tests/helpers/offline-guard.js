'use strict'

const patched = new WeakMap()
const attempts = []
globalThis.__offlineAttempts = attempts

function reject(label) {
  attempts.push(String(label))
  const error = new Error(`Offline guard blocked network access: ${label}`)
  error.code = 'ERR_OFFLINE_GUARD'
  throw error
}

function patch(object, key, label) {
  if (!object || typeof object[key] !== 'function') return
  let keys = patched.get(object)
  if (!keys) { keys = new Set(); patched.set(object, keys) }
  if (keys.has(key)) return
  keys.add(key)
  try {
    Object.defineProperty(object, key, { configurable: true, writable: true, value: (...args) => reject(`${label}.${key}`) })
  } catch (_) {
    // Some runtime built-ins expose immutable methods. Their module-level peers are guarded below.
  }
}

for (const key of ['fetch', 'WebSocket', 'EventSource', 'XMLHttpRequest']) {
  if (typeof globalThis[key] === 'function') {
    try {
      const name = key
      Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: function OfflineBlockedApi() { return reject(`global.${name}`) } })
    } catch (_) {}
  }
}

const http = require('http')
const https = require('https')
for (const [module, label] of [[http, 'http'], [https, 'https']]) {
  for (const key of ['request', 'get']) patch(module, key, label)
}

const net = require('net')
const tls = require('tls')
const http2 = require('http2')
const dgram = require('dgram')
const dns = require('dns')
const dnsMethods = ['lookup', 'lookupService', 'resolve', 'resolve4', 'resolve6', 'resolveAny', 'resolveCname', 'resolveMx', 'resolveNaptr', 'resolveNs', 'resolvePtr', 'resolveSoa', 'resolveSrv', 'resolveTxt', 'reverse']
patch(net, 'connect', 'net')
patch(net, 'createConnection', 'net')
patch(net.Socket.prototype, 'connect', 'net.Socket.prototype')
patch(tls, 'connect', 'tls')
patch(http2, 'connect', 'http2')
patch(dgram, 'createSocket', 'dgram')
for (const key of dnsMethods) patch(dns, key, 'dns')
for (const key of dnsMethods) patch(dns.promises, key, 'dns.promises')
for (const key of dnsMethods) patch(dns.Resolver.prototype, key, 'dns.Resolver.prototype')

function registerWx(wx = globalThis.wx) {
  if (wx) {
    for (const key of ['request', 'uploadFile', 'downloadFile', 'connectSocket']) patch(wx, key, 'wx')
    if (wx.cloud) for (const key of ['callFunction', 'uploadFile', 'downloadFile']) patch(wx.cloud, key, 'wx.cloud')
  }
}
try { registerWx() } catch (_) {}
globalThis.__registerOfflineWx = registerWx
module.exports = { attempts, registerWx }

process.on('exit', () => {
  if (!attempts.length) return
  console.error(`Offline guard observed ${attempts.length} blocked network attempt(s): ${attempts.join(', ')}`)
  process.exitCode = 1
})
