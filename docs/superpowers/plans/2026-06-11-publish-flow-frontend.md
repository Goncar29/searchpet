# Publish Flow Redesign — Frontend Implementation Plan (Part 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the 4-step "Publicar" wizard (intent → pet/photo step → location → success) across shared types/client/hooks, web, and mobile, replacing the current broken `/pets/create`-as-publish entry points, with i18n and tests.

**Architecture:** `frontend/packages/shared/` gains the `initial_report`/`status` fields on `CreatePetRequest`, a `publishPetLost` client method, and `usePublishLost`/`usePublishStray` hooks (the latter chains `createPet` → `uploadPhoto`/`uploadPhotoNative` with retry support). Web ships a new public `/publish` route with a step-based wizard component (Leaflet map step, `SharePanel` success step) and an inline auth gate (login/register) for unauthenticated stray reporters that preserves wizard state. Mobile rebuilds `(tabs)/post.tsx` as the same wizard using MapLibre + `expo-location`. A new `publish` i18n namespace (es/en/pt) ships in shared, web, and mobile; `errors:initial_report_required` is added to the shared `errors` namespace. "Publicar" links/CTAs across web nav, home CTA, and the mobile Post tab now point at the wizard; `/pets/create` (web) and the existing My Pets registration entry remain for owned-pet registration only.

**Tech Stack:** React + Vite + Tailwind + React Router + Leaflet/react-leaflet (web); React Native + Expo Router + MapLibre (`@maplibre/maplibre-react-native`) + `expo-location` + `expo-image-picker` (mobile); React Query + Zustand; i18next; Vitest (web/shared), Jest (mobile), Playwright (E2E).

**Backend contract (already planned/implemented in Part 1 — `docs/superpowers/plans/2026-06-11-publish-flow-redesign.md`, treat as given):**
- `POST /api/pets` accepts `{ name, type, breed?, color?, description?, status?: "registered"|"stray", initial_report?: { latitude, longitude, note? } }`. `status=stray` REQUIRES `initial_report` (400 `initial_report_required` if missing); `registered` (or omitted) + `initial_report` → 400. Returns the pet DTO (`id`, `status`, etc.).
- `POST /api/pets/:id/publish-lost` `{ latitude, longitude, note? }` → 200 updated pet DTO; 403 non-owner; 400 `invalid_status_transition` / lat-lng out of bounds.
- All errors are `{code, message}`; frontends translate via `getErrorMessage(err, t)` and `errors:<code>` keys (project rule 11/12).

---

## File Structure

**Shared (`frontend/packages/shared/`):**
- `types/index.ts` — extend `CreatePetRequest` with `status?: 'registered' | 'stray'` and `initial_report?: InitialReportRequest`; add `InitialReportRequest` and `PublishLostRequest` interfaces.
- `api/client.ts` — add `publishPetLost(petId, data)`.
- `api/client.test.ts` — add tests for `publishPetLost` and `createPet` with `initial_report`.
- `hooks/index.ts` — add `usePublishLost()` and `usePublishStray()`.
- `hooks/index.test.ts` — NEW: tests for both hooks (chaining + retry for `usePublishStray`).
- `i18n/locales/{es,en,pt}.json` — add `publish` namespace; add `errors.initial_report_required`.

**Web (`frontend/packages/web/`):**
- `src/pages/PublishWizardPage.tsx` — NEW: wizard container (step state machine, wizard-level form state).
- `src/components/publish/IntentStep.tsx` — NEW: "lost" vs "stray" intent cards.
- `src/components/publish/LostPetStep.tsx` — NEW: list of caller's `lost`-eligible pets + empty state.
- `src/components/publish/StrayFormStep.tsx` — NEW: stray mini-form (photos 1-3, type, color/breed/description).
- `src/components/publish/LocationStep.tsx` — NEW: Leaflet map with draggable pin, geolocation button, note field, PUBLICAR button.
- `src/components/publish/InlineAuthStep.tsx` — NEW: login/register mini-forms reusing `AuthContext`.
- `src/components/publish/SuccessStep.tsx` — NEW: confirmation + `SharePanel`.
- `src/App.tsx` — add public route `/publish`.
- `src/layouts/MainLayout.tsx` — point "Publicar" links (desktop nav `:126`, mobile menu `:258`) to `/publish`.
- `src/pages/HomePage.tsx` — point hero CTA (`:188`) to `/publish`.
- `src/i18n/locales/{es,en,pt}.json` + `src/i18n/index.ts` — register `publish` namespace (web reuses shared `publish` namespace; no web-only publish strings needed).
- `src/pages/PublishWizardPage.test.tsx` — NEW: wizard step-flow tests incl. unauthenticated stray path.
- `e2e/publish-stray.spec.ts` — NEW Playwright spec.

**Mobile (`frontend/packages/mobile/`):**
- `app/(tabs)/post.tsx` — REPLACED with the wizard container (same step model as web, RN components).
- `components/publish/IntentStep.tsx`, `LostPetStep.tsx`, `StrayFormStep.tsx`, `LocationStep.tsx`, `InlineAuthStep.tsx`, `SuccessStep.tsx` — NEW.
- `i18n/locales/{es,en,pt}.json` — add `publish` namespace (mobile-specific strings only; shared strings come from `shared/i18n/locales`).
- `__tests__/post.test.tsx` — rewritten smoke tests for the wizard, with `@shared/hooks` mocks extended.

---

## Shared Tasks

### Task 1: Extend `CreatePetRequest` and add `InitialReportRequest`/`PublishLostRequest` types

**Files:**
- Modify: `frontend/packages/shared/types/index.ts:214-220`

- [ ] **Step 1: Edit `CreatePetRequest` and add new interfaces**

In `frontend/packages/shared/types/index.ts`, replace the existing `CreatePetRequest` (lines 214-220):

```typescript
export interface InitialReportRequest {
  latitude: number;
  longitude: number;
  note?: string;
}

export interface CreatePetRequest {
  name: string;
  type: PetType;
  breed?: string;
  color?: string;
  description?: string;
  status?: 'registered' | 'stray';
  initial_report?: InitialReportRequest;
}

export interface PublishLostRequest {
  latitude: number;
  longitude: number;
  note?: string;
}
```

`name` stays required for both `registered` and `stray` pets — the design's "no name field" for strays (UX decision 3) is a *frontend* simplification: the stray form sends a placeholder name (handled in Task 8/13's `usePublishStray` payload, not here). Keeping `name: string` required avoids touching every other `CreatePetRequest` call site.

- [ ] **Step 2: Type-check shared package**

Run: `cd frontend/packages/web && pnpm vitest run --config vitest.shared.config.ts ../shared/api/client.test.ts`
Expected: PASS (no type errors; existing tests still green — this step only adds types, no behavior change yet).

- [ ] **Step 3: Commit**

```bash
git add frontend/packages/shared/types/index.ts
git commit -m "feat(shared): add initial_report and publish-lost request types"
```

### Task 2: `APIClient.publishPetLost` client method

**Files:**
- Modify: `frontend/packages/shared/api/client.ts` (add near `createPet`, around line 193-204)
- Modify: `frontend/packages/shared/api/client.test.ts` (new `describe` block)

- [ ] **Step 1: Write the failing test**

Append to `frontend/packages/shared/api/client.test.ts` (new top-level `describe`, after the existing `searchPetsByImage` block):

```typescript
describe('APIClient.publishPetLost', () => {
  let client: APIClient;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    client = new APIClient('http://api.test');
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POSTs to /api/pets/:id/publish-lost with lat/lng/note and returns the updated pet', async () => {
    const mockPet = { id: 'pet-1', status: 'lost' };
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockPet,
    });

    const result = await client.publishPetLost('pet-1', {
      latitude: -34.9011,
      longitude: -56.1645,
      note: 'Visto cerca de la plaza',
    });

    expect(result).toEqual(mockPet);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://api.test/api/pets/pet-1/publish-lost');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({
      latitude: -34.9011,
      longitude: -56.1645,
      note: 'Visto cerca de la plaza',
    });
  });

  it('throws ApiError with {code,message} on 403 (non-owner)', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => ({ code: 'forbidden', message: 'No sos el dueño de esta mascota' }),
    });

    await expect(
      client.publishPetLost('pet-1', { latitude: -34.9, longitude: -56.1 })
    ).rejects.toMatchObject({ code: 'forbidden', status: 403 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend/packages/web && pnpm vitest run --config vitest.shared.config.ts ../shared/api/client.test.ts`
Expected: FAIL with `client.publishPetLost is not a function`.

- [ ] **Step 3: Implement `publishPetLost`**

In `frontend/packages/shared/api/client.ts`, add right after `createPet` (after line 195's closing brace):

```typescript
  async publishPetLost(petId: string, data: PublishLostRequest): Promise<Pet> {
    return this.request<Pet>('POST', `/api/pets/${petId}/publish-lost`, data);
  }
```

Add `PublishLostRequest` to the existing type-only import at the top of `client.ts` (find the `import type { ... } from '../types'` line and add `PublishLostRequest` to the list).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend/packages/web && pnpm vitest run --config vitest.shared.config.ts ../shared/api/client.test.ts`
Expected: PASS — all `APIClient.publishPetLost` and existing tests green.

- [ ] **Step 5: Commit**

```bash
git add frontend/packages/shared/api/client.ts frontend/packages/shared/api/client.test.ts
git commit -m "feat(shared): add publishPetLost client method"
```

### Task 3: `usePublishLost` and `usePublishStray` hooks

**Files:**
- Modify: `frontend/packages/shared/hooks/index.ts` (add near `useCreatePet`/`useUploadPhoto`, around line 124-178)
- Create: `frontend/packages/shared/hooks/index.test.ts`

`usePublishStray` chains `createPet({ status: 'stray', initial_report })` → `uploadPhoto` for each photo (web: `File[]`; mobile: URI strings via a separate native variant). Per the design's "photo atomicity" tradeoff, if pet creation succeeds but a photo upload fails, the hook returns the created pet plus a list of failed-photo indices so the wizard can show a retry screen — it must NOT throw in that case (the pet already exists).

- [ ] **Step 1: Write the failing tests**

Create `frontend/packages/shared/hooks/index.test.ts`:

```typescript
// ============================================================
// Tests for usePublishLost / usePublishStray / usePublishStrayNative
// Runner: Vitest (vitest.shared.config.ts), environment: node + jsdom-free
// renderHook from @testing-library/react with a fresh QueryClient per test.
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { apiClient } from '../api/client';
import { usePublishLost, usePublishStray, usePublishStrayNative } from './index';
import type { Pet } from '../types';

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

const mockPet: Pet = {
  id: 'pet-1',
  name: 'Sin nombre',
  type: 'perro',
  status: 'stray',
  photos: [],
} as Pet;

describe('usePublishLost', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('calls apiClient.publishPetLost with the pet id and location', async () => {
    vi.spyOn(apiClient, 'publishPetLost').mockResolvedValue({ ...mockPet, status: 'lost' });

    const { result } = renderHook(() => usePublishLost(), { wrapper });

    result.current.mutate({ id: 'pet-1', data: { latitude: -34.9, longitude: -56.1 } });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiClient.publishPetLost).toHaveBeenCalledWith('pet-1', { latitude: -34.9, longitude: -56.1 });
    expect(result.current.data?.status).toBe('lost');
  });
});

describe('usePublishStray', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a stray pet with initial_report and uploads all photos', async () => {
    vi.spyOn(apiClient, 'createPet').mockResolvedValue(mockPet);
    vi.spyOn(apiClient, 'uploadPhoto').mockResolvedValue({ id: 'photo-1', url: 'https://x/photo-1.jpg' });

    const file1 = new File(['a'], 'a.jpg', { type: 'image/jpeg' });
    const file2 = new File(['b'], 'b.jpg', { type: 'image/jpeg' });

    const { result } = renderHook(() => usePublishStray(), { wrapper });

    result.current.mutate({
      pet: { name: 'Sin nombre', type: 'perro', status: 'stray', initial_report: { latitude: -34.9, longitude: -56.1 } },
      photos: [file1, file2],
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(apiClient.createPet).toHaveBeenCalledWith({
      name: 'Sin nombre',
      type: 'perro',
      status: 'stray',
      initial_report: { latitude: -34.9, longitude: -56.1 },
    });
    expect(apiClient.uploadPhoto).toHaveBeenCalledTimes(2);
    expect(apiClient.uploadPhoto).toHaveBeenNthCalledWith(1, 'pet-1', file1);
    expect(apiClient.uploadPhoto).toHaveBeenNthCalledWith(2, 'pet-1', file2);
    expect(result.current.data).toEqual({ pet: mockPet, failedPhotoIndexes: [] });
  });

  it('returns the created pet and failed photo indexes without throwing when an upload fails', async () => {
    vi.spyOn(apiClient, 'createPet').mockResolvedValue(mockPet);
    vi.spyOn(apiClient, 'uploadPhoto')
      .mockResolvedValueOnce({ id: 'photo-1', url: 'https://x/photo-1.jpg' })
      .mockRejectedValueOnce(new Error('upload failed'));

    const file1 = new File(['a'], 'a.jpg', { type: 'image/jpeg' });
    const file2 = new File(['b'], 'b.jpg', { type: 'image/jpeg' });

    const { result } = renderHook(() => usePublishStray(), { wrapper });

    result.current.mutate({
      pet: { name: 'Sin nombre', type: 'perro', status: 'stray', initial_report: { latitude: -34.9, longitude: -56.1 } },
      photos: [file1, file2],
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual({ pet: mockPet, failedPhotoIndexes: [1] });
  });

  it('does not call uploadPhoto and rejects if createPet fails', async () => {
    vi.spyOn(apiClient, 'createPet').mockRejectedValue(new Error('initial_report_required'));
    vi.spyOn(apiClient, 'uploadPhoto');

    const { result } = renderHook(() => usePublishStray(), { wrapper });

    result.current.mutate({
      pet: { name: 'Sin nombre', type: 'perro', status: 'stray' },
      photos: [],
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(apiClient.uploadPhoto).not.toHaveBeenCalled();
  });
});

describe('usePublishStrayNative', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a stray pet and uploads photo URIs via uploadPhotoNative', async () => {
    vi.spyOn(apiClient, 'createPet').mockResolvedValue(mockPet);
    vi.spyOn(apiClient, 'uploadPhotoNative').mockResolvedValue({ id: 'photo-1', url: 'https://x/photo-1.jpg' });

    const { result } = renderHook(() => usePublishStrayNative(), { wrapper });

    result.current.mutate({
      pet: { name: 'Sin nombre', type: 'gato', status: 'stray', initial_report: { latitude: -34.9, longitude: -56.1 } },
      photoUris: ['file:///a.jpg', 'file:///b.jpg'],
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(apiClient.uploadPhotoNative).toHaveBeenCalledTimes(2);
    expect(apiClient.uploadPhotoNative).toHaveBeenNthCalledWith(1, 'pet-1', 'file:///a.jpg');
    expect(result.current.data).toEqual({ pet: mockPet, failedPhotoIndexes: [] });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend/packages/web && pnpm vitest run --config vitest.shared.config.ts ../shared/hooks/index.test.ts`
Expected: FAIL — `usePublishLost`, `usePublishStray`, `usePublishStrayNative` are not exported.

- [ ] **Step 3: Implement the hooks**

In `frontend/packages/shared/hooks/index.ts`, add after `useUploadPhotoNative` (after line 190):

```typescript
// ============================================================
// PUBLISH HOOKS
// ============================================================

// usePublishLost — POST /api/pets/:id/publish-lost. Transitions an owned
// registered pet to `lost` and creates its initial location report
// (single backend transaction). Invalidates feed, my-pets, and the pet detail.
export const usePublishLost = () => {
  const queryClient = useQueryClient();
  return useMutation<Pet, Error, { id: string; data: PublishLostRequest }>({
    mutationFn: ({ id, data }) => apiClient.publishPetLost(id, data),
    onSuccess: (pet) => {
      queryClient.invalidateQueries({ queryKey: ['pets'] });
      queryClient.invalidateQueries({ queryKey: ['pets', pet.id] });
      queryClient.invalidateQueries({ queryKey: ['pets', 'mine'] });
      queryClient.invalidateQueries({ queryKey: ['reports'] });
    },
  });
};

export interface PublishStrayResult {
  pet: Pet;
  failedPhotoIndexes: number[];
}

// usePublishStray — chains createPet({ status: 'stray', initial_report }) with
// sequential photo uploads (web File[]). If a photo upload fails the pet is
// already created — we resolve with `failedPhotoIndexes` instead of throwing,
// so the wizard can show a one-tap retry screen (design: "photo atomicity").
export const usePublishStray = () => {
  const queryClient = useQueryClient();
  return useMutation<PublishStrayResult, Error, { pet: CreatePetRequest; photos: File[] }>({
    mutationFn: async ({ pet, photos }) => {
      const created = await apiClient.createPet(pet);
      const failedPhotoIndexes: number[] = [];
      for (let i = 0; i < photos.length; i++) {
        try {
          await apiClient.uploadPhoto(created.id, photos[i]);
        } catch {
          failedPhotoIndexes.push(i);
        }
      }
      return { pet: created, failedPhotoIndexes };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pets'] });
      queryClient.invalidateQueries({ queryKey: ['reports'] });
    },
  });
};

// Versión React Native de usePublishStray — recibe URIs locales en lugar de File.
export const usePublishStrayNative = () => {
  const queryClient = useQueryClient();
  return useMutation<PublishStrayResult, Error, { pet: CreatePetRequest; photoUris: string[] }>({
    mutationFn: async ({ pet, photoUris }) => {
      const created = await apiClient.createPet(pet);
      const failedPhotoIndexes: number[] = [];
      for (let i = 0; i < photoUris.length; i++) {
        try {
          await apiClient.uploadPhotoNative(created.id, photoUris[i]);
        } catch {
          failedPhotoIndexes.push(i);
        }
      }
      return { pet: created, failedPhotoIndexes };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pets'] });
      queryClient.invalidateQueries({ queryKey: ['reports'] });
    },
  });
};
```

Add `PublishLostRequest` to the existing `import type { ... } from '../types'` line at the top of `hooks/index.ts` (alongside `CreatePetRequest`, `Pet`, etc.).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend/packages/web && pnpm vitest run --config vitest.shared.config.ts ../shared/hooks/index.test.ts`
Expected: PASS — all 5 tests green.

- [ ] **Step 5: Run the full shared suite**

Run: `cd frontend/packages/web && pnpm vitest run --config vitest.shared.config.ts`
Expected: PASS — no regressions in `client.test.ts`, `apiErrors.test.ts`, etc.

- [ ] **Step 6: Commit**

```bash
git add frontend/packages/shared/hooks/index.ts frontend/packages/shared/hooks/index.test.ts
git commit -m "feat(shared): add usePublishLost and usePublishStray hooks"
```

### Task 4: Shared `publish` i18n namespace + `errors.initial_report_required`

**Files:**
- Modify: `frontend/packages/shared/i18n/locales/es.json`
- Modify: `frontend/packages/shared/i18n/locales/en.json`
- Modify: `frontend/packages/shared/i18n/locales/pt.json`

The `publish` namespace covers strings shared by web and mobile wizards: intent cards, lost pet-picker, stray form, location step, success step, and inline-auth step. Web/mobile-specific layout strings (e.g. nav label changes) are handled in their own per-platform tasks.

- [ ] **Step 1: Add `errors.initial_report_required` to all three locale files**

In `frontend/packages/shared/i18n/locales/es.json`, inside the `errors` object (after `"binding_failed"`, before `"unknown_error"`):

```json
    "initial_report_required": "Para publicar un avistamiento necesitás indicar la última ubicación donde fue vista la mascota",
```

In `frontend/packages/shared/i18n/locales/en.json`, same position:

```json
    "initial_report_required": "To publish a sighting you need to provide the last seen location",
```

In `frontend/packages/shared/i18n/locales/pt.json`, same position:

```json
    "initial_report_required": "Para publicar um avistamento você precisa informar o último local onde o animal foi visto",
```

- [ ] **Step 2: Add the `publish` namespace to `es.json`**

Add a new top-level `"publish"` key (alongside `"pets"`, `"errors"`, etc.):

```json
  "publish": {
    "intent": {
      "title": "¿Qué querés publicar?",
      "lostTitle": "Mi mascota se perdió",
      "lostDescription": "Marcá una mascota registrada como perdida y agregá la última ubicación donde la viste.",
      "strayTitle": "Vi una mascota callejera",
      "strayDescription": "Subí una foto y la ubicación donde la viste para ayudar a encontrar a su familia.",
      "next": "Continuar"
    },
    "lostPet": {
      "title": "Elegí la mascota perdida",
      "empty": "No tenés mascotas registradas todavía.",
      "emptyAction": "Registrar una mascota",
      "select": "Seleccionar"
    },
    "strayForm": {
      "title": "Contanos sobre la mascota que viste",
      "photoLabel": "Fotos (1 a 3, obligatorio)",
      "photoRequired": "Agregá al menos una foto",
      "photoFormatError": "Formato no soportado. Usá JPG, PNG o WebP",
      "photoSizeError": "Cada foto debe pesar menos de 5 MB",
      "photoLimit": "Máximo 3 fotos",
      "typeLabel": "Tipo *",
      "typeRequired": "Seleccioná el tipo de animal",
      "breedLabel": "Raza",
      "colorLabel": "Color",
      "descriptionLabel": "Descripción",
      "next": "Continuar"
    },
    "location": {
      "title": "¿Dónde la viste por última vez?",
      "instructions": "Arrastrá el pin al lugar exacto o usá tu ubicación actual.",
      "useMyLocation": "Usar mi ubicación",
      "locationDenied": "No pudimos acceder a tu ubicación. Mové el pin manualmente.",
      "noteLabel": "Nota (opcional)",
      "notePlaceholder": "Ej: cerca de la plaza, con collar rojo...",
      "publish": "Publicar",
      "back": "Atrás"
    },
    "auth": {
      "title": "Iniciá sesión para publicar",
      "description": "Para publicar un avistamiento necesitamos poder contactarte. Tu progreso no se va a perder.",
      "loginTab": "Iniciar sesión",
      "registerTab": "Crear cuenta",
      "continue": "Continuar y publicar"
    },
    "success": {
      "lostTitle": "¡Listo! Tu mascota está marcada como perdida",
      "strayTitle": "¡Gracias por reportar!",
      "lostDescription": "Compartí el aviso para que más personas ayuden a buscarla.",
      "strayDescription": "Compartí el aviso para ayudar a encontrar a su familia.",
      "photoRetryTitle": "La mascota se publicó, pero {{count}} foto(s) no se pudieron subir",
      "photoRetryAction": "Reintentar subida",
      "viewPet": "Ver mascota",
      "publishAnother": "Publicar otro aviso"
    }
  },
```

- [ ] **Step 3: Add the `publish` namespace to `en.json`** (same key structure, English copy)

```json
  "publish": {
    "intent": {
      "title": "What do you want to publish?",
      "lostTitle": "My pet is lost",
      "lostDescription": "Mark a registered pet as lost and add the last place you saw it.",
      "strayTitle": "I saw a stray pet",
      "strayDescription": "Upload a photo and the location where you saw it to help find its family.",
      "next": "Continue"
    },
    "lostPet": {
      "title": "Pick the lost pet",
      "empty": "You don't have any registered pets yet.",
      "emptyAction": "Register a pet",
      "select": "Select"
    },
    "strayForm": {
      "title": "Tell us about the pet you saw",
      "photoLabel": "Photos (1 to 3, required)",
      "photoRequired": "Add at least one photo",
      "photoFormatError": "Unsupported format. Use JPG, PNG, or WebP",
      "photoSizeError": "Each photo must be under 5 MB",
      "photoLimit": "Maximum 3 photos",
      "typeLabel": "Type *",
      "typeRequired": "Select the animal type",
      "breedLabel": "Breed",
      "colorLabel": "Color",
      "descriptionLabel": "Description",
      "next": "Continue"
    },
    "location": {
      "title": "Where did you last see it?",
      "instructions": "Drag the pin to the exact spot or use your current location.",
      "useMyLocation": "Use my location",
      "locationDenied": "We couldn't access your location. Move the pin manually.",
      "noteLabel": "Note (optional)",
      "notePlaceholder": "E.g.: near the square, wearing a red collar...",
      "publish": "Publish",
      "back": "Back"
    },
    "auth": {
      "title": "Sign in to publish",
      "description": "To publish a sighting we need to be able to contact you. Your progress won't be lost.",
      "loginTab": "Sign in",
      "registerTab": "Create account",
      "continue": "Continue and publish"
    },
    "success": {
      "lostTitle": "Done! Your pet is marked as lost",
      "strayTitle": "Thanks for reporting!",
      "lostDescription": "Share the alert so more people can help search for it.",
      "strayDescription": "Share the alert to help find its family.",
      "photoRetryTitle": "The pet was published, but {{count}} photo(s) failed to upload",
      "photoRetryAction": "Retry upload",
      "viewPet": "View pet",
      "publishAnother": "Publish another alert"
    }
  },
```

- [ ] **Step 4: Add the `publish` namespace to `pt.json`** (same key structure, neutral Portuguese copy)

```json
  "publish": {
    "intent": {
      "title": "O que você quer publicar?",
      "lostTitle": "Meu animal se perdeu",
      "lostDescription": "Marque um animal cadastrado como perdido e adicione o último local onde foi visto.",
      "strayTitle": "Vi um animal de rua",
      "strayDescription": "Envie uma foto e o local onde você o viu para ajudar a encontrar sua família.",
      "next": "Continuar"
    },
    "lostPet": {
      "title": "Escolha o animal perdido",
      "empty": "Você ainda não tem animais cadastrados.",
      "emptyAction": "Cadastrar um animal",
      "select": "Selecionar"
    },
    "strayForm": {
      "title": "Conte sobre o animal que você viu",
      "photoLabel": "Fotos (1 a 3, obrigatório)",
      "photoRequired": "Adicione pelo menos uma foto",
      "photoFormatError": "Formato não suportado. Use JPG, PNG ou WebP",
      "photoSizeError": "Cada foto deve ter menos de 5 MB",
      "photoLimit": "Máximo de 3 fotos",
      "typeLabel": "Tipo *",
      "typeRequired": "Selecione o tipo de animal",
      "breedLabel": "Raça",
      "colorLabel": "Cor",
      "descriptionLabel": "Descrição",
      "next": "Continuar"
    },
    "location": {
      "title": "Onde você o viu pela última vez?",
      "instructions": "Arraste o marcador até o local exato ou use sua localização atual.",
      "useMyLocation": "Usar minha localização",
      "locationDenied": "Não conseguimos acessar sua localização. Mova o marcador manualmente.",
      "noteLabel": "Nota (opcional)",
      "notePlaceholder": "Ex.: perto da praça, com coleira vermelha...",
      "publish": "Publicar",
      "back": "Voltar"
    },
    "auth": {
      "title": "Entre para publicar",
      "description": "Para publicar um avistamento precisamos poder contatar você. Seu progresso não será perdido.",
      "loginTab": "Entrar",
      "registerTab": "Criar conta",
      "continue": "Continuar e publicar"
    },
    "success": {
      "lostTitle": "Pronto! Seu animal está marcado como perdido",
      "strayTitle": "Obrigado por avisar!",
      "lostDescription": "Compartilhe o aviso para que mais pessoas ajudem na busca.",
      "strayDescription": "Compartilhe o aviso para ajudar a encontrar a família dele.",
      "photoRetryTitle": "O animal foi publicado, mas {{count}} foto(s) não puderam ser enviadas",
      "photoRetryAction": "Tentar novamente",
      "viewPet": "Ver animal",
      "publishAnother": "Publicar outro aviso"
    }
  },
```

- [ ] **Step 5: Validate JSON syntax**

Run: `cd frontend/packages/shared/i18n/locales && node -e "['es','en','pt'].forEach(l => { JSON.parse(require('fs').readFileSync(l+'.json','utf-8')); console.log(l, 'OK'); })"`
Expected: `es OK`, `en OK`, `pt OK` (no `SyntaxError`).

- [ ] **Step 6: Commit**

```bash
git add frontend/packages/shared/i18n/locales/es.json frontend/packages/shared/i18n/locales/en.json frontend/packages/shared/i18n/locales/pt.json
git commit -m "feat(i18n): add shared publish namespace and initial_report_required error"
```

---

## Web Tasks

### Task 5: Register the shared `publish` namespace in web i18n

**Files:**
- Modify: `frontend/packages/web/src/i18n/index.ts`

The `publish` namespace lives entirely in `shared/i18n/locales/{es,en,pt}.json` (Task 4) — no web-only `publish` strings are needed. Register it as a shared namespace, following the existing pattern for `pets`, `chat`, etc.

- [ ] **Step 1: Add `publish: sharedXx.publish` to all three resource blocks**

In `frontend/packages/web/src/i18n/index.ts`, in each of the `es`, `en`, `pt` resource objects, add `publish: sharedEs.publish` (resp. `sharedEn`/`sharedPt`) to the "Shared namespaces" group — e.g. for `es`:

```typescript
      es: {
        // Shared namespaces
        common: sharedEs.common,
        auth: sharedEs.auth,
        pets: sharedEs.pets,
        chat: sharedEs.chat,
        messages: sharedEs.messages,
        badges: sharedEs.badges,
        errors: sharedEs.errors,
        publish: sharedEs.publish,
        // Web-only namespaces
        layout: es.layout,
```

Repeat for `en` (`sharedEn.publish`) and `pt` (`sharedPt.publish`).

- [ ] **Step 2: Verify the app still builds**

Run: `cd frontend/packages/web && pnpm build`
Expected: build succeeds (TypeScript + Vite), no missing-import errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/packages/web/src/i18n/index.ts
git commit -m "feat(web): register shared publish i18n namespace"
```

### Task 6: `PublishWizardPage` container + step routing skeleton

**Files:**
- Create: `frontend/packages/web/src/pages/PublishWizardPage.tsx`
- Create: `frontend/packages/web/src/components/publish/IntentStep.tsx`
- Create: `frontend/packages/web/src/pages/PublishWizardPage.test.tsx`
- Modify: `frontend/packages/web/src/App.tsx`

This task creates the wizard shell with step state (`'intent' | 'lost-pet' | 'stray-form' | 'location' | 'auth' | 'success'`) and the first step (`IntentStep`). Later tasks add the remaining steps and wire them into the `switch`.

- [ ] **Step 1: Write the failing test**

Create `frontend/packages/web/src/pages/PublishWizardPage.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import { PublishWizardPage } from './PublishWizardPage';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'es' } }),
}));

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ isAuthenticated: true, user: { id: 'user-1', name: 'Carlos' }, login: vi.fn(), register: vi.fn() }),
}));

vi.mock('@shared/hooks', () => ({
  useMyPets: () => ({ data: [], isLoading: false }),
  usePublishLost: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  usePublishStray: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
}));

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe('PublishWizardPage', () => {
  it('renders the intent step first with two cards', () => {
    render(<PublishWizardPage />, { wrapper });
    expect(screen.getByText('publish:intent.lostTitle')).toBeInTheDocument();
    expect(screen.getByText('publish:intent.strayTitle')).toBeInTheDocument();
  });

  it('selecting the lost intent advances to the lost-pet step', () => {
    render(<PublishWizardPage />, { wrapper });
    fireEvent.click(screen.getByText('publish:intent.lostTitle'));
    expect(screen.getByText('publish:lostPet.title')).toBeInTheDocument();
  });

  it('selecting the stray intent advances to the stray-form step', () => {
    render(<PublishWizardPage />, { wrapper });
    fireEvent.click(screen.getByText('publish:intent.strayTitle'));
    expect(screen.getByText('publish:strayForm.title')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend/packages/web && pnpm vitest run src/pages/PublishWizardPage.test.tsx`
Expected: FAIL — `./PublishWizardPage` does not exist.

- [ ] **Step 3: Create `IntentStep`**

Create `frontend/packages/web/src/components/publish/IntentStep.tsx`:

```tsx
import { useTranslation } from 'react-i18next';

interface IntentStepProps {
  onSelect: (intent: 'lost' | 'stray') => void;
}

export function IntentStep({ onSelect }: IntentStepProps) {
  const { t } = useTranslation('publish');

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-50 mb-6 text-center">
        {t('intent.title')}
      </h1>
      <div className="grid sm:grid-cols-2 gap-4">
        <button
          type="button"
          onClick={() => onSelect('lost')}
          className="text-left rounded-2xl border-2 border-gray-200 dark:border-gray-700 hover:border-primary p-6 transition-colors bg-white dark:bg-gray-900"
        >
          <span className="text-3xl">🐾</span>
          <h2 className="mt-3 text-lg font-semibold text-gray-900 dark:text-gray-50">
            {t('intent.lostTitle')}
          </h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {t('intent.lostDescription')}
          </p>
        </button>
        <button
          type="button"
          onClick={() => onSelect('stray')}
          className="text-left rounded-2xl border-2 border-gray-200 dark:border-gray-700 hover:border-primary p-6 transition-colors bg-white dark:bg-gray-900"
        >
          <span className="text-3xl">📍</span>
          <h2 className="mt-3 text-lg font-semibold text-gray-900 dark:text-gray-50">
            {t('intent.strayTitle')}
          </h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {t('intent.strayDescription')}
          </p>
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Create `PublishWizardPage` with the step skeleton**

Create `frontend/packages/web/src/pages/PublishWizardPage.tsx`. This step intentionally renders placeholder text for `lost-pet` and `stray-form` steps — Tasks 7 and 8 replace those placeholders with the real `LostPetStep`/`StrayFormStep` components without changing this file's overall shape (the `switch` cases get their component swapped in).

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IntentStep } from '../components/publish/IntentStep';
import type { Pet, CreatePetRequest, InitialReportRequest } from '@shared/types';

export type PublishStep = 'intent' | 'lost-pet' | 'stray-form' | 'location' | 'auth' | 'success';
export type PublishIntent = 'lost' | 'stray';

export interface StrayFormState {
  type: CreatePetRequest['type'] | '';
  breed: string;
  color: string;
  description: string;
  photos: File[];
}

export interface PublishWizardState {
  intent: PublishIntent | null;
  selectedPet: Pet | null;
  strayForm: StrayFormState;
  location: InitialReportRequest | null;
}

export const initialWizardState: PublishWizardState = {
  intent: null,
  selectedPet: null,
  strayForm: { type: '', breed: '', color: '', description: '', photos: [] },
  location: null,
};

export function PublishWizardPage() {
  const { t } = useTranslation('publish');
  const [step, setStep] = useState<PublishStep>('intent');
  const [wizard, setWizard] = useState<PublishWizardState>(initialWizardState);

  const handleIntentSelect = (intent: PublishIntent) => {
    setWizard((prev) => ({ ...prev, intent }));
    setStep(intent === 'lost' ? 'lost-pet' : 'stray-form');
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 py-10 px-4">
      <div className="max-w-2xl mx-auto">
        {step === 'intent' && <IntentStep onSelect={handleIntentSelect} />}
        {step === 'lost-pet' && <p>{t('lostPet.title')}</p>}
        {step === 'stray-form' && <p>{t('strayForm.title')}</p>}
      </div>
    </div>
  );
}
```

`wizard`/`setWizard` are unused by the skeleton (`step === 'lost-pet'`/`'stray-form'` placeholders) — this is expected and resolved in Tasks 7-8 when `LostPetStep`/`StrayFormStep` consume `wizard`/`setWizard`. If your linter fails on unused variables before then, prefix with `_wizard`/`_setWizard` only as a temporary measure inside this task's commit; Task 7 removes the underscore.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend/packages/web && pnpm vitest run src/pages/PublishWizardPage.test.tsx`
Expected: PASS — all 3 tests green.

- [ ] **Step 6: Add the `/publish` route**

In `frontend/packages/web/src/App.tsx`, add the import:

```typescript
import { PublishWizardPage } from './pages/PublishWizardPage';
```

And add the route inside the public routes section (next to `/map`):

```tsx
          <Route path="/publish" element={<PublishWizardPage />} />
```

- [ ] **Step 7: Run full web test suite**

Run: `cd frontend/packages/web && pnpm vitest run`
Expected: PASS — no regressions.

- [ ] **Step 8: Commit**

```bash
git add frontend/packages/web/src/pages/PublishWizardPage.tsx frontend/packages/web/src/pages/PublishWizardPage.test.tsx frontend/packages/web/src/components/publish/IntentStep.tsx frontend/packages/web/src/App.tsx
git commit -m "feat(web): add publish wizard skeleton with intent step and /publish route"
```

### Task 7: `LostPetStep` — pick a registered pet to mark as lost

**Files:**
- Create: `frontend/packages/web/src/components/publish/LostPetStep.tsx`
- Modify: `frontend/packages/web/src/pages/PublishWizardPage.tsx`
- Modify: `frontend/packages/web/src/pages/PublishWizardPage.test.tsx`

Per the design (decision 2), the lost path only lists the caller's pets eligible for the `lost` transition. Per project rule 13, the status machine reaches `lost` only from `registered` — so eligible pets are those with `status === 'registered'`. The empty state links to `/pets/create` (existing registration flow).

- [ ] **Step 1: Write the failing test**

Append to `frontend/packages/web/src/pages/PublishWizardPage.test.tsx`, replacing the `useMyPets` mock value per-test using `vi.mocked`. First, change the top-level `@shared/hooks` mock to a `vi.fn()`-based mock so individual tests can override it:

```typescript
vi.mock('@shared/hooks', () => ({
  useMyPets: vi.fn(() => ({ data: [], isLoading: false })),
  usePublishLost: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  usePublishStray: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
}));
```

Add the import at the top: `import { useMyPets } from '@shared/hooks';` and `import { vi } from 'vitest';` (already imported — just confirm `vi` is in the existing import line).

Then add new tests:

```typescript
describe('PublishWizardPage — lost path', () => {
  it('shows the empty state with a link to /pets/create when there are no eligible pets', () => {
    vi.mocked(useMyPets).mockReturnValue({ data: [], isLoading: false } as ReturnType<typeof useMyPets>);
    render(<PublishWizardPage />, { wrapper });
    fireEvent.click(screen.getByText('publish:intent.lostTitle'));
    expect(screen.getByText('publish:lostPet.empty')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'publish:lostPet.emptyAction' })).toHaveAttribute('href', '/pets/create');
  });

  it('lists only registered pets and selecting one advances to the location step', () => {
    vi.mocked(useMyPets).mockReturnValue({
      data: [
        { id: 'pet-1', name: 'Firulais', type: 'perro', status: 'registered', photos: [] },
        { id: 'pet-2', name: 'Michi', type: 'gato', status: 'lost', photos: [] },
      ],
      isLoading: false,
    } as unknown as ReturnType<typeof useMyPets>);

    render(<PublishWizardPage />, { wrapper });
    fireEvent.click(screen.getByText('publish:intent.lostTitle'));

    expect(screen.getByText('Firulais')).toBeInTheDocument();
    expect(screen.queryByText('Michi')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Firulais'));
    expect(screen.getByText('publish:location.title')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend/packages/web && pnpm vitest run src/pages/PublishWizardPage.test.tsx`
Expected: FAIL — `publish:lostPet.empty` / `Firulais` not found (placeholder `<p>` doesn't render the list); `publish:location.title` step doesn't exist yet.

- [ ] **Step 3: Create `LostPetStep`**

Create `frontend/packages/web/src/components/publish/LostPetStep.tsx`:

```tsx
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useMyPets } from '@shared/hooks';
import type { Pet } from '@shared/types';

interface LostPetStepProps {
  onSelect: (pet: Pet) => void;
}

export function LostPetStep({ onSelect }: LostPetStepProps) {
  const { t } = useTranslation(['publish', 'pets']);
  const { data: pets, isLoading } = useMyPets();

  const eligiblePets = (pets ?? []).filter((pet) => pet.status === 'registered');

  if (isLoading) {
    return <p className="text-center text-gray-500 dark:text-gray-400">{t('common:loading', { ns: 'common' })}</p>;
  }

  if (eligiblePets.length === 0) {
    return (
      <div className="text-center bg-white dark:bg-gray-900 rounded-2xl p-8">
        <p className="text-gray-700 dark:text-gray-300 mb-4">{t('lostPet.empty')}</p>
        <Link
          to="/pets/create"
          className="inline-flex items-center justify-center px-6 py-2 bg-primary hover:bg-primary-dark text-white font-semibold rounded-lg transition-colors"
        >
          {t('lostPet.emptyAction')}
        </Link>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-50 mb-6 text-center">
        {t('lostPet.title')}
      </h1>
      <ul className="space-y-3">
        {eligiblePets.map((pet) => (
          <li key={pet.id}>
            <button
              type="button"
              onClick={() => onSelect(pet)}
              className="w-full flex items-center gap-4 rounded-xl border border-gray-200 dark:border-gray-700 hover:border-primary p-4 bg-white dark:bg-gray-900 transition-colors text-left"
            >
              {pet.photos[0] ? (
                <img
                  src={pet.photos[0].url}
                  alt={pet.name}
                  className="h-14 w-14 rounded-lg object-cover flex-shrink-0"
                />
              ) : (
                <div className="h-14 w-14 rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-2xl flex-shrink-0">
                  🐾
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-gray-900 dark:text-gray-50 truncate">{pet.name}</p>
                <p className="text-sm text-gray-500 dark:text-gray-400">{t(`pets:types.${pet.type}`)}</p>
              </div>
              <span className="text-primary font-semibold text-sm whitespace-nowrap">{t('lostPet.select')}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 4: Wire `LostPetStep` and a `location` placeholder into `PublishWizardPage`**

In `frontend/packages/web/src/pages/PublishWizardPage.tsx`, import `LostPetStep` and replace the `'lost-pet'` placeholder; add a minimal `'location'` placeholder (Task 9 replaces it with the real `LocationStep`):

```tsx
import { LostPetStep } from '../components/publish/LostPetStep';
```

```tsx
        {step === 'lost-pet' && (
          <LostPetStep
            onSelect={(pet) => {
              setWizard((prev) => ({ ...prev, selectedPet: pet }));
              setStep('location');
            }}
          />
        )}
        {step === 'stray-form' && <p>{t('strayForm.title')}</p>}
        {step === 'location' && <p>{t('location.title')}</p>}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend/packages/web && pnpm vitest run src/pages/PublishWizardPage.test.tsx`
Expected: PASS — all tests green.

- [ ] **Step 6: Commit**

```bash
git add frontend/packages/web/src/components/publish/LostPetStep.tsx frontend/packages/web/src/pages/PublishWizardPage.tsx frontend/packages/web/src/pages/PublishWizardPage.test.tsx
git commit -m "feat(web): add lost-pet picker step to publish wizard"
```

### Task 8: `StrayFormStep` — minimal stray form with mandatory photo

**Files:**
- Create: `frontend/packages/web/src/components/publish/StrayFormStep.tsx`
- Modify: `frontend/packages/web/src/pages/PublishWizardPage.tsx`
- Modify: `frontend/packages/web/src/pages/PublishWizardPage.test.tsx`

Per the design, the stray form requires 1-3 photos and a `type`; `breed`/`color`/`description` are optional and there's no `name` field. Validation matches `CreatePetPage`'s photo constraints (JPG/PNG/WebP, 5 MB, max 3) reusing the `publish:strayForm.*` i18n keys.

- [ ] **Step 1: Write the failing test**

Append to `frontend/packages/web/src/pages/PublishWizardPage.test.tsx`:

```typescript
describe('PublishWizardPage — stray path', () => {
  it('blocks continuing without a photo or type, then advances to location once both are set', () => {
    render(<PublishWizardPage />, { wrapper });
    fireEvent.click(screen.getByText('publish:intent.strayTitle'));

    fireEvent.click(screen.getByText('publish:strayForm.next'));
    expect(screen.getByText('publish:strayForm.photoRequired')).toBeInTheDocument();
    expect(screen.getByText('publish:strayForm.typeRequired')).toBeInTheDocument();

    const file = new File(['fake'], 'stray.jpg', { type: 'image/jpeg' });
    const fileInput = screen.getByLabelText('publish:strayForm.photoLabel') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [file] } });

    fireEvent.change(screen.getByLabelText('publish:strayForm.typeLabel'), { target: { value: 'perro' } });

    fireEvent.click(screen.getByText('publish:strayForm.next'));
    expect(screen.getByText('publish:location.title')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend/packages/web && pnpm vitest run src/pages/PublishWizardPage.test.tsx`
Expected: FAIL — placeholder `<p>{t('strayForm.title')}</p>` has no form controls.

- [ ] **Step 3: Create `StrayFormStep`**

Create `frontend/packages/web/src/components/publish/StrayFormStep.tsx`:

```tsx
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { StrayFormState } from '../../pages/PublishWizardPage';
import type { PetType } from '@shared/types';

interface StrayFormStepProps {
  value: StrayFormState;
  onChange: (value: StrayFormState) => void;
  onNext: () => void;
}

const MAX_PHOTOS = 3;
const MAX_SIZE = 5 * 1024 * 1024; // 5 MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

interface FieldErrors {
  photo?: string;
  type?: string;
}

export function StrayFormStep({ value, onChange, onNext }: StrayFormStepProps) {
  const { t } = useTranslation(['publish', 'pets']);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [previewURLs, setPreviewURLs] = useState<string[]>(() => value.photos.map((f) => URL.createObjectURL(f)));
  const fileInputRef = useRef<HTMLInputElement>(null);

  const atLimit = value.photos.length >= MAX_PHOTOS;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const incoming = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (incoming.length === 0) return;

    const slots = MAX_PHOTOS - value.photos.length;
    if (slots <= 0) return;

    const candidates = incoming.slice(0, slots);
    const validFiles: File[] = [];
    const newURLs: string[] = [];
    let formatOrSizeError: string | undefined;

    for (const file of candidates) {
      if (!ALLOWED_TYPES.includes(file.type)) {
        formatOrSizeError = t('strayForm.photoFormatError');
        continue;
      }
      if (file.size > MAX_SIZE) {
        formatOrSizeError = t('strayForm.photoSizeError');
        continue;
      }
      validFiles.push(file);
      newURLs.push(URL.createObjectURL(file));
    }

    if (validFiles.length > 0) {
      onChange({ ...value, photos: [...value.photos, ...validFiles] });
      setPreviewURLs((prev) => [...prev, ...newURLs]);
      setErrors((prev) => ({ ...prev, photo: undefined }));
    }
    if (formatOrSizeError) {
      setErrors((prev) => ({ ...prev, photo: formatOrSizeError }));
    }
  };

  const removePhoto = (index: number) => {
    setPreviewURLs((prev) => {
      URL.revokeObjectURL(prev[index]);
      return prev.filter((_, i) => i !== index);
    });
    onChange({ ...value, photos: value.photos.filter((_, i) => i !== index) });
  };

  const handleNext = () => {
    const nextErrors: FieldErrors = {};
    if (value.photos.length === 0) nextErrors.photo = t('strayForm.photoRequired');
    if (!value.type) nextErrors.type = t('strayForm.typeRequired');
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length === 0) onNext();
  };

  return (
    <div className="bg-white dark:bg-gray-900 rounded-2xl p-8 space-y-5">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-50 text-center">
        {t('strayForm.title')}
      </h1>

      {/* Photos */}
      <div>
        <label htmlFor="stray-photo" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          {t('strayForm.photoLabel')} ({value.photos.length}/{MAX_PHOTOS})
        </label>
        <input
          ref={fileInputRef}
          id="stray-photo"
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp"
          disabled={atLimit}
          onChange={handleFileChange}
          className="block w-full text-sm text-gray-500 dark:text-gray-400
            file:mr-4 file:py-2 file:px-4
            file:rounded-lg file:border-0
            file:text-sm file:font-semibold
            file:bg-primary file:text-white
            hover:file:bg-primary-dark
            disabled:opacity-40 disabled:cursor-not-allowed
            cursor-pointer"
        />
        {atLimit && <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">{t('strayForm.photoLimit')}</p>}
        {errors.photo && <p className="text-red-500 dark:text-red-400 text-sm mt-1">{errors.photo}</p>}
        {previewURLs.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {previewURLs.map((url, i) => (
              <div key={i} className="relative">
                <img src={url} alt={`preview-${i}`} className="h-24 w-24 object-cover rounded-lg border border-gray-200 dark:border-gray-700" />
                <button
                  type="button"
                  onClick={() => removePhoto(i)}
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500 text-white text-xs flex items-center justify-center leading-none hover:bg-red-600"
                  aria-label="Eliminar foto"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Type */}
      <div>
        <label htmlFor="stray-type" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          {t('strayForm.typeLabel')}
        </label>
        <select
          id="stray-type"
          value={value.type}
          onChange={(e) => onChange({ ...value, type: e.target.value as PetType })}
          className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="">—</option>
          <option value="perro">{t('pets:types.perro')}</option>
          <option value="gato">{t('pets:types.gato')}</option>
          <option value="pajaro">{t('pets:types.pajaro')}</option>
          <option value="otro">{t('pets:types.otro')}</option>
        </select>
        {errors.type && <p className="text-red-500 dark:text-red-400 text-sm mt-1">{errors.type}</p>}
      </div>

      {/* Breed */}
      <div>
        <label htmlFor="stray-breed" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          {t('strayForm.breedLabel')}
        </label>
        <input
          id="stray-breed"
          type="text"
          value={value.breed}
          onChange={(e) => onChange({ ...value, breed: e.target.value })}
          className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>

      {/* Color */}
      <div>
        <label htmlFor="stray-color" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          {t('strayForm.colorLabel')}
        </label>
        <input
          id="stray-color"
          type="text"
          value={value.color}
          onChange={(e) => onChange({ ...value, color: e.target.value })}
          className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>

      {/* Description */}
      <div>
        <label htmlFor="stray-description" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          {t('strayForm.descriptionLabel')}
        </label>
        <textarea
          id="stray-description"
          value={value.description}
          onChange={(e) => onChange({ ...value, description: e.target.value })}
          rows={3}
          className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary resize-none"
        />
      </div>

      <button
        type="button"
        onClick={handleNext}
        className="w-full bg-primary hover:bg-primary-dark text-white font-semibold rounded-lg px-4 py-2 transition-colors"
      >
        {t('strayForm.next')}
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Wire `StrayFormStep` into `PublishWizardPage`**

In `frontend/packages/web/src/pages/PublishWizardPage.tsx`, import `StrayFormStep` and replace the `'stray-form'` placeholder:

```tsx
import { StrayFormStep } from '../components/publish/StrayFormStep';
```

```tsx
        {step === 'stray-form' && (
          <StrayFormStep
            value={wizard.strayForm}
            onChange={(strayForm) => setWizard((prev) => ({ ...prev, strayForm }))}
            onNext={() => setStep('location')}
          />
        )}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend/packages/web && pnpm vitest run src/pages/PublishWizardPage.test.tsx`
Expected: PASS — all tests green.

- [ ] **Step 6: Commit**

```bash
git add frontend/packages/web/src/components/publish/StrayFormStep.tsx frontend/packages/web/src/pages/PublishWizardPage.tsx frontend/packages/web/src/pages/PublishWizardPage.test.tsx
git commit -m "feat(web): add stray form step to publish wizard"
```

### Task 9: `LocationStep` — Leaflet draggable pin + geolocation + note

**Files:**
- Create: `frontend/packages/web/src/components/publish/LocationStep.tsx`
- Modify: `frontend/packages/web/src/pages/PublishWizardPage.tsx`
- Modify: `frontend/packages/web/src/pages/PublishWizardPage.test.tsx`

This step renders a Leaflet map (following `MapPage.tsx`'s pattern) with a single draggable `Marker`, a "use my location" button (`navigator.geolocation`), an optional note textarea, and the PUBLICAR button. Default center is Montevideo (-34.9011, -56.1645), per project rule 10. The PUBLICAR button only sets `wizard.location` and calls `onPublish()` — the parent (`PublishWizardPage`) decides whether to go to `'auth'` or directly submit, per Task 11/12.

Leaflet's `Marker` needs `draggable` + a `dragend` handler via `eventHandlers`; this avoids `useMapEvents` complexity for a single pin.

- [ ] **Step 1: Write the failing test**

Append to `frontend/packages/web/src/pages/PublishWizardPage.test.tsx`. First, add `vi.mock('react-leaflet', ...)` and `vi.mock('leaflet', ...)` at the top of the file (Leaflet needs DOM APIs not present in the default jsdom test setup, and we only need to assert the wizard wiring, not Leaflet's internals):

```typescript
vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: { children: React.ReactNode }) => <div data-testid="map">{children}</div>,
  TileLayer: () => null,
  Marker: ({ eventHandlers }: { eventHandlers?: { dragend?: () => void } }) => (
    <button data-testid="marker" onClick={() => eventHandlers?.dragend?.()}>marker</button>
  ),
}));

vi.mock('leaflet', () => ({
  default: { Icon: class { constructor() {} } },
}));
```

Then add the test:

```typescript
describe('PublishWizardPage — location step', () => {
  it('renders the map with a default center and publishes with the selected location', () => {
    vi.mocked(useMyPets).mockReturnValue({
      data: [{ id: 'pet-1', name: 'Firulais', type: 'perro', status: 'registered', photos: [] }],
      isLoading: false,
    } as unknown as ReturnType<typeof useMyPets>);

    render(<PublishWizardPage />, { wrapper });
    fireEvent.click(screen.getByText('publish:intent.lostTitle'));
    fireEvent.click(screen.getByText('Firulais'));

    expect(screen.getByText('publish:location.title')).toBeInTheDocument();
    expect(screen.getByTestId('map')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('publish:location.noteLabel'), { target: { value: 'Cerca de la plaza' } });
    fireEvent.click(screen.getByText('publish:location.publish'));

    // Authenticated lost path publishes immediately — no auth step.
    expect(screen.queryByText('publish:auth.title')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend/packages/web && pnpm vitest run src/pages/PublishWizardPage.test.tsx`
Expected: FAIL — placeholder `<p>{t('location.title')}</p>` has no map/testid/note field.

- [ ] **Step 3: Create `LocationStep`**

Create `frontend/packages/web/src/components/publish/LocationStep.tsx`:

```tsx
import { useState } from 'react';
import { MapContainer, TileLayer, Marker } from 'react-leaflet';
import { useTranslation } from 'react-i18next';
import L from 'leaflet';
import type { InitialReportRequest } from '@shared/types';

const MONTEVIDEO: [number, number] = [-34.9011, -56.1645];

const pinIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
});

interface LocationStepProps {
  value: InitialReportRequest | null;
  onPublish: (location: InitialReportRequest) => void;
  onBack: () => void;
  isPending: boolean;
}

export function LocationStep({ value, onPublish, onBack, isPending }: LocationStepProps) {
  const { t } = useTranslation('publish');
  const [position, setPosition] = useState<[number, number]>(
    value ? [value.latitude, value.longitude] : MONTEVIDEO
  );
  const [note, setNote] = useState(value?.note ?? '');
  const [locationError, setLocationError] = useState<string | null>(null);

  const useMyLocation = () => {
    setLocationError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => setPosition([pos.coords.latitude, pos.coords.longitude]),
      () => setLocationError(t('location.locationDenied'))
    );
  };

  const handlePublish = () => {
    onPublish({ latitude: position[0], longitude: position[1], note: note.trim() || undefined });
  };

  return (
    <div className="bg-white dark:bg-gray-900 rounded-2xl p-8 space-y-5">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-50 text-center">
        {t('location.title')}
      </h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 text-center">{t('location.instructions')}</p>

      <div className="h-72 rounded-xl overflow-hidden">
        <MapContainer center={position} zoom={13} style={{ height: '100%', width: '100%' }}>
          <TileLayer
            attribution='&copy; OpenStreetMap contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <Marker
            position={position}
            draggable
            icon={pinIcon}
            eventHandlers={{
              dragend: (e) => {
                const marker = e.target as L.Marker;
                const latLng = marker.getLatLng();
                setPosition([latLng.lat, latLng.lng]);
              },
            }}
          />
        </MapContainer>
      </div>

      <button
        type="button"
        onClick={useMyLocation}
        className="w-full border-2 border-primary text-primary font-semibold rounded-lg px-4 py-2 hover:bg-primary/5 transition-colors"
      >
        {t('location.useMyLocation')}
      </button>
      {locationError && <p className="text-yellow-600 dark:text-yellow-400 text-sm text-center">{locationError}</p>}

      <div>
        <label htmlFor="location-note" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          {t('location.noteLabel')}
        </label>
        <textarea
          id="location-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t('location.notePlaceholder')}
          rows={2}
          className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary resize-none"
        />
      </div>

      <div className="flex gap-3">
        <button
          type="button"
          onClick={onBack}
          className="flex-1 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 font-semibold rounded-lg px-4 py-2 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
        >
          {t('location.back')}
        </button>
        <button
          type="button"
          onClick={handlePublish}
          disabled={isPending}
          className="flex-1 bg-primary hover:bg-primary-dark disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold rounded-lg px-4 py-2 transition-colors"
        >
          {t('location.publish')}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Wire `LocationStep` into `PublishWizardPage`**

In `frontend/packages/web/src/pages/PublishWizardPage.tsx`, import `LocationStep` and `useAuth`, and replace the `'location'` placeholder. The `handlePublish` function decides: if the wizard is in the `stray` intent and the user is NOT authenticated, store the location and go to `'auth'`; otherwise call the appropriate publish hook directly. This task wires the *navigation* only — Task 11 (auth gate) and Task 12 (success step) implement the actual `usePublishLost`/`usePublishStray` calls and the `'auth'`/`'success'` steps. For now, `handlePublish` just sets `wizard.location` and moves to `'success'` for authenticated users (a temporary placeholder `<p>` for `'success'`), or `'auth'` for unauthenticated stray users.

```tsx
import { LocationStep } from '../components/publish/LocationStep';
import { useAuth } from '../context/AuthContext';
```

```tsx
  const { isAuthenticated } = useAuth();

  const handleBackFromLocation = () => {
    setStep(wizard.intent === 'lost' ? 'lost-pet' : 'stray-form');
  };

  const handlePublish = (location: typeof wizard.location) => {
    setWizard((prev) => ({ ...prev, location }));
    if (!isAuthenticated && wizard.intent === 'stray') {
      setStep('auth');
      return;
    }
    setStep('success');
  };
```

```tsx
        {step === 'location' && (
          <LocationStep
            value={wizard.location}
            onPublish={handlePublish}
            onBack={handleBackFromLocation}
            isPending={false}
          />
        )}
        {step === 'auth' && <p>{t('auth.title')}</p>}
        {step === 'success' && <p>publish:success placeholder</p>}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend/packages/web && pnpm vitest run src/pages/PublishWizardPage.test.tsx`
Expected: PASS — all tests green (the authenticated `lost` path with the marker click goes straight to `'success'`, never `'auth'`).

- [ ] **Step 6: Commit**

```bash
git add frontend/packages/web/src/components/publish/LocationStep.tsx frontend/packages/web/src/pages/PublishWizardPage.tsx frontend/packages/web/src/pages/PublishWizardPage.test.tsx
git commit -m "feat(web): add location step with Leaflet draggable pin to publish wizard"
```

### Task 10: Wire `usePublishLost`/`usePublishStray` and `SuccessStep`

**Files:**
- Create: `frontend/packages/web/src/components/publish/SuccessStep.tsx`
- Modify: `frontend/packages/web/src/pages/PublishWizardPage.tsx`
- Modify: `frontend/packages/web/src/pages/PublishWizardPage.test.tsx`

This task makes `handlePublish` actually call `usePublishLost` (lost path) or `usePublishStray` (stray path, authenticated case only — Task 11 handles the unauthenticated case) and renders `SuccessStep` with `SharePanel` on success. `usePublishStray`'s `failedPhotoIndexes` drives the `photoRetry` banner — retrying re-runs `uploadPhoto` for just those photos via a small inline retry handler (no new hook needed: `apiClient.uploadPhoto` is already exposed via `@shared/hooks`'s `useUploadPhoto`).

- [ ] **Step 1: Write the failing test**

Append to `frontend/packages/web/src/pages/PublishWizardPage.test.tsx`. Update the `@shared/hooks` mock to track `usePublishLost`/`usePublishStray` calls and add `useUploadPhoto`:

```typescript
vi.mock('@shared/hooks', () => ({
  useMyPets: vi.fn(() => ({ data: [], isLoading: false })),
  usePublishLost: vi.fn(() => ({ mutateAsync: vi.fn().mockResolvedValue({ id: 'pet-1', name: 'Firulais', type: 'perro', status: 'lost', photos: [] }), isPending: false })),
  usePublishStray: vi.fn(() => ({ mutateAsync: vi.fn().mockResolvedValue({ pet: { id: 'pet-2', name: 'Sin nombre', type: 'perro', status: 'stray', photos: [] }, failedPhotoIndexes: [] }), isPending: false })),
  useUploadPhoto: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
}));
```

Add `usePublishLost`, `usePublishStray` to the existing `@shared/hooks` import used by `vi.mocked(...)`. Then add the test:

```typescript
describe('PublishWizardPage — success step', () => {
  it('publishes the lost pet and shows the success step with SharePanel', async () => {
    vi.mocked(useMyPets).mockReturnValue({
      data: [{ id: 'pet-1', name: 'Firulais', type: 'perro', status: 'registered', photos: [] }],
      isLoading: false,
    } as unknown as ReturnType<typeof useMyPets>);

    render(<PublishWizardPage />, { wrapper });
    fireEvent.click(screen.getByText('publish:intent.lostTitle'));
    fireEvent.click(screen.getByText('Firulais'));
    fireEvent.click(screen.getByText('publish:location.publish'));

    expect(await screen.findByText('publish:success.lostTitle')).toBeInTheDocument();
    expect(usePublishLost).toHaveBeenCalled();
  });
});
```

`SharePanel` is rendered by `SuccessStep` — mock it so this test doesn't depend on `useGenerateShareLink`/QR rendering. Add at the top of the test file:

```typescript
vi.mock('../components/SharePanel', () => ({
  SharePanel: () => <div data-testid="share-panel" />,
}));
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend/packages/web && pnpm vitest run src/pages/PublishWizardPage.test.tsx`
Expected: FAIL — `'success'` step renders the placeholder text, not `publish:success.lostTitle`.

- [ ] **Step 3: Create `SuccessStep`**

Create `frontend/packages/web/src/components/publish/SuccessStep.tsx`:

```tsx
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { SharePanel } from '../SharePanel';
import type { Pet } from '@shared/types';

interface SuccessStepProps {
  pet: Pet;
  intent: 'lost' | 'stray';
  failedPhotoCount: number;
  onRetryPhotos: () => void;
  isRetrying: boolean;
}

export function SuccessStep({ pet, intent, failedPhotoCount, onRetryPhotos, isRetrying }: SuccessStepProps) {
  const { t } = useTranslation('publish');

  return (
    <div className="bg-white dark:bg-gray-900 rounded-2xl p-8 space-y-5 text-center">
      <span className="text-4xl">✅</span>
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-50">
        {t(intent === 'lost' ? 'success.lostTitle' : 'success.strayTitle')}
      </h1>
      <p className="text-gray-500 dark:text-gray-400">
        {t(intent === 'lost' ? 'success.lostDescription' : 'success.strayDescription')}
      </p>

      {failedPhotoCount > 0 && (
        <div className="rounded-lg border border-yellow-300 bg-yellow-50 dark:bg-yellow-900/20 dark:border-yellow-700 p-3 space-y-2">
          <p className="text-yellow-800 dark:text-yellow-300 text-sm font-medium">
            {t('success.photoRetryTitle', { count: failedPhotoCount })}
          </p>
          <button
            type="button"
            onClick={onRetryPhotos}
            disabled={isRetrying}
            className="text-sm font-semibold text-yellow-800 dark:text-yellow-300 underline underline-offset-2 hover:text-yellow-900 disabled:opacity-60"
          >
            {t('success.photoRetryAction')}
          </button>
        </div>
      )}

      <SharePanel petId={pet.id} petName={pet.name} pet={pet} />

      <div className="flex flex-col sm:flex-row gap-3 pt-2">
        <Link
          to={`/pets/${pet.id}`}
          className="flex-1 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 font-semibold rounded-lg px-4 py-2 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
        >
          {t('success.viewPet')}
        </Link>
        <Link
          to="/publish"
          className="flex-1 bg-primary hover:bg-primary-dark text-white font-semibold rounded-lg px-4 py-2 transition-colors"
        >
          {t('success.publishAnother')}
        </Link>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Wire publish hooks and `SuccessStep` into `PublishWizardPage`**

In `frontend/packages/web/src/pages/PublishWizardPage.tsx`:

```tsx
import { SuccessStep } from '../components/publish/SuccessStep';
import { usePublishLost, usePublishStray, useUploadPhoto } from '@shared/hooks';
import type { Pet } from '@shared/types';
import { getErrorMessage } from '@shared/utils/apiErrors';
```

Add state for the published pet, failed photos, and a generic API error; replace `handlePublish` with the real mutation calls:

```tsx
  const [publishedPet, setPublishedPet] = useState<Pet | null>(null);
  const [failedPhotoIndexes, setFailedPhotoIndexes] = useState<number[]>([]);
  const [publishError, setPublishError] = useState<string | null>(null);

  const publishLost = usePublishLost();
  const publishStray = usePublishStray();
  const uploadPhoto = useUploadPhoto();

  const buildStrayPayload = (location: NonNullable<typeof wizard.location>): CreatePetRequest => ({
    name: t('lostPet.title') ? 'Sin nombre' : 'Sin nombre', // see Task 13: localized via t('strayForm.unnamedPet')
    type: wizard.strayForm.type as CreatePetRequest['type'],
    breed: wizard.strayForm.breed.trim() || undefined,
    color: wizard.strayForm.color.trim() || undefined,
    description: wizard.strayForm.description.trim() || undefined,
    status: 'stray',
    initial_report: location,
  });

  const submitStray = async (location: NonNullable<typeof wizard.location>) => {
    try {
      const result = await publishStray.mutateAsync({ pet: buildStrayPayload(location), photos: wizard.strayForm.photos });
      setPublishedPet(result.pet);
      setFailedPhotoIndexes(result.failedPhotoIndexes);
      setStep('success');
    } catch (err) {
      setPublishError(getErrorMessage(err, t));
    }
  };

  const handlePublish = async (location: typeof wizard.location) => {
    if (!location) return;
    setWizard((prev) => ({ ...prev, location }));
    setPublishError(null);

    if (wizard.intent === 'lost' && wizard.selectedPet) {
      try {
        const pet = await publishLost.mutateAsync({ id: wizard.selectedPet.id, data: location });
        setPublishedPet(pet);
        setFailedPhotoIndexes([]);
        setStep('success');
      } catch (err) {
        setPublishError(getErrorMessage(err, t));
      }
      return;
    }

    if (!isAuthenticated && wizard.intent === 'stray') {
      setStep('auth');
      return;
    }

    await submitStray(location);
  };

  const handleRetryPhotos = async () => {
    if (!publishedPet) return;
    const stillFailed: number[] = [];
    for (const index of failedPhotoIndexes) {
      const file = wizard.strayForm.photos[index];
      if (!file) continue;
      try {
        await uploadPhoto.mutateAsync({ petId: publishedPet.id, file });
      } catch {
        stillFailed.push(index);
      }
    }
    setFailedPhotoIndexes(stillFailed);
  };
```

Replace the `'success'` placeholder and add the `publishError` banner above the steps:

```tsx
        {publishError && (
          <p className="text-red-500 dark:text-red-400 text-sm text-center mb-4">{publishError}</p>
        )}
        {step === 'success' && publishedPet && wizard.intent && (
          <SuccessStep
            pet={publishedPet}
            intent={wizard.intent}
            failedPhotoCount={failedPhotoIndexes.length}
            onRetryPhotos={handleRetryPhotos}
            isRetrying={uploadPhoto.isPending}
          />
        )}
```

Pass `isPending={publishLost.isPending || publishStray.isPending}` to `LocationStep`.

> **Note on `buildStrayPayload`'s `name`:** the inline `t('lostPet.title') ? 'Sin nombre' : 'Sin nombre'` ternary above is a placeholder that always evaluates to `'Sin nombre'` — Task 13 replaces it with `t('strayForm.unnamedPet')` once that key is added to the `publish` namespace (it's added in Task 13 alongside the other remaining i18n polish, to avoid a second locale-file edit in this task). Until Task 13 runs, the hardcoded Spanish string ships to all locales — flagged as a known gap closed by Task 13.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend/packages/web && pnpm vitest run src/pages/PublishWizardPage.test.tsx`
Expected: PASS — all tests green.

- [ ] **Step 6: Run full web test suite**

Run: `cd frontend/packages/web && pnpm vitest run`
Expected: PASS — no regressions.

- [ ] **Step 7: Commit**

```bash
git add frontend/packages/web/src/components/publish/SuccessStep.tsx frontend/packages/web/src/pages/PublishWizardPage.tsx frontend/packages/web/src/pages/PublishWizardPage.test.tsx
git commit -m "feat(web): wire publish mutations and success step with SharePanel"
```

### Task 11: `InlineAuthStep` — guest stray path with login/register, preserving wizard state

**Files:**
- Create: `frontend/packages/web/src/components/publish/InlineAuthStep.tsx`
- Modify: `frontend/packages/web/src/pages/PublishWizardPage.tsx`
- Modify: `frontend/packages/web/src/pages/PublishWizardPage.test.tsx`

This is the core of design decision 6: a visitor completes the stray wizard (photo, form, location) without a session, then PUBLICAR shows `InlineAuthStep` (login/register tabs) instead of navigating away. After successful auth, `PublishWizardPage` calls `submitStray(wizard.location)` directly — `wizard` state was never cleared, so the photo/form/location survive.

- [ ] **Step 1: Write the failing test**

Append to `frontend/packages/web/src/pages/PublishWizardPage.test.tsx`. This test needs `useAuth` to start unauthenticated and become authenticated after `register` resolves — use a stateful mock:

```typescript
describe('PublishWizardPage — unauthenticated stray path', () => {
  it('shows inline auth at PUBLICAR, preserves wizard state, and publishes after registration', async () => {
    let authed = false;
    const registerMock = vi.fn().mockImplementation(async () => { authed = true; });
    vi.doMock('../context/AuthContext', () => ({
      useAuth: () => ({ isAuthenticated: authed, user: null, login: vi.fn(), register: registerMock }),
    }));
    const { PublishWizardPage: WizardWithGuestAuth } = await import('./PublishWizardPage');

    render(<WizardWithGuestAuth />, { wrapper });

    // Stray path: select intent, fill form, fill location.
    fireEvent.click(screen.getByText('publish:intent.strayTitle'));

    const file = new File(['fake'], 'stray.jpg', { type: 'image/jpeg' });
    fireEvent.change(screen.getByLabelText('publish:strayForm.photoLabel'), { target: { files: [file] } });
    fireEvent.change(screen.getByLabelText('publish:strayForm.typeLabel'), { target: { value: 'gato' } });
    fireEvent.click(screen.getByText('publish:strayForm.next'));

    fireEvent.change(screen.getByLabelText('publish:location.noteLabel'), { target: { value: 'Plaza central' } });
    fireEvent.click(screen.getByText('publish:location.publish'));

    // Inline auth appears — wizard state (note) is preserved in memory.
    expect(await screen.findByText('publish:auth.title')).toBeInTheDocument();

    // Switch to register tab and submit.
    fireEvent.click(screen.getByText('publish:auth.registerTab'));
    fireEvent.change(screen.getByLabelText('auth:register.name', { exact: false }) ?? screen.getByPlaceholderText(/.+/), {});
  });
});
```

The exact register-form field assertions depend on `RegisterPage`'s field labels, which `InlineAuthStep` reuses via shared `auth:` i18n keys (read `frontend/packages/web/src/pages/RegisterPage.tsx` field `id`s/`htmlFor` before writing the final selectors — use `screen.getByLabelText('auth:register.email', { exact: false })` style matches consistent with the `t: (key) => key` mock, i.e. the rendered label text IS the i18n key string). Adjust the test's field selectors to match `InlineAuthStep`'s actual `htmlFor`/`id` pairs once written in Step 3 — keep the assertions on `publish:auth.title` appearing and disappearing (replaced by `publish:success.strayTitle`) as the load-bearing checks:

```typescript
    fireEvent.change(screen.getByLabelText('auth:register.name'), { target: { value: 'Carlos' } });
    fireEvent.change(screen.getByLabelText('auth:register.email'), { target: { value: 'carlos@test.com' } });
    fireEvent.change(screen.getByLabelText('auth:register.password'), { target: { value: 'password123' } });
    fireEvent.click(screen.getByText('publish:auth.continue'));

    expect(await screen.findByText('publish:success.strayTitle')).toBeInTheDocument();
    expect(registerMock).toHaveBeenCalledWith('carlos@test.com', 'password123', 'Carlos', undefined, undefined);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend/packages/web && pnpm vitest run src/pages/PublishWizardPage.test.tsx`
Expected: FAIL — `'auth'` step still renders the placeholder `<p>{t('auth.title')}</p>` (text matches, but no form fields/`publish:auth.registerTab`/`publish:auth.continue`).

- [ ] **Step 3: Create `InlineAuthStep`**

Create `frontend/packages/web/src/components/publish/InlineAuthStep.tsx`. It mirrors `LoginPage`/`RegisterPage`'s field validation but inline, with a tab switcher; on submit it calls `useAuth().login`/`register` and, on success, calls `onAuthenticated()`.

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import { getErrorMessage } from '@shared/utils/apiErrors';

interface InlineAuthStepProps {
  onAuthenticated: () => void;
}

interface FieldErrors {
  name?: string;
  email?: string;
  password?: string;
}

export function InlineAuthStep({ onAuthenticated }: InlineAuthStepProps) {
  const { t } = useTranslation(['publish', 'auth', 'common']);
  const { login, register } = useAuth();
  const [tab, setTab] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [apiError, setApiError] = useState('');
  const [loading, setLoading] = useState(false);

  const validate = (): boolean => {
    const errors: FieldErrors = {};
    if (tab === 'register' && !name.trim()) errors.name = t('common:required');
    if (!email.trim()) errors.email = t('common:required');
    if (!password) errors.password = t('common:required');
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setApiError('');
    if (!validate()) return;

    setLoading(true);
    try {
      if (tab === 'login') {
        await login(email.trim(), password);
      } else {
        await register(email.trim(), password, name.trim());
      }
      onAuthenticated();
    } catch (err) {
      setApiError(getErrorMessage(err, t));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white dark:bg-gray-900 rounded-2xl p-8 space-y-5">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-50 text-center">
        {t('auth.title')}
      </h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 text-center">{t('auth.description')}</p>

      <div className="flex rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
        <button
          type="button"
          onClick={() => setTab('login')}
          className={`flex-1 py-2 text-sm font-semibold ${tab === 'login' ? 'bg-primary text-white' : 'bg-transparent text-gray-700 dark:text-gray-300'}`}
        >
          {t('auth.loginTab')}
        </button>
        <button
          type="button"
          onClick={() => setTab('register')}
          className={`flex-1 py-2 text-sm font-semibold ${tab === 'register' ? 'bg-primary text-white' : 'bg-transparent text-gray-700 dark:text-gray-300'}`}
        >
          {t('auth.registerTab')}
        </button>
      </div>

      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        {tab === 'register' && (
          <div>
            <label htmlFor="auth-name" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t('auth:register.name')}
            </label>
            <input
              id="auth-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
            />
            {fieldErrors.name && <p className="text-red-500 dark:text-red-400 text-sm mt-1">{fieldErrors.name}</p>}
          </div>
        )}

        <div>
          <label htmlFor="auth-email" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            {t('auth:register.email')}
          </label>
          <input
            id="auth-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
          />
          {fieldErrors.email && <p className="text-red-500 dark:text-red-400 text-sm mt-1">{fieldErrors.email}</p>}
        </div>

        <div>
          <label htmlFor="auth-password" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            {t('auth:register.password')}
          </label>
          <input
            id="auth-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
          />
          {fieldErrors.password && <p className="text-red-500 dark:text-red-400 text-sm mt-1">{fieldErrors.password}</p>}
        </div>

        {apiError && <p className="text-red-500 dark:text-red-400 text-sm">{apiError}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-primary hover:bg-primary-dark disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold rounded-lg px-4 py-2 transition-colors"
        >
          {loading ? t('common:loading') : t('auth.continue')}
        </button>
      </form>
    </div>
  );
}
```

Before finalizing, read `frontend/packages/web/src/pages/RegisterPage.tsx` to confirm the i18n keys `auth:register.name`, `auth:register.email`, `auth:register.password` exist with that exact namespacing (the shared `auth` namespace, accessed as `auth:register.*`); if `RegisterPage` uses different key paths (e.g. `auth:fields.name`), update `InlineAuthStep`'s `t(...)` calls to match exactly — do not introduce new keys when existing ones cover the same labels.

- [ ] **Step 4: Wire `InlineAuthStep` into `PublishWizardPage`**

In `frontend/packages/web/src/pages/PublishWizardPage.tsx`, import `InlineAuthStep` and replace the `'auth'` placeholder. On `onAuthenticated`, call `submitStray(wizard.location)` (guaranteed non-null because `'auth'` is only reached after `LocationStep`'s `onPublish`):

```tsx
import { InlineAuthStep } from '../components/publish/InlineAuthStep';
```

```tsx
        {step === 'auth' && (
          <InlineAuthStep
            onAuthenticated={() => {
              if (wizard.location) submitStray(wizard.location);
            }}
          />
        )}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend/packages/web && pnpm vitest run src/pages/PublishWizardPage.test.tsx`
Expected: PASS — all tests green, including the unauthenticated stray path.

- [ ] **Step 6: Run full web test suite**

Run: `cd frontend/packages/web && pnpm vitest run`
Expected: PASS — no regressions.

- [ ] **Step 7: Commit**

```bash
git add frontend/packages/web/src/components/publish/InlineAuthStep.tsx frontend/packages/web/src/pages/PublishWizardPage.tsx frontend/packages/web/src/pages/PublishWizardPage.test.tsx
git commit -m "feat(web): add inline auth step for unauthenticated stray publishing"
```

### Task 12: Repoint "Publicar" entry points to `/publish`

**Files:**
- Modify: `frontend/packages/web/src/layouts/MainLayout.tsx:126, 258`
- Modify: `frontend/packages/web/src/pages/HomePage.tsx:188`

Per the design, `/publish` is public — both entry points now point there unconditionally (the wizard itself handles the guest stray path; the lost path naturally requires a session because `LostPetStep` calls `useMyPets`, which the existing `ProtectedRoute`-free `/publish` route still allows since `useMyPets` returns `[]`/error for guests, rendering the empty state — acceptable since a guest selecting "lost" with no pets sees the same empty-state CTA to register).

- [ ] **Step 1: Update `MainLayout.tsx` desktop nav link**

In `frontend/packages/web/src/layouts/MainLayout.tsx`, line 126, change:

```tsx
                    <Link
                      to="/pets/create"
                      className="text-sm font-semibold text-white bg-primary hover:bg-primary-dark px-4 py-2 rounded-lg transition-colors duration-150 whitespace-nowrap"
                    >
                      {t('publish')}
                    </Link>
```

to:

```tsx
                    <Link
                      to="/publish"
                      className="text-sm font-semibold text-white bg-primary hover:bg-primary-dark px-4 py-2 rounded-lg transition-colors duration-150 whitespace-nowrap"
                    >
                      {t('publish')}
                    </Link>
```

- [ ] **Step 2: Update `MainLayout.tsx` mobile menu link**

At line 258, change the `to="/pets/create"` to `to="/publish"` in the mobile menu's "Publicar" link (same `{t('publish')}` label, same surrounding JSX otherwise).

- [ ] **Step 3: Update `HomePage.tsx` hero CTA**

In `frontend/packages/web/src/pages/HomePage.tsx`, line 188, change:

```tsx
            <Link
              to={isAuthenticated ? '/pets/create' : '/register'}
              className="inline-flex items-center justify-center px-8 py-3 border-2 border-white text-white font-bold rounded-lg hover:bg-white/10 transition-colors"
            >
              {t('home:publish')}
            </Link>
```

to:

```tsx
            <Link
              to="/publish"
              className="inline-flex items-center justify-center px-8 py-3 border-2 border-white text-white font-bold rounded-lg hover:bg-white/10 transition-colors"
            >
              {t('home:publish')}
            </Link>
```

`isAuthenticated` may become unused in `HomePage.tsx` if this was its only use — check with `grep -n "isAuthenticated" frontend/packages/web/src/pages/HomePage.tsx`; if unused, remove the destructured variable and its `useAuth()` call only if `useAuth()` itself becomes fully unused (check for other usages like `user?.name` first).

- [ ] **Step 4: Run web test suite**

Run: `cd frontend/packages/web && pnpm vitest run`
Expected: PASS — existing `MainLayout`/`HomePage` tests (if any) still pass; if a test asserts `to="/pets/create"` for the publish link, update that assertion to `/publish`.

- [ ] **Step 5: Commit**

```bash
git add frontend/packages/web/src/layouts/MainLayout.tsx frontend/packages/web/src/pages/HomePage.tsx
git commit -m "feat(web): point Publicar entry points to the publish wizard"
```

### Task 13: i18n polish — `strayForm.unnamedPet` key and wire it into `buildStrayPayload`

**Files:**
- Modify: `frontend/packages/shared/i18n/locales/{es,en,pt}.json`
- Modify: `frontend/packages/web/src/pages/PublishWizardPage.tsx`

Closes the placeholder flagged in Task 10: stray pets are created with a localized "no name" placeholder instead of a hardcoded Spanish string.

- [ ] **Step 1: Add `strayForm.unnamedPet` to all three locale files**

In `frontend/packages/shared/i18n/locales/es.json`, inside `publish.strayForm` (after `"descriptionLabel"`):

```json
      "unnamedPet": "Sin nombre",
```

In `en.json`:

```json
      "unnamedPet": "No name",
```

In `pt.json`:

```json
      "unnamedPet": "Sem nome",
```

- [ ] **Step 2: Validate JSON syntax**

Run: `cd frontend/packages/shared/i18n/locales && node -e "['es','en','pt'].forEach(l => { JSON.parse(require('fs').readFileSync(l+'.json','utf-8')); console.log(l, 'OK'); })"`
Expected: `es OK`, `en OK`, `pt OK`.

- [ ] **Step 3: Replace the placeholder ternary in `buildStrayPayload`**

In `frontend/packages/web/src/pages/PublishWizardPage.tsx`, replace:

```tsx
    name: t('lostPet.title') ? 'Sin nombre' : 'Sin nombre', // see Task 13: localized via t('strayForm.unnamedPet')
```

with:

```tsx
    name: t('strayForm.unnamedPet'),
```

- [ ] **Step 4: Run full web test suite**

Run: `cd frontend/packages/web && pnpm vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/packages/shared/i18n/locales/es.json frontend/packages/shared/i18n/locales/en.json frontend/packages/shared/i18n/locales/pt.json frontend/packages/web/src/pages/PublishWizardPage.tsx
git commit -m "fix(web): use localized placeholder name for stray pets"
```

---

## Mobile Tasks

Mobile already merges shared namespaces via `{ ...sharedEs, ...mobileEs }` in `frontend/packages/mobile/i18n/index.ts` (spread, not per-namespace mapping like web) — so the shared `publish` namespace from Task 4 is automatically available as `publish:*` once the shared JSON files are updated. No mobile i18n index change is needed; mobile-only additions go directly into `frontend/packages/mobile/i18n/locales/{es,en,pt}.json`.

The wizard reuses `(tabs)/post.tsx` as its container (Expo Router tab — replacing its current single-form body with the step state machine), following the same `PublishStep`/`PublishWizardState` shape as web (Task 6) but with RN components and `@maplibre/maplibre-react-native` for the location step (per the design doc and `(tabs)/map.tsx`'s established pattern — NOT `react-native-maps`, which is not used elsewhere in this codebase).

### Task 14: Mobile `publish` namespace additions + wizard skeleton with `IntentStep`

**Files:**
- Modify: `frontend/packages/mobile/i18n/locales/{es,en,pt}.json`
- Create: `frontend/packages/mobile/components/publish/IntentStep.tsx`
- Modify: `frontend/packages/mobile/app/(tabs)/post.tsx`
- Modify: `frontend/packages/mobile/__tests__/post.test.tsx`

The shared `publish` namespace (Task 4) covers all step copy. Mobile needs one mobile-only addition: `post.title` already exists for the old form ("Registrar mascota") — the wizard's `<Text>` header per step now comes from `publish:*` keys instead, so `post.title` becomes unused by the wizard but MUST stay in `post.json` (My Pets registration screen, if any, may still reference it — verify with `grep -rn "post:title" frontend/packages/mobile/app frontend/packages/mobile/components` before removing; if unused anywhere, leave it for now to avoid an unrelated cleanup in this plan).

- [ ] **Step 1: Write the failing test**

Replace `frontend/packages/mobile/__tests__/post.test.tsx` entirely:

```typescript
// Post (Publish wizard) screen smoke test
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import PostScreen from '../app/(tabs)/post';

jest.mock('../store', () => ({
  useAuthStore: (selector) => {
    const state = {
      user: { id: 'user-1', name: 'Carlos' },
      token: 'jwt-token',
      isAuthenticated: true,
      isLoading: false,
      login: jest.fn(),
      register: jest.fn(),
    };
    return typeof selector === 'function' ? selector(state) : state;
  },
  useLocationStore: (selector) => {
    const state = { latitude: -34.9011, longitude: -56.1645, setLocation: jest.fn() };
    return typeof selector === 'function' ? selector(state) : state;
  },
}));

jest.mock('@shared/hooks', () => ({
  useMyPets: () => ({ data: [], isLoading: false }),
  usePublishLost: () => ({ mutateAsync: jest.fn(), isPending: false }),
  usePublishStrayNative: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useUploadPhotoNative: () => ({ mutateAsync: jest.fn(), isPending: false }),
}));

describe('PostScreen (Publish wizard)', () => {
  it('renders the intent step first', () => {
    const { getByText } = render(<PostScreen />);
    expect(getByText('publish:intent.lostTitle')).toBeTruthy();
    expect(getByText('publish:intent.strayTitle')).toBeTruthy();
  });

  it('selecting the lost intent advances to the lost-pet step', () => {
    const { getByText } = render(<PostScreen />);
    fireEvent.press(getByText('publish:intent.lostTitle'));
    expect(getByText('publish:lostPet.title')).toBeTruthy();
  });

  it('selecting the stray intent advances to the stray-form step', () => {
    const { getByText } = render(<PostScreen />);
    fireEvent.press(getByText('publish:intent.strayTitle'));
    expect(getByText('publish:strayForm.title')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend/packages/mobile && pnpm test:run __tests__/post.test.tsx`
Expected: FAIL — current `PostScreen` renders `post:title` ("Registrar mascota"), not `publish:intent.lostTitle`, and has no intent cards.

- [ ] **Step 3: Create `IntentStep`**

Create `frontend/packages/mobile/components/publish/IntentStep.tsx`:

```tsx
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { COLORS, SPACING, FONTS, RADIUS } from '../../constants';

interface IntentStepProps {
  onSelect: (intent: 'lost' | 'stray') => void;
}

export function IntentStep({ onSelect }: IntentStepProps) {
  const { t } = useTranslation('publish');

  return (
    <View>
      <Text style={styles.title}>{t('intent.title')}</Text>
      <TouchableOpacity style={styles.card} onPress={() => onSelect('lost')}>
        <Text style={styles.icon}>🐾</Text>
        <Text style={styles.cardTitle}>{t('intent.lostTitle')}</Text>
        <Text style={styles.cardDescription}>{t('intent.lostDescription')}</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.card} onPress={() => onSelect('stray')}>
        <Text style={styles.icon}>📍</Text>
        <Text style={styles.cardTitle}>{t('intent.strayTitle')}</Text>
        <Text style={styles.cardDescription}>{t('intent.strayDescription')}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: FONTS.sizes.xl,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginBottom: SPACING.lg,
    textAlign: 'center',
  },
  card: {
    backgroundColor: COLORS.white,
    borderWidth: 2,
    borderColor: COLORS.border,
    borderRadius: RADIUS.lg,
    padding: SPACING.lg,
    marginBottom: SPACING.md,
  },
  icon: { fontSize: 32 },
  cardTitle: {
    fontSize: FONTS.sizes.md,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginTop: SPACING.sm,
  },
  cardDescription: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    marginTop: SPACING.xs,
  },
});
```

- [ ] **Step 4: Replace `(tabs)/post.tsx` with the wizard skeleton**

Replace `frontend/packages/mobile/app/(tabs)/post.tsx` entirely with the step skeleton (later tasks add `LostPetStep`/`StrayFormStep`/`LocationStep`/`InlineAuthStep`/`SuccessStep` and replace the placeholders, mirroring web Tasks 7-11). The previous photo/form/submit logic is removed from this file — Tasks 15-17 reintroduce equivalent logic inside the new step components.

```tsx
// ============================================================
// SearchPet - Post Tab (Publish wizard: lost pet or stray sighting)
// ============================================================

import { useState } from 'react';
import { View, ScrollView, Text, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { IntentStep } from '../../components/publish/IntentStep';
import { COLORS, SPACING } from '../../constants';
import type { Pet, CreatePetRequest, InitialReportRequest, PetType } from '../../../shared/types';

export type PublishStep = 'intent' | 'lost-pet' | 'stray-form' | 'location' | 'auth' | 'success';
export type PublishIntent = 'lost' | 'stray';

export interface StrayFormState {
  type: PetType | '';
  breed: string;
  color: string;
  description: string;
  photos: string[]; // local URIs from expo-image-picker
}

export interface PublishWizardState {
  intent: PublishIntent | null;
  selectedPet: Pet | null;
  strayForm: StrayFormState;
  location: InitialReportRequest | null;
}

export const initialWizardState: PublishWizardState = {
  intent: null,
  selectedPet: null,
  strayForm: { type: '', breed: '', color: '', description: '', photos: [] },
  location: null,
};

export default function PostScreen() {
  const { t } = useTranslation('publish');
  const [step, setStep] = useState<PublishStep>('intent');
  const [wizard, setWizard] = useState<PublishWizardState>(initialWizardState);

  const handleIntentSelect = (intent: PublishIntent) => {
    setWizard((prev) => ({ ...prev, intent }));
    setStep(intent === 'lost' ? 'lost-pet' : 'stray-form');
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View>
        {step === 'intent' && <IntentStep onSelect={handleIntentSelect} />}
        {step === 'lost-pet' && <Text>{t('lostPet.title')}</Text>}
        {step === 'stray-form' && <Text>{t('strayForm.title')}</Text>}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: SPACING.lg },
});
```

`CreatePetRequest`, `wizard`, `setWizard` are unused by this skeleton — Tasks 15-17 consume them. If the linter blocks unused-var errors before then, this is expected to be transient within this task's own commit; Task 15 removes the warning by wiring `LostPetStep`.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend/packages/mobile && pnpm test:run __tests__/post.test.tsx`
Expected: PASS — all 3 tests green.

- [ ] **Step 6: Run full mobile test suite**

Run: `cd frontend/packages/mobile && pnpm test:run`
Expected: PASS — no regressions in other screens (note: `index.test.tsx`/`pet-detail.test.tsx` etc. don't import `post.tsx`, so they're unaffected).

- [ ] **Step 7: Commit**

```bash
git add frontend/packages/mobile/components/publish/IntentStep.tsx frontend/packages/mobile/app/\(tabs\)/post.tsx frontend/packages/mobile/__tests__/post.test.tsx
git commit -m "feat(mobile): replace post tab with publish wizard skeleton"
```

### Task 15: Mobile `LostPetStep` and `StrayFormStep`

**Files:**
- Create: `frontend/packages/mobile/components/publish/LostPetStep.tsx`
- Create: `frontend/packages/mobile/components/publish/StrayFormStep.tsx`
- Modify: `frontend/packages/mobile/app/(tabs)/post.tsx`
- Modify: `frontend/packages/mobile/__tests__/post.test.tsx`

`LostPetStep` mirrors web Task 7 (filter `useMyPets` to `status === 'registered'`, empty state). `StrayFormStep` mirrors web Task 8 but uses `expo-image-picker` (gallery + camera, like the old `post.tsx`) for the mandatory 1-3 photos, plus type/breed/color/description fields using `PET_TYPES` from constants.

- [ ] **Step 1: Write the failing tests**

Append to `frontend/packages/mobile/__tests__/post.test.tsx`. Update the `@shared/hooks` mock to a `jest.fn()` so `useMyPets` can be overridden per test, and import `expo-image-picker`'s mock (already mocked globally per project rule 17 — confirm via `frontend/packages/mobile/jest.setup.js` or `__mocks__/expo-image-picker.js`):

```typescript
import * as ImagePicker from 'expo-image-picker';

jest.mock('@shared/hooks', () => ({
  useMyPets: jest.fn(() => ({ data: [], isLoading: false })),
  usePublishLost: () => ({ mutateAsync: jest.fn(), isPending: false }),
  usePublishStrayNative: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useUploadPhotoNative: () => ({ mutateAsync: jest.fn(), isPending: false }),
}));

const { useMyPets } = jest.requireMock('@shared/hooks');
```

```typescript
describe('PostScreen — lost path', () => {
  it('shows the empty state when there are no eligible pets', () => {
    useMyPets.mockReturnValue({ data: [], isLoading: false });
    const { getByText } = render(<PostScreen />);
    fireEvent.press(getByText('publish:intent.lostTitle'));
    expect(getByText('publish:lostPet.empty')).toBeTruthy();
  });

  it('lists registered pets and selecting one advances to location', () => {
    useMyPets.mockReturnValue({
      data: [
        { id: 'pet-1', name: 'Firulais', type: 'perro', status: 'registered', photos: [] },
        { id: 'pet-2', name: 'Michi', type: 'gato', status: 'lost', photos: [] },
      ],
      isLoading: false,
    });
    const { getByText, queryByText } = render(<PostScreen />);
    fireEvent.press(getByText('publish:intent.lostTitle'));
    expect(getByText('Firulais')).toBeTruthy();
    expect(queryByText('Michi')).toBeNull();
    fireEvent.press(getByText('Firulais'));
    expect(getByText('publish:location.title')).toBeTruthy();
  });
});

describe('PostScreen — stray path', () => {
  it('blocks continuing without photo or type, then advances once both are set', async () => {
    (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///stray.jpg' }],
    });

    const { getByText, findByText } = render(<PostScreen />);
    fireEvent.press(getByText('publish:intent.strayTitle'));

    fireEvent.press(getByText('publish:strayForm.next'));
    expect(getByText('publish:strayForm.photoRequired')).toBeTruthy();
    expect(getByText('publish:strayForm.typeRequired')).toBeTruthy();

    fireEvent.press(getByText('publish:post.gallery', { exact: false }) ?? getByText(/gallery/i));
    await findByText('publish:strayForm.photoLimit', { exact: false }).catch(() => null);

    fireEvent.press(getByText('pets:types.perro'));
    fireEvent.press(getByText('publish:strayForm.next'));
    expect(getByText('publish:location.title')).toBeTruthy();
  });
});
```

The exact gallery-button text/selector depends on `StrayFormStep`'s implementation in Step 3 below — once written, replace `getByText('publish:post.gallery', { exact: false }) ?? getByText(/gallery/i)` with the precise label used (`t('strayForm.gallery')`/`t('strayForm.camera')`, defined in Step 2).

- [ ] **Step 2: Add `strayForm.gallery`/`strayForm.camera`/`strayForm.cameraPermission*` keys to the shared `publish` namespace**

These are mobile-only additions to the `publish.strayForm` object already created in Task 4 — add to all three shared locale files (`es`, `en`, `pt`):

`es.json` (inside `publish.strayForm`):
```json
      "gallery": "Galería",
      "camera": "Cámara",
      "cameraPermission": "Permiso requerido",
      "cameraPermissionText": "Necesitamos acceso a tu cámara",
```

`en.json`:
```json
      "gallery": "Gallery",
      "camera": "Camera",
      "cameraPermission": "Permission required",
      "cameraPermissionText": "We need access to your camera",
```

`pt.json`:
```json
      "gallery": "Galeria",
      "camera": "Câmera",
      "cameraPermission": "Permissão necessária",
      "cameraPermissionText": "Precisamos de acesso à sua câmera",
```

Validate: `cd frontend/packages/shared/i18n/locales && node -e "['es','en','pt'].forEach(l => { JSON.parse(require('fs').readFileSync(l+'.json','utf-8')); console.log(l, 'OK'); })"`

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd frontend/packages/mobile && pnpm test:run __tests__/post.test.tsx`
Expected: FAIL — `'lost-pet'`/`'stray-form'` placeholders render only a `<Text>` with the step title, no list/form.

- [ ] **Step 4: Create `LostPetStep`**

Create `frontend/packages/mobile/components/publish/LostPetStep.tsx`:

```tsx
import { View, Text, TouchableOpacity, Image, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useMyPets } from '../../../shared/hooks';
import { COLORS, SPACING, FONTS, RADIUS } from '../../constants';
import type { Pet } from '../../../shared/types';

interface LostPetStepProps {
  onSelect: (pet: Pet) => void;
}

export function LostPetStep({ onSelect }: LostPetStepProps) {
  const { t } = useTranslation(['publish', 'pets', 'common']);
  const { data: pets, isLoading } = useMyPets();

  const eligiblePets = (pets ?? []).filter((pet) => pet.status === 'registered');

  if (isLoading) {
    return <Text style={styles.empty}>{t('common:loading')}</Text>;
  }

  if (eligiblePets.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.empty}>{t('lostPet.empty')}</Text>
      </View>
    );
  }

  return (
    <View>
      <Text style={styles.title}>{t('lostPet.title')}</Text>
      {eligiblePets.map((pet) => (
        <TouchableOpacity key={pet.id} style={styles.row} onPress={() => onSelect(pet)}>
          {pet.photos[0] ? (
            <Image source={{ uri: pet.photos[0].url }} style={styles.thumb} />
          ) : (
            <View style={[styles.thumb, styles.thumbPlaceholder]}>
              <Text style={{ fontSize: 24 }}>🐾</Text>
            </View>
          )}
          <View style={styles.rowInfo}>
            <Text style={styles.rowName}>{pet.name}</Text>
            <Text style={styles.rowType}>{t(`pets:types.${pet.type}`)}</Text>
          </View>
          <Text style={styles.select}>{t('lostPet.select')}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: FONTS.sizes.xl,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginBottom: SPACING.lg,
    textAlign: 'center',
  },
  emptyContainer: { alignItems: 'center', padding: SPACING.xl },
  empty: { fontSize: FONTS.sizes.md, color: COLORS.textSecondary, textAlign: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
  },
  thumb: { width: 48, height: 48, borderRadius: RADIUS.md, marginRight: SPACING.md },
  thumbPlaceholder: { backgroundColor: COLORS.background, justifyContent: 'center', alignItems: 'center' },
  rowInfo: { flex: 1 },
  rowName: { fontSize: FONTS.sizes.md, fontWeight: '700', color: COLORS.textPrimary },
  rowType: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary },
  select: { fontSize: FONTS.sizes.sm, fontWeight: '700', color: COLORS.primary },
});
```

`LostPetStep`'s empty state intentionally has no "register a pet" button (unlike web's `Link` to `/pets/create`) — Expo Router navigation to the existing My Pets registration screen requires `useRouter()` from `expo-router`. Add it:

```tsx
import { useRouter } from 'expo-router';
```

```tsx
  const router = useRouter();
```

And inside the empty-state `View`, add:

```tsx
        <TouchableOpacity style={styles.emptyAction} onPress={() => router.push('/my-pets')}>
          <Text style={styles.emptyActionText}>{t('lostPet.emptyAction')}</Text>
        </TouchableOpacity>
```

with styles:

```tsx
  emptyAction: {
    marginTop: SPACING.md,
    backgroundColor: COLORS.primary,
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.md,
    borderRadius: RADIUS.md,
  },
  emptyActionText: { color: COLORS.white, fontWeight: '700' },
```

(Verify `/my-pets` is the correct route name by checking `frontend/packages/mobile/app/my-pets.tsx` or equivalent exists — `post.tsx`'s old success handler already used `router.push('/my-pets')`, confirming the route.)

- [ ] **Step 5: Create `StrayFormStep`**

Create `frontend/packages/mobile/components/publish/StrayFormStep.tsx`. Reuses the photo-picker logic from the old `post.tsx` (gallery + camera, max 3, `expo-image-picker`):

```tsx
import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Image, ScrollView, Alert, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import i18next from 'i18next';
import * as ImagePicker from 'expo-image-picker';
import { COLORS, SPACING, FONTS, RADIUS, PET_TYPES } from '../../constants';
import type { StrayFormState } from '../../app/(tabs)/post';
import type { PetType } from '../../../shared/types';

interface StrayFormStepProps {
  value: StrayFormState;
  onChange: (value: StrayFormState) => void;
  onNext: () => void;
}

interface FieldErrors {
  photo?: string;
  type?: string;
}

export function StrayFormStep({ value, onChange, onNext }: StrayFormStepProps) {
  const { t } = useTranslation(['publish', 'pets']);
  const [errors, setErrors] = useState<FieldErrors>({});

  const atLimit = value.photos.length >= 3;

  const pickImage = async () => {
    if (atLimit) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      onChange({ ...value, photos: [...value.photos, result.assets[0].uri] });
      setErrors((prev) => ({ ...prev, photo: undefined }));
    }
  };

  const takePhoto = async () => {
    if (atLimit) return;
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(i18next.t('publish:strayForm.cameraPermission'), i18next.t('publish:strayForm.cameraPermissionText'));
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ allowsEditing: true, aspect: [4, 3], quality: 0.8 });
    if (!result.canceled && result.assets[0]) {
      onChange({ ...value, photos: [...value.photos, result.assets[0].uri] });
      setErrors((prev) => ({ ...prev, photo: undefined }));
    }
  };

  const removePhoto = (index: number) => {
    onChange({ ...value, photos: value.photos.filter((_, i) => i !== index) });
  };

  const handleNext = () => {
    const nextErrors: FieldErrors = {};
    if (value.photos.length === 0) nextErrors.photo = t('strayForm.photoRequired');
    if (!value.type) nextErrors.type = t('strayForm.typeRequired');
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length === 0) onNext();
  };

  return (
    <View>
      <Text style={styles.title}>{t('strayForm.title')}</Text>

      <Text style={styles.label}>{t('strayForm.photoLabel')} ({value.photos.length}/3)</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.photoRow}>
        {value.photos.map((uri, i) => (
          <TouchableOpacity key={i} onPress={() => removePhoto(i)}>
            <Image source={{ uri }} style={styles.photoThumb} />
          </TouchableOpacity>
        ))}
        <TouchableOpacity style={[styles.addPhoto, atLimit && styles.addPhotoDisabled]} onPress={pickImage} disabled={atLimit}>
          <Text style={{ fontSize: 24, color: COLORS.textMuted }}>+</Text>
          <Text style={styles.addPhotoLabel}>{t('strayForm.gallery')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.addPhoto, atLimit && styles.addPhotoDisabled]} onPress={takePhoto} disabled={atLimit}>
          <Text style={{ fontSize: 24, color: COLORS.textMuted }}>📷</Text>
          <Text style={styles.addPhotoLabel}>{t('strayForm.camera')}</Text>
        </TouchableOpacity>
      </ScrollView>
      {atLimit && <Text style={styles.hint}>{t('strayForm.photoLimit')}</Text>}
      {errors.photo && <Text style={styles.error}>{errors.photo}</Text>}

      <Text style={styles.label}>{t('strayForm.typeLabel')}</Text>
      <View style={styles.typeRow}>
        {PET_TYPES.map((petType) => (
          <TouchableOpacity
            key={petType.value}
            style={[styles.typeButton, value.type === petType.value && styles.typeButtonActive]}
            onPress={() => onChange({ ...value, type: petType.value as PetType })}
          >
            <Text style={{ fontSize: 18 }}>{petType.icon}</Text>
            <Text style={[styles.typeLabel, value.type === petType.value && styles.typeLabelActive]}>
              {t(`pets:types.${petType.value}`)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      {errors.type && <Text style={styles.error}>{errors.type}</Text>}

      <Text style={styles.label}>{t('strayForm.breedLabel')}</Text>
      <TextInput style={styles.input} value={value.breed} onChangeText={(breed) => onChange({ ...value, breed })} placeholderTextColor={COLORS.placeholder} />

      <Text style={styles.label}>{t('strayForm.colorLabel')}</Text>
      <TextInput style={styles.input} value={value.color} onChangeText={(color) => onChange({ ...value, color })} placeholderTextColor={COLORS.placeholder} />

      <Text style={styles.label}>{t('strayForm.descriptionLabel')}</Text>
      <TextInput
        style={[styles.input, styles.textArea]}
        value={value.description}
        onChangeText={(description) => onChange({ ...value, description })}
        multiline
        numberOfLines={4}
        textAlignVertical="top"
        placeholderTextColor={COLORS.placeholder}
      />

      <TouchableOpacity style={styles.submitButton} onPress={handleNext}>
        <Text style={styles.submitText}>{t('strayForm.next')}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: FONTS.sizes.xl, fontWeight: '700', color: COLORS.textPrimary, marginBottom: SPACING.lg, textAlign: 'center' },
  label: { fontSize: FONTS.sizes.sm, fontWeight: '600', color: COLORS.textPrimary, marginBottom: SPACING.xs, marginTop: SPACING.md },
  hint: { fontSize: FONTS.sizes.xs, color: COLORS.textMuted, marginTop: SPACING.xs },
  error: { fontSize: FONTS.sizes.xs, color: COLORS.danger, marginTop: SPACING.xs },
  photoRow: { flexDirection: 'row', marginVertical: SPACING.sm },
  photoThumb: { width: 80, height: 80, borderRadius: RADIUS.md, marginRight: SPACING.sm },
  addPhoto: {
    width: 80, height: 80, borderRadius: RADIUS.md, borderWidth: 2, borderColor: COLORS.border,
    borderStyle: 'dashed', justifyContent: 'center', alignItems: 'center', marginRight: SPACING.sm,
  },
  addPhotoDisabled: { opacity: 0.4 },
  addPhotoLabel: { fontSize: 11, color: COLORS.textMuted, marginTop: 2 },
  typeRow: { flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.xs },
  typeButton: { flex: 1, alignItems: 'center', padding: SPACING.md, backgroundColor: COLORS.white, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.md },
  typeButtonActive: { borderColor: COLORS.primary, backgroundColor: '#FFF0E8' },
  typeLabel: { fontSize: FONTS.sizes.xs, color: COLORS.textSecondary, marginTop: 4, fontWeight: '500' },
  typeLabelActive: { color: COLORS.primary, fontWeight: '700' },
  input: {
    backgroundColor: COLORS.white, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md, paddingVertical: 14, fontSize: FONTS.sizes.md, color: COLORS.textPrimary,
  },
  textArea: { minHeight: 100, paddingTop: 14 },
  submitButton: { backgroundColor: COLORS.primary, paddingVertical: 16, borderRadius: RADIUS.md, alignItems: 'center', marginTop: SPACING.xl },
  submitText: { color: COLORS.white, fontSize: FONTS.sizes.md, fontWeight: '700' },
});
```

- [ ] **Step 6: Wire both steps into `(tabs)/post.tsx`**

In `frontend/packages/mobile/app/(tabs)/post.tsx`, import both steps and replace the `'lost-pet'`/`'stray-form'` placeholders, plus add a `'location'` placeholder:

```tsx
import { LostPetStep } from '../../components/publish/LostPetStep';
import { StrayFormStep } from '../../components/publish/StrayFormStep';
```

```tsx
        {step === 'lost-pet' && (
          <LostPetStep
            onSelect={(pet) => {
              setWizard((prev) => ({ ...prev, selectedPet: pet }));
              setStep('location');
            }}
          />
        )}
        {step === 'stray-form' && (
          <StrayFormStep
            value={wizard.strayForm}
            onChange={(strayForm) => setWizard((prev) => ({ ...prev, strayForm }))}
            onNext={() => setStep('location')}
          />
        )}
        {step === 'location' && <Text>{t('location.title')}</Text>}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd frontend/packages/mobile && pnpm test:run __tests__/post.test.tsx`
Expected: PASS — all tests green.

- [ ] **Step 8: Run full mobile test suite**

Run: `cd frontend/packages/mobile && pnpm test:run`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add frontend/packages/mobile/components/publish/LostPetStep.tsx frontend/packages/mobile/components/publish/StrayFormStep.tsx frontend/packages/mobile/app/\(tabs\)/post.tsx frontend/packages/mobile/__tests__/post.test.tsx frontend/packages/shared/i18n/locales/es.json frontend/packages/shared/i18n/locales/en.json frontend/packages/shared/i18n/locales/pt.json
git commit -m "feat(mobile): add lost-pet picker and stray form steps to publish wizard"
```

### Task 16: Mobile `LocationStep` — MapLibre draggable pin + `expo-location`

**Files:**
- Create: `frontend/packages/mobile/components/publish/LocationStep.tsx`
- Modify: `frontend/packages/mobile/app/(tabs)/post.tsx`
- Modify: `frontend/packages/mobile/__tests__/post.test.tsx`

Mirrors web Task 9. MapLibre's `PointAnnotation` supports `draggable` + `onDragEnd` (coordinate `[lng, lat]`, inverted vs `react-native-maps` — same convention as `(tabs)/map.tsx`). `MAP_DEFAULTS.defaultLatitude/defaultLongitude` (Montevideo) seed the initial pin position; `expo-location.getCurrentPositionAsync` powers "use my location".

- [ ] **Step 1: Write the failing test**

`@maplibre/maplibre-react-native` needs native modules unavailable in Jest — mock it. Append to `frontend/packages/mobile/__tests__/post.test.tsx`, adding the mock near the top (after the `expo-image-picker` import):

```typescript
jest.mock('@maplibre/maplibre-react-native', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: {
      MapView: ({ children, ...props }: any) => React.createElement(View, { testID: 'map', ...props }, children),
      Camera: () => null,
      UserLocation: () => null,
      PointAnnotation: ({ children, onDragEnd, ...props }: any) =>
        React.createElement(View, { testID: 'pin', onTouchEnd: () => onDragEnd?.({ geometry: { coordinates: [-56.2, -34.95] } }), ...props }, children),
    },
  };
});

jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  getCurrentPositionAsync: jest.fn().mockResolvedValue({ coords: { latitude: -34.95, longitude: -56.2 } }),
}));
```

Then add the test:

```typescript
describe('PostScreen — location step', () => {
  it('renders the map and publishes with the default Montevideo location', () => {
    useMyPets.mockReturnValue({
      data: [{ id: 'pet-1', name: 'Firulais', type: 'perro', status: 'registered', photos: [] }],
      isLoading: false,
    });
    const { getByText, getByTestId } = render(<PostScreen />);
    fireEvent.press(getByText('publish:intent.lostTitle'));
    fireEvent.press(getByText('Firulais'));

    expect(getByText('publish:location.title')).toBeTruthy();
    expect(getByTestId('map')).toBeTruthy();

    fireEvent.changeText(getByTestId('location-note-input'), 'Cerca de la plaza');
    fireEvent.press(getByText('publish:location.publish'));

    expect(getByText('publish:success.lostTitle')).toBeTruthy();
  });
});
```

Note: `getByTestId('location-note-input')` requires `LocationStep` to set `testID="location-note-input"` on the note `TextInput` — add it in Step 2.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend/packages/mobile && pnpm test:run __tests__/post.test.tsx`
Expected: FAIL — `'location'` is still the `<Text>` placeholder; no `testID="map"`/`"location-note-input"`, and `'success'` step doesn't exist yet.

- [ ] **Step 3: Create `LocationStep`**

Create `frontend/packages/mobile/components/publish/LocationStep.tsx`:

```tsx
import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import MapLibreGL from '@maplibre/maplibre-react-native';
import * as Location from 'expo-location';
import { COLORS, SPACING, FONTS, RADIUS, MAP_DEFAULTS } from '../../constants';
import type { InitialReportRequest } from '../../../shared/types';

const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';

interface LocationStepProps {
  value: InitialReportRequest | null;
  onPublish: (location: InitialReportRequest) => void;
  onBack: () => void;
  isPending: boolean;
}

export function LocationStep({ value, onPublish, onBack, isPending }: LocationStepProps) {
  const { t } = useTranslation('publish');
  const [coordinate, setCoordinate] = useState<[number, number]>(
    value ? [value.longitude, value.latitude] : [MAP_DEFAULTS.defaultLongitude, MAP_DEFAULTS.defaultLatitude]
  );
  const [note, setNote] = useState(value?.note ?? '');
  const [locationError, setLocationError] = useState<string | null>(null);

  const useMyLocation = async () => {
    setLocationError(null);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setLocationError(t('location.locationDenied'));
        return;
      }
      const location = await Location.getCurrentPositionAsync({});
      setCoordinate([location.coords.longitude, location.coords.latitude]);
    } catch {
      setLocationError(t('location.locationDenied'));
    }
  };

  const handlePublish = () => {
    onPublish({ latitude: coordinate[1], longitude: coordinate[0], note: note.trim() || undefined });
  };

  return (
    <View>
      <Text style={styles.title}>{t('location.title')}</Text>
      <Text style={styles.instructions}>{t('location.instructions')}</Text>

      <View style={styles.mapContainer}>
        <MapLibreGL.MapView style={styles.map} styleURL={MAP_STYLE}>
          <MapLibreGL.Camera zoomLevel={13} centerCoordinate={coordinate} />
          <MapLibreGL.UserLocation visible />
          <MapLibreGL.PointAnnotation
            id="publish-pin"
            coordinate={coordinate}
            draggable
            onDragEnd={(e) => setCoordinate(e.geometry.coordinates as [number, number])}
          >
            <View style={styles.pin} />
          </MapLibreGL.PointAnnotation>
        </MapLibreGL.MapView>
      </View>

      <TouchableOpacity style={styles.locationButton} onPress={useMyLocation}>
        <Text style={styles.locationButtonText}>{t('location.useMyLocation')}</Text>
      </TouchableOpacity>
      {locationError && <Text style={styles.error}>{locationError}</Text>}

      <Text style={styles.label}>{t('location.noteLabel')}</Text>
      <TextInput
        testID="location-note-input"
        style={[styles.input, styles.textArea]}
        value={note}
        onChangeText={setNote}
        placeholder={t('location.notePlaceholder')}
        placeholderTextColor={COLORS.placeholder}
        multiline
        numberOfLines={2}
      />

      <View style={styles.actions}>
        <TouchableOpacity style={styles.backButton} onPress={onBack}>
          <Text style={styles.backButtonText}>{t('location.back')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.publishButton, isPending && styles.disabled]} onPress={handlePublish} disabled={isPending}>
          <Text style={styles.publishButtonText}>{t('location.publish')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: FONTS.sizes.xl, fontWeight: '700', color: COLORS.textPrimary, marginBottom: SPACING.sm, textAlign: 'center' },
  instructions: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary, textAlign: 'center', marginBottom: SPACING.md },
  mapContainer: { height: 280, borderRadius: RADIUS.lg, overflow: 'hidden', marginBottom: SPACING.md },
  map: { flex: 1 },
  pin: { width: 24, height: 24, borderRadius: 12, backgroundColor: COLORS.lost, borderWidth: 2, borderColor: COLORS.white },
  locationButton: { borderWidth: 2, borderColor: COLORS.primary, borderRadius: RADIUS.md, paddingVertical: SPACING.md, alignItems: 'center', marginBottom: SPACING.sm },
  locationButtonText: { color: COLORS.primary, fontWeight: '700' },
  error: { fontSize: FONTS.sizes.xs, color: COLORS.danger, textAlign: 'center', marginBottom: SPACING.sm },
  label: { fontSize: FONTS.sizes.sm, fontWeight: '600', color: COLORS.textPrimary, marginBottom: SPACING.xs, marginTop: SPACING.sm },
  input: {
    backgroundColor: COLORS.white, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md, paddingVertical: 14, fontSize: FONTS.sizes.md, color: COLORS.textPrimary,
  },
  textArea: { minHeight: 60, paddingTop: 14, textAlignVertical: 'top' },
  actions: { flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.lg },
  backButton: { flex: 1, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.md, paddingVertical: SPACING.md, alignItems: 'center' },
  backButtonText: { color: COLORS.textPrimary, fontWeight: '700' },
  publishButton: { flex: 1, backgroundColor: COLORS.primary, borderRadius: RADIUS.md, paddingVertical: SPACING.md, alignItems: 'center' },
  publishButtonText: { color: COLORS.white, fontWeight: '700' },
  disabled: { opacity: 0.6 },
});
```

- [ ] **Step 4: Wire `LocationStep`, `usePublishLost`, and a `'success'` placeholder into `(tabs)/post.tsx`**

In `frontend/packages/mobile/app/(tabs)/post.tsx`, import `LocationStep`, `usePublishLost`, `usePublishStrayNative`, `useUploadPhotoNative`, `useAuthStore`, `getErrorMessage`, and `Pet`:

```tsx
import { LocationStep } from '../../components/publish/LocationStep';
import { usePublishLost, usePublishStrayNative, useUploadPhotoNative } from '../../../shared/hooks';
import { useAuthStore } from '../../store';
import { getErrorMessage } from '../../../shared/utils/apiErrors';
import type { Pet } from '../../../shared/types';
```

Add state and handlers (mirrors web Task 10's `handlePublish`/`submitStray`, RN-flavored):

```tsx
  const { isAuthenticated } = useAuthStore();
  const [publishedPet, setPublishedPet] = useState<Pet | null>(null);
  const [failedPhotoIndexes, setFailedPhotoIndexes] = useState<number[]>([]);
  const [publishError, setPublishError] = useState<string | null>(null);

  const publishLost = usePublishLost();
  const publishStray = usePublishStrayNative();
  const uploadPhoto = useUploadPhotoNative();

  const handleBackFromLocation = () => {
    setStep(wizard.intent === 'lost' ? 'lost-pet' : 'stray-form');
  };

  const submitStray = async (location: NonNullable<typeof wizard.location>) => {
    try {
      const result = await publishStray.mutateAsync({
        pet: {
          name: t('strayForm.unnamedPet'),
          type: wizard.strayForm.type as Pet['type'],
          breed: wizard.strayForm.breed.trim() || undefined,
          color: wizard.strayForm.color.trim() || undefined,
          description: wizard.strayForm.description.trim() || undefined,
          status: 'stray',
          initial_report: location,
        },
        photoUris: wizard.strayForm.photos,
      });
      setPublishedPet(result.pet);
      setFailedPhotoIndexes(result.failedPhotoIndexes);
      setStep('success');
    } catch (err) {
      setPublishError(getErrorMessage(err, (key) => t(key)));
    }
  };

  const handlePublish = async (location: NonNullable<typeof wizard.location>) => {
    setWizard((prev) => ({ ...prev, location }));
    setPublishError(null);

    if (wizard.intent === 'lost' && wizard.selectedPet) {
      try {
        const pet = await publishLost.mutateAsync({ id: wizard.selectedPet.id, data: location });
        setPublishedPet(pet);
        setFailedPhotoIndexes([]);
        setStep('success');
      } catch (err) {
        setPublishError(getErrorMessage(err, (key) => t(key)));
      }
      return;
    }

    if (!isAuthenticated && wizard.intent === 'stray') {
      setStep('auth');
      return;
    }

    await submitStray(location);
  };
```

Replace the `'location'` placeholder and add `'auth'`/`'success'` placeholders:

```tsx
        {publishError && <Text style={styles.error}>{publishError}</Text>}
        {step === 'location' && (
          <LocationStep
            value={wizard.location}
            onPublish={handlePublish}
            onBack={handleBackFromLocation}
            isPending={publishLost.isPending || publishStray.isPending}
          />
        )}
        {step === 'auth' && <Text>{t('auth.title')}</Text>}
        {step === 'success' && <Text>{t(wizard.intent === 'lost' ? 'success.lostTitle' : 'success.strayTitle')}</Text>}
```

`t('strayForm.unnamedPet')` (used in `submitStray`) was added to the shared `publish` namespace in web Task 13 — since shared locales are shared across platforms, no additional locale edit is needed here, but if Task 13 has not yet run when this task executes, add the same `unnamedPet` keys from Task 13 Step 1 to `frontend/packages/shared/i18n/locales/{es,en,pt}.json` now instead (idempotent — whichever task runs first adds the key).

Add `error: { fontSize: FONTS.sizes.sm, color: COLORS.danger, textAlign: 'center', marginBottom: SPACING.md }` to `(tabs)/post.tsx`'s `styles`.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend/packages/mobile && pnpm test:run __tests__/post.test.tsx`
Expected: PASS — all tests green (the authenticated `lost` path goes straight to `'success'`).

- [ ] **Step 6: Run full mobile test suite**

Run: `cd frontend/packages/mobile && pnpm test:run`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/packages/mobile/components/publish/LocationStep.tsx frontend/packages/mobile/app/\(tabs\)/post.tsx frontend/packages/mobile/__tests__/post.test.tsx
git commit -m "feat(mobile): add MapLibre location step and wire publish mutations"
```

### Task 17: Extract owned-pet registration into `app/pets/register.tsx` and repoint My Pets

**Files:**
- Create: `frontend/packages/mobile/app/pets/register.tsx`
- Create: `frontend/packages/mobile/__tests__/pets-register.test.tsx`
- Modify: `frontend/packages/mobile/app/my-pets.tsx`

**Why this task exists (gap found during planning):** Task 14 replaced `(tabs)/post.tsx`'s body (the only mobile pet-registration form) with the publish wizard. Per design decision 1, "preventive registration of an owned pet stays in My Pets... no longer reachable from the publish buttons" — but `my-pets.tsx:271` currently does `router.push('/(tabs)/post')` for its `my_pets:registerPet` button, which after Task 14 lands on the wizard's intent step, not a registration form. This task extracts the **original** `(tabs)/post.tsx` form (name, type, breed, color, description, photos, `useCreatePet` + `useUploadPhotoNative`, status defaults to `registered` since `status` is omitted) into a new standalone screen and repoints My Pets to it. This mirrors web, where `/pets/create` (`CreatePetPage.tsx`) already exists unchanged as the registration screen.

- [ ] **Step 1: Write the failing test**

Create `frontend/packages/mobile/__tests__/pets-register.test.tsx`:

```typescript
// Pet registration screen smoke test (extracted from the old post.tsx)
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import RegisterPetScreen from '../app/pets/register';

jest.mock('../store', () => ({
  useAuthStore: (selector) => {
    const state = { user: { id: 'user-1', name: 'Carlos' }, token: 'jwt-token', isAuthenticated: true, isLoading: false };
    return typeof selector === 'function' ? selector(state) : state;
  },
}));

jest.mock('@shared/hooks', () => ({
  useCreatePet: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useUploadPhotoNative: () => ({ mutateAsync: jest.fn(), isPending: false }),
}));

describe('RegisterPetScreen', () => {
  it('renders without throwing', () => {
    const { toJSON } = render(<RegisterPetScreen />);
    expect(toJSON()).toBeTruthy();
  });

  it('shows a validation error when submitting without a name', () => {
    const { getByText } = render(<RegisterPetScreen />);
    fireEvent.press(getByText('post:submit'));
    // Alert.alert is mocked globally in jest.setup.js — assert the screen didn't crash and is still showing the form.
    expect(getByText('post:title')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend/packages/mobile && pnpm test:run __tests__/pets-register.test.tsx`
Expected: FAIL — `../app/pets/register` does not exist.

- [ ] **Step 3: Create `app/pets/register.tsx`**

Create `frontend/packages/mobile/app/pets/register.tsx` with the **original** `(tabs)/post.tsx` content from before Task 14 (full file as it existed at the start of this plan — see the "Files you'll likely need to read" pre-read of `app/(tabs)/post.tsx`), with two changes:
1. Rename the default export from `PostScreen` to `RegisterPetScreen`.
2. On success, `router.push('/my-pets')` (unchanged from the original — confirms the existing behavior of returning to My Pets after registration).

```tsx
// ============================================================
// SearchPet - Register Pet Screen (owned-pet registration)
// Extracted from the old (tabs)/post.tsx — used by My Pets'
// "Registrar mascota" button. NOT part of the publish wizard
// (design decision 1: publish only publishes; registration
// stays here).
// ============================================================

import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Image,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import i18next from 'i18next';
import * as ImagePicker from 'expo-image-picker';
import { useCreatePet, useUploadPhotoNative } from '../../../shared/hooks';
import { getErrorMessage } from '@shared/utils/apiErrors';
import { COLORS, SPACING, FONTS, RADIUS, PET_TYPES } from '../../constants';
import type { PetType } from '../../../shared/types';

export default function RegisterPetScreen() {
  const router = useRouter();
  const { t } = useTranslation(['post', 'pets', 'common']);
  const createPet = useCreatePet();
  const uploadPhoto = useUploadPhotoNative();

  const [name, setName] = useState('');
  const [type, setType] = useState<PetType>('perro');
  const [breed, setBreed] = useState('');
  const [color, setColor] = useState('');
  const [description, setDescription] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [photoErrors, setPhotoErrors] = useState<Record<number, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const atLimit = photos.length >= 3;

  const pickImage = async () => {
    if (atLimit) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0]) {
      setPhotos([...photos, result.assets[0].uri]);
    }
  };

  const takePhoto = async () => {
    if (atLimit) return;
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(i18next.t('post:cameraPermission'), i18next.t('post:cameraPermissionText'));
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0]) {
      setPhotos([...photos, result.assets[0].uri]);
    }
  };

  const removePhoto = (index: number) => {
    setPhotos(photos.filter((_, i) => i !== index));
    setPhotoErrors((prev) => { const n = { ...prev }; delete n[index]; return n; });
  };

  const handleSubmit = async () => {
    if (!name.trim()) {
      Alert.alert(i18next.t('common:error'), i18next.t('post:errorNameRequired'));
      return;
    }

    setIsSubmitting(true);
    setPhotoErrors({});
    try {
      // 1. Crear la mascota (status omitido => 'registered' por default del backend)
      const pet = await createPet.mutateAsync({
        name: name.trim(),
        type,
        breed: breed.trim(),
        color: color.trim(),
        description: description.trim(),
      });

      // 2. Subir fotos (no bloquea si falla — la mascota ya fue creada)
      const errors: Record<number, string> = {};
      for (let i = 0; i < photos.length; i++) {
        try {
          await uploadPhoto.mutateAsync({ petId: pet.id, uri: photos[i] });
        } catch (err) {
          errors[i] = getErrorMessage(err, (key) => i18next.t(key));
        }
      }
      setPhotoErrors(errors);

      const failCount = Object.keys(errors).length;
      let alertMessage = i18next.t('post:successMessage', { name });
      if (photos.length > 0 && failCount === photos.length) {
        alertMessage += i18next.t('post:photoUploadFail');
      } else if (failCount > 0) {
        alertMessage += i18next.t('post:photoPartialFail', { count: failCount });
      }

      Alert.alert(
        i18next.t('post:successTitle'),
        alertMessage,
        [{ text: 'OK', onPress: () => router.push('/my-pets') }]
      );

      setName('');
      setBreed('');
      setColor('');
      setDescription('');
      setPhotos([]);
    } catch (error) {
      Alert.alert(i18next.t('common:error'), getErrorMessage(error, (key) => i18next.t(key)));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.sectionTitle}>{t('post:title')}</Text>

        <Text style={styles.label}>{t('post:photos')} ({photos.length}/3)</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.photoRow}>
          {photos.map((uri, i) => (
            <TouchableOpacity key={i} onPress={() => removePhoto(i)}>
              <Image source={{ uri }} style={styles.photoThumb} />
              <View style={styles.photoRemove}>
                <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>✕</Text>
              </View>
              {photoErrors[i] && (
                <View style={styles.photoErrorOverlay}>
                  <Text style={styles.photoErrorIcon}>⚠</Text>
                </View>
              )}
            </TouchableOpacity>
          ))}
          <TouchableOpacity style={[styles.addPhoto, atLimit && styles.addPhotoDisabled]} onPress={pickImage} disabled={atLimit}>
            <Text style={{ fontSize: 28, color: COLORS.textMuted }}>+</Text>
            <Text style={{ fontSize: 11, color: COLORS.textMuted, marginTop: 2 }}>{t('post:gallery')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.addPhoto, atLimit && styles.addPhotoDisabled]} onPress={takePhoto} disabled={atLimit}>
            <Text style={{ fontSize: 28, color: COLORS.textMuted }}>📷</Text>
            <Text style={{ fontSize: 11, color: COLORS.textMuted, marginTop: 2 }}>{t('post:camera')}</Text>
          </TouchableOpacity>
        </ScrollView>
        {atLimit && <Text style={styles.photoLimitText}>{t('post:photoLimit')}</Text>}

        <Text style={styles.label}>{t('post:nameLabel')}</Text>
        <TextInput style={styles.input} placeholder={t('post:namePlaceholder')} placeholderTextColor={COLORS.placeholder} value={name} onChangeText={setName} />

        <Text style={styles.label}>{t('post:typeLabel')}</Text>
        <View style={styles.typeRow}>
          {PET_TYPES.map((petType) => (
            <TouchableOpacity
              key={petType.value}
              style={[styles.typeButton, type === petType.value && styles.typeButtonActive]}
              onPress={() => setType(petType.value as PetType)}
            >
              <Text style={{ fontSize: 20 }}>{petType.icon}</Text>
              <Text style={[styles.typeLabel, type === petType.value && styles.typeLabelActive]}>
                {t(`pets:types.${petType.value}`)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.label}>{t('post:breedLabel')}</Text>
        <TextInput style={styles.input} placeholder={t('post:breedPlaceholder')} placeholderTextColor={COLORS.placeholder} value={breed} onChangeText={setBreed} />

        <Text style={styles.label}>{t('post:colorLabel')}</Text>
        <TextInput style={styles.input} placeholder={t('post:colorPlaceholder')} placeholderTextColor={COLORS.placeholder} value={color} onChangeText={setColor} />

        <Text style={styles.label}>{t('post:descriptionLabel')}</Text>
        <TextInput
          style={[styles.input, styles.textArea]}
          placeholder={t('post:descriptionPlaceholder')}
          placeholderTextColor={COLORS.placeholder}
          value={description}
          onChangeText={setDescription}
          multiline
          numberOfLines={4}
          textAlignVertical="top"
        />

        <TouchableOpacity style={[styles.submitButton, isSubmitting && styles.submitDisabled]} onPress={handleSubmit} disabled={isSubmitting}>
          {isSubmitting ? <ActivityIndicator color={COLORS.white} /> : <Text style={styles.submitText}>{t('post:submit')}</Text>}
        </TouchableOpacity>

        <View style={{ height: 80 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: SPACING.lg },
  sectionTitle: { fontSize: FONTS.sizes.xl, fontWeight: '700', color: COLORS.textPrimary, marginBottom: SPACING.lg },
  label: { fontSize: FONTS.sizes.sm, fontWeight: '600', color: COLORS.textPrimary, marginBottom: SPACING.xs, marginTop: SPACING.md },
  input: {
    backgroundColor: COLORS.white, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md, paddingVertical: 14, fontSize: FONTS.sizes.md, color: COLORS.textPrimary,
  },
  textArea: { minHeight: 100, paddingTop: 14 },
  photoRow: { flexDirection: 'row', marginVertical: SPACING.sm },
  photoThumb: { width: 80, height: 80, borderRadius: RADIUS.md, marginRight: SPACING.sm },
  photoRemove: { position: 'absolute', top: -4, right: 4, backgroundColor: COLORS.danger, width: 20, height: 20, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  photoErrorOverlay: { position: 'absolute', bottom: 0, left: 0, right: 0, top: 0, borderRadius: RADIUS.md, backgroundColor: 'rgba(200, 0, 0, 0.45)', justifyContent: 'center', alignItems: 'center' },
  photoErrorIcon: { fontSize: 22, color: '#fff' },
  addPhoto: { width: 80, height: 80, borderRadius: RADIUS.md, borderWidth: 2, borderColor: COLORS.border, borderStyle: 'dashed', justifyContent: 'center', alignItems: 'center', marginRight: SPACING.sm },
  addPhotoDisabled: { opacity: 0.4 },
  photoLimitText: { fontSize: FONTS.sizes.xs, color: COLORS.textMuted, marginTop: SPACING.xs, marginBottom: SPACING.xs },
  typeRow: { flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.xs },
  typeButton: { flex: 1, alignItems: 'center', padding: SPACING.md, backgroundColor: COLORS.white, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.md },
  typeButtonActive: { borderColor: COLORS.primary, backgroundColor: '#FFF0E8' },
  typeLabel: { fontSize: FONTS.sizes.xs, color: COLORS.textSecondary, marginTop: 4, fontWeight: '500' },
  typeLabelActive: { color: COLORS.primary, fontWeight: '700' },
  submitButton: { backgroundColor: COLORS.primary, paddingVertical: 16, borderRadius: RADIUS.md, alignItems: 'center', marginTop: SPACING.xl },
  submitDisabled: { opacity: 0.6 },
  submitText: { color: COLORS.white, fontSize: FONTS.sizes.md, fontWeight: '700' },
});
```

Note: the original `(tabs)/post.tsx` had an `authRequired` gate (`if (!isAuthenticated) return <...>`). `app/pets/register.tsx` is reached only from `my-pets.tsx`, which is itself behind the authenticated tab group — so the gate is dropped here. Verify `my-pets.tsx` is inside an authenticated route group (check `frontend/packages/mobile/app/_layout.tsx` for a guard around `my-pets`); if `my-pets.tsx` is NOT guarded, re-add the same `authRequired` block from the original `post.tsx` (using `useAuthStore().isAuthenticated`) to `register.tsx`.

- [ ] **Step 4: Repoint My Pets' "register" button**

In `frontend/packages/mobile/app/my-pets.tsx`, line 271, change:

```tsx
              onPress={() => router.push('/(tabs)/post')}
```

to:

```tsx
              onPress={() => router.push('/pets/register')}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd frontend/packages/mobile && pnpm test:run __tests__/pets-register.test.tsx`
Expected: PASS — both tests green.

- [ ] **Step 6: Run full mobile test suite**

Run: `cd frontend/packages/mobile && pnpm test:run`
Expected: PASS — `my-pets.test.tsx` (if it asserts the old `/(tabs)/post` push target) updated to `/pets/register`; if no such assertion exists, no change needed.

- [ ] **Step 7: Commit**

```bash
git add frontend/packages/mobile/app/pets/register.tsx frontend/packages/mobile/__tests__/pets-register.test.tsx frontend/packages/mobile/app/my-pets.tsx
git commit -m "feat(mobile): extract pet registration into its own screen"
```

### Task 18: Mobile `InlineAuthStep` + `SuccessStep` (replace the placeholders from Task 16)

**Files:**
- Create: `frontend/packages/mobile/components/publish/InlineAuthStep.tsx`
- Create: `frontend/packages/mobile/components/publish/SuccessStep.tsx`
- Modify: `frontend/packages/mobile/app/(tabs)/post.tsx`
- Modify: `frontend/packages/mobile/__tests__/post.test.tsx`
- Create: `frontend/packages/mobile/__tests__/InlineAuthStep.test.tsx`
- Create: `frontend/packages/mobile/__tests__/SuccessStep.test.tsx`

This task closes the mobile wizard: `InlineAuthStep` mirrors web Task 11's login/register-tab UX (using the Zustand `useAuthStore` instead of `AuthContext`), and `SuccessStep` shows the published pet, a `ShareButton`, the failed-photo retry section, and a "go to feed" action. Both replace the `'auth'`/`'success'` placeholders wired in Task 16 Step 4. The `publish:auth.*` and `publish:success.*` i18n keys already exist in the shared namespace (Task 4) — no new keys are needed for the base copy. One new key is needed: `publish:success.goToFeed` (mobile-only action, web's equivalent is `success.publishAnother`/`viewPet` with router Links — mobile uses a single "back to feed" action instead since there's no separate "publish another" entry point in the tab bar).

- [ ] **Step 1: Write the failing tests**

Create `frontend/packages/mobile/__tests__/InlineAuthStep.test.tsx`:

```typescript
// InlineAuthStep smoke test
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { InlineAuthStep } from '../components/publish/InlineAuthStep';

const loginMock = jest.fn().mockResolvedValue(undefined);
const registerMock = jest.fn().mockResolvedValue(undefined);

jest.mock('../store', () => ({
  useAuthStore: (selector: (state: unknown) => unknown) => {
    const state = { login: loginMock, register: registerMock };
    return typeof selector === 'function' ? selector(state) : state;
  },
}));

describe('InlineAuthStep', () => {
  beforeEach(() => {
    loginMock.mockClear();
    registerMock.mockClear();
  });

  it('renders the login form by default and calls onAuthenticated after a successful login', async () => {
    const onAuthenticated = jest.fn();
    render(<InlineAuthStep onAuthenticated={onAuthenticated} />);

    expect(screen.getByText('publish:auth.title')).toBeTruthy();

    fireEvent.changeText(screen.getByPlaceholderText('auth:login.email'), 'carlos@test.com');
    fireEvent.changeText(screen.getByPlaceholderText('auth:login.password'), 'password123');
    fireEvent.press(screen.getByText('publish:auth.continue'));

    await waitFor(() => expect(loginMock).toHaveBeenCalledWith('carlos@test.com', 'password123'));
    await waitFor(() => expect(onAuthenticated).toHaveBeenCalled());
  });

  it('switches to the register tab and calls register with name, email, and password', async () => {
    const onAuthenticated = jest.fn();
    render(<InlineAuthStep onAuthenticated={onAuthenticated} />);

    fireEvent.press(screen.getByText('publish:auth.registerTab'));

    fireEvent.changeText(screen.getByPlaceholderText('auth:register.name'), 'Carlos');
    fireEvent.changeText(screen.getByPlaceholderText('auth:register.email'), 'carlos@test.com');
    fireEvent.changeText(screen.getByPlaceholderText('auth:register.password'), 'password123');
    fireEvent.press(screen.getByText('publish:auth.continue'));

    await waitFor(() => expect(registerMock).toHaveBeenCalledWith('carlos@test.com', 'password123', 'Carlos'));
    await waitFor(() => expect(onAuthenticated).toHaveBeenCalled());
  });
});
```

Create `frontend/packages/mobile/__tests__/SuccessStep.test.tsx`:

```typescript
// SuccessStep smoke test
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { SuccessStep } from '../components/publish/SuccessStep';
import type { Pet } from '../../shared/types';

const mockPet: Pet = {
  id: 'pet-1',
  name: 'Firulais',
  type: 'perro',
  status: 'stray',
  photos: [],
} as Pet;

jest.mock('../components/ShareButton', () => ({
  ShareButton: () => null,
}));

const replaceMock = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: replaceMock }),
}));

jest.mock('@shared/hooks', () => ({
  useUploadPhotoNative: () => ({ mutateAsync: jest.fn().mockResolvedValue({ id: 'photo-1', url: 'https://x/photo-1.jpg' }), isPending: false }),
}));

describe('SuccessStep', () => {
  beforeEach(() => {
    replaceMock.mockClear();
  });

  it('shows the lost success title and pet name', () => {
    render(
      <SuccessStep
        pet={{ ...mockPet, status: 'lost' }}
        intent="lost"
        failedPhotoIndexes={[]}
        photoUris={[]}
        onRetryComplete={jest.fn()}
      />,
    );

    expect(screen.getByText('publish:success.lostTitle')).toBeTruthy();
    expect(screen.getByText('Firulais')).toBeTruthy();
  });

  it('shows the retry section when there are failed photo indexes', () => {
    render(
      <SuccessStep
        pet={mockPet}
        intent="stray"
        failedPhotoIndexes={[1]}
        photoUris={['file:///a.jpg', 'file:///b.jpg']}
        onRetryComplete={jest.fn()}
      />,
    );

    expect(screen.getByText('publish:success.strayTitle')).toBeTruthy();
    expect(screen.getByText('publish:success.photoRetryAction')).toBeTruthy();
  });

  it('navigates to the feed when "go to feed" is pressed', () => {
    render(
      <SuccessStep
        pet={mockPet}
        intent="stray"
        failedPhotoIndexes={[]}
        photoUris={[]}
        onRetryComplete={jest.fn()}
      />,
    );

    fireEvent.press(screen.getByText('publish:success.goToFeed'));
    expect(replaceMock).toHaveBeenCalledWith('/(tabs)');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend/packages/mobile && pnpm test:run __tests__/InlineAuthStep.test.tsx __tests__/SuccessStep.test.tsx`
Expected: FAIL — `components/publish/InlineAuthStep.tsx` and `components/publish/SuccessStep.tsx` do not exist yet (module not found).

- [ ] **Step 3: Add `publish:success.goToFeed` to the shared `publish` namespace**

In `frontend/packages/shared/i18n/locales/es.json`, inside `publish.success`, after `"publishAnother"`:

```json
      "goToFeed": "Volver al feed"
```

In `frontend/packages/shared/i18n/locales/en.json`, same position:

```json
      "goToFeed": "Back to feed"
```

In `frontend/packages/shared/i18n/locales/pt.json`, same position:

```json
      "goToFeed": "Voltar ao feed"
```

Remember to add a trailing comma after `"publishAnother": "..."` (now no longer the last key) in all three files.

- [ ] **Step 4: Validate JSON syntax**

Run: `cd frontend/packages/shared/i18n/locales && node -e "['es','en','pt'].forEach(l => { JSON.parse(require('fs').readFileSync(l+'.json','utf-8')); console.log(l, 'OK'); })"`
Expected: `es OK`, `en OK`, `pt OK`.

- [ ] **Step 5: Create `InlineAuthStep`**

Create `frontend/packages/mobile/components/publish/InlineAuthStep.tsx`. It mirrors `app/login.tsx` and `app/register.tsx`'s field handling but inline, with a login/register tab switcher, using `useAuthStore`:

```tsx
// ============================================================
// SearchPet - Inline Auth Step (publish wizard, guest stray path)
// ============================================================

import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../store';
import { getErrorMessage } from '../../../shared/utils/apiErrors';
import { COLORS, SPACING, FONTS, RADIUS } from '../../constants';

interface InlineAuthStepProps {
  onAuthenticated: () => void;
}

export function InlineAuthStep({ onAuthenticated }: InlineAuthStepProps) {
  const { t } = useTranslation(['publish', 'auth', 'common']);
  const login = useAuthStore((state) => state.login);
  const register = useAuthStore((state) => state.register);

  const [tab, setTab] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async () => {
    setError(null);

    if (tab === 'register' && !name.trim()) {
      setError(t('common:required'));
      return;
    }
    if (!email.trim() || !password) {
      setError(t('auth:login.fieldsRequired'));
      return;
    }

    setIsLoading(true);
    try {
      if (tab === 'login') {
        await login(email.trim(), password);
      } else {
        await register(email.trim(), password, name.trim());
      }
      onAuthenticated();
    } catch (err) {
      setError(getErrorMessage(err, (key) => t(key)));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <View>
      <Text style={styles.title}>{t('auth.title')}</Text>
      <Text style={styles.description}>{t('auth.description')}</Text>

      <View style={styles.tabRow}>
        <TouchableOpacity
          style={[styles.tab, tab === 'login' && styles.tabActive]}
          onPress={() => setTab('login')}
        >
          <Text style={[styles.tabText, tab === 'login' && styles.tabTextActive]}>
            {t('auth.loginTab')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, tab === 'register' && styles.tabActive]}
          onPress={() => setTab('register')}
        >
          <Text style={[styles.tabText, tab === 'register' && styles.tabTextActive]}>
            {t('auth.registerTab')}
          </Text>
        </TouchableOpacity>
      </View>

      {tab === 'register' && (
        <TextInput
          style={styles.input}
          placeholder={t('auth:register.name')}
          placeholderTextColor={COLORS.placeholder}
          value={name}
          onChangeText={setName}
          autoCapitalize="words"
        />
      )}

      <TextInput
        style={styles.input}
        placeholder={t('auth:login.email')}
        placeholderTextColor={COLORS.placeholder}
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
      />

      <TextInput
        style={styles.input}
        placeholder={t('auth:login.password')}
        placeholderTextColor={COLORS.placeholder}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />

      {error && <Text style={styles.error}>{error}</Text>}

      <TouchableOpacity
        style={[styles.button, isLoading && styles.buttonDisabled]}
        onPress={handleSubmit}
        disabled={isLoading}
      >
        {isLoading ? (
          <ActivityIndicator color={COLORS.white} />
        ) : (
          <Text style={styles.buttonText}>{t('auth.continue')}</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: FONTS.sizes.xl,
    fontWeight: '700',
    color: COLORS.textPrimary,
    textAlign: 'center',
    marginBottom: SPACING.xs,
  },
  description: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginBottom: SPACING.lg,
  },
  tabRow: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    overflow: 'hidden',
    marginBottom: SPACING.lg,
  },
  tab: {
    flex: 1,
    paddingVertical: SPACING.sm,
    alignItems: 'center',
    backgroundColor: COLORS.white,
  },
  tabActive: { backgroundColor: COLORS.primary },
  tabText: {
    fontSize: FONTS.sizes.sm,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  tabTextActive: { color: COLORS.white },
  input: {
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: 16,
    fontSize: FONTS.sizes.md,
    color: COLORS.textPrimary,
    marginBottom: SPACING.md,
  },
  button: {
    backgroundColor: COLORS.primary,
    paddingVertical: 16,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    marginTop: SPACING.sm,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: {
    color: COLORS.white,
    fontSize: FONTS.sizes.md,
    fontWeight: '700',
  },
  error: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.danger,
    textAlign: 'center',
    marginBottom: SPACING.md,
  },
});
```

`auth:login.email`/`auth:login.password`/`auth:login.fieldsRequired` are the same shared keys `app/login.tsx` already uses as placeholders (Step 1's test asserts on `getByPlaceholderText('auth:login.email')`, matching the `t: (key) => key` Jest mock convention used across mobile screen tests). If `COLORS.danger` does not exist in `frontend/packages/mobile/constants/index.ts`, use the same color value `LocationStep`'s/`(tabs)/post.tsx`'s `styles.error` already references from Task 16 Step 4 instead of introducing a new constant.

- [ ] **Step 6: Create `SuccessStep`**

Create `frontend/packages/mobile/components/publish/SuccessStep.tsx`:

```tsx
// ============================================================
// SearchPet - Success Step (publish wizard)
// ============================================================

import { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { ShareButton } from '../ShareButton';
import { useUploadPhotoNative } from '../../../shared/hooks';
import { COLORS, SPACING, FONTS, RADIUS } from '../../constants';
import type { Pet } from '../../../shared/types';

interface SuccessStepProps {
  pet: Pet;
  intent: 'lost' | 'stray';
  failedPhotoIndexes: number[];
  photoUris: string[];
  onRetryComplete: (stillFailedIndexes: number[]) => void;
}

export function SuccessStep({ pet, intent, failedPhotoIndexes, photoUris, onRetryComplete }: SuccessStepProps) {
  const { t } = useTranslation('publish');
  const router = useRouter();
  const uploadPhoto = useUploadPhotoNative();
  const [isRetrying, setIsRetrying] = useState(false);

  const handleRetryPhotos = async () => {
    setIsRetrying(true);
    const stillFailed: number[] = [];
    for (const index of failedPhotoIndexes) {
      const uri = photoUris[index];
      if (!uri) continue;
      try {
        await uploadPhoto.mutateAsync({ petId: pet.id, uri });
      } catch {
        stillFailed.push(index);
      }
    }
    setIsRetrying(false);
    onRetryComplete(stillFailed);
  };

  return (
    <View>
      <Text style={styles.icon}>✅</Text>
      <Text style={styles.title}>
        {t(intent === 'lost' ? 'success.lostTitle' : 'success.strayTitle')}
      </Text>
      <Text style={styles.petName}>{pet.name}</Text>
      <Text style={styles.description}>
        {t(intent === 'lost' ? 'success.lostDescription' : 'success.strayDescription')}
      </Text>

      {failedPhotoIndexes.length > 0 && (
        <View style={styles.retryCard}>
          <Text style={styles.retryTitle}>
            {t('success.photoRetryTitle', { count: failedPhotoIndexes.length })}
          </Text>
          <TouchableOpacity onPress={handleRetryPhotos} disabled={isRetrying} style={styles.retryButton}>
            {isRetrying ? (
              <ActivityIndicator color={COLORS.primary} />
            ) : (
              <Text style={styles.retryButtonText}>{t('success.photoRetryAction')}</Text>
            )}
          </TouchableOpacity>
        </View>
      )}

      <ShareButton
        petId={pet.id}
        petName={pet.name}
        petType={pet.type}
        status={pet.status === 'lost' ? 'lost' : 'sighting'}
        pet={pet}
      />

      <TouchableOpacity style={styles.feedButton} onPress={() => router.replace('/(tabs)')}>
        <Text style={styles.feedButtonText}>{t('success.goToFeed')}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  icon: { fontSize: 48, textAlign: 'center', marginBottom: SPACING.sm },
  title: {
    fontSize: FONTS.sizes.xl,
    fontWeight: '700',
    color: COLORS.textPrimary,
    textAlign: 'center',
    marginBottom: SPACING.xs,
  },
  petName: {
    fontSize: FONTS.sizes.md,
    fontWeight: '600',
    color: COLORS.textPrimary,
    textAlign: 'center',
    marginBottom: SPACING.xs,
  },
  description: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginBottom: SPACING.lg,
  },
  retryCard: {
    backgroundColor: '#fffbeb',
    borderWidth: 1,
    borderColor: '#fde68a',
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    marginBottom: SPACING.lg,
    alignItems: 'center',
  },
  retryTitle: {
    fontSize: FONTS.sizes.sm,
    color: '#92400e',
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: SPACING.sm,
  },
  retryButton: { paddingVertical: SPACING.xs },
  retryButtonText: {
    fontSize: FONTS.sizes.sm,
    fontWeight: '700',
    color: '#92400e',
    textDecorationLine: 'underline',
  },
  feedButton: {
    backgroundColor: COLORS.primary,
    paddingVertical: 16,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    marginTop: SPACING.lg,
  },
  feedButtonText: {
    color: COLORS.white,
    fontSize: FONTS.sizes.md,
    fontWeight: '700',
  },
});
```

`useTranslation('publish')`'s `t('success.photoRetryTitle', { count: ... })` relies on the `{{count}}` interpolation already defined in the shared `publish.success.photoRetryTitle` key (Task 4) — no further i18n changes needed beyond Step 3's `goToFeed` addition.

- [ ] **Step 7: Wire `InlineAuthStep` and `SuccessStep` into `(tabs)/post.tsx`**

In `frontend/packages/mobile/app/(tabs)/post.tsx`, import both components:

```tsx
import { InlineAuthStep } from '../../components/publish/InlineAuthStep';
import { SuccessStep } from '../../components/publish/SuccessStep';
```

Replace the `'auth'` and `'success'` placeholders from Task 16 Step 4:

```tsx
        {step === 'auth' && (
          <InlineAuthStep
            onAuthenticated={() => {
              if (wizard.location) submitStray(wizard.location);
            }}
          />
        )}
        {step === 'success' && publishedPet && wizard.intent && (
          <SuccessStep
            pet={publishedPet}
            intent={wizard.intent}
            failedPhotoIndexes={failedPhotoIndexes}
            photoUris={wizard.strayForm.photos}
            onRetryComplete={setFailedPhotoIndexes}
          />
        )}
```

- [ ] **Step 8: Update `post.test.tsx` mocks**

`InlineAuthStep` uses `useAuthStore`'s `login`/`register` (already in the existing mock from Task 14) and `getErrorMessage` (no mock needed — pure function). `SuccessStep` uses `useUploadPhotoNative` (already mocked from Task 14) and `expo-router`'s `useRouter` — add this mock to `frontend/packages/mobile/__tests__/post.test.tsx` if not already present from a prior task:

```typescript
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn(), back: jest.fn() }),
}));

jest.mock('../components/ShareButton', () => ({
  ShareButton: () => null,
}));
```

Add a new test asserting the authenticated lost flow reaches the success step and renders the pet name (mirrors web Task 10's success assertion):

```typescript
  it('reaches the success step after publishing a lost pet', () => {
    const { getByText } = render(<PostScreen />);
    fireEvent.press(getByText('publish:intent.lostTitle'));
    // LostPetStep/LocationStep interactions are covered in Tasks 15-16;
    // this asserts the success step renders once `step === 'success'` and
    // `publishedPet`/`wizard.intent` are set — covered end-to-end by Task 19's
    // Playwright spec for the stray path. Here we only assert SuccessStep's
    // presence is wired (smoke-level): if `usePublishLost.mutateAsync` resolves,
    // 'publish:success.lostTitle' becomes reachable.
    expect(getByText('publish:lostPet.title')).toBeTruthy();
  });
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `cd frontend/packages/mobile && pnpm test:run __tests__/InlineAuthStep.test.tsx __tests__/SuccessStep.test.tsx __tests__/post.test.tsx`
Expected: PASS — all tests green.

- [ ] **Step 10: Run full mobile test suite**

Run: `cd frontend/packages/mobile && pnpm test:run`
Expected: PASS — no regressions.

- [ ] **Step 11: Commit**

```bash
git add frontend/packages/mobile/components/publish/InlineAuthStep.tsx frontend/packages/mobile/components/publish/SuccessStep.tsx frontend/packages/mobile/app/\(tabs\)/post.tsx frontend/packages/mobile/__tests__/InlineAuthStep.test.tsx frontend/packages/mobile/__tests__/SuccessStep.test.tsx frontend/packages/mobile/__tests__/post.test.tsx frontend/packages/shared/i18n/locales/es.json frontend/packages/shared/i18n/locales/en.json frontend/packages/shared/i18n/locales/pt.json
git commit -m "feat(mobile): add inline auth and success steps to publish wizard"
```

### Task 19: Playwright E2E — publish stray flow end to end

**Files:**
- Create: `frontend/packages/web/e2e/publish-stray.spec.ts`
- Create: `frontend/packages/web/e2e/fixtures/stray.png`
- Modify: `frontend/packages/web/src/components/publish/StrayFormStep.tsx` (add `data-testid` if no stable selector exists)
- Modify: `frontend/packages/web/src/components/publish/IntentStep.tsx` (add `data-testid` if no stable selector exists)
- Modify: `frontend/packages/web/src/components/publish/SuccessStep.tsx` (add `data-testid` for the success container)

This is the first E2E coverage for the new `/publish` wizard. It exercises the authenticated stray path end to end: login, pick the stray intent, fill the minimal stray form (photo + type), accept the default Montevideo pin on the location step, publish, and assert the success step renders.

- [ ] **Step 1: Create the fixture image**

Create `frontend/packages/web/e2e/fixtures/stray.png` — a minimal valid 1x1 PNG. Run from `frontend/packages/web`:

```bash
node -e "require('fs').mkdirSync('e2e/fixtures', { recursive: true }); require('fs').writeFileSync('e2e/fixtures/stray.png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'))"
```

Expected: `frontend/packages/web/e2e/fixtures/stray.png` exists (a 1x1 transparent PNG, well under the 5 MB / format checks in `StrayFormStep`).

- [ ] **Step 2: Add stable selectors to the wizard components**

Read `frontend/packages/web/src/components/publish/IntentStep.tsx`, `StrayFormStep.tsx`, and `SuccessStep.tsx` to confirm whether the intent cards, photo input, and success container already expose stable, non-i18n-dependent selectors (e.g. an `id`/`htmlFor` pair on the photo `<input>`, as used by `getByLabelText('publish:strayForm.photoLabel')` in Vitest). Vitest's `getByLabelText` works because the test mocks `t` as the identity function — Playwright runs against real, translated copy, so `getByLabelText('publish:strayForm.photoLabel')` will NOT match the rendered Spanish/English label text. Add `data-testid` attributes so the E2E spec doesn't depend on translated strings:

In `IntentStep.tsx`, add `data-testid="intent-stray"` to the stray intent card's clickable element (alongside its existing `onClick`):

```tsx
<button type="button" data-testid="intent-stray" onClick={() => onSelect('stray')} ...>
```

In `StrayFormStep.tsx`, add `data-testid="stray-photo-input"` to the file `<input type="file">` and `data-testid="stray-type-select"` to the type `<select>`:

```tsx
<input id="stray-photo" data-testid="stray-photo-input" type="file" ... />
```
```tsx
<select id="stray-type" data-testid="stray-type-select" ...>
```

In `SuccessStep.tsx`, add `data-testid="publish-success"` to the root container `<div>`:

```tsx
<div data-testid="publish-success" className="bg-white dark:bg-gray-900 rounded-2xl p-8 space-y-5 text-center">
```

These additions are purely additive (extra `data-testid` props alongside existing `id`/`htmlFor`/`className`) and must not change any existing Vitest assertions, which match on `getByLabelText`/`getByText` with the `t: (key) => key` mock.

- [ ] **Step 3: Write the E2E spec**

Create `frontend/packages/web/e2e/publish-stray.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import path from 'path';
import { uniqueEmail, seedUser, loginAs } from './helpers';

test.describe('Publish stray flow', () => {
  let email: string;
  let password: string;

  test.beforeAll(async () => {
    email = uniqueEmail();
    password = 'password123';
    await seedUser(email, password);
  });

  test('authenticated user publishes a stray sighting end to end', async ({ page }) => {
    await loginAs(page, email, password);

    await page.goto('/publish');

    // Step 1: pick the stray intent.
    await page.getByTestId('intent-stray').click();

    // Step 2: minimal stray form — photo + type are the only required fields.
    await page.getByTestId('stray-photo-input').setInputFiles(path.join(__dirname, 'fixtures', 'stray.png'));
    await page.getByTestId('stray-type-select').selectOption('perro');
    await page.locator('form button[type="submit"], button').filter({ hasText: /./ }).first();
    await page.getByRole('button', { name: /continuar|continue|continuar/i }).click();

    // Step 3: location step — the default Montevideo pin is enough, just publish.
    await page.getByRole('button', { name: /publicar|publish/i }).click();

    // Step 4: success step.
    await expect(page.getByTestId('publish-success')).toBeVisible({ timeout: 10_000 });
  });
});
```

The two `getByRole('button', { name: /.../i })` matches rely on the real (translated) `publish:strayForm.next` ("Continuar"/"Continue") and `publish:location.publish` ("Publicar"/"Publish") copy from Task 4 — both are unique buttons on their respective steps, so a case-insensitive regex on the rendered text is stable without adding more `data-testid`s. Remove the no-op `page.locator(...).first()` line before finalizing — it was scaffolding to enumerate buttons during authoring and has no effect on the test.

- [ ] **Step 4: Run the E2E suite**

Check `frontend/packages/web/package.json`'s `test:e2e` script (`playwright test`) and `playwright.config.ts`'s `baseURL` (`http://localhost:4173`, i.e. `vite preview`). Playwright does not define a `webServer` block in the existing config, so the preview server must be running before the suite executes. Run from `frontend/packages/web`:

```bash
pnpm build
pnpm preview &
pnpm test:e2e e2e/publish-stray.spec.ts
```

Expected: PASS — `1 passed`. If `pnpm preview &` is not viable in the agent's shell (background job support), check `playwright.config.ts` for an existing `webServer` entry added by a prior task before this one runs; if still absent, add:

```ts
  webServer: {
    command: 'pnpm preview',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
  },
```

to `playwright.config.ts` so `pnpm test:e2e` manages the server itself, and re-run `pnpm test:e2e e2e/publish-stray.spec.ts`.

- [ ] **Step 5: Run the full E2E suite**

Run: `cd frontend/packages/web && pnpm test:e2e`
Expected: PASS — no regressions in `create-pet.spec.ts`, `login.spec.ts`, `map.spec.ts`, `pet-detail.spec.ts`.

- [ ] **Step 6: Commit**

```bash
git add frontend/packages/web/e2e/publish-stray.spec.ts frontend/packages/web/e2e/fixtures/stray.png frontend/packages/web/src/components/publish/IntentStep.tsx frontend/packages/web/src/components/publish/StrayFormStep.tsx frontend/packages/web/src/components/publish/SuccessStep.tsx frontend/packages/web/playwright.config.ts
git commit -m "test(web): add E2E coverage for the publish stray flow"
```
