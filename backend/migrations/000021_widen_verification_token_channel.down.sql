-- Narrowing back to VARCHAR(10) cannot succeed while password_reset rows exist,
-- so they are deleted first. They are OTPs with a 10 minute TTL, not durable
-- data: the worst case is that an in-flight reset has to be requested again.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'verification_tokens'
    ) THEN
        DELETE FROM verification_tokens WHERE channel = 'password_reset';
        ALTER TABLE verification_tokens ALTER COLUMN channel TYPE VARCHAR(10);
    END IF;
END $$;
