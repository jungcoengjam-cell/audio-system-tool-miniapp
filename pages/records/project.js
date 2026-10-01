const { APP_VERSION, PRODUCT_DATA_DATE } = require('../../data/app-meta')
const { printPerformanceSummary, startMeasurement } = require('../../utils/performance')
const { STANDARD_CLASSES } = require('../../utils/venue')
const { buildRecordComparison } = require('../../utils/record-comparison')
const { vibrate } = require('../../utils/haptics')
const {
  previewGeneratedImage,
  saveGeneratedImage,
  shareGeneratedImage,
} = require('../../utils/report-image-actions')
const {
  REPORT_CANVAS_ID,
  REPORT_WIDTH,
  buildProjectReportPayload,
  calculateProjectReportHeight,
  drawProjectReport,
  getExportDimensions,
} = require('./project-report')
const {
  MODULES,
  getStorageHealth,
  getWorkspaceSnapshot,
  prepareProjectModule,
  removeRecordFromProject,
  restoreRecord,
  setActiveProject,
  updateProject,
} = require('../../utils/records')

function pad(value) {
  return value < 10 ? `0${value}` : String(value)
}

function formatTime(timestamp, includeYear = false) {
  const date = new Date(timestamp)
  const dateText = includeYear
    ? `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    : `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  return `${dateText} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function formatDate(timestamp) {
  return formatTime(timestamp, true).slice(0, 10)
}

function decorateRecords(records) {
  return records.map((record, index) => ({
    id: record.id,
    module: record.module,
    displayIndex: index + 1,
    moduleLabel: MODULES[record.module]?.label || '计算',
    trustLabel: MODULES[record.module]?.trustLabel || '计算结果',
    theme: MODULES[record.module]?.theme || 'cyan',
    timeText: formatTime(record.updatedAt),
    title: record.title,
    summary: record.summary,
  }))
}

function groupRecords(records) {
  const grouped = Object.create(null)
  Object.keys(MODULES).forEach((module) => { grouped[module] = [] })
  records.forEach((record) => {
    if (grouped[record.module]) grouped[record.module].push(record)
  })
  return Object.entries(MODULES).map(([module, metadata]) => ({
    module,
    label: metadata.label,
    theme: metadata.theme,
    trustLabel: metadata.trustLabel,
    trustDescription: metadata.trustDescription,
    records: grouped[module],
  })).filter((group) => group.records.length)
}

function getModuleProgress(records) {
  const counts = Object.create(null)
  records.forEach((record) => { counts[record.module] = (counts[record.module] || 0) + 1 })
  return Object.entries(MODULES).map(([key, module]) => {
    const count = counts[key] || 0
    return {
      key,
      label: module.label,
      theme: module.theme,
      count,
      complete: count > 0,
      statusText: count ? `${count} 条结果` : '尚未计算',
      actionText: count ? '继续计算' : '开始计算',
    }
  })
}

function getProjectWiringSummary(project) {
  const lines = Array.isArray(project && project.wiringSchedule && project.wiringSchedule.lines)
    ? project.wiringSchedule.lines
    : []
  return {
    lineCount: lines.length,
    pendingCount: lines.filter((line) => line && line.status !== 'checked').length,
  }
}

Page({
  data: {
    project: null,
    records: [],
    recordGroups: [],
    moduleProgress: [],
    compareSelectedIds: [],
    comparison: null,
    standardClasses: STANDARD_CLASSES,
    standardClassIndex: 0,
    gradeIndex: 0,
    storageHealth: null,
    editing: false,
    projectForm: {
      name: '',
      venueName: '',
      engineer: '',
      projectDate: '',
      notes: '',
      roomLengthText: '',
      roomWidthText: '',
      roomHeightText: '',
      standardClassKey: 'conference',
      gradeKey: 'II',
    },
    missing: false,
    reportCanvasWidth: REPORT_WIDTH,
    reportCanvasHeight: 1200,
    reportImagePath: '',
    reportPreviewVisible: false,
    isGeneratingReport: false,
  },

  onLoad(options) {
    this.projectId = options.id || ''
    this._skipNextShowRefresh = true
    this.refresh({ forceRefresh: true })
  },

  onShow() {
    if (this._skipNextShowRefresh) {
      this._skipNextShowRefresh = false
      return
    }
    if (this.projectId && !this.data.editing) this.refresh({ forceRefresh: true })
  },

  onUnload() {
    this.reportRevision = (this.reportRevision || 0) + 1
    this.reportPendingSignature = ''
    if (this.data.isGeneratingReport && typeof wx.hideLoading === 'function') wx.hideLoading()
    printPerformanceSummary('项目详情/')
  },

  refresh(options = {}) {
    const finishRefresh = startMeasurement('项目详情/刷新总耗时')
    const snapshot = getWorkspaceSnapshot({
      forceRefresh: options.forceRefresh === true || Boolean(this.data.workspaceError),
    })
    if (snapshot.ok === false) {
      if (this.data.isGeneratingReport || this.reportPendingSignature) {
        this.reportRevision = (this.reportRevision || 0) + 1
        this.reportPendingSignature = ''
        if (this.data.isGeneratingReport && typeof wx.hideLoading === 'function') wx.hideLoading()
      }
      this.setData({
        workspaceError: snapshot.error || '本地项目和收藏数据读取失败，请重试。',
        ...(this.data.isGeneratingReport ? { isGeneratingReport: false } : {}),
      })
      finishRefresh({ storageError: true })
      return
    }
    const { projects, records: allRecords, activeProject } = snapshot
    const project = projects.find((item) => item.id === this.projectId) || null
    if (!project) {
      if (this.reportPendingSignature || this.reportSignature) {
        this.reportRevision = (this.reportRevision || 0) + 1
        this.reportPendingSignature = ''
        this.reportSignature = ''
        if (this.data.isGeneratingReport && typeof wx.hideLoading === 'function') wx.hideLoading()
      }
      if (this.projectViewSignature === 'missing') {
        if (this.data.workspaceError) this.setData({ workspaceError: '' })
        finishRefresh({ skipped: true, missing: true })
        return
      }
      this.projectViewSignature = 'missing'
      this.rawRecords = []
      const finishViewUpdate = startMeasurement('项目详情/setData视图更新', { missing: true })
      this.setData({
        project: null,
        records: [],
        recordGroups: [],
        moduleProgress: [],
        reportImagePath: '',
        reportPreviewVisible: false,
        isGeneratingReport: false,
        ...(this.data.workspaceError ? { workspaceError: '' } : {}),
        missing: true,
      }, () => {
        finishViewUpdate()
        finishRefresh({ missing: true })
      })
      wx.setNavigationBarTitle({ title: '项目不存在' })
      return
    }

    const rawRecords = allRecords.filter((record) => record.projectIds?.includes(project.id))
    const { wiringSchedule, ...projectViewFields } = project
    const wiringSummary = getProjectWiringSummary(project)
    const reportSourceSignature = JSON.stringify({
      project: projectViewFields,
      records: rawRecords.map((record) => ({
        id: record.id,
        title: record.title,
        summary: record.summary,
        updatedAt: record.updatedAt,
      })),
    })
    const viewSignature = JSON.stringify({
      project: projectViewFields,
      wiringSummary,
      wiringRevision: Number(wiringSchedule && wiringSchedule.revision) || 0,
      activeProjectId: activeProject?.id || '',
      records: rawRecords.map((record) => ({
        id: record.id,
        updatedAt: record.updatedAt,
        favorite: record.favorite,
        projectIds: record.projectIds,
      })),
    })
    if (viewSignature === this.projectViewSignature) {
      if (this.data.workspaceError) this.setData({ workspaceError: '' })
      finishRefresh({ skipped: true, records: rawRecords.length })
      return
    }
    this.projectViewSignature = viewSignature
    const finishBuildView = startMeasurement('项目详情/整理项目记录', { records: rawRecords.length })
    const records = decorateRecords(rawRecords)
    const recordGroups = groupRecords(records)
    const normalizedProject = {
      ...projectViewFields,
      venueName: project.venueName || '',
      engineer: project.engineer || '',
      projectDate: project.projectDate || formatDate(project.createdAt),
      notes: project.notes || '',
      roomLengthText: project.roomLengthText || '',
      roomWidthText: project.roomWidthText || '',
      roomHeightText: project.roomHeightText || '',
      standardClassKey: project.standardClassKey || 'conference',
      gradeKey: project.gradeKey || 'II',
      dimensionText: project.roomLengthText && project.roomWidthText && project.roomHeightText
        ? `${project.roomLengthText} × ${project.roomWidthText} × ${project.roomHeightText} m`
        : '未填写',
      standardText: `${project.standardClassKey === 'conference' ? '会议类扩声' : project.standardClassKey} ${project.gradeKey || ''}`,
      isActive: project.id === activeProject?.id,
      recordCount: records.length,
      timeText: formatTime(project.updatedAt),
      wiringLineCount: wiringSummary.lineCount,
      wiringPendingCount: wiringSummary.pendingCount,
    }
    const previousReportSignature = this.reportPendingSignature || this.reportSignature
    const reportChanged = previousReportSignature && previousReportSignature !== reportSourceSignature
    if (reportChanged) {
      this.reportRevision = (this.reportRevision || 0) + 1
      this.reportPendingSignature = ''
      if (this.data.isGeneratingReport && typeof wx.hideLoading === 'function') wx.hideLoading()
    }
    this.reportSourceSignature = reportSourceSignature
    if (reportChanged) this.reportSignature = ''
    this.rawRecords = rawRecords
    finishBuildView({ groups: recordGroups.length })
    const finishViewUpdate = startMeasurement('项目详情/setData视图更新', { records: records.length })
    this.setData({
      project: normalizedProject,
      records: records.map(({ id, module }) => ({ id, module })),
      recordGroups,
      moduleProgress: getModuleProgress(records),
      compareSelectedIds: [],
      comparison: null,
      storageHealth: getStorageHealth(),
      ...(this.data.workspaceError ? { workspaceError: '' } : {}),
      ...(reportChanged ? { reportImagePath: '', reportPreviewVisible: false, isGeneratingReport: false } : {}),
      missing: false,
    }, () => {
      finishViewUpdate()
      finishRefresh({ records: records.length, groups: recordGroups.length })
    })
    wx.setNavigationBarTitle({ title: project.name })
  },

  retryWorkspace() {
    this.refresh({ forceRefresh: true })
  },

  activateProject() {
    if (!this.data.project || this.data.workspaceError) return
    if (!setActiveProject(this.data.project.id)) {
      wx.showToast({ title: '设置失败，请重试', icon: 'none' })
      return
    }
    this.refresh()
    wx.showToast({ title: '已设为当前项目', icon: 'none' })
  },

  startEditProject() {
    const project = this.data.project
    if (!project || this.data.workspaceError) return
    const standardClassIndex = Math.max(0, STANDARD_CLASSES.findIndex((item) => item.key === project.standardClassKey))
    const standardClass = STANDARD_CLASSES[standardClassIndex]
    const gradeIndex = Math.max(0, standardClass.grades.findIndex((item) => item.key === project.gradeKey))
    this.setData({
      editing: true,
      standardClassIndex,
      gradeIndex,
      projectForm: {
        name: project.name,
        venueName: project.venueName,
        engineer: project.engineer,
        projectDate: project.projectDate,
        notes: project.notes,
        roomLengthText: project.roomLengthText,
        roomWidthText: project.roomWidthText,
        roomHeightText: project.roomHeightText,
        standardClassKey: standardClass.key,
        gradeKey: standardClass.grades[gradeIndex].key,
      },
    })
  },

  cancelEditProject() {
    this.setData({ editing: false })
  },

  onProjectFieldInput(event) {
    const field = event.currentTarget.dataset.field
    if (!Object.prototype.hasOwnProperty.call(this.data.projectForm, field)) return
    this.setData({
      projectForm: { ...this.data.projectForm, [field]: event.detail.value },
    })
  },

  onProjectDateChange(event) {
    this.setData({
      projectForm: { ...this.data.projectForm, projectDate: event.detail.value },
    })
  },

  onProjectStandardChange(event) {
    const standardClassIndex = Number(event.detail.value)
    const standardClass = STANDARD_CLASSES[standardClassIndex]
    this.setData({
      standardClassIndex,
      gradeIndex: 0,
      projectForm: {
        ...this.data.projectForm,
        standardClassKey: standardClass.key,
        gradeKey: standardClass.grades[0].key,
      },
    })
  },

  onProjectGradeChange(event) {
    const gradeIndex = Number(event.detail.value)
    const standardClass = STANDARD_CLASSES[this.data.standardClassIndex]
    this.setData({
      gradeIndex,
      projectForm: { ...this.data.projectForm, gradeKey: standardClass.grades[gradeIndex].key },
    })
  },

  openProjectModule(event) {
    if (this.data.workspaceError) return
    const path = prepareProjectModule(this.projectId, event.currentTarget.dataset.module)
    if (path) wx.navigateTo({ url: path })
  },

  openProjectWiring() {
    if (!this.projectId || this.data.workspaceError) return
    wx.navigateTo({ url: `/pages/project-wiring/index?id=${encodeURIComponent(this.projectId)}` })
  },

  toggleCompareRecord(event) {
    const recordId = event.currentTarget.dataset.id
    const record = this.rawRecords.find((item) => item.id === recordId)
    if (!record) return

    const current = this.data.compareSelectedIds
      .map((id) => this.rawRecords.find((item) => item.id === id))
      .filter(Boolean)
    if (current.length && current[0].module !== record.module) {
      wx.showToast({ title: '只能比较同一计算模块', icon: 'none' })
      return
    }

    const wasSelected = current.some((item) => item.id === recordId)
    if (!wasSelected && current.length >= 2) {
      wx.showToast({ title: '每次最多比较两条记录', icon: 'none' })
      return
    }
    const selected = wasSelected
      ? current.filter((item) => item.id !== recordId)
      : [...current, record]

    const selectedIds = selected.map((item) => item.id)
    const recordGroups = groupRecords(decorateRecords(this.rawRecords)).map((group) => ({
      ...group,
      records: group.records.map((item) => ({ ...item, compareSelected: selectedIds.includes(item.id) })),
    }))
    this.setData({
      compareSelectedIds: selectedIds,
      comparison: selected.length === 2 ? buildRecordComparison(selected) : null,
      recordGroups,
    })
  },

  clearComparison() {
    this.setData({
      compareSelectedIds: [],
      comparison: null,
      recordGroups: groupRecords(decorateRecords(this.rawRecords)),
    })
  },

  saveProjectDetails() {
    if (this.data.workspaceError) return
    const updated = updateProject(this.projectId, this.data.projectForm)
    if (!updated) {
      wx.showToast({ title: '项目名称为空或已存在', icon: 'none' })
      return
    }
    this.setData({ editing: false })
    this.refresh()
    wx.showToast({ title: '项目资料已保存', icon: 'none' })
  },

  restoreRecord(event) {
    if (this.data.workspaceError) return
    const record = this.rawRecords.find((item) => item.id === event.currentTarget.dataset.id)
    const path = restoreRecord(record)
    if (path) wx.navigateTo({ url: path })
  },

  removeProjectRecord(event) {
    if (this.data.workspaceError) return
    const recordId = event.currentTarget.dataset.id
    wx.showModal({
      title: '从项目中移除？',
      content: '若该记录未收藏且不属于其他项目，移除后将同时清理。',
      confirmColor: '#ff3b30',
      success: ({ confirm }) => {
        if (!confirm || this.data.workspaceError || !removeRecordFromProject(recordId, this.projectId)) return
        this.refresh()
        wx.showToast({ title: '已从项目移除', icon: 'none' })
      },
    })
  },

  getProjectReportText() {
    if (this.data.workspaceError) return ''
    const project = this.data.project
    if (!project) return ''

    const groups = groupRecords(this.rawRecords || [])
    const lines = [
      '现场项目调试报告',
      `项目名称：${project.name}`,
      `场地名称：${project.venueName || '未填写'}`,
      `调试日期：${project.projectDate || '未填写'}`,
      `调试人员：${project.engineer || '未填写'}`,
      `现场备注：${project.notes || '无'}`,
      `场地尺寸：${project.roomLengthText && project.roomWidthText && project.roomHeightText
        ? `${project.roomLengthText} × ${project.roomWidthText} × ${project.roomHeightText} m`
        : '未填写'}`,
      `扩声目标：${project.standardClassKey === 'conference' ? '会议类扩声' : project.standardClassKey} ${project.gradeKey || ''}`,
      `模块进度：${getModuleProgress(this.rawRecords).map((item) => `${item.label}${item.complete ? '已完成' : '未完成'}`).join('、')}`,
      `计算记录：${this.rawRecords.length} 条`,
      `报告生成：${formatTime(Date.now(), true)}`,
      `小程序版本：${APP_VERSION}`,
      `产品资料复核：${PRODUCT_DATA_DATE}`,
      '',
      '结果说明：以下内容包含参数计算、理论估算、公司标准推荐或前期粗略方案，不替代现场测量与工程复核。',
      '',
    ]

    groups.forEach((group) => {
      lines.push(`【${group.label}｜${group.trustLabel}】`, group.trustDescription)
      group.records.forEach((record, index) => {
        lines.push(
          `—— ${index + 1}. ${record.title} ——`,
          `记录时间：${formatTime(record.updatedAt, true)}`,
          record.resultText,
          '',
        )
      })
    })
    return lines.join('\n').trim()
  },

  copyProject() {
    if (this.data.workspaceError) return
    const text = this.getProjectReportText()
    if (text) wx.setClipboardData({ data: text })
  },

  finishReportGeneration(revision, changes = {}) {
    if (this.reportRevision !== revision) return
    if (typeof wx.hideLoading === 'function') wx.hideLoading()
    this.reportPendingSignature = ''
    this.setData({ isGeneratingReport: false, ...changes })
  },

  generateProjectReportImage() {
    if (this.data.workspaceError) return
    const payload = buildProjectReportPayload(this.data.project, this.data.recordGroups, {
      totalModuleCount: Object.keys(MODULES).length,
      generatedAt: formatTime(Date.now(), true),
      appVersion: APP_VERSION,
      productDataDate: PRODUCT_DATA_DATE,
    })
    if (!payload || this.data.isGeneratingReport) {
      if (!payload) wx.showToast({ title: '暂无可生成的项目记录', icon: 'none' })
      return
    }
    const signature = this.reportSourceSignature || this.projectViewSignature
    if (this.data.reportImagePath && this.reportSignature === signature) {
      vibrate('light')
      this.setData({ reportPreviewVisible: true })
      return
    }
    if (typeof wx.createCanvasContext !== 'function'
      || typeof wx.canvasToTempFilePath !== 'function') {
      wx.showToast({ title: '当前微信版本暂不支持生成图片', icon: 'none' })
      return
    }

    vibrate('medium')
    const reportCanvasHeight = calculateProjectReportHeight(payload)
    const revision = (this.reportRevision || 0) + 1
    this.reportRevision = revision
    this.reportPendingSignature = signature
    const isCurrent = () => this.reportRevision === revision
      && this.reportPendingSignature === signature
    this.setData({
      reportCanvasHeight,
      isGeneratingReport: true,
      reportPreviewVisible: false,
    }, () => {
      if (this.reportRevision !== revision) return
      if (typeof wx.showLoading === 'function') wx.showLoading({ title: '正在生成图片', mask: true })
      try {
        const context = wx.createCanvasContext(REPORT_CANVAS_ID, this)
        const finishReportDrawing = startMeasurement('项目详情/长图绘制', {
          records: payload.groups.reduce((total, group) => total + group.records.length, 0),
        })
        drawProjectReport(context, payload, reportCanvasHeight)
        finishReportDrawing({ height: reportCanvasHeight })
        context.draw(false, () => {
          if (!isCurrent()) return
          const exportDimensions = getExportDimensions(reportCanvasHeight)
          const finishReportExport = startMeasurement('项目详情/长图导出', exportDimensions)
          wx.canvasToTempFilePath({
            canvasId: REPORT_CANVAS_ID,
            width: REPORT_WIDTH,
            height: reportCanvasHeight,
            ...exportDimensions,
            fileType: 'png',
            quality: 1,
            success: ({ tempFilePath }) => {
              if (!isCurrent()) return
              finishReportExport({ success: Boolean(tempFilePath) })
              if (!tempFilePath) {
                this.finishReportGeneration(revision)
                wx.showToast({ title: '图片生成失败，请重试', icon: 'none' })
                return
              }
              this.reportSignature = signature
              this.finishReportGeneration(revision, {
                reportImagePath: tempFilePath,
                reportPreviewVisible: true,
              })
            },
            fail: () => {
              if (!isCurrent()) return
              finishReportExport({ success: false })
              this.finishReportGeneration(revision)
              wx.showToast({ title: '图片生成失败，请重试', icon: 'none' })
            },
          }, this)
        })
      } catch (error) {
        if (!isCurrent()) return
        this.finishReportGeneration(revision)
        wx.showToast({ title: '图片生成失败，请重试', icon: 'none' })
      }
    })
  },

  closeProjectReportPreview() {
    vibrate('light')
    this.setData({ reportPreviewVisible: false })
  },

  stopEvent() {},
  preventTouchMove() {},

  previewProjectReportImage() {
    if (this.data.workspaceError) return
    previewGeneratedImage(this.data.reportImagePath)
  },

  shareProjectReportImage() {
    if (this.data.workspaceError) return
    shareGeneratedImage(this.data.reportImagePath)
  },

  saveProjectReportImage() {
    if (this.data.workspaceError) return
    saveGeneratedImage(this.data.reportImagePath)
  },
})
