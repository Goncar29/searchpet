# Pet Adoption Listings — Design

- **Date:** 2026-07-17
- **Status:** Approved (design), pending implementation plan
- **Author:** brainstorm session (Carlos + Claude)

## Context

SearchPet's whole `Pet` domain is built around **"help me find"**: the feed, map,
image search, share and status machine all revolve around `lost` / `stray` /
`found`. Adoption is a **different intent** — "this pet needs a home", not "help
me find my pet". We want to add adoption listings without polluting the lost-pet
flows.

## Decisions (from brainstorm)

1. **Who publishes:** any registered user (private rehoming + rescuers), same as
   publishing a lost pet today.
2. **Where it lives:** a **separate "Adoptar" section** — adoption pets never mix
   into the lost/stray feed, map or public search.
3. **Approach:** **Option A** — reuse the existing `Pet` entity and add two new,
   isolated statuses. (Rejected: a separate `adoption_listings` table = too much
   duplication of photos/chat/share infra; a `kind` discriminator field = adds a
   dimension to every query when the status already discriminates.)
4. **Location:** **city as free text only** — no PostGIS, no reports, no map.
5. **Registration entry point:** reuse the existing stepped publish flow, adding a
   new "Doy en adopción" publication type alongside lost / stray.
6. **Where the publisher sees it:** a **third tab "En adopción"** in the existing
   "Mis mascotas" page (not folded into "Mis reportes", which is reporter-based
   strays; adoption pets are owner-based).

## Goals

- Any user can publish a pet available for adoption.
- Browsers can see available pets in a dedicated "Adoptar" section, filterable by
  city and type.
- Contact happens through the existing chat / WhatsApp — no new contact code.
- Adoption is fully isolated from the lost-pet lifecycle and surfaces.

## Non-goals

- No geo / map / "adopta cerca tuyo" (city text is enough for v1).
- No adoption applications, screening, or approval workflow.
- No shelter-only gating (any user publishes).
- No cross-over transitions between the lost cluster and the adoption cluster.

## Data model

`Pet` gains one optional field:

- `City *string` — nullable. Only meaningful for adoption listings (free-text
  city/zone used for filtering). Untouched by lost flows. Added via GORM
  AutoMigrate on deploy (rule #19 — backend rebuilds schema on deploy).

Two new status constants in `backend/internal/domain/pet_status.go`:

- `PetStatusAdoption = "adoption"` — available for adoption.
- `PetStatusAdopted  = "adopted"` — adoption completed.

Both added to `ValidPetStatuses`. **Deliberately NOT added** to
`FeedVisibleStatuses`, `MapVisibleStatuses`, or `PublicSearchableStatuses` — this
is the isolation guarantee. New allowlist:

- `AdoptionPublicStatuses = map[string]bool{ PetStatusAdoption: true }` — only
  *available* pets are public in the Adoptar section. `adopted` is visible only to
  its owner (their profile tab).

## State machine (closed cluster)

In `backend/internal/domain/status_machine.go`, add:

```
adoption  → adopted, archived
adopted   → adoption, archived      (revert if the adoption falls through)
```

- **Zero *direct* edges** connect this cluster to `registered / lost / stray /
  found`. A lost pet can never become an adoption in one step, and vice versa.
- Adoption pets are **created directly** as `adoption` (no transition into it).
- `archived → registered` already exists and is **unchanged**. This means an
  owner *can* deliberately walk their own listing back to an owned pet via
  `adoption/adopted → archived → registered` (and from there to `lost`). This is
  intentional and legitimate: adoption pets are **owner-owned** (unlike strays,
  which have no owner and are sandboxed to `stray → found`), so reclaiming a pet
  you were rehoming is a valid multi-step action by its owner. What the isolation
  guarantees is that no adoption listing appears in the lost surfaces *while it is
  a listing*, and that there is no one-step flip between the clusters.

## Backend

### Creation (reuse `POST /api/pets`)
- Extend the creation-status allowlist so `adoption` is a valid initial status
  (same mechanism that already allows creating a `stray`).
- `CreatePetRequest` gains optional `City *string`. Publisher becomes `owner_id`.
- No initial report is created (unlike stray/lost). No PostGIS.

### Public listing (new endpoint)
- `GET /api/adoptions` — **public**, no auth. Lists pets with status `adoption`.
  Optional query params: `city` (case-insensitive contains), `type`, `page`,
  `limit`. Reuses the pet repository with search criteria (add `City` and a
  `Statuses` set to the existing `PetSearchCriteria`).
- Returns `dto.ToPetListResponse` (existing shape).

### Adoption lifecycle (reuse `PUT /api/pets/:id`)
- Marking adopted / reverting / archiving all go through the existing
  `PUT /api/pets/:id` with the state machine enforcing the closed cluster. No
  dedicated endpoint needed (the state machine already gates transitions).
- `UpdatePetRequest` gains optional `City *string` (pointer pattern, rule #22) so
  the city can be edited/cleared.
- Owner-only (existing `ErrForbidden` guard). Invalid transitions → 422
  (`ErrInvalidStatusTransition`), already wired in the handler.
- *(Optional, future)* a `pet.adopted` EventBus event for stats/analytics — not
  required for v1.

### "My adoption pets" (no new endpoint)
- `GET /api/pets/mine` already returns all owned pets. The profile splits them
  client-side: the "Mis mascotas" tab excludes `adoption`/`adopted`; the "En
  adopción" tab includes only those. Avoids a new endpoint.

## Frontend

### Shared (`frontend/packages/shared/`)
- `types/index.ts`: `PetStatus` gains `'adoption' | 'adopted'`; `Pet` and
  `CreatePetRequest` / `UpdatePetRequest` gain optional `city?: string`.
- `utils/petStatusTransitions.ts`: mirror the backend cluster edges so the UI
  never offers a transition the API rejects.
- `api/client.ts`: add `getAdoptions(filters)` → `GET /api/adoptions`.
- `hooks/index.ts`: add `useAdoptions(filters)` query hook.

### Publish flow
- Add an **"Doy en adopción"** option to the publication-type picker, alongside
  the existing lost / stray types.
- New step component `AdoptionStep` (web + mobile), parallel to `LostPetStep`:
  photos + name/type/breed/color/description + **city** field. No location/report
  step.

### Adopt section
- **Web:** new route `/adoptar` + nav link. Page lists `useAdoptions` results with
  city + type filters (draft/applied pattern, consistent with HomePage). Cards
  reuse `PetCardWeb` with an "En adopción" badge.
- **Mobile:** an "Adoptar" screen reachable from home/profile (no 6th tab, to
  avoid overcrowding the tab bar).

### Profile — third tab
- `MyPetsPage` (web) and the mobile equivalent add a third tab **"En adopción"**
  next to "Mis mascotas" / "Mis reportes".
- Backed by the client-side split of `useMyPets` (owned pets with status
  `adoption`/`adopted`).
- Adoption cards get their own actions: **Marcar adoptado** (`PUT` status →
  `adopted`), **Editar**, **Archivar** — and NOT the lost-oriented actions
  ("Reportar perdida", lost transitions).
- `STATUS_CONFIG` and `selectableStatuses` extended for the new statuses.

### i18n (full coverage — web AND mobile)

**Hard rule: every new user-facing string is i18n'd in the three languages
(es / en / pt) from the start. No hardcoded Spanish anywhere.** Applies equally to
web and mobile.

- **Status labels:** `pets:status.adoption` / `pets:status.adopted` in es/en/pt
  (rule #13 — never hardcode status labels). Used by badges, the profile status
  dropdown, and the adopt cards on both platforms.
- **New `adoption` namespace** with keys for all section/publish/profile copy:
  - Section: title, subtitle, empty state, city filter label + placeholder, type
    filter, "En adopción" badge, result count.
  - Publish: the "Doy en adopción" picker option + label/help, the city field
    label + placeholder, submit button, validation messages.
  - Profile tab: the "En adopción" tab label, empty state, "Marcar adoptado"
    button + confirmation, "Archivar".
- **Web registration:** the `adoption` namespace MUST be registered in
  `web/src/i18n/index.ts` in all three language blocks (rule #21 — otherwise
  `useTranslation('adoption')` returns raw keys and the UI shows the literal key).
  Add the JSON files under `web/src/i18n/locales/{es,en,pt}/adoption.json` (or the
  existing per-language structure).
- **Mobile registration:** add the same keys to the mobile i18n resource bundles
  (`frontend/packages/mobile/…/i18n`) for es/en/pt, following the existing mobile
  namespace setup. Mobile screens call `t()` with explicit namespace prefix, same
  convention as the rest of the app.
- **Parity check:** es/en/pt key sets must match exactly (no missing keys in any
  language) — same discipline used in the prior i18n sweeps (PRs #85–#90).
- **Deliberately Spanish-only (unchanged):** shareable poster / PDF flyer copy
  stays in Spanish by project decision — not affected by this feature.

## Isolation guarantees (the crux of Option A)

1. `adoption` / `adopted` are absent from `FeedVisibleStatuses`,
   `MapVisibleStatuses`, `PublicSearchableStatuses` → never leak into the lost
   feed, map, or public search.
2. State machine has no *direct* edges between the adoption cluster and the lost
   cluster (a one-step flip is impossible). The only bridge is the deliberate,
   owner-driven `archived → registered` path shared by all owned pets — see the
   State machine section for why that is intentional, not a leak.
3. Public `GET /api/adoptions` only ever returns `adoption` (never `adopted`, never
   lost statuses).
4. The lost publish flow and the adoption publish flow are separate steps.

## Testing

- **Backend:**
  - State machine: assert no cross-cluster edges (e.g. `lost → adoption` and
    `adoption → lost` both rejected); assert `adoption ↔ adopted` and
    `adoption/adopted → archived` allowed.
  - `GET /api/adoptions` returns only `adoption` pets; respects `city` / `type`
    filters.
  - Public pet search (`?status=`) rejects/omits `adoption` and `adopted` (they're
    not in `PublicSearchableStatuses`).
  - Create with initial status `adoption` succeeds; no report is created.
- **Frontend:**
  - `petStatusTransitions` includes the adoption edges and excludes cross-cluster
    ones.
  - Adopt section renders listings; profile "En adopción" tab shows owner's
    adoption pets with adoption-specific actions.
  - i18n labels resolve (no raw keys) in es/en/pt.

## Out of scope / future

- Geo filtering / map for adoption.
- Adoption applications / screening.
- `pet.adopted` analytics event.
- Shelter-published adoptions (currently any user; shelters could get a curated
  channel later).
