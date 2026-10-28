(async function () {
  const params = new URLSearchParams(location.search)
  const key = params.get('case') || 'gain-project-keyboard'
  const width = window.innerWidth
  const height = window.innerHeight
  const safeTop = Number(params.get('safeTop') || 24)
  const safeBottom = Number(params.get('safeBottom') || 24)
  const keyboard = Number(params.get('keyboard') || 0)
  const overlayMaxHeight = Math.max(1, height - safeTop - safeBottom)
  const overlaySearchMaxHeight = Math.min(Math.round(height * .88), overlayMaxHeight)
  const overlaySearchSheetHeight = Math.min(overlayMaxHeight, Math.round(height <= 360 ? overlayMaxHeight : height * .78))
  const overlayPendingMaxHeight = Math.min(Math.round(height * .8), overlayMaxHeight)
  const overlayAddMaxHeight = Math.min(Math.round(height * .88), overlayMaxHeight)
  const overlaySaveMaxHeight = Math.min(Math.round(height * .66), overlayMaxHeight)
  const overlayGuideHeight = Math.min(Math.round(height * .82), overlayMaxHeight)
  const overlayReportHeight = Math.min(Math.round(height * .84), overlayMaxHeight)
  const overlaySaveListMaxHeight = Math.min(Math.round(height * .34), Math.round(overlayMaxHeight * .48))
  const fixtureSearchAvailableHeight = Math.max(1, overlaySearchSheetHeight - (height <= 360 ? 132 : 198))
  const page = document.getElementById('qa-page')

  const header = title => `<view class="qa-heading"><strong>${title}</strong><button class="qa-close">关闭</button></view>`
  const longScroll = (className = 'qa-scroll') => `<scroll-view class="${className}" data-qa-scroll="true"><view class="qa-long-image"></view></scroll-view>`
  const actions = (className = 'qa-actions', buttonClass = 'qa-button') => `<view class="${className}" data-qa-actions="true"><button class="${buttonClass}" data-qa-action="true">保存 / 确认</button></view>`
  const panelContent = (title, scrollClass, actionClass, buttonClass) => `${header(title)}${longScroll(scrollClass)}${actions(actionClass, buttonClass)}`
  const cases = {
    'gain-share': {
      css: 'pages/gain-structure/gain-structure.wxss',
      html: `<view class="sheet-mask share-preview-mask"><view id="qa-panel" class="sheet-panel share-panel share-panel">${panelContent('增益结果图片', 'share-image-scroll', 'share-actions', 'share-action share-action-primary')}</view></view>`,
    },
    'gain-project-keyboard': {
      css: 'pages/gain-structure/gain-structure.wxss', keyboard: true,
      html: `<view class="sheet-mask project-keyboard-open"><view id="qa-panel" data-qa-lifted="true" class="sheet-panel project-panel project-panel project-keyboard-open" style="max-height:${Math.max(150, height - keyboard)}px;margin-bottom:${keyboard}px">${header('保存到项目')}<scroll-view class="project-sheet-body" data-qa-scroll="true"><view class="qa-long-list"></view></scroll-view>${actions('project-footer', 'share-action share-action-primary')}</view></view>`,
    },
    'limiter-share': {
      css: 'pages/limiter/limiter.wxss',
      html: `<view class="sheet-mask"><view id="qa-panel" class="sheet-panel share-panel">${panelContent('限幅器结果图片', 'share-image-scroll', 'share-actions', 'share-action share-action-primary')}</view></view>`,
    },
    'limiter-project-keyboard': {
      css: 'pages/limiter/limiter.wxss', keyboard: true,
      html: `<view class="sheet-mask project-keyboard-open"><view id="qa-panel" data-qa-lifted="true" class="sheet-panel project-panel project-keyboard-open" style="max-height:${Math.max(150, height - keyboard)}px;margin-bottom:${keyboard}px">${header('保存到项目')}<scroll-view class="project-sheet-body" data-qa-scroll="true"><view class="qa-long-list"></view></scroll-view>${actions('project-footer', 'share-action share-action-primary')}</view></view>`,
    },
    'spl-selector': {
      css: 'pages/spl/spl.wxss',
      html: `<view class="selector-mask"><view id="qa-panel" class="selector-panel">${header('选择音箱')}<scroll-view class="selector-list" data-qa-scroll="true"><view class="qa-long-list"></view></scroll-view>${actions('selector-actions', 'selector-action')}</view></view>`,
    },
    'spl-share': {
      css: 'pages/spl/spl.wxss',
      html: `<view class="spl-overlay"><view id="qa-panel" class="spl-sheet share-panel"><view id="splShareHeader" class="sheet-header">${header('声压级结果图片')}</view><view class="share-image-frame" style="height:48vh"><view class="qa-long-image"></view></view><view class="share-actions" data-qa-actions="true"><button class="share-action share-action-primary" data-qa-action="true">发送图片</button></view></view></view>`,
    },
    'camera-selector': {
      css: 'pages/camera/camera.wxss',
      html: `<view class="selector-mask"><view id="qa-panel" class="selector-panel"><view class="selector-header"><view class="selector-title">选择摄像机</view><button class="selector-close" data-qa-action="true">关闭</button></view><input class="selector-search" placeholder="输入型号" /><scroll-view class="selector-list" data-qa-scroll="true"><view class="qa-long-list"></view></scroll-view></view></view>`,
    },
    'audio-selector': {
      css: 'pages/audio-wiring/index.wxss',
      html: `<view class="selector-mask selector-opening"><view id="qa-panel" class="selector-panel"><view class="selector-header"><view class="selector-title">选择接线端点</view><view class="selector-close" data-qa-action="true">关闭</view></view><scroll-view class="selector-list" data-qa-scroll="true" style="height:55vh"><view class="qa-long-list"></view></scroll-view></view></view>`,
    },
    'camera-report-preview': {
      css: 'pages/camera/camera.wxss',
      html: `<view class="page-root"><view class="result-report-preview-overlay"><view id="qa-panel" class="result-report-preview-sheet">${panelContent('摄像机结果图片', 'result-report-preview-scroll', 'result-report-preview-actions', 'result-report-preview-action result-report-preview-action-primary')}</view></view></view>`,
    },
    'audio-report-preview': {
      css: 'pages/audio-wiring/index.wxss',
      html: `<view class="wiring-page page-root"><view class="result-report-preview-overlay"><view id="qa-panel" class="result-report-preview-sheet">${panelContent('音频接线结果图片', 'result-report-preview-scroll', 'result-report-preview-actions', 'result-report-preview-action result-report-preview-action-primary')}</view></view></view>`,
    },
    'cable-report-preview': {
      css: 'pages/cable/cable.wxss',
      html: `<view class="page-root"><view class="result-report-preview-overlay"><view id="qa-panel" class="result-report-preview-sheet">${panelContent('线材结果图片', 'result-report-preview-scroll', 'result-report-preview-actions', 'result-report-preview-action result-report-preview-action-primary')}</view></view></view>`,
    },
    'led-report-preview': {
      css: 'pages/led-screen/led-screen.wxss',
      html: `<view class="led-report-overlay"><view id="qa-panel" class="led-report-sheet"><view class="led-report-header"><view class="led-report-title">LED 方案图片</view><button class="led-report-close">关闭</button></view><scroll-view class="led-report-scroll"><view class="qa-long-image"></view></scroll-view><view class="led-report-actions" data-qa-actions="true"><button class="led-report-share" data-qa-action="true">分享图片</button><button class="led-report-save">保存图片</button></view></view></view>`,
    },
    'led-project-keyboard': {
      css: 'pages/led-screen/led-screen.wxss', keyboard: true,
      html: `<view class="led-project-overlay project-keyboard-open" style="bottom:${keyboard}px"><view id="qa-panel" data-qa-lifted="true" class="led-project-sheet project-keyboard-open" style="max-height:${Math.max(180, height - keyboard)}px">${header('保存到项目')}<scroll-view class="led-project-body" data-qa-scroll="true"><view class="qa-long-list"></view></scroll-view><view class="led-project-footer" data-qa-actions="true"><button class="led-project-button led-project-button-primary" data-qa-action="true">确认保存</button></view></view></view>`,
    },
    'records-rename': {
      css: 'pages/records/project.wxss',
      html: `<view class="interior-overlay"><view id="qa-panel" class="interior-rename-sheet">${header('重命名项目')}<input class="interior-form-control" value="演示项目名称" />${actions('interior-sheet-actions', 'interior-sheet-button interior-sheet-primary')}</view></view>`,
    },
    'project-wiring-keyboard': {
      css: 'pages/project-wiring/index.wxss', imports: ['pages/project-wiring/workspace.wxss'], keyboard: true,
      html: `<view class="wiring-mask workspace-mask" style="top:0;bottom:auto;height:${height}px"><view class="wiring-backdrop"></view><view id="qa-panel" class="wiring-sheet workspace-device-sheet" style="height:calc(${Math.round(height * .94)}px - ${safeTop}px - ${safeBottom}px)">${header('新增设备')}<scroll-view class="wiring-sheet-scroll" data-qa-scroll="true"><view class="workspace-field-label">设备名称</view><input class="workspace-control" value="新设备" /><view class="qa-long-list"></view><view class="wiring-sheet-keyboard-space" style="height:${keyboard}px"></view></scroll-view>${actions('workspace-sheet-save', 'workspace-primary-button')}</view></view>`,
    },
    'project-wiring-report': {
      css: 'pages/project-wiring/index.wxss', imports: ['pages/project-wiring/workspace.wxss'],
      html: `<view class="wiring-mask wiring-report-mask workspace-mask"><view class="wiring-backdrop"></view><view id="qa-panel" class="wiring-sheet wiring-report-sheet">${header('项目接线报告')}<scroll-view class="wiring-report-image-scroll" data-qa-scroll="true"><view class="qa-long-image"></view></scroll-view>${actions('wiring-sheet-actions wiring-report-actions', 'wiring-sheet-action wiring-sheet-primary')}</view></view>`,
    },
    'dmx-address-search': {
      css: 'pages/dmx-address/dmx-address.wxss',
      html: `<view id="qa-backdrop" class="fixture-search-overlay main-modal-backdrop"></view><view id="qa-panel" class="fixture-search-sheet main-modal-bottom-sheet"><view class="sheet-title-row">选择灯具<button class="sheet-dismiss">完成</button></view><scroll-view class="fixture-search-content-scroll" data-qa-scroll="true" style="height:${fixtureSearchAvailableHeight}px"><view class="qa-long-list"></view></scroll-view>${actions('fixture-search-actions', 'sheet-dismiss')}</view>`,
    },
    'dmx-address-save-project': {
      css: 'pages/dmx-address/dmx-address.wxss',
      html: `<view id="qa-backdrop" class="save-project-overlay main-modal-backdrop"></view><view id="qa-panel" class="save-project-sheet main-modal-bottom-sheet"><view class="sheet-title-row">保存到项目<button class="sheet-dismiss">完成</button></view><scroll-view class="project-save-list" data-qa-scroll="true"><view class="qa-long-list"></view></scroll-view>${actions('new-project-entry', 'save-project-submit')}</view>`,
    },
    'dmx-address-report-preview': {
      css: 'pages/dmx-address/dmx-address.wxss',
      html: `<view class="result-report-preview-overlay main-modal-backdrop"><view id="qa-panel" class="result-report-preview-sheet main-modal-panel">${header('DMX 地址图')}<scroll-view class="result-report-preview-scroll" data-qa-scroll="true"><view class="qa-long-image"></view></scroll-view>${actions('result-report-preview-actions', 'result-report-preview-action')}</view></view>`,
    },
    'dmx-layout-placement': {
      css: 'pages/dmx-layout/dmx-layout.wxss',
      html: `<view class="overlay placement-overlay" style="padding-top:${safeTop + 12}px"><view id="qa-panel" class="placement-card" style="max-height:88vh"><view class="placement-heading"><view class="placement-titlebar"><view class="placement-title">灯位编排</view><view class="placement-actions"><button class="placement-clear-button placement-clear-rod-button" data-qa-action="true">清空当前杆</button><button class="placement-clear-button">清空全图</button></view></view></view><scroll-view class="fixture-selection-list" data-qa-scroll="true"><view class="qa-long-list"></view></scroll-view></view></view>`,
    },
    'dmx-layout-settings': {
      css: 'pages/dmx-layout/dmx-layout.wxss',
      html: `<view class="overlay settings-overlay" style="padding-top:${safeTop + 12}px"><view id="qa-panel" class="settings-card">${header('布局设置')}<scroll-view class="settings-scroll" data-qa-scroll="true"><view class="qa-long-list"></view></scroll-view>${actions('settings-actions', 'settings-apply')}</view></view>`,
    },
    'dmx-layout-export': {
      css: 'pages/dmx-layout/dmx-layout.wxss',
      html: `<view class="export-overlay" style="padding-top:${safeTop + 12}px"><view id="qa-panel" class="export-sheet">${header('灯位图预览')}<scroll-view class="export-image-scroll" data-qa-scroll="true" style="height:55vh"><view class="qa-long-image"></view></scroll-view>${actions('export-actions', 'export-save-current')}</view></view>`,
    },
    'products-import': {
      css: 'pages/products/detail.wxss',
      html: `<view class="dmx-import-overlay"><view id="qa-panel" class="dmx-import-sheet"><view class="dmx-import-header">带入 DMX 灯具</view><scroll-view class="dmx-import-scroll" data-qa-scroll="true"><view class="qa-long-list"></view></scroll-view>${actions('dmx-import-footer', 'dmx-import-confirm')}</view></view>`,
    },
  }

  async function loadFullCss(path, seen = new Set()) {
    const url = new URL('/' + path.replace(/^\/+/, ''), location.origin)
    if (seen.has(url.pathname)) return ''
    seen.add(url.pathname)
    const response = await fetch(url.href)
    if (!response.ok) throw new Error(`CSS fetch ${response.status}: ${url.pathname}`)
    let source = await response.text()
    const imports = [...source.matchAll(/@import\s+["']([^"']+)["']\s*;/g)].map(match => match[1])
    source = source.replace(/@import\s+["'][^"']+["']\s*;/g, '')
    const imported = await Promise.all(imports.map(importPath => {
      const resolved = new URL(importPath, url)
      return loadFullCss(resolved.pathname.replace(/^\//, ''), seen)
    }))
    return imported.join('\n') + '\n' + source
  }

  try {
    const currentCase = cases[key]
    if (!currentCase) throw new Error('Unknown fixture case: ' + key)
    page.style.cssText = `--qa-safe-top:${safeTop}px;--qa-safe-bottom:${safeBottom}px;--overlay-safe-top:${safeTop}px;--overlay-safe-bottom:${safeBottom}px;--overlay-report-height:${overlayReportHeight}px;--overlay-max-height:${overlayMaxHeight}px;--camera-report-sheet-max-height:86vh;--cable-report-sheet-max-height:86vh;--overlay-save-max-height:${overlaySaveMaxHeight}px;--overlay-search-sheet-height:${overlaySearchSheetHeight}px;--overlay-search-max-height:${overlaySearchMaxHeight}px;--overlay-pending-max-height:${overlayPendingMaxHeight}px;--overlay-center-top:${safeTop + overlayMaxHeight / 2}px;--overlay-add-max-height:${overlayAddMaxHeight}px;--overlay-guide-height:${overlayGuideHeight}px;--overlay-save-list-max-height:${overlaySaveListMaxHeight}px;`
    const fullCss = await loadFullCss('app.wxss') + '\n' + await loadFullCss(currentCase.css)
      + '\n' + await Promise.all((currentCase.imports || []).map(path => loadFullCss(path))).then(values => values.join('\n'))
    const rpx = fullCss.replace(/(-?(?:\d+|\d*\.\d+))rpx\b/g, (_match, amount) => `${Number(amount) * width / 750}px`)
    const css = rpx.replace(/env\(safe-area-inset-(top|right|bottom|left)\)/g, 'var(--qa-safe-$1)')
    const style = document.createElement('style')
    style.textContent = css
    document.head.appendChild(style)
    page.innerHTML = currentCase.html
    document.documentElement.dataset.case = key
    document.documentElement.dataset.safeTop = String(safeTop)
    document.documentElement.dataset.safeBottom = String(safeBottom)
    document.documentElement.dataset.keyboard = String(keyboard)
    document.documentElement.dataset.cssBytes = String(css.length)
    document.documentElement.dataset.ready = 'true'
  } catch (error) {
    document.documentElement.dataset.error = String(error && error.stack || error)
    document.documentElement.dataset.ready = 'true'
  }
})()
