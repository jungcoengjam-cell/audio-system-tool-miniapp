const assert = require('node:assert/strict')
const { launch, delay } = require('./browser-driver.cjs')

async function run() {
  const browser = await launch()
  try {
    await browser.viewport(390, 844, 'light', 'no-preference')
    await browser.navigate({ theme: 'light', page: 'main' })
    const standard = await browser.evaluate(`(()=>({
      reduced:matchMedia('(prefers-reduced-motion: reduce)').matches,
      card:getComputedStyle(document.querySelector('.fixture-card')).transitionDuration
    }))()`)
    assert.equal(standard.reduced, false)
    assert(standard.card.split(',').some(value => Number.parseFloat(value) >= 0.19), `normal card snap transition should remain enabled: ${standard.card}`)

    await browser.viewport(390, 844, 'light', 'reduce')
    const reducedCard = await browser.evaluate(`(()=>({
      reduced:matchMedia('(prefers-reduced-motion: reduce)').matches,
      duration:getComputedStyle(document.querySelector('.fixture-card')).transitionDuration
    }))()`)
    assert.equal(reducedCard.reduced, true)
    assert(reducedCard.duration.split(',').every(value => Number.parseFloat(value) === 0), `fixture card transition must be disabled: ${reducedCard.duration}`)

    await browser.evaluate(`window.__dispatch('openFloatingCard',{index:0},{},{})`)
    await delay(280)
    const floating = await browser.evaluate(`(()=>{
      const card=document.querySelector('.floating-card')
      return card ? getComputedStyle(card).transitionDuration : null
    })()`)
    assert(floating, 'the real floating card should be rendered')
    assert(floating.split(',').every(value => Number.parseFloat(value) === 0), `floating-card transitions must be disabled: ${floating}`)
    console.log(JSON.stringify({ normalCardDuration: standard.card, reducedCardDuration: reducedCard.duration, reducedFloatingDuration: floating }))
  } finally {
    await browser.close()
  }
}

run().catch(error => {
  console.error(error.stack || error)
  process.exitCode = 1
})
