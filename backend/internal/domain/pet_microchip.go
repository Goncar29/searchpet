package domain

import "unicode/utf8"

// MicrochipIDMaxLen refleja el `size:50` de Pet.MicrochipID.
//
// Se cuenta en RUNAS y no en bytes a propósito: `size:50` en GORM produce un
// VARCHAR(50), y Postgres cuenta VARCHAR en CARACTERES. Contar bytes acá
// rechazaría identificadores válidos con acentos y, peor, dejaría pasar los que
// Postgres sí rechaza. Es el error inverso al del tag `max` del validador
// contra el límite en bytes de bcrypt: cada vez que un chequeo y un motor
// hablan de "largo", hay que confirmar que hablen de la misma unidad.
const MicrochipIDMaxLen = 50

// IsValidMicrochipID sólo acota el LARGO. No valida el formato del número
// porque no hay uno solo: conviven ISO 11784 de 15 dígitos, los AVID de 9 y 10,
// y los de fabricantes viejos. Rechazar por formato dejaría afuera microchips
// reales, que es peor que aceptar uno con una errata.
//
// El vacío es válido: el campo es opcional.
//
// OJO — esto NO cubre la colisión. La columna es `uniqueIndex`, así que dos
// mascotas con el mismo número siguen dando SQLSTATE 23505 → 500. Mapear eso a
// un 409 necesita leer el código de error de Postgres, que hoy no se hace en
// ninguna capa de este backend: es un cambio de infraestructura aparte.
func IsValidMicrochipID(microchipID string) bool {
	return utf8.RuneCountInString(microchipID) <= MicrochipIDMaxLen
}
