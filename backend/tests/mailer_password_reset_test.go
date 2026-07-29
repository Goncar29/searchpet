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
	// we want: it trains them that ours never does.
	if strings.Contains(captured, "http://") || strings.Contains(captured, "https://") {
		t.Fatalf("reset email must contain no links, got: %s", captured)
	}
}

func TestSendPasswordReset_NoopWhenUnconfigured(t *testing.T) {
	m := mailer.NewBrevoMailer("", "")
	if err := m.SendPasswordReset(context.Background(), "user@example.com", "123456"); err != nil {
		t.Fatalf("noop mailer must not error, got %v", err)
	}
}
