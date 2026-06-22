// ============================================================
// SearchPet - SharePanel (Web)
// Genera un link compartible y abre la red social elegida.
// Incluye QR code (qrcode.react) y WhatsApp template compartido.
// ============================================================

import { useState, useRef } from 'react';
import { QRCodeSVG, QRCodeCanvas } from 'qrcode.react';
import { useShareLink } from '@shared/hooks';
import type { Pet, ShareLink } from '@shared/types';
import { buildWhatsAppMessage } from '@shared/utils/whatsappTemplates';
import { getExpiryInfo } from '@shared/utils/shareExpiry';
import { PhotoBanner } from './PhotoBanner';

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
  const [isSharingStory, setIsSharingStory] = useState(false);
  const [storyMessage, setStoryMessage] = useState<string | null>(null);
  const generateLink = useShareLink();

  // Ref al div contenedor del QR canvas oculto (para descarga en alta resolución)
  const qrContainerRef = useRef<HTMLDivElement | null>(null);

  // Ref al div oculto con el template de la imagen para Instagram Story
  const storyRef = useRef<HTMLDivElement | null>(null);

  const primaryPhoto = pet.photos?.find((p) => p.is_primary) || pet.photos?.[0];

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

  // Genera la imagen de Story (PNG) a partir del template oculto
  async function generateStoryBlob(): Promise<Blob | null> {
    if (!storyRef.current) return null;
    try {
      const { default: html2canvas } = await import('html2canvas');
      const canvas = await html2canvas(storyRef.current, {
        useCORS: true,
        allowTaint: false,
        scale: 2,
        logging: false,
      });
      return await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((blob) => resolve(blob), 'image/png')
      );
    } catch {
      return null;
    }
  }

  function downloadStoryImage(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  const handleInstagramStory = async () => {
    if (!shareLink || isSharingStory) return;
    setIsSharingStory(true);

    try {
      const blob = await generateStoryBlob();

      if (!blob) {
        // No se pudo generar la imagen — compartimos el link como antes
        if (navigator.share) {
          await navigator.share({ url: shareLink.share_url, text: message }).catch(() => {});
        } else {
          window.open('https://www.instagram.com/', '_blank', 'noopener,noreferrer');
        }
        return;
      }

      const storyFilename = `story-${petName}.png`;
      const file = new File([blob], storyFilename, { type: 'image/png' });

      if (navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], text: message });
          return;
        } catch (err) {
          if ((err as Error)?.name === 'AbortError') return;
        }
      }

      downloadStoryImage(blob, storyFilename);
      setStoryMessage('Imagen descargada — subila como Historia desde tu celular 📲');
      setTimeout(() => setStoryMessage(null), 4000);
    } finally {
      setIsSharingStory(false);
    }
  };

  const handlePlatform = (platform: (typeof PLATFORMS)[0]) => {
    if (!shareLink) return;

    if (platform.key === 'instagram') {
      handleInstagramStory();
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
                  disabled={!shareLink || (p.key === 'instagram' && isSharingStory)}
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
              const expiry = getExpiryInfo(shareLink.expires_at, pet.status);
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

            {storyMessage && (
              <p className="text-xs text-green-600 dark:text-green-400 mt-2 text-center">
                {storyMessage}
              </p>
            )}
          </div>
        </>
      )}

      {/* Plantilla oculta para generar la imagen de Instagram Story (9:16) */}
      <div
        ref={storyRef}
        data-testid="story-template"
        style={{
          position: 'fixed',
          top: '-9999px',
          left: '-9999px',
          width: '540px',
          height: '960px',
          backgroundColor: '#ffffff',
          fontFamily: 'Arial, sans-serif',
          padding: '24px',
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
        }}
        aria-hidden="true"
      >
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '16px' }}>
          <div
            style={{
              backgroundColor: pet.status === 'found' ? '#22c55e' : '#ef4444',
              color: '#ffffff',
              padding: '10px 20px',
              borderRadius: '8px',
              fontSize: '22px',
              fontWeight: '800',
              letterSpacing: '2px',
              display: 'inline-block',
            }}
          >
            {pet.status === 'found' ? '¡MASCOTA ENCONTRADA!' : '¡MASCOTA PERDIDA!'}
          </div>
        </div>

        {/* Foto banner — mismo formato 4:3 contain del flyer */}
        <div style={{ marginBottom: '16px' }}>
          <PhotoBanner photoUrl={primaryPhoto?.url} petName={pet.name} heightPx={369} />
        </div>

        {/* Título + datos clave */}
        <h1 style={{ fontSize: '36px', fontWeight: '800', color: '#111827', margin: '0 0 12px 0', textAlign: 'center' }}>
          {pet.name}
        </h1>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '20px' }}>
          <tbody>
            {pet.type && (
              <tr>
                <td style={{ color: '#6b7280', paddingBottom: '6px', paddingRight: '12px', width: '140px' }}>Tipo:</td>
                <td style={{ fontWeight: '600', color: '#111827', paddingBottom: '6px' }}>{pet.type}</td>
              </tr>
            )}
            {pet.breed && (
              <tr>
                <td style={{ color: '#6b7280', paddingBottom: '6px', paddingRight: '12px' }}>Raza:</td>
                <td style={{ fontWeight: '600', color: '#111827', paddingBottom: '6px' }}>{pet.breed}</td>
              </tr>
            )}
            {pet.color && (
              <tr>
                <td style={{ color: '#6b7280', paddingBottom: '6px', paddingRight: '12px' }}>Color:</td>
                <td style={{ fontWeight: '600', color: '#111827', paddingBottom: '6px' }}>{pet.color}</td>
              </tr>
            )}
          </tbody>
        </table>

        <div style={{ flex: 1 }} />

        {/* Footer QR */}
        {shareLink?.share_url && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', borderTop: '2px solid #e5e7eb', paddingTop: '16px' }}>
            <div style={{ flexShrink: 0 }}>
              <QRCodeCanvas value={shareLink.share_url} size={100} level="M" />
            </div>
            <div>
              <p style={{ fontSize: '20px', fontWeight: '700', color: '#111827', margin: '0 0 4px 0' }}>
                Escaneá para ayudar
              </p>
              <p style={{ fontSize: '16px', color: '#6b7280', margin: 0 }}>
                searchpet.app · Reuniendo familias
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
