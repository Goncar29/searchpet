package tests

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"log"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/dto"
	"lost-pets/internal/service"
	"lost-pets/pkg/mailer"
	"lost-pets/pkg/sms"
)

// ============================================================
// Mock: UserRepository (minimal — only methods used by VerificationService)
// ============================================================

type mockUserRepo struct {
	user      *domain.User
	updateFn  func(ctx context.Context, u *domain.User) error
}

func (m *mockUserRepo) Create(ctx context.Context, u *domain.User) error { return nil }

func (m *mockUserRepo) GetByID(ctx context.Context, id uuid.UUID) (*domain.User, error) {
	if m.user == nil {
		return nil, domain.ErrUserNotFound
	}
	return m.user, nil
}

func (m *mockUserRepo) GetByEmail(ctx context.Context, email string) (*domain.User, error) {
	return nil, domain.ErrUserNotFound
}

func (m *mockUserRepo) Update(ctx context.Context, u *domain.User) error {
	if m.updateFn != nil {
		return m.updateFn(ctx, u)
	}
	// Default: mirror mutations back to m.user so assertions can read them.
	*m.user = *u
	return nil
}

func (m *mockUserRepo) Delete(ctx context.Context, id uuid.UUID) error { return nil }

// ============================================================
// Mock: VerificationTokenRepository
// ============================================================

type mockTokenRepo struct {
	activeToken       *domain.VerificationToken
	incrementAttempts int
	markUsedCalled    bool
}

func (m *mockTokenRepo) Create(ctx context.Context, t *domain.VerificationToken) error { return nil }

func (m *mockTokenRepo) FindActiveByUser(ctx context.Context, userID uuid.UUID, channel string) (*domain.VerificationToken, error) {
	return m.activeToken, nil
}

func (m *mockTokenRepo) MarkUsed(ctx context.Context, id uuid.UUID) error {
	m.markUsedCalled = true
	return nil
}

func (m *mockTokenRepo) IncrementAttempts(ctx context.Context, id uuid.UUID) (int, error) {
	m.incrementAttempts++
	return m.incrementAttempts, nil
}

func (m *mockTokenRepo) DeleteExpired(ctx context.Context) (int64, error) { return 0, nil }

// ============================================================
// Helpers
// ============================================================

func hashCode(code string) string {
	h := sha256.Sum256([]byte(code))
	return fmt.Sprintf("%x", h)
}

func makeToken(channel, code string, userID uuid.UUID) *domain.VerificationToken {
	return &domain.VerificationToken{
		ID:        uuid.New(),
		UserID:    userID,
		Channel:   channel,
		CodeHash:  hashCode(code),
		Attempts:  0,
		ExpiresAt: time.Now().Add(10 * time.Minute),
		Used:      false,
	}
}

// ============================================================
// T-12: ConfirmOTP sets is_verified and verification_method
// ============================================================

func TestConfirmOTP_SetsIsVerifiedAndMethod(t *testing.T) {
	ctx := context.Background()
	userID := uuid.New()
	const validCode = "123456"

	tests := []struct {
		name                    string
		channel                 string
		initialEmailVerified    bool
		initialPhoneVerified    bool
		wantEmailVerified       bool
		wantPhoneVerified       bool
		wantIsVerified          bool
		wantVerificationMethod  string
	}{
		{
			name:                   "SCENARIO-1A: email OTP confirm sets is_verified=true, method=email",
			channel:                "email",
			initialEmailVerified:   false,
			initialPhoneVerified:   false,
			wantEmailVerified:      true,
			wantPhoneVerified:      false,
			wantIsVerified:         true,
			wantVerificationMethod: "email",
		},
		{
			name:                   "SCENARIO-1B: phone OTP when email already verified sets method=both",
			channel:                "sms",
			initialEmailVerified:   true,
			initialPhoneVerified:   false,
			wantEmailVerified:      true,
			wantPhoneVerified:      true,
			wantIsVerified:         true,
			wantVerificationMethod: "both",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			user := &domain.User{
				ID:            userID,
				Email:         "test@example.com",
				EmailVerified: tc.initialEmailVerified,
				PhoneVerified: tc.initialPhoneVerified,
				IsVerified:    tc.initialEmailVerified || tc.initialPhoneVerified,
			}

			userRepo := &mockUserRepo{user: user}
			tokenRepo := &mockTokenRepo{
				activeToken: makeToken(tc.channel, validCode, userID),
			}

			svc := service.NewVerificationService(tokenRepo, userRepo, nil, nil, nil)

			// For SMS tests, set TargetPhone on the token to match the call.
			phone := ""
			if tc.channel == "sms" {
				phone = "+59812345678"
				tokenRepo.activeToken.TargetPhone = phone
			}
			err := svc.ConfirmOTP(ctx, userID, tc.channel, validCode, phone)
			if err != nil {
				t.Fatalf("expected no error, got %v", err)
			}

			if user.EmailVerified != tc.wantEmailVerified {
				t.Errorf("EmailVerified: want %v, got %v", tc.wantEmailVerified, user.EmailVerified)
			}
			if user.PhoneVerified != tc.wantPhoneVerified {
				t.Errorf("PhoneVerified: want %v, got %v", tc.wantPhoneVerified, user.PhoneVerified)
			}
			if user.IsVerified != tc.wantIsVerified {
				t.Errorf("IsVerified: want %v, got %v", tc.wantIsVerified, user.IsVerified)
			}
			if user.VerificationMethod != tc.wantVerificationMethod {
				t.Errorf("VerificationMethod: want %q, got %q", tc.wantVerificationMethod, user.VerificationMethod)
			}
		})
	}
}

// SCENARIO-1C: invalid code returns ErrOTPInvalid, IsVerified stays false
func TestConfirmOTP_InvalidCode_ReturnsError(t *testing.T) {
	ctx := context.Background()
	userID := uuid.New()

	user := &domain.User{
		ID:            userID,
		Email:         "test@example.com",
		EmailVerified: false,
		IsVerified:    false,
	}
	userRepo := &mockUserRepo{user: user}
	tokenRepo := &mockTokenRepo{
		activeToken: makeToken("email", "correct", userID),
	}

	svc := service.NewVerificationService(tokenRepo, userRepo, nil, nil, nil)

	err := svc.ConfirmOTP(ctx, userID, "email", "wrong_code", "")
	if err == nil {
		t.Fatal("expected ErrOTPInvalid, got nil")
	}
	if err != domain.ErrOTPInvalid {
		t.Errorf("want ErrOTPInvalid, got %v", err)
	}
	if user.IsVerified {
		t.Error("IsVerified should remain false on invalid OTP")
	}
}

// ============================================================
// T07: Phone atomicity — new test cases
// ============================================================

// Phone mismatch on ConfirmOTP (sms) returns error and does not update user.
func TestConfirmOTP_SMS_PhoneMismatch_ReturnsError(t *testing.T) {
	ctx := context.Background()
	userID := uuid.New()
	const validCode = "123456"

	user := &domain.User{
		ID:            userID,
		Email:         "test@example.com",
		PhoneVerified: false,
	}
	userRepo := &mockUserRepo{user: user}
	token := makeToken("sms", validCode, userID)
	token.TargetPhone = "+59812345678"
	tokenRepo := &mockTokenRepo{activeToken: token}

	svc := service.NewVerificationService(tokenRepo, userRepo, nil, nil, nil)

	// Pass a different phone than TargetPhone — should fail.
	err := svc.ConfirmOTP(ctx, userID, "sms", validCode, "+59899999999")
	if err == nil {
		t.Fatal("expected phone mismatch error, got nil")
	}
	if !errors.Is(err, domain.ErrPhoneMismatch) {
		t.Errorf("want domain.ErrPhoneMismatch, got %v", err)
	}
	if user.PhoneVerified {
		t.Error("PhoneVerified should remain false on phone mismatch")
	}
	if user.Phone != "" {
		t.Errorf("Phone should not be updated on mismatch, got %q", user.Phone)
	}
}

// Happy path: SMS confirm stores Phone and PhoneVerified atomically.
func TestConfirmOTP_SMS_HappyPath_StoresPhoneAndVerified(t *testing.T) {
	ctx := context.Background()
	userID := uuid.New()
	const validCode = "123456"
	const targetPhone = "+59812345678"

	user := &domain.User{
		ID:            userID,
		Email:         "test@example.com",
		Phone:         "",
		PhoneVerified: false,
	}
	userRepo := &mockUserRepo{user: user}
	token := makeToken("sms", validCode, userID)
	token.TargetPhone = targetPhone
	tokenRepo := &mockTokenRepo{activeToken: token}

	svc := service.NewVerificationService(tokenRepo, userRepo, nil, nil, nil)

	err := svc.ConfirmOTP(ctx, userID, "sms", validCode, targetPhone)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if !user.PhoneVerified {
		t.Error("PhoneVerified should be true after successful SMS confirm")
	}
	if user.Phone != targetPhone {
		t.Errorf("Phone: want %q, got %q", targetPhone, user.Phone)
	}
	if !user.IsVerified {
		t.Error("IsVerified should be true after phone verification")
	}
}

// SendOTP for SMS stores TargetPhone in token.
func TestSendOTP_SMS_StoresTargetPhone(t *testing.T) {
	ctx := context.Background()
	userID := uuid.New()
	const phone = "+59812345678"

	user := &domain.User{
		ID:    userID,
		Email: "test@example.com",
		Phone: phone,
	}
	userRepo := &mockUserRepo{user: user}

	var createdToken *domain.VerificationToken
	tokenRepo := &mockTokenRepo{}
	// Override Create to capture the token.
	captureRepo := &captureTokenRepo{
		mockTokenRepo: tokenRepo,
		onCreate: func(t *domain.VerificationToken) {
			createdToken = t
		},
	}

	svc := service.NewVerificationService(captureRepo, userRepo, &noopMailer{}, &noopSMS{}, nil)

	err := svc.SendOTP(ctx, userID, "sms", phone)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if createdToken == nil {
		t.Fatal("expected token to be created")
	}
	if createdToken.TargetPhone != phone {
		t.Errorf("TargetPhone: want %q, got %q", phone, createdToken.TargetPhone)
	}
}

// captureTokenRepo wraps mockTokenRepo and intercepts Create.
type captureTokenRepo struct {
	*mockTokenRepo
	onCreate func(*domain.VerificationToken)
}

func (c *captureTokenRepo) Create(ctx context.Context, t *domain.VerificationToken) error {
	if c.onCreate != nil {
		c.onCreate(t)
	}
	return nil
}

func (c *captureTokenRepo) FindActiveByUser(ctx context.Context, userID uuid.UUID, channel string) (*domain.VerificationToken, error) {
	return c.mockTokenRepo.FindActiveByUser(ctx, userID, channel)
}

func (c *captureTokenRepo) MarkUsed(ctx context.Context, id uuid.UUID) error {
	return c.mockTokenRepo.MarkUsed(ctx, id)
}

func (c *captureTokenRepo) IncrementAttempts(ctx context.Context, id uuid.UUID) (int, error) {
	return c.mockTokenRepo.IncrementAttempts(ctx, id)
}

func (c *captureTokenRepo) DeleteExpired(ctx context.Context) (int64, error) {
	return c.mockTokenRepo.DeleteExpired(ctx)
}

// SendOTP with a failing mailer returns ErrExternalService, invalidates the
// pending token (so the 60s cooldown does not block an immediate retry after
// a provider failure), and logs the upstream cause for diagnosis.
func TestSendOTP_MailerFails_InvalidatesTokenAndLogsCause(t *testing.T) {
	ctx := context.Background()
	userID := uuid.New()

	userRepo := &mockUserRepo{user: &domain.User{ID: userID, Email: "test@example.com"}}
	tokenRepo := &mockTokenRepo{}

	svc := service.NewVerificationService(tokenRepo, userRepo, &failingMailer{}, &noopSMS{}, nil)

	var logBuf bytes.Buffer
	log.SetOutput(&logBuf)
	defer log.SetOutput(os.Stderr)

	err := svc.SendOTP(ctx, userID, "email", "")

	var extErr *service.ErrExternalService
	if !errors.As(err, &extErr) {
		t.Fatalf("expected ErrExternalService, got %v", err)
	}
	if !tokenRepo.markUsedCalled {
		t.Error("expected failed-send token to be invalidated (MarkUsed) so retry is not cooldown-blocked")
	}
	if !strings.Contains(logBuf.String(), "brevo returned status 401") {
		t.Errorf("expected upstream cause in logs, got: %q", logBuf.String())
	}
}

// failingMailer simulates a provider rejection (e.g. Brevo 401).
type failingMailer struct{}

func (f *failingMailer) SendOTP(ctx context.Context, to, code string) error {
	return fmt.Errorf("mailer: brevo returned status 401")
}

var _ mailer.Mailer = (*failingMailer)(nil)

// noopMailer implements mailer.Mailer with no side-effects.
type noopMailer struct{}

func (n *noopMailer) SendOTP(ctx context.Context, to, code string) error { return nil }

// Compile-time interface check.
var _ mailer.Mailer = (*noopMailer)(nil)

// noopSMS implements sms.SMSSender with no side-effects.
type noopSMS struct{}

func (n *noopSMS) SendOTP(ctx context.Context, to, code string) error { return nil }

// Compile-time interface check.
var _ sms.SMSSender = (*noopSMS)(nil)

// ============================================================
// T-13: GetStatus returns correct DTO from user fields
// ============================================================

func TestGetStatus_ReturnsCorrectDTO(t *testing.T) {
	ctx := context.Background()

	tests := []struct {
		name        string
		user        *domain.User
		wantDTO     dto.VerificationStatusResponse
	}{
		{
			name: "unverified user",
			user: &domain.User{
				ID:            uuid.New(),
				EmailVerified: false,
				PhoneVerified: false,
				IsVerified:    false,
			},
			wantDTO: dto.VerificationStatusResponse{
				EmailVerified: false,
				PhoneVerified: false,
				IsVerified:    false,
			},
		},
		{
			name: "email-verified user",
			user: &domain.User{
				ID:            uuid.New(),
				EmailVerified: true,
				PhoneVerified: false,
				IsVerified:    true,
			},
			wantDTO: dto.VerificationStatusResponse{
				EmailVerified: true,
				PhoneVerified: false,
				IsVerified:    true,
			},
		},
		{
			name: "both-verified user",
			user: &domain.User{
				ID:            uuid.New(),
				EmailVerified: true,
				PhoneVerified: true,
				IsVerified:    true,
			},
			wantDTO: dto.VerificationStatusResponse{
				EmailVerified: true,
				PhoneVerified: true,
				IsVerified:    true,
			},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			userRepo := &mockUserRepo{user: tc.user}
			tokenRepo := &mockTokenRepo{}

			svc := service.NewVerificationService(tokenRepo, userRepo, nil, nil, nil)

			result, err := svc.GetStatus(ctx, tc.user.ID)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if result.EmailVerified != tc.wantDTO.EmailVerified {
				t.Errorf("EmailVerified: want %v, got %v", tc.wantDTO.EmailVerified, result.EmailVerified)
			}
			if result.PhoneVerified != tc.wantDTO.PhoneVerified {
				t.Errorf("PhoneVerified: want %v, got %v", tc.wantDTO.PhoneVerified, result.PhoneVerified)
			}
			if result.IsVerified != tc.wantDTO.IsVerified {
				t.Errorf("IsVerified: want %v, got %v", tc.wantDTO.IsVerified, result.IsVerified)
			}
		})
	}
}
