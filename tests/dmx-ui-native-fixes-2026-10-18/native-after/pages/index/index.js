const { printPerformanceSummary, startMeasurement } = require('../../utils/performance')
const finishExploreModuleLoad = startMeasurement('探索页/脚本加载')
const { knowledgeItems } = require('../../data/knowledge')

const categoryKeys = { 音频: 'audio', 视频: 'video', 灯光: 'lighting' }
const headlines = {
  'led-screen-fit': '屏能否装下，要把包边算上。', 'limiter-threshold': '限幅阈值，先看系统承受力。',
  'distance-loss': '自由场中，距离翻倍约降 6 dB。', 'cable-loss': '线越长、越细，损耗越大。',
  'fill-handoff': '主扩渐弱，补声接力。', 'gain-alignment': '先对齐电平，再调现场响度。',
  'camera-fov-distance': '先看视场角，再定安装距离。', 'dmx-address-basics': '按通道占位，地址接着排。',
}
const knowledgeCards = knowledgeItems
  .slice()
  .sort((a, b) => (a.id === 'led-screen-fit' ? -1 : b.id === 'led-screen-fit' ? 1 : 0))
  .map(({ id, title, path, category }) => ({
    id, title, path, category, headline: headlines[id] || title, categoryKey: categoryKeys[category] || 'audio', animationActive: false,
  }))
Page({
  data: {
    knowledgeItems: knowledgeCards,
  },

  onShow() {
    this._visible = true
    this._disposed = false
    if (this._ready) this.setupKnowledgeObserver()
  },

  onReady() { this._ready = true; this.setupKnowledgeObserver() },

  setupKnowledgeObserver() {
    if (this.knowledgeObserver || !this._ready || !this._visible || this._disposed || typeof this.createIntersectionObserver !== 'function') return
    let observer = null
    try {
      observer = this.createIntersectionObserver({ thresholds: [0.35], observeAll: true })
      const token = (this.knowledgeObserverToken || 0) + 1
      this.knowledgeObserverToken = token
      this.knowledgeObserver = observer
      observer.relativeTo('.knowledge-strip').relativeToViewport().observe('.knowledge-card', (entry) => {
        if (!this._visible || this._disposed || this.knowledgeObserverToken !== token || this.knowledgeObserver !== observer) return
        const rawIndex = entry.dataset?.index
        if (rawIndex === null || rawIndex === undefined || rawIndex === '') return
        const index = Number(rawIndex)
        if (!Number.isInteger(index) || index < 0 || index >= this.data.knowledgeItems.length) return
        const active = entry.intersectionRatio >= 0.35
        if (this.data.knowledgeItems[index]?.animationActive === active) return
        this.setData({ [`knowledgeItems[${index}].animationActive`]: active })
      })
    } catch (error) {
      this.knowledgeObserverToken = (this.knowledgeObserverToken || 0) + 1
      observer?.disconnect?.()
      this.knowledgeObserver = null
    }
  },

  onHide() {
    this._visible = false
    this.knowledgeObserverToken = (this.knowledgeObserverToken || 0) + 1
    this.knowledgeObserver?.disconnect()
    this.knowledgeObserver = null
    const reset = {}
    this.data.knowledgeItems.forEach((item, index) => {
      if (item.animationActive) reset[`knowledgeItems[${index}].animationActive`] = false
    })
    if (Object.keys(reset).length) this.setData(reset)
    printPerformanceSummary('探索页/')
  },

  onUnload() { this._disposed = true; this._visible = false; this.knowledgeObserverToken = (this.knowledgeObserverToken || 0) + 1; this.knowledgeObserver?.disconnect(); this.knowledgeObserver = null },
})

finishExploreModuleLoad({ knowledgeItems: knowledgeCards.length })
