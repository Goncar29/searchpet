package dto

import (
	"time"

	"lost-pets/internal/domain"
)

// StrayCandidateResponse es una tarjeta de la pregunta "¿no es alguno de
// estos?".
//
// Lleva `last_seen_nearby_at` y NO un booleano "vencido": la pantalla muestra
// "visto por última vez hace 4 meses", que es un HECHO que la persona puede
// usar para reconocer al animal. "Vencido" es jerga nuestra, no significa nada
// para quien lo lee y sugiere que el animal ya no está — que es justo lo que
// no sabemos.
//
// El nombre del campo dice "nearby" a propósito, no sólo "last_seen": ver
// domain.StrayCandidate.LastSeenNearbyAt para el porqué — es la última vista
// DENTRO DEL RADIO consultado, no la última vista en cualquier lado.
type StrayCandidateResponse struct {
	ID               string    `json:"id"`
	Name             string    `json:"name"`
	Type             string    `json:"type"`
	PhotoURL         string    `json:"photo_url,omitempty"`
	LastSeenNearbyAt time.Time `json:"last_seen_nearby_at"`
	DistanceMeters   float64   `json:"distance_meters"`
}

// ToStrayCandidateList mapea la lista. Devuelve slice vacío y NUNCA nil: el
// front distingue "no hay candidatos" de "no pudimos preguntar" por la
// AUSENCIA de datos, así que un null acá se leería como un fallo.
func ToStrayCandidateList(candidates []domain.StrayCandidate) []StrayCandidateResponse {
	out := make([]StrayCandidateResponse, 0, len(candidates))
	for _, c := range candidates {
		out = append(out, StrayCandidateResponse{
			ID:               c.PetID.String(),
			Name:             c.Name,
			Type:             c.Type,
			PhotoURL:         c.PhotoURL,
			LastSeenNearbyAt: c.LastSeenNearbyAt,
			DistanceMeters:   c.DistanceMeters,
		})
	}
	return out
}
