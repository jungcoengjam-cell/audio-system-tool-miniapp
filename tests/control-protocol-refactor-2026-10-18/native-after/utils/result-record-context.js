'use strict'

const { MODULES } = require('./records')

const SESSIONS_KEY = 'audioTool.resultEditorSessions.v1'
const STORE_VERSION = 2
const SOURCE_LABELS = Object.freeze({
  'project-record': '项目记录编辑',
  'project-draft': '项目内新增',
  favorite: '收藏副本',
  temporary: '临时计算',
})

function clone(value) {
  if (value === undefined) return undefined
  try { return JSON.parse(JSON.stringify(value)) } catch (error) { return null }
}

function isPreferences(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function readValue(key) {
  try {
    const value = wx.getStorageSync(key)
    return { ok: true, present: value !== undefined && value !== null && value !== '', value }
  } catch (error) {
    return { ok: false, present: false, value: undefined }
  }
}

function writeValue(key, value) {
  try {
    wx.setStorageSync(key, value)
    return true
  } catch (error) {
    return false
  }
}

function removeValue(key) {
  try {
    if (typeof wx.removeStorageSync === 'function') wx.removeStorageSync(key)
    else wx.setStorageSync(key, '')
    return true
  } catch (error) {
    return false
  }
}

function readSessionStore() {
  const result = readValue(SESSIONS_KEY)
  if (!result.ok) return { ok: false, sessions: [], owners: {} }
  if (!result.present) return { ok: true, sessions: [], owners: {} }
  const value = result.value
  const validSession = (item) => item && typeof item.id === 'string' && item.id
    && typeof item.module === 'string' && MODULES[item.module]
    && item.preferenceKey === MODULES[item.module].preferenceKey
    && isPreferences(item.preferences)
    && (item.baselinePreferences === undefined || isPreferences(item.baselinePreferences))
  if (!value || ![1, STORE_VERSION].includes(value.version) || !Array.isArray(value.sessions)
    || value.sessions.some((item) => !validSession(item))
    || new Set(value.sessions.map((item) => item.id)).size !== value.sessions.length) {
    return { ok: false, sessions: [], owners: {} }
  }
  const sessions = value.sessions.map((item) => ({
    ...item,
    baselinePreferences: clone(item.baselinePreferences || item.preferences),
  }))
  const owners = value.version === STORE_VERSION && value.owners && typeof value.owners === 'object'
    && !Array.isArray(value.owners) ? { ...value.owners } : {}
  if (value.version === 1) {
    sessions.filter((item) => item.interrupted !== true).forEach((item) => {
      if (!owners[item.module]) owners[item.module] = item.id
    })
  }
  for (const [module, sessionId] of Object.entries(owners)) {
    const owner = sessions.find((item) => item.id === sessionId)
    if (!MODULES[module] || !owner || owner.module !== module || owner.interrupted === true) {
      delete owners[module]
    }
  }
  return { ok: true, sessions, owners }
}

function writeSessionStore(sessions, owners = {}) {
  return writeValue(SESSIONS_KEY, { version: STORE_VERSION, sessions, owners })
}

function makeSessionId() {
  return `editor-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function normalizeWorkingPreferences(moduleKey, preferences, sourceKind) {
  const working = clone(preferences)
  if (!isPreferences(working)) return null
  if (moduleKey === 'camera' && sourceKind === 'favorite') working.cameraCalculationVersion = 2
  if (moduleKey === 'camera' && sourceKind === 'project-record'
    && working.cameraCalculationVersion !== 1 && working.cameraCalculationVersion !== 2) {
    working.cameraCalculationVersion = 1
  }
  return working
}

function createSession(moduleKey, preferences, options = {}) {
  const metadata = MODULES[moduleKey]
  if (!metadata) return null
  const original = readValue(metadata.preferenceKey)
  if (!original.ok) return null
  const workingPreferences = normalizeWorkingPreferences(moduleKey, preferences, options.sourceKind || 'temporary')
  if (!workingPreferences) return null
  const stored = readSessionStore()
  if (!stored.ok) return null
  const id = makeSessionId()
  const session = {
    id,
    module: moduleKey,
    preferenceKey: metadata.preferenceKey,
    sourceKind: options.sourceKind || 'temporary',
    recordId: options.recordId || '',
    projectId: options.projectId || '',
    preferences: workingPreferences,
    baselinePreferences: clone(workingPreferences),
    originalPreferencesPresent: original.present,
    ...(original.present ? { originalPreferences: clone(original.value) } : {}),
    previousOwnerId: stored.owners[moduleKey] || '',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
  const owners = { ...stored.owners, [moduleKey]: id }
  if (!writeSessionStore([session, ...stored.sessions], owners)) return null
  if (!writeValue(metadata.preferenceKey, workingPreferences)) {
    writeSessionStore(stored.sessions, stored.owners)
    return null
  }
  return session
}

function buildSessionUrl(session) {
  const path = MODULES[session.module]?.path
  if (!path) return ''
  const query = [`editorSessionId=${encodeURIComponent(session.id)}`]
  if (session.projectId) query.push(`projectId=${encodeURIComponent(session.projectId)}`)
  return `${path}${path.includes('?') ? '&' : '?'}${query.join('&')}`
}

function openRecordEditor(record, sourceKind = 'project-record', projectId = '') {
  if (!record || !MODULES[record.module] || !isPreferences(record.preferences)) return false
  const session = createSession(record.module, record.preferences, {
    sourceKind,
    recordId: sourceKind === 'project-record' ? record.id : '',
    projectId: projectId || (sourceKind === 'project-record' ? record.projectIds?.[0] : '') || '',
  })
  const url = session && buildSessionUrl(session)
  if (!session || !url) return false
  wx.navigateTo({ url, fail: () => finalizeSession(session.id, false) })
  return session.id
}

function openProjectDraft(moduleKey, projectId, preferences) {
  if (!projectId || !MODULES[moduleKey]) return false
  let working = preferences
  if (working === undefined || working === null) {
    const current = readValue(MODULES[moduleKey].preferenceKey)
    if (!current.ok) return false
    // Empty preferences intentionally let the tool's existing defaults initialize its UI.
    working = current.present && isPreferences(current.value) ? current.value : {}
  }
  const session = createSession(moduleKey, working, { sourceKind: 'project-draft', projectId })
  const url = session && buildSessionUrl(session)
  if (!session || !url) return false
  wx.navigateTo({ url, fail: () => finalizeSession(session.id, false) })
  return session.id
}

function getSession(sessionId) {
  const stored = readSessionStore()
  return stored.ok ? stored.sessions.find((item) => item.id === sessionId) || null : null
}

function attachResultEditor(page, moduleKey, options = {}) {
  const sessionId = String(options.editorSessionId || '')
  if (!sessionId) return null
  const stored = readSessionStore()
  if (!stored.ok) return null
  const session = stored.sessions.find((item) => item.id === sessionId)
  if (!session || session.module !== moduleKey || session.interrupted === true) return null
  if (stored.owners[moduleKey] !== session.id && !writeSessionStore(stored.sessions, { ...stored.owners, [moduleKey]: session.id })) return null
  if (!writeValue(session.preferenceKey, clone(session.preferences))) return null
  page._resultEditorSession = session
  page._resultEditorSessionId = session.id
  if (page.data && typeof page.setData === 'function') {
    page.setData({
      editorSessionActive: true,
      editorDirty: false,
      editorSourceKind: session.sourceKind,
      editorSourceLabel: SOURCE_LABELS[session.sourceKind] || '编辑副本',
      editorRecordId: session.recordId || '',
    })
  }
  return session
}

function currentPreferences(page) {
  if (typeof page?.getEditorPreferences === 'function') {
    const live = page.getEditorPreferences()
    if (isPreferences(live)) return clone(live)
  }
  const session = page?._resultEditorSession
  const result = session ? readValue(session.preferenceKey) : { ok: false }
  if (result.ok && result.present && isPreferences(result.value)) return clone(result.value)
  const payload = typeof page?.getRecordPayload === 'function' ? page.getRecordPayload() : null
  return isPreferences(payload?.preferences) ? clone(payload.preferences) : null
}

function updateSessionStore(sessionId, updates, ownerUpdates) {
  const stored = readSessionStore()
  if (!stored.ok) return false
  const current = stored.sessions.find((item) => item.id === sessionId)
  if (!current) return false
  const next = stored.sessions.map((item) => item.id === sessionId
    ? { ...item, ...clone(updates), updatedAt: Date.now() }
    : item)
  return writeSessionStore(next, ownerUpdates || stored.owners)
}

function captureEditorBaseline(page) {
  const session = page?._resultEditorSession
  const preferences = currentPreferences(page)
  if (!session || !preferences) return false
  const updated = { ...session, preferences, baselinePreferences: clone(preferences), updatedAt: Date.now() }
  if (!updateSessionStore(session.id, updated)) return false
  page._resultEditorSession = updated
  if (page.data?.editorDirty) page.setData({ editorDirty: false })
  return true
}

function isEditorDirty(page) {
  const session = page?._resultEditorSession
  const current = currentPreferences(page)
  const baseline = session?.baselinePreferences || session?.preferences
  return Boolean(session && current && JSON.stringify(current) !== JSON.stringify(baseline))
}

function setEditorDirty(page) {
  const dirty = isEditorDirty(page)
  if (page?.data && page.data.editorDirty !== dirty) page.setData({ editorDirty: dirty })
  return dirty
}

function markEditorSaved(page, record, options = {}) {
  const session = page?._resultEditorSession
  if (!session || !record?.id) return false
  const preferences = isPreferences(record.preferences) ? clone(record.preferences) : currentPreferences(page)
  if (!preferences) return false
  const sourceKind = options.saveAs === true || !session.recordId ? 'project-record' : session.sourceKind
  const updated = {
    ...session,
    sourceKind,
    recordId: record.id,
    projectId: options.projectId || session.projectId || record.projectIds?.[0] || '',
    preferences,
    baselinePreferences: preferences,
    savedAt: Date.now(),
  }
  if (!updateSessionStore(session.id, updated)) return false
  page._resultEditorSession = updated
  if (page.data) page.setData({ editorDirty: false, editorRecordId: record.id })
  return true
}

function restorePreferenceValue(session) {
  if (session.originalPreferencesPresent) return writeValue(session.preferenceKey, clone(session.originalPreferences))
  return removeValue(session.preferenceKey)
}

function finalizeSession(sessionId, dirty, preferences) {
  const stored = readSessionStore()
  if (!stored.ok) return false
  const session = stored.sessions.find((item) => item.id === sessionId)
  if (!session) return true
  const currentSession = dirty
    ? { ...session, draftPreferences: clone(preferences || session.preferences), interrupted: true, updatedAt: Date.now() }
    : session
  const preserved = dirty
    ? stored.sessions.map((item) => item.id === sessionId ? currentSession : item)
    : stored.sessions
  if (dirty && !writeSessionStore(preserved, stored.owners)) return false

  if (stored.owners[session.module] !== session.id) {
    if (dirty) return true
    return writeSessionStore(stored.sessions.filter((item) => item.id !== sessionId), stored.owners)
  }

  if (!restorePreferenceValue(session)) return false
  const nextOwners = { ...stored.owners }
  const priorOwner = session.previousOwnerId
  const previousSession = preserved.find((item) => item.id === priorOwner && item.interrupted !== true)
  if (previousSession) nextOwners[session.module] = previousSession.id
  else delete nextOwners[session.module]
  const nextSessions = dirty ? preserved : stored.sessions.filter((item) => item.id !== sessionId)
  return writeSessionStore(nextSessions, nextOwners)
}

function finalizeResultEditor(page) {
  const session = page?._resultEditorSession
  if (!session) return true
  const preferences = currentPreferences(page)
  const baseline = session.baselinePreferences || session.preferences
  const dirty = Boolean(preferences && JSON.stringify(preferences) !== JSON.stringify(baseline))
  const saved = finalizeSession(session.id, dirty, preferences)
  if (saved) {
    page._resultEditorSession = null
    page._resultEditorSessionId = ''
  }
  return saved
}

function discardResultEditor(page) {
  const session = page?._resultEditorSession
  if (!session) return true
  const stored = readSessionStore()
  if (!stored.ok) return false
  const nextSessions = stored.sessions.filter((item) => item.id !== session.id)
  const nextOwners = { ...stored.owners }
  if (nextOwners[session.module] === session.id) {
    if (!restorePreferenceValue(session)) return false
    const previousSession = nextSessions.find((item) => item.id === session.previousOwnerId && item.interrupted !== true)
    if (previousSession) nextOwners[session.module] = previousSession.id
    else delete nextOwners[session.module]
  }
  if (!writeSessionStore(nextSessions, nextOwners)) return false
  page._resultEditorSession = null
  page._resultEditorSessionId = ''
  if (page.data) page.setData({ editorSessionActive: false, editorDirty: false })
  return true
}

function getInterruptedSessions() {
  const stored = readSessionStore()
  if (!stored.ok) return { ok: false, error: '编辑草稿数据格式异常，已阻止覆盖。', sessions: [] }
  return {
    ok: true,
    error: '',
    sessions: stored.sessions.filter((item) => item.interrupted === true).map((item) => ({ ...item })),
  }
}

function resumeResultEditor(sessionId) {
  const stored = readSessionStore()
  if (!stored.ok) return false
  const session = stored.sessions.find((item) => item.id === sessionId)
  if (!session || session.interrupted !== true) return false
  const liveOriginal = readValue(session.preferenceKey)
  if (!liveOriginal.ok) return false
  const preferences = clone(session.draftPreferences || session.preferences)
  const updated = {
    ...session,
    ...(liveOriginal.present ? { originalPreferences: clone(liveOriginal.value) } : { originalPreferences: undefined }),
    originalPreferencesPresent: liveOriginal.present,
    previousOwnerId: stored.owners[session.module] || '',
    preferences,
    baselinePreferences: clone(session.baselinePreferences || session.preferences),
    interrupted: false,
  }
  const nextSessions = stored.sessions.map((item) => item.id === sessionId ? updated : item)
  const nextOwners = { ...stored.owners, [session.module]: session.id }
  if (!writeSessionStore(nextSessions, nextOwners)) return false
  if (!writeValue(session.preferenceKey, preferences)) {
    writeSessionStore(stored.sessions, stored.owners)
    return false
  }
  wx.navigateTo({ url: buildSessionUrl(updated), fail: () => finalizeSession(sessionId, true, preferences) })
  return true
}

function discardInterruptedSession(sessionId) {
  const stored = readSessionStore()
  if (!stored.ok) return false
  const session = stored.sessions.find((item) => item.id === sessionId && item.interrupted === true)
  if (!session) return false
  const sessions = stored.sessions.filter((item) => item.id !== sessionId)
  const owners = { ...stored.owners }
  if (owners[session.module] === sessionId) delete owners[session.module]
  // The current preference may contain newer temporary work; discarding a saved draft never rolls it back.
  return writeSessionStore(sessions, owners)
}

module.exports = {
  SESSIONS_KEY,
  attachResultEditor,
  captureEditorBaseline,
  currentPreferences,
  discardResultEditor,
  discardInterruptedSession,
  finalizeResultEditor,
  getInterruptedSessions,
  getSession,
  isEditorDirty,
  markEditorSaved,
  openProjectDraft,
  openRecordEditor,
  resumeResultEditor,
  setEditorDirty,
}
