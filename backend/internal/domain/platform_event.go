package domain

import (
	"time"

	"github.com/google/uuid"
)

// Stat event type values for the append-only platform_events ledger.
const (
	// StatEventPetFound is recorded every time a pet transitions into "found".
	// pets_reunited counts every row (each reunification EPISODE), matching
	// stats_handler.go — a pet lost and found again adds +1 each time.
	StatEventPetFound = "pet_found"
	// StatEventSearchStarted is recorded every time a new lost/stray search is
	// opened (publish-lost, stray creation, or a registered->lost edit).
	// searches_started counts every row.
	StatEventSearchStarted = "search_started"
)

// PlatformEvent is an append-only impact-metrics ledger entry. It deliberately
// has NO foreign key to pets: deleting a pet must NOT remove its history, so the
// lifetime counters never decrease.
//
// PetID IS joined back to the pets table, and the comment here used to claim the
// opposite ("never joined back"). monthly_impact_handler.go does
// `JOIN pets p ON p.id = pe.pet_id` for BOTH monthly tables — reunited pets and
// reports — so that join is what makes the admin impact panel work. Two
// consequences follow from having no FK, and both are load-bearing:
//
//   - An event whose pet was hard-deleted is DROPPED by the join, so the monthly
//     list is legitimately shorter than the lifetime counter. Intended.
//   - Nothing cascades, so anything that deletes pets must delete these rows on
//     its own. `cmd/seed`'s reset has to, and forgetting it re-attached stale
//     events to recreated pets, because the seed's pet IDs are fixed.
//
// The lifetime counters (stats_handler.go) do NOT join — they count rows.
type PlatformEvent struct {
	ID        uuid.UUID  `gorm:"type:uuid;default:gen_random_uuid();primaryKey" json:"id"`
	EventType string     `gorm:"type:varchar(50);not null;index" json:"event_type"`
	PetID     *uuid.UUID `gorm:"type:uuid;index" json:"pet_id,omitempty"`
	CreatedAt time.Time  `gorm:"autoCreateTime" json:"created_at"`
}

// TableName pins the table name to platform_events.
func (PlatformEvent) TableName() string { return "platform_events" }
