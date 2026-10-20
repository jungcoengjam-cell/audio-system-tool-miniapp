const nativeQuery = new URLSearchParams(location.search)
window.__qaProfileReady = fetch('/tests/project-wiring-redesign-2026-10-16/evidence/native-fix-2026-10-16/installed-native-source.json').then(response => response.json()).then(source => {
  window.__qaNativeButtonCss = source.mappedButtonCss
  window.__qaNativeSource = source
})
window.__qaTransformCss = source => {
  let transformed = nativeQuery.get('noGrid') === '1' ? source.replace(/display\s*:\s*(?:inline-)?grid\s*;/gi, 'display:block;').replace(/grid-(?:template|auto|column|row)[\w-]*\s*:[^;}]+;?/gi, '') : source
  if (Number(nativeQuery.get('safeBottom')) > 0) transformed = transformed.replace(/env\(safe-area-inset-bottom(?:\s*,\s*0px)?\)/g, Number(nativeQuery.get('safeBottom')) + 'px')
  return transformed
}
window.__qaNativeWheelAdapter = (wheel, index) => {
  const column = wheel.querySelector('picker-view-column')
  if (!column) return
  const rows = [...column.children]
  const contract = { sourceInlineHeight: wheel.getAttribute('style') || '', sourceIndicatorStyle: wheel.getAttribute('indicator-style') || '', maskClass: wheel.getAttribute('mask-class') || '', maskStyle: wheel.getAttribute('mask-style') || '', columnCount: wheel.querySelectorAll(':scope > picker-view-column').length, rowTags: rows.map(row => row.tagName.toLowerCase()), rowDisplays: rows.map(row => getComputedStyle(row).display), rowLineHeights: rows.map(row => getComputedStyle(row).lineHeight) }
  const mask = document.createElement('div'); mask.className = 'qa-native-picker-mask ' + (wheel.getAttribute('mask-class') || ''); mask.style.cssText = wheel.getAttribute('mask-style') || ''
  const indicator = document.createElement('div'); indicator.className = 'qa-native-picker-indicator ' + (wheel.getAttribute('indicator-class') || ''); indicator.style.cssText = wheel.getAttribute('indicator-style') || ''
  const content = document.createElement('div'); content.className = 'qa-native-picker-content'
  column.replaceChildren(mask, indicator, content)
  rows.forEach(row => content.append(row))
  const height = wheel.offsetHeight, pitch = indicator.offsetHeight, padding = (height - pitch) / 2
  mask.style.backgroundSize = `100% ${padding}px`
  indicator.style.top = `${padding}px`
  rows.forEach(row => { row.style.height = pitch + 'px'; row.style.overflow = 'hidden' })
  content.style.transform = `translateY(${padding - index * pitch}px)`
  if (!window.__qaNativePickerContracts) window.__qaNativePickerContracts = []
  window.__qaNativePickerContracts.push({ ...contract, height, pitch, padding, selectedIndex: index })
}
