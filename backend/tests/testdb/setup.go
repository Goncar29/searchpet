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
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	sqlmigrate "github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/postgres"
	"github.com/golang-migrate/migrate/v4/source/iofs"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"lost-pets/pkg/database"
)

// allTableNames lists table names matching database.Models for truncation.
// Must be in reverse FK dependency order (children first).
var allTableNames = []string{
	"platform_events",
	"admin_audit_logs",
	"vets",
	"user_reviews",
	"verification_tokens",
	"device_tokens",
	"report_abuses",
	"blocked_users",
	"story_likes",
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
	"search_episodes",
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

	// AutoMigrate first — creates all base tables from domain models.
	// SQL migrations run after so that ALTER TABLE statements find existing tables.
	// Uses database.Models (the SAME canonical list production migrates) so the
	// test schema can never drift from prod — the drift that hid verification_tokens
	// being absent in prod.
	if migrateErr := db.AutoMigrate(database.Models...); migrateErr != nil {
		t.Fatalf("testdb: AutoMigrate failed: %v", migrateErr)
	}

	// Run SQL migrations (graceful — warn but don't fail if migrations dir not found).
	// Use runtime.Caller to get an absolute path to this file, then navigate to backend/migrations/.
	// This is cwd-independent and works both locally and in CI.
	//
	// The source is loaded via the iofs driver over os.DirFS rather than a
	// "file://" URL: golang-migrate's file source mangles Windows drive paths
	// ("file://C:\..." parses "C:" as the host; "file:///C:/..." yields the
	// invalid OS path "/C:/..."), which silently skipped EVERY migration locally
	// on Windows. iofs takes a real fs.FS, so it is path-syntax agnostic.
	_, thisFile, _, _ := runtime.Caller(0)
	migrationsDir := filepath.Join(filepath.Dir(thisFile), "..", "..", "migrations")
	src, srcErr := iofs.New(os.DirFS(migrationsDir), ".")
	if srcErr != nil {
		t.Logf("WARNING: migrations unavailable (%v) — skipping SQL migrations", srcErr)
	} else if m, merr := sqlmigrate.NewWithSourceInstance("iofs", src, dsn); merr != nil {
		t.Logf("WARNING: migrations unavailable (%v) — skipping SQL migrations", merr)
	} else {
		upErr := m.Up()
		if upErr != nil && upErr != sqlmigrate.ErrNoChange {
			// Recover from dirty state left by a previous failed run.
			var dirtyErr *sqlmigrate.ErrDirty
			if errors.As(upErr, &dirtyErr) {
				resetTo := dirtyErr.Version - 1
				if dirtyErr.Version == 0 {
					resetTo = 0
				}
				if forceErr := m.Force(int(resetTo)); forceErr == nil {
					if retryErr := m.Up(); retryErr != nil && retryErr != sqlmigrate.ErrNoChange {
						t.Logf("WARNING: migration Up failed after dirty recovery (%v)", retryErr)
					}
				} else {
					t.Logf("WARNING: failed to recover from dirty migration state (%v)", forceErr)
				}
			} else {
				t.Logf("WARNING: migration Up failed (%v)", upErr)
			}
		}
		m.Close()
	}

	// Truncate all tables after each test to ensure isolation, then close the
	// connection pool. Each test opens its own pool; without closing it the
	// idle connections accumulate across the suite and eventually exhaust
	// Postgres' max_connections ("too many clients already").
	t.Cleanup(func() {
		truncateAll(t, db)
		if sqlDB, err := db.DB(); err == nil {
			sqlDB.Close()
		}
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
