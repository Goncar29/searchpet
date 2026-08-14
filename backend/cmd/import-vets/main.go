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
	"lost-pets/internal/repository"
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

	imp := osmimport.New(
		repository.NewVetRepository(db),
		&http.Client{Timeout: 150 * time.Second},
		osmimport.DefaultOverpassEndpoint,
		log,
	)

	// No force: whoever runs the CLI has a database shell open anyway, so the
	// override earns nothing here and would only add a way to get it wrong.
	res, err := imp.Run(context.Background(), osmimport.RunOptions{})
	if err != nil {
		log.Fatal("import-vets: run failed", zap.Error(err))
	}

	log.Info("import-vets: completed",
		zap.Int("scanned", res.Scanned),
		zap.Int("upserted", res.Upserted),
		zap.Int("skipped_no_coords", res.SkippedNoCoords),
		zap.Int("upsert_failed", res.UpsertFailed),
		zap.Int("swept", res.Swept),
		zap.String("sweep_skipped", res.SweepSkipped),
	)
}
