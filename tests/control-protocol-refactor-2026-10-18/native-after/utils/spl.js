function round(value, digits = 1) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function getSummationGainDb(speakerCount, summationMode) {
  if (!Number.isInteger(speakerCount) || speakerCount < 1) {
    return null
  }

  if (speakerCount === 1) {
    return 0
  }

  const multiplier = summationMode === 'coherent' ? 20 : 10
  return round(multiplier * Math.log10(speakerCount))
}

function getHumanReference(spl) {
  if (spl < 60) {
    return {
      level: '较安静',
      title: '接近日常交谈以下的声压量级',
      description: '更适合安静交流或较低音量的背景声音。',
    }
  }

  if (spl < 75) {
    return {
      level: '清晰语音',
      title: '常规会议与演讲扩声的常用量级',
      description: '以语言清晰度为主的场景通常处于这一声压范围附近。',
    }
  }

  if (spl < 85) {
    return {
      level: '明显偏响',
      title: '较响的演讲、培训或背景音乐量级',
      description: '听感已经明显高于普通交谈，应结合现场噪声和覆盖情况调整。',
    }
  }

  if (spl < 95) {
    return {
      level: '很响',
      title: '高声压语言扩声或音乐重放量级',
      description: '适合需要较大声压余量的场景，不宜把此数值长期作为普通会议工作声压。',
    }
  }

  if (spl < 105) {
    return {
      level: '高声压',
      title: '接近现场演出或高声压扩声的量级',
      description: '100 dB SPL 左右已经很响，会议场景通常仅将其作为最大声压能力参考。',
    }
  }

  return {
    level: '很高声压',
    title: '高声压演出扩声量级',
    description: '应严格控制工作时长、覆盖区域和限幅保护，并以现场测量为准。',
  }
}

function getMeetingReference(spl) {
  const verificationNote = '仅比较最大声压级数值，不能据此判定工程达标。'

  if (spl >= 98) {
    return {
      level: '一级数值门槛',
      title: '当前理论值高于会议类一级最大声压级参考值（≥98 dB）',
      description: `${verificationNote} 正式评价还需要测量频率响应、传声增益、稳态声场不均匀度和系统噪声。`,
    }
  }

  if (spl >= 95) {
    return {
      level: '二级数值门槛',
      title: '当前理论值处于会议类二级最大声压级参考区间（≥95 dB）',
      description: `${verificationNote} 这不是完整的会议类二级验收结论。`,
    }
  }

  return {
    level: '低于二级数值',
    title: '当前理论值低于会议类二级最大声压级参考值（95 dB）',
    description: '这只表示当前测点的理论声压不足以覆盖该项数值门槛，不代表整个工程的合格与否。',
  }
}

function calculateSplAtDistance(sensitivityDb, ratedPower, distanceMeters, summationGainDb = 0) {
  if (
    !Number.isFinite(sensitivityDb)
    || !Number.isFinite(ratedPower)
    || ratedPower <= 0
    || !Number.isFinite(summationGainDb)
  ) {
    return null
  }

  if (!Number.isFinite(distanceMeters) || distanceMeters < 1) {
    return null
  }

  const oneMeterSpl = sensitivityDb + 10 * Math.log10(ratedPower) + summationGainDb
  const spl = oneMeterSpl - 20 * Math.log10(distanceMeters)

  const result = {
    oneMeterSpl: round(oneMeterSpl),
    spl: round(spl),
  }
  return Number.isFinite(result.oneMeterSpl) && Number.isFinite(result.spl)
    ? result
    : null
}

function buildDistanceRows(sensitivityDb, ratedPower, selectedDistance, summationGainDb) {
  const effectiveSummationGainDb = summationGainDb === undefined ? 0 : summationGainDb
  if (
    !Number.isFinite(sensitivityDb)
    || !Number.isFinite(ratedPower)
    || ratedPower <= 0
    || !Number.isFinite(selectedDistance)
    || selectedDistance < 1
    || !Number.isFinite(effectiveSummationGainDb)
  ) return null

  const standardDistances = [1, 2, 4, 8, 12, 16, 20]
  const distances = [...new Set([...standardDistances, selectedDistance])]
    .sort((a, b) => a - b)

  const rows = []
  for (const distanceMeters of distances) {
    const calculated = calculateSplAtDistance(
      sensitivityDb,
      ratedPower,
      distanceMeters,
      effectiveSummationGainDb,
    )
    if (!calculated) return null
    rows.push({
      distanceMeters,
      spl: calculated.spl,
      isSelected: distanceMeters === selectedDistance,
    })
  }
  return rows
}

function calculateSpeakerSpl(options = {}) {
  const {
    speaker,
    distanceMeters,
    speakerCount = 1,
    summationMode = 'distributed',
  } = options

  if (
    !speaker
    || !Number.isFinite(speaker.sensitivityDb)
    || !Number.isFinite(speaker.ratedPower)
  ) {
    return null
  }

  const summationGainDb = getSummationGainDb(speakerCount, summationMode)
  const singleCalculated = calculateSplAtDistance(
    speaker.sensitivityDb,
    speaker.ratedPower,
    distanceMeters,
  )
  const calculated = calculateSplAtDistance(
    speaker.sensitivityDb,
    speaker.ratedPower,
    distanceMeters,
    summationGainDb,
  )

  if (!singleCalculated || !calculated || summationGainDb === null) {
    return null
  }

  const totalRatedPower = speaker.ratedPower * speakerCount
  if (!Number.isFinite(totalRatedPower)) return null
  const distanceRows = buildDistanceRows(
    speaker.sensitivityDb,
    speaker.ratedPower,
    distanceMeters,
    summationGainDb,
  )
  if (!distanceRows) return null

  return {
    model: speaker.model,
    sensitivityDb: speaker.sensitivityDb,
    ratedPower: speaker.ratedPower,
    totalRatedPower,
    source: speaker.source,
    distanceMeters,
    speakerCount,
    summationMode,
    summationGainDb,
    singleOneMeterSpl: singleCalculated.oneMeterSpl,
    singleSelectedSpl: singleCalculated.spl,
    oneMeterSpl: calculated.oneMeterSpl,
    selectedSpl: calculated.spl,
    humanReference: getHumanReference(calculated.spl),
    meetingReference: getMeetingReference(calculated.spl),
    distanceRows,
  }
}

module.exports = {
  buildDistanceRows,
  calculateSpeakerSpl,
  calculateSplAtDistance,
  getHumanReference,
  getMeetingReference,
  getSummationGainDb,
}
