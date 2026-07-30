package service

import (
	"context"
	"crypto/subtle"
	"errors"
	"log"
	"time"

	"golang.org/x/crypto/bcrypt"
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

	// SECURITY: every failure from here on returns nil, not an error.
	//
	// These paths are only reachable for an account that exists and is not banned —
	// they sit after the two returns above. Surfacing them would hand out the very
	// oracle this endpoint is shaped to deny: if writes to verification_tokens fail
	// while users stays readable (a lock held by a migration, a pooler hiccup on the
	// second query), a real address would answer 500 and an invented one 200. That is
	// cheaper to exploit than the timing channel runAsync exists to close.
	//
	// Only the GetByEmail failure above returns an error, because that one cannot
	// depend on whether the address is registered.
	existing, err := s.tokenRepo.FindActiveByUser(ctx, user.ID, ChannelPasswordReset)
	if err != nil {
		log.Printf("[password_reset] token lookup failed for user %s: %v", user.ID, err)
		return nil
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
		log.Printf("[password_reset] code generation failed for user %s: %v", user.ID, err)
		return nil
	}

	// Retire every outstanding code before minting the replacement. FindActiveByUser
	// returns only the newest row, so without this the previous code stops working
	// while still looking valid: a user who types the one from the first email gets
	// otp_invalid with no explanation, and burns attempts on the new token doing it.
	if err := s.tokenRepo.MarkAllUsedByUser(ctx, user.ID, ChannelPasswordReset); err != nil {
		log.Printf("[password_reset] failed to retire previous tokens for user %s: %v", user.ID, err)
		return nil
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
		log.Printf("[password_reset] token create failed for user %s: %v", user.ID, err)
		return nil
	}

	userID, to, tokenID := user.ID, user.Email, token.ID
	s.runAsync(func() {
		// This stack is no longer under Gin's recovery, so an unhandled panic here
		// would take the whole API down instead of failing a single request.
		defer func() {
			if r := recover(); r != nil {
				// SECURITY: log the recovery, never the code.
				log.Printf("[password_reset] panic while sending to user %s: %v", userID, r)
			}
		}()

		// Detached: the HTTP request is already answered, so ctx may be cancelled.
		// Bounded like importGooglePhotoAsync in auth_service.go — without a deadline,
		// a provider that blackholes packets instead of refusing them leaves this
		// goroutine blocked in Do forever, pinning the plaintext code in its stack.
		bg, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()

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

func (s *passwordResetService) ConfirmReset(ctx context.Context, email, code, newPassword string) error {
	// SECURITY: every failure below returns domain.ErrOTPInvalid. Telling an
	// expired token apart from a wrong code (or from an unknown address) turns
	// this endpoint into an oracle for which accounts exist.
	user, err := s.userRepo.GetByEmail(ctx, email)
	if err != nil {
		if errors.Is(err, domain.ErrUserNotFound) {
			return domain.ErrOTPInvalid
		}
		return err
	}
	if user.IsBanned {
		return domain.ErrOTPInvalid
	}

	// SECURITY: every failure from here on returns ErrOTPInvalid, including
	// infrastructure ones. Same reasoning as RequestReset: these paths are only
	// reachable for an account that exists, so a distinguishable 500 would let a
	// caller tell a registered address from an invented one by submitting a garbage
	// code. It costs the user a misleading "invalid code" during a database fault,
	// which a retry resolves at no cost.
	token, err := s.tokenRepo.FindActiveByUser(ctx, user.ID, ChannelPasswordReset)
	if err != nil {
		log.Printf("[password_reset] token lookup failed for user %s: %v", user.ID, err)
		return domain.ErrOTPInvalid
	}
	if token == nil || time.Now().After(token.ExpiresAt) {
		return domain.ErrOTPInvalid
	}

	attempts, err := s.tokenRepo.IncrementAttempts(ctx, token.ID)
	if err != nil {
		log.Printf("[password_reset] attempt increment failed for user %s: %v", user.ID, err)
		return domain.ErrOTPInvalid
	}
	if attempts > otpMaxAttempts {
		_ = s.tokenRepo.MarkUsed(ctx, token.ID)
		return domain.ErrOTPInvalid
	}

	// Constant-time comparison: with only 5 attempts a prefix-timing attack is
	// impractical anyway, but the guarantee costs one line.
	if subtle.ConstantTimeCompare([]byte(hashOTPCode(code)), []byte(token.CodeHash)) != 1 {
		return domain.ErrOTPInvalid
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(newPassword), bcrypt.DefaultCost)
	if err != nil {
		return domain.ErrInternal
	}

	// Before the user update on purpose: if the write below fails, the token is
	// already spent and cannot be replayed. Retires every outstanding code, not
	// just the one spent here, so a leftover from an earlier request cannot drive
	// a second reset for the rest of its TTL.
	if err := s.tokenRepo.MarkAllUsedByUser(ctx, user.ID, ChannelPasswordReset); err != nil {
		log.Printf("[password_reset] mark-used failed for user %s: %v", user.ID, err)
		return domain.ErrOTPInvalid
	}

	// Truncated to the second: a JWT's `iat` has no sub-second component, so a
	// microsecond-precision value here would make a token issued immediately
	// after the reset reject itself.
	changedAt := time.Now().Truncate(time.Second)
	user.PasswordHash = string(hash)
	user.PasswordChangedAt = &changedAt

	if err := s.userRepo.Update(ctx, user); err != nil {
		log.Printf("[password_reset] password write failed for user %s: %v", user.ID, err)
		return domain.ErrOTPInvalid
	}
	return nil
}
