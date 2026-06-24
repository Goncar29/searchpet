-- Migration 000014 DOWN: revert report_abuses.target_report_id FK to the GORM
-- default (ON DELETE NO ACTION). Keeps the same constraint name so AutoMigrate
-- continues to recognize it.
ALTER TABLE report_abuses DROP CONSTRAINT IF EXISTS fk_report_abuses_target_report;

ALTER TABLE report_abuses
  ADD CONSTRAINT fk_report_abuses_target_report
  FOREIGN KEY (target_report_id) REFERENCES reports (id);
