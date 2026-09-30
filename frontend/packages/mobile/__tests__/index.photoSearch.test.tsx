// Home screen — photo search results render the translated pet type, not the
// raw domain literal ('perro', 'gato'...). Rule #12/M5.
//
// Split from index.test.tsx: these two paths (server-side image search for an
// authenticated user, and the local MobileNet fallback for a guest) need
// their own mutable auth state and their own image-picker/classify mocks, and
// don't touch any of the ListState branches the main suite already covers.
import React from 'react';
import { Alert } from 'react-native';
import { render, screen, fireEvent } from '@testing-library/react-native';
import * as ImagePicker from 'expo-image-picker';

import HomeScreen from '../app/(tabs)/index';

let mockAuthState: { isAuthenticated: boolean };

jest.mock('../store', () => ({
  useAuthStore: (selector?: (state: Record<string, unknown>) => unknown) =>
    typeof selector === 'function' ? selector(mockAuthState) : mockAuthState,
  useLocationStore: (selector?: (state: Record<string, unknown>) => unknown) => {
    const state = { latitude: -34.9011, longitude: -56.1645, setLocation: jest.fn() };
    return typeof selector === 'function' ? selector(state) : state;
  },
}));

const mockIdleSearchQuery = {
  data: { data: [], total: 0 },
  isLoading: false,
  isPending: false,
  isPaused: false,
  isError: false,
  isRefetching: false,
  refetch: jest.fn(),
};

const mockClassify = jest.fn();
const mockImageSearchMutateAsync = jest.fn();

jest.mock('@shared/hooks', () => ({
  useSearchPets: () => mockIdleSearchQuery,
  useStories: () => ({ data: [], isLoading: false }),
  useImageClassify: () => ({
    classify: (...args: unknown[]) => mockClassify(...args),
    isModelLoading: false,
    isClassifying: false,
    error: null,
  }),
  useImageSearchNative: () => ({
    mutateAsync: (...args: unknown[]) => mockImageSearchMutateAsync(...args),
    isPending: false,
  }),
}));

jest.mock('../components/PetCard', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return { PetCard: (props: any) => React.createElement(Text, null, `pet:${props.pet?.name ?? '?'}`) };
});

// This file otherwise relies on react-i18next's uninitialized-instance
// passthrough (`t(key)` -> `key`, or `opts.defaultValue` when given — see
// react-i18next's `notReadyT`). Suggestion 1 added `{ defaultValue: type }`
// to the two `pets:types.*` calls in this screen, and in that passthrough
// that makes ANY type ('perro', unmapped or not) render as its raw value —
// so the exact-match proxy below (translated key vs. raw literal) could no
// longer tell them apart. Resolving `pets:types.*` against the real locale —
// same idea as PetCard.test.tsx's mock — restores that: a known type
// genuinely translates ('perro' -> 'Perro'), while every other key keeps the
// original passthrough behaviour so no other assertion is affected.
jest.mock('react-i18next', () => {
  const petTypes = require('../../shared/i18n/locales/es.json').pets.types;
  return {
    useTranslation: () => ({
      t: (key: string, opts?: Record<string, unknown>) => {
        if (key.startsWith('pets:types.')) {
          const known = petTypes[key.slice('pets:types.'.length)];
          if (known) return known;
        }
        if (opts && typeof opts.defaultValue === 'string') return opts.defaultValue;
        return key;
      },
    }),
  };
});

beforeEach(() => {
  mockClassify.mockReset();
  mockImageSearchMutateAsync.mockReset();
  jest.spyOn(Alert, 'alert').mockImplementation((_title, _msg, buttons) => {
    // "camera" | "gallery" | "cancel" — press "gallery".
    buttons?.[1]?.onPress?.();
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('HomeScreen — el tipo de mascota de la búsqueda por foto sale de i18n', () => {
  it('resultado de búsqueda por foto (usuario autenticado): traduce el tipo, no el literal crudo', async () => {
    mockAuthState = { isAuthenticated: true };
    (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: 'file://photo.jpg' }],
    });
    mockImageSearchMutateAsync.mockResolvedValueOnce({
      results: [{ pet_id: 'p-1', name: 'Rex', type: 'perro', photo_url: undefined, similarity: 0.9 }],
    });

    render(<HomeScreen />);
    fireEvent.press(screen.getByText(/home:byPhoto/));

    // Exact match, not a substring regex: the unrelated type-filter chip row
    // ALSO renders `t('pets:types.perro')` (as "🐶 Perro" — icon + text as
    // sibling nodes in the same <Text>), which would satisfy a loose /Perro/
    // match regardless of this fix. The image-result row's Text has no icon
    // prefix, so its exact content is 'Perro' when translated and 'perro'
    // when raw/untranslated.
    expect(await screen.findByText('Perro')).toBeTruthy();
  });

  it('resultado de clasificación local (sin sesión): traduce el tipo cuando no hay raza', async () => {
    mockAuthState = { isAuthenticated: false };
    (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: 'file://photo.jpg' }],
    });
    mockClassify.mockResolvedValueOnce({ type: 'perro', breed: null, confidence: 0.87, rawLabels: [] });

    render(<HomeScreen />);
    fireEvent.press(screen.getByText(/home:byPhoto/));

    // Exact content of the classify chip's single Text node: 'Perro · 87%'
    // when translated, 'perro · 87%' when raw. See note above on why this
    // can't be a loose substring match.
    expect(await screen.findByText('Perro · 87%')).toBeTruthy();
  });
});
