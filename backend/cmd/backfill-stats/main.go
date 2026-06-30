// Command backfill-stats seeds a one-time baseline into the platform_events
// ledger from pre-existing data, because the ledger only started being written
// when this feature shipped. It is idempotent: it does nothing if the ledger
// already has rows. Run once after deploy:
//
//	DATABASE_URL=... go run ./cmd/backfill-stats
//
// Baseline heuristic (an approximation of un-logged history):
//   - pet_found:      one event per pet currently in status 'found'.
//   - search_started: one event per report with status 'lost' (publish-lost),
//     plus one per pet currently in status 'stray'.
//
// Going forward the counters are exact; this only seeds the starting point.
package main

import (
	"log"

	"lost-pets/config"
	"lost-pets/internal/domain"
	"lost-pets/pkg/database"
)

func main() {
	cfg := config.Load()
	db, err := database.Connect(cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("backfill-stats: db connect: %v", err)
	}

	// Defensive: ensure the table exists even if this runs before the server's
	// own AutoMigrate. Idempotent.
	if err := db.AutoMigrate(&domain.PlatformEvent{}); err != nil {
		log.Fatalf("backfill-stats: migrate platform_events: %v", err)
	}

	var existing int64
	if err := db.Model(&domain.PlatformEvent{}).Count(&existing).Error; err != nil {
		log.Fatalf("backfill-stats: count existing: %v", err)
	}
	if existing > 0 {
		log.Printf("backfill-stats: platform_events already has %d rows — skipping", existing)
		return
	}

	// pet_found baseline
	if err := db.Exec(`
		INSERT INTO platform_events (id, event_type, pet_id, created_at)
		SELECT gen_random_uuid(), ?, id, now()
		FROM pets WHERE status = ?`,
		domain.StatEventPetFound, domain.PetStatusFound).Error; err != nil {
		log.Fatalf("backfill-stats: pet_found: %v", err)
	}

	// search_started baseline: publish-lost reports
	if err := db.Exec(`
		INSERT INTO platform_events (id, event_type, pet_id, created_at)
		SELECT gen_random_uuid(), ?, pet_id, COALESCE(created_at, now())
		FROM reports WHERE status = ?`,
		domain.StatEventSearchStarted, "lost").Error; err != nil {
		log.Fatalf("backfill-stats: search_started (lost reports): %v", err)
	}

	// search_started baseline: current strays
	if err := db.Exec(`
		INSERT INTO platform_events (id, event_type, pet_id, created_at)
		SELECT gen_random_uuid(), ?, id, now()
		FROM pets WHERE status = ?`,
		domain.StatEventSearchStarted, domain.PetStatusStray).Error; err != nil {
		log.Fatalf("backfill-stats: search_started (strays): %v", err)
	}

	var n int64
	db.Model(&domain.PlatformEvent{}).Count(&n)
	log.Printf("backfill-stats: done — platform_events now has %d rows", n)
}
