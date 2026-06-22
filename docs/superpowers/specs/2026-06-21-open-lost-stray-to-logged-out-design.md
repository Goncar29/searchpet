# Design — Open lost/stray pets to logged-out finders

**Date:** 2026-06-21
**Status:** Approved (pending implementation plan)
**Scope:** Web (mobile parity tracked as follow-up)

## Problem

On the web pet card, a **logged-out** user cannot share to social, download the
flyer, or (for strays) contact anyone — and the buttons are disabled with **no
message** explaining why. This directly contradicts SearchPet's mission, which
depends on amplifying lost/stray pets through community and social networks. The
moment of maximum value — a neighbor wanting to share, or an owner who spots
their pet reported as a stray — is exactly where login friction kills reunions.
The web is also the de-facto iOS app (PWA), so logged-out UX is first-class.

## Goal

For **lost** and **stray** pets only, let logged-out finders:

1. Generate/use a share link and share to social networks.
2. Download the PDF flyer (which embeds the share-link QR).
3. Contact the relevant person (owner for lost; reporter for stray).

And never show a mute disabled control: where something stays gated, say why.

Non-goals: opening these for non-lost/stray statuses; removing login for pet
**management** (mark-as-found, edit, claim) — that still requires an account.

## Current state (verified)

- `/pets/:id` (PetDetailPage) is **public** (not behind ProtectedRoute).
- `SharePanel` and `PdfFlyerButton` render but their buttons depend on
  `POST /api/share/generate/:petId`, which is **protected** (router.go:303) →
  logged-out 401 → no link → buttons disabled silently.
- `share_service.Generate` (share_service.go:49) creates a **new row per call**
  (not idempotent) and requires `canManagePet` (owner or stray reporter).
- **Lost with owner:** `pet.owner.phone` is returned unconditionally
  (pet_dto.go:131; repo Preloads Owner; `GetPet` has no auth) and the owner
  block isn't auth-gated → the phone is already visible to logged-out users.
- **Stray (no owner):** the contact block targets the reporter via in-app
  messaging (`/messages/:reporterId`) and is gated by `isAuthenticated`
  (PetDetailPage:340) → a logged-out finder cannot contact anyone. This is the
  gap the user observed.

## Design

### 1. Public, idempotent share-link generation (lost/stray only)

- Make share-link generation reachable without auth **for lost/stray pets**.
  Preferred shape: a public endpoint (e.g. `POST /api/share/pet/:petId/link`)
  that:
  - returns the pet's existing active share link if one exists, else creates one
    (**idempotent** — prevents anonymous row spam);
  - 404s / refuses for non-lost/stray status (status guard);
  - is covered by the existing rate-limit middleware.
- Keep the current protected `Generate` for the owner/management flow, or have
  it delegate to the same idempotent core. Authz: the public path skips
  `canManagePet` but is constrained by the lost/stray status guard.
- Frontend: `SharePanel` and `PdfFlyerButton` call the public endpoint, so both
  work logged-out for lost/stray.

### 2. Stray contact — opt-in public WhatsApp

- At **stray report time**, an opt-in checkbox: *"Mostrar mi WhatsApp para que
  puedan contactarme por este animal (tu número será visible)."* Uses the
  reporter's profile phone.
- Persist a per-pet flag (e.g. `reporter_contact_public bool`). When true, the
  pet DTO includes the reporter's phone and the card shows a public WhatsApp
  contact button (no login).
- When false (or no phone): fall back to in-app messaging (login required), as
  today. There is always one channel; the default/encouraged path is friction-free.

### 3. Lost contact

- Phone is already public; keep it. Apply the same reveal-on-click treatment as
  strays (below).

### 4. Anti-scraping: reveal-on-click

- Don't print raw phone numbers in the HTML. Show a *"Ver teléfono / Contactar"*
  control that reveals the number (and/or opens WhatsApp) on click. This blunts
  trivial bot scraping while keeping zero friction for real finders. The public
  `POST /api/share/pet/:token/contact` (TrackContact) is the existing precedent.

### 5. Honest messaging (no mute disabled buttons)

- Wherever a control remains gated (non-lost/stray status, or a stray whose
  reporter opted out), replace the silent disabled state with a clear inline
  message, e.g. *"Iniciá sesión para compartir / contactar."*

## Privacy & abuse

- **Owner (lost):** publishing a lost pet implies consent to be contacted; phone
  stays public (already the case).
- **Reporter (stray):** exposing a good-samaritan's number is more sensitive →
  **explicit opt-in**, defaulting to the in-app fallback if declined.
- **Abuse:** idempotent generation (one active link per pet) + lost/stray status
  guard + existing rate limiting + reveal-on-click bound the surface.

## Testing

- Backend: idempotent public link generation (returns existing vs creates);
  status guard rejects non-lost/stray; stray DTO includes reporter phone only
  when the opt-in flag is set.
- Frontend: logged-out share/flyer enabled for lost/stray; gated states show the
  message instead of a mute disabled button; reveal-on-click behavior.

## Delivery

Likely **2–3 stacked PRs** (sensitive surface — making a protected route
public — should be reviewed):

1. Public idempotent share-link generation + frontend share/flyer enabled.
2. Stray opt-in contact (DB flag + report-flow checkbox + DTO + card WhatsApp).
3. Reveal-on-click + honest gated-state messaging (cross-cutting polish).

Mobile parity is a follow-up.
