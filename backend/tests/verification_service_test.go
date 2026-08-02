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
)

// ============================================================
// Mock: UserRepository (minimal — only methods used by VerificationService)
// ============================================================

type mockUserRepo struct {
	user     *domain.User
	updateFn func(ctx context.Context, u *domain.User) error
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

func (m *mockUserRepo) GetByGoogleID(context.Context, string) (*domain.User, error) {
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
	activeToken            *domain.VerificationToken
	incrementAttempts      int
	markUsedCalled         bool
	markAllUsedCalls       int
	markAllUsedExceptCalls int
	deleteByIDCalls        int
	// countByUser / countGlobal alimentan los dos topes diarios. Cero por default,
	// que es "sin cupo consumido".
	countByUser   int64
	countGlobal   int64
	countErr      error
	oldestCreated *time.Time
}

func (m *mockTokenRepo) Create(ctx context.Context, t *domain.VerificationToken) error { return nil }

func (m *mockTokenRepo) FindActiveByUser(ctx context.Context, userID uuid.UUID, channel string) (*domain.VerificationToken, error) {
	return m.activeToken, nil
}

func (m *mockTokenRepo) MarkUsed(ctx context.Context, id uuid.UUID) error {
	m.markUsedCalled = true
	return nil
}

func (m *mockTokenRepo) MarkAllUsedByUser(ctx context.Context, userID uuid.UUID, channel string) error {
	m.markUsedCalled = true
	m.markAllUsedCalls++
	return nil
}

func (m *mockTokenRepo) MarkAllUsedByUserExcept(ctx context.Context, userID uuid.UUID, channel string, exceptID uuid.UUID) error {
	m.markAllUsedExceptCalls++
	return nil
}

func (m *mockTokenRepo) IncrementAttempts(ctx context.Context, id uuid.UUID) (int, error) {
	m.incrementAttempts++
	return m.incrementAttempts, nil
}

func (m *mockTokenRepo) DeleteByID(ctx context.Context, id uuid.UUID) error {
	m.deleteByIDCalls++
	return nil
}

func (m *mockTokenRepo) DeleteExpired(ctx context.Context) (int64, error) { return 0, nil }

func (m *mockTokenRepo) CountSince(_ context.Context, userID *uuid.UUID, _ string, _ time.Time) (int64, error) {
	if m.countErr != nil {
		return 0, m.countErr
	}
	if userID == nil {
		return m.countGlobal, nil
	}
	return m.countByUser, nil
}

func (m *mockTokenRepo) OldestCreatedAtSince(_ context.Context, _ *uuid.UUID, _ string, _ time.Time) (*time.Time, error) {
	return m.oldestCreated, nil
}

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
		name                   string
		channel                string
		initialEmailVerified   bool
		initialPhoneVerified   bool
		wantEmailVerified      bool
		wantPhoneVerified      bool
		wantIsVerified         bool
		wantVerificationMethod string
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
			// La verificacion por SMS se quito el 2026-07-31, pero PhoneVerified
			// sigue existiendo y el invariante lo sigue leyendo. Este caso prueba
			// que un usuario que verifico su telefono ANTES no se desverifica al
			// confirmar su email: sale con method=both, no con method=email.
			name:                   "telefono verificado de antes + email confirmado ahora = both",
			channel:                "email",
			initialEmailVerified:   false,
			initialPhoneVerified:   true,
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

			svc := service.NewVerificationService(tokenRepo, userRepo, nil, nil)

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

	svc := service.NewVerificationService(tokenRepo, userRepo, nil, nil)

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
// T07: Phone atomicity — new test cases
// ============================================================

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

// SendOTP with a failing mailer returns ErrExternalService, retires the pending
// token (so the 60s cooldown does not block an immediate retry after a provider
// failure), and logs the upstream cause for diagnosis.
//
// El mecanismo cambio al llegar el cupo diario: antes se marcaba usado, ahora se
// BORRA. La intencion es la misma, pero CountSince ignora `used`, asi que marcarlo
// dejaba la fila gastando cupo por un codigo que nunca salio — ver
// TestSendOTP_FalloDeEnvioNoQuemaCupo. Mismo defecto que ya se cerro en la
// recuperacion de contrasena (8155d1c).
func TestSendOTP_MailerFails_InvalidatesTokenAndLogsCause(t *testing.T) {
	ctx := context.Background()
	userID := uuid.New()

	userRepo := &mockUserRepo{user: &domain.User{ID: userID, Email: "test@example.com"}}
	tokenRepo := &mockTokenRepo{}

	svc := service.NewVerificationService(tokenRepo, userRepo, &failingMailer{}, nil)

	var logBuf bytes.Buffer
	log.SetOutput(&logBuf)
	defer log.SetOutput(os.Stderr)

	err := svc.SendOTP(ctx, userID, "email")

	var extErr *service.ErrExternalService
	if !errors.As(err, &extErr) {
		t.Fatalf("expected ErrExternalService, got %v", err)
	}
	if tokenRepo.deleteByIDCalls != 1 {
		t.Errorf("DeleteByID llamado %d veces, want 1 — el token fallido tiene que salir de la tabla para que ni el cooldown ni el cupo lo cuenten", tokenRepo.deleteByIDCalls)
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

func (f *failingMailer) SendPasswordReset(ctx context.Context, to, code string) error {
	return fmt.Errorf("mailer: brevo returned status 401")
}

var _ mailer.Mailer = (*failingMailer)(nil)

// noopMailer implements mailer.Mailer with no side-effects.
type noopMailer struct{}

func (n *noopMailer) SendOTP(ctx context.Context, to, code string) error { return nil }

func (n *noopMailer) SendPasswordReset(ctx context.Context, to, code string) error { return nil }

// Compile-time interface check.
var _ mailer.Mailer = (*noopMailer)(nil)

// ============================================================
// T-13: GetStatus returns correct DTO from user fields
// ============================================================

func TestGetStatus_ReturnsCorrectDTO(t *testing.T) {
	ctx := context.Background()

	tests := []struct {
		name    string
		user    *domain.User
		wantDTO dto.VerificationStatusResponse
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

			svc := service.NewVerificationService(tokenRepo, userRepo, nil, nil)

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

// ============================================================
// Cupo diario del canal email (parte B)
// ============================================================

// El cooldown de 60s acota la FRECUENCIA; esto acota el VOLUMEN. Sin tope,
// esperar el minuto igual permite 1440 mails por dia contra una sola cuenta.
func TestSendOTP_TopePorCuenta(t *testing.T) {
	ctx := context.Background()
	userID := uuid.New()
	oldest := time.Now().Add(-20 * time.Hour)

	tests := []struct {
		name        string
		countByUser int64
		wantBlocked bool
	}{
		{name: "quinto pedido pasa", countByUser: 4, wantBlocked: false},
		{name: "sexto pedido se bloquea", countByUser: 5, wantBlocked: true},
		{name: "muy por encima tambien se bloquea", countByUser: 40, wantBlocked: true},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			userRepo := &mockUserRepo{user: &domain.User{ID: userID, Email: "a@b.com"}}
			tokenRepo := &mockTokenRepo{countByUser: tc.countByUser, oldestCreated: &oldest}
			svc := service.NewVerificationService(tokenRepo, userRepo, &noopMailer{}, nil)

			err := svc.SendOTP(ctx, userID, "email")

			var limitErr *service.ErrOTPDailyLimit
			if tc.wantBlocked {
				if !errors.As(err, &limitErr) {
					t.Fatalf("con %d codigos en la ventana want ErrOTPDailyLimit, got %v", tc.countByUser, err)
				}
				// El 429 promete un numero real: cuanto falta para que el mas viejo
				// salga de la ventana. Cero seria invitar a reintentar ya mismo.
				if limitErr.RetryAfter <= 0 {
					t.Fatalf("RetryAfter = %d, want > 0", limitErr.RetryAfter)
				}
				return
			}
			if err != nil {
				t.Fatalf("con %d codigos want nil, got %v", tc.countByUser, err)
			}
		})
	}
}

// La reserva del canal protege la cuota de Brevo que este flujo COMPARTE con la
// recuperacion. El tope por cuenta solo no alcanza: el registro es abierto, asi
// que con suficientes cuentas se agota igual.
func TestSendOTP_ReservaDelCanal(t *testing.T) {
	ctx := context.Background()
	userID := uuid.New()
	userRepo := &mockUserRepo{user: &domain.User{ID: userID, Email: "a@b.com"}}
	// La cuenta esta MUY por debajo de su tope: lo que bloquea es el canal.
	tokenRepo := &mockTokenRepo{countByUser: 0, countGlobal: 250}
	svc := service.NewVerificationService(tokenRepo, userRepo, &noopMailer{}, nil)

	err := svc.SendOTP(ctx, userID, "email")

	if !errors.Is(err, domain.ErrOTPChannelUnavailable) {
		t.Fatalf("con la reserva agotada want ErrOTPChannelUnavailable, got %v", err)
	}
	// No es ErrOTPDailyLimit: este usuario no agoto nada, y decirle que si lo
	// mandaria a esperar 24h cuando el cupo se libera con el trafico de terceros.
	var limitErr *service.ErrOTPDailyLimit
	if errors.As(err, &limitErr) {
		t.Fatal("la reserva del canal no debe emitir ErrOTPDailyLimit")
	}
}

// Falla CERRADO: sin numero no hay tope, y dejar pasar ante un error del conteo
// convierte cualquier hipo de la base en via libre.
func TestSendOTP_ConteoFallidoFallaCerrado(t *testing.T) {
	ctx := context.Background()
	userID := uuid.New()

	userRepo := &mockUserRepo{user: &domain.User{ID: userID, Email: "a@b.com"}}
	tokenRepo := &mockTokenRepo{countErr: errors.New("boom")}
	svc := service.NewVerificationService(tokenRepo, userRepo, &noopMailer{}, nil)

	if err := svc.SendOTP(ctx, userID, "email"); err == nil {
		t.Fatal("un error del conteo tiene que abortar el envio, no dejarlo pasar")
	}
}

// Un envio fallido no entrego nada, asi que su fila no puede gastar cupo. Tres
// 401 de Brevo —la regla #24— dejarian al usuario sin poder verificar 24h sin
// haber recibido un solo mail.
func TestSendOTP_FalloDeEnvioNoQuemaCupo(t *testing.T) {
	ctx := context.Background()
	userID := uuid.New()
	userRepo := &mockUserRepo{user: &domain.User{ID: userID, Email: "a@b.com"}}
	tokenRepo := &mockTokenRepo{}
	svc := service.NewVerificationService(tokenRepo, userRepo, &failingMailer{}, nil)

	if err := svc.SendOTP(ctx, userID, "email"); err == nil {
		t.Fatal("want error del proveedor, got nil")
	}

	if tokenRepo.deleteByIDCalls != 1 {
		t.Fatalf("DeleteByID llamado %d veces, want 1 — la fila tiene que BORRARSE", tokenRepo.deleteByIDCalls)
	}
	if tokenRepo.markUsedCalled {
		t.Fatal("MarkUsed no sirve aca: CountSince ignora `used`, asi que la fila seguiria gastando cupo")
	}
}

// Una cuenta ya verificada no tiene nada que verificar. Antes de la reserva del
// canal esto era solo desperdicio; con ella es la denegacion mas barata que hay:
// 50 cuentas verificadas x 5 codigos = los 250 del canal, y ningun usuario nuevo
// puede verificar por 24h. El caso cotidiano es mas aburrido y mas frecuente:
// una pestana vieja que quedo mostrando "enviar codigo".
func TestSendOTP_CuentaYaVerificadaNoGastaCupo(t *testing.T) {
	ctx := context.Background()
	userID := uuid.New()
	userRepo := &mockUserRepo{user: &domain.User{
		ID:            userID,
		Email:         "a@b.com",
		EmailVerified: true,
	}}
	created := 0
	tokenRepo := &captureTokenRepo{
		mockTokenRepo: &mockTokenRepo{},
		onCreate:      func(*domain.VerificationToken) { created++ },
	}
	svc := service.NewVerificationService(tokenRepo, userRepo, &failingMailer{}, nil)

	err := svc.SendOTP(ctx, userID, "email")

	if !errors.Is(err, domain.ErrEmailAlreadyVerified) {
		t.Fatalf("want ErrEmailAlreadyVerified, got %v", err)
	}
	// Lo que importa no es el error sino que no se haya gastado nada: sin fila no
	// hay cupo consumido, y el mailer que falla prueba que tampoco se intento
	// enviar (si se hubiera intentado, el error seria el del proveedor).
	if created != 0 {
		t.Fatalf("se acunaron %d tokens: una cuenta verificada no puede gastar cupo", created)
	}
}
