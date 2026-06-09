// ============================================================
// SearchPet - SharePanel (Web)
// Genera un link compartible y abre la red social elegida.
// Incluye QR code (qrcode.react) y WhatsApp template compartido.
// ============================================================

import { useState, useRef } from 'react';
import { QRCodeSVG, QRCodeCanvas } from 'qrcode.react';
import { useGenerateShareLink } from '@shared/hooks';
import type { Pet, ShareLink } from '@shared/types';
import { buildWhatsAppMessage } from '@shared/utils/whatsappTemplates';
import { getExpiryInfo } from '@shared/utils/shareExpiry';

interface SharePanelProps {
  petId: string;
  petName: string;
  pet: Pet;
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
    getURL: (_, message) =>
      `https://wa.me/?text=${encodeURIComponent(message)}`,
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

export function SharePanel({ petId, petName, pet }: SharePanelProps) {
  const [open, setOpen] = useState(false);
  const [shareLink, setShareLink] = useState<ShareLink | null>(null);
  const [copied, setCopied] = useState(false);
  const generateLink = useGenerateShareLink();

  // Ref al div contenedor del QR canvas oculto (para descarga en alta resolución)
  const qrContainerRef = useRef<HTMLDivElement | null>(null);

  const message = buildWhatsAppMessage(pet, shareLink?.share_url);

  const handleOpen = async () => {
    if (open) {
      setOpen(false);
      return;
    }

    if (shareLink) {
      setOpen(true);
      return;
    }

    try {
      const result = await generateLink.mutateAsync({ petID: petId });
      setShareLink(result);
      setOpen(true);
    } catch {
      setOpen(true);
    }
  };

  const handlePlatform = (platform: (typeof PLATFORMS)[0]) => {
    if (!shareLink) return;

    if (platform.key === 'instagram') {
      // Instagram has no web share URL — use the Web Share API (shows native
      // share sheet on mobile, which includes Instagram if installed).
      if (navigator.share) {
        navigator.share({ url: shareLink.share_url, text: message }).catch(() => {});
      } else {
        window.open('https://www.instagram.com/', '_blank', 'noopener,noreferrer');
      }
      return;
    }

    const url = platform.getURL(shareLink, message);
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  };

  const handleCopy = () => {
    if (!shareLink) return;
    navigator.clipboard.writeText(shareLink.share_url).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
  };

  // Descarga el QR como PNG 512x512
  // El canvas está dentro del div contenedor oculto
  const handleDownloadQR = () => {
    const container = qrContainerRef.current;
    if (!container) return;

    const canvas = container.querySelector('canvas');
    if (!canvas) return;

    const dataUrl = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `qr-${petName}.png`;
    a.click();
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
          <div className="absolute left-0 top-full mt-2 z-20 w-80 bg-white dark:bg-gray-900 rounded-2xl shadow-xl border border-gray-100 dark:border-gray-800 p-4">
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
              <div className="flex items-center gap-2 bg-gray-50 dark:bg-gray-800 rounded-lg px-3 py-2 mb-3">
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

            {/* Expiración del link */}
            {shareLink?.expires_at && (() => {
              const expiry = getExpiryInfo(shareLink.expires_at);
              if (!expiry.hasExpiry) return null;
              if (expiry.isExpired) {
                return (
                  <p className="text-xs mt-1 mb-2 text-red-500 font-semibold">
                    Link expirado — genera uno nuevo
                  </p>
                );
              }
              return (
                <p className={`text-xs mt-1 mb-2 ${expiry.isWarning ? 'text-orange-500 font-semibold' : 'text-gray-500'}`}>
                  {expiry.label}
                </p>
              );
            })()}

            {/* QR Code — solo cuando hay share_token */}
            {shareLink?.share_url && (
              <div className="border-t border-gray-100 dark:border-gray-800 pt-3 mt-1">
                <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">
                  Código QR
                </p>
                <div className="flex items-center gap-3">
                  {/* QR SVG visible — 150x150 mínimo según spec */}
                  <div className="flex-shrink-0">
                    <QRCodeSVG
                      value={shareLink.share_url}
                      size={150}
                      level="M"
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Escanealo para abrir la ficha de {petName}
                    </p>
                    <button
                      onClick={handleDownloadQR}
                      className="text-xs font-semibold text-primary hover:text-primary-dark text-left"
                    >
                      Descargar QR (PNG)
                    </button>
                  </div>
                </div>

                {/* Canvas oculto para descarga en 512x512 */}
                <div className="hidden" aria-hidden="true" ref={qrContainerRef}>
                  <QRCodeCanvas
                    value={shareLink.share_url}
                    size={512}
                    level="M"
                  />
                </div>
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
