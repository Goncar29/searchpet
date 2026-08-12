import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../Icon';
import { useEsHoja } from '../../hooks/useEsHoja';
import { useBottomSheet, CSS_POR_SNAP } from './useBottomSheet';
import type { ResumenFiltros } from '../../utils/mapFilterSummary';

interface Props {
  resumen: ResumenFiltros;
  /** Cuántos reportes trajo la búsqueda. `undefined` mientras no haya respuesta. */
  resultCount: number | undefined;
  isLoading: boolean;
  children: ReactNode;
}

/**
 * El envoltorio del panel del mapa. **Una sola instancia en el DOM**, con dos
 * comportamientos según el ancho:
 *
 *  - **Celular:** hoja inferior arrastrable con tres puntos de anclaje. Se
 *    superpone al mapa en vez de empujarlo, así filtrar y ver moverse los pines
 *    es un solo gesto.
 *  - **Escritorio:** columna al costado que se colapsa a una barra angosta y le
 *    devuelve su ancho al mapa.
 *
 * Instancia única y no una por breakpoint: los dos árboles renderizarían dos
 * veces los mismos `id` (`map-type`, `map-from`, `map-to`), y un `id` duplicado
 * rompe la asociación de cada `<label>` con su campo.
 *
 * El estado COLAPSADO no puede confundirse con "sin filtros": tanto la barra de
 * peek como la columna colapsada muestran el resumen de lo que está aplicado.
 * Cerrar el panel no limpia nada.
 */
export function MapPanel({ resumen, resultCount, isLoading, children }: Props) {
  const { t } = useTranslation(['map']);
  const esHoja = useEsHoja();
  const [colapsado, setColapsado] = useState(false);
  const { snap, dragOffset, hojaRef, asaProps } = useBottomSheet(esHoja);

  // La transformación se aplica SÓLO en modo hoja. En escritorio el panel es un
  // elemento de la fila flex y trasladarlo lo despegaría del mapa.
  //
  // `useEsHoja` falla hacia `false` a propósito (ver su comentario): si la media
  // query no se puede evaluar, esto queda en `undefined` y el panel se comporta
  // como la columna fija que ya funcionaba. El modo que se pierde ante una falla
  // es el nuevo, nunca el que ya andaba.
  const desplazamiento = esHoja
    ? (dragOffset !== null ? `${dragOffset}px` : CSS_POR_SNAP[snap])
    : undefined;

  const resumenTexto = resumen.total === 0
    ? t('map:noFilters')
    : t('map:filtersActive', { count: resumen.total });

  return (
    <aside
      ref={hojaRef as React.RefObject<HTMLElement>}
      style={desplazamiento !== undefined ? { transform: `translateY(${desplazamiento})` } : undefined}
      className={[
        // Hoja: superpuesta al mapa, anclada abajo, por encima de los panes de
        // Leaflet. El contenedor padre es el `relative` de la fila.
        'absolute inset-x-0 bottom-0 z-20 h-[80%] rounded-t-2xl shadow-2xl flex flex-col',
        'bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700',
        // Sin transición mientras se arrastra, o la hoja va siempre atrás del dedo.
        dragOffset !== null ? 'transition-none' : 'transition-transform duration-200 ease-out',
        // Escritorio: vuelve a ser una columna del flex, sin transformar.
        'lg:static lg:h-auto lg:z-auto lg:rounded-none lg:shadow-none lg:translate-y-0',
        'lg:border-t-0 lg:border-r lg:shrink-0 lg:transition-[width] lg:duration-200',
        colapsado ? 'lg:w-14' : 'lg:w-80',
      ].join(' ')}
    >
      {/* ASA — sólo en modo hoja. Es un <button> y no un div: quien navega con
          teclado no puede arrastrar, y el click cicla peek → half → full. */}
      <button
        type="button"
        {...asaProps}
        aria-label={t('map:sheetToggle')}
        aria-expanded={snap !== 'peek'}
        className="lg:hidden w-full pt-2 pb-1 flex justify-center shrink-0 cursor-grab active:cursor-grabbing"
      >
        <span className="w-10 h-1.5 rounded-full bg-gray-300 dark:bg-gray-600" aria-hidden="true" />
      </button>

      {/* BARRA DE RESUMEN — lo único que se ve en `peek`, junto con el asa.
          Ese par tiene que entrar en PEEK_VISIBLE_PX, así que la barra está
          fijada a UNA SOLA LÍNEA: `whitespace-nowrap` en los dos textos y
          `truncate` en el que puede crecer. Si wrappeara, la barra pasaría de
          33 px a 66 y `peek` cortaría justo la información que existe para
          mostrar. El de la izquierda es corto y fijo, así que el que cede es el
          contador. */}
      <div className="lg:hidden shrink-0 px-4 pb-3 flex items-center justify-between gap-3 border-b border-gray-200 dark:border-gray-700">
        <span className="flex items-center gap-1.5 shrink-0 whitespace-nowrap text-sm font-semibold text-gray-700 dark:text-gray-300">
          <Icon name="filter-alt" className="text-base" />
          {resumenTexto}
        </span>
        <span className="min-w-0 truncate whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
          {isLoading
            ? t('map:loadingResults')
            : resultCount !== undefined
              ? t('map:reports', { count: resultCount })
              : ''}
        </span>
      </div>

      {/* COLUMNA COLAPSADA — sólo escritorio, y sólo cuando está colapsado.
          Muestra la MISMA información que la barra de peek, para que cerrar el
          panel no pueda hacerle perder de vista un filtro activo. */}
      <div className={colapsado ? 'hidden lg:flex flex-col items-center gap-3 py-3' : 'hidden'}>
        <button
          type="button"
          onClick={() => setColapsado(false)}
          aria-label={t('map:expandPanel')}
          aria-expanded={false}
          className="p-2 rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
        >
          <Icon name="chevron-right" className="text-xl" />
        </button>
        <span
          className="relative text-gray-500 dark:text-gray-400"
          title={resumenTexto}
        >
          <Icon name="filter-alt" className="text-xl" />
          {resumen.total > 0 && (
            <span className="absolute -top-1 -right-1.5 min-w-4 h-4 px-1 rounded-full bg-primary text-white text-[10px] font-bold flex items-center justify-center">
              {resumen.total}
            </span>
          )}
        </span>
        {/* El sr-only lleva el texto completo: los números sueltos de la columna
            no significan nada leídos en voz alta. */}
        <span className="sr-only">{resumenTexto}</span>
        {!isLoading && resultCount !== undefined && (
          <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">
            {resultCount}
            <span className="sr-only"> {t('map:reports', { count: resultCount })}</span>
          </span>
        )}
      </div>

      {/* CONTENIDO — el panel de filtros y la lista.
          `min-h-0` es obligatorio: sin él un hijo flex no baja de su altura de
          contenido y el `overflow-y-auto` nunca llega a scrollear.
          `overscroll-contain` evita que al llegar al final de la lista el gesto
          siga scrolleando la página de atrás. */}
      <div
        className={[
          'flex-1 min-h-0 overflow-y-auto overscroll-contain',
          colapsado ? 'lg:hidden' : '',
        ].join(' ')}
      >
        {/* El botón de colapsar vive dentro del contenido: si la media query
            fallara y `lg:` no aplicara, lo peor que pasa es que el panel no se
            pueda colapsar. Nunca que quede colapsado sin forma de abrirlo. */}
        <div className="hidden lg:flex justify-end px-2 pt-2">
          <button
            type="button"
            onClick={() => setColapsado(true)}
            aria-label={t('map:collapsePanel')}
            aria-expanded
            className="p-1.5 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <Icon name="chevron-left" className="text-xl" />
          </button>
        </div>
        {children}
      </div>
    </aside>
  );
}
