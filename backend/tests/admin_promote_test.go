package tests

import (
	"context"
	"errors"
	"testing"

	"lost-pets/internal/admintool"
	"lost-pets/internal/domain"
	"lost-pets/internal/repository"
	"lost-pets/tests/testdb"
)

func TestSetAdmin_PromotesUserByEmail(t *testing.T) {
	db := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(db)
	u := newTestUser(t, userRepo)

	res, err := admintool.SetAdmin(context.Background(), userRepo, u.Email, true)
	if err != nil {
		t.Fatalf("SetAdmin: %v", err)
	}
	if res.NoChange {
		t.Errorf("expected a change, got NoChange=true")
	}
	if res.Email != u.Email {
		t.Errorf("want email %q in result, got %q", u.Email, res.Email)
	}

	got, err := userRepo.GetByEmail(context.Background(), u.Email)
	if err != nil {
		t.Fatalf("GetByEmail: %v", err)
	}
	if !got.IsAdmin {
		t.Errorf("expected IsAdmin=true after promote")
	}
}

func TestSetAdmin_AlreadyInDesiredStateIsNoChange(t *testing.T) {
	db := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(db)
	u := newTestUser(t, userRepo)
	if _, err := admintool.SetAdmin(context.Background(), userRepo, u.Email, true); err != nil {
		t.Fatalf("first promote: %v", err)
	}

	res, err := admintool.SetAdmin(context.Background(), userRepo, u.Email, true)
	if err != nil {
		t.Fatalf("second promote: %v", err)
	}
	if !res.NoChange {
		t.Errorf("expected NoChange=true on already-admin")
	}
}

func TestSetAdmin_DemotesUser(t *testing.T) {
	db := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(db)
	u := newTestUser(t, userRepo)
	if _, err := admintool.SetAdmin(context.Background(), userRepo, u.Email, true); err != nil {
		t.Fatalf("promote: %v", err)
	}

	if _, err := admintool.SetAdmin(context.Background(), userRepo, u.Email, false); err != nil {
		t.Fatalf("demote: %v", err)
	}
	got, _ := userRepo.GetByEmail(context.Background(), u.Email)
	if got.IsAdmin {
		t.Errorf("expected IsAdmin=false after demote")
	}
}

func TestSetAdmin_TrimsSurroundingWhitespace(t *testing.T) {
	db := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(db)
	u := newTestUser(t, userRepo)

	if _, err := admintool.SetAdmin(context.Background(), userRepo, "  "+u.Email+"  ", true); err != nil {
		t.Fatalf("SetAdmin with padded email: %v", err)
	}
	got, _ := userRepo.GetByEmail(context.Background(), u.Email)
	if !got.IsAdmin {
		t.Errorf("expected IsAdmin=true; padded email should match the stored one")
	}
}

func TestSetAdmin_UnknownEmailReturnsNotFound(t *testing.T) {
	db := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(db)

	_, err := admintool.SetAdmin(context.Background(), userRepo, "nobody@nowhere.test", true)
	if !errors.Is(err, domain.ErrUserNotFound) {
		t.Errorf("want ErrUserNotFound, got %v", err)
	}
}

func TestSetAdmin_EmptyEmailReturnsInvalidInput(t *testing.T) {
	db := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(db)

	_, err := admintool.SetAdmin(context.Background(), userRepo, "   ", true)
	if !errors.Is(err, domain.ErrInvalidInput) {
		t.Errorf("want ErrInvalidInput for empty email, got %v", err)
	}
}
