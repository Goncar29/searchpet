package googleauth

import (
	"strings"
	"testing"
)

func TestNewVerifier_RejectsEmptyClientID(t *testing.T) {
	// idtoken.Validate SKIPS the audience check on an empty audience, which would
	// accept a token minted for ANY application. A permissive verifier must be
	// impossible to construct, not merely discouraged.
	v, err := NewVerifier("")
	if err == nil {
		t.Fatal("expected an error for an empty client id")
	}
	if v != nil {
		t.Error("no verifier may be returned when the client id is empty")
	}
}

func TestNewVerifier_AcceptsClientID(t *testing.T) {
	v, err := NewVerifier("123.apps.googleusercontent.com")
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if v == nil {
		t.Fatal("expected a verifier")
	}
}

func TestCheckIdentity(t *testing.T) {
	const (
		goodSub   = "google-sub-123"
		goodEmail = "carlos@example.com"
	)

	cases := []struct {
		name            string
		issuer          string
		sub             string
		email           string
		wantErr         bool
		wantErrContains string
	}{
		{name: "bare issuer accepted", issuer: "accounts.google.com", sub: goodSub, email: goodEmail},
		{name: "https issuer accepted", issuer: "https://accounts.google.com", sub: goodSub, email: goodEmail},
		{name: "missing issuer rejected", issuer: "", sub: goodSub, email: goodEmail, wantErr: true, wantErrContains: "issuer"},
		{name: "foreign issuer rejected", issuer: "https://evil.example.com", sub: goodSub, email: goodEmail, wantErr: true, wantErrContains: "issuer"},
		{name: "http issuer rejected", issuer: "http://accounts.google.com", sub: goodSub, email: goodEmail, wantErr: true, wantErrContains: "issuer"},
		{name: "empty sub rejected", issuer: "accounts.google.com", sub: "", email: goodEmail, wantErr: true, wantErrContains: "sub"},
		{name: "empty email rejected", issuer: "accounts.google.com", sub: goodSub, email: "", wantErr: true, wantErrContains: "email"},
		{
			name: "service-account email rejected", issuer: "accounts.google.com", sub: goodSub,
			email: "bot@my-project.iam.gserviceaccount.com", wantErr: true, wantErrContains: "service-account",
		},
		{
			name: "service-account email rejected regardless of case", issuer: "accounts.google.com", sub: goodSub,
			email: "Bot@My-Project.IAM.GServiceAccount.COM", wantErr: true, wantErrContains: "service-account",
		},
		{
			// A human address that merely CONTAINS the string must still pass —
			// the check is a suffix, not a substring.
			name: "lookalike human address accepted", issuer: "accounts.google.com", sub: goodSub,
			email: "iam.gserviceaccount.com@gmail.com",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := checkIdentity(tc.issuer, tc.sub, tc.email)
			if tc.wantErr {
				if err == nil {
					t.Fatalf("expected an error for %q / %q / %q", tc.issuer, tc.sub, tc.email)
				}
				if tc.wantErrContains != "" && !strings.Contains(err.Error(), tc.wantErrContains) {
					t.Errorf("expected the error to mention %q, got %q", tc.wantErrContains, err)
				}
				return
			}
			if err != nil {
				t.Fatalf("expected no error, got %v", err)
			}
		})
	}
}

func TestBoolClaim(t *testing.T) {
	// email_verified is the gate protecting account auto-linking. Every shape that
	// is not an explicit true MUST read as false — failing closed is the point.
	cases := []struct {
		name  string
		value any
		want  bool
	}{
		{"json true", true, true},
		{"json false", false, false},
		{"string true", "true", true},
		{"string False", "False", false},
		{"string True capitalised", "True", false},
		{"number one", 1, false},
		{"nil", nil, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := boolClaim(map[string]any{"email_verified": tc.value}, "email_verified"); got != tc.want {
				t.Errorf("boolClaim(%#v) = %v, expected %v", tc.value, got, tc.want)
			}
		})
	}
	if boolClaim(map[string]any{}, "email_verified") {
		t.Error("a MISSING email_verified claim must read as false")
	}
}
