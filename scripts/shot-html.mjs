// Screenshot a local HTML page (docs, idea notebook) and report horizontal overflow.
// usage: node scripts/shot-html.mjs <file.html> <out.png> [width=1280] [height=900] [full=0|1]
import { chromium } from 'playwright';

const [, , file, out, w = '1280', h = '900', full = '0'] = process.argv;
if (!file || !out) {
  console.error('usage: node scripts/shot-html.mjs <file.html> <out.png> [width] [height] [full]');
  process.exit(1);
}
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) } });
await page.goto('file:///' + file.replace(/\\/g, '/'));
await page.waitForTimeout(300);
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
await page.screenshot({ path: out, fullPage: full === '1' });
console.log(`overflow ${overflow}px → ${out}`);
await browser.close();
