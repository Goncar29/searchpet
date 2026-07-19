-- Índice GIN para filtrar hogares por tipo de animal (animal_types text[]).
-- Las tablas foster_homes/foster_home_photos/foster_home_moderation_logs/
-- foster_home_change_logs las crea AutoMigrate desde los structs GORM; esta
-- migración agrega lo que AutoMigrate no expresa.
CREATE INDEX IF NOT EXISTS idx_foster_homes_animal_types
	ON foster_homes USING GIN (animal_types);

-- Columna de denuncia hacia un hogar (tercer target polimórfico de report_abuses).
-- NOTA: el nombre de tabla GORM es report_abuses (pluralización de ReportAbuse,
-- sin TableName override), NO reports_abuse — mismo detalle que la migración 000014.
ALTER TABLE report_abuses
	ADD COLUMN IF NOT EXISTS target_foster_home_id uuid;

-- Anti-spam: como máximo una denuncia PENDING por (denunciante, hogar).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_abuse_pending_foster_home
	ON report_abuses (reporter_id, target_foster_home_id)
	WHERE target_foster_home_id IS NOT NULL AND status = 'pending';
