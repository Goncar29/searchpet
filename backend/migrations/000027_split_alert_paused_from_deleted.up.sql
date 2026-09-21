-- Separa "pausada" de "borrada" en location_alerts.
--
-- La columna `deleted_at` NO se crea acá: la crea AutoMigrate desde el tag del
-- struct, que corre ANTES que estas migraciones (regla #35). Esta migración
-- hace lo único que AutoMigrate no puede hacer, que es decidir qué significan
-- las filas que ya existen.
--
-- POR QUE TODAS LAS `is_active = false` SE TRATAN COMO BORRADAS:
--
-- Hasta ahora `Delete` era `UPDATE ... SET is_active = false`, el mismo estado
-- que produce pausar desde el interruptor, y `GetByUserID` filtraba por esa
-- columna. O sea que esas filas hoy son invisibles e irrecuperables para su
-- dueño, hayan venido de un borrado o de una pausa.
--
-- Marcarlas borradas PRESERVA ese comportamiento. Dejarlas como pausadas haría
-- reaparecer en la lista de cada usuario todo lo que alguna vez borró a
-- proposito, que es peor que el bug que estamos arreglando.
--
-- Cual fue pausa y cual fue borrado no se puede saber: esa informacion nunca se
-- guardo. Es el costo de que una columna cargara dos conceptos.
--
-- La guarda de tabla y de columna existe porque esta migracion puede correr
-- antes que AutoMigrate en un entorno que no sea el nuestro.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name = 'location_alerts' AND column_name = 'deleted_at') THEN
        UPDATE location_alerts
           SET deleted_at = NOW()
         WHERE is_active = false
           AND deleted_at IS NULL;
    END IF;
END $$;
