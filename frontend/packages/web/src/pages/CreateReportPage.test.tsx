import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CreateReportPage } from './CreateReportPage';

// owner_id ata la mascota al usuario logueado: estos tests describen al DUEÑO
// publicando la suya. Sin dueño, canManagePet da false y el formulario solo
// ofrece avistamiento, que es justo lo que se agrego para los terceros.
const USER_ID = 'user-1';
const PET = { id: 'pet-1', name: 'Firulais', type: 'perro', status: 'registered', owner_id: USER_ID, photos: [] };

// Hoisted: vi.mock se eleva por encima de cualquier const normal.
const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  search: 'petId=pet-1&status=lost',
  // El componente usa `mutate` con callbacks, NO `mutateAsync`. El mock viejo
  // solo tenia mutateAsync, por eso el smoke test nunca ejercito el envio.
  //
  // onSuccess recibe el REPORTE creado. El mock viejo llamaba `onSuccess()` a
  // secas, que no es el contrato de React Query (onSuccess(data, vars, ctx)) —
  // un arnes mas indulgente que el hook real: el componente pasó a leer
  // `report.id` y nada lo habria advertido hasta produccion.
  mutate: vi.fn((_vars: unknown, opts?: { onSuccess?: (r: { id: string }) => void }) =>
    opts?.onSuccess?.({ id: 'report-1' })
  ),
  // Registra las llamadas a setSearchParams para poder afirmar el `replace`,
  // que es la mitad del arreglo del doble reporte.
  setSearchParams: vi.fn(),
  // El handler de click del mapa, capturado para poder sembrar la coordenada
  // que `validate()` exige: sin eso el submit nunca llega a mutate.
  mapClick: null as null | ((e: { latlng: { lat: number; lng: number } }) => void),
  pet: null as unknown,
  // cuantos renders devuelve isLoading antes de entregar la mascota: reproduce
  // la carga en dos tiempos, que es cuando aparecio el bug del estado pisado.
  rendersCargando: 0,
  myPetsVacio: false,
  myPetsError: false,
}));

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: USER_ID, name: 'Carlos' }, isAuthenticated: true }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'es' } }),
}));

vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router')>();
  const React = await import('react');
  return {
    ...actual,
    useNavigate: () => mocks.navigate,
    // Stateful a proposito: el componente ESCRIBE la URL al publicar, asi que
    // un mock de solo lectura no puede ejercitar la pantalla de exito. Devolver
    // un array de un elemento ademas dejaba `setSearchParams` en undefined.
    useSearchParams: () => {
      const [params, setParams] = React.useState(() => new URLSearchParams(mocks.search));
      const setter = (
        next: Record<string, string> | URLSearchParams,
        opts?: { replace?: boolean }
      ) => {
        const np = next instanceof URLSearchParams ? next : new URLSearchParams(next);
        mocks.search = np.toString();
        mocks.setSearchParams(Object.fromEntries(np.entries()), opts);
        setParams(np);
      };
      return [params, setter];
    },
  };
});

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: { children: React.ReactNode }) => <div data-testid="map">{children}</div>,
  TileLayer: () => null,
  Marker: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  useMapEvents: (handlers: { click?: (e: { latlng: { lat: number; lng: number } }) => void }) => {
    mocks.mapClick = handlers.click ?? null;
    return null;
  },
}));

vi.mock('leaflet', () => {
  const IconDefault = function () {} as unknown as { new(): object; mergeOptions: () => void };
  (IconDefault as unknown as Record<string, unknown>).mergeOptions = () => {};
  const Icon = function () {} as unknown as { new(): object; Default: typeof IconDefault };
  (Icon as unknown as Record<string, unknown>).Default = IconDefault;
  return { default: { Icon }, Icon };
});

// El panel real pide un share link a la API y dibuja un QR. Acá interesa la
// DECISION de mostrarlo, no lo que hace por dentro.
vi.mock('../components/SharePanel', () => ({
  SharePanel: ({ petName }: { petName: string }) => <div data-testid="share-panel">{petName}</div>,
}));

vi.mock('@shared/hooks', () => ({
  usePetByID: () => {
    if (mocks.rendersCargando > 0) { mocks.rendersCargando -= 1; return { data: undefined, isLoading: true }; }
    return { data: mocks.myPetsVacio ? undefined : (mocks.pet ?? PET), isLoading: false };
  },
  // En frio las DOS estan cargando: si solo se simula usePetByID, myPets sigue
  // entregando la mascota y el permiso ya es true en el primer render — el
  // escenario del bug no llega a existir.
  useMyPets: () => ({
    data:
      mocks.myPetsError || mocks.rendersCargando > 0 || mocks.myPetsVacio ? undefined : [PET],
    // `isLoading` era `undefined` en el mock viejo, o sea falsy: se deja en
    // `false` explicito para no cambiar lo que la pantalla derivaba.
    isPending: false,
    isFetching: false,
    isLoading: false,
    isPaused: false,
    isError: mocks.myPetsError,
    error: mocks.myPetsError ? new Error('boom') : null,
    refetch: vi.fn(),
  }),
  useCreateReport: () => ({ mutate: mocks.mutate, mutateAsync: vi.fn(), isPending: false }),
}));

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

/** Marca un punto en el mapa, que es lo unico que `validate()` exige ademas del petId. */
function marcarUbicacion() {
  act(() => {
    mocks.mapClick?.({ latlng: { lat: -34.9011, lng: -56.1645 } });
  });
}

function enviar() {
  fireEvent.submit(document.querySelector('form')!);
}

beforeEach(() => {
  mocks.navigate.mockClear();
  mocks.mutate.mockClear();
  mocks.setSearchParams.mockClear();
  mocks.mutate.mockImplementation(
    (_v: unknown, o?: { onSuccess?: (r: { id: string }) => void }) =>
      o?.onSuccess?.({ id: 'report-1' })
  );
  mocks.search = 'petId=pet-1&status=lost';
  mocks.mapClick = null;
  mocks.pet = null;
  mocks.rendersCargando = 0;
  mocks.myPetsVacio = false;
  mocks.myPetsError = false;
});

describe('CreateReportPage', () => {
  it('renderiza sin lanzar errores', () => {
    render(<CreateReportPage />, { wrapper });
    expect(document.body).toBeTruthy();
  });

  it('sin marcar el mapa no envia nada', () => {
    render(<CreateReportPage />, { wrapper });
    enviar();
    expect(mocks.mutate).not.toHaveBeenCalled();
  });
});

// Publicar la mascota como perdida no termina en el listado: termina en el
// link para compartir, que es lo que hace que la busqueda sirva de algo. Antes
// este formulario mandaba derecho a /pets/mine y el aviso se perdia — el
// wizard tenia su propio paso de exito con el panel, y al unificar los dos
// caminos ese paso quedo afuera.
describe('CreateReportPage — despues de publicar como perdida', () => {
  it('muestra el panel de compartir en vez de irse al listado', () => {
    render(<CreateReportPage />, { wrapper });
    marcarUbicacion();
    enviar();

    expect(mocks.mutate).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('share-panel')).toHaveTextContent('Firulais');
    expect(screen.getByText('publish:success.lostTitle')).toBeInTheDocument();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('manda el occurred_at que el paso de ubicacion del wizard no tenia', () => {
    render(<CreateReportPage />, { wrapper });
    marcarUbicacion();
    fireEvent.change(document.querySelector('input[type="date"]')!, { target: { value: '2026-08-04' } });
    enviar();

    expect(mocks.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ pet_id: 'pet-1', status: 'lost' }),
      expect.anything(),
    );
    // El DIA que se lee de vuelta, no un string UTC literal: mandar
    // `2026-08-04T00:00:00Z` guardaba el 3 al oeste de Greenwich.
    const enviado = mocks.mutate.mock.calls[0][0] as { occurred_at?: string };
    const vuelta = new Date(enviado.occurred_at!);
    expect(
      `${vuelta.getFullYear()}-${String(vuelta.getMonth() + 1).padStart(2, '0')}-${String(vuelta.getDate()).padStart(2, '0')}`,
    ).toBe('2026-08-04');
  });

  // Un avistamiento no abre ninguna busqueda, asi que no hay aviso propio que
  // compartir. Pero VOLVER A LA FICHA de la mascota, no al listado propio.
  //
  // El boton que abre este formulario NO esta detras de `canManage`
  // (PetDetailPage: `isAuthenticated && (lost || stray)`), asi que quien
  // reporta un avistamiento casi nunca es el dueno — ese es el producto:
  // alguien ve al perro por la calle y avisa. Mandarlo a "Mis mascotas" lo
  // deja en un listado de SUS mascotas, que para un reporter suele estar
  // vacio, y le saca de vista la mascota que estaba mirando.
  //
  // La version anterior mandaba a /pets/mine con este razonamiento escrito al
  // lado: "los otros dos estados no abren ninguna busqueda, asi que siguen
  // yendo al listado". El criterio medía el TIPO DE REPORTE; para decidir a
  // donde mandar a una persona la pregunta es DE QUIEN ES LA MASCOTA.
  it('un avistamiento vuelve a la FICHA de la mascota, sin panel de compartir', () => {
    mocks.search = 'petId=pet-1&status=sighting';
    render(<CreateReportPage />, { wrapper });
    marcarUbicacion();
    enviar();

    expect(mocks.mutate).toHaveBeenCalledTimes(1);
    // `replace` no es un detalle: sin el, la entrada de este formulario queda
    // viva en el history y el boton atras la devuelve lista para re-enviar —
    // el mismo doble reporte por la otra puerta.
    expect(mocks.navigate).toHaveBeenCalledWith('/pets/pet-1', { replace: true });
    expect(screen.queryByTestId('share-panel')).not.toBeInTheDocument();
  });

  // `found` compartia la rama de `sighting` y se mueve con ella. Aca el dueno
  // SI es quien reporta, asi que "Mis mascotas" no era absurdo — pero la ficha
  // sigue siendo mejor destino: es donde se ve el badge nuevo y la entrada en
  // el historial, o sea la confirmacion de que lo que hizo surtio efecto. Un
  // listado no confirma nada.
  //
  // Va con test propio y no apoyado en el de arriba: son dos caminos distintos
  // por la misma linea, y afirmar uno solo dejaria al otro libre de cambiar sin
  // que nada se ponga rojo.
  it('marcar encontrada tambien vuelve a la ficha, no al listado', () => {
    mocks.search = 'petId=pet-1&status=found';
    render(<CreateReportPage />, { wrapper });
    marcarUbicacion();
    enviar();

    expect(mocks.navigate).toHaveBeenCalledWith('/pets/pet-1', { replace: true });
  });

  // ── Regresion: el doble reporte ────────────────────────────────────────────
  // Reproducido en el navegador antes de escribir esto: publicar, tocar "Ver
  // mascota" desde el exito, y volver con el boton ATRAS devolvia el formulario
  // limpio en la MISMA URL. Confirmarlo otra vez creaba un SEGUNDO reporte y la
  // mascota quedaba con doble historial (2 POST /api/reports medidos).
  //
  // La causa era que "ya reportaste" vivia en useState, que muere en el
  // remonte, mientras la URL seguia siendo identica antes y despues de
  // publicar. Estos dos tests fijan las dos mitades del arreglo.

  it('publicar un lost escribe el exito en la URL y REEMPLAZA la entrada del formulario', () => {
    mocks.search = 'petId=pet-1&status=lost';
    render(<CreateReportPage />, { wrapper });
    marcarUbicacion();
    enviar();

    expect(mocks.setSearchParams).toHaveBeenCalledWith(
      { petId: 'pet-1', status: 'lost', publicado: 'report-1' },
      { replace: true },
    );
    // Sin `replace` la entrada del formulario sobrevive en el history y el
    // atras la reabre: es exactamente el bug, no una preferencia de estilo.
    expect(mocks.setSearchParams.mock.calls[0][1]).toEqual({ replace: true });
    // Y ya NO navega: la pantalla de exito se queda en esta misma ruta.
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('con ?publicado en la URL el formulario es INALCANZABLE, aunque el componente se remonte', () => {
    // Un montaje limpio, que es lo que hace el boton atras al volver de
    // /pets/:id. No hay estado previo: todo lo que se sabe viene de la URL.
    mocks.search = 'petId=pet-1&status=lost&publicado=report-1';
    render(<CreateReportPage />, { wrapper });

    // Lo que se ve es el exito...
    expect(screen.getByTestId('share-panel')).toBeInTheDocument();
    // ...y lo que NO existe es el formulario. Con el bug puesto, acá hay un
    // <form> con su boton de enviar, y tocarlo crea el segundo reporte.
    expect(document.querySelector('form')).toBeNull();
    expect(screen.queryByRole('button', { name: 'reports:create.submit' })).not.toBeInTheDocument();
  });

  // `publicado` viaja en la URL, o sea que es ENTRADA DE USUARIO: por si solo no
  // prueba que exista ningun reporte. Sin el permiso, cualquiera podia abrir
  // /reports/create?petId=<ajena>&publicado=x y leer "tu mascota esta marcada
  // como perdida" sobre una mascota que no es suya — y `GET /api/pets/:id` es
  // PUBLICO, asi que resuelve cualquier id. Es una regresion que trajo mover el
  // estado de exito de useState a la URL: antes la pantalla era inalcanzable sin
  // un mutate exitoso.
  it('con ?publicado sobre una mascota AJENA no muestra el exito', () => {
    mocks.pet = { ...PET, owner_id: 'otro-usuario', reporter_id: undefined };
    mocks.search = 'petId=pet-1&status=lost&publicado=report-1';
    render(<CreateReportPage />, { wrapper });

    expect(screen.queryByTestId('share-panel')).not.toBeInTheDocument();
    expect(screen.queryByText('publish:success.lostTitle')).not.toBeInTheDocument();
    // Y sigue fallando CERRADO: tampoco cae al formulario, que seria el otro
    // agujero.
    expect(document.querySelector('form')).toBeNull();
  });

  it('mientras la mascota carga con ?publicado tampoco aparece el formulario', () => {
    // Fallar ABIERTO acá seria reabrir el agujero por otra puerta: un
    // formulario vivo y re-enviable en la URL de un reporte que ya existe.
    mocks.search = 'petId=pet-1&status=lost&publicado=report-1';
    mocks.rendersCargando = 2;
    render(<CreateReportPage />, { wrapper });

    expect(document.querySelector('form')).toBeNull();
  });
});

// Cambiar el estado de la mascota lo decide su dueño, y el backend lo rechaza
// con 403. El formulario esconde esas opciones para no dejar que un tercero lo
// llene entero y recien ahi se entere. Le queda el avistamiento, que es como
// aporta al seguimiento — despues se coordina por el chat o WhatsApp.
describe('CreateReportPage — una mascota ajena', () => {
  const ajena = { id: 'pet-9', name: 'Nala', type: 'perro', status: 'lost', owner_id: 'otro-usuario', photos: [] };

  it('a un tercero solo le ofrece avistamiento', () => {
    mocks.pet = ajena;
    mocks.search = 'petId=pet-9';

    render(<CreateReportPage />, { wrapper });

    expect(screen.getByText('pets:card.sighting')).toBeInTheDocument();
    expect(screen.queryByText('pets:card.lost')).not.toBeInTheDocument();
    expect(screen.queryByText('pets:card.found')).not.toBeInTheDocument();
  });

  // Entrar a mano con ?status=lost a una mascota ajena no debe mandar `lost`:
  // se cae a avistamiento en vez de armar un request que el backend rechaza.
  it('con ?status=lost en la URL igual manda un avistamiento', () => {
    mocks.pet = ajena;
    mocks.search = 'petId=pet-9&status=lost';

    render(<CreateReportPage />, { wrapper });
    marcarUbicacion();
    enviar();

    expect(mocks.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ pet_id: 'pet-9', status: 'sighting' }),
      expect.anything(),
    );
  });
});

// La mascota no llega en el primer render. Con un useEffect que pisaba `status`
// cuando el usuario "no podia" cambiarlo, ese primer render —sin mascota, o sea
// sin permiso— lo reescribia a sighting, y nada lo devolvia al cargar. La DUEÑA
// entrando en frio a ?status=lost terminaba publicando un avistamiento.
//
// Con caché caliente no se reproduce, que es por que los otros tests no lo veian:
// mockean la mascota con isLoading false desde el primer render.
describe('CreateReportPage — la mascota carga despues del primer render', () => {
  it('la dueña con ?status=lost sigue mandando lost aunque la mascota tarde', () => {
    mocks.rendersCargando = 2; // los primeros renders no tienen la mascota
    mocks.search = 'petId=pet-1&status=lost';

    render(<CreateReportPage />, { wrapper });
    marcarUbicacion();
    enviar();

    expect(mocks.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ pet_id: 'pet-1', status: 'lost' }),
      expect.anything(),
    );
  });
});

// "No tenes permiso" y "no pude cargar la mascota" son lo mismo para
// canManagePet: los dos dan false. Pero significan cosas OPUESTAS. Colapsarlos
// hacia que el dueño abriera ?status=lost con la API caida —un arranque en frio
// de Render alcanza—, se publicara un AVISTAMIENTO, y lo mandaramos al listado
// como si hubiera salido bien. La busqueda nunca se abria y nadie se lo decia.
describe('CreateReportPage — la mascota no se pudo cargar', () => {
  it('no publica nada y avisa, en vez de degradar el pedido a avistamiento', () => {
    mocks.pet = undefined;        // usePetByID devuelve vacio, ya sin cargar
    mocks.myPetsVacio = true;     // y myPets tampoco la tiene
    mocks.search = 'petId=pet-1&status=lost';

    render(<CreateReportPage />, { wrapper });
    marcarUbicacion();
    enviar();

    expect(mocks.mutate).not.toHaveBeenCalled();
    // Aparece dos veces: el bloque de la mascota ya decia 'no encontrada'
    // ANTES de este arreglo, y aun asi el formulario se enviaba. Lo que faltaba
    // no era el mensaje, era cortar el envio.
    expect(screen.getAllByText('pets:detail.notFound').length).toBeGreaterThan(0);
  });
});

// El caso ORIGINAL de toda esta clase, medido el 2026-08-24: el selector de
// mascota se quedaba con su placeholder y nada mas. El usuario leia "elegi una
// mascota" sobre una lista vacia y concluia que no tenia ninguna registrada.
describe('CreateReportPage — el selector de mascota', () => {
  it('con la lista caida avisa, en vez de ofrecer un selector vacio', () => {
    mocks.search = '';            // flujo directo: sin ?petId=, aparece el <select>
    mocks.myPetsError = true;

    render(<CreateReportPage />, { wrapper });

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  // Con el campo reemplazado por el cartel, `fieldErrors.petId` se queda SIN
  // renderer: sus dos unicos lugares son el `FormField` de `campoMascota` y la
  // rama del preset. Si el boton sigue vivo, `validate()` falla y en pantalla
  // no cambia NADA — un boton muerto y silencioso.
  it('con la lista caida el boton de enviar NO queda vivo y mudo', () => {
    mocks.search = '';
    mocks.myPetsError = true;

    render(<CreateReportPage />, { wrapper });

    expect(screen.getByRole('button', { name: 'reports:create.submit' })).toBeDisabled();
  });

  // La otra mitad: con mascotas, el selector sigue estando y las lista.
  it('con mascotas el selector las ofrece', () => {
    mocks.search = '';

    render(<CreateReportPage />, { wrapper });

    expect(screen.getByRole('combobox')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
