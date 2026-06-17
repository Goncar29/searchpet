-- Migration 000013 DOWN: restore NOT NULL on location_alerts.pet_id.
-- WARNING: ALTER COLUMN pet_id SET NOT NULL will FAIL if any zone alerts
-- (with NULL pet_id) exist in the database. Remove them first.

ALTER TABLE location_alerts ALTER COLUMN pet_id SET NOT NULL;
