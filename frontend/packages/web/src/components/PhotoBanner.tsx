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
import { PawPlaceholder } from './PawPlaceholder';

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
        // EXENTO de `cloudinaryThumb` A PROPÓSITO — no es un olvido, y si un
        // barrido de "fotos servidas crudas" te trajo hasta acá, MINIATURIZARLO
        // ES LA RESPUESTA EQUIVOCADA.
        //
        // Este banner no se mira en pantalla: lo rasterizan `PdfFlyerButton`
        // (volante que se IMPRIME en papel) y `SharePanel` (story de Instagram,
        // 1080x1920). Los dos necesitan la resolución del original, así que una
        // miniatura de listado degradaría el impreso.
        //
        // PERO SÍ HAY UN COSTO REAL ACÁ, y es peor de lo que parece: los dos
        // consumidores montan su template offscreen (`position:fixed; top:-9999px`)
        // SIN condicionar al estado de abierto/generando, así que este `<img>`
        // baja el original en CADA visita a la página de detalle, la imprima
        // alguien o no. Y como lleva `crossOrigin`, tiene su propia cache key:
        // es un request aparte del que la página ya hace para mostrar la foto.
        //
        // O sea que hoy es el mayor costo por vista que queda en esa pantalla.
        // La salida correcta es GATEAR EL TEMPLATE detrás del click —
        // conservando esta URL cruda—, no achicar la imagen. Queda anotado y sin
        // hacer: html2canvas necesita el nodo en el DOM al momento de capturar,
        // así que el gating tiene que coordinarse con el render y merece su
        // propia verificación (generar un PDF y una story de verdad).
        //
        // El `crossOrigin` de abajo no es opcional: html2canvas necesita leer
        // los píxeles, y sin eso el canvas queda tainted.
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
        <PawPlaceholder className="w-24" color="#C24E1A" />
      )}
    </div>
  );
}
