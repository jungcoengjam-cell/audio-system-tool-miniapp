'use strict'

const pages = new WeakMap(), disposedPages = new WeakSet(), guards = new WeakSet(), NO_RESULT = {}
let nextId = 1

const record = (v) => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false
  const p = Object.getPrototypeOf(v)
  return p === Object.prototype || p === null
}
const flat = (v) => typeof v === 'boolean' || typeof v === 'string' && v.trim() !== '' || typeof v === 'number' && Number.isFinite(v)
function stateOf(page) {
  let s = pages.get(page)
  if (!s) pages.set(page, s = { epoch: 0, op: null, closed: disposedPages.has(page), invalidated: disposedPages.has(page), disposed: disposedPages.has(page) })
  return s
}
function clear(page, reason) {
  page.setData?.({ result: null })
  page.onOperationInvalidate?.(reason)
}
function publish(page) {
  page.onOperationStateChange?.(view(page))
}
function view(page) {
  const op = stateOf(page).op
  if (!op) return null
  const fields = Object.keys(op.fields).map((key) => {
    const descriptor = op.fields[key]
    const field = { key, value: op.flatvalues[key], unit: descriptor.unit, confirmed: op.confirmedset.has(key) }
    if (descriptor.label) field.label = descriptor.label
    if (typeof descriptor.display === 'function') field.displayValue = descriptor.display(field.value)
    return Object.freeze(field)
  })
  const blockers = op.required.filter((key) => !op.confirmedset.has(key))
  return Object.freeze({ id: op.id, revision: op.rev, kind: op.kind, active: !op.closed,
    status: op.error || op.closed ? 'invalid' : blockers.length ? 'blocked' : 'ready', error: op.error,
    fields: Object.freeze(fields), blockers: Object.freeze(blockers.slice()), ready: !op.closed && !op.error && !blockers.length })
}
function guardFor(page, op, epoch, rev, result = NO_RESULT) {
  const guard = () => {
    const s = pages.get(page)
    return Boolean(s && !s.closed && !s.disposed && s.epoch === epoch && s.op === op && !op?.closed && (!op || op.rev === rev)
      && (result === NO_RESULT || !op || op.result?.ref === result))
  }
  guards.add(guard); return guard
}

function createOperationMethods(contract) {
  if (!record(contract) || typeof contract.id !== 'string' || !contract.id || !record(contract.fields)) throw new TypeError('invalid operation contract')
  const fields = Object.keys(contract.fields), known = new Set(fields), kinds = new Set([contract.id, ...(Array.isArray(contract.kinds) ? contract.kinds : [])])
  const raw = contract.requiredFields, map = Array.isArray(raw) ? Object.fromEntries([...kinds].map((k) => [k, raw])) : raw
  if (!record(map)) throw new TypeError('invalid required fields')
  const required = {}
  for (const kind of kinds) {
    if (!Array.isArray(map[kind]) || map[kind].some((key) => !known.has(key))) throw new TypeError('invalid required field')
    required[kind] = map[kind].slice()
  }
  const req = (kind) => required[kind] || []
  const operation = (kind, values, confirmedset, error = '') => ({ id: `op-${nextId++}`, rev: 1, kind, fields: contract.fields, required: req(kind), flatvalues: values, confirmedset, result: null, closed: false, error })
  const invalid = (state, kind, error) => {
    state.op = operation(kind, Object.fromEntries(fields.map((key) => [key, undefined])), new Set(), error)
    return view
  }
  const restart = (page) => {
    const s = stateOf(page)
    if (s.closed || s.invalidated) return null
    s.epoch += 1
    s.op = null
    clear(page, 'begin')
    return s
  }
  return {
    beginStructuredOperation(facts = {}, kind = contract.id) {
      const s = restart(this)
      if (!s) return view(this) || Object.freeze({ active: false, ready: false, status: 'invalid', blockers: Object.freeze([]), fields: Object.freeze([]) })
      const reject = (rejectKind, error) => {
        const result = invalid(s, rejectKind, error)(this)
        publish(this)
        return result
      }
      if (!kinds.has(kind)) return reject(contract.id, 'invalid operation kind')
      if (!record(facts)) return reject(kind, 'operation inputs must be a flat object')
      const keys = Reflect.ownKeys(facts)
      if (keys.some((key) => typeof key !== 'string' || !known.has(key) || key === 'source' || key === 'confirmed')) return reject(kind, 'invalid structured operation')
      const values = Object.fromEntries(fields.map((key) => [key, undefined])), confirmed = new Set()
      for (const key of keys) {
        if (!flat(facts[key])) return reject(kind, 'operation inputs must be flat values')
        values[key] = facts[key]; confirmed.add(key)
      }
      s.op = operation(kind, values, confirmed)
      publish(this)
      return view(this)
    },
    getOperationSnapshot() { return view(this) },
    setOperationCandidate(field, value, unit) {
      const s = stateOf(this), op = s.op, descriptor = op?.fields[field]
      if (!op || op.closed || !descriptor) return false
      const accepted = flat(value) && descriptor.unit === unit ? value : undefined
      if (op.flatvalues[field] === accepted && op.confirmedset.has(field)) return true
      op.flatvalues[field] = accepted
      op.confirmedset.delete(field)
      op.rev += 1
      op.result = null
      clear(this, 'candidate')
      publish(this)
      return accepted !== undefined
    },
    confirmOperationField(event) {
      const s = stateOf(this), op = s.op, field = event?.currentTarget?.dataset?.field, descriptor = op?.fields[field]
      if (!op || op.closed || !descriptor) return false
      if (op.flatvalues[field] === undefined) {
        const data = this.data || {}, value = typeof descriptor.read === 'function' ? descriptor.read(this, data) : descriptor.dataKey ? data[descriptor.dataKey] : data[field]
        if (!flat(value)) return false
        op.flatvalues[field] = value; op.rev += 1
      }
      const value = op.flatvalues[field], unit = descriptor.unit, epoch = s.epoch, rev = op.rev
      const commit = (confirmed) => {
        const current = pages.get(this)
        if (!confirmed || !current || current.closed || current.disposed || current.epoch !== epoch || current.op !== op || op.closed || op.rev !== rev || op.flatvalues[field] !== value || op.fields[field].unit !== unit) return false
        if (op.confirmedset.has(field)) return true
        op.confirmedset.add(field)
        op.rev += 1
        op.result = null
        publish(this)
        return true
      }
      const modal = typeof wx === 'undefined' ? null : wx
      if (!modal || typeof modal.showModal !== 'function') return false
      const display = typeof descriptor.display === 'function' ? descriptor.display(value) : value
      modal.showModal({ title: '确认本次计算输入', content: String(descriptor.label || field) + '：' + String(display) + (unit && unit !== 'index' ? ' ' + unit : ''), success: (r) => { commit(Boolean(r?.confirm)) } })
      return true
    },
    endStructuredOperation() {
      const s = stateOf(this)
      if (s.closed || s.disposed) return
      s.epoch += 1
      s.op = null
      s.invalidated = false
      clear(this, 'end')
      publish(this)
    },
  }
}

function prepareOperation(page) {
  const s = stateOf(page), op = s.op
  if (s.closed || s.invalidated || op?.closed) return { structured: Boolean(op), blocked: true, disposed: Boolean(s.disposed), state: null, guard: null, blockers: view(page)?.blockers || [] }
  if (!op) {
    const guard = guardFor(page, null, s.epoch)
    return {
      structured: false,
      blocked: false,
      state: page.data,
      guard,
      commit(result) { return guard() ? guardFor(page, null, s.epoch, 0, result) : null },
      blockers: [],
    }
  }
  const current = view(page)
  if (!current.ready) return { structured: true, blocked: true, state: null, guard: null, blockers: current.blockers }
  const epoch = s.epoch, rev = op.rev, guard = guardFor(page, op, epoch, rev)
  return { structured: true, blocked: false, state: Object.freeze({ ...op.flatvalues }), guard,
    commit(result) {
      if (!guard()) return null
      op.result = { ref: result, guard: guardFor(page, op, epoch, rev, result) }
      return op.result.guard
    }, blockers: [] }
}
function captureOperationResult(page, result) {
  const s = stateOf(page), op = s.op
  if (s.closed || s.disposed) return null
  if (op) return op.result && op.result.ref === result && op.result.guard() ? op.result.guard : null
  return guardFor(page, null, s.epoch, 0, result)
}
function isOperationResultCurrent(page, guard) { return guards.has(guard) && guard() }
function invalidateOperation(page, reason = 'invalidated') {
  const s = stateOf(page)
  if (s.disposed) return
  s.epoch += 1
  s.invalidated = true
  if (s.op) {
    s.op.closed = true
    s.op.result = null
  }
  s.closed = reason === 'unload' || reason === 'page-unloaded' || reason === 'close'
  clear(page, reason)
  publish(page)
}

function disposeOperation(page) {
  const s = stateOf(page)
  if (s.disposed) return false
  disposedPages.add(page)
  s.epoch += 1
  s.invalidated = true
  s.closed = true
  s.disposed = true
  if (s.op) {
    s.op.closed = true
    s.op.result = null
  }
  return true
}

module.exports = { createOperationMethods, prepareOperation, captureOperationResult, isOperationResultCurrent, invalidateOperation, disposeOperation }
