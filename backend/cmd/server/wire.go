package main

import (
	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
	"gorm.io/gorm"
	"lost-pets/config"
	"lost-pets/internal/app"
)

// SetupRouter delegates to internal/app.SetupRouter so that the binary
// entry-point stays thin and e2e tests can import the same wiring via the
// exported package.
func SetupRouter(cfg *config.Config, db *gorm.DB, log *zap.Logger) *gin.Engine {
	return app.SetupRouter(cfg, db, log)
}
