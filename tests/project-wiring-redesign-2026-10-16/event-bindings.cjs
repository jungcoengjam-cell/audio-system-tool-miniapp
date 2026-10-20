const fs = require('node:fs')
const path = require('node:path')
const { launch, delay } = require('./cdp.cjs')
async function main() {
  const browser = await launch(), checks = [], output = path.join(__dirname, 'evidence')
  const check = (name, passed, evidence) => checks.push({ name, passed: Boolean(passed), evidence })
  try {
    await browser.viewport(390, 844, 'dark'); await browser.navigate('tests/project-wiring-redesign-2026-10-16/browser.html?fixture=long&theme=dark')
    await browser.evaluate('document.querySelector("[data-tab=lines]").click()'); await delay(120)
    check('real tab DOM click reaches production handler', await browser.evaluate('window.__wiringQa.session.data.workspaceTab === "lines"'))
    await browser.evaluate('(()=>{const cell=document.querySelector(".workspace-port-cell");cell.scrollLeft=100;cell.dispatchEvent(new Event("scroll"));})()'); await delay(90)
    await browser.evaluate('document.querySelector(".workspace-line-row").click()'); await delay(100)
    const scroll = await browser.evaluate('({detail:window.__wiringQa.session.data.detailVisible,scrollLeft:document.querySelector(".workspace-port-cell").scrollLeft,scrollWidth:document.querySelector(".workspace-port-cell").scrollWidth,clientWidth:document.querySelector(".workspace-port-cell").clientWidth})')
    check('real cell scroll event preserves independent scrolling and suppresses row click', !scroll.detail && scroll.scrollLeft > 0 && scroll.scrollWidth > scroll.clientWidth, scroll)
    await browser.screenshot(path.join(output, 'screenshots/actual-cell-scroll-dark-390.png'))
    await delay(400); await browser.evaluate('document.querySelector(".workspace-line-row").click()'); await delay(100)
    check('intentional whole-row DOM click opens actual line detail', await browser.evaluate('window.__wiringQa.session.data.detailVisible === true'))
    await browser.screenshot(path.join(output, 'screenshots/actual-row-click-detail-dark-390.png'))
    const sources = await browser.evaluate('window.__wiringQa.session.sources')
    fs.writeFileSync(path.join(output, 'event-binding-checks.json'), JSON.stringify({ runAt: new Date().toISOString(), actualDomBindings: true, sources, checks, screenshots: ['actual-cell-scroll-dark-390.png', 'actual-row-click-detail-dark-390.png'].map(name => path.join(output, 'screenshots', name)) }, null, 2))
  } finally { await browser.close() }
  console.log(`DOM event checks ${checks.filter(item => item.passed).length}/${checks.length}`); if (checks.some(item => !item.passed)) process.exitCode = 1
}
main().catch(error => { console.error(error); process.exitCode = 1 })
