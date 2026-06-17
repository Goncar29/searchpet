-- Migration 000013: make location_alerts.pet_id nullable.
-- Zone alerts have no associated pet (pet_id is NULL); the domain model already
-- declares PetID as *uuid.UUID. On databases whose location_alerts table was
-- created before PetID became a pointer, the column was left NOT NULL and every
-- CreateAlert fails with SQLSTATE 23502. GORM AutoMigrate does not relax an
-- existing NOT NULL, so this migration fixes those environments explicitly.
-- Idempotent: DROP NOT NULL on an already-nullable column is a no-op.

ALTER TABLE location_alerts ALTER COLUMN pet_id DROP NOT NULL;
