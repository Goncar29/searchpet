// Guard: no MapLibre MapView in the app may receive its style through
// `styleURL`. MapLibre RN 10 only reads `mapStyle`; `styleURL` is dropped
// silently and the map falls back to the demo tiles (no streets). All three
// maps in the app had it wrong until 2026-09-28.
//
// It sweeps every .tsx under app/ and components/ instead of listing files, so
// a map added later is covered too.
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '..');
const SCANNED_DIRS = ['app', 'components'];

function tsxFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return tsxFiles(full);
    return entry.name.endsWith('.tsx') ? [full] : [];
  });
}

describe('MapLibre style prop', () => {
  const files = SCANNED_DIRS.flatMap((dir) => tsxFiles(path.join(ROOT, dir)));

  it('scans the real source tree', () => {
    // A guard that reads nothing passes for the wrong reason. The three maps
    // must be among the scanned files.
    const names = files.map((f) => path.relative(ROOT, f).split(path.sep).join('/'));
    expect(names).toEqual(
      expect.arrayContaining([
        'app/(tabs)/map.tsx',
        'components/publish/LocationStep.tsx',
        'components/TimelineMap.tsx',
      ]),
    );
  });

  it('never passes styleURL to a map (MapLibre 10 ignores it)', () => {
    const offenders = files
      .filter((f) => /\bstyleURL\s*=/.test(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(ROOT, f));
    expect(offenders).toEqual([]);
  });

  // The check above only proves the wrong prop is gone. Deleting the style
  // prop altogether would pass it and still fall back to the demo tiles, so
  // every file that renders a MapView must also pass mapStyle.
  it('gives every rendered MapView a mapStyle', () => {
    const mapFiles = files.filter((f) => /<[\w.]*\bMapView\b/.test(fs.readFileSync(f, 'utf8')));
    expect(mapFiles.length).toBeGreaterThanOrEqual(3);
    const withoutStyle = mapFiles
      .filter((f) => !/\bmapStyle\s*=/.test(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(ROOT, f));
    expect(withoutStyle).toEqual([]);
  });
});
