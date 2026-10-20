const fs = require('node:fs')
const path = require('node:path')
const { launch } = require('./cdp.cjs')
const output = path.join(__dirname, 'evidence')
async function main() {
  fs.mkdirSync(output, { recursive: true }); const browser = await launch(), checks = [], reports = []
  const check = (name, passed, evidence) => { checks.push({ name, passed: Boolean(passed), evidence }); if (!passed) console.error('FAIL:', name) }
  try {
    for (const item of [{ fixture: 'standard', count: 4, theme: 'light' }, { fixture: 'standard', count: 4, theme: 'dark' }, { fixture: 'long', count: 4, theme: 'light' }, { fixture: 'standard', count: 100, theme: 'light' }, { fixture: 'standard', count: 200, theme: 'light' }, { fixture: 'maxlegal', count: 2, theme: 'light' }]) {
      await browser.viewport(1000, 1000, item.theme); await browser.navigate('tests/project-wiring-redesign-2026-10-16/report-canvas.html?' + new URLSearchParams(item))
      const report = await browser.evaluate('window.__reportQa'); reports.push(report)
      check(`${item.fixture}-${item.count}-${item.theme}: project branch`, report.report.type === 'project' && report.outputs.every(page => page.type === 'project'), { type: report.report.type, pages: report.outputs.map(page => page.type) })
      const drawn = report.drawn.join('').replace(/\s+/g, '')
      if (item.fixture !== 'maxlegal') {
        check(`${item.fixture}-${item.count}-${item.theme}: every line port drawn`, Array.from({ length: item.count }, (_, i) => item.fixture === 'long' ? `OUTPUT-${i + 1}-LONG-PORT-NAME-滚动完整端口标签` : `OUT${i + 1}`).every(text => drawn.includes(text.replace(/\s+/g, ''))), drawn)
        check(`${item.fixture}-${item.count}-${item.theme}: missing cable data says 待补`, drawn.includes('待补'), drawn)
      }
      check(`${item.fixture}-${item.count}-${item.theme}: every actual layout line drawn`, report.textMetrics.omittedItems.length === 0, report.textMetrics.omittedItems)
      check(`${item.fixture}-${item.count}-${item.theme}: real Canvas font widths fit field bounds`, report.textMetrics.overflows.length === 0, report.textMetrics.overflows)
      const lineRows = report.report.pages.flatMap(page => page.rows).filter(row => row.kind === 'project-line')
      check(`${item.fixture}-${item.count}-${item.theme}: every independent line represented`, new Set(lineRows.map(row => row.lineId)).size === item.count, lineRows.map(row => row.lineId))
      check(`${item.fixture}-${item.count}-${item.theme}: no A001 presentation`, !report.drawn.some(text => /^A\d{3}$/.test(text)), report.drawn.filter(text => /^A\d{3}$/.test(text)))
      check(`${item.fixture}-${item.count}-${item.theme}: actual PNG bytes`, report.outputs.length > 0 && report.outputs.every(page => page.bytes > 3000 && page.sha256 && page.width > 0 && page.height > 0), report.outputs.map(({ filename, bytes, width, height }) => ({ filename, bytes, width, height })))
      if (item.fixture === 'long') check('long project and device names wrap fully', drawn.includes('多功能会议中心主会场设备通道与线缆完整长项目名称') && drawn.includes('舞台左侧无线话筒接收机一号通道与扩展设备长名称'), drawn)
      console.log(`${item.fixture}/${item.count}/${item.theme}: ${report.outputs.length} actual PNGs`)
    }
    check('whole-project export fixed light across UI themes', JSON.stringify(reports[0].outputs.map(page => page.sha256)) === JSON.stringify(reports[1].outputs.map(page => page.sha256)), reports.slice(0, 2).map(report => report.outputs.map(page => page.sha256)))
  } catch (error) { check('Canvas runner completed', false, error.stack) }
  finally { await browser.close() }
  const result = { runAt: new Date().toISOString(), checks, reports: reports.map(({ report, drawn, sources, outputs, ...rest }) => ({ ...rest, sources, pages: report.pages.length, outputs: outputs.map(({ drawnText, ...output }) => output) })), limits: 'Actual production renderer through Chromium Canvas2D adapter; native WeChat export and physical devices NOT RUN' }
  fs.writeFileSync(path.join(output, 'report-checks.json'), JSON.stringify(result, null, 2)); console.log(`Canvas checks ${checks.filter(item => item.passed).length}/${checks.length}`)
  if (checks.some(item => !item.passed)) process.exitCode = 1
}
main().catch(error => { console.error(error); process.exitCode = 1 })
