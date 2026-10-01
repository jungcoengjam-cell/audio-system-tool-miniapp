const { calculateDmxAddressPlan, MAX_GROUPS } = require('./dmx-address')

const DMX_PREFERENCES_KEY = 'audioTool.dmxAddress.preferences'

function readDmxPreferencesStatus() {
  try {
    const value = wx.getStorageSync(DMX_PREFERENCES_KEY)
    if (value === '' || value === undefined || value === null) {
      return { ok: true, preferences: {} }
    }
    if (typeof value !== 'object' || Array.isArray(value)) {
      return { ok: false, error: '现有 DMX 设置无法识别，未覆盖任何内容。' }
    }
    return { ok: true, preferences: value }
  } catch (error) {
    return { ok: false, error: '读取 DMX 设置失败，未覆盖任何内容。' }
  }
}

function inspectDmxPreferences(preferences = {}) {
  const hasGroupsField = Object.prototype.hasOwnProperty.call(preferences, 'groups')
  const groupsAreArray = Array.isArray(preferences.groups)
  const groups = groupsAreArray ? preferences.groups : []
  const hasGroups = groups.length > 0 || (hasGroupsField && !groupsAreArray)
  return {
    hasGroups,
    existingGroupCount: groupsAreArray ? groups.length : (hasGroups ? 1 : 0),
    groupsReadable: !hasGroupsField || groupsAreArray,
    groups,
  }
}

function getNextGroupId(groups) {
  const used = new Set((groups || []).map((group) => group && group.id).filter(Boolean))
  let number = groups.length + 1
  while (used.has(`group-${number}`)) number += 1
  return `group-${number}`
}

function getValidChannelCount(product, rawChannelCount) {
  const channelCount = Number(rawChannelCount)
  return Number.isSafeInteger(channelCount)
    && Array.isArray(product?.channelModes)
    && product.channelModes.includes(channelCount)
    ? channelCount
    : 0
}

function getValidFixtureCount(rawFixtureCount) {
  const value = String(rawFixtureCount ?? '')
  if (!/^\d+$/.test(value)) return 0
  const fixtureCount = Number(value)
  return Number.isSafeInteger(fixtureCount) && fixtureCount >= 1 && fixtureCount <= 200
    ? fixtureCount
    : 0
}

function createImportedGroup(product, groups, channelCount, fixtureCount, allocationMode, action) {
  const id = getNextGroupId(groups)
  const lastUniverse = action === 'append' && allocationMode === 'manual' && groups.length
    ? String(groups[groups.length - 1]?.targetUniverse || '').toUpperCase()
    : 'A'
  const targetUniverse = ['A', 'B', 'C', 'D'].includes(lastUniverse) ? lastUniverse : 'A'
  const fixtureName = product.name || ''
  return {
    id,
    name: `${product.model} ${fixtureName}`.trim(),
    fixtureSource: 'library',
    fixtureModel: product.model,
    libraryChannelCount: String(channelCount),
    customName: '',
    customChannelCount: '',
    channelCount: String(channelCount),
    fixtureCount: String(fixtureCount),
    targetUniverse,
  }
}

function buildDmxProductImport(options = {}) {
  const { preferences = {}, product, channelCountText, fixtureCountText, action } = options
  if (!product || typeof product.model !== 'string' || !product.model
    || !Array.isArray(product.channelModes) || !product.channelModes.length) {
    return { ok: false, error: '该灯具没有可用的厂家 DMX 通道模式。' }
  }

  const channelCount = getValidChannelCount(product, channelCountText)
  if (!channelCount) return { ok: false, error: '请选择一个有效的厂家通道模式。' }

  const fixtureCount = getValidFixtureCount(fixtureCountText)
  if (!fixtureCount) return { ok: false, error: '灯具数量须为 1–200 的整数。' }

  const inspected = inspectDmxPreferences(preferences)
  const selectedAction = inspected.hasGroups ? action : 'append'
  if (inspected.hasGroups && !['append', 'replace'].includes(selectedAction)) {
    return { ok: false, error: '请选择追加、替换，或取消本次带入。' }
  }
  if (selectedAction === 'append' && !inspected.groupsReadable) {
    return { ok: false, error: '现有分组格式无法追加；请选择替换或取消。' }
  }

  const currentGroups = inspected.groupsReadable ? inspected.groups : []
  const allocationMode = preferences.allocationMode === 'manual' ? 'manual' : 'auto'
  const newGroup = createImportedGroup(
    product,
    currentGroups,
    channelCount,
    fixtureCount,
    allocationMode,
    selectedAction,
  )
  const nextGroups = selectedAction === 'append'
    ? [...currentGroups, newGroup]
    : [newGroup]

  if (nextGroups.length > MAX_GROUPS) {
    return { ok: false, error: `最多保留 ${MAX_GROUPS} 个灯具分组；可选择替换或取消。` }
  }

  const nextPreferences = { ...preferences, groups: nextGroups }
  let result
  try {
    result = calculateDmxAddressPlan({
      startAddress: preferences.startAddressText || '1',
      groups: nextGroups,
      allocationMode,
    })
  } catch (error) {
    return { ok: false, error: '现有编址草稿无法校验；请选择替换或取消。' }
  }
  if (result.error) {
    return {
      ok: false,
      error: selectedAction === 'append'
        ? `${result.error} 可选择替换现有分组，或取消。`
        : result.error,
    }
  }

  return { ok: true, preferences: nextPreferences, result, action: selectedAction }
}

function saveDmxProductImport(options = {}) {
  const read = readDmxPreferencesStatus()
  if (!read.ok) return read

  const plan = buildDmxProductImport({ ...options, preferences: read.preferences })
  if (!plan.ok) return plan

  try {
    wx.setStorageSync(DMX_PREFERENCES_KEY, plan.preferences)
  } catch (error) {
    return { ok: false, error: 'DMX 设置保存失败，输入仍保留在此面板。' }
  }
  return plan
}

module.exports = {
  DMX_PREFERENCES_KEY,
  buildDmxProductImport,
  inspectDmxPreferences,
  readDmxPreferencesStatus,
  saveDmxProductImport,
}
