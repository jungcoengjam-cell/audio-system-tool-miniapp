'use strict'

const { framingEnvelope } = require('../../utils/camera-framing')

const DISPLAY_DISTANCE_SCALE = 100
const PRESENTATION_TOLERANCE_DEGREES = 1e-12
const AUTO_PRECISION_ORDER = [
  [2, 1], [2, 2], [3, 1], [2, 3], [3, 2], [4, 1], [3, 3], [4, 2], [4, 3],
]
const FIXED_PRECISION_ORDER = [[0, 1], [0, 2], [0, 3]]

function ceilMinimumDistanceMeters(value) {
  const raw = Number(value)
  if (!Number.isFinite(raw) || raw <= 0) return value
  const nearest = Number(raw.toFixed(2))
  if (nearest >= raw) return nearest
  return (Math.round(nearest * DISPLAY_DISTANCE_SCALE) + 1) / DISPLAY_DISTANCE_SCALE
}

function parseMetersLabel(label) {
  const match = String(label ?? '').trim().match(/^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*m$/i)
  if (!match) return NaN
  const parsed = Number(match[1])
  return Number.isFinite(parsed) ? parsed : NaN
}

function parsePitchLabel(label) {
  const match = String(label ?? '').trim().match(/^(俯角|仰角|水平)\s+([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)°$/i)
  if (!match) return NaN
  const magnitude = Number(match[2])
  if (!Number.isFinite(magnitude)) return NaN
  if (match[1] === '俯角') return -Math.abs(magnitude)
  if (match[1] === '仰角') return Math.abs(magnitude)
  return magnitude === 0 ? 0 : NaN
}

function pitchLabelFromSignedText(signedText) {
  const signed = Number(signedText)
  if (!Number.isFinite(signed)) return ''
  const negative = signed < 0 || Object.is(signed, -0) || String(signedText).startsWith('-')
  const direction = negative ? '俯角' : signed > 0 ? '仰角' : '水平'
  const magnitudeText = String(signedText).replace(/^[+-]/, '')
  return `${direction} ${magnitudeText}°`
}

function compactNumber(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? String(numeric) : ''
}

function candidateHeightText(rawHeight, heightMode, fixedCameraHeightText, places) {
  if (heightMode === 'fixed') {
    if (fixedCameraHeightText !== undefined && fixedCameraHeightText !== null && String(fixedCameraHeightText) !== '') {
      return String(fixedCameraHeightText)
    }
    return compactNumber(rawHeight)
  }
  const numeric = Number(rawHeight)
  if (!Number.isFinite(numeric)) return ''
  try { return numeric.toFixed(places) } catch (error) { return compactNumber(numeric) }
}

function validateDisplayedTuple(result, distanceLabel, heightLabel, pitchLabel) {
  const distance = parseMetersLabel(distanceLabel)
  const cameraHeight = parseMetersLabel(heightLabel)
  const pitchDegrees = parsePitchLabel(pitchLabel)
  const dimensions = result?.worldDimensions
  const horizontalFov = Number(result?.calculationHorizontalFov)
  const verticalFov = Number(result?.calculationVerticalFov)
  if (!dimensions || ![distance, cameraHeight, pitchDegrees, horizontalFov, verticalFov].every(Number.isFinite)) {
    return { fits: false, requiredHorizontalFov: null, requiredVerticalFov: null }
  }
  if (cameraHeight <= 0 || distance <= 0 || !(dimensions.width > 0)
    || !(dimensions.top > dimensions.bottom) || !Number.isFinite(dimensions.depth)
    || !Number.isFinite(dimensions.marginRatio ?? result.marginRatio)) {
    return { fits: false, requiredHorizontalFov: null, requiredVerticalFov: null }
  }
  const envelope = framingEnvelope({
    distance,
    width: Number(dimensions.width),
    depth: Number(dimensions.depth) || 0,
    bottom: Number(dimensions.bottom),
    top: Number(dimensions.top),
    cameraHeight,
    marginRatio: Number(dimensions.marginRatio ?? result.marginRatio) || 0,
    pitchDegrees,
  })
  if (!envelope) return { fits: false, requiredHorizontalFov: null, requiredVerticalFov: null }
  const requiredHorizontalFov = envelope.requiredHorizontalFov
  const requiredVerticalFov = envelope.requiredVerticalFov
  return {
    fits: requiredHorizontalFov <= horizontalFov + PRESENTATION_TOLERANCE_DEGREES
      && requiredVerticalFov <= verticalFov + PRESENTATION_TOLERANCE_DEGREES,
    requiredHorizontalFov,
    requiredVerticalFov,
    parsed: { distance, cameraHeight, pitchDegrees },
  }
}

function createLegacyOrHorizontalPresentation(result, options = {}) {
  const distanceMeters = getPresentedMinimumDistanceMetersWithoutPresentation(result)
  let heightText = compactNumber(result?.cameraHeightMeters)
  const aimSource = String(result?.aimText || '')
  const isV2 = Number(result?.framingVersion) === 2
  const horizontalOnly = Boolean(result?.horizontalOnly)
  if (isV2 && horizontalOnly && (options.heightMode || result?.heightMode) === 'fixed') {
    const inputText = String(options.fixedCameraHeightText ?? '')
    const inputNumber = Number(inputText)
    const worldHeight = Number(result?.worldDimensions?.cameraHeight ?? result?.cameraHeightMeters)
    if (inputText.trim() && Number.isFinite(inputNumber) && inputNumber === worldHeight) heightText = inputText
  }
  const statusKind = horizontalOnly ? 'horizontal-reference' : isV2 ? 'unverified' : 'legacy-reference'
  const statusText = horizontalOnly
    ? '仅水平参考，垂直覆盖未校核；不作为完整安装建议。'
    : isV2
      ? '当前展示值未能完成双轴校核；请勿据此安装。'
      : '历史版本参考值；未按当前 v2 三维双轴规则核验，请现场复核。'
  return {
    version: Number(result?.framingVersion) || 1,
    statusKind,
    statusText,
    recommendationAllowed: false,
    distanceMeters,
    distanceText: `${compactNumber(distanceMeters)} m`,
    heightText,
    heightDisplayText: heightText ? `${heightText} m` : '—',
    pitchLabel: horizontalOnly ? '初始瞄准未校核' : aimSource,
    aimValue: horizontalOnly ? '未校核' : aimSource || '—',
    pitchText: '',
    precision: null,
    validation: null,
  }
}

function buildCameraPresentation(result, options = {}) {
  if (!result || Number(result.framingVersion) !== 2 || result.horizontalOnly) {
    return createLegacyOrHorizontalPresentation(result, options)
  }

  const rawDistance = Number(result.calculationDistanceMeters)
  const distanceMeters = Number(ceilMinimumDistanceMeters(rawDistance))
  const distanceText = `${compactNumber(distanceMeters)} m`
  const dimensions = result.worldDimensions || {}
  const rawHeight = Number(dimensions.cameraHeight)
  const rawPitch = Number(result.calculationAimAngleDegrees)
  const heightMode = options.heightMode || result.heightMode || 'auto'
  const fixedCameraHeightText = options.fixedCameraHeightText
  const precisionOrder = heightMode === 'fixed' ? FIXED_PRECISION_ORDER : AUTO_PRECISION_ORDER
  let selected = null
  let fallback = null

  for (const [heightPlaces, pitchPlaces] of precisionOrder) {
    let heightText = candidateHeightText(rawHeight, heightMode, fixedCameraHeightText, heightPlaces)
    const parsedHeight = Number(heightText)
    // In fixed mode the user's input is the physical value. Never rewrite it
    // to a fixed decimal count or make a rounded camera height pass. Auto
    // height is a display candidate and must be checked after formatting.
    if (!heightText || !Number.isFinite(parsedHeight)
      || (heightMode === 'fixed' && parsedHeight !== rawHeight)) continue
    let pitchNumberText
    try { pitchNumberText = rawPitch.toFixed(pitchPlaces) } catch (error) { pitchNumberText = '' }
    if (!pitchNumberText) continue
    const pitchLabel = pitchLabelFromSignedText(pitchNumberText)
    const validation = validateDisplayedTuple(result, distanceText, `${heightText} m`, pitchLabel)
    const candidate = {
      distanceMeters: parseMetersLabel(distanceText),
      distanceText,
      heightText,
      heightDisplayText: `${heightText} m`,
      pitchNumberText,
      pitchLabel,
      aimValue: pitchLabel.startsWith('俯角')
        ? `向下 ${pitchLabel.slice(3).trim()}`
        : pitchLabel.startsWith('仰角')
          ? `向上 ${pitchLabel.slice(3).trim()}`
          : `水平 ${pitchLabel.slice(3).trim()}`,
      precision: { heightPlaces, pitchPlaces, fixedHeightInputPreserved: heightMode === 'fixed' },
      validation,
    }
    fallback = candidate
    if (validation.fits) {
      selected = candidate
      break
    }
  }

  selected = selected || fallback
  if (!selected) return createLegacyOrHorizontalPresentation(result)
  const verified = Boolean(selected.validation?.fits)
  const statusText = verified
    ? '当前展示的距离、高度与俯仰组合通过模型双轴校核；实际安装仍需现场复核。'
    : '当前展示精度上限内未通过模型双轴校核；请勿据此安装或形成安装建议。'
  return {
    version: 2,
    statusKind: verified ? 'verified-v2' : 'display-unverified',
    statusText,
    recommendationAllowed: verified,
    distanceMeters: selected.distanceMeters,
    distanceText: selected.distanceText,
    heightText: selected.heightText,
    heightDisplayText: selected.heightDisplayText,
    pitchText: `${selected.pitchNumberText}°`,
    pitchLabel: selected.pitchLabel,
    aimValue: selected.aimValue,
    precision: selected.precision,
    validation: selected.validation,
  }
}

function getPresentedMinimumDistanceMetersWithoutPresentation(result) {
  if (!result) return undefined
  if (Number(result.framingVersion) !== 2) return result.primaryDistanceMeters
  const exact = Number(result.calculationDistanceMeters)
  if (!Number.isFinite(exact) || exact <= 0) return result.primaryDistanceMeters
  return ceilMinimumDistanceMeters(exact)
}

function getPresentedMinimumDistanceMeters(result) {
  if (!result) return undefined
  if (Number.isFinite(Number(result.presentation?.distanceMeters))) return Number(result.presentation.distanceMeters)
  return getPresentedMinimumDistanceMetersWithoutPresentation(result)
}

module.exports = {
  ceilMinimumDistanceMeters,
  getPresentedMinimumDistanceMeters,
  buildCameraPresentation,
  validateDisplayedTuple,
  parseMetersLabel,
  parsePitchLabel,
  PRESENTATION_TOLERANCE_DEGREES,
  AUTO_PRECISION_ORDER,
  FIXED_PRECISION_ORDER,
}
