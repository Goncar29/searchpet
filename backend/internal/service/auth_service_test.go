package service_test

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
	"lost-pets/internal/domain"
	"lost-pets/internal/service"
)

func newAuthSvc(repo *mockUserRepo) service.AuthService {
	// storage nil → no se testa Cloudinary aquí; fosterHomeService nil → hook no-op
	return service.NewAuthService(repo, "test-secret-key-32chars-minimum!", nil, nil)
}

func bcryptHash(t *testing.T, plain string) string {
	t.Helper()
	hash, err := bcrypt.GenerateFromPassword([]byte(plain), bcrypt.MinCost)
	if err != nil {
		t.Fatalf("bcrypt.GenerateFromPassword: %v", err)
	}
	return string(hash)
}

// ============================================================
// Tests: Register
// ============================================================

func TestRegister_HappyPath(t *testing.T) {
	repo := &mockUserRepo{emailErr: domain.ErrUserNotFound}
	svc := newAuthSvc(repo)

	user, token, err := svc.Register(context.Background(), "carlos@example.com", "segura123", "Carlos", "")

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if user == nil {
		t.Fatal("expected user, got nil")
	}
	if token == "" {
		t.Error("expected non-empty JWT token")
	}
	if user.Email != "carlos@example.com" {
		t.Errorf("expected email %q, got %q", "carlos@example.com", user.Email)
	}
}

func TestRegister_DuplicateEmail(t *testing.T) {
	existing := &domain.User{ID: uuid.New(), Email: "carlos@example.com"}
	// GetByEmail retorna usuario → email ya existe
	repo := &mockUserRepo{user: existing, emailErr: nil}
	svc := newAuthSvc(repo)

	_, _, err := svc.Register(context.Background(), "carlos@example.com", "segura123", "Carlos", "")

	if err != domain.ErrEmailAlreadyExists {
		t.Errorf("expected ErrEmailAlreadyExists, got %v", err)
	}
}

func TestRegister_DBError(t *testing.T) {
	repo := &mockUserRepo{
		emailErr:  domain.ErrUserNotFound, // email libre
		createErr: domain.ErrInternal,     // pero falla el INSERT
	}
	svc := newAuthSvc(repo)

	_, _, err := svc.Register(context.Background(), "carlos@example.com", "segura123", "Carlos", "")

	if err == nil {
		t.Fatal("expected error on DB failure, got nil")
	}
}

// ============================================================
// Tests: Login
// ============================================================

func TestLogin_HappyPath(t *testing.T) {
	user := &domain.User{
		ID:           uuid.New(),
		Email:        "carlos@example.com",
		PasswordHash: bcryptHash(t, "segura123"),
		IsBanned:     false,
	}
	repo := &mockUserRepo{user: user}
	svc := newAuthSvc(repo)

	got, token, err := svc.Login(context.Background(), "carlos@example.com", "segura123")

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if got.ID != user.ID {
		t.Errorf("expected user ID %v, got %v", user.ID, got.ID)
	}
	if token == "" {
		t.Error("expected non-empty JWT token")
	}
}

func TestLogin_WrongPassword(t *testing.T) {
	user := &domain.User{
		ID:           uuid.New(),
		PasswordHash: bcryptHash(t, "correcta"),
		IsBanned:     false,
	}
	repo := &mockUserRepo{user: user}
	svc := newAuthSvc(repo)

	_, _, err := svc.Login(context.Background(), "carlos@example.com", "incorrecta")

	if err != domain.ErrInvalidCredentials {
		t.Errorf("expected ErrInvalidCredentials, got %v", err)
	}
}

func TestLogin_BannedUser(t *testing.T) {
	user := &domain.User{
		ID:           uuid.New(),
		PasswordHash: bcryptHash(t, "segura123"),
		IsBanned:     true,
	}
	repo := &mockUserRepo{user: user}
	svc := newAuthSvc(repo)

	_, _, err := svc.Login(context.Background(), "banned@example.com", "segura123")

	if err != domain.ErrUserBanned {
		t.Errorf("expected ErrUserBanned, got %v", err)
	}
}

func TestLogin_UserNotFound_ReturnsInvalidCredentials(t *testing.T) {
	// Seguridad: no revelamos si el email existe o no
	repo := &mockUserRepo{emailErr: domain.ErrUserNotFound}
	svc := newAuthSvc(repo)

	_, _, err := svc.Login(context.Background(), "ghost@example.com", "cualquiera")

	if err != domain.ErrInvalidCredentials {
		t.Errorf("expected ErrInvalidCredentials (not ErrUserNotFound), got %v", err)
	}
}

// ============================================================
// Tests: UpdateProfile
// ============================================================

func TestUpdateProfile_HappyPath(t *testing.T) {
	userID := uuid.New()
	user := &domain.User{ID: userID, Name: "Viejo Nombre", Phone: ""}
	repo := &mockUserRepo{user: user}
	svc := newAuthSvc(repo)

	updated, err := svc.UpdateProfile(context.Background(), userID, "Nuevo Nombre", "+59899123456", "")

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if updated.Name != "Nuevo Nombre" {
		t.Errorf("expected name %q, got %q", "Nuevo Nombre", updated.Name)
	}
	if updated.Phone != "+59899123456" {
		t.Errorf("expected phone %q, got %q", "+59899123456", updated.Phone)
	}
}

func TestUpdateProfile_UserNotFound(t *testing.T) {
	repo := &mockUserRepo{getByIDErr: domain.ErrUserNotFound}
	svc := newAuthSvc(repo)

	_, err := svc.UpdateProfile(context.Background(), uuid.New(), "Nombre", "", "")

	if err == nil {
		t.Fatal("expected error for non-existent user, got nil")
	}
}
