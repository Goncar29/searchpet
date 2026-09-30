import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { Vet } from '@shared/types';
import { VetPopup } from './VetPopup';
import { drawnPaths, iconPath, EMOJI } from '../../test/icons';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'es' } }),
}));

const vet = {
  id: 'v1',
  name: 'VetCare',
  latitude: -34.9,
  longitude: -56.1,
  distance_meters: 1200,
} as unknown as Vet;

// Emoji ignore `currentColor` and dark mode; the popup draws icons instead.
describe('VetPopup — sin emoji', () => {
  it('la distancia lleva el pin y NO hay reloj cuando no hay horario', () => {
    const { container } = render(<VetPopup vet={vet} />);

    expect(container.textContent).not.toMatch(EMOJI);
    expect(container.textContent).toContain('1.2 km');
    expect(drawnPaths(container)).toContain(iconPath('location-on'));
    expect(drawnPaths(container)).not.toContain(iconPath('schedule'));
  });

  it('con horario dibuja además el reloj', () => {
    const { container } = render(<VetPopup vet={{ ...vet, opening_hours: 'Mo-Fr 09-18' } as Vet} />);

    expect(container.textContent).not.toMatch(EMOJI);
    expect(container.textContent).toContain('Mo-Fr 09-18');
    expect(drawnPaths(container)).toContain(iconPath('schedule'));
  });
});
