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
