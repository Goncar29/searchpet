// No screen or component renders an emoji or a UI glyph (arrow, check, star...)
// as text: they are registry icons now (`components/Icon`). Reads every source
// file with the TypeScript parser, so an emoji in a COMMENT is not a use but
// one in JSX text, a string or a template literal is. Add to KEPT only a glyph
// that leaves the app or is part of the copy, with the reason.
import fs from 'fs';
import path from 'path';
import ts from 'typescript';

const ROOT = path.resolve(__dirname, '..');
const DIRS = ['app', 'components'];
const GLYPH =
  /[\u{1F000}-\u{1FFFF}\u{2190}-\u{21FF}\u{2300}-\u{23FF}\u{2600}-\u{27BF}\u{2900}-\u{2BFF}\u{2022}\u{FE0F}]/u;

// file (relative, forward slashes) -> reason. Empty on purpose.
const KEPT: Record<string, string> = {};

function sourceFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' || e.name === '__tests__' ? [] : sourceFiles(full);
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [full] : [];
  });
}

function glyphLines(file: string): string[] {
  const src = fs.readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const hits: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isJsxText(node) ||
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      if (GLYPH.test(node.text)) {
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart());
        hits.push(`${path.relative(ROOT, file).split(path.sep).join('/')}:${line + 1} ${JSON.stringify(node.text.trim())}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

describe('no emoji or UI glyph rendered as text in mobile screens and components', () => {
  it('finds none outside the documented exceptions', () => {
    const hits = DIRS.flatMap((d) => sourceFiles(path.join(ROOT, d))).flatMap(glyphLines);
    const unexpected = hits.filter((h) => !Object.keys(KEPT).some((k) => h.startsWith(k + ':')));
    expect(unexpected).toEqual([]);
  });
});
