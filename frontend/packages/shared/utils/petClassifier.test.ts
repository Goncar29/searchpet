// ============================================================
// Tests for petClassifier.ts
// Runner: Vitest (pure TypeScript — no DOM, no TF.js)
// ============================================================

import { describe, it, expect } from 'vitest';
import { lookupPet, mapLabelToPet, MIN_CONFIDENCE } from './petClassifier';

// ============================================================
// Helpers
// ============================================================

/** Build a single-prediction array with a given label and probability */
function pred(className: string, probability: number) {
  return [{ className, probability }];
}

/** Build a top-5 array where only the given entry is above threshold */
function top5(className: string, probability: number) {
  return [
    { className, probability },
    { className: 'sports_car', probability: 0.05 },
    { className: 'convertible', probability: 0.03 },
    { className: 'racer', probability: 0.02 },
    { className: 'go-kart', probability: 0.01 },
  ];
}

// ============================================================
// mapLabelToPet — exact label lookups
// ============================================================

describe('mapLabelToPet', () => {
  // ---- 20 required dog breeds ----
  const requiredDogBreeds: [string, string][] = [
    ['golden_retriever', 'Golden Retriever'],
    ['Labrador_retriever', 'Labrador'],
    ['German_shepherd', 'Pastor Alemán'],
    ['poodle', 'Poodle'],
    ['beagle', 'Beagle'],
    ['bulldog', 'Bulldog'],
    ['rottweiler', 'Rottweiler'],
    ['Yorkshire_terrier', 'Yorkshire Terrier'],
    ['boxer', 'Boxer'],
    ['Siberian_husky', 'Husky Siberiano'],
    ['dachshund', 'Dachshund'],
    ['Doberman', 'Doberman'],
    ['Shih-Tzu', 'Shih Tzu'],
    ['Chihuahua', 'Chihuahua'],
    ['Border_collie', 'Border Collie'],
    ['cocker_spaniel', 'Cocker Spaniel'],
    ['Great_Dane', 'Gran Danés'],
    ['Dalmatian', 'Dálmata'],
    ['Pomeranian', 'Pomerania'],
    ['Maltese_dog', 'Maltés'],
  ];

  for (const [label, expectedBreed] of requiredDogBreeds) {
    it(`recognises dog breed label "${label}"`, () => {
      const result = mapLabelToPet(label);
      expect(result).not.toBeNull();
      expect(result!.type).toBe('perro');
      expect(result!.breed).toBe(expectedBreed);
    });
  }

  // ---- 10 required cat breeds ----
  const requiredCatBreeds: [string, string][] = [
    ['tabby', 'Atigrado'],
    ['Persian_cat', 'Persa'],
    ['Siamese_cat', 'Siamés'],
    ['Egyptian_cat', 'Egipcio'],
    ['Maine_Coon', 'Maine Coon'],
    ['British_shorthair', 'British Shorthair'],
    ['Bengal_cat', 'Bengalí'],
    ['Russian_blue', 'Azul Ruso'],
    ['Birman_cat', 'Birmano'],
    ['Abyssinian_cat', 'Abisinio'],
  ];

  for (const [label, expectedBreed] of requiredCatBreeds) {
    it(`recognises cat breed label "${label}"`, () => {
      const result = mapLabelToPet(label);
      expect(result).not.toBeNull();
      expect(result!.type).toBe('gato');
      expect(result!.breed).toBe(expectedBreed);
    });
  }

  it('returns null for a non-pet ImageNet label', () => {
    expect(mapLabelToPet('sports_car')).toBeNull();
    expect(mapLabelToPet('banana')).toBeNull();
    expect(mapLabelToPet('acoustic_guitar')).toBeNull();
  });

  it('normalises space-separated MobileNet labels to underscore before lookup', () => {
    // MobileNet returns "golden retriever" (space), map key is "golden_retriever"
    const result = mapLabelToPet('golden retriever');
    expect(result).not.toBeNull();
    expect(result!.type).toBe('perro');
    expect(result!.breed).toBe('Golden Retriever');
  });

  it('normalises mixed-case space-separated label', () => {
    const result = mapLabelToPet('Persian cat');
    expect(result).not.toBeNull();
    expect(result!.type).toBe('gato');
    expect(result!.breed).toBe('Persa');
  });

  it('is case-insensitive for the input label', () => {
    // Map key is 'golden_retriever' — all-uppercase input should still match
    const result = mapLabelToPet('GOLDEN_RETRIEVER');
    expect(result).not.toBeNull();
    expect(result!.type).toBe('perro');
  });

  it('generic "dog" keyword returns { type: "perro", breed: null }', () => {
    const result = mapLabelToPet('dog');
    expect(result).not.toBeNull();
    expect(result!.type).toBe('perro');
    expect(result!.breed).toBeNull();
  });

  it('generic "cat" keyword returns { type: "gato", breed: null }', () => {
    const result = mapLabelToPet('cat');
    expect(result).not.toBeNull();
    expect(result!.type).toBe('gato');
    expect(result!.breed).toBeNull();
  });

  it('generic "puppy" keyword returns { type: "perro", breed: null }', () => {
    const result = mapLabelToPet('puppy');
    expect(result).not.toBeNull();
    expect(result!.type).toBe('perro');
    expect(result!.breed).toBeNull();
  });
});

// ============================================================
// lookupPet — full top-K scan
// ============================================================

describe('lookupPet', () => {
  it('returns type and breed when top prediction is a mapped breed above threshold', () => {
    const result = lookupPet(top5('golden_retriever', 0.80));
    expect(result.type).toBe('perro');
    expect(result.breed).toBe('Golden Retriever');
    expect(result.confidence).toBeCloseTo(0.80);
  });

  it('returns null-result when confidence is below MIN_CONFIDENCE', () => {
    const result = lookupPet(pred('golden_retriever', MIN_CONFIDENCE - 0.01));
    expect(result.type).toBeNull();
    expect(result.breed).toBeNull();
    expect(result.confidence).toBe(0);
  });

  it('returns null-result when confidence equals threshold boundary (exclusive)', () => {
    // At exactly MIN_CONFIDENCE - epsilon it should not match
    const epsilon = 0.001;
    const result = lookupPet(pred('Persian_cat', MIN_CONFIDENCE - epsilon));
    expect(result.type).toBeNull();
  });

  it('matches at exactly MIN_CONFIDENCE', () => {
    const result = lookupPet(pred('Persian_cat', MIN_CONFIDENCE));
    expect(result.type).toBe('gato');
  });

  it('returns null-result for all non-pet top-5 labels', () => {
    const nonPetPredictions = [
      { className: 'sports_car', probability: 0.80 },
      { className: 'convertible', probability: 0.10 },
      { className: 'banana', probability: 0.05 },
      { className: 'acoustic_guitar', probability: 0.03 },
      { className: 'harmonica', probability: 0.02 },
    ];
    const result = lookupPet(nonPetPredictions);
    expect(result.type).toBeNull();
    expect(result.breed).toBeNull();
    expect(result.confidence).toBe(0);
  });

  it('scans top-5 and picks the highest-confidence mapped label', () => {
    // golden_retriever is at index 0 (highest), Chihuahua at index 2
    const predictions = [
      { className: 'golden_retriever', probability: 0.55 },
      { className: 'sports_car', probability: 0.20 },
      { className: 'Chihuahua', probability: 0.15 },
      { className: 'banana', probability: 0.06 },
      { className: 'harmonica', probability: 0.04 },
    ];
    const result = lookupPet(predictions);
    expect(result.type).toBe('perro');
    expect(result.breed).toBe('Golden Retriever'); // first match wins (index 0)
    expect(result.confidence).toBeCloseTo(0.55);
  });

  it('falls back to second-ranked entry when first is not a pet', () => {
    const predictions = [
      { className: 'sports_car', probability: 0.70 },
      { className: 'Siamese_cat', probability: 0.25 },
      { className: 'banana', probability: 0.03 },
      { className: 'harmonica', probability: 0.01 },
      { className: 'whistle', probability: 0.01 },
    ];
    const result = lookupPet(predictions);
    expect(result.type).toBe('gato');
    expect(result.breed).toBe('Siamés');
    expect(result.confidence).toBeCloseTo(0.25);
  });

  it('uses generic "dog" fallback when label contains "dog" but has no breed entry', () => {
    const result = lookupPet(pred('hot_dog', 0.50));
    // "hot_dog" contains "dog" keyword → perro, breed null
    // Note: this is intentional generic fallback behaviour
    expect(result.type).toBe('perro');
    expect(result.breed).toBeNull();
  });

  it('rawLabels contains top-5 class names', () => {
    const predictions = [
      { className: 'golden_retriever', probability: 0.80 },
      { className: 'sports_car', probability: 0.10 },
      { className: 'Chihuahua', probability: 0.05 },
      { className: 'banana', probability: 0.03 },
      { className: 'harmonica', probability: 0.02 },
    ];
    const result = lookupPet(predictions);
    expect(result.rawLabels).toHaveLength(5);
    expect(result.rawLabels[0]).toBe('golden_retriever');
    expect(result.rawLabels[4]).toBe('harmonica');
  });

  it('rawLabels on null-result still contains the input labels', () => {
    const predictions = [
      { className: 'sports_car', probability: 0.80 },
      { className: 'convertible', probability: 0.10 },
    ];
    const result = lookupPet(predictions);
    expect(result.rawLabels).toContain('sports_car');
    expect(result.rawLabels).toContain('convertible');
  });

  it('handles an empty predictions array gracefully', () => {
    const result = lookupPet([]);
    expect(result.type).toBeNull();
    expect(result.confidence).toBe(0);
    expect(result.rawLabels).toHaveLength(0);
  });

  it('matches when MobileNet returns space-separated className', () => {
    // Real MobileNet output uses spaces: "golden retriever", not "golden_retriever"
    const result = lookupPet([{ className: 'golden retriever', probability: 0.82 }]);
    expect(result.type).toBe('perro');
    expect(result.breed).toBe('Golden Retriever');
    expect(result.confidence).toBeCloseTo(0.82);
  });

  it('respects a custom minConfidence override', () => {
    // At default MIN_CONFIDENCE (0.15) this would match; at 0.60 it should not
    const result = lookupPet(pred('golden_retriever', 0.50), 0.60);
    expect(result.type).toBeNull();
  });
});

// ============================================================
// MIN_CONFIDENCE constant
// ============================================================

describe('MIN_CONFIDENCE', () => {
  it('is exported and equals 0.15', () => {
    expect(MIN_CONFIDENCE).toBe(0.15);
  });
});
