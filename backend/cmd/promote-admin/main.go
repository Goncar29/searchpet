// Command promote-admin grants (or revokes) the is_admin flag for a user,
// matched by email. There is deliberately no API to create an admin; this is
// the audited, repeatable way to bootstrap one without hand-editing the DB.
//
//	go run ./cmd/promote-admin -email you@example.com
//	go run ./cmd/promote-admin -email you@example.com -revoke
//
// Runs against DATABASE_URL (local or prod).
package main

import (
	"context"
	"errors"
	"flag"

	"go.uber.org/zap"
	"lost-pets/config"
	"lost-pets/internal/admintool"
	"lost-pets/internal/domain"
	"lost-pets/internal/repository"
	"lost-pets/pkg/database"
	"lost-pets/pkg/logger"
)

func main() {
	email := flag.String("email", "", "email of the user to grant/revoke admin (required)")
	revoke := flag.Bool("revoke", false, "revoke admin instead of granting it")
	flag.Parse()

	cfg := config.Load()
	log := logger.Init(cfg.Environment)
	defer log.Sync() //nolint:errcheck

	db, err := database.Connect(cfg.DatabaseURL)
	if err != nil {
		log.Fatal("promote-admin: DB connect failed", zap.Error(err))
	}
	// No AutoMigrate: promote-admin only ever targets an already-registered
	// user, so the users table is guaranteed to exist (the server created it).
	// Running a migration against prod just to flip one flag is avoidable risk.

	userRepo := repository.NewUserRepository(db)
	res, err := admintool.SetAdmin(context.Background(), userRepo, *email, !*revoke)
	if err != nil {
		switch {
		case errors.Is(err, domain.ErrInvalidInput):
			log.Fatal("promote-admin: -email is required")
		case errors.Is(err, domain.ErrUserNotFound):
			log.Fatal("promote-admin: no user with that email — register the account first, then re-run",
				zap.String("email", *email))
		default:
			log.Fatal("promote-admin: failed", zap.Error(err))
		}
	}

	granting := !*revoke
	if res.NoChange {
		log.Info("promote-admin: no change — user already in the requested state",
			zap.String("email", res.Email), zap.String("name", res.Name), zap.Bool("admin", granting))
		return
	}

	action := "revoked admin"
	if granting {
		action = "granted admin"
	}
	log.Info("promote-admin: "+action,
		zap.String("email", res.Email),
		zap.String("name", res.Name),
		zap.String("user_id", res.UserID))
}
