-- Migration: 000006_seed_shelters (DOWN)
-- Elimina los 3 refugios seeded por UUIDs deterministas.

DELETE FROM shelters
WHERE id IN (
  'a1b2c3d4-0001-0001-0001-000000000001',
  'a1b2c3d4-0002-0002-0002-000000000002',
  'a1b2c3d4-0003-0003-0003-000000000003'
);
