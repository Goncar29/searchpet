# Pet detail page: port the Stitch visual language — design

**Date:** 2026-08-05
**Status:** designed
**Branch:** `feat/web-pet-detail`, based on `feat/web-design-tokens` (PR #126)
**Design source:** `stitch_localizador_de_mascotas_perdidas/detalle_de_mascota_holly/` (gitignored reference material)

## Problem

`PetDetailPage.tsx` predates the Stitch design language. It still uses the old typography scale,
ad-hoc card styles and emoji glyphs, so a user moving from the redesigned home to a pet's page
crosses a visible seam. Two defects also live in the page today, both present in `origin/main`:

```
PetDetailPage.tsx:213   ¡Esta mascota fue encontrada!
PetDetailPage.tsx:301   ¿Confirmás que {pet.name} fue encontrada? Esta acción no se puede deshacer.
```

Neither goes through i18n. An English or Portuguese user reads Spanish, and the second string is
the confirmation for an **irreversible** action. This is the same failure mode as the `aria-label`
found while fixing the story-likes E2E: a hardcoded Spanish string that no test can object to,
because asserting on it would only pin the bug in place.

## The contract this redesign runs under

Carried over from the home redesign, unchanged:

- **The design rules the visuals** — structure, layout, typography, spacing, radii, icons.
- **The code rules the function** — routes, links, components, hooks, i18n, privacy rules.
- A mockup with fewer elements is an **incomplete mockup, not an instruction to delete**.
- The orange `#C24E1A` palette stays. The design's teal is not adopted.
- **Responsive is a hard requirement**, with the phone as the primary case.

The Stitch screen mocks exactly one situation: a lost dog that has an owner. The real page also
serves strays (`owner_id` nullable, `reporter_id` instead), adoptions, found pets, the owner's own
view, and visitors without a session. None of that is visible in the mockup and none of it is
dropped.

## Decisions

### 1. Hero: `object-contain` over a blurred backdrop

The design paints the photo edge to edge with the name on top. The page currently uses
`object-contain` **on purpose**: pet photos arrive in arbitrary orientations, and cropping is worst
precisely where it matters most — a vertical photo of a cat loses its head or its paws, on the one
page whose job is to let someone recognise that animal.

The hero renders the photo twice: a scaled, blurred copy fills the frame, and the real photo sits
on top, whole and uncropped. The design's filled frame is preserved without losing a pixel of the
animal. A dark scrim under the text block guarantees the name stays legible over an arbitrary user
photo — the same reasoning as the `StoryCard` scrim.

Rejected: `object-cover` (matches the mockup, crops the pet) and leaving the gallery untouched
(zero risk, but then the hero is not ported at all).

### 2. Status badge stays derived, never literal

The mockup shows `LOST (URGENTE)`. Statuses come from `domain/pet_status.go` — seven of them —
and the label must be `t('pets:status.<status>')` (rule #13). The literal is not ported. The
`found` banner keeps its position but its text moves into i18n.

### 3. Contact stays behind `RevealContact`

The mockup shows a green **Show phone** button that exposes the number directly. The phone is only
revealed on contact (rule #3). The existing `RevealContact` component keeps its behaviour and takes
the design's button shape. The mockup's `Log in to contact` maps to the state the page already
renders for a visitor without a session.

### 4. The "Want to contribute?" card is not ported

The mockup floats an open-source promo card linking to GitHub in the sidebar. It does not exist in
the app, and it puts an **off-site link on the one page whose job is to reunite a pet with its
family**. Porting it would be adding a feature under the cover of a restyle. The design does not
get to remove elements, and it does not get to add them either.

The footer is likewise not ported: `MainLayout` owns it.

### 5. Optional fields render conditionally

The design shows three fact cards — Type / Breed / Color. `Breed` and `Color` are optional and can
be explicitly emptied (rule #22). Only cards with a value render, so a pet with no breed recorded
does not show an empty box with a heading.

## Layout

| Region | Desktop | Mobile |
|---|---|---|
| Hero | full width, photo + overlaid name/subtitle, gallery controls over the scrim | same, shorter |
| Fact cards | 3 columns | 1 column |
| Description + actions | left column | full width |
| Report history | left column, vertical timeline | full width |
| Contact sidebar | right column, sticky | stacked below the description |

`SharePanel`, `PdfFlyerButton`, `TimelineMap`, `RevealContact` and `AdoptionPetBody` are restyled
in place, never rewritten. The owner/reporter distinction, the mark-as-found flow with its
confirmation and story nudge, and the abuse-report menu all keep their current behaviour.

## Verification

1. `pnpm test:run` — `PetDetailPage.test.tsx` exists and is extended to cover the conditional fact
   cards and the i18n of the two strings being fixed.
2. `pnpm run build` — vitest does not typecheck; the build does.
3. **Playwright, from the start and not at the end.** The story-likes failure showed that the unit
   suite passes while the app is broken in a real browser: 427 unit tests went green across three
   branches that the E2E caught. Local recipe: recreate `lostpets_test`, backend on `:8080` with the
   CI job's env, `VITE_API_URL=http://localhost:8080 pnpm run build`, `pnpm run preview` (:4173),
   then `API_URL=http://localhost:8080 npx playwright test`.
4. Horizontal overflow measured at 375 and 1280 with Playwright, without `overflow-x-hidden`.
5. The two i18n fixes are verified by switching the app to English and reading the strings, not by
   asserting the Spanish text — asserting it is what kept the bug alive.

## Open questions

None blocking. If the branch grows past 400 changed lines it is split following the same stacked
approach as the home redesign.

## Notes for whoever picks this up

- The branch is based on `feat/web-design-tokens` (PR #126) because the page needs `Icon` and the
  `@theme` tokens — and nothing from `StoryCard` or the redesigned `HomePage`. If #126 lands on
  `main` by squash, rebase onto `main` before opening the PR: squashed commits are not ancestors,
  and a branch cut from the pre-squash tip re-proposes the whole feature (rule #30).
- The Stitch export lives in a gitignored directory. It is reference material, never a dependency.
