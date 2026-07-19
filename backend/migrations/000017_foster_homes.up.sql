-- Índice GIN para filtrar hogares por tipo de animal (animal_types text[]).
-- Las tablas foster_homes/foster_home_photos/foster_home_moderation_logs/
-- foster_home_change_logs las crea AutoMigrate desde los structs GORM; esta
-- migración agrega lo que AutoMigrate no expresa.
CREATE INDEX IF NOT EXISTS idx_foster_homes_animal_types
	ON foster_homes USING GIN (animal_types);

-- Columna de denuncia hacia un hogar (tercer target polimórfico de reports_abuse).
ALTER TABLE reports_abuse
	ADD COLUMN IF NOT EXISTS target_foster_home_id uuid;

-- Anti-spam: como máximo una denuncia PENDING por (denunciante, hogar).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_abuse_pending_foster_home
	ON reports_abuse (reporter_id, target_foster_home_id)
	WHERE target_foster_home_id IS NOT NULL AND status = 'pending';
