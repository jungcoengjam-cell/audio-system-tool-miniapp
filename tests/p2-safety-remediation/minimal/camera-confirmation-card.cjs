'use strict'

const assert = require('node:assert/strict')
const { createDelayedEnvironment } = require('./delayed-environment.cjs')

const facts = (verticalFov) => ({
  horizontalFov: 75,
  ...(verticalFov === undefined ? {} : { verticalFov }),
  sceneMode: 'ground', widthMeters: 6, depthMeters: 4,
  subjectHeightMeters: 1.8, heightMode: 'auto', marginPercent: 10,
})

function createPage() {
  const env = createDelayedEnvironment()
  const page = env.loadPage('pages/camera/camera.js')
  page.onLoad()
  env.flushNextTicks()
  return { env, page }
}

function begin(env, page, values, kind) {
  const snapshot = page.beginStructuredOperation(values, kind)
  env.flushNextTicks()
  return snapshot
}

function row(snapshot, key) {
  return snapshot.fields.find((field) => field.key === key)
}
function assertProjection(page) {
  const raw = page.getOperationSnapshot()
  const display = page.data.operationSnapshot
  for (const visible of display.fields) {
    const accepted = row(raw, visible.key)
    assert(accepted, `visible ${visible.key} must belong to private snapshot`)
    for (const key of ['key', 'value', 'unit', 'confirmed']) {
      assert.equal(visible[key], accepted[key], `${visible.key} display projection changed ${key}`)
    }
    if (raw.blockers.includes(visible.key) && accepted.value === undefined) {
      assert.equal(visible.displayValue, '待输入', `${visible.key} blocker placeholder must be explicit`)
    }
  }
}

function run() {
  const { env, page } = createPage()
  const rawHorizontal = begin(env, page, facts(), 'horizontal-only')
  assert.equal(rawHorizontal.ready, true)
  assert.equal(page.getOperationSnapshot().fields.length, 9, 'private horizontal snapshot retains the full contract')
  assertProjection(page)
  assert.equal(row(page.data.operationSnapshot, 'verticalFov'), undefined,
    'horizontal-only card omits unused VFOV')
  assert.equal(row(page.data.operationSnapshot, 'cameraHeightMeters'), undefined,
    'automatic height card omits absent optional camera height')

  const full = begin(env, page, facts(), 'full-area')
  assert.equal(full.ready, false)
  assertProjection(page)
  const blocker = row(page.data.operationSnapshot, 'verticalFov')
  assert(blocker, 'full-area missing VFOV remains visible on the confirmation card')
  assert.equal(blocker.displayValue, '待输入')
  assert.equal(blocker.confirmed, false)
  assert.equal(row(page.data.operationSnapshot, 'cameraHeightMeters'), undefined,
    'auto height does not show an empty optional camera height')
  assert.equal(row(page.getOperationSnapshot(), 'verticalFov').value, undefined,
    'display projection cannot fill the private gate value')

  page.confirmOperationField({ currentTarget: { dataset: { field: 'verticalFov' } } })
  assert.equal(env.pending.modals.length, 1, 'missing VFOV uses explicit confirmation')
  assert.equal(env.pending.modals[0].content, '垂直视场角：36 deg',
    'same-value VFOV confirmation must state 36 deg with its unit exactly once')
  assert.equal((env.pending.modals[0].content.match(/deg/g) || []).length, 1)
  env.answerModal(0, true)
  env.flushNextTicks()
  assert.equal(page.getOperationSnapshot().fields.find((field) => field.key === 'verticalFov').value, 36,
    'same-value 36 candidate is explicitly confirmed')

  begin(env, page, facts(), 'full-area')
  page.confirmOperationField({ currentTarget: { dataset: { field: 'verticalFov' } } })
  const staleOperation = env.pending.modals[0].success
  assert.equal(typeof staleOperation, 'function')
  begin(env, page, facts(), 'horizontal-only')
  staleOperation({ confirm: true })
  assert.equal(page.getOperationSnapshot().kind, 'horizontal-only', 'stale callback cannot restore prior operation mode')
  assert.equal(page.getOperationSnapshot().fields.find((field) => field.key === 'verticalFov').confirmed, false,
    'stale mode callback cannot confirm a field on the replacement operation')

  begin(env, page, facts(), 'full-area')
  page.confirmOperationField({ currentTarget: { dataset: { field: 'verticalFov' } } })
  const staleValue = env.pending.modals.at(-1).success
  page.setOperationCandidate('verticalFov', 24, 'deg')
  staleValue({ confirm: true })
  assert.equal(page.getOperationSnapshot().fields.find((field) => field.key === 'verticalFov').value, 24,
    'stale value callback cannot overwrite a newer explicit candidate')
  assert.equal(page.getOperationSnapshot().fields.find((field) => field.key === 'verticalFov').confirmed, false)
  assertProjection(page)
  return ['horizontal-only omission', 'automatic-height omission', 'VFOV blocker display', 'same-value confirmation',
    'stale operation callback', 'stale value callback', 'stale mode callback']
}

module.exports = { run }
if (require.main === module) console.log(`Camera confirmation-card checks passed: ${run().join(', ')}`)
