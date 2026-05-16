import { useState } from 'react';
import { Link } from 'react-router';
import { useLeaderboard } from '@shared/hooks';
import type { LeaderboardEntry } from '@shared/types';

const BADGE_LABELS: Record<string, { emoji: string; label: string }> = {
  first_helper: { emoji: '🤝', label: 'Primer Ayudante' },
  pet_rescuer: { emoji: '🦸', label: 'Rescatador' },
  social_butterfly: { emoji: '📣', label: 'Social' },
  verified_finder: { emoji: '✓', label: 'Verificado' },
};

const MEDAL: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' };

function LeaderboardRow({ entry }: { entry: LeaderboardEntry }) {
  const medal = MEDAL[entry.rank];
  return (
    <Link
      to={`/users/${entry.user_id}`}
      className="flex items-center gap-4 p-4 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 hover:border-primary/40 hover:shadow-sm transition-all"
    >
      {/* Rank */}
      <div className="w-10 text-center flex-shrink-0">
        {medal ? (
          <span className="text-2xl">{medal}</span>
        ) : (
          <span className="text-lg font-bold text-gray-400 dark:text-gray-500">#{entry.rank}</span>
        )}
      </div>

      {/* Avatar placeholder */}
      <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-lg flex-shrink-0">
        {entry.name.charAt(0).toUpperCase()}
      </div>

      {/* Name + city */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-900 dark:text-gray-50 truncate">{entry.name}</p>
        {entry.city && (
          <p className="text-xs text-gray-400 dark:text-gray-500 truncate">{entry.city}</p>
        )}
      </div>

      {/* Points */}
      <div className="flex-shrink-0 text-right">
        <p className="text-sm font-bold text-primary">{entry.total_points}</p>
        <p className="text-xs text-gray-400 dark:text-gray-500">pts</p>
      </div>
    </Link>
  );
}

export function LeaderboardPage() {
  const [city, setCity] = useState('');
  const [inputCity, setInputCity] = useState('');

  const { data: entries, isLoading, error } = useLeaderboard(city, 20);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setCity(inputCity.trim());
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 py-10 px-4">
      <div className="max-w-2xl mx-auto">

        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-50 mb-2">
            🏆 Leaderboard
          </h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm">
            Los mejores helpers de tu ciudad
          </p>
        </div>

        {/* Buscador de ciudad */}
        <form onSubmit={handleSearch} className="flex gap-2 mb-6">
          <input
            type="text"
            value={inputCity}
            onChange={(e) => setInputCity(e.target.value)}
            placeholder="Ingresá tu ciudad (ej: Montevideo)"
            className="flex-1 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <button
            type="submit"
            className="px-5 py-2 bg-primary hover:bg-primary-dark text-white font-semibold rounded-lg text-sm transition-colors"
          >
            Buscar
          </button>
        </form>

        {/* Badge legend */}
        <div className="flex flex-wrap gap-2 mb-6">
          {Object.entries(BADGE_LABELS).map(([key, { emoji, label }]) => (
            <span
              key={key}
              className="inline-flex items-center gap-1 text-xs bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 px-2.5 py-1 rounded-full"
            >
              {emoji} {label}
            </span>
          ))}
        </div>

        {/* Estado vacío — sin ciudad */}
        {!city && (
          <div className="text-center py-16 text-gray-400 dark:text-gray-500">
            <p className="text-4xl mb-3">🏙️</p>
            <p className="text-sm">Ingresá una ciudad para ver el ranking</p>
          </div>
        )}

        {/* Loading */}
        {city && isLoading && (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-16 rounded-xl bg-gray-200 dark:bg-gray-800 animate-pulse" />
            ))}
          </div>
        )}

        {/* Error */}
        {city && error && (
          <div className="text-center py-10 text-gray-400 dark:text-gray-500">
            <p className="text-3xl mb-2">⚠️</p>
            <p className="text-sm">No se pudo cargar el leaderboard.</p>
          </div>
        )}

        {/* Resultados */}
        {city && !isLoading && entries && entries.length === 0 && (
          <div className="text-center py-16 text-gray-400 dark:text-gray-500">
            <p className="text-4xl mb-3">🔍</p>
            <p className="text-sm">No hay usuarios en <strong>{city}</strong> todavía.</p>
            <p className="text-xs mt-1">¡Sé el primero en reportar mascotas ahí!</p>
          </div>
        )}

        {city && !isLoading && entries && entries.length > 0 && (
          <div className="space-y-2">
            {entries.map((entry: LeaderboardEntry) => (
              <LeaderboardRow key={entry.user_id} entry={entry} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
