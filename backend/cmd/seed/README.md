# seed — local test data

Populates a LOCAL database with a rich, idempotent dataset for end-to-end testing.
Refuses to run against a non-local `DATABASE_URL` unless `--force`.

## Run

```bash
make seed                              # idempotent upsert (NO Jina calls)
make seed ARGS=--reset                 # wipe seed-managed rows first
make seed ARGS=--with-embeddings       # also generate image-search embeddings (opt-in)
```

Requires the local Postgres+PostGIS container (`make db-up`). The local DB listens
on port **5433**, and `JWT_SECRET` must be set (any value works locally).

**Image search is opt-in.** Jina's free tier is tied to a single shared key (the
same one used in prod — a new key is not free). A normal `make seed` never calls
Jina. Only `--with-embeddings` does, and only when `JINA_API_KEY` is set; it first
ensures the `vector` extension and `pet_embeddings` table exist, then indexes the
photos. The seed indexes just 2 photos, so the draw on the shared quota is
negligible.

## Accounts

| Role  | Email                   | Password   |
|-------|-------------------------|------------|
| Admin | admin@searchpet.local   | admin1234  |
| User  | ana@searchpet.local     | user1234   |
| User  | bruno@searchpet.local   | user1234   |
| User  | caro@searchpet.local    | user1234   |

`ana` blocks `bruno` (use it to test bidirectional block detection in chat).

## Image-search self-match test (#2)

1. Seed with `make seed ARGS=--with-embeddings` and `JINA_API_KEY` set so embeddings exist.
2. Download the exact photo of a seeded lost/stray pet from its URL (see
   `dogPhotoURL` / `catPhotoURL` in `fixtures.go`).
3. Upload that downloaded file via the app's photo search.
4. Expected: the matching pet appears with high similarity. A low score points at
   index-time vs query-time byte divergence — see
   `docs/superpowers/specs/2026-06-23-local-test-seed-design.md`.
