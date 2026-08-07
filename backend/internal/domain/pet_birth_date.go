package domain

import "time"

// Precisiones válidas de Pet.BirthDate.
//
// La fecha guarda SIEMPRE un día concreto; la precisión dice cuánto de ese día
// es información real y cuánto es relleno:
//
//	year  → sólo el año es real   (se guarda el 1 de enero)
//	month → el año y el mes       (se guarda el día 1)
//	day   → la fecha entera
//
// El par existe porque mucha gente adopta de grande o rescata y no sabe el día
// exacto. Con una fecha sola, quien sabe "nació en 2022" tiene que inventar un
// día — y una vez inventado el dato queda contaminado para siempre: nadie puede
// distinguir después al que lo sabía del que lo aproximó.
const (
	BirthDatePrecisionDay   = "day"
	BirthDatePrecisionMonth = "month"
	BirthDatePrecisionYear  = "year"
)

var birthDatePrecisions = map[string]bool{
	BirthDatePrecisionDay:   true,
	BirthDatePrecisionMonth: true,
	BirthDatePrecisionYear:  true,
}

// ValidateBirthDate valida el par (fecha, precisión) como una UNIDAD, porque
// por separado ninguno de los dos significa nada: una fecha sin precisión no se
// puede mostrar sin mentir sobre cuánto se sabe de ella, y una precisión sin
// fecha no describe absolutamente nada.
func ValidateBirthDate(birthDate *time.Time, precision string) error {
	if birthDate == nil {
		// Sin fecha, la precisión tiene que estar vacía. Guardar una precisión
		// huérfana dejaría una fila que afirma saber algo que no tiene.
		if precision != "" {
			return ErrInvalidInput
		}
		return nil
	}

	if !birthDatePrecisions[precision] {
		return ErrInvalidInput
	}

	// Una mascota no puede haber nacido en el futuro. Mismo contrato que
	// `occurred_at` en los reportes, a propósito: los dos caminos guardan fechas
	// que el usuario elige en un calendario, y aceptar en uno lo que el otro
	// rechaza deja el dato inconsistente según por dónde entró.
	//
	// Depende de que el cliente mande el día como medianoche LOCAL
	// (`calendarDayToISO`) y no como medianoche UTC. Con UTC, un usuario al este
	// de Greenwich se vería rechazar el día de HOY — es el mismo bug de zona
	// horaria que ya se arregló en la fecha del reporte.
	if birthDate.After(time.Now()) {
		return ErrInvalidInput
	}

	return nil
}
