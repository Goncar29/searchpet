package domain

import (
	"time"

	"github.com/google/uuid"
)

// StrayCandidateRadiusMeters es el radio de búsqueda de candidatos: 1 km.
//
// Un callejero se mueve de a cuadras, no de a barrios. A 5 km una ciudad chica
// devuelve avistamientos de medio Montevideo y la pregunta "¿es alguno de
// estos?" se vuelve incontestable; a 500 m se pierde el perro que dormía ocho
// cuadras más allá, y ahí el duplicado se crea igual.
//
// NO es parámetro, por el mismo motivo que el plazo de straySightingNotExpired
// y que la allowlist de FindPublicByUserID: si el llamador lo pudiera pasar, un
// cero apagaría la búsqueda entera sin que nada avise. Cae justo en el piso del
// bound que ya usan /reports/nearby y la búsqueda con geo (1000–50000 m), así
// que no ensancha ningún rango existente.
const StrayCandidateRadiusMeters = 1000.0

// StrayCandidateLimit acota la lista. Diez es lo que una persona puede mirar y
// contestar; más abajo la pregunta deja de tener respuesta y el usuario aprieta
// "ninguno" sin leer, que es peor que no preguntarle nada.
const StrayCandidateLimit = 10

// StrayCandidateCriteria es lo que el usuario aporta: dónde está y qué animal
// vio. El radio y el tope NO están acá a propósito — ver las constantes.
type StrayCandidateCriteria struct {
	Lat float64
	Lng float64
	// PetType filtra por pets.type. Un gato no es candidato de un perro.
	// Vacío = sin filtro.
	PetType string
}

// StrayCandidate es un avistamiento de callejero cerca del punto consultado.
//
// NO lleva el teléfono ni ningún dato del reportante, y eso es deliberado: esta
// lista se muestra para RECONOCER a un animal, no para contactar a nadie. Ver
// la lección del preload de Owner en el perfil público — "el dato ya es público
// en otro lado" no equivale a "este camino no agrega exposición".
type StrayCandidate struct {
	PetID uuid.UUID
	Name  string
	Type  string
	// PhotoURL es la primaria; si ninguna foto está marcada primaria, la más
	// vieja (mismo criterio que fotoDelMarcador en dto/report_dto.go); "" si
	// la mascota no tiene ninguna foto. Antes de este campo elegir "primaria o
	// nada" dejaba sin foto a cualquier mascota cuya primaria se hubiera
	// borrado (photo_service.go DeletePhoto no promueve un reemplazo) — y en
	// una pantalla cuyo único trabajo es "¿es este animal?", una tarjeta sin
	// foto es la más fácil de descartar por error, así que el duplicado se
	// crea igual.
	PhotoURL string
	// LastSeenNearbyAt es la última vez que se vio a este animal DENTRO DEL
	// RADIO consultado — MAX(COALESCE(occurred_at, created_at)) sobre los
	// reportes que ya pasaron el ST_DWithin, no sobre todos los reportes de la
	// mascota.
	//
	// A propósito NO es pets.last_reported_at (que sí es global): esa columna
	// la actualiza TouchLastReported comparando sólo timestamps, sin ninguna
	// cláusula de geografía (ver pet_repository.go), así que un callejero
	// visto en Pocitos hace 4 meses y otra vez a 30 km hace 2 horas tendría
	// last_reported_at="hace 2 horas" aunque ESE avistamiento nunca haya
	// pasado cerca del punto que se está consultando. Combinado con
	// DistanceMeters (que sí es local), esa fecha global renderizaría "a 120 m
	// · visto hace 2 horas" — una combinación que nunca ocurrió y que se lee
	// como un avistamiento activo cerca de casa. El usuario o dice "es este" y
	// cuelga un reporte en la línea de tiempo del animal equivocado, o se
	// confunde y descarta al que sí es.
	//
	// Si alguien "simplifica" esto de vuelta a pets.last_reported_at porque
	// parece redundante con el JOIN a reports, reintroduce exactamente ese
	// bug — y esta vez sin que ningún test viejo lo note, porque el nombre
	// del campo ya no lo permite confundir con un dato reservado al radio.
	LastSeenNearbyAt time.Time
	// DistanceMeters es la distancia al reporte MÁS CERCANO de esa mascota,
	// dentro del radio consultado.
	DistanceMeters float64
}
