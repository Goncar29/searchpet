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

// BirthDateLayout es el ÚNICO formato en que la fecha de nacimiento entra y
// sale de la API: un día de calendario, sin hora y sin zona.
//
// NO puede viajar como instante, y esto costó un hallazgo de code review. La
// columna es DATE: Postgres se queda con el DÍA del valor que recibe y tira el
// resto. Mandar la medianoche local como ISO —que es lo que hace
// `calendarDayToISO`, y es CORRECTO para `occurred_at` porque esa columna es
// timestamptz— termina guardando el día de UTC:
//
//	usuario en UTC+2 elige el 6  →  2026-08-05T22:00:00Z  →  se guarda el 5
//
// Y a la vuelta el error es simétrico: un `2026-08-06T00:00:00Z` leído en
// Uruguay (UTC-3) se muestra como el 5. El instante no sobrevive al INSERT, así
// que el día local es irrecuperable — no hay helper que lo arregle del lado del
// cliente.
//
// Con un YYYY-MM-DD plano no hay zona horaria en ninguna punta del viaje.
const BirthDateLayout = "2006-01-02"

var birthDatePrecisions = map[string]bool{
	BirthDatePrecisionDay:   true,
	BirthDatePrecisionMonth: true,
	BirthDatePrecisionYear:  true,
}

// birthDateMaxAge es el piso de la fecha. Es deliberadamente generoso: la app
// acepta `otro` como tipo de mascota, y una tortuga pasa los 150 años. No busca
// atajar una edad discutible, sino los valores absurdos —el año 0001 que deja
// pasar un cliente roto— que después derivan en una edad sin sentido.
const birthDateMaxAge = 150

// ParseBirthDate convierte el día de calendario que manda el cliente en el
// valor que se persiste: medianoche UTC de ese día.
//
// La UTC acá no representa una zona horaria, es una convención canónica: la
// columna DATE se queda sólo con el día, así que cualquier otra hora sería
// ruido que Postgres descarta igual.
func ParseBirthDate(day string) (time.Time, error) {
	parsed, err := time.ParseInLocation(BirthDateLayout, day, time.UTC)
	if err != nil {
		return time.Time{}, ErrInvalidInput
	}
	return parsed, nil
}

// FormatBirthDate es la vuelta de ParseBirthDate. Devuelve "" cuando no hay
// fecha, para que el `omitempty` de la respuesta la omita.
func FormatBirthDate(birthDate *time.Time) string {
	if birthDate == nil {
		return ""
	}
	return birthDate.UTC().Format(BirthDateLayout)
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

	// Se comparan DÍAS DE CALENDARIO, no instantes. Comparar contra
	// `time.Now()` a secas rechazaría a una mascota nacida HOY durante las
	// primeras horas UTC del día, porque la fecha guardada vuelve siempre como
	// medianoche.
	hoy := time.Now().UTC().Truncate(24 * time.Hour)
	dia := birthDate.UTC().Truncate(24 * time.Hour)

	// El día de gracia cubre a los usuarios ADELANTADOS de UTC, que es la mitad
	// del problema que el párrafo de arriba resolvía sólo para los atrasados:
	// alguien en Portugal o España cargando a las 00:30 elige su día local, que
	// en UTC todavía es ayer, y sin el margen se lo rechaza. La app se publica
	// en es/en/pt, así que esas zonas están en alcance.
	//
	// No debilita la guarda en nada que importe: lo que atajamos son fechas
	// absurdas, y "mañana" no es una fecha de nacimiento más plausible que hoy.
	if dia.After(hoy.AddDate(0, 0, 1)) {
		return ErrInvalidInput
	}
	if dia.Before(hoy.AddDate(-birthDateMaxAge, 0, 0)) {
		return ErrInvalidInput
	}

	return nil
}
