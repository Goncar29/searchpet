import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AlertsPage } from './AlertsPage';
import type { LocationAlert } from '@shared/types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'es' } }),
}));

const state = vi.hoisted(() => ({
  data: [] as unknown[] | undefined,
  isError: false,
}));

vi.mock('@shared/hooks', () => ({
  useAlerts: () => ({
    data: state.data,
    isPending: false,
    isFetching: false,
    isLoading: false,
    isPaused: false,
    isError: state.isError,
    error: state.isError ? new Error('boom') : null,
    refetch: vi.fn(),
  }),
  useCreateAlert: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateAlert: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteAlert: () => ({ mutate: vi.fn(), isPending: false }),
}));

function alert(overrides: Record<string, unknown> = {}) {
  return {
    id: 'alert-1',
    name: 'Mi barrio',
    alert_latitude: -34.9011,
    alert_longitude: -56.1645,
    radius_km: 5,
    is_active: true,
    ...overrides,
  } as unknown as LocationAlert;
}

describe('AlertsPage', () => {
  beforeEach(() => {
    state.data = [];
    state.isError = false;
  });

  it('con alertas dibuja la lista', () => {
    state.data = [alert()];

    render(<AlertsPage />);

    expect(screen.getByText('Mi barrio')).toBeInTheDocument();
    expect(screen.queryByText('emptyTitle')).not.toBeInTheDocument();
  });

  it('sin alertas dice que no hay ninguna', () => {
    render(<AlertsPage />);

    expect(screen.getByText('emptyTitle')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('con la query caida NO dice que no tenes alertas', () => {
    state.data = undefined;
    state.isError = true;

    render(<AlertsPage />);

    expect(screen.queryByText('emptyTitle')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  // El titulo vive FUERA de la rama que se envuelve: es `Mis alertas ({{count}}/{{max}})`
  // y con la query caida `data ?? []` lo dejaba afirmando "0/10" al lado del
  // cartel que dice que no pudimos leer nada.
  it('con la query caida el titulo NO afirma un conteo', () => {
    state.data = undefined;
    state.isError = true;

    render(<AlertsPage />);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('titleNoCount');
  });

  it('con datos el titulo SI lleva el conteo', () => {
    state.data = [alert()];

    render(<AlertsPage />);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('title');
    expect(screen.getByRole('heading', { level: 1 })).not.toHaveTextContent('titleNoCount');
  });
});

/**
 * El formulario de alta, después del porte al sistema de formularios.
 *
 * Lo que se afirma acá NO es que la pantalla se vea distinta: es que cada
 * control tiene un nombre accesible propio y que el error de coordenadas llega
 * al usuario que tabula de vuelta al campo. Las dos cosas eran justamente lo que
 * el marcado anterior no daba — las coordenadas se nombraban con `aria-label` y
 * el radio era un grupo de botones con `role="radiogroup"` escrito a mano.
 */
describe('AlertsPage — formulario de alta', () => {
  beforeEach(() => {
    state.data = [];
    state.isError = false;
  });

  async function abrirFormulario() {
    render(<AlertsPage />);
    await userEvent.click(screen.getByRole('button', { name: 'newAlert' }));
  }

  it('cada coordenada tiene su propia etiqueta, agrupadas bajo una sola leyenda', async () => {
    await abrirFormulario();

    expect(screen.getByLabelText('latLabel')).toBeInTheDocument();
    expect(screen.getByLabelText('lngLabel')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'coordsLabel' })).toBeInTheDocument();
  });

  // OJO CON ESTE: la primera version afirmaba `getAllByRole('radio')` y
  // `toBeChecked()`, y PASABA contra el marcado viejo — los botones con
  // `role="radio"` y `aria-checked` satisfacen las dos cosas. Un test que no
  // distingue las dos mitades no prueba la mitad que le importa al usuario.
  //
  // Lo que cambia de verdad es de QUE estan hechos: con controles nativos, la
  // exclusividad, las flechas y el tab stop unico los pone el navegador; con
  // botones habria que implementarlos a mano, y no estaban.
  it('el radio esta hecho de controles NATIVOS, no de botones con role', async () => {
    await abrirFormulario();

    const opciones = screen.getAllByRole('radio');
    expect(opciones).toHaveLength(5);
    for (const opcion of opciones) {
      expect(opcion.tagName).toBe('INPUT');
    }
    expect(screen.getByRole('radio', { name: '5 km' })).toBeChecked();
    expect(screen.getByRole('group', { name: 'radiusLabel' })).toBeInTheDocument();
  });

  // Las dos mitades de la distinción, porque una sola no prueba nada: sin error
  // los controles NO pueden quedar marcados como inválidos.
  it('sin enviar, los inputs de coordenadas no estan marcados como invalidos', async () => {
    await abrirFormulario();

    expect(screen.getByLabelText('latLabel')).not.toHaveAttribute('aria-invalid');
    expect(screen.getByLabelText('lngLabel')).not.toHaveAttribute('aria-invalid');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('al enviar sin coordenadas, los DOS inputs referencian el mismo mensaje', async () => {
    await abrirFormulario();

    await userEvent.click(screen.getByRole('button', { name: 'createButton' }));

    const mensaje = screen.getByRole('alert');
    expect(mensaje).toHaveTextContent('coordError');

    for (const campo of [screen.getByLabelText('latLabel'), screen.getByLabelText('lngLabel')]) {
      expect(campo).toHaveAttribute('aria-invalid', 'true');
      // `describedby` y no sólo `aria-invalid`: sin él el usuario oye "inválido"
      // pero nunca el motivo, que es el modo de falla que documenta FormField.
      expect(campo).toHaveAttribute('aria-describedby', mensaje.id);
    }
  });

  // El mensaje dice "ingresá las coordenadas". Dejarlo puesto MIENTRAS el
  // usuario las ingresa deja a los dos campos anunciándose "inválido" con un
  // motivo que su propio contenido desmiente — y ese anuncio es nuevo, porque
  // antes del porte los inputs no llevaban `aria-invalid` en absoluto.
  it('editar una coordenada retira el error, sin esperar a reenviar', async () => {
    await abrirFormulario();
    await userEvent.click(screen.getByRole('button', { name: 'createButton' }));
    expect(screen.getByLabelText('latLabel')).toHaveAttribute('aria-invalid', 'true');

    await userEvent.type(screen.getByLabelText('latLabel'), '-34.9');

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByLabelText('latLabel')).not.toHaveAttribute('aria-invalid');
    // El campo que NO se tocó también se despeja: el error era del par, no de uno.
    expect(screen.getByLabelText('lngLabel')).not.toHaveAttribute('aria-invalid');
  });

  // El "(opcional)" se movió del texto del `<label>` al `hint`, y el hint vive en
  // un `<span>` hermano. Sin `aria-describedby` el control pasa a llamarse sólo
  // "Nombre" y la pista queda para quien MIRA: exactamente la asimetría ver/oír
  // que este sistema de formularios existe para no tener.
  it('el hint del campo opcional llega por aria-describedby', async () => {
    await abrirFormulario();

    const campo = screen.getByLabelText('nameLabel');
    const hintId = campo.getAttribute('aria-describedby');
    expect(hintId).toBeTruthy();
    expect(document.getElementById(hintId!)).toHaveTextContent('optionalHint');
  });
});
