const RELATIVE_TOLERANCE = 1e-9

function missing(value) {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '')
}

function parseNumeric(value) {
  if (missing(value)) return { kind: 'missing' }
  if (typeof value !== 'number' && typeof value !== 'string') return { kind: 'invalid' }
  const number = typeof value === 'string' ? Number(value.trim()) : value
  return Number.isFinite(number) ? { kind: 'value', value: number } : { kind: 'invalid' }
}

function invalidResult(field, error) {
  return { error, field, errorKind: 'invalid' }
}

function missingResult(field, label = field) {
  return { error: `请输入${label}。`, field, errorKind: 'missing' }
}

function parseDistance(value, field, label = field) {
  const parsed = parseNumeric(value)
  if (parsed.kind === 'missing') return missingResult(field, label)
  if (parsed.kind === 'invalid' || parsed.value <= 0) {
    return invalidResult(field, `${label}必须是大于 0 的有限数值。`)
  }
  return parsed.value
}

function parseOpenMicrophoneCount(value) {
  const parsed = parseNumeric(value)
  if (parsed.kind === 'missing') {
    return { error: '请填写同时开放话筒数。', field: 'nom', errorKind: 'missing' }
  }
  if (parsed.kind === 'invalid' || parsed.value <= 0 || !Number.isSafeInteger(parsed.value)) {
    return invalidResult('nom', '同时开放话筒数必须为正整数。')
  }
  return parsed.value
}

function isError(value) {
  return value && typeof value === 'object' && value.errorKind
}

function hasClosedGeometry(distances) {
  const maximum = Math.max(...distances)
  const normalized = distances.map((distance) => distance / maximum)
  const sumOfOthers = normalized.reduce((sum, distance) => sum + distance, 0) - 1
  return 1 <= sumOfOthers + RELATIVE_TOLERANCE
}

function calculatePagNagReview(input = {}) {
  if (input === null || input === undefined) {
    return missingResult('ds', '嘴到话筒距离')
  }
  if (typeof input !== 'object' || Array.isArray(input)) {
    return invalidResult('ds', 'PAG/NAG 复核输入必须是对象。')
  }

  const hasSpeakerMode = Object.prototype.hasOwnProperty.call(input, 'speakerMode')
  const speakerMode = hasSpeakerMode ? input.speakerMode : 'single'
  if (speakerMode !== 'single' && speakerMode !== 'multiple') {
    return invalidResult('speakerMode', '音箱模式必须是同一只音箱或多音箱取点。')
  }

  const fields = [
    ['ds', '嘴到话筒距离'],
    ['d0', '发言人到最远听众距离'],
    ['dn', '发言人到最近听众距离'],
    ['d1', speakerMode === 'multiple' ? '话筒到最近送声箱 A 距离' : '话筒到实际送声音箱距离'],
    ['d2', speakerMode === 'multiple' ? '音箱 B 到同一最远听众距离' : '该音箱到同一最远听众距离'],
  ]
  const distances = {}
  for (const [field, label] of fields) {
    const value = parseDistance(input[field], field, label)
    if (isError(value)) return value
    distances[field] = value
  }
  const nom = parseOpenMicrophoneCount(input.nom)
  if (isError(nom)) return nom

  if (distances.dn > distances.d0) {
    return {
      error: '最近听众距离 dn 不能大于最远听众距离 d0。',
      field: 'geometry',
      errorKind: 'inconsistent',
    }
  }
  // Multiple mode assumes both measured endpoints belong to the common set of speakers carrying this mic.
  const geometryIsConsistent = speakerMode === 'single'
    ? hasClosedGeometry([distances.ds, distances.d1, distances.d2, distances.d0])
    : (() => {
      const maximum = Math.max(distances.ds, distances.d0, distances.d1, distances.d2)
      return Math.abs(distances.d1 / maximum - distances.d2 / maximum)
        <= distances.ds / maximum + distances.d0 / maximum + RELATIVE_TOLERANCE
    })()
  if (!geometryIsConsistent) {
    return {
      error: speakerMode === 'multiple'
        ? '嘴到话筒、话筒到音箱 A、音箱 B 到同一最远听众和发言人到最远听众这组距离无法同时成立。'
        : '嘴到话筒、话筒到音箱、音箱到最远听众和发言人到最远听众这组距离无法同时成立。',
      field: 'geometry',
      errorKind: 'inconsistent',
    }
  }

  const log10 = Math.log10
  const pagDb = 20 * (
    log10(distances.d1)
      - log10(distances.d2)
      + log10(distances.d0)
      - log10(distances.ds)
  ) - (10 * log10(nom)) - 6
  const nagDb = 20 * (log10(distances.d0) - log10(distances.dn))
  const marginDb = pagDb - nagDb

  return {
    basis: speakerMode === 'multiple'
      ? 'omnidirectional-multiple-speakers' : 'omnidirectional-single-path',
    verification: 'unverified',
    distancesMeters: distances,
    openMicrophoneCount: nom,
    feedbackStabilityMarginDb: 6,
    pagDb,
    nagDb,
    marginDb,
  }
}

module.exports = {
  calculatePagNagReview,
}
