'use strict'

const {
  getProjects,
  getRecoveryEntries,
  getStorageMigrationBackups,
  getWorkspaceSnapshot,
  restoreRecoveryEntry,
  restoreStorageMigrationBackup,
} = require('../../utils/records')
const {
  discardInterruptedSession,
  getInterruptedSessions,
  resumeResultEditor,
} = require('../../utils/result-record-context')

const KIND_LABELS = Object.freeze({
  project: '现场项目',
  record: '项目计算记录',
  favorite: '计算收藏',
  'record-project-link': '项目记录关联',
  'legacy-recent': '旧版未归属计算记录',
})

function formatTime(value) {
  if (!Number.isFinite(value)) return '时间未记录'
  return new Date(value).toLocaleString('zh-CN')
}

function decorateRecoveryEntry(entry) {
  const snapshot = entry.snapshot || {}
  const kind = entry.kind
  return {
    id: entry.id,
    kind,
    kindLabel: KIND_LABELS[kind] || '已移除内容',
    title: snapshot.name || snapshot.title || snapshot.summary || snapshot.module || '已保存内容',
    summary: snapshot.summary || snapshot.resultText || entry.projectId || '',
    timeText: formatTime(entry.deletedAt),
    canRestoreDirectly: kind !== 'legacy-recent',
  }
}

Page({
  data: {
    recoveryEntries: [],
    backups: [],
    sessions: [],
    projects: [],
    error: '',
    backupError: '',
    sessionError: '',
  },

  onShow() {
    this.refresh()
  },

  refresh() {
    const snapshot = getWorkspaceSnapshot({ forceRefresh: true })
    const recoveryEntries = snapshot.ok ? snapshot.recoveryEntries.map(decorateRecoveryEntry) : getRecoveryEntries().map(decorateRecoveryEntry)
    const backupResult = getStorageMigrationBackups()
    const sessionResult = getInterruptedSessions()
    this.setData({
      recoveryEntries,
      backups: backupResult.ok ? backupResult.backups.map((item) => ({
        ...item,
        timeText: formatTime(item.createdAt),
        title: `存储迁移前备份 · v${item.schemaVersionBefore}`,
      })) : [],
      sessions: sessionResult.ok ? sessionResult.sessions.map((session) => ({
        id: session.id,
        moduleLabel: require('../../utils/records').getModuleMetadata(session.module)?.label || session.module,
        title: session.recordId ? '项目记录未保存更改' : '未保存的编辑草稿',
        updatedText: formatTime(session.updatedAt),
        projectId: session.projectId,
      })) : [],
      projects: snapshot.ok ? snapshot.projects : getProjects(),
      error: snapshot.ok ? '' : snapshot.error || '恢复内容读取失败；请重试。',
      backupError: backupResult.ok ? '' : backupResult.error,
      sessionError: sessionResult.ok ? '' : sessionResult.error,
    })
  },

  retry() {
    this.refresh()
  },

  restoreEntry(event) {
    const id = String(event.currentTarget.dataset.id || '')
    const entry = getRecoveryEntries().find((item) => item.id === id)
    if (!entry) return
    if (entry.kind === 'legacy-recent') {
      const projects = getProjects()
      if (!projects.length) {
        wx.showToast({ title: '先新建一个项目，再恢复这条旧记录', icon: 'none' })
        return
      }
      wx.showActionSheet({
        itemList: projects.slice(0, 6).map((project) => project.name),
        success: ({ tapIndex }) => {
          const project = projects[tapIndex]
          if (!project) return
          if (!restoreRecoveryEntry(id, project.id)) {
            wx.showToast({ title: '恢复失败，记录仍保留在恢复区', icon: 'none' })
            return
          }
          this.refresh()
          wx.showToast({ title: `已恢复到${project.name}`, icon: 'none' })
        },
      })
      return
    }
    if (!restoreRecoveryEntry(id)) {
      wx.showToast({ title: '恢复失败，内容仍保留在恢复区', icon: 'none' })
      return
    }
    this.refresh()
    wx.showToast({ title: '已恢复', icon: 'none' })
  },

  restoreBackup(event) {
    const backupId = String(event.currentTarget.dataset.id || '')
    wx.showModal({
      title: '恢复迁移前数据？',
      content: '会还原该备份中的原始项目、记录、收藏和活动项目字段。恢复后应用会再次执行兼容迁移；此备份仍会保留。',
      confirmText: '恢复备份',
      cancelText: '取消',
      success: ({ confirm }) => {
        if (!confirm) return
        if (!restoreStorageMigrationBackup(backupId)) {
          wx.showToast({ title: '备份恢复失败，当前内容未被替换', icon: 'none' })
          return
        }
        wx.showToast({ title: '原始数据已还原', icon: 'none' })
        wx.navigateBack()
      },
    })
  },

  resumeSession(event) {
    const id = String(event.currentTarget.dataset.id || '')
    if (!resumeResultEditor(id)) wx.showToast({ title: '草稿恢复失败，请重试', icon: 'none' })
  },

  discardSession(event) {
    const id = String(event.currentTarget.dataset.id || '')
    wx.showModal({
      title: '放弃这份编辑草稿？',
      content: '只移除这份中断的编辑副本，原项目记录和临时输入备份不会被替换。',
      confirmText: '放弃草稿',
      cancelText: '保留',
      success: ({ confirm }) => {
        if (!confirm) return
        if (!discardInterruptedSession(id)) {
          wx.showToast({ title: '操作失败，草稿仍保留', icon: 'none' })
          return
        }
        this.refresh()
      },
    })
  },
})
