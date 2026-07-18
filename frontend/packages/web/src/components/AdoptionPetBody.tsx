// ============================================================
// SearchPet — AdoptionPetBody (web)
// The status-specific detail body for adoption listings, rendered by
// PetDetailPage for `adoption` / `adopted` pets. Isolated from the
// lost-pet body: no report timeline, no "add report", no "mark found".
// ============================================================

import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { Pet } from '@shared/types';
import { useAuth } from '../context/AuthContext';
import { RevealContact } from './RevealContact';
import { SharePanel } from './SharePanel';
import { PdfFlyerButton } from './PdfFlyerButton';

interface AdoptionPetBodyProps {
  pet: Pet;
}

export function AdoptionPetBody({ pet }: AdoptionPetBodyProps) {
  const { t } = useTranslation(['pets', 'adoption', 'common']);
  const { user, isAuthenticated } = useAuth();

  // Resolved: the pet has a home. Celebratory record, no contact/share.
  if (pet.status === 'adopted') {
    return (
      <div
        data-testid="adopted-banner"
        className="bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-xl p-6 mb-6 text-center"
      >
        <div className="text-4xl mb-2">🎉</div>
        <h3 className="font-bold text-green-800 dark:text-green-200">
          {t('adoption:detail.adoptedTitle', { name: pet.name })}
        </h3>
        <p className="text-sm text-green-700 dark:text-green-300 mt-1">
          {t('adoption:detail.adoptedSubtitle')}
        </p>
      </div>
    );
  }

  // Available for adoption.
  const isOwnerViewing = isAuthenticated && user?.id === pet.owner_id;

  return (
    <>
      {pet.owner && (
        <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-4 mb-6">
          <h3 className="font-bold text-gray-900 dark:text-gray-100 mb-3">{t('pets:detail.owner')}</h3>
          <div className="flex items-center gap-3 mb-1">
            <div className="w-12 h-12 bg-gray-200 dark:bg-gray-700 rounded-full flex items-center justify-center text-xl">👤</div>
            <p className="font-semibold text-gray-900 dark:text-gray-100">{pet.owner.name}</p>
          </div>

          {pet.owner.phone && (
            <RevealContact
              phone={pet.owner.phone}
              pet={pet}
              revealLabel={t('pets:detail.revealPhone')}
              contactLabel={t('pets:detail.contact')}
              callLabel={t('pets:detail.callPhone')}
              copyLabel={t('pets:detail.copyNumber')}
              copiedLabel={t('pets:detail.copied')}
            />
          )}

          {/* In-app message — always available to non-owner viewers as the
              primary adoption contact channel (mirrors the owner contact block
              added in PR #95). */}
          {!isOwnerViewing && (
            isAuthenticated ? (
              <Link
                to={`/messages/${pet.owner_id}`}
                className="mt-3 w-full inline-flex items-center justify-center gap-2 bg-primary hover:bg-primary/90 text-white font-bold py-3 rounded-lg transition-colors"
              >
                💬 {t('pets:detail.sendMessage')}
              </Link>
            ) : (
              <Link
                to="/login"
                className="mt-3 w-full inline-flex items-center justify-center gap-2 border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 font-semibold py-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                🔒 {t('pets:detail.loginToContact')}
              </Link>
            )
          )}
        </div>
      )}

      {/* Sharing — spreads the adoption listing. Requires a session (the share
          link endpoint is auth-gated). Any authed user can share. */}
      {isAuthenticated && (
        <div className="flex flex-wrap gap-3 mb-6">
          <SharePanel petId={pet.id} petName={pet.name} pet={pet} />
          <PdfFlyerButton pet={pet} />
        </div>
      )}
    </>
  );
}
