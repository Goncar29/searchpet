package database

import (
	"fmt"

	sqlmigrate "github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/postgres"
	_ "github.com/golang-migrate/migrate/v4/source/file"
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

// RunMigrations executes SQL migration files from the given migrationsDir path
// using golang-migrate. Returns nil if no changes were needed (ErrNoChange).
func RunMigrations(dsn, migrationsDir string) error {
	m, err := sqlmigrate.New("file://"+migrationsDir, dsn)
	if err != nil {
		return fmt.Errorf("error creando migrador: %w", err)
	}
	defer m.Close()

	if err := m.Up(); err != nil && err != sqlmigrate.ErrNoChange {
		return fmt.Errorf("error ejecutando migraciones: %w", err)
	}
	return nil
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
