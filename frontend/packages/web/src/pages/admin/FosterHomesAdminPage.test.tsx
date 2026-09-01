import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { FosterHomesAdminPage } from './FosterHomesAdminPage';

/**
 * Esta pantalla NO tenía tests, y este archivo se escribió ANTES de tocarle el
 * marcado. El orden importa: caracteriza lo que la pantalla hace hoy, así el
 * rediseño que viene tiene contra qué chocar. Escribirlos después habría sido
 * describir lo que quedó, no lo que había.
 *
 * Todo lo que se afirma acá es COMPORTAMIENTO —qué se muestra, qué se llama al
 * moderar— y nada de clases ni estructura, que es justo lo que el rediseño va
 * a cambiar.
 */

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'es' } }),
}));

let cola: unknown[] = [];
let falla = false;

const approveMutate = vi.fn();
const rejectMutate = vi.fn();
const suspendMutate = vi.fn();
const reinstateMutate = vi.fn();

vi.mock('@shared/hooks', () => ({
  usePendingFosterHomes: () => ({
    data: falla ? undefined : cola,
    isLoading: false,
    isPending: false,
    isPaused: false,
    isError: falla,
    refetch: vi.fn(),
  }),
  useApproveFosterHome: () => ({ mutate: approveMutate, isPending: false }),
  useRejectFosterHome: () => ({ mutate: rejectMutate, isPending: false }),
  useSuspendFosterHome: () => ({ mutate: suspendMutate, isPending: false }),
  useReinstateFosterHome: () => ({ mutate: reinstateMutate, isPending: false }),
  useFosterHomeLogs: () => ({ data: [], isLoading: false }),
  useFosterHomeHistory: () => ({ data: [], isLoading: false }),
}));

vi.mock('@shared/utils/apiErrors', () => ({ getErrorMessage: () => 'error' }));

function hogar(over: Record<string, unknown> = {}) {
  return {
    id: 'fh-1',
    city: 'Montevideo',
    housing_type: 'house',
    capacity: 3,
    animal_types: ['dog'],
    status: 'pending',
    owner_name: 'Ana',
    owner_email: 'ana@test.uy',
    owner_user_id: 'u-1',
    photos: [],
    ...over,
  };
}

function pintar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <FosterHomesAdminPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  cola = [hogar()];
  falla = false;
  vi.clearAllMocks();
});

describe('FosterHomesAdminPage', () => {
  it('dibuja la cola con la ciudad, el estado y el dueño', () => {
    pintar();

    expect(screen.getByText(/Montevideo/)).toBeTruthy();
    expect(screen.getByText('fosterHomes:status.pending')).toBeTruthy();
    expect(screen.getByText(/ana@test\.uy/)).toBeTruthy();
  });

  it('con la cola vacía lo dice', () => {
    cola = [];
    pintar();

    expect(screen.getByText('fosterHomes:directory.empty')).toBeTruthy();
  });

  // La distinción que la regla #60 existe para proteger: una consulta caída no
  // es una cola vacía. Si esta pantalla dijera "no hay hogares pendientes"
  // cuando no pudo leer, un moderador se iría tranquilo con la cola llena.
  it('con la consulta caída avisa, y NUNCA dice que la cola está vacía', () => {
    falla = true;
    pintar();

    expect(screen.getByText('fosterHomes:mine.loadError')).toBeTruthy();
    expect(screen.queryByText('fosterHomes:directory.empty')).toBeNull();
  });

  it('aprobar llama a la mutación con el id', () => {
    pintar();

    fireEvent.click(screen.getByText('fosterHomes:admin.approve'));
    expect(approveMutate).toHaveBeenCalledWith('fh-1', expect.anything());
  });

  it('rechazar pide un motivo y lo manda recortado', async () => {
    pintar();

    fireEvent.click(screen.getByText('fosterHomes:admin.reject'));
    fireEvent.change(screen.getByLabelText('fosterHomes:admin.reasonLabel'), {
      target: { value: '  no cumple los requisitos  ' },
    });
    // Por ROL y nombre accesible, no por clase: una clase es exactamente lo
    // que el rediseño va a cambiar, y un test atado a ella se rompe sin que
    // nada se haya roto. Va acotado al diálogo porque la MISMA clave nombra al
    // botón que lo abre y al que confirma.
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'fosterHomes:admin.reject' }),
    );

    await waitFor(() =>
      expect(rejectMutate).toHaveBeenCalledWith(
        { id: 'fh-1', reason: 'no cumple los requisitos' },
        expect.anything(),
      ),
    );
  });

  // El motivo se le muestra al DUEÑO palabra por palabra (lo dice el comentario
  // del componente). Sin este aviso alguien escribe ahí quién denunció.
  it('el modal avisa que el motivo lo va a leer el dueño', () => {
    pintar();

    fireEvent.click(screen.getByText('fosterHomes:admin.reject'));
    expect(screen.getByText('fosterHomes:admin.reasonOwnerNotice')).toBeTruthy();
  });

  // Espeja `foster_homes.rejection_reason` (varchar 500). Sin el tope, el
  // moderador escribe 600 caracteres y se entera recién al confirmar — y antes
  // del #198 eso era un 500 con la suspensión SIN aplicar (regla #34).
  it('el motivo está acotado al ancho de su columna', () => {
    pintar();

    fireEvent.click(screen.getByText('fosterHomes:admin.reject'));
    expect(screen.getByLabelText('fosterHomes:admin.reasonLabel')).toHaveAttribute(
      'maxLength',
      '500',
    );
  });
});
