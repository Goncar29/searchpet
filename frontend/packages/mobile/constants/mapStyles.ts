// Map style URLs, one per theme. The maps follow dark mode like everything
// else (S5): MapTiler for the main map (key in EXPO_PUBLIC_MAPTILER_KEY,
// restricted by User-Agent, see CLAUDE.md rule #67) and OpenFreeMap, keyless,
// for the publish location step and the sighting timeline.
//
// `streets-v4-dark` is MapTiler's own dark variant of `streets-v4` (listed in
// maptiler-client-js src/mapstyle.ts); OpenFreeMap publishes `dark` next to
// `liberty` (both answer 200 at tiles.openfreemap.org/styles/<name>).
import type { ColorScheme } from '../hooks/useTheme';

const MAPTILER_KEY = process.env.EXPO_PUBLIC_MAPTILER_KEY;

export function mainMapStyle(scheme: ColorScheme): string {
  const id = scheme === 'dark' ? 'streets-v4-dark' : 'streets-v4';
  return `https://api.maptiler.com/maps/${id}/style.json?key=${MAPTILER_KEY}`;
}

export function openMapStyle(scheme: ColorScheme): string {
  return `https://tiles.openfreemap.org/styles/${scheme === 'dark' ? 'dark' : 'liberty'}`;
}
