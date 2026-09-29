// Every translation key the mobile code asks for with a LITERAL must exist in
// the resources the app actually loads. A missing key fails nothing: i18next
// renders the raw key path. This is the inverse of the orphan cleanup (G3):
// deleting a key still in use makes this test fail.
//
// It asks the real i18next instance, because i18n/index.ts merges shared and
// mobile locales with a shallow spread: when both define a namespace, mobile's
// replaces shared's whole (CLAUDE.md rule #12). Calls are found with the
// TypeScript parser, so a key named in a comment is not a use.
import fs from 'fs';
import path from 'path';
import ts from 'typescript';
import i18n from '../i18n';

// i18n/index.ts reads the saved language from AsyncStorage, which has no
// global mock in this suite; the package ships one.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const ROOT = path.resolve(__dirname, '..');
const DIRS = ['app', 'components', 'hooks', 'store', 'utils', 'constants'];

function sourceFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' || e.name === '__tests__' ? [] : sourceFiles(full);
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [full] : [];
  });
}

type Use = { file: string; key: string };

function firstNamespace(arg: ts.Expression | undefined): string | undefined {
  if (!arg) return undefined;
  if (ts.isStringLiteralLike(arg)) return arg.text;
  if (ts.isArrayLiteralExpression(arg) && arg.elements[0] && ts.isStringLiteralLike(arg.elements[0])) {
    return arg.elements[0].text;
  }
  return undefined;
}

function keysIn(file: string, src: string): Use[] {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const fns = new Map<string, string>();
  const calls: ts.CallExpression[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isObjectBindingPattern(node.name) &&
      node.initializer &&
      ts.isCallExpression(node.initializer) &&
      ts.isIdentifier(node.initializer.expression) &&
      node.initializer.expression.text === 'useTranslation'
    ) {
      const ns = firstNamespace(node.initializer.arguments[0]);
      for (const el of node.name.elements) {
        const prop = el.propertyName ?? el.name;
        if (ns && ts.isIdentifier(prop) && prop.text === 't' && ts.isIdentifier(el.name)) {
          fns.set(el.name.text, ns);
        }
      }
    }
    if (ts.isCallExpression(node)) calls.push(node);
    ts.forEachChild(node, visit);
  };
  visit(sf);

  const uses: Use[] = [];
  for (const call of calls) {
    const arg = call.arguments[0];
    if (!arg || !ts.isStringLiteralLike(arg)) continue;
    const callee = call.expression;
    if (ts.isPropertyAccessExpression(callee) && callee.name.text === 't') {
      if (arg.text.includes(':')) uses.push({ file, key: arg.text });
      continue;
    }
    if (!ts.isIdentifier(callee)) continue;
    const ns = fns.get(callee.text);
    if (ns === undefined) continue;
    uses.push({ file, key: arg.text.includes(':') ? arg.text : `${ns}:${arg.text}` });
  }
  return uses;
}

const exists = (key: string) =>
  i18n.exists(key, { lng: 'es' }) || i18n.exists(key, { lng: 'es', count: 2 });

describe('translation keys used by the mobile code', () => {
  const files = DIRS.flatMap((d) => sourceFiles(path.join(ROOT, d)));
  const uses = files.flatMap((f) => keysIn(path.relative(ROOT, f), fs.readFileSync(f, 'utf8')));

  it('scans the real code (control: the guard is not blind)', () => {
    expect(files.length).toBeGreaterThan(50);
    expect(uses.length).toBeGreaterThan(500);
    // Keys reached through i18next.t('ns:key') outside a component.
    expect(uses.some((u) => u.key.startsWith('common:'))).toBe(true);
  });

  it('every key used with a literal exists in the loaded resources', () => {
    const missing = uses.filter((u) => !exists(u.key)).map((u) => `${u.file}: ${u.key}`);
    expect(missing).toEqual([]);
  });
});
