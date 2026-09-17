// Runner: Vitest (vitest.shared.config.ts), environment node con el setup que
// hace andar `renderHook` de @testing-library/react. Ver `shared/hooks/index.test.ts`.
//
// POR QUÉ ESTE ARCHIVO EXISTE, y no alcanzaba con los tests de pantalla:
// `useCiudadDecidida` es una máquina de estados con un ref y tres efectos, y
// toda su cobertura era indirecta —dos suites de pantalla, cada una enhebrando
// mocks de sesión a través de un árbol de componentes ajeno—. Los bordes de la
// política salían carísimos de alcanzar así, y varios no se alcanzaban.
//
// Los tests de pantalla siguen siendo los que prueban el CABLEADO (qué estado
// toca cada plataforma). Éstos prueban la POLÍTICA.
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCiudadDecidida, type CiudadDecididaOptions } from './useCiudadDecidida';

/**
 * Monta el hook con un espía en `aplicar` y devuelve las ciudades aplicadas en
 * orden, más el `rerender` para mover la sesión.
 *
 * Se afirma sobre la SECUENCIA y no sólo sobre la última: "no se adelantó" y
 * "se adelantó y después lo corrigió" terminan igual, y la diferencia entre las
 * dos es justamente el defecto que el fallback demorado vino a cerrar.
 */
function montar(inicial: Omit<CiudadDecididaOptions, 'aplicar'>) {
  const aplicadas: string[] = [];
  const aplicar = vi.fn((ciudad: string) => {
    aplicadas.push(ciudad);
  });

  const vista = renderHook(
    (props: Omit<CiudadDecididaOptions, 'aplicar'>) => useCiudadDecidida({ ...props, aplicar }),
    { initialProps: inicial },
  );

  return { aplicadas, vista };
}

describe('useCiudadDecidida', () => {
  describe('siembra desde el perfil', () => {
    it('aplica la ciudad propia en cuanto llega', () => {
      const { aplicadas, vista } = montar({ userId: null, ciudadDelPerfil: null });
      expect(aplicadas).toEqual([]);

      vista.rerender({ userId: 'a', ciudadDelPerfil: 'Salto' });

      expect(aplicadas).toEqual(['Salto']);
    });

    it('recorta los espacios', () => {
      const { aplicadas } = montar({ userId: 'a', ciudadDelPerfil: '  Rivera  ' });
      expect(aplicadas).toEqual(['Rivera']);
    });

    // Las cuentas anteriores a que la ciudad fuera obligatoria en el alta la
    // tienen vacía. Sembrar con '' marcaría la decisión sin aplicar nada, y la
    // ciudad que llegue después ya no entraría nunca.
    it('una ciudad de sólo espacios NO gasta la decisión', () => {
      const { aplicadas, vista } = montar({ userId: 'a', ciudadDelPerfil: '   ' });
      expect(aplicadas).toEqual([]);

      vista.rerender({ userId: 'a', ciudadDelPerfil: 'Paysandú' });

      expect(aplicadas).toEqual(['Paysandú']);
    });

    it('una vez sembrada, otra ciudad del perfil no la pisa', () => {
      const { aplicadas, vista } = montar({ userId: 'a', ciudadDelPerfil: 'Salto' });

      vista.rerender({ userId: 'a', ciudadDelPerfil: 'Rivera' });

      expect(aplicadas).toEqual(['Salto']);
    });
  });

  describe('la búsqueda a mano decide', () => {
    it('devuelve la ciudad recortada', () => {
      const { vista } = montar({ userId: null, ciudadDelPerfil: null });
      expect(vista.result.current.decidirManualmente('  Melo  ')).toBe('Melo');
    });

    it('devuelve null con la entrada vacía o de sólo espacios', () => {
      const { vista } = montar({ userId: null, ciudadDelPerfil: null });
      expect(vista.result.current.decidirManualmente('')).toBeNull();
      expect(vista.result.current.decidirManualmente('   ')).toBeNull();
    });

    // EL ORDEN MÁS PROBABLE DE TODOS, y el defecto CRÍTICO que arregló el #248.
    //
    // La sesión hidrata después del primer render, así que quien entra y busca
    // de una lo hace con la decisión todavía sin tomar. Si el ref preguntara
    // "¿ya sembré?" en vez de "¿ya está decidida?", el perfil aterrizaría
    // encima y le pisaría la búsqueda.
    it('el perfil que llega DESPUÉS no pisa una búsqueda a mano', () => {
      const { aplicadas, vista } = montar({ userId: null, ciudadDelPerfil: null });

      vista.result.current.decidirManualmente('Salto');
      vista.rerender({ userId: 'a', ciudadDelPerfil: 'Rivera' });

      expect(aplicadas).toEqual([]);
    });

    // La otra mitad, y sin ella la de arriba no prueba nada: un hook que NUNCA
    // siembra también la pasaría.
    it('pero una entrada vacía no decide, así que el perfil sí entra', () => {
      const { aplicadas, vista } = montar({ userId: null, ciudadDelPerfil: null });

      vista.result.current.decidirManualmente('   ');
      vista.rerender({ userId: 'a', ciudadDelPerfil: 'Rivera' });

      expect(aplicadas).toEqual(['Rivera']);
    });
  });

  describe('el fallback', () => {
    it('no se aplica mientras la sesión no se resolvió', () => {
      const { aplicadas } = montar({
        userId: null,
        ciudadDelPerfil: null,
        sesionResuelta: false,
        fallback: 'Montevideo',
      });

      expect(aplicadas).toEqual([]);
    });

    it('se aplica una vez resuelta y sin ciudad propia', () => {
      const { aplicadas, vista } = montar({
        userId: null,
        ciudadDelPerfil: null,
        sesionResuelta: false,
        fallback: 'Montevideo',
      });

      vista.rerender({
        userId: null,
        ciudadDelPerfil: null,
        sesionResuelta: true,
        fallback: 'Montevideo',
      });

      expect(aplicadas).toEqual(['Montevideo']);
    });

    // LA MITAD QUE MÁS IMPORTA, y el defecto que tuvo la primera versión de
    // este hook: marcar el fallback como decisión QUEMABA la siembra. Alguien
    // sin sesión veía el default, se logueaba, y su ciudad ya no entraba nunca.
    //
    // El fallback es lo que se muestra mientras tanto, no una elección.
    it('NO decide: la ciudad propia que llega después sí entra', () => {
      const { aplicadas, vista } = montar({
        userId: null,
        ciudadDelPerfil: null,
        sesionResuelta: true,
        fallback: 'Montevideo',
      });
      expect(aplicadas).toEqual(['Montevideo']);

      vista.rerender({
        userId: 'a',
        ciudadDelPerfil: 'Durazno',
        sesionResuelta: true,
        fallback: 'Montevideo',
      });

      expect(aplicadas).toEqual(['Montevideo', 'Durazno']);
    });

    it('sin fallback no se aplica nada: la pantalla sigue pidiendo la ciudad', () => {
      const { aplicadas } = montar({
        userId: null,
        ciudadDelPerfil: null,
        sesionResuelta: true,
      });

      expect(aplicadas).toEqual([]);
    });
  });

  describe('cambio de identidad', () => {
    it('al entrar otra persona suelta la decisión y siembra su ciudad', () => {
      const { aplicadas, vista } = montar({ userId: 'a', ciudadDelPerfil: 'Salto' });
      expect(aplicadas).toEqual(['Salto']);

      vista.rerender({ userId: 'b', ciudadDelPerfil: 'Melo' });

      expect(aplicadas).toEqual(['Salto', 'Melo']);
    });

    it('el logout también la suelta: la sesión siguiente siembra', () => {
      const { aplicadas, vista } = montar({ userId: 'a', ciudadDelPerfil: 'Salto' });

      vista.rerender({ userId: null, ciudadDelPerfil: null });
      vista.rerender({ userId: 'b', ciudadDelPerfil: 'Melo' });

      expect(aplicadas).toEqual(['Salto', 'Melo']);
    });

    // LA HIDRATACIÓN NO ES UN CAMBIO DE IDENTIDAD, y ésta es la condición donde
    // está todo el riesgo del reset: si `null → alguien` soltara la decisión,
    // reintroduciría el defecto crítico del #248 — quien buscó a mano antes de
    // que llegara la sesión perdería su búsqueda contra el perfil.
    //
    // Es el mismo escenario que "el perfil que llega DESPUÉS", pero atacado
    // desde el reset en vez de desde la siembra: son dos caminos distintos al
    // mismo ref y cada uno puede romperse solo.
    it('la hidratación (null → alguien) NO suelta una decisión ya tomada', () => {
      const { aplicadas, vista } = montar({ userId: null, ciudadDelPerfil: null });

      vista.result.current.decidirManualmente('Salto');
      vista.rerender({ userId: 'a', ciudadDelPerfil: 'Rivera' });

      expect(aplicadas).toEqual([]);
    });

    // BORDE DOCUMENTADO, no bendecido: con el id ausente en las dos identidades
    // el reset no puede dispararse, porque no hay con qué distinguirlas.
    //
    // Hoy es INALCANZABLE desde la app: `User.id` es `string` obligatorio en
    // `shared/types`, así que toda sesión autenticada lo trae. Este test existe
    // para que el supuesto sea visible: si alguna vez se le pasa a este hook
    // una forma de usuario sin `id`, acá está escrito qué pasa.
    it('sin `userId` en ninguna de las dos, no hay reset posible', () => {
      const { aplicadas, vista } = montar({ ciudadDelPerfil: 'Salto' });
      expect(aplicadas).toEqual(['Salto']);

      vista.rerender({ ciudadDelPerfil: 'Melo' });

      expect(aplicadas).toEqual(['Salto']);
    });
  });

  // `aplicar` se redefine en cada render de la pantalla, y por eso vive en un
  // ref en vez de en las dependencias del efecto.
  //
  // EL ESCENARIO TIENE QUE SER EL DEL FALLBACK, y no el de la siembra. Con una
  // ciudad ya sembrada el efecto sale en la primera línea (`if (decidida)
  // return`), así que el ref no cambia nada y el test pasa igual con `aplicar`
  // en las dependencias — lo comprobé en verde, o sea que no probaba nada.
  //
  // El fallback NO marca la decisión a propósito, así que es el único camino
  // donde el efecto vuelve a entrar de verdad: ahí una dependencia que cambia
  // en cada render lo hace correr en cada render.
  it('un `aplicar` nuevo en cada render no re-aplica el fallback', () => {
    const aplicadas: string[] = [];
    const vista = renderHook(
      (props: { sesionResuelta: boolean }) =>
        useCiudadDecidida({
          userId: null,
          ciudadDelPerfil: null,
          sesionResuelta: props.sesionResuelta,
          fallback: 'Montevideo',
          // Función nueva en cada render, a propósito.
          aplicar: (ciudad) => aplicadas.push(ciudad),
        }),
      { initialProps: { sesionResuelta: true } },
    );
    expect(aplicadas).toEqual(['Montevideo']);

    vista.rerender({ sesionResuelta: true });
    vista.rerender({ sesionResuelta: true });

    expect(aplicadas).toEqual(['Montevideo']);
  });
});
