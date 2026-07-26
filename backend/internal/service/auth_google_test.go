package service_test

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/service"
	"lost-pets/pkg/googleauth"
	"lost-pets/pkg/jwt"
)

// ============================================================
// Mock: googleauth.Verifier
// ============================================================

type mockVerifier struct {
	claims *googleauth.Claims
	err    error
}

func (m *mockVerifier) Verify(context.Context, string) (*googleauth.Claims, error) {
	if m.err != nil {
		return nil, m.err
	}
	return m.claims, nil
}

var _ googleauth.Verifier = (*mockVerifier)(nil)

func googleClaims() *googleauth.Claims {
	return &googleauth.Claims{
		Sub:           "google-sub-123",
		Email:         "Carlos@Example.com",
		Name:          "Carlos",
		Picture:       "https://lh3.googleusercontent.com/a/photo",
		EmailVerified: true,
	}
}

// newGoogleAuthSvc builds the service with a mocked verifier. storage is nil,
// so the profile-photo import is skipped — it is best-effort by design and
// covered separately in TestLoginWithGoogle_NewUser_NoStorage_StillSucceeds.
func newGoogleAuthSvc(repo *mockUserRepo, v googleauth.Verifier) service.AuthService {
	return service.NewAuthService(repo, googleTestSecret, nil, nil, v)
}

const googleTestSecret = "test-secret-key-32chars-minimum!"

// assertTokenBelongsTo checks the JWT was minted for the expected user, not just
// that a non-empty string came back — a bug returning user A with a token for B
// would otherwise pass every assertion in this file.
func assertTokenBelongsTo(t *testing.T, token string, want uuid.UUID) {
	t.Helper()
	if token == "" {
		t.Fatal("expected non-empty JWT token")
	}
	got, err := jwt.ValidateToken(token, googleTestSecret)
	if err != nil {
		t.Fatalf("issued token does not validate: %v", err)
	}
	if got != want {
		t.Errorf("token was minted for %s, expected %s", got, want)
	}
}

func TestLoginWithGoogle_NewUser(t *testing.T) {
	repo := &mockUserRepo{emailErr: domain.ErrUserNotFound}
	svc := newGoogleAuthSvc(repo, &mockVerifier{claims: googleClaims()})

	user, token, isNew, err := svc.LoginWithGoogle(context.Background(), "any-token")

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if !isNew {
		t.Error("expected isNew=true for a first-time Google user")
	}
	if token == "" {
		t.Error("expected non-empty JWT token")
	}
	if user.GoogleID != "google-sub-123" {
		t.Errorf("expected GoogleID %q, got %q", "google-sub-123", user.GoogleID)
	}
	// Email is normalised: Google may return it with the original casing.
	if user.Email != "carlos@example.com" {
		t.Errorf("expected lowercased email, got %q", user.Email)
	}
	if !user.EmailVerified {
		t.Error("expected EmailVerified=true — Google already verified it, so the Brevo OTP is skipped")
	}
	if user.VerificationMethod != "google" {
		t.Errorf("expected VerificationMethod %q, got %q", "google", user.VerificationMethod)
	}
	if user.PasswordHash != "" {
		t.Error("expected empty PasswordHash for a Google-only account")
	}
	if repo.createdUser == nil {
		t.Error("expected the user to be persisted")
	}
	if !user.IsVerified {
		t.Error("expected IsVerified=true — the codebase invariant is EmailVerified || PhoneVerified")
	}
	// The fixture's claim email is "Carlos@Example.com". Asserting the LOOKUP key
	// (not just the stored value) is what proves we would find an existing
	// account, instead of silently creating a duplicate one.
	if repo.gotEmail != "carlos@example.com" {
		t.Errorf("expected the email lookup to use the normalised address, got %q", repo.gotEmail)
	}
}

func TestLoginWithGoogle_ReturningUser(t *testing.T) {
	existing := &domain.User{ID: uuid.New(), Email: "carlos@example.com", GoogleID: "google-sub-123"}
	repo := &mockUserRepo{googleUser: existing}
	svc := newGoogleAuthSvc(repo, &mockVerifier{claims: googleClaims()})

	user, token, isNew, err := svc.LoginWithGoogle(context.Background(), "any-token")

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if isNew {
		t.Error("expected isNew=false for a returning Google user")
	}
	assertTokenBelongsTo(t, token, existing.ID)
	if user.ID != existing.ID {
		t.Error("expected the existing user, matched by GoogleID")
	}
	if repo.createdUser != nil {
		t.Error("expected NO user creation for a returning user")
	}
	if len(repo.updatedUsers) != 0 {
		t.Error("the returning-user path must be read-only")
	}
}

func TestLoginWithGoogle_LinksExistingLocalAccount(t *testing.T) {
	existing := &domain.User{
		ID:           uuid.New(),
		Email:        "carlos@example.com",
		PasswordHash: bcryptHash(t, "segura123"),
	}
	// No GoogleID match, but the email exists → link.
	repo := &mockUserRepo{user: existing, emailErr: nil}
	svc := newGoogleAuthSvc(repo, &mockVerifier{claims: googleClaims()})

	user, token, isNew, err := svc.LoginWithGoogle(context.Background(), "any-token")

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if isNew {
		t.Error("expected isNew=false when linking an existing local account")
	}
	assertTokenBelongsTo(t, token, existing.ID)
	if user.GoogleID != "google-sub-123" {
		t.Errorf("expected the account to be linked, GoogleID=%q", user.GoogleID)
	}
	if !user.EmailVerified {
		t.Error("expected EmailVerified=true after linking")
	}
	if user.PasswordHash != "" {
		t.Error("SECURITY: linking an UNVERIFIED local account must discard its password — it may have been planted by an attacker (pre-hijacking)")
	}
	if !user.IsVerified {
		t.Error("expected IsVerified=true after linking — the codebase invariant is EmailVerified || PhoneVerified")
	}
	if len(repo.updatedUsers) != 1 {
		t.Errorf("expected exactly 1 Update call, got %d", len(repo.updatedUsers))
	}
	if repo.createdUser != nil {
		t.Error("expected NO user creation when linking")
	}
}

func TestLoginWithGoogle_RejectsUnverifiedEmail(t *testing.T) {
	claims := googleClaims()
	claims.EmailVerified = false
	repo := &mockUserRepo{emailErr: domain.ErrUserNotFound}
	svc := newGoogleAuthSvc(repo, &mockVerifier{claims: claims})

	_, _, _, err := svc.LoginWithGoogle(context.Background(), "any-token")

	if !errors.Is(err, domain.ErrGoogleEmailUnverified) {
		t.Fatalf("expected ErrGoogleEmailUnverified, got %v", err)
	}
	if repo.createdUser != nil {
		t.Error("SECURITY: an unverified Google email must never create or link an account")
	}
}

func TestLoginWithGoogle_UnverifiedEmailDoesNotLink(t *testing.T) {
	claims := googleClaims()
	claims.EmailVerified = false
	existing := &domain.User{ID: uuid.New(), Email: "carlos@example.com"}
	repo := &mockUserRepo{user: existing, emailErr: nil}
	svc := newGoogleAuthSvc(repo, &mockVerifier{claims: claims})

	_, _, _, err := svc.LoginWithGoogle(context.Background(), "any-token")

	if !errors.Is(err, domain.ErrGoogleEmailUnverified) {
		t.Fatalf("expected ErrGoogleEmailUnverified, got %v", err)
	}
	if len(repo.updatedUsers) != 0 {
		t.Error("SECURITY: account takeover — an unverified email must never link to an existing account")
	}
}

func TestLoginWithGoogle_InvalidToken(t *testing.T) {
	repo := &mockUserRepo{emailErr: domain.ErrUserNotFound}
	svc := newGoogleAuthSvc(repo, &mockVerifier{err: errors.New("bad signature")})

	_, _, _, err := svc.LoginWithGoogle(context.Background(), "any-token")

	if !errors.Is(err, domain.ErrGoogleTokenInvalid) {
		t.Fatalf("expected ErrGoogleTokenInvalid, got %v", err)
	}
}

func TestLoginWithGoogle_BannedUser(t *testing.T) {
	banned := &domain.User{ID: uuid.New(), Email: "carlos@example.com", GoogleID: "google-sub-123", IsBanned: true}
	repo := &mockUserRepo{googleUser: banned}
	svc := newGoogleAuthSvc(repo, &mockVerifier{claims: googleClaims()})

	_, _, _, err := svc.LoginWithGoogle(context.Background(), "any-token")

	if !errors.Is(err, domain.ErrUserBanned) {
		t.Fatalf("expected ErrUserBanned, got %v", err)
	}
}

func TestLoginWithGoogle_BannedLocalAccountCannotBeLinked(t *testing.T) {
	banned := &domain.User{ID: uuid.New(), Email: "carlos@example.com", IsBanned: true}
	repo := &mockUserRepo{user: banned, emailErr: nil}
	svc := newGoogleAuthSvc(repo, &mockVerifier{claims: googleClaims()})

	_, _, _, err := svc.LoginWithGoogle(context.Background(), "any-token")

	if !errors.Is(err, domain.ErrUserBanned) {
		t.Fatalf("expected ErrUserBanned, got %v", err)
	}
	if len(repo.updatedUsers) != 0 {
		t.Error("a banned account must not be linked — that would be a ban bypass")
	}
}

func TestLoginWithGoogle_VerifierNotConfigured(t *testing.T) {
	repo := &mockUserRepo{emailErr: domain.ErrUserNotFound}
	svc := newGoogleAuthSvc(repo, nil)

	_, _, _, err := svc.LoginWithGoogle(context.Background(), "any-token")

	if !errors.Is(err, domain.ErrGoogleSignInUnavailable) {
		t.Fatalf("expected ErrGoogleSignInUnavailable when GOOGLE_CLIENT_ID is unset, got %v", err)
	}
}

func TestLoginWithGoogle_NewUser_NoStorage_StillSucceeds(t *testing.T) {
	// storage is nil in newGoogleAuthSvc, so the Cloudinary import is skipped.
	// Signup must still succeed — the photo is best-effort.
	repo := &mockUserRepo{emailErr: domain.ErrUserNotFound}
	svc := newGoogleAuthSvc(repo, &mockVerifier{claims: googleClaims()})

	user, _, isNew, err := svc.LoginWithGoogle(context.Background(), "any-token")

	if err != nil {
		t.Fatalf("photo import failure must not block signup, got %v", err)
	}
	if !isNew {
		t.Error("expected isNew=true")
	}
	if user.ProfilePhotoURL != "" {
		t.Errorf("expected no photo when storage is unavailable, got %q", user.ProfilePhotoURL)
	}
}

func TestLoginWithGoogle_VerifiedLocalAccountKeepsPassword(t *testing.T) {
	existing := &domain.User{
		ID:            uuid.New(),
		Email:         "carlos@example.com",
		PasswordHash:  bcryptHash(t, "segura123"),
		EmailVerified: true, // ya probó el email por OTP
	}
	repo := &mockUserRepo{user: existing, emailErr: nil}
	svc := newGoogleAuthSvc(repo, &mockVerifier{claims: googleClaims()})

	user, _, _, err := svc.LoginWithGoogle(context.Background(), "any-token")

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if user.PasswordHash == "" {
		t.Error("a VERIFIED local account proved its email — it must keep both login methods")
	}
	if user.GoogleID != "google-sub-123" {
		t.Error("expected the account to be linked")
	}
}

func TestLoginWithGoogle_RejectsLinkToDifferentGoogleAccount(t *testing.T) {
	existing := &domain.User{
		ID:       uuid.New(),
		Email:    "carlos@example.com",
		GoogleID: "some-other-google-sub",
	}
	repo := &mockUserRepo{user: existing, emailErr: nil}
	svc := newGoogleAuthSvc(repo, &mockVerifier{claims: googleClaims()})

	_, _, _, err := svc.LoginWithGoogle(context.Background(), "any-token")

	if !errors.Is(err, domain.ErrGoogleAccountMismatch) {
		t.Fatalf("expected ErrGoogleAccountMismatch, got %v", err)
	}
	if len(repo.updatedUsers) != 0 {
		t.Error("an account bound to a different Google sub must not be rebound on an email match")
	}
}

func TestLoginWithGoogle_RepoErrorOnGoogleLookupDoesNotFallThrough(t *testing.T) {
	repo := &mockUserRepo{
		googleErr: errors.New("db down"),
		user:      &domain.User{ID: uuid.New(), Email: "carlos@example.com"},
	}
	svc := newGoogleAuthSvc(repo, &mockVerifier{claims: googleClaims()})

	_, _, _, err := svc.LoginWithGoogle(context.Background(), "any-token")

	if err == nil {
		t.Fatal("expected the repository error to propagate")
	}
	if len(repo.updatedUsers) != 0 || repo.createdUser != nil {
		t.Error("a transient DB error must never fall through into linking or creating an account")
	}
}

func TestLoginWithGoogle_UpdateFailureOnLinkIssuesNoToken(t *testing.T) {
	existing := &domain.User{ID: uuid.New(), Email: "carlos@example.com", EmailVerified: true}
	repo := &mockUserRepo{user: existing, emailErr: nil, updateErr: errors.New("db down")}
	svc := newGoogleAuthSvc(repo, &mockVerifier{claims: googleClaims()})

	_, token, _, err := svc.LoginWithGoogle(context.Background(), "any-token")

	if err == nil {
		t.Fatal("expected the update error to propagate")
	}
	if token != "" {
		t.Error("no token may be issued when the link could not be persisted")
	}
}

func TestLoginWithGoogle_CreateFailureIssuesNoToken(t *testing.T) {
	repo := &mockUserRepo{emailErr: domain.ErrUserNotFound, createErr: errors.New("db down")}
	svc := newGoogleAuthSvc(repo, &mockVerifier{claims: googleClaims()})

	_, token, _, err := svc.LoginWithGoogle(context.Background(), "any-token")

	if err == nil {
		t.Fatal("expected the create error to propagate")
	}
	if token != "" {
		t.Error("no token may be issued when the user could not be created")
	}
}
