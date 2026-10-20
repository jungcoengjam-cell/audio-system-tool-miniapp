const fs = require('node:fs')
const path = require('node:path')
const previous = path.resolve(__dirname, '../camera-theme-2026-10-13')
const source = fs.readFileSync(path.join(previous, 'camera-browser.js'), 'utf8')
const bridge = source.slice(0, source.indexOf('async function loadProductionRenderer()'))
fs.writeFileSync(path.join(__dirname, 'browser-base.js'), bridge)
const html = fs.readFileSync(path.join(previous, 'camera-browser.html'), 'utf8')
  .replace('<pre id="qa-report"', '<pre aria-hidden="true" id="qa-report"')
  .replace('</style>', 'div[data-wx-scroll-y="true"]::-webkit-scrollbar,div[data-wx-scroll-x="true"]::-webkit-scrollbar{display:none}</style>')
  .replace('<script src="/tests/camera-theme-2026-10-13/camera-browser.js"></script>',
    '<script src="/tests/camera-3d-2026-10-15/browser-base.js"></script><script src="/tests/camera-3d-2026-10-15/browser.js"></script>')
fs.writeFileSync(path.join(__dirname, 'browser.html'), html)
let server = fs.readFileSync(path.resolve(__dirname, '../camera-refactor-2026-10-12/camera-browser-server-v5.cjs'), 'utf8')
  .replace("require('./browser-fixtures-v5.cjs')", "require('../camera-refactor-2026-10-12/browser-fixtures-v5.cjs')")
  .replace("'pages/camera/preview-renderer.js',", "'pages/camera/preview-renderer.js', 'pages/camera/camera-scene.js', 'utils/camera-framing.js',")
  .replace("const fixture = createCameraFixtureV5(caseName, viewport.width, viewport.height, options)", `const fixture = createCameraFixtureV5(caseName === 'approved' ? 'ground' : caseName, viewport.width, viewport.height, options)
      if (caseName === 'approved') {
        fixture.page.openCameraSelector()
        const item = fixture.page.data.selectorItems.find((camera) => camera.model === 'TS-0663JP')
        if (!item) throw new Error('Approved reference camera is missing from the current product library')
        fixture.page.selectCamera({ currentTarget: { dataset: { index: item.index } } })
        fixture.page.commitCalculatedState({ heightModeIndex: 1,
          marginIndex: fixture.page.data.marginOptions.indexOf(Number(url.searchParams.get('framingMargin') ?? 10)),
          fixedCameraHeightText: url.searchParams.get('cameraHeight') || '2.3', groundDepthText: url.searchParams.get('targetDepth') || '4' })
      }
      fixture.page.onThemeChange({ theme: url.searchParams.get('theme') || 'light' })
      fixture.env.flushNextTicks()`)
  .replace('buildCameraReportPayload(fixture.page.data.result)', 'buildCameraReportPayload(fixture.page.data.result, { theme: fixture.page.data.theme })')
  .replace('const event = { currentTarget, detail: payload.detail || {} }', 'const event = { currentTarget, detail: payload.detail || {}, theme: payload.detail?.theme }')
  .replace("if (url.pathname === '/__qa-meta') {", `if (url.pathname === '/__qa-save' && request.method === 'POST') {
      const payload = await readJson(request)
      if (!/^[a-zA-Z0-9_.-]+$/.test(payload.name) || !['png', 'json'].includes(payload.type)) return sendJson(response, 400, {error:'Invalid QA artifact'})
      const output = path.join(__dirname, 'evidence/browser', payload.name + '.' + payload.type)
      if (payload.type === 'png') {
        if (!String(payload.data).startsWith('data:image/png;base64,')) return sendJson(response, 400, {error:'PNG required'})
        fs.writeFileSync(output, Buffer.from(payload.data.split(',')[1], 'base64'))
      } else fs.writeFileSync(output, JSON.stringify(payload.data, null, 2))
      return sendJson(response, 200, {saved:true})
    }
    if (url.pathname === '/__qa-meta') {`)
fs.writeFileSync(path.join(__dirname, 'browser-server.cjs'), server)
console.log('Built camera 3D browser bridge from existing production WXML/WXSS adapters')
