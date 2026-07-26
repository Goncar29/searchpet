DROP INDEX IF EXISTS uniq_users_google_id;

ALTER TABLE users
	DROP COLUMN IF EXISTS google_id;

-- Restoring NOT NULL only works if no password-less user survived. Backfill a
-- non-usable placeholder first so the rollback cannot fail mid-way; bcrypt
-- comparison against this value always fails, exactly like the empty string.
UPDATE users SET password_hash = '' WHERE password_hash IS NULL;

ALTER TABLE users
	ALTER COLUMN password_hash SET NOT NULL;
