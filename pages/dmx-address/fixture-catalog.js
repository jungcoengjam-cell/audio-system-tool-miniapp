const FIXTURE_SEARCH_LIMIT = 36
const ALL_FIXTURE_CATEGORIES = '全部'

function getFixtureCategory(name = '') {
if (/烟机|雾机|雪花机|泡泡机|火花机|水雾机/.test(name)) return '舞台特效'
if (/摇头/.test(name)) return '摇头灯'
if (/柔光灯/.test(name)) return '柔光灯'
if (/成像灯|聚光灯|追光灯/.test(name)) return '成像/聚光'
if (/PAR灯|帕灯|染色灯|观众灯|天地排|天幕灯/.test(name)) return 'PAR/染色'
return '效果灯'
}

function createFixtureCatalog(dmxFixtures, { getFixtureDisplayName, getFixtureSpriteIndex }) {
const FIXTURE_SEARCH_ROWS = dmxFixtures.map((fixture) => ({
model: fixture.model,
name: fixture.name,
primaryName: getFixtureDisplayName(fixture),
spriteOffset: `${-(getFixtureSpriteIndex(fixture) * 100 / 3)}%`,
category: getFixtureCategory(fixture.name),
modeText: fixture.channelModes.map((mode) => `${mode} CH`).join(' / '),
searchText: `${fixture.model} ${fixture.name}`.toLowerCase(),
}))
const FIXTURE_CATEGORY_LABELS = ['摇头灯', 'PAR/染色', '柔光灯', '成像/聚光', '效果灯', '舞台特效']
const FIXTURE_SEARCH_CATEGORIES = [ALL_FIXTURE_CATEGORIES, ...FIXTURE_CATEGORY_LABELS].map((label) => ({
label,
count: label === ALL_FIXTURE_CATEGORIES
? FIXTURE_SEARCH_ROWS.length
: FIXTURE_SEARCH_ROWS.filter((item) => item.category === label).length,
}))
function searchFixtures(keyword = '', category = ALL_FIXTURE_CATEGORIES) {
const normalized = keyword.trim().toLowerCase()
const matches = FIXTURE_SEARCH_ROWS.filter(
(item) => (
(category === ALL_FIXTURE_CATEGORIES || item.category === category)
&& (!normalized || item.searchText.includes(normalized))
),
)
return {
rows: matches.slice(0, FIXTURE_SEARCH_LIMIT),
total: matches.length,
}
}
const DEFAULT_FIXTURE_SEARCH = searchFixtures()
function decorateBatchRows(rows, selectedItems = []) {
const selectedModels = new Set(selectedItems.map((item) => item.model))
return rows.map((item) => ({ ...item, batchSelected: selectedModels.has(item.model) }))
}
return {
ALL_FIXTURE_CATEGORIES,
FIXTURE_SEARCH_CATEGORIES,
DEFAULT_FIXTURE_SEARCH,
searchFixtures,
decorateBatchRows,
}
}

module.exports = { createFixtureCatalog }
