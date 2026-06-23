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

	return seedEmbeddings(ctx, embedder, opts)
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
		&domain.Report{}, &domain.Photo{},
		&domain.Badge{}, &domain.UserPoints{}, &domain.SuccessStory{},
		&domain.GroupMember{}, &domain.LocalGroup{}, &domain.ReportAbuse{},
		&domain.BlockedUser{}, &domain.Pet{}, &domain.User{},
	} {
		if err := db.Where("1 = 1").Delete(m).Error; err != nil {
			return err
		}
	}
	return nil
}

// seedEmbeddings is a stub — replaced in Task 7 with the opt-in Jina logic.
func seedEmbeddings(ctx context.Context, embedder *service.EmbeddingService, opts SeedOptions) error {
	opts.Logger.Info("seed: embeddings stub (real logic added in a later task)")
	return nil
}
