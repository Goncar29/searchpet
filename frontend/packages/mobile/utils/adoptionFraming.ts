// ============================================================
// SearchPet — adoption poster / share framing (mobile)
// Spanish-only strings by project decision (shareable posters + flyers stay ES).
// Pure, so the PdfFlyerButton HTML and ShareButton title framing are unit-testable
// without rendering a WebView / native share sheet.
// ============================================================

export interface PosterFraming {
  color: string;
  header: string;
}

// Header + accent colour for the PDF flyer / poster banner.
// `status` is a bare string (not PetStatus) because ShareButton also passes the
// report-only value 'sighting', which is outside the PetStatus union.
export function posterFraming(status: string): PosterFraming {
  if (status === 'adoption') return { color: '#7c3aed', header: '¡EN ADOPCIÓN!' };
  if (status === 'adopted') return { color: '#0f766e', header: '¡ADOPTADO!' };
  if (status === 'found') return { color: '#22c55e', header: '¡MASCOTA ENCONTRADA!' };
  return { color: '#ef4444', header: '¡MASCOTA PERDIDA!' };
}

// Short label for the native-share sheet title (no "MASCOTA" prefix).
export function shareStatusLabel(status: string): string {
  if (status === 'adoption') return 'EN ADOPCIÓN';
  if (status === 'adopted') return 'ADOPTADO';
  if (status === 'found') return 'ENCONTRADA';
  return 'PERDIDA';
}
