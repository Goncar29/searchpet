# Search this area (pan re-search) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users re-center the nearby-reports and nearby-vets search on the current map viewport via a "Search this area" button that appears after panning, on both web (Leaflet) and mobile (MapLibreGL).

**Architecture:** Decouple `searchCenter` from `userLocation`. A shared pure helper decides when to show the button (distance threshold tied to the reports radius). Each map tracks its viewport center through its own library events; data hooks are unchanged.

**Tech Stack:** React + react-leaflet (web), React Native + @maplibre/maplibre-react-native (mobile), React Query, Vitest (web/shared), Jest (mobile), i18next.

**Branch:** `feat/search-this-area`, stacked on `feat/vets-frontend` (vets PR chain). Rebase onto main after the vets chain merges.

---

### Task 1: Shared pure helper `shouldShowSearchHere`

**Files:**
- Create: `frontend/packages/shared/utils/searchArea.ts`
- Test: `frontend/packages/shared/utils/searchArea.test.ts`

Shared tests run from `web` via `vitest.shared.config.ts` (see project rule #14).

- [ ] **Step 1: Write the failing test**

`frontend/packages/shared/utils/searchArea.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { shouldShowSearchHere, SEARCH_HERE_THRESHOLD_RATIO } from './searchArea';

const MVD = { lat: -34.9011, lng: -56.1645 };

describe('shouldShowSearchHere', () => {
  it('is false when the map has not moved', () => {
    expect(shouldShowSearchHere(MVD, MVD, 3000)).toBe(false);
  });

  it('is false for a pan within the threshold', () => {
    // ~500 m north (0.0045 deg lat); threshold = 0.3 * 3000 = 900 m
    const near = { lat: MVD.lat + 0.0045, lng: MVD.lng };
    expect(shouldShowSearchHere(near, MVD, 3000)).toBe(false);
  });

  it('is true for a pan beyond the threshold', () => {
    // ~5.5 km north (0.05 deg lat) >> 900 m
    const far = { lat: MVD.lat + 0.05, lng: MVD.lng };
    expect(shouldShowSearchHere(far, MVD, 3000)).toBe(true);
  });

  it('is false when radiusMeters <= 0 (no meaningful threshold)', () => {
    const far = { lat: MVD.lat + 0.05, lng: MVD.lng };
    expect(shouldShowSearchHere(far, MVD, 0)).toBe(false);
  });

  it('exposes the threshold ratio constant', () => {
    expect(SEARCH_HERE_THRESHOLD_RATIO).toBe(0.3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend/packages/web && npx vitest run --config vitest.shared.config.ts searchArea`
Expected: FAIL — cannot resolve `./searchArea` / `shouldShowSearchHere is not a function`.

- [ ] **Step 3: Write minimal implementation**

`frontend/packages/shared/utils/searchArea.ts`:
```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend/packages/web && npx vitest run --config vitest.shared.config.ts searchArea`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/packages/shared/utils/searchArea.ts frontend/packages/shared/utils/searchArea.test.ts
git commit -m "feat(map): add shouldShowSearchHere threshold helper"
```

---

### Task 2: Web i18n key `map:searchHere`

**Files:**
- Modify: `frontend/packages/web/src/i18n/locales/es.json` (`map` namespace)
- Modify: `frontend/packages/web/src/i18n/locales/en.json` (`map` namespace)
- Modify: `frontend/packages/web/src/i18n/locales/pt.json` (`map` namespace)

- [ ] **Step 1: Add the key to each locale**

Inside the existing `"map": { ... }` object, add:
- es.json: `"searchHere": "Buscar en esta zona",`
- en.json: `"searchHere": "Search this area",`
- pt.json: `"searchHere": "Buscar nesta área",`

Place it next to the other map keys (e.g., after `"radiusKm"`). Keep valid JSON (watch trailing commas).

- [ ] **Step 2: Verify JSON is valid**

Run: `cd frontend/packages/web && node -e "['es','en','pt'].forEach(l=>{const m=require('./src/i18n/locales/'+l+'.json');if(!m.map.searchHere)throw new Error('missing '+l);});console.log('ok')"`
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add frontend/packages/web/src/i18n/locales/es.json frontend/packages/web/src/i18n/locales/en.json frontend/packages/web/src/i18n/locales/pt.json
git commit -m "feat(map): add map:searchHere web translations"
```

---

### Task 3: Web — pan tracking + "Search this area" button

**Files:**
- Modify: `frontend/packages/web/src/pages/MapPage.tsx`
- Test: `frontend/packages/web/src/pages/MapPage.test.tsx`

- [ ] **Step 1: Write the failing test**

Extend `frontend/packages/web/src/pages/MapPage.test.tsx`. First, update the `react-leaflet` mock to capture the `moveend` handler and return a fake map; then add the test. Replace the existing `vi.mock('react-leaflet', ...)` block with:
```tsx
// Captured so the test can simulate a pan (moveend).
let capturedMoveend: (() => void) | undefined;
const fakeMap = { getCenter: vi.fn(() => ({ lat: -34.9011, lng: -56.1645 })) };

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: { children: React.ReactNode }) => <div data-testid="map-container">{children}</div>,
  TileLayer: () => null,
  Marker: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Popup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Circle: () => null,
  useMapEvents: (handlers: { moveend?: () => void }) => {
    capturedMoveend = handlers.moveend;
    return fakeMap;
  },
}));
```

Add this test inside `describe('MapPage', ...)`:
```tsx
it('shows the "search this area" button after panning beyond the threshold', async () => {
  const { act } = await import('react');
  fakeMap.getCenter.mockReturnValue({ lat: -34.9011, lng: -56.1645 });
  render(<MapPage />, { wrapper });

  // Not panned yet — button hidden.
  expect(screen.queryByText('map:searchHere')).toBeNull();

  // Simulate a pan ~5.5 km north, then fire moveend.
  fakeMap.getCenter.mockReturnValue({ lat: -34.8511, lng: -56.1645 });
  act(() => { capturedMoveend?.(); });

  expect(screen.getByText('map:searchHere')).toBeTruthy();
});

it('clicking "search this area" re-fetches reports at the new center', async () => {
  mockUseNearbyReports.mockClear();
  fakeMap.getCenter.mockReturnValue({ lat: -34.9011, lng: -56.1645 });
  render(<MapPage />, { wrapper });

  fakeMap.getCenter.mockReturnValue({ lat: -34.8511, lng: -56.1645 });
  const { act } = await import('react');
  act(() => { capturedMoveend?.(); });

  await userEvent.click(screen.getByText('map:searchHere'));

  const calls = mockUseNearbyReports.mock.calls as unknown[][];
  const lastCall = calls[calls.length - 1];
  expect(lastCall[0]).toBeCloseTo(-34.8511, 3); // new search lat
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend/packages/web && npx vitest run src/pages/MapPage.test.tsx`
Expected: FAIL — `map:searchHere` never appears (no button yet); `useMapEvents` is not used by the component.

- [ ] **Step 3: Implement the component changes**

In `frontend/packages/web/src/pages/MapPage.tsx`:

(a) Update imports — add `useMapEvents` and the helper:
```tsx
import { MapContainer, TileLayer, Marker, Popup, Circle, useMapEvents } from 'react-leaflet';
import { shouldShowSearchHere } from '@shared/utils/searchArea';
```

(b) Replace the location/query block. Change:
```tsx
const [userLocation, setUserLocation] = useState<[number, number]>([-34.9011, -56.1645]);

useEffect(() => {
  navigator.geolocation.getCurrentPosition(
    (pos) => setUserLocation([pos.coords.latitude, pos.coords.longitude]),
    () => console.log('Location denied, using default')
  );
}, []);

const { t: tv } = useTranslation('vets');
const [radius, setRadius] = useState(3);
const { data: reports, isLoading } = useNearbyReports(userLocation[0], userLocation[1], radius, true);
const [showVets, setShowVets] = useState(false);
const { data: vets } = useNearbyVets(userLocation[0], userLocation[1], 5000, showVets);
```
to:
```tsx
const [userLocation, setUserLocation] = useState<[number, number]>([-34.9011, -56.1645]);
const [searchCenter, setSearchCenter] = useState<[number, number]>([-34.9011, -56.1645]);
const [mapCenter, setMapCenter] = useState<[number, number]>([-34.9011, -56.1645]);

useEffect(() => {
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const here: [number, number] = [pos.coords.latitude, pos.coords.longitude];
      setUserLocation(here);
      setSearchCenter(here);
      setMapCenter(here);
    },
    () => console.log('Location denied, using default')
  );
}, []);

const { t: tv } = useTranslation('vets');
const [radius, setRadius] = useState(3);
const { data: reports, isLoading } = useNearbyReports(searchCenter[0], searchCenter[1], radius, true);
const [showVets, setShowVets] = useState(false);
const { data: vets } = useNearbyVets(searchCenter[0], searchCenter[1], 5000, showVets);

const canSearchHere = shouldShowSearchHere(
  { lat: mapCenter[0], lng: mapCenter[1] },
  { lat: searchCenter[0], lng: searchCenter[1] },
  radius * 1000,
);
```

(c) Add a pan-tracker component (top-level in the file, after the icon definitions, before `export function MapPage`):
```tsx
function MapPanTracker({ onCenterChange }: { onCenterChange: (c: [number, number]) => void }) {
  const map = useMapEvents({
    moveend: () => {
      const c = map.getCenter();
      onCenterChange([c.lat, c.lng]);
    },
  });
  return null;
}
```

(d) In the JSX, make the map wrapper relative. Change:
```tsx
<div className="bg-white dark:bg-gray-900 rounded-2xl shadow-lg overflow-hidden" style={{ height: '70vh' }}>
```
to:
```tsx
<div className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-lg overflow-hidden" style={{ height: '70vh' }}>
```

(e) Inside `<MapContainer>`, change `center={userLocation}` to `center={searchCenter}`, add the tracker as the first child, and point the `<Circle>` at `searchCenter`:
```tsx
<MapContainer center={searchCenter} zoom={13} style={{ height: '100%', width: '100%' }}>
  <MapPanTracker onCenterChange={setMapCenter} />
  {/* ...TileLayer unchanged... */}
  <Circle
    center={searchCenter}
    radius={radius * 1000}
    pathOptions={{ color: '#6366f1', fillColor: '#6366f1', fillOpacity: 0.08, weight: 2, dashArray: '6 4' }}
  />
  {/* ...markers unchanged... */}
</MapContainer>
```

(f) Add the floating button as a sibling right after `</MapContainer>` (still inside the relative wrapper / the `else` branch). Wrap the `else` content in a fragment:
```tsx
) : (
  <>
    <MapContainer center={searchCenter} zoom={13} style={{ height: '100%', width: '100%' }}>
      {/* ...as above... */}
    </MapContainer>
    {canSearchHere && (
      <button
        type="button"
        onClick={() => setSearchCenter(mapCenter)}
        className="absolute top-3 left-1/2 -translate-x-1/2 z-[1000] px-4 py-2 rounded-full bg-primary text-white text-sm font-semibold shadow-lg hover:bg-primary/90"
      >
        {t('map:searchHere')}
      </button>
    )}
  </>
)}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend/packages/web && npx vitest run src/pages/MapPage.test.tsx`
Expected: PASS (all MapPage tests, including the 2 new ones).

- [ ] **Step 5: Commit**

```bash
git add frontend/packages/web/src/pages/MapPage.tsx frontend/packages/web/src/pages/MapPage.test.tsx
git commit -m "feat(map): add search-this-area button to web map"
```

---

### Task 4: Mobile i18n key `map:searchHere`

**Files:**
- Modify: `frontend/packages/mobile/i18n/locales/es.json` (`map` namespace)
- Modify: `frontend/packages/mobile/i18n/locales/en.json` (`map` namespace)
- Modify: `frontend/packages/mobile/i18n/locales/pt.json` (`map` namespace)

- [ ] **Step 1: Add the key to each locale**

Inside the existing `"map": { ... }` object (next to `vetsToggle` / `vetEmpty`), add:
- es.json: `"searchHere": "Buscar en esta zona",`
- en.json: `"searchHere": "Search this area",`
- pt.json: `"searchHere": "Buscar nesta área",`

Keep valid JSON.

- [ ] **Step 2: Verify JSON is valid**

Run: `cd frontend/packages/mobile && node -e "['es','en','pt'].forEach(l=>{const m=require('./i18n/locales/'+l+'.json');if(!m.map.searchHere)throw new Error('missing '+l);});console.log('ok')"`
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add frontend/packages/mobile/i18n/locales/es.json frontend/packages/mobile/i18n/locales/en.json frontend/packages/mobile/i18n/locales/pt.json
git commit -m "feat(map): add map:searchHere mobile translations"
```

---

### Task 5: Mobile — region tracking + "Search this area" button

**Files:**
- Modify: `frontend/packages/mobile/app/(tabs)/map.tsx`
- Test: `frontend/packages/mobile/__tests__/map.test.tsx`

- [ ] **Step 1: Write the failing test**

Add to `frontend/packages/mobile/__tests__/map.test.tsx`, inside `describe('MapScreen', ...)`:
```tsx
it('shows the "search this area" button after panning beyond the threshold', () => {
  render(<MapScreen />);
  // not panned yet
  expect(screen.queryByText('searchHere')).toBeNull();

  // MapLibre onRegionDidChange feature: geometry.coordinates = [lng, lat] center
  // Pan ~5.5 km north of the default (-34.9011): lat -34.8511
  const mapView = screen.getByTestId('map-view');
  act(() => {
    mapView.props.onRegionDidChange({
      geometry: { coordinates: [-56.1645, -34.8511] },
    });
  });

  expect(screen.getByText('searchHere')).toBeTruthy();
});
```
Add `act` to the imports at the top:
```tsx
import { render, screen, fireEvent, act } from '@testing-library/react-native';
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend/packages/mobile && npx jest __tests__/map.test.tsx -t "search this area"`
Expected: FAIL — `searchHere` text never rendered; `onRegionDidChange` not wired.

- [ ] **Step 3: Implement the component changes**

In `frontend/packages/mobile/app/(tabs)/map.tsx`:

(a) Add the helper import near the other shared imports:
```tsx
import { shouldShowSearchHere } from '../../../shared/utils/searchArea';
```

(b) Add state and derived flag. After the existing `const lng = longitude || MAP_DEFAULTS.defaultLongitude;` and the vets state, replace the search inputs to use `searchCenter`:
```tsx
const [searchCenter, setSearchCenter] = useState<[number, number]>([lat, lng]);
const [mapCenter, setMapCenter] = useState<[number, number]>([lat, lng]);

const [radius, setRadius] = useState(3);
const { data: reports, isLoading } = useNearbyReports(searchCenter[0], searchCenter[1], radius, true);

const [showVets, setShowVets] = useState(false);
const [selectedVet, setSelectedVet] = useState<Vet | null>(null);
const { data: vets } = useNearbyVets(searchCenter[0], searchCenter[1], 5000, showVets);

const circleGeoJSON = createCircleGeoJSON(searchCenter[1], searchCenter[0], radius);

const canSearchHere = shouldShowSearchHere(
  { lat: mapCenter[0], lng: mapCenter[1] },
  { lat: searchCenter[0], lng: searchCenter[1] },
  radius * 1000,
);
```
(Remove the now-duplicated `const [radius, ...]`, `useNearbyReports`, `showVets`, `selectedVet`, `useNearbyVets`, and `circleGeoJSON` lines they replace, so each is declared once. `circleGeoJSON` now uses `searchCenter[1]` as lng and `searchCenter[0]` as lat.)

(b2) Sync `searchCenter`/`mapCenter` to the user's real location once GPS resolves (mirrors the web geolocation callback — without this, `searchCenter` would stay at the default Montevideo coords because its `useState` initial value is captured before GPS loads). In `requestLocation`, after `setLocation(...)`:
```tsx
if (status === 'granted') {
  const location = await Location.getCurrentPositionAsync({});
  const here: [number, number] = [location.coords.latitude, location.coords.longitude];
  setLocation(here[0], here[1]);
  setSearchCenter(here);
  setMapCenter(here);
}
```

(c) Wire the region change on `<MapLibreGL.MapView>`:
```tsx
<MapLibreGL.MapView
  style={styles.map}
  styleURL={MAP_STYLE}
  onPress={() => { setSelectedReport(null); setSelectedVet(null); }}
  onRegionDidChange={(feature: { geometry: { coordinates: [number, number] } }) => {
    const [regionLng, regionLat] = feature.geometry.coordinates;
    setMapCenter([regionLat, regionLng]);
  }}
>
```

(d) Add the button right after the vet toggle `</TouchableOpacity>` block:
```tsx
{canSearchHere && (
  <TouchableOpacity style={styles.searchHereButton} onPress={() => setSearchCenter(mapCenter)}>
    <Text style={styles.searchHereText}>{t('searchHere')}</Text>
  </TouchableOpacity>
)}
```

(e) Add the styles to the `StyleSheet.create({ ... })` block (next to `vetEmptyText`):
```tsx
searchHereButton: {
  position: 'absolute',
  top: SPACING.lg + 48,
  alignSelf: 'center',
  left: 0,
  right: 0,
  marginHorizontal: 'auto',
  backgroundColor: COLORS.primary,
  paddingVertical: SPACING.sm,
  paddingHorizontal: SPACING.lg,
  borderRadius: 20,
  alignItems: 'center',
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.2,
  shadowRadius: 4,
  elevation: 5,
},
searchHereText: {
  color: COLORS.white,
  fontSize: FONTS.sizes.sm,
  fontWeight: '700',
},
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend/packages/mobile && npx jest __tests__/map.test.tsx`
Expected: PASS (all map tests).

- [ ] **Step 5: Commit**

```bash
git add "frontend/packages/mobile/app/(tabs)/map.tsx" frontend/packages/mobile/__tests__/map.test.tsx
git commit -m "feat(map): add search-this-area button to mobile map"
```

---

### Task 6: Full verification

- [ ] **Step 1: Shared + web tests**

Run: `cd frontend/packages/web && pnpm test:run`
Expected: all green (shared `searchArea` + web `MapPage`).

- [ ] **Step 2: Mobile suite**

Run: `cd frontend/packages/mobile && pnpm test:run`
Expected: all suites green.

---

## Delivery Note

If the cumulative code diff (excluding this plan + the design doc) is well over ~400 lines,
split into stacked PRs per the project PR-size rule: **PR A** = helper + web (Tasks 1–3),
**PR B** = mobile (Tasks 4–5), stacked on A. Otherwise a single PR is fine. This branch stacks
on `feat/vets-frontend`; rebase onto main once the vets chain merges.
