// Self-review screenshots. Run: npx --no-install playwright ... or node after PW available.
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const indexPath = process.env.INDEX_HTML || resolve(__dirname, 'index.html');
const url = 'file://' + indexPath;
const out = process.env.OUT_DIR || '/tmp/onda-landing';

const widths = [
  { name: 'mobile-390', w: 390, h: 844 },
  { name: 'tablet-768', w: 768, h: 1024 },
  { name: 'laptop-1024', w: 1024, h: 800 },
  { name: 'desktop-1440', w: 1440, h: 900 },
];

const launchOpts = process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {};
const browser = await chromium.launch(launchOpts);
let totalErrors = 0;
for (const v of widths) {
  const page = await browser.newPage({ viewport: { width: v.w, height: v.h }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', (err) => errors.push(String(err)));
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  // trigger scroll-reveal so full-page shots show all sections
  const docH = await page.evaluate(() => document.body.scrollHeight);
  for (let y = 0; y <= docH; y += 600) { await page.evaluate((_y) => window.scrollTo(0, _y), y); await page.waitForTimeout(60); }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(200);
  // check for horizontal overflow
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  console.log(`${v.name}: horizontal overflow = ${overflow}px | console errors = ${errors.length}`);
  if (errors.length) { totalErrors += errors.length; errors.forEach((e) => console.log('   ERR:', e)); }
  await page.screenshot({ path: `${out}/${v.name}.png`, fullPage: true });
  await page.close();
}
await browser.close();
console.log('Screenshots written to ' + out + ' | total console errors = ' + totalErrors);
