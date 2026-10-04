// The first release starts with an empty, manually curated catalog. Do not add
// synthetic device, photo, controller, source, or protocol records here.
// A future public photo needs explicit per-photo authorization and redaction review.
// Automatic protocol display also requires directMappingReviewed and mappingReviewerId on each appearance group.
const CATEGORIES = [
  { key: 'all', label: '全部' },
  { key: 'led-power', label: 'LED 配电' },
  { key: 'audio', label: '音频' },
  { key: 'video', label: '视频' },
  { key: 'camera', label: '摄像机' },
  { key: 'lighting', label: '灯光' },
  { key: 'power', label: '电源' },
]

const catalog = {
  appearanceGroups: [],
  deviceVariants: [],
  photos: [],
  controllerVariants: [],
  sources: [],
  protocols: [],
}

module.exports = { CATEGORIES, catalog }
