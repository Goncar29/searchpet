import { Link } from 'react-router';
import { useState, useRef, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useStats, useNearbyReports, useSearchPets, useStories, useImageClassify, useImageSearch } from '@shared/hooks';
import type { Report, Pet, PetType, PetStatus, SuccessStory, ClassifyResult, ImageSearchResult } from '@shared/types';
import { getErrorMessage } from '@shared/utils/apiErrors';
import { ApiError } from '@shared/api/client';
import { useAuth } from '../context/AuthContext';
import { PetCardWeb } from '../components/PetCardWeb';

const PET_TYPES: { value: PetType; label: string; icon: string }[] = [
  { value: 'perro', label: 'Perro', icon: '🐕' },
  { value: 'gato', label: 'Gato', icon: '🐱' },
  { value: 'pajaro', label: 'Pájaro', icon: '🐦' },
  { value: 'otro', label: 'Otro', icon: '🐾' },
];

const PET_STATUSES: { value: PetStatus; label: string }[] = [
  { value: 'lost', label: 'Perdidos' },
  { value: 'stray', label: 'Callejeros' },
  { value: 'found', label: 'Encontrados' },
  { value: 'registered', label: 'Registrados' },
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

  // ── Applied filters (sent to the API — only updated on explicit search) ──
  const [filterType, setFilterType] = useState<PetType | ''>('');
  const [filterColor, setFilterColor] = useState('');
  const [filterStatus, setFilterStatus] = useState<PetStatus | ''>('');
  const [filterBreed, setFilterBreed] = useState('');
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');

  // Feed is always shown on load; nearby-reports mode activates only after explicit clear.
  const [showFeed, setShowFeed] = useState(true);
  const isSearchMode = showFeed || !!filterType || filterColor.trim().length > 0 || !!filterStatus
    || filterBreed.trim().length > 0 || !!filterFrom || !!filterTo;

  const handleSearch = () => {
    // A new filter search replaces any active photo-search results
    setImageResults(null);
    setImageSearchError(null);
    setShowFeed(true);
    setFilterType(draftType);
    setFilterColor(draftColor);
    setFilterStatus(draftStatus);
    setFilterBreed(draftBreed);
    setFilterFrom(draftFrom);
    setFilterTo(draftTo);
  };

  const clearFilters = () => {
    setShowFeed(false);
    setFilterType('');
    setFilterColor('');
    setFilterStatus('');
    setFilterBreed('');
    setFilterFrom('');
    setFilterTo('');
    setDraftType('');
    setDraftColor('');
    setDraftStatus('');
    setDraftBreed('');
    setDraftFrom('');
    setDraftTo('');
    setClassifyResult(null);
    setPhotoNoMatch(false);
    setImageResults(null);
    setImageSearchError(null);
  };

  const [nearbyRadius, setNearbyRadius] = useState(20);

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
    setImageSearchError(null);

    if (isAuthenticated) {
      try {
        const response = await imageSearchMutation.mutateAsync(file);
        setImageResults(response.results);
        setClassifyResult(null);
        e.target.value = '';
        return;
      } catch (err) {
        // image_search_unavailable (503, e.g. HuggingFace down) falls back silently —
        // any other error (network, 4xx) is surfaced to the user.
        const isUnavailable = err instanceof ApiError && err.code === 'image_search_unavailable';
        if (!isUnavailable) {
          setImageSearchError(getErrorMessage(err, t));
        }
      }
    }

    await runClassifierFallback(file);
    e.target.value = '';
  };

  // ── Datos ──
  const { data: reports, isLoading: nearbyLoading } = useNearbyReports(-34.9011, -56.1645, nearbyRadius, !isSearchMode);
  const { data: searchResults, isLoading: searchLoading } = useSearchPets({
    type: filterType || undefined,
    color: filterColor.trim() || undefined,
    status: filterStatus || undefined,
    breed: filterBreed.trim() || undefined,
    from: filterFrom ? new Date(filterFrom).toISOString() : undefined,
    to: filterTo ? new Date(filterTo).toISOString() : undefined,
  });

  const isLoading = isSearchMode ? searchLoading : nearbyLoading;

  // Modo nearby: dedup por pet, ordenado por fecha DESC
  const uniqueReports = [...(reports ?? [])]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .reduce((acc: Report[], report: Report) => {
      const petId = report.pet?.id || report.pet_id;
      if (!acc.some(r => (r.pet?.id || r.pet_id) === petId)) acc.push(report);
      return acc;
    }, []);

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
              to={isAuthenticated ? '/pets/create' : '/register'}
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
              value={draftColor}
              onChange={(e) => setDraftColor(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              className="border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-primary min-w-[180px]"
            />

            {/* Estado */}
            <select
              value={draftStatus}
              onChange={(e) => setDraftStatus(e.target.value as PetStatus | '')}
              className="border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="">Perdidos y encontrados</option>
              {PET_STATUSES.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>

            {/* Raza */}
            <input
              type="text"
              placeholder="Raza (ej: Labrador...)"
              value={draftBreed}
              onChange={(e) => setDraftBreed(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              className="border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-primary min-w-[180px]"
            />

            {/* Desde */}
            <input
              type="date"
              value={draftFrom}
              onChange={(e) => setDraftFrom(e.target.value)}
              className="border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-primary"
            />

            {/* Hasta */}
            <input
              type="date"
              value={draftTo}
              onChange={(e) => setDraftTo(e.target.value)}
              className="border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-primary"
            />

            {/* Radio (solo en modo nearby) */}
            {!isSearchMode && (
              <select
                value={nearbyRadius}
                onChange={(e) => setNearbyRadius(Number(e.target.value))}
                className="border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-primary"
              >
                {[5, 10, 20, 50].map((km) => (
                  <option key={km} value={km}>{km} km</option>
                ))}
              </select>
            )}
          </div>

          <div className="flex gap-2 mt-4">
            <button
              onClick={handleSearch}
              className="px-5 py-2 text-sm font-semibold text-white bg-primary rounded-lg hover:bg-primary-dark transition-colors"
            >
              Buscar
            </button>
            {isSearchMode && (
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
              : isSearchMode
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
          ) : isSearchMode && (
            <span className="text-sm text-gray-500 dark:text-gray-400">
              Búsqueda activa
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
        ) : isSearchMode ? (
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
                      <span className={`absolute top-3 left-3 text-xs font-bold text-white px-2 py-1 rounded-md ${
                        pet.status === 'lost' ? 'bg-red-500' :
                        pet.status === 'stray' ? 'bg-amber-500' :
                        pet.status === 'found' ? 'bg-green-500' :
                        pet.status === 'archived' ? 'bg-gray-400' :
                        'bg-gray-500'
                      }`}>
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
        ) : (
          // ── Feed nearby (Report[]) ──
          uniqueReports && uniqueReports.length > 0 ? (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {uniqueReports.slice(0, 6).map((report: Report) => (
                  <PetCardWeb key={report.id} report={report} />
                ))}
              </div>
              {reports && reports.length > 6 && (
                <div className="text-center mt-8">
                  <Link
                    to="/map"
                    className="inline-flex items-center px-6 py-3 bg-primary text-white font-semibold rounded-lg hover:bg-primary-dark transition-colors"
                  >
                    {t('home:viewAll')}
                  </Link>
                </div>
              )}
            </>
          ) : (
            <div className="text-center py-12">
              <p className="text-5xl mb-4">🐾</p>
              <p className="text-gray-500 dark:text-gray-400">{t('home:noReports')}</p>
            </div>
          )
        )}
      </section>
    </div>
  );
}
