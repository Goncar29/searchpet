// Escapes a value for interpolation into HTML text or a double/single-quoted
// attribute. Same contract as `esc()` in web/api/share.js, plus the single
// quote so it is safe in either attribute quoting style.
//
// Used by the PDF flyer (components/PdfFlyerButton.tsx): expo-print renders
// that HTML in a WebView, and the pet fields are written by whoever published
// the pet while the flyer is generated on whoever is viewing it.
export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
