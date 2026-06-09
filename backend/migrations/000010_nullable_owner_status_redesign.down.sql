-- Migration 000010 DOWN: reverse status redesign and schema changes.
-- WARNING: ALTER COLUMN owner_id SET NOT NULL will FAIL if any stray pets
-- (with NULL owner_id) exist in the database. Remove them first.

DROP INDEX IF EXISTS idx_pets_status_created;

ALTER TABLE pets DROP COLUMN IF EXISTS version;

ALTER TABLE pets DROP COLUMN IF EXISTS reporter_id;

UPDATE pets SET status = 'active' WHERE status = 'registered';

ALTER TABLE pets ALTER COLUMN owner_id SET NOT NULL;
