'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')

const PAGES = [
  {
    name: 'audio-wiring', file: 'pages/audio-wiring/wiring-overlays.wxml',
    keyboardClass: 'project-keyboard-open',
    rootClass: 'project-sheet', modifier: "{{projectDialogStep == 'select' ? 'project-select-sheet' : ''}}",
    select: { tag: 'view', condition: "wx:if=\"{{projectDialogStep == 'select'}}\"", bodyClass: 'project-select-body' },
    search: { className: 'project-search', handler: 'onProjectSearch' },
    list: { items: 'filteredProjects', visible: 'filteredProjects.length', handler: 'selectProjectTarget', event: 'bindtap', rowTag: 'view', dataAttr: 'data-id', dataValue: '{{item.id}}', showScrollbar: 'filteredProjects.length > 1' },
    hint: "filteredProjects.length > 1 && !projectKeyboardOpen",
    statuses: ['projectLoadFailed', '读取项目列表失败', '没有匹配的项目', '还没有现场项目', 'projectError'],
    emptyOutsideList: ['没有匹配的项目', '还没有现场项目'],
    footerClass: 'project-footer', newHandlers: ['retryProjectRead', 'openProjectCreateForm'],
    nextSteps: [
      "<scroll-view wx:elif=\"{{projectDialogStep == 'create'}}\"",
      "<scroll-view wx:elif=\"{{projectDialogStep == 'confirm'}}\"",
      "<scroll-view wx:elif=\"{{projectDialogStep == 'success'}}\"",
    ],
  },
  {
    name: 'cable', file: 'pages/cable/cable-overlays.wxml',
    keyboardClass: 'project-keyboard-open',
    rootClass: 'project-sheet', modifier: "{{projectDialogStep == 'select' ? 'project-select-sheet' : ''}}",
    select: { tag: 'view', condition: "wx:if=\"{{projectDialogStep == 'select'}}\"", bodyClass: 'project-select-body' },
    search: { id: 'projectSearchText', handler: 'onProjectSearch' },
    list: { items: 'filteredProjects', visible: 'filteredProjects.length', handler: 'selectProjectTarget', event: 'bindtap', rowTag: 'view', dataAttr: 'data-id', dataValue: '{{item.id}}', showScrollbar: 'filteredProjects.length > 1' },
    hint: "filteredProjects.length > 1 && !projectKeyboardOpen",
    statuses: ['projectLoadFailed', '读取项目列表失败', '没有匹配的项目', '还没有现场项目', 'projectError'],
    emptyOutsideList: ['没有匹配的项目', '还没有现场项目'],
    footerClass: 'project-footer', newHandlers: ['retryProjectRead', 'openProjectCreateForm'],
    nextSteps: [
      "<scroll-view wx:elif=\"{{projectDialogStep == 'create'}}\"",
      "<scroll-view wx:elif=\"{{projectDialogStep == 'confirm'}}\"",
      "<scroll-view wx:elif=\"{{projectDialogStep == 'success'}}\"",
    ],
  },
  {
    name: 'camera', file: 'pages/camera/camera-overlays.wxml', rootClass: 'camera-project-sheet',
    keyboardClass: 'camera-project-keyboard-open',
    modifier: "{{projectDialogStep == 'select' ? 'project-select-sheet' : ''}}",
    select: { tag: 'view', condition: "wx:if=\"{{projectDialogStep == 'select'}}\"", bodyClass: 'project-select-body' },
    search: { id: 'projectSearchText', handler: 'onCameraProjectSearch' },
    list: { items: 'filteredProjects', visible: 'filteredProjects.length', handler: 'selectCameraProjectTarget', event: 'bindtap', rowTag: 'view', dataAttr: 'data-id', dataValue: '{{item.id}}', showScrollbar: 'filteredProjects.length > 1' },
    hint: "filteredProjects.length > 1 && !projectKeyboardOpen",
    statuses: ['projectLoadFailed', '读取项目列表失败', '没有匹配的项目', '还没有现场项目', 'projectError'],
    emptyOutsideList: ['没有匹配的项目', '还没有现场项目'],
    footerClass: 'camera-project-footer', newHandlers: ['retryCameraProjectRead', 'openCameraProjectCreateForm'],
    nextSteps: [
      "<scroll-view wx:elif=\"{{projectDialogStep == 'create'}}\"",
      "<scroll-view wx:elif=\"{{projectDialogStep == 'confirm'}}\"",
      "<scroll-view wx:elif=\"{{projectDialogStep == 'success'}}\"",
    ],
  },
  {
    name: 'gain', file: 'pages/gain-structure/gain-overlays.wxml', rootClass: 'project-panel',
    keyboardClass: 'project-keyboard-open',
    modifier: "{{projectStep === 'select' ? 'project-select-sheet' : ''}}",
    select: { tag: 'view', condition: "wx:if=\"{{projectStep === 'select'}}\"", bodyClass: 'project-select-body' },
    search: { className: 'selector-search', handler: 'onProjectSearch' },
    list: { items: 'projectItems', visible: 'projectItems.length', handler: 'chooseProject', event: 'bindtap', rowTag: 'button', dataAttr: 'data-id', dataValue: '{{item.id}}', showScrollbar: 'projectItems.length > 1', ariaPressed: '{{projectTargetId === item.id}}' },
    hint: 'projectItems.length > 1 && !projectKeyboardActive',
    statuses: ["projectLoadState === 'loading'", "projectLoadState === 'error'", '没有匹配项目', '还没有项目', 'projectSaveError'],
    footerClass: 'project-footer', footerCondition: "{{projectStep === 'select'}}", newHandlers: ['beginNewProject'],
    nextSteps: [
      "<scroll-view wx:elif=\"{{projectStep === 'create'}}\"",
      "<scroll-view wx:elif=\"{{projectStep === 'details'}}\"",
      "<scroll-view wx:elif=\"{{projectStep === 'success'}}\"",
    ],
  },
  {
    name: 'limiter', file: 'pages/limiter/limiter-overlays.wxml', rootClass: 'project-panel',
    keyboardClass: 'project-keyboard-open',
    modifier: "{{projectStep === 'select' ? 'project-select-sheet' : ''}}",
    select: { tag: 'view', condition: "wx:if=\"{{projectStep === 'select'}}\"", bodyClass: 'project-select-body' },
    search: { className: 'selector-search', handler: 'onProjectSearch' },
    list: { items: 'projectItems', visible: 'projectItems.length > 0', handler: 'chooseProject', event: 'bindtap', rowTag: 'view', dataAttr: 'data-id', dataValue: '{{item.id}}', showScrollbar: 'projectItems.length > 1' },
    hint: 'projectItems.length > 1 && !projectKeyboardActive',
    statuses: ["projectLoadState === 'loading'", "projectLoadState === 'error'", '没有匹配项目', '还没有项目', 'projectSaveError'],
    footerClass: 'project-footer', footerCondition: "{{projectStep === 'select'}}", newHandlers: ['beginNewProject'],
    nextSteps: [
      "<scroll-view wx:elif=\"{{projectStep === 'create'}}\"",
      "<scroll-view wx:elif=\"{{projectStep === 'details'}}\"",
      '<scroll-view wx:else',
    ],
  },
  {
    name: 'LED', file: 'pages/led-screen/led-overlays.wxml', rootClass: 'led-project-sheet',
    keyboardClass: 'project-keyboard-open',
    modifier: "{{projectDialogStep == 'select' ? 'project-select-sheet' : ''}}",
    select: { tag: 'view', condition: "wx:if=\"{{projectDialogStep == 'select'}}\"", bodyClass: 'project-select-body' },
    search: { id: 'ledProjectSearchText', handler: 'onProjectSearch' },
    list: { items: 'filteredProjects', visible: 'filteredProjects.length', handler: 'selectProjectTarget', event: 'bindtap', rowTag: 'view', dataAttr: 'data-id', dataValue: '{{item.id}}', showScrollbar: 'filteredProjects.length > 1' },
    hint: "filteredProjects.length > 1 && !projectKeyboardOpen",
    statuses: ['projectLoadFailed', '读取项目列表失败', '没有匹配的项目', '还没有现场项目', 'projectError'],
    emptyOutsideList: ['没有匹配的项目', '还没有现场项目'],
    footerClass: 'led-project-footer', newHandlers: ['retryProjectRead', 'openProjectCreateForm'],
    nextSteps: [
      "<scroll-view wx:elif=\"{{projectDialogStep == 'create'}}\"",
      "<scroll-view wx:elif=\"{{projectDialogStep == 'confirm'}}\"",
      "<scroll-view wx:elif=\"{{projectDialogStep == 'success'}}\"",
    ],
  },
  {
    name: 'SPL', file: 'pages/spl/spl.wxml', rootClass: 'spl-sheet',
    keyboardClass: 'project-keyboard-open',
    modifier: "{{projectStep === 'select' ? 'project-select-sheet' : ''}}",
    select: { tag: 'view', condition: "wx:if=\"{{projectStep === 'select'}}\"", bodyClass: 'project-select-body' },
    search: { className: 'project-search', handler: 'onProjectSearch' },
    list: { items: 'projectItems', visible: 'projectItems.length', handler: 'chooseProject', event: 'bindtap', rowTag: 'button', dataAttr: 'data-id', dataValue: '{{item.id}}', showScrollbar: 'projectItems.length > 1', ariaPressed: '{{projectTargetId === item.id}}' },
    hint: 'projectItems.length > 1 && !projectKeyboardActive',
    statuses: ["projectLoadState === 'loading'", "projectLoadState === 'error'", '没有匹配项目', '还没有项目', 'projectSaveError'],
    footerClass: 'project-footer', footerCondition: "{{projectStep === 'select'}}", newHandlers: ['beginNewProject'],
    nextSteps: [
      "<scroll-view wx:elif=\"{{projectStep === 'create'}}\"",
      "<scroll-view wx:elif=\"{{projectStep === 'details'}}\"",
      "<scroll-view wx:elif=\"{{projectStep === 'success'}}\"",
    ],
  },
  {
    name: 'DMX address', file: 'pages/dmx-address/dmx-address.wxml', rootClass: 'save-project-sheet',
    modifier: "{{!showNewProjectNameInput ? 'project-select-sheet' : ''}}",
    dmx: true,
    list: { items: 'projectSaveRows', visible: '!showNewProjectNameInput && projectSaveRows.length', handler: 'onSaveToExistingProject', event: 'catchtap', rowTag: 'view', dataAttr: 'data-project-id', dataValue: '{{project.id}}', showScrollbar: 'projectSaveRows.length > 1' },
  },
]

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8')
}

function parseTag(source, start) {
  let index = start + 1
  const closing = source[index] === '/'
  if (closing) index += 1
  const nameStart = index
  while (index < source.length && /[A-Za-z0-9_:-]/.test(source[index])) index += 1
  if (index === nameStart) return null
  const name = source.slice(nameStart, index)
  let quote = ''
  for (; index < source.length; index += 1) {
    const char = source[index]
    if (quote) {
      if (char === quote) quote = ''
      continue
    }
    if (char === '"' || char === "'") quote = char
    else if (char === '>') break
  }
  if (index >= source.length) throw new Error(`Unclosed tag <${name}>`)
  const raw = source.slice(start, index + 1)
  return { name, closing, selfClosing: !closing && /\/\s*>$/.test(raw), start, end: index + 1, raw }
}

function tags(source) {
  const result = []
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] !== '<') continue
    if (source.startsWith('<!--', index)) {
      const end = source.indexOf('-->', index + 4)
      if (end < 0) throw new Error('Unclosed WXML comment')
      index = end + 2
      continue
    }
    const tag = parseTag(source, index)
    if (!tag) continue
    result.push(tag)
    index = tag.end - 1
  }
  return result
}

function attr(tag, name) {
  return tag.raw.match(new RegExp(`(?:^|\\s)${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}="([^"]*)"`))?.[1]
}

function classList(tag) {
  return (attr(tag, 'class') || '').split(/\s+/).filter(Boolean)
}

function findElement(source, tagName, predicate, label) {
  const all = tags(source)
  for (let index = 0; index < all.length; index += 1) {
    const opening = all[index]
    if (opening.closing || opening.name !== tagName || !predicate(opening)) continue
    if (opening.selfClosing) return { ...opening, text: opening.raw, content: '' }
    const stack = []
    for (let endIndex = index; endIndex < all.length; endIndex += 1) {
      const current = all[endIndex]
      if (current.closing) {
        const expected = stack.pop()
        assert.equal(current.name, expected, `${label || tagName}: malformed WXML nesting`)
        if (stack.length === 0) {
          return {
            ...opening,
            end: current.end,
            text: source.slice(opening.start, current.end),
            content: source.slice(opening.end, current.start),
          }
        }
      } else if (!current.selfClosing) {
        stack.push(current.name)
      }
    }
    throw new Error(`${label || tagName}: matching closing tag not found`)
  }
  throw new Error(`${label || tagName}: opening tag not found`)
}

function assertExactlyOne(source, pattern, message) {
  const matches = [...source.matchAll(pattern)]
  assert.equal(matches.length, 1, `${message}: expected one match, found ${matches.length}`)
  return matches[0]
}

function assertRootModifier(source, spec) {
  const matches = tags(source).filter(tag => !tag.closing && tag.name === 'view'
    && classList(tag).includes(spec.rootClass)
    && classList(tag).includes('result-save'))
  assert.equal(matches.length, 1, `${spec.name}: expected exactly one result-save sheet root`)
  const root = matches[0]
  assert.ok((attr(root, 'class') || '').includes(spec.modifier), `${spec.name}: select modifier must be conditional on selection mode`)
  assert.equal((source.match(/project-select-sheet/g) || []).length, 1, `${spec.name}: modifier must occur only on the save-sheet root`)
  return root
}

function assertListBranch(source, branch, spec) {
  const branchTags = tags(branch.text)
  const scrolls = branchTags.filter(tag => !tag.closing && tag.name === 'scroll-view')
  assert.equal(scrolls.length, 1, `${spec.name}: selection must have exactly one project scroll-view`)
  const list = scrolls[0]
  assert.ok(classList(list).includes('project-select-list'), `${spec.name}: project scroller must use project-select-list`)
  assert.ok(Object.hasOwn(Object.fromEntries([...list.raw.matchAll(/(?:^|\s)([\w:-]+)(?:="[^"]*")?/g)].map(match => [match[1], true])), 'scroll-y'), `${spec.name}: project list must scroll vertically`)
  assert.equal(attr(list, 'wx:if'), `{{${spec.list.visible}}}`, `${spec.name}: project list visibility condition changed`)
  assert.equal(attr(list, 'show-scrollbar'), `{{${spec.list.showScrollbar}}}`, `${spec.name}: scrollbar must follow multi-item list state`)

  const rows = tags(branch.text).filter(tag => !tag.closing && attr(tag, 'wx:for') === `{{${spec.list.items}}}`)
  assert.equal(rows.length, 1, `${spec.name}: expected one row loop for ${spec.list.items}`)
  const row = rows[0]
  assert.equal(attr(row, 'wx:key'), 'id', `${spec.name}: project rows must key by id`)
  assert.ok(classList(row).includes('project-select-row'), `${spec.name}: project row must use full viewport row class`)
  assert.equal(attr(row, spec.list.event), spec.list.handler, `${spec.name}: existing project selection handler changed`)
  assert.equal(attr(row, spec.list.dataAttr), spec.list.dataValue, `${spec.name}: project row id data binding changed`)
  if (spec.list.ariaPressed) {
    assert.equal(attr(row, 'aria-pressed'), spec.list.ariaPressed, `${spec.name}: selected row accessibility state changed`)
  }

  const hints = branchTags.filter(tag => !tag.closing && classList(tag).includes('project-select-hint'))
  assert.equal(hints.length, 1, `${spec.name}: selection must provide one conditional scroll hint`)
  assert.equal(attr(hints[0], 'wx:if'), `{{${spec.hint}}}`, `${spec.name}: scroll hint condition changed`)
  const hint = findElement(branch.text, hints[0].name, tag => tag.start === hints[0].start, `${spec.name} scroll hint`)
  assert.match(hint.content, /上下滑动查看更多/, `${spec.name}: scroll hint copy changed`)

  if (spec.emptyOutsideList) {
    const listStart = branch.text.indexOf(list.raw)
    const listEnd = branch.text.indexOf('</scroll-view>', listStart) + '</scroll-view>'.length
    for (const marker of spec.emptyOutsideList) {
      assert.ok(branch.text.indexOf(marker, listEnd) >= listEnd, `${spec.name}: ${marker} must stay outside the list scroller`)
    }
  }
}

function assertStandardPage(spec) {
  const source = read(spec.file)
  const root = assertRootModifier(source, spec)
  if (spec.keyboardClass) {
    assert.ok((attr(root, 'class') || '').includes(`'${spec.keyboardClass}'`), `${spec.name}: save sheet must expose its keyboard-state class`)
  }
  const branch = findElement(source, spec.select.tag, tag => (tag.raw.includes(spec.select.condition)
    && (attr(tag, 'class') || '').split(/\s+/).includes(spec.select.bodyClass)), `${spec.name} selection branch`)
  assertListBranch(source, branch, spec)

  const searchInputs = tags(branch.text).filter(tag => !tag.closing && tag.name === 'input' && attr(tag, 'bindinput') === spec.search.handler)
  assert.equal(searchInputs.length, 1, `${spec.name}: select state must have one search input with the existing handler`)
  const search = searchInputs[0]
  if (spec.search.id) assert.equal(attr(search, 'id'), spec.search.id, `${spec.name}: search input id changed`)
  if (spec.search.className) assert.ok(classList(search).includes(spec.search.className), `${spec.name}: expected ${spec.search.className} search input`)
  assert.ok(search.start < branch.text.indexOf('<scroll-view'), `${spec.name}: search must remain above the project list`)
  assert.ok(!branch.text.includes('scroll-into-view'), `${spec.name}: selection wrapper must not become a second scroller`)
  for (const status of spec.statuses) assert.ok(branch.text.includes(status), `${spec.name}: selection state must preserve ${status}`)

  const footerTags = tags(source).filter(tag => !tag.closing && tag.name === 'view'
    && classList(tag).includes(spec.footerClass) && classList(tag).includes('result-footer')
    && (!spec.footerCondition || attr(tag, 'wx:if') === spec.footerCondition))
  assert.equal(footerTags.length, 1, `${spec.name}: expected one selection action footer`)
  const footer = findElement(source, 'view', tag => tag.start === footerTags[0].start, `${spec.name} action footer`)
  assert.ok(footer.start > branch.end, `${spec.name}: action footer must remain outside scrolling selection content`)
  for (const handler of spec.newHandlers) assert.ok(footer.text.includes(`bindtap="${handler}"`), `${spec.name}: selection retry/new-project action ${handler} missing`)

  for (const marker of spec.nextSteps) {
    const step = source.indexOf(marker, branch.end)
    assert.ok(step > branch.end, `${spec.name}: non-select branch ${marker} must remain outside select content`)
    assert.ok(/<scroll-view\b[^>]*scroll-y/.test(source.slice(step, step + 500)), `${spec.name}: non-select branch must keep its scrollable body`)
  }
}

function assertDmxPage(spec) {
  const source = read(spec.file)
  assertRootModifier(source, spec)
  const sheet = findElement(source, 'view', tag => classList(tag).includes(spec.rootClass)
    && classList(tag).includes('result-save') && (attr(tag, 'wx:if') || '').includes('showSaveNewProject'), 'DMX save sheet')
  const sheetTags = tags(sheet.text)
  const scrolls = sheetTags.filter(tag => !tag.closing && tag.name === 'scroll-view')
  assert.equal(scrolls.length, 1, 'DMX save selection must have exactly one project scroll-view')
  const list = scrolls[0]
  assert.ok(classList(list).includes('project-select-list') && classList(list).includes('project-select-list-with-status'), 'DMX list must use the status-row variant')
  assert.ok(list.raw.includes('scroll-y'), 'DMX project list must scroll vertically')
  assert.equal(attr(list, 'wx:if'), `{{${spec.list.visible}}}`, 'DMX project list visibility condition changed')
  assert.equal(attr(list, 'show-scrollbar'), `{{${spec.list.showScrollbar}}}`, 'DMX scrollbar must follow multi-item state')
  const rows = tags(sheet.text).filter(tag => !tag.closing && attr(tag, 'wx:for') === `{{${spec.list.items}}}`)
  assert.equal(rows.length, 1, 'DMX selection must iterate the save rows once')
  const row = rows[0]
  assert.equal(attr(row, 'wx:for-item'), 'project', 'DMX row item name changed')
  assert.equal(attr(row, 'wx:key'), 'id', 'DMX project rows must key by id')
  assert.ok(classList(row).includes('project-select-row'), 'DMX row must use the full viewport row class')
  assert.equal(attr(row, spec.list.event), spec.list.handler, 'DMX existing project-save handler changed')
  assert.equal(attr(row, spec.list.dataAttr), spec.list.dataValue, 'DMX project id binding changed')
  const rowBlock = findElement(sheet.text, row.name, tag => tag.start === row.start, 'DMX project row')
  assert.ok(rowBlock.text.includes('project.hasLighting'), 'DMX row must retain the existing lighting-status content')
  assert.ok(!sheet.text.includes('<input') || sheet.text.indexOf('<input') > sheet.text.indexOf('class="project-select-hint"'), 'DMX new-project input belongs to the new-project branch, not the selection list')
  assert.ok(sheet.text.includes('pendingProjectSaveId') && sheet.text.includes('retryProjectSave'), 'DMX pending-save retry must remain available')
  assert.ok(sheet.text.includes('projectSaveError'), 'DMX save error must remain visible')
  const hint = findElement(sheet.text, 'view', tag => classList(tag).includes('project-select-hint'), 'DMX scroll hint')
  assert.equal(attr(tags(hint.text).find(tag => !tag.closing), 'wx:if'), `{{!showNewProjectNameInput && ${spec.list.items}.length > 1}}`, 'DMX hint must appear only for multiple projects while selecting')
  assert.match(hint.content, /上下滑动查看更多/, 'DMX scroll hint copy changed')
  const newEntry = findElement(sheet.text, 'view', tag => classList(tag).includes('new-project-entry'), 'DMX create-project entry')
  assert.equal(attr(tags(newEntry.text).find(tag => !tag.closing), 'bindtap'), 'onNewProjectNameEntry', 'DMX new-project entry handler changed')
  assert.ok(sheet.text.includes('class="new-project-inline"') && sheet.text.includes('bindinput="onProjectNameInput"')
    && sheet.text.includes('bindtap="saveLightingAsNewProject"'), 'DMX new-project form path must remain available')
  assert.ok(!sheet.text.includes('projectSearchText') && !sheet.text.includes('project-search'), 'DMX save selection has no search field by design')
}

function findRule(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = css.match(new RegExp(`(?:^|\\n)${escaped}\\{([^}]*)\\}`))
  assert.ok(match, `Missing CSS rule: ${selector}`)
  return new Set(match[1].split(';').filter(Boolean).map(declaration => declaration.trim()))
}

function assertRowSizing() {
  const css = read('app.wxss')
  const standard = findRule(css, '.result-sheet.result-save.result-save.project-select-sheet.project-select-sheet')
  assert.ok(standard.has('--project-select-row:96px'), 'standard project row height must remain 96px')
  const list = findRule(css, '.result-sheet.result-save.result-save.project-select-sheet.project-select-sheet .project-select-list')
  assert.ok(list.has('height:var(--project-select-row)'), 'project list height must use the shared row size')
  assert.ok(list.has('max-height:var(--project-select-row)'), 'project list max-height must use the shared row size')
  const row = findRule(css, '.result-sheet.result-save.result-save.project-select-sheet.project-select-sheet .project-select-row')
  assert.ok(row.has('min-height:var(--project-select-row)'), 'project row min-height must use the shared row size')
  const status = findRule(css, '.result-sheet.result-save.result-save.project-select-sheet.project-select-sheet .project-select-list-with-status')
  assert.ok(status.has('--project-select-row:112px'), 'DMX project rows with status must remain 112px')
}

function cssRules(source) {
  const css = source.replace(/\/\*[\s\S]*?\*\//g, '')
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(match => ({
    selectors: match[1].split(',').map(selector => selector.trim()).filter(Boolean),
    declarations: new Set(match[2].split(';').map(declaration => declaration.trim()).filter(Boolean)),
  }))
}

function assertCssDeclarations(rules, selector, declarations, label) {
  const rule = rules.find(candidate => candidate.selectors.includes(selector))
  assert.ok(rule, `${label}: missing selector ${selector}`)
  for (const declaration of declarations) {
    assert.ok(rule.declarations.has(declaration), `${label}: ${selector} must include ${declaration}`)
  }
}

function assertKeyboardLayout() {
  const rules = cssRules(read('app.wxss'))
  const keyboardModes = [
    {
      name: 'standard',
      panel: '.result-sheet.result-save.project-select-sheet.project-keyboard-open',
      rowSize: '.result-sheet.result-save.result-save.project-select-sheet.project-keyboard-open',
      body: '.result-sheet.result-save.project-select-sheet.project-keyboard-open .project-select-body',
      list: '.result-sheet.result-save.result-save.project-select-sheet.project-keyboard-open .project-select-list',
      resultHeader: '.result-sheet.result-save.result-save.project-select-sheet.project-keyboard-open .result-header',
      sheetHeader: '.result-sheet.result-save.project-select-sheet.project-keyboard-open .sheet-header',
    },
    {
      name: 'camera',
      panel: '.result-sheet.result-save.project-select-sheet.camera-project-keyboard-open',
      rowSize: '.result-sheet.result-save.result-save.project-select-sheet.camera-project-keyboard-open',
      body: '.result-sheet.result-save.project-select-sheet.camera-project-keyboard-open .project-select-body',
      list: '.result-sheet.result-save.result-save.project-select-sheet.camera-project-keyboard-open .project-select-list',
      resultHeader: '.result-sheet.result-save.result-save.project-select-sheet.camera-project-keyboard-open .result-header',
      sheetHeader: '.result-sheet.result-save.project-select-sheet.camera-project-keyboard-open .sheet-header',
    },
  ]

  for (const mode of keyboardModes) {
    assertCssDeclarations(rules, mode.panel, ['height:300px'], `${mode.name} keyboard panel`)
    assertCssDeclarations(rules, mode.rowSize, ['--project-select-row:88px'], `${mode.name} keyboard panel row size`)
    assertCssDeclarations(rules, mode.body, ['height:0', 'min-height:0', 'flex:1 1 0', 'overflow-y:auto'], `${mode.name} keyboard selection body`)
    assertCssDeclarations(rules, mode.list, ['height:0', 'min-height:0', 'max-height:88px', 'flex:1 1 0', 'overflow-y:auto'], `${mode.name} keyboard project list`)
    assertCssDeclarations(rules, mode.resultHeader, ['min-height:44px'], `${mode.name} result header`)
    assertCssDeclarations(rules, mode.sheetHeader, ['min-height:44px'], `${mode.name} sheet header`)
  }

  const gainSource = read('pages/gain-structure/gain-overlays.wxml')
  const gainSheet = findElement(gainSource, 'view', tag => classList(tag).includes('project-panel')
    && classList(tag).includes('result-save'), 'Gain project save sheet')
  assert.ok(tags(gainSheet.text).some(tag => !tag.closing && classList(tag).includes('sheet-header')),
    'Gain save sheet must retain the sheet-header covered by the keyboard override')
}

function main() {
  for (const spec of PAGES) {
    if (spec.dmx) assertDmxPage(spec)
    else assertStandardPage(spec)
  }
  assertRowSizing()
  assertKeyboardLayout()
  console.log('PASS compact project-select contracts: eight pages, row sizes 96px/112px, keyboard panel/body/list/header rules')
}

main()
