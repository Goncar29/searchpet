package repository

import (
	"time"

	"lost-pets/internal/domain"
)

// straySightingNotExpired es la ÚNICA definición de "este avistamiento todavía
// cuenta". La comparten las TRES superficies que demotan un callejero vencido:
// el feed (Search sin filtro de estado), el mapa (FindNearby) y el perfil
// público (publicProfileScope).
//
// Que sea una sola no es prolijidad: tres copias del mismo WHERE divergen en
// silencio, y el síntoma sería que la misma mascota aparece en una pantalla y no
// en otra, sin que ninguna de las dos se vea mal por separado. Es exactamente el
// motivo por el que publicProfileScope ya existía.
//
// El plazo NO es parámetro. Se lee de domain.StraySightingTTL adentro, igual que
// FindPublicByUserID lee su allowlist adentro: si el llamador pudiera pasarlo,
// la firma prometería "lo vigente" mientras cualquiera le pasa otra cosa — y un
// cero lo apagaría entero sin que nada avise.
//
// Tres decisiones que están dentro del SQL y conviene no re-derivar:
//
//   - `NOT (...)` y no `status != 'stray' OR ...`. Sólo los callejeros caducan.
//     Una mascota PERDIDA tiene un dueño buscándola y apagarla por antigüedad
//     sería cerrarle la búsqueda a alguien que no la cerró.
//
//   - COALESCE con created_at, porque LastReportedAt es nullable. Un callejero
//     sin ningún reporte envejece desde su ALTA. Tratar el NULL como "nunca
//     vence" lo dejaría vivo para siempre, que es el bug del issue #218 con otro
//     disfraz.
//
//   - El corte se calcula en Go y no con `now()` de Postgres. Así el plazo sale
//     de la constante del dominio y no de una expresión SQL que habría que
//     mantener en paralelo — cuatro definiciones del reloj ya son suficientes.
//
// El prefijo `pets.` es obligatorio y funciona en las tres: dos hacen JOIN con
// reports y la tercera va sobre Model(&domain.Pet{}), así que la tabla siempre
// se llama `pets`. Sin el prefijo, las que joinean serían ambiguas.
func straySightingNotExpired() (string, []any) {
	corte := time.Now().Add(-domain.StraySightingTTL)
	return "NOT (pets.status = ? AND " + LastSeenExpr + " < ?)",
		[]any{domain.PetStatusStray, corte}
}

// LastSeenExpr es la expresión SQL de "cuándo se vio por última vez a este
// callejero". La usa straySightingNotExpired para decidir la visibilidad, y
// `Pet.LastSeen()` la replica en Go para exponer el dato en la ficha.
//
// Está EXPORTADA sólo para que el test de acuerdo pueda ejercitar ESTA
// expresión y no una copia. La primera versión de ese test se llamaba
// "CoincideConElCoalesceDelScope" y tenía el SQL escrito a mano adentro: como
// straySightingNotExpired no era alcanzable desde `package tests`, cambiar esta
// línea habría dejado el test VERDE mientras la ficha y el feed pasaban a
// discrepar sobre la misma mascota. Un test que copia lo que dice custodiar no
// custodia nada.
const LastSeenExpr = "COALESCE(pets.last_reported_at, pets.created_at)"
