-- Migration 000019: búsqueda de usuarios por email insensible a mayúsculas (UP)
-- Order-agnostic on purpose: prod corre las migraciones SQL ANTES de AutoMigrate,
-- testdb corre AutoMigrate PRIMERO. Este índice no depende de columnas nuevas,
-- así que es idempotente en cualquiera de los dos órdenes.

-- GetByEmail pasó a comparar con LOWER(email) = LOWER(?). Sin este índice
-- funcional esa query degrada a seq scan sobre users, porque el índice único
-- de la columna (case-sensitive) no puede satisfacer la expresión.
--
-- NO es UNIQUE a propósito: ya podrían existir filas que difieren sólo en
-- mayúsculas (Register nunca normalizó), y un índice único fallaría el deploy.
-- La unicidad real la sigue dando el uniqueIndex de la columna; la protección
-- contra duplicados por variante de mayúsculas la aporta el chequeo de Register,
-- que ahora es case-insensitive porque usa este mismo GetByEmail.
CREATE INDEX IF NOT EXISTS idx_users_email_lower
	ON users (LOWER(email));
