# Password Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user who forgot their password prove control of their email with a 6-digit OTP and set a new one, invalidating every session that predates the change.

**Architecture:** A new `PasswordResetService` reuses the existing `verification_tokens` table under `channel = "password_reset"`, plus the OTP generation, hashing and attempt-capping already in the `service` package. Session invalidation adds `users.password_changed_at`, returns the JWT's `iat` from `jwt.ValidateToken`, and compares them in both auth middlewares.

**Tech Stack:** Go 1.25 + Gin + GORM, golang-jwt/v5, bcrypt, Brevo HTTP API, PostgreSQL; React + Vite + Tailwind (web), React Native + Expo (mobile), i18next on both.

**Spec:** `docs/superpowers/specs/2026-07-29-password-recovery-design.md`

**Branch:** `feat/password-recovery` (already created from `origin/main`, spec committed as `84c6806`)

---

## Conventions this plan follows

- **Conventional commits, no AI attribution.** Commit after every task.
- **All HTTP errors go through `writeError(c, status, err)`** → `{code, message}` (rule #11).
- **Backend test commands** run from `backend/`: `go test ./... -run <Name> -v`.
- **Never log the plaintext OTP or the new password.** Existing `SECURITY:` comments show the pattern.
- Service unit tests live in `backend/tests/` (package `tests`). That package already defines `mockUserRepo`, `mockTokenRepo`, `hashCode` and `makeToken` in `verification_service_test.go` — **reuse them, do not redeclare**, or the package will not compile.

## File structure

| File | Responsibility |
|---|---|
| `backend/internal/domain/errors.go` | +`ErrSessionExpired` and its code (modify) |
| `backend/internal/domain/models.go` | +`User.PasswordChangedAt` (modify) |
| `backend/migrations/000020_add_password_changed_at.{up,down}.sql` | Column (create) |
| `backend/pkg/jwt/jwt.go` | `ValidateToken` also returns the issued-at (modify) |
| `backend/internal/middleware/auth.go` | Both gates reject stale tokens (modify) |
| `backend/pkg/mailer/mailer.go` | +`SendPasswordReset` + template (modify) |
| `backend/internal/service/password_reset_service.go` | The whole flow (create) |
| `backend/internal/service/interfaces.go` | +`PasswordResetService` interface (modify) |
| `backend/internal/service/auth_service.go` | `LoginWithGoogle` stamps the column (modify) |
| `backend/internal/dto/auth_dto.go` | Two request DTOs (modify) |
| `backend/internal/handler/password_reset_handler.go` | Two endpoints (create) |
| `backend/internal/app/router.go` | Wiring + routes + middleware lookup (modify) |
| `frontend/packages/shared/api/client.ts` | Two client methods (modify) |
| `frontend/packages/web/src/pages/ForgotPasswordPage.tsx` | Two-step page (create) |
| `frontend/packages/mobile/app/forgot-password.tsx` | Two-step screen (create) |

---

### Task 1: `ErrSessionExpired` domain error

**Files:**
- Modify: `backend/internal/domain/errors.go`
- Test: `backend/tests/write_error_test.go` (existing file, append)

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/write_error_test.go`:

```go
func TestCodeFor_SessionExpired(t *testing.T) {
	if got := domain.CodeFor(domain.ErrSessionExpired); got != "session_expired" {
		t.Fatalf("CodeFor(ErrSessionExpired) = %q, want %q", got, "session_expired")
	}
}
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd backend && go test ./tests/ -run TestCodeFor_SessionExpired -v`
Expected: compile error — `undefined: domain.ErrSessionExpired`.

- [ ] **Step 3: Add the sentinel and its code**

In `errors.go`, inside the `var (...)` block under the `// General` group:

```go
	// Returned when a JWT predates the user's last credential change. Distinct
	// from ErrUnauthorized so clients can drop the stored token and route to
	// login instead of showing a generic failure.
	ErrSessionExpired = errors.New("tu sesión expiró; volvé a iniciar sesión")
```

In the `ErrorCodes` map, under `// General`:

```go
	ErrSessionExpired: "session_expired",
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `cd backend && go test ./tests/ -run TestCodeFor_SessionExpired -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/domain/errors.go backend/tests/write_error_test.go
git commit -m "feat(auth): agregar error de dominio session_expired"
```

---

### Task 2: `users.password_changed_at`

**Files:**
- Modify: `backend/internal/domain/models.go` (the `User` struct)
- Create: `backend/migrations/000020_add_password_changed_at.up.sql`
- Create: `backend/migrations/000020_add_password_changed_at.down.sql`

- [ ] **Step 1: Add the field**

In the `User` struct in `models.go`, next to the other auth fields:

```go
	// PasswordChangedAt is the moment the credentials last changed. NULL means
	// "never changed" and invalidates nothing, so existing sessions survive the
	// deploy that introduces this column. Always stored truncated to the second:
	// a JWT's `iat` has second granularity, and a sub-second value here would
	// make a freshly issued token reject itself.
	PasswordChangedAt *time.Time `json:"-" gorm:"column:password_changed_at"`
```

- [ ] **Step 2: Write the up migration**

`backend/migrations/000020_add_password_changed_at.up.sql`:

```sql
-- IF NOT EXISTS because GORM AutoMigrate also derives this column from the
-- struct field, and both paths run on every deploy.
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;
```

- [ ] **Step 3: Write the down migration**

`backend/migrations/000020_add_password_changed_at.down.sql`:

```sql
ALTER TABLE users DROP COLUMN IF EXISTS password_changed_at;
```

- [ ] **Step 4: Confirm the whole backend still builds**

Run: `cd backend && go build ./...`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/domain/models.go backend/migrations/000020_add_password_changed_at.up.sql backend/migrations/000020_add_password_changed_at.down.sql
git commit -m "feat(auth): agregar columna users.password_changed_at"
```

---

### Task 3: `ValidateToken` returns the issued-at

**Files:**
- Modify: `backend/pkg/jwt/jwt.go:36-54`
- Test: `backend/tests/jwt_test.go` (existing, append)

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/jwt_test.go`:

```go
func TestValidateToken_ReturnsIssuedAt(t *testing.T) {
	userID := uuid.New()
	before := time.Now().Add(-2 * time.Second)

	token, err := jwt.GenerateToken(userID, "test-secret")
	if err != nil {
		t.Fatalf("GenerateToken: %v", err)
	}

	gotID, issuedAt, err := jwt.ValidateToken(token, "test-secret")
	if err != nil {
		t.Fatalf("ValidateToken: %v", err)
	}
	if gotID != userID {
		t.Fatalf("userID = %v, want %v", gotID, userID)
	}
	if issuedAt.Before(before) {
		t.Fatalf("issuedAt = %v, want at or after %v", issuedAt, before)
	}
	if issuedAt.After(time.Now().Add(time.Second)) {
		t.Fatalf("issuedAt = %v is in the future", issuedAt)
	}
}
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd backend && go test ./tests/ -run TestValidateToken_ReturnsIssuedAt -v`
Expected: compile error — assignment mismatch, `ValidateToken` returns 2 values.

- [ ] **Step 3: Change the signature**

Replace the body of `ValidateToken` in `backend/pkg/jwt/jwt.go`:

```go
// ValidateToken verifica la firma del JWT y extrae el userID y el momento de
// emisión. El issued-at lo usa el middleware para rechazar tokens anteriores al
// último cambio de credenciales (users.password_changed_at).
// Retorna error si el token es inválido o expiró.
func ValidateToken(tokenString, secretKey string) (uuid.UUID, time.Time, error) {
	token, err := jwt.ParseWithClaims(tokenString, &Claims{}, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, errors.New("método de firma inválido")
		}
		return []byte(secretKey), nil
	})

	if err != nil {
		return uuid.Nil, time.Time{}, err
	}

	claims, ok := token.Claims.(*Claims)
	if !ok || !token.Valid {
		return uuid.Nil, time.Time{}, errors.New("token inválido")
	}

	// GenerateToken always sets IssuedAt. A token without it is not one of ours,
	// and a zero time would silently pass every freshness check.
	if claims.IssuedAt == nil {
		return uuid.Nil, time.Time{}, errors.New("token sin issued-at")
	}

	return claims.UserID, claims.IssuedAt.Time, nil
}
```

- [ ] **Step 4: Fix the three call sites**

`backend/internal/middleware/auth.go:34` → `userID, _, err := jwt.ValidateToken(parts[1], secretKey)`
`backend/internal/middleware/auth.go:63` → `if userID, _, err := jwt.ValidateToken(parts[1], secretKey); err == nil {`
`backend/internal/service/auth_google_test.go:63` → `got, _, err := jwt.ValidateToken(token, googleTestSecret)`

(Task 4 replaces the two middleware lines properly; this step only restores compilation.)

- [ ] **Step 5: Run the full backend test suite**

Run: `cd backend && go build ./... && go test ./tests/ ./internal/... -count=1`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/pkg/jwt/jwt.go backend/internal/middleware/auth.go backend/internal/service/auth_google_test.go backend/tests/jwt_test.go
git commit -m "feat(auth): ValidateToken retorna el issued-at del JWT"
```

---

### Task 4: Both middlewares reject stale tokens

**Files:**
- Modify: `backend/internal/middleware/auth.go`
- Test: `backend/tests/auth_middleware_test.go` (create)

**Why both gates:** `OptionalAuth` establishes `userID` from the same token on public endpoints that enrich their response for a signed-in viewer. Patching only `Auth` would leave a revoked token granting identity there. `OptionalAuth` keeps its contract and never aborts — on a stale token it simply declines to set `userID`.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/auth_middleware_test.go`:

```go
package tests

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"lost-pets/internal/middleware"
	"lost-pets/pkg/jwt"
)

const mwSecret = "middleware-test-secret"

// lookup builds a PasswordChangedAtFunc returning a fixed instant.
func lookup(at time.Time) middleware.PasswordChangedAtFunc {
	return func(_ context.Context, _ uuid.UUID) (time.Time, error) { return at, nil }
}

func requestWith(t *testing.T, h gin.HandlerFunc, token string) *httptest.ResponseRecorder {
	t.Helper()
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/probe", h, func(c *gin.Context) {
		id, ok := c.Get("userID")
		if !ok {
			c.JSON(http.StatusOK, gin.H{"anon": true})
			return
		}
		c.JSON(http.StatusOK, gin.H{"user": id})
	})

	req := httptest.NewRequest(http.MethodGet, "/probe", nil)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func TestAuth_RejectsTokenIssuedBeforePasswordChange(t *testing.T) {
	token, err := jwt.GenerateToken(uuid.New(), mwSecret)
	if err != nil {
		t.Fatalf("GenerateToken: %v", err)
	}
	// Password changed one minute AFTER this token was issued.
	changed := time.Now().Add(time.Minute).Truncate(time.Second)

	w := requestWith(t, middleware.Auth(mwSecret, lookup(changed)), token)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", w.Code)
	}
	if body := w.Body.String(); !strings.Contains(body, "session_expired") {
		t.Fatalf("body = %s, want it to carry session_expired", body)
	}
}

func TestAuth_AcceptsTokenIssuedInTheSameSecond(t *testing.T) {
	token, err := jwt.GenerateToken(uuid.New(), mwSecret)
	if err != nil {
		t.Fatalf("GenerateToken: %v", err)
	}
	// Truncated to the same second the token was stamped with.
	changed := time.Now().Truncate(time.Second)

	w := requestWith(t, middleware.Auth(mwSecret, lookup(changed)), token)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 — a freshly issued token must not reject itself", w.Code)
	}
}

func TestAuth_ZeroPasswordChangedAtInvalidatesNothing(t *testing.T) {
	token, err := jwt.GenerateToken(uuid.New(), mwSecret)
	if err != nil {
		t.Fatalf("GenerateToken: %v", err)
	}

	w := requestWith(t, middleware.Auth(mwSecret, lookup(time.Time{})), token)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}
}

func TestOptionalAuth_StaleTokenDropsIdentityWithoutAborting(t *testing.T) {
	token, err := jwt.GenerateToken(uuid.New(), mwSecret)
	if err != nil {
		t.Fatalf("GenerateToken: %v", err)
	}
	changed := time.Now().Add(time.Minute).Truncate(time.Second)

	w := requestWith(t, middleware.OptionalAuth(mwSecret, lookup(changed)), token)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 — OptionalAuth must never abort", w.Code)
	}
	if !strings.Contains(w.Body.String(), "anon") {
		t.Fatalf("body = %s, want the request to proceed anonymously", w.Body.String())
	}
}
```

- [ ] **Step 2: Run and confirm they fail**

Run: `cd backend && go test ./tests/ -run 'TestAuth_|TestOptionalAuth_' -v`
Expected: compile error — `middleware.PasswordChangedAtFunc` undefined and `Auth` takes 1 argument.

- [ ] **Step 3: Implement**

Replace `backend/internal/middleware/auth.go` entirely:

```go
package middleware

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/pkg/jwt"
)

// PasswordChangedAtFunc reports when the user's credentials last changed.
// A zero time means "never changed" and invalidates nothing. Kept as a narrow
// function rather than a repository so the middleware does not depend on the
// whole data layer.
type PasswordChangedAtFunc func(ctx context.Context, userID uuid.UUID) (time.Time, error)

func abortUnauthorized(c *gin.Context) {
	c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
		"code":    domain.CodeFor(domain.ErrUnauthorized),
		"message": domain.ErrUnauthorized.Error(),
	})
}

// abortSessionExpired is distinct from abortUnauthorized on purpose: the client
// must drop the stored token and route to login, not just show an error.
func abortSessionExpired(c *gin.Context) {
	c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
		"code":    domain.CodeFor(domain.ErrSessionExpired),
		"message": domain.ErrSessionExpired.Error(),
	})
}

// tokenIsStale reports whether a token issued at issuedAt predates the user's
// last credential change.
//
// The comparison is strict and both sides are second-granular: a JWT's `iat` has
// no sub-second component, so a password_changed_at carrying microseconds would
// make a token minted in the same second reject itself. The cost is that a token
// issued within that same second survives the reset — an accepted one-second
// window.
//
// A lookup failure is treated as stale (fail closed): a deleted user must not
// keep transiting, and a database outage already breaks every request anyway.
func tokenIsStale(ctx context.Context, changedAt PasswordChangedAtFunc, userID uuid.UUID, issuedAt time.Time) bool {
	if changedAt == nil {
		return false
	}
	at, err := changedAt(ctx, userID)
	if err != nil {
		return true
	}
	if at.IsZero() {
		return false
	}
	return issuedAt.Before(at.Truncate(time.Second))
}

// Auth valida el JWT en el header Authorization y pone el userID en el contexto.
func Auth(secretKey string, changedAt PasswordChangedAtFunc) gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			abortUnauthorized(c)
			return
		}

		parts := strings.SplitN(authHeader, " ", 2)
		if len(parts) != 2 || parts[0] != "Bearer" {
			abortUnauthorized(c)
			return
		}

		userID, issuedAt, err := jwt.ValidateToken(parts[1], secretKey)
		if err != nil {
			abortUnauthorized(c)
			return
		}

		if tokenIsStale(c.Request.Context(), changedAt, userID, issuedAt) {
			abortSessionExpired(c)
			return
		}

		c.Set("userID", userID)
		c.Next()
	}
}

// OptionalAuth parses the JWT if present and sets the userID, but never aborts.
// Use it on public read endpoints that enrich their response for the viewer
// (e.g. liked_by_me) yet must remain readable by anonymous users. A missing,
// invalid or stale token simply leaves no userID in the context
// (getUserUUID → uuid.Nil).
func OptionalAuth(secretKey string, changedAt PasswordChangedAtFunc) gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			c.Next()
			return
		}

		parts := strings.SplitN(authHeader, " ", 2)
		if len(parts) != 2 || parts[0] != "Bearer" {
			c.Next()
			return
		}

		userID, issuedAt, err := jwt.ValidateToken(parts[1], secretKey)
		if err == nil && !tokenIsStale(c.Request.Context(), changedAt, userID, issuedAt) {
			c.Set("userID", userID)
		}
		c.Next()
	}
}
```

- [ ] **Step 4: Wire the lookup in the router**

In `backend/internal/app/router.go`, after `userRepo` is constructed and before the middlewares are used:

```go
	// One primary-key read per authenticated request. Accepted cost: it is what
	// makes a password reset actually terminate the attacker's live session.
	passwordChangedAt := func(ctx context.Context, userID uuid.UUID) (time.Time, error) {
		u, err := userRepo.GetByID(ctx, userID)
		if err != nil {
			return time.Time{}, err
		}
		if u.PasswordChangedAt == nil {
			return time.Time{}, nil
		}
		return *u.PasswordChangedAt, nil
	}
```

Then update every `middleware.Auth(cfg.JWTSecret)` to `middleware.Auth(cfg.JWTSecret, passwordChangedAt)` and every `middleware.OptionalAuth(cfg.JWTSecret)` to `middleware.OptionalAuth(cfg.JWTSecret, passwordChangedAt)`.

Find them all first: `cd backend && rg 'middleware\.(Auth|OptionalAuth)\(' internal/`

- [ ] **Step 5: Run and confirm they pass**

Run: `cd backend && go build ./... && go test ./tests/ -run 'TestAuth_|TestOptionalAuth_' -v`
Expected: all four PASS.

- [ ] **Step 6: Run the whole suite for regressions**

Run: `cd backend && go test ./... -count=1`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/internal/middleware/auth.go backend/internal/app/router.go backend/tests/auth_middleware_test.go
git commit -m "feat(auth): invalidar sesiones anteriores al cambio de contrasena

Auth y OptionalAuth rechazan tokens cuyo iat precede a
users.password_changed_at. OptionalAuth mantiene su contrato y no aborta:
ante un token viejo simplemente no setea el userID."
```

---

### Task 5: `Mailer.SendPasswordReset`

**Files:**
- Modify: `backend/pkg/mailer/mailer.go`
- Test: `backend/tests/mailer_password_reset_test.go` (create)

- [ ] **Step 1: Write the failing test**

Create `backend/tests/mailer_password_reset_test.go`:

```go
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
```

- [ ] **Step 2: Run and confirm it fails**

Run: `cd backend && go test ./tests/ -run TestSendPasswordReset -v`
Expected: compile error — `SendPasswordReset` undefined on `mailer.Mailer`.

- [ ] **Step 3: Extend the interface and implement it**

In `backend/pkg/mailer/mailer.go`, add to the `Mailer` interface:

```go
	// SendPasswordReset envía el OTP de recuperación de contraseña.
	// SECURITY: el parámetro code NUNCA debe ser logueado.
	SendPasswordReset(ctx context.Context, to, code string) error
```

Add the template after `otpHTMLTemplate`:

```go
// resetHTMLTemplate mirrors otpHTMLTemplate's email-safe structure (tables plus
// inline styles) and SearchPet's palette. It deliberately contains NO links:
// training users that our reset mail never asks for a click is the cheapest
// anti-phishing defence available. The only placeholder (%s) is the OTP code.
const resetHTMLTemplate = `<!DOCTYPE html>
<html lang="es">
<body style="margin:0;padding:0;background-color:#f4f5f7;">
  <table role="presentation" width="100%%" cellpadding="0" cellspacing="0" style="background-color:#f4f5f7;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%%" cellpadding="0" cellspacing="0" style="max-width:440px;background-color:#ffffff;border-radius:12px;overflow:hidden;">
          <tr>
            <td style="background-color:#FF6B35;padding:20px 32px;text-align:center;">
              <span style="font-family:Helvetica,Arial,sans-serif;font-size:22px;font-weight:bold;color:#ffffff;">&#128062; SearchPet</span>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;">
              <p style="margin:0 0 8px;font-family:Helvetica,Arial,sans-serif;font-size:18px;font-weight:bold;color:#1f2937;text-align:center;">
                Restablec&eacute; tu contrase&ntilde;a
              </p>
              <p style="margin:0 0 24px;font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#6b7280;text-align:center;">
                Ingres&aacute; este c&oacute;digo en SearchPet para elegir una nueva.
              </p>
              <table role="presentation" width="100%%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="background-color:#FFF1EB;border-radius:8px;padding:20px;">
                    <span style="font-family:Courier,monospace;font-size:34px;font-weight:bold;letter-spacing:8px;color:#E5551F;">%s</span>
                  </td>
                </tr>
              </table>
              <p style="margin:24px 0 0;font-family:Helvetica,Arial,sans-serif;font-size:13px;color:#6b7280;text-align:center;">
                Expira en 10 minutos. No lo compartas con nadie.
              </p>
              <p style="margin:16px 0 0;font-family:Helvetica,Arial,sans-serif;font-size:13px;color:#6b7280;text-align:center;">
                Al cambiarla vas a tener que volver a entrar en tus otros dispositivos.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 32px 24px;border-top:1px solid #f0f0f0;">
              <p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:12px;color:#9ca3af;text-align:center;">
                Si no pediste esto, ignor&aacute; este mail &mdash; tu contrase&ntilde;a no cambia.<br>
                Nunca te vamos a pedir que hagas clic en un enlace para recuperarla.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
```

Add the method on `brevoMailer` (mirroring `SendOTP`, changing subject, text and template):

```go
// SendPasswordReset envía el OTP de recuperación de contraseña.
// SECURITY: el código se incluye en el cuerpo del email pero NUNCA en los logs.
func (m *brevoMailer) SendPasswordReset(ctx context.Context, to, code string) error {
	escapedCode := html.EscapeString(code)
	payload := map[string]interface{}{
		"sender": map[string]string{
			"email": m.fromEmail,
			"name":  m.fromName,
		},
		"to": []map[string]string{
			{"email": to},
		},
		"subject": "Restablecer tu contraseña — SearchPet",
		"textContent": fmt.Sprintf(
			"Tu código para restablecer la contraseña es: %s\n\n"+
				"Expira en 10 minutos. No lo compartas con nadie.\n"+
				"Al cambiarla vas a tener que volver a entrar en tus otros dispositivos.\n\n"+
				"Si no pediste esto, ignorá este mail — tu contraseña no cambia.", code),
		"htmlContent": fmt.Sprintf(resetHTMLTemplate, escapedCode),
	}

	return m.post(ctx, payload)
}
```

Extract the shared transport out of `SendOTP` into `post`, and make `SendOTP` call it:

```go
// post marshals and delivers a Brevo payload. Shared by SendOTP and
// SendPasswordReset so the transport, error shape and status handling stay in
// one place.
func (m *brevoMailer) post(ctx context.Context, payload map[string]interface{}) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("mailer: marshal error: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, m.endpoint, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("mailer: request error: %w", err)
	}

	req.Header.Set("api-key", m.apiKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		// External failure → 502 upstream
		return fmt.Errorf("mailer: upstream error: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		// El body de error de Brevo distingue la causa ("Key not found",
		// "unrecognised IP address", sender no verificado) — sin él un 401
		// es indiagnosticable. Nunca contiene secretos ni el código OTP.
		errBody, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return fmt.Errorf("mailer: brevo returned status %d: %s", resp.StatusCode, strings.TrimSpace(string(errBody)))
	}

	return nil
}
```

And on `noopMailer`:

```go
func (n *noopMailer) SendPasswordReset(_ context.Context, _, _ string) error {
	return nil
}
```

- [ ] **Step 4: Check the structural-typing gotcha**

`sms.SMSSender` currently has a method set identical to the old `Mailer`. Adding a method may break any site that passes an SMS sender where a `Mailer` is expected.

Run: `cd backend && go build ./...`
Expected: no output. If it fails, the error names the exact site — fix by using the concrete type there.

- [ ] **Step 5: Run and confirm the tests pass**

Run: `cd backend && go test ./tests/ -run TestSendPasswordReset -v`
Expected: both PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/pkg/mailer/mailer.go backend/tests/mailer_password_reset_test.go
git commit -m "feat(mailer): agregar email de recuperacion de contrasena

Mismo esqueleto email-safe y paleta que el OTP de verificacion, sin ningun
link: entrenar al usuario a que nuestro mail de reset nunca pide un clic es
la defensa antiphishing mas barata que tenemos."
```

---

### Task 6: `PasswordResetService.RequestReset`

**Files:**
- Create: `backend/internal/service/password_reset_service.go`
- Modify: `backend/internal/service/interfaces.go`
- Test: `backend/tests/password_reset_service_test.go` (create)

**The enumeration guarantees ARE the feature.** They are tested as behaviour, not documented as intent.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/password_reset_service_test.go`:

```go
package tests

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/service"
)

// ============================================================
// Mocks specific to password reset (the shared ones in
// verification_service_test.go key on GetByID, this flow keys on GetByEmail).
// ============================================================

type resetUserRepo struct {
	byEmail  map[string]*domain.User
	updated  *domain.User
	updateErr error
}

func (r *resetUserRepo) Create(context.Context, *domain.User) error { return nil }
func (r *resetUserRepo) GetByID(context.Context, uuid.UUID) (*domain.User, error) {
	return nil, domain.ErrUserNotFound
}
func (r *resetUserRepo) GetByEmail(_ context.Context, email string) (*domain.User, error) {
	u, ok := r.byEmail[email]
	if !ok {
		return nil, domain.ErrUserNotFound
	}
	return u, nil
}
func (r *resetUserRepo) GetByGoogleID(context.Context, string) (*domain.User, error) {
	return nil, domain.ErrUserNotFound
}
func (r *resetUserRepo) Update(_ context.Context, u *domain.User) error {
	if r.updateErr != nil {
		return r.updateErr
	}
	r.updated = u
	return nil
}
func (r *resetUserRepo) Delete(context.Context, uuid.UUID) error { return nil }

type resetTokenRepo struct {
	active      *domain.VerificationToken
	created     []*domain.VerificationToken
	markedUsed  []uuid.UUID
	attempts    int
}

func (r *resetTokenRepo) Create(_ context.Context, t *domain.VerificationToken) error {
	t.ID = uuid.New()
	t.CreatedAt = time.Now()
	r.created = append(r.created, t)
	return nil
}
func (r *resetTokenRepo) FindActiveByUser(_ context.Context, _ uuid.UUID, channel string) (*domain.VerificationToken, error) {
	if r.active != nil && r.active.Channel == channel {
		return r.active, nil
	}
	return nil, nil
}
func (r *resetTokenRepo) MarkUsed(_ context.Context, id uuid.UUID) error {
	r.markedUsed = append(r.markedUsed, id)
	return nil
}
func (r *resetTokenRepo) IncrementAttempts(context.Context, uuid.UUID) (int, error) {
	r.attempts++
	return r.attempts, nil
}
func (r *resetTokenRepo) DeleteExpired(context.Context) (int64, error) { return 0, nil }

type recordingMailer struct {
	sentTo   string
	sentCode string
	err      error
}

func (m *recordingMailer) SendOTP(context.Context, string, string) error { return nil }
func (m *recordingMailer) SendPasswordReset(_ context.Context, to, code string) error {
	m.sentTo, m.sentCode = to, code
	return m.err
}

// newResetSvc builds the service with runAsync inlined so tests are deterministic.
func newResetSvc(users *resetUserRepo, tokens *resetTokenRepo, m *recordingMailer) service.PasswordResetService {
	return service.NewPasswordResetServiceForTest(tokens, users, m, func(f func()) { f() })
}

func knownUser(email string) *resetUserRepo {
	return &resetUserRepo{byEmail: map[string]*domain.User{
		email: {ID: uuid.New(), Email: email, PasswordHash: "old-hash"},
	}}
}

// ============================================================
// RequestReset — enumeration resistance
// ============================================================

func TestRequestReset_UnknownEmail_NoTokenNoMailNoError(t *testing.T) {
	users := &resetUserRepo{byEmail: map[string]*domain.User{}}
	tokens := &resetTokenRepo{}
	m := &recordingMailer{}

	if err := newResetSvc(users, tokens, m).RequestReset(context.Background(), "ghost@example.com"); err != nil {
		t.Fatalf("unknown email must not surface an error, got %v", err)
	}
	if len(tokens.created) != 0 {
		t.Fatal("no token may be created for an unknown address")
	}
	if m.sentTo != "" {
		t.Fatal("no mail may be sent to an unknown address")
	}
}

func TestRequestReset_BannedUser_NoTokenNoMailNoError(t *testing.T) {
	users := knownUser("banned@example.com")
	users.byEmail["banned@example.com"].IsBanned = true
	tokens := &resetTokenRepo{}
	m := &recordingMailer{}

	if err := newResetSvc(users, tokens, m).RequestReset(context.Background(), "banned@example.com"); err != nil {
		t.Fatalf("banned user must be indistinguishable from success, got %v", err)
	}
	if len(tokens.created) != 0 || m.sentTo != "" {
		t.Fatal("a banned user must produce neither a token nor a mail")
	}
}

func TestRequestReset_WithinCooldown_SwallowsRateLimit(t *testing.T) {
	users := knownUser("user@example.com")
	tokens := &resetTokenRepo{active: &domain.VerificationToken{
		ID:        uuid.New(),
		Channel:   "password_reset",
		CreatedAt: time.Now().Add(-10 * time.Second), // inside the 60s window
		ExpiresAt: time.Now().Add(9 * time.Minute),
	}}
	m := &recordingMailer{}

	// Surfacing the rate limit would leak existence: only real accounts can hit it.
	if err := newResetSvc(users, tokens, m).RequestReset(context.Background(), "user@example.com"); err != nil {
		t.Fatalf("cooldown must be swallowed, got %v", err)
	}
	if len(tokens.created) != 0 || m.sentTo != "" {
		t.Fatal("cooldown must suppress both the token and the mail")
	}
}

func TestRequestReset_HappyPath_CreatesTokenAndSends(t *testing.T) {
	users := knownUser("user@example.com")
	tokens := &resetTokenRepo{}
	m := &recordingMailer{}

	if err := newResetSvc(users, tokens, m).RequestReset(context.Background(), "user@example.com"); err != nil {
		t.Fatalf("RequestReset: %v", err)
	}
	if len(tokens.created) != 1 {
		t.Fatalf("created %d tokens, want 1", len(tokens.created))
	}
	tok := tokens.created[0]
	if tok.Channel != "password_reset" {
		t.Fatalf("channel = %q, want password_reset", tok.Channel)
	}
	if tok.CodeHash == "" || len(tok.CodeHash) != 64 {
		t.Fatalf("CodeHash = %q, want a 64-char sha256 hex", tok.CodeHash)
	}
	if m.sentTo != "user@example.com" {
		t.Fatalf("sentTo = %q", m.sentTo)
	}
	if len(m.sentCode) != 6 {
		t.Fatalf("sentCode = %q, want 6 digits", m.sentCode)
	}
	// The plaintext code must never be persisted.
	if tok.CodeHash == m.sentCode {
		t.Fatal("the token stores the plaintext code")
	}
}

func TestRequestReset_MailFailure_StillReturnsNilAndFreesTheCooldown(t *testing.T) {
	users := knownUser("user@example.com")
	tokens := &resetTokenRepo{}
	m := &recordingMailer{err: errors.New("brevo down")}

	// A 502 here would appear ONLY for addresses that exist.
	if err := newResetSvc(users, tokens, m).RequestReset(context.Background(), "user@example.com"); err != nil {
		t.Fatalf("mail failure must not reach the caller, got %v", err)
	}
	if len(tokens.markedUsed) != 1 {
		t.Fatal("a failed send must invalidate the token so the 60s cooldown does not block the retry")
	}
}
```

- [ ] **Step 2: Run and confirm they fail**

Run: `cd backend && go test ./tests/ -run TestRequestReset -v`
Expected: compile error — `service.PasswordResetService` and `NewPasswordResetServiceForTest` undefined.

- [ ] **Step 3: Add the interface**

In `backend/internal/service/interfaces.go`:

```go
// PasswordResetService recupera el acceso a una cuenta probando control del
// email con un OTP. Es anónimo: no hay sesión cuando arranca.
type PasswordResetService interface {
	// RequestReset envía un OTP al email si corresponde.
	//
	// SECURITY: devuelve nil para TODO resultado observable por el llamador —
	// email inexistente, usuario baneado, cooldown activo, fallo del mailer.
	// Cualquier diferencia visible convierte al endpoint en un oráculo de qué
	// direcciones están registradas. Solo un fallo de infraestructura
	// independiente del email (una caída de la base) devuelve error.
	RequestReset(ctx context.Context, email string) error

	// ConfirmReset valida el código y fija la contraseña nueva.
	//
	// SECURITY: devuelve domain.ErrOTPInvalid para código errado, token vencido,
	// ausencia de token y email inexistente por igual. Distinguir el vencimiento
	// del código errado permitiría sondear qué cuentas existen.
	ConfirmReset(ctx context.Context, email, code, newPassword string) error
}
```

- [ ] **Step 4: Implement `RequestReset`**

Create `backend/internal/service/password_reset_service.go`:

```go
package service

import (
	"context"
	"errors"
	"log"
	"time"

	"golang.org/x/crypto/bcrypt"
	"lost-pets/internal/domain"
	"lost-pets/internal/repository"
	"lost-pets/pkg/mailer"
)

// ChannelPasswordReset scopes reset tokens inside the shared verification_tokens
// table. FindActiveByUser filters on it, so a token minted to verify an email can
// never be spent on a reset, nor the other way round.
const ChannelPasswordReset = "password_reset"

type passwordResetService struct {
	tokenRepo repository.VerificationTokenRepository
	userRepo  repository.UserRepository
	mailer    mailer.Mailer
	// runAsync detaches the mail send from the request. This is not a latency
	// optimisation, it is the enumeration defence: a synchronous Brevo round trip
	// makes a registered address take ~300-500ms against ~5ms for an unknown one,
	// which is trivially measurable. Tests run it inline for determinism.
	runAsync func(func())
}

// NewPasswordResetService construye el servicio con sus dependencias.
func NewPasswordResetService(
	tokenRepo repository.VerificationTokenRepository,
	userRepo repository.UserRepository,
	m mailer.Mailer,
) PasswordResetService {
	return &passwordResetService{
		tokenRepo: tokenRepo,
		userRepo:  userRepo,
		mailer:    m,
		runAsync:  func(f func()) { go f() },
	}
}

// NewPasswordResetServiceForTest injects runAsync so tests observe the send
// synchronously. Not for production wiring.
func NewPasswordResetServiceForTest(
	tokenRepo repository.VerificationTokenRepository,
	userRepo repository.UserRepository,
	m mailer.Mailer,
	runAsync func(func()),
) PasswordResetService {
	return &passwordResetService{tokenRepo: tokenRepo, userRepo: userRepo, mailer: m, runAsync: runAsync}
}

func (s *passwordResetService) RequestReset(ctx context.Context, email string) error {
	// GetByEmail matches case-insensitively (idx_users_email_lower, migration
	// 000019), so an account registered as Carlos@Example.com is reachable here.
	user, err := s.userRepo.GetByEmail(ctx, email)
	if err != nil {
		if errors.Is(err, domain.ErrUserNotFound) {
			return nil // indistinguishable from success, by design
		}
		// A database failure is independent of whether the address exists, so
		// surfacing it leaks nothing.
		return err
	}

	if user.IsBanned {
		return nil
	}

	existing, err := s.tokenRepo.FindActiveByUser(ctx, user.ID, ChannelPasswordReset)
	if err != nil {
		return err
	}
	if existing != nil && time.Since(existing.CreatedAt) < otpRateLimit {
		// Only a real account can be rate-limited, so the cooldown is swallowed.
		// Abuse is bounded by the per-IP rate limit middleware, which cannot tell
		// accounts apart and therefore cannot leak.
		return nil
	}

	// SECURITY: NUNCA loguear el código en texto plano.
	code, err := generateOTPCode()
	if err != nil {
		return err
	}

	token := &domain.VerificationToken{
		UserID:    user.ID,
		Channel:   ChannelPasswordReset,
		CodeHash:  hashOTPCode(code),
		Attempts:  0,
		ExpiresAt: time.Now().Add(otpTTL),
		Used:      false,
	}
	if err := s.tokenRepo.Create(ctx, token); err != nil {
		return err
	}

	userID, to, tokenID := user.ID, user.Email, token.ID
	s.runAsync(func() {
		// Detached: the HTTP request is already answered, so ctx may be cancelled.
		bg := context.Background()
		if sendErr := s.mailer.SendPasswordReset(bg, to, code); sendErr != nil {
			// SECURITY: sendErr carries the provider status, never the code.
			log.Printf("[password_reset] send failed for user %s: %v", userID, sendErr)
			// Free the cooldown: leaving the token active would block a retry for
			// 60s even though the user never received anything.
			if muErr := s.tokenRepo.MarkUsed(bg, tokenID); muErr != nil {
				log.Printf("[password_reset] failed to invalidate token after send failure: %v", muErr)
			}
		}
	})

	return nil
}
```

- [ ] **Step 5: Run and confirm they pass**

Run: `cd backend && go test ./tests/ -run TestRequestReset -v`
Expected: all five PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/internal/service/password_reset_service.go backend/internal/service/interfaces.go backend/tests/password_reset_service_test.go
git commit -m "feat(auth): PasswordResetService.RequestReset resistente a enumeracion

Email inexistente, usuario baneado, cooldown y fallo del mailer devuelven
todos nil. El envio va async: sincrono, el round trip a Brevo hace que una
direccion registrada tarde ~300-500ms contra ~5ms de una desconocida, que es
un oraculo medible con un cronometro."
```

---

### Task 7: `PasswordResetService.ConfirmReset`

**Files:**
- Modify: `backend/internal/service/password_reset_service.go`
- Test: `backend/tests/password_reset_service_test.go` (append)

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/password_reset_service_test.go`:

```go
// ============================================================
// ConfirmReset — every failure collapses into one error
// ============================================================

// activeResetToken builds a live password_reset token whose code is `code`.
func activeResetToken(code string) *domain.VerificationToken {
	return &domain.VerificationToken{
		ID:        uuid.New(),
		Channel:   "password_reset",
		CodeHash:  hashCode(code), // helper from verification_service_test.go
		ExpiresAt: time.Now().Add(10 * time.Minute),
		CreatedAt: time.Now(),
	}
}

func TestConfirmReset_AllFailuresReturnTheSameError(t *testing.T) {
	cases := []struct {
		name   string
		users  *resetUserRepo
		tokens *resetTokenRepo
		email  string
		code   string
	}{
		{
			name:   "wrong code",
			users:  knownUser("user@example.com"),
			tokens: &resetTokenRepo{active: activeResetToken("111111")},
			email:  "user@example.com",
			code:   "999999",
		},
		{
			name:  "expired token",
			users: knownUser("user@example.com"),
			tokens: func() *resetTokenRepo {
				tok := activeResetToken("111111")
				tok.ExpiresAt = time.Now().Add(-time.Minute)
				return &resetTokenRepo{active: tok}
			}(),
			email: "user@example.com",
			code:  "111111",
		},
		{
			name:   "no active token",
			users:  knownUser("user@example.com"),
			tokens: &resetTokenRepo{},
			email:  "user@example.com",
			code:   "111111",
		},
		{
			name:   "unknown email",
			users:  &resetUserRepo{byEmail: map[string]*domain.User{}},
			tokens: &resetTokenRepo{active: activeResetToken("111111")},
			email:  "ghost@example.com",
			code:   "111111",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			svc := newResetSvc(tc.users, tc.tokens, &recordingMailer{})
			err := svc.ConfirmReset(context.Background(), tc.email, tc.code, "newpassword")

			// Distinguishing these lets an attacker probe which accounts exist:
			// request a reset, wait past the TTL, submit garbage — an "expired"
			// answer proves the address is registered.
			if !errors.Is(err, domain.ErrOTPInvalid) {
				t.Fatalf("err = %v, want domain.ErrOTPInvalid for every failure mode", err)
			}
			if tc.users.updated != nil {
				t.Fatal("no password may be written on a failed reset")
			}
		})
	}
}

func TestConfirmReset_SixthAttemptInvalidatesTheToken(t *testing.T) {
	users := knownUser("user@example.com")
	tokens := &resetTokenRepo{active: activeResetToken("111111"), attempts: 5}
	svc := newResetSvc(users, tokens, &recordingMailer{})

	// Even with the RIGHT code: the cap has been spent.
	err := svc.ConfirmReset(context.Background(), "user@example.com", "111111", "newpassword")

	if !errors.Is(err, domain.ErrOTPInvalid) {
		t.Fatalf("err = %v, want domain.ErrOTPInvalid", err)
	}
	if len(tokens.markedUsed) != 1 {
		t.Fatal("exceeding the attempt cap must invalidate the token")
	}
}

func TestConfirmReset_HappyPath_SetsHashAndStampsPasswordChangedAt(t *testing.T) {
	users := knownUser("user@example.com")
	tokens := &resetTokenRepo{active: activeResetToken("111111")}
	svc := newResetSvc(users, tokens, &recordingMailer{})

	before := time.Now().Add(-time.Second)
	if err := svc.ConfirmReset(context.Background(), "user@example.com", "111111", "newpassword"); err != nil {
		t.Fatalf("ConfirmReset: %v", err)
	}

	got := users.updated
	if got == nil {
		t.Fatal("the user was never updated")
	}
	if got.PasswordHash == "old-hash" {
		t.Fatal("the password hash was not replaced")
	}
	if err := bcrypt.CompareHashAndPassword([]byte(got.PasswordHash), []byte("newpassword")); err != nil {
		t.Fatalf("the stored hash does not match the new password: %v", err)
	}
	if got.PasswordChangedAt == nil {
		t.Fatal("PasswordChangedAt was not stamped — sessions would survive the reset")
	}
	if got.PasswordChangedAt.Before(before) {
		t.Fatalf("PasswordChangedAt = %v, want roughly now", got.PasswordChangedAt)
	}
	// Truncation matters: a JWT's iat has second granularity, so a sub-second
	// value here would make a freshly issued token reject itself.
	if got.PasswordChangedAt.Nanosecond() != 0 {
		t.Fatalf("PasswordChangedAt = %v, want it truncated to the second", got.PasswordChangedAt)
	}
	if len(tokens.markedUsed) != 1 {
		t.Fatal("the token must be single-use")
	}
}

func TestConfirmReset_GoogleOnlyUserGetsAPassword(t *testing.T) {
	// The case that motivated the whole feature: LoginWithGoogle discards the
	// hash when linking an unverified account (rule #25), leaving the legitimate
	// owner Google-only with no way back.
	users := knownUser("user@example.com")
	users.byEmail["user@example.com"].PasswordHash = ""
	tokens := &resetTokenRepo{active: activeResetToken("111111")}
	svc := newResetSvc(users, tokens, &recordingMailer{})

	if err := svc.ConfirmReset(context.Background(), "user@example.com", "111111", "newpassword"); err != nil {
		t.Fatalf("ConfirmReset: %v", err)
	}
	if users.updated == nil || users.updated.PasswordHash == "" {
		t.Fatal("a Google-only account must come out of this with a usable password")
	}
}

func TestConfirmReset_RejectsATokenFromAnotherChannel(t *testing.T) {
	users := knownUser("user@example.com")
	// An email-verification token must never be spendable on a reset.
	tok := activeResetToken("111111")
	tok.Channel = "email"
	tokens := &resetTokenRepo{active: tok}
	svc := newResetSvc(users, tokens, &recordingMailer{})

	err := svc.ConfirmReset(context.Background(), "user@example.com", "111111", "newpassword")
	if !errors.Is(err, domain.ErrOTPInvalid) {
		t.Fatalf("err = %v, want domain.ErrOTPInvalid", err)
	}
}
```

Add `"golang.org/x/crypto/bcrypt"` to the test file's imports.

- [ ] **Step 2: Run and confirm they fail**

Run: `cd backend && go test ./tests/ -run TestConfirmReset -v`
Expected: compile error — `ConfirmReset` not implemented on the concrete type.

- [ ] **Step 3: Implement**

Append to `backend/internal/service/password_reset_service.go`:

```go
func (s *passwordResetService) ConfirmReset(ctx context.Context, email, code, newPassword string) error {
	// SECURITY: every failure below returns domain.ErrOTPInvalid. Telling an
	// expired token apart from a wrong code (or from an unknown address) turns
	// this endpoint into an oracle for which accounts exist.
	user, err := s.userRepo.GetByEmail(ctx, email)
	if err != nil {
		if errors.Is(err, domain.ErrUserNotFound) {
			return domain.ErrOTPInvalid
		}
		return err
	}
	if user.IsBanned {
		return domain.ErrOTPInvalid
	}

	token, err := s.tokenRepo.FindActiveByUser(ctx, user.ID, ChannelPasswordReset)
	if err != nil {
		return err
	}
	if token == nil || time.Now().After(token.ExpiresAt) {
		return domain.ErrOTPInvalid
	}

	attempts, err := s.tokenRepo.IncrementAttempts(ctx, token.ID)
	if err != nil {
		return err
	}
	if attempts > otpMaxAttempts {
		_ = s.tokenRepo.MarkUsed(ctx, token.ID)
		return domain.ErrOTPInvalid
	}

	// Constant-time comparison: with only 5 attempts a prefix-timing attack is
	// impractical anyway, but the guarantee costs one line.
	if subtle.ConstantTimeCompare([]byte(hashOTPCode(code)), []byte(token.CodeHash)) != 1 {
		return domain.ErrOTPInvalid
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(newPassword), bcrypt.DefaultCost)
	if err != nil {
		return domain.ErrInternal
	}

	if err := s.tokenRepo.MarkUsed(ctx, token.ID); err != nil {
		return err
	}

	// Truncated to the second: a JWT's `iat` has no sub-second component, so a
	// microsecond-precision value here would make a token issued immediately
	// after the reset reject itself.
	changedAt := time.Now().Truncate(time.Second)
	user.PasswordHash = string(hash)
	user.PasswordChangedAt = &changedAt

	return s.userRepo.Update(ctx, user)
}
```

Add `"crypto/subtle"` to the file's imports.

- [ ] **Step 4: Run and confirm they pass**

Run: `cd backend && go test ./tests/ -run 'TestConfirmReset|TestRequestReset' -v`
Expected: all PASS, including the four subtests of `TestConfirmReset_AllFailuresReturnTheSameError`.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/service/password_reset_service.go backend/tests/password_reset_service_test.go
git commit -m "feat(auth): PasswordResetService.ConfirmReset

Codigo errado, token vencido, token ausente y email inexistente devuelven
todos ErrOTPInvalid. Sella password_changed_at truncado al segundo para que
un token recien emitido no se rechace a si mismo."
```

---

### Task 8: `LoginWithGoogle` stamps `password_changed_at`

**Files:**
- Modify: `backend/internal/service/auth_service.go` (the branch of `LoginWithGoogle` that discards `PasswordHash`)
- Test: `backend/internal/service/auth_google_test.go` (append)

**Why:** rule #25 discards the stored password when linking an account whose email was never verified, because an attacker may have planted it. But it currently leaves any session that attacker already holds alive — we take their password and let them stay logged in.

- [ ] **Step 1: Read the current linking branch**

Run: `cd backend && rg -n 'PasswordHash' internal/service/auth_service.go`
Locate the assignment that clears it inside `LoginWithGoogle`.

- [ ] **Step 2: Write the failing test**

Append to `backend/internal/service/auth_google_test.go`, matching the existing helpers in that file (`newGoogleAuthSvc`, `googleTestSecret`):

```go
func TestLoginWithGoogle_LinkingUnverifiedAccountKillsExistingSessions(t *testing.T) {
	// Linking discards the planted password (rule #25). It must also terminate
	// the session the planter may already be holding.
	svc, repo := newGoogleAuthSvcWithUser(t, &domain.User{
		ID:            uuid.New(),
		Email:         "victim@example.com",
		PasswordHash:  "planted-hash",
		EmailVerified: false,
	})

	if _, _, _, err := svc.LoginWithGoogle(context.Background(), "valid-token"); err != nil {
		t.Fatalf("LoginWithGoogle: %v", err)
	}

	got := repo.lastUpdated()
	if got.PasswordHash != "" {
		t.Fatal("the planted password must be discarded")
	}
	if got.PasswordChangedAt == nil {
		t.Fatal("PasswordChangedAt must be stamped, or the planter's live session survives")
	}
	if got.PasswordChangedAt.Nanosecond() != 0 {
		t.Fatalf("PasswordChangedAt = %v, want it truncated to the second", got.PasswordChangedAt)
	}
}
```

Adapt `newGoogleAuthSvcWithUser` / `repo.lastUpdated()` to whatever the existing fixtures in that file are named — read the file first and reuse them rather than adding parallel helpers.

- [ ] **Step 3: Run and confirm it fails**

Run: `cd backend && go test ./internal/service/ -run TestLoginWithGoogle_LinkingUnverifiedAccountKillsExistingSessions -v`
Expected: FAIL — `PasswordChangedAt` is nil.

- [ ] **Step 4: Implement**

Where `LoginWithGoogle` clears the hash, add alongside it:

```go
		// Discarding the password is only half the defence: the planter may
		// already hold a live JWT. Stamping this terminates it (see the
		// freshness check in middleware.Auth).
		discardedAt := time.Now().Truncate(time.Second)
		user.PasswordHash = ""
		user.PasswordChangedAt = &discardedAt
```

- [ ] **Step 5: Run and confirm it passes**

Run: `cd backend && go test ./internal/service/ -v`
Expected: PASS, no regressions in the other Google tests.

- [ ] **Step 6: Commit**

```bash
git add backend/internal/service/auth_service.go backend/internal/service/auth_google_test.go
git commit -m "fix(auth): vincular una cuenta no verificada corta las sesiones vivas

Descartar el password plantado era media defensa: si el atacante ya tenia
sesion abierta, le sacabamos la contrasena y lo dejabamos adentro."
```

---

### Task 9: DTOs, handler and routes

**Files:**
- Modify: `backend/internal/dto/auth_dto.go`
- Create: `backend/internal/handler/password_reset_handler.go`
- Modify: `backend/internal/app/router.go`

- [ ] **Step 1: Add the DTOs**

In `backend/internal/dto/auth_dto.go`, after `GoogleAuthResponse`:

```go
// ForgotPasswordRequest inicia la recuperación de contraseña.
type ForgotPasswordRequest struct {
	Email string `json:"email" binding:"required,email"`
}

// ResetPasswordRequest completa la recuperación con el OTP recibido por email.
// min=6 iguala a RegisterRequest a propósito: exigir más en la recuperación que
// en el alta sería incoherente.
type ResetPasswordRequest struct {
	Email       string `json:"email" binding:"required,email"`
	Code        string `json:"code" binding:"required"`
	NewPassword string `json:"new_password" binding:"required,min=6"`
}
```

- [ ] **Step 2: Write the handler**

Create `backend/internal/handler/password_reset_handler.go`:

```go
package handler

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"lost-pets/internal/domain"
	"lost-pets/internal/dto"
	"lost-pets/internal/service"
)

// forgotPasswordMessage is fixed. Deriving anything in the response from whether
// the address exists would undo the service-level enumeration defence.
const forgotPasswordMessage = "Si el email está registrado, te enviamos un código."

// PasswordResetHandler expone la recuperación de contraseña. Ambas rutas son
// públicas: por definición el usuario no puede iniciar sesión.
type PasswordResetHandler struct {
	passwordResetService service.PasswordResetService
}

func NewPasswordResetHandler(s service.PasswordResetService) *PasswordResetHandler {
	return &PasswordResetHandler{passwordResetService: s}
}

// ForgotPassword godoc
// POST /api/auth/password/forgot
//
// SECURITY: responde 200 con un cuerpo fijo para email existente, inexistente,
// baneado, en cooldown o con el mailer caído. Un 502 acá aparecería SOLO para
// direcciones reales.
func (h *PasswordResetHandler) ForgotPassword(c *gin.Context) {
	var req dto.ForgotPasswordRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, domain.ErrBindingFailed)
		return
	}

	if err := h.passwordResetService.RequestReset(c.Request.Context(), req.Email); err != nil {
		// Only reachable on infrastructure failure, which is independent of
		// whether the address exists.
		writeError(c, http.StatusInternalServerError, domain.ErrInternal)
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": forgotPasswordMessage})
}

// ResetPassword godoc
// POST /api/auth/password/reset
//
// SECURITY: no auto-login. El usuario entra con su contraseña nueva, lo que de
// paso confirma que quedó bien.
func (h *PasswordResetHandler) ResetPassword(c *gin.Context) {
	var req dto.ResetPasswordRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, domain.ErrBindingFailed)
		return
	}

	err := h.passwordResetService.ConfirmReset(c.Request.Context(), req.Email, req.Code, req.NewPassword)
	if err != nil {
		if errors.Is(err, domain.ErrOTPInvalid) {
			writeError(c, http.StatusBadRequest, err)
			return
		}
		writeError(c, http.StatusInternalServerError, domain.ErrInternal)
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "contraseña actualizada"})
}
```

- [ ] **Step 3: Wire it**

In `router.go`, next to the other service constructions (near `verificationService`, after `mailerClient` exists):

```go
	passwordResetService := service.NewPasswordResetService(verificationTokenRepo, userRepo, mailerClient)
	passwordResetHandler := handler.NewPasswordResetHandler(passwordResetService)
```

In the public group, next to the other auth routes:

```go
		// Same rate limit as login/register: it is an authentication gate, and
		// the per-IP limit is what bounds abuse now that the service swallows
		// the per-user cooldown.
		public.POST("/auth/password/forgot", authRateLimit, passwordResetHandler.ForgotPassword)
		public.POST("/auth/password/reset", authRateLimit, passwordResetHandler.ResetPassword)
```

- [ ] **Step 4: Verify the request logger does not dump the body**

The `/reset` body carries the new password in plaintext.

Run: `cd backend && rg -n 'Body|ReadAll' internal/middleware/cors.go`
Expected: no body reading in the logger. If it does read bodies, exclude `/auth/password/reset` and note it in the commit.

- [ ] **Step 5: Build and run everything**

Run: `cd backend && go build ./... && go test ./... -count=1`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/internal/dto/auth_dto.go backend/internal/handler/password_reset_handler.go backend/internal/app/router.go
git commit -m "feat(auth): endpoints POST /api/auth/password/{forgot,reset}"
```

---

### Task 10: Handler-level status and code table

**Files:**
- Test: `backend/tests/password_reset_handler_test.go` (create)

- [ ] **Step 1: Write the tests**

Create `backend/tests/password_reset_handler_test.go`:

```go
package tests

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"lost-pets/internal/domain"
	"lost-pets/internal/handler"
)

type stubResetSvc struct {
	requestErr error
	confirmErr error
}

func (s *stubResetSvc) RequestReset(context.Context, string) error { return s.requestErr }
func (s *stubResetSvc) ConfirmReset(context.Context, string, string, string) error {
	return s.confirmErr
}

func postJSON(t *testing.T, h gin.HandlerFunc, path string, body any) *httptest.ResponseRecorder {
	t.Helper()
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.POST(path, h)

	raw, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, path, bytes.NewReader(raw))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func codeOf(t *testing.T, w *httptest.ResponseRecorder) string {
	t.Helper()
	var body struct {
		Code string `json:"code"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("unmarshal %s: %v", w.Body.String(), err)
	}
	return body.Code
}

func TestForgotPassword_IdenticalResponseForRealAndFakeAddress(t *testing.T) {
	h := handler.NewPasswordResetHandler(&stubResetSvc{})

	real := postJSON(t, h.ForgotPassword, "/forgot", map[string]string{"email": "user@example.com"})
	fake := postJSON(t, h.ForgotPassword, "/forgot", map[string]string{"email": "ghost@example.com"})

	if real.Code != http.StatusOK || fake.Code != http.StatusOK {
		t.Fatalf("statuses = %d and %d, want 200 for both", real.Code, fake.Code)
	}
	if real.Body.String() != fake.Body.String() {
		t.Fatalf("bodies differ:\n real: %s\n fake: %s", real.Body.String(), fake.Body.String())
	}
}

func TestForgotPassword_MalformedEmailIs400(t *testing.T) {
	h := handler.NewPasswordResetHandler(&stubResetSvc{})
	w := postJSON(t, h.ForgotPassword, "/forgot", map[string]string{"email": "not-an-email"})

	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", w.Code)
	}
}

func TestResetPassword_InvalidOTPIs400WithOtpInvalid(t *testing.T) {
	h := handler.NewPasswordResetHandler(&stubResetSvc{confirmErr: domain.ErrOTPInvalid})
	w := postJSON(t, h.ResetPassword, "/reset", map[string]string{
		"email": "user@example.com", "code": "000000", "new_password": "newpassword",
	})

	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", w.Code)
	}
	if got := codeOf(t, w); got != "otp_invalid" {
		t.Fatalf("code = %q, want otp_invalid", got)
	}
}

func TestResetPassword_ShortPasswordIs400(t *testing.T) {
	h := handler.NewPasswordResetHandler(&stubResetSvc{})
	w := postJSON(t, h.ResetPassword, "/reset", map[string]string{
		"email": "user@example.com", "code": "123456", "new_password": "12345",
	})

	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", w.Code)
	}
}

func TestResetPassword_HappyPathIs200(t *testing.T) {
	h := handler.NewPasswordResetHandler(&stubResetSvc{})
	w := postJSON(t, h.ResetPassword, "/reset", map[string]string{
		"email": "user@example.com", "code": "123456", "new_password": "newpassword",
	})

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}
}
```

- [ ] **Step 2: Run them**

Run: `cd backend && go test ./tests/ -run 'TestForgotPassword|TestResetPassword' -v`
Expected: all PASS.

- [ ] **Step 3: Commit**

```bash
git add backend/tests/password_reset_handler_test.go
git commit -m "test(auth): tabla de status y codigos de recuperacion de contrasena"
```

---

### Task 11: Shared API client

**Files:**
- Modify: `frontend/packages/shared/api/client.ts`
- Test: `frontend/packages/shared/api/client.test.ts` (append if it exists, otherwise skip the test and rely on Task 13's page tests)

- [ ] **Step 1: Add the two methods**

In `client.ts`, next to `login` / `register` / `loginWithGoogle`, following the exact call idiom used by its neighbours:

```ts
  /**
   * Always resolves for a well-formed email, whether or not the account exists —
   * the backend answers 200 either way so the endpoint cannot be used to probe
   * which addresses are registered. Do not treat resolution as "the email exists".
   */
  async forgotPassword(email: string): Promise<{ message: string }> {
    return this.request('/auth/password/forgot', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  }

  /**
   * Rejects with code `otp_invalid` for a wrong code, an expired one, or an
   * unknown address alike. Surface one message covering both real cases.
   */
  async resetPassword(email: string, code: string, newPassword: string): Promise<{ message: string }> {
    return this.request('/auth/password/reset', {
      method: 'POST',
      body: JSON.stringify({ email, code, new_password: newPassword }),
    });
  }
```

Match the surrounding method style exactly — if neighbours use a `this.post(...)` helper rather than `this.request(...)`, use that.

- [ ] **Step 2: Typecheck**

Run: `cd frontend/packages/web && pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/packages/shared/api/client.ts
git commit -m "feat(shared): metodos de cliente para recuperacion de contrasena"
```

---

### Task 12: i18n keys

**Files:**
- Modify: `frontend/packages/shared/i18n/locales/{es,en,pt}.json` (the `auth` and `errors` namespaces — confirm the exact path with `fd -e json . frontend/packages/shared | rg locales`)
- Modify the mobile locale files if mobile keeps its own copies.

- [ ] **Step 1: Add the `auth` keys to all three languages**

Spanish (`es`), under `auth`:

```json
"forgotPassword": {
  "link": "¿Olvidaste tu contraseña?",
  "title": "Recuperar contraseña",
  "emailStepDescription": "Te enviamos un código de 6 dígitos para que elijas una contraseña nueva.",
  "email": "Email",
  "sendCode": "Enviar código",
  "codeStepDescription": "Si el email está registrado, te enviamos un código. Revisá tu casilla y el spam.",
  "code": "Código de 6 dígitos",
  "newPassword": "Contraseña nueva",
  "submit": "Cambiar contraseña",
  "sessionsWarning": "Al cambiarla vas a tener que volver a entrar en tus otros dispositivos.",
  "success": "Listo. Entrá con tu contraseña nueva.",
  "backToLogin": "Volver al inicio de sesión"
}
```

English (`en`):

```json
"forgotPassword": {
  "link": "Forgot your password?",
  "title": "Reset password",
  "emailStepDescription": "We'll send you a 6-digit code so you can choose a new password.",
  "email": "Email",
  "sendCode": "Send code",
  "codeStepDescription": "If the email is registered, we sent a code. Check your inbox and spam folder.",
  "code": "6-digit code",
  "newPassword": "New password",
  "submit": "Change password",
  "sessionsWarning": "Changing it will sign you out on your other devices.",
  "success": "Done. Sign in with your new password.",
  "backToLogin": "Back to sign in"
}
```

Portuguese (`pt`):

```json
"forgotPassword": {
  "link": "Esqueceu sua senha?",
  "title": "Recuperar senha",
  "emailStepDescription": "Enviamos um código de 6 dígitos para você escolher uma nova senha.",
  "email": "Email",
  "sendCode": "Enviar código",
  "codeStepDescription": "Se o email estiver cadastrado, enviamos um código. Verifique sua caixa de entrada e o spam.",
  "code": "Código de 6 dígitos",
  "newPassword": "Nova senha",
  "submit": "Alterar senha",
  "sessionsWarning": "Ao alterá-la, você precisará entrar novamente nos seus outros dispositivos.",
  "success": "Pronto. Entre com sua nova senha.",
  "backToLogin": "Voltar para o login"
}
```

- [ ] **Step 2: Add the two error codes to the `errors` namespace**

`es`:

```json
"otp_invalid": "El código es inválido o venció. Pedí uno nuevo.",
"session_expired": "Tu sesión expiró. Volvé a iniciar sesión."
```

`en`:

```json
"otp_invalid": "That code is invalid or has expired. Request a new one.",
"session_expired": "Your session expired. Please sign in again."
```

`pt`:

```json
"otp_invalid": "O código é inválido ou expirou. Solicite um novo.",
"session_expired": "Sua sessão expirou. Entre novamente."
```

If `otp_invalid` already exists, **replace** its message with the wording above — it must cover the expired case too, because the backend no longer distinguishes them.

- [ ] **Step 3: Confirm the namespaces are registered**

Run: `cd frontend/packages/web && rg -n 'auth:|errors:' src/i18n/index.ts`
Expected: both appear in the `es`, `en` and `pt` blocks (rule #21). They already do — this is a guard against regression.

- [ ] **Step 4: Commit**

```bash
git add frontend/packages/shared/i18n frontend/packages/mobile
git commit -m "feat(i18n): textos de recuperacion de contrasena en es/en/pt"
```

---

### Task 13: Web — `ForgotPasswordPage`

**Files:**
- Create: `frontend/packages/web/src/pages/ForgotPasswordPage.tsx`
- Modify: `frontend/packages/web/src/App.tsx` (route)
- Modify: `frontend/packages/web/src/pages/LoginPage.tsx` (link)
- Modify: the web API-error handling path (401 `session_expired` → clear token, go to login)
- Test: `frontend/packages/web/src/pages/ForgotPasswordPage.test.tsx` (create)

**One route, two internal steps.** Not two routes: the email would land in a query parameter, and from there in browser history and any intermediate log.

- [ ] **Step 1: Write the failing test**

Create `frontend/packages/web/src/pages/ForgotPasswordPage.test.tsx`, following the mocking style of the existing page tests in that directory:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ForgotPasswordPage } from './ForgotPasswordPage';

const forgotPassword = vi.fn();
const resetPassword = vi.fn();

vi.mock('@shared/api/client', () => ({
  apiClient: {
    forgotPassword: (...a: unknown[]) => forgotPassword(...a),
    resetPassword: (...a: unknown[]) => resetPassword(...a),
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

const renderPage = () =>
  render(
    <MemoryRouter>
      <ForgotPasswordPage />
    </MemoryRouter>,
  );

beforeEach(() => {
  forgotPassword.mockReset().mockResolvedValue({ message: 'ok' });
  resetPassword.mockReset().mockResolvedValue({ message: 'ok' });
});

describe('ForgotPasswordPage', () => {
  it('moves to the code step after requesting one', async () => {
    renderPage();

    fireEvent.change(screen.getByLabelText('forgotPassword.email'), {
      target: { value: 'user@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'forgotPassword.sendCode' }));

    await waitFor(() => expect(forgotPassword).toHaveBeenCalledWith('user@example.com'));
    expect(await screen.findByLabelText('forgotPassword.code')).toBeInTheDocument();
  });

  it('advances even for an address that does not exist', async () => {
    // The backend answers 200 either way. Branching here would rebuild, in the
    // client, the enumeration oracle the backend deliberately closed.
    renderPage();

    fireEvent.change(screen.getByLabelText('forgotPassword.email'), {
      target: { value: 'ghost@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'forgotPassword.sendCode' }));

    expect(await screen.findByLabelText('forgotPassword.code')).toBeInTheDocument();
  });

  it('submits the code and the new password together', async () => {
    renderPage();

    fireEvent.change(screen.getByLabelText('forgotPassword.email'), {
      target: { value: 'user@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'forgotPassword.sendCode' }));

    fireEvent.change(await screen.findByLabelText('forgotPassword.code'), {
      target: { value: '123456' },
    });
    fireEvent.change(screen.getByLabelText('forgotPassword.newPassword'), {
      target: { value: 'newpassword' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'forgotPassword.submit' }));

    await waitFor(() =>
      expect(resetPassword).toHaveBeenCalledWith('user@example.com', '123456', 'newpassword'),
    );
  });
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `cd frontend/packages/web && pnpm vitest run src/pages/ForgotPasswordPage.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the page**

Create `frontend/packages/web/src/pages/ForgotPasswordPage.tsx`:

```tsx
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@shared/api/client';
import { getErrorMessage } from '@shared/utils/apiErrors';

type Step = 'email' | 'code';

export function ForgotPasswordPage() {
  const { t } = useTranslation(['auth', 'common', 'errors']);
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const inputClass =
    'w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary';
  const labelClass = 'block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1';

  const handleRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await apiClient.forgotPassword(email.trim());
      // Always advance. The backend answers 200 whether or not the address is
      // registered; branching here would rebuild the enumeration oracle in the
      // client that the backend deliberately closed.
      setStep('code');
    } catch (err) {
      setError(getErrorMessage(err, t));
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await apiClient.resetPassword(email.trim(), code.trim(), newPassword);
      navigate('/login', { state: { notice: t('auth:forgotPassword.success') } });
    } catch (err) {
      setError(getErrorMessage(err, t));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-md mx-auto px-4 py-12">
      <div className="bg-white dark:bg-gray-900 rounded-2xl p-8 space-y-5">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-50 text-center">
          {t('auth:forgotPassword.title')}
        </h1>

        {step === 'email' ? (
          <form onSubmit={handleRequest} noValidate className="space-y-4">
            <p className="text-sm text-gray-500 dark:text-gray-400 text-center">
              {t('auth:forgotPassword.emailStepDescription')}
            </p>
            <div>
              <label htmlFor="forgot-email" className={labelClass}>
                {t('auth:forgotPassword.email')}
              </label>
              <input
                id="forgot-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputClass}
              />
            </div>
            {error && <p className="text-red-500 dark:text-red-400 text-sm">{error}</p>}
            <button
              type="submit"
              disabled={loading || !email.trim()}
              className="w-full bg-primary hover:bg-primary-dark disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold rounded-lg px-4 py-2 transition-colors"
            >
              {loading ? t('common:loading') : t('auth:forgotPassword.sendCode')}
            </button>
          </form>
        ) : (
          <form onSubmit={handleReset} noValidate className="space-y-4">
            <p className="text-sm text-gray-500 dark:text-gray-400 text-center">
              {t('auth:forgotPassword.codeStepDescription')}
            </p>
            <div>
              <label htmlFor="forgot-code" className={labelClass}>
                {t('auth:forgotPassword.code')}
              </label>
              <input
                id="forgot-code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="forgot-new-password" className={labelClass}>
                {t('auth:forgotPassword.newPassword')}
              </label>
              <input
                id="forgot-new-password"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className={inputClass}
              />
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {t('auth:forgotPassword.sessionsWarning')}
            </p>
            {error && <p className="text-red-500 dark:text-red-400 text-sm">{error}</p>}
            <button
              type="submit"
              disabled={loading || !code.trim() || !newPassword}
              className="w-full bg-primary hover:bg-primary-dark disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold rounded-lg px-4 py-2 transition-colors"
            >
              {loading ? t('common:loading') : t('auth:forgotPassword.submit')}
            </button>
          </form>
        )}

        <Link
          to="/login"
          className="block text-center text-sm text-primary hover:text-primary-dark"
        >
          {t('auth:forgotPassword.backToLogin')}
        </Link>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Add the route and the link**

In `App.tsx`, alongside the other auth routes:

```tsx
<Route path="/forgot-password" element={<ForgotPasswordPage />} />
```

In `LoginPage.tsx`, under the password field:

```tsx
<Link to="/forgot-password" className="text-sm text-primary hover:text-primary-dark">
  {t('auth:forgotPassword.link')}
</Link>
```

- [ ] **Step 5: Handle `session_expired` centrally**

Find where the web stores and clears the auth token (`src/context/AuthContext.tsx`). Wherever API errors surface, add: on a `401` whose `code` is `session_expired`, clear the stored token and navigate to `/login`. A toast alone leaves the user holding a dead session with no way out.

Run: `cd frontend/packages/web && rg -n 'localStorage|401' src/context/AuthContext.tsx src/../../shared/api/client.ts`

- [ ] **Step 6: Run the tests**

Run: `cd frontend/packages/web && pnpm vitest run src/pages/ForgotPasswordPage.test.tsx`
Expected: 3 PASS.

Then the whole web suite: `pnpm test:run`
Expected: PASS (this script also runs the `shared/` Vitest config — rule #14).

- [ ] **Step 7: Commit**

```bash
git add frontend/packages/web/src
git commit -m "feat(web): pagina de recuperacion de contrasena en dos pasos"
```

---

### Task 14: Mobile — forgot password screen

**Files:**
- Create: `frontend/packages/mobile/app/forgot-password.tsx`
- Modify: `frontend/packages/mobile/app/login.tsx` (link)
- Modify: `frontend/packages/mobile/store/index.ts` (clear the session on `session_expired`)
- Test: `frontend/packages/mobile/app/__tests__/forgot-password.test.tsx` (create — match the existing test location convention in that package)

- [ ] **Step 1: Read the login screen first**

Run: `cd frontend/packages/mobile && cat app/login.tsx`

Mirror its `StyleSheet`, colours from `constants/index.ts`, and its loading/error handling. Do not invent a new visual language.

- [ ] **Step 2: Write the failing test**

Create the test mirroring the existing mobile screen tests. Mock `@shared/api/client` hook by hook — rule #17: every hook a tested screen uses must be in its mock.

```tsx
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import ForgotPasswordScreen from '../forgot-password';

const forgotPassword = jest.fn();
const resetPassword = jest.fn();

jest.mock('@shared/api/client', () => ({
  apiClient: {
    forgotPassword: (...a: unknown[]) => forgotPassword(...a),
    resetPassword: (...a: unknown[]) => resetPassword(...a),
  },
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: jest.fn(), back: jest.fn() }),
  Link: ({ children }: { children: React.ReactNode }) => children,
}));

beforeEach(() => {
  forgotPassword.mockReset().mockResolvedValue({ message: 'ok' });
  resetPassword.mockReset().mockResolvedValue({ message: 'ok' });
});

describe('ForgotPasswordScreen', () => {
  it('advances to the code step for any well-formed address', async () => {
    const { getByPlaceholderText, getByText, findByPlaceholderText } = render(<ForgotPasswordScreen />);

    fireEvent.changeText(getByPlaceholderText('forgotPassword.email'), 'ghost@example.com');
    fireEvent.press(getByText('forgotPassword.sendCode'));

    await waitFor(() => expect(forgotPassword).toHaveBeenCalledWith('ghost@example.com'));
    expect(await findByPlaceholderText('forgotPassword.code')).toBeTruthy();
  });

  it('submits code and new password together', async () => {
    const { getByPlaceholderText, getByText, findByPlaceholderText } = render(<ForgotPasswordScreen />);

    fireEvent.changeText(getByPlaceholderText('forgotPassword.email'), 'user@example.com');
    fireEvent.press(getByText('forgotPassword.sendCode'));

    fireEvent.changeText(await findByPlaceholderText('forgotPassword.code'), '123456');
    fireEvent.changeText(getByPlaceholderText('forgotPassword.newPassword'), 'newpassword');
    fireEvent.press(getByText('forgotPassword.submit'));

    await waitFor(() =>
      expect(resetPassword).toHaveBeenCalledWith('user@example.com', '123456', 'newpassword'),
    );
  });
});
```

- [ ] **Step 3: Run and confirm it fails**

Run: `cd frontend/packages/mobile && pnpm test:run -- forgot-password`
Expected: FAIL — module not found.

**Never run `pnpm test` here — it is `jest --watchAll` and never terminates (rule #17).**

- [ ] **Step 4: Implement the screen**

Create `app/forgot-password.tsx` with the same two-step state machine as the web page (`step`, `email`, `code`, `newPassword`, `error`, `loading`), using the components and styles you read in Step 1. Same rule applies: **always advance to the code step**, never branch on whether the address exists. Include the `sessionsWarning` line above the submit button, and `keyboardType="number-pad"` plus `textContentType="oneTimeCode"` on the code field.

- [ ] **Step 5: Link from the login screen**

Add a pressable under the password field navigating to `/forgot-password`, labelled `t('auth:forgotPassword.link')`.

- [ ] **Step 6: Clear the session on `session_expired`**

In `store/index.ts`, wherever API errors are handled, drop the persisted token and route to login when the response code is `session_expired`.

- [ ] **Step 7: Run the mobile suite**

Run: `cd frontend/packages/mobile && pnpm test:run`
Expected: PASS, all suites.

- [ ] **Step 8: Commit**

```bash
git add frontend/packages/mobile
git commit -m "feat(mobile): pantalla de recuperacion de contrasena en dos pasos"
```

---

### Task 15: Update `GUIDE.md`

**Files:**
- Modify: `backend/GUIDE.md`

- [ ] **Step 1: Find the stale snippets**

Run: `cd backend && rg -n 'ValidateToken' GUIDE.md`
Expected: four hits (lines ~507, ~601, ~854, ~1473) all showing the two-value signature.

- [ ] **Step 2: Update each to the three-value form**

```go
userID, issuedAt, err := jwt.ValidateToken(tokenString, secretKey)
```

Where the snippet shows the middleware, add the freshness check so the documented example matches the real one.

- [ ] **Step 3: Commit**

```bash
git add backend/GUIDE.md
git commit -m "docs(backend): actualizar GUIDE.md a la nueva firma de ValidateToken"
```

---

## Final verification before merge

- [ ] `cd backend && go build ./... && go test ./... -count=1` — all green
- [ ] `cd frontend/packages/web && pnpm test:run && pnpm build`
- [ ] `cd frontend/packages/mobile && pnpm test:run`
- [ ] Local end-to-end against the Docker database on host port **5433**, not 5432 (`.env` gotcha):
  - request a reset for a seeded user, read the code out of the Render/local log or the Brevo dashboard
  - confirm the reset, then verify the OLD JWT now returns `401 session_expired`
  - log in with the new password
  - request a reset for an address that does not exist and confirm the response body is byte-identical to the real one
- [ ] `/security-review`, then `/code-review` if credits allow

---

## Known pre-existing issue, deliberately not fixed here

`VerificationHandler.handleSendError` (`internal/handler/verification_handler.go:151-161`) still emits the legacy `{"error": ..., "retry_after": ...}` shape for rate limits instead of `{code, message}` — a rule #11 violation predating this work. Out of scope: touching it would change the contract of the email-verification endpoints, which this change does not otherwise go near. Worth its own small PR.
