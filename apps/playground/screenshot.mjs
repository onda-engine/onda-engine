// Smoke test: load the built playground in headless Chromium, fail on any
// console/page error, and screenshot the player.
//   node apps/playground/screenshot.mjs [url] [outfile]
import { chromium } from 'playwright'

const url = process.argv[2] ?? 'http://localhost:4173/'
const out = process.argv[3] ?? 'player.png'
const waitMs = Number(process.argv[4] ?? 1200)

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1000, height: 620 }, deviceScaleFactor: 2 })

const errors = []
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))

await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForSelector('canvas')
await page.waitForTimeout(waitMs) // advance playback to the frame we want to capture
await page.screenshot({ path: out })
await browser.close()

if (errors.length > 0) {
  console.error(`PAGE ERRORS:\n${errors.join('\n')}`)
  process.exit(2)
}
console.log(`screenshot -> ${out}`)
