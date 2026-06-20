// Command import-vets pulls amenity=veterinary POIs for Uruguay from the OSM
// Overpass API and upserts them into the vets table. Idempotent: first run seeds,
// later runs refresh. Run manually against DATABASE_URL when a refresh is wanted.
package main

import (
	"context"
	"net/http"
	"time"

	"go.uber.org/zap"
	"lost-pets/config"
	"lost-pets/internal/domain"
	"lost-pets/internal/osmimport"
	"lost-pets/pkg/database"
	"lost-pets/pkg/logger"
)

func main() {
	cfg := config.Load()
	log := logger.Init(cfg.Environment)
	defer log.Sync() //nolint:errcheck

	db, err := database.Connect(cfg.DatabaseURL)
	if err != nil {
		log.Fatal("import-vets: DB connect failed", zap.Error(err))
	}

	// Ensure the table exists when run against a fresh DB (server AutoMigrate
	// normally creates it, but the command must be self-sufficient).
	if err := db.AutoMigrate(&domain.Vet{}); err != nil {
		log.Fatal("import-vets: AutoMigrate failed", zap.Error(err))
	}

	imp := osmimport.New(db, &http.Client{Timeout: 150 * time.Second}, osmimport.DefaultOverpassEndpoint, log)

	res, err := imp.Run(context.Background())
	if err != nil {
		log.Fatal("import-vets: run failed", zap.Error(err))
	}

	log.Info("import-vets: completed",
		zap.Int("scanned", res.Scanned),
		zap.Int("upserted", res.Upserted),
		zap.Int("skipped", res.Skipped),
	)
}
