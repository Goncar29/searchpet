// ============================================================
// SearchPet — PhotoBanner (Web only)
// Caja de foto con relación de aspecto 4:3, object-fit: contain
// sobre fondo blanco. "Formato clave" compartido por el flyer PDF
// y la imagen de Instagram Story: la foto nunca se recorta, sea
// cual sea su orientación original.
// ============================================================

interface PhotoBannerProps {
  photoUrl?: string;
  petName: string;
  heightPx: number;
}

export function PhotoBanner({ photoUrl, petName, heightPx }: PhotoBannerProps) {
  return (
    <div
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
          style={{ width: '100%', height: '100%', objectFit: 'contain' }}
        />
      ) : (
        <span style={{ fontSize: '80px' }}>🐾</span>
      )}
    </div>
  );
}
