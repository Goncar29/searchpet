import { useParams, Link } from 'react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  usePublicProfile,
  useUserPets,
  useUserReviews,
  useCreateReview,
  useUpdateReview,
  useDeleteReview,
  useBlockUser,
  useBlockedUsers,
  useUnblockUser,
  useSubmitAbuseReport,
} from '@shared/hooks';
import type { Badge, Pet, UserReview, AbuseReason } from '@shared/types';
import { BADGE_META } from '@shared/types';
import { ListState } from '../components/list/ListState';
import { PawPlaceholder } from '../components/PawPlaceholder';
import { Icon } from '../components/Icon';
import { useAuth } from '../context/AuthContext';
import { getErrorMessage } from '@shared/utils/apiErrors';
import { cloudinaryThumb, cloudinaryCardThumb } from '@shared/utils/cloudinaryThumb';
import { splitOwnedPets } from '@shared/utils/ownedPetBuckets';
import { statusBadgeBg } from '../utils/statusBadge';

const BADGE_COLOR: Record<string, string> = {
  first_helper: 'bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300',
  pet_rescuer: 'bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800 text-green-700 dark:text-green-300',
  social_butterfly: 'bg-purple-50 dark:bg-purple-950 border-purple-200 dark:border-purple-800 text-purple-700 dark:text-purple-300',
  verified_finder: 'bg-orange-50 dark:bg-orange-950 border-orange-200 dark:border-orange-800 text-orange-700 dark:text-orange-300',
};
const DEFAULT_BADGE_COLOR = 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300';

const CARD = 'bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-800 p-6';

function BadgeCard({ badge }: { badge: Badge }) {
  const { t } = useTranslation('badges');
  const meta = BADGE_META[badge.badge_type] ?? {
    emoji: '🏅',
    labelKey: badge.badge_type,
    descriptionKey: '',
  };
  const color = BADGE_COLOR[badge.badge_type] ?? DEFAULT_BADGE_COLOR;

  return (
    <div className={`flex items-start gap-3 p-3 rounded-xl border ${color}`}>
      <span className="text-2xl flex-shrink-0">{meta.emoji}</span>
      <div>
        <p className="text-sm font-semibold">{t(meta.labelKey)}</p>
        {meta.descriptionKey && (
          <p className="text-xs opacity-75 mt-0.5">{t(meta.descriptionKey)}</p>
        )}
        <p className="text-xs opacity-50 mt-1">
          {new Date(badge.earned_at).toLocaleDateString('es-UY', { day: 'numeric', month: 'short', year: 'numeric' })}
        </p>
      </div>
    </div>
  );
}

function StarDisplay({ stars, size = 'text-sm' }: { stars: number; size?: string }) {
  return (
    <span className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={`${size} ${i <= stars ? 'text-yellow-400' : 'text-gray-300 dark:text-gray-600'}`}>
          ★
        </span>
      ))}
    </span>
  );
}

function StarSelector({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <span className="flex gap-1">
      {[1, 2, 3, 4, 5].map((i) => (
        <button
          key={i}
          type="button"
          onClick={() => onChange(i)}
          className={`text-3xl leading-none transition-colors ${i <= value ? 'text-yellow-400' : 'text-gray-300 dark:text-gray-600 hover:text-yellow-300'}`}
        >
          ★
        </button>
      ))}
    </span>
  );
}

/**
 * Tarjeta de mascota del perfil público.
 *
 * Vive acá y no en un componente compartido porque `PetCardWeb` se borró como
 * código muerto y cada pantalla dibuja la suya: espeja la de `AdoptPage`.
 */
function ProfilePetCard({ pet }: { pet: Pet }) {
  const { t } = useTranslation(['pets']);

  return (
    <Link to={`/pets/${pet.id}`} className="block group">
      <div className="bg-white dark:bg-gray-900 rounded-2xl overflow-hidden shadow-sm border border-gray-100 dark:border-gray-800 hover:shadow-md transition-shadow">
        <div className="h-48 bg-gray-100 dark:bg-gray-800 relative overflow-hidden">
          {pet.photos?.[0]?.url ? (
            <img
              // Variante `feed` y no `adopt`, MEDIDO: esta grilla es de 2
              // columnas dentro de una columna de ~789px, o sea tarjetas de
              // ~376px — casi el doble que las ~280px de Adoptar, que por eso
              // pide 450. `feed` es [600, 300] y además calza el 2:1 de `h-48`.
              src={cloudinaryCardThumb(pet.photos[0].url, 'feed')}
              loading="lazy"
              alt={pet.name}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <PawPlaceholder className="w-2/5 max-w-20" />
            </div>
          )}
          {/* La etiqueta SIEMPRE sale de `pets:status.<status>`: esta grilla
              mezcla estados (perdida, callejera, encontrada), así que un texto
              fijo mentiría en la mayoría de las tarjetas. */}
          <span className={`absolute top-3 left-3 text-xs font-bold text-white px-2 py-1 rounded-md ${statusBadgeBg(pet.status)}`}>
            {t(`pets:status.${pet.status}`).toUpperCase()}
          </span>
        </div>
        <div className="p-4">
          <h3 className="font-display text-lg font-semibold text-gray-900 dark:text-gray-100">{pet.name}</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5 min-h-[1.25rem]">
            {[pet.type && t(`pets:types.${pet.type}`), pet.breed, pet.color].filter(Boolean).join(' · ')}
          </p>
          <p className="flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400 mt-1 min-h-[1.25rem]">
            {pet.city && (
              <>
                <Icon name="location-on" className="h-4 w-4 shrink-0" />
                <span className="truncate">{pet.city}</span>
              </>
            )}
          </p>
        </div>
      </div>
    </Link>
  );
}

function PetGridSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {[0, 1].map((i) => (
        <div
          key={i}
          className="bg-white dark:bg-gray-900 rounded-2xl overflow-hidden shadow-sm border border-gray-100 dark:border-gray-800 animate-pulse"
        >
          <div className="h-48 bg-gray-100 dark:bg-gray-800" />
          <div className="p-4">
            <div className="h-7 w-2/3 bg-gray-100 dark:bg-gray-800 rounded" />
            <div className="h-5 w-1/2 bg-gray-100 dark:bg-gray-800 rounded mt-0.5" />
            <div className="h-5 w-1/3 bg-gray-100 dark:bg-gray-800 rounded mt-1" />
          </div>
        </div>
      ))}
    </div>
  );
}

function ReviewCard({ review, onDelete }: { review: UserReview; onDelete?: () => void }) {
  const { t } = useTranslation(['profile']);
  const initials = review.reviewer_name.trim().charAt(0).toUpperCase();
  const date = new Date(review.created_at).toLocaleDateString('es-UY', {
    day: 'numeric', month: 'short', year: 'numeric',
  });

  return (
    <div className="flex gap-3 py-4 border-b border-gray-100 dark:border-gray-800 last:border-0">
      {review.reviewer_photo ? (
        <img
          src={cloudinaryThumb(review.reviewer_photo, 96)}
          loading="lazy"
          alt={review.reviewer_name}
          className="w-9 h-9 rounded-full object-cover flex-shrink-0"
        />
      ) : (
        <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary flex-shrink-0">
          {initials}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold text-gray-900 dark:text-gray-50 truncate">
            {review.reviewer_name}
          </span>
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className="text-xs text-gray-400 dark:text-gray-500">{date}</span>
            {onDelete && (
              <button
                type="button"
                onClick={onDelete}
                className="text-xs text-red-500 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 font-medium transition-colors"
              >
                {t('profile:public.deleteReview')}
              </button>
            )}
          </div>
        </div>
        <StarDisplay stars={review.stars} />
        {review.text && (
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1 leading-relaxed">{review.text}</p>
        )}
      </div>
    </div>
  );
}

export function UserProfilePage() {
  const { id } = useParams<{ id: string }>();
  // Los namespaces van DECLARADOS y no confiados a los recursos precargados:
  // si algún día `profile` dejara de estar registrado, el modo de falla es una
  // clave cruda en pantalla que ningún test ve — acá `t` está mockeado.
  const { t } = useTranslation(['profile', 'common', 'badges', 'pets']);
  const { user, isAuthenticated } = useAuth();
  const { data: profile, isLoading, error } = usePublicProfile(id ?? '');
  const petsQuery = useUserPets(id ?? '');
  const reviewsQuery = useUserReviews(id ?? '');

  const [showForm, setShowForm] = useState(false);
  const [formStars, setFormStars] = useState(0);
  const [formText, setFormText] = useState('');
  const [formError, setFormError] = useState('');
  const [showReportMenu, setShowReportMenu] = useState(false);
  const [reportSuccess, setReportSuccess] = useState(false);

  const createReview = useCreateReview(id ?? '');
  const updateReview = useUpdateReview(id ?? '');
  const deleteReview = useDeleteReview();
  const blockUser = useBlockUser();
  const unblockUser = useUnblockUser();
  const submitAbuseReport = useSubmitAbuseReport();
  const { data: blockedList } = useBlockedUsers();

  const isOwnProfile = !!user && user.id === id;
  const canReview = isAuthenticated && !isOwnProfile;
  const isBlockedByMe = blockedList?.some((b) => b.blocked_id === id) ?? false;

  const handleBlockToggle = () => {
    const name = profile?.name ?? '';
    if (isBlockedByMe) {
      if (!window.confirm(t('profile:public.confirmUnblock', { name }))) return;
      unblockUser.mutate(id ?? '');
    } else {
      if (!window.confirm(t('profile:public.confirmBlock', { name }))) return;
      blockUser.mutate({ userId: id ?? '' });
    }
  };

  const handleReport = (reason: AbuseReason) => {
    submitAbuseReport.mutate(
      { target_user_id: id ?? '', reason },
      {
        onSuccess: () => {
          setShowReportMenu(false);
          setReportSuccess(true);
          setTimeout(() => setReportSuccess(false), 4000);
        },
        onError: () => {
          // keep menu open so user can retry
        },
      },
    );
  };

  // `myReview` decide si el formulario edita o crea, y vive FUERA de la rama que
  // envuelve `ListState`, así que el guard de la primitiva no lo alcanza. Con la
  // query caída queda `undefined` y el formulario ofrece publicar — que es
  // exactamente lo que hacía antes. No es una mentira sobre la lista (el cartel
  // de abajo dice que no se pudo leer), y bloquear el formulario mientras no se
  // sepa es otra decisión, no un porte.
  //
  // Los `?.` reemplazan al `?? []` que había: no hace falta un array vacío para
  // buscar dentro de datos que no llegaron. Van **dos**, y el segundo importa:
  // `ListState` blinda `query.data` Y el retorno de `select` contra `null`
  // justo porque es el único choke point que ven las 12 pantallas portadas,
  // pero esta línea vive AFUERA. Con un solo `?.`, un cuerpo `{"reviews": null}`
  // tira acá en pleno render y deja la pantalla en blanco vía `ErrorBoundary`:
  // la falla exacta que este trabajo existe para evitar, reintroducida por el
  // borrado de la única defensa que había en este punto.
  const myReview = canReview
    ? reviewsQuery.data?.reviews?.find((r) => r.reviewer_id === user?.id)
    : undefined;

  // El aviso de lista recortada. Los DOS números salen del mismo sobre y
  // describen el mismo conjunto —todo lo que esta persona publicó y no cerró—:
  // `mostradas` cuenta las filas que el endpoint devolvió (las que se dibujan
  // entre "Publicaciones" y "En adopción") y `total` es el conteo real sin
  // tope. NO se compara contra el largo de una sola sección: el total del
  // header incluye las de adopción, así que emparejarlo con el recorte de
  // "Publicaciones" afirmaría una resta que nadie calculó.
  //
  // Con la query caída `petsQuery.data` es `null`, los dos quedan en 0 y el
  // aviso no se dibuja: no afirma nada sobre una lista que no se pudo leer.
  const petsShown = petsQuery.data?.data.length ?? 0;
  const petsTotal = petsQuery.data?.total ?? 0;
  const petsTruncated = petsTotal > petsShown;

  const handleOpenForm = () => {
    setFormError('');
    if (myReview) {
      setFormStars(myReview.stars);
      setFormText(myReview.text);
    } else {
      setFormStars(0);
      setFormText('');
    }
    setShowForm(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    if (formStars < 1 || formStars > 5) {
      setFormError(t('profile:public.starsRequired'));
      return;
    }
    if (!formText.trim()) {
      setFormError(t('profile:public.textRequired'));
      return;
    }
    const payload = { stars: formStars, text: formText.trim() };
    const action = myReview ? updateReview : createReview;
    action.mutate(payload, {
      onSuccess: () => {
        setShowForm(false);
        setFormStars(0);
        setFormText('');
      },
      onError: (err) => {
        setFormError(getErrorMessage(err, t));
      },
    });
  };

  if (isLoading) {
    return (
      <div className="bg-gray-50 dark:bg-gray-950 min-h-screen">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-1 space-y-6">
              <div className="h-72 rounded-2xl bg-gray-200 dark:bg-gray-800 animate-pulse" />
              <div className="h-48 rounded-2xl bg-gray-200 dark:bg-gray-800 animate-pulse" />
            </div>
            <div className="lg:col-span-2 space-y-8">
              <div className="h-64 rounded-2xl bg-gray-200 dark:bg-gray-800 animate-pulse" />
              <div className="h-48 rounded-2xl bg-gray-200 dark:bg-gray-800 animate-pulse" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center px-4">
        <div className="text-center">
          <PawPlaceholder className="w-16 mx-auto mb-4" />
          <h2 className="font-display text-xl font-semibold text-gray-900 dark:text-gray-50 mb-2">
            {t('profile:public.notFound')}
          </h2>
          <p className="text-gray-500 dark:text-gray-400 text-sm mb-6">
            {t('profile:public.notFoundHint')}
          </p>
          <Link
            to="/"
            className="inline-block px-5 py-2 bg-primary hover:bg-primary-dark text-white font-semibold rounded-lg text-sm transition-colors"
          >
            {t('profile:public.backHome')}
          </Link>
        </div>
      </div>
    );
  }

  const stats = [
    { value: profile.total_points, label: t('profile:public.points') },
    { value: profile.total_reports, label: t('profile:public.reports') },
    { value: profile.found_count, label: t('profile:public.reunited') },
    { value: profile.share_count, label: t('profile:public.shared') },
  ];

  return (
    <div className="bg-gray-50 dark:bg-gray-950 min-h-screen">
      {/* Sin banda de encabezado: el nombre de la persona ya es el encabezado,
          igual que en ProfilePage. */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* ── Columna izquierda: quién es ── */}
          <aside className="lg:col-span-1 space-y-6">
            {/* Identidad. SIN filas de contacto: el email es privado y no viaja
                en ningún DTO público, y el teléfono tampoco lo expone este
                endpoint — no es una omisión de diseño, es el contrato. */}
            <section className={CARD}>
              <div className="flex flex-col items-center text-center">
                {profile.profile_photo_url ? (
                  <img
                    src={cloudinaryThumb(profile.profile_photo_url, 224)}
                    alt=""
                    className="h-28 w-28 rounded-full object-cover ring-4 ring-primary/20"
                  />
                ) : (
                  <div className="h-28 w-28 rounded-full bg-primary/10 dark:bg-primary/20 ring-4 ring-primary/20 flex items-center justify-center font-display text-4xl font-bold text-primary">
                    {profile.name.charAt(0).toUpperCase()}
                  </div>
                )}

                <h1 className="font-display text-headline font-semibold text-gray-900 dark:text-gray-100 mt-4 break-words">
                  {profile.name}
                </h1>

                {profile.city && (
                  <p className="flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400 mt-1">
                    <Icon name="location-on" className="h-4 w-4 shrink-0" />
                    <span className="break-words">{profile.city}</span>
                  </p>
                )}
              </div>

              {/* Denunciar / Bloquear — sólo para una sesión ajena. */}
              {isAuthenticated && !isOwnProfile && (
                <div className="mt-5 pt-4 border-t border-gray-100 dark:border-gray-800 space-y-2">
                  <div className="flex flex-wrap justify-center gap-2">
                    <button
                      type="button"
                      onClick={() => { setShowReportMenu((v) => !v); setReportSuccess(false); }}
                      disabled={submitAbuseReport.isPending}
                      aria-expanded={showReportMenu}
                      className="text-sm font-semibold px-4 py-2 rounded-lg border border-orange-300 dark:border-orange-700 text-orange-600 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-950 transition-colors disabled:opacity-60"
                    >
                      {submitAbuseReport.isPending
                        ? t('profile:public.reporting')
                        : t('profile:public.report')}
                    </button>
                    <button
                      type="button"
                      onClick={handleBlockToggle}
                      disabled={blockUser.isPending || unblockUser.isPending}
                      className={`text-sm font-semibold px-4 py-2 rounded-lg border transition-colors disabled:opacity-60 ${
                        isBlockedByMe
                          ? 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                          : 'border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950'
                      }`}
                    >
                      {blockUser.isPending || unblockUser.isPending
                        ? t('profile:public.processing')
                        : isBlockedByMe
                          ? t('profile:public.unblock')
                          : t('profile:public.block')}
                    </button>
                  </div>

                  {/* Motivo de la denuncia */}
                  {showReportMenu && (
                    <div className="flex flex-col gap-1 p-3 bg-orange-50 dark:bg-orange-950 rounded-xl border border-orange-200 dark:border-orange-800">
                      <p className="text-xs font-semibold text-orange-700 dark:text-orange-300 mb-1">
                        {t('profile:public.reportReason')}
                      </p>
                      {(['spam', 'fake', 'abuse', 'inappropriate', 'other'] as AbuseReason[]).map((reason) => (
                        <button
                          key={reason}
                          type="button"
                          onClick={() => handleReport(reason)}
                          disabled={submitAbuseReport.isPending}
                          className="text-left text-sm px-3 py-1.5 rounded-lg hover:bg-orange-100 dark:hover:bg-orange-900 text-orange-800 dark:text-orange-200 disabled:opacity-60 transition-colors"
                        >
                          {t(`profile:public.reasons.${reason}`)}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => setShowReportMenu(false)}
                        className="text-left text-xs px-3 py-1 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-400 transition-colors mt-1"
                      >
                        {t('common:cancel')}
                      </button>
                    </div>
                  )}

                  {reportSuccess && (
                    <p className="text-xs text-green-600 dark:text-green-400 text-center font-medium">
                      {t('profile:public.reportSent')}
                    </p>
                  )}
                </div>
              )}
            </section>

            {/* Actividad */}
            <section className={CARD}>
              <h2 className="font-display text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
                {t('profile:public.activity')}
              </h2>
              <div className="grid grid-cols-2 gap-3">
                {stats.map((stat) => (
                  <div key={stat.label} className="rounded-xl bg-primary/5 dark:bg-primary/10 p-4 text-center">
                    <p className="text-2xl font-bold text-primary">{stat.value}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{stat.label}</p>
                  </div>
                ))}
              </div>
            </section>

            {/* Logros — SÓLO los que ganó. `ProfilePage` también dibuja los que
                faltan en gris, pero ese texto es motivacional para el dueño
                ("Verificá tu identidad"): a un tercero le anunciaría lo que esta
                persona NO logró.

                Nada de `hidden sm:*` acá — con esa forma la sección entera
                desaparecía por debajo de 640px, o sea justo en un teléfono.
                `grid-cols-1 sm:grid-cols-2` degrada bien. */}
            <section className={CARD}>
              <h2 className="font-display text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
                {t('profile:public.achievements')} ({profile.badges.length})
              </h2>
              {profile.badges.length === 0 ? (
                <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-4">
                  {t('profile:public.noAchievements')}
                </p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {profile.badges.map((badge: Badge) => (
                    <BadgeCard key={badge.id} badge={badge} />
                  ))}
                </div>
              )}
            </section>
          </aside>

          {/* ── Columna derecha: qué publicó ── */}
          <div className="lg:col-span-2 space-y-8">
            {/* A. Publicaciones */}
            <section>
              <h2 className="font-display text-headline font-semibold text-gray-900 dark:text-gray-100 mb-4">
                {t('profile:public.posts')}
              </h2>
              <ListState
                query={petsQuery}
                // El sobre es `{data, total}`: hay que atravesar `.data` ANTES
                // de partir en baldes.
                select={(paged) => splitOwnedPets(paged.data).owned}
                errorTitle={t('profile:public.postsError')}
                loading={<PetGridSkeleton />}
                empty={
                  <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 text-center py-12 px-6">
                    <PawPlaceholder className="w-16 mx-auto mb-4" />
                    <p className="text-gray-700 dark:text-gray-300 font-semibold">
                      {t('profile:public.postsEmpty')}
                    </p>
                  </div>
                }
              >
                {(pets) => (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {pets.map((pet: Pet) => (
                      <ProfilePetCard key={pet.id} pet={pet} />
                    ))}
                  </div>
                )}
              </ListState>
            </section>

            {/* B. En adopción — la sección entera desaparece cuando no hay nada
                (`empty={<></>}`) y su encabezado vive DENTRO de los children.

                El `petsQuery.data != null` de afuera es lo que le saca el cartel
                de error propio: sale de la MISMA query que "Publicaciones", que
                siempre se dibuja y por lo tanto ya carga el aviso cuando esa
                query falla. Un segundo cartel sería el mismo fallo dicho dos
                veces en la misma columna. Sin datos no se dibuja nada, que no
                afirma nada. */}
            {petsQuery.data != null && (
              <ListState
                query={petsQuery}
                select={(paged) => splitOwnedPets(paged.data).adoption}
                loading={<></>}
                empty={<></>}
              >
                {(pets) => (
                  <section>
                    <h2 className="font-display text-headline font-semibold text-gray-900 dark:text-gray-100 mb-4">
                      {t('profile:public.adoption')}
                    </h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {pets.map((pet: Pet) => (
                        <ProfilePetCard key={pet.id} pet={pet} />
                      ))}
                    </div>
                  </section>
                )}
              </ListState>
            )}

            {/* El aviso de recorte va DEBAJO de todo lo publicado, no arriba:
                arriba se lee como una advertencia antes de haber visto nada,
                acá contesta la pregunta que el lector sí tiene en ese momento
                — "¿esto es todo?".

                Una línea apagada y nada más: sin `role="alert"`, sin ícono y
                sin caja de color. Promoverla a alerta afirmaría una urgencia
                que no existe; esto es una nota al pie. Y sólo se dibuja cuando
                el tope MUERDE: anunciar un recorte que no está pasando es ruido
                que entrena a la gente a ignorar el mensaje el día que es
                cierto. */}
            {petsTruncated && (
              <p className="text-sm text-gray-400 dark:text-gray-500 text-center pt-4">
                {t('profile:public.postsCapped', { shown: petsShown, total: petsTotal })}
              </p>
            )}

            {/* C. Reseñas — el resumen y la lista en UNA sola tarjeta. Estaban
                separadas, y el resumen dibujaba `—` en `text-3xl font-bold`
                para quien no tiene ninguna: en pantalla se leía como una barra
                negra suelta al lado de cinco estrellas grises. */}
            <section className={CARD}>
              <div className="flex items-start justify-between gap-4 mb-4">
                <div className="min-w-0">
                  <h2 className="font-display text-lg font-semibold text-gray-900 dark:text-gray-100">
                    {t('profile:public.reviews')}
                  </h2>
                  {profile.review_count > 0 ? (
                    <div className="flex items-center gap-3 mt-1">
                      <span className="text-3xl font-bold text-gray-900 dark:text-gray-50">
                        {profile.avg_rating.toFixed(1)}
                      </span>
                      <div>
                        <StarDisplay stars={Math.round(profile.avg_rating)} size="text-lg" />
                        <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                          {t('profile:public.reviewCount', { count: profile.review_count })}
                        </p>
                      </div>
                    </div>
                  ) : (
                    // Sin guion y sin estrellas: no hay nada que promediar, así
                    // que no se dibuja un promedio vacío.
                    <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">
                      {t('profile:public.noRating')}
                    </p>
                  )}
                </div>
                {canReview && (
                  <button
                    type="button"
                    onClick={handleOpenForm}
                    className="shrink-0 text-sm font-semibold text-primary hover:text-primary-dark transition-colors"
                  >
                    {myReview ? t('profile:public.editReview') : t('profile:public.leaveReview')}
                  </button>
                )}
              </div>

              {/* Formulario inline */}
              {showForm && (
                <form onSubmit={handleSubmit} className="mb-4 p-4 bg-gray-50 dark:bg-gray-800 rounded-xl space-y-3">
                  <div>
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      {t('profile:public.yourRating')}
                    </p>
                    <StarSelector value={formStars} onChange={setFormStars} />
                  </div>
                  <textarea
                    value={formText}
                    onChange={(e) => setFormText(e.target.value)}
                    placeholder={t('profile:public.reviewPlaceholder')}
                    maxLength={2000}
                    rows={4}
                    className="w-full text-sm border border-gray-200 dark:border-gray-700 rounded-lg p-2.5 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-50 placeholder-gray-400 resize-none focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                  {formError && (
                    <p role="alert" className="text-xs text-red-500">{formError}</p>
                  )}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setShowForm(false)}
                      className="flex-1 py-2 text-sm font-semibold border border-gray-200 dark:border-gray-700 rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                    >
                      {t('common:cancel')}
                    </button>
                    <button
                      type="submit"
                      disabled={createReview.isPending || updateReview.isPending}
                      className="flex-[2] py-2 text-sm font-semibold bg-primary text-white rounded-lg hover:bg-primary-dark disabled:opacity-60 transition-colors"
                    >
                      {createReview.isPending || updateReview.isPending
                        ? t('profile:public.saving')
                        : myReview
                          ? t('profile:public.saveReview')
                          : t('profile:public.publishReview')}
                    </button>
                  </div>
                </form>
              )}

              <ListState
                query={reviewsQuery}
                select={(res) => res.reviews}
                // `useUserReviews` es `enabled: !!userId`. Sin `id` en la URL la
                // query nunca se pide y cae al slot `empty`, igual que hoy — pero
                // ese caso ya lo ataja la guarda de `!profile` de más arriba.
                errorTitle={t('profile:public.reviewsError')}
                loading={
                  <div className="space-y-3 py-2">
                    {[1, 2].map((i) => (
                      <div key={i} className="h-16 rounded-xl bg-gray-100 dark:bg-gray-800 animate-pulse" />
                    ))}
                  </div>
                }
                empty={
                  <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-4">
                    {t('profile:public.reviewsEmpty')}
                  </p>
                }
              >
                {(reviews) => (
                  <div>
                    {reviews.map((review) => (
                      <ReviewCard
                        key={review.id}
                        review={review}
                        onDelete={
                          user && review.reviewer_id === user.id
                            ? () => {
                                if (!window.confirm(t('profile:public.confirmDeleteReview'))) return;
                                deleteReview.mutate(id ?? '');
                              }
                            : undefined
                        }
                      />
                    ))}
                  </div>
                )}
              </ListState>
            </section>

            {/* Link al leaderboard */}
            <div className="text-center">
              <Link
                to="/leaderboard"
                className="text-sm text-primary hover:text-primary-dark font-medium transition-colors"
              >
                {t('profile:public.seeRanking')}
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
