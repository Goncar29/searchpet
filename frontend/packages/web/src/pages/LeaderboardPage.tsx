import { useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useLeaderboard } from '@shared/hooks';
import { BADGE_META } from '@shared/types';
import type { LeaderboardEntry } from '@shared/types';

const MEDAL: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' };

function LeaderboardRow({ entry }: { entry: LeaderboardEntry }) {
  const { t } = useTranslation('leaderboard');
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

      {/* Badges */}
      {entry.badges && entry.badges.length > 0 && (
        <div className="flex items-center gap-0.5 flex-shrink-0">
          {entry.badges.map((badgeType) => {
            const meta = BADGE_META[badgeType];
            if (!meta) return null;
            return (
              <span key={badgeType} title={t(meta.labelKey)} className="text-base leading-none">
                {meta.emoji}
              </span>
            );
          })}
        </div>
      )}

      {/* Points */}
      <div className="flex-shrink-0 text-right">
        <p className="text-sm font-bold text-primary">{entry.total_points}</p>
        <p className="text-xs text-gray-400 dark:text-gray-500">{t('leaderboard:pts')}</p>
      </div>
    </Link>
  );
}

export function LeaderboardPage() {
  const { t } = useTranslation('leaderboard');
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
            🏆 {t('leaderboard:title')}
          </h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm">
            {t('leaderboard:subtitle')}
          </p>
        </div>

        {/* Buscador de ciudad */}
        <form onSubmit={handleSearch} className="flex gap-2 mb-6">
          <input
            type="text"
            value={inputCity}
            onChange={(e) => setInputCity(e.target.value)}
            placeholder={t('leaderboard:searchPlaceholder')}
            className="flex-1 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <button
            type="submit"
            className="px-5 py-2 bg-primary hover:bg-primary-dark text-white font-semibold rounded-lg text-sm transition-colors"
          >
            {t('leaderboard:searchButton')}
          </button>
        </form>

        {/* Achievements — what the badges mean and how to earn them */}
        <div className="mb-8 p-4 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700">
          <h2 className="text-sm font-bold text-gray-900 dark:text-gray-50 mb-1">
            🏅 {t('badges:achievementsTitle')}
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
            {t('badges:achievementsSubtitle')}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {Object.entries(BADGE_META).map(([key, meta]) => (
              <div key={key} className="flex items-start gap-2.5">
                <span className="text-xl leading-none mt-0.5">{meta.emoji}</span>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-gray-800 dark:text-gray-200">{t(meta.labelKey)}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{t(meta.howToEarnKey)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Estado vacío — sin ciudad */}
        {!city && (
          <div className="text-center py-16 text-gray-400 dark:text-gray-500">
            <p className="text-4xl mb-3">🏙️</p>
            <p className="text-sm">{t('leaderboard:enterCity')}</p>
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
            <p className="text-sm">{t('leaderboard:loadError')}</p>
          </div>
        )}

        {/* Resultados */}
        {city && !isLoading && entries && entries.length === 0 && (
          <div className="text-center py-16 text-gray-400 dark:text-gray-500">
            <p className="text-4xl mb-3">🔍</p>
            <p className="text-sm">{t('leaderboard:empty', { city })}</p>
            <p className="text-xs mt-1">{t('leaderboard:emptyHint')}</p>
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
