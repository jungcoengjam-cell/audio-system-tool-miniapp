const fs = require('fs')
const path = require('path')

function runCloseout8Contracts({ log = true, failFast = false } = {}) {
const root = path.resolve(__dirname, '..')
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8')
const failures = []
const passes = []

function check(id, operation) {
  try {
    operation()
    passes.push(id)
    if (log) console.log('PASS closeout8 contract: ' + id)
  } catch (error) {
    failures.push({ id, message: error.message })
    if (log) console.error('FAIL closeout8 contract: ' + id + ': ' + error.message)
    if (failFast) throw error
  }
}

function expect(condition, message) {
  if (!condition) throw new Error(message)
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function allRules(source) {
  const rules = []
  const pattern = /([^{}]+)\{([^{}]*)\}/g
  let match
  while ((match = pattern.exec(source))) {
    const selectorText = match[1].trim()
    if (!selectorText || selectorText.startsWith('@')) continue
    rules.push({
      selectors: selectorText.split(',').map(item => item.trim()),
      declarations: match[2],
    })
  }
  return rules
}

function ruleFor(source, selector) {
  const found = allRules(source).filter(rule => rule.selectors.includes(selector))
  expect(found.length > 0, 'missing current selector ' + selector)
  return found[found.length - 1].declarations
}

function firstRuleFor(source, selector) {
  const found = allRules(source).filter(rule => rule.selectors.includes(selector))
  expect(found.length > 0, 'missing current selector ' + selector)
  return found[0].declarations
}

function declaration(source, selector, property) {
  const body = ruleFor(source, selector)
  const match = new RegExp('(?:^|;)\\s*' + escapeRegExp(property) + '\\s*:\\s*([^;]+)').exec(body)
  expect(match, selector + ' has no ' + property + ' declaration')
  return match[1].trim()
}

function declarationsOf(body) {
  const values = {}
  body.split(';').forEach(part => {
    const index = part.indexOf(':')
    if (index < 0) return
    values[part.slice(0, index).trim()] = part.slice(index + 1).trim()
  })
  return values
}

function finalPropertiesFor(source, selector, propertyNames) {
  const values = {}
  allRules(source).filter(rule => rule.selectors.includes(selector)).forEach(rule => {
    const declared = declarationsOf(rule.declarations)
    propertyNames.forEach(name => {
      if (Object.prototype.hasOwnProperty.call(declared, name)) values[name] = declared[name]
    })
  })
  return values
}

function sourceOrderedPropertiesFor(source, selectors, propertyNames) {
  const values = {}
  const selectorSet = new Set(selectors)
  const rules = selectors.length === 1 && selectors[0] === '.page-root'
    ? Array.from(source.matchAll(/\.page-root\s*\{([^{}]*)\}/g), match => ({
      selectors: ['.page-root'],
      declarations: match[1],
    }))
    : allRules(source)
  rules.filter(rule => rule.selectors.some(selector => selectorSet.has(selector))).forEach(rule => {
    const declared = declarationsOf(rule.declarations)
    propertyNames.forEach(name => {
      if (Object.prototype.hasOwnProperty.call(declared, name)) values[name] = declared[name]
    })
  })
  return values
}

function parseHex(value) {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value)
  expect(match, 'expected a resolved three- or six-digit color, got ' + value)
  const hex = match[1].length === 3 ? match[1].split('').map(value => value + value).join('') : match[1]
  return [0, 2, 4].map(index => parseInt(hex.slice(index, index + 2), 16))
}

function linear(channel) {
  const value = channel / 255
  return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4)
}

function luminance(rgb) {
  return 0.2126 * linear(rgb[0]) + 0.7152 * linear(rgb[1]) + 0.0722 * linear(rgb[2])
}

function contrast(foreground, background) {
  const left = luminance(foreground)
  const right = luminance(background)
  return (Math.max(left, right) + 0.05) / (Math.min(left, right) + 0.05)
}

function composite(foreground, background, opacity) {
  return foreground.map((channel, index) => channel * opacity + background[index] * (1 - opacity))
}

function cssBlock(source, marker) {
  const start = source.indexOf(marker)
  expect(start >= 0, 'missing CSS block ' + marker)
  const open = source.indexOf('{', start)
  expect(open >= 0, 'missing CSS block body ' + marker)
  let depth = 0
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1
    if (source[index] === '}') depth -= 1
    if (depth === 0) return { start, end: index + 1, body: source.slice(open + 1, index) }
  }
  throw new Error('unclosed CSS block ' + marker)
}

function withoutCssBlock(source, marker) {
  const block = cssBlock(source, marker)
  return source.slice(0, block.start) + source.slice(block.end)
}

function cssForTheme(theme) {
  return theme === 'light'
    ? withoutCssBlock(dmxWxss, '@media (prefers-color-scheme:dark)')
    : dmxWxss
}

function opacityFor(source, selector) {
  const value = finalPropertiesFor(source, selector, ['opacity']).opacity
  if (value === undefined) return 1
  const opacity = Number(value)
  expect(Number.isFinite(opacity) && opacity >= 0 && opacity <= 1,
    selector + ' opacity must resolve between 0 and 1')
  return opacity
}

function endKeyframeOpacity(source, animationName) {
  const block = cssBlock(source, '@keyframes ' + animationName)
  const end = /\bto\s*\{([^{}]*)\}/.exec(block.body)
  expect(end, animationName + ' must define its final keyframe')
  const opacity = declarationsOf(end[1]).opacity
  expect(opacity !== undefined && Number.isFinite(Number(opacity)),
    animationName + ' final keyframe opacity must be explicit')
  return Number(opacity)
}

function modalOpacity(themeSource, selector, reducedMotion) {
  const animation = finalPropertiesFor(themeSource, selector, ['animation']).animation
  if (reducedMotion) {
    expect(animation === 'none!important', selector + ' must honor reduced-motion animation suppression')
    return opacityFor(themeSource, selector)
  }
  const normalSource = withoutCssBlock(themeSource, '@media (prefers-reduced-motion: reduce)')
  const normalAnimation = finalPropertiesFor(normalSource, selector, ['animation']).animation
  expect(normalAnimation, selector + ' must have its normal modal animation')
  const animationName = normalAnimation.trim().split(/\s+/)[0]
  return endKeyframeOpacity(normalSource, animationName)
}

function backdropFor(themeSource, overlaySelector) {
  const pageRules = Array.from(themeSource.matchAll(/\.page-root\s*\{([^{}]*)\}/g))
  const page = pageRules.length
    ? declarationsOf(pageRules[pageRules.length - 1][1]).background
    : undefined
  const overlay = finalPropertiesFor(themeSource, overlaySelector, ['background']).background
  expect(page && overlay, 'page and bound overlay backgrounds must resolve')
  const alpha = /^rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*([\d.]+)\s*\)$/i.exec(overlay)
  expect(alpha, overlaySelector + ' backdrop must retain a measurable black overlay')
  return composite([0, 0, 0], parseHex(page), Number(alpha[1]))
}

function opacityForCurrentElement(themeSource, selectors) {
  const value = sourceOrderedPropertiesFor(themeSource, selectors, ['opacity']).opacity
  if (value === undefined) return 1
  const opacity = Number(value)
  expect(Number.isFinite(opacity) && opacity >= 0 && opacity <= 1,
    'current DMX element opacity must resolve between 0 and 1')
  return opacity
}

function ancestorOpacity(themeSource, elementSelectorGroups, animatedSelectors, reducedMotion) {
  const staticOpacity = elementSelectorGroups.reduce((opacity, selectors) =>
    opacity * opacityForCurrentElement(themeSource, selectors), 1)
  const animationOpacity = animatedSelectors.reduce((opacity, selector) =>
    opacity * modalOpacity(themeSource, selector, reducedMotion), 1)
  return staticOpacity * animationOpacity
}

function renderedContrast(foreground, background, textOpacity, parentOpacity, backdrop) {
  const textOnSelection = composite(foreground, background, textOpacity)
  return contrast(
    composite(textOnSelection, backdrop, parentOpacity),
    composite(background, backdrop, parentOpacity),
  )
}

function selectedRole(theme, selectors, ancestors, animatedSelectors, overlaySelector, textSelectors, reducedMotion) {
  const source = cssForTheme(theme)
  const selected = sourceOrderedPropertiesFor(source, selectors, ['background', 'color'])
  const selectedName = selectors[selectors.length - 1]
  expect(selected.background && selected.color, selectedName + ' must bind its selected colors')
  const textStyle = sourceOrderedPropertiesFor(source, textSelectors, ['color', 'opacity'])
  const effectiveColor = textStyle.color && textStyle.color !== 'inherit' ? textStyle.color : selected.color
  const textOpacity = textStyle.opacity === undefined ? 1 : Number(textStyle.opacity)
  expect(Number.isFinite(textOpacity) && textOpacity >= 0 && textOpacity <= 1,
    selectedName + ' effective text opacity must resolve between 0 and 1')
  const parentOpacity = ancestorOpacity(source, ancestors, animatedSelectors, reducedMotion)
  expect(parentOpacity === 1,
    selectedName + ' current ancestor chain must remain fully opaque in its stable state')
  return {
    background: parseHex(selected.background),
    foreground: parseHex(effectiveColor),
    effectiveColor,
    textOpacity,
    parentOpacity,
    backdrop: backdropFor(source, overlaySelector),
    ratio: renderedContrast(parseHex(effectiveColor), parseHex(selected.background),
      textOpacity, parentOpacity, backdropFor(source, overlaySelector)),
  }
}

function currentThemeTokens(css, selector, propertyNames) {
  const values = declarationsOf(firstRuleFor(css, selector))
  const result = {}
  propertyNames.forEach(name => {
    expect(values[name], selector + ' is missing ' + name)
    result[name] = values[name]
  })
  return result
}

const dmxWxml = read('pages/dmx-address/dmx-address.wxml')
const dmxWxss = read('pages/dmx-address/dmx-address.wxss')
const projectWxml = read('pages/records/project.wxml')
const projectWxss = read('pages/records/project.wxss')
const libraryWxml = read('pages/products/library.wxml')
const productDetailWxml = read('pages/products/detail.wxml')
const ledWxml = read('pages/led-screen/led-screen.wxml')
const ledWxss = read('pages/led-screen/led-screen.wxss')
const appWxss = read('app.wxss')
const layoutWxml = read('pages/dmx-layout/dmx-layout.wxml')
const layoutWxss = read('pages/dmx-layout/dmx-layout.wxss')
const layoutFactory = read('pages/dmx-layout/page-factory.js')
const layoutRenderer = read('pages/dmx-layout/layout-renderer.js')

check('dmx-current-picker-and-group-controls', () => {
  expect(dmxWxml.includes('class="context-picker"')
    && dmxWxml.includes('range="{{contextRows}}"')
    && dmxWxml.includes('value="{{contextIndex}}"')
    && dmxWxml.includes('bindchange="onLightingContextChange"')
    && dmxWxml.includes('{{contextName}}'),
  'current project/context selection must remain bound to the approved context picker')
  expect(/<picker class="allocation-picker"[^>]*range="\{\{allocationModeOptions\}\}"[^>]*value="\{\{allocationModeIndex\}\}"[^>]*bindchange="onAllocationModePickerChange"/.test(dmxWxml),
    'allocation mode must remain an actual picker bound to the current mode options and handler')
  expect(/wx:for="\{\{groupCards\}\}"[^>]*wx:key="_lightingGroupId"/.test(dmxWxml),
    'current group cards must retain stable identity')
  expect(dmxWxml.includes('group.primaryName') && dmxWxml.includes('group.rangeText'),
    'current group summary must show fixture identity and address range')
  expect(dmxWxml.includes('bindtap="openFloatingCard"') && dmxWxml.includes('catchtap="requestDeleteGroup"'),
    'current group actions must retain floating edit and delete entry points')
  expect(dmxWxml.includes('bindchange="onCardModeChange"')
    && dmxWxml.includes('bindinput="onCardQuantityInput"')
    && dmxWxml.includes('bindblur="onCardQuantityBlur"'),
  'library fixture mode and quantity edits must remain bound in the current group card')
  expect(dmxWxml.includes('class="fixture-control-label"') && dmxWxml.includes('class="select-chevron"'),
    'current control labels and picker affordance replace retired editor labels and arrow classes')
  expect(dmxWxml.includes('bindtap="openFixtureLayout"') && dmxWxml.includes('class="layout-entry-title">灯位图'),
    'the layout entry must remain a labeled current action')
  expect(dmxWxml.includes('bindtap="openModelPicker"')
    && dmxWxml.includes('group.channelCount}} CH')
    && dmxWxml.includes('group.fixtureCount}}')
    && dmxWxml.includes('selectedUniverseLabel}}域')
    && dmxWxml.includes('startAddressDisplay'),
  'current group and address controls must keep their mode, quantity, domain and address units explicit')
})

check('dmx-current-search-and-guide-bindings', () => {
  expect(dmxWxml.includes('fixtureSearchCategories')
    && dmxWxml.includes('fixture-category-active')
    && dmxWxml.includes('bindtap="selectFixtureCategory"')
    && dmxWxml.includes('{{item.count}}'),
  'category selection and result counts must stay bound to current search data')
  expect(dmxWxml.includes('fixture.primaryName') && dmxWxml.includes('fixture.model')
    && dmxWxml.includes('fixture.modeText') && dmxWxml.includes('bindtap="selectFixture"'),
  'search results must preserve name, model, mode and selection behavior')
  expect(/fixture\.model == fixtureSearchSelectedModel \? 'fixture-search-row-selected'/.test(dmxWxml)
    && dmxWxml.includes('class="fixture-search-check">✓'),
  'selected model remains visible through row treatment and a marker')
  expect(dmxWxml.includes('fixtureChannelGuide.channels')
    && dmxWxml.includes('item.actualAddress')
    && dmxWxml.includes('item.name')
    && dmxWxml.includes('item.summary')
    && dmxWxml.includes('fixtureChannelGuideDetail.ranges'),
  'channel guide retains actual address, function, summary and range details')
  expect(dmxWxml.includes('fixtureChannelGuide.source')
    && dmxWxml.includes('fixtureChannelGuide.sourcePageText')
    && dmxWxml.includes('fixtureChannelGuide.verificationStatus'),
  'channel guide keeps source, source page and verification state separate')
  expect(/fixture-channel-guide-detail-close[^>]*bindtap="closeFixtureChannelGuideDetail"/.test(dmxWxml),
    'channel detail must retain its own close action')
})

check('dmx-result-summary-and-theme-aliases', () => {
  expect(dmxWxml.includes('selectedOccupancyUniverse.segments')
    && dmxWxml.includes('selectedOccupancyUniverse.occupiedText')
    && dmxWxml.includes('nextAvailableAddress'),
  'current occupancy summary must show used space and the next address')
  expect(dmxWxml.includes('group.cardFixtureChips')
    && dmxWxml.includes("chip.checked ? 'address-chip-checked' : ''")
    && dmxWxml.includes('bindtap="toggleFixtureCheck"')
    && dmxWxml.includes('catchlongpress="openFixtureChannelGuide"'),
  'per-fixture address check and long-press guide behavior must remain available')
  const chipStyle = /class="address-chip(?:\s|\")[^\"]*"[^>]*style="([^\"]+)"/.exec(dmxWxml)
  expect(chipStyle && chipStyle[1].includes('--group-color:') && chipStyle[1].includes('--group-tint:')
    && !/(?:^|;)\s*(?:background(?:-color)?|border(?:-color)?)\s*:/.test(chipStyle[1]),
  'group styling must flow through custom properties, not a stale inline fill/border snapshot')
  expect(/\.address-chip\{[^}]*background:var\(--group-tint\)[^}]*color:var\(--group-color\)/.test(dmxWxss),
    'current chips must resolve their surface and color through the group tint tokens')
  expect(/\.layout-entry\{[^}]*color:var\(--text\)/.test(dmxWxss)
    && /\.layout-entry-title\{[^}]*color:var\(--text\)/.test(dmxWxss),
  'layout entry title must inherit the current local primary-text token')
})

check('dmx-current-theme-token-bindings', () => {
  const light = currentThemeTokens(dmxWxss, '.page-root', ['--page-bg', '--surface', '--control', '--text', '--muted'])
  const dark = currentThemeTokens(dmxWxss, '.page-root', ['--page-bg', '--surface', '--control', '--text', '--muted'])
  const darkRule = /@media\s*\(prefers-color-scheme:\s*dark\)\s*\{\s*\.page-root\s*\{([^{}]*)\}/.exec(dmxWxss)
  expect(darkRule, 'DMX dark local theme tokens must exist')
  const darkValues = declarationsOf(darkRule[1])
  ;['--page-bg', '--surface', '--control', '--text', '--muted'].forEach(name => {
    expect(darkValues[name], 'DMX dark local theme is missing ' + name)
    dark[name] = darkValues[name]
  })
  ;[light, dark].forEach(tokens => {
    ;['--page-bg', '--surface', '--control', '--text', '--muted'].forEach(name => parseHex(tokens[name]))
  })
})

check('dmx-selected-category-label-contrast', () => {
  expect(dmxWxml.includes("fixtureSearchCategory == item.label ? 'fixture-category-active' : ''"),
    'selected category class is not bound to the active category')
  ;['light', 'dark'].forEach(theme => {
    ;[false, true].forEach(reducedMotion => {
      const role = selectedRole(theme, ['.fixture-category', '.fixture-category-active'],
        [['.page-root'], ['.fixture-search-sheet'], ['.fixture-category-scroll'],
          ['.fixture-category-list'], ['.fixture-category', '.fixture-category-active']],
        ['.main-modal-bottom-sheet'], '.fixture-search-overlay', [], reducedMotion)
      expect(role.background[2] > role.background[1] && role.background[1] > role.background[0],
        theme + ' selected category must retain its blue visual identity')
      expect(role.ratio >= 4.5,
        theme + ' selected category after modal/backdrop compositing is ' + role.ratio.toFixed(8) + ':1')
    })
  })
  expect(contrast(parseHex('#fff'), parseHex('#007aff')) < 4.5,
    'the prior selected blue must remain a failing negative control')
})

check('dmx-selected-category-count-contrast', () => {
  expect(dmxWxml.includes("fixtureSearchCategory == item.label ? 'fixture-category-active' : ''")
    && /<text>\{\{item\.count\}\}<\/text>/.test(dmxWxml),
  'active category count must be inside the bound selected category')
  const genericOpacity = Number(finalPropertiesFor(dmxWxss, '.fixture-category text', ['opacity']).opacity)
  expect(genericOpacity === 0.75,
    'the generic category count opacity remains the existing .75 negative-control input')
  ;['light', 'dark'].forEach(theme => {
    ;[false, true].forEach(reducedMotion => {
      const role = selectedRole(theme, ['.fixture-category', '.fixture-category-active'],
        [['.page-root'], ['.fixture-search-sheet'], ['.fixture-category-scroll'],
          ['.fixture-category-list'], ['.fixture-category', '.fixture-category-active']],
        ['.main-modal-bottom-sheet'], '.fixture-search-overlay',
        ['.fixture-category text', '.fixture-category-active text'], reducedMotion)
      expect(role.background[2] > role.background[1] && role.background[1] > role.background[0],
        theme + ' selected category count must retain the active category blue background')
      expect(role.ratio >= 4.5,
        theme + ' selected category count after opacity compositing is ' + role.ratio.toFixed(8) + ':1')
      expect(renderedContrast(parseHex('#fff'), parseHex('#005eb8'), 0.75, 1, role.backdrop) < 4.5,
        theme + ' fixed white-on-blue .75-opacity count example must remain a failing negative control')
      expect(renderedContrast(role.foreground, role.background, role.textOpacity, 0.25, role.backdrop) < 4.5,
        theme + ' reduced parent opacity must be detected after backdrop compositing')
    })
  })
})

check('dmx-selected-channel-guide-contrast', () => {
  expect(dmxWxml.includes("fixtureChannelGuideDetail && fixtureChannelGuideDetail.channel == item.channel ? 'fixture-channel-guide-expand-selected' : ''"),
    'selected guide state is not bound to the current channel detail')
  ;['light', 'dark'].forEach(theme => {
    ;[false, true].forEach(reducedMotion => {
      const role = selectedRole(theme, ['.fixture-channel-guide-expand', '.fixture-channel-guide-expand-selected'],
        [['.page-root'], ['.fixture-channel-guide-overlay'], ['.fixture-channel-guide-sheet'], ['.fixture-channel-guide-scroll'],
          ['.fixture-channel-guide-list'], ['.fixture-channel-guide-row'],
          ['.fixture-channel-guide-row-head'], ['.fixture-channel-guide-expand', '.fixture-channel-guide-expand-selected']],
        ['.main-modal-backdrop', '.main-modal-panel'], '.fixture-channel-guide-overlay', [], reducedMotion)
      expect(role.background[2] > role.background[1] && role.background[1] > role.background[0],
        theme + ' selected guide must retain its blue visual identity')
      expect(role.ratio >= 4.5,
        theme + ' selected channel-guide label after modal/backdrop compositing is ' + role.ratio.toFixed(8) + ':1')
    })
  })
  expect(contrast(parseHex('#fff'), parseHex('#007aff')) < 4.5,
    'the prior selected blue must remain a failing negative control')
})

check('records-current-summary-theme-and-report-action', () => {
  expect(projectWxml.includes('class="interior-report-button"')
    && projectWxml.includes('bindtap="openProjectReport"'),
  'project report action must remain present and operable')
  expect(projectWxml.includes('recordGroups') && projectWxml.includes('group.label')
    && projectWxml.includes('record.moduleLabel') && projectWxml.includes('record.summary')
    && projectWxml.includes('record.projectNote'),
  'project records must retain module grouping, module label and saved summary/note content')
  expect(projectWxml.includes('class="interior-module-chip"')
    && projectWxml.includes('class="interior-item-subtitle"'),
  'current module and record summary roles must remain visible in the current row structure')
  expect(/\.interior-report-button\{[^}]*background:var\(--theme-control\)[^}]*color:var\(--theme-accent-text\)/.test(projectWxss)
    && /\.interior-primary-button\{[^}]*background:var\(--theme-primary-fill\)[^}]*color:#fff/.test(projectWxss),
  'current project report and primary actions must use theme tokens')
  const darkStart = projectWxss.indexOf('@media (prefers-color-scheme: dark)')
  const lightProjectWxss = darkStart < 0 ? projectWxss : projectWxss.slice(0, darkStart)
  const darkProjectWxss = darkStart < 0 ? '' : projectWxss.slice(darkStart)
  ;['.interior-group-title', '.interior-module-chip', '.interior-item-subtitle', '.interior-item-time'].forEach(selector => {
    const lightColor = finalPropertiesFor(lightProjectWxss, selector, ['color']).color
    expect(/^var\(--theme-(?:text|text-secondary|text-tertiary|accent-text)\)$/.test(lightColor || ''),
      'current project record role must retain its final light theme text token: ' + selector)
    const darkColor = finalPropertiesFor(darkProjectWxss, selector, ['color']).color
    if (darkColor) {
      expect(/^var\(--theme-(?:text|text-secondary|text-tertiary|accent-text)\)$/.test(darkColor),
        'current project record role must retain its final dark theme text token: ' + selector)
    }
  })
  const reportBase = finalPropertiesFor(lightProjectWxss, '.interior-report-button', ['background', 'color'])
  const reportDark = { ...reportBase, ...finalPropertiesFor(darkProjectWxss, '.interior-report-button', ['background', 'color']) }
  expect(reportBase.background === 'var(--theme-control)' && reportBase.color === 'var(--theme-accent-text)',
    'project report action must keep the approved neutral control surface and accent label')
  expect(reportDark.background === 'var(--theme-control)' && reportDark.color === 'var(--theme-text)',
    'dark project report action must use the readable primary text token on the neutral control')
})

check('dmx-current-selection-and-theme-state-semantics', () => {
  expect(dmxWxml.includes("fixture.model == fixtureSearchSelectedModel ? 'fixture-search-row-selected' : ''")
    && /\.fixture-search-row-selected\{[^}]*background:var\(--control\)/.test(dmxWxss),
  'selected search model must use the neutral current-theme surface')
  expect(dmxWxml.includes("chip.checked ? 'address-chip-checked' : ''")
    && /<text wx:if="\{\{chip\.checked\}\}" class="chip-check"[^>]*>✓<\/text>/.test(dmxWxml)
    && /\.address-chip-checked\{[^}]*border-color:var\(--group-color\)/s.test(dmxWxss),
  'checked addresses must retain their state binding, visible check marker, and group-linked distinction')
  expect(dmxWxml.includes('fixture.batchSelected ? \'✓\' : \'+\'')
    && dmxWxml.includes('class="fixture-result-name"')
    && /\.fixture-result-name\{[^}]*color:var\(--text\)/.test(dmxWxss)
    && /\.fixture-result-model\{[^}]*color:var\(--muted\)/.test(dmxWxss)
    && /\.fixture-name\{[^}]*color:var\(--text\)/.test(dmxWxss),
  'current search labels and batch markers must keep primary identity and metadata roles')
  expect(dmxWxml.includes('fixtureChannelGuide.source') && dmxWxml.includes('fixtureChannelGuide.sourcePageText')
    && /\.fixture-channel-guide-source\{[^}]*color:var\(--muted\)/.test(dmxWxss),
  'channel guide source and page reference must remain present with the current local text token')
})

check('project-comparison-retirement-library-comparison-retained', () => {
  expect(!projectWxml.includes('comparison-') && !projectWxss.includes('.comparison-'),
    'project-level comparison selectors must remain retired per revision-2 acceptance')
  expect(libraryWxml.includes('product-comparison-table')
    && libraryWxml.includes('product-comparison-head')
    && libraryWxml.includes('product-comparison-different'),
  'product library comparison remains a separate active feature')
})

check('speaker-detail-spec-source-after-profile-removal', () => {
  expect(productDetailWxml.includes('product.maximumSplText')
    && productDetailWxml.includes('product.coverageText')
    && productDetailWxml.includes('product.source')
    && productDetailWxml.includes('product.sourcePageText'),
  'speaker detail must keep reliable specification and source fields')
  expect(!productDetailWxml.includes('product.profile.roleText') && !productDetailWxml.includes('coverage-role'),
    'removed meeting-room recommendation profiles must not reappear as product detail roles')
})

check('led-current-dimension-labels-and-theme', () => {
  expect(ledWxml.includes('class="screen-dimension">{{result.dimensionText}}')
    && ledWxml.includes('class="screen-layout">{{result.columns}}')
    && ledWxml.includes('外框（含包边）')
    && ledWxml.includes('result.installedDimensionText'),
  'LED dimensions must show net size, grid layout and installed frame size')
  expect(ledWxml.includes('wallWidthText') && ledWxml.includes('wallHeightText')
    && ledWxml.includes('class="diagram-net-label"')
    && ledWxml.includes('result.horizontalMarginMeters')
    && ledWxml.includes('result.actualTopMarginMeters')
    && ledWxml.includes('result.actualBottomMarginMeters'),
  'LED diagram must retain wall, net-screen and installation-clearance labels')
  ;['.screen-dimension', '.screen-layout', '.screen-install-dimension', '.wall-width-label', '.diagram-net-label', '.diagram-clearances'].forEach(selector => {
    expect(ruleFor(ledWxss, selector).includes('var(--theme-text')
      || ruleFor(ledWxss, selector).includes('var(--theme-accent-text'),
    'current dimension label must keep a theme text token: ' + selector)
  })
})

check('global-theme-text-token-definitions-and-project-roles', () => {
  const light = declarationsOf(firstRuleFor(appWxss, 'page'))
  const darkRule = /@media\s*\(prefers-color-scheme:\s*dark\)\s*\{\s*page\s*\{([^{}]*)\}/.exec(appWxss)
  expect(darkRule, 'global dark theme declaration must exist')
  const dark = { ...light, ...declarationsOf(darkRule[1]) }
  ;[[light, 'light'], [dark, 'dark']].forEach(([tokens, mode]) => {
    ;[
      '--theme-text', '--theme-text-secondary', '--theme-text-tertiary', '--theme-surface',
      '--theme-control', '--theme-accent-text', '--theme-primary-fill',
    ].forEach(name => {
      expect(tokens[name], mode + ' global theme token is missing ' + name)
      if (/^--theme-(?:text|text-secondary|text-tertiary|surface|control|accent-text|primary-fill)$/.test(name)
        && /^#/.test(tokens[name])) parseHex(tokens[name])
    })
  })
})

check('layout-direct-drag-copy-and-six-state-canvas-contract', () => {
  expect(!layoutWxml.includes('DMX LAYOUT')
    && !layoutWxml.includes('用位置、分组和地址，把编址结果变成现场可核对的舞台图。')
    && !layoutWxml.includes('选择灯具组，按住地址拖到灯位'),
  'retired promotional copy and obsolete static placement wording must not replace the current interaction cue')
  const sideNote = '侧光同一位置的展开仅为地址辨识，不代表安装高度。'
  expect(layoutWxml.includes('wx:if="{{manipulationText}}"')
    && layoutWxml.includes('{{manipulationText}}')
    && layoutFactory.includes('拖动到目标灯杆，松手吸附')
    && !layoutWxml.includes(sideNote)
    && layoutRenderer.includes(sideNote),
  'current direct-drag cue and renderer-only side-light height clarification must remain available')
  const canvasTags = Array.from(layoutWxml.matchAll(/<canvas\b[^>]*>/g), match => match[0])
  const mainCanvases = canvasTags.filter(tag => /\bid="dmxLayoutCanvas"/.test(tag))
  const exportCanvases = canvasTags.filter(tag => /\bid="dmxLayoutExportCanvas"/.test(tag))
  expect(mainCanvases.length === 1 && exportCanvases.length === 1,
    'one 2D stage canvas and one independent export canvas must be declared')
  expect(/\btype="2d"/.test(mainCanvases[0]) && /\btype="2d"/.test(exportCanvases[0]),
    'both declared canvases must use the supported 2D renderer')
  const mainCondition = /\bwx:if="\{\{([^}]+)\}\}"/.exec(mainCanvases[0])
  expect(mainCondition, 'stage canvas must retain its occlusion condition')
  const states = ['layoutPanelVisible', 'locateVisible', 'placementVisible', 'previewVisible', 'isGeneratingImage', 'exportCanvasActive']
  const condition = mainCondition[1]
  expect(/^[\w\s!&|()]+$/.test(condition), 'stage canvas condition must remain a boolean expression over state names')
  const identifiers = condition.match(/[A-Za-z_$][\w$]*/g) || []
  expect(identifiers.length === states.length && states.every(state => identifiers.includes(state)),
    'stage canvas condition must use each of the six approved occlusion states exactly')
  const mountsWhen = new Function(...states, 'return (' + condition + ')')
  for (let mask = 0; mask < (1 << states.length); mask += 1) {
    const values = states.map((state, index) => (mask & (1 << index)) !== 0)
    expect(Boolean(mountsWhen(...values)) === (mask === 0),
      'stage canvas condition must mount only when all six occlusion states are inactive; mask=' + mask)
  }
  expect(/wx:if="\{\{exportCanvasActive\}\}"/.test(exportCanvases[0])
    && /\.export-canvas\{[^}]*pointer-events:none/.test(layoutWxss),
  'export canvas must mount only for export and stay noninteractive')
  expect(layoutWxml.includes('bindtouchcancel="onCanvasTouchCancel"'),
    'stage canvas must keep touch-cancel handling')
})

const result = { passed: passes, failures }
if (log) {
  console.log('Closeout 8 semantic contract checks: ' + passes.length + ' passed, ' + failures.length + ' failed')
  if (failures.length) console.error(JSON.stringify({ failures }, null, 2))
}
return result
}

module.exports = { runCloseout8Contracts }

if (require.main === module) {
  const result = runCloseout8Contracts()
  if (result.failures.length) process.exitCode = 1
}
