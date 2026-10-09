//go:build e2e

package e2e_test

import (
	"io"
	"net/http"
	"strings"
	"testing"

	"lost-pets/internal/domain"
)

// TestBanFlow_EndsTheOpenSessionAndUnbanRestoresIt guards that a ban reaches a
// session that is ALREADY open. Until 2026-10-09 users.is_banned was read only
// at login, so a banned user kept using the API for up to the 72 h of the
// token. Runs against real Postgres: the flag travels through the same
// per-request user read the middleware does in production.
func TestBanFlow_EndsTheOpenSessionAndUnbanRestoresIt(t *testing.T) {
	baseURL, db, cleanup := startTestServerWithDB(t)
	defer cleanup()

	targetToken, targetEmail := registerAndLogin(t, baseURL)
	adminToken, adminEmail := registerAndLogin(t, baseURL)
	markAdmin(t, db, adminEmail)

	var target domain.User
	if err := db.Where("email = ?", targetEmail).First(&target).Error; err != nil {
		t.Fatalf("load target user: %v", err)
	}

	if got := authedStatus(t, baseURL, targetToken); got != http.StatusOK {
		t.Fatalf("before the ban: protected route = %d, want 200", got)
	}

	moderate(t, baseURL, adminToken, "/api/admin/users/"+target.ID.String()+"/ban")

	status, body := authedGet(t, baseURL+"/api/pets/mine", targetToken)
	if status != http.StatusUnauthorized || !strings.Contains(body, `"code":"user_banned"`) {
		t.Fatalf("after the ban, same token: %d %s, want 401 user_banned", status, body)
	}

	// Public reads stay readable: OptionalAuth treats the banned user as anonymous.
	if status, body := authedGet(t, baseURL+"/api/stories", targetToken); status != http.StatusOK {
		t.Fatalf("after the ban, public read: %d %s, want 200", status, body)
	}

	moderate(t, baseURL, adminToken, "/api/admin/users/"+target.ID.String()+"/unban")

	if got := authedStatus(t, baseURL, targetToken); got != http.StatusOK {
		t.Fatalf("after the unban, same token: %d, want 200", got)
	}
}

func moderate(t *testing.T, baseURL, adminToken, path string) {
	t.Helper()
	req, err := http.NewRequest(http.MethodPatch, baseURL+path, strings.NewReader(`{"reason":"e2e"}`))
	if err != nil {
		t.Fatalf("build %s: %v", path, err)
	}
	req.Header.Set("Authorization", "Bearer "+adminToken)
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("%s: %v", path, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		raw, _ := io.ReadAll(resp.Body)
		t.Fatalf("%s: %d %s, want 200", path, resp.StatusCode, raw)
	}
}

func authedGet(t *testing.T, url, token string) (int, string) {
	t.Helper()
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		t.Fatalf("build GET %s: %v", url, err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("GET %s: %v", url, err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, string(raw)
}
