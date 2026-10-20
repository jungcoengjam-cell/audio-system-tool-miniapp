const ASSET_ROOT = '/pages/audio-wiring/assets'

// Contact coordinates describe where lines meet the edited pixels in these images.
// They are visual anchors, not manufacturer dimensions or mechanical tolerances.
const XLR_VARIANTS = {
  male: {
    key: 'xlr-male-rear',
    path: `${ASSET_ROOT}/solder/xlr-male-rear.png`,
    width: 384,
    height: 384,
    contentRect: { x: 31.9, y: 22, width: 320.2, height: 340 },
    routeAngles: { '1': -45, '2': -135, '3': 90 },
    pinPoints: {
      '1': { x: 0.736598, y: 0.480677 },
      '2': { x: 0.242791, y: 0.48583 },
      '3': { x: 0.487547, y: 0.721998 },
    },
  },
  female: {
    key: 'xlr-female-rear',
    path: `${ASSET_ROOT}/solder/xlr-female-rear.png`,
    width: 384,
    height: 384,
    contentRect: { x: 47.65, y: 22, width: 288.7, height: 340 },
    routeAngles: { '1': -135, '2': -45, '3': 90 },
    pinPoints: {
      '1': { x: 0.270511, y: 0.511132 },
      '2': { x: 0.723495, y: 0.51627 },
      '3': { x: 0.490581, y: 0.733771 },
    },
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
        key: 'terminal-block',
        path: `${ASSET_ROOT}/terminal.png`,
        width: 256,
        height: 256,
        kind: 'terminal',
        pinPoints: {
          '+': { x: 0.2109375, y: 0.6015625 },
          '−': { x: 0.41796875, y: 0.6796875 },
          G: { x: 0.625, y: 0.75390625 },
        },
        labelPoints: {
          '+': { x: 0.2109375, y: 0.453125 },
          '−': { x: 0.41796875, y: 0.53125 },
          G: { x: 0.625, y: 0.60546875 },
        },
        routeAngles: { '+': -135, '−': -45, G: 90 },
      }
    },
  },
  stereo35: {
    getVariant() {
      return {
        key: 'stereo35-rear', path: `${ASSET_ROOT}/solder/stereo35-rear.png`, width: 384, height: 384,
        contentRect: { x: 116.8, y: 22, width: 150.4, height: 340 },
        pinPoints: { T: { x: 0.520207, y: 0.553272 }, R: { x: 0.384271, y: 0.465098 }, S: { x: 0.512859, y: 0.193227 } },
        routeAngles: { T: 45, R: 180, S: -90 },
      }
    },
  },
  trsBalanced: {
    getVariant() {
      return {
        key: 'trs635-rear', path: `${ASSET_ROOT}/solder/trs635-rear.png`, width: 384, height: 384,
        contentRect: { x: 115.9, y: 22, width: 152.2, height: 340 },
        pinPoints: { T: { x: 0.435351, y: 0.460648 }, R: { x: 0.587839, y: 0.460648 }, S: { x: 0.530217, y: 0.851356 } },
        routeAngles: { T: -135, R: -45, S: 90 },
      }
    },
  },
  tsMono: {
    getVariant() {
      return {
        key: 'ts-rear', path: `${ASSET_ROOT}/solder/ts-rear.png`, width: 384, height: 384,
        contentRect: { x: 220, y: 155, width: 142, height: 80 },
        pinPoints: { T: { x: 0.673125, y: 0.453542 }, S: { x: 0.875208, y: 0.519375 } },
        routeAngles: { T: -90, S: 90 },
      }
    },
  },
  tsStereo: {
    getVariant() {
      return {
        key: 'ts-rear', path: `${ASSET_ROOT}/solder/ts-rear.png`, width: 384, height: 384,
        contentRect: { x: 220, y: 155, width: 142, height: 80 },
        pinPoints: { T: { x: 0.673125, y: 0.453542 }, S: { x: 0.875208, y: 0.519375 } },
        routeAngles: { T: -90, S: 90 },
      }
    },
  },
  rcaMono: {
    getVariant() {
      return {
        key: 'rca-rear', path: `${ASSET_ROOT}/solder/rca-rear.png`, width: 384, height: 384,
        contentRect: { x: 215, y: 150, width: 147, height: 133 },
        pinPoints: { core: { x: 0.68292, y: 0.541281 }, shell: { x: 0.803917, y: 0.605339 } },
        routeAngles: { core: -90, shell: 45 },
      }
    },
  },
  rcaStereo: {
    getVariant() {
      return {
        key: 'rca-rear', path: `${ASSET_ROOT}/solder/rca-rear.png`, width: 384, height: 384,
        contentRect: { x: 215, y: 150, width: 147, height: 133 },
        pinPoints: { core: { x: 0.68292, y: 0.541281 }, shell: { x: 0.803917, y: 0.605339 } },
        routeAngles: { core: -90, shell: 45 },
      }
    },
  },
}

const screenImageCache = new WeakMap()

function getSolderPhotoSpec(endpoint) {
  const entry = endpoint && PHOTO_MANIFEST[endpoint.id]
  return entry && typeof entry.getVariant === 'function' ? entry.getVariant(endpoint) : null
}

function getModelPhotoSpecs(model) {
  const unique = new Map()
  ;['output', 'input'].forEach((side) => {
    const spec = getSolderPhotoSpec(model && model[side])
    if (spec) unique.set(spec.key, spec)
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
  if (/^\.?\/?pages\/audio-wiring\/assets\//.test(path)) {
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
  getModelPhotoSpecs,
  getLoadedScreenPhotos,
  loadScreenSolderPhotos,
  loadReportSolderPhotos,
}
