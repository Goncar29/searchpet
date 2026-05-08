package database

import (
	"fmt"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"lost-pets/internal/domain"
)

// Connect abre la conexión a PostgreSQL y ejecuta AutoMigrate
// Retorna la instancia de gorm.DB lista para usar
func Connect(dsn string) (*gorm.DB, error) {
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Info),
	})
	if err != nil {
		return nil, fmt.Errorf("error conectando a PostgreSQL: %w", err)
	}

	if err := migrate(db); err != nil {
		return nil, fmt.Errorf("error en migraciones: %w", err)
	}

	return db, nil
}

// migrate crea o actualiza las tablas en base a los structs de dominio
func migrate(db *gorm.DB) error {
	return db.AutoMigrate(
		&domain.User{},
		&domain.Pet{},
		&domain.Report{},
		&domain.Photo{},
		&domain.Message{},
		&domain.Favorite{},
		&domain.ShareLink{},
		&domain.LocationAlert{},
		&domain.Badge{},
		&domain.UserPoints{},
		&domain.LocalGroup{},
		&domain.GroupMember{},
		&domain.SuccessStory{},
		&domain.BlockedUser{},
		&domain.ReportAbuse{},
		&domain.Shelter{},
		&domain.DeviceToken{},
	)
}
