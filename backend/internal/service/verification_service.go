package service

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/repository"
	"lost-pets/pkg/mailer"
	"lost-pets/pkg/sms"
)

const (
	otpTTL         = 10 * time.Minute
	otpRateLimit   = 60 * time.Second
	otpMaxAttempts = 5
)

type verificationService struct {
	tokenRepo  repository.VerificationTokenRepository
	userRepo   repository.UserRepository
	mailer     mailer.Mailer
	smsSender  sms.SMSSender
	gamSvc     GamificationService
}

// NewVerificationService construye el VerificationService con sus dependencias.
// gamSvc puede ser nil si la gamificación no está habilitada (defensivo).
func NewVerificationService(
	tokenRepo repository.VerificationTokenRepository,
	userRepo repository.UserRepository,
	m mailer.Mailer,
	s sms.SMSSender,
	gamSvc GamificationService,
) VerificationService {
	return &verificationService{
		tokenRepo: tokenRepo,
		userRepo:  userRepo,
		mailer:    m,
		smsSender: s,
		gamSvc:    gamSvc,
	}
}

// SendOTP genera y envía un OTP al usuario por el canal dado.
// SECURITY: el código en texto plano NUNCA es logueado.
func (s *verificationService) SendOTP(ctx context.Context, userID uuid.UUID, channel string) error {
	// Validar canal
	if channel != "email" && channel != "sms" {
		return domain.ErrInvalidInput
	}

	// Cargar usuario para obtener email/phone
	user, err := s.userRepo.GetByID(ctx, userID)
	if err != nil {
		return err
	}

	// Validación SMS: usuario debe tener teléfono
	if channel == "sms" && strings.TrimSpace(user.Phone) == "" {
		return &ErrNoPhoneOnFile{}
	}

	// Rate limit: verificar si ya hay un token activo reciente (< 60s)
	existing, err := s.tokenRepo.FindActiveByUser(ctx, userID, channel)
	if err != nil {
		return err
	}
	if existing != nil {
		elapsed := time.Since(existing.CreatedAt)
		if elapsed < otpRateLimit {
			retryAfter := int((otpRateLimit - elapsed).Seconds()) + 1
			return &ErrRateLimitOTP{RetryAfter: retryAfter}
		}
	}

	// Generar código de 6 dígitos con crypto/rand
	// SECURITY: NUNCA loguear el código en texto plano
	code, err := generateOTPCode()
	if err != nil {
		return fmt.Errorf("otp: generate error: %w", err)
	}

	// Calcular SHA-256 del código y almacenar SOLO el hash
	codeHash := hashOTPCode(code)

	token := &domain.VerificationToken{
		UserID:    userID,
		Channel:   channel,
		CodeHash:  codeHash,
		Attempts:  0,
		ExpiresAt: time.Now().Add(otpTTL),
		Used:      false,
	}

	if err := s.tokenRepo.Create(ctx, token); err != nil {
		return err
	}

	// Enviar código por el canal correspondiente
	// SECURITY: pasamos el código al sender pero no lo logueamos nosotros
	var sendErr error
	switch channel {
	case "email":
		sendErr = s.mailer.SendOTP(ctx, user.Email, code)
	case "sms":
		sendErr = s.smsSender.SendOTP(ctx, user.Phone, code)
	}

	if sendErr != nil {
		// Falló el proveedor externo → envolver para que el handler retorne 502
		return &ErrExternalService{Cause: sendErr}
	}

	return nil
}

// ConfirmOTP verifica el código OTP del usuario.
// SECURITY: nunca loguea el código recibido.
func (s *verificationService) ConfirmOTP(ctx context.Context, userID uuid.UUID, channel, code string) error {
	// Buscar token activo
	token, err := s.tokenRepo.FindActiveByUser(ctx, userID, channel)
	if err != nil {
		return err
	}
	if token == nil {
		return domain.ErrOTPExpired
	}

	// Verificar expiración (doble check — FindActiveByUser ya filtra por expires_at)
	if time.Now().After(token.ExpiresAt) {
		return domain.ErrOTPExpired
	}

	// Incrementar intentos de forma atómica
	newAttempts, err := s.tokenRepo.IncrementAttempts(ctx, token.ID)
	if err != nil {
		return err
	}

	// Si supera el máximo de intentos → invalidar token
	if newAttempts > otpMaxAttempts {
		_ = s.tokenRepo.MarkUsed(ctx, token.ID)
		return domain.ErrOTPInvalid
	}

	// Comparar hash del código recibido con el almacenado
	// SECURITY: comparamos hashes — nunca almacenamos ni logueamos el plaintext
	inputHash := hashOTPCode(code)
	if inputHash != token.CodeHash {
		return domain.ErrOTPInvalid
	}

	// Éxito → marcar token como usado
	if err := s.tokenRepo.MarkUsed(ctx, token.ID); err != nil {
		return err
	}

	// Actualizar el campo correspondiente en el usuario
	user, err := s.userRepo.GetByID(ctx, userID)
	if err != nil {
		return err
	}

	switch channel {
	case "email":
		user.EmailVerified = true
	case "sms":
		user.PhoneVerified = true
	}

	if err := s.userRepo.Update(ctx, user); err != nil {
		return err
	}

	// Otorgar badge "verified_finder" por completar la verificación de identidad.
	// REGLA: el error del badge NO debe fallar el flujo OTP — solo se loguea.
	if s.gamSvc != nil {
		if err := s.gamSvc.AwardBadgeIfEligible(ctx, userID, "verified_finder"); err != nil {
			log.Printf("[VerificationService] gamification: award verified_finder para %s: %v", userID, err)
		}
	}

	return nil
}

// generateOTPCode genera un código numérico de 6 dígitos usando crypto/rand.
// SECURITY: NUNCA loguear el valor retornado.
func generateOTPCode() (string, error) {
	b := make([]byte, 4)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	// Convertir a número de 6 dígitos (0-999999)
	n := int(b[0])<<24|int(b[1])<<16|int(b[2])<<8|int(b[3])
	if n < 0 {
		n = -n
	}
	code := fmt.Sprintf("%06d", n%1000000)
	return code, nil
}

// hashOTPCode calcula el SHA-256 hexadecimal del código.
// SECURITY: siempre almacenar/comparar el hash, nunca el plaintext.
func hashOTPCode(code string) string {
	h := sha256.Sum256([]byte(code))
	return fmt.Sprintf("%x", h)
}
