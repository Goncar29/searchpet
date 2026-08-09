import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Pet } from '@shared/types';
import { EditPetPage } from './EditPetPage';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'es' } }),
}));

vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router')>();
  return {
    ...actual,
    useParams: () => ({ id: 'pet-123' }),
    useNavigate: () => vi.fn(),
  };
});

// Mutable para que cada test elija qué mascota devuelve la API.
let petData: Pet | null = null;
const mutate = vi.fn();

vi.mock('@shared/hooks', () => ({
  usePetByID: () => ({ data: petData, isLoading: petData === null }),
  useUpdatePet: () => ({ mutate, mutateAsync: vi.fn(), isPending: false }),
  useUploadPhoto: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

function unaMascota(extra: Partial<Pet> = {}): Pet {
  return {
    id: 'pet-123',
    name: 'Koda',
    type: 'perro',
    status: 'registered',
    photos: [],
    created_at: '2026-01-01T00:00:00Z',
    ...extra,
  } as Pet;
}

beforeEach(() => {
  petData = null;
  mutate.mockClear();
});

describe('EditPetPage', () => {
  it('renderiza sin lanzar errores', () => {
    render(<EditPetPage />, { wrapper });
    expect(document.body).toBeTruthy();
  });

  // EL test de la feature. El backend guarda "2022-01-01" para una precisión
  // 'year' porque la columna es DATE y necesita un día concreto. Si el
  // formulario rehidratara mes=enero y día=1, el dueño vería una fecha exacta
  // que nunca afirmó — y al guardar quedaría como 'day'.
  //
  // El dato se contaminaría SOLO, con abrir y cerrar la pantalla, sin que nadie
  // se equivoque y sin ningún error a la vista. Y una vez contaminado no hay
  // forma de distinguir al que sabía la fecha del que sólo sabía el año.
  it('con precisión year rehidrata SÓLO el año, y guardar sin tocar nada no la sube a day', () => {
    petData = unaMascota({ birth_date: '2022-01-01', birth_date_precision: 'year' });
    render(<EditPetPage />, { wrapper });

    expect((screen.getByLabelText('pets:create.birthYear') as HTMLSelectElement).value).toBe('2022');
    expect((screen.getByLabelText('pets:create.birthMonth') as HTMLSelectElement).value).toBe('');
    expect((screen.getByLabelText('pets:create.birthDay') as HTMLSelectElement).value).toBe('');

    fireEvent.submit(screen.getByRole('button', { name: 'pets:edit.submit' }).closest('form')!);

    expect(mutate).toHaveBeenCalled();
    expect(mutate.mock.calls[0][0].data).toMatchObject({
      birth_date: '2022-01-01',
      birth_date_precision: 'year',
    });
  });

  it('con precisión month rehidrata año y mes, y el día queda vacío', () => {
    petData = unaMascota({ birth_date: '2022-03-01', birth_date_precision: 'month' });
    render(<EditPetPage />, { wrapper });

    expect((screen.getByLabelText('pets:create.birthYear') as HTMLSelectElement).value).toBe('2022');
    expect((screen.getByLabelText('pets:create.birthMonth') as HTMLSelectElement).value).toBe('3');
    expect((screen.getByLabelText('pets:create.birthDay') as HTMLSelectElement).value).toBe('');
  });

  // Vaciar el año tiene que borrar el PAR completo. Mandar la fecha vacía y
  // dejar viva la precisión es el request contradictorio que el backend
  // responde con 400 — y le llegaría al usuario como "datos inválidos" sobre
  // un formulario que llenó bien.
  it('vaciar el año manda los dos campos vacíos, nunca uno solo', () => {
    petData = unaMascota({ birth_date: '2022-03-09', birth_date_precision: 'day' });
    render(<EditPetPage />, { wrapper });

    fireEvent.change(screen.getByLabelText('pets:create.birthYear'), { target: { value: '' } });
    fireEvent.submit(screen.getByRole('button', { name: 'pets:edit.submit' }).closest('form')!);

    expect(mutate.mock.calls[0][0].data).toMatchObject({
      birth_date: '',
      birth_date_precision: '',
    });
  });

  it('manda el sexo elegido', () => {
    petData = unaMascota({ gender: 'female' });
    render(<EditPetPage />, { wrapper });

    expect((screen.getByLabelText('pets:create.gender') as HTMLSelectElement).value).toBe('female');
  });
});
