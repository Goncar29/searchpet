// Package secret compara secretos sin filtrar por tiempo cuanto acerto el
// atacante (hallazgo S8 de la auditoria de seguridad 2026-09-23).
package secret

import (
	"crypto/sha256"
	"crypto/subtle"
)

// Equal informa si a y b son iguales en tiempo constante.
//
// `a == b` corta en el primer byte distinto, asi que el tiempo de respuesta
// dice cuantos bytes del principio acerto quien pregunta. subtle.ConstantTimeCompare
// sola tampoco alcanza: devuelve al instante si los largos difieren, lo que
// filtra el largo del secreto. Hashear los dos lados primero deja siempre dos
// digests de 32 bytes, y el tiempo ya no depende ni del contenido ni del largo.
//
// Equal NO trata el vacio como caso especial: Equal("", "") es true. Un
// llamador cuyo secreto puede no estar configurado tiene que rechazar ese caso
// ANTES de comparar (regla #18).
func Equal(a, b string) bool {
	ha := sha256.Sum256([]byte(a))
	hb := sha256.Sum256([]byte(b))
	return subtle.ConstantTimeCompare(ha[:], hb[:]) == 1
}
