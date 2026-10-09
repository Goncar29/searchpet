// Guard: the app raises its dialogs with showAlert (components/appAlert), never
// with React Native's Alert. The native dialog ignores the theme (a white box
// in dark mode) and on Android shows at most three buttons, which once hid
// Report in the chat menu. All 96 calls were migrated on 2026-10-09.
//
// It sweeps the source tree instead of listing files, so a screen added later
// is covered too, and it looks at the import, so an alias (`Alert as RNAlert`)
// cannot slip past.
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '..');
const SCANNED_DIRS = ['app', 'components', 'hooks', 'store', 'utils'];

function sourceFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

const rel = (f: string) => path.relative(ROOT, f).split(path.sep).join('/');

/** True when the file imports `Alert` (bare or aliased) from react-native. */
function importsNativeAlert(source: string): boolean {
  const imports = source.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]react-native['"]/g);
  for (const [, names] of imports) {
    if (names.split(',').some((n) => n.trim().split(/\s+as\s+/)[0] === 'Alert')) return true;
  }
  return /\{[^}]*\bAlert\b[^}]*\}\s*=\s*require\(\s*['"]react-native['"]\s*\)/.test(source);
}

describe('no native Alert in the app', () => {
  const files = SCANNED_DIRS.flatMap((dir) => sourceFiles(path.join(ROOT, dir)));

  it('scans the real source tree', () => {
    // A guard that reads nothing passes for the wrong reason. These screens
    // used Alert.alert before the migration and must be among the scanned files.
    expect(files.map(rel)).toEqual(
      expect.arrayContaining(['app/chat/[userId].tsx', 'app/users/[id].tsx', 'components/ShareButton.tsx']),
    );
  });

  it('recognises the forms it forbids', () => {
    expect(importsNativeAlert("import { View, Alert } from 'react-native';")).toBe(true);
    expect(importsNativeAlert("import {\n  Alert as RNAlert,\n  Text,\n} from 'react-native';")).toBe(true);
    expect(importsNativeAlert("const { Alert } = require('react-native');")).toBe(true);
    expect(importsNativeAlert("import { AlertButton } from 'react-native';")).toBe(false);
    expect(importsNativeAlert("import { showAlert } from '../components/appAlert';")).toBe(false);
  });

  it('no file imports Alert from react-native: use showAlert', () => {
    const offenders = files.filter((f) => importsNativeAlert(fs.readFileSync(f, 'utf8'))).map(rel);
    expect(offenders).toEqual([]);
  });
});
