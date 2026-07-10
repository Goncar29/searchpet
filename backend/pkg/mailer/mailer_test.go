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
