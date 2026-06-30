package domain

import (
	"time"

	"github.com/google/uuid"
)

// Stat event type values for the append-only platform_events ledger.
const (
	// StatEventPetFound is recorded every time a pet transitions into "found".
	// pets_reunited counts DISTINCT pet_id over these rows.
	StatEventPetFound = "pet_found"
	// StatEventSearchStarted is recorded every time a new lost/stray search is
	// opened (publish-lost, stray creation, or a registered->lost edit).
	// searches_started counts every row.
	StatEventSearchStarted = "search_started"
)

// PlatformEvent is an append-only impact-metrics ledger entry. It deliberately
// has NO foreign key to pets: deleting a pet must NOT remove its history, so the
// lifetime counters never decrease. PetID is a plain value (nullable) used only
// to deduplicate pets_reunited; it is never joined back to the pets table.
type PlatformEvent struct {
	ID        uuid.UUID  `gorm:"type:uuid;default:gen_random_uuid();primaryKey" json:"id"`
	EventType string     `gorm:"type:varchar(50);not null;index" json:"event_type"`
	PetID     *uuid.UUID `gorm:"type:uuid;index" json:"pet_id,omitempty"`
	CreatedAt time.Time  `gorm:"autoCreateTime" json:"created_at"`
}

// TableName pins the table name to platform_events.
func (PlatformEvent) TableName() string { return "platform_events" }
