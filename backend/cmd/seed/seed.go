package main

import (
	"context"

	"go.uber.org/zap"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"lost-pets/internal/domain"
	"lost-pets/internal/service"
)

type SeedOptions struct {
	Reset          bool
	WithEmbeddings bool
	JinaAPIKey     string
	Logger         *zap.Logger
}

func Seed(ctx context.Context, db *gorm.DB, embedder *service.EmbeddingService, opts SeedOptions) error {
	if opts.Reset {
		if err := resetSeedData(db); err != nil {
			return err
		}
		opts.Logger.Info("seed: reset done")
	}

	// Users (hash plaintext passwords here).
	for _, su := range SeedUsers() {
		hash, err := bcrypt.GenerateFromPassword([]byte(su.Password), bcrypt.DefaultCost)
		if err != nil {
			return err
		}
		u := su.User
		u.PasswordHash = string(hash)
		if err := upsert(db, &u); err != nil {
			return err
		}
	}

	for _, p := range SeedPets() {
		p := p
		if err := upsert(db, &p); err != nil {
			return err
		}
	}
	for _, ph := range SeedPhotos() {
		ph := ph
		if err := upsert(db, &ph); err != nil {
			return err
		}
	}
	for _, r := range SeedReports() {
		r := r
		if err := upsert(db, &r); err != nil {
			return err
		}
	}

	c := SeedCommunity()
	for i := range c.Groups {
		if err := upsert(db, &c.Groups[i]); err != nil {
			return err
		}
	}
	for i := range c.Members {
		if err := upsert(db, &c.Members[i]); err != nil {
			return err
		}
	}
	for i := range c.Blocks {
		if err := upsert(db, &c.Blocks[i]); err != nil {
			return err
		}
	}
	for i := range c.Abuse {
		if err := upsert(db, &c.Abuse[i]); err != nil {
			return err
		}
	}
	for i := range c.Stories {
		if err := upsert(db, &c.Stories[i]); err != nil {
			return err
		}
	}
	for i := range c.Likes {
		// A developer may have liked this story through the UI, creating a row with
		// a different UUID but the same (story_id, user_id). upsert resolves the
		// conflict on the primary key, so that row would collide with the
		// idx_story_likes_story_user unique index. Clear any such row first.
		if err := db.Where("story_id = ? AND user_id = ? AND id <> ?",
			c.Likes[i].StoryID, c.Likes[i].UserID, c.Likes[i].ID).
			Delete(&domain.StoryLike{}).Error; err != nil {
			return err
		}
		if err := upsert(db, &c.Likes[i]); err != nil {
			return err
		}
	}
	for i := range c.Points {
		if err := upsert(db, &c.Points[i]); err != nil {
			return err
		}
	}
	for i := range c.Badges {
		if err := upsert(db, &c.Badges[i]); err != nil {
			return err
		}
	}
	opts.Logger.Info("seed: core records upserted")

	return seedEmbeddings(ctx, db, embedder, opts)
}

// upsert inserts or updates by primary key (records carry fixed UUIDs).
func upsert(db *gorm.DB, model interface{}) error {
	return db.Clauses(clause.OnConflict{UpdateAll: true}).Create(model).Error
}

// resetSeedData deletes seed-managed rows in reverse-dependency order.
func resetSeedData(db *gorm.DB) error {
	// pet_embeddings may not exist locally (no pgvector) — delete only if present.
	if db.Migrator().HasTable(&domain.PetEmbedding{}) {
		if err := db.Where("1 = 1").Delete(&domain.PetEmbedding{}).Error; err != nil {
			return err
		}
	}
	for _, m := range []interface{}{
		// Rows with FKs to reports/pets/users must be deleted before their parents,
		// otherwise the User/Pet/Report deletes below fail with a FK violation when
		// these tables hold app-created data (chat, share links, alerts, reviews).
		&domain.Message{}, &domain.ShareLink{}, &domain.LocationAlert{}, &domain.UserReview{},
		&domain.Report{}, &domain.Photo{},
		&domain.Badge{}, &domain.UserPoints{}, &domain.StoryLike{}, &domain.SuccessStory{},
		&domain.GroupMember{}, &domain.LocalGroup{}, &domain.ReportAbuse{},
		&domain.BlockedUser{}, &domain.Pet{}, &domain.User{},
	} {
		if err := db.Where("1 = 1").Delete(m).Error; err != nil {
			return err
		}
	}
	return nil
}

// seedEmbeddings indexes the lost/stray pets' photos using the SAME production
// path as the reindex endpoint (EmbeddingService.BackfillAll). OPT-IN only:
// Jina's free tier is tied to a single shared key (also used in prod), so a
// normal seed must never call Jina. Runs only with --with-embeddings.
func seedEmbeddings(ctx context.Context, db *gorm.DB, embedder *service.EmbeddingService, opts SeedOptions) error {
	if !opts.WithEmbeddings {
		opts.Logger.Info("seed: skipping image-search embeddings",
			zap.String("hint", "pass --with-embeddings to generate them (uses the shared Jina key)"))
		return nil
	}

	// Ensure pgvector + the embeddings table exist locally (prod creates these via
	// SQL migration; the seed makes itself self-sufficient for local testing).
	if err := db.Exec("CREATE EXTENSION IF NOT EXISTS vector").Error; err != nil {
		return err
	}
	if err := db.AutoMigrate(&domain.PetEmbedding{}); err != nil {
		return err
	}

	if opts.JinaAPIKey == "" {
		opts.Logger.Warn("seed: --with-embeddings set but JINA_API_KEY is empty — table ready, skipping fill",
			zap.String("hint", "set JINA_API_KEY (the shared free-tier key) to enable photo search locally"))
		return nil
	}

	res := embedder.BackfillAll(ctx)
	opts.Logger.Info("seed: embeddings backfilled",
		zap.Int("pets_scanned", res.PetsScanned),
		zap.Int("photos_indexed", res.PhotosIndexed),
		zap.Int("photos_failed", res.PhotosFailed),
	)
	return nil
}
