package domain

import (
	"time"

	"github.com/google/uuid"
)

// Vet is a veterinary clinic imported from OpenStreetMap (amenity=veterinary).
// The natural key (OSMType, OSMID) makes the import idempotent. Geography is
// built on the fly in the nearby query, so no PostGIS column type is needed.
type Vet struct {
	ID           uuid.UUID `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	OSMType      string    `gorm:"size:8;not null;uniqueIndex:idx_vets_osm,priority:1" json:"-"`
	OSMID        int64     `gorm:"not null;uniqueIndex:idx_vets_osm,priority:2" json:"-"`
	Name         string    `gorm:"size:255" json:"name"`
	Latitude     float64   `gorm:"type:double precision;not null;index" json:"latitude"`
	Longitude    float64   `gorm:"type:double precision;not null;index" json:"longitude"`
	Address      string    `gorm:"size:500" json:"address,omitempty"`
	Phone        string    `gorm:"size:50" json:"phone,omitempty"`
	Website      string    `gorm:"size:500" json:"website,omitempty"`
	OpeningHours string    `gorm:"size:255" json:"opening_hours,omitempty"`
	Source       string    `gorm:"size:20;default:'osm'" json:"-"`
	LastSyncedAt time.Time `json:"-"`
	CreatedAt    time.Time `gorm:"autoCreateTime" json:"-"`
	UpdatedAt    time.Time `gorm:"autoUpdateTime" json:"-"`
}

// VetNearbyResult is a Vet plus its computed distance from the query point.
type VetNearbyResult struct {
	Vet
	DistanceMeters float64 `gorm:"column:distance_meters" json:"distance_meters"`
}
