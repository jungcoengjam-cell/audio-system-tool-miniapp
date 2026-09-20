const {
  addRecordToProject,
  createProject,
  getActiveProject,
  getRecordByPayload,
  toggleFavorite,
} = require('./records')
const { vibrate } = require('./haptics')

function getPayload(page) {
  return typeof page.getRecordPayload === 'function' ? page.getRecordPayload() : null
}

function getLookupPayload(page) {
  return typeof page.getRecordLookupPayload === 'function'
    ? page.getRecordLookupPayload()
    : getPayload(page)
}

function syncPageFavorite(page) {
  const payload = getLookupPayload(page)
  const currentFavorite = Boolean(payload && getRecordByPayload(payload)?.favorite)
  if (page.data.currentFavorite !== currentFavorite) page.setData({ currentFavorite })
  return currentFavorite
}

function togglePageFavorite(page) {
  const payload = getPayload(page)
  if (!payload) return

  const wasFavorite = Boolean(getRecordByPayload(payload)?.favorite)
  const record = toggleFavorite(payload)
  const currentFavorite = Boolean(record?.favorite)
  const removedFavorite = wasFavorite && !record && !getRecordByPayload(payload)
  if (!record && !removedFavorite) {
    wx.showToast({ title: '保存失败，请检查本地存储', icon: 'none' })
    return
  }
  page.setData({ currentFavorite })
  vibrate('medium')
  wx.showToast({ title: currentFavorite ? '已收藏常用' : '已取消收藏', icon: 'none' })
}

function addPageToActiveProject(page) {
  const payload = getPayload(page)
  if (!payload) return

  const saveToProject = (project) => {
    if (!project) return
    if (!addRecordToProject(payload, project.id)) {
      wx.showToast({ title: '保存失败，请检查本地存储', icon: 'none' })
      return
    }
    vibrate('medium')
    wx.showToast({ title: `已加入${project.name}`, icon: 'none' })
  }
  const activeProject = getActiveProject()

  if (activeProject) {
    saveToProject(activeProject)
    return
  }

  wx.showModal({
    title: '新建现场项目',
    content: '',
    editable: true,
    placeholderText: '例如：三楼会议室',
    confirmText: '创建并加入',
    success: ({ confirm, content }) => {
      if (!confirm) return
      const project = createProject(content)
      if (project) saveToProject(project)
      else wx.showToast({ title: '请输入项目名称', icon: 'none' })
    },
  })
}

module.exports = {
  addPageToActiveProject,
  syncPageFavorite,
  togglePageFavorite,
}
