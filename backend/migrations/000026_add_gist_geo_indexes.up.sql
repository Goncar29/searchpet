-- Índices GiST para las consultas geográficas.
--
-- Hasta acá no había NINGUNO: cada ST_DWithin escaneaba la tabla entera.
-- Medido en local con 60.000 reports sembrados sobre el área de Uruguay,
-- consultando un radio de 5 km desde el pin por defecto (Montevideo):
--
--                   sin índice        con índice
--   ejecución          881 ms            8,2 ms      (~107x)
--   buffers             1060               192
--   filas descartadas  59.947                31
--
-- Y el planner LO ELIGE, verificado con EXPLAIN sobre la consulta real de
-- FindNearby —la que joinea pets y filtra por la allowlist de visibilidad—,
-- no sobre una escrita para la ocasión: el plan muestra
-- `Bitmap Index Scan on idx_reports_geog`.
--
-- POR QUÉ IMPORTA EN ESTE PROYECTO, que no es por la latencia. El techo no es
-- CPU ni disco: es TIEMPO DESPIERTO de Neon (regla #59). Una consulta lenta es
-- compute prendido, y el plan gratuito cobra por eso. Bajar 881 ms a 8 ms en el
-- camino del mapa reduce directamente la palanca que esa regla dice mirar.
--
-- LA EXPRESIÓN DEL ÍNDICE TIENE QUE COINCIDIR EXACTAMENTE CON LA DE LA QUERY o
-- Postgres no lo usa, y entonces es peor que no tenerlo: ocupa espacio, cuesta
-- en cada escritura y encima parece resuelto. Las de acá se copiaron de los
-- repositorios, no se reescribieron:
--
--   reports         → report_repository.go (mapa) y pet_repository.go (búsqueda),
--                     que joinean reports y comparten la misma expresión
--   vets            → vet_repository.go
--   location_alerts → location_alert_repository.go, donde un comentario venía
--                     recomendando este índice con la nota "ejecutar una vez,
--                     fuera de AutoMigrate". Nunca se ejecutó.
--
-- Las columnas son `numeric`, así que ST_MakePoint las castea a double
-- precision. El índice hereda el mismo cast y por eso matchea; se verificó en el
-- plan, donde el Index Cond muestra `(longitude)::double precision`.
--
-- Sin CONCURRENTLY a propósito: golang-migrate corre cada archivo dentro de una
-- transacción y CREATE INDEX CONCURRENTLY no puede vivir ahí. Con los volúmenes
-- actuales (cientos de filas) la construcción es instantánea y el lock no se
-- percibe. Si alguna de estas tablas creciera a millones, este índice habría que
-- crearlo a mano y fuera de la migración.

CREATE INDEX IF NOT EXISTS idx_reports_geog
  ON reports USING GIST (
    (ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography)
  );

CREATE INDEX IF NOT EXISTS idx_vets_geog
  ON vets USING GIST (
    (ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography)
  );

CREATE INDEX IF NOT EXISTS idx_location_alerts_geog
  ON location_alerts USING GIST (
    (ST_SetSRID(ST_MakePoint(alert_longitude, alert_latitude), 4326)::geography)
  );
