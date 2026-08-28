import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MyFosterHomePage } from './MyFosterHomePage';

const mutateMock = vi.fn();
const refetchMock = vi.fn();

const baseFosterHome = {
  id: 'fh-1',
  city: 'Montevideo',
  housing_type: 'house' as const,
  animal_types: ['dog' as const],
  capacity: 2,
  description: 'tengo patio',
  whatsapp_phone: '099111222',
  status: 'approved' as const,
  photos: [] as unknown[],
};

let myFosterHomeState: {
  data: unknown;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
} = { data: baseFosterHome, isLoading: false, isError: false, error: null };

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key}:${Object.values(opts).join(',')}` : key,
    i18n: { language: 'es' },
  }),
}));

vi.mock('@shared/hooks', () => ({
  useMyFosterHome: () => ({ ...myFosterHomeState, refetch: refetchMock }),
  useUpdateMyFosterHome: () => ({ mutate: mutateMock, isPending: false }),
  useUploadFosterHomePhoto: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteFosterHomePhoto: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@shared/utils/apiErrors', () => ({
  getErrorMessage: () => 'api-error-message',
}));

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <MyFosterHomePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const grupoAnimales = () => screen.getByRole('group', { name: /animalTypes/ });

describe('MyFosterHomePage', () => {
  beforeEach(() => {
    mutateMock.mockReset();
    refetchMock.mockReset();
    myFosterHomeState = { data: baseFosterHome, isLoading: false, isError: false, error: null };
  });

  it('precarga el formulario con los datos del hogar', () => {
    renderPage();
    expect((screen.getByLabelText('fosterHomes:register.city') as HTMLInputElement).value).toBe('Montevideo');
    expect((screen.getByLabelText('fosterHomes:register.capacity') as HTMLInputElement).value).toBe('2');
  });

  it('el formulario queda partido en secciones con titulo', () => {
    renderPage();
    expect(screen.getByText('fosterHomes:register.sectionHome')).toBeTruthy();
    expect(screen.getByText('fosterHomes:register.sectionContact')).toBeTruthy();
    expect(screen.getByText('fosterHomes:detail.photos')).toBeTruthy();
  });

  // ── Lo que la primitiva compartida tiene que dar en las DOS pantallas ──

  it('los grupos de opciones tienen nombre accesible', () => {
    renderPage();
    expect(screen.getByRole('group', { name: 'fosterHomes:register.housingType' })).toBeTruthy();
    expect(grupoAnimales()).toBeTruthy();
  });

  it('el grupo requerido ANUNCIA que lo es', () => {
    renderPage();
    expect(screen.getByRole('group', { name: /fosterHomes:register\.required/ })).toBeTruthy();
  });

  it('el error del grupo llega a CADA checkbox', () => {
    renderPage();
    // Se destildan todos para forzar el error del grupo.
    for (const casilla of within(grupoAnimales()).getAllByRole('checkbox')) {
      if ((casilla as HTMLInputElement).checked) fireEvent.click(casilla);
    }
    fireEvent.click(screen.getByText('fosterHomes:mine.save'));

    const casillas = within(grupoAnimales()).getAllByRole('checkbox');
    expect(casillas).toHaveLength(3);
    for (const casilla of casillas) {
      expect(casilla.getAttribute('aria-invalid')).toBe('true');
      const descrito = casilla.getAttribute('aria-describedby');
      expect(document.getElementById(descrito!)?.textContent).toBe(
        'fosterHomes:register.animalTypesRequired',
      );
    }
  });

  // Suspendido ya no es un callejón: el dueño corrige y guarda, y su hogar
  // vuelve a la cola. Este test afirmaba lo contrario — que el formulario
  // quedaba congelado — y se invierte junto con el comportamiento.
  it('con el hogar suspendido el formulario es EDITABLE y ofrece reenviar', () => {
    myFosterHomeState.data = { ...baseFosterHome, status: 'suspended' };
    renderPage();

    expect(screen.getByLabelText('fosterHomes:register.city')).not.toBeDisabled();
    expect(screen.getByLabelText('fosterHomes:register.description')).not.toBeDisabled();
    for (const casilla of within(grupoAnimales()).getAllByRole('checkbox')) {
      expect(casilla).not.toBeDisabled();
    }

    // El botón cambia de texto: "guardar" y "guardar y reenviar" no son lo
    // mismo, y el usuario tiene que saber que esto lo devuelve a revisión.
    expect(screen.getByText('fosterHomes:mine.resubmit')).toBeTruthy();
    expect(screen.queryByText('fosterHomes:mine.save')).toBeNull();
    expect(screen.getByText('fosterHomes:mine.resubmitHint')).toBeTruthy();
  });

  // Sin esto, alguien podría "arreglar" el test de arriba habilitando el
  // formulario y dejando el `return` de `handleSubmit`: el botón se vería
  // vivo y no haría nada.
  it('y guardar un hogar suspendido SÍ llama a la API', () => {
    myFosterHomeState.data = { ...baseFosterHome, status: 'suspended' };
    mutateMock.mockImplementation((_data, opts) => opts?.onSuccess?.());
    renderPage();

    fireEvent.change(screen.getByLabelText('fosterHomes:register.city'), {
      target: { value: 'Salto' },
    });
    fireEvent.click(screen.getByText('fosterHomes:mine.resubmit'));

    expect(mutateMock).toHaveBeenCalledTimes(1);
    expect(mutateMock.mock.calls[0][0]).toMatchObject({ city: 'Salto' });
  });

  it('un hogar suspendido muestra el motivo, como uno rechazado', () => {
    myFosterHomeState.data = {
      ...baseFosterHome,
      status: 'suspended',
      rejection_reason: 'fotos que no corresponden',
    };
    renderPage();

    expect(screen.getByText('fotos que no corresponden')).toBeTruthy();
  });

  // Un texto que el BACKEND aceptó tiene que poder editarse. El backend cuenta
  // con `utf8.RuneCountInString` (puntos de código) y `String.length` cuenta
  // unidades UTF-16: 400 emoji son 400 runas para Go y 800 para JS. Con el
  // conteo viejo la pantalla mostraba "800/500" en rojo y bloqueaba CUALQUIER
  // guardado de una descripción que el servidor había guardado feliz.
  it('una descripcion de emojis guardada por el backend se puede seguir editando', () => {
    const cuatrocientosEmojis = '🐶'.repeat(400);
    myFosterHomeState.data = { ...baseFosterHome, description: cuatrocientosEmojis };
    mutateMock.mockImplementation((_data, opts) => opts?.onSuccess?.());
    renderPage();

    expect(screen.getByText('400/500')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('fosterHomes:register.city'), {
      target: { value: 'Salto' },
    });
    fireEvent.click(screen.getByText('fosterHomes:mine.save'));

    expect(mutateMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('fosterHomes:register.maxLengthError:500')).toBeNull();
  });

  it('el contador de la descripcion sigue estando', () => {
    renderPage();
    fireEvent.change(screen.getByLabelText('fosterHomes:register.description'), {
      target: { value: 'hola' },
    });
    expect(screen.getByText('4/500')).toBeTruthy();
  });

  it('guarda los datos recortados y avisa', () => {
    mutateMock.mockImplementation((_data, opts) => opts?.onSuccess?.());
    renderPage();

    fireEvent.change(screen.getByLabelText('fosterHomes:register.city'), {
      target: { value: '  Salto  ' },
    });
    fireEvent.click(screen.getByText('fosterHomes:mine.save'));

    expect(mutateMock.mock.calls[0][0]).toMatchObject({ city: 'Salto', capacity: 2 });
    expect(screen.getByText('fosterHomes:mine.saved')).toBeTruthy();
  });

  it('muestra el error de la API', () => {
    mutateMock.mockImplementation((_data, opts) => opts?.onError?.(new Error('boom')));
    renderPage();
    fireEvent.click(screen.getByText('fosterHomes:mine.save'));

    expect(screen.getByText('api-error-message')).toBeTruthy();
  });

  // Un 404 `foster_home_not_found` es "todavía no registró", no un fallo: la
  // pantalla ofrece registrarse en vez de un cartel de error.
  it('sin hogar registrado ofrece registrarse, no un error', () => {
    myFosterHomeState = {
      data: undefined,
      isLoading: false,
      isError: true,
      error: { code: 'foster_home_not_found' },
    };
    renderPage();

    expect(screen.getByText('fosterHomes:mine.noFosterHomeTitle')).toBeTruthy();
    expect(screen.queryByText('fosterHomes:mine.loadError')).toBeNull();
  });

  it('un fallo de verdad SI muestra el error, con reintentar', () => {
    myFosterHomeState = { data: undefined, isLoading: false, isError: true, error: { code: 'internal' } };
    renderPage();

    expect(screen.getByText('fosterHomes:mine.loadError')).toBeTruthy();
    fireEvent.click(screen.getByText('fosterHomes:mine.retry'));
    expect(refetchMock).toHaveBeenCalledTimes(1);
  });
});
