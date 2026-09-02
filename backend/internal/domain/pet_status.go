package domain

// Pet status constants — the only valid values for Pet.Status.
// "active" is NOT a valid status; it is a legacy value replaced by "registered".
const (
	PetStatusRegistered = "registered"
	PetStatusLost       = "lost"
	PetStatusStray      = "stray"
	PetStatusFound      = "found"
	PetStatusArchived   = "archived"
	PetStatusAdoption   = "adoption"
	PetStatusAdopted    = "adopted"
)

// ValidPetStatuses is the authoritative set of allowed status values.
// Use this for input validation before calling service methods.
var ValidPetStatuses = map[string]bool{
	PetStatusRegistered: true,
	PetStatusLost:       true,
	PetStatusStray:      true,
	PetStatusFound:      true,
	PetStatusArchived:   true,
	PetStatusAdoption:   true,
	PetStatusAdopted:    true,
}

// FeedVisibleStatuses are the statuses returned in the public feed by default
// (when no explicit status filter is provided). Only lost and stray pets —
// active searches — show up by default.
var FeedVisibleStatuses = []string{PetStatusLost, PetStatusStray}

// PublicSearchableStatuses is the allowlist of statuses an unauthenticated
// visitor may request explicitly on the public search endpoint. found is
// included so people tracking a pet learn it was recovered. registered and
// archived are private/closed and must NEVER be enumerable via ?status=,
// otherwise anyone could list every user's private pets.
var PublicSearchableStatuses = map[string]bool{
	PetStatusLost:  true,
	PetStatusStray: true,
	PetStatusFound: true,
}

// MapVisibleStatuses are the pet statuses whose reports show on the nearby/map
// feed (FindNearby). It includes found — a fresh "found here" marker tells the
// people who were tracking the pet that it was recovered — but excludes
// registered/archived so stale reports of re-privatized or closed cases don't
// leak. Kept distinct from FeedVisibleStatuses on purpose: the map and the
// default pet-browse feed are different surfaces and may diverge.
var MapVisibleStatuses = []string{PetStatusLost, PetStatusStray, PetStatusFound}

// AdoptionVisibleStatuses is the allowlist for the public "Adoptar" section
// (GET /api/adoptions). Only pets *available* for adoption are listed here;
// adopted pets are not (they surface only in their owner's profile tab).
// Deliberately kept OUT of FeedVisibleStatuses / MapVisibleStatuses /
// PublicSearchableStatuses so adoption never leaks into the lost-pet feed,
// map, or public search.
var AdoptionVisibleStatuses = []string{PetStatusAdoption}

// PublicProfileVisibleStatuses son los estados que un TERCERO ve en el perfil
// público de otra persona (GET /api/users/:id/pets).
//
// Excluye `registered` y `archived` por el mismo motivo que
// PublicSearchableStatuses: publicarlos sería un inventario de qué animales
// tiene esa persona y dónde vive.
//
// `archived` es además el interruptor con el que se baja una publicación de
// esta vista, PERO NO ALCANZA PARA TODAS. `stray` es el único estado del
// sistema que no tiene arista hacia `archived` —ver AllowedTransitions, donde
// los otros cinco sí la tienen— así que hoy quien reporta un callejero no lo
// puede retirar de su perfil sin pasar por `found`, que es afirmar que el
// animal apareció, o sin borrar la mascota entera.
//
// Duele justo donde más se acumula: `reporter_id` junta cada callejero que la
// persona reportó en su vida, y es el motivo por el que la lista tiene tope.
// La asimetría no tiene ninguna justificación escrita en ningún lado y parece
// un olvido, no una decisión. Se deja anotada y no se arregla acá: tocar la
// máquina de estados es superficie compartida con el feed, el mapa, la
// búsqueda y adopción, y no entra en un cambio cuyo review tiene que mirar una
// frontera de privacidad.
//
// NO deducir de esto que archivar cubre todo — esta línea existe porque yo lo
// deduje y era falso.
//
// Incluye `found` y `adopted` a propósito: los dos son finales felices que ya
// fueron públicos (found está en PublicSearchableStatuses; adopted estuvo
// listado en /api/adoptions mientras fue adoption). La adopción NO transfiere
// la mascota —el status machine sólo permite adoption ↔ adopted y → archived—
// así que no hay un adoptante cuya privacidad proteger.
//
// EXPLÍCITA y no derivada, igual que las otras cuatro: si mañana se agrega un
// estado, hay que decidir si entra. El default —quedar afuera— es el que no
// publica nada de nadie.
var PublicProfileVisibleStatuses = []string{
	PetStatusLost,
	PetStatusStray,
	PetStatusFound,
	PetStatusAdoption,
	PetStatusAdopted,
}

// ValidPetTypes son los cuatro tipos de mascota que ofrece la UI.
//
// La usan DOS caminos: el filtro de búsqueda (`report_handler.go`), donde el
// cliente es un select con estas cuatro opciones y cualquier otra cosa es un
// request malformado; y desde 2026-08-31 también el ALTA (`pet_service.CreatePet`).
//
// Hasta ese día la creación NO validaba —el DTO pedía `required` y nada más— y
// este comentario documentaba esa asimetría como si fuera deliberada. No lo
// era: era un agujero. Se cerró.
//
// LO QUE SIGUE ABIERTO: la lista no revalida ni corrige datos YA GUARDADOS.
// Una mascota creada antes de ese cierre puede tener cualquier string en
// `type`, y como `UpdatePetRequest` no tiene campo `type`, su dueño no la puede
// corregir por la API. Queda invisible en el filtro por tipo, que sólo ofrece
// estas cuatro opciones. Repararlo necesita un backfill o abrir el campo en la
// edición; no se hizo porque no se pudo medir cuántas filas así existen.
//
// Los valores son en ESPAÑOL y son cuatro. La unión canónica del lado del
// frontend es `PetType` en shared/types/index.ts, con su espejo en PET_TYPES.
var ValidPetTypes = []string{"perro", "gato", "pajaro", "otro"}

// IsValidPetType dice si un tipo viene de la lista que ofrece la UI.
func IsValidPetType(t string) bool {
	for _, v := range ValidPetTypes {
		if v == t {
			return true
		}
	}
	return false
}

// ValidReportStatuses son los estados de un REPORTE, que es una columna
// distinta del estado de la MASCOTA. No confundir con las allowlists de
// visibilidad de arriba: éstas acotan lo que el usuario puede pedir, aquéllas
// deciden qué es visible y no dependen de ningún parámetro.
var ValidReportStatuses = []string{"lost", "found", "sighting"}

// IsValidReportStatus dice si un estado de reporte es uno de los tres válidos.
func IsValidReportStatus(s string) bool {
	for _, v := range ValidReportStatuses {
		if v == s {
			return true
		}
	}
	return false
}
