import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useGroups, useJoinGroup, useLeaveGroup } from '@shared/hooks';
import { useAuth } from '../context/AuthContext';
import type { LocalGroup } from '@shared/types';

// ============================================================
// Group Card
// ============================================================

interface GroupCardProps {
  group: LocalGroup;
  isAuthenticated: boolean;
  onUnauthenticated: () => void;
}

function GroupCard({ group, isAuthenticated, onUnauthenticated }: GroupCardProps) {
  const joinMutation = useJoinGroup(group.id);
  const leaveMutation = useLeaveGroup(group.id);
  const isPending = joinMutation.isPending || leaveMutation.isPending;

  const handleJoin = () => {
    if (!isAuthenticated) {
      onUnauthenticated();
      return;
    }
    joinMutation.mutate();
  };

  const handleLeave = () => {
    leaveMutation.mutate();
  };

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-5 hover:shadow-md transition-shadow flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-base">📍</span>
            <Link
              to={`/groups/${group.id}`}
              className="text-lg font-bold text-gray-900 dark:text-gray-100 hover:text-primary truncate"
            >
              {group.city}
            </Link>
            {group.is_member && (
              <span className="text-xs font-semibold text-primary bg-primary/10 px-2 py-0.5 rounded-full whitespace-nowrap">
                Miembro
              </span>
            )}
          </div>

          {group.description && (
            <p className="text-sm text-gray-600 dark:text-gray-300 line-clamp-2">
              {group.description}
            </p>
          )}
        </div>

        <button
          onClick={group.is_member ? handleLeave : handleJoin}
          disabled={isPending}
          className={[
            'flex-shrink-0 px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors disabled:opacity-60',
            group.is_member
              ? 'border border-red-500 text-red-500 hover:bg-red-50 dark:hover:bg-red-950'
              : 'bg-primary text-white hover:bg-primary/90',
          ].join(' ')}
        >
          {isPending ? '...' : group.is_member ? 'Salir' : 'Unirse'}
        </button>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-400 dark:text-gray-500">
          {group.member_count} {group.member_count === 1 ? 'miembro' : 'miembros'}
        </p>
        <Link
          to={`/groups/${group.id}`}
          className="text-xs text-primary hover:underline font-medium"
        >
          Ver grupo →
        </Link>
      </div>
    </div>
  );
}

// ============================================================
// GroupsPage
// ============================================================

export function GroupsPage() {
  const navigate = useNavigate();
  const [cityInput, setCityInput] = useState('');
  const [submittedCity, setSubmittedCity] = useState('');

  const { isAuthenticated } = useAuth();

  const { data: groups, isLoading, isError, refetch } = useGroups(submittedCity || undefined);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmittedCity(cityInput.trim());
  };

  const handleUnauthenticated = () => {
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 py-10 px-4">
      <div className="max-w-4xl mx-auto">

        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-50 mb-2">
            👥 Grupos locales
          </h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm">
            Unite a la comunidad de tu ciudad para ayudar a encontrar mascotas
          </p>
        </div>

        {/* City filter */}
        <form onSubmit={handleSearch} className="flex gap-2 mb-8">
          <input
            type="text"
            value={cityInput}
            onChange={(e) => setCityInput(e.target.value)}
            placeholder="Buscar por ciudad..."
            className="flex-1 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
          <button
            type="submit"
            className="px-5 py-2.5 rounded-xl bg-primary text-white text-sm font-semibold hover:bg-primary/90 transition-colors"
          >
            Buscar
          </button>
          {submittedCity && (
            <button
              type="button"
              onClick={() => { setCityInput(''); setSubmittedCity(''); }}
              className="px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-sm text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              Limpiar
            </button>
          )}
        </form>

        {/* Loading */}
        {isLoading && (
          <div className="text-center py-12">
            <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full mx-auto mb-4" />
            <p className="text-gray-500 dark:text-gray-400">Cargando grupos...</p>
          </div>
        )}

        {/* Error */}
        {isError && (
          <div className="text-center py-12">
            <p className="text-4xl mb-3">⚠️</p>
            <p className="text-gray-700 dark:text-gray-300 font-semibold mb-2">Error al cargar grupos</p>
            <button
              onClick={() => refetch()}
              className="text-sm text-primary hover:underline"
            >
              Reintentar
            </button>
          </div>
        )}

        {/* Groups grid */}
        {!isLoading && !isError && groups && groups.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {groups.map((group: LocalGroup) => (
              <GroupCard
                key={group.id}
                group={group}
                isAuthenticated={isAuthenticated}
                onUnauthenticated={handleUnauthenticated}
              />
            ))}
          </div>
        )}

        {/* Empty state */}
        {!isLoading && !isError && (!groups || groups.length === 0) && (
          <div className="text-center py-16">
            <p className="text-5xl mb-4">👥</p>
            <p className="text-gray-700 dark:text-gray-300 font-semibold mb-2">
              {submittedCity
                ? `No encontramos grupos en "${submittedCity}"`
                : 'No hay grupos disponibles todavía'}
            </p>
            <p className="text-gray-500 dark:text-gray-400 text-sm">
              Los grupos se crean cuando la comunidad de una ciudad crece.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
