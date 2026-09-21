-- Vuelve a fusionar los dos conceptos: lo borrado pasa a verse como pausado.
--
-- Es informacion que se PIERDE, y es inherente: al volver al modelo viejo, la
-- distincion entre pausada y borrada deja de tener donde vivir. Las filas que
-- se borraron despues de la migracion quedan como pausadas, que es justo el
-- bug original.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name = 'location_alerts' AND column_name = 'deleted_at') THEN
        UPDATE location_alerts
           SET is_active = false,
               deleted_at = NULL
         WHERE deleted_at IS NOT NULL;
    END IF;
END $$;
