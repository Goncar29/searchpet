-- Indice para las dos queries del cupo diario de recuperacion de contrasena
-- (CountSince por usuario y global). Los indices que ya existen son sobre
-- user_id, used y expires_at: ninguno sirve para filtrar por channel + created_at.
--
-- Guarda de tabla por la regla #35: RunMigrations corre ANTES que RunAutoMigrate
-- (pkg/database/postgres.go), asi que en una base limpia este archivo se ejecuta
-- cuando GORM todavia no creo verification_tokens. CREATE INDEX IF NOT EXISTS
-- protege el INDICE, no la tabla.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'verification_tokens'
    ) THEN
        CREATE INDEX IF NOT EXISTS idx_verification_tokens_channel_created_at
            ON verification_tokens (channel, created_at);
    END IF;
END $$;
