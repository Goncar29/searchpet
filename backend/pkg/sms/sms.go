package sms

import (
	"context"
	"encoding/base64"
	"fmt"
	"net/http"
	"net/url"
	"strings"
)

// SMSSender define el contrato para envío de OTP por SMS.
// SECURITY: el parámetro code NUNCA debe ser logueado.
type SMSSender interface {
	SendOTP(ctx context.Context, to, code string) error
}

// twilioSender envía SMS a través de la API REST de Twilio (sin SDK).
type twilioSender struct {
	accountSID string
	authToken  string
	from       string
}

// NewTwilioSender construye el sender de Twilio.
// Si las credenciales están vacías, retorna un NoopSMSSender (degradación graceful).
func NewTwilioSender(accountSID, authToken, from string) SMSSender {
	if accountSID == "" || authToken == "" || from == "" {
		return &noopSMSSender{}
	}
	return &twilioSender{
		accountSID: accountSID,
		authToken:  authToken,
		from:       from,
	}
}

// SendOTP envía un OTP por SMS al destinatario.
// SECURITY: el código se incluye en el cuerpo del mensaje pero NUNCA en los logs.
func (s *twilioSender) SendOTP(ctx context.Context, to, code string) error {
	apiURL := fmt.Sprintf("https://api.twilio.com/2010-04-01/Accounts/%s/Messages.json", s.accountSID)

	body := url.Values{
		"To":   {to},
		"From": {s.from},
		"Body": {fmt.Sprintf("Tu código SearchPet: %s. Válido 10 min. No lo compartas.", code)},
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, apiURL, strings.NewReader(body.Encode()))
	if err != nil {
		return fmt.Errorf("sms: request error: %w", err)
	}

	creds := base64.StdEncoding.EncodeToString([]byte(s.accountSID + ":" + s.authToken))
	req.Header.Set("Authorization", "Basic "+creds)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		// External failure → 502 upstream
		return fmt.Errorf("sms: upstream error: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return fmt.Errorf("sms: twilio returned status %d", resp.StatusCode)
	}

	return nil
}

// noopSMSSender es una implementación vacía que no hace nada (Twilio no configurado).
type noopSMSSender struct{}

func (n *noopSMSSender) SendOTP(_ context.Context, _, _ string) error {
	return nil
}
