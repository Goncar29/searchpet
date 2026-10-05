-- pet_share_credits: who already earned the share points for a pet. One row
-- per (pet, user), so generating more share links for the same pet never pays
-- twice.
--
-- AutoMigrate runs BEFORE this migration (rule #35) and already creates the
-- table and its composite primary key from the struct tags, WITHOUT the foreign
-- keys. The CREATE below is a no-op on a real deploy and exists for a database
-- built from SQL alone; the FKs are what this migration really adds. Keep the
-- tags in domain.PetShareCredit and this file saying the same thing.
CREATE TABLE IF NOT EXISTS pet_share_credits (
    pet_id       uuid NOT NULL,
    user_id      uuid NOT NULL,
    credited_at  timestamptz,
    PRIMARY KEY (pet_id, user_id)
);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_pet_share_credits_pet') THEN
        ALTER TABLE pet_share_credits
            ADD CONSTRAINT fk_pet_share_credits_pet
            FOREIGN KEY (pet_id) REFERENCES pets (id) ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_pet_share_credits_user') THEN
        ALTER TABLE pet_share_credits
            ADD CONSTRAINT fk_pet_share_credits_user
            FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE;
    END IF;
END $$;

ALTER TABLE pet_share_credits ALTER COLUMN credited_at SET DEFAULT now();
