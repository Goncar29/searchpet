-- Migration 000016: shelter self-registration (UP)
-- Order-agnostic on purpose: prod runs SQL migrations BEFORE AutoMigrate
-- (columns must be added here), testdb runs AutoMigrate FIRST (the ADD COLUMN
-- IF NOT EXISTS calls become no-ops). Idempotent either way.

ALTER TABLE shelters ADD COLUMN IF NOT EXISTS owner_user_id UUID;
ALTER TABLE shelters ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'pending';
ALTER TABLE shelters ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
ALTER TABLE shelters ADD COLUMN IF NOT EXISTS pending_donation_url VARCHAR(500);
ALTER TABLE shelters ADD COLUMN IF NOT EXISTS pending_website_url VARCHAR(500);
ALTER TABLE shelters ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

-- Grandfather: every pre-existing shelter was hand-vetted by an admin.
UPDATE shelters SET status = 'approved' WHERE owner_user_id IS NULL AND status = 'pending';
UPDATE shelters SET updated_at = created_at WHERE updated_at IS NULL;

-- Same name GORM would generate for the `index` tag, so AutoMigrate never duplicates it.
CREATE INDEX IF NOT EXISTS idx_shelters_status ON shelters(status);

-- One shelter per account. Partial: seed/admin shelters (owner NULL) are unlimited.
-- AutoMigrate cannot express partial unique indexes — this is why the migration exists.
CREATE UNIQUE INDEX IF NOT EXISTS idx_shelters_owner_unique
	ON shelters(owner_user_id) WHERE owner_user_id IS NOT NULL;
