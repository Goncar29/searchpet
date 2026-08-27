import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RegisterFosterHomePage } from './RegisterFosterHomePage';

const mutateMock = vi.fn();
let verificationData: { email_verified: boolean } | undefined = { email_verified: true };
let myFosterHomeData: unknown = undefined;

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'es' } }),
}));

vi.mock('@shared/hooks', () => ({
  useVerificationStatus: () => ({ data: verificationData }),
  useMyFosterHome: () => ({
    data: myFosterHomeData,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  useRegisterFosterHome: () => ({ mutate: mutateMock, isPending: false }),
}));

vi.mock('@shared/utils/apiErrors', () => ({
  getErrorMessage: () => 'api-error-message',
}));

function renderPage({ withMineRoute = false }: { withMineRoute?: boolean } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = () => (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        {withMineRoute ? (
          <Routes>
            <Route path="/" element={<RegisterFosterHomePage />} />
            <Route path="/fosterhomes/mine" element={<div>mine-page-stub</div>} />
          </Routes>
        ) : (
          <RegisterFosterHomePage />
        )}
      </MemoryRouter>
    </QueryClientProvider>
  );
  const result = render(tree());
  return { ...result, rerenderPage: () => result.rerender(tree()) };
}

/** Salta la pantalla de intro y deja el formulario a la vista. */
function abrirFormulario() {
  fireEvent.click(screen.getByText('fosterHomes:register.start'));
}

describe('RegisterFosterHomePage', () => {
  beforeEach(() => {
    mutateMock.mockReset();
    verificationData = { email_verified: true };
    myFosterHomeData = undefined;
  });

  it('muestra las notas honestas en la intro', () => {
    renderPage();
    expect(screen.getByText('fosterHomes:register.intro')).toBeTruthy();
    expect(screen.getByText('fosterHomes:register.reviewNote')).toBeTruthy();
    expect(screen.getByText('fosterHomes:register.oneNote')).toBeTruthy();
  });

  it('sin email verificado ofrece el link de verificacion en vez del boton', () => {
    verificationData = { email_verified: false };
    renderPage();
    expect(screen.getByText('fosterHomes:register.emailUnverified')).toBeTruthy();
    expect(screen.getByText('fosterHomes:register.verifyEmailLink').closest('a')?.getAttribute('href')).toBe(
      '/profile',
    );
    expect(screen.queryByText('fosterHomes:register.start')).toBeNull();
  });

  // ── Lo que el porte al sistema de formularios tiene que preservar ──

  it('el formulario queda partido en dos secciones con titulo', () => {
    renderPage();
    abrirFormulario();
    expect(screen.getByText('fosterHomes:register.sectionHome')).toBeTruthy();
    expect(screen.getByText('fosterHomes:register.sectionContact')).toBeTruthy();
  });

  it('valida los requeridos antes de enviar', () => {
    renderPage();
    abrirFormulario();
    fireEvent.click(screen.getByText('fosterHomes:register.submit'));

    expect(mutateMock).not.toHaveBeenCalled();
    expect(screen.getByText('fosterHomes:register.cityRequired')).toBeTruthy();
    expect(screen.getByText('fosterHomes:register.animalTypesRequired')).toBeTruthy();
    expect(screen.getByText('fosterHomes:register.descriptionRequired')).toBeTruthy();
  });

  // `FormField` ata el control con su mensaje por `aria-describedby` y le pone
  // `aria-invalid`. El marcado anterior dibujaba el error en un `<p>` suelto:
  // se anunciaba al aparecer y después no había forma de volver a encontrarlo
  // tabulando al campo.
  it('el campo invalido queda ATADO a su mensaje de error', () => {
    renderPage();
    abrirFormulario();
    fireEvent.click(screen.getByText('fosterHomes:register.submit'));

    const ciudad = screen.getByLabelText('fosterHomes:register.city');
    expect(ciudad.getAttribute('aria-invalid')).toBe('true');
    const descrito = ciudad.getAttribute('aria-describedby');
    expect(descrito).toBeTruthy();
    expect(document.getElementById(descrito!)?.textContent).toBe('fosterHomes:register.cityRequired');
  });

  // El defecto de accesibilidad que este porte cierra: los dos grupos de
  // opciones tenían su título en un `<span>` suelto, así que un lector de
  // pantalla leía "Perro, casilla, no marcada" sin decir nunca DE QUÉ era la
  // lista. Cada control tenía nombre; el conjunto no tenía ninguno.
  it('los grupos de opciones tienen nombre accesible', () => {
    renderPage();
    abrirFormulario();

    const grupos = screen.getAllByRole('group');
    const nombres = grupos.map((g) => g.getAttribute('aria-labelledby'))
      .map((id) => (id ? document.getElementById(id)?.textContent : null));

    expect(nombres).toContain('fosterHomes:register.housingType');
    expect(nombres).toContain('fosterHomes:register.animalTypes');
  });

  it('el grupo de animales queda atado a su error', () => {
    renderPage();
    abrirFormulario();
    fireEvent.click(screen.getByText('fosterHomes:register.submit'));

    const grupo = screen
      .getAllByRole('group')
      .find((g) => g.getAttribute('aria-labelledby')?.includes('animals'));
    expect(grupo).toBeTruthy();
    const descrito = grupo!.getAttribute('aria-describedby');
    expect(document.getElementById(descrito!)?.textContent).toBe(
      'fosterHomes:register.animalTypesRequired',
    );
  });

  it('el contador de la descripcion sigue estando y cuenta', () => {
    renderPage();
    abrirFormulario();
    fireEvent.change(screen.getByLabelText('fosterHomes:register.description'), {
      target: { value: 'hola' },
    });

    expect(screen.getByText('4/500')).toBeTruthy();
  });

  it('envia los datos recortados y muestra la confirmacion', () => {
    // El callback se dispara DENTRO del mock, no después: así corre adentro del
    // `act` del fireEvent y el re-render ocurre. Llamarlo desde afuera deja la
    // pantalla vieja y el test falla sin que haya nada roto.
    mutateMock.mockImplementation((_data, opts) => opts?.onSuccess?.());
    renderPage();
    abrirFormulario();

    fireEvent.change(screen.getByLabelText('fosterHomes:register.city'), {
      target: { value: '  Montevideo  ' },
    });
    fireEvent.change(screen.getByLabelText('fosterHomes:register.description'), {
      target: { value: '  tengo patio  ' },
    });
    const animales = screen
      .getAllByRole('group')
      .find((g) => g.getAttribute('aria-labelledby')?.includes('animals'))!;
    fireEvent.click(within(animales).getAllByRole('checkbox')[0]);

    fireEvent.click(screen.getByText('fosterHomes:register.submit'));

    expect(mutateMock).toHaveBeenCalledTimes(1);
    expect(mutateMock.mock.calls[0][0]).toMatchObject({
      city: 'Montevideo',
      description: 'tengo patio',
      housing_type: 'house',
      capacity: 1,
    });

    expect(screen.getByText('fosterHomes:register.successTitle')).toBeTruthy();
  });

  it('muestra el error de la API y se queda en el formulario', () => {
    mutateMock.mockImplementation((_data, opts) => opts?.onError?.(new Error('boom')));
    renderPage();
    abrirFormulario();

    fireEvent.change(screen.getByLabelText('fosterHomes:register.city'), {
      target: { value: 'Montevideo' },
    });
    fireEvent.change(screen.getByLabelText('fosterHomes:register.description'), {
      target: { value: 'tengo patio' },
    });
    const animales = screen
      .getAllByRole('group')
      .find((g) => g.getAttribute('aria-labelledby')?.includes('animals'))!;
    fireEvent.click(within(animales).getAllByRole('checkbox')[0]);
    fireEvent.click(screen.getByText('fosterHomes:register.submit'));

    expect(screen.getByText('api-error-message')).toBeTruthy();
    expect(screen.getByText('fosterHomes:register.submit')).toBeTruthy();
  });

  it('redirige a /fosterhomes/mine si ya tiene un hogar', () => {
    myFosterHomeData = { id: 'fh-1' };
    renderPage({ withMineRoute: true });
    expect(screen.getByText('mine-page-stub')).toBeTruthy();
  });

  // El guard de 'done': tras el submit la invalidación repuebla useMyFosterHome,
  // y sin él el redirect se comería la pantalla de confirmación.
  it('la confirmacion sobrevive a que la invalidacion repueble el hogar', () => {
    mutateMock.mockImplementation((_data, opts) => opts?.onSuccess?.());
    const { rerenderPage } = renderPage({ withMineRoute: true });
    abrirFormulario();

    fireEvent.change(screen.getByLabelText('fosterHomes:register.city'), {
      target: { value: 'Montevideo' },
    });
    fireEvent.change(screen.getByLabelText('fosterHomes:register.description'), {
      target: { value: 'tengo patio' },
    });
    const animales = screen
      .getAllByRole('group')
      .find((g) => g.getAttribute('aria-labelledby')?.includes('animals'))!;
    fireEvent.click(within(animales).getAllByRole('checkbox')[0]);
    fireEvent.click(screen.getByText('fosterHomes:register.submit'));

    myFosterHomeData = { id: 'fh-1' };
    rerenderPage();

    expect(screen.getByText('fosterHomes:register.successTitle')).toBeTruthy();
    expect(screen.queryByText('mine-page-stub')).toBeNull();
  });
});
