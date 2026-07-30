//go:build e2e

package e2e_test

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"testing"
	"time"

	"lost-pets/internal/domain"
)

// knownCode is planted over the generated one. The real code only ever exists in
// the email body, and reading it back is not the point of this test: what matters
// is that the row reaches Postgres at all.
const knownCode = "123456"

// TestPasswordResetFlow_EndToEnd is the regression guard for the bug that made
// this feature a silent no-op in production: domain.VerificationToken.Channel was
// sized 10 while the flow writes "password_reset" (14 chars), so every insert died
// with SQLSTATE 22001. RequestReset swallows that error on purpose (enumeration
// defence), so /forgot still answered 200 and no test with a mocked repository
// could tell. Only a real Postgres column can fail this way.
func TestPasswordResetFlow_EndToEnd(t *testing.T) {
	baseURL, db, cleanup := startTestServerWithDB(t)
	defer cleanup()

	oldToken, email := registerAndLogin(t, baseURL)

	// The old session must be live before the reset, otherwise step 4 proves nothing.
	if got := authedStatus(t, baseURL, oldToken); got != http.StatusOK {
		t.Fatalf("pre-reset /api/pets/mine: want 200, got %d", got)
	}

	// DO NOT REMOVE. checkFreshness compares a second-granular `iat` against a
	// second-granular password_changed_at, so a token minted in the same wall-clock
	// second as the reset survives it by design (middleware/auth.go). Without this
	// wait the whole flow runs inside one second and step 4 fails against correct
	// code. The wait is what makes the assertion mean "sessions are cut", instead
	// of "the test was slow enough".
	time.Sleep(1100 * time.Millisecond)

	// 1. Request the code.
	if got, _ := postJSON(t, baseURL+"/api/auth/password/forgot", map[string]string{"email": email}); got != http.StatusOK {
		t.Fatalf("/password/forgot: want 200, got %d", got)
	}

	// 2. THE ASSERTION THAT WOULD HAVE CAUGHT THE BUG. Before the fix this row did
	// not exist: the endpoint answered 200 and Postgres had rejected the insert.
	var stored domain.VerificationToken
	if err := db.Where("channel = ?", "password_reset").Order("created_at DESC").First(&stored).Error; err != nil {
		t.Fatalf("no password_reset token reached the database: %v — "+
			"/forgot answers 200 even when the insert fails, so check the server log "+
			"for '[password_reset] token create failed'", err)
	}
	if stored.Used {
		t.Fatal("a freshly minted token must not be marked used")
	}

	// 3. Plant a code we know, then spend it.
	planted := fmt.Sprintf("%x", sha256.Sum256([]byte(knownCode)))
	if err := db.Model(&domain.VerificationToken{}).Where("id = ?", stored.ID).
		UpdateColumn("code_hash", planted).Error; err != nil {
		t.Fatalf("failed to plant a known code: %v", err)
	}

	const newPassword = "brandnewpassword456"
	status, _ := postJSON(t, baseURL+"/api/auth/password/reset", map[string]string{
		"email": email, "code": knownCode, "new_password": newPassword,
	})
	if status != http.StatusOK {
		t.Fatalf("/password/reset: want 200, got %d", status)
	}

	// 4. The reset must cut every session issued before it.
	if got := authedStatus(t, baseURL, oldToken); got != http.StatusUnauthorized {
		t.Errorf("post-reset the old JWT must be rejected: want 401, got %d", got)
	}

	// 5. The old password is gone and the new one works.
	if got, _ := postJSON(t, baseURL+"/api/auth/login", map[string]string{
		"email": email, "password": "password123",
	}); got != http.StatusUnauthorized {
		t.Errorf("login with the old password: want 401, got %d", got)
	}
	if got, _ := postJSON(t, baseURL+"/api/auth/login", map[string]string{
		"email": email, "password": newPassword,
	}); got != http.StatusOK {
		t.Errorf("login with the new password: want 200, got %d", got)
	}

	// 6. The spent code cannot be replayed.
	if got, _ := postJSON(t, baseURL+"/api/auth/password/reset", map[string]string{
		"email": email, "code": knownCode, "new_password": "yetanotherpassword789",
	}); got != http.StatusBadRequest {
		t.Errorf("replaying a spent code: want 400, got %d", got)
	}
}

// TestPasswordResetFlow_ForgotIsIndistinguishable pins the enumeration defence
// against the real stack. A registered and an unknown address must come back
// byte for byte the same, or /forgot becomes an account-existence oracle.
func TestPasswordResetFlow_ForgotIsIndistinguishable(t *testing.T) {
	baseURL, cleanup := startTestServer(t)
	defer cleanup()

	_, email := registerAndLogin(t, baseURL)

	realStatus, realBody := postJSON(t, baseURL+"/api/auth/password/forgot", map[string]string{"email": email})
	fakeStatus, fakeBody := postJSON(t, baseURL+"/api/auth/password/forgot",
		map[string]string{"email": "definitely-not-registered@searchpet.test"})

	if realStatus != fakeStatus {
		t.Errorf("status differs: registered %d, unknown %d", realStatus, fakeStatus)
	}
	if !bytes.Equal(realBody, fakeBody) {
		t.Errorf("body differs:\n registered: %s\n unknown:    %s", realBody, fakeBody)
	}
}

// postJSON posts a JSON body and returns the status and the raw response bytes.
func postJSON(t *testing.T, url string, payload map[string]string) (int, []byte) {
	t.Helper()

	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("failed to marshal payload: %v", err)
	}
	resp, err := http.Post(url, "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("POST %s failed: %v", url, err)
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("failed to read response from %s: %v", url, err)
	}
	return resp.StatusCode, raw
}

// authedStatus calls a protected route with the given JWT and returns the status.
func authedStatus(t *testing.T, baseURL, token string) int {
	t.Helper()

	req, err := http.NewRequest(http.MethodGet, baseURL+"/api/pets/mine", nil)
	if err != nil {
		t.Fatalf("failed to build request: %v", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	defer resp.Body.Close()
	return resp.StatusCode
}
