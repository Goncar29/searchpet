-- Revierte 000025. El backfill no se deshace porque la columna se va entera:
-- los datos que contenía son derivables de `reports` en cualquier momento.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'pets'
    ) THEN
        ALTER TABLE pets DROP COLUMN IF EXISTS last_reported_at;
    END IF;
END $$;
