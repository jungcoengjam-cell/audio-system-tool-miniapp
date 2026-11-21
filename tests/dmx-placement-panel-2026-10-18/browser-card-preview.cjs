const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { launch, delay } = require('../dmx-ui-round3-2026-10-18/browser-driver.cjs')

const out = process.env.DMX_CARD_PREVIEW_OUT_DIR
  ? path.resolve(process.env.DMX_CARD_PREVIEW_OUT_DIR)
  : path.join(__dirname, 'evidence/cards')
fs.mkdirSync(out, { recursive: true })

async function run() {
  const browser = await launch()
  const results = []
  const evaluate = (script) => browser.evaluate(script)

  async function inspect() {
    return evaluate(`(() => {
      const page = window.__lightingQa.page
      const card = document.querySelector('.fixture-card')
      const preview = card.querySelector('.address-chips-preview')
      const items = [...preview.querySelectorAll('.address-chip-preview')]
      const bounds = (element) => {
        const rect = element.getBoundingClientRect()
        return {
          x: rect.x,
          y: rect.y,
          right: rect.right,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
        }
      }
      const overflow = card.querySelector('.address-chip-overflow')
      const label = overflow?.querySelector('.address-chip-preview-label')
      const check = overflow?.querySelector('.chip-check-preview')
      return {
        width: innerWidth,
        columns: page.data.groupCards[0].cardChipColumns,
        full: page.data.groupCards[0].fixtureChips.length,
        preview: page.data.groupCards[0].cardFixtureChips.length,
        rows: [...new Set(items.map((item) => Math.round(item.getBoundingClientRect().y)))],
        box: bounds(preview),
        items: items.map(bounds),
        lastText: items.at(-1)?.querySelector('.address-chip-preview-label')?.textContent,
        lastAddress: page.data.groupCards[0].cardFixtureChips.at(-1)?.addressText,
        overflowLast: overflow === items.at(-1),
        overflowCount: card.querySelectorAll('.address-chip-overflow').length,
        background: overflow ? getComputedStyle(overflow).backgroundImage : '',
        labelOpacity: label ? getComputedStyle(label).opacity : null,
        checkOpacity: check ? getComputedStyle(check).opacity : null,
        nestedTextCount: overflow ? overflow.querySelectorAll('text text').length : 0,
        scrollWidth: preview.scrollWidth,
        clientWidth: preview.clientWidth,
        writes: window.__lightingQa.events.writes.length,
      }
    })()`)
  }

  try {
    for (const theme of ['light', 'dark']) {
      await browser.viewport(390, 844, theme)
      await browser.navigate({ page: 'main', theme, fixture: 'export-dense' })
      await delay(150)
      const before = await evaluate('({fixtures:JSON.stringify(window.__lightingQa.page._calculationResult.fixtures),writes:window.__lightingQa.events.writes.length})')

      for (const width of [390, 320, 844]) {
        await browser.viewport(width, width === 844 ? 390 : 844, theme)
        await delay(150)
        const preview = await inspect()
        assert.equal(preview.full, 160)
        assert.equal(preview.rows.length, 2, 'dense card capped at two rendered rows')
        assert.equal(preview.preview, preview.columns * 2)
        assert.equal(preview.overflowCount, 1)
        assert(preview.overflowLast)
        assert.equal(preview.lastText, preview.lastAddress, 'fade does not alter address text')
        assert(preview.background.includes('linear-gradient'), 'overflow chip uses a computed gradient')
        assert.equal(Number(preview.labelOpacity), 0.52, 'overflow label remains readable')
        assert(preview.checkOpacity === null || Number(preview.checkOpacity) === 1, 'checkmark stays fully opaque')
        assert.equal(preview.nestedTextCount, 0, 'address renders as plain text')
        assert(preview.items.every((item) => item.x >= preview.box.x - 1
          && item.right <= preview.box.right + 1
          && item.y >= preview.box.y - 1
          && item.bottom <= preview.box.bottom + 1), 'every displayed code fits in the preview')
        assert(preview.scrollWidth <= preview.clientWidth + 1)
        assert.equal(preview.writes, before.writes)
        assert.equal(await evaluate('JSON.stringify(window.__lightingQa.page._calculationResult.fixtures)'), before.fixtures)

        const file = path.join(out, 'preview-' + theme + '-' + width + '.png')
        await browser.screenshot(file)
        results.push({ theme, width, ...preview, file })
        console.log('PASS two-row preview with computed overflow fade ' + theme + ' ' + width)
      }

      await browser.viewport(390, 844, theme)
      await delay(100)
      await evaluate('document.querySelector(".address-chips-preview").click()')
      await delay(300)
      assert.equal(await evaluate('document.querySelectorAll(".floating-chips .address-chip").length'), 160,
        'expanded card retains every fixture')
      await browser.screenshot(path.join(out, 'expanded-' + theme + '.png'))

      await browser.navigate({ page: 'main', theme, fixture: 'standard' })
      await delay(120)
      const small = await inspect()
      assert.equal(small.full, 12)
      assert(small.rows.length <= 2)
      if (small.preview === small.full) assert.equal(small.overflowCount, 0, 'no gradient when all addresses fit')
      results.push({ theme, small })
    }
  } finally {
    fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify({
      runAt: new Date().toISOString(),
      nativeRuntime: false,
      physicalDevice: false,
      results,
    }, null, 2))
    await browser.close()
  }
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
