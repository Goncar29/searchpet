# Publish Flow Redesign — Design

**Date:** 2026-06-11
**Status:** Approved by user (brainstorming session)

## Problem

The "Publicar" button (web nav `MainLayout.tsx`, home CTA `HomePage.tsx`) and the mobile Post tab (`(tabs)/post.tsx`) route to a plain pet-creation form that never sends `status`. The backend (`pet_service.go` `CreatePet`) therefore defaults to `status=registered` with `owner_id = <publisher>`. Result: a user who publishes a stray sighting becomes the pet's "owner", and the same animal can end up registered multiple times (once by the finder, once by the real owner marking their pet lost). No publish path collects a last-seen location or creates an initial report, so published pets carry no map data.

The backend domain model is already correct: `stray` pets have `owner_id = NULL` and `reporter_id` set; `lost` is reached only by transition from `registered` via the status machine. The bug is entirely in the publish UX and the missing composite operations.

## Decisions (user-confirmed)

1. **"Publicar" only publishes.** Two intents: *my pet is lost* and *I saw a stray*. Preventive registration of an owned pet stays in My Pets (existing `CreatePetPage` / mobile equivalent), no longer reachable from the publish buttons.
2. **Lost flow accepts only already-registered pets.** Rationale: forces complete pet data (photos, contact) so the search is useful. Empty state links to the registration flow.
3. **Photo is mandatory for strays** (min 1, max 3). Needed for identification and CLIP image-search indexing.
4. **Web and mobile ship together** in this change; shared types/hooks are touched once.
5. **Composite transactional backend endpoints** (chosen over frontend orchestration): a lost/stray pet visible in the public feed without a location report is corrupt data for a map-centric product, so the invariant "publishing requires a location" lives in the domain layer.
6. **Stray reporting is open to visitors, publishing still requires an account.** The stray wizard path (photo, form, map) works without a session; at the PUBLICAR action an inline register/login step appears, preserving all wizard state. Fully anonymous publishing was rejected: a sighting needs a contactable reporter (chat is user-to-user), unauthenticated photo uploads expose the 25-credit/month Cloudinary quota to abuse, `reports_abuse`/blocking only target users, and the reporter could never be notified (`pet.found`) nor earn badges.

## UX Flow — 4-step wizard

All publish entry points (web nav "Publicar", home "Publicar mascota", mobile Post tab) land on the wizard:

1. **Intent** — two cards: "Mi mascota se perdió" / "Vi una mascota callejera".
2. **A (lost): pick your pet** — list of the user's registered pets eligible for the `lost` transition. Empty state: "No tenés mascotas registradas" + button to the existing registration flow, returning here afterwards.
   **B (stray): minimal form** — photo picker (required, 1–3), type (required), color/breed/description (optional). No name field; strays render with a "Sin nombre"/type label.
3. **Last-seen location** (both paths) — map with draggable pin (Leaflet on web, react-native-maps on mobile), "use my location" button (browser geolocation / device GPS), default center Montevideo (-34.9011, -56.1645), optional sighting note. PUBLICAR button. If the user has no session (stray path only — the lost path requires owned pets and therefore a session from step 2A), PUBLICAR opens an inline register/login step; wizard state is preserved and publishing continues right after authentication. The `/publish` route and mobile Post tab are therefore public, with the auth gate at the publish action, not at entry.
4. **Success** — confirmation screen offering social sharing via the existing SharePanel (web) / ShareButton (mobile).

Wireframes from the brainstorming session: `.superpowers/brainstorm/15503-1781199994/content/publish-wizard-flow.html` (local only, not committed).

## API Design

### New: publish a lost pet

```
POST /api/pets/:id/publish-lost        (protected)
Body: { "latitude": number, "longitude": number, "note": string? }
```

Service (new `PublishLost` method on the existing `PetService`, which already owns status transitions):
- Verify the caller owns the pet (403 otherwise).
- Verify the status machine allows the transition to `lost` (`invalid_status_transition` otherwise).
- In **one GORM transaction**: update pet status to `lost` + create the initial report (reporter = owner, given coordinates/note).
- After commit, publish `pet.lost` (triggers CLIP embedding backfill) and `report.created` (triggers nearby push notifications) on the EventBus.
- Response: updated pet DTO (200).

### Extended: create a stray with its initial report

```
POST /api/pets                          (protected, existing endpoint)
Body: { ...existing fields, "status": "stray",
        "initial_report": { "latitude": number, "longitude": number, "note": string? } }
```

New service rules:
- `status=stray` **requires** `initial_report` → 400 `initial_report_required` if absent.
- `status=registered` (or omitted) **rejects** `initial_report` → 400 (registered pets are not published).
- Pet + report created in **one GORM transaction**. Existing behavior preserved: `owner_id = NULL`, `reporter_id = caller`, `pet.stray` event; `report.created` fires for the initial report after commit.

### Photo atomicity (accepted tradeoff)

Photos upload in a separate call after pet creation (the upload endpoint needs `pet_id`; existing pattern). The hard transactional invariant covers **pet + location** — the data that corrupts the map. Worst case for strays: the pet exists with location but without photo for a short window if the upload fails; the wizard keeps the photo in memory and shows a one-tap "retry upload" screen. Folding the photo into a multipart composite endpoint was rejected: it breaks the existing upload pattern for a rare, recoverable case.

### Validation and errors (project rule 11 — `{code, message}` via `writeError`)

- Latitude in [-90, 90], longitude in [-180, 180] → 400 on violation.
- `publish-lost`: 403 not-owner, `invalid_status_transition`, transaction rollback if report creation fails (status unchanged).
- `POST /api/pets`: new code `initial_report_required`; 400 when `registered` carries `initial_report`.
- New error codes get i18n entries (es/en/pt) in all frontends' `errors` namespaces.

## Shared / Frontend Changes

### `frontend/packages/shared/`
- `CreatePetRequest` gains `status?: 'registered' | 'stray'` and `initial_report?: { latitude: number; longitude: number; note?: string }`.
- New client method `publishPetLost(petId, { latitude, longitude, note? })`.
- New hooks: `usePublishLost()`, `usePublishStray()` (chains create → photo upload with retry support). Both invalidate feed and my-pets queries.

### Web (`frontend/packages/web/`)
- New route `/publish` hosting the wizard (local component state across steps).
- `MainLayout.tsx` nav "Publicar" and `HomePage.tsx` "Publicar mascota" point to `/publish`.
- `CreatePetPage` (`/pets/create`) remains as owned-pet registration, linked from My Pets.
- Map step uses Leaflet (already a dependency) with draggable pin + browser geolocation.

### Mobile (`frontend/packages/mobile/`)
- `(tabs)/post.tsx` becomes the wizard (react-native-maps + device GPS).
- Owned-pet registration lives in My Pets.

### i18n
- New `publish` namespace (es/en/pt) across shared/web/mobile locale files.

## Testing

- **Backend (Go, table-driven with repo mocks):** publish-lost happy path, non-owner 403, invalid transition, report-failure rollback (status must remain unchanged); create-stray with/without `initial_report`, `registered`+`initial_report` rejection, transactional pairing. New error codes appended to `write_error_test.go`. One httptest flow test covering the full publish sequence (register → publish-lost → nearby), alongside the existing 3 flows.
- **Shared (Vitest via `vitest.shared.config.ts` from web — project rule 14):** `publishPetLost` client method; `usePublishStray` chaining and retry behavior.
- **Web (Vitest):** wizard tests — intent selection, lost empty state, stray photo requirement, map-step validation, successful publish, and the unauthenticated stray path: inline auth appears at PUBLICAR and wizard state survives registration.
- **Mobile (Jest `test:run` — project rule 17):** wizard smoke tests; new hooks added to the `@shared/hooks` screen mocks.
- **E2E (Playwright):** one new spec — publish a stray end-to-end.

## Out of Scope

- Image-search provider replacement (bug 1 — separate change; HF router no longer serves CLIP).
- Badge/points for publishing strays (gamification already listens to `report.created`).
- Editing or deleting published reports.
- Detox mobile E2E (deferred project-wide).
