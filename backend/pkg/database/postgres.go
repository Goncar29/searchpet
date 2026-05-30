package database

import (
	"fmt"
	"os"

	sqlmigrate "github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/postgres"
	_ "github.com/golang-migrate/migrate/v4/source/file"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"lost-pets/internal/domain"
)

// Connect abre la conexión a PostgreSQL y retorna la instancia lista para usar.
// No ejecuta AutoMigrate — llamar RunAutoMigrate(db) después de RunMigrations.
func Connect(dsn string) (*gorm.DB, error) {
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Info),
	})
	if err != nil {
		return nil, fmt.Errorf("error conectando a PostgreSQL: %w", err)
	}
	return db, nil
}

// RunAutoMigrate aplica AutoMigrate para todos los modelos de dominio.
// Debe llamarse DESPUÉS de RunMigrations para respetar el orden correcto:
// Connect → RunMigrations → RunAutoMigrate.
func RunAutoMigrate(db *gorm.DB) error {
	if err := migrate(db); err != nil {
		return fmt.Errorf("error en AutoMigrate: %w", err)
	}
	return nil
}

// RunMigrations executes SQL migration files from the given migrationsDir path
// using golang-migrate. Returns nil if the directory doesn't exist or has no files.
func RunMigrations(dsn, migrationsDir string) error {
	if _, err := os.Stat(migrationsDir); os.IsNotExist(err) {
		return nil // no hay migraciones SQL todavía — OK
	}

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
