import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useMyPets } from '@shared/hooks';
import { useAuth } from '../../context/AuthContext';
import type { Pet, Photo } from '@shared/types';
import { PawPlaceholder } from '../PawPlaceholder';

interface LostPetStepProps {
  onSelect: (pet: Pet) => void;
}

export function LostPetStep({ onSelect }: LostPetStepProps) {
  const { t } = useTranslation(['publish', 'pets']);
  const { isAuthenticated } = useAuth();
  const { data: pets, isLoading } = useMyPets(isAuthenticated);

  const eligiblePets = (pets ?? []).filter((pet) => pet.status === 'registered');

  if (isLoading) {
    return <p className="text-center text-gray-500 dark:text-gray-400">{t('common:loading')}</p>;
  }

  if (eligiblePets.length === 0) {
    return (
      <div className="text-center bg-white dark:bg-gray-900 rounded-2xl p-8">
        <p className="text-gray-700 dark:text-gray-300 mb-4">{t('lostPet.empty')}</p>
        <Link
          to="/pets/create"
          className="inline-flex items-center justify-center px-6 py-2 bg-primary hover:bg-primary-dark text-white font-semibold rounded-lg transition-colors"
        >
          {t('lostPet.emptyAction')}
        </Link>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-50 mb-6 text-center">
        {t('lostPet.title')}
      </h1>
      <ul className="space-y-3">
        {eligiblePets.map((pet) => {
          const primaryPhoto: Photo | undefined =
            pet.photos?.find((p) => p.is_primary) ?? pet.photos?.[0];

          return (
          <li key={pet.id}>
            <button
              type="button"
              onClick={() => onSelect(pet)}
              className="w-full flex items-center gap-4 rounded-xl border border-gray-200 dark:border-gray-700 hover:border-primary p-4 bg-white dark:bg-gray-900 transition-colors text-left"
            >
              {primaryPhoto ? (
                <img
                  src={primaryPhoto.url}
                  alt={pet.name}
                  className="h-14 w-14 rounded-lg object-cover flex-shrink-0"
                />
              ) : (
                <div className="h-14 w-14 rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center flex-shrink-0">
                  <PawPlaceholder className="w-7" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-gray-900 dark:text-gray-50 truncate">{pet.name}</p>
                <p className="text-sm text-gray-500 dark:text-gray-400">{t(`pets:types.${pet.type}`)}</p>
              </div>
              <span className="text-primary font-semibold text-sm whitespace-nowrap">{t('lostPet.select')}</span>
            </button>
          </li>
          );
        })}
      </ul>
    </div>
  );
}
