package tests

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/service"
)

// ============================================================
// Mocks specific to password reset (the shared ones in
// verification_service_test.go key on GetByID, this flow keys on GetByEmail).
// ============================================================

type resetUserRepo struct {
	byEmail   map[string]*domain.User
	updated   *domain.User
	updateErr error
}

func (r *resetUserRepo) Create(context.Context, *domain.User) error { return nil }
func (r *resetUserRepo) GetByID(context.Context, uuid.UUID) (*domain.User, error) {
	return nil, domain.ErrUserNotFound
}
func (r *resetUserRepo) GetByEmail(_ context.Context, email string) (*domain.User, error) {
	u, ok := r.byEmail[email]
	if !ok {
		return nil, domain.ErrUserNotFound
	}
	return u, nil
}
func (r *resetUserRepo) GetByGoogleID(context.Context, string) (*domain.User, error) {
	return nil, domain.ErrUserNotFound
}
func (r *resetUserRepo) Update(_ context.Context, u *domain.User) error {
	if r.updateErr != nil {
		return r.updateErr
	}
	r.updated = u
	return nil
}
func (r *resetUserRepo) Delete(context.Context, uuid.UUID) error { return nil }

type resetTokenRepo struct {
	active     *domain.VerificationToken
	created    []*domain.VerificationToken
	markedUsed []uuid.UUID
	attempts   int
}

func (r *resetTokenRepo) Create(_ context.Context, t *domain.VerificationToken) error {
	t.ID = uuid.New()
	t.CreatedAt = time.Now()
	r.created = append(r.created, t)
	return nil
}
func (r *resetTokenRepo) FindActiveByUser(_ context.Context, _ uuid.UUID, channel string) (*domain.VerificationToken, error) {
	if r.active != nil && r.active.Channel == channel {
		return r.active, nil
	}
	return nil, nil
}
func (r *resetTokenRepo) MarkUsed(_ context.Context, id uuid.UUID) error {
	r.markedUsed = append(r.markedUsed, id)
	return nil
}
func (r *resetTokenRepo) IncrementAttempts(context.Context, uuid.UUID) (int, error) {
	r.attempts++
	return r.attempts, nil
}
func (r *resetTokenRepo) DeleteExpired(context.Context) (int64, error) { return 0, nil }

type recordingMailer struct {
	sentTo   string
	sentCode string
	err      error
}

func (m *recordingMailer) SendOTP(context.Context, string, string) error { return nil }
func (m *recordingMailer) SendPasswordReset(_ context.Context, to, code string) error {
	m.sentTo, m.sentCode = to, code
	return m.err
}

// newResetSvc builds the service with runAsync inlined so tests are deterministic.
func newResetSvc(users *resetUserRepo, tokens *resetTokenRepo, m *recordingMailer) service.PasswordResetService {
	return service.NewPasswordResetServiceForTest(tokens, users, m, func(f func()) { f() })
}

func knownUser(email string) *resetUserRepo {
	return &resetUserRepo{byEmail: map[string]*domain.User{
		email: {ID: uuid.New(), Email: email, PasswordHash: "old-hash"},
	}}
}

// ============================================================
// RequestReset — enumeration resistance
// ============================================================

func TestRequestReset_UnknownEmail_NoTokenNoMailNoError(t *testing.T) {
	users := &resetUserRepo{byEmail: map[string]*domain.User{}}
	tokens := &resetTokenRepo{}
	m := &recordingMailer{}

	if err := newResetSvc(users, tokens, m).RequestReset(context.Background(), "ghost@example.com"); err != nil {
		t.Fatalf("unknown email must not surface an error, got %v", err)
	}
	if len(tokens.created) != 0 {
		t.Fatal("no token may be created for an unknown address")
	}
	if m.sentTo != "" {
		t.Fatal("no mail may be sent to an unknown address")
	}
}

func TestRequestReset_BannedUser_NoTokenNoMailNoError(t *testing.T) {
	users := knownUser("banned@example.com")
	users.byEmail["banned@example.com"].IsBanned = true
	tokens := &resetTokenRepo{}
	m := &recordingMailer{}

	if err := newResetSvc(users, tokens, m).RequestReset(context.Background(), "banned@example.com"); err != nil {
		t.Fatalf("banned user must be indistinguishable from success, got %v", err)
	}
	if len(tokens.created) != 0 || m.sentTo != "" {
		t.Fatal("a banned user must produce neither a token nor a mail")
	}
}

func TestRequestReset_WithinCooldown_SwallowsRateLimit(t *testing.T) {
	users := knownUser("user@example.com")
	tokens := &resetTokenRepo{active: &domain.VerificationToken{
		ID:        uuid.New(),
		Channel:   "password_reset",
		CreatedAt: time.Now().Add(-10 * time.Second), // inside the 60s window
		ExpiresAt: time.Now().Add(9 * time.Minute),
	}}
	m := &recordingMailer{}

	// Surfacing the rate limit would leak existence: only real accounts can hit it.
	if err := newResetSvc(users, tokens, m).RequestReset(context.Background(), "user@example.com"); err != nil {
		t.Fatalf("cooldown must be swallowed, got %v", err)
	}
	if len(tokens.created) != 0 || m.sentTo != "" {
		t.Fatal("cooldown must suppress both the token and the mail")
	}
}

func TestRequestReset_HappyPath_CreatesTokenAndSends(t *testing.T) {
	users := knownUser("user@example.com")
	tokens := &resetTokenRepo{}
	m := &recordingMailer{}

	if err := newResetSvc(users, tokens, m).RequestReset(context.Background(), "user@example.com"); err != nil {
		t.Fatalf("RequestReset: %v", err)
	}
	if len(tokens.created) != 1 {
		t.Fatalf("created %d tokens, want 1", len(tokens.created))
	}
	tok := tokens.created[0]
	if tok.Channel != "password_reset" {
		t.Fatalf("channel = %q, want password_reset", tok.Channel)
	}
	if tok.CodeHash == "" || len(tok.CodeHash) != 64 {
		t.Fatalf("CodeHash = %q, want a 64-char sha256 hex", tok.CodeHash)
	}
	if m.sentTo != "user@example.com" {
		t.Fatalf("sentTo = %q", m.sentTo)
	}
	if len(m.sentCode) != 6 {
		t.Fatalf("sentCode = %q, want 6 digits", m.sentCode)
	}
	// The plaintext code must never be persisted.
	if tok.CodeHash == m.sentCode {
		t.Fatal("the token stores the plaintext code")
	}
}

func TestRequestReset_MailFailure_StillReturnsNilAndFreesTheCooldown(t *testing.T) {
	users := knownUser("user@example.com")
	tokens := &resetTokenRepo{}
	m := &recordingMailer{err: errors.New("brevo down")}

	// A 502 here would appear ONLY for addresses that exist.
	if err := newResetSvc(users, tokens, m).RequestReset(context.Background(), "user@example.com"); err != nil {
		t.Fatalf("mail failure must not reach the caller, got %v", err)
	}
	if len(tokens.markedUsed) != 1 {
		t.Fatal("a failed send must invalidate the token so the 60s cooldown does not block the retry")
	}
}
