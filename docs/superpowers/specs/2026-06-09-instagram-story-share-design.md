# Design: Instagram Story Share + Flyer Photo Banner Redesign

## Context

Instagram has no web share intent for posting (unlike Facebook/X). The current
"Instagram" button in `SharePanel.tsx` (web) falls back to
`navigator.share({ url, text })`, which on mobile opens the native share sheet
but Instagram only accepts it as a direct message link — not as a Story.

Goal: let users generate an image with the lost-pet content (photo, key data,
QR/link to the pet's `SharedPetPage`) and share it directly to Instagram
Stories from the web app. While redesigning that image, also fix a known issue
in the existing PDF flyer: the pet photo sits in a small fixed 220x220 box,
under-using the A4 page, and depending on the photo's aspect ratio it can look
cramped or crop out parts of the animal.

## Part 1: Flyer redesign (`PdfFlyerButton.tsx`)

Reorder the hidden A4 template (the one captured by `html2canvas`) to:

1. Header badge (`¡MASCOTA PERDIDA!` / `¡ENCONTRADA!`) — unchanged
2. **Photo banner** — full width within the existing page margins, **4:3**
   aspect ratio, `object-fit: contain` on a **white background**. The photo
   keeps its original aspect ratio (no cropping) regardless of whether the
   source image is portrait, landscape, or square — any leftover space in the
   4:3 box is filled with white (pillarbox/letterbox).
3. Title (pet name, `<h1>`) + data table (type, breed, color, last seen) —
   same content/order as today, now placed below the photo instead of beside it
4. Description — unchanged
5. Footer (QR + share URL + branding) — unchanged

This "photo banner" treatment (4:3 box, `object-fit: contain`, white fill) is
the shared **format convention** reused by the Story image in Part 2.

If `pet.photos` has no primary photo, keep the existing 🐾 placeholder, sized
to fill the same 4:3 banner box.

## Part 2: Instagram Story share (`SharePanel.tsx`)

Replace the current Instagram button entirely. New behavior:

### Image generation

- A new hidden `<div>` template, sized for a 9:16 Story (540x960px,
  captured with `html2canvas` at `scale: 2` → 1080x1920 output), following
  the same generation pattern as `PdfFlyerButton` (dynamic `import('html2canvas')`,
  `useCORS: true` for Cloudinary photos, fallback retry without images on CORS
  failure).
- Layout (top to bottom):
  1. Header badge (`¡MASCOTA PERDIDA!` / `¡ENCONTRADA!`)
  2. Photo banner — same format convention as the flyer: 4:3 box,
     `object-fit: contain`, white background
  3. Pet name (title) + key data table (type, breed, color, last seen)
  4. Footer block: QR code (pointing at `shareLink.share_url`, i.e. the pet's
     `SharedPetPage`) + "Escaneá para ayudar" + `searchpet.app` branding text
- Output: `canvas.toBlob()` → `File` (PNG, named `story-${pet.name}.png`)
- The share link must already exist (`shareLink` state in `SharePanel`,
  generated on panel open as it is today) since the QR encodes
  `shareLink.share_url`.

### Sharing flow

- **Mobile (Web Share API with files supported)**: if
  `navigator.canShare?.({ files: [file] })` returns `true`, call
  `navigator.share({ files: [file], text: caption })`. This opens the native
  share sheet, where Instagram (Stories) appears as a target if installed.
  - `caption` reuses the existing `message` built via `buildWhatsAppMessage(pet, shareLink.share_url)`.
  - If the user cancels the share sheet (`AbortError`), do nothing (no error
    shown).
  - Any other error during `navigator.share` falls back to the desktop
    download behavior below.
- **Desktop (no file-sharing support)**: trigger a direct download of the
  generated PNG (`story-${pet.name}.png`), then show an inline message (same
  visual pattern as the existing `copied` state text) reading something like
  "Imagen descargada — subila como Historia desde tu celular 📲".

### Error handling

- If `html2canvas`/blob generation itself fails, fall back to the same
  download-with-message path (best effort — don't block the user).

## Affected files

- `frontend/packages/web/src/components/PdfFlyerButton.tsx` — reorder hidden
  template layout (photo banner full-width 4:3 contain+white, moved above
  title/table)
- `frontend/packages/web/src/components/SharePanel.tsx` — new hidden Story
  template + image generation + share/download logic; remove old Instagram
  `navigator.share({url, text})` handler
- `frontend/packages/web/src/components/PdfFlyerButton.test.tsx` /
  `SharePanel` tests (if present) — updated for new layout/behavior
- `frontend/packages/web/src/pages/PetDetailPage.test.tsx` — verify no
  regressions from flyer layout change

## Out of scope

- Native mobile (Expo) Instagram Stories deep link (`instagram-stories://share`)
  — explicitly deferred, to be handled separately
- Direct Instagram feed posting (requires Graph API + business account + app
  review — not pursued)
- Backend changes — everything here is client-side image generation
