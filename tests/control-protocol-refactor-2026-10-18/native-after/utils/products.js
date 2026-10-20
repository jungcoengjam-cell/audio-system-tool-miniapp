const { PRODUCT_DATA_DATE } = require('../data/app-meta')

const ALL_CATEGORY = '全部'
const RECENT_STORAGE_KEY = 'audioTool.products.recent.v1'
const RECENT_LIMIT = 12
const SOURCE_ITEMS = {}
const SOURCE_INDEXES = {}
const PRODUCT_CACHE = {
  amplifier: new Map(),
  speaker: new Map(),
  camera: new Map(),
  lighting: new Map(),
}
const PRODUCT_LIST_CACHE = {}
const PRODUCT_LIST_INDEX_CACHE = {}
const CATEGORY_CACHE = {}
const PRODUCT_FILTERS = {
  amplifier: [
    { key: 'all', label: '全部能力' },
    { key: 'limiter', label: '可用于限幅器' },
  ],
  speaker: [
    { key: 'all', label: '全部能力' },
    { key: 'limiter', label: '可用于限幅器' },
    { key: 'spl', label: '可用于声压估算' },
    { key: 'maximumSpl', label: '有最大声压级' },
    { key: 'coverage', label: '有覆盖角' },
  ],
  camera: [
    { key: 'all', label: '全部能力' },
    { key: 'cameraFov', label: '可用于视场角计算' },
  ],
  lighting: [
    { key: 'all', label: '全部能力' },
    { key: 'dmxAddress', label: '可用于 DMX 编址' },
  ],
}

let speakerSpecifications = null
let cameraFovApi = null

function getSourceItems(type) {
  if (SOURCE_ITEMS[type]) return SOURCE_ITEMS[type]
  if (type === 'amplifier' || type === 'speaker') {
    const { amplifiers, speakers } = require('../data/equipment')
    SOURCE_ITEMS.amplifier = amplifiers
    SOURCE_ITEMS.speaker = speakers
  } else if (type === 'camera') {
    SOURCE_ITEMS.camera = require('../data/cameras').cameras
  } else if (type === 'lighting') {
    SOURCE_ITEMS.lighting = require('../data/stage-lighting').stageLightingProducts
  }
  return SOURCE_ITEMS[type] || []
}

function getSourceIndex(type) {
  if (!SOURCE_INDEXES[type]) {
    SOURCE_INDEXES[type] = new Map(getSourceItems(type).map((item) => [item.model, item]))
  }
  return SOURCE_INDEXES[type]
}

function getSpeakerSpecifications() {
  if (!speakerSpecifications) speakerSpecifications = require('../data/speaker-specifications').speakerSpecifications
  return speakerSpecifications
}

function getCameraFovApi() {
  if (!cameraFovApi) cameraFovApi = require('./camera-fov')
  return cameraFovApi
}

function getCategory(model) {
  const prefix = model.replace(/\d.*$/, '').replace(/-$/, '')
  return `${prefix || '其他'}系列`
}

function getProduct(type, model) {
  if (!PRODUCT_CACHE[type]) return null
  if (PRODUCT_CACHE[type].has(model)) return PRODUCT_CACHE[type].get(model)

  const item = getSourceIndex(type).get(model)
  if (!item) return null

  const specification = type === 'speaker' ? getSpeakerSpecifications()[item.model] || null : null
  const product = {
    ...item,
    ...(specification || {}),
    type,
    typeLabel: {
      amplifier: '功放',
      speaker: '音箱',
      camera: '摄像机',
      lighting: '舞台灯光',
    }[type],
    category: ['camera', 'lighting'].includes(type) ? item.category : getCategory(item.model),
    specification,
  }
  PRODUCT_CACHE[type].set(model, product)
  return product
}

function getProductList(type) {
  if (PRODUCT_LIST_CACHE[type]) return PRODUCT_LIST_CACHE[type]

  const products = getSourceItems(type).map((item) => {
    const product = getProduct(type, item.model)
    if (type === 'lighting') {
      const dmxAddressable = product.categoryKey === 'fixture' && product.channelModes.length > 0
      return {
        type,
        model: product.model,
        category: product.category,
        meta: `${product.name}${product.ratedPowerW ? ` · ${product.ratedPowerW} W` : ''}`,
        statusLabel: product.categoryKey !== 'fixture'
          ? '设备资料已录入'
          : dmxAddressable ? `${product.channelModes.length} 种 DMX 通道模式` : '非 DMX 控制',
        statusKey: product.categoryKey !== 'fixture' || dmxAddressable ? 'ready' : 'partial',
        capabilities: { dmxAddress: dmxAddressable },
        abilityLabels: dmxAddressable ? ['DMX 自动编址'] : ['资料参考'],
        verifiedType: product.name,
      }
    }
    if (type === 'camera') {
      const {
        getCalculableCameraViews,
        getCameraMountLabel,
        getHorizontalCameraViews,
      } = getCameraFovApi()
      const calculableViewCount = getCalculableCameraViews(product).length
      const horizontalViewCount = getHorizontalCameraViews(product).length
      const viewCount = product.views.length
      const mountLabel = getCameraMountLabel(product)
      return {
        type,
        model: product.model,
        category: product.category,
        meta: `${product.megapixels ? `${product.megapixels} MP · ` : ''}${product.sensor} · ${mountLabel}`,
        statusLabel: !horizontalViewCount
          ? '缺少水平视场角'
          : !calculableViewCount
            ? '仅支持水平覆盖预估'
          : calculableViewCount < viewCount ? `${calculableViewCount}/${viewCount} 组镜头可计算` : '厂家双轴视场角完整',
        statusKey: calculableViewCount === viewCount ? 'ready' : 'partial',
        capabilities: { cameraFov: horizontalViewCount > 0 },
        abilityLabels: calculableViewCount ? ['安装计算'] : ['水平覆盖预估'],
        verifiedType: mountLabel,
      }
    }
    const isAmplifier = type === 'amplifier'
    const hasSensitivity = Number.isFinite(product.sensitivityDb)
    const isSplitBand = Boolean(product.bands)
    const hasMaximumSpl = Number.isFinite(product.maximumSplDb)
    const hasCoverage = Number.isFinite(product.horizontalCoverageDeg)
      && Boolean(product.verticalCoverageDeg || product.verticalCoverage)
    const capabilities = {
      limiter: isAmplifier || (!product.calculationDisabled && Number.isFinite(product.ratedPower)),
      spl: !isAmplifier && !product.calculationDisabled && hasSensitivity,
      maximumSpl: !isAmplifier && hasMaximumSpl,
      coverage: !isAmplifier && hasCoverage,
    }

    return {
      type,
      model: product.model,
      category: product.category,
      meta: isAmplifier
        ? `立体声 ${Object.keys(product.stereoPower || {}).join('/')} Ω`
        : `${product.ratedPower} W · ${product.impedance} Ω`,
      statusLabel: isSplitBand ? '分通道参数已录入' : isAmplifier || hasSensitivity ? '基础参数可用' : '灵敏度待补充',
      statusKey: isAmplifier || hasSensitivity || isSplitBand ? 'ready' : 'partial',
      capabilities,
      abilityLabels: [
        ...(capabilities.limiter ? ['限幅器'] : []),
        ...(capabilities.spl ? ['声压估算'] : []),
        ...(capabilities.coverage ? ['覆盖角'] : []),
      ],
      verifiedType: '',
    }
  })
  PRODUCT_LIST_CACHE[type] = products
  PRODUCT_LIST_INDEX_CACHE[type] = new Map(products.map((item) => [item.model, item]))
  return products
}

function getCategories(type) {
  if (!CATEGORY_CACHE[type]) {
    CATEGORY_CACHE[type] = [ALL_CATEGORY, ...new Set(getProductList(type).map((item) => item.category))]
  }
  return CATEGORY_CACHE[type]
}

function getProductFilters(type) {
  return PRODUCT_FILTERS[type] || PRODUCT_FILTERS.amplifier
}

function filterProducts(type, keyword = '', category = ALL_CATEGORY, capability = 'all') {
  const normalizedKeyword = keyword.trim().toLowerCase()
  return getProductList(type).filter((item) => (
    (category === ALL_CATEGORY || item.category === category)
    && (capability === 'all' || item.capabilities[capability])
    && (!normalizedKeyword
      || item.model.toLowerCase().includes(normalizedKeyword)
      || item.category.toLowerCase().includes(normalizedKeyword)
      || item.meta.toLowerCase().includes(normalizedKeyword))
  ))
}

function formatPowerMap(powerMap = {}) {
  const rows = buildPowerRows(powerMap)
  return rows.length ? rows.map((item) => `${item.impedance}Ω ${item.power}W`).join(' / ') : '未提供'
}

function formatProductValue(value, unit = '') {
  return value === undefined || value === null || value === '' ? '未提供' : `${value}${unit}`
}

function formatRange(wide, tele, unit) {
  if (!Number.isFinite(wide)) return '未提供'
  return Number.isFinite(tele) ? `${wide}–${tele}${unit}` : `${wide}${unit}`
}

function formatFocalRange(view) {
  return formatRange(view.focalWideMm, view.focalTeleMm, ' mm')
}

function formatAxisRange(view, axis) {
  return formatRange(view[`${axis}Wide`], view[`${axis}Tele`], '°')
}

function buildProductComparison(type, models) {
  const products = [...new Set(models || [])].map((model) => getProduct(type, model)).filter(Boolean)
  if (products.length < 2 || products.length > 3) return null

  let definitions
  if (type === 'amplifier') {
    definitions = [
      ['立体声输出', (item) => formatPowerMap(item.stereoPower)],
      ['桥接输出', (item) => formatPowerMap(item.bridgePower)],
      ['系列', (item) => item.category],
    ]
  } else if (type === 'camera') {
    const { getCameraMountLabel } = getCameraFovApi()
    definitions = [
      ['安装结构', (item) => getCameraMountLabel(item)],
      ['传感器', (item) => formatProductValue(item.sensor)],
      ['有效像素', (item) => formatProductValue(item.megapixels, ' MP')],
      ['镜头组数', (item) => `${item.views.length} 组`],
      ['光学变焦', (item) => item.views.map((view) => `${view.label} ${view.opticalZoom || 1}×`).join(' / ')],
      ['焦距', (item) => item.views.map((view) => `${view.label} ${formatFocalRange(view)}`).join(' / ')],
      ['水平视场角', (item) => item.views.map((view) => `${view.label} ${formatAxisRange(view, 'h')}`).join(' / ')],
      ['垂直视场角', (item) => item.views.map((view) => `${view.label} ${formatAxisRange(view, 'v')}`).join(' / ')],
    ]
  } else if (type === 'lighting') {
    definitions = [
      ['设备名称', (item) => item.name],
      ['设备分类', (item) => item.category],
      ['DMX 通道模式', (item) => item.channelModes.length ? item.channelModes.map((mode) => `${mode} CH`).join(' / ') : '不支持或未提供'],
      ['额定功率', (item) => formatProductValue(item.ratedPowerW, ' W')],
      ['输入电压', (item) => formatProductValue(item.inputVoltage)],
      ['防护等级', (item) => formatProductValue(item.ipRating)],
    ]
  } else {
    definitions = [
        ['额定功率', (item) => formatProductValue(item.ratedPower, ' W')],
        ['峰值/最大功率', (item) => formatProductValue(
          Number.isFinite(item.peakPower) ? item.peakPower : item.maximumPower,
          ' W',
        )],
        ['标称阻抗', (item) => formatProductValue(item.impedance, ' Ω')],
        ['最低频率', (item) => formatProductValue(item.minimumFrequency, ' Hz')],
        ['灵敏度', (item) => formatProductValue(item.sensitivityDb, ' dB')],
        ['最大声压级', (item) => formatProductValue(item.maximumSplDb, ' dB SPL')],
        ['水平覆盖', (item) => formatProductValue(item.horizontalCoverageDeg, '°')],
        ['垂直覆盖', (item) => formatProductValue(item.verticalCoverageDeg || item.verticalCoverage, typeof item.verticalCoverageDeg === 'number' ? '°' : '')],
    ]
  }

  return {
    type,
    models: products.map((item) => item.model),
    rows: definitions.map(([label, getValue]) => {
      const texts = products.map(getValue)
      return {
        label,
        values: texts.map((text, index) => ({ model: products[index].model, text })),
        different: new Set(texts).size > 1,
      }
    }),
  }
}

function buildPowerRows(powerMap = {}) {
  return Object.keys(powerMap)
    .map(Number)
    .sort((left, right) => left - right)
    .map((impedance) => ({
      impedance,
      power: powerMap[impedance],
    }))
}

function buildAmplifierDetail(product) {
  const stereoRows = buildPowerRows(product.stereoPower)
  const bridgeRows = buildPowerRows(product.bridgePower)
  const missingParameters = []

  if (!stereoRows.length) missingParameters.push('立体声输出功率')
  if (!bridgeRows.length) missingParameters.push('桥接输出功率')

  return {
    ...product,
    statusLabel: missingParameters.length ? '核心参数待补充' : '基础参数完整',
    statusKey: missingParameters.length ? 'partial' : 'ready',
    summary: `已录入 ${stereoRows.length} 档立体声功率与 ${bridgeRows.length} 档桥接功率。`,
    stereoRows,
    bridgeRows,
    bandRows: [],
    missingParameters,
    modules: [
      { key: 'limiter', label: '限幅器参数计算', description: '可直接带入功放型号', actionable: true },
    ],
  }
}

function buildSpeakerDetail(product) {
  const isSplitBand = Boolean(product.bands && Object.keys(product.bands).length)
  const hasMaximumSpl = Number.isFinite(product.maximumSplDb)
  const horizontalCoverageDeg = product.horizontalCoverageDeg
  const verticalCoverage = Number.isFinite(product.verticalCoverageDeg)
    ? `${product.verticalCoverageDeg}°`
    : product.verticalCoverage
  const hasCoverage = Number.isFinite(horizontalCoverageDeg) && Boolean(verticalCoverage)
  const missingParameters = []

  if (!isSplitBand && !Number.isFinite(product.peakPower) && !Number.isFinite(product.maximumPower)) {
    missingParameters.push('峰值/最大功率')
  }
  if (!Number.isFinite(product.minimumFrequency)) missingParameters.push('最低工作频率')
  if (!isSplitBand && !Number.isFinite(product.sensitivityDb)) missingParameters.push('灵敏度')
  if (!hasMaximumSpl) missingParameters.push('最大声压级')
  if (!hasCoverage) missingParameters.push('覆盖角')

  const bandRows = Object.keys(product.bands || {}).map((key) => {
    const band = product.bands[key]
    return {
      key,
      ratedPowerText: Number.isFinite(band.ratedPower) ? `${band.ratedPower} W` : '未提供',
      peakPowerText: Number.isFinite(band.peakPower) ? `${band.peakPower} W` : '未提供',
      impedanceText: Number.isFinite(band.impedance) ? `${band.impedance} Ω` : '未提供',
      sensitivityText: Number.isFinite(band.sensitivityDb) ? `${band.sensitivityDb} dB` : '未提供',
      soundPressureText: Number.isFinite(band.maximumSplDb)
        ? `${Number.isFinite(band.ratedMaximumSplDb) ? `额定 ${band.ratedMaximumSplDb} / ` : ''}峰值 ${band.maximumSplDb} dB SPL`
        : Number.isFinite(band.ratedMaximumSplDb) ? `额定 ${band.ratedMaximumSplDb} dB SPL` : '',
    }
  })

  const modules = [
    {
      key: 'limiter',
      label: '限幅器参数计算',
      description: product.calculationDisabled ? '分通道型号，需分别选择对应频段参数' : '可直接带入音箱型号',
      actionable: !product.calculationDisabled,
    },
    {
      key: 'spl',
      label: '声压级与功率估算',
      description: product.calculationDisabled
        ? '分通道型号，暂不带入单功率估算'
        : Number.isFinite(product.sensitivityDb) ? '可直接带入音箱型号' : '缺少灵敏度，暂不可用',
      actionable: Number.isFinite(product.sensitivityDb) && !product.calculationDisabled,
    },
  ]

  return {
    ...product,
    statusLabel: isSplitBand ? '分通道参数已录入' : missingParameters.length ? '基础参数可用' : '资料完整',
    statusKey: missingParameters.length ? 'partial' : 'ready',
    summary: isSplitBand
      ? '分通道驱动型号 · 请按频段查看功率与阻抗'
      : `${product.ratedPower} W 额定功率 · ${product.impedance} Ω 标称阻抗`,
    powerLimitText: Number.isFinite(product.peakPower)
      ? `${product.peakPower} W`
      : Number.isFinite(product.maximumPower) ? `${product.maximumPower} W` : '待补充',
    powerLimitLabel: Number.isFinite(product.peakPower) ? '峰值功率' : Number.isFinite(product.maximumPower) ? '最大功率' : '峰值/最大功率',
    minimumFrequencyText: Number.isFinite(product.minimumFrequency) ? `${product.minimumFrequency} Hz` : '待补充',
    sensitivityText: Number.isFinite(product.sensitivityDb)
      ? `${product.sensitivityDb}${Number.isFinite(product.sensitivityToleranceDb) ? ` ±${product.sensitivityToleranceDb}` : ''} dB`
      : '待补充',
    hasCoverageData: hasMaximumSpl || hasCoverage,
    maximumSplText: Number.isFinite(product.maximumSplDb)
      ? `${product.maximumSplDb}${Number.isFinite(product.maximumSplToleranceDb) ? ` ±${product.maximumSplToleranceDb}` : ''} dB SPL`
      : '说明书未提供',
    maximumSplLabel: Number.isFinite(product.ratedMaximumSplDb)
      ? `峰值；额定 ${product.ratedMaximumSplDb} dB SPL`
      : '说明书最大声压级',
    coverageText: hasCoverage ? `${horizontalCoverageDeg}° × ${verticalCoverage}` : '说明书未提供',
    bandRows,
    missingParameters,
    modules,
  }
}

function buildCameraDetail(product) {
  const { getCameraMountLabel } = getCameraFovApi()
  const viewRows = product.views.map((view, viewIndex) => {
    const wideComplete = Number.isFinite(view.hWide) && Number.isFinite(view.vWide)
    const teleDeclared = Number.isFinite(view.hTele) || Number.isFinite(view.vTele)
    const teleComplete = Number.isFinite(view.hTele) && Number.isFinite(view.vTele)
    const missing = [
      ...(!Number.isFinite(view.hWide) ? ['水平视场角'] : []),
      ...(!Number.isFinite(view.vWide) ? ['垂直视场角'] : []),
      ...(teleDeclared && !Number.isFinite(view.hTele) ? ['长焦端水平视场角'] : []),
      ...(teleDeclared && !Number.isFinite(view.vTele) ? ['长焦端垂直视场角'] : []),
    ]
    return {
      ...view,
      focalText: formatFocalRange(view),
      zoomText: `${view.opticalZoom || 1}×`,
      horizontalText: formatAxisRange(view, 'h'),
      verticalText: formatAxisRange(view, 'v'),
      mountLabel: getCameraMountLabel(product, viewIndex),
      calculable: wideComplete && (!teleDeclared || teleComplete),
      horizontalCalculable: Number.isFinite(view.hWide),
      statusLabel: wideComplete
        ? (teleDeclared && !teleComplete ? '广角完整，长焦仅水平' : '可完整计算')
        : Number.isFinite(view.hWide) ? '仅水平预估' : '参数不完整',
      statusKey: wideComplete ? 'ready' : 'partial',
      missing,
      missingText: missing.join('、'),
    }
  })
  const calculableViewCount = viewRows.filter((view) => Number.isFinite(view.hWide) && Number.isFinite(view.vWide)).length
  const horizontalViewCount = viewRows.filter((view) => Number.isFinite(view.hWide)).length
  const missingParameters = viewRows.reduce((items, view) => (
    items.concat(view.missing.map((item) => `${view.label}：${item}`))
  ), [])

  return {
    ...product,
    statusLabel: !horizontalViewCount
      ? '缺少水平视场角'
      : !calculableViewCount
        ? '仅支持水平覆盖预估'
      : calculableViewCount < viewRows.length ? '部分镜头可计算' : '厂家双轴视场角完整',
    statusKey: calculableViewCount === viewRows.length ? 'ready' : 'partial',
    summary: `${product.sensor} · ${getCameraMountLabel(product)} · ${viewRows.length} 组镜头视角 · ${calculableViewCount} 组双轴完整`,
    megapixelsText: Number.isFinite(product.megapixels) ? `${product.megapixels} MP` : '说明书未明确',
    mountLabel: getCameraMountLabel(product),
    viewRows,
    bandRows: [],
    missingParameters,
    modules: [{
      key: 'camera',
      label: '摄像机安装计算',
      description: calculableViewCount
        ? '可带入说明书水平/垂直视场角'
        : '可带入说明书水平角，仅输出水平覆盖预估',
      actionable: horizontalViewCount > 0,
    }],
  }
}

function buildLightingDetail(product) {
  const isFixture = product.categoryKey === 'fixture'
  const dmxAddressable = isFixture && product.channelModes.length > 0
  const dmxChannelGuide = dmxAddressable ? {
    model: product.model,
    source: product.source || '',
    sourcePageText: Array.isArray(product.sourcePages) && product.sourcePages.length
      ? `PDF第${product.sourcePages.join('、')}页`
      : '',
    verificationStatus: product.verification === 'manual-document' ? '已核对产品资料' : '资料已录入',
    modeLabel: `${product.channelModes[0]} CH`,
    channelCount: product.channelModes[0],
    modes: product.channelModes.map((mode, index) => ({
      channelCount: mode,
      label: `${mode} CH`,
      selected: index === 0,
    })),
  } : null
  const specRows = [
    ['设备名称', product.name],
    ['设备分类', product.category],
    ['额定功率', Number.isFinite(product.ratedPowerW) ? `${product.ratedPowerW} W` : ''],
    ['输入电压', product.inputVoltage],
    ['光源', product.lightSource],
    ['光束/出光角', product.beamAngle],
    ['防护等级', product.ipRating],
    ['产品尺寸', product.dimensions],
    ['产品净重', Number.isFinite(product.netWeightKg) ? `${product.netWeightKg} kg` : ''],
    ['输出回路', Number.isFinite(product.outputChannels) ? `${product.outputChannels} 路` : ''],
    ['单回路容量', Number.isFinite(product.perChannelKw) ? `${product.perChannelKw} kW` : ''],
    ['DMX 控制通道', Number.isFinite(product.dmxChannels) ? `${product.dmxChannels} 个` : ''],
    ['可控灯具数量', Number.isFinite(product.fixtureCapacity) ? `${product.fixtureCapacity} 台` : ''],
  ]
    .filter(([, value]) => value)
    .map(([label, value]) => ({ label, value }))

  return {
    ...product,
    statusLabel: isFixture
      ? dmxAddressable ? 'DMX 通道模式已复核' : '非 DMX 控制'
      : '设备资料已录入',
    statusKey: isFixture && !dmxAddressable ? 'partial' : 'ready',
    summary: `${product.category} · ${product.name}`,
    specRows,
    modeRows: product.channelModes.map((mode) => ({ value: mode, label: `${mode} CH` })),
    dmxChannelGuide,
    bandRows: [],
    missingParameters: [],
    modules: dmxAddressable
      ? [{
        key: 'dmxAddress',
        label: 'DMX 灯具地址编址',
        description: '带入型号与说明书通道模式',
        actionable: true,
      }]
      : [{
        key: 'lightingReference',
        label: product.categoryKey === 'fixture' ? 'DMX 灯具地址编址' : '设备资料',
        description: product.categoryKey === 'fixture'
          ? '该产品不使用 DMX512 地址控制'
          : '当前作为产品资料查阅，不参与灯具地址计算',
        actionable: false,
      }],
  }
}

function getProductDetail(type, model) {
  const product = getProduct(type, model)
  if (!product) return null

  const detail = type === 'amplifier'
    ? buildAmplifierDetail(product)
    : type === 'camera'
      ? buildCameraDetail(product)
      : type === 'lighting' ? buildLightingDetail(product) : buildSpeakerDetail(product)

  return {
    ...detail,
    sourcePageText: Array.isArray(detail.sourcePages) && detail.sourcePages.length
      ? `规格页码：第 ${detail.sourcePages.join('、')} 页`
      : detail.sourcePages
      ? `规格页码：第 ${detail.sourcePages} 页`
      : detail.sourcePage
      ? detail.sourcePage.file === detail.source
        ? `规格页码：第 ${detail.sourcePage.page} 页`
        : `补充规格：${detail.sourcePage.file}（第 ${detail.sourcePage.page} 页）`
      : '',
    reviewDate: PRODUCT_DATA_DATE,
  }
}

function readRecentProductKeys() {
  if (typeof wx === 'undefined' || !wx.getStorageSync) return []
  try {
    const stored = wx.getStorageSync(RECENT_STORAGE_KEY)
    if (!Array.isArray(stored)) return []
    const validTypes = new Set(['amplifier', 'speaker', 'camera', 'lighting'])
    return stored.filter((item) => item
      && typeof item === 'object'
      && validTypes.has(item.type)
      && typeof item.model === 'string'
      && item.model.trim())
  } catch (error) {
    return []
  }
}

function markProductViewed(type, model) {
  if (!getProduct(type, model) || typeof wx === 'undefined' || !wx.setStorageSync) return
  const recent = readRecentProductKeys()
    .filter((item) => item.type !== type || item.model !== model)

  try {
    wx.setStorageSync(RECENT_STORAGE_KEY, [
      { type, model, viewedAt: Date.now() },
      ...recent,
    ].slice(0, RECENT_LIMIT))
  } catch (error) {
    // 最近查看属于辅助功能，存储失败不应影响产品详情使用。
  }
}

function getRecentProducts(type) {
  if (!PRODUCT_LIST_INDEX_CACHE[type]) getProductList(type)
  const products = PRODUCT_LIST_INDEX_CACHE[type] || new Map()
  return readRecentProductKeys()
    .filter((item) => item.type === type && products.has(item.model))
    .map((item) => ({ ...products.get(item.model), viewedAt: item.viewedAt }))
}

module.exports = {
  ALL_CATEGORY,
  PRODUCT_FILTERS,
  RECENT_STORAGE_KEY,
  buildProductComparison,
  filterProducts,
  getCategories,
  getCategory,
  getProduct,
  getProductDetail,
  getProductList,
  getProductFilters,
  getRecentProducts,
  markProductViewed,
}
