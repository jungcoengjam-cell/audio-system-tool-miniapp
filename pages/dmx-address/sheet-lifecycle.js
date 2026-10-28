'use strict'

const MAIN_SHEET_CLOSE_MS = 180

function createDmxSheetLifecycleMethods(runtime) {
  const { cancelResultReportGeneration, setTimeout, clearTimeout } = runtime
  return {
    clearSheetCloseTimer(key) {
      if (!this._sheetCloseTimers) this._sheetCloseTimers = Object.create(null)
      if (!this._sheetCloseTokens) this._sheetCloseTokens = Object.create(null)
      clearTimeout(this._sheetCloseTimers[key])
      this._sheetCloseTimers[key] = null
      const token = (Number(this._sheetCloseTokens[key]) || 0) + 1
      this._sheetCloseTokens[key] = token
      return token
    },
    cancelSheetClose(key, closingField = '') {
      const token = this.clearSheetCloseTimer(key)
      if (closingField && this.data[closingField]) this.setData({ [closingField]: false })
      return token
    },
    getSheetModalIdentity(key) {
      const data = this.data
      if (key === 'fixturePicker') {
        return `${Number(Boolean(data.fixtureSearchOpen))}:${Number(Boolean(data.fixtureBatchOpen))}:${Number(data.fixtureSearchGroupIndex)}:${String(data.fixtureSearchSelectedModel || '')}`
      }
      if (key === 'pendingChange') {
        const pending = data.pendingChange
        return pending
          ? `${pending.kind || ''}:${pending.groupId || ''}:${pending.groupIndex ?? ''}:${pending.deleteIndex ?? ''}:${pending.title || ''}`
          : ''
      }
      if (key === 'saveProject') {
        return `${Number(Boolean(data.showSaveNewProject))}:${String(data.pendingProjectSaveId || '')}:${Number(Boolean(data.showNewProjectNameInput))}`
      }
      if (key === 'fixtureChannelGuide') {
        const guide = data.fixtureChannelGuide
        return guide ? `${guide.model || ''}:${guide.actualRangeText || ''}:${guide.channelCount || ''}` : ''
      }
      if (key === 'resultReportPreview') {
        return `${Number(Boolean(data.resultReportPreviewVisible))}:${String(data.resultReportImagePath || '')}:${Number(this.resultReportRevision) || 0}`
      }
      return ''
    },
    openSheetModal(key, closingField = '') {
      const token = this.clearSheetCloseTimer(key)
      if (closingField && this.data[closingField]) this.setData({ [closingField]: false })
      return token
    },
    beginSheetClose(key, closingField, finalize) {
      if (!this._pageAlive) {
        this.clearSheetCloseTimer(key)
        return false
      }
      if (!this._pageVisible) {
        this.cancelSheetClose(key, closingField)
        finalize?.()
        return false
      }
      const token = this.clearSheetCloseTimer(key)
      const contextId = this._contextId
      const modalIdentity = this.getSheetModalIdentity(key)
      const isCurrentClose = () => this._pageAlive && this._pageVisible
        && token === this._sheetCloseTokens[key]
        && contextId === this._contextId
        && modalIdentity === this.getSheetModalIdentity(key)
        && Boolean(this.data[closingField])
      this.setData({ [closingField]: true }, () => {
        if (!isCurrentClose()) return
        const timer = setTimeout(() => {
          if (this._sheetCloseTimers[key] !== timer) return
          this._sheetCloseTimers[key] = null
          if (!isCurrentClose()) return
          finalize?.()
        }, MAIN_SHEET_CLOSE_MS)
        this._sheetCloseTimers[key] = timer
      })
      return true
    },
    clearAllSheetCloseTimers({ preserveSaveProjectExit = false } = {}) {
      ['fixturePicker', 'pendingChange', 'fixtureChannelGuide', 'resultReportPreview',
        ...(!preserveSaveProjectExit ? ['saveProject'] : [])]
        .forEach((key) => this.clearSheetCloseTimer(key))
    },
    dismissMainSheetsImmediately({ preserveFixturePicker = false, preserveSaveProjectExit = false } = {}) {
      this.clearAllSheetCloseTimers({ preserveSaveProjectExit })
      if (!preserveFixturePicker) this.cancelFixtureSearch()
      cancelResultReportGeneration(this)
      if (this.data.pendingChange || this._pendingScheme) this.cancelPendingChange()
      if (!preserveFixturePicker && (this.data.fixtureSearchOpen || this.data.fixtureBatchOpen || this.data.fixturePickerClosing)) {
        this.clearSheetCloseTimer('fixturePicker')
        this.setData({ fixtureSearchOpen: false, fixtureBatchOpen: false, fixturePickerClosing: false })
      }
      if (!preserveSaveProjectExit && (this.data.showSaveNewProject || this.data.saveProjectClosing)) this.closeSaveProjectDialog()
      if (this.data.fixtureChannelGuide || this.data.fixtureChannelGuideClosing) this.closeFixtureChannelGuide()
      const closingFlags = {}
      ;['fixturePickerClosing', 'pendingChangeClosing', 'saveProjectClosing', 'fixtureChannelGuideClosing', 'resultReportPreviewClosing']
        .filter((key) => !(preserveSaveProjectExit && key === 'saveProjectClosing'))
        .forEach((key) => { if (this.data[key]) closingFlags[key] = false })
      if (this.data.resultReportPreviewVisible) closingFlags.resultReportPreviewVisible = false
      if (Object.keys(closingFlags).length) this.setData(closingFlags)
    },
  }
}

module.exports = { createDmxSheetLifecycleMethods }
