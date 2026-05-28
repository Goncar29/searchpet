// Package testdb provides shared test database helpers for integration tests.
// Tests that use SetupTestDB require a PostgreSQL+PostGIS instance.
// The DATABASE_URL environment variable must be set, otherwise the test is skipped.
//
// Recommended usage in local dev:
//
//	DATABASE_URL=postgres://postgres:postgres@localhost:5432/lostpets_test?sslmode=disable go test ./tests/...
//
// In CI the DATABASE_URL is already set by the workflow (postgis/postgis:15-3.4).
package testdb

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	sqlmigrate "github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/postgres"
	_ "github.com/golang-migrate/migrate/v4/source/file"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"lost-pets/internal/domain"
)

// allModels lists every domain model that must exist in the test schema.
// Order matters for FK constraints: parent tables first.
var allModels = []interface{}{
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
	&domain.VerificationToken{},
	&domain.UserReview{},
}

// allTableNames lists table names matching allModels for truncation.
// Must be in reverse FK dependency order (children first).
var allTableNames = []string{
	"user_reviews",
	"verification_tokens",
	"device_tokens",
	"report_abuses",
	"blocked_users",
	"success_stories",
	"group_members",
	"local_groups",
	"user_points",
	"badges",
	"location_alerts",
	"share_links",
	"messages",
	"photos",
	"reports",
	"pets",
	"shelters",
	"users",
}

// SetupTestDB connects to the test database, runs SQL migrations then AutoMigrate
// for all domain models, and registers a t.Cleanup that truncates all tables so
// each test starts clean.
//
// If DATABASE_URL is not set the test is skipped gracefully (not failed).
func SetupTestDB(t *testing.T) *gorm.DB {
	t.Helper()

	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		t.Skip("DATABASE_URL not set — skipping integration test")
	}

	var db *gorm.DB
	var err error

	// Connect with up to 5 retry attempts (1 s apart) to tolerate CI container startup lag.
	for attempt := 1; attempt <= 5; attempt++ {
		db, err = gorm.Open(postgres.Open(dsn), &gorm.Config{
			Logger: logger.Default.LogMode(logger.Silent),
		})
		if err == nil {
			sqlDB, pingErr := db.DB()
			if pingErr == nil {
				pingErr = sqlDB.Ping()
			}
			if pingErr == nil {
				break
			}
			err = pingErr
		}
		if attempt < 5 {
			time.Sleep(time.Second)
		}
	}
	if err != nil {
		t.Fatalf("testdb: failed to connect after 5 attempts: %v", err)
	}

	// Run SQL migrations (graceful — warn but don't fail if migrations dir not found).
	// Use runtime.Caller to get an absolute path to this file, then navigate to backend/migrations/.
	// This is cwd-independent and works both locally and in CI.
	_, thisFile, _, _ := runtime.Caller(0)
	migrationsDir := filepath.Join(filepath.Dir(thisFile), "..", "..", "migrations")
	m, merr := sqlmigrate.New("file://"+migrationsDir, dsn)
	if merr != nil {
		t.Logf("WARNING: migrations unavailable (%v) — skipping SQL migrations", merr)
	} else {
		if upErr := m.Up(); upErr != nil && upErr != sqlmigrate.ErrNoChange {
			t.Logf("WARNING: migration Up failed (%v) — continuing with AutoMigrate only", upErr)
		}
		m.Close()
	}

	// AutoMigrate creates or updates tables for all domain models.
	if migrateErr := db.AutoMigrate(allModels...); migrateErr != nil {
		t.Fatalf("testdb: AutoMigrate failed: %v", migrateErr)
	}

	// Truncate all tables after each test to ensure isolation.
	t.Cleanup(func() {
		truncateAll(t, db)
	})

	return db
}

// truncateAll truncates every application table in reverse-FK order so that
// child rows are removed before parent rows.
func truncateAll(t *testing.T, db *gorm.DB) {
	t.Helper()
	for _, table := range allTableNames {
		sql := fmt.Sprintf("TRUNCATE TABLE %s RESTART IDENTITY CASCADE", table)
		if err := db.Exec(sql).Error; err != nil {
			// Non-fatal: log the error but don't fail the test that already passed.
			t.Logf("testdb: truncate %s: %v", table, err)
		}
	}
}
