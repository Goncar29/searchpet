-- Migration 000010: nullable owner_id, reporter_id, version column, status redesign
-- Drops NOT NULL on owner_id to allow stray pets with no owner.
-- Adds reporter_id for stray pets (the user who reported the stray).
-- Adds version for optimistic concurrency control.
-- Maps legacy "active" status to "registered".
-- Creates composite index for feed queries on status + created_at.

ALTER TABLE pets ALTER COLUMN owner_id DROP NOT NULL;

ALTER TABLE pets ADD COLUMN IF NOT EXISTS reporter_id UUID;

ALTER TABLE pets ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;

UPDATE pets SET status = 'registered' WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_pets_status_created ON pets(status, created_at DESC);
