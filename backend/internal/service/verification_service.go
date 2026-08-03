package service

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"fmt"
	"log"
	"time"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/dto"
	"lost-pets/internal/event"
	"lost-pets/internal/repository"
	"lost-pets/pkg/mailer"
)

const (
	otpTTL         = 10 * time.Minute
	otpRateLimit   = 60 * time.Second
	otpMaxAttempts = 5

	// ChannelEmail es el canal de verificación de email dentro de la tabla
	// compartida verification_tokens.
	ChannelEmail = "email"

	// emailVerificationDailyMax es el tope de códigos por CUENTA en QuotaWindow.
	//
	// Cinco y no los tres de la recuperación porque esto es onboarding: el usuario
	// está esperando del otro lado y la fricción acá cuesta un alta.
	emailVerificationDailyMax = 5

	// emailVerificationGlobalDailyMax es la reserva del CANAL en QuotaWindow.
	//
	// 250 + los 50 de password_reset = los 300 diarios del plan de Brevo. Los dos
	// presupuestos son DISJUNTOS: ningún canal puede matar de hambre al otro, y
	// juntos no pueden exceder lo que el proveedor acepta. Hasta acá, la
	// justificación del cupo de reset —"deja 250 para la verificación"— no la
	// hacía cumplir absolutamente nadie.
	//
	// El tope no crea una caída: hace visible una inevitable. Hoy, a los 300,
	// Brevo simplemente empieza a rechazar y el fallo es casi mudo.
	emailVerificationGlobalDailyMax = 250
)

type verificationService struct {
	tokenRepo repository.VerificationTokenRepository
	userRepo  repository.UserRepository
	mailer    mailer.Mailer
	bus       *event.EventBus
}

// NewVerificationService construye el VerificationService con sus dependencias.
// bus puede ser nil si el EventBus no está disponible (defensivo).
func NewVerificationService(
	tokenRepo repository.VerificationTokenRepository,
	userRepo repository.UserRepository,
	m mailer.Mailer,
	bus *event.EventBus,
) VerificationService {
	return &verificationService{
		tokenRepo: tokenRepo,
		userRepo:  userRepo,
		mailer:    m,
		bus:       bus,
	}
}

// SendOTP genera y envía un OTP al usuario por el canal dado.
// SECURITY: el código en texto plano NUNCA es logueado.
func (s *verificationService) SendOTP(ctx context.Context, userID uuid.UUID, channel string) error {
	// Validar canal
	if channel != ChannelEmail {
		return domain.ErrInvalidInput
	}

	// Cargar usuario para obtener email
	user, err := s.userRepo.GetByID(ctx, userID)
	if err != nil {
		return err
	}

	// Una cuenta ya verificada no tiene nada que verificar, y hasta que existió la
	// reserva del canal eso era sólo desperdicio. Ahora no: 50 cuentas verificadas
	// pidiendo sus 5 códigos agotan los 250 del canal y dejan sin verificar a todo
	// usuario nuevo por 24h, gastando el presupuesto en mails que no verifican
	// nada. La versión cotidiana es más aburrida y más frecuente — una pestaña
	// vieja que quedó mostrando "enviar código" después de verificar en otra.
	if user.EmailVerified {
		return domain.ErrEmailAlreadyVerified
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

	// El cooldown de arriba acota la FRECUENCIA (uno por minuto); esto acota el
	// VOLUMEN. Sin tope, esperar el minuto igual permite 1440 mails por día.
	//
	// A diferencia de /forgot, este endpoint está detrás de `protected`: no hay
	// secreto de existencia de cuenta que defender, así que responde la verdad en
	// vez de tragarse el fallo.
	since := time.Now().Add(-QuotaWindow)

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

	// Contar y acuñar van JUNTOS detrás del lock del canal. Sueltos, dos requests
	// simultáneos leen el mismo 249 y los dos acuñan: como 250 + los 50 de
	// password_reset son exactamente los 300 de Brevo, el excedente no tiene
	// colchón y sale como rechazo opaco del proveedor. El cooldown de 60s
	// serializa a un mismo usuario, nunca a dos distintos, así que no cubre la
	// reserva global. El envío del mail queda FUERA a propósito.
	minted := false
	if err := s.tokenRepo.WithChannelLock(ctx, channel, func(ctx context.Context) error {
		userCount, err := s.tokenRepo.CountSince(ctx, &userID, channel, since)
		if err != nil {
			// Falla CERRADO: sin número no hay tope, y abrir la puerta ante un error del
			// conteo convierte cualquier hipo de la base en vía libre.
			log.Printf("[verification] per-account quota count failed for user %s: %v", userID, err)
			return err
		}
		if userCount >= emailVerificationDailyMax {
			log.Printf("[verification] daily cap reached for user %s (%d/%d)", userID, userCount, emailVerificationDailyMax)
			return &ErrOTPDailyLimit{
				RetryAfter: s.secondsUntilWindowFrees(ctx, &userID, channel, since, userCount, emailVerificationDailyMax),
			}
		}

		globalCount, err := s.tokenRepo.CountSince(ctx, nil, channel, since)
		if err != nil {
			log.Printf("[verification] global quota count failed: %v", err)
			return err
		}
		if globalCount >= emailVerificationGlobalDailyMax {
			// INCIDENTE, no rutina: a partir de acá ningún usuario nuevo puede verificar
			// su email hasta que corra la ventana. Tiene que ser greppable — esta
			// familia de features ya nos mordió dos veces por fallar en silencio.
			log.Printf("[verification] ALERT: global daily reserve exhausted (%d/%d) — email verification is disabled until the window rolls",
				globalCount, emailVerificationGlobalDailyMax)
			return domain.ErrOTPChannelUnavailable
		}

		if err := s.tokenRepo.Create(ctx, token); err != nil {
			return err
		}
		minted = true
		return nil
	}); err != nil {
		// El Create commitea por su cuenta —fn escribe FUERA de la transacción
		// que sostiene el lock—, así que un fallo al cerrar esa transacción
		// devuelve error con la fila ya viva y sin que nadie mande el mail. Sin
		// esto el usuario pierde uno de sus cinco códigos diarios por un código
		// que nunca existió: el mismo agujero que 8155d1c cerró en el fallo de
		// envío, entrando por el otro lado.
		if minted {
			if delErr := s.tokenRepo.DeleteByID(ctx, token.ID); delErr != nil {
				log.Printf("[verification] failed to delete token after lock tx error: %v", delErr)
			}
		}
		return err
	}

	// Enviar código por el canal correspondiente
	// SECURITY: pasamos el código al sender pero no lo logueamos nosotros
	var sendErr error
	switch channel {
	case ChannelEmail:
		sendErr = s.mailer.SendOTP(ctx, user.Email, code)
	default:
		// Un canal que pasa el guard de arriba pero no tiene sender acá NO puede
		// terminar en éxito: la fila ya está acuñada y gastando cupo, así que un
		// switch sin default devolvería 202 por un mail que nunca salió. Con el
		// error entra al camino de fallo de abajo, que BORRA el token.
		sendErr = fmt.Errorf("verification: no hay sender para el canal %q", channel)
	}

	if sendErr != nil {
		// SECURITY: sendErr solo contiene el status del proveedor, nunca el código OTP.
		log.Printf("[verification] %s send failed for user %s: %v", channel, userID, sendErr)

		// BORRAR, no marcar usado. Marcarlo libera el cooldown de 60s —que era la
		// intención original— pero CountSince ignora `used`, así que la fila seguiría
		// gastando cupo diario por un código que nunca salió: tres 401 de Brevo
		// dejarían al usuario sin poder verificar durante 24h sin haber recibido
		// nada. Mismo defecto que ya se cerró en la recuperación (8155d1c).
		if delErr := s.tokenRepo.DeleteByID(ctx, token.ID); delErr != nil {
			log.Printf("[verification] failed to delete token after send failure: %v", delErr)
		}

		// Falló el proveedor externo → envolver para que el handler retorne 502
		return &ErrExternalService{Cause: sendErr}
	}

	return nil
}

// ConfirmOTP verifica el código OTP del usuario.
// SECURITY: nunca loguea el código recibido.
func (s *verificationService) ConfirmOTP(ctx context.Context, userID uuid.UUID, channel, code string) error {
	// Validar canal ANTES de tocar estado, igual que SendOTP.
	//
	// Hoy un canal desconocido ya fallaba solo: FindActiveByUser no encuentra nada
	// y se sale por ErrOTPExpired. Pero eso depende de que no exista otro canal
	// válido — el día que exista, el token se encontraría, MarkUsed lo quemaría, y
	// el switch de abajo no marcaría nada verificado. El usuario perdería el código
	// sin verificar nada y sin ningún error.
	if channel != ChannelEmail {
		return domain.ErrInvalidInput
	}

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
	case ChannelEmail:
		user.EmailVerified = true
	}

	// Derivar is_verified y verification_method a partir del estado actualizado.
	// PhoneVerified ya no lo puede poner nadie —la verificación por SMS se quitó el
	// 2026-07-31— pero se sigue leyendo: hay usuarios que la completaron antes y
	// borrarlos del invariante los desverificaría en silencio.
	user.IsVerified = user.EmailVerified || user.PhoneVerified
	switch {
	case user.EmailVerified && user.PhoneVerified:
		user.VerificationMethod = "both"
	case user.EmailVerified:
		user.VerificationMethod = "email"
	case user.PhoneVerified:
		user.VerificationMethod = "phone"
	}

	if err := s.userRepo.Update(ctx, user); err != nil {
		return err
	}

	// Publicar evento para que GamificationService (y futuros subscribers) reaccionen.
	if s.bus != nil {
		s.bus.Publish("user.verified", event.UserVerifiedEvent{UserID: userID})
	}

	return nil
}

// GetStatus retorna el estado de verificación del usuario autenticado.
func (s *verificationService) GetStatus(ctx context.Context, userID uuid.UUID) (*dto.VerificationStatusResponse, error) {
	user, err := s.userRepo.GetByID(ctx, userID)
	if err != nil {
		return nil, err
	}
	return &dto.VerificationStatusResponse{
		EmailVerified: user.EmailVerified,
		PhoneVerified: user.PhoneVerified,
		IsVerified:    user.IsVerified,
	}, nil
}

// secondsUntilWindowFrees calcula cuánto falta para que salga de la ventana el
// código cuya salida devuelve el cupo, que es cuando se puede volver a pedir.
//
// No es el más viejo salvo que el contador esté justo en el tope. Con count por
// encima del máximo —alcanzable bajando la constante, o por un alta concurrente—
// esperar al más viejo deja el contador todavía arriba y manda al cliente a
// comerse otro 429; el que libera es el (count-max+1)-ésimo.
//
// Ante cualquier problema devuelve la ventana entera: es un Retry-After
// conservador, nunca uno optimista que invite a reintentar antes de tiempo.
func (s *verificationService) secondsUntilWindowFrees(ctx context.Context, userID *uuid.UUID, channel string, since time.Time, count, max int64) int {
	skip := int(count - max)
	if skip < 0 {
		skip = 0
	}

	freesAt, err := s.tokenRepo.NthOldestCreatedAtSince(ctx, userID, channel, since, skip)
	if err != nil || freesAt == nil {
		return int(QuotaWindow.Seconds())
	}
	remaining := time.Until(freesAt.Add(QuotaWindow))
	if remaining <= 0 {
		return 1
	}
	return int(remaining.Seconds()) + 1
}

// generateOTPCode genera un código numérico de 6 dígitos usando crypto/rand.
// SECURITY: NUNCA loguear el valor retornado.
func generateOTPCode() (string, error) {
	b := make([]byte, 4)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	// Convertir a número de 6 dígitos (0-999999)
	n := int(b[0])<<24 | int(b[1])<<16 | int(b[2])<<8 | int(b[3])
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
