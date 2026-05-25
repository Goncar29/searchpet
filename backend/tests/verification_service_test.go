package tests

import (
	"context"
	"crypto/sha256"
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/dto"
	"lost-pets/internal/service"
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

			err := svc.ConfirmOTP(ctx, userID, tc.channel, validCode)
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

	err := svc.ConfirmOTP(ctx, userID, "email", "wrong_code")
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
