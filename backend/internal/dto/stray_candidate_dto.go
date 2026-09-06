package dto

import (
	"time"

	"lost-pets/internal/domain"
)

// StrayCandidateResponse es una tarjeta de la pregunta "¿no es alguno de
// estos?".
//
// Lleva `last_seen_at` y NO un booleano "vencido": la pantalla muestra "visto
// por última vez hace 4 meses", que es un HECHO que la persona puede usar para
// reconocer al animal. "Vencido" es jerga nuestra, no significa nada para quien
// lo lee y sugiere que el animal ya no está — que es justo lo que no sabemos.
type StrayCandidateResponse struct {
	ID             string    `json:"id"`
	Name           string    `json:"name"`
	Type           string    `json:"type"`
	PhotoURL       string    `json:"photo_url,omitempty"`
	LastSeenAt     time.Time `json:"last_seen_at"`
	DistanceMeters float64   `json:"distance_meters"`
}

// ToStrayCandidateList mapea la lista. Devuelve slice vacío y NUNCA nil: el
// front distingue "no hay candidatos" de "no pudimos preguntar" por la
// AUSENCIA de datos, así que un null acá se leería como un fallo.
func ToStrayCandidateList(candidates []domain.StrayCandidate) []StrayCandidateResponse {
	out := make([]StrayCandidateResponse, 0, len(candidates))
	for _, c := range candidates {
		out = append(out, StrayCandidateResponse{
			ID:             c.PetID.String(),
			Name:           c.Name,
			Type:           c.Type,
			PhotoURL:       c.PhotoURL,
			LastSeenAt:     c.LastSeenAt,
			DistanceMeters: c.DistanceMeters,
		})
	}
	return out
}
