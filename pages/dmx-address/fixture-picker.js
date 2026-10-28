const FIXTURE_SEARCH_DELAY = 120

function createFixturePickerMethods({
  ALL_FIXTURE_CATEGORIES,
  DEFAULT_FIXTURE_SEARCH,
  FIXTURE_SEARCH_CATEGORIES,
  searchFixtures,
  decorateBatchRows,
  stageLightingProductIndex,
  createGroup,
  makeStableId,
  getFixtureSearchScrollMetrics,
  vibrate,
  setTimeout,
  clearTimeout,
  now,
}) {
  return {
    resetFixturePicker(mode = 'closed', extra = {}) {
    const open = mode !== 'closed'
    if (open) this.openSheetModal('fixturePicker', 'fixturePickerClosing')
    else this.cancelSheetClose('fixturePicker', 'fixturePickerClosing')
    const fixtureSearchLayout = getFixtureSearchScrollMetrics(this.data, mode === 'batch', 0)
    this.setData({
    fixtureSearchOpen: mode === 'search',
    fixturePickerClosing: false,
    fixtureBatchOpen: mode === 'batch',
    fixtureSearchKeyword: '',
    fixtureSearchCategory: ALL_FIXTURE_CATEGORIES,
    fixtureSearchResults: open ? DEFAULT_FIXTURE_SEARCH.rows : [],
    fixtureSearchTotal: open ? DEFAULT_FIXTURE_SEARCH.total : 0,
    fixtureSearchGroupIndex: -1,
    fixtureSearchSelectedModel: '',
    batchSelectedItems: [],
    batchSelectedTotal: 0,
    removedDetailsExpanded: false,
    ...fixtureSearchLayout,
    ...extra,
    })
    },
    cancelFixtureSearch(preservePending = false) {
    const hasPending = this._fixtureSearchTimer !== null && this._fixtureSearchTimer !== undefined
    if (hasPending) clearTimeout(this._fixtureSearchTimer)
    this._fixtureSearchTimer = null
    this._fixtureSearchToken = (Number(this._fixtureSearchToken) || 0) + 1
    this._fixtureSearchNeedsRefresh = Boolean(preservePending
    && !this.data.fixturePickerClosing
    && (this.data.fixtureSearchOpen || this.data.fixtureBatchOpen))
    },
    closeFixturePicker() {
    this.cancelFixtureSearch()
    this.resetFixturePicker()
    },
    onUserCloseFixturePicker() {
    if ((!this.data.fixtureSearchOpen && !this.data.fixtureBatchOpen) || this.data.fixturePickerClosing) return
    this.cancelFixtureSearch()
    this.beginSheetClose('fixturePicker', 'fixturePickerClosing', () => this.closeFixturePicker())
    },
    onFixtureSearchInput(event) {
    if (!this._pageAlive || !this._pageVisible || this.data.fixturePickerClosing) return
    const fixtureSearchKeyword = event.detail.value
    this.setData({ fixtureSearchKeyword })
    this.cancelFixtureSearch()
    const searchToken = this._fixtureSearchToken
    this._fixtureSearchTimer = setTimeout(() => {
    if (searchToken !== this._fixtureSearchToken) return
    this._fixtureSearchTimer = null
    if (!this._pageAlive || !this._pageVisible) {
    this._fixtureSearchNeedsRefresh = Boolean(this.data.fixtureSearchOpen || this.data.fixtureBatchOpen)
    return
    }
    this.applyFixtureSearch()
    }, FIXTURE_SEARCH_DELAY)
    },
    applyFixtureSearch() {
    if (this.data.fixturePickerClosing) return false
    if (!this._pageAlive || !this._pageVisible) {
    this._fixtureSearchNeedsRefresh = Boolean(this.data.fixtureSearchOpen || this.data.fixtureBatchOpen)
    return false
    }
    const search = searchFixtures(
    this.data.fixtureSearchKeyword,
    this.data.fixtureSearchCategory,
    )
    this.setData({
    fixtureSearchResults: this.data.fixtureBatchOpen
    ? decorateBatchRows(search.rows, this.data.batchSelectedItems)
    : search.rows,
    fixtureSearchTotal: search.total,
    })
    return true
    },
    selectFixtureCategory(event) {
    if (!this._pageAlive || !this._pageVisible || this.data.fixturePickerClosing) return
    const fixtureSearchCategory = event.currentTarget.dataset.category
    if (!FIXTURE_SEARCH_CATEGORIES.some((item) => item.label === fixtureSearchCategory)
    || fixtureSearchCategory === this.data.fixtureSearchCategory) return
    this.cancelFixtureSearch()
    vibrate('light')
    const search = searchFixtures(this.data.fixtureSearchKeyword, fixtureSearchCategory)
    this.setData({
    fixtureSearchCategory,
    fixtureSearchResults: this.data.fixtureBatchOpen
    ? decorateBatchRows(search.rows, this.data.batchSelectedItems)
    : search.rows,
    fixtureSearchTotal: search.total,
    })
    },
    flushFixtureSearch() {
    if (!this._pageAlive || !this._pageVisible || this.data.fixturePickerClosing) return
    this.cancelFixtureSearch()
    this.applyFixtureSearch()
    },
    clearFixtureSearch() {
    if (!this._pageAlive || !this._pageVisible || this.data.fixturePickerClosing) return
    this.setData({ fixtureSearchKeyword: '' }, () => this.applyFixtureSearch())
    },
    openModelPicker(event) {
    if (!this._pageAlive || !this._pageVisible || now() < (Number(this._suppressFloatingOpenUntil) || 0)) return
    const index = Number(event.currentTarget.dataset.index)
    if (!this.data.groups[index]) return
    this.cancelFixtureSearch()
    this.resetFixturePicker('search', {
    fixtureSearchGroupIndex: index,
    fixtureSearchSelectedModel: this.data.groups[index].fixtureModel,
    })
    },
    openFixtureSearch(event) {
    this.openModelPicker(event)
    },
    selectFixture(event) {
    if (this.data.fixturePickerClosing) return
    if (this.data.fixtureBatchOpen) return this.toggleBatchFixture(event)
    const fixture = stageLightingProductIndex.get(event.currentTarget.dataset.model)
    if (!fixture || !fixture.channelModes?.length) return
    const index = this.data.fixtureSearchGroupIndex
    this.cancelFixtureSearch()
    this.beginSheetClose('fixturePicker', 'fixturePickerClosing', () => {
    this.closeFixturePicker()
    if (index < 0) {
    const group = {
    ...createGroup(this._nextGroupId, {
    fixtureSource: 'library',
    fixtureModel: fixture.model,
    fixtureCount: 1,
    }),
    _lightingGroupId: makeStableId('group'),
    name: `${fixture.model} ${fixture.name}`,
    channelModes: fixture.channelModes,
    channelCount: String(fixture.channelModes[0]),
    fixtureCount: '1',
    }
    const groups = [...this.data.groups, group]
    const candidate = this.buildSchemeFromState({ ...this.data, groups })
    const groupIndex = groups.length - 1
    this.buildPendingPreview(candidate, {
    kind: 'add',
    title: '确认添加灯组',
    groupIndex,
    groupId: group._lightingGroupId,
    quantityText: '1',
    channelCount: fixture.channelModes[0],
    channelModeIndex: 0,
    channelModes: fixture.channelModes,
    fixtureModel: fixture.model,
    fixtureName: fixture.name,
    })
    this._nextGroupId += 1
    return
    }
    const current = this.data.groups[index]
    if (!current) return
    const groups = this.data.groups.map((group, groupIndex) => groupIndex === index
    ? {
    ...group,
    name: `${fixture.model} ${fixture.name}`,
    fixtureSource: 'library',
    fixtureModel: fixture.model,
    fixtureName: fixture.name,
    channelModes: fixture.channelModes,
    libraryChannelCount: String(fixture.channelModes[0]),
    channelModeIndex: 0,
    channelCount: String(fixture.channelModes[0]),
    }
    : group)
    const candidate = this.buildSchemeFromState({ ...this.data, groups })
    this.buildPendingPreview(candidate, {
    kind: 'edit',
    title: '确认更换灯具型号',
    groupIndex: index,
    groupId: current._lightingGroupId,
    quantityText: String(current.fixtureCount),
    channelCount: fixture.channelModes[0],
    channelModeIndex: 0,
    channelModes: fixture.channelModes,
    fixtureModel: fixture.model,
    fixtureName: fixture.name,
    })
    })
    }
  }
}

module.exports = { createFixturePickerMethods }
