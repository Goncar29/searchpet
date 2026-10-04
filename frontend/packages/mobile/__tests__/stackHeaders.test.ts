// Every Stack route outside the tab bar must be registered in app/_layout.tsx,
// either with a translated native title or with `headerShown: false` (the
// screen then draws its own header). An unregistered route makes the native
// header show the raw route name (`foster-homes/index`); a screen with a native
// header that also draws its own title + back arrow shows two headers.
//
// Routes and registrations are read with the TypeScript parser, and each
// title is resolved against the REAL i18n instance in the three languages.
import fs from 'fs';
import path from 'path';
import ts from 'typescript';
import i18n from '../i18n';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const ROOT = path.resolve(__dirname, '..');
const APP = path.join(ROOT, 'app');

// Route groups and the layout itself are not Stack routes.
function routeFiles(dir = APP): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return e.name.startsWith('(') ? [] : routeFiles(full);
    if (!/\.tsx$/.test(e.name) || e.name === '_layout.tsx') return [];
    return [full];
  });
}

const routeName = (file: string) =>
  path.relative(APP, file).split(path.sep).join('/').replace(/\.tsx$/, '');

type Registration = { name: string; title?: string; titleCallee?: string; headerHidden: boolean };

function registrations(): Registration[] {
  const file = path.join(APP, '_layout.tsx');
  const sf = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: Registration[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(sf) === 'Stack.Screen') {
      const reg: Registration = { name: '', headerHidden: false };
      for (const attr of node.attributes.properties) {
        if (!ts.isJsxAttribute(attr)) continue;
        const attrName = attr.name.getText(sf);
        const init = attr.initializer;
        if (attrName === 'name' && init && ts.isStringLiteral(init)) reg.name = init.text;
        if (attrName === 'options' && init && ts.isJsxExpression(init) && init.expression && ts.isObjectLiteralExpression(init.expression)) {
          for (const prop of init.expression.properties) {
            if (!ts.isPropertyAssignment(prop)) continue;
            const key = prop.name.getText(sf);
            if (key === 'headerShown' && prop.initializer.kind === ts.SyntaxKind.FalseKeyword) reg.headerHidden = true;
            if (key === 'title' && ts.isCallExpression(prop.initializer)) {
              const arg = prop.initializer.arguments[0];
              if (arg && ts.isStringLiteralLike(arg)) reg.title = arg.text;
              reg.titleCallee = prop.initializer.expression.getText(sf);
            }
          }
        }
      }
      out.push(reg);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

// A back arrow drawn inside a screen that already has a native header: either a
// text glyph or, since the emoji-to-icons work, a registry icon passed as
// `name`/`icon` to <Icon> or <IconLabel>.
const BACK_ICONS = new Set(['arrow-back', 'chevron-left']);

function drawsOwnBackArrow(file: string): boolean {
  const sf = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found = false;
  const visit = (node: ts.Node) => {
    if ((ts.isJsxText(node) || ts.isStringLiteral(node)) && /[‹←]/.test(node.text)) found = true;
    if (
      ts.isJsxAttribute(node) &&
      ['name', 'icon'].includes(node.name.getText(sf)) &&
      node.initializer &&
      ts.isStringLiteral(node.initializer) &&
      BACK_ICONS.has(node.initializer.text)
    ) {
      found = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

// Translation keys a screen renders in-screen, qualified with the namespace its
// `useTranslation('ns')` declares when the key itself carries none.
function renderedKeys(file: string): string[] {
  const sf = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let defaultNs: string | undefined;
  const calls: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText(sf);
      const arg = node.arguments[0];
      if (callee === 'useTranslation' && arg && ts.isStringLiteralLike(arg)) defaultNs ??= arg.text;
      // Only text drawn as a JSX child (`<Text>{t('k')}</Text>`): an Alert title or
      // an accessibility label reusing the key is not a second on-screen title.
      const drawn = ts.isJsxExpression(node.parent) && (ts.isJsxElement(node.parent.parent) || ts.isJsxFragment(node.parent.parent));
      if (drawn && (callee === 't' || callee === 'i18next.t') && arg && ts.isStringLiteralLike(arg)) calls.push(arg.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return calls.map((k) => (k.includes(':') || !defaultNs ? k : `${defaultNs}:${k}`));
}

describe('Stack routes and their headers', () => {
  const regs = registrations();
  const byName = new Map(regs.map((r) => [r.name, r]));
  const routes = routeFiles().map((f) => ({ name: routeName(f), file: f }));

  it('reads the real routes (control: the guard is not blind)', () => {
    expect(routes.length).toBeGreaterThan(20);
    expect(regs.length).toBeGreaterThan(20);
    expect(byName.get('login')?.title).toBe('profile:loginButton');
  });

  it('registers every Stack route', () => {
    expect(routes.filter((r) => !byName.has(r.name)).map((r) => r.name)).toEqual([]);
  });

  it('registers no route that does not exist', () => {
    const real = new Set(routes.map((r) => r.name));
    expect(regs.filter((r) => r.name !== '(tabs)' && !real.has(r.name)).map((r) => r.name)).toEqual([]);
  });

  it('gives every route a translated title or hides the native header', () => {
    expect(routes.filter((r) => !byName.get(r.name)?.title && !byName.get(r.name)?.headerHidden).map((r) => r.name)).toEqual([]);
  });

  it('draws no second back arrow in a screen with a native header', () => {
    const doubled = routes.filter((r) => byName.get(r.name)?.title && drawsOwnBackArrow(r.file)).map((r) => r.name);
    expect(doubled).toEqual([]);
  });

  it('reads every native title through the language-aware t from useTranslation', () => {
    expect(regs.filter((r) => r.title && r.titleCallee !== 't').map((r) => `${r.name}: ${r.titleCallee}`)).toEqual([]);
  });

  it('does not repeat the native title as an in-screen title', () => {
    const repeated = routes
      .filter((r) => byName.get(r.name)?.title)
      .filter((r) => renderedKeys(r.file).includes(byName.get(r.name)?.title as string))
      .map((r) => `${r.name}: ${byName.get(r.name)?.title}`);
    expect(repeated).toEqual([]);
  });

  describe.each(['es', 'en', 'pt'])('titles in %s', (lng) => {
    it('resolve to text, not to the key', () => {
      const bad = regs
        .filter((r) => r.title)
        .filter((r) => {
          const key = r.title as string;
          const value = i18n.t(key, { lng });
          return !i18n.exists(key, { lng, fallbackLng: [] }) || !value || value === key || value === key.split(':')[1];
        })
        .map((r) => `${r.name}: ${r.title}`);
      expect(bad).toEqual([]);
    });
  });
});
