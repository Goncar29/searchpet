//go:build e2e

package e2e_test

import (
	"encoding/json"
	"io"
	"net/http"
	"testing"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"lost-pets/config"
	"lost-pets/internal/domain"
)

// El rate limit de ruta de /verification/send-email es 5 por MINUTO y su clave es
// `ruta + ClientIP` (router.go), así que desde una sola IP tapa al cupo diario:
// el sexto pedido seguido nunca llega al servicio. No es un conflicto — son ejes
// distintos, uno acota un ORIGEN y el otro una CUENTA, y es exactamente por eso
// que el cupo existe: el limiter no puede distinguir cuentas y por lo tanto no
// puede protegerlas.
//
// Consecuencia para estos tests: hay que gastar el cupo sin gastar el limiter.
// Las filas que ya están en la tabla se siembran directo, y sólo el pedido que
// tiene que ser rechazado viaja por HTTP.
const sendEmailRouteLimitPerMinute = 5

// TestVerificationQuota_TopePorCuenta prueba el cupo diario contra Postgres real.
//
// Regla #34: los mocks no tienen columnas ni constraints. Regla #40: esta tabla
// tiene un reaper horario. Un tope diario es una afirmación sobre lo que la BASE
// hace durante una ventana — verificarlo sólo contra un mock no verifica nada, y
// esa es exactamente la forma en que el cupo de recuperación llegó a producción
// valiendo 3 por HORA mientras el spec, el plan y los tests decían 3 por día.
func TestVerificationQuota_TopePorCuenta(t *testing.T) {
	// El mailer real no debe existir: sin BREVO_API_KEY / MAIL_FROM_EMAIL el
	// adapter cae en noop. No es higiene, es determinismo — con credenciales
	// reales en el entorno el envío sale a la red, falla, y el fallo BORRA el
	// token (corrección de este mismo cambio), con lo cual el cupo nunca se
	// consumiría y el test fallaría culpando al tope.
	t.Setenv("BREVO_API_KEY", "")
	t.Setenv("MAIL_FROM_EMAIL", "")

	baseURL, db, cleanup := startTestServerWithConfig(t, func(c *config.Config) {
		c.EnableEmailVerification = true
	})
	defer cleanup()

	token, email := registerAndLogin(t, baseURL)
	userID := userIDByEmail(t, db, email)

	// Cuatro pedidos reales: prueban que el camino feliz ESCRIBE filas que después
	// cuentan. Entre uno y otro se retrocede el created_at para saltear el cooldown
	// de 60s, sin sacar la fila de la ventana de conteo.
	const realSends = 4
	for i := 0; i < realSends; i++ {
		status, body := postAuthed(t, baseURL+"/api/verification/send-email", token)
		if status != http.StatusAccepted {
			t.Fatalf("pedido %d: status %d, want 202 (body %s)", i+1, status, body)
		}
		backdateNewestToken(t, db, "email", time.Now().Add(-2*time.Minute))
	}

	if got := countTokens(t, db, userID, "email"); got != realSends {
		t.Fatalf("tras %d envíos hay %d filas — el camino feliz no está dejando historia que contar",
			realSends, got)
	}

	// La quinta la sembramos: gastar el cupo por HTTP gastaría también el limiter
	// de ruta y el rechazo llegaría con el código equivocado.
	seedEmailToken(t, db, userID, time.Now().Add(-3*time.Minute))

	// Este es el pedido número 5 de la ventana del limiter, así que pasa por él y
	// llega al servicio, que ya ve las cinco filas.
	status, body := postAuthed(t, baseURL+"/api/verification/send-email", token)
	if status != http.StatusTooManyRequests {
		t.Fatalf("con el cupo agotado: status %d, want 429 (body %s)", status, body)
	}
	var errBody struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	}
	if err := json.Unmarshal(body, &errBody); err != nil {
		t.Fatalf("body no es JSON: %v (%s)", err, body)
	}
	if errBody.Code != "otp_daily_limit" {
		t.Fatalf("code = %q, want otp_daily_limit — si dice rate_limit_exceeded, el que respondió fue el limiter de ruta y este test no probó el cupo (body %s)",
			errBody.Code, body)
	}
	if errBody.Message == "" {
		t.Fatal("message vacío")
	}
}

// TestVerificationQuota_ElTopeEsPorCuentaNoGlobal: si el tope por cuenta se
// comportara como global, una sola víctima dejaría sin verificación a toda la
// plataforma. Servidor propio para arrancar con el limiter de ruta en cero.
func TestVerificationQuota_ElTopeEsPorCuentaNoGlobal(t *testing.T) {
	t.Setenv("BREVO_API_KEY", "")
	t.Setenv("MAIL_FROM_EMAIL", "")

	baseURL, db, cleanup := startTestServerWithConfig(t, func(c *config.Config) {
		c.EnableEmailVerification = true
	})
	defer cleanup()

	exhaustedToken, exhaustedEmail := registerAndLogin(t, baseURL)
	exhaustedID := userIDByEmail(t, db, exhaustedEmail)
	for i := 0; i < 5; i++ {
		seedEmailToken(t, db, exhaustedID, time.Now().Add(-time.Duration(i+1)*time.Minute))
	}

	status, body := postAuthed(t, baseURL+"/api/verification/send-email", exhaustedToken)
	if status != http.StatusTooManyRequests {
		t.Fatalf("cuenta agotada: status %d, want 429 (body %s)", status, body)
	}

	freshToken, _ := registerAndLogin(t, baseURL)
	freshStatus, freshBody := postAuthed(t, baseURL+"/api/verification/send-email", freshToken)
	if freshStatus != http.StatusAccepted {
		t.Fatalf("otra cuenta: status %d, want 202 — el tope por cuenta se filtró a global (body %s)",
			freshStatus, freshBody)
	}
}

// postAuthed hace un POST sin cuerpo con el JWT y devuelve status y body.
func postAuthed(t *testing.T, url, token string) (int, []byte) {
	t.Helper()

	req, err := http.NewRequest(http.MethodPost, url, nil)
	if err != nil {
		t.Fatalf("failed to build request: %v", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("POST %s failed: %v", url, err)
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("failed to read response from %s: %v", url, err)
	}
	return resp.StatusCode, raw
}

// userIDByEmail resuelve el id del usuario recién registrado.
func userIDByEmail(t *testing.T, db *gorm.DB, email string) uuid.UUID {
	t.Helper()

	var user domain.User
	if err := db.Where("LOWER(email) = LOWER(?)", email).First(&user).Error; err != nil {
		t.Fatalf("buscar usuario %s: %v", email, err)
	}
	return user.ID
}

// seedEmailToken inserta una fila del canal email con el created_at pedido, para
// gastar cupo sin gastar el rate limit de ruta.
func seedEmailToken(t *testing.T, db *gorm.DB, userID uuid.UUID, createdAt time.Time) {
	t.Helper()

	tok := &domain.VerificationToken{
		UserID:    userID,
		Channel:   "email",
		CodeHash:  "seeded",
		ExpiresAt: createdAt.Add(10 * time.Minute),
	}
	if err := db.Create(tok).Error; err != nil {
		t.Fatalf("sembrar token: %v", err)
	}
	if err := db.Model(&domain.VerificationToken{}).
		Where("id = ?", tok.ID).UpdateColumn("created_at", createdAt).Error; err != nil {
		t.Fatalf("backdate del token sembrado: %v", err)
	}
}

// backdateNewestToken retrocede el created_at del token más nuevo del canal para
// saltear el cooldown de 60s sin dormir. NO lo saca de la ventana de conteo: si
// lo hiciera, el test dejaría de medir el cupo.
func backdateNewestToken(t *testing.T, db *gorm.DB, channel string, to time.Time) {
	t.Helper()

	var tok domain.VerificationToken
	if err := db.Where("channel = ?", channel).
		Order("created_at DESC").First(&tok).Error; err != nil {
		t.Fatalf("buscar token del canal %s: %v", channel, err)
	}
	if err := db.Model(&domain.VerificationToken{}).
		Where("id = ?", tok.ID).UpdateColumn("created_at", to).Error; err != nil {
		t.Fatalf("backdate: %v", err)
	}
}

// countTokens cuenta las filas del canal para el usuario, sin filtrar por `used`
// — igual que CountSince, que es lo que este test está midiendo.
func countTokens(t *testing.T, db *gorm.DB, userID uuid.UUID, channel string) int64 {
	t.Helper()

	var n int64
	if err := db.Model(&domain.VerificationToken{}).
		Where("user_id = ? AND channel = ?", userID, channel).Count(&n).Error; err != nil {
		t.Fatalf("contar tokens: %v", err)
	}
	return n
}
