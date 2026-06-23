package main

import (
	"context"

	"go.uber.org/zap"
	"gorm.io/gorm"
	"lost-pets/internal/service"
)

type SeedOptions struct {
	Reset          bool
	WithEmbeddings bool
	JinaAPIKey     string
	Logger         *zap.Logger
}

func Seed(ctx context.Context, db *gorm.DB, embedder *service.EmbeddingService, opts SeedOptions) error {
	opts.Logger.Info("seed: stub — no data yet")
	return nil
}
