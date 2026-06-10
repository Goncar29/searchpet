// ============================================================
// SearchPet — PdfFlyerButton (Web only)
// Genera un PDF flyer con datos de la mascota + QR code.
// Usa html2canvas + jsPDF — ambas dependencias son web-only.
// ============================================================

import { useRef, useState } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import { useGenerateShareLink } from '@shared/hooks';
import type { Pet, Report } from '@shared/types';
import { PhotoBanner } from './PhotoBanner';

interface PdfFlyerButtonProps {
  pet: Pet;
  reports?: Report[];
}

const MAX_DESCRIPTION_CHARS = 300;

export function PdfFlyerButton({ pet, reports = [] }: PdfFlyerButtonProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareError, setShareError] = useState(false);
  const generateLink = useGenerateShareLink();
  const flyerRef = useRef<HTMLDivElement>(null);

  const primaryPhoto = pet.photos?.find((p) => p.is_primary) || pet.photos?.[0];

  // Última fecha de avistamiento
  const latestReport = reports[0];
  const lastSeenDate = latestReport
    ? new Date(latestReport.occurred_at ?? latestReport.created_at).toLocaleDateString('es', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : null;

  // Descripción truncada
  const description = pet.description
    ? pet.description.length > MAX_DESCRIPTION_CHARS
      ? pet.description.slice(0, MAX_DESCRIPTION_CHARS) + '...'
      : pet.description
    : null;

  const handleGenerate = async () => {
    if (!flyerRef.current || isGenerating) return;
    setIsGenerating(true);
    setShareError(false);

    try {
      let url = shareUrl;
      if (!url) {
        let link;
        try {
          link = await generateLink.mutateAsync({ petID: pet.id });
        } catch {
          setShareError(true);
          return;
        }
        url = link.share_url;
        setShareUrl(url);
      }

      // Importaciones dinámicas — evitan que el bundle de mobile incluya estas libs
      const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
        import('html2canvas'),
        import('jspdf'),
      ]);

      const canvas = await html2canvas(flyerRef.current, {
        useCORS: true,       // permite imágenes de Cloudinary con crossOrigin="anonymous"
        allowTaint: false,   // rechaza imágenes sin CORS en lugar de fallar silenciosamente
        scale: 2,            // doble resolución para mejor calidad de impresión
        logging: false,
      });

      const imgData = canvas.toDataURL('image/jpeg', 0.92);

      // A4 en mm: 210 x 297
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4',
      });

      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();

      // Calculamos la altura proporcional de la imagen en el PDF
      const imgWidth = pageWidth;
      const imgHeight = (canvas.height * pageWidth) / canvas.width;
      const finalHeight = Math.min(imgHeight, pageHeight);

      pdf.addImage(imgData, 'JPEG', 0, 0, imgWidth, finalHeight);
      pdf.save(`flyer-${pet.name}.pdf`);
    } catch (err) {
      // Si html2canvas falla por CORS, intentamos sin imagen
      console.warn('[PdfFlyerButton] html2canvas error, retrying without images:', err);
      try {
        const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
          import('html2canvas'),
          import('jspdf'),
        ]);

        const canvas = await html2canvas(flyerRef.current!, {
          useCORS: false,
          allowTaint: true,
          scale: 2,
          logging: false,
          ignoreElements: (el) => el.tagName === 'IMG',
        });

        const imgData = canvas.toDataURL('image/jpeg', 0.92);
        const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
        const pageWidth = pdf.internal.pageSize.getWidth();
        const pageHeight = pdf.internal.pageSize.getHeight();
        const imgHeight = (canvas.height * pageWidth) / canvas.width;
        pdf.addImage(imgData, 'JPEG', 0, 0, pageWidth, Math.min(imgHeight, pageHeight));
        pdf.save(`flyer-${pet.name}.pdf`);
      } catch (fallbackErr) {
        console.error('[PdfFlyerButton] PDF generation failed:', fallbackErr);
      }
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <>
      {/* Botón visible */}
      <button
        onClick={handleGenerate}
        disabled={isGenerating || shareError}
        className="inline-flex items-center gap-2 px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 font-semibold rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
        title="Descargar volante PDF para imprimir"
      >
        {isGenerating ? (
          <>
            <span className="animate-spin">⏳</span>
            Generando PDF...
          </>
        ) : shareError ? (
          <>
            ⚠️ Error al generar link
          </>
        ) : (
          <>
            📄 Descargar volante
          </>
        )}
      </button>

      {/* Div oculto que html2canvas captura */}
      {/* Posicionado fuera del viewport pero en el DOM para que html2canvas lo renderice */}
      <div
        style={{
          position: 'fixed',
          top: '-9999px',
          left: '-9999px',
          width: '794px', // ancho A4 a 96dpi
          backgroundColor: '#ffffff',
          fontFamily: 'Arial, sans-serif',
          padding: '40px',
          boxSizing: 'border-box',
        }}
        ref={flyerRef}
        aria-hidden="true"
      >
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '24px' }}>
          <div
            style={{
              backgroundColor: pet.status === 'found' ? '#22c55e' : '#ef4444',
              color: '#ffffff',
              padding: '12px 24px',
              borderRadius: '8px',
              fontSize: '28px',
              fontWeight: '800',
              letterSpacing: '2px',
              marginBottom: '8px',
              display: 'inline-block',
            }}
          >
            {pet.status === 'found' ? '¡MASCOTA ENCONTRADA!' : '¡MASCOTA PERDIDA!'}
          </div>
        </div>

        {/* Foto banner — ancho completo, 4:3, object-fit: contain (no recorta la mascota) */}
        <div style={{ marginBottom: '24px' }}>
          <PhotoBanner photoUrl={primaryPhoto?.url} petName={pet.name} heightPx={536} />
        </div>

        {/* Título + datos */}
        <div style={{ marginBottom: '24px' }}>
          <h1 style={{ fontSize: '32px', fontWeight: '800', color: '#111827', margin: '0 0 16px 0' }}>
            {pet.name}
          </h1>

          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '15px' }}>
            <tbody>
              {pet.type && (
                <tr>
                  <td style={{ color: '#6b7280', paddingBottom: '8px', paddingRight: '12px', width: '100px' }}>Tipo:</td>
                  <td style={{ fontWeight: '600', color: '#111827', paddingBottom: '8px' }}>{pet.type}</td>
                </tr>
              )}
              {pet.breed && (
                <tr>
                  <td style={{ color: '#6b7280', paddingBottom: '8px', paddingRight: '12px' }}>Raza:</td>
                  <td style={{ fontWeight: '600', color: '#111827', paddingBottom: '8px' }}>{pet.breed}</td>
                </tr>
              )}
              {pet.color && (
                <tr>
                  <td style={{ color: '#6b7280', paddingBottom: '8px', paddingRight: '12px' }}>Color:</td>
                  <td style={{ fontWeight: '600', color: '#111827', paddingBottom: '8px' }}>{pet.color}</td>
                </tr>
              )}
              {lastSeenDate && (
                <tr>
                  <td style={{ color: '#6b7280', paddingBottom: '8px', paddingRight: '12px' }}>Visto:</td>
                  <td style={{ fontWeight: '600', color: '#111827', paddingBottom: '8px' }}>{lastSeenDate}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Descripción */}
        {description && (
          <div style={{ marginBottom: '24px', padding: '16px', backgroundColor: '#f9fafb', borderRadius: '8px', fontSize: '14px', color: '#374151', lineHeight: '1.6' }}>
            {description}
          </div>
        )}

        {/* Footer: QR + URL */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '24px', borderTop: '2px solid #e5e7eb', paddingTop: '20px' }}>
          {shareUrl && (
            <div style={{ flexShrink: 0 }}>
              <QRCodeCanvas
                value={shareUrl}
                size={120}
                level="M"
              />
            </div>
          )}
          <div>
            <p style={{ fontSize: '13px', color: '#6b7280', margin: '0 0 6px 0' }}>
              Escaneá el QR para ver más info y compartir:
            </p>
            {shareUrl && (
              <p style={{ fontSize: '13px', color: '#2563eb', fontWeight: '600', margin: '0 0 12px 0', wordBreak: 'break-all' }}>
                {shareUrl}
              </p>
            )}
            <p style={{ fontSize: '12px', color: '#9ca3af', margin: 0 }}>
              SearchPet — Ayudamos a reunir mascotas con sus familias
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
