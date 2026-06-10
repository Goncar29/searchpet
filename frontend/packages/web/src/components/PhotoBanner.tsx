// ============================================================
// SearchPet — PhotoBanner (Web only)
// Caja de foto con relación de aspecto 4:3, ajuste "contain"
// sobre fondo blanco. "Formato clave" compartido por el flyer PDF
// y la imagen de Instagram Story: la foto nunca se recorta, sea
// cual sea su orientación original.
//
// html2canvas (1.4.x) no soporta object-fit y estira la imagen al
// tamaño de su caja. Por eso calculamos las dimensiones "contain"
// manualmente al cargar la imagen y las fijamos en px explícitos,
// que html2canvas sí respeta.
// ============================================================

import { useRef, useState } from 'react';

interface PhotoBannerProps {
  photoUrl?: string;
  petName: string;
  heightPx: number;
}

export function PhotoBanner({ photoUrl, petName, heightPx }: PhotoBannerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [imgDims, setImgDims] = useState<{ width: number; height: number } | null>(null);

  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    const containerWidth = containerRef.current?.clientWidth ?? 0;
    if (!img.naturalWidth || !img.naturalHeight || !containerWidth) return;

    const scale = Math.min(containerWidth / img.naturalWidth, heightPx / img.naturalHeight);
    setImgDims({
      width: Math.round(img.naturalWidth * scale),
      height: Math.round(img.naturalHeight * scale),
    });
  };

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: `${heightPx}px`,
        backgroundColor: '#ffffff',
        border: '1px solid #e5e7eb',
        borderRadius: '8px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      {photoUrl ? (
        <img
          src={photoUrl}
          alt={petName}
          crossOrigin="anonymous"
          onLoad={handleImageLoad}
          style={
            imgDims
              ? { width: `${imgDims.width}px`, height: `${imgDims.height}px` }
              : { width: '100%', height: '100%', objectFit: 'contain' }
          }
        />
      ) : (
        <span style={{ fontSize: '80px' }}>🐾</span>
      )}
    </div>
  );
}
