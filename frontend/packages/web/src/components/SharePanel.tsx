// ============================================================
// SearchPet - SharePanel (Web)
// Genera un link compartible y abre la red social elegida.
// ============================================================

import { useState } from 'react';
import { useGenerateShareLink } from '@shared/hooks';
import type { PetStatus, ShareLink } from '@shared/types';

interface SharePanelProps {
  petId: string;
  petName: string;
  petStatus: PetStatus;
}

const PLATFORMS: {
  key: string;
  label: string;
  icon: string;
  bg: string;
  getURL: (link: ShareLink, message: string) => string | null;
}[] = [
  {
    key: 'whatsapp',
    label: 'WhatsApp',
    icon: '💬',
    bg: 'bg-[#25D366] hover:bg-[#1ebe5d]',
    getURL: (link, message) =>
      `https://wa.me/?text=${encodeURIComponent(message + '\n' + link.share_url)}`,
  },
  {
    key: 'facebook',
    label: 'Facebook',
    icon: '📘',
    bg: 'bg-[#1877F2] hover:bg-[#0c6cdf]',
    getURL: (link) =>
      `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(link.share_url)}`,
  },
  {
    key: 'twitter',
    label: 'Twitter / X',
    icon: '🐦',
    bg: 'bg-[#1DA1F2] hover:bg-[#0d8fdc]',
    getURL: (_, message) =>
      `https://twitter.com/intent/tweet?text=${encodeURIComponent(message)}`,
  },
  {
    key: 'instagram',
    label: 'Instagram',
    icon: '📸',
    bg: 'bg-gradient-to-br from-[#f09433] via-[#e6683c] to-[#cc2366] hover:opacity-90',
    getURL: () => null, // Instagram no tiene Web Share Intent — se copia el link
  },
];

export function SharePanel({ petId, petName, petStatus }: SharePanelProps) {
  const [open, setOpen] = useState(false);
  const [shareLink, setShareLink] = useState<ShareLink | null>(null);
  const [copied, setCopied] = useState(false);
  const generateLink = useGenerateShareLink();

  const statusText = petStatus === 'found' ? 'ENCONTRADA' : 'PERDIDA';

  const message = `🚨 ¡MASCOTA ${statusText}! 🚨\nNombre: ${petName}\nPor favor, si tenés información, contactate con su dueño.`;

  const handleOpen = async () => {
    if (open) {
      setOpen(false);
      return;
    }

    // Si ya tenemos el link generado lo reutilizamos
    if (shareLink) {
      setOpen(true);
      return;
    }

    try {
      const result = await generateLink.mutateAsync({ petID: petId });
      setShareLink(result);
      setOpen(true);
    } catch {
      // Si falla, seguimos sin URL de share
      setOpen(true);
    }
  };

  const handlePlatform = (platform: (typeof PLATFORMS)[0]) => {
    if (!shareLink) return;

    const url = platform.getURL(shareLink, message);

    if (platform.key === 'instagram') {
      navigator.clipboard.writeText(shareLink.share_url).catch(() => {});
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
      return;
    }

    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  };

  const handleCopy = () => {
    if (!shareLink) return;
    navigator.clipboard.writeText(shareLink.share_url).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
  };

  return (
    <div className="relative">
      <button
        onClick={handleOpen}
        disabled={generateLink.isPending}
        className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-white font-semibold rounded-lg hover:bg-primary-dark disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
      >
        {generateLink.isPending ? (
          <>
            <span className="animate-spin">⏳</span>
            Generando...
          </>
        ) : (
          <>
            🔗 Compartir
          </>
        )}
      </button>

      {open && (
        <>
          {/* Overlay para cerrar al hacer click afuera */}
          <div
            className="fixed inset-0 z-10"
            onClick={() => setOpen(false)}
          />

          {/* Panel */}
          <div className="absolute left-0 top-full mt-2 z-20 w-72 bg-white dark:bg-gray-900 rounded-2xl shadow-xl border border-gray-100 dark:border-gray-800 p-4">
            <p className="text-sm font-bold text-gray-900 dark:text-gray-100 mb-1">
              Compartir a {petName}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
              Compartir aumenta las chances de encontrarlo/a
            </p>

            {/* Plataformas */}
            <div className="grid grid-cols-2 gap-2 mb-3">
              {PLATFORMS.map((p) => (
                <button
                  key={p.key}
                  onClick={() => handlePlatform(p)}
                  disabled={!shareLink}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-white text-sm font-semibold transition-opacity disabled:opacity-40 ${p.bg}`}
                >
                  <span>{p.icon}</span>
                  {p.label}
                </button>
              ))}
            </div>

            {/* Copiar link */}
            {shareLink && (
              <div className="flex items-center gap-2 bg-gray-50 dark:bg-gray-800 rounded-lg px-3 py-2">
                <span className="text-xs text-gray-500 dark:text-gray-400 truncate flex-1">
                  {shareLink.share_url}
                </span>
                <button
                  onClick={handleCopy}
                  className="text-xs font-semibold text-primary hover:text-primary-dark flex-shrink-0"
                >
                  {copied ? '✓ Copiado' : 'Copiar'}
                </button>
              </div>
            )}

            {copied && (
              <p className="text-xs text-green-600 dark:text-green-400 mt-2 text-center">
                Link copiado al portapapeles
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
