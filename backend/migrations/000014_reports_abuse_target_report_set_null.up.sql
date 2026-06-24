-- Migration 000014 UP: make report_abuses.target_report_id FK cascade to NULL
-- when its target report is deleted.
--
-- Rationale: admin moderation (DELETE /api/admin/reports/:id) hard-deletes a
-- report. AutoMigrate creates the FK report_abuses.target_report_id -> reports(id)
-- with the default ON DELETE NO ACTION, so deleting a report that an abuse report
-- points at fails with a FK violation (surfaced as a 500). An abuse report is an
-- audit record and must survive the deletion, just with a null target.
--
-- Runs after AutoMigrate has already created the report_abuses table and the FK
-- (main.go order: Connect -> RunAutoMigrate -> RunMigrations). We drop whatever
-- FK currently constrains target_report_id (by column, name-agnostic) and re-add
-- it with the exact name GORM expects (fk_report_abuses_target_report) so a later
-- AutoMigrate sees it and does NOT create a second NO ACTION duplicate.
--
-- NOTE: the GORM table name is report_abuses (default pluralization of the
-- ReportAbuse model — no TableName override), not reports_abuse.
DO $$
DECLARE
  conname text;
BEGIN
  SELECT con.conname INTO conname
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ANY (con.conkey)
  WHERE rel.relname = 'report_abuses'
    AND con.contype = 'f'
    AND att.attname = 'target_report_id'
  LIMIT 1;

  IF conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE report_abuses DROP CONSTRAINT %I', conname);
  END IF;
END $$;

ALTER TABLE report_abuses
  ADD CONSTRAINT fk_report_abuses_target_report
  FOREIGN KEY (target_report_id) REFERENCES reports (id) ON DELETE SET NULL;
