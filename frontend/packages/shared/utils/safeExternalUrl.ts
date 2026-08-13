/**
 * Returns the URL when it is safe to put in an `href`, or `undefined` when it is
 * not. Only http(s) with a host survives.
 *
 * React escapes text, but it does NOT check schemes: `<a href={value}>` with a
 * `javascript:` value builds a working link. The values that need this come from
 * OpenStreetMap tags, which anyone can edit, and reach us through the public
 * `GET /api/vets/nearby`.
 *
 * The import already drops these at the door (`safeWebsite` in
 * `internal/osmimport/importer.go`), which is the fix that covers every consumer
 * including the ones not written yet. This is the second layer, and it earns its
 * place for a concrete reason rather than symmetry: rows imported BEFORE that
 * filter existed still hold whatever OSM had, and they are only rewritten when a
 * later import happens to include them again.
 */
export function safeExternalUrl(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    // Relative or malformed. A protocol-relative "//host" throws here too, which
    // is the outcome we want: without a scheme there is nothing to vouch for.
    return undefined;
  }
  // The URL parser lowercases the protocol, so "JavaScript:" lands here as
  // "javascript:" and is rejected with the rest.
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
  return raw;
}
