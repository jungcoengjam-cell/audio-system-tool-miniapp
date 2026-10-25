const { findKnowledgeById } = require('../../data/knowledge')
const { demos } = require('./demo-scenes')
const { vibrate } = require('../../utils/haptics')

const DEMO_STEP_MS = 2400
Page({
  data: {
    article: null,
    loadError: '',
    principleAnimationActive: false,
    formulaExpanded: false,
    demo: null,
    demoFrame: null,
    demoIndex: 0,
    demoPlaying: false,
  },

  onLoad(options) {
    this.destroyed = false
    this.pageVisible = true
    this.cardVisible = false
    this.userPaused = false
    this.resumeIntent = false
    this.demoEntered = false
    const article = findKnowledgeById(options.id)

    if (!article) {
      this.setData({ article: null, loadError: '这篇知识内容不存在，或链接已经失效。' })
      wx.setNavigationBarTitle({ title: '内容不存在' })
      return
    }

    const demo = demos[article.visualType] || null
    this.setData({ article, demo, demoFrame: demo ? demo.steps[0] : null })
    wx.setNavigationBarTitle({ title: article.shortTitle })
  },

  onReady() {
    if (this.destroyed) return
    if (this.data.demo) {
      this.observeDemo()
      return
    }
    if (!this.data.article?.visualType) return

    if (typeof this.createIntersectionObserver !== 'function') {
      this.startPrincipleAnimation()
      return
    }

    try {
      this.principleObserver = this.createIntersectionObserver({ thresholds: [0.35] })
      this.principleObserver
        .relativeToViewport()
        .observe('.principle-visual-card', ({ intersectionRatio }) => {
          if (this.destroyed) return
          if (intersectionRatio >= 0.35 && !this.principleAnimationPlayed) {
            this.principleAnimationPlayed = true
            this.startPrincipleAnimation()
          }
        })
    } catch (error) {
      this.startPrincipleAnimation()
    }
  },

  onUnload() {
    this.destroyed = true
    this.pageVisible = false
    this.cardVisible = false
    clearTimeout(this.principleAnimationTimer)
    clearTimeout(this.demoTimer)
    this.principleAnimationTimer = null
    this.demoTimer = null
    this.principleObserver?.disconnect()
    this.principleObserver = null
  },

  onHide() {
    this.pageVisible = false
    if (this.data.demoPlaying) {
      this.resumeIntent = true
      this.pauseDemo(false)
    }
  },

  onShow() {
    this.pageVisible = true
    if (this.resumeIntent && this.cardVisible && !this.userPaused) {
      this.resumeIntent = false
      this.playDemo()
    }
  },

  observeDemo() {
    if (typeof this.createIntersectionObserver !== 'function') {
      this.cardVisible = true
      this.demoEntered = true
      this.playDemo()
      return
    }
    try {
      this.principleObserver = this.createIntersectionObserver({ thresholds: [0.35] })
      this.principleObserver.relativeToViewport().observe('.demo-card', ({ intersectionRatio }) => {
        if (this.destroyed) return
        this.cardVisible = intersectionRatio >= 0.35
        if (!this.cardVisible) {
          if (this.data.demoPlaying) {
            this.resumeIntent = true
            this.pauseDemo(false)
          }
          return
        }
        if (!this.demoEntered) {
          this.demoEntered = true
          if (this.pageVisible) this.playDemo()
          else this.resumeIntent = true
        } else if (this.resumeIntent && this.pageVisible && !this.userPaused) {
          this.resumeIntent = false
          this.playDemo()
        }
      })
    } catch (error) {
      this.cardVisible = true
      this.demoEntered = true
      this.playDemo()
    }
  },

  scheduleDemoStep() {
    clearTimeout(this.demoTimer)
    this.demoTimer = setTimeout(() => {
      this.demoTimer = null
      if (this.destroyed || !this.pageVisible || !this.cardVisible || !this.data.demoPlaying) return
      const nextIndex = this.data.demoIndex + 1
      if (nextIndex >= this.data.demo.steps.length) {
        this.setData({ demoPlaying: false })
        return
      }
      this.setData({ demoIndex: nextIndex, demoFrame: this.data.demo.steps[nextIndex] }, () => {
        if (!this.destroyed && this.data.demoPlaying) this.scheduleDemoStep()
      })
    }, DEMO_STEP_MS)
  },

  playDemo() {
    if (this.destroyed || !this.data.demo || !this.pageVisible || !this.cardVisible) return
    let nextIndex = this.data.demoIndex
    if (nextIndex >= this.data.demo.steps.length - 1) nextIndex = 0
    this.userPaused = false
    clearTimeout(this.demoTimer)
    this.setData({ demoIndex: nextIndex, demoFrame: this.data.demo.steps[nextIndex], demoPlaying: true })
    this.scheduleDemoStep()
  },

  pauseDemo(manual = true) {
    clearTimeout(this.demoTimer)
    this.demoTimer = null
    if (manual) {
      this.userPaused = true
      this.resumeIntent = false
    }
    if (!this.destroyed) this.setData({ demoPlaying: false })
  },

  toggleDemoPlayback() {
    const previous = Boolean(this.data.demoPlaying)
    if (this.data.demoPlaying) this.pauseDemo()
    else this.playDemo()
    if (this.data.demoPlaying !== previous && !this.destroyed && this.pageVisible) vibrate('light')
  },

  selectDemoStep(event) {
    const index = Number(event.currentTarget.dataset.index)
    if (!this.data.demo?.steps[index]) return
    const changed = index !== this.data.demoIndex || this.data.demoPlaying
    clearTimeout(this.demoTimer)
    this.userPaused = true
    this.resumeIntent = false
    this.setData({ demoIndex: index, demoFrame: this.data.demo.steps[index], demoPlaying: false })
    if (changed && !this.destroyed && this.pageVisible) vibrate('light')
  },

  replayDemo() {
    const previousIndex = this.data.demoIndex
    const previousPlaying = this.data.demoPlaying
    this.userPaused = false
    this.resumeIntent = !this.pageVisible || !this.cardVisible
    clearTimeout(this.demoTimer)
    if (!this.data.demo) return
    this.setData({ demoIndex: 0, demoFrame: this.data.demo.steps[0], demoPlaying: false })
    if (this.pageVisible && this.cardVisible) this.playDemo()
    if ((previousIndex !== this.data.demoIndex || previousPlaying !== this.data.demoPlaying)
      && !this.destroyed && this.pageVisible) vibrate('light')
  },


  startPrincipleAnimation() {
    if (this.destroyed) return
    clearTimeout(this.principleAnimationTimer)
    this.setData({ principleAnimationActive: false })
    this.principleAnimationTimer = setTimeout(() => {
      this.principleAnimationTimer = null
      if (this.destroyed) return
      this.setData({ principleAnimationActive: true })
    }, 40)
  },

  replayPrincipleAnimation() {
    if (this.data.demo) {
      this.replayDemo()
      return
    }
    this.startPrincipleAnimation()
    if (!this.destroyed && this.pageVisible) vibrate('light')
  },

  toggleFormula() {
    this.setData({ formulaExpanded: !this.data.formulaExpanded })
    if (!this.destroyed && this.pageVisible) vibrate('light')
  },

  openRelatedTool() {
    const { relatedPath } = this.data.article || {}

    if (relatedPath) {
      wx.navigateTo({ url: relatedPath })
    }
  },

  goBack() {
    wx.navigateBack({
      fail: () => wx.reLaunch({ url: '/pages/index/index' }),
    })
  },
})
