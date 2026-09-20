'use strict'

function safeValue(value) {
  if (value === undefined) return null
  const seen = new WeakSet()
  try {
    return JSON.parse(JSON.stringify(value, (_, item) => {
      if (typeof item === 'number' && !Number.isFinite(item)) return String(item)
      if (typeof item === 'bigint') return String(item) + 'n'
      if (item && typeof item === 'object') {
        if (seen.has(item)) return '[Circular]'
        seen.add(item)
      }
      return item
    }))
  } catch (error) { return String(error) }
}

module.exports = { safeValue }
