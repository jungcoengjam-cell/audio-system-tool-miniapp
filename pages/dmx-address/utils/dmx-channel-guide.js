const { stageLightingChannelProfiles } = require('../data/stage-lighting-channels')

const DMX_UNIVERSE_SIZE = 512
const UNIVERSE_LABELS = ['A', 'B', 'C', 'D']

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function findDmxChannelProfile(model) {
  const key = String(model || '').trim()
  return stageLightingChannelProfiles[key] || null
}

function hasDmxChannelProfile(model) {
  return Boolean(findDmxChannelProfile(model))
}

function getDmxChannelProfile(model) {
  const profile = findDmxChannelProfile(model)
  return profile ? clone(profile) : null
}

function getDmxChannelModes(model) {
  const profile = findDmxChannelProfile(model)
  return profile?.modes ? clone(profile.modes) : []
}

function getDmxChannelMode(model, channelCount) {
  const count = Number(channelCount)
  const profile = findDmxChannelProfile(model)
  const mode = profile?.modes?.find((candidate) => candidate.channelCount === count)
  return mode ? clone(mode) : null
}

function getUniverseNumber(fixture = {}) {
  const numeric = Number(fixture.universe)
  if (Number.isInteger(numeric) && numeric >= 1) return numeric
  const labelIndex = UNIVERSE_LABELS.indexOf(String(fixture.universeLabel || '').toUpperCase())
  return labelIndex >= 0 ? labelIndex + 1 : 1
}

function formatAddress(universe, address) {
  const label = UNIVERSE_LABELS[universe - 1] || ''
  return `${label}${String(address).padStart(3, '0')}`
}

function decorateChannel(channel, fixture, includeAddress = false) {
  const result = {
    ...channel,
    ranges: Array.isArray(channel.ranges) ? channel.ranges.map((range) => ({ ...range })) : [],
  }
  if (!includeAddress) return result
  const startAddress = Number(fixture.startAddress)
  const offset = channel.channel - 1
  if (!Number.isInteger(startAddress) || startAddress < 1) return result
  const absolute = startAddress - 1 + offset
  const universe = getUniverseNumber(fixture) + Math.floor(absolute / DMX_UNIVERSE_SIZE)
  const address = (absolute % DMX_UNIVERSE_SIZE) + 1
  const actualAddress = formatAddress(universe, address)
  return {
    ...result,
    actualAddress,
    addressText: actualAddress,
    actualAddressText: actualAddress,
  }
}

function buildGuide(profile, mode, fixture = null) {
  if (!profile || !mode) return null
  const channels = mode.channels.map((channel) => decorateChannel(channel, fixture || {}, Boolean(fixture)))
  const first = channels[0]
  const last = channels[channels.length - 1]
  return {
    model: profile.model,
    source: profile.source,
    sourcePages: profile.sourcePages.slice(),
    sourcePageText: profile.sourcePageText,
    verification: profile.verification,
    verificationStatus: profile.verificationStatus,
    channelCount: mode.channelCount,
    modeLabel: `${mode.channelCount} CH`,
    channels,
    modes: profile.modes.map((candidate) => ({
      channelCount: candidate.channelCount,
      label: `${candidate.channelCount} CH`,
      selected: candidate.channelCount === mode.channelCount,
    })),
    actualRangeText: first?.actualAddress && last?.actualAddress
      ? `${first.actualAddress}–${last.actualAddress}`
      : '',
  }
}

function buildDmxChannelGuide(options = {}) {
  const model = options.fixtureModel || options.model || options.fixture?.fixtureModel
  const profile = findDmxChannelProfile(model)
  if (!profile) return null
  const hasRequestedMode = options.channelCount !== undefined
    || options.mode !== undefined
    || options.fixture?.channelCount !== undefined
  const requestedCount = Number(
    options.channelCount !== undefined
      ? options.channelCount
      : options.mode !== undefined ? options.mode : options.fixture?.channelCount,
  )
  const mode = hasRequestedMode
    ? profile.modes.find((item) => item.channelCount === requestedCount)
    : profile.modes[0]
  if (!mode) return null
  const fixture = options.fixture || (options.startAddress ? options : null)
  return buildGuide(profile, mode, fixture)
}

function buildActualDmxChannelGuide(fixture = {}, channelCount) {
  return buildDmxChannelGuide({
    fixture,
    fixtureModel: fixture.fixtureModel,
    channelCount: channelCount || fixture.channelCount,
  })
}

module.exports = {
  buildActualDmxChannelGuide,
  buildActualChannelGuide: buildActualDmxChannelGuide,
  buildDmxChannelGuide,
  getDmxChannelMode,
  getDmxChannelModes,
  getDmxChannelProfile,
  hasDmxChannelProfile,
  getChannelProfile: getDmxChannelProfile,
}
