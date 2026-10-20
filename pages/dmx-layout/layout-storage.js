const {
  recommendSidePairCount,
  posDefs,
  normBars,
  posFromBars,
  restorePositions,
  barsFromPositions,
  mergePositions,
  parsePositive,
  clamp,
  posKey,
  posPoint,
  sideCanvasRange,
  stageRect,
} = require('./layout-model')

const SCHEME_IDS = ['top', 'top-front', 'full']

function resolveSavedLayout(saved = {}, fixtures = [], groups = []) {
  const rows = Math.min(6, Math.max(1, Number(saved.rowCount) || 3))
  const schemeIndex = Math.max(0, SCHEME_IDS.indexOf(saved.schemeId))
  const recommendedSidePairCount = recommendSidePairCount(parsePositive(saved.stageDepthText, 8))
  const pairs = saved.sidePairManual
    ? Math.min(3, Math.max(1, Number(saved.sidePairCount) || recommendedSidePairCount))
    : recommendedSidePairCount
  const definitions = posDefs(rows, SCHEME_IDS[schemeIndex], pairs)
  const barCounts = normBars(saved.barCounts, groups, definitions.length)
  const automaticPositions = posFromBars(fixtures, barCounts, groups, definitions, rows, pairs, saved.positions && Object.keys(saved.positions).length)
  const preserve = Boolean(saved.preserveUnplaced)
  const positions = preserve
    ? restorePositions(fixtures, saved.positions, rows, definitions, pairs)
    : mergePositions(fixtures, automaticPositions, saved.positions, rows, definitions, pairs)
  return {
    rows,
    schemeIndex,
    pairs,
    definitions,
    sidePairManual: Boolean(saved.sidePairManual),
    preserve,
    positions,
    barCounts: preserve
      ? barsFromPositions(fixtures, positions, groups, definitions, rows, pairs)
      : barCounts,
  }
}

function migrateLegacyLayout(saved, fixtures = [], groups = []) {
  if (!saved || typeof saved !== 'object' || Array.isArray(saved) || Object.keys(saved).length === 0) {
    return { migrated: false, layout: null, sideFixtureCount: 0 }
  }
  const width = parsePositive(saved.stageWidthText, 12)
  const depth = parsePositive(saved.stageDepthText, 8)
  const layout = resolveSavedLayout(saved, fixtures, groups)
  const frontAtBottom = saved.frontIndex !== 1
  const stage = stageRect(width, depth, 700, 900)
  const sideRods = []
  layout.definitions.filter((definition) => definition.zone.startsWith('side-')).forEach((definition) => {
    const interval = sideCanvasRange(definition, stage, frontAtBottom, layout.pairs)
    sideRods.push({
      id: `legacy-${definition.zone}-${definition.positionIndex + 1}`,
      side: definition.zone === 'side-left' ? 'left' : 'right',
      positionIndex: definition.positionIndex,
      distance: 42 * width / stage.width,
      startT: clamp((interval.startY - stage.top) / stage.height, 0, 1),
      endT: clamp((interval.endY - stage.top) / stage.height, 0, 1),
    })
  })
  const internalRods = Array.from({ length: layout.rows }, (_, index) => ({
    id: `legacy-top-${index + 1}`,
    distance: (1 - ((index + 1) / (layout.rows + 1))) * depth,
  }))
  const hasFrontRod = layout.definitions.some((definition) => definition.zone === 'front')
  const frontRods = hasFrontRod ? [{
    id: 'legacy-front-1',
    distance: 42 * depth / stage.height,
  }] : []
  const positionsById = {}
  let sideFixtureCount = 0
  fixtures.forEach((fixture) => {
    const legacyPosition = layout.positions[posKey(fixture)]
    if (!legacyPosition) return
    const definition = layout.definitions.find((item) => item.zone === legacyPosition.zone && item.positionIndex === legacyPosition.positionIndex)
    if (!definition) return
    const point = posPoint(legacyPosition, stage, frontAtBottom)
    const t = definition.zone.startsWith('side-')
      ? clamp((point.y - stage.top) / stage.height, 0, 1)
      : clamp((point.x - stage.left) / stage.width, definition.zone === 'front' ? .04 : .02, definition.zone === 'front' ? .96 : .98)
    let rodId = ''
    if (definition.zone === 'top') rodId = `legacy-top-${definition.positionIndex + 1}`
    else if (definition.zone === 'front') rodId = 'legacy-front-1'
    else {
      rodId = `legacy-${definition.zone}-${definition.positionIndex + 1}`
      sideFixtureCount += 1
    }
    const stableId = String(fixture.stableId || fixture.id || '')
    if (!stableId) return
    positionsById[stableId] = {
      rodId,
      t,
      legacyPoint: {
        x: (point.x - stage.left) / stage.width,
        y: (point.y - stage.top) / stage.height,
      },
      legacyPosition: { ...legacyPosition },
    }
  })
  return {
    migrated: true,
    layout: {
      stageWidthText: String(saved.stageWidthText || width),
      stageDepthText: String(saved.stageDepthText || depth),
      apronDirection: frontAtBottom ? 'bottom' : 'top',
      internalRods,
      frontRods,
      legacySideRods: sideRods,
      positionsById,
    },
    sideFixtureCount,
    sidePairCount: layout.pairs,
    positionSource: saved.positionSource || 'unknown',
    positionAutoFilledCount: Number(saved.positionAutoFilledCount) || 0,
  }
}

module.exports = { SCHEME_IDS, resolveSavedLayout, migrateLegacyLayout }
