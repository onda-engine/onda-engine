// Self-review screenshots. Run: npx --no-install playwright ... or node after PW available.
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const indexPath = process.env.INDEX_HTML || resolve(__dirname, 'index.html');
const url = 'file://' + indexPath;
const out = process.env.OUT_DIR || '/tmp/onda-landing';

const widths = [
  { name: 'mobile-375', w: 375, h: 812 },
  { name: 'tablet-768', w: 768, h: 1024 },
  { name: 'laptop-1024', w: 1024, h: 800 },
  { name: 'desktop-1440', w: 1440, h: 900 },
];

const launchOpts = process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {};
const browser = await chromium.launch(launchOpts);
for (const v of widths) {
  const page = await browser.newPage({ viewport: { width: v.w, height: v.h }, deviceScaleFactor: 2 });
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  // check for horizontal overflow
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  console.log(`${v.name}: horizontal overflow = ${overflow}px`);
  await page.screenshot({ path: `${out}/${v.name}.png`, fullPage: true });
  await page.close();
}
await browser.close();
console.log('Screenshots written to ' + out);
