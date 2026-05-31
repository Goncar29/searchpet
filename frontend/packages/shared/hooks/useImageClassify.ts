// ============================================================
// SearchPet — useImageClassify hook
// Lazy-loads TF.js + MobileNet on first classify() call.
// Works on both Web (HTMLImageElement) and React Native (URI string).
// ============================================================

import { useState, useRef, useCallback } from 'react';
import type { ClassifyResult } from '../types';
import { lookupPet, MIN_CONFIDENCE } from '../utils/petClassifier';

// ============================================================
// MODULE-LEVEL SINGLETONS
// Shared across all hook instances so the model is loaded once
// per session regardless of how many components mount the hook.
// ============================================================

// The loaded MobileNet model instance (null until first classify call)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let modelRef: any = null;

// In-flight load promise — prevents concurrent load attempts
let loadingPromiseRef: Promise<void> | null = null;

// ============================================================
// TYPES
// ============================================================

type ImageInput = HTMLImageElement | HTMLCanvasElement | ImageData | string;

// MobileNet prediction shape returned by model.classify()
interface MobileNetPrediction {
  className: string;
  probability: number;
}

// ============================================================
// HOOK
// ============================================================

export interface UseImageClassifyReturn {
  /** Run MobileNet classification on an image. Returns null when no pet is detected. */
  classify: (input: ImageInput) => Promise<ClassifyResult | null>;
  /** True while the MobileNet model weights are being downloaded/initialised */
  isModelLoading: boolean;
  /** True while inference is running (model already loaded, image being processed) */
  isClassifying: boolean;
  /** Non-null when model loading or inference fails */
  error: string | null;
}

/**
 * Shared hook that lazy-loads TF.js + MobileNet on first call.
 * Platform detection is done at runtime:
 *   - Web:    expects HTMLImageElement / HTMLCanvasElement / ImageData
 *   - Mobile: expects a URI string and uses @tensorflow/tfjs-react-native
 *
 * The model instance is a module-level singleton — only one network request
 * is made per session regardless of how many components use this hook.
 */
export function useImageClassify(): UseImageClassifyReturn {
  const [isModelLoading, setIsModelLoading] = useState(false);
  const [isClassifying, setIsClassifying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Instance-level flag so concurrent calls inside one component are safe
  const classifyingRef = useRef(false);

  const loadModel = useCallback(async (): Promise<void> => {
    // Already loaded — nothing to do
    if (modelRef !== null) return;

    // Another concurrent call is already loading — wait for it
    if (loadingPromiseRef !== null) {
      return loadingPromiseRef;
    }

    setIsModelLoading(true);

    loadingPromiseRef = (async () => {
      try {
        const isWeb = typeof document !== 'undefined';

        if (isWeb) {
          // Web path: standard TF.js
          // @ts-ignore — resolved from web/node_modules at runtime
          await import('@tensorflow/tfjs');
          // @ts-ignore
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const mobilenet = await import('@tensorflow-models/mobilenet') as any;
          modelRef = await mobilenet.load();
        } else {
          // React Native path: native TF.js backend
          // @ts-ignore — resolved from mobile/node_modules at runtime
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const tf = await import('@tensorflow/tfjs') as any;
          // @ts-ignore
          await import('@tensorflow/tfjs-react-native');
          await tf.ready();
          // @ts-ignore
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const mobilenet = await import('@tensorflow-models/mobilenet') as any;
          modelRef = await mobilenet.load();
        }
      } catch (err) {
        loadingPromiseRef = null; // allow retry on next call
        throw err;
      }
    })();

    try {
      await loadingPromiseRef;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(`Error al cargar el modelo: ${message}`);
      setIsModelLoading(false);
      return;
    }

    setIsModelLoading(false);
  }, []);

  const classify = useCallback(async (input: ImageInput): Promise<ClassifyResult | null> => {
    setError(null);

    // Load model if not yet available
    if (modelRef === null) {
      await loadModel();
      if (modelRef === null) {
        // loadModel set the error already
        return null;
      }
    }

    if (classifyingRef.current) return null;
    classifyingRef.current = true;
    setIsClassifying(true);

    try {
      let predictions: MobileNetPrediction[];
      const isWeb = typeof document !== 'undefined';

      if (isWeb) {
        // Web: pass the image element directly
        predictions = await modelRef.classify(input as HTMLImageElement | HTMLCanvasElement | ImageData);
      } else {
        // React Native: decode URI to tensor then run inference
        // @ts-ignore
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { decodeJpeg } = await import('@tensorflow/tfjs-react-native') as any;
        const uri = input as string;

        const response = await fetch(uri);
        const buffer = await response.arrayBuffer();
        const imageData = new Uint8Array(buffer);
        const tensor = decodeJpeg(imageData);

        try {
          predictions = await modelRef.classify(tensor);
        } finally {
          tensor.dispose();
        }
      }

      const result = lookupPet(predictions, MIN_CONFIDENCE);

      // Return null when no pet was detected
      if (result.type === null) return null;

      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(`Error al clasificar la imagen: ${message}`);
      return null;
    } finally {
      classifyingRef.current = false;
      setIsClassifying(false);
    }
  }, [loadModel]);

  return { classify, isModelLoading, isClassifying, error };
}
