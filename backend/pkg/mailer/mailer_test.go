package mailer

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestNewBrevoMailer_MissingAPIKey_ReturnsNoop(t *testing.T) {
	m := NewBrevoMailer("", "sender@example.com")

	if _, ok := m.(*noopMailer); !ok {
		t.Fatalf("expected noopMailer when api key is empty, got %T", m)
	}
	if err := m.SendOTP(context.Background(), "user@example.com", "123456"); err != nil {
		t.Fatalf("noop mailer should never fail, got: %v", err)
	}
}

func TestNewBrevoMailer_MissingFromEmail_ReturnsNoop(t *testing.T) {
	m := NewBrevoMailer("key", "")

	if _, ok := m.(*noopMailer); !ok {
		t.Fatalf("expected noopMailer when from email is empty, got %T", m)
	}
}

func TestBrevoMailer_SendOTP_SendsCorrectRequest(t *testing.T) {
	var gotAPIKey, gotContentType string
	var gotBody map[string]interface{}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("expected POST, got %s", r.Method)
		}
		gotAPIKey = r.Header.Get("api-key")
		gotContentType = r.Header.Get("Content-Type")
		if err := json.NewDecoder(r.Body).Decode(&gotBody); err != nil {
			t.Errorf("invalid JSON body: %v", err)
		}
		w.WriteHeader(http.StatusCreated)
	}))
	defer server.Close()

	m := NewBrevoMailer("test-api-key", "sender@example.com")
	brevo, ok := m.(*brevoMailer)
	if !ok {
		t.Fatalf("expected *brevoMailer, got %T", m)
	}
	brevo.endpoint = server.URL

	if err := m.SendOTP(context.Background(), "user@example.com", "654321"); err != nil {
		t.Fatalf("SendOTP failed: %v", err)
	}

	if gotAPIKey != "test-api-key" {
		t.Errorf("expected api-key header 'test-api-key', got %q", gotAPIKey)
	}
	if gotContentType != "application/json" {
		t.Errorf("expected Content-Type application/json, got %q", gotContentType)
	}

	sender, _ := gotBody["sender"].(map[string]interface{})
	if sender["email"] != "sender@example.com" {
		t.Errorf("expected sender email 'sender@example.com', got %v", sender["email"])
	}
	if sender["name"] != "SearchPet" {
		t.Errorf("expected sender name 'SearchPet', got %v", sender["name"])
	}

	to, _ := gotBody["to"].([]interface{})
	if len(to) != 1 {
		t.Fatalf("expected exactly 1 recipient, got %d", len(to))
	}
	recipient, _ := to[0].(map[string]interface{})
	if recipient["email"] != "user@example.com" {
		t.Errorf("expected recipient 'user@example.com', got %v", recipient["email"])
	}

	subject, _ := gotBody["subject"].(string)
	if subject == "" {
		t.Error("expected non-empty subject")
	}

	textContent, _ := gotBody["textContent"].(string)
	if !strings.Contains(textContent, "654321") {
		t.Errorf("expected textContent to contain the OTP code, got %q", textContent)
	}

	// htmlContent is the styled version; textContent stays as the fallback
	// for clients that don't render HTML.
	htmlContent, _ := gotBody["htmlContent"].(string)
	if !strings.Contains(htmlContent, "654321") {
		t.Errorf("expected htmlContent to contain the OTP code, got %q", htmlContent)
	}
	if !strings.Contains(htmlContent, "SearchPet") {
		t.Error("expected htmlContent to carry SearchPet branding")
	}
	if !strings.Contains(htmlContent, "<") {
		t.Error("expected htmlContent to be HTML markup")
	}
}

func TestBrevoMailer_SendOTP_UpstreamErrorStatus(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"message":"unrecognised IP address 1.2.3.4","code":"unauthorized"}`))
	}))
	defer server.Close()

	m := NewBrevoMailer("bad-key", "sender@example.com")
	m.(*brevoMailer).endpoint = server.URL

	err := m.SendOTP(context.Background(), "user@example.com", "111111")
	if err == nil {
		t.Fatal("expected error on 401 response, got nil")
	}
	// The Brevo error body distinguishes "Key not found" from
	// "unrecognised IP address" — without it a 401 is undiagnosable.
	if !strings.Contains(err.Error(), "unrecognised IP address") {
		t.Errorf("expected error to include the Brevo response body, got: %v", err)
	}
}

func TestBrevoMailer_SendOTP_UpstreamErrorBodyTruncated(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(strings.Repeat("x", 5000)))
	}))
	defer server.Close()

	m := NewBrevoMailer("key", "sender@example.com")
	m.(*brevoMailer).endpoint = server.URL

	err := m.SendOTP(context.Background(), "user@example.com", "111111")
	if err == nil {
		t.Fatal("expected error on 400 response, got nil")
	}
	if len(err.Error()) > 600 {
		t.Errorf("expected upstream body to be truncated in error, got %d chars", len(err.Error()))
	}
}

func TestBrevoMailer_SendOTP_ConnectionError(t *testing.T) {
	m := NewBrevoMailer("key", "sender@example.com")
	// Closed server → connection refused.
	server := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, _ *http.Request) {}))
	m.(*brevoMailer).endpoint = server.URL
	server.Close()

	err := m.SendOTP(context.Background(), "user@example.com", "222222")
	if err == nil {
		t.Fatal("expected error when upstream is unreachable, got nil")
	}
}

// --- Startup guard ------------------------------------------------------
//
// The noop mailer is a legitimate development affordance: local runs, the seed
// and the e2e suite all boot without Brevo credentials on purpose. What was
// missing is that production booted into that same noop SILENTLY — the user
// asked for a code, read "te enviamos un código", and nothing was ever sent.
// These tests pin the guard that closes it.

func TestMissingConfig_NombraLaEnvQueFalta(t *testing.T) {
	cases := []struct {
		name      string
		apiKey    string
		fromEmail string
		want      []string
	}{
		{"todo configurado", "key", "sender@example.com", nil},
		{"falta la api key", "", "sender@example.com", []string{"BREVO_API_KEY"}},
		{"falta el remitente", "key", "", []string{"MAIL_FROM_EMAIL"}},
		{"faltan las dos", "", "", []string{"BREVO_API_KEY", "MAIL_FROM_EMAIL"}},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := MissingConfig(tc.apiKey, tc.fromEmail)

			if len(got) != len(tc.want) {
				t.Fatalf("MissingConfig(%q, %q) = %v, want %v", tc.apiKey, tc.fromEmail, got, tc.want)
			}
			for i := range tc.want {
				if got[i] != tc.want[i] {
					t.Errorf("MissingConfig()[%d] = %q, want %q", i, got[i], tc.want[i])
				}
			}
		})
	}
}

// TestRequireConfigured_SoloFallaEnProduccion pins BOTH halves. Only asserting
// that production fails would pass against a guard that fails everywhere — and
// that guard would break local dev, the seed and the e2e suite, all of which
// boot without Brevo credentials deliberately.
func TestRequireConfigured_SoloFallaEnProduccion(t *testing.T) {
	cases := []struct {
		name        string
		apiKey      string
		fromEmail   string
		environment string
		wantErr     bool
	}{
		{"produccion sin credenciales", "", "", "production", true},
		{"produccion sin api key", "", "sender@example.com", "production", true},
		{"produccion sin remitente", "key", "", "production", true},
		{"produccion configurada", "key", "sender@example.com", "production", false},
		{"development sin credenciales", "", "", "development", false},
		{"test sin credenciales", "", "", "test", false},
		{"string vacio sin credenciales", "", "", "", false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := RequireConfigured(tc.apiKey, tc.fromEmail, tc.environment)

			if tc.wantErr && err == nil {
				t.Fatalf("RequireConfigured(%q, %q, %q) = nil, want error",
					tc.apiKey, tc.fromEmail, tc.environment)
			}
			if !tc.wantErr && err != nil {
				t.Fatalf("RequireConfigured(%q, %q, %q) = %v, want nil",
					tc.apiKey, tc.fromEmail, tc.environment, err)
			}
		})
	}
}

// TestRequireConfigured_NombraLaEnvEnElError: the whole point of failing at
// boot is that the operator can fix it without reading source. An error that
// says "mailer misconfigured" and nothing else sends them digging.
func TestRequireConfigured_NombraLaEnvEnElError(t *testing.T) {
	err := RequireConfigured("", "sender@example.com", "production")
	if err == nil {
		t.Fatal("expected an error when BREVO_API_KEY is missing in production")
	}
	if !strings.Contains(err.Error(), "BREVO_API_KEY") {
		t.Errorf("error should name the missing env var, got: %v", err)
	}
}

// TestRequireConfigured_NoFiltraElSecreto: the guard reads the API key, so it
// is one careless %v away from printing it into Render's logs.
func TestRequireConfigured_NoFiltraElSecreto(t *testing.T) {
	const secret = "xkeysib-super-secret-value"

	// Missing sender, key present: the key is in scope and must stay out.
	err := RequireConfigured(secret, "", "production")
	if err == nil {
		t.Fatal("expected an error when MAIL_FROM_EMAIL is missing in production")
	}
	if strings.Contains(err.Error(), secret) {
		t.Errorf("the API key must never reach the error message, got: %v", err)
	}
}

// TestMissingConfig_CoincideConElConstructor is the anti-drift test, and the
// reason MissingConfig exists as a function instead of the guard re-stating the
// condition. Two copies of "is the mailer configured?" is exactly how a guard
// ends up disagreeing with the thing it guards — and this guard's whole job is
// to notice a noop, so a disagreement makes it blind to the case it exists for.
func TestMissingConfig_CoincideConElConstructor(t *testing.T) {
	values := []string{"", "set"}

	for _, apiKey := range values {
		for _, fromEmail := range values {
			missing := len(MissingConfig(apiKey, fromEmail)) > 0
			_, isNoop := NewBrevoMailer(apiKey, fromEmail).(*noopMailer)

			if missing != isNoop {
				t.Errorf("apiKey=%q fromEmail=%q: MissingConfig says missing=%v but constructor noop=%v — the guard and the constructor disagree",
					apiKey, fromEmail, missing, isNoop)
			}
		}
	}
}
