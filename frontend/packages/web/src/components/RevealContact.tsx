// ============================================================
// SearchPet — RevealContact (Web)
// Anti-scraping reveal-on-click for a contact phone. The raw number and the
// wa.me link are kept OUT of the DOM until the user clicks "reveal", which
// blunts trivial bot scraping while staying zero-friction for real finders.
// ============================================================

import { useState } from 'react';
import type { Pet } from '@shared/types';
import { buildWhatsAppContactURL } from '@shared/utils/whatsappTemplates';

interface RevealContactProps {
  phone: string;
  pet: Pet;
  revealLabel: string;
  contactLabel: string;
}

export function RevealContact({ phone, pet, revealLabel, contactLabel }: RevealContactProps) {
  const [revealed, setRevealed] = useState(false);

  if (!revealed) {
    return (
      <button
        type="button"
        onClick={() => setRevealed(true)}
        className="mt-4 w-full inline-flex items-center justify-center gap-2 bg-[#25D366] text-white font-bold py-3 rounded-lg hover:opacity-90 transition-opacity"
      >
        📞 {revealLabel}
      </button>
    );
  }

  return (
    <div className="mt-4">
      <p className="text-sm text-gray-700 dark:text-gray-200 mb-2 text-center font-semibold">📞 {phone}</p>
      <a
        href={buildWhatsAppContactURL(phone, pet)}
        target="_blank"
        rel="noopener noreferrer"
        className="w-full inline-flex items-center justify-center gap-2 bg-[#25D366] text-white font-bold py-3 rounded-lg hover:opacity-90 transition-opacity"
      >
        💬 {contactLabel}
      </a>
    </div>
  );
}
