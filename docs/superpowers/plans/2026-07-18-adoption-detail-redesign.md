# Adoption Detail Redesign (web) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give adoption listings their own detail body on web — adoption-framed contact and sharing when available, a "found a home" state once adopted — with none of the lost-pet scaffolding.

**Architecture:** Approach B. `PetDetailPage` keeps the shared shell (gallery, header, attributes, description) and branches the body: `adoption`/`adopted` render a new isolated `AdoptionPetBody`; every other status renders the existing inline body, now guarded by `!isAdoptionListing`. Sharing is made status-aware in the shared `buildWhatsAppMessage` and the two web poster templates.

**Tech Stack:** React + Vite + Tailwind, react-i18next, @tanstack/react-query, Vitest + React Testing Library. Shared TS in `frontend/packages/shared`, web in `frontend/packages/web`.

**Branch:** `feat/web-adoption-detail-redesign` (already created off `main`, holds the design spec).

**Spec:** `docs/superpowers/specs/2026-07-18-adoption-detail-redesign-design.md`

**Test commands:**
- Shared/web: from `frontend/packages/web` run `pnpm test:run` (chains web + shared via `vitest.shared.config.ts`).
- A single shared test file: from `frontend/packages/web` run `pnpm vitest run --config vitest.shared.config.ts <path>`.
- A single web test file: from `frontend/packages/web` run `pnpm vitest run <path>`.
- Typecheck: from `frontend/packages/web` run `npx tsc --noEmit`.

---

## File Structure

- `frontend/packages/shared/utils/whatsappTemplates.ts` — **modify**: `buildWhatsAppMessage` gains an `adoption` case + optional `city`.
- `frontend/packages/shared/utils/whatsappTemplates.test.ts` — **create**: unit tests for the pure function.
- `frontend/packages/web/src/i18n/locales/{es,en,pt}.json` — **modify**: add `adoption.detail` keys (adopted banner).
- `frontend/packages/web/src/components/AdoptionPetBody.tsx` — **create**: the isolated adoption body (contact + share for `adoption`; success banner for `adopted`).
- `frontend/packages/web/src/components/AdoptionPetBody.test.tsx` — **create**: RTL tests.
- `frontend/packages/web/src/pages/PetDetailPage.tsx` — **modify**: branch the body to `AdoptionPetBody` when `isAdoptionListing`.
- `frontend/packages/web/src/components/PdfFlyerButton.tsx` — **modify**: adoption-aware poster header + city row.
- `frontend/packages/web/src/components/SharePanel.tsx` — **modify**: adoption-aware poster header.

---

## Task 1: Adoption case in `buildWhatsAppMessage` (shared)

**Files:**
- Modify: `frontend/packages/shared/utils/whatsappTemplates.ts`
- Test: `frontend/packages/shared/utils/whatsappTemplates.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `frontend/packages/shared/utils/whatsappTemplates.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildWhatsAppMessage } from './whatsappTemplates';

describe('buildWhatsAppMessage', () => {
  it('frames a lost pet as PERDIDA', () => {
    const msg = buildWhatsAppMessage({ name: 'Firu', type: 'perro', status: 'lost' });
    expect(msg).toContain('¡MASCOTA PERDIDA!');
    expect(msg).toContain('Nombre: Firu');
  });

  it('frames a found pet as ENCONTRADA', () => {
    const msg = buildWhatsAppMessage({ name: 'Firu', type: 'perro', status: 'found' });
    expect(msg).toContain('¡MASCOTA ENCONTRADA!');
  });

  it('frames an adoption pet as EN ADOPCIÓN and never as PERDIDA', () => {
    const msg = buildWhatsAppMessage(
      { name: 'Michi', type: 'gato', status: 'adoption', city: 'Montevideo' },
      'https://searchpet.app/pet/tok',
    );
    expect(msg).toContain('¡EN ADOPCIÓN!');
    expect(msg).toContain('busca un hogar');
    expect(msg).toContain('📍 Montevideo');
    expect(msg).toContain('https://searchpet.app/pet/tok');
    expect(msg).not.toContain('PERDIDA');
  });

  it('omits the city line when no city is given for adoption', () => {
    const msg = buildWhatsAppMessage({ name: 'Michi', type: 'gato', status: 'adoption' });
    expect(msg).toContain('¡EN ADOPCIÓN!');
    expect(msg).not.toContain('📍');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `frontend/packages/web`): `pnpm vitest run --config vitest.shared.config.ts ../shared/utils/whatsappTemplates.test.ts`
Expected: FAIL — the adoption assertions fail (`¡EN ADOPCIÓN!` not present; message says `PERDIDA`).

- [ ] **Step 3: Write minimal implementation**

In `frontend/packages/shared/utils/whatsappTemplates.ts`, add `city` to the input type and an adoption branch. Replace the `PetForMessage` interface and the top of `buildWhatsAppMessage`:

```ts
interface PetForMessage {
  name: string;
  type: string;
  breed?: string;
  color?: string;
  description?: string;
  status: PetStatus;
  city?: string;
}
```

Then, inside `buildWhatsAppMessage`, replace the header/footer setup (the current lines from `const statusText = ...` through `const footer = ...`) with:

```ts
  const isAdoption = pet.status === 'adoption';

  const header = isAdoption
    ? '🏠 ¡EN ADOPCIÓN! 🏠'
    : `🚨 ¡MASCOTA ${pet.status === 'found' ? 'ENCONTRADA' : 'PERDIDA'}! 🚨`;
  const nameLine = isAdoption ? `${pet.name} busca un hogar` : `Nombre: ${pet.name}`;
  const typeLine = `Tipo: ${pet.type}`;
  const breedLine = pet.breed ? `Raza: ${pet.breed}` : '';
  const colorLine = pet.color ? `Color: ${pet.color}` : '';
  const cityLine = isAdoption && pet.city ? `📍 ${pet.city}` : '';
  const urlLine = shareUrl ? `Ver más: ${shareUrl}` : '';
  const footer = isAdoption
    ? 'Compartí para ayudarlo a encontrar un hogar. 🙏'
    : 'Por favor, compartí si podés. 🙏';
```

Then add `cityLine` into BOTH `fixedParts` and `allParts` arrays, right after `colorLine`:

```ts
  const fixedParts = [header, nameLine, typeLine, breedLine, colorLine, cityLine, urlLine, footer]
    .filter(Boolean)
    .join('\n');
```

```ts
  const allParts = [header, nameLine, typeLine, breedLine, colorLine, cityLine, description, urlLine, footer]
    .filter(Boolean)
    .join('\n');
```

- [ ] **Step 4: Run test to verify it passes**

Run (from `frontend/packages/web`): `pnpm vitest run --config vitest.shared.config.ts ../shared/utils/whatsappTemplates.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/packages/shared/utils/whatsappTemplates.ts frontend/packages/shared/utils/whatsappTemplates.test.ts
git commit -m "feat(shared): adoption-framed WhatsApp share message"
```

---

## Task 2: Adoption "adopted" i18n keys (web)

**Files:**
- Modify: `frontend/packages/web/src/i18n/locales/es.json`, `en.json`, `pt.json`

- [ ] **Step 1: Add the `detail` block to the `adoption` namespace (es)**

In `frontend/packages/web/src/i18n/locales/es.json`, inside the `"adoption"` object (which currently has `section`, `publish`, `profile`), add a `"detail"` key:

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

Run (from `frontend/packages/web/src/i18n/locales`):
`node -e "['es','en','pt'].forEach(f=>{JSON.parse(require('fs').readFileSync(f+'.json','utf8'));console.log(f,'OK')})"`
Expected: `es OK`, `en OK`, `pt OK`.

- [ ] **Step 5: Commit**

```bash
git add frontend/packages/web/src/i18n/locales/es.json frontend/packages/web/src/i18n/locales/en.json frontend/packages/web/src/i18n/locales/pt.json
git commit -m "feat(web): add adoption:detail i18n keys (es/en/pt)"
```

---

## Task 3: `AdoptionPetBody` component (web)

**Files:**
- Create: `frontend/packages/web/src/components/AdoptionPetBody.tsx`
- Test: `frontend/packages/web/src/components/AdoptionPetBody.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/packages/web/src/components/AdoptionPetBody.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { Pet } from '@shared/types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => (opts?.name ? `${key}:${opts.name}` : key),
    i18n: { language: 'es' },
  }),
}));

const authState = { user: undefined as undefined | { id: string }, isAuthenticated: false };
vi.mock('../context/AuthContext', () => ({ useAuth: () => authState }));

// Stub the heavy children so we test AdoptionPetBody's own logic in isolation.
vi.mock('./SharePanel', () => ({ SharePanel: () => <div data-testid="share-panel" /> }));
vi.mock('./PdfFlyerButton', () => ({ PdfFlyerButton: () => <div data-testid="flyer" /> }));
vi.mock('./RevealContact', () => ({ RevealContact: () => <div data-testid="reveal-contact" /> }));

import { AdoptionPetBody } from './AdoptionPetBody';

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
};

const renderBody = (pet: Pet) =>
  render(<MemoryRouter><AdoptionPetBody pet={pet} /></MemoryRouter>);

beforeEach(() => {
  authState.user = undefined;
  authState.isAuthenticated = false;
});

describe('AdoptionPetBody', () => {
  it('adopted: shows the success banner and NO contact/share', () => {
    renderBody({ ...adoptionPet, status: 'adopted' });
    expect(screen.getByTestId('adopted-banner')).toBeTruthy();
    expect(screen.queryByTestId('share-panel')).toBeNull();
    expect(screen.queryByText(/pets:detail.sendMessage/)).toBeNull();
  });

  it('adoption + authed non-owner: shows message link and share', () => {
    authState.user = { id: 'other-user' };
    authState.isAuthenticated = true;
    renderBody(adoptionPet);
    const link = screen.getByText(/pets:detail.sendMessage/).closest('a');
    expect(link?.getAttribute('href')).toBe('/messages/owner-1');
    expect(screen.getByTestId('share-panel')).toBeTruthy();
  });

  it('adoption + owner viewing own listing: hides the message button', () => {
    authState.user = { id: 'owner-1' };
    authState.isAuthenticated = true;
    renderBody(adoptionPet);
    expect(screen.queryByText(/pets:detail.sendMessage/)).toBeNull();
  });

  it('adoption + logged out: shows login gate and NO share', () => {
    renderBody(adoptionPet);
    expect(screen.getByText(/pets:detail.loginToContact/)).toBeTruthy();
    expect(screen.queryByTestId('share-panel')).toBeNull();
  });

  it('adoption: reveal-contact only when a phone exists', () => {
    authState.isAuthenticated = true;
    authState.user = { id: 'other' };
    const { rerender } = renderBody(adoptionPet);
    expect(screen.queryByTestId('reveal-contact')).toBeNull();
    rerender(
      <MemoryRouter>
        <AdoptionPetBody pet={{ ...adoptionPet, owner: { id: 'owner-1', name: 'Ana', phone: '+59899' } }} />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('reveal-contact')).toBeTruthy();
  });

  it('never renders lost-pet scaffolding', () => {
    authState.isAuthenticated = true;
    authState.user = { id: 'other' };
    renderBody(adoptionPet);
    expect(screen.queryByText(/pets:detail.addReport/)).toBeNull();
    expect(screen.queryByText(/pets:detail.timeline/)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `frontend/packages/web`): `pnpm vitest run src/components/AdoptionPetBody.test.tsx`
Expected: FAIL — module `./AdoptionPetBody` does not exist.

- [ ] **Step 3: Write the component**

Create `frontend/packages/web/src/components/AdoptionPetBody.tsx`:

```tsx
// ============================================================
// SearchPet — AdoptionPetBody (web)
// The status-specific detail body for adoption listings, rendered by
// PetDetailPage for `adoption` / `adopted` pets. Isolated from the
// lost-pet body: no report timeline, no "add report", no "mark found".
// ============================================================

import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { Pet } from '@shared/types';
import { useAuth } from '../context/AuthContext';
import { RevealContact } from './RevealContact';
import { SharePanel } from './SharePanel';
import { PdfFlyerButton } from './PdfFlyerButton';

interface AdoptionPetBodyProps {
  pet: Pet;
}

export function AdoptionPetBody({ pet }: AdoptionPetBodyProps) {
  const { t } = useTranslation(['pets', 'adoption', 'common']);
  const { user, isAuthenticated } = useAuth();

  // Resolved: the pet has a home. Celebratory record, no contact/share.
  if (pet.status === 'adopted') {
    return (
      <div
        data-testid="adopted-banner"
        className="bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-xl p-6 mb-6 text-center"
      >
        <div className="text-4xl mb-2">🎉</div>
        <h3 className="font-bold text-green-800 dark:text-green-200">
          {t('adoption:detail.adoptedTitle', { name: pet.name })}
        </h3>
        <p className="text-sm text-green-700 dark:text-green-300 mt-1">
          {t('adoption:detail.adoptedSubtitle')}
        </p>
      </div>
    );
  }

  // Available for adoption.
  const isOwnerViewing = isAuthenticated && user?.id === pet.owner_id;

  return (
    <>
      {pet.owner && (
        <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-4 mb-6">
          <h3 className="font-bold text-gray-900 dark:text-gray-100 mb-3">{t('pets:detail.owner')}</h3>
          <div className="flex items-center gap-3 mb-1">
            <div className="w-12 h-12 bg-gray-200 dark:bg-gray-700 rounded-full flex items-center justify-center text-xl">👤</div>
            <p className="font-semibold text-gray-900 dark:text-gray-100">{pet.owner.name}</p>
          </div>

          {pet.owner.phone && (
            <RevealContact
              phone={pet.owner.phone}
              pet={pet}
              revealLabel={t('pets:detail.revealPhone')}
              contactLabel={t('pets:detail.contact')}
              callLabel={t('pets:detail.callPhone')}
              copyLabel={t('pets:detail.copyNumber')}
              copiedLabel={t('pets:detail.copied')}
            />
          )}

          {/* In-app message — always available to non-owner viewers as the
              primary adoption contact channel (mirrors the owner contact block
              added in PR #95). */}
          {!isOwnerViewing && (
            isAuthenticated ? (
              <Link
                to={`/messages/${pet.owner_id}`}
                className="mt-3 w-full inline-flex items-center justify-center gap-2 bg-primary hover:bg-primary/90 text-white font-bold py-3 rounded-lg transition-colors"
              >
                💬 {t('pets:detail.sendMessage')}
              </Link>
            ) : (
              <Link
                to="/login"
                className="mt-3 w-full inline-flex items-center justify-center gap-2 border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 font-semibold py-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                🔒 {t('pets:detail.loginToContact')}
              </Link>
            )
          )}
        </div>
      )}

      {/* Sharing — spreads the adoption listing. Requires a session (the share
          link endpoint is auth-gated). Any authed user can share. */}
      {isAuthenticated && (
        <div className="flex flex-wrap gap-3 mb-6">
          <SharePanel petId={pet.id} petName={pet.name} pet={pet} />
          <PdfFlyerButton pet={pet} />
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run (from `frontend/packages/web`): `pnpm vitest run src/components/AdoptionPetBody.test.tsx`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/packages/web/src/components/AdoptionPetBody.tsx frontend/packages/web/src/components/AdoptionPetBody.test.tsx
git commit -m "feat(web): AdoptionPetBody — adoption-specific pet detail body"
```

---

## Task 4: Branch the body in `PetDetailPage`

**Files:**
- Modify: `frontend/packages/web/src/pages/PetDetailPage.tsx`

Context: `PetDetailPage` already derives `isAdoptionListing` (from PR #94). The "body" of the detail card is everything below the description: the action-buttons `div` (share/report/mark-found/flyer), the owner contact block, the reporter contact block, the abuse-report block, and the report timeline (`TimelineMap`). We wrap that entire body in `!isAdoptionListing` and render `AdoptionPetBody` for adoption pets.

- [ ] **Step 1: Import the new component**

Add near the other component imports (after `import { TimelineMap } from '../components/TimelineMap';`):

```tsx
import { AdoptionPetBody } from '../components/AdoptionPetBody';
```

- [ ] **Step 2: Open the adoption branch before the body**

Immediately BEFORE the action-buttons block (the line `{/* Action buttons.` … the `<div className="flex flex-wrap gap-3 mb-6">` that contains `SharePanel`), insert:

```tsx
            {isAdoptionListing && <AdoptionPetBody pet={pet} />}
            {!isAdoptionListing && (
              <>
```

- [ ] **Step 3: Close the branch after the body**

After the LAST body element inside the detail card (the report timeline / `TimelineMap` block and the abuse-report block — i.e. the last child before the card's closing `</div>` that wraps the info section), insert the closing:

```tsx
              </>
            )}
```

Note: the existing PR #94 guards inside the lost body (`shareAvailable`, the `isAdoptionListing` check on the add-report button) are now dead for adoption pets (they never render) but remain harmless. Leave them — do not refactor the lost body in this task.

- [ ] **Step 4: Typecheck and run the page's tests**

Run (from `frontend/packages/web`):
`npx tsc --noEmit` → Expected: 0 errors.
`pnpm vitest run src/pages/PetDetailPage.test.tsx` (if present) and `pnpm vitest run src/components/AdoptionPetBody.test.tsx` → Expected: PASS.

- [ ] **Step 5: Manual verification note**

With the local stack running (backend `:8081`, web `:3000`), open an `adoption` pet detail → adoption body (message + share, no report UI); open an `adopted` pet → success banner; open a `lost` pet → unchanged body.

- [ ] **Step 6: Commit**

```bash
git add frontend/packages/web/src/pages/PetDetailPage.tsx
git commit -m "feat(web): route adoption listings to AdoptionPetBody in pet detail"
```

---

## Task 5: Adoption-aware PDF flyer header + city row

**Files:**
- Modify: `frontend/packages/web/src/components/PdfFlyerButton.tsx`
- Test: `frontend/packages/web/src/components/PdfFlyerButton.test.tsx`

- [ ] **Step 1: Write the failing test**

Create (or extend) `frontend/packages/web/src/components/PdfFlyerButton.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { Pet } from '@shared/types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'es' } }),
}));
vi.mock('@shared/hooks', () => ({ useShareLink: () => ({ mutateAsync: vi.fn(), isPending: false }) }));

import { PdfFlyerButton } from './PdfFlyerButton';

const base: Pet = {
  id: 'p1', name: 'Michi', type: 'gato', color: 'gris', status: 'adoption',
  city: 'Montevideo', photos: [], created_at: '',
};

describe('PdfFlyerButton — adoption framing', () => {
  it('renders EN ADOPCIÓN header and the city row for adoption pets', () => {
    const { container } = render(<PdfFlyerButton pet={base} />);
    expect(container.textContent).toContain('¡EN ADOPCIÓN!');
    expect(container.textContent).toContain('Montevideo');
    expect(container.textContent).not.toContain('¡MASCOTA PERDIDA!');
  });

  it('keeps the lost header for lost pets', () => {
    const { container } = render(<PdfFlyerButton pet={{ ...base, status: 'lost', city: undefined }} />);
    expect(container.textContent).toContain('¡MASCOTA PERDIDA!');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `frontend/packages/web`): `pnpm vitest run src/components/PdfFlyerButton.test.tsx`
Expected: FAIL — header shows `¡MASCOTA PERDIDA!` for the adoption pet; no `Montevideo`.

- [ ] **Step 3: Implement**

In `PdfFlyerButton.tsx`, add derived constants at the top of the component body (right after `const primaryPhoto = ...`):

```tsx
  const isAdoption = pet.status === 'adoption';
  const posterColor = isAdoption ? '#7c3aed' : pet.status === 'found' ? '#22c55e' : '#ef4444';
  const posterHeader = isAdoption
    ? '¡EN ADOPCIÓN!'
    : pet.status === 'found' ? '¡MASCOTA ENCONTRADA!' : '¡MASCOTA PERDIDA!';
```

Replace the header `backgroundColor: pet.status === 'found' ? '#22c55e' : '#ef4444',` with `backgroundColor: posterColor,` and replace the header text expression `{pet.status === 'found' ? '¡MASCOTA ENCONTRADA!' : '¡MASCOTA PERDIDA!'}` with `{posterHeader}`.

Then add a city row to the details table — right after the `pet.color` `<tr>`:

```tsx
              {isAdoption && pet.city && (
                <tr>
                  <td style={{ color: '#6b7280', paddingBottom: '8px', paddingRight: '12px' }}>Zona:</td>
                  <td style={{ fontWeight: '600', color: '#111827', paddingBottom: '8px' }}>{pet.city}</td>
                </tr>
              )}
```

- [ ] **Step 4: Run test to verify it passes**

Run (from `frontend/packages/web`): `pnpm vitest run src/components/PdfFlyerButton.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/packages/web/src/components/PdfFlyerButton.tsx frontend/packages/web/src/components/PdfFlyerButton.test.tsx
git commit -m "feat(web): adoption-framed PDF flyer (header + city)"
```

---

## Task 6: Adoption-aware SharePanel poster header

**Files:**
- Modify: `frontend/packages/web/src/components/SharePanel.tsx`
- Test: `frontend/packages/web/src/components/SharePanel.test.tsx` (extend)

- [ ] **Step 1: Write the failing test**

Add to `frontend/packages/web/src/components/SharePanel.test.tsx` (a new `describe`, reusing the existing top-of-file mocks for `react-i18next` and `@shared/hooks`):

```tsx
describe('SharePanel — adoption poster header', () => {
  it('shows EN ADOPCIÓN in the story template for adoption pets', () => {
    const { container } = render(
      <SharePanel petId="pet-2" petName="Michi" pet={{ ...basePet, name: 'Michi', status: 'adoption' }} />
    );
    expect(container.textContent).toContain('¡EN ADOPCIÓN!');
    expect(container.textContent).not.toContain('¡MASCOTA PERDIDA!');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `frontend/packages/web`): `pnpm vitest run src/components/SharePanel.test.tsx`
Expected: FAIL — the new test finds `¡MASCOTA PERDIDA!` instead of `¡EN ADOPCIÓN!`.

- [ ] **Step 3: Implement**

In `SharePanel.tsx`, add derived constants near the top of the component (alongside `const message = buildWhatsAppMessage(...)` at line ~79):

```tsx
  const isAdoption = pet.status === 'adoption';
  const posterColor = isAdoption ? '#7c3aed' : pet.status === 'found' ? '#22c55e' : '#ef4444';
  const posterHeader = isAdoption
    ? '¡EN ADOPCIÓN!'
    : pet.status === 'found' ? '¡MASCOTA ENCONTRADA!' : '¡MASCOTA PERDIDA!';
```

Replace the poster header `backgroundColor: pet.status === 'found' ? '#22c55e' : '#ef4444',` with `backgroundColor: posterColor,` and the text `{pet.status === 'found' ? '¡MASCOTA ENCONTRADA!' : '¡MASCOTA PERDIDA!'}` with `{posterHeader}`.

- [ ] **Step 4: Run test to verify it passes**

Run (from `frontend/packages/web`): `pnpm vitest run src/components/SharePanel.test.tsx`
Expected: PASS (existing tests + the new one).

- [ ] **Step 5: Commit**

```bash
git add frontend/packages/web/src/components/SharePanel.tsx frontend/packages/web/src/components/SharePanel.test.tsx
git commit -m "feat(web): adoption poster header in SharePanel"
```

---

## Task 7: Full suite + typecheck gate

- [ ] **Step 1: Typecheck**

Run (from `frontend/packages/web`): `npx tsc --noEmit` → Expected: 0 errors.

- [ ] **Step 2: Full web + shared suite**

Run (from `frontend/packages/web`): `pnpm test:run` → Expected: all green (web + shared), including the new tests.

- [ ] **Step 3: Push branch and open PR** (per the `searchpet-pr` skill)

The user controls merge. Open the PR against `main`, note `pnpm test:run` ran, and that it does not touch sensitive surfaces (auth/JWT/websocket). Mobile detail redesign is an explicit follow-up.

---

## Self-Review

**Spec coverage:**
- Adoption detail layout (adoption + adopted bodies) → Task 3 + Task 4. ✅
- adopted "found a home" state, no contact/share → Task 3 (adopted branch) + Task 2 (copy). ✅
- Adoption-framed share message → Task 1. ✅
- SharePanel poster header adoption case (self-review gotcha) → Task 6. ✅
- Adoption flyer → Task 5. ✅
- Share restored only for adoption (adopted has none) → Task 3 (share block gated to `isAuthenticated`, only rendered in the `adoption` branch; `adopted` returns early with no share). ✅
- Contact: chat + phone → Task 3. ✅
- i18n es/en/pt parity → Task 2 (adopted banner); other strings reuse existing `pets:detail.*`. ✅
- Web-first, mobile follow-up → out of scope, noted in Task 7. ✅
- Lost detail unchanged → Task 4 wraps the existing body untouched in `!isAdoptionListing`. ✅

**Placeholder scan:** No TBD/TODO. Every code step shows full code. Task 4 gives exact anchors for the JSX wrap (large existing file; the wrap is mechanical and the boundaries are named).

**Type consistency:** `posterColor` / `posterHeader` are the same names in Tasks 5 and 6. `isAdoptionListing` matches the existing PetDetailPage variable. `AdoptionPetBody` prop `{ pet: Pet }` matches its usage in Task 4. `PetForMessage.city` (Task 1) matches `Pet.city` (verified `city?: string`).
