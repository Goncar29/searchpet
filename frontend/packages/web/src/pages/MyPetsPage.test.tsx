import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MyPetsPage } from './MyPetsPage';
import type { Pet, PetStatus } from '@shared/types';

const state = vi.hoisted(() => ({ owned: [] as Pet[] }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'es' } }),
}));

vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router')>();
  return { ...actual, useNavigate: () => vi.fn() };
});

vi.mock('@shared/hooks', () => ({
  useMyPets: () => ({ data: state.owned, isLoading: false }),
  useReportedPets: () => ({ data: [], isLoading: false }),
  useDeletePet: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdatePet: () => ({ mutate: vi.fn(), isPending: false }),
}));

function makePet(status: PetStatus): Pet {
  return {
    id: `pet-${status}`,
    name: `Pet ${status}`,
    type: 'perro',
    status,
    photos: [],
  } as unknown as Pet;
}

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

function optionValues(): string[] {
  const select = screen.getByTestId('status-select') as HTMLSelectElement;
  return within(select)
    .queryAllByRole('option')
    .map((o) => (o as HTMLOptionElement).value);
}

describe('MyPetsPage', () => {
  beforeEach(() => {
    state.owned = [];
  });

  it('renderiza sin lanzar errores', () => {
    render(<MyPetsPage />, { wrapper });
    expect(document.body).toBeTruthy();
  });

  it('no ofrece "lost" como destino en el selector de estado (se usa "Publicar como perdida")', () => {
    state.owned = [makePet('registered')];
    render(<MyPetsPage />, { wrapper });
    const values = optionValues();
    expect(values).toContain('registered');
    expect(values).toContain('archived');
    expect(values).not.toContain('lost');
  });

  it('mantiene "lost" visible cuando es el estado actual (para poder salir de él)', () => {
    state.owned = [makePet('lost')];
    render(<MyPetsPage />, { wrapper });
    const values = optionValues();
    expect(values).toContain('lost');
    expect(values).toContain('found');
    expect(values).toContain('registered');
  });

  it('una mascota en adopción aparece en la tab "adoption:profile.tab" y no en "owned"', () => {
    state.owned = [makePet('adoption')];
    render(<MyPetsPage />, { wrapper });

    // Por defecto se muestra la tab "owned": la mascota en adopción no debe aparecer ahí.
    expect(screen.queryByText('Pet adoption')).not.toBeInTheDocument();

    // Cambiar a la tab de adopción.
    fireEvent.click(screen.getByRole('button', { name: 'adoption:profile.tab' }));
    expect(screen.getByText('Pet adoption')).toBeInTheDocument();

    // El botón "Reportar perdida" no debe estar disponible para una mascota en adopción.
    expect(screen.queryByText('pets:mine.reportLost')).not.toBeInTheDocument();

    // El selector de estado debe ofrecer "adopted" como transición.
    const values = optionValues();
    expect(values).toContain('adopted');
  });
});
