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
import { Icon } from './Icon';

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
        className="mt-4 w-full inline-flex items-center justify-center gap-2 bg-[#25D366] text-white font-bold px-3 py-3 text-center leading-tight rounded-lg hover:opacity-90 transition-opacity"
      >
        <Icon name="call" className="shrink-0 text-lg" />
        {revealLabel}
      </button>
    );
  }

  return (
    <div className="mt-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 p-4">
      {/* Number + copy affordance. `flex-wrap` and `min-w-0` are both load-
          bearing since this card lives in a ~214px sidebar column: a phone
          number is an unbreakable string, so without them the copy button —
          which is `shrink-0` — gets pushed clean outside the card. Measured at
          1280px: the button ended 67px past the right edge of the <aside>. */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <a
          href={`tel:${phone}`}
          className="min-w-0 break-all text-lg font-bold tracking-wide tabular-nums text-gray-900 dark:text-gray-100 hover:text-[#1c9e4d] dark:hover:text-[#25D366] transition-colors"
        >
          {phone}
        </a>
        <button
          type="button"
          onClick={handleCopy}
          // No `aria-label` here: the label is visible right next to the icon,
          // and an aria-label would OVERRIDE it rather than add to it — the
          // same trap the home redesign hit. The icon is aria-hidden, so the
          // text is what carries the accessible name.
          className="shrink-0 inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-md border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
        >
          <Icon name={copied ? 'check' : 'content-copy'} className="shrink-0 text-sm" />
          {copied ? copiedLabel : copyLabel}
        </button>
      </div>

      {/* Primary action — WhatsApp */}
      <a
        href={buildWhatsAppContactURL(phone, pet)}
        target="_blank"
        rel="noopener noreferrer"
        className="w-full inline-flex items-center justify-center gap-2 bg-[#25D366] text-white font-bold px-3 py-3 text-center leading-tight rounded-lg hover:opacity-90 transition-opacity"
      >
        <Icon name="chat-bubble" className="shrink-0 text-lg" />
        {contactLabel}
      </a>

      {/* Secondary action — phone call */}
      <a
        href={`tel:${phone}`}
        className="mt-2 w-full inline-flex items-center justify-center gap-2 border border-[#25D366] text-[#1c9e4d] dark:text-[#25D366] font-bold px-3 py-3 text-center leading-tight rounded-lg hover:bg-[#25D366]/10 transition-colors"
      >
        <Icon name="call" className="shrink-0 text-lg" />
        {callLabel}
      </a>
    </div>
  );
}
