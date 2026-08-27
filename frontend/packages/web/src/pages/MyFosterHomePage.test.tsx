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

  // El porte borró el `disabled` que estaba repetido en cada control, apoyándose
  // en que el `<fieldset disabled>` lo hace nativamente. Eso es una SUPOSICIÓN
  // hasta que algo la mide: si fuera falsa, un hogar suspendido quedaría
  // editable y el único freno sería el 409 del backend.
  it('con el hogar suspendido, el fieldset deshabilita TODOS los controles', () => {
    myFosterHomeState.data = { ...baseFosterHome, status: 'suspended' };
    renderPage();

    // `toBeDisabled()` y NO `.disabled`: la propiedad IDL refleja sólo el
    // atributo PROPIO del control, así que da `false` aunque el elemento esté
    // realmente deshabilitado por un `<fieldset disabled>` ancestro. El matcher
    // de jest-dom sí camina hacia arriba, que es la pregunta que importa.
    // Medido: con `.disabled` este test fallaba con el comportamiento correcto.
    expect(screen.getByLabelText('fosterHomes:register.city')).toBeDisabled();
    expect(screen.getByLabelText('fosterHomes:register.description')).toBeDisabled();
    for (const casilla of within(grupoAnimales()).getAllByRole('checkbox')) {
      expect(casilla).toBeDisabled();
    }
    for (const radio of within(
      screen.getByRole('group', { name: 'fosterHomes:register.housingType' }),
    ).getAllByRole('radio')) {
      expect(radio).toBeDisabled();
    }
    // Y no se ofrece guardar.
    expect(screen.queryByText('fosterHomes:mine.save')).toBeNull();
    expect(screen.getByText('fosterHomes:mine.suspendedFrozen')).toBeTruthy();
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
