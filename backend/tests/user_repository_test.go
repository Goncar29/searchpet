package tests

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/repository"
	"lost-pets/tests/testdb"
)

func TestUserRepository_CreateAndGetByID(t *testing.T) {
	db := testdb.SetupTestDB(t)
	repo := repository.NewUserRepository(db)
	ctx := context.Background()

	user := &domain.User{
		ID:           uuid.New(),
		Email:        fmt.Sprintf("user-%s@test.com", uuid.New().String()[:8]),
		PasswordHash: "hashed",
		Name:         "Test User",
	}

	if err := repo.Create(ctx, user); err != nil {
		t.Fatalf("Create: %v", err)
	}

	got, err := repo.GetByID(ctx, user.ID)
	if err != nil {
		t.Fatalf("GetByID: %v", err)
	}
	if got.Email != user.Email {
		t.Errorf("want email %q, got %q", user.Email, got.Email)
	}
	if got.Name != user.Name {
		t.Errorf("want name %q, got %q", user.Name, got.Name)
	}
}

func TestUserRepository_GetByEmail_NotFound(t *testing.T) {
	db := testdb.SetupTestDB(t)
	repo := repository.NewUserRepository(db)
	ctx := context.Background()

	_, err := repo.GetByEmail(ctx, "nonexistent@test.com")
	if !errors.Is(err, domain.ErrUserNotFound) {
		t.Errorf("want ErrUserNotFound, got %v", err)
	}
}

func TestUserRepository_GetByID_NotFound(t *testing.T) {
	db := testdb.SetupTestDB(t)
	repo := repository.NewUserRepository(db)
	ctx := context.Background()

	_, err := repo.GetByID(ctx, uuid.New())
	if !errors.Is(err, domain.ErrUserNotFound) {
		t.Errorf("want ErrUserNotFound, got %v", err)
	}
}

func TestUserRepository_GetByEmail_Found(t *testing.T) {
	db := testdb.SetupTestDB(t)
	repo := repository.NewUserRepository(db)
	ctx := context.Background()

	email := fmt.Sprintf("find-%s@test.com", uuid.New().String()[:8])
	user := &domain.User{
		ID:           uuid.New(),
		Email:        email,
		PasswordHash: "hashed",
		Name:         "Find Me",
	}
	if err := repo.Create(ctx, user); err != nil {
		t.Fatalf("Create: %v", err)
	}

	got, err := repo.GetByEmail(ctx, email)
	if err != nil {
		t.Fatalf("GetByEmail: %v", err)
	}
	if got.ID != user.ID {
		t.Errorf("want ID %s, got %s", user.ID, got.ID)
	}
}

func TestUserRepository_Update(t *testing.T) {
	db := testdb.SetupTestDB(t)
	repo := repository.NewUserRepository(db)
	ctx := context.Background()

	user := &domain.User{
		ID:           uuid.New(),
		Email:        fmt.Sprintf("update-%s@test.com", uuid.New().String()[:8]),
		PasswordHash: "hashed",
		Name:         "Original Name",
	}
	if err := repo.Create(ctx, user); err != nil {
		t.Fatalf("Create: %v", err)
	}

	user.Name = "Updated Name"
	user.City = "Montevideo"
	if err := repo.Update(ctx, user); err != nil {
		t.Fatalf("Update: %v", err)
	}

	got, err := repo.GetByID(ctx, user.ID)
	if err != nil {
		t.Fatalf("GetByID after update: %v", err)
	}
	if got.Name != "Updated Name" {
		t.Errorf("want name 'Updated Name', got %q", got.Name)
	}
	if got.City != "Montevideo" {
		t.Errorf("want city 'Montevideo', got %q", got.City)
	}
}

func TestUserRepository_BanAndUnban(t *testing.T) {
	db := testdb.SetupTestDB(t)
	repo := repository.NewUserRepository(db)
	ctx := context.Background()

	user := &domain.User{
		ID:           uuid.New(),
		Email:        fmt.Sprintf("ban-%s@test.com", uuid.New().String()[:8]),
		PasswordHash: "hashed",
		Name:         "Ban Test",
	}
	if err := repo.Create(ctx, user); err != nil {
		t.Fatalf("Create: %v", err)
	}

	// Ban
	user.IsBanned = true
	user.BanReason = "spam"
	if err := repo.Update(ctx, user); err != nil {
		t.Fatalf("Update (ban): %v", err)
	}

	got, err := repo.GetByID(ctx, user.ID)
	if err != nil {
		t.Fatalf("GetByID after ban: %v", err)
	}
	if !got.IsBanned {
		t.Error("want IsBanned=true after ban")
	}

	// Unban
	user.IsBanned = false
	user.BanReason = ""
	if err := repo.Update(ctx, user); err != nil {
		t.Fatalf("Update (unban): %v", err)
	}

	got2, err := repo.GetByID(ctx, user.ID)
	if err != nil {
		t.Fatalf("GetByID after unban: %v", err)
	}
	if got2.IsBanned {
		t.Error("want IsBanned=false after unban")
	}
}

// GetByEmail debe ser insensible a mayúsculas: Register guarda el email tal cual
// lo tipeó el usuario, pero LoginWithGoogle normaliza a minúsculas. Sin esto, un
// usuario registrado como "Carlos@Example.com" que entra con Google no se
// encuentra y termina con una segunda cuenta duplicada.
func TestUserRepository_GetByEmailIsCaseInsensitive(t *testing.T) {
	db := testdb.SetupTestDB(t)
	repo := repository.NewUserRepository(db)
	ctx := context.Background()

	local := uuid.New().String()[:8]
	stored := fmt.Sprintf("Carlos-%s@Example.COM", local)
	user := &domain.User{
		ID:           uuid.New(),
		Email:        stored,
		PasswordHash: "hashed",
		Name:         "Test User",
	}
	if err := repo.Create(ctx, user); err != nil {
		t.Fatalf("Create: %v", err)
	}

	for _, lookup := range []string{
		stored,
		strings.ToLower(stored),
		strings.ToUpper(stored),
	} {
		got, err := repo.GetByEmail(ctx, lookup)
		if err != nil {
			t.Fatalf("GetByEmail(%q): %v", lookup, err)
		}
		if got.ID != user.ID {
			t.Errorf("GetByEmail(%q) returned %s, expected %s", lookup, got.ID, user.ID)
		}
	}

	if _, err := repo.GetByEmail(ctx, fmt.Sprintf("nadie-%s@example.com", local)); !errors.Is(err, domain.ErrUserNotFound) {
		t.Errorf("expected ErrUserNotFound for an unrelated address, got %v", err)
	}
}
