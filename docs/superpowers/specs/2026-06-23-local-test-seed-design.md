# Local Test Seed — Design

**Date:** 2026-06-23
**Status:** Approved (pending spec review)
**Branch:** `feat/local-test-seed`

## Goal

Provide a single, repeatable command that populates a **local** database with a
rich, realistic dataset so the team can exercise the whole app at once and surface
inconsistencies — including the never-tested **admin role** and the image-search
(`#2`) self-match issue.

## Motivation

Today there is no seed. Local testing means manually creating users, pets, and
reports, which is slow and never reproduces edge cases consistently. Three concrete
needs drive this:

1. **General dataset** — enough variety to click through the app and spot UI/UX
   inconsistencies.
2. **Edge cases** — pets with/without description, with/without photo, every status,
   blocked users, etc., to stress the inconsistencies on purpose.
3. **Image search (`#2`)** — pets with real photos whose embeddings are indexed
   locally, so the "same photo should be ~100%" self-match can be reproduced.
4. **Admin role** — a known admin account to test admin-only screens (success
   stories moderation, abuse reports, local groups).

### Note on the `#2` root-cause hypothesis

Both the index path (`EmbeddingService.GenerateEmbeddingFromURL` → fetches the
photo URL → `GenerateEmbedding` → `downscaleForEmbedding`) and the query path
(`SearchSimilar` → `GenerateEmbedding` → `downscaleForEmbedding`) share the same
embedding code. The only divergence is the **input bytes**: indexing embeds the
bytes served at the photo URL; querying embeds the bytes the user uploads. If the
hosting layer (Cloudinary) re-encodes the stored image, the two byte streams
differ and the same logical photo yields different vectors — explaining a
self-match below ~100%. This seed makes that reproducible: it indexes from a
stable public URL, and the self-match test queries with the bytes downloaded from
that exact URL.

## Approach

A standalone Go command, `backend/cmd/seed`, mirroring the existing
`backend/cmd/import-vets` pattern (connects to `DATABASE_URL`, performs idempotent
upserts, safe to re-run).

**Rejected alternative — SQL seed file:** cannot generate Jina embeddings (those
require Go calls to the embedding provider), so it cannot satisfy need #3. A Go
command can reuse the production `EmbeddingService`, which is also what makes the
seed faithful for diagnosing `#2`.

## What the seed creates

All records use **fixed UUIDs / emails** so re-running upserts rather than
duplicating. Passwords are bcrypt-hashed via the existing auth path/util.

### Users
- **1 admin** — `is_admin = true`, known credentials (e.g. `admin@searchpet.local`
  / a documented password), to test admin screens and endpoints.
- **Several normal users** — a mix of verified and unverified.
- **One blocked pair** — two users with a `blocked_users` relationship, to test the
  bidirectional block detection in chat.

### Pets
Coverage across every `PetStatus` (`registered`, `lost`, `stray`, `found`,
`archived`) and these edge combinations:
- with and without `description`
- with and without `breed` / `color`
- with and without photos
- owned (`owner_id`) and ownerless **stray** (`reporter_id`, no owner)

### Reports
- PostGIS coordinates spread around Montevideo (`-34.9011, -56.1645`).
- Varied `occurred_at` / `created_at` dates to exercise the timeline.
- Mixed statuses (`lost`, `found`, `sighting`) and mixed presence of
  `location_description`.

### Image-search data (`#2`)
- A few `lost`/`stray` pets whose photos point to **stable public image URLs**
  (constants in the command).
- When run with `--with-embeddings`, the seed generates their embeddings via
  `EmbeddingService.BackfillAll` (the same production index path the reindex
  endpoint uses) and stores them in `pet_embeddings`.
- **Self-match test procedure (documented, manual):** download the image from the
  same URL and upload it via the app's photo search — it must return that pet at a
  high similarity. A low score points at the byte-divergence hypothesis above.

### Community / edge extras
- One `blocked_users` pair (see Users).
- One `reports_abuse` row.
- One `local_group` + one `group_member`.
- One `success_story` (so the admin can moderate/feature it).
- `user_points` / `badges` for at least one user.

## Idempotency & execution

- **Idempotent** via fixed identifiers (upsert on conflict). Re-running is safe and
  converges to the same dataset.
- **`--reset` flag** (optional): deletes the seed-managed rows before inserting, for
  a clean slate.
- **`--with-embeddings` flag** (optional): the only path that calls Jina (see
  Dependencies). A normal seed never touches the network.
- **Makefile target** `make seed` (pass `ARGS=--reset` / `ARGS=--with-embeddings`)
  runs `go run ./backend/cmd/seed`.
- Reads `DATABASE_URL` (falls back to the local docker-compose default for
  `lostpets`).

## Dependencies & constraints

- **Embeddings are opt-in.** Jina's free tier is tied to a **single shared key**
  (the same one used in prod — a newly created key is not free). So a normal seed
  must never call Jina: embedding generation runs only behind a `--with-embeddings`
  flag **and** only when `JINA_API_KEY` is set; otherwise it is skipped (the
  general/edge-case seed always works offline). The seed indexes just 2 photos, so
  the draw on the shared quota is negligible.
- Requires the local Postgres+PostGIS container running (docker-compose), with
  `AutoMigrate` already applied (i.e. run the server once, or rely on the seed
  connecting after migrations).
- Local-only by intent. The command should refuse to run against an obviously
  production `DATABASE_URL` (e.g. guard on a `--prod` confirmation or host check) —
  to be detailed in the plan.

## Testing

- Unit-test the pure data-builder helpers (fixture construction) where practical.
- The embedding step is integration-only (needs Jina) and is exercised manually.
- Follow the project's Go testing conventions (`go test ./...`).

## Out of scope

- Seeding production or staging.
- Cloudinary uploads (image-search photos use public URLs, not Cloudinary).
- Fixing `#2` itself — this seed only makes it reproducible; the fix is a separate
  change.
- Frontend changes.
