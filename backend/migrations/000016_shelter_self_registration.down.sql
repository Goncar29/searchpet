-- Migration 000016: shelter self-registration (DOWN)

DROP INDEX IF EXISTS idx_shelters_owner_unique;
DROP INDEX IF EXISTS idx_shelters_status;
ALTER TABLE shelters DROP COLUMN IF EXISTS updated_at;
ALTER TABLE shelters DROP COLUMN IF EXISTS pending_website_url;
ALTER TABLE shelters DROP COLUMN IF EXISTS pending_donation_url;
ALTER TABLE shelters DROP COLUMN IF EXISTS rejection_reason;
ALTER TABLE shelters DROP COLUMN IF EXISTS status;
ALTER TABLE shelters DROP COLUMN IF EXISTS owner_user_id;
