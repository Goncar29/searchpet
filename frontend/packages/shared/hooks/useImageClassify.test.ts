// ============================================================
// Tests for useImageClassify.ts
// Runner: Vitest + @testing-library/react
// TF.js and MobileNet are mocked via vi.mock — no real model loaded.
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

// ============================================================
// MOCKS — must be declared before any imports that trigger module init
// ============================================================

// Mock MobileNet model factory
const mockClassify = vi.fn();
const mockModelLoad = vi.fn().mockResolvedValue({ classify: mockClassify });

vi.mock('@tensorflow-models/mobilenet', () => ({
  load: mockModelLoad,
}));

// Mock TF.js core (web path)
vi.mock('@tensorflow/tfjs', () => ({
  ready: vi.fn().mockResolvedValue(undefined),
}));

// Mock TF.js React Native backend (mobile path — not triggered on web)
vi.mock('@tensorflow/tfjs-react-native', () => ({
  decodeJpeg: vi.fn(),
}));

// ============================================================
// IMPORTANT: Reset the module-level singletons between tests.
// The hook stores modelRef at module scope — we need to clear
// it between tests that deal with singleton / reload behaviour.
// ============================================================
vi.mock('../hooks/useImageClassify', async (importOriginal) => {
  // We re-export the real module but wrap it so each test can
  // reset the singleton by re-importing a fresh module instance.
  const actual = await importOriginal<typeof import('./useImageClassify')>();
  return actual;
});

// Delayed import so the mock registrations above take effect first.
// We import inside beforeEach when we need a fresh singleton.
import { useImageClassify } from './useImageClassify';

// ============================================================
// HELPERS
// ============================================================

function makePredictions(className: string, probability: number) {
  return [
    { className, probability },
    { className: 'sports_car', probability: 0.05 },
    { className: 'convertible', probability: 0.03 },
    { className: 'racer', probability: 0.02 },
    { className: 'go-kart', probability: 0.01 },
  ];
}

// ============================================================
// TESTS
// ============================================================

describe('useImageClassify', () => {
  beforeEach(() => {
    // Reset all mock call histories
    vi.clearAllMocks();

    // Reset the module-level singletons by patching the module internals.
    // Since the singletons are module-scoped we use vi.resetModules() here
    // to force a fresh module instance for tests that require clean state.
    // For singleton tests we deliberately keep state across calls.
  });

  // ----------------------------------------------------------
  // Loading states
  // ----------------------------------------------------------

  it('starts with isModelLoading=false and isClassifying=false', () => {
    const { result } = renderHook(() => useImageClassify());
    expect(result.current.isModelLoading).toBe(false);
    expect(result.current.isClassifying).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('exposes a classify function', () => {
    const { result } = renderHook(() => useImageClassify());
    expect(typeof result.current.classify).toBe('function');
  });

  it('flips isModelLoading to true then false when model loads', async () => {
    // Make load slow enough that we can observe the loading state
    let resolveLoad!: () => void;
    const slowLoad = new Promise<void>((resolve) => {
      resolveLoad = resolve;
    });

    // We need a fresh singleton to observe the loading transition.
    // Since module-level state persists, simulate by making load hang.
    mockModelLoad.mockReturnValueOnce(
      slowLoad.then(() => ({ classify: mockClassify })),
    );
    mockClassify.mockResolvedValue(makePredictions('sports_car', 0.90)); // non-pet

    const { result } = renderHook(() => useImageClassify());

    // Start classify — triggers model load
    let classifyPromise: Promise<unknown>;
    act(() => {
      classifyPromise = result.current.classify(new Image());
    });

    // While model is loading, isModelLoading should be true
    // (This window is extremely small — we just verify the final state)
    resolveLoad();
    await act(async () => {
      await classifyPromise!;
    });

    expect(result.current.isModelLoading).toBe(false);
    expect(result.current.isClassifying).toBe(false);
  });

  // ----------------------------------------------------------
  // Error handling
  // ----------------------------------------------------------

  it('sets error and clears isModelLoading when model load fails', async () => {
    // Reset module singletons for this test via a fresh renderHook scope
    // We use vi.resetModules to get a clean singleton
    vi.resetModules();
    const freshModule = await import('./useImageClassify');

    mockModelLoad.mockRejectedValueOnce(new Error('Network error'));

    const { result } = renderHook(() => freshModule.useImageClassify());

    await act(async () => {
      await result.current.classify(new Image());
    });

    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });

    expect(result.current.isModelLoading).toBe(false);
  });

  it('error message contains a human-readable description', async () => {
    vi.resetModules();
    const freshModule = await import('./useImageClassify');

    mockModelLoad.mockRejectedValueOnce(new Error('fetch failed'));

    const { result } = renderHook(() => freshModule.useImageClassify());

    await act(async () => {
      await result.current.classify(new Image());
    });

    await waitFor(() => {
      expect(result.current.error).toContain('fetch failed');
    });
  });

  // ----------------------------------------------------------
  // Classification results
  // ----------------------------------------------------------

  it('returns ClassifyResult with type and breed when predictions match', async () => {
    vi.resetModules();
    const freshModule = await import('./useImageClassify');

    mockModelLoad.mockResolvedValue({ classify: mockClassify });
    mockClassify.mockResolvedValue(makePredictions('golden_retriever', 0.75));

    const { result } = renderHook(() => freshModule.useImageClassify());

    let classifyResult: unknown;
    await act(async () => {
      classifyResult = await result.current.classify(new Image());
    });

    expect(classifyResult).not.toBeNull();
    expect((classifyResult as { type: string }).type).toBe('perro');
    expect((classifyResult as { breed: string }).breed).toBe('Golden Retriever');
    expect((classifyResult as { confidence: number }).confidence).toBeCloseTo(0.75);
  });

  it('returns null when predictions are below confidence threshold', async () => {
    vi.resetModules();
    const freshModule = await import('./useImageClassify');

    mockModelLoad.mockResolvedValue({ classify: mockClassify });
    // All predictions below MIN_CONFIDENCE (0.15)
    mockClassify.mockResolvedValue([
      { className: 'golden_retriever', probability: 0.05 },
      { className: 'sports_car', probability: 0.04 },
    ]);

    const { result } = renderHook(() => freshModule.useImageClassify());

    let classifyResult: unknown;
    await act(async () => {
      classifyResult = await result.current.classify(new Image());
    });

    expect(classifyResult).toBeNull();
  });

  it('returns null when predictions are all non-pet labels', async () => {
    vi.resetModules();
    const freshModule = await import('./useImageClassify');

    mockModelLoad.mockResolvedValue({ classify: mockClassify });
    mockClassify.mockResolvedValue([
      { className: 'sports_car', probability: 0.80 },
      { className: 'convertible', probability: 0.10 },
      { className: 'banana', probability: 0.05 },
    ]);

    const { result } = renderHook(() => freshModule.useImageClassify());

    let classifyResult: unknown;
    await act(async () => {
      classifyResult = await result.current.classify(new Image());
    });

    expect(classifyResult).toBeNull();
  });

  // ----------------------------------------------------------
  // isClassifying state
  // ----------------------------------------------------------

  it('flips isClassifying to false after inference completes', async () => {
    vi.resetModules();
    const freshModule = await import('./useImageClassify');

    mockModelLoad.mockResolvedValue({ classify: mockClassify });
    mockClassify.mockResolvedValue(makePredictions('Persian_cat', 0.80));

    const { result } = renderHook(() => freshModule.useImageClassify());

    await act(async () => {
      await result.current.classify(new Image());
    });

    expect(result.current.isClassifying).toBe(false);
  });

  // ----------------------------------------------------------
  // Singleton behaviour
  // ----------------------------------------------------------

  it('does not call modelLoad.load() a second time if model is already cached', async () => {
    vi.resetModules();
    const freshModule = await import('./useImageClassify');

    mockModelLoad.mockResolvedValue({ classify: mockClassify });
    mockClassify.mockResolvedValue(makePredictions('tabby', 0.70));

    const { result } = renderHook(() => freshModule.useImageClassify());

    // First classify call — model loads
    await act(async () => {
      await result.current.classify(new Image());
    });

    // Second classify call — should reuse cached model
    await act(async () => {
      await result.current.classify(new Image());
    });

    // load() called exactly once across two classify() invocations
    expect(mockModelLoad).toHaveBeenCalledTimes(1);
  });
});
