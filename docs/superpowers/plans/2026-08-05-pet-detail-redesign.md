# Pet detail redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the Stitch visual language to `PetDetailPage` and translate the nine Spanish strings hardcoded in it, without losing a single behaviour the page has today.

**Architecture:** One page file is restyled section by section. Every existing child component (`SharePanel`, `PdfFlyerButton`, `RevealContact`, `TimelineMap`, `AdoptionPetBody`) keeps its behaviour and only receives new container styling. The hero renders the photo twice — a blurred copy fills the frame, the real photo sits on top uncropped — so the design's edge-to-edge look never crops the animal.

**Tech Stack:** React 19, react-router 7, Tailwind v4 (`@theme` tokens in `index.css`), i18next, Vitest + Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-05-pet-detail-redesign-design.md`

---

## Constraints that bite in this plan

1. **The `pets` namespace lives in `frontend/packages/shared/i18n/locales/`, not in `web/`.** Mobile consumes `shared`, so **every task that touches those files must also run the mobile suite** (`cd frontend/packages/mobile && pnpm test:run` — never `pnpm test`, which is `--watchAll` and never exits).
2. **Judge by exit code, never by grepping output.** `... | rg FAIL || echo green` prints success when the grep read nothing.
3. **`pnpm test:run` is not "the suite".** Playwright is a separate CI job and is the only thing that runs the app in a real browser. It goes in the loop from Task 1, not at the end.
4. The branch is `feat/web-pet-detail`, based on `feat/web-design-tokens` (PR #126). If #126 lands on `main` by squash, rebase onto `main` before opening the PR (rule #30).

## File structure

| File | Responsibility | Action |
|---|---|---|
| `frontend/packages/shared/i18n/locales/{es,en,pt}.json` | The seven new `pets.detail.*` keys | Modify |
| `frontend/packages/web/src/pages/PetDetailPage.tsx` | The page: hero, fact cards, actions, contact, timeline | Modify |
| `frontend/packages/web/src/pages/PetDetailPage.test.tsx` | Unit coverage for the conditional cards and the i18n | Modify |
| `frontend/packages/web/e2e/pet-detail.spec.ts` | Browser coverage for the found flow in English | Create |

---

## Task 1: Translate the nine hardcoded Spanish strings

This lands first and on its own, because it is a **bug fix that stands without the redesign**. If the visual work is ever reverted, these must not go with it.

The nine, all present in `origin/main`:

| Line | String | Fix |
|---|---|---|
| 144 | `Ayudanos a encontrar a ${pet.name}` | `pets:detail.ogFallback` |
| 213 | `¡Esta mascota fue encontrada!` | `pets:detail.foundBanner` |
| 292 | `Guardando...` | `pets:detail.markFoundSaving` |
| 295 | `✅ Marcar como encontrada` | `pets:detail.markFound` |
| 301 | `¿Confirmás que {name} fue encontrada? ...` | `pets:detail.markFoundConfirm` |
| 310 | `Confirmar` | `common:confirm` (exists) |
| 317 | `Cancelar` | `common:cancel` (exists) |
| 358 | `🎉 Contar historia` | `pets:detail.tellStory` |
| 544 | `Verificado` | `pets:detail.reportVerified` |

`pets.detail.verified` already exists but means *the owner is verified*. It is **not** reused for the report badge: the two words coincide in Spanish today and will not in every language.

**Files:**
- Modify: `frontend/packages/shared/i18n/locales/es.json`, `en.json`, `pt.json`
- Modify: `frontend/packages/web/src/pages/PetDetailPage.tsx:144,213,292,295,301,310,317,358,544`
- Test: `frontend/packages/web/src/pages/PetDetailPage.test.tsx`

- [ ] **Step 1: Write the failing test**

`PetDetailPage.test.tsx:9` mocks `react-i18next` with `t: (key) => key`. **There is no English in this harness** — a translated string renders as its own key, a hardcoded one renders as Spanish. That difference *is* the assertion, and it is sharper than comparing prose:

```tsx
it('sends the mark-as-found flow through i18n instead of hardcoded Spanish', async () => {
  authState.isAuthenticated = true;
  authState.user = { id: 'owner-1' };
  petResult = { data: lostPetWithOwner(), isLoading: false };

  render(<PetDetailPage />, { wrapper });

  // `$` anchors the match so `markFoundSaving` and `markFoundConfirm` don't satisfy it.
  const markFound = screen.getByRole('button', { name: /pets:detail\.markFound$/ });
  expect(screen.queryByText(/Marcar como encontrada/)).not.toBeInTheDocument();

  await userEvent.click(markFound);
  // The confirmation of an irreversible action must go through i18n.
  expect(screen.queryByText(/Confirmás/)).not.toBeInTheDocument();
  expect(screen.getByText(/pets:detail\.markFoundConfirm/)).toBeInTheDocument();
});
```

Add `import userEvent from '@testing-library/user-event';` if the file does not already have it.

- [ ] **Step 2: Run it and watch it fail**

```bash
cd frontend/packages/web && npx vitest run src/pages/PetDetailPage.test.tsx; echo "EXIT=$?"
```

Expected: `EXIT=1`, failing on `getByRole('button', { name: /pets:detail\.markFound$/ })` — the button still reads `✅ Marcar como encontrada` in every language.

**The real proof of the translation is in Task 7**, where a browser resolves the app to English. The unit test can only prove the string stopped being a literal; it cannot prove the English reads correctly.

- [ ] **Step 3: Add the seven keys to the three shared locales**

In `frontend/packages/shared/i18n/locales/es.json` under `pets.detail`:

```json
"foundBanner": "¡Esta mascota fue encontrada!",
"markFound": "Marcar como encontrada",
"markFoundSaving": "Guardando...",
"markFoundConfirm": "¿Confirmás que {{name}} fue encontrada? Esta acción no se puede deshacer.",
"tellStory": "Contar historia",
"ogFallback": "Ayudanos a encontrar a {{name}}",
"reportVerified": "Verificado"
```

`en.json`:

```json
"foundBanner": "This pet has been found!",
"markFound": "Mark as found",
"markFoundSaving": "Saving...",
"markFoundConfirm": "Confirm that {{name}} has been found? This action cannot be undone.",
"tellStory": "Tell the story",
"ogFallback": "Help us find {{name}}",
"reportVerified": "Verified"
```

`pt.json`:

```json
"foundBanner": "Este pet foi encontrado!",
"markFound": "Marcar como encontrado",
"markFoundSaving": "Salvando...",
"markFoundConfirm": "Confirma que {{name}} foi encontrado? Esta ação não pode ser desfeita.",
"tellStory": "Contar a história",
"ogFallback": "Ajude-nos a encontrar {{name}}",
"reportVerified": "Verificado"
```

- [ ] **Step 4: Replace the nine call sites**

`PetDetailPage.tsx:144`:

```tsx
    : t('pets:detail.ogFallback', { name: pet.name });
```

`:213`:

```tsx
                {t('pets:detail.foundBanner')}
```

`:292` and `:295`:

```tsx
                    {markAsFound.isPending ? (
                      <>
                        <span className="animate-spin">⏳</span>
                        {t('pets:detail.markFoundSaving')}
                      </>
                    ) : (
                      `✅ ${t('pets:detail.markFound')}`
                    )}
```

`:301`:

```tsx
                        {t('pets:detail.markFoundConfirm', { name: pet.name })}
```

`:310` and `:317`:

```tsx
                          {t('common:confirm')}
```
```tsx
                          {t('common:cancel')}
```

`:358`:

```tsx
                  🎉 {t('pets:detail.tellStory')}
```

`:544`:

```tsx
                            {t('pets:detail.reportVerified')}
```

- [ ] **Step 5: Run the test and watch it pass**

```bash
cd frontend/packages/web && npx vitest run src/pages/PetDetailPage.test.tsx; echo "EXIT=$?"
```

Expected: `EXIT=0`.

- [ ] **Step 6: Run the web, shared AND mobile suites**

`shared/` changed, so mobile is not optional:

```bash
cd frontend/packages/web && pnpm test:run; echo "WEB=$?"
cd ../mobile && pnpm test:run; echo "MOBILE=$?"
```

Expected: `WEB=0` and `MOBILE=0`.

- [ ] **Step 7: Commit**

```bash
git add frontend/packages/shared/i18n/locales frontend/packages/web/src/pages/PetDetailPage.tsx frontend/packages/web/src/pages/PetDetailPage.test.tsx
git commit -m "fix(web): traducir los nueve strings hardcodeados del detalle de mascota"
```

---

## Task 2: Hero — contained photo over a blurred backdrop

**Files:**
- Modify: `frontend/packages/web/src/pages/PetDetailPage.tsx:160-216`
- Test: `frontend/packages/web/src/pages/PetDetailPage.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
it('never crops the pet photo', () => {
  petResult = {
    data: lostPetWithOwner({
      photos: [{ id: 'p1', url: 'https://example.com/a.jpg', is_primary: true } as Photo],
    }),
    isLoading: false,
  };

  render(<PetDetailPage />, { wrapper });

  // object-contain is the whole point: a cropped vertical photo loses the
  // animal's head, on the page whose job is to let someone recognise it.
  expect(screen.getByAltText('Firulais')).toHaveClass('object-contain');

  // The blurred fill is decoration and must stay out of the accessibility tree.
  expect(document.querySelector('[data-hero-backdrop]')).toHaveAttribute('aria-hidden', 'true');
});
```

`Photo` is already imported by the page; add it to the test file's type imports if it is not there.

- [ ] **Step 2: Run it and watch it fail**

```bash
cd frontend/packages/web && npx vitest run src/pages/PetDetailPage.test.tsx -t "never crops"; echo "EXIT=$?"
```

Expected: `EXIT=1` on the missing `[data-hero-backdrop]` element.

- [ ] **Step 3: Replace the hero container**

Replace the opening of the gallery block at `:160-170` with:

```tsx
          <div className="relative h-80 md:h-[28rem] overflow-hidden rounded-t-2xl bg-gray-900">
            {activePhoto ? (
              <>
                {/* Scaled, blurred copy of the same photo fills the frame so the
                    design's edge-to-edge hero never costs us a crop. Decoration
                    only — the real <img> below carries the alt text. */}
                <div
                  data-hero-backdrop
                  aria-hidden="true"
                  className="absolute inset-0 scale-110 bg-cover bg-center blur-2xl"
                  style={{ backgroundImage: `url(${activePhoto.url})` }}
                />
                <img
                  src={activePhoto.url}
                  alt={pet.name}
                  className="relative z-10 w-full h-full object-contain"
                  crossOrigin="anonymous"
                />
              </>
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-gray-100 dark:bg-gray-800">
                <PawPlaceholder className="w-2/5 max-w-28" />
              </div>
            )}
```

- [ ] **Step 4: Add the name overlay before the closing `</div>` of the hero**

```tsx
            {/* Scrim + title, from the design. The gradient is not decoration:
                the text sits over an arbitrary user photo and needs a
                guaranteed dark base to stay legible. */}
            <div
              aria-hidden="true"
              className="absolute inset-x-0 bottom-0 z-10 h-2/3 bg-gradient-to-t from-black/85 via-black/40 to-transparent"
            />
            <div className="absolute inset-x-0 bottom-0 z-20 p-5 md:p-8 text-white">
              <h1 className="font-display text-display-sm md:text-display">{pet.name}</h1>
              {(pet.breed || pet.type) && (
                <p className="mt-1 text-sm text-white/80">
                  {[pet.breed, t(`pets:types.${pet.type}`)].filter(Boolean).join(' • ')}
                </p>
              )}
            </div>
```

- [ ] **Step 5: Remove the now-duplicated `<h1>` at the old `:219`**

Delete the line `<h1 className="text-3xl font-bold ...">{pet.name}</h1>` — the name now lives in the hero. Leaving both renders it twice, which the test in Task 3 catches.

- [ ] **Step 6: Raise the gallery controls and badge above the new layers**

Every existing control (`‹`, `›`, the counter, the dots, the status badge, the found banner) needs `z-20` added to its class list so the scrim does not swallow it.

- [ ] **Step 7: Run the tests**

```bash
cd frontend/packages/web && pnpm test:run; echo "EXIT=$?"
```

Expected: `EXIT=0`.

- [ ] **Step 8: Commit**

```bash
git add frontend/packages/web/src/pages
git commit -m "feat(web): rehacer el hero del detalle sin recortar la foto"
```

---

## Task 3: Fact cards

**Files:**
- Modify: `frontend/packages/web/src/pages/PetDetailPage.tsx:221-240`
- Test: `frontend/packages/web/src/pages/PetDetailPage.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
it('shows the pet name once and omits fact cards with no value', () => {
  petResult = { data: lostPetWithOwner({ breed: '', color: '' }), isLoading: false };

  render(<PetDetailPage />, { wrapper });

  // The name moved into the hero. Rendering it in both places is the bug.
  expect(screen.getAllByText('Firulais')).toHaveLength(1);
  expect(screen.getByText('pets:detail.type')).toBeInTheDocument();
  // An emptied optional field must not render a card with a heading and no body.
  expect(screen.queryByText('pets:detail.breed')).not.toBeInTheDocument();
  expect(screen.queryByText('pets:detail.color')).not.toBeInTheDocument();
});
```

The labels are queried by key, not by Spanish prose — `t` echoes keys in this file.

- [ ] **Step 2: Run it and watch it fail**

```bash
cd frontend/packages/web && npx vitest run src/pages/PetDetailPage.test.tsx -t "shows the pet name once"; echo "EXIT=$?"
```

Expected: `EXIT=1` — `getAllByText('Firulais')` returns 2 until Task 2 Step 5 removes the old `<h1>`.

- [ ] **Step 3: Restyle the grid to the design's three cards**

```tsx
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
              {pet.type && (
                <div className="rounded-2xl border border-gray-100 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
                  <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">{t('pets:detail.type')}</p>
                  <p className="mt-1 font-display text-headline text-gray-900 dark:text-gray-100">{t(`pets:types.${pet.type}`)}</p>
                </div>
              )}
```

Repeat the same wrapper for `pet.breed` and `pet.color`, keeping their existing `t('pets:detail.breed')` / `t('pets:detail.color')` labels and raw values.

- [ ] **Step 4: Run the tests**

```bash
cd frontend/packages/web && pnpm test:run; echo "EXIT=$?"
```

Expected: `EXIT=0`.

- [ ] **Step 5: Commit**

```bash
git add frontend/packages/web/src/pages
git commit -m "feat(web): pasar los datos de la mascota a las cards del diseno"
```

---

## Task 4: Description card and action row

**Files:**
- Modify: `frontend/packages/web/src/pages/PetDetailPage.tsx:242-363`

- [ ] **Step 1: Wrap the description in the design's card**

```tsx
            {pet.description && (
              <div className="mb-6 rounded-2xl border border-gray-100 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
                <h3 className="flex items-center gap-2 font-display text-headline text-gray-900 dark:text-gray-100">
                  <Icon name="description" className="text-primary" />
                  {t('pets:detail.description')}
                </h3>
                <p className="mt-2 leading-relaxed text-gray-600 dark:text-gray-300">{pet.description}</p>
              </div>
            )}
```

- [ ] **Step 2: Add the `Icon` import**

```tsx
import { Icon } from '../components/Icon';
```

- [ ] **Step 3: Confirm `description` exists in the icon map, and add it if not**

```bash
cd frontend/packages/web && rg -n "description|history|call|lock" src/components/Icon.tsx
```

If a name used here is missing, add its Material Symbols path to `ICON_PATHS` in the same commit. **Do not** swap in an emoji — the page is being moved off them.

- [ ] **Step 4: Leave every action button's behaviour alone**

`SharePanel`, `PdfFlyerButton`, the add-report link, the mark-as-found flow, the story nudge and the abuse menu keep their current conditions **exactly**. Only `className` strings change, to the design's `rounded-xl` buttons. Any change to a condition here is out of scope and belongs in its own PR.

- [ ] **Step 5: Run the tests**

```bash
cd frontend/packages/web && pnpm test:run; echo "EXIT=$?"; pnpm run build; echo "BUILD=$?"
```

Expected: `EXIT=0` and `BUILD=0`. The build matters here: vitest does not typecheck, and an unused import left behind by the restyle fails `noUnusedLocals` (TS6133).

- [ ] **Step 6: Commit**

```bash
git add frontend/packages/web/src
git commit -m "feat(web): restilizar la descripcion y la fila de acciones"
```

---

## Task 5: Two-column layout with the contact sidebar

**Files:**
- Modify: `frontend/packages/web/src/pages/PetDetailPage.tsx:157,218,365-463,562-564`

- [ ] **Step 1: Widen the page shell**

At `:157`, `max-w-4xl` becomes `max-w-6xl` — the design's two-column body does not fit in the old width.

- [ ] **Step 2: Split the body into the grid**

Wrap everything after the hero in:

```tsx
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-6 p-6 md:p-8">
            <div className="min-w-0">{/* fact cards, description, actions, timeline */}</div>
            <aside className="min-w-0 lg:sticky lg:top-24 lg:self-start">{/* owner / reporter / abuse */}</aside>
          </div>
```

`minmax(0,…)` on both tracks is not optional: without it a long unbroken word in a description pushes the grid wider than the viewport and reintroduces horizontal overflow.

- [ ] **Step 3: Move the owner, reporter and abuse blocks into `<aside>` unchanged**

Cut `:365-463` (owner block, reporter block) and the abuse block at `:465-513` and paste them inside `<aside>`. **Do not touch `RevealContact`.** The design's green "Show phone" button becomes the existing reveal flow with the design's shape — the phone is only revealed on contact.

- [ ] **Step 4: Run the tests**

```bash
cd frontend/packages/web && pnpm test:run; echo "EXIT=$?"; pnpm run build; echo "BUILD=$?"
```

Expected: `EXIT=0` and `BUILD=0`.

- [ ] **Step 5: Commit**

```bash
git add frontend/packages/web/src
git commit -m "feat(web): pasar el detalle a dos columnas con sidebar de contacto"
```

---

## Task 6: Report history timeline

**Files:**
- Modify: `frontend/packages/web/src/pages/PetDetailPage.tsx:515-559`

- [ ] **Step 1: Wrap the timeline in the design's card and restyle the heading**

```tsx
              <div className="rounded-2xl border border-gray-100 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
                <h3 className="flex items-center gap-2 font-display text-headline text-gray-900 dark:text-gray-100">
                  <Icon name="history" className="text-primary" />
                  {t('pets:detail.timeline', { count: reports.length })}
                </h3>
```

- [ ] **Step 2: Replace the emoji pin with an icon**

```tsx
                        {report.location_description && (
                          <p className="flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400">
                            <Icon name="location" className="text-base" />
                            {report.location_description}
                          </p>
                        )}
```

- [ ] **Step 3: Leave the connector line, the coloured dots and `TimelineMap` untouched**

The dot colours already map to report status and the connector already hides on the last entry. Neither is a visual defect.

- [ ] **Step 4: Run the tests**

```bash
cd frontend/packages/web && pnpm test:run; echo "EXIT=$?"; pnpm run build; echo "BUILD=$?"
```

Expected: `EXIT=0` and `BUILD=0`.

- [ ] **Step 5: Commit**

```bash
git add frontend/packages/web/src
git commit -m "feat(web): restilizar el historial de reportes"
```

---

## Task 7: Browser verification — responsive, overflow and the found flow in English

**Files:**
- Create: `frontend/packages/web/e2e/pet-detail.spec.ts`

- [ ] **Step 1: Bring up the E2E stack**

```bash
docker exec lostpets-db psql -U postgres -c "DROP DATABASE IF EXISTS lostpets_test;" -q
docker exec lostpets-db psql -U postgres -c "CREATE DATABASE lostpets_test;" -q
cd backend && DATABASE_URL="postgres://postgres:postgres@localhost:5433/lostpets_test?sslmode=disable" \
  JWT_SECRET=test-secret-e2e PORT=8080 REDIS_URL="" CLOUDINARY_CLOUD_NAME=test \
  CLOUDINARY_API_KEY=test CLOUDINARY_API_SECRET=test FIREBASE_KEY="" BREVO_API_KEY="" \
  MAIL_FROM_EMAIL="" RATE_LIMIT_AUTH_MAX=100 go run ./cmd/server &
cd frontend/packages/web && VITE_API_URL=http://localhost:8080 pnpm run build && pnpm run preview &
```

- [ ] **Step 2: Write the spec**

The helpers that exist are `uniqueEmail`, `seedUser`, `loginAs`, `getToken`, `seedStray`, `markFound` and `seedStory`. There is no `registerUser`; the account is created with `seedUser` and the token fetched with `getToken`, following `story-likes.spec.ts`.

```ts
import { test, expect } from '@playwright/test';
import { uniqueEmail, seedUser, loginAs, getToken, seedStray } from './helpers';

test.describe('Pet detail', () => {
  const password = 'test1234';
  let email: string;
  let petId: string;

  test.beforeEach(async () => {
    email = uniqueEmail();
    await seedUser(email, password);
    const token = await getToken(email, password);
    petId = await seedStray(token, `Detail-${Date.now()}`);
  });

  test('the irreversible found confirmation speaks the browser language', async ({ page }) => {
    await loginAs(page, email, password);
    await page.goto(`/pets/${petId}`);

    // Chromium resolves the app to English here, which is exactly why this
    // test exists: the whole found flow was hardcoded Spanish and the unit
    // suite could not see it — `t` is mocked to echo keys there.
    const markFound = page.getByRole('button', { name: /mark as found/i });
    await expect(markFound).toBeVisible();
    await markFound.click();
    await expect(page.getByText(/cannot be undone/i)).toBeVisible();
    await expect(page.getByText(/Confirmás/)).toHaveCount(0);
  });

  test('no horizontal overflow at 375 or 1280', async ({ page }) => {
    await loginAs(page, email, password);

    for (const width of [375, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/pets/${petId}`);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `overflow at ${width}px`).toBe(0);
    }
  });
});
```

- [ ] **Step 3: Confirm the seeded stray is manageable by this account**

`seedStray` reports the pet with the given token, so that account is its `reporter_id` and `canManage` is true — which is what puts the mark-as-found button on screen. If the button is missing, check that first rather than the styling.

- [ ] **Step 4: Run the full E2E suite**

```bash
cd frontend/packages/web && API_URL=http://localhost:8080 npx playwright test; echo "E2E=$?"
```

Expected: `E2E=0` with the two new tests included.

- [ ] **Step 5: Prove the new guard fails red**

Revert one string to hardcoded Spanish (`'✅ Marcar como encontrada'`), rebuild, rerun. The found-flow test must fail on `getByRole('button', { name: /mark as found/i })` **and nothing else** must fail. Then restore. A guard nobody has watched fail is not a guard.

- [ ] **Step 6: Run everything**

```bash
cd frontend/packages/web && pnpm test:run; echo "WEB=$?"; pnpm run build; echo "BUILD=$?"
cd ../mobile && pnpm test:run; echo "MOBILE=$?"
```

Expected: all three `0`.

- [ ] **Step 7: Commit**

```bash
git add frontend/packages/web/e2e
git commit -m "test(web): cubrir el detalle de mascota en navegador real"
```

---

## Task 8: Open the PR

- [ ] **Step 1: Check the review budget**

```bash
git diff --numstat feat/web-design-tokens HEAD | awk '{a+=$1; d+=$2} END {print "changed:", a+d}'
```

If it exceeds 400, split following the home redesign's approach: Task 1 (i18n) is already a self-contained work unit and makes the natural first slice.

- [ ] **Step 2: Rebase if #126 has landed**

```bash
git fetch origin
git log --oneline origin/main..HEAD
```

If that lists commits you did not write, the base was squashed into `main`: `git rebase --onto origin/main feat/web-design-tokens feat/web-pet-detail`, then confirm `git diff` against the pre-rebase tip is empty before pushing.

- [ ] **Step 3: Push and open the PR**

```bash
git push -u origin feat/web-pet-detail
```

Base the PR on `main` if #126 has merged, otherwise on `feat/web-design-tokens`. The body follows the home redesign's PRs: Resumen, Cambios, what is deliberately not ported and why, Chain Context with the `📍` diagram, review budget, Plan de prueba, sensitive-surface note.
