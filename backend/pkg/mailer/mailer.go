package mailer

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"html"
	"io"
	"net/http"
	"strings"
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

	// SendPasswordReset envía el OTP de recuperación de contraseña.
	// SECURITY: el parámetro code NUNCA debe ser logueado.
	SendPasswordReset(ctx context.Context, to, code string) error
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

// Identidad de marca "Rastro" para los emails.
//
// brandPrimary es el mismo #C24E1A que --color-primary en la web y theme_color
// en el manifest, y **es exactamente el color de fondo de icon-192.png**: por eso
// el ícono se funde con la cabecera sin que se vea el recuadro.
//
// La URL va hardcodeada a producción a propósito, no derivada de APP_URL: el mail
// se abre fuera de la app, en el cliente de correo del destinatario, así que el
// asset tiene que resolver público sí o sí. Con APP_URL, un entorno local mandaría
// mails apuntando a localhost. Mismo criterio que web/api/share.js y index.html.
const (
	brandPrimary = "#C24E1A"
	brandLogoURL = "https://searchpet.vercel.app/icons/icon-192.png"
)

// brandHeader es la cabecera compartida por los dos templates. El alt del ícono
// va vacío adrede: el wordmark de al lado ya dice "SearchPet", así que con las
// imágenes bloqueadas (default de Gmail para remitentes desconocidos) se lee el
// nombre una sola vez en vez de dos.
//
// Los 56px no son el tamaño del logo, son el tamaño del MARCO: icon-192.png trae
// ~40% de fondo vacío alrededor de la pata, así que el glifo visible mide ~34px.
// A 32px la pata caía a ~18px, empatada con la altura de mayúscula del wordmark
// (~16px), y un glifo rodeado de aire siempre pierde contra texto en negrita a
// tamaño parejo: hay que pasarlo, no igualarlo. Si algún día se recorta el asset,
// este número tiene que bajar en la misma proporción.
//
// El padding-right de 6px se lee más chico de lo que es: el ícono aporta ~4px de
// fondo propio a su derecha. Va ajustado a propósito para que ícono y wordmark
// lean como un bloque — con el fondo del ícono fundido con el de la cabecera no
// hay borde que los agrupe, y separados se leen como dos elementos sueltos.
//
// El width/height van duplicados en atributo y en style a propósito: Outlook
// ignora el CSS inline y necesita el atributo, y los clientes que reescalan por
// densidad necesitan el style.
const brandHeader = `<td style="background-color:` + brandPrimary + `;padding:20px 32px;text-align:center;">
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
                <tr>
                  <td style="padding-right:6px;vertical-align:middle;">
                    <img src="` + brandLogoURL + `" width="56" height="56" alt="" style="display:block;border:0;width:56px;height:56px;">
                  </td>
                  <td style="vertical-align:middle;">
                    <span style="font-family:Helvetica,Arial,sans-serif;font-size:22px;font-weight:bold;color:#ffffff;">SearchPet</span>
                  </td>
                </tr>
              </table>
            </td>`

// otpHTMLTemplate es el cuerpo HTML del email de verificación. Email-safe:
// tablas + estilos inline (Gmail/Outlook no soportan CSS moderno). El único
// placeholder (%s) es el código OTP.
const otpHTMLTemplate = `<!DOCTYPE html>
<html lang="es">
<body style="margin:0;padding:0;background-color:#f4f5f7;">
  <table role="presentation" width="100%%" cellpadding="0" cellspacing="0" style="background-color:#f4f5f7;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%%" cellpadding="0" cellspacing="0" style="max-width:440px;background-color:#ffffff;border-radius:12px;overflow:hidden;">
          <tr>
            ` + brandHeader + `
          </tr>
          <tr>
            <td style="padding:32px;">
              <p style="margin:0 0 8px;font-family:Helvetica,Arial,sans-serif;font-size:18px;font-weight:bold;color:#1f2937;text-align:center;">
                Tu c&oacute;digo de verificaci&oacute;n
              </p>
              <p style="margin:0 0 24px;font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#6b7280;text-align:center;">
                Ingresalo en la app para verificar tu cuenta.
              </p>
              <table role="presentation" width="100%%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="background-color:#FFF1EB;border-radius:8px;padding:20px;">
                    <span style="font-family:Courier,monospace;font-size:34px;font-weight:bold;letter-spacing:8px;color:#E5551F;">%s</span>
                  </td>
                </tr>
              </table>
              <p style="margin:24px 0 0;font-family:Helvetica,Arial,sans-serif;font-size:13px;color:#6b7280;text-align:center;">
                Expira en 10 minutos. No lo compartas con nadie.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 32px 24px;border-top:1px solid #f0f0f0;">
              <p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:12px;color:#9ca3af;text-align:center;">
                Recibiste este email porque se pidi&oacute; verificar esta direcci&oacute;n en SearchPet.<br>
                Si no fuiste vos, pod&eacute;s ignorarlo.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`

// resetHTMLTemplate mirrors otpHTMLTemplate's email-safe structure (tables plus
// inline styles) and SearchPet's palette. It deliberately contains NO links:
// training users that our reset mail never asks for a click is the cheapest
// anti-phishing defence available. The only placeholder (%s) is the OTP code.
const resetHTMLTemplate = `<!DOCTYPE html>
<html lang="es">
<body style="margin:0;padding:0;background-color:#f4f5f7;">
  <table role="presentation" width="100%%" cellpadding="0" cellspacing="0" style="background-color:#f4f5f7;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%%" cellpadding="0" cellspacing="0" style="max-width:440px;background-color:#ffffff;border-radius:12px;overflow:hidden;">
          <tr>
            ` + brandHeader + `
          </tr>
          <tr>
            <td style="padding:32px;">
              <p style="margin:0 0 8px;font-family:Helvetica,Arial,sans-serif;font-size:18px;font-weight:bold;color:#1f2937;text-align:center;">
                Restablec&eacute; tu contrase&ntilde;a
              </p>
              <p style="margin:0 0 24px;font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#6b7280;text-align:center;">
                Ingres&aacute; este c&oacute;digo en SearchPet para elegir una nueva.
              </p>
              <table role="presentation" width="100%%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="background-color:#FFF1EB;border-radius:8px;padding:20px;">
                    <span style="font-family:Courier,monospace;font-size:34px;font-weight:bold;letter-spacing:8px;color:#E5551F;">%s</span>
                  </td>
                </tr>
              </table>
              <p style="margin:24px 0 0;font-family:Helvetica,Arial,sans-serif;font-size:13px;color:#6b7280;text-align:center;">
                Expira en 10 minutos. No lo compartas con nadie.
              </p>
              <p style="margin:16px 0 0;font-family:Helvetica,Arial,sans-serif;font-size:13px;color:#6b7280;text-align:center;">
                Al cambiarla vas a tener que volver a entrar en tus otros dispositivos.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 32px 24px;border-top:1px solid #f0f0f0;">
              <p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:12px;color:#9ca3af;text-align:center;">
                Si no pediste esto, ignor&aacute; este mail &mdash; tu contrase&ntilde;a no cambia.<br>
                Nunca te vamos a pedir que hagas clic en un enlace para recuperarla.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`

// SendOTP envía un OTP por email al destinatario.
// SECURITY: el código se incluye en el cuerpo del email pero NUNCA en los logs.
func (m *brevoMailer) SendOTP(ctx context.Context, to, code string) error {
	escapedCode := html.EscapeString(code)
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
		"htmlContent": fmt.Sprintf(otpHTMLTemplate, escapedCode),
	}

	return m.post(ctx, payload)
}

// SendPasswordReset envía el OTP de recuperación de contraseña.
// SECURITY: el código se incluye en el cuerpo del email pero NUNCA en los logs.
func (m *brevoMailer) SendPasswordReset(ctx context.Context, to, code string) error {
	escapedCode := html.EscapeString(code)
	payload := map[string]interface{}{
		"sender": map[string]string{
			"email": m.fromEmail,
			"name":  m.fromName,
		},
		"to": []map[string]string{
			{"email": to},
		},
		"subject": "Restablecer tu contraseña — SearchPet",
		"textContent": fmt.Sprintf(
			"Tu código para restablecer la contraseña es: %s\n\n"+
				"Expira en 10 minutos. No lo compartas con nadie.\n"+
				"Al cambiarla vas a tener que volver a entrar en tus otros dispositivos.\n\n"+
				"Si no pediste esto, ignorá este mail — tu contraseña no cambia.", code),
		"htmlContent": fmt.Sprintf(resetHTMLTemplate, escapedCode),
	}

	return m.post(ctx, payload)
}

// post marshals and delivers a Brevo payload. Shared by SendOTP and
// SendPasswordReset so the transport, error shape and status handling stay in
// one place.
func (m *brevoMailer) post(ctx context.Context, payload map[string]interface{}) error {
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
		// El body de error de Brevo distingue la causa ("Key not found",
		// "unrecognised IP address", sender no verificado) — sin él un 401
		// es indiagnosticable. Nunca contiene secretos ni el código OTP.
		errBody, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return fmt.Errorf("mailer: brevo returned status %d: %s", resp.StatusCode, strings.TrimSpace(string(errBody)))
	}

	return nil
}

// noopMailer es una implementación vacía que no hace nada (Brevo no configurado).
type noopMailer struct{}

func (n *noopMailer) SendOTP(_ context.Context, _, _ string) error {
	return nil
}

func (n *noopMailer) SendPasswordReset(_ context.Context, _, _ string) error {
	return nil
}
