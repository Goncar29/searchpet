// ============================================================
// SearchPet — Pet Classifier Translation Map
// Pure TypeScript: no side-effects, no TF.js imports, no DOM.
// Compatible with Web and React Native.
// ============================================================

import type { PetType, ClassifyResult } from '../types';

// ============================================================
// CONFIDENCE THRESHOLD
// ============================================================

/**
 * Minimum confidence score (0-1) required for a MobileNet prediction to be
 * considered a valid match. MobileNet v2 spreads probability across 1000
 * ImageNet classes; pet-relevant classes typically score 0.15-0.40 even on
 * clear photos. This constant is exported so tests and the hook can reference
 * it without magic numbers.
 */
export const MIN_CONFIDENCE = 0.15;

// ============================================================
// MAPPING TYPES
// ============================================================

interface PetMapping {
  type: PetType;
  breed: string | null;
}

// ============================================================
// STATIC TRANSLATION MAP
// Keys are the exact ImageNet class label strings returned by MobileNet v2.
// Dogs: 20+ breeds. Cats: 10+ breeds.
// ============================================================

const PET_CLASSIFIER_MAP: Record<string, PetMapping> = {
  // ---- Dogs ----
  golden_retriever:       { type: 'perro', breed: 'Golden Retriever' },
  Labrador_retriever:     { type: 'perro', breed: 'Labrador' },
  German_shepherd:        { type: 'perro', breed: 'Pastor Alemán' },
  poodle:                 { type: 'perro', breed: 'Poodle' },
  beagle:                 { type: 'perro', breed: 'Beagle' },
  bulldog:                { type: 'perro', breed: 'Bulldog' },
  rottweiler:             { type: 'perro', breed: 'Rottweiler' },
  Yorkshire_terrier:      { type: 'perro', breed: 'Yorkshire Terrier' },
  boxer:                  { type: 'perro', breed: 'Boxer' },
  Siberian_husky:         { type: 'perro', breed: 'Husky Siberiano' },
  dachshund:              { type: 'perro', breed: 'Dachshund' },
  Doberman:               { type: 'perro', breed: 'Doberman' },
  'Shih-Tzu':             { type: 'perro', breed: 'Shih Tzu' },
  Chihuahua:              { type: 'perro', breed: 'Chihuahua' },
  Border_collie:          { type: 'perro', breed: 'Border Collie' },
  cocker_spaniel:         { type: 'perro', breed: 'Cocker Spaniel' },
  Great_Dane:             { type: 'perro', breed: 'Gran Danés' },
  Dalmatian:              { type: 'perro', breed: 'Dálmata' },
  Pomeranian:             { type: 'perro', breed: 'Pomerania' },
  Maltese_dog:            { type: 'perro', breed: 'Maltés' },
  Australian_shepherd:    { type: 'perro', breed: 'Pastor Australiano' },
  French_bulldog:         { type: 'perro', breed: 'Bulldog Francés' },
  German_short_haired_pointer: { type: 'perro', breed: 'Braco Alemán' },
  miniature_schnauzer:    { type: 'perro', breed: 'Schnauzer Miniatura' },
  standard_schnauzer:     { type: 'perro', breed: 'Schnauzer Estándar' },
  Bernese_mountain_dog:   { type: 'perro', breed: 'Boyero de Berna' },
  Saint_Bernard:          { type: 'perro', breed: 'San Bernardo' },

  // ---- Cats ----
  tabby:                  { type: 'gato', breed: 'Atigrado' },
  Persian_cat:            { type: 'gato', breed: 'Persa' },
  Siamese_cat:            { type: 'gato', breed: 'Siamés' },
  Egyptian_cat:           { type: 'gato', breed: 'Egipcio' },
  Maine_Coon:             { type: 'gato', breed: 'Maine Coon' },
  British_shorthair:      { type: 'gato', breed: 'British Shorthair' },
  Bengal_cat:             { type: 'gato', breed: 'Bengalí' },
  Russian_blue:           { type: 'gato', breed: 'Azul Ruso' },
  Birman_cat:             { type: 'gato', breed: 'Birmano' },
  Abyssinian_cat:         { type: 'gato', breed: 'Abisinio' },
  Scottish_fold:          { type: 'gato', breed: 'Scottish Fold' },
  ragdoll:                { type: 'gato', breed: 'Ragdoll' },
};

// ============================================================
// GENERIC FALLBACK KEYWORDS
// When no exact breed match is found, these keyword lists provide
// a type-only result (breed: null) so the search still runs.
// ============================================================

const DOG_GENERIC_CLASSES = [
  'dog', 'puppy', 'hound', 'terrier', 'retriever', 'spaniel',
  'pointer', 'setter', 'shepherd', 'husky', 'spitz', 'collie',
];

const CAT_GENERIC_CLASSES = [
  'cat', 'kitten', 'lynx', 'tiger_cat',
];

// ============================================================
// PUBLIC API
// ============================================================

/**
 * Look up a single ImageNet label in the translation map.
 * Returns a PetMapping when matched, null otherwise.
 *
 * Exported so callers can do targeted lookups without running
 * the full top-K scan.
 */
export function mapLabelToPet(label: string): { type: PetType; breed: string | null } | null {
  const normalized = label.toLowerCase();

  // Exact map lookup (case-insensitive key matching)
  for (const key of Object.keys(PET_CLASSIFIER_MAP)) {
    if (key.toLowerCase() === normalized) {
      return PET_CLASSIFIER_MAP[key];
    }
  }

  // Generic dog keyword fallback
  for (const keyword of DOG_GENERIC_CLASSES) {
    if (normalized.includes(keyword)) {
      return { type: 'perro', breed: null };
    }
  }

  // Generic cat keyword fallback
  for (const keyword of CAT_GENERIC_CLASSES) {
    if (normalized.includes(keyword)) {
      return { type: 'gato', breed: null };
    }
  }

  return null;
}

/**
 * Scan the top-K MobileNet predictions and return the best pet match.
 *
 * Algorithm:
 *   1. Iterate predictions in confidence-descending order (as returned by MobileNet).
 *   2. For each prediction above `minConfidence`, attempt an exact map lookup.
 *   3. First exact match wins — returned immediately.
 *   4. If no exact match, fall back to generic keyword groups for the top prediction.
 *   5. If nothing matches, return a null-result.
 *
 * @param predictions  Array of {className, probability} from MobileNet.classify()
 * @param minConfidence  Minimum probability to consider (defaults to MIN_CONFIDENCE)
 * @returns ClassifyResult — type/breed are null when no pet is detected
 */
export function lookupPet(
  predictions: Array<{ className: string; probability: number }>,
  minConfidence: number = MIN_CONFIDENCE,
): ClassifyResult {
  const rawLabels = predictions.slice(0, 5).map((p) => p.className);

  // First pass: exact breed map match above threshold
  for (const prediction of predictions.slice(0, 5)) {
    if (prediction.probability < minConfidence) continue;

    const normalized = prediction.className.toLowerCase();
    for (const key of Object.keys(PET_CLASSIFIER_MAP)) {
      if (key.toLowerCase() === normalized) {
        const mapping = PET_CLASSIFIER_MAP[key];
        return {
          type: mapping.type,
          breed: mapping.breed,
          confidence: prediction.probability,
          rawLabels,
        };
      }
    }
  }

  // Second pass: generic keyword fallback for top prediction above threshold
  for (const prediction of predictions.slice(0, 5)) {
    if (prediction.probability < minConfidence) continue;

    const normalized = prediction.className.toLowerCase();

    for (const keyword of DOG_GENERIC_CLASSES) {
      if (normalized.includes(keyword)) {
        return {
          type: 'perro',
          breed: null,
          confidence: prediction.probability,
          rawLabels,
        };
      }
    }

    for (const keyword of CAT_GENERIC_CLASSES) {
      if (normalized.includes(keyword)) {
        return {
          type: 'gato',
          breed: null,
          confidence: prediction.probability,
          rawLabels,
        };
      }
    }
  }

  // No match
  return { type: null, breed: null, confidence: 0, rawLabels };
}
