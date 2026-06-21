// Generates the default Open Graph card (1200x630) used as the social-share
// preview image for the homepage and as the fallback when a shared pet has no
// photo (see api/share.js). Run with: node scripts/generate-og-image.mjs
//
// Uses the Chromium that ships with @playwright/test (already a dev dependency
// for the e2e suite) to rasterize an HTML template — no extra image tooling.
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname, '../public/og');
const outFile = resolve(outDir, 'og-cover.png');

// Brand palette mirrors src/index.css (--color-primary tuned for WCAG AA).
const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 1200px; height: 630px; }
  body {
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    font-family: 'Segoe UI', system-ui, -apple-system, Arial, sans-serif;
    background: linear-gradient(135deg, #C24E1A 0%, #A33F12 100%);
    color: #fff; text-align: center;
    position: relative; overflow: hidden;
  }
  .glow {
    position: absolute; width: 900px; height: 900px; border-radius: 50%;
    background: radial-gradient(circle, rgba(255,255,255,0.14) 0%, rgba(255,255,255,0) 60%);
    top: -300px; right: -250px;
  }
  .paw { margin-bottom: 28px; }
  .wordmark { font-size: 104px; font-weight: 800; letter-spacing: -2px; line-height: 1; }
  .tagline { font-size: 40px; font-weight: 500; margin-top: 22px; opacity: 0.95; }
  .pill {
    margin-top: 40px; font-size: 26px; font-weight: 600;
    background: rgba(255,255,255,0.18); padding: 12px 28px; border-radius: 999px;
    backdrop-filter: blur(2px);
  }
</style>
</head>
<body>
  <div class="glow"></div>
  <svg class="paw" width="118" height="118" viewBox="0 0 64 64" fill="#fff" xmlns="http://www.w3.org/2000/svg">
    <ellipse cx="20" cy="20" rx="8" ry="11" />
    <ellipse cx="44" cy="20" rx="8" ry="11" />
    <ellipse cx="8"  cy="38" rx="7" ry="9.5" />
    <ellipse cx="56" cy="38" rx="7" ry="9.5" />
    <path d="M32 30c9 0 16 7 16 15 0 6-5 9-11 9-2 0-3-1-5-1s-3 1-5 1c-6 0-11-3-11-9 0-8 7-15 16-15z" />
  </svg>
  <div class="wordmark">SearchPet</div>
  <div class="tagline">Ayudá a encontrar mascotas perdidas</div>
  <div class="pill">100% gratis · Sin fines de lucro</div>
</body>
</html>`;

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'load' });
  mkdirSync(outDir, { recursive: true });
  await page.screenshot({ path: outFile, type: 'png' });
  console.log('OG card written to', outFile);
} finally {
  await browser.close();
}
