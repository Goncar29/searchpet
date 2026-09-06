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
	// PhotoURL es la foto primaria, o "" si la mascota no tiene ninguna.
	PhotoURL string
	// LastSeenAt es COALESCE(last_reported_at, created_at): el mismo fallback
	// que usa straySightingNotExpired para decidir si está vencido. Se resuelve
	// en SQL y llega siempre con valor, así que la UI no tiene que elegir.
	LastSeenAt time.Time
	// DistanceMeters es la distancia al reporte MÁS CERCANO de esa mascota.
	DistanceMeters float64
}
