const { speakers } = require('../../data/equipment')
const { cameras } = require('../../data/cameras')
const {
  calculateGroundAreaPlacement,
  calculateHorizontalOnlyPlacement,
  calculateVerticalPlanePlacement,
  getCameraMountLabel,
  getCameraMountType,
  getHorizontalCameraViews,
  resolveLibraryOptics,
} = require('../../utils/camera-fov')
const { calculateSpeakerSpl } = require('../../utils/spl')
const { calculateConstantVoltageCable, calculateProfessionalSpeakerCable } = require('../../utils/cable')
const { calculateLedScreenPlan, LED_UNIT_SPECS, LED_PIXEL_PITCHES, PREFERRED_RATIO_ERROR } = require('../../utils/led-screen')
const { calculateDmxAddressPlan } = require('../../utils/dmx-address')
const { buildResultReportPayload, calculateResultReportHeight, drawResultReport } = require('../../utils/result-report')
const limiterReport = require('../limiter/limiter-report')
const splReport = require('../spl/spl-report')
const cableReport = require('../cable/cable-report')
const cameraReport = require('../camera/camera-report')
const ledReport = require('../led-screen/report')
const gainReport = require('../gain-structure/gain-report')
const { buildLightingExportPages, renderLightingExportPage } = require('../dmx-layout/layout-renderer')
const { APRON_DIRECTIONS, createStageGeometry } = require('../dmx-layout/layout-model')

const REPORT_WIDTH = 750
const REPORT_MAX_CANVAS_HEIGHT = 3600
const REPORT_SEGMENT_HEIGHT = 3600
const MAX_RESULT_LINES = 20
const GENERIC_PAGE_LINES = 14

function fail(error) {
  return { ok: false, error }
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key)
}

function validPreferences(record, required) {
  if (!record || !record.preferences || typeof record.preferences !== 'object'
    || Array.isArray(record.preferences) || typeof record.resultText !== 'string' || !record.resultText) {
    return '这条记录缺少完整的历史输入，无法还原工具图片。'
  }
  const missing = required.filter((key) => !hasOwn(record.preferences, key))
  return missing.length ? '这条记录缺少完整的历史输入，无法还原工具图片。' : ''
}

function number(value) {
  if (value === null || value === undefined || (typeof value === 'string' && !value.trim())) return NaN
  return Number(value)
}

function hasNativeMeasureContext(context) {
  return Boolean(context && typeof context.measureText === 'function')
}

function makeTask(module, title, draw, options = {}) {
  const width = Number(options.width) || REPORT_WIDTH
  const height = Number(options.height)
  if (!Number.isFinite(height) || height < 1) throw new RangeError(`${title}缺少有效的原始图片高度。`)
  return {
    module,
    title,
    width,
    height,
    canvasHeight: Math.min(height, REPORT_MAX_CANVAS_HEIGHT),
    drawSegment(context, top, segmentHeight) {
      const start = Number(top)
      const partHeight = Number(segmentHeight)
      if (!Number.isFinite(start) || start < 0 || !Number.isFinite(partHeight) || partHeight < 1
        || start + partHeight > height + 1) throw new RangeError('原生报告图片分段范围无效。')
      context.save()
      try {
        context.beginPath()
        context.rect(0, 0, width, partHeight)
        context.clip()
        context.translate(0, -start)
        const drawn = draw(context)
        if (drawn && Number.isFinite(Number(drawn.height)) && Math.abs(Number(drawn.height) - height) > 1) {
          throw new RangeError('原生报告图片的排版高度在绘制时发生变化。')
        }
      } finally {
        context.restore()
      }
      return { width, height: partHeight, fullHeight: height, top: start }
    },
  }
}

function splitTaskIntoSegments(task, segmentHeight = REPORT_SEGMENT_HEIGHT) {
  const width = Number(task?.width)
  const height = Number(task?.height)
  const safeHeight = Number(segmentHeight)
  if (!Number.isFinite(width) || width < 1 || !Number.isFinite(height) || height < 1
    || !Number.isFinite(safeHeight) || safeHeight < 1 || typeof task.drawSegment !== 'function') return []
  const segments = []
  for (let top = 0; top < height; top += safeHeight) {
    segments.push({ top, height: Math.min(safeHeight, height - top) })
  }
  return segments
}

function buildGenericTasks(record, measureContext) {
  const initialPayload = buildResultReportPayload(record)
  if (!initialPayload) return fail('该模块的保存结果无法由原生结果图片渲染器读取。')
  if (!hasNativeMeasureContext(measureContext)) {
    return fail('当前环境无法测量原生结果文字，未生成可能裁切的图片。')
  }
  const renderer = record.module === 'limiter' ? limiterReport
    : record.module === 'gainStructure' ? gainReport : null
  const pages = splitResultReportRecord(record, GENERIC_PAGE_LINES, measureContext)
  if (!pages.length || pages.some((page) => !buildResultReportPayload(page))) return fail('保存结果为空，无法生成工具图片。')
  const tasks = []
  if (renderer) {
    const canonical = getCanonicalResultLines(record, initialPayload.moduleLabel)
    const specializedPayload = { ...initialPayload, lines: canonical.lines }
    const specializedHeight = renderer.calculateResultReportHeight(specializedPayload, measureContext)
    if (!Number.isFinite(specializedHeight) || specializedHeight < 1) {
      return fail(`${initialPayload.moduleLabel}原生图片无法计算安全排版高度。`)
    }
    tasks.push(makeTask(record.module, `${initialPayload.moduleLabel} · 原生图`, (context) => {
      renderer.drawResultReport(context, specializedPayload, specializedHeight)
      return { width: REPORT_WIDTH, height: specializedHeight }
    }, { height: specializedHeight }))

    const supplementPages = record.module === 'gainStructure'
      ? splitResultReportLines(record, gainSupplementLines(canonical.lines), GENERIC_PAGE_LINES, measureContext)
      : pages.slice(1)
    supplementPages.forEach((page, index) => {
      const pagePayload = buildResultReportPayload(page)
      const height = calculateResultReportHeight(pagePayload)
      const title = record.module === 'gainStructure'
        ? `${initialPayload.moduleLabel} · 补充说明 ${index + 1} / ${supplementPages.length} 页`
        : `${initialPayload.moduleLabel} · 结果续页 ${index + 2} / ${pages.length} 页`
      tasks.push(makeTask(record.module, title, (context) => {
        drawResultReport(context, pagePayload, height)
        return { width: REPORT_WIDTH, height }
      }, { height }))
    })
    return { ok: true, tasks }
  }
  return {
    ok: true,
    tasks: pages.map((page, index) => {
      const pagePayload = buildResultReportPayload(page)
      const height = calculateResultReportHeight(pagePayload)
      const title = `${initialPayload.moduleLabel} · 第 ${index + 1} / ${pages.length} 页`
      return makeTask(record.module, title, (context) => {
        drawResultReport(context, pagePayload, height)
        return { width: REPORT_WIDTH, height }
      }, { height })
    }),
  }
}

function splitMeasuredResultLine(line, measureContext) {
  const maxWidth = 606
  measureContext.font = '400 21px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif'
  const wrapped = []
  let current = ''
  for (const character of [...String(line)]) {
    const candidate = current + character
    if (current && Number(measureContext.measureText(candidate)?.width) > maxWidth) {
      wrapped.push(current)
      current = character
    } else {
      current = candidate
    }
  }
  if (current || !wrapped.length) wrapped.push(current)
  return wrapped
}

function getCanonicalResultLines(record, moduleLabel) {
  const lines = String(record.resultText || '').split(/\r\n|\r|\n/).map((line) => line.trim()).filter(Boolean)
  const firstLine = lines[0] || ''
  const hasHiddenTitle = firstLine.includes(moduleLabel) && /(计算|估算|选型|编址)/.test(firstLine)
  const resultNature = lines.find((line) => line.startsWith('结果性质：')) || ''
  return {
    firstLine,
    hasHiddenTitle,
    resultNature,
    lines: lines.filter((line, index) => !(hasHiddenTitle && index === 0) && !line.startsWith('结果性质：')),
  }
}

function gainSupplementLines(lines) {
  const summaryOrNativeLabels = new Set([
    '功放', '输入级档位', '工作条件', 'DSP 标定', '目标峰值', '功放额定输出输入点',
    '系统对齐衰减', '衰减执行位置', 'DSP 输入表目标', 'DSP 最终输出增益', '功放输入电平控制',
  ])
  return lines.filter((line) => {
    const colonIndex = line.indexOf('：')
    const label = colonIndex < 0 ? '' : line.slice(0, colonIndex).trim()
    if (summaryOrNativeLabels.has(label)) return false
    if (['驱动差额', '驱动不足', '系统对齐衰减'].includes(label)) return false
    if (line.includes('DSP') && line.includes('衰减') && line.includes('功放')) return false
    return true
  })
}

function splitResultReportLines(record, bodyLines, pageSize = MAX_RESULT_LINES, measureContext) {
  const initial = buildResultReportPayload(record)
  if (!initial || !hasNativeMeasureContext(measureContext)) return []
  const canonical = getCanonicalResultLines(record, initial.moduleLabel)
  const bodyGroups = (Array.isArray(bodyLines) ? bodyLines : canonical.lines)
    .map((line) => String(line || '').trim())
    .filter(Boolean)
    .map((line) => splitMeasuredResultLine(line, measureContext))
  const safePageSize = Math.max(1, Math.min(MAX_RESULT_LINES, Number(pageSize) || MAX_RESULT_LINES))
  const slices = []
  let current = []
  const flush = () => {
    if (!current.length) return
    slices.push(current)
    current = []
  }
  bodyGroups.forEach((group) => {
    if (group.length > safePageSize) {
      flush()
      for (let index = 0; index < group.length; index += safePageSize) {
        slices.push(group.slice(index, index + safePageSize))
      }
      return
    }
    if (current.length && current.length + group.length > safePageSize) flush()
    current.push(...group)
  })
  flush()
  return slices.map((slice, pageIndex) => ({
      ...record,
      resultText: [canonical.hasHiddenTitle ? canonical.firstLine : '', canonical.resultNature, ...slice].filter(Boolean).join('\n'),
      title: `${record.title || initial.moduleLabel} · 结果 ${pageIndex + 1}`,
    }))
}

function splitResultReportRecord(record, pageSize = MAX_RESULT_LINES, measureContext) {
  return splitResultReportLines(record, null, pageSize, measureContext)
}

function buildSplTask(record, measureContext) {
  if (!hasNativeMeasureContext(measureContext)) return fail('当前环境无法测量声压级结果文字，未生成可能裁切的图片。')
  const issue = validPreferences(record, ['speakerModel', 'speakerCount', 'distanceText', 'summationMode'])
  if (issue) return fail(issue)
  const prefs = record.preferences
  const speaker = speakers.find((item) => item.model === prefs.speakerModel && !item.calculationDisabled
    && Number.isFinite(item.sensitivityDb) && Number.isFinite(item.ratedPower))
  if (!speaker) return fail(`历史音箱型号“${prefs.speakerModel || '未保存'}”无法识别，未使用其他型号替代。`)
  if (!Number.isInteger(prefs.speakerCount) || prefs.speakerCount < 1
    || !['distributed', 'coherent'].includes(prefs.summationMode)) {
    return fail('历史音箱数量或叠加方式无法识别。')
  }
  const distanceMeters = number(prefs.distanceText)
  const shortLabel = prefs.summationMode === 'coherent' ? '同相叠加' : '常规叠加'
  const result = calculateSpeakerSpl({ speaker, distanceMeters, speakerCount: prefs.speakerCount, summationMode: prefs.summationMode })
  if (!result) return fail('保存的声压级参数无法通过当前纯计算模型重建。')
  result.summationModeShortLabel = shortLabel
  const expected = [
    '声压级与功率估算', '结果性质：自由场理论估算',
    `音箱：${result.model} × ${result.speakerCount} 只`, `测量距离：${result.distanceMeters} m`,
    `叠加方式：${result.summationModeShortLabel}`,
    `说明书灵敏度：${result.sensitivityDb} dB @ 1W/1m`,
    `总额定功率：${result.totalRatedPower} W`, `叠加增益：+${result.summationGainDb} dB`,
    `1 m 理论声压级：${result.oneMeterSpl} dB SPL`,
    `${result.distanceMeters} m 理论声压级：${result.selectedSpl} dB SPL`,
    '注：自由场理论估算，实际结果受节目电平、摆位、覆盖角度、相位和房间反射影响。',
  ].join('\n')
  if (expected !== record.resultText) return fail('声压级历史结果与保存的计算结果不一致，未生成替代图。')
  const payload = splReport.buildSplReportPayload({ result })
  const height = splReport.calculateSplReportHeight(payload, measureContext)
  if (!Number.isFinite(height) || height < 1) return fail('声压级原生结果图无法计算安全分页高度。')
  return { ok: true, tasks: [makeTask('spl', '声压级原生结果图', (context) => {
    splReport.drawSplReport(context, payload, height)
    return { width: splReport.REPORT_WIDTH, height }
  }, { height })] }
}

function buildCableTask(record, measureContext) {
  if (!hasNativeMeasureContext(measureContext)) return fail('当前环境无法测量线材结果文字，未生成可能裁切的图片。')
  const required = ['mode', 'environment', 'constantPowerText', 'constantDistanceText', 'professionalPowerText', 'professionalDistanceText']
  const issue = validPreferences(record, required)
  if (issue) return fail(issue)
  const prefs = record.preferences
  if (!['constant', 'professional'].includes(prefs.mode) || !['indoor', 'outdoor'].includes(prefs.environment)) {
    return fail('历史线材模式或敷设环境无法识别。')
  }
  const constant = prefs.mode === 'constant'
  const powerText = constant ? prefs.constantPowerText : prefs.professionalPowerText
  const distanceText = constant ? prefs.constantDistanceText : prefs.professionalDistanceText
  const result = constant
    ? calculateConstantVoltageCable({ totalPowerW: powerText, distanceMeters: prefs.constantDistanceText, environment: prefs.environment })
    : calculateProfessionalSpeakerCable({ totalPowerW: powerText, distanceMeters: distanceText })
  if (!result || result.error) return fail(result?.error || '保存的线材参数无法重建。')
  const envLabel = prefs.environment === 'outdoor' ? '室外' : '室内'
  const expected = [
    constant ? '定压广播线材选型' : '专业音箱线材选型', '结果性质：公司标准推荐',
    `输入总功率：${powerText} W`, `最远单程距离：${result.distanceMeters} m`,
    ...(constant ? [`敷设环境：${envLabel}`] : []), `设计带载功率：${result.designPowerW} W`,
    `推荐线材：${result.spec}`, `状态：${result.status}`, result.description,
    ...(result.hasFormula ? [`公司公式校核下限：${result.formulaMinimumArea} mm²`] : []),
    ...result.warnings.map((warning) => `注意：${warning}`),
    '注：按公司线材标准作选型参考，实际施工仍需结合敷设方式、环境和当地规范复核。',
  ].join('\n')
  if (expected !== record.resultText) return fail('线材历史结果与保存的计算结果不一致，未生成替代图。')
  const state = {
    result,
    constantPowerText: prefs.constantPowerText,
    professionalPowerText: prefs.professionalPowerText,
    environments: [{ value: 'indoor', label: '室内' }, { value: 'outdoor', label: '室外' }],
    environmentIndex: prefs.environment === 'outdoor' ? 1 : 0,
  }
  const payload = cableReport.buildCableReportPayload(state)
  const layout = cableReport.buildCableReportLayout(measureContext, payload)
  if (!layout?.height) return fail('线材原生结果图无法计算安全分页高度。')
  const height = layout.height
  return { ok: true, tasks: [makeTask('cable', '线材选型原生结果图', (context) => {
    cableReport.drawCableReport(context, payload, layout)
    return { width: REPORT_WIDTH, height: layout.height }
  }, { height })] }
}

function decorateLedResult(result, prefs) {
  const unit = LED_UNIT_SPECS[result.unitKey]
  if (!unit) return null
  const exactRatio = result.columns * unit.widthMm / (result.rows * unit.heightMm)
  const deviation = Math.abs(exactRatio - result.targetAspectRatio) / result.targetAspectRatio
  const ratioDeviationText = `${(deviation * 100).toFixed(1)}%`
  const ratioFallback = deviation > PREFERRED_RATIO_ERROR + 1e-9
  const finest = Number(result.pixelPitch) === Math.min(...LED_PIXEL_PITCHES)
  const viewingAssessmentText = result.statusKey === 'near'
    ? `${result.viewingDistanceMeters} m 低于 ${result.comfortableMinimumMeters} m 的舒适距离参考下限。${finest
      ? `${result.pitchMode === 'recommended' ? '系统推荐' : '当前指定'}已是现有规格中最细的 ${result.pitchText}。`
      : `当前按 ${result.pitchModeLabel} ${result.pitchText} 校核。`}`
    : result.statusKey === 'avoid'
      ? `${result.viewingDistanceMeters} m 低于 ${result.pitchText} 对应的点间距距离参考。`
      : result.statusKey === 'surplus'
        ? `${result.viewingDistanceMeters} m 超过舒适距离参考上限 ${result.comfortableMaximumMeters} m，当前点间距清晰度有富余。`
        : ''
  return {
    ...result,
    actualRatioText: `${Number(exactRatio.toFixed(2))}:1`,
    ratioDeviationText,
    layoutText: `横向${result.unitType === 'module' ? '模组' : '箱体'} ${result.columns} × 纵向${result.unitType === 'module' ? '模组' : '箱体'} ${result.rows}，总共 ${result.totalUnits} 块`,
    integerLayoutNote: deviation > 1e-9 ? '完整单元拼装会产生比例偏差，内容按实际比例适配。' : '屏体按完整单元拼装，内容按实际比例显示。',
    ratioFallbackText: ratioFallback ? '整数拼装偏差超过 5%，无法满足目标比例，当前为最接近方案。' : '',
    viewingAssessmentText,
  }
}

function buildLedTask(record, measureContext) {
  if (!hasNativeMeasureContext(measureContext)) return fail('当前环境无法测量 LED 结果文字，未生成可能裁切的图片。')
  const required = ['wallWidthText', 'wallHeightText', 'topReserveText', 'bottomReserveText', 'frameWidthText', 'viewingDistanceText', 'aspectRatio', 'unitKey', 'pitch']
  const issue = validPreferences(record, required)
  if (issue) return fail(issue)
  const prefs = record.preferences
  if (!LED_UNIT_SPECS[prefs.unitKey] || !['recommended', ...LED_PIXEL_PITCHES].some((value) => value === prefs.pitch)
    || typeof prefs.aspectRatio !== 'string' || !prefs.aspectRatio) return fail('历史拼装单元、点间距或比例无法识别。')
  const frameWidthCm = number(prefs.frameWidthText)
  const calculation = calculateLedScreenPlan({
    wallWidthMeters: prefs.wallWidthText, wallHeightMeters: prefs.wallHeightText,
    topReserveMeters: prefs.topReserveText, bottomReserveMeters: prefs.bottomReserveText,
    frameWidthMeters: Number.isFinite(frameWidthCm) ? frameWidthCm / 100 : NaN,
    viewingDistanceMeters: prefs.viewingDistanceText, aspectRatioKey: prefs.aspectRatio,
    unitKey: prefs.unitKey, pixelPitch: prefs.pitch,
  })
  if (!calculation || calculation.error) return fail(calculation?.error || '保存的 LED 参数无法重建。')
  const result = decorateLedResult(calculation, prefs)
  if (!result) return fail('历史拼装单元无法识别。')
  const expected = [
    'LED 大屏尺寸预估',
    `现场墙面：${prefs.wallWidthText} × ${prefs.wallHeightText} m`,
    `上/下最低预留：${prefs.topReserveText} / ${prefs.bottomReserveText} m`,
    `目标画面比例：${result.targetAspectRatioKey}`,
    `实际比例：${result.actualRatioText}（偏差 ${result.ratioDeviationText}）`, result.integerLayoutNote,
    ...(result.ratioFallbackText ? [`比例提示：${result.ratioFallbackText}`] : []),
    `实际屏体：${result.dimensionText}`, `四周包边：${result.frameWidthText}`,
    `含包边安装外尺寸：${result.installedDimensionText}`, `拼装数量：${result.layoutText}`,
    `拼装单元：${result.unitSizeText}`, `左右余量：${result.horizontalMarginText}`,
    `上/下实际余量：${result.verticalMarginText}`, `点间距：${result.pitchModeLabel} ${result.pitchText}`,
    `估算分辨率：${result.resolutionText}`, `最近观看距离：${result.viewingDistanceMeters} m`,
    `舒适观看范围：${result.comfortableRangeText}`, `观看校核：${result.statusLabel}`,
    '结果为前期尺寸预估，最终以实际模组/箱体像素矩阵及结构深化为准。',
  ].join('\n')
  if (expected !== record.resultText) return fail('LED 历史结果与保存的计算结果不一致，未生成替代图。')
  const payload = ledReport.buildLedScreenReportPayload({
    wallWidthText: prefs.wallWidthText, wallHeightText: prefs.wallHeightText,
    topReserveText: prefs.topReserveText, bottomReserveText: prefs.bottomReserveText,
    viewingDistanceText: prefs.viewingDistanceText, result,
  })
  const layout = ledReport.buildLedScreenReportLayout(measureContext, payload)
  if (!layout?.height) return fail('LED 大屏原生结果图无法计算安全分页高度。')
  const height = layout.height
  return { ok: true, tasks: [makeTask('ledScreen', 'LED 大屏原生结果图', (context) => {
    ledReport.drawLedScreenReport(context, payload, layout)
    return { width: ledReport.REPORT_WIDTH, height: layout.height }
  }, { height })] }
}

function formatCameraNumber(value) {
  return Number(value).toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1')
}

function buildCameraCalculationProcess(result) {
  if (result.framingVersion === 2) {
    return {
      rows: [
        { title: '确定真实目标边界', formula: '场地纵深保持输入值，投影目标各角点到相机取景截面',
          substitution: `宽 ${result.widthMeters} m，${result.sceneMode === 'ground' ? `纵深 ${result.depthMeters} m` : `高 ${result.heightMeters} m`}`,
          value: '使用镜头中心与俯仰基底' },
        { title: '加入取景余量', formula: '投影包络总宽、总高分别 × (1 + 余量)，两侧均分',
          substitution: `1 + ${result.marginPercent}%`, value: `每侧 ${result.marginPercent / 2}%` },
        { title: '求解前沿退距', formula: result.horizontalOnly ? '扩张后的水平投影包络不超过镜头水平视场角'
          : '扩张后的水平、垂直投影包络同时位于镜头视场角内',
          substitution: `水平 ${result.horizontalFov}°${result.horizontalOnly ? '；垂直未校核' : `，垂直 ${result.verticalFov}°`}`,
          value: `${result.primaryDistanceMeters} m` },
      ],
      conclusion: result.horizontalOnly ? `仅水平参考 ${result.primaryDistanceMeters} m，垂直覆盖未校核。`
        : `相机坐标下双轴包络校核通过，理论最小前沿退距 ${result.primaryDistanceMeters} m；场地纵深未增加。`,
      visual: { horizontalBarPercent: 100, verticalBarPercent: result.horizontalOnly ? 0 : 100,
        limitingDistanceMeters: formatCameraNumber(result.calculationDistanceMeters), limitingAxisLabel: result.distanceConstraintText,
        hasDepthMargin: false, depthMarginMeters: 0 },
    }
  }
  const rows = [
    { title: '加入构图余量', formula: '有效宽度 = 原宽度 × (1 + 余量)',
      substitution: `${result.widthMeters} × (1 + ${result.marginPercent}%)`, value: `${result.effectiveWidthMeters} m` },
    { title: '计算水平最低距离', formula: 'Dₕ = 有效宽度 ÷ [2 × tan(水平视场角 ÷ 2)]',
      substitution: `${result.effectiveWidthMeters} ÷ [2 × tan(${result.horizontalFov}° ÷ 2)]`,
      value: `${result.horizontalMinimumDistanceMeters} m` },
  ]
  if (!result.horizontalOnly) rows.push({
    title: '满足水平约束后校核垂直距离', formula: '从水平最低距离起求解：垂直包络角 ≤ 镜头垂直视场角',
    substitution: result.sceneMode === 'ground'
      ? `镜头高 ${result.cameraHeightMeters} m，有效高度 0–${result.effectiveSubjectHeightMeters} m，有效纵深 ${result.effectiveDepthMeters} m，垂直角 ${result.verticalFov}°`
      : `镜头高 ${result.cameraHeightMeters} m，有效上下边界 ${result.effectiveBottomHeightMeters}–${result.effectiveTopHeightMeters} m，垂直角 ${result.verticalFov}°`,
    value: `${formatCameraNumber(result.calculationDistanceMeters)} m`,
  })
  const limitingDistance = result.horizontalOnly ? result.horizontalMinimumDistanceMeters : result.calculationDistanceMeters
  rows.push(result.sceneMode === 'ground'
    ? { title: '换算到实际区域前沿', formula: `${result.horizontalOnly ? 'Dₕ' : '满足水平约束的距离'} + 纵深方向构图余量`,
      substitution: `${formatCameraNumber(limitingDistance)} + ${result.depthMarginMeters}`, value: `${result.primaryDistanceMeters} m` }
    : { title: '确定最终最低距离', formula: result.horizontalOnly ? 'D = Dₕ' : '当前模型下双轴覆盖通过的理论最小距离',
      substitution: result.horizontalOnly ? `${result.horizontalMinimumDistanceMeters}` : formatCameraNumber(limitingDistance),
      value: `${result.primaryDistanceMeters} m` })
  const barMaximum = Math.max(limitingDistance, 0.01)
  return {
    rows,
    conclusion: result.horizontalOnly
      ? `当前只能确认水平方向至少需要 ${result.primaryDistanceMeters} m；垂直覆盖仍需说明书参数或样机画面确认。`
      : `当前独立水平/垂直视场角模型下，理论最小距离为 ${result.primaryDistanceMeters} m；两轴校核通过。`,
    visual: {
      horizontalBarPercent: Math.max(12, Math.round(result.horizontalMinimumDistanceMeters / barMaximum * 100)),
      verticalBarPercent: result.horizontalOnly ? 0 : Math.max(12, Math.round(result.verticalMinimumDistanceMeters / barMaximum * 100)),
      limitingDistanceMeters: formatCameraNumber(limitingDistance),
      limitingAxisLabel: result.horizontalOnly ? '仅水平约束' : result.distanceConstraintText,
      hasDepthMargin: result.sceneMode === 'ground' && result.depthMarginMeters > 0,
      depthMarginMeters: result.depthMarginMeters || 0,
    },
  }
}

function buildCameraResultText(result) {
  const sceneRows = result.sceneMode === 'ground'
    ? [
      `拍摄区域：宽 ${result.widthMeters} m × 纵深 ${result.depthMeters} m；人物最高 ${result.subjectHeightMeters} m`,
      `摄像机距区域前沿：${result.cameraSetbackMeters} m`,
      `摄像机距区域中心：${result.distanceToCenterMeters} m`,
    ]
    : [
      `目标平面：宽 ${result.widthMeters} m × 高 ${result.heightMeters} m；底边离地 ${result.bottomHeightMeters} m`,
      `摄像机距目标平面：${result.distanceMeters} m`,
      result.horizontalOnly
        ? `${result.framingVersion === 2 ? '镜头法向截面水平宽度' : '理论水平画面宽度'}：${result.frameWidthMeters} m；垂直范围未校核`
        : `${result.framingVersion === 2 ? '镜头法向取景截面' : '理论画面范围'}：宽 ${result.frameWidthMeters} m × 高 ${result.frameHeightMeters} m`,
    ]
  return [
    `摄像机安装反算｜${result.sceneLabel}`,
    `结果性质：${result.horizontalOnly ? '仅水平覆盖预估，非完整安装距离' : '当前模型双轴校核通过的理论最小距离'}`,
    `摄像机：${result.displayModel}｜${result.displayView}｜${result.endpointLabel}`,
    `镜头端点说明：${result.endpointExplanation}`,
    ...sceneRows,
    `${result.heightDisplayLabel}：${result.cameraHeightMeters} m（${result.heightBasis}）`,
    `安装结构：${result.mountLabel}`,
    `取景方式：${result.mountGuidanceText}`,
    `构图余量：${result.marginPercent}%`,
    `镜头视场角：水平 ${result.horizontalFov}°｜垂直 ${result.horizontalOnly ? '说明书未提供' : `${result.verticalFov}°`}`,
    `目标最低所需视场角：水平 ${result.requiredHorizontalFov}°${result.horizontalOnly ? '｜垂直未校核' : `｜垂直 ${result.requiredVerticalFov}°`}`,
    `距离判定：${result.distanceConstraintText}`,
    '计算过程：',
    ...result.calculationRows.map((row, index) => `${index + 1}. ${row.title}：${row.formula}；代入 ${row.substitution}；结果 ${row.value}`),
    `计算结论：${result.calculationConclusion}`,
    `资料来源：${result.sourceText}`,
    `注：${result.horizontalOnly ? '当前仅校核水平覆盖；' : result.framingVersion === 2 ? '使用理想镜头的相机坐标包络；' : '独立水平/垂直视场角二维校核；'}未计遮挡和镜头畸变，最终安装应通过样机画面复核。`,
  ].join('\n')
}

function decorateCameraResult(result, camera, prefs) {
  const view = camera.views[prefs.viewIndex]
  const mountType = getCameraMountType(camera, prefs.viewIndex)
  result.displayModel = camera.model
  result.displayView = view.label
  result.sourceText = `${camera.source}｜参数页 ${camera.sourcePages}`
  result.sourceNote = [camera.note, result.horizontalOnly
    ? '本结果仅使用说明书水平视场角，不推算垂直角，不能作为完整安装距离。' : ''].filter(Boolean).join(' ')
  result.endpointLabel = result.endpointLabel
  result.mountType = mountType
  result.mountLabel = getCameraMountLabel(camera, prefs.viewIndex)
  if (!result.mountLabel) return false
  result.requiresInitialAim = mountType !== 'ptz'
  result.heightSummary = `${result.horizontalOnly ? '参考' : '建议'}镜头中心高 ${result.cameraHeightMeters} m`
  result.distanceMeaning = result.horizontalOnly ? '水平拍全目标宽度所需最低距离（非完整安装距离）' : '当前模型下理论最小距离'
  const isWide = Number(view.hTele) > 0
  Object.assign(result, {
    heightMode: prefs.heightMode,
    heightDisplayLabel: prefs.heightMode === 'fixed'
      ? (result.horizontalOnly ? '已有镜头中心高度 · 仅水平参考' : '已有镜头中心高度')
      : (result.horizontalOnly ? '建议镜头中心高度 · 仅水平参考' : '建议镜头中心高度'),
    heightBasisDisplay: prefs.heightMode === 'fixed' ? '沿用已填写高度'
      : prefs.sceneMode === 'ground' ? '最高点 + 0.5 m，且不低于 1.5 m' : '与目标中心等高',
    distanceStartLabel: '镜头中心',
    distanceEndLabel: prefs.sceneMode === 'ground' ? '拍摄区前沿' : '目标平面',
    distanceReferenceText: prefs.sceneMode === 'ground' ? '镜头中心至拍摄区实际前沿（水平）' : '镜头中心至目标平面（水平）',
    resultNatureText: result.horizontalOnly
      ? '仅为水平方向参考距离；垂直覆盖尚未校核。'
      : result.framingVersion === 2
        ? '按理想镜头模型在相机坐标下校核目标各角点及取景余量的理论最小距离；未计遮挡和镜头畸变。'
        : '按独立水平与垂直视场角模型估算的理论最小距离；该二维校核不等于真实三维视锥逐方向验证，且未计遮挡。',
    opticsIntegrityText: result.horizontalOnly
      ? `厂家水平角 ${formatCameraNumber(result.horizontalFov)}°；垂直角未提供`
      : `厂家水平角 ${formatCameraNumber(result.horizontalFov)}° / 垂直角 ${formatCameraNumber(result.verticalFov)}°；参数完整`,
    isWideEndpoint: isWide,
    ...(prefs.sceneMode === 'ground' ? {} : {
      targetTopHeightDisplay: formatCameraNumber(Number(result.bottomHeightMeters) + Number(result.heightMeters)),
    }),
  })
  if (mountType === 'ptz') {
    result.requiresInitialAim = false
    result.aimValue = '现场可调'
    result.aimLabel = '机械云台水平与俯仰'
    result.mountGuidanceText = '机械云台可在现场调整水平与俯仰；示意角度不作为固定安装要求。'
  } else if (mountType === 'unspecified') {
    result.requiresInitialAim = false
    result.aimValue = '待现场确认'
    result.aimLabel = '安装方式待确认'
    result.mountGuidanceText = '安装结构待现场确认；暂不判断是否可转向或需要固定初始角度。'
  } else {
    result.requiresInitialAim = true
    result.aimValue = result.aimText
    result.aimLabel = '固定安装初始俯仰角参考'
    result.mountGuidanceText = mountType === 'eptz'
      ? `电子云台为固定安装，初始俯仰参考 ${result.aimText}；安装时需现场调整本体朝向并用实际画面复核，电子裁切不能替代物理转向。`
      : `固定式/枪机初始俯仰参考 ${result.aimText}；安装时需现场调整本体朝向并用实际画面复核。`
  }
  result.endpointExplanation = result.horizontalOnly
    ? '说明书缺少垂直视场角；当前只能确认水平方向能否拍全，无法确认目标上下边界是否入画。'
    : isWide
      ? '安装点位统一按广角端计算，确保能够拍全目标区域；长焦端参数仅在产品资料库中保留，用于查阅特写能力。'
      : '该结果按资料库中的当前固定或广角端视场角计算。'
  const process = buildCameraCalculationProcess(result)
  result.calculationRows = process.rows
  result.calculationConclusion = process.conclusion
  result.calculationVisual = process.visual
  return true
}

function buildCameraTask(record, measureContext) {
  if (!hasNativeMeasureContext(measureContext)) return fail('当前环境无法测量摄像机结果文字，未生成可能裁切的图片。')
  const required = [
    'cameraCalculationVersion', 'sourceMode', 'cameraModel', 'viewIndex', 'viewLabel',
    'sceneMode', 'heightMode', 'marginPercent', 'groundWidthText', 'groundDepthText',
    'subjectHeightText', 'planeWidthText', 'planeHeightText', 'planeBottomHeightText',
    'fixedCameraHeightText',
  ]
  const issue = validPreferences(record, required)
  if (issue) return fail(issue)
  const prefs = record.preferences
  if (![1, 2].includes(prefs.cameraCalculationVersion)) return fail(`历史摄像机计算版本“${prefs.cameraCalculationVersion}”无法识别，未替换为其他版本。`)
  if (prefs.sourceMode !== 'library') return fail('此历史记录使用手动/自定义摄像机参数；报告不以资料库型号替代。')
  if (!['ground', 'plane'].includes(prefs.sceneMode) || !['auto', 'fixed'].includes(prefs.heightMode)
    || ![0, 5, 10, 15, 20].includes(Number(prefs.marginPercent))) return fail('历史摄像机场景、高度方式或构图余量无法识别。')
  const catalog = cameras.find((item) => item.model === prefs.cameraModel)
  if (!catalog) return fail(`历史摄像机型号“${prefs.cameraModel || '未保存'}”无法识别，未使用默认型号替代。`)
  const camera = {
    ...catalog,
    views: getHorizontalCameraViews(catalog).map((view, index) => ({
      ...view,
      mountLabel: getCameraMountLabel(catalog, index),
    })),
  }
  if (!Number.isInteger(prefs.viewIndex) || prefs.viewIndex < 0 || prefs.viewIndex >= camera.views.length) {
    return fail('历史摄像机视角序号无法识别。')
  }
  const view = camera.views[prefs.viewIndex]
  if (view.label !== prefs.viewLabel) return fail('历史摄像机视角标签与产品资料不一致，未使用其他视角替代。')
  const fov = resolveLibraryOptics(camera, prefs.viewIndex, 'wide')
  if (!fov) return fail('历史摄像机视角缺少可重建的厂家视场角数据。')
  const version = prefs.cameraCalculationVersion
  const baseOptions = {
    calculationVersion: version,
    heightMode: prefs.heightMode,
    cameraHeightMeters: number(prefs.fixedCameraHeightText),
    marginRatio: Number(prefs.marginPercent) / 100,
  }
  const groundOptions = {
    ...baseOptions,
    widthMeters: number(prefs.groundWidthText),
    depthMeters: number(prefs.groundDepthText),
    subjectHeightMeters: number(prefs.subjectHeightText),
  }
  const planeOptions = {
    ...baseOptions,
    widthMeters: number(prefs.planeWidthText),
    heightMeters: number(prefs.planeHeightText),
    bottomHeightMeters: number(prefs.planeBottomHeightText),
  }
  const options = prefs.sceneMode === 'ground' ? groundOptions : planeOptions
  const result = fov.horizontalOnly
    ? calculateHorizontalOnlyPlacement(fov, { ...options, sceneMode: prefs.sceneMode })
    : prefs.sceneMode === 'ground'
      ? calculateGroundAreaPlacement(fov, options)
      : calculateVerticalPlanePlacement(fov, options)
  if (!result) return fail('保存的摄像机参数无法按历史版本重建。')
  if (!decorateCameraResult(result, camera, prefs)) return fail('历史摄像机安装结构无法识别。')
  const expected = buildCameraResultText(result)
  if (expected !== record.resultText) return fail('摄像机历史结果与保存的计算结果不一致，未生成替代图。')
  const payload = cameraReport.buildCameraReportPayload(result)
  if (!payload) return fail('摄像机结果图缺少完整的冻结结果数据。')
  const layout = cameraReport.buildCameraReportLayout(measureContext, payload)
  const height = Number(layout?.height)
  if (!Number.isFinite(height) || height < 1) return fail('摄像机原生结果图无法计算完整分页高度。')
  return { ok: true, tasks: [makeTask('camera', '摄像机安装建议原生结果图', (context) => {
    cameraReport.drawCameraReport(context, payload, layout)
    return { width: REPORT_WIDTH, height: layout.height }
  }, { height })] }
}

function buildDmxAddressTask(record, measureContext) {
  const issue = validPreferences(record, ['startAddressText', 'allocationMode', 'groups'])
  if (issue) return fail(issue)
  const prefs = record.preferences
  if (!['auto', 'manual'].includes(prefs.allocationMode) || !Array.isArray(prefs.groups) || !prefs.groups.length) {
    return fail('历史 DMX 编址方式或灯具组列表无法识别。')
  }
  const groups = prefs.groups.map((group) => ({
    ...group,
    fixtureModel: group.fixtureSource === 'custom' ? '' : String(group.fixtureModel || ''),
  }))
  const result = calculateDmxAddressPlan({ startAddress: prefs.startAddressText, groups, allocationMode: prefs.allocationMode })
  if (!result || result.error) return fail(result?.error || '保存的 DMX 地址无法重建。')
  if (prefs.allocationMode === 'manual' && groups.some((group, index) => (
    String(group.targetUniverse || '').trim().toUpperCase() !== result.groups[index]?.targetUniverse
  ))) return fail('历史手动编址中的 DMX 域无法识别，未替换为默认域。')
  const groupDomain = (group) => result.allocationMode === 'manual' ? ` · ${group.targetUniverse}域` : ''
  const groupLines = result.groups.flatMap((group) => [
    '', `${group.groupIndex + 1}. ${group.name} · ${group.fixtureCount} 台 · ${group.channelCount} CH/台${groupDomain(group)}`,
    ...group.fixtures.map((fixture) => `   #${fixture.fixtureIndex}  ${fixture.addressText}  占用 ${fixture.rangeText}`),
  ])
  const expected = [
    '灯具地址码计算', `编址方式：${result.modeText}`, `起始位置：${result.startText}`,
    `规模：${result.totalGroups} 组 · ${result.totalFixtures} 台 · ${result.totalChannels} 个通道`,
    `已用范围：${result.startText} → ${result.endText}`, `下一可用：${result.nextText}`,
    ...groupLines, '', result.ruleText, ...result.warnings.map((warning) => `提醒：${warning}`),
    '现场复核：灯具通道模式必须与本次填写一致；换模式后应重新编址，并在控台 Patch、节点域号和灯具地址菜单中逐台核对。',
  ].join('\n')
  if (expected !== record.resultText) return fail('DMX 地址历史结果与保存的计算结果不一致，未生成替代图。')
  return buildGenericTasks(record, measureContext)
}

function adaptLegacyLightingContext(context) {
  return {
    setFillStyle: (value) => context.setFillStyle(value),
    setStrokeStyle: (value) => context.setStrokeStyle(value),
    setLineWidth: (value) => context.setLineWidth(value),
    setFontSize: (value) => context.setFontSize(value),
    setTextAlign: (value) => context.setTextAlign(value),
    setLineDash: (value, offset) => context.setLineDash?.(value, offset),
    measureText: (value) => context.measureText(value),
    beginPath: (...args) => context.beginPath(...args), closePath: (...args) => context.closePath(...args),
    moveTo: (...args) => context.moveTo(...args), lineTo: (...args) => context.lineTo(...args),
    arc: (...args) => context.arc(...args), rect: (...args) => context.rect(...args),
    quadraticCurveTo: (...args) => context.quadraticCurveTo(...args), clip: (...args) => context.clip?.(...args),
    save: (...args) => context.save?.(...args), restore: (...args) => context.restore?.(...args),
    fill: (...args) => context.fill(...args), stroke: (...args) => context.stroke(...args),
    fillRect: (...args) => context.fillRect(...args), strokeRect: (...args) => context.strokeRect(...args),
    fillText: (...args) => context.fillText(...args),
  }
}

function hasRenderableLightingLayout(layout) {
  if (!layout || typeof layout !== 'object' || Array.isArray(layout)) return false
  const width = number(layout.stageWidthText)
  const depth = number(layout.stageDepthText)
  if (!Number.isFinite(width) || width <= 0 || width > 200
    || !Number.isFinite(depth) || depth <= 0 || depth > 200
    || !APRON_DIRECTIONS.includes(layout.apronDirection)
    || !Array.isArray(layout.internalRods) || !Array.isArray(layout.frontRods)) return false
  if (hasOwn(layout, 'legacySideRods') && !Array.isArray(layout.legacySideRods)) return false
  const internalMaximum = layout.apronDirection === 'left' || layout.apronDirection === 'right' ? width : depth
  const rodIds = new Set()
  const validRodList = (rods, maximum, requireLegacyRange = false) => rods.length <= 16 && rods.every((rod) => {
    if (!rod || typeof rod !== 'object' || Array.isArray(rod)
      || typeof rod.id !== 'string' || !rod.id.trim() || rodIds.has(rod.id)
      || !Number.isFinite(rod.distance) || rod.distance <= 0 || rod.distance > maximum) return false
    if (requireLegacyRange && (!Number.isFinite(rod.startT) || !Number.isFinite(rod.endT)
      || rod.startT < 0 || rod.endT > 1 || rod.startT >= rod.endT)) return false
    rodIds.add(rod.id)
    return true
  })
  return validRodList(layout.internalRods, internalMaximum)
    && validRodList(layout.frontRods, 200)
    && (!hasOwn(layout, 'legacySideRods') || validRodList(layout.legacySideRods, 200, true))
}

function buildLightingTask(item, projectName) {
  const lighting = item.lighting
  if (!lighting?.scheme?.layout || !Array.isArray(lighting.fixtures)
    || !Array.isArray(lighting.scheme?.preferences?.groups)
    || !Array.isArray(lighting.scheme?.groupIds)
    || !lighting.scheme?.fixtureIdsByGroup || typeof lighting.scheme.fixtureIdsByGroup !== 'object') {
    return fail('保存的灯位方案缺少布局、灯具组或地址快照。')
  }
  const groupById = new Map(lighting.scheme.preferences.groups.map((group, index) => [
    lighting.scheme.groupIds[index], group,
  ]))
  const layout = lighting.scheme.layout
  if (!hasRenderableLightingLayout(layout)) {
    return fail('保存的灯位舞台尺寸、朝向或灯杆结构不完整，无法按历史布局生成图片。')
  }
  const positionsById = layout.positionsById
  if (!positionsById || typeof positionsById !== 'object' || Array.isArray(positionsById)) {
    return fail('保存的灯位方案缺少位置快照，未使用默认位置替代。')
  }
  const geometry = createStageGeometry(layout, 1048, 990)
  const rodsById = new Map((geometry.rods || []).map((rod) => [String(rod.id), rod]))
  let placedFixtures = []
  const unplacedFixtures = []
  let inconsistentPositionSnapshot = false
  let invalidPosition = false
  const fixtures = lighting.fixtures.map((fixture) => {
    if (!fixture || typeof fixture !== 'object') return null
    const group = groupById.get(fixture.groupId)
    if (!group || !fixture.stableId || !fixture.addressText || !fixture.rangeText
      || !Number.isInteger(fixture.fixtureIndex) || !Number.isInteger(fixture.channelCount)) return null
    const hasLayoutPosition = hasOwn(positionsById, fixture.stableId)
    const layoutPosition = hasLayoutPosition ? positionsById[fixture.stableId] : undefined
    const savedPosition = fixture.position
    if (JSON.stringify(layoutPosition ?? null) !== JSON.stringify(savedPosition ?? null)) {
      inconsistentPositionSnapshot = true
      return null
    }
    if (savedPosition === null || savedPosition === undefined) {
      unplacedFixtures.push(fixture.stableId)
      return {
        ...fixture,
        id: fixture.stableId,
        groupName: group.name || '',
        fixtureModel: group.fixtureModel || '',
        modeName: `${fixture.channelCount} CH`,
      }
    }
    if (!savedPosition || typeof savedPosition !== 'object' || Array.isArray(savedPosition)
      || typeof savedPosition.rodId !== 'string' || !savedPosition.rodId.trim()
      || !Number.isFinite(savedPosition.t) || savedPosition.t < 0 || savedPosition.t > 1
      || !rodsById.has(String(savedPosition.rodId))) {
      invalidPosition = true
      return null
    }
    return {
      ...fixture,
      id: fixture.stableId,
      groupName: group.name || '',
      fixtureModel: group.fixtureModel || '',
      modeName: `${fixture.channelCount} CH`,
    }
  })
  if (inconsistentPositionSnapshot) return fail('灯位位置快照彼此不一致，未使用默认位置替代。')
  if (invalidPosition) return fail('灯位历史位置无法还原（缺少有效杆位或位置参数），未使用默认位置替代。')
  if (fixtures.some((fixture) => !fixture)) return fail('灯位地址、组编号或布局无法一一对应。')
  placedFixtures = fixtures.filter((fixture) => fixture.position !== null && fixture.position !== undefined)
  const fixtureChunks = []
  const perPage = 40
  if (!placedFixtures.length) fixtureChunks.push([])
  for (let index = 0; index < placedFixtures.length; index += perPage) fixtureChunks.push(placedFixtures.slice(index, index + perPage))
  const tasks = []
  fixtureChunks.forEach((fixtureChunk, index) => {
    const label = fixtureChunks.length > 1 ? ` · ${index + 1}/${fixtureChunks.length}` : ''
    const chunkPositions = Object.fromEntries(fixtureChunk.map((fixture) => [fixture.id, fixture.position]))
    const snapshot = {
      layout: { ...layout, positionsById: chunkPositions },
      fixtures: fixtureChunk,
      contextLabel: `${projectName || '项目'} · 已布置 ${placedFixtures.length}/${fixtures.length} 台${!placedFixtures.length ? ' · 当前无已布置灯具' : ''}${label}`,
    }
    let pages
    try {
      pages = buildLightingExportPages(snapshot, { width: 1120, height: 1160, maxDimension: 4096 })
    } catch (_) {
      return
    }
    if (!Array.isArray(pages) || pages.length !== 1
      || pages.some((page) => page.width > 4096 || page.height > 4096)) return
    const page = pages[0]
    const taskTitle = `灯位原生图 · 已布置 ${placedFixtures.length}/${fixtures.length} 台${unplacedFixtures.length ? ` · 未布置 ${unplacedFixtures.length} 台` : ''}${label}`
    tasks.push({ ...makeTask('lighting', taskTitle, (context) => {
      renderLightingExportPage(adaptLegacyLightingContext(context), snapshot, page)
      return { width: page.width, height: page.height }
    }, { width: page.width, height: page.height }), coveredFixtureIds: fixtureChunk.map((fixture) => fixture.id) })
  })
  if (tasks.length !== fixtureChunks.length) return fail('灯位图超出安全画布尺寸或无法分页渲染，未生成不完整图片。')
  return { ok: true, tasks, coveredFixtureIds: placedFixtures.map((fixture) => fixture.id), unplacedFixtureIds: unplacedFixtures }
}

function buildReportImageTasks(item, projectName = '', measureContext = null) {
  if (!item) return fail('缺少报告快照。')
  if (item.type === 'lighting') return buildLightingTask(item, projectName)
  if (item.type === 'wiring') {
    if (!item.line || typeof item.line !== 'object' || !item.line.id) return fail('项目线路缺少完整冻结快照。')
    return { ok: true, bridge: 'projectWiring' }
  }
  if (item.type !== 'calculation' || !item.record) return fail('该内容项不是完整的报告快照。')
  const module = item.record.module
  if (module === 'spl') return buildSplTask(item.record, measureContext)
  if (module === 'cable') return buildCableTask(item.record, measureContext)
  if (module === 'ledScreen') return buildLedTask(item.record, measureContext)
  if (module === 'dmxAddress') return buildDmxAddressTask(item.record, measureContext)
  if (['limiter', 'gainStructure'].includes(module)) return buildGenericTasks(item.record, measureContext)
  if (module === 'camera') return buildCameraTask(item.record, measureContext)
  if (module === 'audioWiring') {
    const prefs = item.record.preferences
    if (!prefs || prefs.version !== 1 || typeof prefs.outputId !== 'string' || typeof prefs.inputId !== 'string'
      || !prefs.manualSelected || typeof prefs.manualSelected.output !== 'boolean'
      || typeof prefs.manualSelected.input !== 'boolean' || !prefs.selections || typeof prefs.selections !== 'object') {
      return fail('接线历史选项快照不完整或版本无法识别。')
    }
    return { ok: true, bridge: 'audioWiring' }
  }
  return fail(`模块“${module || '未知'}”没有匹配的原生报告图片渲染器。`)
}

module.exports = {
  GENERIC_PAGE_LINES,
  MAX_RESULT_LINES,
  REPORT_MAX_CANVAS_HEIGHT,
  REPORT_SEGMENT_HEIGHT,
  REPORT_WIDTH,
  buildGenericTasks,
  buildLightingTask,
  buildReportImageTasks,
  splitTaskIntoSegments,
  splitResultReportRecord,
}
