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

// El mapa de resumen se moquea para poder afirmar QUÉ recibe: su propio
// comportamiento (círculos, encuadre, punteado de la pausada) lo cubre
// `AlertsMap.test.tsx`. Acá lo que se prueba es el cableado de la página.
const mapaResumen = vi.hoisted(() => ({
  props: null as { alerts: unknown[]; focused: string | null } | null,
  montado: 0,
}));

vi.mock('../components/alerts/AlertsMap', () => ({
  AlertsMap: (props: { alerts: unknown[]; focused: string | null }) => {
    mapaResumen.props = { alerts: props.alerts, focused: props.focused };
    mapaResumen.montado += 1;
    return <div data-testid="alerts-map" />;
  },
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
/**
 * La lista después del rediseño: un mapa de resumen y tarjetas en grilla.
 *
 * Lo que se afirma no es que se vea distinto —eso sólo lo ve el navegador—
 * sino las dos cosas que pueden mentirle al usuario: que el mapa NO aparezca
 * cuando no sabemos nada, y que el estado se anuncie por lo que es.
 */
describe('AlertsPage — el mapa de resumen', () => {
  beforeEach(() => {
    state.data = [];
    state.isError = false;
    mapaResumen.props = null;
    mapaResumen.montado = 0;
  });

  it('con alertas, el mapa recibe todas las zonas', () => {
    state.data = [alert(), alert({ id: 'alert-2', name: 'Casa de mamá' })];

    render(<AlertsPage />);

    expect(screen.getByTestId('alerts-map')).toBeInTheDocument();
    expect(mapaResumen.props?.alerts).toHaveLength(2);
    expect(mapaResumen.props?.focused).toBeNull();
  });

  // La mitad que importa: un mapa vacío sobre una consulta caída diría "no
  // estás vigilando ninguna zona", que es exactamente la mentira que
  // `ListState` existe para matar. Y sobre la lista vacía tampoco va: no hay
  // nada que dibujar.
  it('NO dibuja el mapa cuando la consulta se cayo, ni cuando no hay alertas', () => {
    const { unmount } = render(<AlertsPage />);
    expect(screen.queryByTestId('alerts-map')).not.toBeInTheDocument();
    unmount();

    state.data = undefined;
    state.isError = true;
    render(<AlertsPage />);

    expect(screen.queryByTestId('alerts-map')).not.toBeInTheDocument();
    // Y no es que se montó y devolvió null: no se montó nunca.
    expect(mapaResumen.montado).toBe(0);
  });

  it('tocar la ubicacion de una tarjeta enfoca ESA zona, no la primera', async () => {
    state.data = [alert(), alert({ id: 'alert-2', name: 'Casa de mamá' })];
    render(<AlertsPage />);

    // Con `t` mockeado los dos botones se llaman igual, así que hay que tomar
    // el SEGUNDO: si el click enfocara cualquier cosa menos la tarjeta tocada,
    // afirmar sobre el primero no lo notaría.
    const botones = screen.getAllByRole('button', { name: 'showOnMap' });
    expect(botones).toHaveLength(2);
    await userEvent.click(botones[1]);

    expect(mapaResumen.props?.focused).toBe('alert-2');
  });

  // `role="switch"` sobre el checkbox nativo: lo que se anuncia es
  // "activa / pausada" y no "casilla marcada". Sigue siendo un input nativo, o
  // sea que el foco, el teclado y la barra espaciadora los pone el navegador —
  // que es la misma razón por la que el radio del formulario dejó de ser un
  // grupo de botones con `role` escrito a mano.
  it('el estado de la alerta se anuncia como interruptor, y sigue siendo nativo', () => {
    state.data = [alert({ is_active: true })];

    render(<AlertsPage />);

    const interruptor = screen.getByRole('switch');
    expect(interruptor.tagName).toBe('INPUT');
    expect(interruptor).toBeChecked();
  });
});

describe('AlertsPage — el lenguaje de las públicas', () => {
  beforeEach(() => {
    state.data = [];
    state.isError = false;
  });

  // Las públicas rediseñadas (`AdoptPage`, `LeaderboardPage`) abren con una
  // banda de color y el título en la familia display. Esta pantalla entraba con
  // un `<h1>` de `text-2xl font-bold`, sin `font-display`.
  //
  // NO se afirma un peso acá, y es deliberado: `--text-display` y
  // `--text-display-sm` ya declaran `font-weight: 700` en `index.css`. Exigir
  // `font-semibold` obligaría a escribir algo redundante, y exigir `font-bold`
  // ataría el test a un detalle que el token puede cambiar. Lo que importa es
  // que el tamaño venga de un token que SÍ trae peso — por eso se afirma el
  // token, no el peso.
  it('el titulo usa la familia display y el tamaño de las hermanas', () => {
    render(<AlertsPage />);

    const titulo = screen.getByRole('heading', { level: 1 });
    expect(titulo.className).toContain('font-display');
    expect(titulo.className).toContain('text-display-sm');
    expect(titulo.className).not.toContain('font-bold');
  });

  it('la banda lleva subtitulo, como las otras publicas', () => {
    render(<AlertsPage />);
    expect(screen.getByText('subtitle')).toBeTruthy();
  });

  // La convención aprobada el 2026-08-05: toda página de contenido va en
  // `max-w-7xl`, el mismo cap que el navbar. Esta estaba en `max-w-3xl`, o sea
  // a menos de la mitad — el mismo defecto que se corrigió en `MyPetsPage` y
  // `GroupsPage`.
  //
  // Se afirma CADA sección por separado, y no un conteo global.
  //
  // La primera versión hacía `querySelectorAll('.max-w-7xl').length === 2`. Eso
  // pasa el caso que verifiqué en rojo —dejar la banda al ancho viejo— pero
  // NO el que me marcó la revisión: sacarlo de la banda y meter dos en el
  // contenido da 2 igual. El test contaba lo que su propio comentario decía
  // que no contaba.
  //
  // Anclarse a la banda por su gradiente y al contenido por ser el `<section>`
  // que NO es la banda ata cada aserción a la cosa que protege.
  it('la banda Y el contenido estan anclados al ancho del navbar', () => {
    const { container } = render(<AlertsPage />);

    const banda = container.querySelector('section.bg-gradient-to-br');
    expect(banda, 'no encontré la banda').toBeTruthy();
    expect(banda!.querySelector('.max-w-7xl')).toBeTruthy();
    // Y que la banda sea DE VERDAD el encabezado, no cualquier gradiente: si
    // el `<h1>` se fuera a otro lado, anclar acá dejaría de significar algo.
    expect(banda!.querySelector('h1')).toBeTruthy();

    // El contenido lleva el cap en el `<section>` mismo; la banda lo lleva en un
    // div interno, porque el gradiente va a todo el ancho de la ventana.
    const contenido = [...container.querySelectorAll('section')].find((s) => s !== banda);
    expect(contenido, 'no encontré la sección de contenido').toBeTruthy();
    expect(contenido!.className).toContain('max-w-7xl');

    expect(container.querySelector('.max-w-3xl.mx-auto')).toBeTruthy();
  });
});

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
  // El mapa NO reemplaza a los inputs de coordenadas: los acompaña. Los tests
  // de arriba siguen afirmando la vía accesible entera —etiqueta propia,
  // `aria-invalid` y el mensaje compartido— y este afirma que además apareció
  // la vía visual, con la pista que nombra las dos.
  //
  // Se afirma el `.leaflet-container` y no un mock: acá react-leaflet corre de
  // verdad contra jsdom, así que ese nodo es la prueba de que el mapa se montó
  // dentro del formulario y no quedó colgado de un import sin usar.
  it('el formulario trae un mapa para elegir la zona, sin quitar los inputs', async () => {
    await abrirFormulario();

    expect(document.querySelector('.leaflet-container')).toBeTruthy();
    expect(screen.getByText('mapHint')).toBeInTheDocument();
    expect(screen.getByLabelText('latLabel')).toBeInTheDocument();
    expect(screen.getByLabelText('lngLabel')).toBeInTheDocument();
  });

  it('el hint del campo opcional llega por aria-describedby', async () => {
    await abrirFormulario();

    const campo = screen.getByLabelText('nameLabel');
    const hintId = campo.getAttribute('aria-describedby');
    expect(hintId).toBeTruthy();
    expect(document.getElementById(hintId!)).toHaveTextContent('optionalHint');
  });
});
