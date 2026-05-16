import { useParams, Link } from 'react-router';
import { usePublicProfile } from '@shared/hooks';
import type { Badge } from '@shared/types';

const BADGE_META: Record<string, { emoji: string; label: string; description: string; color: string }> = {
  first_helper: {
    emoji: '🤝',
    label: 'Primer Ayudante',
    description: 'Creó su primer reporte de avistamiento',
    color: 'bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300',
  },
  pet_rescuer: {
    emoji: '🦸',
    label: 'Rescatador',
    description: 'Ayudó a reunir una mascota con su familia',
    color: 'bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800 text-green-700 dark:text-green-300',
  },
  social_butterfly: {
    emoji: '📣',
    label: 'Social',
    description: 'Compartió reportes en redes sociales',
    color: 'bg-purple-50 dark:bg-purple-950 border-purple-200 dark:border-purple-800 text-purple-700 dark:text-purple-300',
  },
  verified_finder: {
    emoji: '✓',
    label: 'Verificado',
    description: 'Identidad verificada por la plataforma',
    color: 'bg-orange-50 dark:bg-orange-950 border-orange-200 dark:border-orange-800 text-orange-700 dark:text-orange-300',
  },
};

function BadgeCard({ badge }: { badge: Badge }) {
  const meta = BADGE_META[badge.badge_type] ?? {
    emoji: '🏅',
    label: badge.badge_type,
    description: '',
    color: 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300',
  };

  return (
    <div className={`flex items-start gap-3 p-3 rounded-xl border ${meta.color}`}>
      <span className="text-2xl flex-shrink-0">{meta.emoji}</span>
      <div>
        <p className="text-sm font-semibold">{meta.label}</p>
        {meta.description && (
          <p className="text-xs opacity-75 mt-0.5">{meta.description}</p>
        )}
        <p className="text-xs opacity-50 mt-1">
          {new Date(badge.earned_at).toLocaleDateString('es-UY', { day: 'numeric', month: 'short', year: 'numeric' })}
        </p>
      </div>
    </div>
  );
}

function StatPill({ label, value }: { label: string; value: number }) {
  return (
    <div className="text-center">
      <p className="text-2xl font-bold text-gray-900 dark:text-gray-50">{value}</p>
      <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{label}</p>
    </div>
  );
}

export function UserProfilePage() {
  const { id } = useParams<{ id: string }>();
  const { data: profile, isLoading, error } = usePublicProfile(id ?? '');

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 py-10 px-4">
        <div className="max-w-lg mx-auto space-y-4">
          <div className="h-32 rounded-2xl bg-gray-200 dark:bg-gray-800 animate-pulse" />
          <div className="h-24 rounded-2xl bg-gray-200 dark:bg-gray-800 animate-pulse" />
          <div className="h-48 rounded-2xl bg-gray-200 dark:bg-gray-800 animate-pulse" />
        </div>
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center px-4">
        <div className="text-center">
          <p className="text-5xl mb-4">🐾</p>
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-50 mb-2">Perfil no encontrado</h2>
          <p className="text-gray-500 dark:text-gray-400 text-sm mb-6">
            Este usuario no existe o su perfil no está disponible.
          </p>
          <Link
            to="/"
            className="inline-block px-5 py-2 bg-primary hover:bg-primary-dark text-white font-semibold rounded-lg text-sm transition-colors"
          >
            Volver al inicio
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 py-10 px-4">
      <div className="max-w-lg mx-auto space-y-4">

        {/* Header de perfil */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
          <div className="flex items-center gap-4">
            {/* Avatar */}
            {profile.profile_photo_url ? (
              <img
                src={profile.profile_photo_url}
                alt={profile.name}
                className="w-20 h-20 rounded-full object-cover border-2 border-gray-200 dark:border-gray-700 flex-shrink-0"
              />
            ) : (
              <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center text-3xl font-bold text-primary flex-shrink-0">
                {profile.name.charAt(0).toUpperCase()}
              </div>
            )}

            {/* Info */}
            <div className="flex-1 min-w-0">
              <h1 className="text-xl font-bold text-gray-900 dark:text-gray-50 truncate">{profile.name}</h1>
              {profile.city && (
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">📍 {profile.city}</p>
              )}
              <div className="flex items-center gap-2 mt-2">
                <span className="text-lg font-bold text-primary">{profile.total_points}</span>
                <span className="text-xs text-gray-400 dark:text-gray-500">puntos totales</span>
              </div>
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 p-5">
          <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-4">
            Actividad
          </h2>
          <div className="grid grid-cols-3 divide-x divide-gray-100 dark:divide-gray-800">
            <StatPill label="Reportes" value={profile.total_reports} />
            <StatPill label="Reunidos" value={profile.found_count} />
            <StatPill label="Compartidos" value={profile.share_count} />
          </div>
        </div>

        {/* Badges */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 p-5">
          <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-4">
            Logros ({profile.badges.length})
          </h2>
          {profile.badges.length === 0 ? (
            <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-4">
              Aún no tiene logros desbloqueados.
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {profile.badges.map((badge: Badge) => (
                <BadgeCard key={badge.id} badge={badge} />
              ))}
            </div>
          )}
        </div>

        {/* Link al leaderboard */}
        <div className="text-center">
          <Link
            to="/leaderboard"
            className="text-sm text-primary hover:text-primary-dark font-medium transition-colors"
          >
            Ver ranking por ciudad →
          </Link>
        </div>
      </div>
    </div>
  );
}
