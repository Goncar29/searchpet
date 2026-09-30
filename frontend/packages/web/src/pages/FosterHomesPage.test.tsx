import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { FosterHomesPage } from './FosterHomesPage';
import { drawnPaths, iconPath, EMOJI } from '../test/icons';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'es' } }),
}));

vi.mock('@shared/hooks', () => ({
  useFosterHomes: () => ({ data: [], isLoading: false, isError: false }),
}));

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <MemoryRouter>{children}</MemoryRouter>
);

// Emoji ignore `currentColor` and dark mode; the directory draws icons instead.
describe('FosterHomesPage — sin emoji', () => {
  it('el estado vacío dibuja el ícono home', () => {
    const { container } = render(<FosterHomesPage />, { wrapper });

    expect(screen.getByText('fosterHomes:directory.empty')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(EMOJI);
    expect(drawnPaths(container)).toContain(iconPath('home'));
  });

  it('limpiar filtros se dibuja con el ícono close, sin emoji', () => {
    const { container } = render(<FosterHomesPage />, { wrapper });
    // Sin filtros aplicados no hay botón que limpiar.
    expect(screen.queryByText('fosterHomes:directory.clearFilters')).not.toBeInTheDocument();

    fireEvent.change(container.querySelector('#fh-city')!, { target: { value: 'Salto' } });
    fireEvent.click(screen.getByText('common:search'));

    const clear = screen.getByText('fosterHomes:directory.clearFilters').closest('button')!;
    expect(clear.textContent).not.toMatch(EMOJI);
    expect(drawnPaths(clear)).toEqual([iconPath('close')]);
  });
});
