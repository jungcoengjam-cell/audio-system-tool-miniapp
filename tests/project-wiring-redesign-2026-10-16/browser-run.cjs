const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { launch, delay } = require('./cdp.cjs')
const output = path.join(__dirname, 'evidence'), screenshots = path.join(output, 'screenshots')
const checks = [], captures = [], scenes = [], failures = []
let browser
function check(name, passed, evidence) { const item = { name, passed: Boolean(passed), evidence }; checks.push(item); if (!passed) { failures.push(name); console.error('FAIL:', name, JSON.stringify(evidence)) } }
async function snapshot() { return browser.evaluate('window.__wiringQa') }
async function dispatch(method, dataset = {}, detail = {}, extra = {}) { return browser.evaluate(`window.__dispatch(${JSON.stringify(method)},${JSON.stringify(dataset)},${JSON.stringify(detail)},${JSON.stringify(extra)})`) }
async function action(name, value, options = {}) { return browser.evaluate(`window.__qaAction(${JSON.stringify(name)},${JSON.stringify(value)},${JSON.stringify(options)})`) }
async function capture(name) {
  await delay(60)
  const state = await snapshot(), geometry = await browser.evaluate('window.__geometry()')
  const file = path.join(screenshots, name + '.png'); await browser.screenshot(file)
  const evidence = { name, file, sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'), geometry, data: state.session.data, sources: state.session.sources }
  fs.mkdirSync(path.join(output, 'scenes'), { recursive: true }); fs.writeFileSync(path.join(output, 'scenes', name + '.json'), JSON.stringify(evidence, null, 2))
  captures.push({ name, file, sha256: evidence.sha256, width: geometry.width, height: geometry.height })
  check(name + ': production WXML expressions resolve', geometry.errors.length === 0, geometry.errors)
  check(name + ': no horizontal page overflow', geometry.pageWidth <= geometry.width + 1, { pageWidth: geometry.pageWidth, width: geometry.width })
  const interactiveButtons = geometry.controls.filter(control => !['workspace-search-input'].includes(control.className))
  check(name + ': touch controls at least 44 CSS pixels', interactiveButtons.every(control => control.width >= 43.5 && control.height >= 43.5), interactiveButtons.filter(control => control.width < 43.5 || control.height < 43.5))
  if (/^groups-.*-390$/.test(name)) {
    check(name + ': compact group headers and independent rows', geometry.groups.every(group => group.height >= 46 && group.height <= 54) && geometry.rows.every(row => row.height >= 46 && row.height <= 54), { groups: geometry.groups, rows: geometry.rows })
    check(name + ': circled stable labels use blue outline transparent surface', geometry.circles.every(circle => { const rgb = circle.borderColor.match(/\d+/g).map(Number); return circle.width >= 30 && circle.width <= 34 && Math.abs(circle.width - circle.height) < 1 && ['rgba(0, 0, 0, 0)', 'transparent'].includes(circle.background) && rgb[2] > 180 && rgb[2] > rgb[0] + 100 && rgb[2] > rgb[1] + 50 }), geometry.circles)
    check(name + ': fixed divider between independent scrolling cells', geometry.dividers.length === geometry.rows.length && geometry.portCells.filter(cell => cell.className === 'workspace-port-cell').length === geometry.rows.length * 2, { dividers: geometry.dividers, cells: geometry.portCells })
  }
  scenes.push({ name, geometry })
  console.log('Captured', name)
  return state.session
}
async function navigate(theme = 'light', width = 390, fixture = 'standard', height = 844) { await browser.viewport(width, height, theme); await browser.navigate('tests/project-wiring-redesign-2026-10-16/browser.html?' + new URLSearchParams({ theme, fixture })); return (await snapshot()).session }
async function resolveModal(before) { const state = (await snapshot()).session; if (state.events.modals.length > before) return action('modal', undefined, { confirm: true }); return state }
async function close(method) { const before = (await snapshot()).session.events.modals.length; await dispatch(method); return resolveModal(before) }
function projectWrites(state) { return state.events.writes.filter(item => item.key === 'audioTool.projects.v1').length }
async function main() {
  fs.mkdirSync(output, { recursive: true }); browser = await launch()
  try {
    for (const theme of ['light', 'dark']) for (const width of [320, 390, 430]) {
      await navigate(theme, width)
      await capture(`devices-${theme}-${width}`)
      await dispatch('onWorkspaceTab', { tab: 'lines' }); const groups = await capture(`groups-${theme}-${width}`)
      if (theme === 'dark') check(`dark-${width}: pure black page`, (await browser.evaluate('window.__geometry().background')) === 'rgb(0, 0, 0)', await browser.evaluate('window.__geometry().background'))
      if (groups.data.groups?.length) {
        const first = groups.data.groups[0]
        await dispatch('toggleGroup', { key: first.key }); let collapsed = (await snapshot()).session
        check(`group collapse-${theme}-${width}`, collapsed.data.groups[0].collapsed === true, collapsed.data.groups[0])
        await dispatch('toggleGroup', { key: first.key })
      }
      const id = groups.schedule.lines[0].id
      await dispatch('onLineTap', { id }); await capture(`detail-${theme}-${width}`)
      await dispatch('editDetailLine'); await capture(`editor-${theme}-${width}`)
      await close('requestCloseEditor')
      await dispatch('openDeviceEditor'); await capture(`add-device-${theme}-${width}`); await close('requestCloseDeviceEditor')
      await dispatch('requestProjectPicker'); await capture(`project-wheel-${theme}-${width}`); await dispatch('cancelProjectPicker')
      await dispatch('openNewLine'); await dispatch('openContinuous'); await capture(`continuous-${theme}-${width}`)
      await dispatch('closeContinuous'); await close('requestCloseEditor')
    }
    let state = await navigate('light', 390)
    const originalProject = state.data.project.id
    await dispatch('requestProjectPicker'); await dispatch('onProjectWheelChange', {}, { value: [1] }); state = (await snapshot()).session
    check('wheel change is temporary', state.data.project.id === originalProject, state.data.project)
    await dispatch('cancelProjectPicker'); state = (await snapshot()).session
    check('wheel Cancel preserves project', state.data.project.id === originalProject && !state.data.projectPickerVisible, state.data.project)
    await dispatch('requestProjectPicker'); await dispatch('onProjectWheelChange', {}, { value: [1] }); await dispatch('confirmProjectPicker'); state = (await snapshot()).session
    check('wheel Done enters selected project', state.data.project.id !== originalProject && !state.data.projectPickerVisible, state.data.project)

    state = await navigate('light', 390)
    const initialCount = state.schedule.devices.length, initialWrites = projectWrites(state)
    await dispatch('openDeviceEditor'); await dispatch('onDeviceType', { type: 'amplifier' })
    await dispatch('onDeviceDraftInput', { field: 'name' }, { value: '侧场功放' }); await dispatch('onDeviceDraftInput', { field: 'count' }, { value: '2' }); state = (await snapshot()).session
    check('device live names preview', state.data.deviceNamePreview.length === 2, state.data.deviceNamePreview)
    await capture('device-live-preview-light-390')
    await dispatch('saveDevices'); state = (await snapshot()).session
    check('device add stores exact batch atomically', state.schedule.devices.length === initialCount + 2 && projectWrites(state) === initialWrites + 1, { count: state.schedule.devices.length, writes: projectWrites(state) })
    const afterDevice = state.schedule.devices.length; await dispatch('saveDevices'); state = (await snapshot()).session
    check('device repeated save creates no duplicate', state.schedule.devices.length === afterDevice, state.schedule.devices)
    const savedStorage = state.storage; await action('reload'); state = (await snapshot()).session
    check('device persistence after reload', JSON.stringify(state.storage) === JSON.stringify(savedStorage) && state.schedule.devices.length === afterDevice, state.schedule.devices)

    await dispatch('onWorkspaceTab', { tab: 'lines' }); state = (await snapshot()).session
    const beforeLines = state.schedule.lines.length
    await dispatch('openNewLine'); await dispatch('openContinuous')
    await dispatch('onContinuousInput', { field: 'fromPort' }, { value: 'OUT 009' }); await dispatch('onContinuousInput', { field: 'toPort' }, { value: 'IN 009' }); await dispatch('onContinuousInput', { field: 'count' }, { value: '3' })
    state = (await snapshot()).session
    check('continuous terminal digit preview', state.data.continuousPairs.length === 3 && JSON.stringify(state.data.continuousPairs).includes('010'), state.data.continuousPairs)
    await capture('continuous-live-preview-light-390')
    await dispatch('fillContinuous'); state = (await snapshot()).session
    check('continuous Fill changes draft only', state.schedule.lines.length === beforeLines && state.data.draftPairs.length >= 3, { lines: state.schedule.lines.length, pairs: state.data.draftPairs })
    await dispatch('onPairInput', { index: 0, field: 'fromPort' }, { value: 'MANUAL OUT' }); state = (await snapshot()).session
    check('generated pairs remain editable', state.data.draftPairs[0].fromPort === 'MANUAL OUT', state.data.draftPairs)
    await close('requestCloseEditor'); state = (await snapshot()).session
    check('line draft Cancel discards all generated pairs', state.schedule.lines.length === beforeLines && !state.data.editorVisible, state.schedule)

    for (const theme of ['light', 'dark']) {
      await navigate(theme, 390, 'long'); await dispatch('onWorkspaceTab', { tab: 'lines' }); await capture(`long-groups-${theme}-390`)
      const id = (await snapshot()).session.schedule.lines[0].id
      await dispatch('onLineTouchStart', { id }, {}, { touches: [{ clientX: 200, clientY: 180 }] })
      await dispatch('onLineTouchMove', { id }, {}, { touches: [{ clientX: 80, clientY: 180 }] })
      await dispatch('onLineTouchEnd', { id }, {}, { changedTouches: [{ clientX: 80, clientY: 180 }] })
      await dispatch('onPortCellScroll', { id }, { scrollLeft: 80 }); await dispatch('onLineTap', { id }); state = (await snapshot()).session
      check(`horizontal scrolling suppresses detail-${theme}`, !state.data.detailVisible, state.data.detailVisible)
      await delay(500); await dispatch('onLineTouchStart', { id }, {}, { touches: [{ clientX: 200, clientY: 180 }] }); await dispatch('onLineTouchEnd', { id }, {}, { changedTouches: [{ clientX: 200, clientY: 180 }] }); await dispatch('onLineTap', { id }); await capture(`long-detail-${theme}-390`)
      await navigate(theme, 320, 'empty', 568); await capture(`empty-devices-${theme}-320`); await dispatch('onWorkspaceTab', { tab: 'lines' }); await capture(`empty-lines-${theme}-320`)
    }
    await navigate('light', 390, 'numbered'); await dispatch('onWorkspaceTab', { tab: 'lines' }); await capture('multiple-digit-numbers-light-390')
    const labelWidths = await browser.evaluate('[...document.querySelectorAll(".workspace-circle")].map(node=>({text:node.textContent.trim(),width:node.clientWidth,height:node.clientHeight,scrollWidth:node.scrollWidth,scrollHeight:node.scrollHeight,whiteSpace:getComputedStyle(node).whiteSpace}))')
    check('numeric labels 9 10 100 200 remain one line and fully visible', labelWidths.every(item => item.scrollWidth <= item.width + 1 && item.scrollHeight <= item.height + 1 && item.whiteSpace === 'nowrap'), labelWidths)
    await navigate('dark', 390, 'maxlegal'); await dispatch('onWorkspaceTab', { tab: 'lines' }); await capture('custom-code-maxlegal-dark-390')
    const customLabels = await browser.evaluate('[...document.querySelectorAll(".workspace-circle")].map(node=>({text:node.textContent.trim(),width:node.clientWidth,height:node.clientHeight,scrollWidth:node.scrollWidth,scrollHeight:node.scrollHeight}))')
    check('maximum custom code capsules display every character without clipping', customLabels.every(item => item.scrollWidth <= item.width + 1 && item.scrollHeight <= item.height + 1), customLabels)
    await navigate('light', 390); await dispatch('requestProjectPicker'); const wheel = await browser.evaluate('(()=>{const wheel=document.querySelector("picker-view"),selected=wheel.querySelector(".workspace-wheel-item-selected"),indicator=wheel.querySelector("[data-qa-native-wheel-part=indicator]"),sheet=document.querySelector(".workspace-wheel-sheet"),rect=n=>{const r=n.getBoundingClientRect();return{y:r.y,height:r.height,centerY:r.y+r.height/2}};return{wheel:rect(wheel),selected:rect(selected),indicator:rect(indicator),sheet:rect(sheet)}})()')
    check('source-derived native wheel adapter centers selected row on production indicator', Math.abs(wheel.selected.centerY - wheel.indicator.centerY) <= 1 && Math.abs(wheel.selected.centerY - wheel.wheel.centerY) <= 1 && Math.abs(wheel.sheet.height - 844 * .45) <= 2, wheel)
    await capture('project-wheel-centered-light-390')
    await browser.viewport(320, 568, 'dark'); await browser.navigate('tests/project-wiring-redesign-2026-10-16/browser.html?theme=dark&capsule=1'); await capture('native-capsule-header-dark-320')
    const nav = await browser.evaluate('(()=>{const title=document.querySelector(".workspace-title"),share=document.querySelector(".workspace-share"),back=document.querySelector(".workspace-back");const b=n=>{const r=n.getBoundingClientRect();return{x:r.x,right:r.right,y:r.y,width:r.width,height:r.height,scrollWidth:n.scrollWidth,clientWidth:n.clientWidth}};return{title:b(title),share:b(share),back:b(back)}})()')
    check('320 native capsule reservation keeps title and touch actions fully reachable', nav.share.right <= 224 && nav.share.width >= 44 && nav.back.width >= 44 && nav.title.scrollWidth <= nav.title.clientWidth + 1, nav)
    await dispatch('openNewLine'); await dispatch('onFormInputFocus', { focusId: 'wiring-pair-0-from' }, { height: 260 }, { id: 'wiring-pair-0-from' }); await capture('keyboard-editor-dark-320')
    state = (await snapshot()).session; check('keyboard height event updates real form spacer', state.data.formKeyboardSpacerHeight === 260, { spacer: state.data.formKeyboardSpacerHeight, formFrameStyle: state.data.formFrameStyle })
    await dispatch('onFormKeyboardHeightChange', {}, { height: 0 }); await dispatch('requestPageBack'); state = (await snapshot()).session
    check('Back closes editor before leaving page', !state.data.editorVisible && state.events.navigations.length === 0, { editor: state.data.editorVisible, navigations: state.events.navigations })
    await dispatch('openDeviceEditor'); await dispatch('requestPageBack'); state = (await snapshot()).session
    check('Back closes device form before leaving page', !state.data.deviceEditorVisible && state.events.navigations.length === 0, { form: state.data.deviceEditorVisible, navigations: state.events.navigations })
    await navigate('light', 390); await dispatch('onWorkspaceTab', { tab: 'lines' }); const beforeTheme = (await snapshot()).session.schedule
    await browser.viewport(390, 844, 'dark'); await action('theme', 'dark'); await capture('theme-switch-dark-390'); state = (await snapshot()).session
    check('live theme switch preserves records and synchronizes native nav colors', JSON.stringify(state.schedule) === JSON.stringify(beforeTheme) && state.events.navigationColors.at(-1).frontColor === '#ffffff', state.events.navigationColors)
    state = await navigate('light', 390); await action('write-failure', true)
    await dispatch('openDeviceEditor'); await dispatch('onDeviceDraftInput', { field: 'name' }, { value: '故障重试设备' }); await dispatch('saveDevices'); state = (await snapshot()).session
    check('storage failure keeps editor open without records', state.data.deviceEditorVisible && state.schedule.devices.length === 4, { data: state.data, count: state.schedule.devices.length })
    await capture('storage-error-light-390'); await action('write-failure', false); await dispatch('saveDevices'); state = (await snapshot()).session
    check('storage retry saves once', state.schedule.devices.length === 5, state.schedule.devices)
    await action('read-failure', true); await action('reload'); state = (await snapshot()).session
    check('storage read failure reaches explicit recovery state', !state.data.project || Boolean(state.data.selectionRequired || state.data.loadError), { project: state.data.project, selectionRequired: state.data.selectionRequired, loadError: state.data.loadError })
    await action('load-failure', 'QA 模拟项目读取失败，请重试'); await capture('load-error-light-390')
    check('load failure shown explicitly', Boolean((await snapshot()).session.data.loadError), (await snapshot()).session.data.loadError)
  } catch (error) { check('runner completed', false, error.stack) }
  finally { if (browser) await browser.close() }
  const result = { runAt: new Date().toISOString(), renderer: 'Current production WXML/WXSS mapped to Chromium with actual controller handlers and isolated wx storage', nativeRuntime: 'NOT RUN', physicalDevice: 'NOT RUN', nativeWheel: 'HTML scroll-column adapter; native iOS/Android wheel behavior not claimed', checks, captures, scenes, failures }
  fs.writeFileSync(path.join(output, 'browser-checks.json'), JSON.stringify(result, null, 2)); console.log(`Browser checks: ${checks.filter(check => check.passed).length}/${checks.length}; captures: ${captures.length}`)
  if (failures.length) process.exitCode = 1
}
main().catch(error => { console.error(error); process.exitCode = 1 })
