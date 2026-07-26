-- Migration 000018: Google Sign-In (UP)
-- Order-agnostic on purpose: prod runs SQL migrations BEFORE AutoMigrate,
-- testdb runs AutoMigrate FIRST (the ADD COLUMN IF NOT EXISTS becomes a no-op
-- and leaves a nullable column with no default). Idempotent either way.

-- A Google-only user has no password. AutoMigrate never DROPS a NOT NULL it
-- didn't ask for, so this has to happen here — and the `not null` also had to
-- leave the struct tag, or AutoMigrate would re-impose it afterwards in prod.
ALTER TABLE users
	ALTER COLUMN password_hash DROP NOT NULL;

ALTER TABLE users
	ADD COLUMN IF NOT EXISTS google_id VARCHAR(255);

-- Applied unconditionally: when AutoMigrate created the column first, the
-- ADD COLUMN above is a no-op and THESE are what impose the constraint. That
-- keeps the test schema identical to prod instead of quietly weaker.
UPDATE users SET google_id = '' WHERE google_id IS NULL;

ALTER TABLE users
	ALTER COLUMN google_id SET DEFAULT '';

ALTER TABLE users
	ALTER COLUMN google_id SET NOT NULL;

-- PARTIAL unique index: one account per Google `sub`, while every user without
-- Google keeps the shared empty value. A plain UNIQUE index would reject the
-- second password-only registration.
-- Named uniq_* so it never collides with GORM's idx_users_google_id.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_users_google_id
	ON users (google_id)
	WHERE google_id <> '';
