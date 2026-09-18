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
    const { rerender } = render(<AlertsMap {...props} focused={null} />);
    mapa.fitBounds.mockClear();

    rerender(<AlertsMap {...props} focused="a2" />);

    expect(mapa.fitBounds).toHaveBeenCalledTimes(1);
    const bounds = mapa.fitBounds.mock.calls[0][0] as L.LatLngBounds;
    expect(bounds.contains([-34.4, -55.2])).toBe(true);
    // Y NO la otra: si el encuadre sigue abarcando todo, "enfocar" no hizo nada.
    expect(bounds.contains([-34.9, -56.16])).toBe(false);
  });

  it('cada zona dice de cual alerta es', () => {
    const { getByText } = render(
      <AlertsMap
        alerts={[alerta({ name: 'Casa de mamá' })]}
        focused={null}
        labelFor={(a) => a.name ?? 'sin nombre'}
      />
    );

    expect(getByText('Casa de mamá')).toBeInTheDocument();
  });
});
