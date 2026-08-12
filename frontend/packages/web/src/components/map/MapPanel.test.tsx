import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { MapPanel } from './MapPanel';
import { resumirFiltros } from '../../utils/mapFilterSummary';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (clave: string, opciones?: { count?: number }) =>
      opciones && typeof opciones.count === 'number' ? `${clave}:${opciones.count}` : clave,
  }),
}));

const sinFiltros = resumirFiltros({});
const conFiltros = resumirFiltros({ type: 'gato', status: ['lost'] });

/**
 * Sin `matchMedia`, `useEsHoja` devuelve false y el panel se comporta como la
 * columna de escritorio. Los casos que necesitan el modo HOJA lo montan con
 * esto; el resto se renderiza directo y ejercita el modo escritorio.
 */
function montarComoHoja() {
  Object.defineProperty(window, 'matchMedia', {
    value: () => ({ matches: true, media: '', addEventListener: vi.fn(), removeEventListener: vi.fn() }),
    configurable: true,
    writable: true,
  });
  return render(
    <MapPanel resumen={sinFiltros} resultCount={0} isLoading={false} isError={false}>
      <p>contenido</p>
    </MapPanel>,
  );
}

afterEach(() => {
  Reflect.deleteProperty(window, 'matchMedia');
});

describe('MapPanel', () => {
  it('anuncia los filtros aplicados en la barra de resumen', () => {
    render(
      <MapPanel resumen={conFiltros} resultCount={4} isLoading={false} isError={false}>
        <p>contenido</p>
      </MapPanel>,
    );
    // Dos grupos activos: tipo y estados.
    // Aparece dos veces a propósito: la barra de peek y la columna colapsada
    // conviven en el DOM y el CSS decide cuál se ve. Es lo que garantiza que
    // muestren lo MISMO.
    expect(screen.getAllByText('map:filtersActive:2').length).toBeGreaterThan(0);
    expect(screen.getAllByText('map:reports:4').length).toBe(2);
  });

  it('sin filtros lo dice explícitamente', () => {
    render(
      <MapPanel resumen={sinFiltros} resultCount={0} isLoading={false} isError={false}>
        <p>contenido</p>
      </MapPanel>,
    );
    expect(screen.getAllByText('map:noFilters').length).toBeGreaterThan(0);
  });

  // La garantía del spec: colapsar "no desmonta nada y no pierde el borrador".
  // Si el contenido se desmontara, lo que el usuario tenía a medio escribir en
  // el panel se perdería al cerrarlo — y cerrar es un gesto de acomodar la
  // pantalla, no de descartar trabajo.
  it('colapsar en escritorio NO desmonta el contenido del panel', () => {
    render(
      <MapPanel resumen={conFiltros} resultCount={4} isLoading={false} isError={false}>
        <p>contenido</p>
      </MapPanel>,
    );
    fireEvent.click(screen.getByLabelText('map:collapsePanel'));

    expect(screen.getByText('contenido')).toBeTruthy();
    expect(screen.getByLabelText('map:expandPanel')).toBeTruthy();
  });

  // Cerrado, el resumen es la ÚNICA información en pantalla sobre qué se está
  // filtrando. Sin él, una lista acotada por filtros se lee como la realidad.
  it('la columna colapsada sigue mostrando el resumen', () => {
    render(
      <MapPanel resumen={conFiltros} resultCount={4} isLoading={false} isError={false}>
        <p>contenido</p>
      </MapPanel>,
    );
    fireEvent.click(screen.getByLabelText('map:collapsePanel'));
    expect(screen.getAllByText('map:filtersActive:2').length).toBeGreaterThan(0);
  });

  // En `peek` el contenido está trasladado por debajo del contenedor y sólo lo
  // tapa el `overflow-hidden` de la fila. Un contenedor con overflow oculto
  // SIGUE siendo scrolleable por programa, así que enfocar un control de
  // adentro hace que el navegador lo traiga a la vista: medido en el navegador,
  // un Tab desde el asa saltaba al buscador de lugares, la fila scrolleaba
  // 414px y el mapa se iba a top:-349 — sin barra de scroll para volver.
  //
  // `inert` saca esos controles del orden de tabulación mientras están
  // guardados. Para llegar a ellos con teclado, primero se abre la hoja con el
  // asa, que es el mismo orden que con el dedo.
  it('en peek el contenido guardado queda fuera del orden de tabulación', () => {
    montarComoHoja();
    const contenido = screen.getByText('contenido').closest('[data-testid="map-panel-contenido"]');
    expect(contenido).toHaveAttribute('inert');
  });

  it('al abrir la hoja el contenido vuelve a ser alcanzable', () => {
    montarComoHoja();
    fireEvent.click(screen.getByLabelText('map:sheetToggle')); // peek -> half
    const contenido = screen.getByText('contenido').closest('[data-testid="map-panel-contenido"]');
    expect(contenido).not.toHaveAttribute('inert');
  });

  // En escritorio el panel está a la vista y nunca se traslada: marcarlo inert
  // dejaría los filtros sin teclado en la pantalla donde más se usa.
  it('en escritorio el contenido NUNCA es inert', () => {
    render(
      <MapPanel resumen={sinFiltros} resultCount={0} isLoading={false} isError={false}>
        <p>contenido</p>
      </MapPanel>,
    );
    const contenido = screen.getByText('contenido').closest('[data-testid="map-panel-contenido"]');
    expect(contenido).not.toHaveAttribute('inert');
  });

  // El contenido del panel mide ~1850px, así que el contenedor scrollea
  // siempre. Con el botón adentro, bajar a mirar la lista de reportes hacía
  // desaparecer el control para cerrar el panel hasta volver arriba.
  it('el botón de colapsar NO vive dentro del contenedor scrolleable', () => {
    render(
      <MapPanel resumen={sinFiltros} resultCount={0} isLoading={false} isError={false}>
        <p>contenido</p>
      </MapPanel>,
    );
    const boton = screen.getByLabelText('map:collapsePanel');
    expect(boton.closest('.overflow-y-auto')).toBeNull();
    // Y el contenido sí está adentro: la aserción de arriba no puede pasar
    // porque el contenedor haya dejado de existir.
    expect(screen.getByText('contenido').closest('.overflow-y-auto')).not.toBeNull();
  });

  it('se puede volver a expandir', () => {
    render(
      <MapPanel resumen={sinFiltros} resultCount={0} isLoading={false} isError={false}>
        <p>contenido</p>
      </MapPanel>,
    );
    fireEvent.click(screen.getByLabelText('map:collapsePanel'));
    fireEvent.click(screen.getByLabelText('map:expandPanel'));
    expect(screen.getByLabelText('map:collapsePanel')).toBeTruthy();
  });

  // El asa es la ÚNICA forma de abrir la hoja sin arrastrar. Quien navega con
  // teclado no puede arrastrar: sin este ciclo la hoja se queda en `peek` para
  // siempre y los filtros quedan inalcanzables.
  it('el click en el asa cicla peek → half → full → peek', () => {
    render(
      <MapPanel resumen={sinFiltros} resultCount={0} isLoading={false} isError={false}>
        <p>contenido</p>
      </MapPanel>,
    );
    const asa = screen.getByLabelText('map:sheetToggle');
    expect(asa.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(asa); // half
    expect(asa.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(asa); // full
    expect(asa.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(asa); // vuelve a peek
    expect(asa.getAttribute('aria-expanded')).toBe('false');
  });

  // La rebanada 2 ya había pagado esta lección en `NearbyReportList`: un
  // request FALLIDO llega como `reports === undefined` con `isLoading === false`,
  // indistinguible de una búsqueda sin resultados. La hoja la volvía invisible
  // un nivel más arriba — en `peek`, que es el estado por defecto en celular, la
  // lista está fuera de la pantalla y la barra es lo ÚNICO que se ve. El usuario
  // veía un mapa sin pines y una barra tranquila, y concluía que no hay reportes.
  it('un request fallido se anuncia en la barra, no se lee como vacío', () => {
    render(
      <MapPanel resumen={sinFiltros} resultCount={undefined} isLoading={false} isError>
        <p>contenido</p>
      </MapPanel>,
    );
    expect(screen.getAllByText('map:resultsError').length).toBeGreaterThan(0);
  });

  it('el error le gana al contador: no muestra un total y un error a la vez', () => {
    render(
      <MapPanel resumen={sinFiltros} resultCount={7} isLoading={false} isError>
        <p>contenido</p>
      </MapPanel>,
    );
    expect(screen.queryByText('map:reports:7')).toBeNull();
  });

  it('mientras carga, el resumen dice que está buscando en vez de mostrar un total viejo', () => {
    render(
      <MapPanel resumen={sinFiltros} resultCount={undefined} isLoading isError={false}>
        <p>contenido</p>
      </MapPanel>,
    );
    expect(screen.getByText('map:loadingResults')).toBeTruthy();
  });
});
