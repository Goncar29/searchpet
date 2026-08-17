import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useStats, useShelters, useMyShelter } from '@shared/hooks';
import type { Shelter } from '@shared/types';
import { Icon } from '../components/Icon';

export function SheltersPage() {
  const { t } = useTranslation(['shelters', 'common']);
  const { data: stats } = useStats();

  // ── Draft vs applied city ──
  // The draft is what the user is typing; only an explicit submit promotes it to
  // `applied`, which is the value the query actually keys on. Feeding the input
  // straight to `useShelters` would fire a request per keystroke.
  const [cityDraft, setCityDraft] = useState('');
  const [appliedCity, setAppliedCity] = useState<string | undefined>(undefined);

  // `useShelters(city)` already accepted this argument and reached the backend's
  // `?city=` (shelter_handler.go); the page just never passed anything.
  const { data: shelters, isLoading, isError } = useShelters(appliedCity);

  // Owner-aware CTA: has a shelter → manage it; otherwise → register.
  // A 404/401 (no shelter or logged out) leaves myShelter undefined.
  const { data: myShelter } = useMyShelter();
  const [detail, setDetail] = useState<Shelter | null>(null);

  const dialogRef = useRef<HTMLDivElement>(null);
  // Quien abrio el modal, para devolverle el foco al cerrarlo. Sin esto el foco
  // vuelve al <body> y el usuario de teclado reempieza desde el principio.
  const triggerRef = useRef<HTMLElement | null>(null);
  const dialogTitleId = useId();

  // `aria-modal="true"` le promete a un lector de pantalla que el resto de la
  // pagina esta inerte. Sin foco adentro, sin ciclo de Tab y sin Escape esa
  // promesa era falsa: medido, el foco quedaba en el boton "Ver mas" que queda
  // TAPADO por el modal, y cerrar con teclado obligaba a tabular por toda la
  // pagina hasta el boton "Cerrar". Un atributo que afirma un invariante no lo
  // vuelve cierto (regla #37).
  useEffect(() => {
    const panel = dialogRef.current;
    if (!detail || !panel) return;

    panel.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setDetail(null);
        return;
      }
      if (e.key !== 'Tab') return;

      const focusables = panel.querySelectorAll<HTMLElement>('a[href], button:not([disabled])');
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];

      // El panel mismo cuenta como "antes del primero": recibe el foco al abrir.
      if (e.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      triggerRef.current?.focus();
    };
  }, [detail]);

  const applyCity = () => setAppliedCity(cityDraft.trim() || undefined);
  const clearCity = () => {
    setCityDraft('');
    setAppliedCity(undefined);
  };

  const isEmpty = !isLoading && !isError && shelters && shelters.length === 0;

  return (
    <div className="bg-gray-50 dark:bg-gray-950 min-h-screen">
      {/* Encabezado */}
      <section className="bg-gradient-to-br from-primary to-primary-dark text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 text-center">
          <h1 className="font-display text-display-sm md:text-display mb-3">
            {t('shelters:title')}
          </h1>
          <p className="text-lg text-white/80 max-w-2xl mx-auto">
            {t('shelters:description')}
          </p>
        </div>
      </section>

      {/* Buscador por ciudad */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-800 p-5">
          {/* Un <form>, no un div con onClick: asi Enter envia sin que haya que
              cablear onKeyDown, y el boton hace de submit natural.

              El ancho va acotado y centrado porque es UN control, no la barra de
              tres que justifica el ancho completo en Adoptar: a 1280 sin tope el
              campo mide ~1030px para escribir el nombre de una ciudad. */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              applyCity();
            }}
            className="flex flex-col sm:flex-row gap-3 sm:items-center max-w-2xl mx-auto"
          >
            <div className="relative flex-1">
              <Icon
                name="location-on"
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400 dark:text-gray-500"
              />
              <input
                type="text"
                placeholder={t('shelters:searchPlaceholder')}
                aria-label={t('shelters:cityLabel')}
                value={cityDraft}
                onChange={(e) => setCityDraft(e.target.value)}
                className="w-full border border-gray-200 dark:border-gray-700 rounded-xl pl-10 pr-4 py-2.5 text-sm bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              />
            </div>

            <button
              type="submit"
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-primary rounded-xl shadow-sm hover:bg-primary-dark transition-colors"
            >
              <Icon name="search" className="h-4 w-4" />
              {t('shelters:searchButton')}
            </button>
          </form>
        </div>
      </section>

      {/* Impacto */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-gradient-to-r from-primary to-primary-dark rounded-2xl p-8 text-white mb-10">
          <h2 className="font-display text-headline mb-6 text-center">{t('shelters:impact')}</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="text-center">
              <p className="font-display text-display-sm">{stats?.pets_reunited || 0}</p>
              <p className="text-sm text-white/70">{t('shelters:impactFound')}</p>
            </div>
            <div className="text-center">
              <p className="font-display text-display-sm">{stats?.total_users || 0}</p>
              <p className="text-sm text-white/70">{t('shelters:impactUsers')}</p>
            </div>
            <div className="text-center">
              <p className="font-display text-display-sm">{stats?.searches_started || 0}</p>
              <p className="text-sm text-white/70">{t('shelters:impactReports')}</p>
            </div>
            <div className="text-center">
              <p className="font-display text-display-sm">{stats?.total_pets || 0}</p>
              <p className="text-sm text-white/70">{t('shelters:impactPets')}</p>
            </div>
          </div>
        </div>
      </section>

      {/* Directorio */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-16">
        {/* La salida del filtro vive acá y no dentro del vacío, porque una
            búsqueda CON resultados también hay que poder deshacerla. Estaba
            solo en el estado vacío: quien buscaba "Salto" y obtenía tres
            refugios no tenía forma de volver al directorio salvo deducir que
            había que borrar el campo y apretar Buscar de nuevo. Y el único
            indicio de que el filtro seguía puesto era el texto en el input. */}
        {appliedCity && (
          <div className="flex items-center gap-2 mb-6">
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 dark:bg-primary/20 px-3 py-1 text-sm font-semibold text-primary">
              <Icon name="location-on" className="h-4 w-4" />
              {appliedCity}
            </span>
            <button
              type="button"
              onClick={clearCity}
              className="text-sm font-semibold text-gray-500 dark:text-gray-400 hover:text-primary hover:underline"
            >
              {t('shelters:clearFilter')}
            </button>
          </div>
        )}

        {isLoading && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {/* SEIS, el unico numero que llena filas completas en los tres anchos
                de esta grilla: 1, 2 y 3 columnas.

                El esqueleto imita la tarjeta FILA POR FILA — nombre, ciudad,
                telefono, tres lineas de descripcion, "ver mas" y la fila de
                botones — porque su unico trabajo es ocupar el mismo alto que lo
                que viene despues. Cuando el esqueleto y la tarjeta divergen, el
                salto de layout al llegar los datos es invisible en una captura y
                en cualquier test (paso en el PR #161: 107px por fila). Si manana
                crece la tarjeta, esto crece con ella. */}
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-800 p-5 animate-pulse"
              >
                {/* nombre */}
                <div className="h-7 w-2/3 bg-gray-100 dark:bg-gray-800 rounded" />
                {/* ciudad */}
                <div className="h-5 w-1/2 bg-gray-100 dark:bg-gray-800 rounded mt-1" />
                {/* telefono */}
                <div className="h-5 w-1/3 bg-gray-100 dark:bg-gray-800 rounded mt-1" />
                {/* descripcion: tres lineas, igual que el line-clamp-3 */}
                <div className="h-[3.75rem] w-full bg-gray-100 dark:bg-gray-800 rounded mt-2" />
                {/* ver mas */}
                <div className="h-5 w-20 bg-gray-100 dark:bg-gray-800 rounded mt-2" />
                {/* botones */}
                <div className="flex gap-2 pt-4">
                  <div className="h-9 flex-1 bg-gray-100 dark:bg-gray-800 rounded-xl" />
                  <div className="h-9 flex-1 bg-gray-100 dark:bg-gray-800 rounded-xl" />
                </div>
              </div>
            ))}
          </div>
        )}

        {isError && (
          <div className="text-center py-12">
            <p className="text-red-500 dark:text-red-400">{t('common:error')}</p>
          </div>
        )}

        {/* Vacio. Buscar por ciudad crea un segundo estado vacio que el copy
            original describia mal: "no hay refugios disponibles" es cierto para
            el directorio entero y falso para "no hay ninguno en Salto". Y sin
            una salida, el usuario queda encerrado en su propio filtro. */}
        {isEmpty && (
          <div className="text-center py-12">
            {appliedCity ? (
              // La salida no se repite acá: el chip de arriba ya la ofrece, y
              // dos botones con el mismo nombre accesible es justo lo que este
              // PR corrigió en las tarjetas.
              <p className="text-gray-500 dark:text-gray-400">
                {t('shelters:emptyForCity', { city: appliedCity })}
              </p>
            ) : (
              <p className="text-gray-400 dark:text-gray-500">{t('shelters:empty')}</p>
            )}
          </div>
        )}

        {!isLoading && !isError && shelters && shelters.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {shelters.map((shelter) => (
              <article
                key={shelter.id}
                className="flex flex-col h-full bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-800 p-5 hover:shadow-md transition-shadow"
              >
                <div className="flex items-start justify-between gap-2">
                  {/* El peso va explicito: `font-display` fija la FAMILIA, no el
                      peso, y el preflight de Tailwind v4 pone los h1-h6 en
                      `font-weight: inherit`. Los tokens `text-headline` y
                      `text-display` si traen peso propio; `text-lg` no. */}
                  <h3 className="font-display text-lg font-semibold text-gray-900 dark:text-gray-100">
                    {shelter.name}
                  </h3>
                  {shelter.is_verified && (
                    <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-primary/10 dark:bg-primary/20 px-2 py-0.5 text-xs font-semibold text-primary">
                      <Icon name="check-circle" className="h-3.5 w-3.5" />
                      {t('shelters:verified')}
                    </span>
                  )}
                </div>

                <p className="flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400 mt-1">
                  <Icon name="location-on" className="h-4 w-4 shrink-0" />
                  <span className="truncate">{shelter.city}</span>
                </p>

                {/* La fila del telefono reserva su alto aunque el refugio no
                    tenga. Medido: con la reserva la descripcion arranca a 105px
                    del borde de la tarjeta, sin ella a 85px — 20px de
                    desalineacion contra las tarjetas vecinas que si tienen. */}
                <p className="flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400 mt-1 min-h-[1.25rem]">
                  {shelter.phone && (
                    <>
                      <Icon name="call" className="h-4 w-4 shrink-0" />
                      <a href={`tel:${shelter.phone}`} className="text-primary hover:underline">
                        {shelter.phone}
                      </a>
                    </>
                  )}
                </p>

                {shelter.description && (
                  <>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-2 line-clamp-3">
                      {shelter.description}
                    </p>
                    {/* El nombre visible se queda corto ("Ver mas"), pero el
                        accesible lleva el refugio. Con seis tarjetas habia seis
                        controles con el MISMO nombre accesible, y el contexto no
                        los desambigua: WCAG 2.4.4 admite como contexto la frase,
                        el parrafo, el item de lista, la celda o el encabezado que
                        envuelve al link — un <article> no esta en esa lista. Vale
                        igual para "Visitar web" y "Donar". */}
                    <button
                      type="button"
                      aria-label={t('shelters:seeMoreAria', { name: shelter.name })}
                      onClick={(e) => {
                        triggerRef.current = e.currentTarget;
                        setDetail(shelter);
                      }}
                      className="self-start mt-2 inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline"
                    >
                      {t('shelters:seeMore')}
                      <Icon name="chevron-right" className="h-4 w-4" />
                    </button>
                  </>
                )}

                {/* `mt-auto` con `h-full` en la tarjeta y el estirado por defecto
                    de la grilla: la fila de botones queda alineada entre las
                    tarjetas de una misma fila, tengan o no descripcion. */}
                <div className="mt-auto pt-4 flex gap-2">
                  {shelter.website_url && (
                    <a
                      href={shelter.website_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={t('shelters:visitWebAria', { name: shelter.name })}
                      className="flex-1 text-center text-sm font-semibold text-primary border border-primary py-2 rounded-xl hover:bg-primary/5 transition-colors"
                    >
                      {t('shelters:visitWeb')}
                    </a>
                  )}
                  {shelter.donation_url && (
                    <a
                      href={shelter.donation_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={t('shelters:donateAria', { name: shelter.name })}
                      className="flex-1 text-center text-sm font-semibold text-white bg-primary py-2 rounded-xl hover:bg-primary-dark transition-colors"
                    >
                      {t('shelters:donate')}
                    </a>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}

        {/* CTA. El diseno solo dibuja la mitad deslogueada; quien ya tiene un
            refugio tiene que llegar a gestionarlo, no a registrar otro. */}
        <div className="mt-12">
          {myShelter ? (
            <div className="text-center">
              <Link
                to="/shelters/mine"
                className="inline-block bg-primary text-white text-sm font-semibold px-6 py-2.5 rounded-xl hover:bg-primary-dark transition-colors"
              >
                {t('shelters:manageButton')}
              </Link>
            </div>
          ) : (
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm p-8 text-center">
              <h2 className="font-display text-headline text-gray-900 dark:text-gray-100 mb-2">
                {t('shelters:registerCta')}
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 max-w-xl mx-auto mb-6">
                {t('shelters:registerCtaBody')}
              </p>
              <Link
                to="/shelters/register"
                className="inline-block bg-primary text-white text-sm font-semibold px-6 py-2.5 rounded-xl hover:bg-primary-dark transition-colors"
              >
                {t('shelters:registerButton')}
              </Link>
            </div>
          )}
        </div>
      </section>

      {detail && (
        <div
          /* z-[60], por encima del `z-50` del navbar de MainLayout. Con z-30 el
             navbar quedaba PINTADO ARRIBA del modal: medido, `elementFromPoint`
             sobre la barra devolvia el nav, no la capa oscura, y un click en
             "Mapa" con el modal abierto navegaba. O sea que el `aria-modal` que
             se agrego recien seguia siendo falso por mouse aunque el foco ya
             estuviera atrapado por teclado. */
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 px-4"
          onClick={() => setDetail(null)}
        >
          {/* El `role="dialog"` va en el PANEL, no en el fondo: en el fondo, el
              contenido del dialogo para un lector de pantalla incluia la capa
              oscura entera. Y `aria-labelledby` lo nombra con el refugio, que es
              lo que un dialogo sin nombre no le decia a nadie. */}
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={dialogTitleId}
            tabIndex={-1}
            className="w-full max-w-lg rounded-2xl bg-white dark:bg-gray-900 p-6 max-h-[85vh] overflow-y-auto shadow-xl focus:outline-none"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-2 mb-1">
              <h3
                id={dialogTitleId}
                className="font-display text-headline text-gray-900 dark:text-gray-100"
              >
                {detail.name}
              </h3>
              {detail.is_verified && (
                <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-primary/10 dark:bg-primary/20 px-2 py-0.5 text-xs font-semibold text-primary">
                  <Icon name="check-circle" className="h-3.5 w-3.5" />
                  {t('shelters:verified')}
                </span>
              )}
            </div>

            <p className="flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400 mb-4">
              <Icon name="location-on" className="h-4 w-4 shrink-0" />
              {detail.city}
            </p>

            {detail.description && (
              <p className="text-sm text-gray-600 dark:text-gray-300 mb-5 whitespace-pre-line">
                {detail.description}
              </p>
            )}

            <div className="text-sm text-gray-500 dark:text-gray-400 space-y-2 mb-5">
              {detail.phone && (
                <p className="flex items-center gap-1">
                  <Icon name="call" className="h-4 w-4 shrink-0" />
                  <a href={`tel:${detail.phone}`} className="text-primary hover:underline">
                    {detail.phone}
                  </a>
                </p>
              )}
              {detail.email && (
                <p className="flex items-center gap-1">
                  <Icon name="mail" className="h-4 w-4 shrink-0" />
                  <a
                    href={`mailto:${detail.email}`}
                    className="text-primary hover:underline break-all"
                  >
                    {detail.email}
                  </a>
                </p>
              )}
            </div>

            {(detail.website_url || detail.donation_url) && (
              <div className="flex gap-2 mb-5">
                {detail.website_url && (
                  <a
                    href={detail.website_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 text-center text-sm font-semibold text-primary border border-primary py-2 rounded-xl hover:bg-primary/5 transition-colors"
                  >
                    {t('shelters:visitWeb')}
                  </a>
                )}
                {detail.donation_url && (
                  <a
                    href={detail.donation_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 text-center text-sm font-semibold text-white bg-primary py-2 rounded-xl hover:bg-primary-dark transition-colors"
                  >
                    {t('shelters:donate')}
                  </a>
                )}
              </div>
            )}

            <button
              type="button"
              onClick={() => setDetail(null)}
              className="w-full text-sm font-semibold text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700 py-2 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              {t('shelters:close')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
