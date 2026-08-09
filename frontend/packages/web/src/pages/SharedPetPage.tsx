import { useState } from 'react';
import { useParams, Link } from 'react-router';
import { Helmet } from 'react-helmet-async';
import { useTranslation } from 'react-i18next';
import { useSharedPet } from '@shared/hooks';
import { statusBadgeBg } from '../utils/statusBadge';
import { buildWhatsAppContactURL } from '@shared/utils/whatsappTemplates';
import { computePetAge } from '@shared/utils/petAge';
import { Logo } from '../components/Logo';
import { PawPlaceholder } from '../components/PawPlaceholder';
import { Icon } from '../components/Icon';

// La landing pública: lo que ve alguien que recibió el link por WhatsApp y NO
// tiene la app. Es la pantalla con más desconocidos por visita de todo el
// proyecto, y su único trabajo es que esa persona reconozca al animal y sepa
// cómo avisar.
//
// Sigue el diseño de Stitch "Landing Pública - Mascota Perdida", que resuelve
// dos cosas que la versión anterior no hacía:
//
//  - Las señas van como CHIPS, no como una tabla de etiqueta/valor. Se leen de
//    un vistazo, que es lo que hace alguien parado en la vereda con el celular.
//  - El sexo y la edad van en UN SOLO chip ("Macho, 3 años"). Separarlos suma
//    ruido a una pantalla cuyo trabajo es identificar rápido, y combinado
//    aguanta que se sepa sólo uno de los dos.
//
// Y trae modo oscuro, que esta pantalla NO TENÍA: no había una sola clase
// `dark:` en el archivo. Quien abría un aviso con el sistema en oscuro recibía
// una pantalla blanca de golpe.

export function SharedPetPage() {
  const { t } = useTranslation(['sharedPet', 'pets']);
  const { token } = useParams<{ token: string }>();
  const { data, isLoading } = useSharedPet(token || '');
  const [activePhoto, setActivePhoto] = useState(0);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center">
        <div className="animate-spin h-10 w-10 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center px-4">
        <div className="text-center">
          <p className="text-6xl mb-4">🔍</p>
          <h1 className="font-display text-headline text-gray-900 dark:text-gray-100 mb-2">
            {t('sharedPet:notFoundTitle')}
          </h1>
          <p className="text-gray-500 dark:text-gray-400">{t('sharedPet:notFoundSubtitle')}</p>
        </div>
      </div>
    );
  }

  const pet = data.pet;
  const owner = data.owner;
  const photos = pet.photos ?? [];
  // La primaria manda, y el resto conserva su orden. Sin esto la galería
  // arrancaría por una foto cualquiera según el orden del heap de Postgres.
  const ordered = [...photos].sort((a, b) => Number(b.is_primary) - Number(a.is_primary));
  const current = ordered[Math.min(activePhoto, ordered.length - 1)];

  const statusLabel = pet.status === 'found' ? t('pets:card.found') : t('pets:card.lost');
  const statusBg = statusBadgeBg(pet.status);

  const age = computePetAge(pet.birth_date, pet.birth_date_precision);
  const ageText = age
    ? (() => {
        const base = t(`pets:age.${age.unit}s`, { count: age.value });
        return age.approximate ? t('pets:age.approximate', { age: base }) : base;
      })()
    : '';
  const genderText = pet.gender && pet.gender !== 'unknown' ? t(`pets:genders.${pet.gender}`) : '';
  // Sexo y edad en UN chip. Si falta uno, va el otro solo; si faltan los dos,
  // el chip no existe (filter de abajo) en vez de dejar una píldora vacía.
  const identityChip = [genderText, ageText].filter(Boolean).join(', ');

  const chips = [
    // El tipo se TRADUCE. Antes salía `{pet.type}` crudo, así que decía "perro"
    // en minúscula aunque la app estuviera en inglés — el mismo defecto que se
    // arregló en CreateReportPage.
    pet.type && t(`pets:types.${pet.type}`),
    pet.breed,
    pet.color,
    identityChip,
  ].filter(Boolean) as string[];

  const pageTitle =
    pet.status === 'found'
      ? t('sharedPet:seoTitleFound', { name: pet.name })
      : t('sharedPet:seoTitleLost', { name: pet.name });
  const ogDescription = pet.description
    ? pet.description.slice(0, 160) + (pet.description.length > 160 ? '...' : '')
    : t('sharedPet:seoDescriptionFallback', { name: pet.name });
  const shareUrl = `${window.location.origin}/pet/${token}`;

  const whatsappUrl = owner?.phone
    ? buildWhatsAppContactURL(owner.phone, { ...pet, status: pet.status }, shareUrl)
    : null;

  return (
    <>
      <Helmet>
        <title>{pageTitle}</title>
        <meta property="og:title" content={pageTitle} />
        <meta property="og:description" content={ogDescription} />
        {current?.url && <meta property="og:image" content={current.url} />}
        <meta property="og:url" content={shareUrl} />
        <meta property="og:type" content="website" />
      </Helmet>

      <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
        <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 py-4">
          <div className="max-w-5xl mx-auto px-4 sm:px-6">
            <Link to="/" className="inline-flex items-center gap-2 hover:opacity-80 transition-opacity">
              <Logo className="h-7 w-7 text-primary" />
              <span className="text-xl font-brand font-semibold tracking-tight text-gray-900 dark:text-gray-100">
                Search<span className="text-primary">Pet</span>
              </span>
            </Link>
          </div>
        </header>

        <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:gap-10">
            {/* Galería */}
            <section aria-label={t('sharedPet:gallery')}>
              <div className="relative rounded-2xl overflow-hidden bg-gray-100 dark:bg-gray-800 aspect-[4/3]">
                {/* El badge flota SOBRE la foto, como en el diseño: la barra de
                    ancho completo que había antes empujaba la imagen hacia
                    abajo y le robaba lo primero que se ve. */}
                <span
                  className={`absolute z-10 top-3 left-3 ${statusBg} text-white text-xs font-bold uppercase tracking-wider px-3 py-1.5 rounded-full inline-flex items-center gap-1.5`}
                >
                  <Icon name="warning" className="h-3.5 w-3.5" />
                  {statusLabel}
                </span>

                {current ? (
                  <img
                    src={current.url}
                    alt={t('sharedPet:photoOf', {
                      n: activePhoto + 1,
                      total: ordered.length,
                      name: pet.name,
                    })}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <PawPlaceholder className="w-2/5 max-w-28" />
                  </div>
                )}
              </div>

              {/* Tres columnas, no cuatro: el backend limita a 3 fotos por
                  mascota (ErrPhotoLimitReached), así que una cuarta celda NUNCA
                  se puede llenar y deja un hueco permanente a la derecha. Se ve
                  en cuanto la mascota tiene fotos de verdad. */}
              {ordered.length > 1 && (
                <ul className="mt-3 grid grid-cols-3 gap-2 sm:gap-3">
                  {ordered.map((photo, i) => (
                    <li key={photo.id}>
                      <button
                        type="button"
                        onClick={() => setActivePhoto(i)}
                        aria-current={i === activePhoto}
                        aria-label={t('sharedPet:photoOf', {
                          n: i + 1,
                          total: ordered.length,
                          name: pet.name,
                        })}
                        className={`block w-full aspect-square rounded-xl overflow-hidden ring-2 transition-all focus:outline-none focus-visible:ring-4 focus-visible:ring-primary/40 ${
                          i === activePhoto
                            ? 'ring-primary'
                            : 'ring-transparent hover:ring-gray-300 dark:hover:ring-gray-600'
                        }`}
                      >
                        <img src={photo.url} alt="" className="w-full h-full object-cover" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Info */}
            <section className="min-w-0">
              <h1 className="font-display text-display-sm break-words text-gray-900 dark:text-gray-50">
                {pet.name}
              </h1>

              {chips.length > 0 && (
                <ul className="mt-4 flex flex-wrap gap-2">
                  {chips.map((chip) => (
                    <li
                      key={chip}
                      className="rounded-full bg-gray-100 dark:bg-gray-800 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-200"
                    >
                      {chip}
                    </li>
                  ))}
                </ul>
              )}

              {pet.description && (
                <div className="mt-6 rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
                  <h2 className="font-display text-headline text-gray-900 dark:text-gray-100">
                    {t('sharedPet:about', { name: pet.name })}
                  </h2>
                  {/* break-words no es prolijidad: la descripción es texto libre
                      y una palabra larga sin cortar desborda el contenedor. */}
                  <p className="mt-2 text-gray-600 dark:text-gray-300 leading-relaxed break-words whitespace-pre-line">
                    {pet.description}
                  </p>
                </div>
              )}

              {owner?.name && (
                <div className="mt-4 rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 p-5 flex items-center gap-3">
                  <span className="h-11 w-11 shrink-0 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-gray-500 dark:text-gray-400">
                    <Icon name="person" className="h-6 w-6" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                      {t('sharedPet:ownerLooking')}
                    </span>
                    <span className="block font-semibold text-gray-900 dark:text-gray-100 break-words">
                      {owner.name}
                    </span>
                  </span>
                </div>
              )}

              <div className="mt-6 space-y-3">
                {whatsappUrl && (
                  <a
                    href={whatsappUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#25D366] py-4 font-bold text-white transition-opacity hover:opacity-90"
                  >
                    <Icon name="whatsapp" className="h-5 w-5" />
                    {t('sharedPet:contactOwner')}
                  </a>
                )}

                <div className="rounded-2xl bg-primary/5 dark:bg-primary/10 p-5 text-center">
                  <p className="text-sm text-gray-600 dark:text-gray-300">{t('sharedPet:helpTitle')}</p>
                  <Link
                    to="/"
                    className="mt-3 block w-full rounded-xl bg-primary py-3 font-bold text-white transition-colors hover:bg-primary-dark"
                  >
                    {t('sharedPet:exploreApp')}
                  </Link>
                  <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
                    {t('sharedPet:or')}{' '}
                    <Link to="/download" className="font-semibold text-primary hover:text-primary-dark">
                      {t('sharedPet:downloadApp')}
                    </Link>
                  </p>
                </div>

                {data.view_count > 0 && (
                  <p className="pt-1 text-center text-xs text-gray-500 dark:text-gray-400">
                    {t('sharedPet:views', { count: data.view_count })}
                  </p>
                )}
              </div>
            </section>
          </div>
        </main>
      </div>
    </>
  );
}
