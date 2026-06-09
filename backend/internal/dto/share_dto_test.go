package dto

import (
	"strings"
	"testing"
	"time"
)

func TestToGenerateShareLinkResponse_StripsTrailingSlash(t *testing.T) {
	// APP_URL on Render includes a trailing slash — must not produce "//pet/"
	expiresAt := time.Now().Add(24 * time.Hour)
	resp := ToGenerateShareLinkResponse("abc123", "https://example.com/", expiresAt)

	if strings.Contains(resp.ShareURL, "//pet/") {
		t.Fatalf("share URL has double slash: %q", resp.ShareURL)
	}
	want := "https://example.com/pet/abc123"
	if resp.ShareURL != want {
		t.Fatalf("want %q, got %q", want, resp.ShareURL)
	}
}

func TestToGenerateShareLinkResponse_NoTrailingSlash(t *testing.T) {
	expiresAt := time.Now().Add(24 * time.Hour)
	resp := ToGenerateShareLinkResponse("abc123", "https://example.com", expiresAt)

	want := "https://example.com/pet/abc123"
	if resp.ShareURL != want {
		t.Fatalf("want %q, got %q", want, resp.ShareURL)
	}
}
