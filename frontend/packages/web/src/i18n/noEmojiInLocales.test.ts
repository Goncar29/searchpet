import { describe, expect, it } from 'vitest';

/**
 * Translation copy must not carry pictographic glyphs: they paint in color from
 * each OS font and ignore currentColor. UI decoration is drawn with <Icon>
 * next to the text instead. The sweeps over source code never scanned the JSON
 * locales, which is how these survived.
 */
const GLYPH_RANGES =
  /[\u{1F000}-\u{1FFFF}\u{2190}-\u{21FF}\u{2300}-\u{23FF}\u{2600}-\u{27BF}\u{2900}-\u{2BFF}\u{2022}\u{2713}]/u;
// The variation selector is checked on its own: inside a character class it
// trips no-misleading-character-class.
const hasGlyph = (value: string) => GLYPH_RANGES.test(value) || value.includes('️');

// `file:key.path` -> why the glyph stays. Anything else fails.
const KEPT: Record<string, string> = {};
for (const lang of ['es', 'en', 'pt']) {
  KEPT[`web/${lang}.json:impact.shareText`] =
    'Text that leaves the app through the share sheet; there is no icon to draw there';
  KEPT[`web/${lang}.json:download.sideload.step1`] =
    'The arrow is part of an instruction describing a menu path (Settings -> Security)';
}

const webFiles = import.meta.glob('./locales/*.json', { eager: true, import: 'default' });
const sharedFiles = import.meta.glob('../../../shared/i18n/locales/*.json', {
  eager: true,
  import: 'default',
});

function walk(node: unknown, path: string[], out: Array<{ key: string; value: string }>) {
  if (typeof node === 'string') {
    out.push({ key: path.join('.'), value: node });
  } else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) walk(v, [...path, k], out);
  }
}

function offenders(): string[] {
  const found: string[] = [];
  const scan = (prefix: string, files: Record<string, unknown>) => {
    for (const [file, json] of Object.entries(files)) {
      const name = `${prefix}/${file.split('/').pop()}`;
      const strings: Array<{ key: string; value: string }> = [];
      walk(json, [], strings);
      for (const { key, value } of strings) {
        if (hasGlyph(value) && !(`${name}:${key}` in KEPT)) {
          found.push(`${name}:${key} -> ${JSON.stringify(value)}`);
        }
      }
    }
  };
  scan('web', webFiles);
  scan('shared', sharedFiles);
  return found;
}

describe('locale copy has no emoji or decorative glyphs', () => {
  it('loads the locale files it is meant to scan', () => {
    expect(Object.keys(webFiles)).toHaveLength(3);
    expect(Object.keys(sharedFiles)).toHaveLength(3);
  });

  it('has no glyph outside the KEPT map', () => {
    expect(offenders(), 'draw an <Icon> next to the text, or add the key to KEPT with a reason').toEqual([]);
  });

  it('every KEPT entry still exists and still carries a glyph', () => {
    const byName = new Map<string, unknown>();
    for (const [prefix, files] of [['web', webFiles], ['shared', sharedFiles]] as const) {
      for (const [file, json] of Object.entries(files)) byName.set(`${prefix}/${file.split('/').pop()}`, json);
    }
    const stale: string[] = [];
    for (const entry of Object.keys(KEPT)) {
      const [name, key] = entry.split(':');
      if (!byName.has(name)) {
        stale.push(`${entry} -> no locale file named ${name}`);
        continue;
      }
      const strings: Array<{ key: string; value: string }> = [];
      walk(byName.get(name), [], strings);
      const hit = strings.find((s) => s.key === key);
      if (!hit) stale.push(`${entry} -> key not found`);
      else if (!hasGlyph(hit.value)) stale.push(`${entry} -> no glyph left`);
    }
    expect(stale, 'KEPT entry is stale; fix or remove it').toEqual([]);
  });
});
