import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AlertZonePicker } from './AlertZonePicker';

/**
 * El mapa se moquea con la misma forma que `MapPage.test.tsx`: react-leaflet no
 * corre en jsdom, así que lo que se afirma es el CONTRATO que el componente le
 * pide a Leaflet — dónde pone el marcador, de qué tamaño pide el círculo y
 * cuándo mueve la vista — no los píxeles, que sólo puede ver Playwright.
 */
const mapa = vi.hoisted(() => ({
  setView: vi.fn(),
  fitBounds: vi.fn(),
  // Por defecto el punto entra en la vista: es el caso normal de arrastrar el
  // marcador, y es el que NO tiene que mover la cámara.
  //
  // El tipo de retorno va ANOTADO: sin él TypeScript infiere el literal `true`
  // y el `mockReturnValue({ contains: () => false })` del caso contrario no
  // compila. Lo destapó `pnpm build`, no los tests.
  getBounds: vi.fn((): { contains: (p: unknown) => boolean } => ({ contains: () => true })),
}));

const capturado = vi.hoisted(() => ({
  circulo: null as { center?: unknown; radius?: number } | null,
  marcador: null as { position?: unknown } | null,
  onDragEnd: undefined as ((e: unknown) => void) | undefined,
  onMapClick: undefined as ((e: unknown) => void) | undefined,
}));

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="map-container">{children}</div>
  ),
  TileLayer: () => null,
  Marker: (props: { position: unknown; eventHandlers?: { dragend?: (e: unknown) => void } }) => {
    capturado.marcador = { position: props.position };
    capturado.onDragEnd = props.eventHandlers?.dragend;
    return <div data-testid="marker" />;
  },
  Circle: (props: { center: unknown; radius: number }) => {
    capturado.circulo = { center: props.center, radius: props.radius };
    return <div data-testid="circle" />;
  },
  useMap: () => mapa,
  useMapEvents: (handlers: { click?: (e: unknown) => void }) => {
    capturado.onMapClick = handlers.click;
    return mapa;
  },
}));

function pintar(props: Partial<React.ComponentProps<typeof AlertZonePicker>> = {}) {
  const onPick = vi.fn();
  const utils = render(
    <AlertZonePicker
      latitude={-34.9011}
      longitude={-56.1645}
      radiusKm={5}
      onPick={onPick}
      hint="Tocá el mapa"
      {...props}
    />
  );
  return { onPick, ...utils };
}

describe('AlertZonePicker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mapa.getBounds.mockReturnValue({ contains: () => true });
    capturado.circulo = null;
    capturado.marcador = null;
    capturado.onDragEnd = undefined;
    capturado.onMapClick = undefined;
  });

  // Sin punto elegido NO se dibuja un marcador en ningún lado. Plantarlo en
  // Montevideo "para que se vea algo" afirmaría una zona que el usuario no
  // eligió, y su alerta terminaría vigilando el centro por defecto.
  it('sin coordenadas no dibuja ni marcador ni circulo, y explica que hacer', () => {
    pintar({ latitude: null, longitude: null });

    expect(screen.queryByTestId('marker')).not.toBeInTheDocument();
    expect(screen.queryByTestId('circle')).not.toBeInTheDocument();
    expect(screen.getByText('Tocá el mapa')).toBeInTheDocument();
  });

  it('con coordenadas dibuja el marcador en el punto, y la pista se va', () => {
    pintar();

    expect(capturado.marcador?.position).toEqual([-34.9011, -56.1645]);
    expect(screen.queryByText('Tocá el mapa')).not.toBeInTheDocument();
  });

  // Leaflet pide el radio en METROS y el modelo lo guarda en KILÓMETROS. Sin
  // esta conversión el círculo de una alerta de 5 km se dibuja de 5 metros: se
  // ve un punto, y el usuario concluye que el radio no hace nada.
  it('el circulo se pide en METROS, no en los kilometros del modelo', () => {
    pintar({ radiusKm: 5 });

    expect(capturado.circulo?.radius).toBe(5000);
    expect(capturado.circulo?.center).toEqual([-34.9011, -56.1645]);
  });

  it('arrastrar el marcador informa el punto nuevo', () => {
    const { onPick } = pintar();

    capturado.onDragEnd?.({
      target: { getLatLng: () => ({ lat: -34.88, lng: -56.12 }) },
    });

    expect(onPick).toHaveBeenCalledWith(-34.88, -56.12);
  });

  // El click es la única vía de RATÓN para elegir una zona que no sea la propia:
  // sin él, quien quiere vigilar la casa de un familiar tiene que arrastrar el
  // marcador desde donde haya caído, o volver a tipear coordenadas.
  it('tocar el mapa elige ese punto', () => {
    const { onPick } = pintar({ latitude: null, longitude: null });

    capturado.onMapClick?.({ latlng: { lat: -34.85, lng: -56.2 } });

    expect(onPick).toHaveBeenCalledWith(-34.85, -56.2);
  });

  // Las dos mitades de la misma decisión, porque una sola no prueba nada.
  describe('la camara', () => {
    it('reencuadra cuando cambia el radio, para que el circulo entre', () => {
      const { rerender, onPick } = pintar({ radiusKm: 1 });
      mapa.fitBounds.mockClear();

      rerender(
        <AlertZonePicker
          latitude={-34.9011}
          longitude={-56.1645}
          radiusKm={25}
          onPick={onPick}
          hint="Tocá el mapa"
        />
      );

      expect(mapa.fitBounds).toHaveBeenCalled();
    });

    // Y la mitad que importa de verdad: arrastrar el marcador NO mueve la
    // cámara. Con un `setView` en cada cambio de posición el mapa salta para
    // centrar el pin en cada suelta, así que el punto nunca se puede dejar
    // fuera del centro y el arrastre pelea contra la vista.
    it('NO mueve la vista cuando el punto nuevo ya se ve', () => {
      const { rerender, onPick } = pintar();
      mapa.setView.mockClear();

      rerender(
        <AlertZonePicker
          latitude={-34.89}
          longitude={-56.16}
          radiusKm={5}
          onPick={onPick}
          hint="Tocá el mapa"
        />
      );

      expect(mapa.setView).not.toHaveBeenCalled();
    });

    // El PRIMER punto también encuadra, y este caso lo levantó la revisión
    // nativa: el efecto del radio dependía sólo de `[map, radiusKm]`, así que
    // en la transición `null → punto` no volvía a correr, y el otro efecto
    // tampoco hacía nada porque un click siempre cae DENTRO de la vista.
    // Resultado: el primer círculo se dibujaba sin que la cámara lo mirara, y
    // con 25 km eso es una circunferencia más grande que la pantalla.
    it('encuadra el PRIMER punto elegido, no solo los cambios de radio', () => {
      const onPick = vi.fn();
      const { rerender } = render(
        <AlertZonePicker
          latitude={null}
          longitude={null}
          radiusKm={5}
          onPick={onPick}
          hint="Tocá el mapa"
        />
      );
      mapa.fitBounds.mockClear();

      rerender(
        <AlertZonePicker
          latitude={-34.9011}
          longitude={-56.1645}
          radiusKm={5}
          onPick={onPick}
          hint="Tocá el mapa"
        />
      );

      expect(mapa.fitBounds).toHaveBeenCalledTimes(1);
    });

    // Y la otra mitad, que es la que el arreglo de arriba no puede romper:
    // mover un punto YA elegido sigue sin reencuadrar.
    it('mover un punto ya elegido NO reencuadra', () => {
      const onPick = vi.fn();
      const { rerender } = render(
        <AlertZonePicker
          latitude={-34.9011}
          longitude={-56.1645}
          radiusKm={5}
          onPick={onPick}
          hint="Tocá el mapa"
        />
      );
      mapa.fitBounds.mockClear();

      rerender(
        <AlertZonePicker
          latitude={-34.89}
          longitude={-56.16}
          radiusKm={5}
          onPick={onPick}
          hint="Tocá el mapa"
        />
      );

      expect(mapa.fitBounds).not.toHaveBeenCalled();
    });

    // ...pero sí la mueve cuando el punto quedó fuera de pantalla, que es lo
    // que pasa al tipear una coordenada lejana en los inputs: sin esto el
    // usuario escribe y el mapa se queda mostrando otra ciudad.
    it('SI mueve la vista cuando el punto nuevo quedo fuera', () => {
      const { rerender, onPick } = pintar();
      mapa.setView.mockClear();
      mapa.getBounds.mockReturnValue({ contains: () => false });

      rerender(
        <AlertZonePicker
          latitude={-30.0}
          longitude={-51.2}
          radiusKm={5}
          onPick={onPick}
          hint="Tocá el mapa"
        />
      );

      expect(mapa.setView).toHaveBeenCalledWith([-30.0, -51.2]);
    });
  });

  // POR QUÉ EXISTE, y es la parte que ningún test veía: `editarCoordenada` pone
  // el estado en `null` cuando el input queda vacío, y un `<input type="number">`
  // reporta `value === ''` para TODO estado intermedio inválido — `-`, `-34.` —
  // además del campo borrado. O sea que editar a mano una latitud ya elegida
  // pasa por `null` varias veces, y con la cámara atada al booleano `elegido`
  // eso reencuadraba en cada recuperación: el mapa saltaba a mitad de tipeo.
  //
  // Es el camino ACCESIBLE, el que este componente existe para proteger, y el
  // comentario que había en el código afirmaba el invariante contrario.
  describe('editar las coordenadas a mano', () => {
    // El tipo de `onPick` va ANOTADO con la firma real y no con
    // `ReturnType<typeof vi.fn>`: ese alias incluye `Constructable`, no matchea
    // `(lat, lng) => void`, y `tsc` lo rechaza. Los tests pasaban igual —lo
    // cazó `pnpm build`, como la vez anterior en este mismo archivo.
    const conPunto = (
      lat: number | null,
      lng: number | null,
      onPick: (latitude: number, longitude: number) => void
    ) => (
      <AlertZonePicker
        latitude={lat}
        longitude={lng}
        radiusKm={5}
        onPick={onPick}
        hint="Tocá el mapa"
      />
    );

    it('el hueco de un tipeo NO vuelve a encuadrar la camara', () => {
      const onPick = vi.fn();
      const { rerender } = render(conPunto(-34.9011, -56.1645, onPick));
      expect(mapa.fitBounds).toHaveBeenCalledTimes(1); // el primer punto, sí
      mapa.fitBounds.mockClear();

      rerender(conPunto(null, -56.1645, onPick)); // el usuario borra la latitud
      rerender(conPunto(-3, -56.1645, onPick)); // y empieza a escribir de nuevo

      expect(mapa.fitBounds).not.toHaveBeenCalled();
    });

    it('la pista no reaparece sobre un mapa que ya tuvo punto', () => {
      const onPick = vi.fn();
      const { rerender } = render(conPunto(-34.9011, -56.1645, onPick));
      expect(screen.queryByText('Tocá el mapa')).not.toBeInTheDocument();

      rerender(conPunto(null, -56.1645, onPick));

      // El marcador SÍ puede irse —sin par completo no hay punto que dibujar, y
      // eso es honesto—, pero "tocá el mapa para elegir la zona" es una
      // INSTRUCCIÓN, y sobre alguien que está corrigiendo su zona a mano es una
      // instrucción equivocada. Un dato ausente no miente; una instrucción sí.
      expect(screen.queryByText('Tocá el mapa')).not.toBeInTheDocument();
    });

    it('sin ningun punto todavia, la pista SI se muestra', () => {
      // El centinela del test de arriba: sin esto, esconder la pista para
      // siempre lo dejaría verde y el estado vacío se quedaría mudo.
      render(conPunto(null, null, vi.fn()));
      expect(screen.getByText('Tocá el mapa')).toBeInTheDocument();
    });

    // POR QUÉ EXISTE, y lo pidió la revisión nativa: el test de arriba prueba el
    // hueco con un punto CERCANO, que se recupera dentro de la vista. Faltaba la
    // otra rama — el mismo radio aterrizando LEJOS—, donde además entra en juego
    // el paneo. Lo que se afirma son las dos mitades juntas: la cámara panea al
    // punto nuevo y NO vuelve a encuadrar.
    //
    // Que eso sea correcto no es casualidad: el encuadre lo determina el RADIO
    // (`toBounds(radiusKm * 2 * 1000)`), así que con el mismo radio el zoom que
    // quedó del encuadre anterior enmarca el círculo nuevo igual. Reencuadrar
    // acá no arreglaría nada y le devolvería el salto al camino accesible.
    it('un punto lejano con el MISMO radio panea, y no reencuadra', () => {
      const onPick = vi.fn();
      const { rerender } = render(conPunto(-34.9011, -56.1645, onPick));
      mapa.fitBounds.mockClear();
      mapa.setView.mockClear();
      // El punto nuevo cae fuera de la vista: es lo que pasa al tipear una
      // coordenada de otra ciudad.
      mapa.getBounds.mockReturnValue({ contains: () => false });

      rerender(conPunto(-30.0, -51.2, onPick));

      expect(mapa.setView).toHaveBeenCalledWith([-30.0, -51.2]);
      expect(mapa.fitBounds).not.toHaveBeenCalled();
    });

    it('cambiar el radio SI reencuadra, con un punto ya elegido', () => {
      // La otra mitad: el guard del ref no puede apagar el reencuadre del radio,
      // que es la mitad del motivo por el que este mapa existe.
      const onPick = vi.fn();
      const { rerender } = render(conPunto(-34.9011, -56.1645, onPick));
      mapa.fitBounds.mockClear();

      rerender(
        <AlertZonePicker
          latitude={-34.9011}
          longitude={-56.1645}
          radiusKm={25}
          onPick={onPick}
          hint="Tocá el mapa"
        />
      );

      expect(mapa.fitBounds).toHaveBeenCalledTimes(1);
    });
  });
});
