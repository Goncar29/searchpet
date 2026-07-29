-- IF NOT EXISTS because GORM AutoMigrate also derives this column from the
-- struct field, and both paths run on every deploy.
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;
