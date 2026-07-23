# Adoption Detail Redesign (web) — Design

- **Date:** 2026-07-18
- **Status:** Approved (design), pending implementation plan
- **Author:** brainstorm session (Carlos + Claude)
- **Builds on:** [2026-07-17-pet-adoption-listings-design.md](./2026-07-17-pet-adoption-listings-design.md)

## Context

The pet-adoption feature (backend #91, web #92, mobile #93) reused the existing
`PetDetailPage` for adoption listings. That page is built for **lost pets** — it
shows a location-report timeline, an "add report" action, a share panel and a PDF
flyer all framed as "🚨 MASCOTA PERDIDA". PR #94 already hid the most misleading
pieces (report button, flyer, share) for `adoption`/`adopted` as a stopgap, and
PR #95 added an in-app message button to the owner contact block.

This design gives adoption listings their **own** detail body: adoption-framed
contact and sharing when a pet is available, and a resolved "found a home" state
once it is adopted — with none of the lost-pet scaffolding.

## Decisions (from brainstorm)

1. **Scope:** full — the adoption detail layout **and** adoption-framed sharing
   (reframed share message + adoption flyer), not just the layout.
2. **Platform:** **web first**. Mobile (`pet/[id].tsx`) is an explicit follow-up,
   reusing this design once validated on web.
3. **Architecture:** **Approach B** — `PetDetailPage` keeps the shared shell and
   delegates the status-specific body. Adoption gets its own isolated component;
   the lost/stray/found body stays inline, guarded by `!isAdoptionListing`.
   (Rejected: A — more conditionals inside the already-large PetDetailPage;
   C — a separate `/adopt/:id` route, which would break existing `/pets/:id`
   links and shares for little extra isolation over B.)
4. **`adopted` state:** contact and sharing are hidden (the pet is resolved). A
   celebratory "🎉 found a home" banner is shown. The record stays reachable by
   direct link (it is already excluded from the public Adoptar browse and search
   by `AdoptionPublicStatuses` / `PublicSearchableStatuses`).
5. **Share is restored only for `adoption`**, never `adopted`.
6. **Contact in adoption:** in-app chat (`💬 Enviar mensaje`) plus the owner's
   phone when present (reusing `RevealContact`).
7. **Flyer/poster copy stays Spanish-only** (unchanged project decision).

## Goals

- An `adoption` pet's detail shows adoption-appropriate contact + sharing, with no
  lost-pet scaffolding (no report timeline, no "add report", no "mark found").
- An `adopted` pet's detail shows a resolved success state, still viewable by link.
- Sharing an adoption listing produces adoption-framed copy and an adoption flyer,
  never "MASCOTA PERDIDA".
- The lost/stray/found detail experience is unchanged.

## Non-goals

- Mobile detail redesign (follow-up).
- Any change to the adoption data model, statuses, or state machine (already
  shipped in the prior feature).
- Changes to the Adoptar browse page or the publish flow.
- Adoption applications / screening.

## Component structure (Approach B)

`frontend/packages/web/src/pages/PetDetailPage.tsx`:

- Keeps: data loading, photo gallery, header (name + status badge), attribute row
  (type/breed/color/**city**), description, SEO/Helmet. These are common to all
  statuses.
- Derives `isAdoptionListing = pet.status === 'adoption' || pet.status === 'adopted'`
  (already present from PR #94).
- **Body branch:**
  - `isAdoptionListing` → renders `<AdoptionPetBody pet={pet} />` (new).
  - else → the existing inline body (actions, owner/reporter contact, report
    timeline, share) unchanged, guarded by `!isAdoptionListing`.

New component `frontend/packages/web/src/components/AdoptionPetBody.tsx`:

- **Props:** `{ pet: Pet }`. Reads auth via `useAuth`, translation via
  `useTranslation`. Self-contained — no lost-pet dependencies.
- **`pet.status === 'adoption'`:**
  - **Owner contact block** — reuse the same pattern as the current owner block:
    `💬 Enviar mensaje` → `/messages/${pet.owner_id}` (always, for non-owner
    authed viewers; `🔒 loginToContact` when logged out; hidden for the owner
    viewing their own listing), plus `RevealContact` when `pet.owner.phone`.
  - **Share block** — adoption-framed `SharePanel` + adoption flyer button
    (see "Adoption sharing").
- **`pet.status === 'adopted'`:**
  - A success banner: `🎉 {name} encontró un hogar` + a short thank-you line.
  - No contact, no share.

**Boundary check:** `AdoptionPetBody` does one thing (render the adoption-specific
body for a pet), takes one input (`pet`), and depends only on auth + i18n +
existing contact/share primitives. `PetDetailPage` no longer accretes adoption
conditionals beyond the single body branch.

## Adoption sharing

### Share message — `frontend/packages/shared/utils/whatsappTemplates.ts`
`buildWhatsAppMessage` becomes **status-aware**:

- `adoption` → adoption copy, e.g. `🏠 EN ADOPCIÓN 🏠\n{name} busca un hogar\nTipo: {type}\n📍 {city}\n{shareUrl}`.
- `found` → existing "ENCONTRADA" copy (unchanged).
- everything else → existing "PERDIDA" copy (unchanged).

Keep the function pure and unit-tested; add a case, do not restructure the
existing branches.

### Adoption flyer — new variant alongside `PdfFlyerButton`
- Reuse the existing PDF generation + `PhotoBanner` infrastructure (rule: don't
  reinvent). Produce an adoption poster: "EN ADOPCIÓN" header, "Busca hogar",
  name, city, contact, share-link QR.
- Options to settle in the plan: a `variant`/`mode` prop on `PdfFlyerButton` vs a
  thin `AdoptionFlyerButton` wrapper. Prefer the smallest change that keeps the
  lost flyer untouched.
- Copy stays Spanish-only (project decision).

### SharePanel
- The share **message** framing comes for free: `SharePanel` already calls
  `buildWhatsAppMessage` (SharePanel.tsx:79) for its WhatsApp / X / native-share
  text, so the status-aware change above flows through with no SharePanel edit.
- **But** SharePanel has its own hardcoded **poster header** (SharePanel.tsx:378):
  `{pet.status === 'found' ? '¡MASCOTA ENCONTRADA!' : '¡MASCOTA PERDIDA!'}`. This
  needs an `adoption` case (`¡EN ADOPCIÓN!`). It lives in the shareable poster
  image, which is **Spanish-only by project decision** — so this string stays
  Spanish (not i18n'd), consistent with the flyer copy.
- Restored only for `adoption` (relax the PR #94 `shareAvailable` guard for
  `adoption`; still excludes `adopted`).

## i18n (es / en / pt — full parity)

- New keys under the `adoption` namespace (already registered per the prior
  feature; rule #21) for: the "found a home" banner, adoption share button label,
  adoption flyer button label, and any adoption-specific contact copy.
- Reuse existing `pets:detail.*` keys where they already fit (`sendMessage`,
  `loginToContact`, `revealPhone`, `callPhone`, …).
- es/en/pt key sets must match exactly (parity discipline from PRs #85–#90).
- Status labels `pets:status.adoption` / `pets:status.adopted` already exist.

## Testing

- **`buildWhatsAppMessage`** (shared, vitest): `adoption` status yields
  adoption-framed copy and never the "PERDIDA" string; `lost`/`found` unchanged.
- **`AdoptionPetBody`** (web, vitest + RTL):
  - `adoption` → renders message + share; renders phone reveal only when a phone
    exists; hides the message button for the owner viewing their own pet; shows
    the login gate when logged out.
  - `adopted` → renders the success banner; renders **no** contact and **no**
    share.
  - Never renders report-timeline / "add report" / "mark found".
- **`PetDetailPage`**: an `adoption`/`adopted` pet routes to `AdoptionPetBody`;
  a `lost`/`stray` pet still renders the existing body.
- i18n: adoption strings resolve (no raw keys) in es/en/pt.

## Out of scope / future

- Mobile adoption detail redesign (same design, separate cycle).
- An `Adoptado` public success wall / stories cross-over.
- Any adoption analytics event.
