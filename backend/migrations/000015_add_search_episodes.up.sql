-- search_episodes: one continuous search per pet (opens on lost/stray, closes on resolution).
CREATE TABLE IF NOT EXISTS search_episodes (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    pet_id      uuid NOT NULL REFERENCES pets (id) ON DELETE CASCADE,
    started_at  timestamptz NOT NULL DEFAULT now(),
    ended_at    timestamptz,
    resolution  varchar(50)
);

CREATE INDEX IF NOT EXISTS idx_search_episodes_pet_started
    ON search_episodes (pet_id, started_at DESC);

-- AutoMigrate runs BEFORE this SQL migration and creates search_episodes from the
-- struct WITHOUT the pet_id FK or the started_at default (so the inline CREATE TABLE
-- clauses above are a no-op on any real deploy). Apply them idempotently here.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_search_episodes_pet'
    ) THEN
        ALTER TABLE search_episodes
            ADD CONSTRAINT fk_search_episodes_pet
            FOREIGN KEY (pet_id) REFERENCES pets (id) ON DELETE CASCADE;
    END IF;
END $$;

ALTER TABLE search_episodes ALTER COLUMN started_at SET DEFAULT now();

-- reports.episode_id: which episode a report belongs to. SET NULL on episode delete
-- so reports survive (consistent with the report_abuses FK pattern in 000014).
ALTER TABLE reports
    ADD COLUMN IF NOT EXISTS episode_id uuid;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_reports_episode'
    ) THEN
        ALTER TABLE reports
            ADD CONSTRAINT fk_reports_episode
            FOREIGN KEY (episode_id) REFERENCES search_episodes (id) ON DELETE SET NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_reports_episode_id ON reports (episode_id);

-- pets.current_episode_id: pointer to the most-recently-opened episode. Used by
-- FindNearby to show only the current episode's reports.
ALTER TABLE pets
    ADD COLUMN IF NOT EXISTS current_episode_id uuid;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_pets_current_episode'
    ) THEN
        ALTER TABLE pets
            ADD CONSTRAINT fk_pets_current_episode
            FOREIGN KEY (current_episode_id) REFERENCES search_episodes (id) ON DELETE SET NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_pets_current_episode_id ON pets (current_episode_id);

-- ── Backfill for pre-existing data ──────────────────────────────────────────
-- FindNearby now filters `reports.episode_id = pets.current_episode_id`, and in
-- SQL `NULL = NULL` is never true. Without this backfill every pet that existed
-- before this migration — and all of its reports — would silently disappear from
-- the map. Create one episode per currently map-visible pet, point
-- current_episode_id at it, and stamp that pet's reports. Every statement is
-- guarded (current_episode_id IS NULL / episode_id IS NULL) so the backfill is
-- idempotent and never disturbs pets that already have an episode.

-- Open episodes for pets in an active search (lost/stray).
INSERT INTO search_episodes (id, pet_id, started_at)
SELECT gen_random_uuid(), p.id, COALESCE(p.updated_at, p.created_at, now())
FROM pets p
WHERE p.status IN ('lost', 'stray') AND p.current_episode_id IS NULL;

-- Closed episodes for found pets (still map-visible; their search is resolved).
INSERT INTO search_episodes (id, pet_id, started_at, ended_at, resolution)
SELECT gen_random_uuid(), p.id, COALESCE(p.created_at, now()), COALESCE(p.updated_at, now()), 'found'
FROM pets p
WHERE p.status = 'found' AND p.current_episode_id IS NULL;

-- Point each backfilled pet at its (single) freshly created episode.
UPDATE pets p
SET current_episode_id = se.id
FROM search_episodes se
WHERE se.pet_id = p.id
  AND p.status IN ('lost', 'stray', 'found')
  AND p.current_episode_id IS NULL;

-- Stamp existing reports with their pet's current episode.
UPDATE reports r
SET episode_id = p.current_episode_id
FROM pets p
WHERE p.id = r.pet_id
  AND p.current_episode_id IS NOT NULL
  AND r.episode_id IS NULL;
