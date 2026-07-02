ALTER TABLE pets DROP CONSTRAINT IF EXISTS fk_pets_current_episode;
DROP INDEX IF EXISTS idx_pets_current_episode_id;
ALTER TABLE pets DROP COLUMN IF EXISTS current_episode_id;

ALTER TABLE reports DROP CONSTRAINT IF EXISTS fk_reports_episode;
DROP INDEX IF EXISTS idx_reports_episode_id;
ALTER TABLE reports DROP COLUMN IF EXISTS episode_id;

DROP INDEX IF EXISTS idx_search_episodes_pet_started;
DROP TABLE IF EXISTS search_episodes;
