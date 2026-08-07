DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'pets'
    ) THEN
        ALTER TABLE pets DROP COLUMN IF EXISTS birth_date_precision;
        ALTER TABLE pets DROP COLUMN IF EXISTS birth_date;
    END IF;
END $$;
