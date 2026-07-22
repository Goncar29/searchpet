// Regenerates all SearchPet raster logo assets from the single "Rastro" mark.
// Source of truth: the `trail` icon from the brand design doc (paw print + trail
// of steps), rendered as a single-color mark. Rasterized with Playwright's
// bundled Chromium so we add no new dependencies.
//
// Usage: node scripts/gen-logo.mjs   (run from frontend/packages/web)
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const BRAND = '#C24E1A'; // terracotta
const PAPER = '#FBF5EF'; // cream

// The Rastro mark, in its native coordinate space. Fill is applied by the wrapper.
const MARK = `
  <circle cx="10" cy="82" r="4"/>
  <circle cx="28" cy="72" r="5.5"/>
  <circle cx="47" cy="61" r="7"/>
  <g transform="translate(44.65,6.86) scale(0.85)">
    <ellipse cx="51" cy="64" rx="23" ry="19"/>
    <circle cx="23" cy="43" r="9.5"/>
    <circle cx="41" cy="28" r="10.5"/>
    <circle cx="61" cy="28" r="10.5"/>
    <circle cx="79" cy="43" r="9.5"/>
  </g>`;

// Bounding box of MARK in native coords (measured from the geometry above).
const BB = { x: 6, y: 21, w: 114, h: 65 };

// Build a square SVG string that fits MARK, centered, with `pad` fraction of
// breathing room on each side. `bg` null => transparent (baked bg otherwise).
function buildSvg({ size, bg, fg, pad }) {
  const avail = 100 * (1 - 2 * pad);
  const f = avail / Math.max(BB.w, BB.h);
  const drawW = BB.w * f;
  const drawH = BB.h * f;
  const ox = (100 - drawW) / 2 - BB.x * f;
  const oy = (100 - drawH) / 2 - BB.y * f;
  const rect = bg ? `<rect width="100" height="100" fill="${bg}"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">
    ${rect}
    <g transform="translate(${ox.toFixed(3)},${oy.toFixed(3)}) scale(${f.toFixed(4)})" fill="${fg}">${MARK}</g>
  </svg>`;
}

const here = path.dirname(fileURLToPath(import.meta.url));
const webPublic = path.resolve(here, '..', 'public');
const mobileAssets = path.resolve(here, '..', '..', 'mobile', 'assets', 'images');

// [outPath, {size, bg, fg, pad}]
const TARGETS = [
  // Web PWA — maskable: cream paw on full-bleed terracotta, generous safe zone.
  [path.join(webPublic, 'icons', 'icon-192.png'), { size: 192, bg: BRAND, fg: PAPER, pad: 0.2 }],
  [path.join(webPublic, 'icons', 'icon-512.png'), { size: 512, bg: BRAND, fg: PAPER, pad: 0.2 }],
  // Apple touch icon: no transparency, iOS rounds the corners itself.
  [path.join(webPublic, 'apple-touch-icon.png'), { size: 180, bg: BRAND, fg: PAPER, pad: 0.16 }],
  // Mobile (Expo) iOS icon: full-bleed square, iOS masks it.
  [path.join(mobileAssets, 'icon.png'), { size: 1024, bg: BRAND, fg: PAPER, pad: 0.16 }],
  // Android adaptive foreground: transparent, cream paw, extra safe zone (~66% crop).
  [path.join(mobileAssets, 'adaptive-icon.png'), { size: 1024, bg: null, fg: PAPER, pad: 0.28 }],
  // Splash: cream paw on transparent (app.json paints the terracotta background).
  [path.join(mobileAssets, 'splash.png'), { size: 1024, bg: null, fg: PAPER, pad: 0.34 }],
];

const browser = await chromium.launch({ args: ['--no-sandbox', '--force-color-profile=srgb'] });
const page = await browser.newPage();
for (const [outPath, opts] of TARGETS) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const svg = buildSvg(opts);
  await page.setViewportSize({ width: opts.size, height: opts.size });
  await page.setContent(svg, { waitUntil: 'load' });
  const el = await page.$('svg');
  await el.screenshot({ path: outPath, omitBackground: true });
  console.log('wrote', path.relative(process.cwd(), outPath), `(${opts.size}px)`);
}
await browser.close();
console.log('done');
