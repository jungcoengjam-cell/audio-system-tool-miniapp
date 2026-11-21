'use strict'

let packedRows = null
let modelAliases = null

function getModelAliasIndex() {
  if (modelAliases) return modelAliases
  if (packedRows === null) packedRows = require('../data/model-alias-search-index')
  modelAliases = new Map()
  String(packedRows || '').split('\n').forEach((row) => {
    const fields = row.split('|')
    const model = fields.shift()
    if (model) modelAliases.set(model, fields)
  })
  return modelAliases
}

function findModelAliasMatches(model, keyword) {
  const query = String(keyword || '').trim().toLowerCase()
  if (!query || !model) return []
  const aliases = getModelAliasIndex().get(String(model))
  if (!aliases) return []
  return aliases.filter((alias) => alias.toLowerCase().includes(query))
}

function formatModelAliasMatches(aliases) {
  const matches = Array.isArray(aliases) ? aliases : []
  if (!matches.length) return ''
  const shown = matches.slice(0, 2).join(' · ')
  return matches.length > 2 ? shown + ' 等' + matches.length + '项' : shown
}

module.exports = { findModelAliasMatches, formatModelAliasMatches }
