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
  props: null as { alerts: unknown[]; focused: string | null; focusTick: number } | null,
  montado: 0,
}));

vi.mock('../components/alerts/AlertsMap', () => ({
  AlertsMap: (props: { alerts: unknown[]; focused: string | null; focusTick: number }) => {
    mapaResumen.props = { alerts: props.alerts, focused: props.focused, focusTick: props.focusTick };
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

  // ─── Los cinco hallazgos del /code-review, cada uno con su guard ───

  describe('la ubicacion del navegador', () => {
    const conGeolocalizacion = (coords: { latitude: number; longitude: number }) => {
      Object.defineProperty(navigator, 'geolocation', {
        configurable: true,
        value: {
          getCurrentPosition: (ok: (p: unknown) => void) => ok({ coords }),
          watchPosition: () => 0,
          clearWatch: () => {},
        },
      });
    };

    // POR QUÉ EXISTE: el prefill de MONTAJE escribía `pos.coords.latitude`
    // crudo, salteando `elegirZona` — mientras el comentario de `elegirZona`
    // afirmaba, desde su primer día, ser "la ÚNICA puerta". Con el permiso
    // concedido el input mostraba `-34.899025460930744`: 15 decimales, el mismo
    // defecto que el redondeo vino a cerrar, vivo en un tercer camino.
    //
    // Lo levantó un /code-review. El /verify no lo vio porque probó el BOTÓN
    // "usar mi ubicación", no el montaje: dos caminos, y sólo uno mirado.
    it('el prefill de montaje redondea la coordenada', async () => {
      conGeolocalizacion({ latitude: -34.899025460930744, longitude: -56.164173829174611 });
      render(<AlertsPage />);
      await userEvent.click(screen.getByRole('button', { name: 'newAlert' }));

      expect(screen.getByLabelText('latLabel')).toHaveValue(-34.899025);
      expect(screen.getByLabelText('lngLabel')).toHaveValue(-56.164174);
    });
  });

  // POR QUÉ EXISTE: `resetForm` limpiaba nombre, radio y tipo pero NO las
  // coordenadas, así que reabrir el formulario montaba el mapa con el marcador
  // y el círculo de la zona anterior — y sin la pista, porque para el picker ya
  // había un punto elegido. Quien tocara "Crear" se llevaba una zona duplicada.
  it('cerrar el formulario limpia las coordenadas elegidas', async () => {
    state.data = [];
    render(<AlertsPage />);
    await userEvent.click(screen.getByRole('button', { name: 'newAlert' }));
    await userEvent.type(screen.getByLabelText('latLabel'), '-34.9011');
    await userEvent.type(screen.getByLabelText('lngLabel'), '-56.1645');

    await userEvent.click(screen.getByRole('button', { name: 'cancel' }));
    await userEvent.click(screen.getByRole('button', { name: 'newAlert' }));

    expect(screen.getByLabelText('latLabel')).toHaveValue(null);
    expect(screen.getByLabelText('lngLabel')).toHaveValue(null);
  });

  describe('volver al conjunto de zonas', () => {
    // POR QUÉ EXISTE: `setFocused` sólo recibía ids, nunca `null`, y no había
    // ningún control que devolviera la vista del conjunto. El primer click en
    // una tarjeta dejaba el resumen inalcanzable por el resto de la sesión.
    it('el control aparece recien cuando hay una zona enfocada', async () => {
      state.data = [alert({ id: 'a1' }), alert({ id: 'a2', name: 'Casa' })];
      render(<AlertsPage />);

      expect(screen.queryByRole('button', { name: 'viewAll' })).not.toBeInTheDocument();

      await userEvent.click(screen.getAllByRole('button', { name: 'showOnMap' })[0]);
      expect(screen.getByRole('button', { name: 'viewAll' })).toBeInTheDocument();
      expect(mapaResumen.props?.focused).toBe('a1');
    });

    it('el control devuelve el mapa al conjunto y se esconde', async () => {
      state.data = [alert({ id: 'a1' }), alert({ id: 'a2', name: 'Casa' })];
      render(<AlertsPage />);
      await userEvent.click(screen.getAllByRole('button', { name: 'showOnMap' })[0]);

      await userEvent.click(screen.getByRole('button', { name: 'viewAll' }));

      expect(mapaResumen.props?.focused).toBeNull();
      expect(screen.queryByRole('button', { name: 'viewAll' })).not.toBeInTheDocument();
    });

    // POR QUÉ EXISTE: pedir la MISMA zona dos veces dejaba `focused` igual, y
    // el efecto de la cámara no volvía a correr. Tras alejar el mapa a mano el
    // botón quedaba muerto — medido en el navegador, mismo píxel antes y
    // después. La página tiene que emitir un pedido NUEVO, no sólo un destino.
    it('pedir la misma zona dos veces emite un pedido nuevo', async () => {
      state.data = [alert({ id: 'a1' })];
      render(<AlertsPage />);
      const boton = screen.getAllByRole('button', { name: 'showOnMap' })[0];

      await userEvent.click(boton);
      const primero = mapaResumen.props!.focusTick;
      await userEvent.click(boton);

      expect(mapaResumen.props?.focused).toBe('a1');
      expect(mapaResumen.props?.focusTick).toBeGreaterThan(primero);
    });

    // POR QUÉ EXISTEN LOS DOS DE ABAJO (issue #256): `handleDelete` no limpiaba
    // `focused`, así que borrar la alerta que estabas mirando dejaba el estado
    // apuntando a un id muerto. `AlertsMap` degrada bien —su cámara no
    // encuentra el id y encuadra el conjunto— pero acá el guard
    // `focused !== null` seguía dando true, y el boton "Ver todas" quedaba
    // visible afirmando un enfoque que ya no existe.
    //
    // Lo introdujo ese mismo botón, agregado para cerrar un hallazgo de la
    // revisión anterior: un control nuevo trae estados nuevos que alguien tiene
    // que limpiar.
    //
    // SON DOS TESTS Y NO UNO a propósito. Con sólo el primero, "limpiar SIEMPRE
    // al borrar" pasaría igual — y eso sacaría al usuario de la zona que está
    // mirando cada vez que borra cualquier otra alerta. El arreglo crea una
    // distinción (la borrada ES la enfocada, o no lo es), así que hay que
    // afirmar las dos mitades.
    it('borrar la alerta ENFOCADA devuelve el mapa al conjunto', async () => {
      const confirmar = vi.spyOn(window, 'confirm').mockReturnValue(true);
      state.data = [alert({ id: 'a1' }), alert({ id: 'a2', name: 'Casa' })];
      render(<AlertsPage />);
      await userEvent.click(screen.getAllByRole('button', { name: 'showOnMap' })[0]);
      expect(screen.getByRole('button', { name: 'viewAll' })).toBeInTheDocument();

      await userEvent.click(screen.getAllByRole('button', { name: 'deleteLabel' })[0]);

      expect(mapaResumen.props?.focused).toBeNull();
      expect(screen.queryByRole('button', { name: 'viewAll' })).not.toBeInTheDocument();
      confirmar.mockRestore();
    });

    it('borrar OTRA alerta no saca al usuario de la zona que mira', async () => {
      const confirmar = vi.spyOn(window, 'confirm').mockReturnValue(true);
      state.data = [alert({ id: 'a1' }), alert({ id: 'a2', name: 'Casa' })];
      render(<AlertsPage />);
      await userEvent.click(screen.getAllByRole('button', { name: 'showOnMap' })[0]);

      // La segunda tarjeta, que NO es la enfocada.
      await userEvent.click(screen.getAllByRole('button', { name: 'deleteLabel' })[1]);

      expect(mapaResumen.props?.focused).toBe('a1');
      expect(screen.getByRole('button', { name: 'viewAll' })).toBeInTheDocument();
      confirmar.mockRestore();
    });

    // El centinela de los dos de arriba: si el usuario CANCELA el dialogo, no se
    // borra nada, asi que tampoco puede moverse el enfoque. Sin esto, limpiar
    // `focused` antes de mirar la respuesta del `confirm` pasaria el primer test.
    it('cancelar el borrado no toca el enfoque', async () => {
      const confirmar = vi.spyOn(window, 'confirm').mockReturnValue(false);
      state.data = [alert({ id: 'a1' }), alert({ id: 'a2', name: 'Casa' })];
      render(<AlertsPage />);
      await userEvent.click(screen.getAllByRole('button', { name: 'showOnMap' })[0]);

      await userEvent.click(screen.getAllByRole('button', { name: 'deleteLabel' })[0]);

      expect(mapaResumen.props?.focused).toBe('a1');
      expect(screen.getByRole('button', { name: 'viewAll' })).toBeInTheDocument();
      confirmar.mockRestore();
    });
  });

  // POR QUÉ EXISTE: en una grilla de hasta 10 tarjetas, el interruptor se
  // llamaba "Activa" y el botón "Eliminar" en TODAS. Quien navega por teclado
  // oía lo mismo diez veces sin saber cuál iba a pausar o borrar, mientras
  // `confirmDelete` sí interpolaba el nombre: las dos superficies se
  // contradecían sobre si el nombre importa.
  //
  // ACÁ NO SE PUEDE AFIRMAR QUE LOS NOMBRES DIFIERAN, y decirlo importa: el
  // mock de `t` devuelve la clave, así que las dos tarjetas rinden el mismo
  // texto por construcción. Lo que este test afirma es que el nombre accesible
  // sale de una clave PROPIA y no del texto repetido; que esa clave lleve el
  // nombre adentro lo afirma `alertsKeys.test.ts`, que sí mira los locales.
  it('el interruptor y el borrado se nombran con una clave propia', () => {
    state.data = [alert({ id: 'a1' }), alert({ id: 'a2', name: 'Casa' })];
    render(<AlertsPage />);

    expect(screen.getAllByRole('switch', { name: 'toggleLabel' })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'deleteLabel' })).toHaveLength(2);
    // El texto visible se queda corto a propósito: el espacio de la tarjeta es
    // corto, el nombre accesible no tiene ese límite.
    expect(screen.getAllByText('delete')).toHaveLength(2);
  });
});
