'use strict'

const crossReferenceData = require('../data/model-cross-reference')
const columnGroups = crossReferenceData.columnGroups || {}
const records = crossReferenceData.records || {}
const historical = crossReferenceData.historical || {}
const source = crossReferenceData.source || {}

function isSearchableValue(value) {
  return value !== null
    && value !== undefined
    && String(value).trim() !== ''
    && String(value).trim() !== '/'
}

function getReferenceGroups(reference) {
  const definitions = columnGroups[reference.sheet] || []
  const values = Array.isArray(reference.values) ? reference.values : []
  return definitions.map((definition, index) => {
    const pair = Array.isArray(values[index]) ? values[index] : []
    const fields = []
    const hasIdentifier = isSearchableValue(pair[0])
    const hasModel = isSearchableValue(pair[1])
    if (hasIdentifier && hasModel && String(pair[0]) === String(pair[1])) {
      fields.push({
        label: definition.identifierLabel + ' / ' + definition.modelLabel,
        value: pair[0],
      })
    } else {
      if (hasIdentifier) fields.push({ label: definition.identifierLabel, value: pair[0] })
      if (hasModel) fields.push({ label: definition.modelLabel, value: pair[1] })
    }
    return { brand: definition.brand, fields }
  }).filter((group) => group.fields.length)
}

function getHistoricalLabel(kind) {
  const value = String(kind || '').toLocaleLowerCase()
  if (value.includes('old') || value.includes('legacy') || value.includes('旧型号')) return '旧型号'
  if (value.includes('历史改名/替代')) return '历史改名/替代'
  if (value.includes('replace') || value.includes('替代')) return '历史型号替代'
  if (value.includes('rename') || value.includes('change') || value.includes('改名')) return '历史型号改名'
  return '历史型号关系'
}

function getProductModelCrossReferenceSourceText() {
  return [source.fileName, source.version].filter(Boolean).join(' · ')
}

function getProductModelCrossReferences(model) {
  const rows = Array.isArray(records[model]) ? records[model] : []
  const history = Array.isArray(historical[model]) ? historical[model] : []
  const rowReferences = rows.map((reference, index) => ({
    key: String(reference.sheet) + '-' + String(reference.row) + '-' + index,
    kind: reference.sheet === '停产' ? 'discontinued' : 'catalog',
    sourceLabel: reference.sheet,
    row: reference.row,
    statusLabel: reference.sheet === '停产' ? '停产' : '',
    groups: getReferenceGroups(reference),
  }))
  const historicalReferences = history.map((reference, index) => ({
    key: 'history-' + String(reference.sheet) + '-' + String(reference.cell) + '-' + index,
    kind: 'history',
    kindLabel: getHistoricalLabel(reference.kind),
    sourceLabel: String(reference.sheet || '').trim() + (reference.cell ? '!' + reference.cell : ''),
    targetModel: reference.targetModel || '',
    noteSummary: reference.note || '',
  }))
  return rowReferences.concat(historicalReferences)
}

function searchProductModelCrossReferences(keyword) {
  const query = String(keyword || '').trim().toLocaleLowerCase()
  const matches = new Map()
  if (!query) return matches

  function addMatch(model, hit) {
    const current = matches.get(model) || []
    const key = [hit.brand, hit.label, hit.value].join('\u0000')
    if (!current.some((item) => [item.brand, item.label, item.value].join('\u0000') === key)) {
      current.push(hit)
      matches.set(model, current)
    }
  }

  Object.entries(records).forEach(([model, references]) => {
    ;(Array.isArray(references) ? references : []).forEach((reference) => {
      const definitions = columnGroups[reference.sheet] || []
      const values = Array.isArray(reference.values) ? reference.values : []
      definitions.forEach((definition, index) => {
        const pair = Array.isArray(values[index]) ? values[index] : []
        const candidates = [
          { value: pair[0], label: definition.identifierLabel },
          { value: pair[1], label: definition.modelLabel },
        ]
        candidates.forEach((candidate) => {
          if (isSearchableValue(candidate.value)
            && String(candidate.value).toLocaleLowerCase().includes(query)) {
            addMatch(model, {
              brand: definition.brand || '',
              label: candidate.label || '型号',
              value: String(candidate.value),
            })
          }
        })
      })
    })
  })

  Object.entries(historical).forEach(([model, references]) => {
    ;(Array.isArray(references) ? references : []).forEach((reference) => {
      const value = reference.targetModel
      if (isSearchableValue(value) && String(value).toLocaleLowerCase().includes(query)) {
        addMatch(model, {
          brand: '历史关系',
          label: getHistoricalLabel(reference.kind),
          value: String(value),
        })
      }
    })
  })

  return matches
}

module.exports = {
  getProductModelCrossReferences,
  getProductModelCrossReferenceSourceText,
  searchProductModelCrossReferences,
}
