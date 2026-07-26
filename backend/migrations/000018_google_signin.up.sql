-- Google Sign-In: users may now exist without a password, and may be linked to
-- a Google account by its stable `sub` claim.

-- A Google-only user has no password. AutoMigrate cannot drop an existing
-- NOT NULL, so it is dropped here (migrations run BEFORE AutoMigrate).
ALTER TABLE users
	ALTER COLUMN password_hash DROP NOT NULL;

-- AutoMigrate would also add this column, but doing it here guarantees the
-- NOT NULL DEFAULT '' so existing rows never hold NULL (scanning NULL into a
-- non-pointer Go string fails).
ALTER TABLE users
	ADD COLUMN IF NOT EXISTS google_id VARCHAR(255) NOT NULL DEFAULT '';

-- PARTIAL unique index: one account per Google `sub`, while every user without
-- Google keeps the shared empty value. A plain UNIQUE index would reject the
-- second password-only registration.
-- Named uniq_* so it never collides with GORM's idx_users_google_id.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_users_google_id
	ON users (google_id)
	WHERE google_id <> '';
