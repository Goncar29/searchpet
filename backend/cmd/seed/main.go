// Command seed populates a LOCAL database with a rich test dataset (users incl.
// an admin, pets across all statuses, PostGIS reports, community records, and
// image-search photos with real Jina embeddings). Idempotent: re-running
// upserts by fixed IDs. Local-only by intent — refuses non-local DATABASE_URL
// unless --force.
package main

import (
	"context"
	"flag"
	"net/url"
	"strings"

	"go.uber.org/zap"
	"lost-pets/config"
	"lost-pets/internal/domain"
	"lost-pets/internal/repository"
	"lost-pets/internal/service"
	"lost-pets/pkg/database"
	"lost-pets/pkg/logger"
)

func main() {
	reset := flag.Bool("reset", false, "delete seed-managed rows before inserting")
	force := flag.Bool("force", false, "allow running against a non-local DATABASE_URL")
	// Embeddings are OPT-IN: Jina's free tier is tied to a single shared key (also
	// used in prod), so a normal seed must never touch Jina. Only this flag does.
	withEmbeddings := flag.Bool("with-embeddings", false, "generate image-search embeddings via Jina (uses the shared JINA_API_KEY)")
	flag.Parse()

	cfg := config.Load()
	log := logger.Init(cfg.Environment)
	defer log.Sync() //nolint:errcheck

	if !*force && !isLocalDB(cfg.DatabaseURL) {
		log.Fatal("seed: refusing to run against a non-local DATABASE_URL; pass --force to override",
			zap.String("hint", "this command is for local testing only"))
	}

	db, err := database.Connect(cfg.DatabaseURL)
	if err != nil {
		log.Fatal("seed: DB connect failed", zap.Error(err))
	}

	// PetEmbedding is intentionally excluded: it depends on the pgvector extension
	// and is managed exclusively by SQL migration 000009_add_pgvector_embeddings.
	// The local Docker image (postgis/postgis) does not ship pgvector; AutoMigrate
	// of that model would always fail locally with "type vector does not exist".
	if err := db.AutoMigrate(
		&domain.User{}, &domain.Pet{}, &domain.Photo{}, &domain.Report{},
		&domain.BlockedUser{}, &domain.ReportAbuse{}, &domain.LocalGroup{},
		&domain.GroupMember{}, &domain.SuccessStory{}, &domain.UserPoints{},
		&domain.Badge{},
	); err != nil {
		log.Fatal("seed: AutoMigrate failed", zap.Error(err))
	}

	embedder := service.NewEmbeddingService(
		repository.NewPetEmbeddingRepository(db),
		repository.NewPetRepository(db),
		repository.NewPhotoRepository(db),
		cfg.JinaAPIKey,
	)
	if cfg.JinaEndpoint != "" {
		embedder.SetEndpoint(cfg.JinaEndpoint)
	}

	if err := Seed(context.Background(), db, embedder, SeedOptions{
		Reset:          *reset,
		WithEmbeddings: *withEmbeddings,
		JinaAPIKey:     cfg.JinaAPIKey,
		Logger:         log,
	}); err != nil {
		log.Fatal("seed: failed", zap.Error(err))
	}
	log.Info("seed: completed")
}

// isLocalDB returns true when the DATABASE_URL host is localhost/127.0.0.1.
func isLocalDB(dsn string) bool {
	u, err := url.Parse(dsn)
	if err != nil {
		return false
	}
	host := u.Hostname()
	return host == "localhost" || host == "127.0.0.1" || strings.HasPrefix(host, "host.docker.internal")
}
