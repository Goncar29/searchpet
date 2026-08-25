import { Link } from 'react-router';
import { useState, useRef, useCallback, useEffect, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useStats, useSearchPets, useStories, useImageClassify, useImageSearch } from '@shared/hooks';
import { statusBadgeBg } from '../utils/statusBadge';
import type { PetType, PetStatus, SuccessStory, ClassifyResult, ImageSearchResult } from '@shared/types';
import { getErrorMessage } from '@shared/utils/apiErrors';
import { startOfDayISO, endOfDayISO } from '@shared/utils/dateFilters';
import { cloudinaryCardThumb } from '@shared/utils/cloudinaryThumb';
import { ApiError } from '@shared/api/client';
import { useAuth } from '../context/AuthContext';
import { PawPlaceholder } from '../components/PawPlaceholder';
import { Icon } from '../components/Icon';
import { StoryCard } from '../components/StoryCard';
import { ListState } from '../components/list/ListState';

// Montevideo default center for the optional distance filter.
const DEFAULT_LAT = -34.9011;
const DEFAULT_LNG = -56.1645;

// Served from `public/`, so it resolves to 'self' — the only image origins the
// CSP in vercel.json accepts besides Cloudinary, OSM tiles, GitHub raw, cdnjs
// and lh3.googleusercontent. A remote placeholder here renders locally and is
// blocked in production, silently, leaving an empty 520px box.
// JPEG, not PNG: the source was a 590 KB PNG of a photograph, a format that
// cannot compress one. Re-encoded at q82 it is 225 KB with no visible loss at
// the 584x520 box this renders into. Worth keeping small because the column is
// `hidden lg:block` and a phone still downloads it — see the note below.
const HERO_IMAGE_SRC = '/hero.jpg';

// The icon here is an emoji on purpose: these render inside native <option>
// elements, and a browser strips any markup there — an inline <svg> would
// simply not draw. Replacing it needs a custom combobox, not an icon swap.
const PET_TYPES: { value: PetType; labelKey: string; icon: string }[] = [
  { value: 'perro', labelKey: 'home:petTypes.perro', icon: '🐕' },
  { value: 'gato', labelKey: 'home:petTypes.gato', icon: '🐱' },
  { value: 'pajaro', labelKey: 'home:petTypes.pajaro', icon: '🐦' },
  { value: 'otro', labelKey: 'home:petTypes.otro', icon: '🐾' },
];

// Only feed-visible statuses are offered. `registered`/`archived` are private
// and are rejected by the public search endpoint, so they must not be options.
const PET_STATUSES: { value: PetStatus; labelKey: string }[] = [
  { value: 'lost', labelKey: 'home:petStatuses.lost' },
  { value: 'stray', labelKey: 'home:petStatuses.stray' },
  { value: 'found', labelKey: 'home:petStatuses.found' },
];

// Shared field chrome for the filter grid. Full width at every breakpoint and a
// fixed height so selects, text inputs and date inputs line up on one baseline —
// native date inputs are the ones that drift otherwise.
const FIELD_CLASS =
  'w-full h-12 border border-gray-200 dark:border-gray-700 rounded-lg px-3 text-sm bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-primary';
const FIELD_LABEL_CLASS = 'block mb-1.5 text-sm font-semibold text-gray-600 dark:text-gray-400';

export function HomePage() {
  const { t } = useTranslation(['home', 'common', 'pets']);
  // Local "today" as YYYY-MM-DD (en-CA yields that format) to cap date filters:
  // no future dates, and the range endpoints can't cross each other.
  const todayStr = new Date().toLocaleDateString('en-CA');
  const { isAuthenticated } = useAuth();
  const { data: stats } = useStats();
  const { data: featuredStories } = useStories({ limit: 3 });

  // ── Draft filters (what the user is typing — not yet applied) ──
  const [draftType, setDraftType] = useState<PetType | ''>('');
  const [draftColor, setDraftColor] = useState('');
  const [draftStatus, setDraftStatus] = useState<PetStatus | ''>('');
  const [draftBreed, setDraftBreed] = useState('');
  const [draftFrom, setDraftFrom] = useState('');
  const [draftTo, setDraftTo] = useState('');
  const [draftRadius, setDraftRadius] = useState(''); // km, '' = cualquier distancia

  // ── Applied filters (sent to the API — only updated on explicit search) ──
  const [filterType, setFilterType] = useState<PetType | ''>('');
  const [filterColor, setFilterColor] = useState('');
  const [filterStatus, setFilterStatus] = useState<PetStatus | ''>('');
  const [filterBreed, setFilterBreed] = useState('');
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');
  const [filterRadius, setFilterRadius] = useState(''); // km, '' = cualquier distancia
  // Resolved center for the distance filter. null = fallback to Montevideo.
  const [filterGeoCenter, setFilterGeoCenter] = useState<{ lat: number; lng: number } | null>(null);
  // True while we are waiting for GPS to resolve (prevents a double-fetch).
  const [isLocating, setIsLocating] = useState(false);
  // Synchronous mirror of isLocating for the re-entrancy guard — React state is
  // stale within the same synchronous batch, a ref is not.
  const isLocatingRef = useRef(false);

  // The home always shows the search feed (lost+stray by default). Filters —
  // including the optional distance — layer on top. No separate "nearby" mode.
  const hasActiveFilters = !!filterType || filterColor.trim().length > 0 || !!filterStatus
    || filterBreed.trim().length > 0 || !!filterFrom || !!filterTo || !!filterRadius;

  // Commit all applied filters at once so exactly one query fires.
  // center may be a real GPS position or null (Montevideo fallback).
  // draftXxx values are captured at call time (closure over current render's
  // draft state). The timer callback and geo callbacks always call the latest
  // version of this function via commitFiltersRef (kept in sync below), so
  // drafts reflect the state at the time the timer fires, not at arm time.
  const commitFilters = useCallback((center: { lat: number; lng: number } | null) => {
    setFilterType(draftType);
    setFilterColor(draftColor);
    setFilterStatus(draftStatus);
    setFilterBreed(draftBreed);
    setFilterFrom(draftFrom);
    setFilterTo(draftTo);
    setFilterRadius(draftRadius);
    setFilterGeoCenter(center);
    setIsLocating(false);
    isLocatingRef.current = false;
  }, [draftType, draftColor, draftStatus, draftBreed, draftFrom, draftTo, draftRadius]);

  // Ref holding the outer 8-second safety-net timer id so it can be cancelled
  // by clearFilters or on unmount, preventing stale-state writes after reset.
  const geoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Ref that always holds the latest commitFilters. Assigned synchronously
  // during render (canonical "latest ref" pattern) — no useEffect needed,
  // which eliminates the 1-render-stale window the effect had.
  const commitFiltersRef = useRef(commitFilters);
  commitFiltersRef.current = commitFilters;

  // Generation counter: incremented each time a new geo request is started or
  // cancelled. Every in-flight callback captures its own gen at arm time and
  // bails out early if the counter has moved — cancelling the uncancellable.
  const geoGenRef = useRef(0);

  // Cancel the geo safety-net timer on unmount to prevent setState-after-unmount.
  // Also bump the generation counter so any in-flight geo callbacks bail out.
  useEffect(() => () => {
    geoGenRef.current++;
    if (geoTimerRef.current) clearTimeout(geoTimerRef.current);
  }, []);

  const handleSearch = () => {
    // Re-entrancy guard: if geolocation is already in-flight, ignore the call.
    // Uses the ref (not state) so rapid synchronous re-entry is also blocked.
    if (isLocatingRef.current) return;

    // A new filter search replaces any active photo-search results
    setImageResults(null);
    setImageSearchError(null);

    // When the user picks a distance radius, resolve their real location FIRST,
    // then commit center + radius together — so the query fires exactly once
    // with the correct center (no Montevideo-first flash, no double-fetch).
    // On denial / unsupported / timeout we fall back to Montevideo silently.
    if (draftRadius) {
      if (typeof navigator !== 'undefined' && navigator.geolocation) {
        setIsLocating(true);
        isLocatingRef.current = true;
        // Cancel any previous safety-net timer before arming a new one so a
        // prior pending timer cannot fire and overwrite state after a clear/reset.
        if (geoTimerRef.current) clearTimeout(geoTimerRef.current);
        // Increment the generation counter and capture the current value.
        // Every callback for THIS request uses this gen; if the counter moves
        // (clearFilters or unmount) before the callback fires, the callback bails.
        const gen = ++geoGenRef.current;
        // Outer safety net: if the browser never fires either callback (e.g.
        // the permission prompt is ignored/dismissed), resolve after 8 s with
        // the Montevideo fallback so the button never stays disabled forever.
        // Uses commitFiltersRef so the latest commitFilters closure is called,
        // not the one captured at the time the timer was armed.
        geoTimerRef.current = setTimeout(() => {
          if (gen !== geoGenRef.current) return;
          geoTimerRef.current = null;
          commitFiltersRef.current(null);
        }, 8000);
        try {
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              if (gen !== geoGenRef.current) return;
              if (geoTimerRef.current) { clearTimeout(geoTimerRef.current); geoTimerRef.current = null; }
              commitFiltersRef.current({ lat: pos.coords.latitude, lng: pos.coords.longitude });
            },
            () => {
              // permission denied, unavailable, or inner timeout → Montevideo fallback
              if (gen !== geoGenRef.current) return;
              if (geoTimerRef.current) { clearTimeout(geoTimerRef.current); geoTimerRef.current = null; }
              commitFiltersRef.current(null);
            },
            { timeout: 5000 }
          );
        } catch {
          // Synchronous throw in restrictive environments (e.g. certain WebViews).
          // No gen check: nothing can run between arming gen and a synchronous throw.
          if (geoTimerRef.current) { clearTimeout(geoTimerRef.current); geoTimerRef.current = null; }
          commitFiltersRef.current(null);
        }
      } else {
        // Geolocation not supported → commit immediately with Montevideo fallback
        commitFiltersRef.current(null);
      }
    } else {
      // No distance filter → commit immediately, no geolocation needed
      commitFiltersRef.current(null);
    }
  };

  const clearFilters = () => {
    // Bump the generation counter first — invalidates any in-flight GPS
    // success/error/timer callbacks so they bail out before touching state.
    geoGenRef.current++;
    // Cancel any in-flight geo safety-net timer so it cannot fire and overwrite
    // state after the user has already cleared the filters.
    if (geoTimerRef.current) { clearTimeout(geoTimerRef.current); geoTimerRef.current = null; }
    setFilterType('');
    setFilterColor('');
    setFilterStatus('');
    setFilterBreed('');
    setFilterFrom('');
    setFilterTo('');
    setFilterRadius('');
    setFilterGeoCenter(null);
    setIsLocating(false);
    isLocatingRef.current = false;
    setDraftType('');
    setDraftColor('');
    setDraftStatus('');
    setDraftBreed('');
    setDraftFrom('');
    setDraftTo('');
    setDraftRadius('');
    setClassifyResult(null);
    setPhotoNoMatch(false);
    setImageResults(null);
    setImageSearchError(null);
  };

  // ── Búsqueda por foto ──
  const [classifyResult, setClassifyResult] = useState<ClassifyResult | null>(null);
  const [photoNoMatch, setPhotoNoMatch] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { classify, isModelLoading, isClassifying } = useImageClassify();
  const imageSearchMutation = useImageSearch();

  // Server-side image search results (CLIP similarity) — only populated when
  // the user is authenticated and the backend call succeeds.
  const [imageResults, setImageResults] = useState<ImageSearchResult[] | null>(null);
  const [imageSearchError, setImageSearchError] = useState<string | null>(null);
  // Photo search needs the backend (CLIP), which requires auth. When logged out
  // we prompt for login instead of running the local classifier (which can't search).
  const [photoLoginPrompt, setPhotoLoginPrompt] = useState(false);

  const clearImageResults = () => {
    setImageResults(null);
    setImageSearchError(null);
  };

  const runClassifierFallback = async (file: File) => {
    const img = new Image();
    img.src = URL.createObjectURL(file);
    await img.decode();
    const result = await classify(img);
    URL.revokeObjectURL(img.src);
    if (result) {
      setClassifyResult(result);
      // Photo search auto-applies immediately — uploading IS the explicit action
      if (result.type) { setDraftType(result.type); setFilterType(result.type); }
      if (result.breed) { setDraftBreed(result.breed); setFilterBreed(result.breed); }
    } else {
      setPhotoNoMatch(true);
    }
  };

  const handleImageSearch = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoNoMatch(false);
    setPhotoLoginPrompt(false);
    // Clear any previous photo-search results too: otherwise a later failure
    // (e.g. 503) leaves stale cards from the prior photo on screen, which the
    // user would read as matches for the new one.
    clearImageResults();

    // Photo search is a backend (CLIP) feature gated by auth. Logged out, the
    // on-device classifier can't actually search (it only reports "no pet
    // detected"), so we prompt for login instead of running it.
    if (!isAuthenticated) {
      setPhotoLoginPrompt(true);
      e.target.value = '';
      return;
    }

    try {
      const response = await imageSearchMutation.mutateAsync(file);
      setImageResults(response.results);
      setClassifyResult(null);
      e.target.value = '';
      return;
    } catch (err) {
      // image_search_unavailable (503 — e.g. Jina rate-limited / down): tell the
      // user honestly and STOP. Falling back to the much weaker on-device
      // classifier here only reports "no pet detected", masking the real cause.
      const isUnavailable = err instanceof ApiError && err.code === 'image_search_unavailable';
      if (isUnavailable) {
        setImageSearchError(t('home:photoSearch.unavailable'));
        e.target.value = '';
        return;
      }
      // Any other error (network, 4xx): surface it, then still try the local
      // classifier as a best-effort fallback.
      setImageSearchError(getErrorMessage(err, t));
    }

    await runClassifierFallback(file);
    e.target.value = '';
  };

  // ── Datos ──
  // Single unified feed: /pets/search (lost+stray by default). The optional
  // distance filter adds lat/lng/radius; results are ordered by recency.
  // When the user applies a distance filter we use their GPS location as the
  // center; on denial / unsupported we fall back to Montevideo (DEFAULT_LAT/LNG).
  const radiusKm = Number(filterRadius);
  const geoLat = filterRadius ? (filterGeoCenter?.lat ?? DEFAULT_LAT) : undefined;
  const geoLng = filterRadius ? (filterGeoCenter?.lng ?? DEFAULT_LNG) : undefined;
  const searchQuery = useSearchPets({
    type: filterType || undefined,
    color: filterColor.trim() || undefined,
    status: filterStatus || undefined,
    breed: filterBreed.trim() || undefined,
    from: filterFrom ? startOfDayISO(filterFrom) : undefined,
    to: filterTo ? endOfDayISO(filterTo) : undefined,
    lat: geoLat,
    lng: geoLng,
    radiusMeters: filterRadius ? radiusKm * 1000 : undefined,
  });
  // `undefined` y no 0 cuando no hay datos: con la query caída, un "0
  // resultados" acá contradice al cartel de error de abajo, y de los dos el que
  // suena seguro es el que miente. Sin dato, no se afirma nada.
  const resultCount = searchQuery.data
    ? (searchQuery.data.total ?? searchQuery.data.data.length)
    : undefined;

  return (
    <div className="bg-gray-50 dark:bg-gray-950 min-h-screen">
      {/* Hero.
          `overflow-hidden` here is scoped clipping for the decorative blob, not
          the body-level `overflow-x-hidden` the Stitch mockup ships — that one
          hides layout overflow instead of fixing it, and we did not copy it. */}
      <section className="bg-gradient-to-br from-primary to-primary-dark text-white overflow-hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14 sm:py-20">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <div className="text-center lg:text-left">
              <h1 className="font-display text-display-sm md:text-display mb-4">
                {t('home:hero.title')}
              </h1>
              <p className="text-base sm:text-lg text-white/80 max-w-2xl mx-auto lg:mx-0 mb-8">
                {t('home:hero.subtitle')}
              </p>
              <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 justify-center lg:justify-start">
                <Link
                  to="/map"
                  className="inline-flex items-center justify-center gap-2 px-8 py-3 bg-white text-primary font-bold rounded-xl hover:bg-gray-100 transition-colors"
                >
                  <Icon name="map" className="text-xl" />
                  {t('home:viewMap')}
                </Link>
                <Link
                  to="/publish"
                  className="inline-flex items-center justify-center gap-2 px-8 py-3 border-2 border-white text-white font-bold rounded-xl hover:bg-white/10 transition-colors"
                >
                  <Icon name="campaign" className="text-xl" />
                  {t('home:publish')}
                </Link>
              </div>
            </div>

            {/* Photo column, from lg up only — same breakpoint the design uses.
                On a phone it would push the two CTAs below the fold, which is
                the opposite of what this page is for.

                `hidden` stops it being painted, NOT downloaded: a browser still
                fetches an <img> inside a display:none container. Measured at
                375px — the box is 0x0 while the element reports complete=true
                and naturalWidth=921. So a phone pays for these bytes and sees
                nothing, which is why the file is kept small. `loading="lazy"`
                would skip the fetch here but this is the desktop LCP element,
                so it would trade a phone's bytes for everyone else's paint. */}
            <div className="relative hidden lg:block">
              <div
                aria-hidden="true"
                className="absolute -top-12 -right-12 h-[420px] w-[420px] rounded-full bg-white/10"
              />
              <img
                src={HERO_IMAGE_SRC}
                alt=""
                className="relative z-10 h-[520px] w-full rounded-[40px] object-cover shadow-2xl"
              />
              {/* The design floats a stat card over this photo ("85% success
                  rate" — an invented number). Deliberately not ported: every
                  real stat we have already appears in the band right below, so
                  the card would repeat a figure the user reads seconds later.
                  HomePage.test.tsx caught it as a duplicate-text failure. */}
            </div>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 -mt-10">
        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-lg p-6 grid grid-cols-2 md:grid-cols-4 gap-6">
          <div className="text-center">
            <p className="font-display text-display-sm text-primary">{stats?.pets_reunited || 0}</p>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('home:stats.reunited')}</p>
          </div>
          <div className="text-center">
            <p className="font-display text-display-sm text-primary">{stats?.searches_started || 0}</p>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('home:stats.searches')}</p>
          </div>
          <div className="text-center">
            <p className="font-display text-display-sm text-primary">{stats?.total_users || 0}</p>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('home:stats.members')}</p>
          </div>
          <div className="text-center">
            <p className="font-display text-display-sm text-primary">{stats?.total_pets || 0}</p>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('home:stats.registered')}</p>
          </div>
        </div>
      </section>

      {/* Cómo funciona */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
        <h2 className="font-display text-headline sm:text-display-sm text-gray-900 dark:text-gray-100 text-center mb-8 sm:mb-10">
          {t('home:how.title')}
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {([
            { icon: 'campaign', tint: 'bg-primary/10 text-primary', key: 'step1' },
            { icon: 'map', tint: 'bg-secondary/10 text-secondary', key: 'step2' },
            { icon: 'share', tint: 'bg-found/10 text-found', key: 'step3' },
          ] as const).map((step) => (
            <div
              key={step.key}
              className="bg-white dark:bg-gray-900 rounded-3xl border border-gray-100 dark:border-gray-800 shadow-sm p-6 sm:p-8 flex flex-col items-center text-center"
            >
              <div className={`${step.tint} rounded-2xl p-4 mb-4`}>
                <Icon name={step.icon} className="text-3xl" />
              </div>
              <h3 className="font-display text-headline text-gray-900 dark:text-gray-100 mb-2">
                {t(`home:how.${step.key}.title`)}
              </h3>
              <p className="text-gray-500 dark:text-gray-400 text-sm">
                {t(`home:how.${step.key}.description`)}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Historias de éxito */}
      {featuredStories && featuredStories.length > 0 && (
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-6">
            <h2 className="font-display text-headline sm:text-display-sm text-gray-900 dark:text-gray-100">
              {t('home:successStories.title')}
            </h2>
            <Link
              to="/stories"
              className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:text-primary-dark transition-colors"
            >
              {t('home:successStories.viewAll')}
              <Icon name="arrow-forward" className="text-base" />
            </Link>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {featuredStories.map((story: SuccessStory) => (
              // Read-only here: no onToggleLike, so the count renders as text.
              // Liking lives on /stories, where the user came to engage.
              <StoryCard key={story.id} story={story} to={`/stories/${story.id}`} />
            ))}
          </div>
        </section>
      )}

      {/* Buscar por foto */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8">
        <div className="bg-gradient-to-r from-primary/5 to-blue-50 dark:from-primary/10 dark:to-gray-900 rounded-2xl border border-primary/20 dark:border-primary/30 p-5 sm:p-6">
          <div className="flex flex-col md:flex-row md:items-center gap-5">
            <div className="flex-1 min-w-0">
              {/* flex-wrap matters: title + two badges overflow a narrow phone
                  in the longer locales without it. */}
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <span className="inline-flex items-center justify-center rounded-lg bg-primary p-1.5 text-white">
                  <Icon name="linked-camera" className="text-lg" />
                </span>
                <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">
                  {t('home:photoSearch.title')}
                </h2>
                <span className="text-xs font-bold bg-primary/15 text-primary px-2 py-0.5 rounded-full">{t('home:photoSearch.aiBadge')}</span>
                <span className="text-xs font-semibold bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 px-2 py-0.5 rounded-full">Beta</span>
              </div>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {t('home:photoSearch.description')}
              </p>
              {classifyResult?.type && (
                <div className="mt-3 flex items-center gap-2 flex-wrap">
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 text-sm font-semibold bg-primary/10 text-primary border border-primary/20 rounded-full">
                    <Icon name="check-circle" /> {classifyResult.breed ?? classifyResult.type} · {Math.round(classifyResult.confidence * 100)}%
                  </span>
                  <button
                    type="button"
                    onClick={() => { setClassifyResult(null); clearFilters(); }}
                    className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
                  >
                    {t('home:filters.clear')} <Icon name="close" />
                  </button>
                </div>
              )}
              {photoNoMatch && (
                <div className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs text-yellow-700 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-700 rounded-full">
                  {t('home:photoSearch.noPetDetected')}
                  <button
                    type="button"
                    onClick={() => setPhotoNoMatch(false)}
                    aria-label={t('common:close')}
                    className="ml-0.5 hover:opacity-70"
                  >
                    <Icon name="close" />
                  </button>
                </div>
              )}
              {imageResults && (
                <div className="mt-3 flex items-center gap-2 flex-wrap">
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 text-sm font-semibold bg-primary/10 text-primary border border-primary/20 rounded-full">
                    <Icon name="check-circle" /> {t('home:photoSearch.resultsTitle')} ({imageResults.length})
                  </span>
                  <button
                    type="button"
                    onClick={clearImageResults}
                    className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
                  >
                    {t('home:photoSearch.clear')} <Icon name="close" />
                  </button>
                </div>
              )}
              {imageSearchError && (
                <div className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs text-yellow-700 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-700 rounded-full">
                  {imageSearchError}
                  <button
                    type="button"
                    onClick={() => setImageSearchError(null)}
                    aria-label={t('common:close')}
                    className="ml-0.5 hover:opacity-70"
                  >
                    <Icon name="close" />
                  </button>
                </div>
              )}
              {photoLoginPrompt && (
                <Link
                  to="/login"
                  className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-primary bg-primary/10 border border-primary/20 rounded-full hover:bg-primary/15 transition-colors"
                >
                  <Icon name="lock" /> {t('home:photoSearch.loginRequired')}
                </Link>
              )}
            </div>
            <div className="md:flex-shrink-0">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isModelLoading || isClassifying || imageSearchMutation.isPending}
                className="w-full md:w-auto inline-flex items-center justify-center gap-2 px-5 py-3 text-sm font-semibold text-white bg-primary rounded-xl hover:bg-primary-dark disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
              >
                {imageSearchMutation.isPending || isClassifying ? (
                  <>
                    <Icon name="spinner" className="animate-spin" />
                    {t('home:photoSearch.analyzing')}
                  </>
                ) : isModelLoading ? (
                  <>
                    <Icon name="hourglass" />
                    {t('home:photoSearch.loadingModel')}
                  </>
                ) : (
                  <>
                    <Icon name="photo-camera" className="text-base" />
                    {t('home:photoSearch.uploadPhoto')}
                  </>
                )}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleImageSearch}
              />
            </div>
          </div>
        </div>
      </section>

      {/* Filtros */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-800 p-5 sm:p-6">
          <h2 className="flex items-center gap-2 text-lg font-bold text-gray-900 dark:text-gray-100 mb-5">
            <Icon name="filter-alt" className="text-primary text-xl" />
            {t('home:filters.title')}
          </h2>

          {/* One column on a phone, two on a tablet, four on a desktop. Every
              field is full width, so the row never turns into a ragged pile. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label htmlFor="filter-type" className={FIELD_LABEL_CLASS}>{t('home:filters.labels.type')}</label>
              <select
                id="filter-type"
                value={draftType}
                onChange={(e) => setDraftType(e.target.value as PetType | '')}
                className={FIELD_CLASS}
              >
                <option value="">{t('home:filters.allTypes')}</option>
                {PET_TYPES.map((pt) => (
                  <option key={pt.value} value={pt.value}>{pt.icon} {t(pt.labelKey)}</option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="filter-color" className={FIELD_LABEL_CLASS}>{t('home:filters.labels.color')}</label>
              <input
                id="filter-color"
                type="text"
                placeholder={t('home:filters.colorPlaceholder')}
                value={draftColor}
                onChange={(e) => setDraftColor(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !isLocating && handleSearch()}
                className={FIELD_CLASS}
              />
            </div>

            <div>
              <label htmlFor="filter-status" className={FIELD_LABEL_CLASS}>{t('home:filters.labels.status')}</label>
              <select
                id="filter-status"
                value={draftStatus}
                onChange={(e) => setDraftStatus(e.target.value as PetStatus | '')}
                className={FIELD_CLASS}
              >
                <option value="">{t('home:filters.defaultStatus')}</option>
                {PET_STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>{t(s.labelKey)}</option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="filter-breed" className={FIELD_LABEL_CLASS}>{t('home:filters.labels.breed')}</label>
              <input
                id="filter-breed"
                type="text"
                placeholder={t('home:filters.breedPlaceholder')}
                value={draftBreed}
                onChange={(e) => setDraftBreed(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !isLocating && handleSearch()}
                className={FIELD_CLASS}
              />
            </div>

            <div>
              <label htmlFor="filter-from" className={FIELD_LABEL_CLASS}>{t('home:filters.labels.dateFrom')}</label>
              <input
                id="filter-from"
                type="date"
                value={draftFrom}
                onChange={(e) => setDraftFrom(e.target.value)}
                max={draftTo || todayStr}
                className={FIELD_CLASS}
              />
            </div>

            <div>
              <label htmlFor="filter-to" className={FIELD_LABEL_CLASS}>{t('home:filters.labels.dateTo')}</label>
              <input
                id="filter-to"
                type="date"
                value={draftTo}
                onChange={(e) => setDraftTo(e.target.value)}
                min={draftFrom || undefined}
                max={todayStr}
                className={FIELD_CLASS}
              />
            </div>

            <div>
              <label htmlFor="filter-distance" className={FIELD_LABEL_CLASS}>{t('home:filters.labels.distance')}</label>
              <select
                id="filter-distance"
                value={draftRadius}
                onChange={(e) => setDraftRadius(e.target.value)}
                disabled={isLocating}
                className={`${FIELD_CLASS} disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                <option value="">{t('home:distance.any')}</option>
                {[5, 10, 20, 50].map((km) => (
                  <option key={km} value={km}>{t('home:distance.upToKm', { km })}</option>
                ))}
              </select>
              {filterRadius && (
                <span className="mt-1 block text-xs text-gray-400 dark:text-gray-500">
                  {filterGeoCenter
                    ? t('home:distanceCenter.gps')
                    : t('home:distanceCenter.fallback')}
                </span>
              )}
            </div>
          </div>

          {/* Actions live outside the field grid so the primary button is never
              squeezed into a column with a date input. */}
          <div className="flex flex-col sm:flex-row gap-2 mt-5">
            <button
              onClick={handleSearch}
              disabled={isLocating}
              className="inline-flex items-center justify-center gap-2 w-full sm:w-auto px-6 h-12 text-sm font-semibold text-white bg-primary rounded-lg hover:bg-primary-dark disabled:opacity-60 disabled:cursor-wait transition-colors"
            >
              <Icon name="search" className="text-base" />
              {isLocating ? t('home:distance.locating') : t('home:searchButton')}
            </button>
            {(hasActiveFilters || isLocating) && (
              <button
                onClick={clearFilters}
                className="inline-flex items-center justify-center gap-1.5 w-full sm:w-auto px-5 h-12 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 border border-gray-200 dark:border-gray-700 rounded-lg transition-colors"
              >
                <Icon name="close" />
                {t('home:filters.clear')}
              </button>
            )}
          </div>
        </div>
      </section>

      {/* Resultados */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-16">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
          <h2 className="font-display text-headline sm:text-display-sm text-gray-900 dark:text-gray-100">
            {imageResults
              ? `${t('home:photoSearch.resultsTitle')} (${imageResults.length})`
              : hasActiveFilters
              ? resultCount !== undefined
                ? `${resultCount} ${resultCount !== 1 ? t('home:results') : t('home:result')}`
                : null
              : t('home:recentReports')}
          </h2>
          {imageResults ? (
            <button
              onClick={clearImageResults}
              className="inline-flex items-center justify-center gap-1.5 w-full sm:w-auto px-4 py-2 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 border border-gray-200 dark:border-gray-700 rounded-lg transition-colors"
            >
              {t('home:photoSearch.clear')} <Icon name="close" />
            </button>
          ) : hasActiveFilters && (
            <span className="text-sm text-gray-500 dark:text-gray-400">
              {t('home:searchActive')}
            </span>
          )}
        </div>

        {imageResults ? (
          // ── Resultados de búsqueda por foto (ImageSearchResult[]) ──
          imageResults.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {imageResults.map((result) => (
                <Link key={result.pet_id} to={`/pets/${result.pet_id}`} className="block group">
                  <div className="bg-white dark:bg-gray-900 rounded-2xl overflow-hidden shadow-sm border border-gray-100 dark:border-gray-800 hover:shadow-md transition-shadow">
                    <div className="h-48 bg-gray-100 dark:bg-gray-800 relative overflow-hidden">
                      {result.photo_url ? (
                        <img
                          src={cloudinaryCardThumb(result.photo_url)}
                          alt={result.name}
                          loading="lazy"
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center"><PawPlaceholder className="w-2/5 max-w-20" /></div>
                      )}
                      <span className="absolute top-3 right-3 text-xs font-bold text-white bg-primary px-2.5 py-1 rounded-full">
                        {t('pets:card.similarityMatch', { percent: Math.round(result.similarity * 100) })}
                      </span>
                    </div>
                    <div className="p-4">
                      <h3 className="font-bold text-gray-900 dark:text-gray-100 text-lg mb-1">{result.name}</h3>
                      {result.type && (
                        <span className="text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 px-2 py-0.5 rounded-full">{t(`pets:types.${result.type}`)}</span>
                      )}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="text-center py-12">
              <Icon name="search" className="mx-auto mb-4 text-5xl text-gray-300 dark:text-gray-600" />
              <p className="text-gray-700 dark:text-gray-300 font-semibold mb-2">{t('home:photoSearch.noResults')}</p>
              <button onClick={clearImageResults} className="px-5 py-2 bg-primary text-white rounded-lg text-sm font-semibold hover:bg-primary-dark transition-colors">
                {t('home:photoSearch.clear')}
              </button>
            </div>
          )
        ) : (
          <ListState
            query={searchQuery}
            select={(res) => res.data}
            loading={
              <div className="text-center py-12">
                <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full mx-auto mb-4"></div>
                <p className="text-gray-500 dark:text-gray-400">{t('common:loading')}</p>
              </div>
            }
            empty={
              // Este vacío ya dice lo correcto: "no hay resultados" para los
              // filtros puestos, no "no hay mascotas". Es el estado de filtro
              // sin coincidencias, y se queda tal cual.
              <div className="text-center py-12">
                <Icon name="search" className="mx-auto mb-4 text-5xl text-gray-300 dark:text-gray-600" />
                <p className="text-gray-700 dark:text-gray-300 font-semibold mb-2">{t('home:noResults.title')}</p>
                <p className="text-gray-500 dark:text-gray-400 mb-4">{t('home:noResults.hint')}</p>
                <button onClick={clearFilters} className="px-5 py-2 bg-primary text-white rounded-lg text-sm font-semibold hover:bg-primary-dark transition-colors">
                  {t('home:filters.clear')}
                </button>
              </div>
            }
          >
            {(pets) => (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {pets.map((pet) => (
                  <Link key={pet.id} to={`/pets/${pet.id}`} className="block group">
                    <div className="bg-white dark:bg-gray-900 rounded-2xl overflow-hidden shadow-sm border border-gray-100 dark:border-gray-800 hover:shadow-md transition-shadow">
                      {/* Foto */}
                      <div className="h-48 bg-gray-100 dark:bg-gray-800 relative overflow-hidden">
                        {pet.photos?.[0]?.url ? (
                          <img
                            src={cloudinaryCardThumb(pet.photos[0].url)}
                            alt={pet.name}
                            loading="lazy"
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center"><PawPlaceholder className="w-2/5 max-w-20" /></div>
                        )}
                        <span className={`absolute top-3 left-3 text-xs font-bold text-white px-2.5 py-1 rounded-full ${statusBadgeBg(pet.status)}`}>
                          {t(`pets:status.${pet.status}`).toUpperCase()}
                        </span>
                      </div>
                      {/* Info */}
                      <div className="p-4">
                        <h3 className="font-bold text-gray-900 dark:text-gray-100 text-lg mb-1">{pet.name}</h3>
                        <div className="flex flex-wrap gap-1 mb-2">
                          {pet.type && <span className="text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 px-2 py-0.5 rounded-full">{t(`pets:types.${pet.type}`)}</span>}
                          {pet.breed && <span className="text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 px-2 py-0.5 rounded-full">{pet.breed}</span>}
                          {pet.color && <span className="text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 px-2 py-0.5 rounded-full">{pet.color}</span>}
                        </div>
                        {/* Always reserve the comment height (2 lines) and show a
                            placeholder when empty so every card stays the same height (#19). */}
                        <p
                          className={`text-sm line-clamp-2 min-h-[2.5rem] ${
                            pet.description
                              ? 'text-gray-500 dark:text-gray-400'
                              : 'italic text-gray-400 dark:text-gray-500'
                          }`}
                        >
                          {pet.description || t('pets:card.noComment')}
                        </p>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </ListState>
        )}
      </section>
    </div>
  );
}
