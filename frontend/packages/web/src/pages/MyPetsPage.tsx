import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useMyPets, useDeletePet, useUpdatePet } from '@shared/hooks';
import type { Pet, PetStatus, Photo } from '@shared/types';
import { getErrorMessage } from '@shared/utils/apiErrors';

function SkeletonCard() {
  return (
    <div className="bg-gray-200 dark:bg-gray-700 rounded-xl h-48 animate-pulse" />
  );
}

const STATUS_CONFIG: Record<PetStatus, { labelKey: string; className: string }> = {
  registered: {
    labelKey: 'pets:status.registered',
    className: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400',
  },
  lost: {
    labelKey: 'pets:status.lost',
    className: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
  },
  stray: {
    labelKey: 'pets:status.stray',
    className: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
  },
  found: {
    labelKey: 'pets:status.found',
    className: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
  },
  archived: {
    labelKey: 'pets:status.archived',
    className: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-500',
  },
};

function PetCard({
  pet,
  onDelete,
  confirmingId,
  onRequestConfirm,
}: {
  pet: Pet;
  onDelete: (id: string) => void;
  confirmingId: string | null;
  onRequestConfirm: (id: string | null) => void;
}) {
  const { t } = useTranslation(['pets', 'common']);
  const navigate = useNavigate();
  const updatePet = useUpdatePet();

  const statusCfg = STATUS_CONFIG[pet.status] ?? STATUS_CONFIG.registered;
  const primaryPhoto: Photo | undefined =
    pet.photos?.find((p) => p.is_primary) ?? pet.photos?.[0];

  const typeLabels: Record<string, string> = {
    perro: t('pets:types.dog'),
    gato: t('pets:types.cat'),
    otro: t('pets:types.other'),
    pajaro: t('pets:types.other'),
  };

  const isConfirming = confirmingId === pet.id;
  const [pendingStatus, setPendingStatus] = useState<PetStatus | null>(null);

  const handleStatusChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const next = e.target.value as PetStatus;
    if (next !== pet.status) setPendingStatus(next);
  };

  const confirmStatusChange = () => {
    if (!pendingStatus) return;
    updatePet.mutate(
      { id: pet.id, data: { status: pendingStatus } },
      { onSettled: () => setPendingStatus(null) },
    );
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 flex flex-col overflow-hidden">
      {/* Foto — clickeable al detail */}
      <Link to={`/pets/${pet.id}`} className="block h-40 bg-gray-100 dark:bg-gray-700 relative flex-shrink-0 group">
        {primaryPhoto ? (
          <img
            src={primaryPhoto.url}
            alt={pet.name}
            className="w-full h-full object-cover group-hover:opacity-90 transition-opacity"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-4xl">🐾</div>
        )}
        <span className={`absolute top-2 right-2 text-xs font-medium px-2 py-0.5 rounded-full ${statusCfg.className}`}>
          {t(statusCfg.labelKey)}
        </span>
        <span className="absolute bottom-2 left-2 text-xs font-medium px-2 py-0.5 rounded-full bg-black/60 text-white">
          📷 {t('pets:mine.photoCount', { current: pet.photos?.length ?? 0 })}
        </span>
      </Link>

      {/* Contenido */}
      <div className="p-4 flex flex-col gap-3 flex-1">
        <div>
          <Link to={`/pets/${pet.id}`} className="hover:text-primary transition-colors">
            <h3 className="font-semibold text-gray-900 dark:text-gray-50 text-base leading-tight">
              {pet.name}
            </h3>
          </Link>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {typeLabels[pet.type] ?? pet.type}
          </p>
        </div>

        {pet.description && (
          <p className="text-sm text-gray-600 dark:text-gray-300 line-clamp-2">
            {pet.description}
          </p>
        )}

        <div className="mt-auto space-y-2">
          {/* Acciones principales */}
          <div className="grid grid-cols-2 gap-2">
            <Link
              to={`/pets/${pet.id}/edit`}
              className="text-center text-sm font-medium rounded-lg px-3 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              {t('pets:mine.edit')}
            </Link>
            <button
              onClick={() => navigate(`/reports/create?petId=${pet.id}&status=lost`)}
              className="text-sm font-medium rounded-lg px-3 py-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors"
            >
              {t('pets:mine.reportLost')}
            </button>
          </div>

          {/* Cambiar estado */}
          <select
            value={pendingStatus ?? pet.status}
            onChange={handleStatusChange}
            disabled={updatePet.isPending}
            className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-60"
            aria-label={t('pets:mine.changeStatus')}
          >
            <option value="registered">{t('pets:status.registered')}</option>
            <option value="lost">{t('pets:status.lost')}</option>
            <option value="stray">{t('pets:status.stray')}</option>
            <option value="found">{t('pets:status.found')}</option>
            <option value="archived">{t('pets:status.archived')}</option>
          </select>

          {/* Status change confirmation */}
          {pendingStatus && (
            <div className="flex gap-2 p-2 bg-amber-50 dark:bg-amber-950 rounded-lg border border-amber-200 dark:border-amber-800">
              <button
                onClick={confirmStatusChange}
                disabled={updatePet.isPending}
                className="flex-1 bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold rounded-md px-2 py-1.5 transition-colors disabled:opacity-60"
              >
                {t('common:confirm')}
              </button>
              <button
                onClick={() => setPendingStatus(null)}
                className="flex-1 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 text-xs font-semibold rounded-md px-2 py-1.5 transition-colors"
              >
                {t('common:cancel')}
              </button>
            </div>
          )}

          {/* Delete / confirm */}
          {isConfirming ? (
            <div className="flex gap-2">
              <button
                onClick={() => onDelete(pet.id)}
                className="flex-1 bg-red-500 hover:bg-red-600 text-white text-sm font-medium rounded-lg px-3 py-2 transition-colors"
              >
                {t('common:confirm')}
              </button>
              <button
                onClick={() => onRequestConfirm(null)}
                className="flex-1 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-lg px-3 py-2 transition-colors"
              >
                {t('common:cancel')}
              </button>
            </div>
          ) : (
            <button
              onClick={() => onRequestConfirm(pet.id)}
              className="w-full bg-gray-100 dark:bg-gray-700 hover:bg-red-100 dark:hover:bg-red-900/30 text-gray-700 dark:text-gray-300 hover:text-red-600 dark:hover:text-red-400 text-sm font-medium rounded-lg px-3 py-2 transition-colors"
            >
              {t('pets:mine.delete')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function MyPetsPage() {
  const { t } = useTranslation(['pets', 'common']);
  const { data: pets, isLoading } = useMyPets();
  const deletePet = useDeletePet();
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleDelete = (id: string) => {
    setDeleteError(null);
    deletePet.mutate(id, {
      onSuccess: () => {
        setConfirmingId(null);
      },
      onError: (err) => {
        setConfirmingId(null);
        setDeleteError(getErrorMessage(err, t));
      },
    });
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 py-10 px-4">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-50">
            {t('pets:mine.title')}
          </h1>
          <Link
            to="/pets/create"
            className="inline-flex items-center gap-2 bg-primary hover:bg-primary-dark text-white font-semibold rounded-lg px-4 py-2 text-sm transition-colors"
          >
            + {t('pets:mine.add')}
          </Link>
        </div>

        {deleteError && (
          <p className="text-red-500 dark:text-red-400 text-sm mb-4">{deleteError}</p>
        )}

        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </div>
        ) : !pets || pets.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-gray-500 dark:text-gray-400 mb-4">
              {t('pets:mine.empty')}
            </p>
            <Link
              to="/pets/create"
              className="inline-block bg-primary hover:bg-primary-dark text-white font-semibold rounded-lg px-6 py-2 transition-colors"
            >
              {t('pets:mine.emptyAction')}
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {pets.map((pet) => (
              <PetCard
                key={pet.id}
                pet={pet}
                onDelete={handleDelete}
                confirmingId={confirmingId}
                onRequestConfirm={setConfirmingId}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
