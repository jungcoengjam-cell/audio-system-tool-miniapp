const {
  addRecordToProject,
  createProject,
  getRecordByPayload,
  getWorkspaceSnapshot,
  toggleFavorite,
} = require('./records')
const { vibrate } = require('./haptics')

const ACTION_SHEET_LIMIT = 6

function getPayload(page) {
  return typeof page.getRecordPayload === 'function' ? page.getRecordPayload() : null
}

function getLookupPayload(page) {
  return typeof page.getRecordLookupPayload === 'function'
    ? page.getRecordLookupPayload()
    : getPayload(page)
}

function showToast(title) {
  if (typeof wx.showToast === 'function') wx.showToast({ title, icon: 'none' })
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
    showToast('保存失败，请检查本地存储')
    return
  }
  page.setData({ currentFavorite })
  vibrate('medium')
  showToast(currentFavorite ? '已收藏常用' : '已取消收藏')
}

function serializePayload(payload) {
  try {
    return JSON.stringify(payload)
  } catch (error) {
    return ''
  }
}

function isPageVisible(page) {
  if (page._pageVisible === false) return false
  if (typeof getCurrentPages === 'function') {
    try {
      const pages = getCurrentPages()
      return Array.isArray(pages) && pages.length > 0 && pages[pages.length - 1] === page
    } catch (error) {
      return false
    }
  }
  return true
}

function isSaveCurrent(page, isCurrent, payloadSignature) {
  if (!isCurrent() || !isPageVisible(page)) return false
  const currentPayload = getPayload(page)
  return Boolean(currentPayload && serializePayload(currentPayload) === payloadSignature)
}

function showReadFailure() {
  showToast('读取项目列表失败，请检查本地存储后重试')
}

function getFreshWorkspace() {
  const snapshot = getWorkspaceSnapshot({ forceRefresh: true })
  if (snapshot.ok === false) {
    showReadFailure()
    return null
  }
  return snapshot
}

function addPageToActiveProject(page, isCurrent = () => true) {
  if (page._projectSavePending || !isCurrent() || !isPageVisible(page)) return false
  const initialPayload = getPayload(page)
  const payloadSignature = serializePayload(initialPayload)
  if (!initialPayload || !payloadSignature) return false

  const requestId = (page._projectSaveRequestId || 0) + 1
  page._projectSaveRequestId = requestId
  page._projectSavePending = true
  const payload = JSON.parse(payloadSignature)

  const isRequestActive = () => page._projectSaveRequestId === requestId && page._projectSavePending
  const finish = () => {
    if (isRequestActive()) page._projectSavePending = false
  }
  const failIfStale = () => {
    if (!isRequestActive()) return true
    if (!isSaveCurrent(page, isCurrent, payloadSignature)) {
      if (isPageVisible(page)) showToast('\u4fdd\u5b58\u5185\u5bb9\u5df2\u53d8\u5316\uff0c\u8bf7\u91cd\u65b0\u9009\u62e9')
      finish()
      return true
    }
    return false
  }
  const writeToProject = (project) => {
    if (!addRecordToProject(payload, project.id)) {
      showToast('\u4fdd\u5b58\u5931\u8d25\uff0c\u8bf7\u68c0\u67e5\u672c\u5730\u5b58\u50a8')
      return finish()
    }
    vibrate('medium')
    showToast('\u5df2\u52a0\u5165' + project.name)
    finish()
  }
  const confirmSaveToProject = (projectId, selectedName) => {
    if (failIfStale()) return
    wx.showModal({
      title: '\u786e\u8ba4\u4fdd\u5b58\u4f4d\u7f6e',
      content: '\u5c06\u5f53\u524d\u7ed3\u679c\u4fdd\u5b58\u5230\u201c' + selectedName + '\u201d\u5417\uff1f',
      confirmText: '\u4fdd\u5b58',
      cancelText: '\u53d6\u6d88',
      success: ({ confirm }) => {
        if (!confirm) return finish()
        if (failIfStale()) return
        const snapshot = getFreshWorkspace()
        if (!snapshot) return finish()
        const project = snapshot.projects.find((item) => item.id === projectId)
        if (!project) {
          showToast('\u76ee\u6807\u9879\u76ee\u5df2\u4e0d\u5b58\u5728\uff0c\u8bf7\u91cd\u65b0\u9009\u62e9')
          return finish()
        }
        if (project.name !== selectedName) {
          showToast('\u9879\u76ee\u540d\u79f0\u5df2\u53d8\u66f4\uff0c\u8bf7\u91cd\u65b0\u9009\u62e9')
          return finish()
        }
        writeToProject(project)
      },
      fail: () => finish(),
    })
  }
  const createAndSave = () => {
    wx.showModal({
      title: '新建现场项目',
      content: '',
      editable: true,
      placeholderText: '例如：三楼会议室',
      confirmText: '创建并加入',
      success: ({ confirm, content }) => {
        if (!confirm) return finish()
        if (failIfStale()) return
        if (!getFreshWorkspace()) return finish()
        const project = createProject(content)
        if (!project) {
          showToast(content?.trim() ? '新建失败，请检查本地存储' : '请输入项目名称')
          return finish()
        }
        confirmSaveToProject(project.id, project.name)
      },
      fail: () => finish(),
    })
  }
  const showProjectChoices = (snapshot, start = 0, starts = [0]) => {
    if (failIfStale()) return
    const projects = snapshot.projects
    if (!projects.length) return createAndSave()

    const canPrevious = start > 0
    const remaining = projects.length - start
    const maxProjectsWithoutNext = ACTION_SHEET_LIMIT - 1 - (canPrevious ? 1 : 0)
    const canNext = remaining > maxProjectsWithoutNext
    const pageSize = Math.min(remaining, maxProjectsWithoutNext - (canNext ? 1 : 0))
    const pageProjects = projects.slice(start, start + pageSize)
    const itemList = pageProjects.map((project) => (
      `${project.name}${snapshot.activeProject?.id === project.id ? '（当前）' : ''}`
    ))
    const actions = pageProjects.map((project) => ({ type: 'project', id: project.id, name: project.name }))
    if (canPrevious) {
      itemList.push('上一页项目')
      actions.push({ type: 'previous' })
    }
    if (canNext) {
      itemList.push('下一页项目')
      actions.push({ type: 'next', start: start + pageSize })
    }
    itemList.push('新建项目并保存')
    actions.push({ type: 'create' })

    wx.showActionSheet({
      itemList,
      success: ({ tapIndex }) => {
        const action = actions[tapIndex]
        if (!action) return finish()
        if (failIfStale()) return
        if (action.type === 'project') return confirmSaveToProject(action.id, action.name)
        if (action.type === 'create') return createAndSave()
        if (action.type === 'previous') {
          const previousStarts = starts.slice(0, -1)
          return showProjectChoices(snapshot, previousStarts[previousStarts.length - 1] || 0, previousStarts)
        }
        const nextStarts = [...starts, action.start]
        return showProjectChoices(snapshot, action.start, nextStarts)
      },
      fail: () => finish(),
    })
  }

  const snapshot = getFreshWorkspace()
  if (!snapshot) {
    finish()
    return false
  }
  showProjectChoices(snapshot)
  return true
}

module.exports = {
  addPageToActiveProject,
  syncPageFavorite,
  togglePageFavorite,
}
