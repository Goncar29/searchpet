// ============================================================
// SearchPet — RevealContact (Web)
// Anti-scraping reveal-on-click for a contact phone. The raw number, the
// wa.me link and the tel: link are kept OUT of the DOM until the user clicks
// "reveal", which blunts trivial bot scraping while staying zero-friction for
// real finders. Once revealed, the number is shown in a contact card with
// three actions: WhatsApp (primary), Call (tel:) and copy-to-clipboard.
// ============================================================

import { useState } from 'react';
import type { Pet } from '@shared/types';
import { buildWhatsAppContactURL } from '@shared/utils/whatsappTemplates';

interface RevealContactProps {
  phone: string;
  pet: Pet;
  revealLabel: string;
  contactLabel: string;
  callLabel: string;
  copyLabel: string;
  copiedLabel: string;
}

export function RevealContact({
  phone,
  pet,
  revealLabel,
  contactLabel,
  callLabel,
  copyLabel,
  copiedLabel,
}: RevealContactProps) {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(phone);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable — ignore; the number is still visible to copy by hand */
    }
  };

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
    <div className="mt-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 p-4">
      {/* Number + copy affordance */}
      <div className="flex items-center justify-between gap-3 mb-3">
        <a
          href={`tel:${phone}`}
          className="text-lg font-bold tracking-wide tabular-nums text-gray-900 dark:text-gray-100 hover:text-[#1c9e4d] dark:hover:text-[#25D366] transition-colors"
        >
          {phone}
        </a>
        <button
          type="button"
          onClick={handleCopy}
          aria-label={copied ? copiedLabel : copyLabel}
          className="shrink-0 inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-md border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
        >
          {copied ? `✓ ${copiedLabel}` : `📋 ${copyLabel}`}
        </button>
      </div>

      {/* Primary action — WhatsApp */}
      <a
        href={buildWhatsAppContactURL(phone, pet)}
        target="_blank"
        rel="noopener noreferrer"
        className="w-full inline-flex items-center justify-center gap-2 bg-[#25D366] text-white font-bold py-3 rounded-lg hover:opacity-90 transition-opacity"
      >
        💬 {contactLabel}
      </a>

      {/* Secondary action — phone call */}
      <a
        href={`tel:${phone}`}
        className="mt-2 w-full inline-flex items-center justify-center gap-2 border border-[#25D366] text-[#1c9e4d] dark:text-[#25D366] font-bold py-3 rounded-lg hover:bg-[#25D366]/10 transition-colors"
      >
        📞 {callLabel}
      </a>
    </div>
  );
}
