import { useBlockedUsers, useUnblockUser } from '@shared/hooks';
import type { BlockedUser } from '@shared/types';

function BlockedUserCard({ item, onUnblock, isPending }: {
  item: BlockedUser;
  onUnblock: (id: string) => void;
  isPending: boolean;
}) {
  const initial = item.name.trim().charAt(0).toUpperCase();
  const date = new Date(item.blocked_at).toLocaleDateString('es-UY', {
    day: 'numeric', month: 'short', year: 'numeric',
  });

  const handleUnblock = () => {
    if (!window.confirm(`¿Querés desbloquear a ${item.name}?`)) return;
    onUnblock(item.blocked_id);
  };

  return (
    <div className="flex items-center gap-4 p-4 bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm">
      <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-lg font-bold text-primary flex-shrink-0">
        {initial}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-900 dark:text-gray-50 truncate">{item.name}</p>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Bloqueado el {date}</p>
      </div>
      <button
        type="button"
        onClick={handleUnblock}
        disabled={isPending}
        className="flex-shrink-0 text-sm font-semibold px-4 py-2 rounded-lg border border-primary text-primary hover:bg-primary/5 transition-colors disabled:opacity-60"
      >
        Desbloquear
      </button>
    </div>
  );
}

export function BlockedUsersPage() {
  const { data: blockedUsers, isLoading, isError } = useBlockedUsers();
  const unblockUser = useUnblockUser();

  const handleUnblock = (userId: string) => {
    unblockUser.mutate(userId);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 py-10 px-4">
        <div className="max-w-lg mx-auto space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 rounded-2xl bg-gray-200 dark:bg-gray-800 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center px-4">
        <div className="text-center">
          <p className="text-5xl mb-4">⚠️</p>
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-50 mb-2">Error al cargar</h2>
          <p className="text-gray-500 dark:text-gray-400 text-sm">
            No se pudo obtener la lista de usuarios bloqueados. Intentá de nuevo más tarde.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 py-10 px-4">
      <div className="max-w-lg mx-auto">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-50 mb-6">
          Usuarios bloqueados
        </h1>

        {(blockedUsers ?? []).length === 0 ? (
          <div className="text-center py-16">
            <p className="text-5xl mb-4">✅</p>
            <h2 className="text-lg font-bold text-gray-900 dark:text-gray-50 mb-2">
              No tenés usuarios bloqueados
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Cuando bloqueés a alguien, aparecerá aquí y podrás desbloquearlo cuando quieras.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {(blockedUsers ?? []).map((item) => (
              <BlockedUserCard
                key={item.id}
                item={item}
                onUnblock={handleUnblock}
                isPending={unblockUser.isPending}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
