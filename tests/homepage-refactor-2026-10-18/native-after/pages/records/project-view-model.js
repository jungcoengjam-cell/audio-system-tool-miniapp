'use strict'

const FILTERS = new Set(['all', 'calculations', 'wiring', 'lighting'])

function text(value) {
  if (value === undefined || value === null) return ''
  return typeof value === 'string' ? value : String(value)
}

function containsQuery(values, query) {
  if (!query) return true
  return values.some((value) => text(value).toLowerCase().includes(query))
}

function buildProjectContentView(options = {}) {
  const projectId = text(options.projectId)
  const rawFilter = text(options.filter || 'all')
  const filter = FILTERS.has(rawFilter) ? rawFilter : 'all'
  const query = text(options.searchText).trim().toLowerCase()
  const records = (Array.isArray(options.records) ? options.records : [])
    .filter((record) => record && Array.isArray(record.projectIds) && record.projectIds.includes(projectId))
    .filter((record) => containsQuery([
      record.title,
      record.summary,
      record.resultText,
      record.projectNote,
      record.module,
      JSON.stringify(record.preferences || {}),
    ], query))

  const schedule = options.wiringSchedule && typeof options.wiringSchedule === 'object'
    ? options.wiringSchedule
    : {}
  const wiringLines = (Array.isArray(schedule.lines) ? schedule.lines : []).map((line, index) => {
    const source = line && typeof line === 'object' ? line : {}
    const endpointSummary = `${text(source.fromDevice)} · ${text(source.fromPort)} → ${text(source.toDevice)} · ${text(source.toPort)}`
    const materialSummary = [source.spec, source.lengthText ? `${source.lengthText} m` : '', source.status === 'checked' ? '已核对' : '待核对']
      .map(text).filter(Boolean).join(' · ')
    return {
      ...source,
      displayTitle: text(source.code) || `线路 ${index + 1}`,
      endpointSummary,
      materialSummary,
      searchText: JSON.stringify(source),
    }
  }).filter((line) => containsQuery([
    line.displayTitle, line.endpointSummary, line.materialSummary, line.searchText,
  ], query))

  const lightingFixtures = (Array.isArray(options.lightingFixtures) ? options.lightingFixtures : []).map((fixture) => {
    const source = fixture && typeof fixture === 'object' ? fixture : {}
    return {
      ...source,
      displayTitle: [text(source.groupName), source.fixtureIndex ? `第 ${source.fixtureIndex} 台` : ''].filter(Boolean).join(' · ')
        || '灯位',
      addressSummary: [
        source.universeLabel ? `域 ${source.universeLabel}` : '',
        source.rangeText || source.addressText || '',
      ].map(text).filter(Boolean).join(' · '),
      modelSummary: text(source.fixtureModel),
      searchText: JSON.stringify(source),
    }
  }).filter((fixture) => containsQuery([
    fixture.displayTitle, fixture.addressSummary, fixture.modelSummary, fixture.searchText,
  ], query))

  const includeCalculations = filter === 'all' || filter === 'calculations'
  const includeWiring = filter === 'all' || filter === 'wiring'
  const includeLighting = filter === 'all' || filter === 'lighting'
  const visibleRecords = includeCalculations ? records : []
  const visibleWiringLines = includeWiring ? wiringLines : []
  const visibleLightingFixtures = includeLighting ? lightingFixtures : []
  const visibleCount = visibleRecords.length + visibleWiringLines.length + visibleLightingFixtures.length
  const hasVisibleReadError = includeLighting && Boolean(options.lightingReadError && !query)

  return {
    filter,
    visibleRecords,
    visibleWiringLines,
    visibleLightingFixtures,
    showCalculations: includeCalculations,
    showWiring: includeWiring && wiringLines.length > 0,
    showLighting: includeLighting && (lightingFixtures.length > 0 || hasVisibleReadError),
    lightingReadError: text(options.lightingReadError),
    visibleCount,
    isSearchEmpty: Boolean(query) && visibleCount === 0,
    isTypeEmpty: !query && visibleCount === 0 && !hasVisibleReadError,
  }
}

module.exports = { buildProjectContentView }
