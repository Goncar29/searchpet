import { Link } from 'react-router';
import { useState, useRef, useCallback, useEffect, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useStats, useSearchPets, useStories, useImageClassify, useImageSearch } from '@shared/hooks';
import { statusBadgeBg } from '../utils/statusBadge';
import type { Pet, PetType, PetStatus, SuccessStory, ClassifyResult, ImageSearchResult } from '@shared/types';
import { getErrorMessage } from '@shared/utils/apiErrors';
import { startOfDayISO, endOfDayISO } from '@shared/utils/dateFilters';
import { ApiError } from '@shared/api/client';
import { useAuth } from '../context/AuthContext';

// Montevideo default center for the optional distance filter.
const DEFAULT_LAT = -34.9011;
const DEFAULT_LNG = -56.1645;

const PET_TYPES: { value: PetType; label: string; icon: string }[] = [
  { value: 'perro', label: 'Perro', icon: '🐕' },
  { value: 'gato', label: 'Gato', icon: '🐱' },
  { value: 'pajaro', label: 'Pájaro', icon: '🐦' },
  { value: 'otro', label: 'Otro', icon: '🐾' },
];

// Only feed-visible statuses are offered. `registered`/`archived` are private
// and are rejected by the public search endpoint, so they must not be options.
const PET_STATUSES: { value: PetStatus; label: string }[] = [
  { value: 'lost', label: 'Perdidos' },
  { value: 'stray', label: 'Callejeros' },
  { value: 'found', label: 'Encontrados' },
];

export function HomePage() {
  const { t } = useTranslation(['home', 'common', 'pets']);
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
  const { data: searchResults, isLoading } = useSearchPets({
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

  return (
    <div className="bg-gray-50 dark:bg-gray-950 min-h-screen">
      {/* Hero Section */}
      <section className="bg-gradient-to-br from-primary to-primary-dark text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 text-center">
          <h1 className="text-4xl md:text-5xl font-extrabold mb-4">
            {t('home:hero.title')}
          </h1>
          <p className="text-lg md:text-xl text-white/80 max-w-2xl mx-auto mb-8">
            {t('home:hero.subtitle')}
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              to="/map"
              className="inline-flex items-center justify-center px-8 py-3 bg-white text-primary font-bold rounded-lg hover:bg-gray-100 transition-colors"
            >
              {t('home:viewMap')}
            </Link>
            <Link
              to="/publish"
              className="inline-flex items-center justify-center px-8 py-3 border-2 border-white text-white font-bold rounded-lg hover:bg-white/10 transition-colors"
            >
              {t('home:publish')}
            </Link>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 -mt-10">
        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-lg p-6 grid grid-cols-2 md:grid-cols-4 gap-6">
          <div className="text-center">
            <p className="text-3xl font-bold text-primary">{stats?.found_pets || 0}</p>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('home:stats.found')}</p>
          </div>
          <div className="text-center">
            <p className="text-3xl font-bold text-primary">{stats?.total_users || 0}</p>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('home:stats.users')}</p>
          </div>
          <div className="text-center">
            <p className="text-3xl font-bold text-primary">{stats?.total_reports || 0}</p>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('home:stats.reports')}</p>
          </div>
          <div className="text-center">
            <p className="text-3xl font-bold text-primary">{stats?.total_pets || 0}</p>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('home:stats.pets')}</p>
          </div>
        </div>
      </section>

      {/* Cómo funciona */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 text-center mb-10">
          {t('home:how.title')}
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="text-center p-6">
            <div className="text-5xl mb-4">📝</div>
            <h3 className="font-bold text-lg text-gray-900 dark:text-gray-100 mb-2">{t('home:how.step1.title')}</h3>
            <p className="text-gray-500 dark:text-gray-400 text-sm">
              {t('home:how.step1.description')}
            </p>
          </div>
          <div className="text-center p-6">
            <div className="text-5xl mb-4">🗺️</div>
            <h3 className="font-bold text-lg text-gray-900 dark:text-gray-100 mb-2">{t('home:how.step2.title')}</h3>
            <p className="text-gray-500 dark:text-gray-400 text-sm">
              {t('home:how.step2.description')}
            </p>
          </div>
          <div className="text-center p-6">
            <div className="text-5xl mb-4">📱</div>
            <h3 className="font-bold text-lg text-gray-900 dark:text-gray-100 mb-2">{t('home:how.step3.title')}</h3>
            <p className="text-gray-500 dark:text-gray-400 text-sm">
              {t('home:how.step3.description')}
            </p>
          </div>
        </div>
      </section>

      {/* Historias de éxito */}
      {featuredStories && featuredStories.length > 0 && (
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              Historias de éxito
            </h2>
            <Link
              to="/stories"
              className="text-sm font-semibold text-primary hover:text-primary-dark transition-colors"
            >
              Ver todas →
            </Link>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {featuredStories.map((story: SuccessStory) => (
              <Link
                key={story.id}
                to="/stories"
                className="block bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-5 hover:shadow-md transition-shadow"
              >
                <p className="text-sm font-bold text-primary mb-1">{story.pet_name}</p>
                <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-2 line-clamp-1">
                  {story.title || story.pet_name}
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-300 line-clamp-2 mb-3">
                  {story.body}
                </p>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-400 dark:text-gray-500">
                    {new Date(story.created_at).toLocaleDateString()}
                  </span>
                  <span className="text-xs text-gray-500 dark:text-gray-400">❤️ {story.like_count}</span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Buscar por foto */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8">
        <div className="bg-gradient-to-r from-primary/5 to-blue-50 dark:from-primary/10 dark:to-gray-900 rounded-2xl border border-primary/20 dark:border-primary/30 p-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-5">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-2xl">📷</span>
                <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">
                  Buscar por foto
                </h2>
                <span className="text-xs font-bold bg-primary/15 text-primary px-2 py-0.5 rounded-full">IA</span>
                <span className="text-xs font-semibold bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 px-2 py-0.5 rounded-full">Beta</span>
              </div>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Subí una foto y detectamos automáticamente la raza y el tipo de mascota.
              </p>
              {classifyResult?.type && (
                <div className="mt-3 flex items-center gap-2 flex-wrap">
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 text-sm font-semibold bg-primary/10 text-primary border border-primary/20 rounded-full">
                    ✓ {classifyResult.breed ?? classifyResult.type} · {Math.round(classifyResult.confidence * 100)}%
                  </span>
                  <button
                    type="button"
                    onClick={() => { setClassifyResult(null); clearFilters(); }}
                    className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
                  >
                    Limpiar ✕
                  </button>
                </div>
              )}
              {photoNoMatch && (
                <div className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs text-yellow-700 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-700 rounded-full">
                  No se detectó ninguna mascota. Probá con una foto más clara.
                  <button type="button" onClick={() => setPhotoNoMatch(false)} className="ml-0.5 hover:opacity-70">✕</button>
                </div>
              )}
              {imageResults && (
                <div className="mt-3 flex items-center gap-2 flex-wrap">
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 text-sm font-semibold bg-primary/10 text-primary border border-primary/20 rounded-full">
                    ✓ {t('home:photoSearch.resultsTitle')} ({imageResults.length})
                  </span>
                  <button
                    type="button"
                    onClick={clearImageResults}
                    className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
                  >
                    {t('home:photoSearch.clear')} ✕
                  </button>
                </div>
              )}
              {imageSearchError && (
                <div className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs text-yellow-700 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-700 rounded-full">
                  {imageSearchError}
                  <button type="button" onClick={() => setImageSearchError(null)} className="ml-0.5 hover:opacity-70">✕</button>
                </div>
              )}
              {photoLoginPrompt && (
                <Link
                  to="/login"
                  className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-primary bg-primary/10 border border-primary/20 rounded-full hover:bg-primary/15 transition-colors"
                >
                  🔒 {t('home:photoSearch.loginRequired')}
                </Link>
              )}
            </div>
            <div className="flex-shrink-0">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isModelLoading || isClassifying || imageSearchMutation.isPending}
                className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-primary rounded-xl hover:bg-primary-dark disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
              >
                {imageSearchMutation.isPending ? '🔍 Analizando...' : isModelLoading ? '⏳ Cargando...' : isClassifying ? '🔍 Analizando...' : '📷 Subir foto'}
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
        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-800 p-5">
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-4">
            🔍 Filtrar mascotas
          </h2>

          <div className="flex flex-wrap gap-3">
            {/* Tipo */}
            <select
              value={draftType}
              onChange={(e) => setDraftType(e.target.value as PetType | '')}
              aria-label={t('home:filters.type')}
              className="border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="">Todos los tipos</option>
              {PET_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.icon} {t.label}</option>
              ))}
            </select>

            {/* Color */}
            <input
              type="text"
              placeholder="Color (ej: negro, marrón...)"
              aria-label={t('home:filters.color')}
              value={draftColor}
              onChange={(e) => setDraftColor(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !isLocating && handleSearch()}
              className="border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-primary min-w-[180px]"
            />

            {/* Estado */}
            <select
              value={draftStatus}
              onChange={(e) => setDraftStatus(e.target.value as PetStatus | '')}
              aria-label={t('home:filters.status')}
              className="border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="">Perdidos y callejeros</option>
              {PET_STATUSES.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>

            {/* Raza */}
            <input
              type="text"
              placeholder="Raza (ej: Labrador...)"
              aria-label={t('home:filters.breed')}
              value={draftBreed}
              onChange={(e) => setDraftBreed(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !isLocating && handleSearch()}
              className="border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-primary min-w-[180px]"
            />

            {/* Desde */}
            <input
              type="date"
              value={draftFrom}
              onChange={(e) => setDraftFrom(e.target.value)}
              aria-label={t('home:filters.dateFrom')}
              className="border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-primary"
            />

            {/* Hasta */}
            <input
              type="date"
              value={draftTo}
              onChange={(e) => setDraftTo(e.target.value)}
              aria-label={t('home:filters.dateTo')}
              className="border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-primary"
            />

            {/* Distancia (opcional) */}
            <div className="flex flex-col gap-1">
              <select
                value={draftRadius}
                onChange={(e) => setDraftRadius(e.target.value)}
                disabled={isLocating}
                aria-label={t('home:filters.distance')}
                className="border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <option value="">{t('home:distance.any')}</option>
                {[5, 10, 20, 50].map((km) => (
                  <option key={km} value={km}>{t('home:distance.upToKm', { km })}</option>
                ))}
              </select>
              {filterRadius && (
                <span className="text-xs text-gray-400 dark:text-gray-500 px-1">
                  {filterGeoCenter
                    ? t('home:distanceCenter.gps')
                    : t('home:distanceCenter.fallback')}
                </span>
              )}
            </div>
          </div>

          <div className="flex gap-2 mt-4">
            <button
              onClick={handleSearch}
              disabled={isLocating}
              className="px-5 py-2 text-sm font-semibold text-white bg-primary rounded-lg hover:bg-primary-dark disabled:opacity-60 disabled:cursor-wait transition-colors"
            >
              {isLocating ? t('home:distance.locating') : t('home:searchButton')}
            </button>
            {(hasActiveFilters || isLocating) && (
              <button
                onClick={clearFilters}
                className="px-4 py-2 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 border border-gray-200 dark:border-gray-700 rounded-lg transition-colors"
              >
                ✕ Limpiar
              </button>
            )}
          </div>
        </div>
      </section>

      {/* Resultados */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-16">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            {imageResults
              ? `${t('home:photoSearch.resultsTitle')} (${imageResults.length})`
              : hasActiveFilters
              ? `${searchResults?.total ?? searchResults?.data?.length ?? 0} resultado${(searchResults?.total ?? 0) !== 1 ? 's' : ''}`
              : t('home:recentReports')}
          </h2>
          {imageResults ? (
            <button
              onClick={clearImageResults}
              className="px-4 py-2 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 border border-gray-200 dark:border-gray-700 rounded-lg transition-colors"
            >
              {t('home:photoSearch.clear')} ✕
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
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {imageResults.map((result) => (
                <Link key={result.pet_id} to={`/pets/${result.pet_id}`} className="block group">
                  <div className="bg-white dark:bg-gray-900 rounded-2xl overflow-hidden shadow-sm border border-gray-100 dark:border-gray-800 hover:shadow-md transition-shadow">
                    <div className="h-48 bg-gray-100 dark:bg-gray-800 relative overflow-hidden">
                      {result.photo_url ? (
                        <img
                          src={result.photo_url}
                          alt={result.name}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-5xl">🐾</div>
                      )}
                      <span className="absolute top-3 right-3 text-xs font-bold text-white bg-primary px-2 py-1 rounded-md">
                        {t('pets:card.similarityMatch', { percent: Math.round(result.similarity * 100) })}
                      </span>
                    </div>
                    <div className="p-4">
                      <h3 className="font-bold text-gray-900 dark:text-gray-100 text-lg mb-1">{result.name}</h3>
                      {result.type && (
                        <span className="text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 px-2 py-0.5 rounded-full">{result.type}</span>
                      )}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="text-center py-12">
              <p className="text-5xl mb-4">🔍</p>
              <p className="text-gray-700 dark:text-gray-300 font-semibold mb-2">{t('home:photoSearch.noResults')}</p>
              <button onClick={clearImageResults} className="px-5 py-2 bg-primary text-white rounded-lg text-sm font-semibold hover:bg-primary-dark transition-colors">
                {t('home:photoSearch.clear')}
              </button>
            </div>
          )
        ) : isLoading ? (
          <div className="text-center py-12">
            <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full mx-auto mb-4"></div>
            <p className="text-gray-500 dark:text-gray-400">{t('common:loading')}</p>
          </div>
        ) : (
          // ── Resultados de búsqueda (Pet[]) ──
          searchResults?.data && searchResults.data.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {searchResults.data.map((pet: Pet) => (
                <Link key={pet.id} to={`/pets/${pet.id}`} className="block group">
                  <div className="bg-white dark:bg-gray-900 rounded-2xl overflow-hidden shadow-sm border border-gray-100 dark:border-gray-800 hover:shadow-md transition-shadow">
                    {/* Foto */}
                    <div className="h-48 bg-gray-100 dark:bg-gray-800 relative overflow-hidden">
                      {pet.photos?.[0]?.url ? (
                        <img
                          src={pet.photos[0].url}
                          alt={pet.name}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-5xl">🐾</div>
                      )}
                      <span className={`absolute top-3 left-3 text-xs font-bold text-white px-2 py-1 rounded-md ${statusBadgeBg(pet.status)}`}>
                        {t(`pets:status.${pet.status}`).toUpperCase()}
                      </span>
                    </div>
                    {/* Info */}
                    <div className="p-4">
                      <h3 className="font-bold text-gray-900 dark:text-gray-100 text-lg mb-1">{pet.name}</h3>
                      <div className="flex flex-wrap gap-1 mb-2">
                        {pet.type && <span className="text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 px-2 py-0.5 rounded-full">{pet.type}</span>}
                        {pet.breed && <span className="text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 px-2 py-0.5 rounded-full">{pet.breed}</span>}
                        {pet.color && <span className="text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 px-2 py-0.5 rounded-full">{pet.color}</span>}
                      </div>
                      {pet.description && (
                        <p className="text-sm text-gray-500 dark:text-gray-400 line-clamp-2">{pet.description}</p>
                      )}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="text-center py-12">
              <p className="text-5xl mb-4">🔍</p>
              <p className="text-gray-700 dark:text-gray-300 font-semibold mb-2">Sin resultados</p>
              <p className="text-gray-500 dark:text-gray-400 mb-4">Probá con otros filtros</p>
              <button onClick={clearFilters} className="px-5 py-2 bg-primary text-white rounded-lg text-sm font-semibold hover:bg-primary-dark transition-colors">
                Limpiar filtros
              </button>
            </div>
          )
        )}
      </section>
    </div>
  );
}
