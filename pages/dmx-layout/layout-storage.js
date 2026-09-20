const {
  recommendSidePairCount,
  posDefs,
  normBars,
  posFromBars,
  restorePositions,
  barsFromPositions,
  mergePositions,
  parsePositive,
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
  const automaticPositions = posFromBars(fixtures, barCounts, groups, definitions, rows, pairs)
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

module.exports = { SCHEME_IDS, resolveSavedLayout }
