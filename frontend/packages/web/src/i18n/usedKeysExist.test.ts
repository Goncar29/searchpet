import { describe, it, expect, beforeAll } from 'vitest';
import ts from 'typescript';
import i18n from './index';

// Every translation key the web code asks for with a LITERAL must exist in the
// resources the app actually loads. A missing key does not fail anything: i18next
// renders the raw key path on screen. This is the inverse of the orphan cleanup
// (G3): deleting a key that is still in use makes this test fail.
//
// It asks the real i18next instance (`i18n.exists`) instead of rebuilding the
// resource map, because index.ts decides which file each namespace comes from:
// `publish`, for instance, is registered from shared/, and a copy of it in web's
// own locales is never loaded.
//
// Calls are found with the TypeScript parser, not with regexes over the text:
// a key named in a comment is not a use, and stripping comments by hand breaks
// on a `//` inside a string.

const sources = import.meta.glob<string>(['../**/*.{ts,tsx}', '!../**/*.test.{ts,tsx}'], {
  query: '?raw',
  import: 'default',
  eager: true,
});

type Use = { file: string; key: string };

const firstNamespace = (arg: ts.Expression | undefined): string | undefined => {
  if (!arg) return undefined;
  if (ts.isStringLiteralLike(arg)) return arg.text;
  if (ts.isArrayLiteralExpression(arg) && arg.elements[0] && ts.isStringLiteralLike(arg.elements[0])) {
    return arg.elements[0].text;
  }
  return undefined;
};

function keysIn(file: string, src: string): Use[] {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  // Local name of each translate function -> its default namespace.
  // `const { t } = useTranslation('ns')`, `const { t: tAdoption } = useTranslation(...)`.
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
    // i18n.t('ns:key') / i18next.t('ns:key')
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

describe('translation keys used by the web code', () => {
  let uses: Use[];
  beforeAll(() => {
    uses = Object.entries(sources).flatMap(([file, src]) => keysIn(file, src));
  });

  it('scans the real code (control: the guard is not blind)', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(100);
    expect(uses.length).toBeGreaterThan(900);
    const keys = uses.map((u) => u.key);
    // A bare key resolved through a list of namespaces.
    expect(keys).toContain('publish:strayForm.photoLabel');
    // A key reached through an aliased translate function.
    expect(keys.some((k) => k.startsWith('adoption:'))).toBe(true);
    // A key named only in a comment is not a use.
    expect(keys).not.toContain('admin:groups.error');
  });

  it('every key used with a literal exists in the loaded resources', () => {
    const missing = uses.filter((u) => !exists(u.key)).map((u) => `${u.file}: ${u.key}`);
    expect(missing).toEqual([]);
  });
});
