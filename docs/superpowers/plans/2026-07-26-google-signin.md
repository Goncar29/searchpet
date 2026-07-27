# Google Sign-In (Web) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add "Continue with Google" as an additional authentication option on the SearchPet web app, keeping the existing email/password form untouched, and capture location + profile photo for brand-new Google users.

**Architecture:** The browser runs Google Identity Services (GIS), which returns a signed ID token. The Go backend verifies that token server-side (`google.golang.org/api/idtoken`, already a direct dependency) behind a mockable `googleauth.Verifier` interface, then either logs in a returning Google user (matched by the stable Google `sub`), links an existing local account (only when Google reports `email_verified: true`), or creates a new user. Our own JWT remains the single session mechanism — Google is only an identity assertion at the door. Clean Architecture layering is preserved: Handler → Service → Repository → Model.

**Tech Stack:** Go 1.25 + Gin + GORM + PostgreSQL (golang-migrate for SQL DDL), `google.golang.org/api/idtoken`, Cloudinary; React 18 + Vite + Tailwind + react-i18next on the web; Vitest + Testing Library for web tests, stdlib `testing` for Go.

**Source spec:** `docs/superpowers/specs/2026-07-22-google-signin-design.md`

> **STATUS — this plan has been fully executed.** It is kept as the record of how
> the work was sequenced and why each decision was made. **The code is now the
> source of truth, not these code blocks.** Several tasks were amended during
> execution after reviews found real defects; the amendments are summarised in
> "Changes made during execution" below and in the design notes. Do not re-run a
> task body verbatim expecting it to match `HEAD`.

**Branch:** `feat/google-signin`

---

## File Structure

### Backend (created)

| File | Responsibility |
|------|----------------|
| `backend/pkg/googleauth/verifier.go` | `Verifier` interface + `Claims` struct + the real `idtoken`-backed implementation. Only place that knows Google's token format. |
| `backend/migrations/000018_google_signin.up.sql` / `.down.sql` | DDL that AutoMigrate cannot express: `password_hash` nullable + partial unique index on `google_id`. |
| `backend/internal/service/auth_google_test.go` | Unit tests for `LoginWithGoogle` and `UpdateLocation` with a mocked verifier. |

### Backend (modified)

| File | Change |
|------|--------|
| `backend/internal/domain/models.go` | `User.PasswordHash` drops `not null`; new `User.GoogleID`. |
| `backend/internal/domain/errors.go` | 4 new sentinel errors + their `{code}` mappings. |
| `backend/internal/repository/interfaces.go` | `UserRepository.GetByGoogleID`. |
| `backend/internal/repository/user_repository.go` | Implementation of `GetByGoogleID`. |
| `backend/internal/service/interfaces.go` | `AuthService.LoginWithGoogle` + `AuthService.UpdateLocation`. |
| `backend/internal/service/auth_service.go` | Verifier dependency, `LoginWithGoogle`, `importGooglePhoto`, `UpdateLocation`. |
| `backend/internal/dto/auth_dto.go` | `GoogleAuthRequest`, `GoogleAuthResponse`, `UpdateLocationRequest`. |
| `backend/internal/handler/auth_handler.go` | `GoogleAuth` + `UpdateLocation` handlers. |
| `backend/config/config.go` | `GoogleClientID` from `GOOGLE_CLIENT_ID`. |
| `backend/internal/app/router.go` | Verifier construction, DI, 2 new routes. |
| 7 test files with `UserRepository` mocks | Add the new interface method. |

### Web (created)

| File | Responsibility |
|------|----------------|
| `frontend/packages/web/src/types/google-gis.d.ts` | Ambient types for `window.google.accounts.id`. |
| `frontend/packages/web/src/components/auth/GoogleSignInButton.tsx` | Loads the GIS script once, renders Google's official button, hands the ID token up. Knows nothing about our API. |
| `frontend/packages/web/src/components/auth/LocationOnboardingStep.tsx` | Post-signup, skippable location capture (GPS → city fallback). |
| `frontend/packages/web/src/hooks/useGoogleSignIn.ts` | Shared flow logic for LoginPage + RegisterPage (DRY: both pages need the identical credential → context → route decision). |
| `frontend/packages/web/src/components/auth/GoogleSignInButton.test.tsx` | Component tests. |
| `frontend/packages/web/src/components/auth/LocationOnboardingStep.test.tsx` | Component tests. |

### Web (modified)

| File | Change |
|------|--------|
| `frontend/packages/shared/types/index.ts` | `GoogleAuthResponse`, `UpdateLocationRequest`. |
| `frontend/packages/shared/api/client.ts` | `loginWithGoogle`, `updateMyLocation`. |
| `frontend/packages/web/src/context/AuthContext.tsx` | `loginWithGoogle` returning `isNewUser`. |
| `frontend/packages/web/src/pages/LoginPage.tsx` | Google button + divider + onboarding step. |
| `frontend/packages/web/src/pages/RegisterPage.tsx` | Same. |
| `frontend/packages/shared/i18n/locales/{es,en,pt}.json` | `auth.google.*`, `auth.location.*`, 3 new `errors.*` codes. |
| `frontend/packages/web/vercel.json` | CSP: `script-src`, `frame-src`, `connect-src` for `accounts.google.com`. |

---

## Design notes locked in before coding

Read these before Task 1 — three of them contradict a literal reading of the spec, for reasons found in the codebase.

1. **`GoogleID` must NOT carry a GORM `uniqueIndex` tag.** The spec text says `gorm:"uniqueIndex;size:255"`, but `google_id` is an empty string for every non-Google user. A plain unique index rejects the second such row, breaking ordinary email registration. The uniqueness is enforced by a **partial** unique index created in SQL (`WHERE google_id <> ''`), which AutoMigrate cannot express. The struct tag uses a plain `index` only.

2. **Index naming matters.** GORM's default name for `index` on that column is `idx_users_google_id`. The SQL partial index is therefore named `uniq_users_google_id` so the two never collide.

3. **Migration order is `RunMigrations` → `RunAutoMigrate`** (`backend/pkg/database/postgres.go:73`). AutoMigrate runs *last*, so `not null` must be removed from the `PasswordHash` struct tag — otherwise AutoMigrate re-imposes the constraint the SQL migration just dropped.

4. **502 vs 401.** `idtoken.Validate` does not cleanly distinguish "bad token" from "couldn't reach Google", so every verification failure maps to `google_token_invalid` (401). `google_signin_unavailable` (502) is reserved for the case where `GOOGLE_CLIENT_ID` is unset and the verifier is nil — the route stays registered so a front/back config mismatch produces a clear error instead of a confusing 404.

5. **`NewVerifier` returns `(Verifier, error)` and rejects an empty client id.** `idtoken.Validate` skips the audience check entirely when the audience argument is `""` (`validate.go:160` — `if audience != "" && ...`), leaving only signature and expiry. Any Google-minted token would then verify, including one minted for an attacker's own app carrying a victim's real, genuinely-verified email — full takeover through the auto-link path. The constructor therefore refuses to build a permissive verifier rather than trusting callers to check the env var. Same failure shape as CLAUDE.md rule #24 (the Brevo mailer silently no-op'ing on missing config).

6. **The verifier checks `iss` itself, because `idtoken` does not.** `Issuer` exists only as a struct field in that library (`validate.go:48`) and is never read. It also never requires any claim to be present, so `Verify` rejects a token with an empty `sub` or `email` instead of returning empty strings into the account-matching logic.

7. **`UserResponse` intentionally does not expose `latitude`/`longitude`.** `GET /api/auth/me` already omits them; this plan does not change that. The onboarding step only needs the request to succeed.

**Risks that WERE closed during execution (they are no longer accepted):**

- **Google IAM `generateIdToken` tokens are rejected** (`fc7274f`). That API mints a token with a caller-chosen `aud`, signed by the same key set and carrying `iss: accounts.google.com`, so neither the audience nor the issuer check narrows it — it allowed unauthenticated account creation with a Google-verified email, skipping the OTP. Closed by refusing `*.iam.gserviceaccount.com` email suffixes, chosen over an `azp` check because it is unit-testable with no live OAuth client and cannot break the real consent flow. The policy now lives in the pure, fully tested `checkIdentity(issuer, sub, email)`.
- **The avatar import no longer sits on the signup response path** (`9b5f91f`). It is dispatched through `runAsync` with `context.Background()`, and the background job re-reads the user before saving because `Update` writes the whole row.

**Still genuinely open — surfaced, not parked:**

- **No nonce binding.** GIS supports a server-issued nonce; without it a captured token is replayable within its ~1h validity. This one cannot be built and verified until the OAuth client exists, so it is called out here rather than silently omitted.

---

### Task 1: Database schema — `google_id` column and nullable `password_hash`

**Files:**
- Modify: `backend/internal/domain/models.go:41` (the `PasswordHash` line)
- Create: `backend/migrations/000018_google_signin.up.sql`
- Create: `backend/migrations/000018_google_signin.down.sql`

- [ ] **Step 1: Change the `User` struct**

In `backend/internal/domain/models.go`, replace line 41:

```go
	PasswordHash       string    `gorm:"not null;size:255" json:"-"`
```

with these two lines (the `not null` is gone, and `GoogleID` is added right after):

```go
	PasswordHash       string    `gorm:"size:255" json:"-"` // empty = Google-only account; bcrypt against "" always fails, which blocks password login without extra logic
	GoogleID           string    `gorm:"size:255;index" json:"-"` // Google `sub` (stable across email changes); empty = not linked. Uniqueness is a PARTIAL unique index (migration 000018), not a GORM uniqueIndex — every non-Google user shares the empty value.
```

- [ ] **Step 2: Write the up migration**

Create `backend/migrations/000018_google_signin.up.sql`:

```sql
-- Google Sign-In: users may now exist without a password, and may be linked to
-- a Google account by its stable `sub` claim.

-- A Google-only user has no password. AutoMigrate cannot drop an existing
-- NOT NULL, so it is dropped here (migrations run BEFORE AutoMigrate).
ALTER TABLE users
	ALTER COLUMN password_hash DROP NOT NULL;

-- AutoMigrate would also add this column, but doing it here guarantees the
-- NOT NULL DEFAULT '' so existing rows never hold NULL (scanning NULL into a
-- non-pointer Go string fails).
ALTER TABLE users
	ADD COLUMN IF NOT EXISTS google_id VARCHAR(255) NOT NULL DEFAULT '';

-- PARTIAL unique index: one account per Google `sub`, while every user without
-- Google keeps the shared empty value. A plain UNIQUE index would reject the
-- second password-only registration.
-- Named uniq_* so it never collides with GORM's idx_users_google_id.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_users_google_id
	ON users (google_id)
	WHERE google_id <> '';
```

- [ ] **Step 3: Write the down migration**

Create `backend/migrations/000018_google_signin.down.sql`:

```sql
DROP INDEX IF EXISTS uniq_users_google_id;

ALTER TABLE users
	DROP COLUMN IF EXISTS google_id;

-- Restoring NOT NULL only works if no password-less user survived. Backfill a
-- non-usable placeholder first so the rollback cannot fail mid-way; bcrypt
-- comparison against this value always fails, exactly like the empty string.
UPDATE users SET password_hash = '' WHERE password_hash IS NULL;

ALTER TABLE users
	ALTER COLUMN password_hash SET NOT NULL;
```

- [ ] **Step 4: Verify it compiles**

Run: `cd backend && go build ./...`
Expected: no output (success).

- [ ] **Step 5: Commit**

```bash
git add backend/internal/domain/models.go backend/migrations/000018_google_signin.up.sql backend/migrations/000018_google_signin.down.sql
git commit -m "feat(auth): add google_id column and nullable password_hash"
```

---

### Task 2: `UserRepository.GetByGoogleID`

Adding a method to `UserRepository` breaks **7** test mocks that implement the interface. They are all fixed in this task so the tree never stays red.

**Files:**
- Modify: `backend/internal/repository/interfaces.go:62-68`
- Modify: `backend/internal/repository/user_repository.go`
- Modify: `backend/internal/service/mocks_test.go`
- Modify: `backend/internal/service/admin_service_test.go`
- Modify: `backend/internal/service/moderation_service_test.go`
- Modify: `backend/internal/middleware/admin_test.go`
- Modify: `backend/tests/review_service_test.go`
- Modify: `backend/tests/verification_service_test.go`
- Modify: `backend/tests/foster_home_service_test.go`

- [ ] **Step 1: Add the method to the interface**

In `backend/internal/repository/interfaces.go`, replace the `UserRepository` block:

```go
type UserRepository interface {
	Create(ctx context.Context, user *domain.User) error
	GetByID(ctx context.Context, id uuid.UUID) (*domain.User, error)
	GetByEmail(ctx context.Context, email string) (*domain.User, error)
	// GetByGoogleID busca por el `sub` de Google (id estable, no cambia si el
	// usuario cambia su email). Retorna domain.ErrUserNotFound si no hay match.
	GetByGoogleID(ctx context.Context, googleID string) (*domain.User, error)
	Update(ctx context.Context, user *domain.User) error
	Delete(ctx context.Context, id uuid.UUID) error
}
```

- [ ] **Step 2: Implement it**

In `backend/internal/repository/user_repository.go`, add after `GetByEmail` (which ends at line 55):

```go
// GetByGoogleID obtiene un usuario por el `sub` de su cuenta de Google.
// Retorna domain.ErrUserNotFound si no existe.
// Un googleID vacío nunca matchea: el string vacío es el valor compartido por
// TODOS los usuarios sin Google vinculado.
func (r *postgresUserRepository) GetByGoogleID(ctx context.Context, googleID string) (*domain.User, error) {
	if googleID == "" {
		return nil, domain.ErrUserNotFound
	}
	user := &domain.User{}
	if err := r.db.WithContext(ctx).First(user, "google_id = ?", googleID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, domain.ErrUserNotFound
		}
		return nil, err
	}
	return user, nil
}
```

- [ ] **Step 3: Extend the shared service-package mock**

In `backend/internal/service/mocks_test.go`, extend the `mockUserRepo` struct (currently lines 15-21) to:

```go
type mockUserRepo struct {
	user       *domain.User
	emailErr   error // error devuelto por GetByEmail
	getByIDErr error // error devuelto por GetByID
	createErr  error
	updateErr  error

	// Google Sign-In
	googleUser *domain.User // lo que GetByGoogleID devuelve
	googleErr  error        // error devuelto por GetByGoogleID

	// Capturas para aserciones
	createdUser  *domain.User
	updatedUsers []*domain.User
}
```

Replace `Create` and `Update`, and add `GetByGoogleID`:

```go
func (m *mockUserRepo) Create(_ context.Context, user *domain.User) error {
	if m.createErr != nil {
		return m.createErr
	}
	user.ID = uuid.New()
	m.createdUser = user
	return nil
}

func (m *mockUserRepo) GetByGoogleID(_ context.Context, googleID string) (*domain.User, error) {
	if m.googleErr != nil {
		return nil, m.googleErr
	}
	if m.googleUser == nil {
		return nil, domain.ErrUserNotFound
	}
	return m.googleUser, nil
}

func (m *mockUserRepo) Update(_ context.Context, user *domain.User) error {
	if m.updateErr != nil {
		return m.updateErr
	}
	m.updatedUsers = append(m.updatedUsers, user)
	return nil
}
```

- [ ] **Step 4: Add the method to the other 6 mocks**

Each of these only needs a stub — none of their tests exercise Google. Add one method per file, next to that file's existing `GetByEmail`:

`backend/internal/service/admin_service_test.go` (after line 26):

```go
func (m *mockUserRepoForAdmin) GetByGoogleID(context.Context, string) (*domain.User, error) {
	return nil, domain.ErrUserNotFound
}
```

`backend/internal/service/moderation_service_test.go` (after line 24):

```go
func (m *mockUserRepoForMod) GetByGoogleID(context.Context, string) (*domain.User, error) {
	return nil, domain.ErrUserNotFound
}
```

`backend/internal/middleware/admin_test.go` (after line 26):

```go
func (s *stubUserRepo) GetByGoogleID(context.Context, string) (*domain.User, error) { return nil, nil }
```

`backend/tests/review_service_test.go` (after line 99):

```go
func (m *mockUserRepository) GetByGoogleID(context.Context, string) (*domain.User, error) {
	return nil, domain.ErrUserNotFound
}
```

`backend/tests/verification_service_test.go` (after line 43):

```go
func (m *mockUserRepo) GetByGoogleID(context.Context, string) (*domain.User, error) {
	return nil, domain.ErrUserNotFound
}
```

`backend/tests/foster_home_service_test.go` (after line 63):

```go
func (f *fakeUserRepo) GetByGoogleID(context.Context, string) (*domain.User, error) {
	return nil, domain.ErrUserNotFound
}
```

- [ ] **Step 5: Run the full backend test suite**

Run: `cd backend && go build ./... && go test ./internal/... ./tests/...`
Expected: PASS. If a mock is missing the method, the failure reads `cannot use ... as repository.UserRepository value: missing method GetByGoogleID` — add it to that file and re-run.

> **Gotcha (memory: `go-test-wipes-dev-db`):** running `go test` with `DATABASE_URL` pointing at the local `lostpets` dev DB wipes the seed. Either unset `DATABASE_URL` for this run or re-seed afterwards with `make db-reset && go run ./cmd/seed`.

- [ ] **Step 6: Commit**

```bash
git add backend/internal/repository backend/internal/service/mocks_test.go backend/internal/service/admin_service_test.go backend/internal/service/moderation_service_test.go backend/internal/middleware/admin_test.go backend/tests/review_service_test.go backend/tests/verification_service_test.go backend/tests/foster_home_service_test.go
git commit -m "feat(auth): add UserRepository.GetByGoogleID"
```

---

### Task 3: Domain errors and `{code}` mappings

**Files:**
- Modify: `backend/internal/domain/errors.go`

- [ ] **Step 1: Add the sentinel errors**

In `backend/internal/domain/errors.go`, inside the same `var (...)` block that declares `ErrInvalidCredentials` (line 8) and `ErrUserBanned` (line 10), add:

```go
	// Google Sign-In
	ErrGoogleTokenInvalid      = errors.New("no pudimos validar tu cuenta de Google; intentá de nuevo")
	ErrGoogleEmailUnverified   = errors.New("tu email de Google no está verificado")
	ErrGoogleSignInUnavailable = errors.New("el inicio de sesión con Google no está disponible en este momento")
	ErrGoogleAccountMismatch   = errors.New("este email ya está vinculado a otra cuenta de Google")
```

> `ErrGoogleSignInUnavailable` is a SERVER MISCONFIGURATION (`GOOGLE_CLIENT_ID` unset), not a network failure. Its name and message say so on purpose — "we couldn't reach Google" would send someone chasing a network problem when the real cause is an unset env var.

- [ ] **Step 2: Map them to stable codes**

In the `ErrorCodes` map (starts line 125), under the `// Auth` group, add:

```go
	ErrGoogleTokenInvalid:      "google_token_invalid",
	ErrGoogleEmailUnverified:   "google_email_unverified",
	ErrGoogleSignInUnavailable: "google_signin_unavailable",
	ErrGoogleAccountMismatch:   "google_account_mismatch",
```

> Note for Task 15: `google_email_unverified` sits next to the pre-existing `email_not_verified`. Different subject (Google's verification vs ours) and different remediation — the translations must be clearly distinct, not near-duplicates.

- [ ] **Step 3: Verify the mapping resolves**

Run: `cd backend && go build ./... && go test ./tests/ -run TestWriteError -v`
Expected: PASS (the existing `write_error_test.go` suite stays green; the new codes are additive).

- [ ] **Step 4: Commit**

```bash
git add backend/internal/domain/errors.go
git commit -m "feat(auth): add Google Sign-In domain errors and codes"
```

---

### Task 4: `pkg/googleauth` — the ID token verifier

**Files:**
- Create: `backend/pkg/googleauth/verifier.go`

`google.golang.org/api v0.278.0` is already a direct dependency in `backend/go.mod:23`, so no `go get` is needed.

- [ ] **Step 1: Write the package**

Create `backend/pkg/googleauth/verifier.go`:

```go
// Package googleauth verifies Google ID tokens. It is the only place in the
// backend that knows Google's token format — everything upstream consumes the
// Verifier interface, which keeps AuthService unit-testable without network.
package googleauth

import (
	"context"
	"errors"
	"fmt"

	"google.golang.org/api/idtoken"
)

// Claims are the fields we consume from a verified Google ID token.
type Claims struct {
	Sub           string // stable Google user id; survives an email change
	Email         string
	Name          string
	Picture       string
	EmailVerified bool
}

// Verifier validates a Google ID token and returns its claims.
type Verifier interface {
	Verify(ctx context.Context, idToken string) (*Claims, error)
}

type idTokenVerifier struct {
	clientID string
}

// NewVerifier returns a Verifier backed by google.golang.org/api/idtoken.
//
// clientID is the OAuth 2.0 Web client id, checked as the token audience —
// that check is what stops a token minted for a DIFFERENT application from
// being replayed against us. It is rejected when empty rather than defaulted,
// because idtoken.Validate skips the audience check entirely on an empty
// audience: a misconfigured deploy would otherwise accept any Google token.
func NewVerifier(clientID string) (Verifier, error) {
	if clientID == "" {
		return nil, errors.New("googleauth: clientID is required; an empty audience disables the audience check")
	}
	return &idTokenVerifier{clientID: clientID}, nil
}

// googleIssuers are the two `iss` values Google mints ID tokens with. The
// idtoken library does NOT check the issuer — it validates signature, expiry
// and audience only — so we check it here.
var googleIssuers = map[string]bool{
	"accounts.google.com":         true,
	"https://accounts.google.com": true,
}

func (v *idTokenVerifier) Verify(ctx context.Context, token string) (*Claims, error) {
	// Validate checks the signature, expiry, and audience. It does NOT check
	// the issuer or require any claim to be present — both are handled below.
	payload, err := idtoken.Validate(ctx, token, v.clientID)
	if err != nil {
		return nil, fmt.Errorf("googleauth: invalid id token: %w", err)
	}
	if !googleIssuers[payload.Issuer] {
		return nil, fmt.Errorf("googleauth: unexpected issuer %q", payload.Issuer)
	}

	// sub and email are the two identifiers the whole auth decision hangs on.
	// idtoken does not require either to be present, so a malformed token would
	// otherwise surface as an empty string deep inside the account-matching
	// logic instead of as a rejection here.
	sub := payload.Subject
	if sub == "" {
		return nil, fmt.Errorf("googleauth: token has no sub claim")
	}
	email := stringClaim(payload.Claims, "email")
	if email == "" {
		return nil, fmt.Errorf("googleauth: token has no email claim")
	}

	return &Claims{
		Sub:           sub,
		Email:         email,
		Name:          stringClaim(payload.Claims, "name"),
		Picture:       stringClaim(payload.Claims, "picture"),
		EmailVerified: boolClaim(payload.Claims, "email_verified"),
	}, nil
}

func stringClaim(claims map[string]any, key string) string {
	v, _ := claims[key].(string)
	return v
}

// boolClaim tolerates both shapes Google has shipped for email_verified:
// a JSON boolean and the string "true".
func boolClaim(claims map[string]any, key string) bool {
	switch v := claims[key].(type) {
	case bool:
		return v
	case string:
		return v == "true"
	}
	return false
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd backend && go build ./pkg/googleauth/`
Expected: no output (success).

- [ ] **Step 3: Commit**

```bash
git add backend/pkg/googleauth/verifier.go
git commit -m "feat(auth): add googleauth ID token verifier"
```

---

### Task 5: `AuthService.LoginWithGoogle`

**Files:**
- Modify: `backend/internal/service/interfaces.go:145-166`
- Modify: `backend/internal/service/auth_service.go`
- Create: `backend/internal/service/auth_google_test.go`

- [ ] **Step 1: Write the failing tests**

Create `backend/internal/service/auth_google_test.go`:

```go
package service_test

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/service"
	"lost-pets/pkg/googleauth"
)

// ============================================================
// Mock: googleauth.Verifier
// ============================================================

type mockVerifier struct {
	claims *googleauth.Claims
	err    error
}

func (m *mockVerifier) Verify(context.Context, string) (*googleauth.Claims, error) {
	if m.err != nil {
		return nil, m.err
	}
	return m.claims, nil
}

var _ googleauth.Verifier = (*mockVerifier)(nil)

func googleClaims() *googleauth.Claims {
	return &googleauth.Claims{
		Sub:           "google-sub-123",
		Email:         "Carlos@Example.com",
		Name:          "Carlos",
		Picture:       "https://lh3.googleusercontent.com/a/photo",
		EmailVerified: true,
	}
}

// newGoogleAuthSvc builds the service with a mocked verifier. storage is nil,
// so the profile-photo import is skipped — it is best-effort by design and
// covered separately in TestLoginWithGoogle_NewUser_NoStorage_StillSucceeds.
func newGoogleAuthSvc(repo *mockUserRepo, v googleauth.Verifier) service.AuthService {
	return service.NewAuthService(repo, "test-secret-key-32chars-minimum!", nil, nil, v)
}

func TestLoginWithGoogle_NewUser(t *testing.T) {
	repo := &mockUserRepo{emailErr: domain.ErrUserNotFound}
	svc := newGoogleAuthSvc(repo, &mockVerifier{claims: googleClaims()})

	user, token, isNew, err := svc.LoginWithGoogle(context.Background(), "any-token")

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if !isNew {
		t.Error("expected isNew=true for a first-time Google user")
	}
	if token == "" {
		t.Error("expected non-empty JWT token")
	}
	if user.GoogleID != "google-sub-123" {
		t.Errorf("expected GoogleID %q, got %q", "google-sub-123", user.GoogleID)
	}
	// Email is normalised: Google may return it with the original casing.
	if user.Email != "carlos@example.com" {
		t.Errorf("expected lowercased email, got %q", user.Email)
	}
	if !user.EmailVerified {
		t.Error("expected EmailVerified=true — Google already verified it, so the Brevo OTP is skipped")
	}
	if user.VerificationMethod != "google" {
		t.Errorf("expected VerificationMethod %q, got %q", "google", user.VerificationMethod)
	}
	if user.PasswordHash != "" {
		t.Error("expected empty PasswordHash for a Google-only account")
	}
	if repo.createdUser == nil {
		t.Error("expected the user to be persisted")
	}
}

func TestLoginWithGoogle_ReturningUser(t *testing.T) {
	existing := &domain.User{ID: uuid.New(), Email: "carlos@example.com", GoogleID: "google-sub-123"}
	repo := &mockUserRepo{googleUser: existing}
	svc := newGoogleAuthSvc(repo, &mockVerifier{claims: googleClaims()})

	user, token, isNew, err := svc.LoginWithGoogle(context.Background(), "any-token")

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if isNew {
		t.Error("expected isNew=false for a returning Google user")
	}
	if token == "" {
		t.Error("expected non-empty JWT token")
	}
	if user.ID != existing.ID {
		t.Error("expected the existing user, matched by GoogleID")
	}
	if repo.createdUser != nil {
		t.Error("expected NO user creation for a returning user")
	}
}

func TestLoginWithGoogle_LinksExistingLocalAccount(t *testing.T) {
	existing := &domain.User{
		ID:           uuid.New(),
		Email:        "carlos@example.com",
		PasswordHash: bcryptHash(t, "segura123"),
	}
	// No GoogleID match, but the email exists → link.
	repo := &mockUserRepo{user: existing, emailErr: nil}
	svc := newGoogleAuthSvc(repo, &mockVerifier{claims: googleClaims()})

	user, _, isNew, err := svc.LoginWithGoogle(context.Background(), "any-token")

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if isNew {
		t.Error("expected isNew=false when linking an existing local account")
	}
	if user.GoogleID != "google-sub-123" {
		t.Errorf("expected the account to be linked, GoogleID=%q", user.GoogleID)
	}
	if !user.EmailVerified {
		t.Error("expected EmailVerified=true after linking")
	}
	if user.PasswordHash == "" {
		t.Error("expected the existing password to survive linking — the user keeps both login methods")
	}
	if len(repo.updatedUsers) != 1 {
		t.Errorf("expected exactly 1 Update call, got %d", len(repo.updatedUsers))
	}
	if repo.createdUser != nil {
		t.Error("expected NO user creation when linking")
	}
}

func TestLoginWithGoogle_RejectsUnverifiedEmail(t *testing.T) {
	claims := googleClaims()
	claims.EmailVerified = false
	repo := &mockUserRepo{emailErr: domain.ErrUserNotFound}
	svc := newGoogleAuthSvc(repo, &mockVerifier{claims: claims})

	_, _, _, err := svc.LoginWithGoogle(context.Background(), "any-token")

	if !errors.Is(err, domain.ErrGoogleEmailUnverified) {
		t.Fatalf("expected ErrGoogleEmailUnverified, got %v", err)
	}
	if repo.createdUser != nil {
		t.Error("SECURITY: an unverified Google email must never create or link an account")
	}
}

func TestLoginWithGoogle_UnverifiedEmailDoesNotLink(t *testing.T) {
	claims := googleClaims()
	claims.EmailVerified = false
	existing := &domain.User{ID: uuid.New(), Email: "carlos@example.com"}
	repo := &mockUserRepo{user: existing, emailErr: nil}
	svc := newGoogleAuthSvc(repo, &mockVerifier{claims: claims})

	_, _, _, err := svc.LoginWithGoogle(context.Background(), "any-token")

	if !errors.Is(err, domain.ErrGoogleEmailUnverified) {
		t.Fatalf("expected ErrGoogleEmailUnverified, got %v", err)
	}
	if len(repo.updatedUsers) != 0 {
		t.Error("SECURITY: account takeover — an unverified email must never link to an existing account")
	}
}

func TestLoginWithGoogle_InvalidToken(t *testing.T) {
	repo := &mockUserRepo{emailErr: domain.ErrUserNotFound}
	svc := newGoogleAuthSvc(repo, &mockVerifier{err: errors.New("bad signature")})

	_, _, _, err := svc.LoginWithGoogle(context.Background(), "any-token")

	if !errors.Is(err, domain.ErrGoogleTokenInvalid) {
		t.Fatalf("expected ErrGoogleTokenInvalid, got %v", err)
	}
}

func TestLoginWithGoogle_BannedUser(t *testing.T) {
	banned := &domain.User{ID: uuid.New(), Email: "carlos@example.com", GoogleID: "google-sub-123", IsBanned: true}
	repo := &mockUserRepo{googleUser: banned}
	svc := newGoogleAuthSvc(repo, &mockVerifier{claims: googleClaims()})

	_, _, _, err := svc.LoginWithGoogle(context.Background(), "any-token")

	if !errors.Is(err, domain.ErrUserBanned) {
		t.Fatalf("expected ErrUserBanned, got %v", err)
	}
}

func TestLoginWithGoogle_BannedLocalAccountCannotBeLinked(t *testing.T) {
	banned := &domain.User{ID: uuid.New(), Email: "carlos@example.com", IsBanned: true}
	repo := &mockUserRepo{user: banned, emailErr: nil}
	svc := newGoogleAuthSvc(repo, &mockVerifier{claims: googleClaims()})

	_, _, _, err := svc.LoginWithGoogle(context.Background(), "any-token")

	if !errors.Is(err, domain.ErrUserBanned) {
		t.Fatalf("expected ErrUserBanned, got %v", err)
	}
	if len(repo.updatedUsers) != 0 {
		t.Error("a banned account must not be linked — that would be a ban bypass")
	}
}

func TestLoginWithGoogle_VerifierNotConfigured(t *testing.T) {
	repo := &mockUserRepo{emailErr: domain.ErrUserNotFound}
	svc := newGoogleAuthSvc(repo, nil)

	_, _, _, err := svc.LoginWithGoogle(context.Background(), "any-token")

	if !errors.Is(err, domain.ErrGoogleSignInUnavailable) {
		t.Fatalf("expected ErrGoogleSignInUnavailable when GOOGLE_CLIENT_ID is unset, got %v", err)
	}
}

func TestLoginWithGoogle_NewUser_NoStorage_StillSucceeds(t *testing.T) {
	// storage is nil in newGoogleAuthSvc, so the Cloudinary import is skipped.
	// Signup must still succeed — the photo is best-effort.
	repo := &mockUserRepo{emailErr: domain.ErrUserNotFound}
	svc := newGoogleAuthSvc(repo, &mockVerifier{claims: googleClaims()})

	user, _, isNew, err := svc.LoginWithGoogle(context.Background(), "any-token")

	if err != nil {
		t.Fatalf("photo import failure must not block signup, got %v", err)
	}
	if !isNew {
		t.Error("expected isNew=true")
	}
	if user.ProfilePhotoURL != "" {
		t.Errorf("expected no photo when storage is unavailable, got %q", user.ProfilePhotoURL)
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && go test ./internal/service/ -run TestLoginWithGoogle -v`
Expected: FAIL to compile — `too many arguments in call to service.NewAuthService` and `user.LoginWithGoogle undefined`.

- [ ] **Step 3: Add the method to the `AuthService` interface**

In `backend/internal/service/interfaces.go`, inside the `AuthService` interface (starts line 145), add after `Login`:

```go
	// LoginWithGoogle verifica un ID token de Google y retorna el usuario, un JWT
	// propio, y si el usuario fue creado en esta llamada (para el onboarding).
	// Vincula automáticamente por email SOLO si Google reporta email_verified.
	LoginWithGoogle(ctx context.Context, idToken string) (*domain.User, string, bool, error)
```

- [ ] **Step 4: Add the verifier dependency to the service**

In `backend/internal/service/auth_service.go`, add the import:

```go
	"lost-pets/pkg/googleauth"
```

Replace the struct and constructor (lines 34-53) with:

```go
type authService struct {
	userRepo  repository.UserRepository
	secretKey string
	storage   *storage.CloudinaryClient
	// fosterHomeService is OPTIONAL (may be nil): when wired, UpdateProfile uses it
	// to record owner contact changes on the user's foster home forensic history.
	// A nil value makes the hook a no-op.
	fosterHomeService FosterHomeService
	// googleVerifier is OPTIONAL (may be nil): nil means GOOGLE_CLIENT_ID is not
	// configured, and LoginWithGoogle fails closed with ErrGoogleSignInUnavailable.
	googleVerifier googleauth.Verifier
}

// NewAuthService crea una instancia del servicio de auth con sus dependencias.
// fosterHomeService puede ser nil (hook de contacto es no-op en ese caso).
// googleVerifier puede ser nil (login con Google deshabilitado).
func NewAuthService(
	userRepo repository.UserRepository,
	secretKey string,
	storage *storage.CloudinaryClient,
	fosterHomeService FosterHomeService,
	googleVerifier googleauth.Verifier,
) AuthService {
	return &authService{
		userRepo:          userRepo,
		secretKey:         secretKey,
		storage:           storage,
		fosterHomeService: fosterHomeService,
		googleVerifier:    googleVerifier,
	}
}
```

- [ ] **Step 5: Implement `LoginWithGoogle`**

Append to `backend/internal/service/auth_service.go`:

```go
// LoginWithGoogle resuelve un ID token de Google a una sesión nuestra.
//
// Tres caminos, en orden:
//  1. GoogleID conocido  → login de usuario que vuelve.
//  2. Email conocido     → vincula Google a la cuenta local existente.
//  3. Nada conocido      → crea el usuario.
//
// SEGURIDAD: los caminos 2 y 3 solo se alcanzan con claims.EmailVerified == true.
// Sin ese gate, cualquiera podría reclamar la cuenta ajena de un email que no
// controla. El chequeo de email_verified ES la barrera.
func (s *authService) LoginWithGoogle(ctx context.Context, idToken string) (*domain.User, string, bool, error) {
	if s.googleVerifier == nil {
		log.Println("[auth_service] login con Google solicitado pero GOOGLE_CLIENT_ID no está configurado")
		return nil, "", false, domain.ErrGoogleSignInUnavailable
	}

	claims, err := s.googleVerifier.Verify(ctx, idToken)
	if err != nil {
		log.Printf("[auth_service] google: verificación de id token falló: %v", err)
		return nil, "", false, domain.ErrGoogleTokenInvalid
	}
	if !claims.EmailVerified {
		return nil, "", false, domain.ErrGoogleEmailUnverified
	}
	if claims.Sub == "" || claims.Email == "" {
		return nil, "", false, domain.ErrGoogleTokenInvalid
	}

	email := strings.ToLower(strings.TrimSpace(claims.Email))

	// 1. Usuario que vuelve — match por el `sub` estable de Google.
	existing, err := s.userRepo.GetByGoogleID(ctx, claims.Sub)
	if err == nil {
		if existing.IsBanned {
			return nil, "", false, domain.ErrUserBanned
		}
		token, err := s.issueToken(existing)
		if err != nil {
			return nil, "", false, err
		}
		return existing, token, false, nil
	}
	if !errors.Is(err, domain.ErrUserNotFound) {
		return nil, "", false, err
	}

	// 2. Cuenta local con el mismo email (verificado por Google) — vincular.
	existing, err = s.userRepo.GetByEmail(ctx, email)
	if err == nil {
		if existing.IsBanned {
			return nil, "", false, domain.ErrUserBanned
		}
		existing.GoogleID = claims.Sub
		existing.EmailVerified = true
		if err := s.userRepo.Update(ctx, existing); err != nil {
			return nil, "", false, err
		}
		token, err := s.issueToken(existing)
		if err != nil {
			return nil, "", false, err
		}
		return existing, token, false, nil
	}
	if !errors.Is(err, domain.ErrUserNotFound) {
		return nil, "", false, err
	}

	// 3. Usuario nuevo.
	user := &domain.User{
		Email:              email,
		Name:               claims.Name,
		GoogleID:           claims.Sub,
		PasswordHash:       "", // sin contraseña: bcrypt contra "" siempre falla → login por password bloqueado
		EmailVerified:      true,
		VerificationMethod: "google",
	}
	if err := s.userRepo.Create(ctx, user); err != nil {
		return nil, "", false, err
	}

	// Foto: best-effort. Nunca bloquea el alta.
	if photoURL := s.importGooglePhoto(ctx, user.ID, claims.Picture); photoURL != "" {
		user.ProfilePhotoURL = photoURL
		if err := s.userRepo.Update(ctx, user); err != nil {
			log.Printf("[auth_service] google: no se pudo persistir la foto de perfil de %s: %v", user.ID, err)
			user.ProfilePhotoURL = ""
		}
	}

	token, err := s.issueToken(user)
	if err != nil {
		return nil, "", false, err
	}
	return user, token, true, nil
}

// issueToken genera nuestro JWT y normaliza el error a ErrInternal.
func (s *authService) issueToken(user *domain.User) (string, error) {
	token, err := jwt.GenerateToken(user.ID, s.secretKey)
	if err != nil {
		return "", domain.ErrInternal
	}
	return token, nil
}
```

- [ ] **Step 6: Add a temporary no-op `importGooglePhoto`**

The real implementation lands in Task 6. Add this stub now so the package compiles and Task 5's tests can run in isolation. Append to `backend/internal/service/auth_service.go`:

```go
// importGooglePhoto es reemplazada por la implementación real en la tarea 6.
func (s *authService) importGooglePhoto(_ context.Context, _ uuid.UUID, _ string) string {
	return ""
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cd backend && go test ./internal/service/ -run TestLoginWithGoogle -v`
Expected: PASS — 10 tests.

- [ ] **Step 8: Fix the one other `NewAuthService` caller**

`backend/internal/app/router.go:118` still passes 4 arguments. Change it to:

```go
	authService := service.NewAuthService(userRepo, cfg.JWTSecret, cloudinaryClient, fosterHomeService, nil)
```

(The real verifier is wired in Task 9; `nil` keeps the build green until then.)

Run: `cd backend && go build ./... && go test ./internal/... ./tests/...`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add backend/internal/service backend/internal/app/router.go
git commit -m "feat(auth): add AuthService.LoginWithGoogle"
```

---

### Task 6: Import the Google profile photo into Cloudinary

**Files:**
- Modify: `backend/internal/service/auth_service.go` (replace the Task 5 stub)

- [ ] **Step 1: Replace the stub with the real implementation**

In `backend/internal/service/auth_service.go`, delete the `importGooglePhoto` stub added in Task 5 Step 6 and put this in its place:

```go
// googlePhotoMaxBytes acota la descarga. Los avatares de Google pesan pocos KB;
// esto es un tope de sanidad, no un límite esperado.
const googlePhotoMaxBytes = 5 << 20 // 5 MiB

// importGooglePhoto baja el avatar de Google y lo re-sube a Cloudinary, para no
// hotlinkear una URL que Google puede rotar o revocar.
//
// Best-effort por diseño: CUALQUIER falla retorna "" y el alta continúa sin foto.
// Una cuenta creada sin avatar es un problema cosmético; un alta que falla porque
// Cloudinary tuvo un mal día no lo es.
func (s *authService) importGooglePhoto(ctx context.Context, userID uuid.UUID, pictureURL string) string {
	if pictureURL == "" || s.storage == nil {
		return ""
	}

	// La URL viene de un token firmado por Google, pero exigimos https igual:
	// es la barrera contra un http:// o un esquema raro que nos haga de puente.
	parsed, err := url.Parse(pictureURL)
	if err != nil || parsed.Scheme != "https" {
		log.Printf("[auth_service] google: picture url no-https ignorada para %s", userID)
		return ""
	}

	reqCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, pictureURL, nil)
	if err != nil {
		return ""
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		log.Printf("[auth_service] google: descarga de foto falló para %s: %v", userID, err)
		return ""
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		log.Printf("[auth_service] google: descarga de foto para %s retornó %d", userID, resp.StatusCode)
		return ""
	}

	publicID := sanitizeAvatarPublicID(userID.String(), "google-avatar")
	secureURL, _, err := s.storage.UploadImage(reqCtx, io.LimitReader(resp.Body, googlePhotoMaxBytes), publicID, "searchpet")
	if err != nil {
		log.Printf("[auth_service] google: upload a Cloudinary falló para %s: %v", userID, err)
		return ""
	}
	return secureURL
}
```

- [ ] **Step 2: Add the new imports**

`backend/internal/service/auth_service.go` already imports `io` and `log`. Add to the stdlib group:

```go
	"net/http"
	"net/url"
	"time"
```

- [ ] **Step 3: Run the tests**

Run: `cd backend && go build ./... && go test ./internal/service/ -run TestLoginWithGoogle -v`
Expected: PASS — 10 tests. `TestLoginWithGoogle_NewUser_NoStorage_StillSucceeds` proves the nil-storage path still returns `""` without erroring.

- [ ] **Step 4: Commit**

```bash
git add backend/internal/service/auth_service.go
git commit -m "feat(auth): re-upload Google profile photo to Cloudinary"
```

---

### Task 7: DTOs and the `POST /api/auth/google` handler

**Files:**
- Modify: `backend/internal/dto/auth_dto.go`
- Modify: `backend/internal/handler/auth_handler.go`
- Modify: `backend/tests/auth_handler_test.go`

- [ ] **Step 1: Write the failing handler test**

In `backend/tests/auth_handler_test.go`, add the new field to the `mockAuthService` struct (currently lines 23-30):

```go
	loginWithGoogleFn func(ctx context.Context, idToken string) (*domain.User, string, bool, error)
	updateLocationFn  func(ctx context.Context, id uuid.UUID, req dto.UpdateLocationRequest) (*domain.User, error)
```

and add the two methods next to the existing `Login` method:

```go
func (m *mockAuthService) LoginWithGoogle(ctx context.Context, idToken string) (*domain.User, string, bool, error) {
	if m.loginWithGoogleFn != nil {
		return m.loginWithGoogleFn(ctx, idToken)
	}
	return nil, "", false, nil
}

func (m *mockAuthService) UpdateLocation(ctx context.Context, id uuid.UUID, req dto.UpdateLocationRequest) (*domain.User, error) {
	if m.updateLocationFn != nil {
		return m.updateLocationFn(ctx, id, req)
	}
	return nil, nil
}
```

Then append these tests to the same file:

```go
// ============================================================
// Tests: POST /api/auth/google
// ============================================================

func TestGoogleAuth_NewUserResponseShape(t *testing.T) {
	gin.SetMode(gin.TestMode)
	created := &domain.User{ID: uuid.New(), Email: "carlos@example.com", Name: "Carlos"}
	svc := &mockAuthService{
		loginWithGoogleFn: func(context.Context, string) (*domain.User, string, bool, error) {
			return created, "jwt-token", true, nil
		},
	}
	h := handler.NewAuthHandler(svc)

	router := gin.New()
	router.POST("/api/auth/google", h.GoogleAuth)

	body, _ := json.Marshal(map[string]string{"id_token": "google-id-token"})
	req := httptest.NewRequest(http.MethodPost, "/api/auth/google", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d — body: %s", w.Code, w.Body.String())
	}

	var resp dto.GoogleAuthResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	if resp.Token != "jwt-token" {
		t.Errorf("expected token %q, got %q", "jwt-token", resp.Token)
	}
	if !resp.IsNewUser {
		t.Error("expected is_new_user=true — the web onboarding step depends on this flag")
	}
	if resp.User.Email != "carlos@example.com" {
		t.Errorf("expected email in the response, got %q", resp.User.Email)
	}
}

func TestGoogleAuth_ErrorStatusMapping(t *testing.T) {
	gin.SetMode(gin.TestMode)
	cases := []struct {
		name     string
		err      error
		wantCode int
		wantBody string
	}{
		{"invalid token", domain.ErrGoogleTokenInvalid, http.StatusUnauthorized, "google_token_invalid"},
		{"unverified email", domain.ErrGoogleEmailUnverified, http.StatusUnauthorized, "google_email_unverified"},
		{"banned", domain.ErrUserBanned, http.StatusForbidden, "user_banned"},
		{"sub mismatch", domain.ErrGoogleAccountMismatch, http.StatusConflict, "google_account_mismatch"},
		{"verify failed", domain.ErrGoogleSignInUnavailable, http.StatusBadGateway, "google_signin_unavailable"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			svc := &mockAuthService{
				loginWithGoogleFn: func(context.Context, string) (*domain.User, string, bool, error) {
					return nil, "", false, tc.err
				},
			}
			h := handler.NewAuthHandler(svc)
			router := gin.New()
			router.POST("/api/auth/google", h.GoogleAuth)

			body, _ := json.Marshal(map[string]string{"id_token": "t"})
			req := httptest.NewRequest(http.MethodPost, "/api/auth/google", bytes.NewReader(body))
			req.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()
			router.ServeHTTP(w, req)

			if w.Code != tc.wantCode {
				t.Errorf("expected %d, got %d", tc.wantCode, w.Code)
			}
			var errResp dto.ErrorResponse
			if err := json.Unmarshal(w.Body.Bytes(), &errResp); err != nil {
				t.Fatalf("invalid JSON: %v", err)
			}
			if errResp.Code != tc.wantBody {
				t.Errorf("expected code %q, got %q", tc.wantBody, errResp.Code)
			}
		})
	}
}

func TestGoogleAuth_MissingIDToken(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := handler.NewAuthHandler(&mockAuthService{})
	router := gin.New()
	router.POST("/api/auth/google", h.GoogleAuth)

	req := httptest.NewRequest(http.MethodPost, "/api/auth/google", bytes.NewReader([]byte(`{}`)))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for a missing id_token, got %d", w.Code)
	}
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && go test ./tests/ -run TestGoogleAuth -v`
Expected: FAIL to compile — `h.GoogleAuth undefined` and `dto.GoogleAuthResponse undefined`.

- [ ] **Step 3: Add the DTOs**

In `backend/internal/dto/auth_dto.go`, add after `AuthResponse` (line 42):

```go
// GoogleAuthRequest es el ID token que el botón de Google Identity Services
// obtiene en el navegador y nos manda para verificar server-side.
type GoogleAuthRequest struct {
	IDToken string `json:"id_token" binding:"required"`
}

// GoogleAuthResponse extiende AuthResponse con IsNewUser, que le dice al cliente
// si tiene que mostrar el paso de onboarding de ubicación.
type GoogleAuthResponse struct {
	User      UserResponse `json:"user"`
	Token     string       `json:"token"`
	IsNewUser bool         `json:"is_new_user"`
}

// UpdateLocationRequest — todos los campos son opcionales, pero lat y lng viajan
// como par: una sin la otra es una coordenada inválida, no un update parcial.
type UpdateLocationRequest struct {
	Latitude  *float64 `json:"latitude"`
	Longitude *float64 `json:"longitude"`
	City      string   `json:"city"`
}
```

- [ ] **Step 4: Add the handler**

In `backend/internal/handler/auth_handler.go`, add after `Login` (which ends at line 74):

```go
// GoogleAuth godoc
// POST /api/auth/google
// Público. Verifica un ID token de Google y devuelve una sesión nuestra.
func (h *AuthHandler) GoogleAuth(c *gin.Context) {
	var req dto.GoogleAuthRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, err)
		return
	}

	user, token, isNewUser, err := h.authService.LoginWithGoogle(c.Request.Context(), req.IDToken)
	if err != nil {
		switch {
		case errors.Is(err, domain.ErrGoogleTokenInvalid), errors.Is(err, domain.ErrGoogleEmailUnverified):
			writeError(c, http.StatusUnauthorized, err)
		case errors.Is(err, domain.ErrGoogleAccountMismatch):
			writeError(c, http.StatusConflict, err)
		case errors.Is(err, domain.ErrUserBanned):
			writeError(c, http.StatusForbidden, err)
		case errors.Is(err, domain.ErrGoogleSignInUnavailable):
			writeError(c, http.StatusBadGateway, err)
		default:
			writeError(c, http.StatusInternalServerError, domain.ErrInternal)
		}
		return
	}

	c.JSON(http.StatusOK, dto.GoogleAuthResponse{
		User:      dto.ToUserResponse(user),
		Token:     token,
		IsNewUser: isNewUser,
	})
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd backend && go test ./tests/ -run TestGoogleAuth -v`
Expected: PASS — 6 tests (3 top-level, 4 subtests inside the mapping table).

- [ ] **Step 6: Commit**

```bash
git add backend/internal/dto/auth_dto.go backend/internal/handler/auth_handler.go backend/tests/auth_handler_test.go
git commit -m "feat(auth): add POST /api/auth/google endpoint"
```

---

### Task 8: `PATCH /api/auth/me/location`

**Files:**
- Modify: `backend/internal/service/interfaces.go`
- Modify: `backend/internal/service/auth_service.go`
- Modify: `backend/internal/handler/auth_handler.go`
- Modify: `backend/internal/service/auth_google_test.go`

- [ ] **Step 1: Write the failing tests**

Append to `backend/internal/service/auth_google_test.go`:

```go
// ============================================================
// Tests: UpdateLocation
// ============================================================

func floatPtr(v float64) *float64 { return &v }

func TestUpdateLocation_SetsCoordinates(t *testing.T) {
	existing := &domain.User{ID: uuid.New(), Email: "carlos@example.com"}
	repo := &mockUserRepo{user: existing}
	svc := newGoogleAuthSvc(repo, nil)

	user, err := svc.UpdateLocation(context.Background(), existing.ID, dto.UpdateLocationRequest{
		Latitude:  floatPtr(-34.9011),
		Longitude: floatPtr(-56.1645),
	})

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if user.Latitude == nil || *user.Latitude != -34.9011 {
		t.Errorf("expected latitude -34.9011, got %v", user.Latitude)
	}
	if user.Longitude == nil || *user.Longitude != -56.1645 {
		t.Errorf("expected longitude -56.1645, got %v", user.Longitude)
	}
}

func TestUpdateLocation_SetsCityOnly(t *testing.T) {
	existing := &domain.User{ID: uuid.New(), Email: "carlos@example.com"}
	repo := &mockUserRepo{user: existing}
	svc := newGoogleAuthSvc(repo, nil)

	user, err := svc.UpdateLocation(context.Background(), existing.ID, dto.UpdateLocationRequest{City: "  Montevideo  "})

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if user.City != "Montevideo" {
		t.Errorf("expected trimmed city %q, got %q", "Montevideo", user.City)
	}
	if user.Latitude != nil {
		t.Error("expected latitude to stay nil when only a city is sent")
	}
}

func TestUpdateLocation_RejectsEmptyPayload(t *testing.T) {
	existing := &domain.User{ID: uuid.New()}
	repo := &mockUserRepo{user: existing}
	svc := newGoogleAuthSvc(repo, nil)

	_, err := svc.UpdateLocation(context.Background(), existing.ID, dto.UpdateLocationRequest{})

	if !errors.Is(err, domain.ErrInvalidInput) {
		t.Fatalf("expected ErrInvalidInput, got %v", err)
	}
}

func TestUpdateLocation_RejectsHalfCoordinate(t *testing.T) {
	existing := &domain.User{ID: uuid.New()}
	repo := &mockUserRepo{user: existing}
	svc := newGoogleAuthSvc(repo, nil)

	_, err := svc.UpdateLocation(context.Background(), existing.ID, dto.UpdateLocationRequest{Latitude: floatPtr(-34.9)})

	if !errors.Is(err, domain.ErrInvalidInput) {
		t.Fatalf("expected ErrInvalidInput for latitude without longitude, got %v", err)
	}
}

func TestUpdateLocation_RejectsOutOfRange(t *testing.T) {
	existing := &domain.User{ID: uuid.New()}
	repo := &mockUserRepo{user: existing}
	svc := newGoogleAuthSvc(repo, nil)

	_, err := svc.UpdateLocation(context.Background(), existing.ID, dto.UpdateLocationRequest{
		Latitude:  floatPtr(120),
		Longitude: floatPtr(-56.1645),
	})

	if !errors.Is(err, domain.ErrInvalidInput) {
		t.Fatalf("expected ErrInvalidInput for latitude 120, got %v", err)
	}
}
```

Add `"lost-pets/internal/dto"` to that file's import block.

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && go test ./internal/service/ -run TestUpdateLocation -v`
Expected: FAIL to compile — `svc.UpdateLocation undefined`.

- [ ] **Step 3: Add to the interface**

In `backend/internal/service/interfaces.go`, inside `AuthService`, add after `UpdateProfile`:

```go
	// UpdateLocation setea la ubicación del usuario (coordenadas y/o ciudad).
	// lat y lng son un par: mandar una sin la otra es ErrInvalidInput.
	UpdateLocation(ctx context.Context, id uuid.UUID, req dto.UpdateLocationRequest) (*domain.User, error)
```

- [ ] **Step 4: Implement it**

Append to `backend/internal/service/auth_service.go`:

```go
// UpdateLocation setea la ubicación del usuario. Reutilizable: la usa el
// onboarding de Google, pero cualquier usuario puede completar su ubicación
// después desde el perfil.
func (s *authService) UpdateLocation(ctx context.Context, id uuid.UUID, req dto.UpdateLocationRequest) (*domain.User, error) {
	city := strings.TrimSpace(req.City)

	// lat/lng son un par — una sola es una coordenada rota, no un update parcial.
	if (req.Latitude == nil) != (req.Longitude == nil) {
		return nil, domain.ErrInvalidInput
	}
	if req.Latitude == nil && city == "" {
		return nil, domain.ErrInvalidInput
	}
	if req.Latitude != nil {
		if *req.Latitude < -90 || *req.Latitude > 90 || *req.Longitude < -180 || *req.Longitude > 180 {
			return nil, domain.ErrInvalidInput
		}
	}

	user, err := s.userRepo.GetByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if req.Latitude != nil {
		user.Latitude = req.Latitude
		user.Longitude = req.Longitude
	}
	if city != "" {
		user.City = city
	}
	if err := s.userRepo.Update(ctx, user); err != nil {
		return nil, err
	}
	return user, nil
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd backend && go test ./internal/service/ -run TestUpdateLocation -v`
Expected: PASS — 5 tests.

- [ ] **Step 6: Add the handler**

In `backend/internal/handler/auth_handler.go`, add after `GoogleAuth`:

```go
// UpdateLocation godoc
// PATCH /api/auth/me/location
// Protegido. Setea coordenadas y/o ciudad del usuario autenticado.
func (h *AuthHandler) UpdateLocation(c *gin.Context) {
	rawID, exists := c.Get("userID")
	if !exists {
		writeError(c, http.StatusUnauthorized, domain.ErrUnauthorized)
		return
	}
	id, ok := rawID.(uuid.UUID)
	if !ok {
		writeError(c, http.StatusUnauthorized, domain.ErrUnauthorized)
		return
	}

	var req dto.UpdateLocationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, err)
		return
	}

	user, err := h.authService.UpdateLocation(c.Request.Context(), id, req)
	if err != nil {
		switch {
		case errors.Is(err, domain.ErrInvalidInput):
			writeError(c, http.StatusBadRequest, err)
		case errors.Is(err, domain.ErrUserNotFound):
			writeError(c, http.StatusNotFound, err)
		default:
			writeError(c, http.StatusInternalServerError, domain.ErrInternal)
		}
		return
	}

	c.JSON(http.StatusOK, dto.ToUserResponse(user))
}
```

- [ ] **Step 7: Run the whole backend suite**

Run: `cd backend && go build ./... && go test ./internal/... ./tests/...`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add backend/internal/service backend/internal/handler/auth_handler.go
git commit -m "feat(auth): add PATCH /api/auth/me/location"
```

---

### Task 9: Config and dependency injection

**Files:**
- Modify: `backend/config/config.go`
- Modify: `backend/internal/app/router.go:118` and the route blocks around lines 265 and 326
- Modify: `backend/.env.example`

- [ ] **Step 1: Add the config field**

In `backend/config/config.go`, add to the `Config` struct (near the other third-party keys, around `JinaAPIKey` at line 48):

```go
	// GoogleClientID is the OAuth 2.0 Web client id, checked as the ID token
	// audience. Empty disables Google Sign-In: POST /api/auth/google then
	// answers 502 google_signin_unavailable instead of trusting an unchecked token.
	GoogleClientID string
```

and to the struct literal in `Load()` (near line 93):

```go
		GoogleClientID: getEnv("GOOGLE_CLIENT_ID", ""),
```

- [ ] **Step 2: Wire the verifier**

In `backend/internal/app/router.go`, replace line 118:

```go
	authService := service.NewAuthService(userRepo, cfg.JWTSecret, cloudinaryClient, fosterHomeService, nil)
```

with:

```go
	// googleVerifier nil = feature deshabilitada (ver config.GoogleClientID).
	// NewVerifier RECHAZA un clientID vacío a propósito: con audience vacío,
	// idtoken.Validate se saltea el chequeo de audiencia y aceptaría cualquier
	// token de Google. Por eso el nil viene de no llamarlo, nunca de llamarlo mal.
	var googleVerifier googleauth.Verifier
	if cfg.GoogleClientID != "" {
		v, err := googleauth.NewVerifier(cfg.GoogleClientID)
		if err != nil {
			// Inalcanzable con la guarda de arriba, pero fallar acá es preferible
			// a arrancar con un verificador permisivo.
			log.Fatalf("[app] no se pudo construir el verificador de Google: %v", err)
		}
		googleVerifier = v
	} else {
		log.Println("[app] GOOGLE_CLIENT_ID no configurado — el login con Google responderá 502 google_signin_unavailable")
	}
	authService := service.NewAuthService(userRepo, cfg.JWTSecret, cloudinaryClient, fosterHomeService, googleVerifier)
```

Add `"lost-pets/pkg/googleauth"` to the imports (and `"log"` if it is not already there).

- [ ] **Step 3: Register the routes**

In `backend/internal/app/router.go`, after line 266 (`public.POST("/auth/login", ...)`), add:

```go
		// Mismo rate limit que login/register: es una puerta de autenticación.
		public.POST("/auth/google", authRateLimit, authHandler.GoogleAuth)
```

After line 326 (`protected.POST("/auth/me/photo", ...)`), add:

```go
		protected.PATCH("/auth/me/location", authHandler.UpdateLocation)
```

- [ ] **Step 4: Document the env var**

In `backend/.env.example`, add:

```
# Google Sign-In — OAuth 2.0 Web client id from Google Cloud Console.
# Verified as the ID token audience. NO client secret is needed (GIS is a
# public client). Leave empty to disable Google Sign-In.
GOOGLE_CLIENT_ID=
```

- [ ] **Step 5: Verify build and tests**

Run: `cd backend && go build ./... && go test ./internal/... ./tests/...`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/config/config.go backend/internal/app/router.go backend/.env.example
git commit -m "feat(auth): wire Google Sign-In routes and verifier"
```

---

### Task 10: Shared types and API client

**Files:**
- Modify: `frontend/packages/shared/types/index.ts`
- Modify: `frontend/packages/shared/api/client.ts`

- [ ] **Step 1: Add the types**

In `frontend/packages/shared/types/index.ts`, add after `AuthResponse` (line 389):

```ts
/**
 * Response of POST /api/auth/google. `is_new_user` tells the UI whether to show
 * the location onboarding step — it is the only signal that the account was
 * created by this very request.
 */
export interface GoogleAuthResponse {
  token: string;
  user: User;
  is_new_user: boolean;
}
```

and after `LoginRequest` (line 422):

```ts
/** Payload of PATCH /api/auth/me/location. latitude and longitude travel as a pair. */
export interface UpdateLocationRequest {
  latitude?: number;
  longitude?: number;
  city?: string;
}
```

- [ ] **Step 2: Add the client methods**

In `frontend/packages/shared/api/client.ts`, add after `login` (which ends at line 228):

```ts
  async loginWithGoogle(idToken: string): Promise<GoogleAuthResponse> {
    const resp = await this.request<GoogleAuthResponse>('POST', '/api/auth/google', { id_token: idToken });
    this.token = resp.token;
    return resp;
  }
```

and after `updateMe`:

```ts
  async updateMyLocation(data: UpdateLocationRequest): Promise<User> {
    return this.request<User>('PATCH', '/api/auth/me/location', data);
  }
```

Add `GoogleAuthResponse` and `UpdateLocationRequest` to the `import type { ... } from '../types'` list at the top of the file.

- [ ] **Step 3: Verify types compile**

Run: `cd frontend/packages/web && pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/packages/shared/types/index.ts frontend/packages/shared/api/client.ts
git commit -m "feat(auth): add Google Sign-In types and API client methods"
```

---

### Task 11: `AuthContext.loginWithGoogle`

**Files:**
- Modify: `frontend/packages/web/src/context/AuthContext.tsx`

- [ ] **Step 1: Extend the context type**

In `frontend/packages/web/src/context/AuthContext.tsx`, add to `AuthContextType` (lines 7-17), after `register`:

```ts
  /** Resolves to `is_new_user` so the caller can decide whether to run onboarding. */
  loginWithGoogle: (idToken: string) => Promise<boolean>;
```

- [ ] **Step 2: Implement it**

Add after the `register` function (which ends at line 115):

```tsx
  const loginWithGoogle = async (idToken: string): Promise<boolean> => {
    const resp = await apiClient.loginWithGoogle(idToken);
    setToken(resp.token);
    setUser(resp.user);
    localStorage.setItem('token', resp.token);
    localStorage.setItem('user', JSON.stringify(resp.user));
    // Registrar token FCM — en background, falla silenciosamente
    registerWebPushToken();
    return resp.is_new_user;
  };
```

- [ ] **Step 3: Expose it on the provider**

Replace the provider value (line 136):

```tsx
    <AuthContext.Provider value={{ user, token, login, register, loginWithGoogle, logout, refreshUser, isAuthenticated: !!token, isAdmin: user?.is_admin ?? false, isLoading }}>
```

- [ ] **Step 4: Verify**

Run: `cd frontend/packages/web && pnpm tsc --noEmit && pnpm vitest run src/context/AuthContext.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/packages/web/src/context/AuthContext.tsx
git commit -m "feat(auth): add loginWithGoogle to AuthContext"
```

---

### Task 12: `GoogleSignInButton` component

**Files:**
- Create: `frontend/packages/web/src/types/google-gis.d.ts`
- Create: `frontend/packages/web/src/components/auth/GoogleSignInButton.tsx`
- Create: `frontend/packages/web/src/components/auth/GoogleSignInButton.test.tsx`

- [ ] **Step 1: Add the ambient types**

Create `frontend/packages/web/src/types/google-gis.d.ts`:

```ts
/**
 * Minimal ambient types for Google Identity Services (accounts.google.com/gsi/client).
 * Only the surface we actually call — the full library is loaded at runtime from
 * Google's CDN, so there is no npm package to import types from.
 */
interface GoogleCredentialResponse {
  credential: string;
  select_by?: string;
}

interface GoogleIdConfiguration {
  client_id: string;
  callback: (response: GoogleCredentialResponse) => void;
  auto_select?: boolean;
  cancel_on_tap_outside?: boolean;
}

interface GoogleButtonConfiguration {
  type?: 'standard' | 'icon';
  theme?: 'outline' | 'filled_blue' | 'filled_black';
  size?: 'small' | 'medium' | 'large';
  text?: 'signin_with' | 'signup_with' | 'continue_with' | 'signin';
  shape?: 'rectangular' | 'pill' | 'circle' | 'square';
  width?: number;
  locale?: string;
}

interface GoogleAccountsId {
  initialize: (config: GoogleIdConfiguration) => void;
  renderButton: (parent: HTMLElement, options: GoogleButtonConfiguration) => void;
  cancel: () => void;
}

interface Window {
  google?: {
    accounts: {
      id: GoogleAccountsId;
    };
  };
}
```

- [ ] **Step 2: Write the failing test**

Create `frontend/packages/web/src/components/auth/GoogleSignInButton.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { GoogleSignInButton, __resetGisLoaderForTests } from './GoogleSignInButton';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'es' } }),
}));

const initialize = vi.fn();
const renderButton = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  __resetGisLoaderForTests();
  vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id.apps.googleusercontent.com');
  // Pretend the GIS script is already on the page.
  window.google = { accounts: { id: { initialize, renderButton, cancel: vi.fn() } } };
});

afterEach(() => {
  vi.unstubAllEnvs();
  delete window.google;
});

describe('GoogleSignInButton', () => {
  it('initialises GIS with the configured client id and renders the button', async () => {
    render(<GoogleSignInButton onCredential={vi.fn()} onError={vi.fn()} />);

    await waitFor(() => expect(initialize).toHaveBeenCalledTimes(1));
    expect(initialize.mock.calls[0][0].client_id).toBe('test-client-id.apps.googleusercontent.com');
    expect(renderButton).toHaveBeenCalledTimes(1);
  });

  it('forwards the credential to onCredential', async () => {
    const onCredential = vi.fn();
    render(<GoogleSignInButton onCredential={onCredential} onError={vi.fn()} />);

    await waitFor(() => expect(initialize).toHaveBeenCalled());
    // Simulate Google invoking the callback we registered.
    initialize.mock.calls[0][0].callback({ credential: 'fake-id-token' });

    expect(onCredential).toHaveBeenCalledWith('fake-id-token');
  });

  it('renders nothing when VITE_GOOGLE_CLIENT_ID is not configured', () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', '');
    const { container } = render(<GoogleSignInButton onCredential={vi.fn()} onError={vi.fn()} />);

    expect(container).toBeEmptyDOMElement();
    expect(initialize).not.toHaveBeenCalled();
  });

  it('shows a placeholder until GIS is ready', () => {
    render(<GoogleSignInButton onCredential={vi.fn()} onError={vi.fn()} />);
    expect(screen.getByText('auth:google.loading')).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd frontend/packages/web && pnpm vitest run src/components/auth/GoogleSignInButton.test.tsx`
Expected: FAIL — `Failed to resolve import "./GoogleSignInButton"`.

- [ ] **Step 4: Write the component**

Create `frontend/packages/web/src/components/auth/GoogleSignInButton.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

const GIS_SRC = 'https://accounts.google.com/gsi/client';

/**
 * The GIS script is a page-level singleton: loading it twice would register two
 * sets of globals. This promise is shared by every instance of the button.
 */
let gisPromise: Promise<void> | null = null;

function loadGis(): Promise<void> {
  if (gisPromise) return gisPromise;
  gisPromise = new Promise<void>((resolve, reject) => {
    if (window.google?.accounts?.id) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = GIS_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => {
      // Reset so a later mount can retry — a one-off network blip should not
      // disable the button for the rest of the session.
      gisPromise = null;
      reject(new Error('gis_load_failed'));
    };
    document.head.appendChild(script);
  });
  return gisPromise;
}

/** Test-only: clears the module-level singleton between test cases. */
export function __resetGisLoaderForTests() {
  gisPromise = null;
}

interface GoogleSignInButtonProps {
  /** Receives the Google ID token. The parent decides what to do with it. */
  onCredential: (idToken: string) => void;
  /** Called when the GIS script cannot be loaded at all. */
  onError: (message: string) => void;
}

/**
 * Renders Google's official sign-in button. Deliberately knows nothing about our
 * API or auth context: it produces an ID token and hands it up.
 *
 * Renders nothing when VITE_GOOGLE_CLIENT_ID is unset, so an environment without
 * Google configured simply shows the email/password form on its own.
 */
export function GoogleSignInButton({ onCredential, onError }: GoogleSignInButtonProps) {
  const { t } = useTranslation(['auth']);
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
  const containerRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  // GIS initialize() runs once, but the callbacks close over page state that
  // changes between renders — refs keep the latest without re-initialising.
  const onCredentialRef = useRef(onCredential);
  onCredentialRef.current = onCredential;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;

    loadGis()
      .then(() => {
        if (cancelled || !containerRef.current || !window.google) return;
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: (response) => onCredentialRef.current(response.credential),
          cancel_on_tap_outside: true,
        });
        window.google.accounts.id.renderButton(containerRef.current, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          text: 'continue_with',
          shape: 'pill',
          width: 320,
        });
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) onErrorRef.current(t('auth:google.loadError'));
      });

    return () => {
      cancelled = true;
    };
  }, [clientId, t]);

  if (!clientId) return null;

  return (
    <div className="flex flex-col items-center gap-2">
      <div ref={containerRef} data-testid="google-signin-button" />
      {!ready && (
        <p className="text-sm text-gray-400 dark:text-gray-500">{t('auth:google.loading')}</p>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd frontend/packages/web && pnpm vitest run src/components/auth/GoogleSignInButton.test.tsx`
Expected: PASS — 4 tests.

- [ ] **Step 6: Commit**

```bash
git add frontend/packages/web/src/types/google-gis.d.ts frontend/packages/web/src/components/auth/GoogleSignInButton.tsx frontend/packages/web/src/components/auth/GoogleSignInButton.test.tsx
git commit -m "feat(auth): add GoogleSignInButton component"
```

---

### Task 13: `LocationOnboardingStep` component

**Files:**
- Create: `frontend/packages/web/src/components/auth/LocationOnboardingStep.tsx`
- Create: `frontend/packages/web/src/components/auth/LocationOnboardingStep.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/packages/web/src/components/auth/LocationOnboardingStep.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LocationOnboardingStep } from './LocationOnboardingStep';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'es' } }),
}));

const updateMyLocation = vi.fn();
vi.mock('@shared/api/client', () => ({
  apiClient: {
    updateMyLocation: (...args: unknown[]) => updateMyLocation(...args),
  },
}));

function mockGeolocation(impl: Partial<Geolocation>) {
  Object.defineProperty(navigator, 'geolocation', { value: impl, configurable: true });
}

beforeEach(() => {
  vi.clearAllMocks();
  updateMyLocation.mockResolvedValue({});
});

describe('LocationOnboardingStep', () => {
  it('saves coordinates when the browser grants permission', async () => {
    mockGeolocation({
      getCurrentPosition: (success) =>
        success({ coords: { latitude: -34.9011, longitude: -56.1645 } } as GeolocationPosition),
    });
    const onDone = vi.fn();
    const user = userEvent.setup();

    render(<LocationOnboardingStep onDone={onDone} />);
    await user.click(screen.getByRole('button', { name: 'auth:location.useMyLocation' }));

    await waitFor(() =>
      expect(updateMyLocation).toHaveBeenCalledWith({ latitude: -34.9011, longitude: -56.1645 }),
    );
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it('falls back to the city field when permission is denied', async () => {
    mockGeolocation({
      getCurrentPosition: (_success, error) =>
        error?.({ code: 1, message: 'denied' } as GeolocationPositionError),
    });
    const user = userEvent.setup();

    render(<LocationOnboardingStep onDone={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'auth:location.useMyLocation' }));

    await waitFor(() => expect(screen.getByLabelText('auth:location.cityLabel')).toBeInTheDocument());
    expect(screen.getByText('auth:location.permissionDenied')).toBeInTheDocument();
  });

  it('saves the city typed in the fallback field', async () => {
    mockGeolocation({
      getCurrentPosition: (_success, error) =>
        error?.({ code: 1, message: 'denied' } as GeolocationPositionError),
    });
    const onDone = vi.fn();
    const user = userEvent.setup();

    render(<LocationOnboardingStep onDone={onDone} />);
    await user.click(screen.getByRole('button', { name: 'auth:location.useMyLocation' }));
    await waitFor(() => screen.getByLabelText('auth:location.cityLabel'));

    await user.type(screen.getByLabelText('auth:location.cityLabel'), 'Montevideo');
    await user.click(screen.getByRole('button', { name: 'auth:location.saveCity' }));

    await waitFor(() => expect(updateMyLocation).toHaveBeenCalledWith({ city: 'Montevideo' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it('is skippable and never calls the API when skipped', async () => {
    mockGeolocation({ getCurrentPosition: vi.fn() });
    const onDone = vi.fn();
    const user = userEvent.setup();

    render(<LocationOnboardingStep onDone={onDone} />);
    await user.click(screen.getByRole('button', { name: 'auth:location.skip' }));

    expect(updateMyLocation).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalled();
  });

  it('still finishes when saving fails — location is never a blocker', async () => {
    updateMyLocation.mockRejectedValue(new Error('network'));
    mockGeolocation({
      getCurrentPosition: (success) =>
        success({ coords: { latitude: -34.9, longitude: -56.1 } } as GeolocationPosition),
    });
    const onDone = vi.fn();
    const user = userEvent.setup();

    render(<LocationOnboardingStep onDone={onDone} />);
    await user.click(screen.getByRole('button', { name: 'auth:location.useMyLocation' }));

    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend/packages/web && pnpm vitest run src/components/auth/LocationOnboardingStep.test.tsx`
Expected: FAIL — `Failed to resolve import "./LocationOnboardingStep"`.

- [ ] **Step 3: Write the component**

Create `frontend/packages/web/src/components/auth/LocationOnboardingStep.tsx`:

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@shared/api/client';

interface LocationOnboardingStepProps {
  /** Called once the step is over — saved, skipped, or failed. Never blocks. */
  onDone: () => void;
}

/**
 * Post-signup location capture for brand-new Google users.
 *
 * Geolocation is the point of the product (PostGIS proximity search), but it is
 * NOT a gate: the user model allows null coordinates, so anyone who skips ends up
 * exactly like a user who never set a location and can fix it later from their
 * profile. A failed save also finishes the step — a network error at this point
 * must not trap someone inside a signup they already completed.
 */
export function LocationOnboardingStep({ onDone }: LocationOnboardingStepProps) {
  const { t } = useTranslation(['auth', 'common']);
  const [showCityFallback, setShowCityFallback] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [city, setCity] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async (payload: { latitude?: number; longitude?: number; city?: string }) => {
    setSaving(true);
    try {
      await apiClient.updateMyLocation(payload);
    } catch {
      // Intencional: la ubicación es opcional. Un fallo acá no puede dejar al
      // usuario atrapado en un alta que ya se completó.
    } finally {
      setSaving(false);
      onDone();
    }
  };

  const requestGeolocation = () => {
    if (!navigator.geolocation) {
      setShowCityFallback(true);
      return;
    }
    setSaving(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setSaving(false);
        void save({ latitude: position.coords.latitude, longitude: position.coords.longitude });
      },
      () => {
        setSaving(false);
        setPermissionDenied(true);
        setShowCityFallback(true);
      },
      { timeout: 10_000 },
    );
  };

  return (
    <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-6 space-y-4">
      <div>
        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">{t('auth:location.title')}</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('auth:location.subtitle')}</p>
      </div>

      {permissionDenied && (
        <p className="bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 text-sm p-3 rounded-lg">
          {t('auth:location.permissionDenied')}
        </p>
      )}

      {!showCityFallback && (
        <button
          type="button"
          onClick={requestGeolocation}
          disabled={saving}
          className="w-full bg-primary text-white font-bold py-3 rounded-lg hover:bg-primary-dark transition-colors disabled:opacity-60"
        >
          {saving ? t('common:loading') : t('auth:location.useMyLocation')}
        </button>
      )}

      {showCityFallback && (
        <div>
          <label htmlFor="onboarding-city" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            {t('auth:location.cityLabel')}
          </label>
          <input
            id="onboarding-city"
            type="text"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder={t('auth:location.cityPlaceholder')}
            className="w-full border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
          />
          <button
            type="button"
            onClick={() => void save({ city: city.trim() })}
            disabled={saving || city.trim() === ''}
            className="w-full mt-3 bg-primary text-white font-bold py-3 rounded-lg hover:bg-primary-dark transition-colors disabled:opacity-60"
          >
            {saving ? t('common:loading') : t('auth:location.saveCity')}
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={onDone}
        disabled={saving}
        className="w-full text-sm text-gray-500 dark:text-gray-400 hover:underline disabled:opacity-60"
      >
        {t('auth:location.skip')}
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend/packages/web && pnpm vitest run src/components/auth/LocationOnboardingStep.test.tsx`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/packages/web/src/components/auth/LocationOnboardingStep.tsx frontend/packages/web/src/components/auth/LocationOnboardingStep.test.tsx
git commit -m "feat(auth): add location onboarding step for new Google users"
```

---

### Task 14: Wire the flow into LoginPage and RegisterPage

Both pages need the identical logic, so it lives in one hook.

**Files:**
- Create: `frontend/packages/web/src/hooks/useGoogleSignIn.ts`
- Modify: `frontend/packages/web/src/pages/LoginPage.tsx`
- Modify: `frontend/packages/web/src/pages/RegisterPage.tsx`

- [ ] **Step 1: Write the shared hook**

Create `frontend/packages/web/src/hooks/useGoogleSignIn.ts`:

```ts
import { useCallback, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { getErrorMessage } from '@shared/utils/apiErrors';
import { useAuth } from '../context/AuthContext';

/**
 * The Google sign-in flow shared by LoginPage and RegisterPage: exchange the ID
 * token for a session, then either drop the user into the app (returning user)
 * or show the location onboarding step (brand-new user).
 */
export function useGoogleSignIn() {
  const { t } = useTranslation(['auth', 'common', 'errors']);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { loginWithGoogle } = useAuth();

  const [googleError, setGoogleError] = useState('');
  const [googleLoading, setGoogleLoading] = useState(false);
  const [showLocationStep, setShowLocationStep] = useState(false);

  const goToApp = useCallback(() => {
    navigate(searchParams.get('returnUrl') || '/', { replace: true });
  }, [navigate, searchParams]);

  const handleCredential = useCallback(
    async (idToken: string) => {
      setGoogleError('');
      setGoogleLoading(true);
      try {
        const isNewUser = await loginWithGoogle(idToken);
        if (isNewUser) {
          setShowLocationStep(true);
          return;
        }
        goToApp();
      } catch (err) {
        setGoogleError(getErrorMessage(err, t));
      } finally {
        setGoogleLoading(false);
      }
    },
    [loginWithGoogle, goToApp, t],
  );

  return {
    googleError,
    setGoogleError,
    googleLoading,
    showLocationStep,
    handleCredential,
    /** Called by LocationOnboardingStep when it is saved or skipped. */
    finishOnboarding: goToApp,
  };
}
```

- [ ] **Step 2: Wire LoginPage**

In `frontend/packages/web/src/pages/LoginPage.tsx`, add the imports:

```tsx
import { GoogleSignInButton } from '../components/auth/GoogleSignInButton';
import { LocationOnboardingStep } from '../components/auth/LocationOnboardingStep';
import { useGoogleSignIn } from '../hooks/useGoogleSignIn';
```

Add the hook right after the existing `useAuth()` line (line 19):

```tsx
  const {
    googleError,
    setGoogleError,
    googleLoading,
    showLocationStep,
    handleCredential,
    finishOnboarding,
  } = useGoogleSignIn();
```

Replace the whole `return (...)` block's inner content so the Google block sits above the form. That is, between the `</div>` closing the header (line 69) and the `<form` (line 71), insert:

```tsx
      {showLocationStep ? (
        <LocationOnboardingStep onDone={finishOnboarding} />
      ) : (
        <>
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-6 mb-4">
            {googleError && (
              <div className="bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 text-sm p-3 rounded-lg mb-3">
                {googleError}
              </div>
            )}
            <GoogleSignInButton onCredential={handleCredential} onError={setGoogleError} />
          </div>

          <div className="flex items-center gap-3 mb-4">
            <span className="h-px flex-1 bg-gray-200 dark:bg-gray-700" />
            <span className="text-xs uppercase tracking-wide text-gray-400 dark:text-gray-500">
              {t('auth:google.divider')}
            </span>
            <span className="h-px flex-1 bg-gray-200 dark:bg-gray-700" />
          </div>
```

and close the fragment after the existing `</form>` (line 133):

```tsx
        </>
      )}
```

Also disable the submit button while Google is in flight — replace the `disabled={loading}` on the submit button (line 122) with:

```tsx
          disabled={loading || googleLoading}
```

- [ ] **Step 3: Wire RegisterPage identically**

Apply the same three edits to `frontend/packages/web/src/pages/RegisterPage.tsx`: the same imports, the same hook call after its `useAuth()` line, and the same Google block + divider inserted between the header `</div>` (before line 82's `<form`) and the form, with the fragment closed after the form's `</form>`. The submit button gets `disabled={loading || googleLoading}` the same way.

- [ ] **Step 4: Verify the existing page tests still pass**

The existing `LoginPage.test.tsx` mocks `../context/AuthContext`; the new hook calls `useAuth()` from that same module, so the mock must now also return `loginWithGoogle`. Update the mock in `frontend/packages/web/src/pages/LoginPage.test.tsx`:

```tsx
const mockLogin = vi.fn();
const mockLoginWithGoogle = vi.fn();
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    login: mockLogin,
    loginWithGoogle: mockLoginWithGoogle,
    isAuthenticated: false,
    isLoading: false,
  }),
}));
```

Apply the same addition to `RegisterPage.test.tsx` if it mocks the context the same way.

Run: `cd frontend/packages/web && pnpm tsc --noEmit && pnpm vitest run src/pages/LoginPage.test.tsx src/pages/RegisterPage.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/packages/web/src/hooks/useGoogleSignIn.ts frontend/packages/web/src/pages/LoginPage.tsx frontend/packages/web/src/pages/RegisterPage.tsx frontend/packages/web/src/pages/LoginPage.test.tsx frontend/packages/web/src/pages/RegisterPage.test.tsx
git commit -m "feat(auth): add Google sign-in to login and register pages"
```

---

### Task 15: i18n strings (es / en / pt)

`auth` and `errors` are **shared** namespaces (`frontend/packages/shared/i18n/locales/*.json`), already registered in `web/src/i18n/index.ts` — so rule #21 needs no new registration here. Adding them to the shared file also means mobile inherits the strings when its own iteration lands.

**Files:**
- Modify: `frontend/packages/shared/i18n/locales/es.json`
- Modify: `frontend/packages/shared/i18n/locales/en.json`
- Modify: `frontend/packages/shared/i18n/locales/pt.json`

- [ ] **Step 1: Add the Spanish strings**

In `frontend/packages/shared/i18n/locales/es.json`, add inside the `auth` object (next to `login` and `register`):

```json
    "google": {
      "divider": "o",
      "loading": "Cargando…",
      "loadError": "No pudimos cargar el acceso con Google. Revisá tu conexión."
    },
    "location": {
      "title": "Completá tu ubicación",
      "subtitle": "La usamos para mostrarte mascotas perdidas cerca tuyo. Podés completarla después.",
      "useMyLocation": "Usar mi ubicación",
      "permissionDenied": "No pudimos acceder a tu ubicación. Escribí tu ciudad.",
      "cityLabel": "Ciudad",
      "cityPlaceholder": "Ej: Montevideo",
      "saveCity": "Guardar ciudad",
      "skip": "Omitir por ahora"
    },
```

and inside the `errors` object:

```json
    "google_token_invalid": "No pudimos validar tu cuenta de Google. Intentá de nuevo.",
    "google_email_unverified": "Tu email de Google no está verificado. Verificalo en Google e intentá de nuevo.",
    "google_signin_unavailable": "El inicio de sesión con Google no está disponible en este momento.",
    "google_account_mismatch": "Este email ya está vinculado a otra cuenta de Google.",
```

- [ ] **Step 2: Add the English strings**

In `frontend/packages/shared/i18n/locales/en.json`, inside `auth`:

```json
    "google": {
      "divider": "or",
      "loading": "Loading…",
      "loadError": "We couldn't load Google sign-in. Check your connection."
    },
    "location": {
      "title": "Set your location",
      "subtitle": "We use it to show you lost pets near you. You can set it later.",
      "useMyLocation": "Use my location",
      "permissionDenied": "We couldn't access your location. Type your city instead.",
      "cityLabel": "City",
      "cityPlaceholder": "e.g. Montevideo",
      "saveCity": "Save city",
      "skip": "Skip for now"
    },
```

and inside `errors`:

```json
    "google_token_invalid": "We couldn't validate your Google account. Please try again.",
    "google_email_unverified": "Your Google email isn't verified. Verify it with Google and try again.",
    "google_signin_unavailable": "Google sign-in is unavailable right now.",
    "google_account_mismatch": "This email is already linked to a different Google account.",
```

- [ ] **Step 3: Add the Portuguese strings**

In `frontend/packages/shared/i18n/locales/pt.json`, inside `auth`:

```json
    "google": {
      "divider": "ou",
      "loading": "Carregando…",
      "loadError": "Não foi possível carregar o acesso com Google. Verifique sua conexão."
    },
    "location": {
      "title": "Defina sua localização",
      "subtitle": "Nós a usamos para mostrar animais perdidos perto de você. Você pode definir depois.",
      "useMyLocation": "Usar minha localização",
      "permissionDenied": "Não conseguimos acessar sua localização. Digite sua cidade.",
      "cityLabel": "Cidade",
      "cityPlaceholder": "Ex: Montevidéu",
      "saveCity": "Salvar cidade",
      "skip": "Pular por enquanto"
    },
```

and inside `errors`:

```json
    "google_token_invalid": "Não foi possível validar sua conta do Google. Tente novamente.",
    "google_email_unverified": "Seu e-mail do Google não está verificado. Verifique no Google e tente novamente.",
    "google_signin_unavailable": "O login com Google não está disponível no momento.",
    "google_account_mismatch": "Este e-mail já está vinculado a outra conta do Google.",
```

- [ ] **Step 4: Verify the JSON is valid and keys line up**

Run:

```bash
cd frontend/packages/shared/i18n/locales && node -e "
const es=require('./es.json'), en=require('./en.json'), pt=require('./pt.json');
for (const g of ['google','location']) {
  const k = Object.keys(es.auth[g]).sort().join(',');
  for (const [name, j] of [['en',en],['pt',pt]]) {
    const other = Object.keys(j.auth[g]).sort().join(',');
    if (k !== other) { console.error('MISMATCH auth.'+g+' in '+name); process.exit(1); }
  }
}
for (const c of ['google_token_invalid','google_email_unverified','google_signin_unavailable','google_account_mismatch']) {
  for (const [name, j] of [['es',es],['en',en],['pt',pt]]) {
    if (!j.errors[c]) { console.error('MISSING errors.'+c+' in '+name); process.exit(1); }
  }
}
console.log('i18n OK');
"
```

Expected: `i18n OK`.

- [ ] **Step 5: Commit**

```bash
git add frontend/packages/shared/i18n/locales
git commit -m "feat(auth): add Google Sign-In i18n strings (es/en/pt)"
```

---

### Task 16: CSP, env example, and full verification

**Files:**
- Modify: `frontend/packages/web/vercel.json`
- Modify: `frontend/packages/web/.env.example` (create it if it does not exist)

- [ ] **Step 1: Open the CSP for GIS**

In `frontend/packages/web/vercel.json`, replace the `Content-Security-Policy` value with (three changes: `script-src` gains the GIS origin, `connect-src` gains it too, and a brand-new `frame-src` directive is added because GIS renders in an iframe and `default-src 'self'` would otherwise block it):

```
default-src 'self'; script-src 'self' https://www.gstatic.com https://accounts.google.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://unpkg.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https://res.cloudinary.com https://*.tile.openstreetmap.org https://raw.githubusercontent.com https://cdnjs.cloudflare.com https://lh3.googleusercontent.com; connect-src 'self' https://searchpet.onrender.com wss://searchpet.onrender.com https://accounts.google.com https://tfhub.dev https://storage.googleapis.com https://fcmregistrations.googleapis.com https://firebaseinstallations.googleapis.com; frame-src https://accounts.google.com; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests
```

> `img-src` also gains `https://lh3.googleusercontent.com`: Google's button and One Tap card render the account avatar directly from that host.
>
> **Rule #23 reminder:** a mis-calibrated CSP does not break the build — it breaks the feature at runtime. This must be verified in a Vercel preview with the console open, not assumed from a green build.

- [ ] **Step 2: Document the web env var**

In `frontend/packages/web/.env.example` (create it if missing, mirroring any existing entries such as `VITE_API_URL`):

```
# Google Sign-In — the SAME OAuth 2.0 Web client id the backend verifies as the
# token audience. Public by design (GIS is a public client, there is no secret).
# Leave empty to hide the Google button entirely.
VITE_GOOGLE_CLIENT_ID=
```

- [ ] **Step 3: Run the full verification suite**

```bash
cd backend && go build ./... && go test ./internal/... ./tests/...
cd ../frontend/packages/web && pnpm tsc --noEmit && pnpm build && pnpm test:run
```

Expected: Go tests PASS; `tsc` clean; `vite build` succeeds; web + shared Vitest suites PASS (`test:run` chains both — rule #14).

- [ ] **Step 4: Commit**

```bash
git add frontend/packages/web/vercel.json frontend/packages/web/.env.example
git commit -m "feat(auth): allow Google Identity Services in the CSP"
```

---

## Owner setup (blocks manual verification only — not any code task)

Not a code step; the tasks above all build and test without it. Needed before the flow can be exercised end-to-end.

- [ ] Google Cloud Console → **APIs & Services → Credentials → Create OAuth client ID → Web application**.
- [ ] **Authorized JavaScript origins:** `https://searchpet.vercel.app`, `http://localhost:3000`, plus the Vercel preview origin used for the CSP check.
- [ ] **OAuth consent screen:** app name, Rastro logo, scopes `openid email profile` — all non-sensitive, so no Google review is required.
- [ ] Copy the client id into: Render env `GOOGLE_CLIENT_ID`, Vercel env `VITE_GOOGLE_CLIENT_ID`, and the local `.env` files. **No client secret exists or is needed.**
- [ ] Cost: **$0**.

## Manual verification checklist (Vercel preview, console open)

- [ ] Google button renders on `/login` and `/register`; the email/password form is unchanged and still works.
- [ ] Console shows **no** `Refused to load/connect/frame` CSP errors.
- [ ] Brand-new Google account → lands on the location step; "Use my location" saves; denying permission reveals the city field; "Skip for now" still enters the app.
- [ ] Sign out, sign in with the same Google account → goes straight into the app, no location step.
- [ ] Register locally with email `X`, sign out, then sign in with Google using the same `X` → same account (check the user id), and the original password still works afterwards.
- [ ] New Google user's avatar appears and its URL is on `res.cloudinary.com`, not `googleusercontent.com`.

---

## Changes made during execution

Every one came from an adversarial review that found a real defect. The code
reflects all of them; the task bodies above mostly do not.

| Change | Commit | Why |
|---|---|---|
| Migration 000018 made order-agnostic | `4afe16d` | `testdb` runs AutoMigrate BEFORE the SQL migrations — the opposite of prod — so `ADD COLUMN IF NOT EXISTS … NOT NULL DEFAULT ''` was a no-op there and the test schema drifted from prod. |
| `NewVerifier` returns `(Verifier, error)`, rejects an empty client id | `6cddb1c` | `idtoken.Validate` **skips the audience check entirely** on an empty audience (`validate.go:160`), so one unset env var would accept a token minted for any app — takeover via the auto-link path. |
| `Verify` validates `iss` and requires `sub`/`email` | `6cddb1c` | The library never reads `Issuer`, and requires no claim to be present. Our comment claimed otherwise. |
| Error renamed to `ErrGoogleSignInUnavailable` | `c445300` | It fires on an unset `GOOGLE_CLIENT_ID`, not a network failure; the old message sent people chasing the wrong problem. |
| Pre-hijacking defence + `google_account_mismatch` + `IsVerified` | `e0caa64` | `Register` requires no proof of email ownership, so an attacker could plant an account on a victim's address and inherit it when the victim signed in with Google. Linking an **unverified** local account now discards its password. |
| Case-insensitive `GetByEmail` + migration 000019 | `dc1ee8e` | `Register` stores the email as typed; Google normalises to lowercase — a user registered as `Carlos@x.com` was getting a **second account**. |
| Avatar host allowlist + per-hop redirect re-validation | `2479100` | The allowlist only checked where the request *started*; `http.DefaultClient` follows redirects with no re-validation. |
| `authService.storage` → `ImageUploader` | `2479100` | The concrete Cloudinary type made the whole download/upload path untestable; the interface already existed in the same package. |
| Service-account tokens rejected | `fc7274f` | Google IAM `generateIdToken` mints tokens with a caller-chosen audience — unauthenticated account creation bypassing the OTP. |
| Avatar import moved off the response path | `9b5f91f` | It was adding up to 10s to first-login latency for a cosmetic feature. |
| `GoogleAuthPanel` extracted | `695a4f3` | 35 lines of JSX were duplicated across the two auth pages. |
| Auth guard excludes `googleLoading` + `showLocationStep`; CSP gains `style-src` | `cbc8078` | **The location onboarding step was unreachable dead code** — the "already signed in" guard fired first. And GIS needs FOUR CSP directives; both documents listed three. |
| Tests for the location endpoint, `AuthContext`, and Google repo lookups | `43640fa` | Gaps the pre-PR audit found against spec §7. |
| `google_id` declared `not null` on the GORM tag | `9160eb4` | Verified against a real Postgres: **AutoMigrate DROPS a NOT NULL the struct tag does not declare**, so the migration's `SET NOT NULL` was a no-op in production too. |
| Navbar renders the profile photo; `AuthContext` reconciles with `GET /auth/me` | `d1abcc0` | Found in live testing. The navbar only ever drew the name's initial, and the cached user was stale because the avatar import finishes AFTER the token is issued. |
| GIS reloaded with `?hl=` on language change | `ae07ea7` | Found in live testing. **GIS fixes its language when the script loads** — `renderButton`'s `locale` option does not re-localize an already-loaded client, so the first render's language was frozen. |
| New handlers use `ErrBindingFailed` | *this commit* | A malformed body returned `internal_error` plus a raw English validator string instead of the translatable `binding_failed` the rest of the handlers use (rule #11). |

---

## Self-review

**Spec coverage** — every section of `2026-07-22-google-signin-design.md` maps to a task:

| Spec section | Task |
|---|---|
| §4 Data model + SQL migration | 1 |
| §5.1 `POST /api/auth/google` | 7, 9 |
| §5.2 `LoginWithGoogle` flow (all 5 steps) | 5 |
| §5.3 `GoogleTokenVerifier` interface | 4 |
| §5.4 `PATCH /api/auth/me/location` | 8, 9 |
| §5.5 Error table | 3, 7 |
| §6 Web GIS button, divider, form kept | 12, 14 |
| §6 `is_new_user` → onboarding, skippable | 11, 13, 14 |
| §6 Photo resolved server-side | 6 |
| §6 i18n es/en/pt | 15 |
| §6.1 CSP | 16 |
| §7 Testing (backend service, handler, web, CSP manual) | 5, 7, 8, 12, 13, 16 |
| §8 Setup | Owner setup checklist |
| §9 Security — link only on `email_verified` | 5 (`TestLoginWithGoogle_UnverifiedEmailDoesNotLink`) |

**Deviations from the spec, all documented in "Design notes locked in before coding":** the GORM tag on `GoogleID` (plain `index`, not `uniqueIndex`), the partial-index name, the `PasswordHash` tag edit forced by AutoMigrate ordering, and the 401-vs-502 mapping.

**Type consistency:** `googleauth.Verifier` / `googleauth.Claims` are used under those exact names in Tasks 4, 5 and 9. `LoginWithGoogle(ctx, idToken) (*domain.User, string, bool, error)` has the same signature in the interface (Task 5 Step 3), the implementation (Step 5), and the handler mock (Task 7). `UpdateLocation(ctx, id, dto.UpdateLocationRequest) (*domain.User, error)` matches across Tasks 7, 8. `GoogleAuthResponse` fields (`user`, `token`, `is_new_user`) match between the Go DTO (Task 7) and the TS type (Task 10). `loginWithGoogle` returns `Promise<boolean>` in Tasks 11 and 14. `importGooglePhoto(ctx, uuid.UUID, string) string` matches between the Task 5 stub and the Task 6 implementation.
