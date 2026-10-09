// The update check compares the installed version with the latest GitHub
// release. The release guard (build-apk.yml) keeps the tag equal to app.json's
// version, so "v1.3.0" vs "1.2.0" is a real comparison.
import { isNewerVersion, fetchLatestVersion } from '../utils/updateCheck';

describe('isNewerVersion', () => {
  it.each([
    ['1.3.0', '1.2.0', true],
    ['1.2.1', '1.2.0', true],
    ['2.0.0', '1.9.9', true],
    // Numeric, not alphabetic: "1.10.0" sorts before "1.9.0" as text.
    ['1.10.0', '1.9.0', true],
    ['1.2.0', '1.2.0', false],
    ['1.1.0', '1.2.0', false],
    ['1.9.0', '1.10.0', false],
  ])('%s sobre %s → %s', (latest, current, expected) => {
    expect(isNewerVersion(latest, current)).toBe(expected);
  });

  it('nunca afirma una versión nueva si alguna de las dos no se entiende', () => {
    expect(isNewerVersion('', '1.2.0')).toBe(false);
    expect(isNewerVersion('beta', '1.2.0')).toBe(false);
    expect(isNewerVersion('1.3.0', '')).toBe(false);
    expect(isNewerVersion('1.3.0-rc.1', '1.2.0')).toBe(false);
  });
});

describe('fetchLatestVersion', () => {
  const ok = (body: unknown) =>
    jest.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(body) });

  it('devuelve la versión del tag, sin la "v"', async () => {
    const fetchImpl = ok({ tag_name: 'v1.3.0' });
    await expect(fetchLatestVersion(fetchImpl)).resolves.toBe('1.3.0');
    expect(fetchImpl.mock.calls[0][0]).toBe(
      'https://api.github.com/repos/Goncar29/searchpet/releases/latest',
    );
  });

  it('devuelve null si GitHub responde con error', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({}) });
    await expect(fetchLatestVersion(fetchImpl)).resolves.toBeNull();
  });

  it('devuelve null si no hay red', async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new TypeError('Network request failed'));
    await expect(fetchLatestVersion(fetchImpl)).resolves.toBeNull();
  });

  it('devuelve null si la respuesta no trae un tag', async () => {
    await expect(fetchLatestVersion(ok({}))).resolves.toBeNull();
    await expect(fetchLatestVersion(ok({ tag_name: 42 }))).resolves.toBeNull();
  });
});
