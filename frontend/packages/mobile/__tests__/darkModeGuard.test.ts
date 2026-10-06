// S4: no screen or component is left half-migrated to dark mode.
//
// Parses the code with the TypeScript compiler (not a regex over the text), so
// a color or a name mentioned in a comment does not count.
//
// Every allowlist below is EXACT: an entry that no longer appears in the code
// fails too, so the lists cannot rot into permissions nobody uses.
import fs from 'fs';
import path from 'path';
import ts from 'typescript';

const ROOT = path.join(__dirname, '..');
const SCANNED = ['app', 'components'];

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === '__tests__' ? [] : walk(full);
    return /\.tsx?$/.test(e.name) ? [full] : [];
  });
}

const files = SCANNED.flatMap((d) => walk(path.join(ROOT, d)));
const rel = (f: string) => path.relative(ROOT, f).split(path.sep).join('/');

interface Found {
  identifiers: Map<string, number>;
  colors: Map<string, number>;
}

const COLOR = /^(#[0-9a-fA-F]{3,8}|rgba?\(.*\))$/;

function scan(file: string): Found {
  const src = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const found: Found = { identifiers: new Map(), colors: new Map() };
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node) && ['COLORS', 'LIGHT_COLORS', 'DARK_COLORS'].includes(node.text)) {
      bump(found.identifiers, node.text);
    }
    if (ts.isStringLiteralLike(node) && COLOR.test(node.text)) bump(found.colors, node.text);
    ts.forEachChild(node, visit);
  };
  visit(src);
  return found;
}

const scanned = new Map(files.map((f) => [rel(f), scan(f)]));

// Pinned to the light palette in BOTH themes on purpose.
const PINNED_LIGHT: Record<string, string> = {
  'app/leaderboard/index.tsx': 'medal colors are the same in both palettes',
  'app/my-pets.tsx': "the 'registered' badge paints white text on textSecondary; dark textSecondary is light gray",
  'app/pet/[id].tsx': "same 'registered' badge as my-pets",
  'components/ShareButton.tsx': 'QR ink must stay dark on the white QR background',
};

// Literals that read well in both themes, by file. Value -> why it stays.
const KEPT_COLORS: Record<string, Record<string, string>> = {
  'app/(tabs)/map.tsx': {
    '#6366f1': 'radius circle drawn over the map tiles',
    '#000': 'shadow',
    'rgba(0,0,0,0.7)': 'dark overlay banners with white text over the map',
  },
  'app/chat/[userId].tsx': { '#000': 'shadow' },
  'app/foster-home/[id].tsx': { 'rgba(0, 0, 0, 0.5)': 'modal backdrop' },
  'app/my-pets.tsx': { '#000': 'shadow' },
  'app/pet/[id].tsx': {
    '#16a34a': 'verified mark and the found button (white text on it)',
    '#10b981': 'story button with white text',
    'rgba(255, 255, 255, 0.55)': 'carousel dots over the photo',
    'rgba(34, 197, 94, 0.9)': 'found banner over the photo',
  },
  'app/pets/register.tsx': { 'rgba(200, 0, 0, 0.45)': 'upload error overlay over the photo' },
  'components/HelperPickerModal.tsx': { 'rgba(0, 0, 0, 0.5)': 'modal backdrop' },
  'components/Logo.tsx': { '#C24E1A': 'brand mark' },
  'components/OptionPickerModal.tsx': { 'rgba(0, 0, 0, 0.5)': 'modal backdrop' },
  'components/PawPlaceholder.tsx': { '#C24E1A': 'brand mark' },
  'components/PointsRulesModal.tsx': { 'rgba(0, 0, 0, 0.5)': 'modal backdrop' },
  'components/ShareButton.tsx': { '#f97316': 'link-expiry warning, orange reads on both' },
  'components/TimelineMap.tsx': { '#6366f1': 'route line drawn over the map tiles' },
};

describe('dark mode guard (S4)', () => {
  it('scans the real screens and components', () => {
    expect(scanned.size).toBeGreaterThan(50);
    expect(scanned.has('app/(tabs)/index.tsx')).toBe(true);
  });

  it('no screen or component reads the legacy light COLORS', () => {
    const offenders = [...scanned].filter(([, f]) => f.identifiers.has('COLORS')).map(([p]) => p);
    expect(offenders).toEqual([]);
  });

  it('a palette is pinned only where the list says why', () => {
    const pinned = [...scanned]
      .filter(([, f]) => f.identifiers.has('LIGHT_COLORS') || f.identifiers.has('DARK_COLORS'))
      .map(([p]) => p)
      .sort();
    expect(pinned).toEqual(Object.keys(PINNED_LIGHT).sort());
  });

  it('every color literal is a reasoned exception', () => {
    const actual: Record<string, string[]> = {};
    for (const [p, f] of scanned) if (f.colors.size) actual[p] = [...f.colors.keys()].sort();
    const expected: Record<string, string[]> = {};
    for (const [p, kept] of Object.entries(KEPT_COLORS)) expected[p] = Object.keys(kept).sort();
    expect(actual).toEqual(expected);
  });
});
