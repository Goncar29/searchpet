//go:build e2e

package e2e_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"testing"
)

func TestAuthFlow_FullChain(t *testing.T) {
	baseURL, cleanup := startTestServer(t)
	defer cleanup()

	token, email := registerAndLogin(t, baseURL)

	// GET /api/auth/me with token
	req, err := http.NewRequest(http.MethodGet, baseURL+"/api/auth/me", nil)
	if err != nil {
		t.Fatalf("failed to build /auth/me request: %v", err)
	}
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", token))

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("/auth/me request failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("/auth/me: want 200, got %d", resp.StatusCode)
	}

	var body struct {
		Email string `json:"email"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("failed to decode /auth/me response: %v", err)
	}
	if body.Email != email {
		t.Errorf("want email %q, got %q", email, body.Email)
	}
}

func TestAuthFlow_WrongPassword(t *testing.T) {
	baseURL, cleanup := startTestServer(t)
	defer cleanup()

	_, email := registerAndLogin(t, baseURL)

	// Attempt login with wrong password
	loginBody := fmt.Sprintf(`{"email":%q,"password":"wrongpassword"}`, email)
	resp, err := http.Post(baseURL+"/api/auth/login", "application/json",
		stringReader(loginBody))
	if err != nil {
		t.Fatalf("login request failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("want 401, got %d", resp.StatusCode)
	}
}
