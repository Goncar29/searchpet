import { useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useMyPets, useDeletePet } from '@shared/hooks';
import type { Pet } from '@shared/types';

function SkeletonCard() {
  return (
    <div className="bg-gray-200 dark:bg-gray-700 rounded-xl h-48 animate-pulse" />
  );
}

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

  const statusLabel =
    pet.status === 'found' ? t('pets:status.found') : t('pets:status.lost');

  const statusClass =
    pet.status === 'found'
      ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
      : 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300';

  const typeLabels: Record<string, string> = {
    perro: t('pets:types.dog'),
    gato: t('pets:types.cat'),
    otro: t('pets:types.other'),
    pajaro: t('pets:types.other'),
  };

  const isConfirming = confirmingId === pet.id;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-5 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold text-gray-900 dark:text-gray-50 text-lg leading-tight">
            {pet.name}
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {typeLabels[pet.type] ?? pet.type}
          </p>
        </div>
        <span className={`text-xs font-medium px-2 py-1 rounded-full whitespace-nowrap ${statusClass}`}>
          {statusLabel}
        </span>
      </div>

      {pet.description && (
        <p className="text-sm text-gray-600 dark:text-gray-300 line-clamp-2">
          {pet.description}
        </p>
      )}

      <div className="mt-auto">
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
  );
}

export function MyPetsPage() {
  const { t } = useTranslation(['pets', 'common']);
  const { data: pets, isLoading } = useMyPets();
  const deletePet = useDeletePet();
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const handleDelete = (id: string) => {
    deletePet.mutate(id, {
      onSuccess: () => {
        setConfirmingId(null);
      },
    });
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 py-10 px-4">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-50 mb-8">
          {t('pets:mine.title')}
        </h1>

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
