// Guards the premise behind ignoring GHSA-vcc3-ghjq-m6fr (decode-uri-component
// DoS) in pnpm-workspace.yaml: the package ships in the bundle, but a deep link
// never reaches it. expo-router parses the query with the native URL API and
// replaces React Navigation's parser, the only one that calls
// query-string.parse. If that stops being true, this fails and the ignore has
// to be re-evaluated; the audit would stay green on its own.
import fs from 'fs';
import path from 'path';

const mockDecode = jest.fn((value: string) => decodeURIComponent(value));
jest.mock('decode-uri-component', () => mockDecode);

const MALICIOUS_QUERY = '/pet/1?q=' + '%E0%A4%A'.repeat(20000);

beforeEach(() => mockDecode.mockClear());

describe('deep links and decode-uri-component', () => {
  it('the spy sees query-string calling it (control: the guard is not blind)', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const queryString = require('query-string');
    queryString.parse('q=%41');
    expect(mockDecode).toHaveBeenCalled();
  });

  it("expo-router's parser handles a malicious link without calling it", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { parseQueryParams } = require('expo-router/build/fork/getStateFromPath-forks');
    const params = parseQueryParams(MALICIOUS_QUERY, { name: 'pet/[id]', params: {} });
    // The decoded length depends on the URL implementation (Node and Jest
    // replace invalid sequences differently); only that it parsed matters.
    expect(typeof params.q).toBe('string');
    expect(mockDecode).not.toHaveBeenCalled();
  });

  it('no app or shared source imports query-string', () => {
    const root = path.resolve(__dirname, '..');
    const dirs = ['app', 'components', 'store', 'utils', 'hooks', '../shared'];
    const files = dirs
      .map((d) => path.join(root, d))
      .filter((d) => fs.existsSync(d))
      .flatMap(function walk(dir: string): string[] {
        return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
          const full = path.join(dir, e.name);
          if (e.isDirectory()) return e.name === 'node_modules' ? [] : walk(full);
          return /\.(ts|tsx|js)$/.test(e.name) ? [full] : [];
        });
      });
    expect(files.length).toBeGreaterThan(50);
    const importers = files
      .filter((f) => /['"]query-string['"]/.test(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(root, f));
    expect(importers).toEqual([]);
  });
});
