-- Migration 000014 DOWN: revert reports_abuse.target_report_id FK to the GORM
-- default (ON DELETE NO ACTION). Keeps the same constraint name so AutoMigrate
-- continues to recognize it.
ALTER TABLE reports_abuse DROP CONSTRAINT IF EXISTS fk_reports_abuse_target_report;

ALTER TABLE reports_abuse
  ADD CONSTRAINT fk_reports_abuse_target_report
  FOREIGN KEY (target_report_id) REFERENCES reports (id);
