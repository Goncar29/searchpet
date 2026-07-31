package tests

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"lost-pets/pkg/mailer"
)

func TestSendPasswordReset_PostsCodeAndNoLinks(t *testing.T) {
	var captured string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		captured = string(b)
		w.WriteHeader(http.StatusCreated)
	}))
	defer srv.Close()

	m := mailer.NewBrevoMailer("test-key", "sender@searchpet.test")
	setter, ok := m.(interface{ SetEndpoint(string) })
	if !ok {
		t.Fatal("expected a real brevoMailer, got the noop")
	}
	setter.SetEndpoint(srv.URL)

	if err := m.SendPasswordReset(context.Background(), "user@example.com", "123456"); err != nil {
		t.Fatalf("SendPasswordReset: %v", err)
	}

	if !strings.Contains(captured, "123456") {
		t.Fatal("payload does not carry the code")
	}
	if !strings.Contains(captured, "user@example.com") {
		t.Fatal("payload does not carry the recipient")
	}
	// A reset mail that never asks the user to click is the anti-phishing posture
	// we want: it trains them that ours never does. What has to be absent is
	// anything CLICKABLE — the brand logo is an <img>, which nobody can click and
	// which therefore trains nothing.
	if strings.Contains(captured, "<a ") || strings.Contains(captured, "href") {
		t.Fatalf("reset email must contain no clickable links, got: %s", captured)
	}

	// The rule stays auditable: the logo is the ONLY URL allowed in the payload.
	// A stray link added later still fails here instead of slipping through the
	// narrower clickable-link check above.
	if urls := countURLs(captured); urls != 1 {
		t.Fatalf("reset email must carry exactly one URL (the logo), got %d in: %s", urls, captured)
	}
	if !strings.Contains(captured, "icons/icon-192.png") {
		t.Fatal("the one URL in the reset email must be the brand logo")
	}
}

// countURLs cuenta ocurrencias de esquemas http(s) en el payload serializado.
func countURLs(payload string) int {
	return strings.Count(payload, "http://") + strings.Count(payload, "https://")
}

func TestSendPasswordReset_NoopWhenUnconfigured(t *testing.T) {
	m := mailer.NewBrevoMailer("", "")
	if err := m.SendPasswordReset(context.Background(), "user@example.com", "123456"); err != nil {
		t.Fatalf("noop mailer must not error, got %v", err)
	}
}
