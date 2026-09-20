import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { AlertsMap } from './AlertsMap';
import type { LocationAlert } from '@shared/types';

const mapa = vi.hoisted(() => ({
  fitBounds: vi.fn(),
}));

const circulos = vi.hoisted(
  () => [] as Array<{ center: unknown; radius: number; options?: Record<string, unknown> }>
);

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="map-container">{children}</div>
  ),
  TileLayer: () => null,
  Circle: (props: {
    center: unknown;
    radius: number;
    pathOptions?: Record<string, unknown>;
    children?: React.ReactNode;
  }) => {
    circulos.push({ center: props.center, radius: props.radius, options: props.pathOptions });
    return <div data-testid="circle">{props.children}</div>;
  },
  Tooltip: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  useMap: () => mapa,
}));

function alerta(overrides: Partial<LocationAlert> = {}): LocationAlert {
  return {
    id: 'a1',
    name: 'Mi barrio',
    alert_latitude: -34.9011,
    alert_longitude: -56.1645,
    radius_km: 5,
    is_active: true,
    ...overrides,
  } as LocationAlert;
}

describe('AlertsMap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    circulos.length = 0;
  });

  it('dibuja un circulo por alerta, con el radio en METROS', () => {
    render(
      <AlertsMap
        alerts={[alerta(), alerta({ id: 'a2', radius_km: 2, alert_latitude: -34.88 })]}
        focused={null}
        focusTick={0}
        labelFor={(a) => a.name ?? 'sin nombre'}
      />
    );

    expect(circulos).toHaveLength(2);
    expect(circulos.map((c) => c.radius)).toEqual([5000, 2000]);
  });

  // Una alerta pausada y una activa NO pueden distinguirse SÓLO por el color:
  // es el criterio 1.4.1 de WCAG, y acá además el mapa es la única vista donde
  // conviven las dos. El trazo punteado es la diferencia que sobrevive al
  // daltonismo y a una captura en blanco y negro.
  it('la pausada se distingue de la activa por algo que no es solo el color', () => {
    render(
      <AlertsMap
        alerts={[alerta({ id: 'viva', is_active: true }), alerta({ id: 'quieta', is_active: false })]}
        focused={null}
        focusTick={0}
        labelFor={(a) => a.name ?? 'sin nombre'}
      />
    );

    const [viva, quieta] = circulos;
    expect(viva.options?.dashArray).toBeFalsy();
    expect(quieta.options?.dashArray).toBeTruthy();
    // Y que además el color cambie está bien; lo que no está bien es que sea
    // lo único.
    expect(quieta.options?.color).not.toBe(viva.options?.color);
  });

  it('al montar encuadra TODAS las zonas, no sólo la primera', () => {
    render(
      <AlertsMap
        alerts={[
          alerta({ id: 'a1', alert_latitude: -34.9, alert_longitude: -56.16 }),
          alerta({ id: 'a2', alert_latitude: -34.4, alert_longitude: -55.2 }),
        ]}
        focused={null}
        focusTick={0}
        labelFor={(a) => a.name ?? 'sin nombre'}
      />
    );

    expect(mapa.fitBounds).toHaveBeenCalledTimes(1);
    const bounds = mapa.fitBounds.mock.calls[0][0] as L.LatLngBounds;
    // El encuadre tiene que contener las DOS: con `fitBounds` sobre la primera
    // sola, la segunda alerta queda fuera de pantalla y el mapa miente sobre
    // cuántas zonas estás vigilando.
    expect(bounds.contains([-34.9, -56.16])).toBe(true);
    expect(bounds.contains([-34.4, -55.2])).toBe(true);
  });

  it('enfocar una alerta encuadra ESA zona', () => {
    const props = {
      alerts: [
        alerta({ id: 'a1', alert_latitude: -34.9, alert_longitude: -56.16 }),
        alerta({ id: 'a2', alert_latitude: -34.4, alert_longitude: -55.2, radius_km: 1 }),
      ],
      labelFor: (a: LocationAlert) => a.name ?? 'sin nombre',
    };
    const { rerender } = render(<AlertsMap {...props} focused={null} focusTick={0} />);
    mapa.fitBounds.mockClear();

    rerender(<AlertsMap {...props} focused="a2" focusTick={1} />);

    expect(mapa.fitBounds).toHaveBeenCalledTimes(1);
    const bounds = mapa.fitBounds.mock.calls[0][0] as L.LatLngBounds;
    expect(bounds.contains([-34.4, -55.2])).toBe(true);
    // Y NO la otra: si el encuadre sigue abarcando todo, "enfocar" no hizo nada.
    expect(bounds.contains([-34.9, -56.16])).toBe(false);
  });

  // La página nunca limpia `focused`, así que borrar la alerta enfocada deja un
  // id que ya no existe. Por construcción eso no rompe —`find` devuelve
  // `undefined` y se cae al encuadre del conjunto— pero "no rompe por
  // construcción" es un razonamiento, no una prueba. Lo levantó la revisión
  // nativa y acá queda demostrado.
  it('con un id enfocado que ya no existe, vuelve a encuadrar el conjunto', () => {
    render(
      <AlertsMap
        alerts={[
          alerta({ id: 'a1', alert_latitude: -34.9, alert_longitude: -56.16 }),
          alerta({ id: 'a2', alert_latitude: -34.4, alert_longitude: -55.2 }),
        ]}
        focused="la-que-borre"
        focusTick={0}
        labelFor={(a) => a.name ?? 'sin nombre'}
      />
    );

    expect(mapa.fitBounds).toHaveBeenCalledTimes(1);
    const bounds = mapa.fitBounds.mock.calls[0][0] as L.LatLngBounds;
    expect(bounds.contains([-34.9, -56.16])).toBe(true);
    expect(bounds.contains([-34.4, -55.2])).toBe(true);
  });

  it('cada zona dice de cual alerta es', () => {
    const { getByText } = render(
      <AlertsMap
        alerts={[alerta({ name: 'Casa de mamá' })]}
        focused={null}
        focusTick={0}
        labelFor={(a) => a.name ?? 'sin nombre'}
      />
    );

    expect(getByText('Casa de mamá')).toBeInTheDocument();
  });

  // POR QUÉ EXISTE: `focused` solo no distingue "mirá A" de "mirá A otra vez".
  // Pedir la misma alerta dos veces no cambia el estado en la página, React
  // corta el render, y este efecto no vuelve a correr — el botón de la tarjeta
  // quedaba MUERTO después de alejar el mapa a mano. Medido en el navegador: el
  // círculo terminaba en el mismo píxel antes y después del segundo click.
  //
  // El test afirma el pedido REPETIDO, que es la mitad que estaba rota. La otra
  // —cambiar de alerta— ya la cubre "enfocar una alerta encuadra ESA zona".
  it('pedir la MISMA zona otra vez vuelve a encuadrarla', () => {
    const props = {
      alerts: [alerta({ id: 'a1', alert_latitude: -34.9, alert_longitude: -56.16 })],
      labelFor: (a: LocationAlert) => a.name ?? 'sin nombre',
    };
    const { rerender } = render(<AlertsMap {...props} focused="a1" focusTick={1} />);
    mapa.fitBounds.mockClear();

    // Mismo destino, pedido nuevo: es exactamente lo que hace el segundo click.
    rerender(<AlertsMap {...props} focused="a1" focusTick={2} />);

    expect(mapa.fitBounds).toHaveBeenCalledTimes(1);
  });

  // La otra mitad del mismo arreglo: un re-render que NO pide nada no puede
  // mover la cámara. Sin esto, "andá siempre" pasaría el test de arriba y
  // reencuadraría el mapa en cada tecla que el usuario escriba en el formulario.
  it('un re-render sin pedido nuevo NO mueve la camara', () => {
    const props = {
      alerts: [alerta({ id: 'a1' })],
      labelFor: (a: LocationAlert) => a.name ?? 'sin nombre',
    };
    const { rerender } = render(<AlertsMap {...props} focused="a1" focusTick={1} />);
    mapa.fitBounds.mockClear();

    rerender(<AlertsMap {...props} focused="a1" focusTick={1} />);

    expect(mapa.fitBounds).not.toHaveBeenCalled();
  });

  // POR QUÉ EXISTE, y es un agujero que levantó la revisión nativa sobre los
  // dos tests de arriba: los dos reusan el MISMO objeto `props.alerts` en el
  // render y en el rerender, así que un `[alerts]` ingenuo en las deps los
  // dejaría verdes igual. O sea que no podían distinguir la memoización por
  // `ids` de no tener memoización ninguna.
  //
  // Y la memoización es lo único que sostiene el motivo que el comentario del
  // efecto declara: `AlertsPage` recalcula `alerts` en CADA render, así que con
  // `[alerts]` el mapa se reencuadraría con cada tecla que se escriba en el
  // formulario de arriba. Eso es lo que este test afirma, y es el ÚNICO que
  // puede: hace falta una referencia nueva con el mismo contenido.
  it('un array NUEVO con los mismos ids no mueve la camara', () => {
    const labelFor = (a: LocationAlert) => a.name ?? 'sin nombre';
    const primera = [alerta({ id: 'a1' }), alerta({ id: 'a2', alert_latitude: -34.4 })];
    // Mismo contenido, objetos distintos: exactamente lo que produce un render
    // nuevo de la página.
    const segunda = [alerta({ id: 'a1' }), alerta({ id: 'a2', alert_latitude: -34.4 })];
    expect(segunda).not.toBe(primera);

    const { rerender } = render(
      <AlertsMap alerts={primera} focused={null} focusTick={0} labelFor={labelFor} />
    );
    mapa.fitBounds.mockClear();

    rerender(<AlertsMap alerts={segunda} focused={null} focusTick={0} labelFor={labelFor} />);

    expect(mapa.fitBounds).not.toHaveBeenCalled();
  });
});
