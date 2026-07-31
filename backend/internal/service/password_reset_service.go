package service

import (
	"context"
	"crypto/subtle"
	"errors"
	"log"
	"time"

	"github.com/google/uuid"
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
	// disconnectUser closes the user's live WebSocket connections. OPTIONAL (may
	// be nil, and is nil in tests that do not care). A function rather than the
	// Hub itself so this layer keeps knowing nothing about internal/websocket —
	// same seam as middleware.Auth's PasswordChangedAtFunc.
	//
	// Stamping password_changed_at is NOT enough on its own: sockets authenticate
	// with a ticket once, at upgrade time, and are never re-checked afterwards.
	disconnectUser func(userID uuid.UUID)
	// sleep exists so the timing pad below is injectable: tests would otherwise
	// spend minRequestResetDuration on every RequestReset case.
	sleep func(time.Duration)
}

// minRequestResetDuration es el piso al que se acolcha TODA respuesta de
// RequestReset, exista o no la cuenta.
//
// runAsync sacó el round trip de mail de la respuesta, pero el trabajo de base no
// desapareció: una dirección registrada cuesta GetByEmail + FindActiveByUser +
// Create + el barrido —cuatro viajes a Neon, dos de ellos escrituras— contra UNA
// sola lectura para una desconocida. Sobre un Postgres gestionado remoto esa
// diferencia son decenas de ms contra unos pocos: la misma señal medible que
// runAsync existía para tapar.
//
// Es una mitigación, no una prueba: si la base se pone lenta y el camino
// registrado supera este piso, la diferencia vuelve a asomar. El valor tiene que
// quedar cómodamente por encima del caso registrado típico.
const minRequestResetDuration = 300 * time.Millisecond

// passwordResetDailyMax es el tope de codigos de recuperacion por CUENTA en
// quotaWindow. Tres alcanza de sobra para el caso real —pedís, no te llega, mirás
// el spam, pedís de nuevo— y deja el ataque acotado a 3 mails por víctima en vez
// de 1440.
const passwordResetDailyMax = 3

// passwordResetGlobalDailyMax es la reserva del CANAL en quotaWindow. El cap por
// cuenta solo no protege la cuota compartida: un atacante con ~17 direcciones
// registradas la agotaría igual, y con ella se cae la verificación de email de
// TODA la plataforma, no solo la recuperación. Cincuenta deja 250 de los 300
// diarios de Brevo para la verificación, que es el consumidor primario porque
// corre en cada alta.
const passwordResetGlobalDailyMax = 50

// quotaWindow es la ventana móvil que usan los dos topes.
const quotaWindow = 24 * time.Hour

// padTo duerme lo que falte para que la llamada haya durado al menos
// minRequestResetDuration, contando desde start.
func (s *passwordResetService) padTo(start time.Time) {
	if s.sleep == nil {
		return
	}
	if elapsed := time.Since(start); elapsed < minRequestResetDuration {
		s.sleep(minRequestResetDuration - elapsed)
	}
}

// NewPasswordResetService construye el servicio con sus dependencias.
// disconnectUser may be nil: the flow still works, it just leaves live sockets up.
func NewPasswordResetService(
	tokenRepo repository.VerificationTokenRepository,
	userRepo repository.UserRepository,
	m mailer.Mailer,
	disconnectUser func(userID uuid.UUID),
) PasswordResetService {
	return &passwordResetService{
		tokenRepo:      tokenRepo,
		userRepo:       userRepo,
		mailer:         m,
		runAsync:       func(f func()) { go f() },
		disconnectUser: disconnectUser,
		sleep:          time.Sleep,
	}
}

// NewPasswordResetServiceForTest injects runAsync so tests observe the send
// synchronously. Not for production wiring.
// sleep may be nil, which disables the timing pad so the suite does not spend
// minRequestResetDuration per case. Pass a recorder to assert on the padding.
func NewPasswordResetServiceForTest(
	tokenRepo repository.VerificationTokenRepository,
	userRepo repository.UserRepository,
	m mailer.Mailer,
	runAsync func(func()),
	disconnectUser func(userID uuid.UUID),
	sleep func(time.Duration),
) PasswordResetService {
	return &passwordResetService{
		tokenRepo:      tokenRepo,
		userRepo:       userRepo,
		mailer:         m,
		runAsync:       runAsync,
		disconnectUser: disconnectUser,
		sleep:          sleep,
	}
}

func (s *passwordResetService) RequestReset(ctx context.Context, email string) error {
	// Every return below is padded to the same floor — see minRequestResetDuration
	// for why the work this endpoint does is itself an enumeration oracle. The
	// argument is evaluated now, at defer time, which is what makes this the start.
	defer s.padTo(time.Now())

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

	// Tope diario por cuenta. Se traga igual que el cooldown: este camino solo se
	// alcanza para una cuenta que existe, así que responder distinto la delataría.
	//
	// El cooldown de arriba acota la FRECUENCIA (uno por minuto); esto acota el
	// VOLUMEN. Sin este tope, un minuto de espera entre pedidos igual permite 1440
	// mails por día contra una sola dirección.
	since := time.Now().Add(-quotaWindow)
	userCount, err := s.tokenRepo.CountSince(ctx, &user.ID, ChannelPasswordReset, since)
	if err != nil {
		// Falla cerrado: sin número no hay tope, y abrir la puerta ante un error del
		// conteo convierte cualquier hipo de la base en vía libre.
		log.Printf("[password_reset] per-account quota count failed for user %s: %v", user.ID, err)
		return nil
	}
	if userCount >= passwordResetDailyMax {
		log.Printf("[password_reset] daily cap reached for user %s (%d/%d)", user.ID, userCount, passwordResetDailyMax)
		return nil
	}

	// Reserva global del canal. Protege la cuota diaria de Brevo que este flujo
	// COMPARTE con la verificación de email: sin esto, un ataque de resets deja sin
	// verificar el mail a todos los usuarios nuevos de la plataforma. El cap por
	// cuenta solo no alcanza — con ~17 direcciones registradas se agotan los 300.
	globalCount, err := s.tokenRepo.CountSince(ctx, nil, ChannelPasswordReset, since)
	if err != nil {
		log.Printf("[password_reset] global quota count failed: %v", err)
		return nil
	}
	if globalCount >= passwordResetGlobalDailyMax {
		// INCIDENTE, no rutina: es casi seguro un ataque, y a partir de acá la
		// recuperación de contraseña queda caída para TODOS hasta que corra la
		// ventana. Tiene que ser greppable — esta feature ya nos mordió dos veces
		// por fallar en silencio.
		log.Printf("[password_reset] ALERT: global daily reserve exhausted (%d/%d) — password recovery is disabled until the window rolls",
			globalCount, passwordResetGlobalDailyMax)
		return nil
	}

	// SECURITY: NUNCA loguear el código en texto plano.
	code, err := generateOTPCode()
	if err != nil {
		log.Printf("[password_reset] code generation failed for user %s: %v", user.ID, err)
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

	// Retirar los códigos viejos va DESPUÉS de acuñar el nuevo, y el orden es la
	// corrección: hacerlo antes deja al usuario con CERO códigos válidos si el
	// Create falla, mientras /forgot igual contesta "te enviamos un código". Peor
	// todavía, le daba a cualquiera que conozca la dirección una forma de negar la
	// recuperación indefinidamente — llamando /forgot cada 61s se mata el código
	// que la víctima está tipeando en ese momento, una y otra vez.
	//
	// Se retiran igual porque FindActiveByUser devuelve solo el más reciente: sin
	// esto, el código anterior deja de poder canjearse pero sigue pareciendo
	// válido, y quien tipea el del primer mail come otp_invalid sin explicación.
	//
	// Un fallo acá NO aborta el envío: degrada a que el código viejo siga vivo
	// hasta su TTL, que es el comportamiento previo a 789e27b — molesto, pero
	// estrictamente mejor que quedarse sin ninguno.
	if err := s.tokenRepo.MarkAllUsedByUserExcept(ctx, user.ID, ChannelPasswordReset, token.ID); err != nil {
		log.Printf("[password_reset] failed to retire previous tokens for user %s: %v", user.ID, err)
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

	// Canjear este OTP prueba control del buzón exactamente igual de fuerte que
	// VerificationService.ConfirmOTP, que sí marca el email como verificado.
	// Dejarlo en false acá NO es neutral: Register no exige ninguna prueba, así que
	// false es el caso común, y la defensa anti pre-hijacking de auth_service.go
	// blanquea el PasswordHash de toda cuenta no verificada que después vincule una
	// identidad de Google. El usuario recuperaría su contraseña y la perdería en
	// silencio en su siguiente login con Google — de vuelta al agujero solo-Google
	// que este flujo existe para cerrar.
	//
	// A propósito NO se publica el evento user.verified: ese badge premia pasar por
	// el flujo de verificación deliberadamente, y otorgarlo como efecto secundario
	// de recuperar la cuenta sería inesperado. Acá solo se mueve el flag que lee la
	// decisión de seguridad.
	user.EmailVerified = true
	// Invariante del codebase (verification_service.go:207): IsVerified es el OR de
	// los dos canales, y VerificationMethod nombra los que están confirmados.
	user.IsVerified = true
	if user.PhoneVerified {
		user.VerificationMethod = "both"
	} else {
		user.VerificationMethod = "email"
	}

	if err := s.userRepo.Update(ctx, user); err != nil {
		log.Printf("[password_reset] password write failed for user %s: %v", user.ID, err)
		return domain.ErrOTPInvalid
	}

	// DESPUÉS del write, y solo si salió bien: cortar sockets de una recuperación
	// que después falla dejaría al dueño legítimo desconectado sin haber cambiado
	// nada. password_changed_at invalida los JWT, pero un socket ya abierto
	// autenticó una sola vez con su ticket y nadie lo vuelve a chequear — sin
	// esto, quien tenga una conexión viva sigue recibiendo los mensajes de la
	// víctima indefinidamente, que es justo lo que el reset viene a cortar.
	if s.disconnectUser != nil {
		s.disconnectUser(user.ID)
	}
	return nil
}
