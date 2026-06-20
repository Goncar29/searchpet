// Decides when to offer a "search this area" re-search after the user pans the map.

export const SEARCH_HERE_THRESHOLD_RATIO = 0.3;

export interface LatLng {
  lat: number;
  lng: number;
}

// Great-circle distance in meters between two points.
function haversineMeters(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// True when the map center has moved far enough from the search center to
// justify offering a re-search. Threshold scales with the visible radius.
export function shouldShowSearchHere(
  mapCenter: LatLng,
  searchCenter: LatLng,
  radiusMeters: number,
): boolean {
  if (radiusMeters <= 0) return false;
  return haversineMeters(mapCenter, searchCenter) > SEARCH_HERE_THRESHOLD_RATIO * radiusMeters;
}
