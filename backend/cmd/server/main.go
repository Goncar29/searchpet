package main

import (
	"go.uber.org/zap"
	"lost-pets/config"
	"lost-pets/pkg/database"
	"lost-pets/pkg/logger"
	"lost-pets/pkg/mailer"
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
	// MAILER — se valida ANTES de tocar la base
	// ========================================
	// Va acá arriba a propósito: es una comprobación de configuración pura, sin
	// I/O, así que un deploy mal configurado muere en milisegundos en vez de
	// despertar el compute de Neon para después abortar igual (las horas
	// despiertas son el recurso escaso del proyecto).
	//
	// En producción no arranca; en cualquier otro entorno sólo avisa, porque el
	// no-op es deliberado en local, en `make seed` y en los e2e.
	if err := mailer.RequireConfigured(cfg.BrevoAPIKey, cfg.MailFromEmail, cfg.Environment); err != nil {
		log.Fatal("Configuración de mailer inválida", zap.Error(err))
	}
	if missing := mailer.MissingConfig(cfg.BrevoAPIKey, cfg.MailFromEmail); len(missing) > 0 {
		log.Warn("Mailer sin configurar: los OTP no se envían (no-op)",
			zap.Strings("faltan", missing),
			zap.String("env", cfg.Environment))
	}

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
	if err := database.RunMigrations(db, "migrations"); err != nil {
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
