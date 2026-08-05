// ============================================================
// PetDetailPage
// ============================================================
import { useParams, Link } from 'react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PawPlaceholder } from '../components/PawPlaceholder';
import { Helmet } from 'react-helmet-async';
import { usePetByID, useReportsByPetID, useMarkPetAsFound, useSubmitAbuseReport } from '@shared/hooks';
import { statusBadgeBg } from '../utils/statusBadge';
import type { Photo, Report, AbuseReason } from '@shared/types';
import { useAuth } from '../context/AuthContext';
import { SharePanel } from '../components/SharePanel';
import { PdfFlyerButton } from '../components/PdfFlyerButton';
import { RevealContact } from '../components/RevealContact';
import { TimelineMap } from '../components/TimelineMap';
import { AdoptionPetBody } from '../components/AdoptionPetBody';
import { Icon } from '../components/Icon';

export function PetDetailPage() {
  const { t, i18n } = useTranslation(['pets', 'common']);
  const { id } = useParams<{ id: string }>();
  const { user, isAuthenticated } = useAuth();
  const { data: pet, isLoading } = usePetByID(id || '');
  const { data: reports } = useReportsByPetID(id || '');
  const markAsFound = useMarkPetAsFound();
  const submitAbuseReport = useSubmitAbuseReport();
  const [showPetReportMenu, setShowPetReportMenu] = useState(false);
  const [petReportSuccess, setPetReportSuccess] = useState(false);
  const [showFoundConfirm, setShowFoundConfirm] = useState(false);
  const [showStoryNudge, setShowStoryNudge] = useState(false);
  const [activePhotoIndex, setActivePhotoIndex] = useState(0);

  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-lg overflow-hidden animate-pulse">
          {/* Image placeholder */}
          <div className="h-72 md:h-96 bg-gray-200 dark:bg-gray-700" />
          <div className="p-6 md:p-8 space-y-5">
            {/* Title placeholder */}
            <div className="h-8 w-1/2 bg-gray-200 dark:bg-gray-700 rounded-lg" />
            {/* Attribute grid placeholder */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="h-16 bg-gray-100 dark:bg-gray-800 rounded-lg" />
              <div className="h-16 bg-gray-100 dark:bg-gray-800 rounded-lg" />
              <div className="h-16 bg-gray-100 dark:bg-gray-800 rounded-lg" />
            </div>
            {/* Description placeholder */}
            <div className="space-y-2">
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-full" />
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-5/6" />
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-4/6" />
            </div>
            {/* Buttons placeholder */}
            <div className="flex gap-3">
              <div className="h-10 w-28 bg-gray-200 dark:bg-gray-700 rounded-lg" />
              <div className="h-10 w-28 bg-gray-200 dark:bg-gray-700 rounded-lg" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!pet) {
    return (
      <div className="text-center py-20">
        <p className="text-5xl mb-4">🔍</p>
        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">{t('pets:detail.notFound')}</h2>
        <Link to="/" className="text-primary font-semibold mt-4 inline-block">{t('common:back')}</Link>
      </div>
    );
  }

  // Primary photo first, then the rest in original order
  const photos: Photo[] = [...(pet.photos ?? [])].sort(
    (a, b) => Number(b.is_primary ?? false) - Number(a.is_primary ?? false),
  );
  const safePhotoIndex = photos.length > 0 ? Math.min(activePhotoIndex, photos.length - 1) : 0;
  const activePhoto: Photo | undefined = photos[safePhotoIndex];
  const primaryPhoto = photos[0];
  // canManage: the owner (owned pets) or the reporter (stray pets, which have no
  // owner) may manage the pet — mark found, share, edit, delete, tell its story.
  const canManage = isAuthenticated && (user?.id === pet.owner_id || user?.id === pet.reporter_id);

  // Adoption listings share/flyer are lost-pet framed ("MASCOTA PERDIDA"), so
  // hide that surface for now — an adoption-framed share is a follow-up. `adopted`
  // is resolved (has a home), so it gets no share either.
  const isAdoptionListing = pet.status === 'adoption' || pet.status === 'adopted';

  // Sharing is friction-free for active searches (lost/stray use the public
  // endpoint); for any other status it requires a session.
  const shareAvailable =
    (pet.status === 'lost' || pet.status === 'stray' || isAuthenticated) && !isAdoptionListing;

  const goToPhoto = (delta: number) => {
    setActivePhotoIndex((safePhotoIndex + delta + photos.length) % photos.length);
  };

  const handlePetReport = (reason: AbuseReason) => {
    submitAbuseReport.mutate(
      { target_user_id: pet.owner_id ?? pet.reporter_id, reason },
      {
        onSuccess: () => {
          setShowPetReportMenu(false);
          setPetReportSuccess(true);
          setTimeout(() => setPetReportSuccess(false), 4000);
        },
        onError: () => {
          // keep menu open so user can retry
        },
      },
    );
  };

  const statusBadge = {
    color: statusBadgeBg(pet.status),
    label: t(`pets:status.${pet.status}`).toUpperCase(),
  };

  const getReportStatusLabel = (status: string) => {
    switch (status) {
      case 'lost': return t('pets:status.lost');
      case 'found': return t('pets:status.found');
      case 'sighting': return t('pets:card.sighting');
      default: return status;
    }
  };

  // Fecha efectiva del reporte: occurred_at si existe, sino created_at
  const getReportDate = (report: Report): string => {
    const dateStr = report.occurred_at ?? report.created_at;
    return new Date(dateStr).toLocaleDateString(i18n.language, {
      day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  };

  // SEO — descripción truncada a 160 caracteres
  const ogDescription = pet.description
    ? pet.description.slice(0, 160) + (pet.description.length > 160 ? '...' : '')
    : t('pets:detail.ogFallback', { name: pet.name });
  const ogImage = primaryPhoto?.url;

  // Extracted so the adoption body and the two-column body can both render them
  // without the JSX existing twice — the two branches share these, they do not
  // each own a copy.
  const factCards = (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
      {([
        ['pets:detail.type', pet.type && t(`pets:types.${pet.type}`)],
        ['pets:detail.breed', pet.breed],
        ['pets:detail.color', pet.color],
      ] as const)
        // Breed and color are optional and an update can clear them with "", so
        // a falsy value must drop the whole card — not render a heading with
        // nothing under it.
        .filter(([, value]) => !!value)
        .map(([labelKey, value]) => (
          <div
            key={labelKey}
            className="rounded-2xl border border-gray-100 bg-white p-4 dark:border-gray-800 dark:bg-gray-900"
          >
            <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">{t(labelKey)}</p>
            <p className="mt-1 font-display text-headline break-words text-gray-900 dark:text-gray-100">{value}</p>
          </div>
        ))}
    </div>
  );

  const descriptionCard = pet.description ? (
    <div className="mb-6 rounded-2xl border border-gray-100 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
      <h3 className="flex items-center gap-2 font-display text-headline text-gray-900 dark:text-gray-100">
        <Icon name="description" className="text-primary" />
        {t('pets:detail.description')}
      </h3>
      {/* `break-words` is load-bearing, not tidiness: the description is free
          text a user typed, so it can hold a pasted URL or a 90-character
          compound with no break opportunity. Without it that word paints past
          its box and drags the page's scrollWidth with it — measured at 375px,
          713 against a 375 viewport. Neither `min-w-0` nor the grid's
          `minmax(0,…)` help: those stop the TRACK from growing, they do not
          make a word wrap. */}
      <p className="mt-2 leading-relaxed break-words text-gray-600 dark:text-gray-300">{pet.description}</p>
    </div>
  ) : null;

  return (
    <>
      <Helmet>
        <title>{`${pet.name} — SearchPet`}</title>
        <meta property="og:title" content={`${pet.name} — SearchPet`} />
        <meta property="og:description" content={ogDescription} />
        {ogImage && <meta property="og:image" content={ogImage} />}
        <meta property="og:type" content="website" />
      </Helmet>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-lg">
          {/* Photo gallery / hero */}
          <div className="relative h-80 md:h-[28rem] bg-gray-100 dark:bg-gray-800 overflow-hidden rounded-t-2xl">
            {activePhoto ? (
              <>
                {/* A scaled, blurred copy of the same photo fills the frame, so the
                    design's edge-to-edge hero never costs us a crop. Pet photos
                    arrive in any orientation and `object-cover` would cut the head
                    off a vertical one — on the page whose whole job is to let
                    someone recognise this animal. Decoration only: the real <img>
                    below carries the alt text. */}
                <div
                  data-hero-backdrop
                  aria-hidden="true"
                  className="absolute inset-0 scale-110 bg-cover bg-center blur-2xl"
                  style={{ backgroundImage: `url(${activePhoto.url})` }}
                />
                <img
                  src={activePhoto.url}
                  alt={pet.name}
                  className="relative z-10 w-full h-full object-contain"
                  crossOrigin="anonymous"
                />
              </>
            ) : (
              <div className="w-full h-full flex items-center justify-center"><PawPlaceholder className="w-2/5 max-w-28" /></div>
            )}
            {photos.length > 1 && (
              <>
                <button
                  type="button"
                  onClick={() => goToPhoto(-1)}
                  aria-label={t('pets:detail.prevPhoto')}
                  className="absolute z-30 left-3 top-1/2 -translate-y-1/2 w-9 h-9 flex items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
                >
                  ‹
                </button>
                <button
                  type="button"
                  onClick={() => goToPhoto(1)}
                  aria-label={t('pets:detail.nextPhoto')}
                  className="absolute z-30 right-3 top-1/2 -translate-y-1/2 w-9 h-9 flex items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
                >
                  ›
                </button>
                {/* The counter moved to the top row: the bottom of the hero now
                    belongs to the name, and stacking both there collides on a
                    phone the moment a pet has a long name. */}
                <span className="absolute z-30 top-4 right-4 text-xs font-medium px-2 py-0.5 rounded-full bg-black/60 text-white">
                  📷 {safePhotoIndex + 1}/{photos.length}
                </span>
              </>
            )}
            <span className={`absolute z-30 top-4 left-4 ${statusBadge.color} text-white text-xs font-bold px-3 py-1 rounded`}>
              {statusBadge.label}
            </span>

            {/* Scrim. Not decoration in the throwaway sense: the title sits over
                an arbitrary user photo and needs a guaranteed dark base to stay
                readable — the same reasoning as the StoryCard scrim. */}
            <div
              aria-hidden="true"
              className="absolute inset-x-0 bottom-0 z-10 h-2/3 bg-gradient-to-t from-black/85 via-black/40 to-transparent"
            />

            {/* Bottom stack, in flow so nothing needs a magic offset: title row
                first, found banner underneath it. */}
            <div className="absolute inset-x-0 bottom-0 z-20">
              <div className="flex items-end justify-between gap-4 p-5 md:p-8 text-white">
                <div className="min-w-0">
                  <h1 className="font-display text-display-sm md:text-display break-words">{pet.name}</h1>
                  {(pet.breed || pet.type) && (
                    <p className="mt-1 break-words text-sm text-white/80">
                      {[pet.breed, pet.type && t(`pets:types.${pet.type}`)].filter(Boolean).join(' • ')}
                    </p>
                  )}
                </div>
                {photos.length > 1 && (
                  <div className="flex shrink-0 gap-1.5 pb-2">
                    {photos.map((p, i) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setActivePhotoIndex(i)}
                        aria-label={t('pets:detail.goToPhoto', { number: i + 1 })}
                        className={`w-2 h-2 rounded-full transition-colors ${
                          i === safePhotoIndex ? 'bg-white' : 'bg-white/40 hover:bg-white/70'
                        }`}
                      />
                    ))}
                  </div>
                )}
              </div>
              {pet.status === 'found' && (
                <div className="bg-green-700/95 text-white text-center py-2 font-bold text-sm">
                  {t('pets:detail.foundBanner')}
                </div>
              )}
            </div>
          </div>

          <div className="p-6 md:p-8">
            {isAdoptionListing && (
              <>
                {factCards}
                {descriptionCard}
                <AdoptionPetBody pet={pet} />
              </>
            )}
            {!isAdoptionListing && (
              // `minmax(0,…)` on both tracks stops a wide child from forcing the
              // TRACK past the viewport. It does NOT make text wrap — an
              // unbreakable word still paints outside its box, which is what
              // `break-words` on the user-content nodes is for. The two solve
              // different halves and neither substitutes for the other.
              <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-6">
                <div className="min-w-0">
                {factCards}
                {descriptionCard}
            {/* Action buttons.
                Sharing works logged-out for lost/stray (public endpoint); for any
                other status it needs a session. Where it's gated we show an honest
                login prompt instead of a silently disabled button. */}
            <div className="flex flex-wrap gap-3 mb-6">
              {shareAvailable ? (
                <SharePanel
                  petId={pet.id}
                  petName={pet.name}
                  pet={pet}
                />
              ) : !isAdoptionListing ? (
                <Link
                  to="/login"
                  className="inline-flex items-center gap-2 px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 font-semibold rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                >
                  🔒 {t('pets:detail.loginToShare')}
                </Link>
              ) : null}
              {/* Location reports only make sense while a pet is actively being
                  searched (lost/stray). Hide for adoption/adopted/found/registered. */}
              {isAuthenticated && (pet.status === 'lost' || pet.status === 'stray') && (
                <Link
                  to={`/reports/create?petId=${id}`}
                  className="inline-flex items-center gap-2 px-4 py-2 border border-primary text-primary font-semibold rounded-lg hover:bg-primary/5 transition-colors"
                >
                  {t('pets:detail.addReport')}
                </Link>
              )}
              {/* Mark as Found — dueño u (si es stray) reporter, mientras está activa */}
              {canManage && (pet.status === 'lost' || pet.status === 'stray') && (
                <div className="flex flex-col gap-2">
                  <button
                    onClick={() => setShowFoundConfirm(true)}
                    disabled={markAsFound.isPending}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white font-semibold rounded-lg hover:bg-green-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                  >
                    {markAsFound.isPending ? (
                      <>
                        <span className="animate-spin">⏳</span>
                        {t('pets:detail.markFoundSaving')}
                      </>
                    ) : (
                      `✅ ${t('pets:detail.markFound')}`
                    )}
                  </button>
                  {showFoundConfirm && (
                    <div className="flex flex-col gap-2 p-3 bg-green-50 dark:bg-green-950 rounded-xl border border-green-200 dark:border-green-800">
                      <p className="text-sm font-semibold text-green-800 dark:text-green-200">
                        {t('pets:detail.markFoundConfirm', { name: pet.name })}
                      </p>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => markAsFound.mutate(pet.id, { onSuccess: () => { setShowFoundConfirm(false); setShowStoryNudge(true); } })}
                          disabled={markAsFound.isPending}
                          className="px-4 py-1.5 bg-green-600 text-white text-sm font-semibold rounded-lg hover:bg-green-700 disabled:opacity-60 transition-colors"
                        >
                          {t('common:confirm')}
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowFoundConfirm(false)}
                          className="px-4 py-1.5 text-sm font-semibold text-gray-600 dark:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                        >
                          {t('common:cancel')}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {/* Story nudge — shown right after marking the pet found, to catch
                  the peak-emotion moment and offer telling the success story. */}
              {showStoryNudge && (
                <div className="flex flex-col gap-2 p-4 bg-green-50 dark:bg-green-950 rounded-xl border border-green-200 dark:border-green-800">
                  <p className="text-sm font-bold text-green-800 dark:text-green-200">
                    {t('pets:detail.foundNudgeTitle')}
                  </p>
                  <p className="text-sm text-green-700 dark:text-green-300">
                    {t('pets:detail.foundNudgeText')}
                  </p>
                  <div className="flex flex-wrap gap-2 mt-1">
                    <Link
                      to={`/stories/create?petId=${id}`}
                      className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white text-sm font-semibold rounded-lg hover:bg-green-700 transition-colors"
                    >
                      🎉 {t('pets:detail.foundNudgeCta')}
                    </Link>
                    <button
                      type="button"
                      onClick={() => setShowStoryNudge(false)}
                      className="px-4 py-2 text-sm font-semibold text-gray-600 dark:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                    >
                      {t('pets:detail.foundNudgeDismiss')}
                    </button>
                  </div>
                </div>
              )}
              {/* Contar historia — para quien gestiona la mascota (dueño o, en
                  un stray, el reporter) cuando ya fue encontrada */}
              {canManage && pet.status === 'found' && (
                <Link
                  to={`/stories/create?petId=${id}`}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white font-semibold rounded-lg hover:bg-green-700 transition-colors"
                >
                  🎉 {t('pets:detail.tellStory')}
                </Link>
              )}
              {/* PDF Flyer — same gating as share (it embeds the share-link QR) */}
              {shareAvailable && <PdfFlyerButton pet={pet} reports={reports ?? []} />}
            </div>

                </div>

            {/* Contact sidebar. It is the SECOND grid child on purpose: on a
                phone the grid collapses to one column and children stack in DOM
                order, so contact has to come before the timeline — it is the
                action someone takes after recognising the pet. On desktop the
                grid auto-places it in column 2 and the timeline below in
                column 1, without either needing an explicit placement. */}
            <aside className="min-w-0 lg:sticky lg:top-24 lg:self-start">

            {/* Dueño */}
            {pet.owner && (
              <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-4 mb-6">
                <h3 className="font-bold text-gray-900 dark:text-gray-100 mb-3">{t('pets:detail.owner')}</h3>
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-gray-200 dark:bg-gray-700 rounded-full flex items-center justify-center text-xl">👤</div>
                  <div>
                    <p className="font-semibold text-gray-900 dark:text-gray-100">{pet.owner.name}</p>
                    {pet.owner.is_verified && (
                      <p className="text-xs text-green-600 dark:text-green-400 font-semibold">{t('pets:detail.verified')}</p>
                    )}
                    {!pet.owner.phone && (
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{t('pets:detail.noPhone')}</p>
                    )}
                  </div>
                </div>
                {/* Reveal-on-click: the number stays out of the DOM until clicked. */}
                {pet.owner.phone && (
                  <RevealContact
                    phone={pet.owner.phone}
                    pet={pet}
                    revealLabel={t('pets:detail.revealPhone')}
                    contactLabel={t('pets:detail.contact')}
                    callLabel={t('pets:detail.callPhone')}
                    copyLabel={t('pets:detail.copyNumber')}
                    copiedLabel={t('pets:detail.copied')}
                  />
                )}
                {/* In-app message — always available as an alternative to the
                    phone, and the only contact channel when the owner has no
                    phone. Hidden for the owner viewing their own pet. */}
                {user?.id !== pet.owner_id && (
                  isAuthenticated ? (
                    <Link
                      to={`/messages/${pet.owner_id}`}
                      className="mt-3 w-full inline-flex items-center justify-center gap-2 bg-primary hover:bg-primary/90 text-white font-bold py-3 rounded-lg transition-colors"
                    >
                      💬 {t('pets:detail.sendMessage')}
                    </Link>
                  ) : (
                    <Link
                      to="/login"
                      className="mt-3 w-full inline-flex items-center justify-center gap-2 border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 font-semibold py-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                    >
                      🔒 {t('pets:detail.loginToContact')}
                    </Link>
                  )
                )}
              </div>
            )}

            {/* Reporter contact — stray pets with no owner.
                - Public WhatsApp (no login) when the reporter opted in and has a
                  phone — the friction-free path for finders/owners.
                - Otherwise fall back to in-app messaging (login required).
                The reporter never sees a contact button for their own report. */}
            {pet.status === 'stray' && !pet.owner && pet.reporter_id && (() => {
              const isReporter = isAuthenticated && user?.id === pet.reporter_id;
              // The reporter never needs a contact button for their own report.
              if (isReporter) return null;

              const reporterPhone = pet.reporter?.phone;
              const publicContact = !!(pet.reporter_contact_public && reporterPhone);

              return (
                <div className="bg-amber-50 dark:bg-amber-950 rounded-xl p-4 mb-6 border border-amber-200 dark:border-amber-800">
                  <h3 className="font-bold text-gray-900 dark:text-gray-100 mb-2">{t('pets:detail.reporter')}</h3>
                  <p className="text-sm text-gray-600 dark:text-gray-300 mb-3">{t('pets:detail.reporterDescription')}</p>
                  {publicContact ? (
                    // Public WhatsApp (no login), behind a reveal-on-click guard.
                    <RevealContact
                      phone={reporterPhone!}
                      pet={pet}
                      revealLabel={t('pets:detail.revealPhone')}
                      contactLabel={t('pets:detail.contactReporterWhatsapp')}
                      callLabel={t('pets:detail.callPhone')}
                      copyLabel={t('pets:detail.copyNumber')}
                      copiedLabel={t('pets:detail.copied')}
                    />
                  ) : isAuthenticated ? (
                    // In-app messaging fallback (login required).
                    <Link
                      to={`/messages/${pet.reporter_id}`}
                      className="w-full inline-flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-600 text-white font-bold py-3 rounded-lg transition-colors"
                    >
                      💬 {t('pets:detail.contactReporter')}
                    </Link>
                  ) : (
                    // Honest gated state: tell the logged-out finder how to contact.
                    <Link
                      to="/login"
                      className="w-full inline-flex items-center justify-center gap-2 border border-amber-400 dark:border-amber-700 text-amber-700 dark:text-amber-300 font-semibold py-3 rounded-lg hover:bg-amber-100 dark:hover:bg-amber-900 transition-colors"
                    >
                      🔒 {t('pets:detail.loginToContact')}
                    </Link>
                  )}
                </div>
              );
            })()}

            {/* Report pet — only for authenticated users who don't manage it,
                and only when there is a valid target (owner or reporter) to
                avoid submitting target_user_id: undefined. */}
            {isAuthenticated && !canManage && (pet.owner_id || pet.reporter_id) && (
              <div className="mb-6 space-y-2">
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => { setShowPetReportMenu((v) => !v); setPetReportSuccess(false); }}
                    disabled={submitAbuseReport.isPending}
                    className="text-sm font-semibold px-4 py-2 rounded-lg border border-orange-300 dark:border-orange-700 text-orange-600 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-950 transition-colors disabled:opacity-60"
                  >
                    {submitAbuseReport.isPending ? t('pets:report.sending') : t('pets:report.button')}
                  </button>
                </div>

                {/* Reason picker */}
                {showPetReportMenu && (
                  <div className="flex flex-col gap-1 p-3 bg-orange-50 dark:bg-orange-950 rounded-xl border border-orange-200 dark:border-orange-800">
                    <p className="text-xs font-semibold text-orange-700 dark:text-orange-300 mb-1">{t('pets:report.reasonLabel')}</p>
                    {(['spam', 'fake', 'abuse', 'inappropriate', 'other'] as AbuseReason[]).map((reason) => (
                      <button
                        key={reason}
                        type="button"
                        onClick={() => handlePetReport(reason)}
                        disabled={submitAbuseReport.isPending}
                        className="text-left text-sm px-3 py-1.5 rounded-lg hover:bg-orange-100 dark:hover:bg-orange-900 text-orange-800 dark:text-orange-200 disabled:opacity-60 transition-colors"
                      >
                        {t(`pets:report.reasons.${reason}`)}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => setShowPetReportMenu(false)}
                      className="text-left text-xs px-3 py-1 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-400 transition-colors mt-1"
                    >
                      {t('pets:report.cancel')}
                    </button>
                  </div>
                )}

                {/* Success feedback */}
                {petReportSuccess && (
                  <p className="text-xs text-green-600 dark:text-green-400 text-right font-medium">
                    {t('pets:report.success')}
                  </p>
                )}
              </div>
            )}

            </aside>

            {/* Timeline */}
            <div className="min-w-0">
            {reports && reports.length > 0 && (
              <div className="rounded-2xl border border-gray-100 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
                <h3 className="mb-4 flex items-center gap-2 font-display text-headline text-gray-900 dark:text-gray-100">
                  <Icon name="history" className="text-primary" />
                  {t('pets:detail.timeline', { count: reports.length })}
                </h3>
                <div className="space-y-0">
                  {reports.map((report: Report, index: number) => (
                    <div key={report.id} className="flex gap-3 relative">
                      {/* Línea conectora — visible entre entradas consecutivas */}
                      {index < reports.length - 1 && (
                        <div
                          className="absolute left-[5px] top-[20px] bottom-0 w-0.5 bg-gray-200 dark:bg-gray-700"
                          aria-hidden="true"
                        />
                      )}
                      <div className={`w-3 h-3 rounded-full mt-1.5 flex-shrink-0 relative z-10 ${
                        report.status === 'lost' ? 'bg-red-500' :
                        report.status === 'found' ? 'bg-green-500' : 'bg-yellow-500'
                      }`} />
                      <div className="pb-4">
                        <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                          {getReportStatusLabel(report.status)}
                        </p>
                        {report.is_verified && (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-600 dark:text-green-400">
                            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd"/>
                            </svg>
                            {t('pets:detail.reportVerified')}
                          </span>
                        )}
                        {report.location_description && (
                          <p className="flex items-start gap-1 text-sm text-gray-500 dark:text-gray-400">
                            <Icon name="location-on" className="mt-0.5 shrink-0 text-base" />
                            <span className="min-w-0 break-words">{report.location_description}</span>
                          </p>
                        )}
                        <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                          {getReportDate(report)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
                <TimelineMap reports={reports ?? []} />
              </div>
            )}
            </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
