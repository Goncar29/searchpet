-- last_reported_at es cuándo se vio a este animal por última vez. Existe para
-- que un avistamiento de callejero pueda caducar (issue #218): hasta hoy un
-- `stray` reportado una vez y nunca más envejecía en el mapa para siempre.
--
-- Guarda un HECHO, no un VEREDICTO. Si está vencido se deriva en la consulta
-- comparando contra el plazo, así que cambiar ese plazo no migra una sola fila
-- y un reporte nuevo devuelve la mascota al mapa sin código de revival.
--
-- El tag del struct (internal/domain/models.go) dice exactamente esto y NINGUNO
-- de los dos corrige al otro: AutoMigrate corre primero y crea la columna desde
-- el tag, así que un desacuerdo acá quedaría invisible en los dos entornos.
-- Deliberadamente SIN índice: ver el comentario del campo.
--
-- La guarda de tabla no protege contra el orden de arranque (AutoMigrate ya
-- corrió); protege a quien aplique las migraciones sueltas con el CLI de
-- golang-migrate contra una base vacía, donde ni `pets` ni `reports` existen.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'pets'
    ) THEN
        ALTER TABLE pets ADD COLUMN IF NOT EXISTS last_reported_at TIMESTAMPTZ;

        -- Backfill: las mascotas que YA tienen reportes arrancan con la fecha de
        -- su último avistamiento real, no con la de este deploy. Sin esto, todo
        -- callejero viejo quedaría marcado como recién visto y la caducidad
        -- tardaría un plazo entero en empezar a hacer algo.
        --
        -- MAX(COALESCE(occurred_at, created_at)) es el mismo reloj que usan
        -- FindByPetID, los filtros de fecha de FindNearby y sightingTime() en Go.
        -- Las cuatro definiciones tienen que decir lo mismo.
        --
        -- Las mascotas SIN reportes se dejan en NULL a propósito: quien lee la
        -- columna hace COALESCE(last_reported_at, created_at), así que su fecha
        -- de alta ya responde "desde cuándo no se sabe nada". Rellenarlas acá
        -- sería guardar un dato derivable y crear una segunda fuente de verdad.
        IF EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = 'reports'
        ) THEN
            UPDATE pets p
            SET last_reported_at = r.last_seen
            FROM (
                SELECT pet_id, MAX(COALESCE(occurred_at, created_at)) AS last_seen
                FROM reports
                GROUP BY pet_id
            ) r
            WHERE p.id = r.pet_id
              AND p.last_reported_at IS NULL;
        END IF;
    END IF;
END $$;
