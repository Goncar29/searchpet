-- The password-reset flow stores channel='password_reset' (14 chars). The column
-- was created as VARCHAR(10) from the old struct tag, so every insert failed with
-- SQLSTATE 22001. RequestReset swallows that error on purpose (enumeration
-- defence), so /auth/password/forgot answered 200 and never minted a token: the
-- whole feature was a silent no-op on any real database.
--
-- Guarded on the table existing because RunMigrations runs BEFORE RunAutoMigrate
-- (pkg/database/postgres.go): on a fresh database this file executes before GORM
-- has created verification_tokens, and there the width comes from the struct tag.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'verification_tokens'
    ) THEN
        ALTER TABLE verification_tokens ALTER COLUMN channel TYPE VARCHAR(20);
    END IF;
END $$;
