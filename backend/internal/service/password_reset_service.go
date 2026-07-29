package service

import (
	"context"
	"errors"
	"log"
	"time"

	"lost-pets/internal/domain"
	"lost-pets/internal/repository"
	"lost-pets/pkg/mailer"
)

// ChannelPasswordReset scopes reset tokens inside the shared verification_tokens
// table. FindActiveByUser filters on it, so a token minted to verify an email can
// never be spent on a reset, nor the other way round.
const ChannelPasswordReset = "password_reset"

type passwordResetService struct {
	tokenRepo repository.VerificationTokenRepository
	userRepo  repository.UserRepository
	mailer    mailer.Mailer
	// runAsync detaches the mail send from the request. This is not a latency
	// optimisation, it is the enumeration defence: a synchronous Brevo round trip
	// makes a registered address take ~300-500ms against ~5ms for an unknown one,
	// which is trivially measurable. Tests run it inline for determinism.
	runAsync func(func())
}

// NewPasswordResetService construye el servicio con sus dependencias.
func NewPasswordResetService(
	tokenRepo repository.VerificationTokenRepository,
	userRepo repository.UserRepository,
	m mailer.Mailer,
) PasswordResetService {
	return &passwordResetService{
		tokenRepo: tokenRepo,
		userRepo:  userRepo,
		mailer:    m,
		runAsync:  func(f func()) { go f() },
	}
}

// NewPasswordResetServiceForTest injects runAsync so tests observe the send
// synchronously. Not for production wiring.
func NewPasswordResetServiceForTest(
	tokenRepo repository.VerificationTokenRepository,
	userRepo repository.UserRepository,
	m mailer.Mailer,
	runAsync func(func()),
) PasswordResetService {
	return &passwordResetService{tokenRepo: tokenRepo, userRepo: userRepo, mailer: m, runAsync: runAsync}
}

func (s *passwordResetService) RequestReset(ctx context.Context, email string) error {
	// GetByEmail matches case-insensitively (idx_users_email_lower, migration
	// 000019), so an account registered as Carlos@Example.com is reachable here.
	user, err := s.userRepo.GetByEmail(ctx, email)
	if err != nil {
		if errors.Is(err, domain.ErrUserNotFound) {
			return nil // indistinguishable from success, by design
		}
		// A database failure is independent of whether the address exists, so
		// surfacing it leaks nothing.
		return err
	}

	if user.IsBanned {
		return nil
	}

	existing, err := s.tokenRepo.FindActiveByUser(ctx, user.ID, ChannelPasswordReset)
	if err != nil {
		return err
	}
	if existing != nil && time.Since(existing.CreatedAt) < otpRateLimit {
		// Only a real account can be rate-limited, so the cooldown is swallowed.
		// Abuse is bounded by the per-IP rate limit middleware, which cannot tell
		// accounts apart and therefore cannot leak.
		return nil
	}

	// SECURITY: NUNCA loguear el código en texto plano.
	code, err := generateOTPCode()
	if err != nil {
		return err
	}

	token := &domain.VerificationToken{
		UserID:    user.ID,
		Channel:   ChannelPasswordReset,
		CodeHash:  hashOTPCode(code),
		Attempts:  0,
		ExpiresAt: time.Now().Add(otpTTL),
		Used:      false,
	}
	if err := s.tokenRepo.Create(ctx, token); err != nil {
		return err
	}

	userID, to, tokenID := user.ID, user.Email, token.ID
	s.runAsync(func() {
		// Detached: the HTTP request is already answered, so ctx may be cancelled.
		bg := context.Background()
		if sendErr := s.mailer.SendPasswordReset(bg, to, code); sendErr != nil {
			// SECURITY: sendErr carries the provider status, never the code.
			log.Printf("[password_reset] send failed for user %s: %v", userID, sendErr)
			// Free the cooldown: leaving the token active would block a retry for
			// 60s even though the user never received anything.
			if muErr := s.tokenRepo.MarkUsed(bg, tokenID); muErr != nil {
				log.Printf("[password_reset] failed to invalidate token after send failure: %v", muErr)
			}
		}
	})

	return nil
}

// ConfirmReset is implemented in Task 7 of the password-recovery plan. This
// stub exists ONLY so *passwordResetService satisfies the PasswordResetService
// interface added in this task (Task 6 Step 3 declares both methods, Step 4
// implements only RequestReset — without this stub `go build` fails with
// "missing method ConfirmReset"). It carries none of Task 7's logic (no
// bcrypt, no attempt cap, no channel check, no PasswordChangedAt stamp) and is
// not exercised by any test in this task.
func (s *passwordResetService) ConfirmReset(ctx context.Context, email, code, newPassword string) error {
	return domain.ErrOTPInvalid
}
