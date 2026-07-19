DROP INDEX IF EXISTS uniq_abuse_pending_foster_home;
ALTER TABLE report_abuses DROP COLUMN IF EXISTS target_foster_home_id;
DROP INDEX IF EXISTS idx_foster_homes_animal_types;
