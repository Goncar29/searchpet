-- birth_date guarda un día concreto y birth_date_precision dice cuánto de ese
-- día es información real ('day' | 'month' | 'year'). Los dos van juntos: una
-- fecha sin precisión no se puede mostrar sin mentir sobre cuánto se sabe de
-- ella. Ver internal/domain/pet_birth_date.go.
--
-- La EDAD no se guarda: se deriva de la fecha. Guardar "3 años" es guardar un
-- dato que queda viejo solo al pasar el año.
--
-- Guardado sobre la existencia de la TABLA, no sólo de la columna: RunMigrations
-- corre ANTES que RunAutoMigrate (pkg/database/postgres.go), así que en una base
-- limpia este archivo se ejecuta antes de que GORM haya creado `pets`. Un
-- `ADD COLUMN IF NOT EXISTS` pelado protege la columna, NO la tabla, y rompería
-- el deploy en una base nueva.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'pets'
    ) THEN
        ALTER TABLE pets ADD COLUMN IF NOT EXISTS birth_date DATE;
        -- NOT NULL DEFAULT '' tiene que coincidir con el tag del struct
        -- (`size:10;not null;default:''`). Si divergen, en una base de
        -- producción manda el tag y en una de tests manda la migración, y el
        -- desacuerdo sólo aparece en prod.
        ALTER TABLE pets ADD COLUMN IF NOT EXISTS birth_date_precision VARCHAR(10) NOT NULL DEFAULT '';
    END IF;
END $$;
