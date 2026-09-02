-- Una mascota, una historia — garantizado por la base y no sólo por el service.
--
-- POR QUÉ PARCIAL Y NO UN `uniqueIndex` EN EL TAG DE GORM, que es la forma obvia
-- y habría creado un bug: las historias se borran en LÓGICO
-- (`Delete` hace `UpdateColumn("deleted_at", now)`, la fila queda), y
-- `GetByPetID` filtra `deleted_at IS NULL`. Con un índice único PLANO sobre
-- pet_id, el flujo sería:
--
--   1. un admin borra la historia de una mascota  -> la fila sobrevive
--   2. el dueño intenta contar una nueva
--   3. el service llama GetByPetID, NO la ve, y lo deja seguir
--   4. el INSERT choca con el índice -> error de Postgres -> 500 genérico
--
-- O sea: el usuario escribe su historia entera y la pierde con un "ocurrió un
-- error inesperado", sin saber qué pasó. Es la regla #34 con otro disfraz — un
-- error de base que el handler colapsa y que nadie puede diagnosticar desde
-- afuera.
--
-- La condición del índice tiene que ser LA MISMA que la del service. Con
-- `WHERE deleted_at IS NULL` los dos hablan de lo mismo: "historia viva".
--
-- Va con guarda de tabla porque RunMigrations corre ANTES de RunAutoMigrate
-- (pkg/database/postgres.go): en una base nueva este archivo se ejecuta antes de
-- que GORM haya creado success_stories (regla #35).
--
-- Seguro de aplicar: producción tenía CERO historias al momento de escribir esto
-- —verificado por dos vías, el header `x-total-count` y el cuerpo de
-- GET /api/stories— así que no hay filas que puedan violarlo. Un índice único
-- sobre datos con duplicados haría fallar la migración y con ella el deploy.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'success_stories'
    ) THEN
        CREATE UNIQUE INDEX IF NOT EXISTS uniq_success_stories_pet_alive
            ON success_stories (pet_id)
            WHERE deleted_at IS NULL;
    END IF;
END $$;
