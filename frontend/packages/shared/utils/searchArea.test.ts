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
