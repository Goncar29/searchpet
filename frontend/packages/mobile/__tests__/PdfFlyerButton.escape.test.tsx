// S4 of odd/tasks/auditoria-seguridad-2026-09-23.md: the flyer interpolates
// pet fields into the HTML that expo-print renders. The button is NOT
// owner-gated (anyone viewing a pet can print its flyer), so the text is
// written by one user and rendered on another user's device. Every
// user-controlled value must reach the HTML escaped.
//
// This drives the real component and reads the exact HTML handed to
// Print.printToFileAsync, instead of testing a helper in isolation: a helper
// with perfect tests proves nothing about a call site that forgot to use it.
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import type { Pet } from '@shared/types';
import * as Print from 'expo-print';
import i18next from 'i18next';
import { PdfFlyerButton } from '../components/PdfFlyerButton';

jest.mock('expo-print', () => ({
  printToFileAsync: jest.fn().mockResolvedValue({ uri: 'file:///flyer.pdf' }),
}));
jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn().mockResolvedValue(false),
  shareAsync: jest.fn(),
}));
jest.mock('qrcode', () => ({
  toDataURL: jest.fn().mockResolvedValue('data:image/png;base64,QR'),
}));
jest.mock('../../shared/hooks', () => ({
  useGenerateShareLink: () => ({
    mutateAsync: jest.fn().mockResolvedValue({ share_url: 'https://searchpet.app/share/abc' }),
  }),
}));

// One distinct payload per field, so a failure names the call site that
// forgot to escape instead of just saying "something leaked".
const payload = (field: string) => `"><script>INJ_${field}</script>`;

function pet(overrides: Partial<Pet>): Pet {
  return {
    id: 'pet-1',
    owner_id: 'owner-1',
    name: payload('NAME'),
    type: payload('TYPE'),
    breed: payload('BREED'),
    color: payload('COLOR'),
    city: payload('CITY'),
    description: payload('DESC'),
    status: 'adoption',
    photos: [{ id: 'ph-1', url: 'https://res.cloudinary.com/x.jpg" onerror="INJ_PHOTO', is_primary: true }],
    created_at: new Date().toISOString(),
    ...overrides,
  } as Pet;
}

async function flyerHtml(p: Pet): Promise<string> {
  const printMock = Print.printToFileAsync as jest.Mock;
  printMock.mockClear();
  const { getByTestId } = render(<PdfFlyerButton pet={p} />);
  fireEvent.press(getByTestId('pdf-flyer-button'));
  await waitFor(() => expect(printMock).toHaveBeenCalledTimes(1));
  return printMock.mock.calls[0][0].html as string;
}

// A real i18next with no resources: every lookup misses and returns its key.
// That is the production path for a pet type without a translation, where the
// key carries the raw user value (`types.<value>`) straight into the flyer.
beforeAll(async () => {
  await i18next.init({ lng: 'es', resources: { es: {} } });
});

describe('PdfFlyerButton — HTML escaping (S4)', () => {
  // The TYPE assertion below only proves the raw-key leak while i18next has no
  // translation for the type. If a setup file ever loads real resources, this
  // fails first and says why, instead of the TYPE assertion failing obscurely.
  it('precondition: a pet type without a translation comes back as its raw key', () => {
    expect(i18next.t('pets:types.<b>x')).toBe('types.<b>x');
  });

  it('escapes every user-controlled text field', async () => {
    const html = await flyerHtml(pet({}));

    // The flyer never ships a script of its own, so any <script> is injected.
    expect(html).not.toMatch(/<script/i);
    for (const field of ['NAME', 'TYPE', 'BREED', 'COLOR', 'CITY', 'DESC']) {
      expect(html).toContain(`&lt;script&gt;INJ_${field}`);
    }
  });

  it('does not let the photo URL break out of its src attribute', async () => {
    const html = await flyerHtml(pet({}));

    expect(html).not.toContain('onerror="INJ_PHOTO');
    expect(html).toContain('x.jpg&quot; onerror=&quot;INJ_PHOTO');
  });

  it('keeps ordinary values readable (escaping is not mangling)', async () => {
    const html = await flyerHtml(
      pet({ name: 'Firulais', breed: 'Mestizo', color: 'Marrón', city: 'Montevideo', description: 'Muy mimoso' }),
    );

    expect(html).toContain('<h1>Firulais</h1>');
    expect(html).toContain('Mestizo');
    expect(html).toContain('Marrón');
    expect(html).toContain('Montevideo');
    expect(html).toContain('Muy mimoso');
  });
});
