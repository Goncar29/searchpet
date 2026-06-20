package database

import (
	"context"
	"database/sql"
	"fmt"
	"net"
	"os"
	"time"

	sqlmigrate "github.com/golang-migrate/migrate/v4"
	migratepg "github.com/golang-migrate/migrate/v4/database/postgres"
	_ "github.com/golang-migrate/migrate/v4/source/file"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"lost-pets/internal/domain"
)

// Connect abre la conexión a PostgreSQL y retorna la instancia GORM lista para usar.
//
// La conexión fuerza IPv4 a nivel del dialer: Neon publica registros A (IPv4) y
// AAAA (IPv6), pero el free tier de Render no rutea IPv6, así que una conexión
// que resuelve al AAAA falla con "network is unreachable" de forma intermitente.
// Forzar tcp4 hace el arranque determinístico.
//
// No ejecuta AutoMigrate — llamar RunAutoMigrate(db) después de RunMigrations.
func Connect(dsn string) (*gorm.DB, error) {
	sqlDB, err := openIPv4(dsn)
	if err != nil {
		return nil, err
	}

	// Ping explícito para fallar rápido y ejercitar el dialer IPv4 en el arranque.
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := sqlDB.PingContext(ctx); err != nil {
		return nil, fmt.Errorf("error conectando a PostgreSQL: %w", err)
	}

	db, err := gorm.Open(postgres.New(postgres.Config{Conn: sqlDB}), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Info),
	})
	if err != nil {
		return nil, fmt.Errorf("error conectando a PostgreSQL: %w", err)
	}
	return db, nil
}

// openIPv4 construye un *sql.DB (pgx/stdlib) cuyo dialer solo usa IPv4. El mismo
// *sql.DB respalda a GORM y a golang-migrate, de modo que todo el bootstrap
// comparte una única conexión forzada a IPv4 sobre el host directo (sin pooler,
// para no romper los advisory locks de golang-migrate).
func openIPv4(dsn string) (*sql.DB, error) {
	config, err := pgx.ParseConfig(dsn)
	if err != nil {
		// No propagamos err: el mensaje de pgx embebe el DSN completo (con la
		// contraseña), y termina en los logs. Devolvemos un error genérico para
		// no filtrar credenciales. Formato esperado:
		// postgresql://user:password@host/db?sslmode=require
		return nil, fmt.Errorf("DATABASE_URL con formato inválido (revisar usuario:password@host/db?sslmode=require)")
	}
	config.DialFunc = func(ctx context.Context, _ string, addr string) (net.Conn, error) {
		d := net.Dialer{Timeout: 10 * time.Second}
		return d.DialContext(ctx, "tcp4", addr)
	}
	return stdlib.OpenDB(*config), nil
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
// using golang-migrate over the SAME connection GORM uses (forced to IPv4).
// Returns nil if the directory doesn't exist or has no files.
func RunMigrations(db *gorm.DB, migrationsDir string) error {
	if _, err := os.Stat(migrationsDir); os.IsNotExist(err) {
		return nil // no hay migraciones SQL todavía — OK
	}

	sqlDB, err := db.DB()
	if err != nil {
		return fmt.Errorf("error obteniendo *sql.DB: %w", err)
	}

	driver, err := migratepg.WithInstance(sqlDB, &migratepg.Config{})
	if err != nil {
		return fmt.Errorf("error creando driver de migración: %w", err)
	}

	m, err := sqlmigrate.NewWithDatabaseInstance("file://"+migrationsDir, "postgres", driver)
	if err != nil {
		return fmt.Errorf("error creando migrador: %w", err)
	}
	// No llamamos m.Close(): cerraría el *sql.DB compartido con GORM.

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
		&domain.StoryLike{},
		&domain.BlockedUser{},
		&domain.ReportAbuse{},
		&domain.Shelter{},
		&domain.DeviceToken{},
		&domain.UserReview{},
		&domain.Vet{},
	)
}
