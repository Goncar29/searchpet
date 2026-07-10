package mailer

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
)

// DefaultBrevoEndpoint is the Brevo transactional email API endpoint.
// We migrated off SendGrid because it retired its free-forever plan
// (60-day trial only since 2025). Brevo's free tier (300 emails/day)
// supports single-sender verification without owning a domain.
// Override via config.Config.BrevoEndpoint if Brevo migrates its API.
const DefaultBrevoEndpoint = "https://api.brevo.com/v3/smtp/email"

// Mailer define el contrato para envío de emails con OTP.
// SECURITY: el parámetro code NUNCA debe ser logueado.
type Mailer interface {
	SendOTP(ctx context.Context, to, code string) error
}

// brevoMailer envía emails a través de la API HTTP v3 de Brevo (sin SDK).
type brevoMailer struct {
	apiKey    string
	fromEmail string
	fromName  string
	endpoint  string
}

// NewBrevoMailer construye el mailer de Brevo.
// Si apiKey o fromEmail están vacíos, retorna un NoopMailer (degradación
// graceful): Brevo requiere un remitente verificado, así que sin FROM
// configurado no hay forma válida de enviar.
func NewBrevoMailer(apiKey, fromEmail string) Mailer {
	if apiKey == "" || fromEmail == "" {
		return &noopMailer{}
	}
	return &brevoMailer{
		apiKey:    apiKey,
		fromEmail: fromEmail,
		fromName:  "SearchPet",
		endpoint:  DefaultBrevoEndpoint,
	}
}

// SetEndpoint overrides the Brevo endpoint used by this mailer instance.
// Intended for production wiring only — call from router setup when
// config.Config.BrevoEndpoint is set (e.g. after a future Brevo API migration).
func (m *brevoMailer) SetEndpoint(endpoint string) {
	m.endpoint = endpoint
}

// SendOTP envía un OTP por email al destinatario.
// SECURITY: el código se incluye en el cuerpo del email pero NUNCA en los logs.
func (m *brevoMailer) SendOTP(ctx context.Context, to, code string) error {
	payload := map[string]interface{}{
		"sender": map[string]string{
			"email": m.fromEmail,
			"name":  m.fromName,
		},
		"to": []map[string]string{
			{"email": to},
		},
		"subject":     "Tu código de verificación — SearchPet",
		"textContent": fmt.Sprintf("Tu código de verificación es: %s\n\nExpira en 10 minutos. No lo compartas con nadie.", code),
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("mailer: marshal error: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, m.endpoint, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("mailer: request error: %w", err)
	}

	req.Header.Set("api-key", m.apiKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		// External failure → 502 upstream
		return fmt.Errorf("mailer: upstream error: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return fmt.Errorf("mailer: brevo returned status %d", resp.StatusCode)
	}

	return nil
}

// noopMailer es una implementación vacía que no hace nada (Brevo no configurado).
type noopMailer struct{}

func (n *noopMailer) SendOTP(_ context.Context, _, _ string) error {
	return nil
}
