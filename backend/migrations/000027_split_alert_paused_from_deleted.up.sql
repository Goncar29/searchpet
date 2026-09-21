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
-- La guarda FALLA CERRADO a proposito. La version anterior hacia un no-op
-- silencioso si la columna no estaba, y eso es lo peor que podria pasar:
-- golang-migrate igual registra la version 27, el backfill NO se puede
-- reintentar, y en el arranque siguiente AutoMigrate crea `deleted_at` toda en
-- NULL. Resultado: cada alerta que un usuario borro alguna vez REAPARECE en su
-- lista como pausada — exactamente el desenlace que el comentario de arriba
-- llama peor que el bug.
--
-- En nuestro despliegue la columna siempre existe (AutoMigrate corre antes, y
-- `main.go` hace `log.Fatal` si falla), asi que esta guarda es para el entorno
-- que NO es el nuestro. Justamente por eso tiene que frenar el deploy en vez de
-- saltearse en silencio.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'location_alerts' AND column_name = 'deleted_at') THEN
        RAISE EXCEPTION 'location_alerts.deleted_at no existe: corre AutoMigrate antes de esta migracion, o el backfill se pierde en silencio';
    END IF;

    UPDATE location_alerts
       SET deleted_at = NOW()
     WHERE is_active = false
       AND deleted_at IS NULL;
END $$;
