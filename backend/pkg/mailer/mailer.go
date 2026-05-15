package mailer

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
)

// Mailer define el contrato para envío de emails con OTP.
// SECURITY: el parámetro code NUNCA debe ser logueado.
type Mailer interface {
	SendOTP(ctx context.Context, to, code string) error
}

// sendGridMailer envía emails a través de la API HTTP v3 de SendGrid (sin SDK).
type sendGridMailer struct {
	apiKey    string
	fromEmail string
	fromName  string
}

// NewSendGridMailer construye el mailer de SendGrid.
// Si apiKey está vacío, retorna un NoopMailer (degradación graceful).
func NewSendGridMailer(apiKey string) Mailer {
	if apiKey == "" {
		return &noopMailer{}
	}
	return &sendGridMailer{
		apiKey:    apiKey,
		fromEmail: "noreply@searchpet.app",
		fromName:  "SearchPet",
	}
}

// SendOTP envía un OTP por email al destinatario.
// SECURITY: el código se incluye en el cuerpo del email pero NUNCA en los logs.
func (m *sendGridMailer) SendOTP(ctx context.Context, to, code string) error {
	payload := map[string]interface{}{
		"personalizations": []map[string]interface{}{
			{
				"to": []map[string]string{
					{"email": to},
				},
				"dynamic_template_data": map[string]string{
					"otp_code": code,
				},
			},
		},
		"from": map[string]string{
			"email": m.fromEmail,
			"name":  m.fromName,
		},
		"subject": "Tu código de verificación — SearchPet",
		"content": []map[string]string{
			{
				"type":  "text/plain",
				"value": fmt.Sprintf("Tu código de verificación es: %s\n\nExpira en 10 minutos. No lo compartas con nadie.", code),
			},
		},
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("mailer: marshal error: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.sendgrid.com/v3/mail/send", bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("mailer: request error: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+m.apiKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		// External failure → 502 upstream
		return fmt.Errorf("mailer: upstream error: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return fmt.Errorf("mailer: sendgrid returned status %d", resp.StatusCode)
	}

	return nil
}

// noopMailer es una implementación vacía que no hace nada (SendGrid no configurado).
type noopMailer struct{}

func (n *noopMailer) SendOTP(_ context.Context, _, _ string) error {
	return nil
}
