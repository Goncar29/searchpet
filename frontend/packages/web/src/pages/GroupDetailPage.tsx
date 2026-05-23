import { useParams, useNavigate } from 'react-router';
import { useGroup, useGroupMembers, useJoinGroup, useLeaveGroup } from '@shared/hooks';
import { useAuth } from '../context/AuthContext';
import type { GroupMember } from '@shared/types';

// ============================================================
// Helpers
// ============================================================

function getInitials(name: string): string {
  return name.trim().charAt(0).toUpperCase();
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('es-UY', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

// ============================================================
// Member Card
// ============================================================

function MemberCard({ member }: { member: GroupMember }) {
  return (
    <div className="flex items-center gap-3 p-3 bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-700">
      {member.profile_photo_url ? (
        <img
          src={member.profile_photo_url}
          alt={member.name}
          className="w-10 h-10 rounded-full object-cover flex-shrink-0"
        />
      ) : (
        <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-lg flex-shrink-0">
          {getInitials(member.name)}
        </div>
      )}
      <div className="min-w-0">
        <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
          {member.name}
        </p>
        <p className="text-xs text-gray-400 dark:text-gray-500">
          Miembro desde {formatDate(member.joined_at)}
        </p>
      </div>
    </div>
  );
}

// ============================================================
// GroupDetailPage
// ============================================================

export function GroupDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { isAuthenticated } = useAuth();

  const { data: group, isLoading: groupLoading, isError: groupError } = useGroup(id ?? '');
  const { data: members, isLoading: membersLoading } = useGroupMembers(id ?? '');
  const joinMutation = useJoinGroup(id ?? '');
  const leaveMutation = useLeaveGroup(id ?? '');

  const isPending = joinMutation.isPending || leaveMutation.isPending;

  const handleJoin = () => {
    if (!isAuthenticated) {
      navigate('/login');
      return;
    }
    joinMutation.mutate();
  };

  const handleLeave = () => {
    leaveMutation.mutate();
  };

  // Loading
  if (groupLoading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-gray-500 dark:text-gray-400">Cargando grupo...</p>
        </div>
      </div>
    );
  }

  // Not found / error
  if (groupError || !group) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center px-4">
        <div className="text-center">
          <p className="text-5xl mb-4">🔍</p>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-2">
            Grupo no encontrado
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mb-6">
            Este grupo no existe o fue eliminado.
          </p>
          <button
            onClick={() => navigate('/groups')}
            className="px-5 py-2 rounded-xl border border-primary text-primary text-sm font-semibold hover:bg-primary/5 transition-colors"
          >
            Ver todos los grupos
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 py-10 px-4">
      <div className="max-w-3xl mx-auto">

        {/* Back link */}
        <button
          onClick={() => navigate('/groups')}
          className="flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400 hover:text-primary mb-6 transition-colors"
        >
          ← Volver a grupos
        </button>

        {/* Group header card */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-6 mb-6">
          <div className="flex items-start justify-between gap-4 mb-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <span className="text-xl">📍</span>
                <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                  {group.city}
                </h1>
                {group.is_member && (
                  <span className="text-xs font-semibold text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                    Sos miembro
                  </span>
                )}
              </div>
              <p className="text-sm text-gray-400 dark:text-gray-500">
                {group.member_count} {group.member_count === 1 ? 'miembro' : 'miembros'}
              </p>
            </div>

            <button
              onClick={group.is_member ? handleLeave : handleJoin}
              disabled={isPending}
              className={[
                'flex-shrink-0 px-5 py-2 rounded-xl text-sm font-semibold transition-colors disabled:opacity-60',
                group.is_member
                  ? 'border border-red-500 text-red-500 hover:bg-red-50 dark:hover:bg-red-950'
                  : 'bg-primary text-white hover:bg-primary/90',
              ].join(' ')}
            >
              {isPending ? '...' : group.is_member ? 'Salir del grupo' : 'Unirse al grupo'}
            </button>
          </div>

          {group.description && (
            <p className="text-gray-600 dark:text-gray-300 leading-relaxed">
              {group.description}
            </p>
          )}
        </div>

        {/* Members section */}
        <div>
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-4">
            👥 Miembros
          </h2>

          {membersLoading ? (
            <div className="text-center py-8">
              <div className="animate-spin h-6 w-6 border-4 border-primary border-t-transparent rounded-full mx-auto mb-3" />
              <p className="text-gray-400 dark:text-gray-500 text-sm">Cargando miembros...</p>
            </div>
          ) : !members || members.length === 0 ? (
            <div className="text-center py-10">
              <p className="text-4xl mb-3">🤷</p>
              <p className="text-gray-600 dark:text-gray-400 font-medium">
                Este grupo aún no tiene miembros
              </p>
              {!group.is_member && (
                <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">
                  ¡Sé el primero en unirte!
                </p>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {members.map((member: GroupMember) => (
                <MemberCard key={member.user_id} member={member} />
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
