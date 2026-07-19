# Adoption Detail Redesign (mobile) — Design

- **Date:** 2026-07-18
- **Status:** Approved (design), pending implementation plan
- **Author:** brainstorm session (Carlos + Claude)
- **Builds on:** [2026-07-18-adoption-detail-redesign-design.md](./2026-07-18-adoption-detail-redesign-design.md) (web), [2026-07-17-pet-adoption-listings-design.md](./2026-07-17-pet-adoption-listings-design.md)

## Context

The web adoption detail redesign shipped (PR #97, merged): adoption listings got
their own detail body (`AdoptionPetBody`), adoption-framed sharing (share message,
PDF flyer, SharePanel poster header), and a resolved "found a home" state. This is
the explicit **mobile follow-up** — the same design ported to
`frontend/packages/mobile/app/pet/[id].tsx`.

Today the mobile detail screen is lost-pet framed for adoption listings:

- The status badge has no `adoption`/`adopted` case, so both fall to the default
  red `COLORS.lost`.
- The report timeline, `TimelineMap`, `ShareButton` and `PdfFlyerButton` render
  for every status, framed as a lost pet.
- `PdfFlyerButton` hardcodes `¡MASCOTA PERDIDA!`; `ShareButton` uses a `PERDIDA`
  title. (The WhatsApp **message body** already flows adoption-framed for free,
  because the screen passes the full `pet` to the shared `buildWhatsAppMessage`,
  which gained the `adoption` case in web PR #97 — now in `main`.)
- Owner contact is a single WhatsApp/chat button, not the web's in-app-chat-first
  adoption contact block.

## Decisions (from brainstorm)

1. **Scope:** full — the adoption detail body **and** adoption-framed sharing
   (flyer header + city, share title), mirroring web. Not layout-only.
2. **Architecture:** **Approach B** (mirror web) — extract an isolated mobile
   `AdoptionPetBody` component; the lost/stray/found body stays inline in
   `pet/[id].tsx`, guarded by `!isAdoptionListing`. (Rejected: inline
   conditionals in the already-large ~590-line screen.)
3. **`adopted` state:** contact and sharing hidden; a celebratory "found a home"
   banner is shown. Still reachable by direct link.
4. **Share is restored only for `adoption`**, never `adopted`, and — as on web —
   **requires a session** (parity with web; the share-link endpoint is
   auth-gated). This is stricter than the current mobile behaviour, where
   lost/stray share is public; lost/stray gating is unchanged.
5. **Contact in adoption:** in-app chat first (`💬 Enviar mensaje` →
   `/chat/${owner_id}`), plus the owner's WhatsApp/phone when present.
6. **Flyer/poster copy stays Spanish-only** (unchanged project decision).
7. **Badge colours mirror web** `statusBadge.ts`: `adoption` = purple-700
   (`#7E22CE`), `adopted` = teal-700 (`#0F766E`).

## Goals

- An `adoption` pet's mobile detail shows adoption-appropriate contact + sharing,
  with no lost-pet scaffolding (no report timeline, no `TimelineMap`, no "mark
  found").
- An `adopted` pet's mobile detail shows a resolved success state, still viewable
  by link.
- Sharing an adoption listing produces adoption-framed copy and an adoption flyer,
  never "MASCOTA PERDIDA".
- The lost/stray/found mobile detail experience is unchanged.

## Non-goals

- Any change to the adoption data model, statuses, or state machine (already
  shipped).
- The "mark adopted" action (already on the my-pets screen, PR #93 M4b).
- Changes to the mobile Adoptar browse or publish flow.
- Adoption applications / screening.
- Web changes (already shipped).

## Component structure (Approach B)

`frontend/packages/mobile/app/pet/[id].tsx`:

- Keeps: data loading, photo carousel, header (name + status badge), details card
  (type/breed/color + **city** for adoption), description. Common to all statuses.
- Derives `isAdoptionListing = pet.status === 'adoption' || pet.status === 'adopted'`.
- **Body branch:**
  - `isAdoptionListing` → renders `<AdoptionPetBody pet={pet} />` (new).
  - else → the existing inline body (mark-found, story button, owner card,
    `ShareButton`, `PdfFlyerButton`, `TimelineMap`, report timeline) unchanged,
    guarded by `!isAdoptionListing`.
- **Status badge:** add `adoption` and `adopted` cases to the badge background
  switch using the new `COLORS.adoption` / `COLORS.adopted`.

New component `frontend/packages/mobile/components/AdoptionPetBody.tsx`:

- **Props:** `{ pet: Pet }`. Reads auth via `useAuthStore`, translation via
  `useTranslation`, navigation via `useRouter`. Self-contained — no lost-pet deps.
- **`pet.status === 'adopted'`:**
  - A success banner: `🎉 {name} encontró un hogar` + a short thank-you line
    (`adoption:detail.adoptedTitle` / `adoptedSubtitle`).
  - No contact, no share.
- **`pet.status === 'adoption'`:**
  - **Owner contact block** (when `pet.owner`): in-app chat first —
    `💬 {pet_detail:sendMessage}` → `/chat/${pet.owner_id}` for a non-owner
    authenticated viewer; a `🔒 {pet_detail:loginToContact}` gate when logged out;
    hidden entirely for the owner viewing their own listing. Plus a WhatsApp/phone
    contact button when `pet.owner.phone` (reusing `buildWhatsAppContactURL`).
  - **Share block** — `ShareButton` (adoption-framed) + `PdfFlyerButton`
    (adoption-framed), rendered only when `isAuthenticated` (decision 4).

**Boundary check:** `AdoptionPetBody` does one thing (render the adoption body for
a pet), takes one input (`pet`), depends only on auth + i18n + navigation + the
existing share/contact primitives. `pet/[id].tsx` gains only the single body
branch plus the two badge-colour cases.

## Adoption sharing (mobile)

### Share message
No change needed — the screen already passes the full `pet` to `ShareButton`,
which builds its text via the shared `buildWhatsAppMessage`. That function is
status-aware as of web PR #97 (now in `main`), so the `adoption` message framing
flows for free.

### `ShareButton` — `frontend/packages/mobile/components/ShareButton.tsx`
- Its `status` prop is typed `'lost' | 'found' | 'sighting'` and the caller passes
  `pet.status === 'found' ? 'found' : 'lost'`, producing a `PERDIDA` share title
  for adoption. Make the title adoption-aware: derive from `pet.status` so an
  adoption listing shows `EN ADOPCIÓN` (Spanish, matching the poster/flyer copy),
  never `PERDIDA`. Keep lost/found titles unchanged.

### `PdfFlyerButton` — `frontend/packages/mobile/components/PdfFlyerButton.tsx`
- Mirror web PR #97 Task 5. Add adoption-aware constants:
  - `statusColor`: adoption → `#7c3aed`, found → `#22c55e`, else `#ef4444`.
  - `statusText`: adoption → `¡EN ADOPCIÓN!`, found → `¡MASCOTA ENCONTRADA!`,
    else `¡MASCOTA PERDIDA!`.
- Add a "Zona: {city}" row for adoption listings when `pet.city` is present.
- Lost/found flyers unchanged. Copy stays Spanish-only.

## Constants — `frontend/packages/mobile/constants/index.ts`

Add to `COLORS`, mirroring web `statusBadge.ts`:

- `adoption: '#7E22CE'` (purple-700)
- `adopted: '#0F766E'` (teal-700)

## i18n (es / en / pt — full parity)

- Add a `detail` block to the mobile `adoption` namespace (which today has
  `section` / `publish` / `profile`), mirroring web copy:
  - `adoption:detail.adoptedTitle` — `"¡{{name}} encontró un hogar! 🎉"` (es),
    `"{{name}} found a home! 🎉"` (en), `"{{name}} encontrou um lar! 🎉"` (pt).
  - `adoption:detail.adoptedSubtitle` — thank-you line, es/en/pt.
- Reuse existing `pet_detail:*` keys for contact copy where they fit
  (`sendMessage`, `loginToContact`, `contact`, …). Add any missing key to
  `pet_detail` in all three locales. es/en/pt key sets must match exactly.
- Status labels `pets:status.adoption` / `pets:status.adopted` already exist.

## Testing

- **`AdoptionPetBody`** (mobile, jest + @testing-library/react-native), mocking
  `@shared/hooks`, `useAuthStore`, `useRouter`, and the heavy children
  (`ShareButton`, `PdfFlyerButton`) hook-by-hook per rule #17:
  - `adoption` + authed non-owner → renders the message action and the share
    block; renders the phone/WhatsApp button only when `owner.phone` exists.
  - `adoption` + owner viewing own listing → hides the message action.
  - `adoption` + logged out → shows the login gate and **no** share block.
  - `adopted` → renders the success banner; renders **no** contact and **no**
    share.
  - Never renders lost-pet scaffolding (no timeline / mark-found).
- **`PdfFlyerButton`**: an adoption pet's generated HTML contains `¡EN ADOPCIÓN!`
  and the city, never `¡MASCOTA PERDIDA!`; a lost pet still shows the lost header.
- **`ShareButton`**: an adoption pet's share title is not `PERDIDA`.
- Run with `pnpm test:run` from `frontend/packages/mobile` (never `pnpm test` —
  watch mode). Any new hook used by a tested screen must be added to its mock.

## Out of scope / future

- An `Adoptado` public success wall / stories cross-over.
- Any adoption analytics event.
- Web parity is already shipped; this closes the mobile side of the feature.
