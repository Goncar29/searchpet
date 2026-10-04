-- pet_helper_credits: who the owner confirmed as helping to reunite a pet.
-- One row per (pet, helper) -- NOT per episode -- so a found -> lost -> found
-- loop can never credit the same helper twice.
--
-- AutoMigrate runs BEFORE this migration (rule #35) and already creates the
-- table, the unique index and the helper index from the struct tags, WITHOUT
-- the foreign keys. The CREATE statements below are therefore no-ops on a real
-- deploy and exist for a database built from SQL alone; the FKs are what this
-- migration really adds. Keep the tags in domain.PetHelperCredit and this file
-- saying the same thing.
CREATE TABLE IF NOT EXISTS pet_helper_credits (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    pet_id          uuid NOT NULL,
    episode_id      uuid,
    helper_user_id  uuid NOT NULL,
    credited_by     uuid NOT NULL,
    credited_at     timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_pet_helper_credits_pet_helper
    ON pet_helper_credits (pet_id, helper_user_id);
CREATE INDEX IF NOT EXISTS idx_pet_helper_credits_helper_user_id
    ON pet_helper_credits (helper_user_id);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_pet_helper_credits_pet') THEN
        ALTER TABLE pet_helper_credits
            ADD CONSTRAINT fk_pet_helper_credits_pet
            FOREIGN KEY (pet_id) REFERENCES pets (id) ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_pet_helper_credits_episode') THEN
        ALTER TABLE pet_helper_credits
            ADD CONSTRAINT fk_pet_helper_credits_episode
            FOREIGN KEY (episode_id) REFERENCES search_episodes (id) ON DELETE SET NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_pet_helper_credits_helper') THEN
        ALTER TABLE pet_helper_credits
            ADD CONSTRAINT fk_pet_helper_credits_helper
            FOREIGN KEY (helper_user_id) REFERENCES users (id) ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_pet_helper_credits_credited_by') THEN
        ALTER TABLE pet_helper_credits
            ADD CONSTRAINT fk_pet_helper_credits_credited_by
            FOREIGN KEY (credited_by) REFERENCES users (id) ON DELETE CASCADE;
    END IF;
END $$;

ALTER TABLE pet_helper_credits ALTER COLUMN credited_at SET DEFAULT now();
