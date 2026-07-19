# Adoption Detail Redesign (mobile) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give adoption listings their own detail body on mobile — adoption-framed contact + sharing for `adoption`, a "found a home" banner for `adopted` — with none of the lost-pet scaffolding, mirroring the shipped web redesign (PR #97).

**Architecture:** Approach B. `pet/[id].tsx` keeps the shared shell (carousel, header + status badge, details card, description) and branches the body: `adoption`/`adopted` render a new isolated `AdoptionPetBody`; every other status renders the existing inline body, now guarded by `!isAdoptionListing`. Poster/share framing (flyer header + city, native-share title) moves to a small pure helper so it is unit-testable.

**Tech Stack:** React Native + Expo Router, react-i18next, @tanstack/react-query, Jest + @testing-library/react-native. Shared TS in `frontend/packages/shared`, mobile in `frontend/packages/mobile`.

**Branch:** `feat/mobile-adoption-detail-redesign` (already created off `main`, holds the design spec).

**Spec:** `docs/superpowers/specs/2026-07-18-adoption-detail-redesign-mobile-design.md`

**Test commands** (all from `frontend/packages/mobile`):
- Full suite: `pnpm test:run` (jest, single run — **never** `pnpm test`, which is watch mode).
- A single file: `pnpm test:run <path>` (e.g. `pnpm test:run components/AdoptionPetBody.test.tsx`).
- Typecheck: `npx tsc --noEmit`.

---

## File Structure

- `frontend/packages/mobile/i18n/locales/{es,en,pt}.json` — **modify**: add `adoption.detail` keys (adopted banner).
- `frontend/packages/mobile/constants/index.ts` — **modify**: add `COLORS.adoption` / `COLORS.adopted`.
- `frontend/packages/mobile/utils/adoptionFraming.ts` — **create**: pure `posterFraming` + `shareStatusLabel` (Spanish poster/share strings).
- `frontend/packages/mobile/__tests__/adoptionFraming.test.ts` — **create**: unit tests for the pure helpers. (Jest `testMatch` is `**/__tests__/**/*.test.(ts|tsx|js)` — tests MUST live in `__tests__/`, not colocated.)
- `frontend/packages/mobile/components/AdoptionPetBody.tsx` — **create**: isolated adoption body (contact + share for `adoption`; success banner for `adopted`).
- `frontend/packages/mobile/__tests__/AdoptionPetBody.test.tsx` — **create**: RTL-native tests (in `__tests__/`, per jest `testMatch`).
- `frontend/packages/mobile/app/pet/[id].tsx` — **modify**: derive `isAdoptionListing`, branch the body, add badge colours + adoption city row.
- `frontend/packages/mobile/__tests__/pet-detail.test.tsx` — **modify**: add an adoption routing case.
- `frontend/packages/mobile/components/PdfFlyerButton.tsx` — **modify**: use `posterFraming` + add the adoption city row.
- `frontend/packages/mobile/components/ShareButton.tsx` — **modify**: adoption-aware native-share title.

---

## Task 1: Adoption `detail` i18n keys + badge colours

**Files:**
- Modify: `frontend/packages/mobile/i18n/locales/es.json`, `en.json`, `pt.json`
- Modify: `frontend/packages/mobile/constants/index.ts`

- [ ] **Step 1: Add the `detail` block to the mobile `adoption` namespace (es)**

In `frontend/packages/mobile/i18n/locales/es.json`, inside the `"adoption"` object (which currently has `section`, `publish`, `profile`), add a `"detail"` key:

```json
    "detail": {
      "adoptedTitle": "¡{{name}} encontró un hogar! 🎉",
      "adoptedSubtitle": "Gracias a la comunidad por difundir."
    }
```

- [ ] **Step 2: Add the same block (en)**

In `en.json`, inside `"adoption"`:

```json
    "detail": {
      "adoptedTitle": "{{name}} found a home! 🎉",
      "adoptedSubtitle": "Thanks to the community for spreading the word."
    }
```

- [ ] **Step 3: Add the same block (pt)**

In `pt.json`, inside `"adoption"`:

```json
    "detail": {
      "adoptedTitle": "{{name}} encontrou um lar! 🎉",
      "adoptedSubtitle": "Obrigado à comunidade por divulgar."
    }
```

- [ ] **Step 4: Verify JSON is valid**

Run (from `frontend/packages/mobile/i18n/locales`):
`node -e "['es','en','pt'].forEach(f=>{const j=JSON.parse(require('fs').readFileSync(f+'.json','utf8'));if(!j.adoption.detail.adoptedTitle)throw new Error(f+' missing');console.log(f,'OK')})"`
Expected: `es OK`, `en OK`, `pt OK`.

- [ ] **Step 5: Add adoption/adopted colours to `COLORS`**

In `frontend/packages/mobile/constants/index.ts`, in the `COLORS` object, right after the `sighting: '#F59E0B',` line, add (mirrors web `statusBadge.ts` — `adoption` = purple-700, `adopted` = teal-700):

```ts
  adoption: '#7E22CE',
  adopted: '#0F766E',
```

- [ ] **Step 6: Commit**

```bash
git add frontend/packages/mobile/i18n/locales/es.json frontend/packages/mobile/i18n/locales/en.json frontend/packages/mobile/i18n/locales/pt.json frontend/packages/mobile/constants/index.ts
git commit -m "feat(mobile): adoption detail i18n keys + badge colours"
```

---

## Task 2: Pure poster/share framing helper

**Files:**
- Create: `frontend/packages/mobile/utils/adoptionFraming.ts`
- Test: `frontend/packages/mobile/utils/adoptionFraming.test.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/packages/mobile/utils/adoptionFraming.test.ts`:

```ts
import { posterFraming, shareStatusLabel } from './adoptionFraming';

describe('posterFraming', () => {
  it('frames adoption as purple ¡EN ADOPCIÓN!', () => {
    expect(posterFraming('adoption')).toEqual({ color: '#7c3aed', header: '¡EN ADOPCIÓN!' });
  });

  it('keeps the found header', () => {
    expect(posterFraming('found')).toEqual({ color: '#22c55e', header: '¡MASCOTA ENCONTRADA!' });
  });

  it('defaults to the lost header', () => {
    expect(posterFraming('lost')).toEqual({ color: '#ef4444', header: '¡MASCOTA PERDIDA!' });
  });
});

describe('shareStatusLabel', () => {
  it('labels adoption as EN ADOPCIÓN, never PERDIDA', () => {
    expect(shareStatusLabel('adoption')).toBe('EN ADOPCIÓN');
    expect(shareStatusLabel('adoption')).not.toBe('PERDIDA');
  });

  it('labels found as ENCONTRADA and everything else as PERDIDA', () => {
    expect(shareStatusLabel('found')).toBe('ENCONTRADA');
    expect(shareStatusLabel('lost')).toBe('PERDIDA');
    expect(shareStatusLabel('sighting')).toBe('PERDIDA');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `frontend/packages/mobile`): `pnpm test:run utils/adoptionFraming.test.ts`
Expected: FAIL — module `./adoptionFraming` does not exist.

- [ ] **Step 3: Write the helper**

Create `frontend/packages/mobile/utils/adoptionFraming.ts`:

```ts
// ============================================================
// SearchPet — adoption poster / share framing (mobile)
// Spanish-only strings by project decision (shareable posters + flyers stay ES).
// Pure, so the PdfFlyerButton HTML and ShareButton title framing are unit-testable
// without rendering a WebView / native share sheet.
// ============================================================

export interface PosterFraming {
  color: string;
  header: string;
}

// Header + accent colour for the PDF flyer / poster banner.
export function posterFraming(status: string): PosterFraming {
  if (status === 'adoption') return { color: '#7c3aed', header: '¡EN ADOPCIÓN!' };
  if (status === 'found') return { color: '#22c55e', header: '¡MASCOTA ENCONTRADA!' };
  return { color: '#ef4444', header: '¡MASCOTA PERDIDA!' };
}

// Short label for the native-share sheet title (no "MASCOTA" prefix).
export function shareStatusLabel(status: string): string {
  if (status === 'adoption') return 'EN ADOPCIÓN';
  if (status === 'found') return 'ENCONTRADA';
  return 'PERDIDA';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run (from `frontend/packages/mobile`): `pnpm test:run utils/adoptionFraming.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/packages/mobile/utils/adoptionFraming.ts frontend/packages/mobile/utils/adoptionFraming.test.ts
git commit -m "feat(mobile): pure adoption poster/share framing helper"
```

---

## Task 3: `AdoptionPetBody` component

**Files:**
- Create: `frontend/packages/mobile/components/AdoptionPetBody.tsx`
- Test: `frontend/packages/mobile/components/AdoptionPetBody.test.tsx`

Context: mobile i18n merges the shared `pets` namespace with mobile-only namespaces (see `i18n/index.ts`). So `pets:detail.sendMessage`, `pets:detail.loginToContact`, and `pet_detail:ownerContact` / `pet_detail:contact` all already resolve. In jest, i18next has no resources loaded, so `t('key')` returns the raw key — tests assert on `testID`s and raw key strings (matching the existing `pet-detail.test.tsx` style).

- [ ] **Step 1: Write the failing test**

Create `frontend/packages/mobile/components/AdoptionPetBody.test.tsx`:

```tsx
import React from 'react';
import { render } from '@testing-library/react-native';
import type { Pet } from '@shared/types';
import { AdoptionPetBody } from './AdoptionPetBody';

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn(), navigate: jest.fn() }),
}));

const authState = { user: null as null | { id: string }, isAuthenticated: false };
jest.mock('../store', () => ({
  useAuthStore: (selector?: (s: unknown) => unknown) =>
    typeof selector === 'function' ? selector(authState) : authState,
}));

jest.mock('@shared/utils/whatsappTemplates', () => ({
  buildWhatsAppContactURL: () => 'https://wa.me/',
}));

jest.mock('./ShareButton', () => ({ ShareButton: () => null }));
jest.mock('./PdfFlyerButton', () => ({ PdfFlyerButton: () => null }));

const adoptionPet: Pet = {
  id: 'pet-2',
  owner_id: 'owner-1',
  name: 'Michi',
  type: 'gato',
  color: 'gris',
  status: 'adoption',
  city: 'Montevideo',
  photos: [],
  owner: { id: 'owner-1', name: 'Ana' },
  created_at: new Date().toISOString(),
} as Pet;

beforeEach(() => {
  authState.user = null;
  authState.isAuthenticated = false;
});

describe('AdoptionPetBody', () => {
  it('adopted: shows the success banner and no contact/share', () => {
    const { queryByTestId } = render(<AdoptionPetBody pet={{ ...adoptionPet, status: 'adopted' }} />);
    expect(queryByTestId('adopted-banner')).toBeTruthy();
    expect(queryByTestId('share-block')).toBeNull();
    expect(queryByTestId('message-owner')).toBeNull();
  });

  it('adoption + authed non-owner: shows the message action and share block', () => {
    authState.user = { id: 'other-user' };
    authState.isAuthenticated = true;
    const { queryByTestId } = render(<AdoptionPetBody pet={adoptionPet} />);
    expect(queryByTestId('message-owner')).toBeTruthy();
    expect(queryByTestId('share-block')).toBeTruthy();
  });

  it('adoption + owner viewing own listing: hides the message action', () => {
    authState.user = { id: 'owner-1' };
    authState.isAuthenticated = true;
    const { queryByTestId } = render(<AdoptionPetBody pet={adoptionPet} />);
    expect(queryByTestId('message-owner')).toBeNull();
  });

  it('adoption + logged out: shows the login gate and no share block', () => {
    const { queryByTestId } = render(<AdoptionPetBody pet={adoptionPet} />);
    expect(queryByTestId('login-gate')).toBeTruthy();
    expect(queryByTestId('share-block')).toBeNull();
  });

  it('adoption: WhatsApp contact only when a phone exists', () => {
    authState.user = { id: 'other' };
    authState.isAuthenticated = true;
    const noPhone = render(<AdoptionPetBody pet={adoptionPet} />);
    expect(noPhone.queryByTestId('whatsapp-contact')).toBeNull();

    const withPhone = render(
      <AdoptionPetBody pet={{ ...adoptionPet, owner: { id: 'owner-1', name: 'Ana', phone: '+59899' } } as Pet} />,
    );
    expect(withPhone.queryByTestId('whatsapp-contact')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `frontend/packages/mobile`): `pnpm test:run components/AdoptionPetBody.test.tsx`
Expected: FAIL — module `./AdoptionPetBody` does not exist.

- [ ] **Step 3: Write the component**

Create `frontend/packages/mobile/components/AdoptionPetBody.tsx`:

```tsx
// ============================================================
// SearchPet — AdoptionPetBody (mobile)
// The status-specific detail body for adoption listings, rendered by the pet
// detail screen for `adoption` / `adopted` pets. Isolated from the lost-pet body:
// no report timeline, no "mark found". Mirrors the web AdoptionPetBody.
// ============================================================

import { View, Text, TouchableOpacity, Linking, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import type { Pet } from '@shared/types';
import { buildWhatsAppContactURL } from '@shared/utils/whatsappTemplates';
import { useAuthStore } from '../store';
import { ShareButton } from './ShareButton';
import { PdfFlyerButton } from './PdfFlyerButton';
import { COLORS, SPACING, FONTS, RADIUS, SHADOWS } from '../constants';

interface AdoptionPetBodyProps {
  pet: Pet;
}

export function AdoptionPetBody({ pet }: AdoptionPetBodyProps) {
  const { t } = useTranslation(['pets', 'pet_detail', 'adoption', 'common']);
  const { user, isAuthenticated } = useAuthStore();
  const router = useRouter();

  // Resolved: the pet has a home. Celebratory record, no contact/share.
  if (pet.status === 'adopted') {
    return (
      <View testID="adopted-banner" style={styles.adoptedBanner}>
        <Text style={styles.adoptedEmoji}>🎉</Text>
        <Text style={styles.adoptedTitle}>{t('adoption:detail.adoptedTitle', { name: pet.name })}</Text>
        <Text style={styles.adoptedSubtitle}>{t('adoption:detail.adoptedSubtitle')}</Text>
      </View>
    );
  }

  const isOwnerViewing = isAuthenticated && user?.id === pet.owner_id;

  return (
    <View>
      {pet.owner && (
        <View style={styles.ownerCard}>
          <Text style={styles.sectionTitle}>{t('pet_detail:ownerContact')}</Text>
          <View style={styles.ownerInfo}>
            <View style={styles.ownerAvatar}>
              <Text style={{ fontSize: 24 }}>👤</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.ownerName}>{pet.owner.name}</Text>
            </View>
          </View>

          {pet.owner.phone && (
            <TouchableOpacity
              testID="whatsapp-contact"
              style={styles.contactButton}
              onPress={() => Linking.openURL(buildWhatsAppContactURL(pet.owner!.phone!, pet))}
            >
              <Text style={styles.contactButtonText}>{t('pet_detail:contact')}</Text>
            </TouchableOpacity>
          )}

          {/* In-app message — primary adoption contact channel for non-owner viewers. */}
          {!isOwnerViewing && (
            isAuthenticated ? (
              <TouchableOpacity
                testID="message-owner"
                style={styles.messageButton}
                onPress={() => router.push(`/chat/${pet.owner_id}` as `/${string}`)}
              >
                <Text style={styles.messageButtonText}>💬 {t('pets:detail.sendMessage')}</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                testID="login-gate"
                style={styles.loginButton}
                onPress={() => router.push('/login')}
              >
                <Text style={styles.loginButtonText}>🔒 {t('pets:detail.loginToContact')}</Text>
              </TouchableOpacity>
            )
          )}
        </View>
      )}

      {/* Sharing — spreads the adoption listing. Requires a session (the share-link
          endpoint is auth-gated), mirroring web. */}
      {isAuthenticated && (
        <View testID="share-block">
          <ShareButton petId={pet.id} petName={pet.name} petType={pet.type} status="adoption" pet={pet} />
          <PdfFlyerButton pet={pet} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  adoptedBanner: {
    backgroundColor: '#ecfdf5',
    borderRadius: RADIUS.lg,
    padding: SPACING.lg,
    marginBottom: SPACING.md,
    alignItems: 'center',
    ...SHADOWS.sm,
  },
  adoptedEmoji: { fontSize: 40, marginBottom: SPACING.sm },
  adoptedTitle: { fontSize: FONTS.sizes.md, fontWeight: '800', color: '#065f46', textAlign: 'center' },
  adoptedSubtitle: { fontSize: FONTS.sizes.sm, color: '#047857', textAlign: 'center', marginTop: 4 },
  ownerCard: {
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    ...SHADOWS.sm,
  },
  sectionTitle: { fontSize: FONTS.sizes.md, fontWeight: '700', color: COLORS.textPrimary, marginBottom: SPACING.sm },
  ownerInfo: { flexDirection: 'row', alignItems: 'center', marginBottom: SPACING.md },
  ownerAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: COLORS.background,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: SPACING.md,
  },
  ownerName: { fontSize: FONTS.sizes.md, fontWeight: '600', color: COLORS.textPrimary },
  contactButton: {
    backgroundColor: COLORS.whatsapp,
    paddingVertical: 14,
    borderRadius: RADIUS.md,
    alignItems: 'center',
  },
  contactButtonText: { color: COLORS.white, fontSize: FONTS.sizes.md, fontWeight: '700' },
  messageButton: {
    backgroundColor: COLORS.primary,
    paddingVertical: 14,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    marginTop: SPACING.sm,
  },
  messageButtonText: { color: COLORS.white, fontSize: FONTS.sizes.md, fontWeight: '700' },
  loginButton: {
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingVertical: 14,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    marginTop: SPACING.sm,
  },
  loginButtonText: { color: COLORS.textSecondary, fontSize: FONTS.sizes.md, fontWeight: '600' },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run (from `frontend/packages/mobile`): `pnpm test:run components/AdoptionPetBody.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/packages/mobile/components/AdoptionPetBody.tsx frontend/packages/mobile/components/AdoptionPetBody.test.tsx
git commit -m "feat(mobile): AdoptionPetBody — adoption-specific pet detail body"
```

---

## Task 4: Branch the body in `pet/[id].tsx`

**Files:**
- Modify: `frontend/packages/mobile/app/pet/[id].tsx`
- Modify: `frontend/packages/mobile/__tests__/pet-detail.test.tsx`

- [ ] **Step 1: Import the component**

In `frontend/packages/mobile/app/pet/[id].tsx`, add after `import { TimelineMap } from '../../components/TimelineMap';`:

```tsx
import { AdoptionPetBody } from '../../components/AdoptionPetBody';
```

- [ ] **Step 2: Derive `isAdoptionListing`**

Right after the `canManage` line (`const canManage = isAuthenticated && (user?.id === pet.owner_id || user?.id === pet.reporter_id);`), add:

```tsx
  const isAdoptionListing = pet.status === 'adoption' || pet.status === 'adopted';
```

- [ ] **Step 3: Add adoption/adopted badge colours**

In the status badge `backgroundColor` ternary, insert the two new cases just before the `pet.status === 'archived'` line:

```tsx
              backgroundColor:
                pet.status === 'found'      ? COLORS.found :
                pet.status === 'adopted'    ? COLORS.adopted :
                pet.status === 'adoption'   ? COLORS.adoption :
                pet.status === 'archived'   ? COLORS.textMuted :
                pet.status === 'registered' ? COLORS.textSecondary :
                pet.status === 'stray'      ? COLORS.warning :
                COLORS.lost,
```

- [ ] **Step 4: Add the adoption city row to the details card**

In the details card, right after the `pet.color` `<View style={styles.detailRow}>…</View>` block and before the `latestReport?.location_description` block, add:

```tsx
          {pet.status === 'adoption' && pet.city && (
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>{t('adoption:publish.cityLabel')}</Text>
              <Text style={styles.detailValue}>{pet.city}</Text>
            </View>
          )}
```

Note: the screen's `useTranslation` array must include `adoption`. Change line 37 from
`useTranslation(['pet_detail', 'common', 'pets', 'story', 'map'])` to
`useTranslation(['pet_detail', 'common', 'pets', 'story', 'map', 'adoption'])`.

- [ ] **Step 5: Open the adoption branch before the body**

Immediately BEFORE the "Marcar como encontrada" block (the comment `{/* Botón Marcar como encontrada …`), insert:

```tsx
        {isAdoptionListing && <AdoptionPetBody pet={pet} />}
        {!isAdoptionListing && (
          <>
```

- [ ] **Step 6: Close the branch after the timeline**

After the report-timeline block (the `{reports && reports.length > 0 && ( … )}` block that ends just before `<View style={{ height: 80 }} />`), insert the closing before that spacer View:

```tsx
          </>
        )}
```

So the structure becomes: `…timeline block…` → `</>` `)}` → `<View style={{ height: 80 }} />`.

- [ ] **Step 7: Add the adoption routing test**

In `frontend/packages/mobile/__tests__/pet-detail.test.tsx`, add inside the `describe('PetDetailScreen', …)` block, after the existing `it` cases:

```tsx
  it('routes adoption pets to the adoption body (no lost scaffolding)', () => {
    mockUsePetByID.mockReturnValue({
      data: { ...mockPetBase, status: 'adoption', city: 'Montevideo', owner: { id: 'owner-1', name: 'Ana' } },
      isLoading: false,
    });
    const { queryByTestId, queryByText } = render(<PetDetailScreen />);
    // logged-out adoption viewer → login gate, no mark-found scaffolding
    expect(queryByTestId('login-gate')).toBeTruthy();
    expect(queryByText(/pet_detail:markAsFound/)).toBeNull();
  });
```

Note: the existing top-of-file mocks (`../store` with `isAuthenticated: false`, `../components/ShareButton`, `../components/PdfFlyerButton`, `@shared/utils/whatsappTemplates`) already cover `AdoptionPetBody`'s dependencies, so no new mock is needed.

- [ ] **Step 8: Typecheck and run the screen tests**

Run (from `frontend/packages/mobile`):
`npx tsc --noEmit` → Expected: 0 errors.
`pnpm test:run __tests__/pet-detail.test.tsx components/AdoptionPetBody.test.tsx` → Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add frontend/packages/mobile/app/pet/[id].tsx frontend/packages/mobile/__tests__/pet-detail.test.tsx
git commit -m "feat(mobile): route adoption listings to AdoptionPetBody in pet detail"
```

---

## Task 5: Adoption-aware PDF flyer (header + city)

**Files:**
- Modify: `frontend/packages/mobile/components/PdfFlyerButton.tsx`

- [ ] **Step 1: Import the helper**

In `frontend/packages/mobile/components/PdfFlyerButton.tsx`, add after the `import type { Pet, Report } …` line:

```tsx
import { posterFraming } from '../utils/adoptionFraming';
```

- [ ] **Step 2: Use the helper for the poster header**

Replace these two lines (currently ~63–64):

```tsx
      const statusColor = pet.status === 'found' ? '#22c55e' : '#ef4444';
      const statusText = pet.status === 'found' ? '¡MASCOTA ENCONTRADA!' : '¡MASCOTA PERDIDA!';
```

with:

```tsx
      const { color: statusColor, header: statusText } = posterFraming(pet.status);
```

- [ ] **Step 3: Add the adoption city row**

In the `detailRows` array, add a row for adoption listings. Insert right after the `pet.color …` line and before the `lastSeenDate …` line:

```tsx
        pet.status === 'adoption' && pet.city ? `<tr><td class="lbl">Zona:</td><td class="val">${pet.city}</td></tr>` : '',
```

- [ ] **Step 4: Typecheck**

Run (from `frontend/packages/mobile`): `npx tsc --noEmit`
Expected: 0 errors. (The `posterFraming` unit tests from Task 2 already cover the header/colour mapping; the flyer HTML itself is generated inside a WebView call and is not rendered in jest.)

- [ ] **Step 5: Commit**

```bash
git add frontend/packages/mobile/components/PdfFlyerButton.tsx
git commit -m "feat(mobile): adoption-framed PDF flyer (header + city)"
```

---

## Task 6: Adoption-aware native-share title

**Files:**
- Modify: `frontend/packages/mobile/components/ShareButton.tsx`

- [ ] **Step 1: Import the helper**

In `frontend/packages/mobile/components/ShareButton.tsx`, add after the `import { getExpiryInfo } …` line:

```tsx
import { shareStatusLabel } from '../utils/adoptionFraming';
```

- [ ] **Step 2: Widen the `status` prop and derive the title**

In the `ShareButtonProps` interface, widen the `status` type to allow adoption:

```tsx
  status: 'lost' | 'found' | 'sighting' | 'adoption';
```

Then replace the `statusText` line (currently ~45):

```tsx
  const statusText = status === 'found' ? 'ENCONTRADA' : 'PERDIDA';
```

with (prefer the full pet's status when available so an adoption listing never shows "PERDIDA"):

```tsx
  const statusText = shareStatusLabel(pet?.status ?? status);
```

- [ ] **Step 3: Typecheck**

Run (from `frontend/packages/mobile`): `npx tsc --noEmit`
Expected: 0 errors. (`shareStatusLabel` is unit-tested in Task 2; the WhatsApp message body was already adoption-framed via the shared `buildWhatsAppMessage`.)

- [ ] **Step 4: Commit**

```bash
git add frontend/packages/mobile/components/ShareButton.tsx
git commit -m "feat(mobile): adoption-aware native-share title"
```

---

## Task 7: Full suite + typecheck gate, push, PR

- [ ] **Step 1: Typecheck**

Run (from `frontend/packages/mobile`): `npx tsc --noEmit` → Expected: 0 errors.

- [ ] **Step 2: Full mobile suite**

Run (from `frontend/packages/mobile`): `pnpm test:run` → Expected: all suites green, including the new `adoptionFraming`, `AdoptionPetBody`, and the extended `pet-detail` tests. (Use `pnpm test:run`, never `pnpm test` — watch mode never exits.)

- [ ] **Step 3: Push branch and open PR** (per the `searchpet-pr` skill)

The user controls merge. Open the PR against `main`, note `pnpm test:run` (mobile) ran, and that it does not touch sensitive surfaces (auth/JWT/websocket). Note this closes the mobile side of the adoption feature (web shipped in PR #97).

---

## Self-Review

**Spec coverage:**
- Adoption detail body (adoption + adopted) → Task 3 + Task 4. ✅
- `adopted` "found a home" state, no contact/share → Task 3 (adopted branch) + Task 1 (copy). ✅
- No lost-pet scaffolding for adoption (timeline / mark-found hidden) → Task 4 wraps the inline body in `!isAdoptionListing`. ✅
- Share restored only for `adoption`, session-gated → Task 3 (share block gated to `isAuthenticated`, only in the `adoption` branch; `adopted` returns early with no share). ✅
- Contact: in-app chat + phone → Task 3. ✅
- Adoption-framed share message → free via shared `buildWhatsAppMessage` (already in main); native-share title → Task 6. ✅
- Adoption flyer (header + city) → Task 5. ✅
- Badge colours (adoption purple / adopted teal) → Task 1 (colours) + Task 4 (switch). ✅
- i18n es/en/pt parity for the adopted banner → Task 1; contact copy reuses existing `pets:detail.*` / `pet_detail:*`. ✅
- Lost/stray/found detail unchanged → Task 4 wraps the existing body untouched. ✅

**Placeholder scan:** No TBD/TODO. Every code step shows full code. Task 4's JSX wrap boundaries are named by their surrounding comments/anchors in the existing file.

**Type consistency:** `posterFraming` / `shareStatusLabel` signatures (Task 2) match their call sites (Tasks 5, 6). `isAdoptionListing` is the same name used in the web mirror. `AdoptionPetBody` prop `{ pet: Pet }` (Task 3) matches its usage in Task 4. `ShareButton` `status` prop widened to include `'adoption'` (Task 6) matches the `status="adoption"` passed in Task 3. `COLORS.adoption` / `COLORS.adopted` (Task 1) match the badge switch (Task 4).
