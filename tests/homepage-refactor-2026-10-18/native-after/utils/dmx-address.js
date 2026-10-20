const DMX_UNIVERSE_SIZE = 512
const UNIVERSE_LABELS = ['A', 'B', 'C', 'D']
const MAX_UNIVERSE = UNIVERSE_LABELS.length
const MAX_GROUPS = 20
const MAX_FIXTURES_PER_GROUP = 200
const MAX_TOTAL_FIXTURES = 500

function parseInteger(value) {
  const number = Number(value)
  return Number.isInteger(number) ? number : null
}

function padAddress(value) {
  return String(value).padStart(3, '0')
}

function getUniverseLabel(universe) {
  return UNIVERSE_LABELS[universe - 1] || ''
}

function formatDmxAddress(universe, address) {
  return `${getUniverseLabel(universe)}${padAddress(address)}`
}

function buildError(message) {
  return { error: message }
}

function getTargetUniverse(value) {
  return UNIVERSE_LABELS.includes(String(value || '').toUpperCase())
    ? String(value).toUpperCase()
    : ''
}

function createUniverseSummaries(fixtures) {
  const universeMap = Object.create(null)
  fixtures.forEach((fixture) => {
    if (!universeMap[fixture.universe]) {
      universeMap[fixture.universe] = {
        universe: fixture.universe,
        universeLabel: fixture.universeLabel,
        fixtureCount: 0,
        usedChannels: 0,
        firstAddress: fixture.startAddress,
        lastAddress: fixture.endAddress,
      }
    }
    const summary = universeMap[fixture.universe]
    summary.fixtureCount += 1
    summary.usedChannels += fixture.channelCount
    summary.firstAddress = Math.min(summary.firstAddress, fixture.startAddress)
    summary.lastAddress = Math.max(summary.lastAddress, fixture.endAddress)
  })
  return Object.values(universeMap).map((summary) => ({
    ...summary,
    remainingChannels: DMX_UNIVERSE_SIZE - summary.lastAddress,
    rangeText: `${formatDmxAddress(summary.universe, summary.firstAddress)}–${formatDmxAddress(summary.universe, summary.lastAddress)}`,
  }))
}

function buildNextText(cursors, usedUniverses) {
  return usedUniverses.map((universe) => (
    cursors[universe] > DMX_UNIVERSE_SIZE
      ? `${getUniverseLabel(universe)}已满`
      : formatDmxAddress(universe, cursors[universe])
  )).join(' / ')
}

function calculateDmxAddressPlan(options = {}) {
  const startUniverse = 1
  const startAddress = parseInteger(options.startAddress)
  const groups = Array.isArray(options.groups) ? options.groups : []
  const allocationMode = options.allocationMode === 'manual' ? 'manual' : 'auto'

  if (!startAddress || startAddress < 1 || startAddress > DMX_UNIVERSE_SIZE) {
    return buildError(`起始地址必须是 1 至 ${DMX_UNIVERSE_SIZE} 的整数。`)
  }
  if (!groups.length) return buildError('请至少添加一个灯具分组。')
  if (groups.length > MAX_GROUPS) return buildError(`灯具分组不能超过 ${MAX_GROUPS} 组。`)

  const normalizedGroups = []
  let totalFixtures = 0
  for (let index = 0; index < groups.length; index += 1) {
    const group = groups[index] || {}
    const name = String(group.name || '').trim()
    const channelCount = parseInteger(group.channelCount)
    const fixtureCount = parseInteger(group.fixtureCount)
    const position = `第 ${index + 1} 组`

    if (!name) return buildError(`${position}请填写灯具名称。`)
    if (!channelCount || channelCount < 1 || channelCount > DMX_UNIVERSE_SIZE) {
      return buildError(`${position}的单台通道数必须是 1 至 ${DMX_UNIVERSE_SIZE} 的整数。`)
    }
    if (!fixtureCount || fixtureCount < 1 || fixtureCount > MAX_FIXTURES_PER_GROUP) {
      return buildError(`${position}的灯具数量必须是 1 至 ${MAX_FIXTURES_PER_GROUP} 的整数。`)
    }

    totalFixtures += fixtureCount
    normalizedGroups.push({
      id: group.id || `group-${index + 1}`,
      name,
      fixtureModel: String(group.fixtureModel || '').trim(),
      channelCount,
      fixtureCount,
      targetUniverse: getTargetUniverse(group.targetUniverse) || 'A',
    })
  }
  if (totalFixtures > MAX_TOTAL_FIXTURES) {
    return buildError(`单次编址最多支持 ${MAX_TOTAL_FIXTURES} 台灯具。`)
  }

  if (allocationMode === 'manual') {
    const cursors = [null, startAddress, 1, 1, 1]
    const fixtures = []
    let globalFixtureIndex = 0
    let manualError = null
    const groupResults = normalizedGroups.map((group, groupIndex) => {
      if (manualError) return { ...group, groupIndex, totalChannels: group.channelCount * group.fixtureCount, fixtures: [] }
      const targetUniverse = UNIVERSE_LABELS.indexOf(group.targetUniverse) + 1
      const address = cursors[targetUniverse]
      const requiredChannels = group.channelCount * group.fixtureCount
      if (address + requiredChannels - 1 > DMX_UNIVERSE_SIZE) {
        manualError = `第 ${groupIndex + 1} 组“${group.name}”无法完整放入 ${group.targetUniverse} 域（从 ${formatDmxAddress(targetUniverse, address)} 开始还需要 ${requiredChannels} 个通道）。请拆分本组或改用其他域。`
        return { ...group, groupIndex, totalChannels: requiredChannels, fixtures: [] }
      }
      const groupFixtures = []
      for (let fixtureIndex = 1; fixtureIndex <= group.fixtureCount; fixtureIndex += 1) {
        const start = cursors[targetUniverse]
        const end = start + group.channelCount - 1
        globalFixtureIndex += 1
        const fixture = {
          globalIndex: globalFixtureIndex,
          groupId: group.id,
          groupIndex,
          groupName: group.name,
          fixtureModel: group.fixtureModel,
          fixtureIndex,
          channelCount: group.channelCount,
          universe: targetUniverse,
          universeLabel: group.targetUniverse,
          startAddress: start,
          endAddress: end,
          addressText: formatDmxAddress(targetUniverse, start),
          rangeText: `${formatDmxAddress(targetUniverse, start)}–${formatDmxAddress(targetUniverse, end)}`,
        }
        groupFixtures.push(fixture)
        fixtures.push(fixture)
        cursors[targetUniverse] = end + 1
      }
      return {
        ...group,
        groupIndex,
        totalChannels: requiredChannels,
        fixtures: groupFixtures,
      }
    })
    if (manualError) return buildError(manualError)
    const usedUniverses = [...new Set(fixtures.map((fixture) => fixture.universe))].sort((a, b) => a - b)
    const firstFixture = fixtures.find((fixture) => fixture.universe === usedUniverses[0])
    const lastFixture = [...fixtures].reverse().find((fixture) => fixture.universe === usedUniverses[usedUniverses.length - 1])
    const universeSummaries = createUniverseSummaries(fixtures)
    const totalChannels = normalizedGroups.reduce((sum, group) => sum + (group.channelCount * group.fixtureCount), 0)
    return {
      allocationMode,
      modeText: '按组分域',
      startUniverse,
      startUniverseLabel: firstFixture.universeLabel,
      startAddress: firstFixture.startAddress,
      startText: firstFixture.addressText,
      endText: lastFixture.rangeText.split('–').pop(),
      nextText: buildNextText(cursors, usedUniverses),
      nextMetricLabel: '各域下一可用',
      totalGroups: normalizedGroups.length,
      totalFixtures,
      totalChannels,
      universeCount: usedUniverses.length,
      unusedTailChannels: 0,
      skippedRanges: [],
      groups: groupResults,
      fixtures,
      universeSummaries,
      warnings: [
        '按组分域：同一灯具组固定在指定域内，不会自动跨域；请分别核对各域信号主线与分配器输出。',
      ],
      ruleText: '按组指定域并在域内连续编址；单台灯具和整组灯具均不得跨域或与其他组重叠。',
    }
  }

  let universe = startUniverse
  let address = startAddress
  let globalFixtureIndex = 0
  let unusedTailChannels = 0
  let overflow = false
  const skippedRanges = []
  const fixtures = []
  const groupResults = normalizedGroups.map((group, groupIndex) => {
    const groupFixtures = []
    for (let fixtureIndex = 1; fixtureIndex <= group.fixtureCount; fixtureIndex += 1) {
      if (address + group.channelCount - 1 > DMX_UNIVERSE_SIZE) {
        skippedRanges.push({
          universe,
          universeLabel: getUniverseLabel(universe),
          startAddress: address,
          endAddress: DMX_UNIVERSE_SIZE,
          channelCount: DMX_UNIVERSE_SIZE - address + 1,
          rangeText: `${formatDmxAddress(universe, address)}–${formatDmxAddress(universe, DMX_UNIVERSE_SIZE)}`,
        })
        unusedTailChannels += DMX_UNIVERSE_SIZE - address + 1
        universe += 1
        address = 1
      }
      if (universe > MAX_UNIVERSE) {
        overflow = true
        break
      }

      const endAddress = address + group.channelCount - 1
      globalFixtureIndex += 1
      const fixture = {
        globalIndex: globalFixtureIndex,
        groupId: group.id,
        groupIndex,
        groupName: group.name,
        fixtureModel: group.fixtureModel,
        fixtureIndex,
        channelCount: group.channelCount,
        universe,
        universeLabel: getUniverseLabel(universe),
        startAddress: address,
        endAddress,
        addressText: formatDmxAddress(universe, address),
        rangeText: `${formatDmxAddress(universe, address)}–${formatDmxAddress(universe, endAddress)}`,
      }
      groupFixtures.push(fixture)
      fixtures.push(fixture)
      address = endAddress + 1
      if (address > DMX_UNIVERSE_SIZE) {
        universe += 1
        address = 1
      }
    }

    return {
      ...group,
      groupIndex,
      totalChannels: group.channelCount * group.fixtureCount,
      fixtures: groupFixtures,
    }
  })

  if (overflow || fixtures.length !== totalFixtures) {
    return buildError(`编址结果超过 ${getUniverseLabel(MAX_UNIVERSE)} 域，请减少灯具数量或调整起始域。`)
  }

  const lastFixture = fixtures[fixtures.length - 1]
  const lastUniverse = lastFixture.universe
  const universeSummaries = createUniverseSummaries(fixtures)
  const totalChannels = normalizedGroups.reduce(
    (sum, group) => sum + (group.channelCount * group.fixtureCount),
    0,
  )
  const warnings = []
  if (lastUniverse > startUniverse) {
    warnings.push(`本方案从 ${getUniverseLabel(startUniverse)} 域跨至 ${getUniverseLabel(lastUniverse)} 域，共 ${lastUniverse - startUniverse + 1} 个域，请核对控台输出口与节点域。`)
  }
  if (unusedTailChannels) {
    warnings.push(`为避免单台灯具跨域，域尾共保留 ${unusedTailChannels} 个未使用地址。`)
  }
  const hasNextAddress = universe <= MAX_UNIVERSE

  return {
    allocationMode,
    modeText: '连续自动',
    startUniverse,
    startUniverseLabel: getUniverseLabel(startUniverse),
    startAddress,
    startText: formatDmxAddress(startUniverse, startAddress),
    endText: formatDmxAddress(lastUniverse, lastFixture.endAddress),
    nextText: hasNextAddress
      ? formatDmxAddress(universe, address)
      : `已到 ${getUniverseLabel(MAX_UNIVERSE)}512 上限`,
    nextMetricLabel: '下一可用地址',
    totalGroups: normalizedGroups.length,
    totalFixtures,
    totalChannels,
    universeCount: lastUniverse - startUniverse + 1,
    unusedTailChannels,
    skippedRanges,
    groups: groupResults,
    fixtures,
    universeSummaries,
    warnings,
    ruleText: '按分组顺序连续编址；单台灯具的全部通道必须位于同一个 DMX 域内。',
  }
}

module.exports = {
  DMX_UNIVERSE_SIZE,
  MAX_GROUPS,
  MAX_TOTAL_FIXTURES,
  calculateDmxAddressPlan,
}
