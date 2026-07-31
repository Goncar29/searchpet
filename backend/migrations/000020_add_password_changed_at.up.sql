-- IF NOT EXISTS because GORM AutoMigrate also derives this column from the
-- struct field, and both paths run on every deploy.
--
-- Guarded on the table existing for the same reason as 000021: RunMigrations runs
-- BEFORE RunAutoMigrate (pkg/database/postgres.go), so on a fresh database this
-- file executes before GORM has created `users` — and ADD COLUMN IF NOT EXISTS
-- guards the COLUMN, not the table, so it still fails with "relation does not
-- exist". The two migrations shipped by this feature must not disagree about
-- whether the guard is needed.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'users'
    ) THEN
        ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;
    END IF;
END $$;
