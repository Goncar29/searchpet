// ============================================================
// SearchPet — PdfFlyerButton (Web only)
// Genera un PDF flyer con datos de la mascota + QR code.
// Usa html2canvas + jsPDF — ambas dependencias son web-only.
// ============================================================

import { useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { QRCodeCanvas } from 'qrcode.react';
import { useShareLink } from '@shared/hooks';
import type { Pet, Report } from '@shared/types';
import { PhotoBanner } from './PhotoBanner';
import { esperarImagenes, cederAlRender } from '../utils/esperarImagenes';
import { Icon } from './Icon';

interface PdfFlyerButtonProps {
  pet: Pet;
  reports?: Report[];
}

const MAX_DESCRIPTION_CHARS = 300;

export function PdfFlyerButton({ pet, reports = [] }: PdfFlyerButtonProps) {
  const { t } = useTranslation();
  const [isGenerating, setIsGenerating] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareError, setShareError] = useState(false);
  /**
   * El template offscreen sólo existe mientras se lo captura.
   *
   * Antes se montaba siempre, así que su `<img>` bajaba la foto ORIGINAL
   * (~107-198 KB, sin miniaturizar a propósito porque el volante se imprime) en
   * cada visita a la página de detalle, la imprimiera alguien o no. Medido en
   * runtime: era el mayor costo por vista de esa pantalla, y como lleva
   * `crossOrigin` tiene cache key propia, o sea ni siquiera compartía el request
   * con la foto que la página ya muestra.
   */
  const [montarTemplate, setMontarTemplate] = useState(false);
  const generateLink = useShareLink();
  const flyerRef = useRef<HTMLDivElement>(null);

  const primaryPhoto = pet.photos?.find((p) => p.is_primary) || pet.photos?.[0];

  const isAdoption = pet.status === 'adoption';
  const posterColor = isAdoption ? '#7c3aed' : pet.status === 'found' ? '#22c55e' : '#ef4444';
  const posterHeader = isAdoption
    ? '¡EN ADOPCIÓN!'
    : pet.status === 'found' ? '¡MASCOTA ENCONTRADA!' : '¡MASCOTA PERDIDA!';

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
    // Ya NO se chequea `flyerRef.current` acá: el template todavía no existe en
    // este punto, se monta más abajo. Con la guarda vieja este handler salía
    // siempre por el early return.
    if (isGenerating) return;
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
      }

      // Los DOS estados en un solo `flushSync`, y recién DESPUÉS de tener la
      // URL: el template dibuja el QR a partir de `shareUrl`, así que montarlo
      // antes lo capturaría con el QR vacío. `flushSync` garantiza que al volver
      // de esta línea el DOM ya está actualizado — sin él habría que confiar en
      // que los `await` de abajo le den tiempo a React, que es justo la clase de
      // suposición temporal que rompe el día que la máquina está rápida.
      flushSync(() => {
        setShareUrl(url);
        setMontarTemplate(true);
      });

      if (!flyerRef.current) return;

      // Importaciones dinámicas — evitan que el bundle de mobile incluya estas libs
      const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
        import('html2canvas'),
        import('jspdf'),
      ]);

      // La foto recién empieza a bajar cuando el template entra al DOM, y
      // html2canvas dibuja lo que haya en ese instante. Sin esperar, el volante
      // sale SIN la mascota — peor que el costo que este montaje diferido vino a
      // eliminar.
      await esperarImagenes(flyerRef.current);
      // Y después del render que esa carga dispara: `PhotoBanner` fija las
      // dimensiones "contain" en píxeles desde su `onLoad` —html2canvas ignora
      // `object-fit`— y el QR se dibuja en un `useEffect`, que `flushSync` no
      // alcanza. Es defensa en profundidad: medido, la carrera NO se reproduce
      // (ver `cederAlRender`, que explica qué se midió y por qué se deja).
      await cederAlRender();

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
      // En el `finally` y no al final del `try`: si la captura explota, el
      // template tiene que desmontarse igual, o el costo por vista vuelve por la
      // puerta de atrás para todo el que haya tenido un error una vez.
      setMontarTemplate(false);
    }
  };

  return (
    <>
      {/* Botón visible */}
      <button
        onClick={handleGenerate}
        disabled={isGenerating || shareError}
        className="inline-flex items-center gap-2 px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 font-semibold rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
        title={t('pets:flyer.title')}
      >
        {isGenerating ? (
          <>
            <Icon name="spinner" className="animate-spin shrink-0" />
            {t('pets:flyer.generating')}
          </>
        ) : shareError ? (
          <>
            <Icon name="warning" className="shrink-0" />
            {t('pets:flyer.error')}
          </>
        ) : (
          <>
            <Icon name="description" className="shrink-0" />
            {t('pets:flyer.button')}
          </>
        )}
      </button>

      {/* Div oculto que html2canvas captura. */}
      {/* Sólo existe MIENTRAS se genera: fuera del viewport pero en el DOM, que
          es lo que html2canvas necesita, y nada más que en ese rato. Montado
          siempre, su <img> bajaba el original en cada visita a la página. */}
      {montarTemplate && (
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
        data-testid="flyer-template"
        aria-hidden="true"
      >
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '24px' }}>
          <div
            style={{
              backgroundColor: posterColor,
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
            {posterHeader}
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
              {isAdoption && pet.city && (
                <tr>
                  <td style={{ color: '#6b7280', paddingBottom: '8px', paddingRight: '12px' }}>Zona:</td>
                  <td style={{ fontWeight: '600', color: '#111827', paddingBottom: '8px' }}>{pet.city}</td>
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
      )}
    </>
  );
}
