import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { FosterHome } from '@shared/types';
import { FosterHomeCard } from './FosterHomeCard';
import { drawnPaths, iconPath, EMOJI } from '../test/icons';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'es' } }),
}));

function card(photos: unknown[]) {
  const fosterHome = {
    id: 'fh-1',
    city: 'Montevideo',
    housing_type: 'house',
    animal_types: [],
    photos,
  } as unknown as FosterHome;
  return render(
    <MemoryRouter>
      <FosterHomeCard fosterHome={fosterHome} />
    </MemoryRouter>,
  );
}

// Emoji ignore `currentColor` and dark mode; the card draws icons instead.
describe('FosterHomeCard — sin emoji', () => {
  it('sin foto dibuja el placeholder home y la ciudad con el pin', () => {
    const { container } = card([]);

    expect(container.textContent).not.toMatch(EMOJI);
    expect(container.querySelector('h3')?.textContent).toBe('Montevideo');
    const paths = drawnPaths(container);
    expect(paths).toContain(iconPath('home'));
    expect(paths).toContain(iconPath('location-on'));
  });

  it('con foto muestra la imagen y NO el placeholder', () => {
    const { container } = card([{ id: 'p1', url: 'https://cdn/a.jpg' }]);

    expect(container.querySelector('img')).not.toBeNull();
    expect(drawnPaths(container)).not.toContain(iconPath('home'));
    expect(drawnPaths(container)).toContain(iconPath('location-on'));
  });
});
