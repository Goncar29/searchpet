// Regenerates the Open Graph / social share cover (public/og/og-cover.png, 1200x630)
// with the current SearchPet brand: the Rastro paw + Fredoka wordmark on the
// terracotta gradient. Rendered with Playwright's bundled Chromium.
//
// Usage: node scripts/gen-og.mjs   (run from frontend/packages/web)
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const PAPER = '#FBF5EF';
const ACCENT = '#FCBF49';

const PAW = `<svg viewBox="6 38 122 72" height="150" fill="${PAPER}" xmlns="http://www.w3.org/2000/svg">
  <g transform="translate(4,20)">
    <circle cx="10" cy="82" r="4"/><circle cx="28" cy="72" r="5.5"/><circle cx="47" cy="61" r="7"/>
    <g transform="translate(44.65,6.86) scale(0.85)">
      <ellipse cx="51" cy="64" rx="23" ry="19"/><circle cx="23" cy="43" r="9.5"/>
      <circle cx="41" cy="28" r="10.5"/><circle cx="61" cy="28" r="10.5"/><circle cx="79" cy="43" r="9.5"/>
    </g>
  </g>
</svg>`;

const html = `<!doctype html><html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fredoka:wght@600;700&family=Plus+Jakarta+Sans:wght@500&display=swap" rel="stylesheet">
<style>
  *{margin:0;box-sizing:border-box}
  body{width:1200px;height:630px;overflow:hidden}
  .card{width:1200px;height:630px;background:linear-gradient(120deg,#C24E1A 0%,#9C3C12 100%);
    display:flex;flex-direction:column;align-items:center;justify-content:center;gap:22px;
    font-family:'Plus Jakarta Sans',system-ui,sans-serif;}
  .paw{display:block}
  .wm{font-family:'Fredoka',sans-serif;font-weight:600;font-size:104px;line-height:1;letter-spacing:-.01em;color:${PAPER};}
  .wm .p{color:${ACCENT};}
  .tag{font-size:36px;font-weight:500;color:rgba(251,245,239,.92);margin-top:6px;}
</style></head>
<body>
  <div class="card">
    <div class="paw">${PAW}</div>
    <div class="wm">Search<span class="p">Pet</span></div>
    <div class="tag">Reunimos mascotas perdidas con sus familias</div>
  </div>
</body></html>`;

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, '..', 'public', 'og', 'og-cover.png');

const browser = await chromium.launch({ args: ['--no-sandbox', '--force-color-profile=srgb'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(html, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(300);
fs.mkdirSync(path.dirname(out), { recursive: true });
await page.screenshot({ path: out, clip: { x: 0, y: 0, width: 1200, height: 630 } });
await browser.close();
console.log('wrote', path.relative(process.cwd(), out));
