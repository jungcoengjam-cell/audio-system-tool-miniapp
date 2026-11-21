const ASSET_ROOT = '/pages/audio-wiring/assets'

// Contact anchors map to the visible solder lugs in the complete opened plug.
// They are illustration coordinates, not mechanical dimensions or tolerances.
const XLR_VARIANTS = {
  male: {
    key: 'xlr-male-rear', path: `${ASSET_ROOT}/solder/xlr-male-rear.png`, width: 290, height: 512,
    contentRect: { x: 0, y: 0, width: 290, height: 512 },
    pinPoints: { '1': { x: 0.623869, y: 0.241672 }, '2': { x: 0.224869, y: 0.225344 }, '3': { x: 0.415145, y: 0.336381 } },
    routeAngles: { '1': -45, '2': -135, '3': 180 },
    routingGeometry: { wiringWindow: { x: 31.436, y: 103.671, width: 224.063, height: 123.736 },
      bodyRect: { x: 19.731, y: 227.407, width: 254.161, height: 284.593 } },
  },
  female: {
    key: 'xlr-female-rear', path: `${ASSET_ROOT}/solder/xlr-female-rear.png`, width: 244, height: 512,
    contentRect: { x: 0, y: 0, width: 244, height: 512 },
    pinPoints: { '1': { x: 0.260037, y: 0.290922 }, '2': { x: 0.734217, y: 0.289596 }, '3': { x: 0.499213, y: 0.396289 } },
    routeAngles: { '1': -135, '2': -45, '3': 180 },
    routingGeometry: { wiringWindow: { x: 20.358, y: 116.379, width: 213.757, height: 115.361 },
      bodyRect: { x: 8.482, y: 231.74, width: 235.812, height: 280.26 } },
  },
}

const PHOTO_MANIFEST = {
  xlrBalanced: {
    getVariant(endpoint) {
      if (!endpoint || !['公头', '母头'].includes(endpoint.cableConnectorGender)) return null
      return endpoint.cableConnectorGender === '公头' ? XLR_VARIANTS.male : XLR_VARIANTS.female
    },
  },
  terminalBalanced: {
    getVariant() {
      return {
        key: 'terminal-block', path: `${ASSET_ROOT}/terminal.png`, width: 256, height: 256,
        kind: 'terminal', contentRect: { x: 0, y: 0, width: 256, height: 256 },
        pinPoints: { '+': { x: 0.2109375, y: 0.6015625 }, '−': { x: 0.41796875, y: 0.6796875 }, G: { x: 0.625, y: 0.75390625 } },
        labelPoints: { '+': { x: 0.2109375, y: 0.453125 }, '−': { x: 0.41796875, y: 0.53125 }, G: { x: 0.625, y: 0.60546875 } },
        routeAngles: { '+': 135, '−': 135, G: 135 },
        routingGeometry: { wiringWindow: { x: 18, y: 120, width: 185, height: 105 }, bodyRect: null },
      }
    },
  },
  stereo35: {
    getVariant() {
      return {
        key: 'stereo35-rear', path: `${ASSET_ROOT}/solder/stereo35-rear.png`, width: 141, height: 512,
        contentRect: { x: 0, y: 0, width: 141, height: 512 },
        pinPoints: { T: { x: 0.479369, y: 0.355775 }, R: { x: 0.210922, y: 0.279867 }, S: { x: 0.529702, y: 0.114191 } },
        routeAngles: { T: -45, R: 180, S: -90 },
        routingGeometry: { wiringWindow: { x: 12.842, y: 40.554, width: 125.043, height: 175.736 },
          bodyRect: { x: 12.842, y: 216.29, width: 125.043, height: 283.881 } },
      }
    },
  },
  trsBalanced: {
    getVariant() {
      return {
        key: 'trs635-rear', path: `${ASSET_ROOT}/solder/trs635-rear.png`, width: 119, height: 512,
        contentRect: { x: 0, y: 0, width: 119, height: 512 },
        pinPoints: { T: { x: 0.686538, y: 0.281271 }, R: { x: 0.317092, y: 0.315078 }, S: { x: 0.439269, y: 0.055443 } },
        routeAngles: { T: -45, R: -135, S: -90 },
        routingGeometry: { wiringWindow: { x: 5.193, y: 0, width: 114.239, height: 194.553 },
          bodyRect: { x: 5.193, y: 194.553, width: 114.239, height: 311.562 } },
      }
    },
  },
  stereo635: {
    getVariant() { return PHOTO_MANIFEST.trsBalanced.getVariant() },
  },
  tsMono: {
    getVariant() {
      return {
        key: 'ts-solder-open', path: `${ASSET_ROOT}/solder/ts-solder-open.png`, width: 141, height: 512,
        contentRect: { x: 0, y: 0, width: 141, height: 512 },
        pinPoints: { T: { x: 0.344582, y: 0.106021 }, S: { x: 0.708177, y: 0.051047 } },
        routeAngles: { T: -135, S: -45 },
        routingGeometry: { wiringWindow: { x: 6.366, y: 0, width: 135.037, height: 107.225 },
          bodyRect: { x: 6.366, y: 107.225, width: 135.037, height: 404.775 } },
      }
    },
  },
  tsStereo: {
    getVariant() { return PHOTO_MANIFEST.tsMono.getVariant() },
  },
  rcaMono: {
    getVariant() {
      return {
        key: 'rca-rear', path: `${ASSET_ROOT}/solder/rca-rear.png`, width: 512, height: 972,
        contentRect: { x: 0, y: 0, width: 512, height: 972 },
        pinPoints: { core: { x: 0.590068, y: 0.288934 }, shell: { x: 0.72983, y: 0.149876 } },
        routeAngles: { core: -180, shell: -45 },
        routingGeometry: { wiringWindow: { x: 0, y: 0, width: 512, height: 335 },
          bodyRect: { x: 105, y: 335, width: 300, height: 637 } },
      }
    },
  },
  rcaStereo: {
    getVariant() { return PHOTO_MANIFEST.rcaMono.getVariant() },
  },
}

const OVERVIEW_PHOTO_MANIFEST = {
  xlrBalanced(endpoint) {
    const gender = endpoint && endpoint.cableConnectorGender
    if (!['公头', '母头'].includes(gender)) return null
    const female = gender === '母头'
    return {
      key: female ? 'overview-xlr-female-v1' : 'overview-xlr-male-v1',
      path: female ? `${ASSET_ROOT}/overview/xlr-female-v1.png` : '/assets/home/module-audio-wiring-catalog.png',
      width: female ? 128 : 256,
      height: female ? 128 : 256,
      viewLabel: '接头外形',
    }
  },
  trsBalanced: () => ({
    key: 'overview-trs-v1', path: `${ASSET_ROOT}/trs.png`, width: 256, height: 256, viewLabel: '接头外形',
  }),
  stereo635: () => ({
    key: 'overview-trs-v1', path: `${ASSET_ROOT}/trs.png`, width: 256, height: 256, viewLabel: '接头外形',
  }),
  stereo35: () => ({
    key: 'overview-stereo35-v1', path: `${ASSET_ROOT}/stereo35.png`, width: 256, height: 256, viewLabel: '接头外形',
  }),
  tsMono: () => ({
    key: 'overview-ts-v1', path: `${ASSET_ROOT}/ts.png`, width: 256, height: 256, viewLabel: '接头外形',
  }),
  tsStereo: () => ({
    key: 'overview-ts-v1', path: `${ASSET_ROOT}/ts.png`, width: 256, height: 256, viewLabel: '接头外形',
  }),
  rcaMono: () => ({
    key: 'overview-rca-v1', path: `${ASSET_ROOT}/rca.png`, width: 256, height: 256, viewLabel: '接头外形',
  }),
  rcaStereo: () => ({
    key: 'overview-rca-v1', path: `${ASSET_ROOT}/rca.png`, width: 256, height: 256, viewLabel: '接头外形',
  }),
  terminalBalanced: () => ({
    key: 'overview-terminal-v1', path: `${ASSET_ROOT}/terminal.png`, width: 256, height: 256, viewLabel: '端子外形',
  }),
}

const screenImageCache = new WeakMap()

function getSolderPhotoSpec(endpoint) {
  if (!endpoint || typeof endpoint.id !== 'string') return null
  const entry = Object.prototype.hasOwnProperty.call(PHOTO_MANIFEST, endpoint.id) ? PHOTO_MANIFEST[endpoint.id] : null
  return entry && typeof entry.getVariant === 'function' ? entry.getVariant(endpoint) : null
}

function getConnectorOverviewPhotoSpec(endpoint) {
  if (!endpoint || typeof endpoint.id !== 'string'
    || !Object.prototype.hasOwnProperty.call(OVERVIEW_PHOTO_MANIFEST, endpoint.id)) return null
  const entry = OVERVIEW_PHOTO_MANIFEST[endpoint.id]
  return typeof entry === 'function' ? entry(endpoint) : null
}

function getModelPhotoSpecs(model) {
  const unique = new Map()
  ;['output', 'input'].forEach((side) => {
    const endpoint = model && model[side]
    const solderSpec = getSolderPhotoSpec(endpoint)
    if (solderSpec) unique.set(solderSpec.key, solderSpec)
  })
  return [...unique.values()]
}

function getCanvasCache(canvas) {
  let cache = screenImageCache.get(canvas)
  if (!cache) {
    cache = new Map()
    screenImageCache.set(canvas, cache)
  }
  return cache
}

function getLoadedScreenPhotos(canvas, model) {
  if (!canvas || (typeof canvas !== 'object' && typeof canvas !== 'function')) return null
  const cache = getCanvasCache(canvas)
  const specs = getModelPhotoSpecs(model)
  const photos = {}
  for (const spec of specs) {
    const entry = cache.get(spec.key)
    if (!entry || entry.status !== 'loaded') return null
    photos[spec.key] = entry.image
  }
  return photos
}

function loadScreenPhoto(canvas, spec) {
  const cache = getCanvasCache(canvas)
  const existing = cache.get(spec.key)
  if (existing && existing.status === 'loaded') return Promise.resolve(existing.image)
  if (existing && existing.status === 'pending') return existing.promise
  if (!canvas || typeof canvas.createImage !== 'function') {
    return Promise.reject(new Error('Canvas image loading is unavailable'))
  }

  let image
  try {
    image = canvas.createImage()
  } catch (error) {
    return Promise.reject(error)
  }
  if (!image) return Promise.reject(new Error('Canvas image could not be created'))

  const entry = { status: 'pending', image, promise: null }
  cache.set(spec.key, entry)
  entry.promise = new Promise((resolve, reject) => {
    image.onload = () => {
      if (cache.get(spec.key) !== entry) return resolve(image)
      entry.status = 'loaded'
      resolve(image)
    }
    image.onerror = (error) => {
      if (cache.get(spec.key) === entry) cache.delete(spec.key)
      reject(error instanceof Error ? error : new Error('Canvas image failed to load'))
    }
    try {
      image.src = spec.path
    } catch (error) {
      if (cache.get(spec.key) === entry) cache.delete(spec.key)
      reject(error)
    }
  })
  return entry.promise
}

function loadScreenSolderPhotos(canvas, model) {
  const specs = getModelPhotoSpecs(model)
  return Promise.all(specs.map((spec) => loadScreenPhoto(canvas, spec)))
    .then((images) => Object.fromEntries(specs.map((spec, index) => [spec.key, images[index]])))
}

function normalizeReportPhotoPath(value) {
  if (typeof value !== 'string' || !value.trim()) return ''
  const path = value.trim()
  if (/^\.?\/?(?:pages\/audio-wiring\/assets|assets\/home)\//.test(path)) {
    return `/${path.replace(/^\.?\//, '')}`
  }
  return path
}

function loadReportSolderPhotos(model, isCurrent = () => true, onComplete) {
  const specs = getModelPhotoSpecs(model)
  const run = (complete) => {
    if (!specs.length) {
      complete(null, {})
      return
    }
    let pending = specs.length
    let settled = false
    const photos = {}
    const finish = (error, value) => {
      if (settled) return
      settled = true
      complete(error, value)
    }
    specs.forEach((spec) => {
      if (!isCurrent()) {
        finish(null, null)
        return
      }
      try {
        wx.getImageInfo({
          src: spec.path,
          success(info = {}) {
            if (settled) return
            if (!isCurrent()) return finish(null, null)
            const path = normalizeReportPhotoPath(info.path) || normalizeReportPhotoPath(info.tempFilePath)
            const width = Number(info.width)
            const height = Number(info.height)
            if (!path || !Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
              return finish(new Error('Local image information is incomplete'))
            }
            photos[spec.key] = path
            pending -= 1
            if (!pending) finish(null, photos)
          },
          fail(error) {
            if (!isCurrent()) return finish(null, null)
            finish(error instanceof Error ? error : new Error('Local image information failed'))
          },
        })
      } catch (error) {
        if (isCurrent()) finish(error)
        else finish(null, null)
      }
    })
  }
  if (typeof onComplete === 'function') {
    run(onComplete)
    return undefined
  }
  if (typeof wx === 'undefined' || typeof wx.getImageInfo !== 'function') {
    return Promise.reject(new Error('Local image information is unavailable'))
  }
  return new Promise((resolve, reject) => run((error, photos) => {
    if (error) reject(error)
    else resolve(photos)
  }))
}

module.exports = {
  getSolderPhotoSpec,
  getConnectorOverviewPhotoSpec,
  getModelPhotoSpecs,
  getLoadedScreenPhotos,
  loadScreenSolderPhotos,
  loadReportSolderPhotos,
}
