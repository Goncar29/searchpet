// The map labels resolve against the REAL i18n instance in the three
// languages (the screen test mocks `t`, so it cannot see a wrong or missing
// translation). "Veterinaries" is not English: the en copy uses "Vets".
import i18n from '../i18n';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const EXPECTED: Record<string, { vetsToggle: string; vetEmpty: string }> = {
  es: { vetsToggle: 'Veterinarias', vetEmpty: 'No hay veterinarias en esta zona' },
  en: { vetsToggle: 'Vets', vetEmpty: 'No vets in this area' },
  pt: { vetsToggle: 'Veterinárias', vetEmpty: 'Não há veterinárias nesta área' },
};

describe.each(Object.keys(EXPECTED))('map vet labels in %s', (lng) => {
  it('exist in that language (no fallback to Spanish) and read as expected', () => {
    for (const key of ['vetsToggle', 'vetEmpty'] as const) {
      expect(i18n.exists(`map:${key}`, { lng, fallbackLng: [] })).toBe(true);
      expect(i18n.t(`map:${key}`, { lng })).toBe(EXPECTED[lng][key]);
    }
  });
});
