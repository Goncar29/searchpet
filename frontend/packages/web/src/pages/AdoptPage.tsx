import { Link } from 'react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cloudinaryCardThumb } from '@shared/utils/cloudinaryThumb';
import { useAdoptions } from '@shared/hooks';
import { statusBadgeBg } from '../utils/statusBadge';
import type { Pet, PetType } from '@shared/types';
import { Icon } from '../components/Icon';
import { PawPlaceholder } from '../components/PawPlaceholder';
import { ListState } from '../components/list/ListState';

const PET_TYPES: { value: PetType; labelKey: string; icon: string }[] = [
  { value: 'perro', labelKey: 'pets:types.perro', icon: '🐕' },
  { value: 'gato', labelKey: 'pets:types.gato', icon: '🐱' },
  { value: 'pajaro', labelKey: 'pets:types.pajaro', icon: '🐦' },
  { value: 'otro', labelKey: 'pets:types.otro', icon: '🐾' },
];

export function AdoptPage() {
  const { t } = useTranslation(['adoption', 'common', 'pets']);

  // ── Draft filters (what the user is editing — not yet applied) ──
  const [cityDraft, setCityDraft] = useState('');
  const [typeDraft, setTypeDraft] = useState<PetType | ''>('');

  // ── Applied filters (sent to the API — only updated on explicit Apply) ──
  const [applied, setApplied] = useState<{ city?: string; type?: PetType }>({});

  const applyFilters = () => {
    setApplied({
      city: cityDraft.trim() || undefined,
      type: typeDraft || undefined,
    });
  };

  const adoptionsQuery = useAdoptions({
    city: applied.city,
    type: applied.type,
  });

  // `undefined` y no `0` cuando no hay respuesta: el encabezado es una
  // AFIRMACION sobre cuantas mascotas hay, y con la query caida `?? 0` la
  // convertia en una mentira dibujada justo al lado del cartel que dice que no
  // pudimos leer nada. Vive fuera de la rama que envuelve `ListState`, asi que
  // el port no lo arregla solo.
  //
  // El `?.length ?? 0` de adentro NO es paranoia de mas: el codigo anterior
  // decia `data?.total ?? (data?.data ?? []).length` y ese `?? []` blindaba la
  // tajada interna. `ListState` se blinda igual contra un `data: null` (es JSON
  // valido, y la forma exacta de un slice `nil` de Go), pero ese guard cubre el
  // nivel de arriba y este contador lo esquiva por vivir afuera. Sin esto, el
  // render TIRA y deja en blanco la pantalla que todo esto viene a proteger.
  const count = adoptionsQuery.data
    ? (adoptionsQuery.data.total ?? (adoptionsQuery.data.data?.length ?? 0))
    : undefined;

  return (
    <div className="bg-gray-50 dark:bg-gray-950 min-h-screen">
      {/* Header */}
      <section className="bg-gradient-to-br from-primary to-primary-dark text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 text-center">
          <h1 className="font-display text-display-sm md:text-display mb-3">
            {t('adoption:section.title')}
          </h1>
          <p className="text-lg text-white/80 max-w-2xl mx-auto">
            {t('adoption:section.subtitle')}
          </p>
        </div>
      </section>

      {/* Filtros */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-800 p-5">
          {/* Barra de una fila en escritorio y apilada en celular. Los filtros
              siguen siendo ciudad y tipo: el diseño de Stitch dibuja ademas
              especie, edad, tamaño y genero, pero `useAdoptions` no los acepta
              y pintar un control que no filtra nada es peor que no tenerlo. */}
          <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
            {/* Ciudad */}
            <div className="relative flex-1">
              <Icon
                name="search"
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400 dark:text-gray-500"
              />
              <input
                type="text"
                placeholder={t('adoption:section.cityPlaceholder')}
                aria-label={t('adoption:section.cityFilter')}
                value={cityDraft}
                onChange={(e) => setCityDraft(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && applyFilters()}
                className="w-full border border-gray-200 dark:border-gray-700 rounded-xl pl-10 pr-4 py-2.5 text-sm bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              />
            </div>

            {/* Tipo */}
            <select
              value={typeDraft}
              onChange={(e) => setTypeDraft(e.target.value as PetType | '')}
              aria-label={t('adoption:section.typeFilter')}
              className="border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-2.5 text-sm bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            >
              <option value="">{t('adoption:section.allTypes')}</option>
              {PET_TYPES.map((pt) => (
                <option key={pt.value} value={pt.value}>{pt.icon} {t(pt.labelKey)}</option>
              ))}
            </select>

            {/* Aplicar */}
            <button
              onClick={applyFilters}
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-primary rounded-xl shadow-sm hover:bg-primary-dark transition-colors"
            >
              <Icon name="filter-alt" className="h-4 w-4" />
              {t('adoption:section.apply')}
            </button>
          </div>
        </div>
      </section>

      {/* Resultados */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-16">
        {/* Se oculta el encabezado entero y no solo su numero: un `<h2>` vacio
            es un encabezado sin nombre accesible, que para un lector de
            pantalla es peor que no tenerlo. */}
        {count !== undefined && (
          <div className="flex items-center justify-between mb-6">
            <h2 className="font-display text-headline text-gray-900 dark:text-gray-100">
              {t('adoption:section.resultCount', { count })}
            </h2>
          </div>
        )}

        <ListState
          query={adoptionsQuery}
          select={(res) => res.data}
          loading={
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {/* DOCE, que es el unico numero que llena filas completas en los tres
                anchos de la grilla: 2, 3 y 4 columnas. Antes decian ocho "porque
                la grilla llega a cuatro", y esa cuenta era falsa justo en el
                medio — a tres columnas ocho deja una fila de dos, que es la fila
                incompleta que se queria evitar. Y doce entra comodo en la pagina
                de 20 que devuelve la API.

                El esqueleto imita la tarjeta FILA POR FILA — nombre, metadatos,
                ciudad, dos lineas de descripcion y el "ver perfil" — porque su
                unico trabajo es ocupar el mismo alto que lo que viene despues.
                Cuando se le agregaron esas filas a la tarjeta y este bloque
                quedo igual, el esqueleto medía 274px contra 381px de la tarjeta
                real: 107px de salto por fila al llegar los datos, invisible en
                una captura y en cualquier test. Si mañana crece la tarjeta, esto
                crece con ella. */}
            {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((i) => (
              <div
                key={i}
                className="bg-white dark:bg-gray-900 rounded-2xl overflow-hidden shadow-sm border border-gray-100 dark:border-gray-800 animate-pulse"
              >
                <div className="h-48 bg-gray-100 dark:bg-gray-800"></div>
                <div className="p-4">
                  {/* nombre */}
                  <div className="h-7 w-2/3 bg-gray-100 dark:bg-gray-800 rounded"></div>
                  {/* metadatos */}
                  <div className="h-5 w-1/2 bg-gray-100 dark:bg-gray-800 rounded mt-0.5"></div>
                  {/* ciudad */}
                  <div className="h-5 w-1/3 bg-gray-100 dark:bg-gray-800 rounded mt-1"></div>
                  {/* descripcion: dos lineas, igual que el line-clamp-2 */}
                  <div className="h-10 w-full bg-gray-100 dark:bg-gray-800 rounded mt-2"></div>
                  {/* ver perfil */}
                  <div className="h-5 w-24 bg-gray-100 dark:bg-gray-800 rounded mt-3"></div>
                </div>
              </div>
            ))}
            </div>
          }
          empty={
            <div className="text-center py-12">
              <PawPlaceholder className="w-16 mx-auto mb-4" />
              <p className="text-gray-700 dark:text-gray-300 font-semibold mb-2">{t('adoption:section.empty')}</p>
            </div>
          }
        >
          {(pets) => (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {pets.map((pet: Pet) => (
              <Link key={pet.id} to={`/pets/${pet.id}`} className="block group">
                <div className="bg-white dark:bg-gray-900 rounded-2xl overflow-hidden shadow-sm border border-gray-100 dark:border-gray-800 hover:shadow-md transition-shadow">
                  {/* Foto */}
                  <div className="h-48 bg-gray-100 dark:bg-gray-800 relative overflow-hidden">
                    {pet.photos?.[0]?.url ? (
                      <img
                        src={cloudinaryCardThumb(pet.photos[0].url, 'adopt')}
                        loading="lazy"
                        alt={pet.name}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center"><PawPlaceholder className="w-2/5 max-w-20" /></div>
                    )}
                    <span className={`absolute top-3 left-3 text-xs font-bold text-white px-2 py-1 rounded-md ${statusBadgeBg(pet.status)}`}>
                      {t('pets:status.adoption').toUpperCase()}
                    </span>
                  </div>
                  {/* Info */}
                  <div className="p-4">
                    {/* El peso va explicito. `font-display` fija la FAMILIA, no el
                        peso, y el preflight de Tailwind v4 pone los h1-h6 en
                        `font-weight: inherit`, asi que cambiar `font-bold` por
                        `font-display` a secas dejaba el nombre en 400: el mismo
                        peso que la linea de metadatos de abajo, distinguiendose
                        solo por tamaño. Medido. Los tokens `text-headline` y
                        `text-display` si traen peso propio; `text-lg` no. */}
                    <h3 className="font-display text-lg font-semibold text-gray-900 dark:text-gray-100">
                      {pet.name}
                    </h3>

                    {/* Una linea de metadatos en vez de cuatro chips, como en el
                        diseño. Se conservan los mismos datos: tipo, raza y color
                        van juntos, y la ciudad baja a su propia linea con el
                        icono de ubicacion en lugar del emoji. */}
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5 min-h-[1.25rem]">
                      {[pet.type && t(`pets:types.${pet.type}`), pet.breed, pet.color]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>

                    <p className="flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400 mt-1 min-h-[1.25rem]">
                      {pet.city && (
                        <>
                          <Icon name="location-on" className="h-4 w-4 shrink-0" />
                          <span className="truncate">{pet.city}</span>
                        </>
                      )}
                    </p>

                    {/* Reserve the comment height (2 lines) and show a placeholder
                        when empty so every card stays the same height. */}
                    <p
                      className={`text-sm line-clamp-2 min-h-[2.5rem] mt-2 ${
                        pet.description
                          ? 'text-gray-500 dark:text-gray-400'
                          : 'italic text-gray-400 dark:text-gray-500'
                      }`}
                    >
                      {pet.description || t('pets:card.noComment')}
                    </p>

                    {/* Un <span>, no un <Link> ni un <button>: la tarjeta ENTERA
                        ya es el link, y anidar un interactivo dentro de otro es
                        HTML invalido y le da dos destinos al mismo destino a un
                        lector de pantalla. Esto es la senal visual del diseño;
                        lo clickeable sigue siendo toda la tarjeta. */}
                    <span className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-primary">
                      {t('adoption:section.viewProfile')}
                      <Icon name="chevron-right" className="h-4 w-4" />
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
          )}
        </ListState>
      </section>
    </div>
  );
}
