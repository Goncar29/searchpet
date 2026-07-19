//go:build e2e

package e2e_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"gorm.io/gorm"
	"lost-pets/config"
	"lost-pets/internal/app"
	"lost-pets/pkg/logger"
	"lost-pets/tests/testdb"
)

// uniqueEmail returns a distinct email address for each call so parallel tests
// never collide in the users table.
func uniqueEmail() string {
	return fmt.Sprintf("test-%d@searchpet.test", time.Now().UnixNano())
}

// startTestServer connects to the test database, wires the full router via
// app.SetupRouter, and wraps it in an httptest.Server.
// The returned cleanup func stops the server.
// Table truncation is handled by testdb.SetupTestDB's t.Cleanup.
func startTestServer(t *testing.T) (baseURL string, cleanup func()) {
	t.Helper()
	baseURL, _, cleanup = startTestServerWithDB(t)
	return baseURL, cleanup
}

// startTestServerWithDB is identical to startTestServer but also returns the
// *gorm.DB backing the router. Some flows have no self-serve API to reach a
// given state (e.g. granting is_admin, or flipping email_verified when
// EnableEmailVerification is off — see CLAUDE.md rule #20 on admin bootstrap)
// and need direct DB access to set up fixtures.
func startTestServerWithDB(t *testing.T) (baseURL string, db *gorm.DB, cleanup func()) {
	t.Helper()

	// SetupTestDB skips the test when DATABASE_URL is not set.
	db = testdb.SetupTestDB(t)

	// Build a minimal config that matches what the test environment provides.
	cfg := &config.Config{
		Port:                    "0",
		DatabaseURL:             os.Getenv("DATABASE_URL"),
		JWTSecret:               getEnvOrDefault("JWT_SECRET", "test-secret-e2e"),
		Environment:             "test",
		CORSAllowedOrigins:      "*",
		AppURL:                  "http://localhost",
		EnableEmailVerification: false,
		AuthRateLimitMax:        1000,
	}

	log := logger.Init("test")

	router := app.SetupRouter(cfg, db, log)
	srv := httptest.NewServer(router)

	return srv.URL, db, func() {
		srv.Close()
	}
}

// registerAndLogin creates a new user and returns its JWT token and email.
func registerAndLogin(t *testing.T, baseURL string) (token string, email string) {
	t.Helper()

	email = uniqueEmail()
	password := "password123"

	// Register
	regBody, _ := json.Marshal(map[string]interface{}{
		"email":    email,
		"password": password,
		"name":     "E2E User",
	})
	regResp, err := http.Post(baseURL+"/api/auth/register", "application/json", bytes.NewReader(regBody))
	if err != nil {
		t.Fatalf("register request failed: %v", err)
	}
	defer regResp.Body.Close()
	if regResp.StatusCode != http.StatusCreated {
		t.Fatalf("register: want 201, got %d", regResp.StatusCode)
	}

	// Login
	loginBody, _ := json.Marshal(map[string]interface{}{
		"email":    email,
		"password": password,
	})
	loginResp, err := http.Post(baseURL+"/api/auth/login", "application/json", bytes.NewReader(loginBody))
	if err != nil {
		t.Fatalf("login request failed: %v", err)
	}
	defer loginResp.Body.Close()
	if loginResp.StatusCode != http.StatusOK {
		t.Fatalf("login: want 200, got %d", loginResp.StatusCode)
	}

	var result struct {
		Token string `json:"token"`
	}
	if err := json.NewDecoder(loginResp.Body).Decode(&result); err != nil {
		t.Fatalf("failed to decode login response: %v", err)
	}
	if result.Token == "" {
		t.Fatal("login returned empty token")
	}

	return result.Token, email
}

// getEnvOrDefault returns the env var value or the provided default.
func getEnvOrDefault(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

// stringReader wraps a string in an io.Reader for use in HTTP requests.
func stringReader(s string) *strings.Reader {
	return strings.NewReader(s)
}
