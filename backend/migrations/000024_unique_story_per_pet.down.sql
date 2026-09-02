-- Sin guarda de tabla: `DROP INDEX IF EXISTS` ya es un no-op cuando el índice
-- no está, y si la tabla no existe el índice tampoco.
DROP INDEX IF EXISTS uniq_success_stories_pet_alive;
