package dto

import (
	"github.com/google/uuid"
	"lost-pets/internal/domain"
)

// VetResponse son los datos públicos de una veterinaria devueltos al cliente.
type VetResponse struct {
	ID             uuid.UUID `json:"id"`
	Name           string    `json:"name"`
	Latitude       float64   `json:"latitude"`
	Longitude      float64   `json:"longitude"`
	Address        string    `json:"address,omitempty"`
	Phone          string    `json:"phone,omitempty"`
	Website        string    `json:"website,omitempty"`
	OpeningHours   string    `json:"opening_hours,omitempty"`
	DistanceMeters float64   `json:"distance_meters"`
}

// ToVetResponse convierte un VetNearbyResult de dominio en su DTO.
func ToVetResponse(r domain.VetNearbyResult) VetResponse {
	return VetResponse{
		ID:             r.ID,
		Name:           r.Name,
		Latitude:       r.Latitude,
		Longitude:      r.Longitude,
		Address:        r.Address,
		Phone:          r.Phone,
		Website:        r.Website,
		OpeningHours:   r.OpeningHours,
		DistanceMeters: r.DistanceMeters,
	}
}

// ToVetListResponse convierte un slice de resultados. Siempre retorna slice
// inicializado (nunca nil) para que JSON serialice [] en vez de null.
func ToVetListResponse(rs []domain.VetNearbyResult) []VetResponse {
	out := make([]VetResponse, len(rs))
	for i, r := range rs {
		out[i] = ToVetResponse(r)
	}
	return out
}

// VetImportResponse is the outcome of one OSM import run.
//
// sweep_skipped is present ONLY when a guard blocked the deletion pass. An
// operator has to be able to tell "nothing was stale" (swept: 0, no reason) from
// "we refused to delete" (swept: 0, with a reason) — collapsing those two into a
// bare zero is how a broken import looks identical to a clean one.
// active_before is the threshold guard's denominator. It ships even on a clean
// run because the only way to read a blocked sweep is against the number it was
// measured against.
//
// The mapping from osmimport.Result lives in the handler, not here: dto maps
// from domain, and importing an infrastructure package into this layer would
// invert the dependency direction the architecture rests on.
// VetImportRequest is the optional body of POST /api/admin/vets/import. Every
// field is optional: a run with no body at all is the ordinary, guarded import.
type VetImportRequest struct {
	// ForceSweep lets the deletion pass proceed below the sanity threshold. It is
	// the operator's exit from a guard that cannot untrip itself, and it never
	// reaches the guard that protects against our own failed writes.
	ForceSweep bool `json:"force_sweep"`
}

type VetImportResponse struct {
	Scanned         int    `json:"scanned"`
	Upserted        int    `json:"upserted"`
	SkippedNoCoords int    `json:"skipped_no_coords"`
	UpsertFailed    int    `json:"upsert_failed"`
	Swept           int    `json:"swept"`
	ActiveBefore    int64  `json:"active_before"`
	SweepSkipped    string `json:"sweep_skipped,omitempty"`
	SweepForced     bool   `json:"sweep_forced,omitempty"`
}
