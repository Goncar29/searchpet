package main

import (
	"go.uber.org/zap"
	"lost-pets/config"
	"lost-pets/pkg/database"
	"lost-pets/pkg/logger"
)

func main() {
	// ========================================
	// CONFIGURACIÓN
	// ========================================
	cfg := config.Load()

	// ========================================
	// LOGGER
	// ========================================
	log := logger.Init(cfg.Environment)
	defer log.Sync() //nolint:errcheck

	// ========================================
	// BASE DE DATOS
	// Connect → AutoMigrate (crea tablas base) → RunMigrations (DDL incremental)
	// ========================================
	db, err := database.Connect(cfg.DatabaseURL)
	if err != nil {
		log.Fatal("Error conectando a la base de datos", zap.Error(err))
	}

	// 1. AutoMigrate primero: crea todas las tablas base en DBs vacías
	if err := database.RunAutoMigrate(db); err != nil {
		log.Fatal("Error en AutoMigrate", zap.Error(err))
	}

	// 2. SQL migrations después: aplica DDL incremental (columnas, índices, tablas auxiliares)
	if err := database.RunMigrations(cfg.DatabaseURL, "migrations"); err != nil {
		log.Fatal("Error ejecutando migraciones SQL", zap.Error(err))
	}
	log.Info("Migraciones SQL aplicadas")

	// ========================================
	// ROUTER — all DI wiring lives in wire.go
	// ========================================
	router := SetupRouter(cfg, db, log)

	// ========================================
	// INICIAR SERVIDOR
	// ========================================
	log.Info("SearchPet API corriendo", zap.String("port", cfg.Port), zap.String("env", cfg.Environment))

	if err := router.Run(":" + cfg.Port); err != nil {
		log.Fatal("Error al iniciar servidor", zap.Error(err))
	}
}
