import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Link } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MyPetsPage } from './MyPetsPage';
import type { Pet, PetStatus } from '@shared/types';

const state = vi.hoisted(() => ({ owned: [] as Pet[], reported: [] as Pet[] }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'es' } }),
}));

vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router')>();
  return { ...actual, useNavigate: () => vi.fn() };
});

vi.mock('@shared/hooks', () => ({
  useMyPets: () => ({ data: state.owned, isLoading: false }),
  useReportedPets: () => ({ data: state.reported, isLoading: false }),
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

/** Wrapper que abre la pantalla en una URL concreta, para probar `?tab=`. */
function wrapperAt(url: string) {
  return function Wrapped({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter initialEntries={[url]}>{children}</MemoryRouter>
      </QueryClientProvider>
    );
  };
}

describe('MyPetsPage', () => {
  beforeEach(() => {
    state.owned = [];
    state.reported = [];
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

  // `?tab=` es la puerta de entrada que usa el perfil: su "ver todos mis
  // reportes" enlaza acá. Sin esto el link aterrizaba en "Mis mascotas" y el
  // nombre accesible prometía algo que el destino no entregaba.
  it('abre en la pestaña que pide ?tab=', () => {
    state.owned = [makePet('registered')];
    state.reported = [makePet('stray')];
    render(<MyPetsPage />, { wrapper: wrapperAt('/my-pets?tab=reported') });

    expect(screen.getByText('Pet stray')).toBeInTheDocument();
    expect(screen.queryByText('Pet registered')).not.toBeInTheDocument();
  });

  it('abre en adopción con ?tab=adoption', () => {
    state.owned = [makePet('registered'), makePet('adoption')];
    render(<MyPetsPage />, { wrapper: wrapperAt('/my-pets?tab=adoption') });

    expect(screen.getByText('Pet adoption')).toBeInTheDocument();
    expect(screen.queryByText('Pet registered')).not.toBeInTheDocument();
  });

  // Un `?tab=` inventado no puede dejar la pantalla sin ninguna pestaña
  // seleccionada: cae en la de por defecto.
  it('con un ?tab= desconocido cae en "owned"', () => {
    state.owned = [makePet('registered')];
    state.reported = [makePet('stray')];
    render(<MyPetsPage />, { wrapper: wrapperAt('/my-pets?tab=cualquiera') });

    expect(screen.getByText('Pet registered')).toBeInTheDocument();
    expect(screen.queryByText('Pet stray')).not.toBeInTheDocument();
  });

  // Sin `?tab=` la pantalla sigue abriendo donde siempre.
  it('sin ?tab= abre en "owned"', () => {
    state.owned = [makePet('registered')];
    state.reported = [makePet('stray')];
    render(<MyPetsPage />, { wrapper });

    expect(screen.getByText('Pet registered')).toBeInTheDocument();
    expect(screen.queryByText('Pet stray')).not.toBeInTheDocument();
  });

  // Navegar a la misma ruta NO remonta el elemento (regla #51), así que leer
  // `?tab=` sólo en el inicializador dejaba la URL y la pestaña visible
  // contradiciéndose: se llega desde el perfil a `?tab=adoption`, se toca "Mis
  // mascotas" en el navbar, la URL pierde el parámetro y la pestaña de adopción
  // se queda seleccionada. Un F5 después cambiaba sola.
  it('al navegar a la misma ruta sin ?tab= vuelve a "owned"', async () => {
    state.owned = [makePet('registered'), makePet('adoption')];
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter initialEntries={['/pets/mine?tab=adoption']}>
          {/* El link imita el del navbar: misma ruta, sin el parámetro. */}
          <Link to="/pets/mine">volver-a-mis-mascotas</Link>
          <MyPetsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    // Arranca donde pidió la URL.
    expect(screen.getByText('Pet adoption')).toBeInTheDocument();

    await userEvent.click(screen.getByText('volver-a-mis-mascotas'));

    // Y sigue a la URL cuando ésta cambia, sin remontar.
    expect(screen.getByText('Pet registered')).toBeInTheDocument();
    expect(screen.queryByText('Pet adoption')).not.toBeInTheDocument();
  });
});
