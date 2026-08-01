# Email Verification Daily Quota — Implementation Plan (Part B)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cap email-verification OTPs at 5 per account and 250 per channel in a rolling 24-hour window, so the `email` and `password_reset` channels can no longer starve each other inside Brevo's shared 300/day plan.

**Architecture:** `VerificationService.SendOTP` gains the same two-tier check the reset flow already ships — a per-account cap and a channel-wide reserve, both counted with the existing `CountSince` over `QuotaWindow`. Unlike `/forgot`, this endpoint sits behind `protected`, so it tells the truth: three distinct `429` codes instead of one opaque swallow. The legacy `gin.H{"error":...}` shape on the existing cooldown response is repaired in the same pass, and the clients read `Retry-After` to drive the countdown they already render.

**Tech Stack:** Go 1.25 + Gin + GORM (backend), PostgreSQL (real-Postgres tests via `tests/testdb`), React + Vite (web), React Native + Expo (mobile), i18next (shared locales).

**Source spec:** `docs/superpowers/specs/2026-07-31-email-verification-quota-design.md`, Part B.

---

## Branch and delivery

Part A is **PR #116, open, not merged**, on branch `docs/email-verification-quota`. Part B stacks on top of it.

```bash
git fetch origin
git checkout docs/email-verification-quota
git pull --ff-only
git checkout -b feat/email-verification-quota
```

Open the PR with `--base docs/email-verification-quota`.

**When A merges (squash), rebase B before anything else** — rule #30: the squash gives A a new SHA, so a branch stacked on the old commits re-proposes all of Part A.

```bash
git fetch origin
git rebase --onto origin/main docs/email-verification-quota feat/email-verification-quota
git log --oneline origin/main..HEAD   # must show ONLY Part B commits
git push --force-with-lease
```

GitHub retargets the PR base to `main` automatically once A merges.

---

## File Structure

| File | Responsibility |
|---|---|
| `backend/internal/repository/interfaces.go` | Add `OldestCreatedAtSince` to `VerificationTokenRepository` |
| `backend/internal/repository/verification_token_repository.go` | Implement it over the existing `(channel, created_at)` index |
| `backend/internal/domain/errors.go` | Three new sentinels + their `ErrorCodes` entries |
| `backend/internal/service/interfaces.go` | `ErrRateLimitOTP` unwraps to a sentinel; new `ErrOTPDailyLimit`; delete dead `ErrNoPhoneOnFile` |
| `backend/internal/service/verification_service.go` | The two caps, and the send-failure path stops burning quota |
| `backend/internal/handler/verification_handler.go` | Honest `429`s in `{code,message}` + `Retry-After` |
| `backend/tests/verification_service_test.go` | Unit coverage of both caps (mocks) |
| `backend/tests/verification_token_repository_test.go` | `OldestCreatedAtSince` + the sweeper guard extended to `email` |
| `backend/tests/e2e/verification_quota_flow_test.go` | The cap against real Postgres (rule #34) |
| `frontend/packages/shared/api/client.ts` | `ApiError.retryAfter` parsed from the header |
| `frontend/packages/shared/i18n/locales/{es,en,pt}.json` | Three `errors` keys |
| `frontend/packages/web/src/pages/ProfilePage.tsx` | Seed the countdown from `retryAfter` |
| `frontend/packages/mobile/app/(tabs)/profile.tsx` | Same, mobile |
| `CLAUDE.md` | Close the open gap row; rule for the disjoint budgets |

---

## Task 1: `OldestCreatedAtSince` on the token repository

The per-account `429` promises a real `Retry-After`: seconds until the oldest of the five leaves the window. That needs the oldest `created_at` inside the window. No new table and no new index — migration `000022` already covers `(channel, created_at)`.

**Files:**
- Modify: `backend/internal/repository/interfaces.go:188` (after `CountSince`)
- Modify: `backend/internal/repository/verification_token_repository.go` (after `CountSince`, ~line 95)
- Test: `backend/tests/verification_token_repository_test.go`

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/verification_token_repository_test.go`:

```go
func TestVerificationTokenRepository_OldestCreatedAtSince(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	tokenRepo := repository.NewVerificationTokenRepository(gormDB)
	ctx := context.Background()

	user := newTestUser(t, userRepo)
	other := newTestUser(t, userRepo)
	now := time.Now()

	mint := func(userID uuid.UUID, channel string, createdAt time.Time) {
		t.Helper()
		tok := &domain.VerificationToken{
			UserID:    userID,
			Channel:   channel,
			CodeHash:  "hash",
			ExpiresAt: createdAt.Add(10 * time.Minute),
		}
		if err := tokenRepo.Create(ctx, tok); err != nil {
			t.Fatalf("Create: %v", err)
		}
		if err := gormDB.Model(&domain.VerificationToken{}).
			Where("id = ?", tok.ID).UpdateColumn("created_at", createdAt).Error; err != nil {
			t.Fatalf("backdate: %v", err)
		}
	}

	since := now.Add(-24 * time.Hour)

	// Sin filas en la ventana: nil, sin error.
	got, err := tokenRepo.OldestCreatedAtSince(ctx, &user.ID, "email", since)
	if err != nil {
		t.Fatalf("OldestCreatedAtSince (vacio): %v", err)
	}
	if got != nil {
		t.Fatalf("sin filas want nil, got %v", got)
	}

	mint(user.ID, "email", now.Add(-5*time.Hour))
	mint(user.ID, "email", now.Add(-20*time.Hour)) // la mas vieja DENTRO de la ventana
	mint(user.ID, "email", now.Add(-30*time.Hour)) // fuera de la ventana: no cuenta
	mint(user.ID, "password_reset", now.Add(-23*time.Hour))
	mint(other.ID, "email", now.Add(-23*time.Hour))

	got, err = tokenRepo.OldestCreatedAtSince(ctx, &user.ID, "email", since)
	if err != nil {
		t.Fatalf("OldestCreatedAtSince: %v", err)
	}
	if got == nil {
		t.Fatal("want la fila de -20h, got nil")
	}
	if diff := got.Sub(now.Add(-20 * time.Hour)); diff > time.Second || diff < -time.Second {
		t.Fatalf("oldest por cuenta = %v, want ~%v — un canal u otro usuario se colo",
			got, now.Add(-20*time.Hour))
	}

	// userID nil mide el CANAL entero: la de otro usuario a -23h es mas vieja.
	got, err = tokenRepo.OldestCreatedAtSince(ctx, nil, "email", since)
	if err != nil {
		t.Fatalf("OldestCreatedAtSince (canal): %v", err)
	}
	if got == nil {
		t.Fatal("canal: want la fila de -23h, got nil")
	}
	if diff := got.Sub(now.Add(-23 * time.Hour)); diff > time.Second || diff < -time.Second {
		t.Fatalf("oldest del canal = %v, want ~%v", got, now.Add(-23*time.Hour))
	}
}
```

- [ ] **Step 2: Run it and confirm it fails to compile**

```bash
cd backend
DATABASE_URL="postgres://lostpets:lostpets@localhost:5433/lostpets_test?sslmode=disable" \
  go test ./tests/ -run TestVerificationTokenRepository_OldestCreatedAtSince -count=1 > /tmp/t1.log 2>&1; echo "EXIT=$?"
```

Expected: non-zero exit, `tokenRepo.OldestCreatedAtSince undefined`.

**Never verify with a grep over the output** — rule #41. The exit code is the verdict.

- [ ] **Step 3: Add the interface method**

In `backend/internal/repository/interfaces.go`, immediately after the `CountSince` declaration:

```go
	// OldestCreatedAtSince retorna el created_at mas viejo del canal dentro de la
	// ventana, o nil si no hay ninguno. Con userID nil mide el CANAL entero.
	//
	// Existe para que el 429 del tope diario pueda decir un Retry-After real —
	// cuanto falta para que la fila mas vieja salga de la ventana— en vez de un
	// numero inventado.
	OldestCreatedAtSince(ctx context.Context, userID *uuid.UUID, channel string, since time.Time) (*time.Time, error)
```

- [ ] **Step 4: Implement it**

In `backend/internal/repository/verification_token_repository.go`, right after `CountSince`:

```go
// OldestCreatedAtSince retorna el created_at mas viejo del canal dentro de la
// ventana, o nil si no hay filas. Con userID nil mide el canal entero.
//
// No filtra por `used` a proposito, igual que CountSince: el cupo cuenta codigos
// EMITIDOS, y un token canjeado ya gasto su mail.
func (r *postgresVerificationTokenRepository) OldestCreatedAtSince(ctx context.Context, userID *uuid.UUID, channel string, since time.Time) (*time.Time, error) {
	q := r.db.WithContext(ctx).
		Model(&domain.VerificationToken{}).
		Where("channel = ? AND created_at >= ?", channel, since)
	if userID != nil {
		q = q.Where("user_id = ?", *userID)
	}

	var oldest time.Time
	err := q.Order("created_at ASC").Limit(1).Pluck("created_at", &oldest).Error
	if err != nil {
		return nil, err
	}
	if oldest.IsZero() {
		return nil, nil
	}
	return &oldest, nil
}
```

- [ ] **Step 5: Run the test**

```bash
cd backend
DATABASE_URL="postgres://lostpets:lostpets@localhost:5433/lostpets_test?sslmode=disable" \
  go test ./tests/ -run TestVerificationTokenRepository_OldestCreatedAtSince -count=1 -v > /tmp/t1.log 2>&1; echo "EXIT=$?"
```

Expected: `EXIT=0`, `--- PASS`.

`Pluck` into a non-slice leaves the zero value when no row matches; that is what the `IsZero` branch reads. If the driver errors instead, the test's first assertion catches it.

- [ ] **Step 6: Commit**

```bash
git add backend/internal/repository/interfaces.go backend/internal/repository/verification_token_repository.go backend/tests/verification_token_repository_test.go
git commit -m "feat(repo): OldestCreatedAtSince para el Retry-After del cupo diario"
```

---

## Task 2: The sweeper guard extends to the `email` channel

Rule #40: this table has an hourly hard-delete reaper, so any query that counts history over a window must be tested **with the reaper running**. The existing guard covers `password_reset` only — the channel that is about to grow a cap is uncovered.

**Files:**
- Modify: `backend/tests/verification_token_repository_test.go:305-347`

- [ ] **Step 1: Turn the existing guard into a per-channel table test**

Replace the whole `TestVerificationTokenRepository_DeleteExpiredRespetaLaVentanaDeConteo` function with:

```go
func TestVerificationTokenRepository_DeleteExpiredRespetaLaVentanaDeConteo(t *testing.T) {
	// Rule #40: los DOS canales cuentan historia sobre una tabla con un reaper
	// horario. Si el sweeper se lleva la ventana, el tope diario del canal es
	// ficcion — que es exactamente lo que paso con password_reset la primera vez.
	for _, channel := range []string{"password_reset", "email"} {
		t.Run(channel, func(t *testing.T) {
			gormDB := testdb.SetupTestDB(t)
			userRepo := repository.NewUserRepository(gormDB)
			tokenRepo := repository.NewVerificationTokenRepository(gormDB)
			ctx := context.Background()

			user := newTestUser(t, userRepo)
			now := time.Now()

			mint := func(createdAt time.Time) {
				t.Helper()
				tok := &domain.VerificationToken{
					UserID:    user.ID,
					Channel:   channel,
					CodeHash:  "hash",
					ExpiresAt: createdAt.Add(10 * time.Minute), // vencido hace rato
				}
				if err := tokenRepo.Create(ctx, tok); err != nil {
					t.Fatalf("Create: %v", err)
				}
				if err := gormDB.Model(&domain.VerificationToken{}).
					Where("id = ?", tok.ID).UpdateColumn("created_at", createdAt).Error; err != nil {
					t.Fatalf("backdate: %v", err)
				}
			}

			mint(now.Add(-23 * time.Hour)) // DENTRO de la ventana de conteo
			mint(now.Add(-25 * time.Hour)) // fuera: puede irse

			if _, err := tokenRepo.DeleteExpired(ctx); err != nil {
				t.Fatalf("DeleteExpired: %v", err)
			}

			// La de 23h tiene que seguir contando DESPUES de la barrida. Si el sweeper
			// se la lleva, el usuario recupera cupo cada hora y el tope diario es ficcion.
			got, err := tokenRepo.CountSince(ctx, &user.ID, channel, now.Add(-24*time.Hour))
			if err != nil {
				t.Fatalf("CountSince: %v", err)
			}
			if got != 1 {
				t.Fatalf("count tras la barrida = %d, want 1 — el sweeper se comio la ventana de conteo", got)
			}
		})
	}
}
```

- [ ] **Step 2: Run it**

```bash
cd backend
DATABASE_URL="postgres://lostpets:lostpets@localhost:5433/lostpets_test?sslmode=disable" \
  go test ./tests/ -run TestVerificationTokenRepository_DeleteExpiredRespetaLaVentanaDeConteo -count=1 -v > /tmp/t2.log 2>&1; echo "EXIT=$?"
```

Expected: `EXIT=0`, two subtests PASS (`password_reset`, `email`).

- [ ] **Step 3: Commit**

```bash
git add backend/tests/verification_token_repository_test.go
git commit -m "test(repo): el guard del sweeper cubre tambien el canal email"
```

---

## Task 3: Domain sentinels and their error codes

`writeError` derives the code with `domain.CodeFor`, so every new `429` needs a sentinel. Rule #11.

**Files:**
- Modify: `backend/internal/domain/errors.go:93-94` and `:223-224`

- [ ] **Step 1: Add the sentinels**

In `backend/internal/domain/errors.go`, next to `ErrOTPExpired` / `ErrOTPInvalid`:

```go
	ErrOTPExpired    = errors.New("otp_expired")
	ErrOTPInvalid    = errors.New("otp_invalid")
	// ErrOTPCooldown: el usuario pidio otro codigo dentro de los 60s. Distinto de
	// otp_daily_limit a proposito — "espera un minuto" y "terminaste por hoy" son
	// situaciones distintas para el usuario.
	ErrOTPCooldown = errors.New("otp_cooldown")
	// ErrOTPDailyLimit: la cuenta agoto sus codigos de la ventana de 24h.
	ErrOTPDailyLimit = errors.New("otp_daily_limit")
	// ErrOTPChannelUnavailable: la reserva del CANAL se agoto. No depende del
	// usuario que la recibe, asi que no lleva Retry-After: cualquier numero seria
	// una adivinanza.
	ErrOTPChannelUnavailable = errors.New("otp_channel_unavailable")
```

- [ ] **Step 2: Register the codes**

In the `ErrorCodes` map, next to the existing OTP entries:

```go
	ErrOTPExpired:            "otp_expired",
	ErrOTPInvalid:            "otp_invalid",
	ErrOTPCooldown:           "otp_cooldown",
	ErrOTPDailyLimit:         "otp_daily_limit",
	ErrOTPChannelUnavailable: "otp_channel_unavailable",
```

- [ ] **Step 3: Verify it compiles**

```bash
cd backend
go build ./... > /tmp/t3.log 2>&1; echo "EXIT=$?"
```

Expected: `EXIT=0`.

- [ ] **Step 4: Commit**

```bash
git add backend/internal/domain/errors.go
git commit -m "feat(domain): codigos de error para el cooldown y el cupo de OTP"
```

---

## Task 4: The service errors carry a code, and the dead SMS error goes

`ErrRateLimitOTP` currently returns Spanish prose from `Error()`, so `CodeFor` cannot resolve it and `writeError` would emit `internal_error`. Giving it an `Unwrap` fixes that without changing its shape. `ErrNoPhoneOnFile` is a Part A leftover: SMS is gone, nothing returns it any more.

**Files:**
- Modify: `backend/internal/service/interfaces.go:28-43`

- [ ] **Step 1: Rewrite the error block**

Replace lines 28–43 of `backend/internal/service/interfaces.go` with:

```go
// ErrRateLimitOTP es retornado cuando se pide un OTP dentro del cooldown de 60s.
// RetryAfter indica los segundos que el cliente debe esperar.
//
// Unwrap devuelve el sentinel para que writeError → domain.CodeFor resuelva
// `otp_cooldown`. Sin eso el handler emitiria `internal_error` y el frontend
// mostraria un mensaje generico (regla #11).
type ErrRateLimitOTP struct {
	RetryAfter int
}

func (e *ErrRateLimitOTP) Error() string { return domain.ErrOTPCooldown.Error() }

func (e *ErrRateLimitOTP) Unwrap() error { return domain.ErrOTPCooldown }

// ErrOTPDailyLimit es retornado cuando la CUENTA agoto sus codigos de la ventana.
// RetryAfter son los segundos hasta que el mas viejo salga de la ventana.
type ErrOTPDailyLimit struct {
	RetryAfter int
}

func (e *ErrOTPDailyLimit) Error() string { return domain.ErrOTPDailyLimit.Error() }

func (e *ErrOTPDailyLimit) Unwrap() error { return domain.ErrOTPDailyLimit }
```

Confirm `domain` is already imported in that file (it is — the interfaces reference `domain.User`, `domain.VerificationToken`, etc.).

- [ ] **Step 2: Find every reference to the deleted type**

```bash
cd backend
rg -n "ErrNoPhoneOnFile" .
```

Expected: exactly one hit, `internal/handler/verification_handler.go:110-114`, which Task 6 removes (the definition went away in Step 1). If anything else appears, it is live SMS code Part A missed — stop and report it rather than deleting blind.

- [ ] **Step 3: Commit (after Task 6 compiles the handler)**

This task and Task 6 land in one commit because the handler branch and the type are removed together. Proceed to Task 5.

---

## Task 5: The two caps in `SendOTP`

**Files:**
- Modify: `backend/internal/service/verification_service.go:19-23` (constants) and `:63-121` (`SendOTP`)
- Test: `backend/tests/verification_service_test.go`

- [ ] **Step 1: Write the failing tests**

First extend the mock in `backend/tests/verification_service_test.go` so it can be driven. Replace the `mockTokenRepo` struct and its `CountSince` method (lines 63–69 and 102–104) with:

```go
type mockTokenRepo struct {
	activeToken            *domain.VerificationToken
	incrementAttempts      int
	markUsedCalled         bool
	markAllUsedCalls       int
	markAllUsedExceptCalls int
	deleteByIDCalls        int
	// countByUser / countGlobal alimentan los dos topes diarios. Cero por
	// default, que es "sin cupo consumido".
	countByUser   int64
	countGlobal   int64
	countErr      error
	oldestCreated *time.Time
}
```

```go
func (m *mockTokenRepo) CountSince(_ context.Context, userID *uuid.UUID, _ string, _ time.Time) (int64, error) {
	if m.countErr != nil {
		return 0, m.countErr
	}
	if userID == nil {
		return m.countGlobal, nil
	}
	return m.countByUser, nil
}

func (m *mockTokenRepo) OldestCreatedAtSince(_ context.Context, _ *uuid.UUID, _ string, _ time.Time) (*time.Time, error) {
	return m.oldestCreated, nil
}
```

And make `DeleteByID` observable (replace line 98):

```go
func (m *mockTokenRepo) DeleteByID(ctx context.Context, id uuid.UUID) error {
	m.deleteByIDCalls++
	return nil
}
```

Now append the new tests:

```go
// ============================================================
// Cupo diario del canal email (parte B)
// ============================================================

func TestSendOTP_TopePorCuenta(t *testing.T) {
	ctx := context.Background()
	userID := uuid.New()
	oldest := time.Now().Add(-20 * time.Hour)

	tests := []struct {
		name        string
		countByUser int64
		wantBlocked bool
	}{
		{name: "cuarto pedido pasa", countByUser: 4, wantBlocked: false},
		{name: "sexto pedido se bloquea", countByUser: 5, wantBlocked: true},
		{name: "muy por encima tambien se bloquea", countByUser: 40, wantBlocked: true},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			userRepo := &mockUserRepo{user: &domain.User{ID: userID, Email: "a@b.com"}}
			tokenRepo := &mockTokenRepo{countByUser: tc.countByUser, oldestCreated: &oldest}
			svc := service.NewVerificationService(tokenRepo, userRepo, &noopMailer{}, nil)

			err := svc.SendOTP(ctx, userID, "email")

			var limitErr *service.ErrOTPDailyLimit
			if tc.wantBlocked {
				if !errors.As(err, &limitErr) {
					t.Fatalf("con %d codigos en la ventana want ErrOTPDailyLimit, got %v", tc.countByUser, err)
				}
				if limitErr.RetryAfter <= 0 {
					t.Fatalf("RetryAfter = %d, want > 0 — el 429 promete un numero real", limitErr.RetryAfter)
				}
				return
			}
			if err != nil {
				t.Fatalf("con %d codigos want nil, got %v", tc.countByUser, err)
			}
		})
	}
}

func TestSendOTP_ReservaDelCanal(t *testing.T) {
	ctx := context.Background()
	userID := uuid.New()
	userRepo := &mockUserRepo{user: &domain.User{ID: userID, Email: "a@b.com"}}
	// La cuenta esta MUY por debajo de su tope: lo que bloquea es el canal.
	tokenRepo := &mockTokenRepo{countByUser: 0, countGlobal: 250}
	svc := service.NewVerificationService(tokenRepo, userRepo, &noopMailer{}, nil)

	err := svc.SendOTP(ctx, userID, "email")

	if !errors.Is(err, domain.ErrOTPChannelUnavailable) {
		t.Fatalf("con la reserva agotada want ErrOTPChannelUnavailable, got %v", err)
	}
	// Sin Retry-After: depende de otros usuarios, cualquier numero seria una adivinanza.
	var limitErr *service.ErrOTPDailyLimit
	if errors.As(err, &limitErr) {
		t.Fatal("la reserva del canal no debe emitir ErrOTPDailyLimit — el usuario no agoto su cupo")
	}
}

func TestSendOTP_ConteoFallidoFallaCerrado(t *testing.T) {
	ctx := context.Background()
	userID := uuid.New()
	userRepo := &mockUserRepo{user: &domain.User{ID: userID, Email: "a@b.com"}}
	tokenRepo := &mockTokenRepo{countErr: errors.New("boom")}
	svc := service.NewVerificationService(tokenRepo, userRepo, &noopMailer{}, nil)

	if err := svc.SendOTP(ctx, userID, "email"); err == nil {
		t.Fatal("sin numero no hay tope: un error del conteo tiene que abortar el envio, no dejarlo pasar")
	}
}

func TestSendOTP_FalloDeEnvioBorraElToken(t *testing.T) {
	ctx := context.Background()
	userID := uuid.New()
	userRepo := &mockUserRepo{user: &domain.User{ID: userID, Email: "a@b.com"}}
	tokenRepo := &mockTokenRepo{}
	svc := service.NewVerificationService(tokenRepo, userRepo, &failingMailer{}, nil)

	if err := svc.SendOTP(ctx, userID, "email"); err == nil {
		t.Fatal("want error del proveedor, got nil")
	}
	// CountSince ignora `used`: marcar usado dejaria la fila gastando cupo diario
	// por un codigo que nunca salio. Tres caidas de Brevo dejarian al usuario sin
	// verificar 24h sin haber recibido nada.
	if tokenRepo.deleteByIDCalls != 1 {
		t.Fatalf("DeleteByID llamado %d veces, want 1 — el token fallido tiene que BORRARSE, no marcarse usado", tokenRepo.deleteByIDCalls)
	}
	if tokenRepo.markUsedCalled {
		t.Fatal("MarkUsed no debe usarse en el fallo de envio: la fila seguiria contando para el cupo")
	}
}
```

Add the two mailer doubles at the bottom of the file if the existing ones do not already cover these shapes (check first with `rg -n "noopMailer|failingMailer" backend/tests/verification_service_test.go`):

```go
type noopMailer struct{}

func (noopMailer) SendOTP(ctx context.Context, to, code string) error { return nil }

type failingMailer struct{}

func (failingMailer) SendOTP(ctx context.Context, to, code string) error {
	return errors.New("brevo returned status 401")
}
```

If `mailer.Mailer` declares more methods than `SendOTP`, add them to both doubles as no-ops — check with `rg -n "type Mailer interface" -A 10 backend/pkg/mailer/mailer.go`.

- [ ] **Step 2: Run them and watch them fail**

```bash
cd backend
DATABASE_URL="postgres://lostpets:lostpets@localhost:5433/lostpets_test?sslmode=disable" \
  go test ./tests/ -run 'TestSendOTP_' -count=1 -v > /tmp/t5.log 2>&1; echo "EXIT=$?"
```

Expected: non-zero. `service.ErrOTPDailyLimit` resolves (Task 4 added it) but no cap exists, so `TestSendOTP_TopePorCuenta` fails on the blocked cases and `TestSendOTP_FalloDeEnvioBorraElToken` fails on `deleteByIDCalls = 0`.

- [ ] **Step 3: Add the constants**

In `backend/internal/service/verification_service.go`, extend the `const` block:

```go
const (
	otpTTL         = 10 * time.Minute
	otpRateLimit   = 60 * time.Second
	otpMaxAttempts = 5

	// ChannelEmail es el canal de verificacion de email dentro de la tabla
	// compartida verification_tokens.
	ChannelEmail = "email"

	// emailVerificationDailyMax es el tope de codigos por CUENTA en QuotaWindow.
	//
	// Cinco y no los tres de la recuperacion porque esto es onboarding: el usuario
	// esta esperando del otro lado y la friccion aca cuesta un alta.
	emailVerificationDailyMax = 5

	// emailVerificationGlobalDailyMax es la reserva del CANAL en QuotaWindow.
	//
	// 250 + los 50 de password_reset = los 300 diarios del plan de Brevo. Los dos
	// presupuestos son DISJUNTOS: ningun canal puede matar de hambre al otro, y
	// juntos no pueden exceder lo que el proveedor acepta. Antes de esto la
	// justificacion de "deja 250 para verificacion" no la hacia cumplir nadie.
	//
	// El tope no crea una caida: hace visible una inevitable. Hoy, a los 300,
	// Brevo simplemente empieza a rechazar y el fallo es casi mudo.
	emailVerificationGlobalDailyMax = 250
)
```

`QuotaWindow` already lives in this package (`password_reset_service.go:87`) and derives from `repository.TokenRetention` — do **not** declare a second window here. Rule #40: two constants for one invariant is how the cap became fiction the first time.

- [ ] **Step 4: Insert the caps into `SendOTP`**

In `backend/internal/service/verification_service.go`, after the cooldown block (the one ending in `return &ErrRateLimitOTP{RetryAfter: retryAfter}`) and **before** `generateOTPCode()`:

```go
	// El cooldown de arriba acota la FRECUENCIA (uno por minuto); esto acota el
	// VOLUMEN. Sin tope, esperar el minuto igual permite 1440 mails por dia.
	//
	// A diferencia de /forgot, este endpoint esta detras de `protected`: no hay
	// secreto de existencia de cuenta que defender, asi que responde la verdad en
	// vez de tragarse el fallo.
	since := time.Now().Add(-QuotaWindow)

	userCount, err := s.tokenRepo.CountSince(ctx, &userID, channel, since)
	if err != nil {
		// Falla CERRADO: sin numero no hay tope, y abrir la puerta ante un error
		// del conteo convierte cualquier hipo de la base en via libre.
		log.Printf("[verification] per-account quota count failed for user %s: %v", userID, err)
		return err
	}
	if userCount >= emailVerificationDailyMax {
		log.Printf("[verification] daily cap reached for user %s (%d/%d)", userID, userCount, emailVerificationDailyMax)
		return &ErrOTPDailyLimit{RetryAfter: s.secondsUntilWindowFrees(ctx, &userID, channel, since)}
	}

	globalCount, err := s.tokenRepo.CountSince(ctx, nil, channel, since)
	if err != nil {
		log.Printf("[verification] global quota count failed: %v", err)
		return err
	}
	if globalCount >= emailVerificationGlobalDailyMax {
		// INCIDENTE, no rutina: a partir de aca ningun usuario nuevo puede
		// verificar su email hasta que corra la ventana. Tiene que ser greppable.
		log.Printf("[verification] ALERT: global daily reserve exhausted (%d/%d) — email verification is disabled until the window rolls",
			globalCount, emailVerificationGlobalDailyMax)
		return domain.ErrOTPChannelUnavailable
	}
```

Then add the helper at the bottom of the file, next to `hashOTPCode`:

```go
// secondsUntilWindowFrees calcula cuanto falta para que el codigo mas viejo de la
// ventana salga de ella, que es cuando la cuenta recupera un cupo.
//
// Ante cualquier problema devuelve la ventana entera: es un Retry-After
// conservador, nunca uno optimista que invite a reintentar antes de tiempo.
func (s *verificationService) secondsUntilWindowFrees(ctx context.Context, userID *uuid.UUID, channel string, since time.Time) int {
	oldest, err := s.tokenRepo.OldestCreatedAtSince(ctx, userID, channel, since)
	if err != nil || oldest == nil {
		return int(QuotaWindow.Seconds())
	}
	remaining := time.Until(oldest.Add(QuotaWindow))
	if remaining <= 0 {
		return 1
	}
	return int(remaining.Seconds()) + 1
}
```

- [ ] **Step 5: Stop burning quota on a failed send**

Still in `SendOTP`, in the `if sendErr != nil` block, replace the `MarkUsed` call:

```go
		// SECURITY: sendErr solo contiene el status del proveedor, nunca el codigo OTP.
		log.Printf("[verification] %s send failed for user %s: %v", channel, userID, sendErr)

		// BORRAR, no marcar usado: CountSince ignora `used`, asi que una fila
		// marcada seguiria gastando cupo diario por un codigo que nunca salio.
		// Tres 401 de Brevo dejarian al usuario sin poder verificar durante 24h
		// sin haber recibido un solo mail. Mismo defecto que ya se cerro en la
		// recuperacion de contrasena (8155d1c).
		if delErr := s.tokenRepo.DeleteByID(ctx, token.ID); delErr != nil {
			log.Printf("[verification] failed to delete token after send failure: %v", delErr)
		}
```

- [ ] **Step 6: Run the tests**

```bash
cd backend
DATABASE_URL="postgres://lostpets:lostpets@localhost:5433/lostpets_test?sslmode=disable" \
  go test ./tests/ -run 'TestSendOTP_' -count=1 -v > /tmp/t5.log 2>&1; echo "EXIT=$?"
```

Expected: `EXIT=0`, every subtest PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/internal/service/verification_service.go backend/internal/service/interfaces.go backend/tests/verification_service_test.go
git commit -m "feat(auth): cupo diario por cuenta y reserva de canal para la verificacion por email"
```

---

## Task 6: Honest `429`s in the handler

`verification_handler.go:103-106` answers the cooldown with `gin.H{"error": "rate limit excedido", "retry_after": N}` — rule #11 violation, and the reason that `429` renders today as a generic failure. The new caps must not copy the broken shape, so the existing one is corrected here.

**Files:**
- Modify: `backend/internal/handler/verification_handler.go:98-124`
- Test: `backend/tests/verification_handler_test.go` (check whether it exists first: `ls backend/tests/verification_handler_test.go`)

- [ ] **Step 1: Write the failing test**

Create or append to `backend/tests/verification_handler_test.go`:

```go
package tests

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"

	"github.com/gin-gonic/gin"
	"lost-pets/internal/domain"
	"lost-pets/internal/handler"
	"lost-pets/internal/service"
)

// El 429 del cooldown devolvia {error, retry_after} en vez de {code, message}:
// getErrorMessage busca errors:{code} y sin code mostraba un mensaje generico.
func TestVerificationHandler_SendErrorsUsanCodeMessage(t *testing.T) {
	gin.SetMode(gin.TestMode)

	tests := []struct {
		name           string
		err            error
		wantCode       string
		wantRetryAfter string
	}{
		{
			name:           "cooldown",
			err:            &service.ErrRateLimitOTP{RetryAfter: 42},
			wantCode:       "otp_cooldown",
			wantRetryAfter: "42",
		},
		{
			name:           "tope por cuenta",
			err:            &service.ErrOTPDailyLimit{RetryAfter: 3600},
			wantCode:       "otp_daily_limit",
			wantRetryAfter: "3600",
		},
		{
			name:     "reserva del canal",
			err:      domain.ErrOTPChannelUnavailable,
			wantCode: "otp_channel_unavailable",
			// Sin Retry-After: depende de otros usuarios.
			wantRetryAfter: "",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(w)
			c.Request = httptest.NewRequest(http.MethodPost, "/api/verification/send-email", nil)

			handler.ExportedHandleSendError(c, tc.err)

			if w.Code != http.StatusTooManyRequests {
				t.Fatalf("status = %d, want 429", w.Code)
			}
			var body struct {
				Code    string `json:"code"`
				Message string `json:"message"`
			}
			if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
				t.Fatalf("body no es JSON: %v (%s)", err, w.Body.String())
			}
			if body.Code != tc.wantCode {
				t.Fatalf("code = %q, want %q — regla #11: {code,message}, nunca {error}", body.Code, tc.wantCode)
			}
			if body.Message == "" {
				t.Fatal("message vacio")
			}
			if got := w.Header().Get("Retry-After"); got != tc.wantRetryAfter {
				t.Fatalf("Retry-After = %q, want %q", got, tc.wantRetryAfter)
			}
			if tc.wantRetryAfter != "" {
				if _, err := strconv.Atoi(tc.wantRetryAfter); err != nil {
					t.Fatalf("Retry-After tiene que ser segundos enteros: %v", err)
				}
			}
		})
	}
}
```

The test needs a seam into the unexported method. Add it to `backend/internal/handler/verification_handler.go`:

```go
// ExportedHandleSendError expone handleSendError para los tests del paquete
// tests, que vive afuera. El mapeo de estos tres 429 es contrato con el
// frontend, no detalle interno.
func ExportedHandleSendError(c *gin.Context, err error) {
	(&VerificationHandler{}).handleSendError(c, err)
}
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd backend
DATABASE_URL="postgres://lostpets:lostpets@localhost:5433/lostpets_test?sslmode=disable" \
  go test ./tests/ -run TestVerificationHandler_SendErrorsUsanCodeMessage -count=1 -v > /tmp/t6.log 2>&1; echo "EXIT=$?"
```

Expected: non-zero — the cooldown subtest reports `code = ""`.

- [ ] **Step 3: Rewrite `handleSendError`**

Replace lines 98–124 of `backend/internal/handler/verification_handler.go` with:

```go
// handleSendError centraliza el mapeo de errores del endpoint de envio.
//
// Los tres 429 son deliberadamente distintos: "espera un minuto", "terminaste
// por hoy" y "la plataforma se quedo sin presupuesto" son situaciones distintas
// para el usuario y senales distintas para nosotros. Colapsarlos seria el mismo
// error que el mensaje generico que este cambio viene a arreglar.
func (h *VerificationHandler) handleSendError(c *gin.Context, err error) {
	var cooldownErr *service.ErrRateLimitOTP
	if errors.As(err, &cooldownErr) {
		c.Header("Retry-After", strconv.Itoa(cooldownErr.RetryAfter))
		writeError(c, http.StatusTooManyRequests, cooldownErr)
		return
	}

	var dailyErr *service.ErrOTPDailyLimit
	if errors.As(err, &dailyErr) {
		c.Header("Retry-After", strconv.Itoa(dailyErr.RetryAfter))
		writeError(c, http.StatusTooManyRequests, dailyErr)
		return
	}

	if errors.Is(err, domain.ErrOTPChannelUnavailable) {
		// Sin Retry-After a proposito: cuando se libera depende de otros usuarios,
		// asi que cualquier numero seria una adivinanza.
		writeError(c, http.StatusTooManyRequests, err)
		return
	}

	var extErr *service.ErrExternalService
	if errors.As(err, &extErr) {
		// 502 Bad Gateway para fallos de proveedores externos
		writeError(c, http.StatusBadGateway, domain.ErrInternal)
		return
	}

	writeError(c, http.StatusInternalServerError, domain.ErrInternal)
}
```

The `ErrNoPhoneOnFile` branch is gone — SMS was removed in Part A and nothing returns it.

- [ ] **Step 4: Run the test and the whole handler suite**

```bash
cd backend
DATABASE_URL="postgres://lostpets:lostpets@localhost:5433/lostpets_test?sslmode=disable" \
  go test ./tests/ -run 'TestVerificationHandler' -count=1 -v > /tmp/t6.log 2>&1; echo "EXIT=$?"
```

Expected: `EXIT=0`.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/handler/verification_handler.go backend/internal/service/interfaces.go backend/tests/verification_handler_test.go
git commit -m "fix(auth): el 429 de verificacion devuelve {code,message} y distingue los tres limites"
```

---

## Task 7: The cap against real Postgres

Rule #34: mocks have no constraints and no sweeper. The cap is a claim about what the database will do over a window, so it gets an e2e test on the real thing.

**Files:**
- Create: `backend/tests/e2e/verification_quota_flow_test.go`
- Reference: `backend/tests/e2e/password_reset_flow_test.go` (same harness, same helpers)

- [ ] **Step 1: Read the existing harness**

```bash
cd backend
sed -n '1,60p' tests/e2e/password_reset_flow_test.go
sed -n '1,80p' tests/e2e/helpers_test.go
```

Reuse whatever that file uses to build the server and register a user; do not invent a second harness.

- [ ] **Step 2: Write the failing test**

Create `backend/tests/e2e/verification_quota_flow_test.go`. Mirror the build tag and package of `password_reset_flow_test.go` exactly (first two lines of that file).

```go
//go:build e2e

package e2e

// Ajustar imports y helpers a los que ya usa password_reset_flow_test.go.

// TestVerificationQuota_TopePorCuenta prueba el cupo contra Postgres real.
//
// Regla #34: los mocks no tienen columnas ni constraints, y regla #40: esta
// tabla tiene un reaper. Un tope diario es una afirmacion sobre lo que la BASE
// hace durante una ventana — verificarlo contra un mock no verifica nada.
func TestVerificationQuota_TopePorCuenta(t *testing.T) {
	// El mailer real no debe existir: sin BREVO_API_KEY / MAIL_FROM_EMAIL el
	// adapter cae en noop y el test no depende de la red (mismo motivo que deae995).
	t.Setenv("BREVO_API_KEY", "")
	t.Setenv("MAIL_FROM_EMAIL", "")

	srv := newTestServer(t) // el helper que ya usa password_reset_flow_test.go
	token := registerAndLogin(t, srv, "quota-a@example.com", "password123")

	// Los cinco primeros pasan. Entre uno y otro hay que saltear el cooldown de
	// 60s: se retrocede el created_at del token recien acunado, que es lo mismo
	// que hace el test del repositorio.
	for i := 0; i < 5; i++ {
		resp := srv.post(t, "/api/verification/send-email", nil, token)
		if resp.Code != http.StatusAccepted {
			t.Fatalf("pedido %d: status %d, want 202 (body %s)", i+1, resp.Code, resp.Body.String())
		}
		backdateNewestToken(t, srv.db, "email", time.Now().Add(-2*time.Minute))
	}

	// El sexto se bloquea con otp_daily_limit y Retry-After real.
	resp := srv.post(t, "/api/verification/send-email", nil, token)
	if resp.Code != http.StatusTooManyRequests {
		t.Fatalf("sexto pedido: status %d, want 429 (body %s)", resp.Code, resp.Body.String())
	}
	var body struct {
		Code string `json:"code"`
	}
	if err := json.Unmarshal(resp.Body.Bytes(), &body); err != nil {
		t.Fatalf("body no es JSON: %v", err)
	}
	if body.Code != "otp_daily_limit" {
		t.Fatalf("code = %q, want otp_daily_limit", body.Code)
	}
	if ra := resp.Header().Get("Retry-After"); ra == "" {
		t.Fatal("falta Retry-After en el tope por cuenta")
	}

	// Otra cuenta NO se ve afectada: el tope es por usuario, no global.
	otherToken := registerAndLogin(t, srv, "quota-b@example.com", "password123")
	otherResp := srv.post(t, "/api/verification/send-email", nil, otherToken)
	if otherResp.Code != http.StatusAccepted {
		t.Fatalf("otra cuenta: status %d, want 202 — el tope por cuenta se filtro a global (body %s)",
			otherResp.Code, otherResp.Body.String())
	}
}
```

Add the backdating helper in the same file:

```go
// backdateNewestToken retrocede el created_at del token mas nuevo del canal para
// saltear el cooldown de 60s sin dormir. NO lo saca de la ventana de conteo.
func backdateNewestToken(t *testing.T, db *gorm.DB, channel string, to time.Time) {
	t.Helper()
	var tok domain.VerificationToken
	if err := db.Where("channel = ?", channel).
		Order("created_at DESC").First(&tok).Error; err != nil {
		t.Fatalf("buscar token: %v", err)
	}
	if err := db.Model(&domain.VerificationToken{}).
		Where("id = ?", tok.ID).UpdateColumn("created_at", to).Error; err != nil {
		t.Fatalf("backdate: %v", err)
	}
}
```

If `newTestServer` / `registerAndLogin` / `srv.post` / `srv.db` are named differently in `helpers_test.go`, use the real names — do not add shims.

- [ ] **Step 3: Run it**

```bash
cd backend
DATABASE_URL="postgres://lostpets:lostpets@localhost:5433/lostpets_test?sslmode=disable" \
  go test ./tests/e2e/ -tags e2e -run TestVerificationQuota -count=1 -v > /tmp/t7.log 2>&1; echo "EXIT=$?"
```

Expected: `EXIT=0`.

- [ ] **Step 4: Prove the test can fail**

Rule #34, the part that is usually skipped: restore the defect and watch the red.

Temporarily set `emailVerificationDailyMax = 500` in `verification_service.go`, re-run the command above, and confirm the sixth request returns 202 and the test fails. Then put `5` back and re-run to green.

- [ ] **Step 5: Commit**

```bash
git add backend/tests/e2e/verification_quota_flow_test.go
git commit -m "test(e2e): el cupo por cuenta de verificacion contra Postgres real"
```

---

## Task 8: `ApiError` carries `retryAfter`

**Files:**
- Modify: `frontend/packages/shared/api/client.ts:9-17` and `:198-207`
- Test: `frontend/packages/shared/utils/apiErrors.test.ts` (existing Vitest file)

- [ ] **Step 1: Write the failing test**

Append to `frontend/packages/shared/utils/apiErrors.test.ts`:

```ts
describe('ApiError.retryAfter', () => {
  it('carries the Retry-After seconds when the server sent one', () => {
    const err = new ApiError('otp_cooldown', 429, 'otp_cooldown', 42);
    expect(err.retryAfter).toBe(42);
  });

  it('is undefined when the server sent no header', () => {
    const err = new ApiError('otp_channel_unavailable', 429, 'otp_channel_unavailable');
    expect(err.retryAfter).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd frontend/packages/web
pnpm vitest run --config vitest.shared.config.ts > /tmp/t8.log 2>&1; echo "EXIT=$?"
```

Expected: non-zero — TypeScript rejects the 4th argument.

Rule #14: shared tests run from `web/` with that config, never Jest.

- [ ] **Step 3: Extend `ApiError`**

In `frontend/packages/shared/api/client.ts`, replace the class body:

```ts
export class ApiError extends Error {
  code: string;
  status: number;
  /**
   * Seconds from the `Retry-After` header, when the server sent one.
   * Undefined for errors that carry no honest number — the channel-wide OTP
   * reserve, for instance, depends on other users.
   */
  retryAfter?: number;
  constructor(code: string, status: number, message: string, retryAfter?: number) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

/** Parses `Retry-After` as seconds. Ignores the HTTP-date form: the API never sends it. */
function parseRetryAfter(response: Response): number | undefined {
  const raw = response.headers.get('Retry-After');
  if (raw === null) return undefined;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : undefined;
}
```

Keep whatever the existing constructor already assigns (`this.name`, `super(message)`) — copy it verbatim rather than the sketch above if it differs.

- [ ] **Step 4: Parse it on the error path**

In the same file, at the `throw new ApiError(code, response.status, message);` inside the main `request` path (~line 206):

```ts
      throw new ApiError(code, response.status, message, parseRetryAfter(response));
```

Only this one call site changes. The upload paths (~317, ~419, ~444) never return `429` with a `Retry-After`, and widening them would be change without a caller.

- [ ] **Step 5: Run the tests**

```bash
cd frontend/packages/web
pnpm vitest run --config vitest.shared.config.ts > /tmp/t8.log 2>&1; echo "EXIT=$?"
```

Expected: `EXIT=0`.

- [ ] **Step 6: Commit**

```bash
git add frontend/packages/shared/api/client.ts frontend/packages/shared/utils/apiErrors.test.ts
git commit -m "feat(shared): ApiError expone los segundos de Retry-After"
```

---

## Task 9: The three error messages, in three languages

**Files:**
- Modify: `frontend/packages/shared/i18n/locales/es.json` (`errors` object, next to `otp_invalid` ~line 378)
- Modify: `frontend/packages/shared/i18n/locales/en.json`
- Modify: `frontend/packages/shared/i18n/locales/pt.json`

- [ ] **Step 1: Add the keys**

`es.json`, inside `errors`:

```json
    "otp_cooldown": "Esperá unos segundos antes de pedir otro código.",
    "otp_daily_limit": "Alcanzaste el límite de códigos por hoy. Probá de nuevo mañana.",
    "otp_channel_unavailable": "El envío de códigos no está disponible en este momento. Probá más tarde.",
```

`en.json`:

```json
    "otp_cooldown": "Wait a few seconds before requesting another code.",
    "otp_daily_limit": "You've reached today's limit of verification codes. Try again tomorrow.",
    "otp_channel_unavailable": "Code delivery is unavailable right now. Please try again later.",
```

`pt.json`:

```json
    "otp_cooldown": "Aguarde alguns segundos antes de pedir outro código.",
    "otp_daily_limit": "Você atingiu o limite de códigos de hoje. Tente novamente amanhã.",
    "otp_channel_unavailable": "O envio de códigos está indisponível no momento. Tente mais tarde.",
```

`otp_daily_limit` says "tomorrow" rather than interpolating the exact hours on purpose: the window is a rolling 24h, "tomorrow" is always true, and the precise `Retry-After` still travels in the header for any client that wants it. A per-second countdown over 20 hours would be noise.

- [ ] **Step 2: Verify the JSON parses in all three**

```bash
cd frontend/packages/shared/i18n/locales
node -e "['es','en','pt'].forEach(l=>{const j=require('./'+l+'.json');['otp_cooldown','otp_daily_limit','otp_channel_unavailable'].forEach(k=>{if(!j.errors[k])throw new Error(l+' falta '+k)})});console.log('OK')" > /tmp/t9.log 2>&1; echo "EXIT=$?"
```

Expected: `EXIT=0`, `OK`.

`errors` is a shared namespace and is already registered — no change to `web/src/i18n/index.ts` (rule #21 applies to web-only namespaces).

- [ ] **Step 3: Commit**

```bash
git add frontend/packages/shared/i18n/locales/es.json frontend/packages/shared/i18n/locales/en.json frontend/packages/shared/i18n/locales/pt.json
git commit -m "feat(i18n): mensajes de cooldown, cupo diario y reserva del canal"
```

---

## Task 10: The web countdown reads the server's number

Both clients already render a `resendCountdown` and already hardcode 60 after a **successful** send. What is missing is seeding it from a rejection — today a `429` prints a generic message and the button stays clickable.

**Files:**
- Modify: `frontend/packages/web/src/pages/ProfilePage.tsx:52-60` and `:338-345`
- Test: `frontend/packages/web/src/pages/ProfilePage.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `frontend/packages/web/src/pages/ProfilePage.test.tsx`, following the mocking style already in that file (it mocks `@shared/hooks` hook by hook — rule #17's web sibling):

```tsx
it('shows the cooldown countdown from Retry-After when the send is rejected', async () => {
  const mutateAsync = vi.fn().mockRejectedValue(
    new ApiError('otp_cooldown', 429, 'otp_cooldown', 45)
  );
  mockUseSendEmailOTP.mockReturnValue({ mutateAsync, isPending: false });

  render(<ProfilePage />, { wrapper });

  await userEvent.click(screen.getByText('profile:accountVerification'));
  await userEvent.click(screen.getByText('profile:sendCode'));

  // El mensaje sale del code, no de un texto generico.
  expect(await screen.findByText('errors:otp_cooldown')).toBeInTheDocument();
  // Y el contador arranca en los segundos que dijo el servidor, no en 60.
  expect(screen.getByText(/45/)).toBeInTheDocument();
});
```

Adapt the mock names and the `wrapper` to whatever the file already defines. If the file has no `ApiError` import, add `import { ApiError } from '@shared/api/client';`.

- [ ] **Step 2: Run it and watch it fail**

```bash
cd frontend/packages/web
pnpm vitest run src/pages/ProfilePage.test.tsx > /tmp/t10.log 2>&1; echo "EXIT=$?"
```

Expected: non-zero — no countdown renders on the failure path.

- [ ] **Step 3: Seed the countdown from the error**

In `frontend/packages/web/src/pages/ProfilePage.tsx`, replace `handleSendOTP` (lines 52–60):

```tsx
  const handleSendOTP = async () => {
    setVerifyError('');
    try {
      await sendEmailOTP.mutateAsync();
      setOtpSent(true);
      setResendCountdown(60);
    } catch (err) {
      setVerifyError(getErrorMessage(err, t));
      // El cooldown es el unico limite cuya espera se mide en segundos: el tope
      // diario se cuenta en horas y su mensaje ya dice "manana", y la reserva del
      // canal no trae numero porque depende de otros usuarios.
      if (err instanceof ApiError && err.code === 'otp_cooldown' && err.retryAfter) {
        setOtpSent(true);
        setResendCountdown(err.retryAfter);
      }
    }
  };
```

Add the import at the top: `import { ApiError } from '@shared/api/client';`

- [ ] **Step 4: Show the countdown on the send step too**

The countdown currently only renders inside the confirm step. Setting `otpSent` in the catch (above) moves the user there, which is correct — a cooldown means a code was already sent and is probably in their inbox.

For the pre-send button, disable it while the countdown runs. Replace lines 338–345:

```tsx
                    <button
                      type="button"
                      onClick={handleSendOTP}
                      disabled={sendEmailOTP.isPending || resendCountdown > 0}
                      className="bg-primary hover:bg-primary-dark disabled:opacity-60 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
                    >
                      {sendEmailOTP.isPending
                        ? t('profile:sending')
                        : resendCountdown > 0
                          ? t('profile:resendIn', { seconds: resendCountdown })
                          : t('profile:sendCode')}
                    </button>
```

And the resend button at line 379:

```tsx
                        disabled={sendEmailOTP.isPending || resendCountdown > 0}
```

- [ ] **Step 5: Run the web suite**

```bash
cd frontend/packages/web
pnpm test:run > /tmp/t10.log 2>&1; echo "EXIT=$?"
```

Expected: `EXIT=0`.

- [ ] **Step 6: Typecheck — `vitest` does not**

The build is what typechecks; a green suite proves nothing about types (this exact gap broke CI on PR #116).

```bash
cd frontend/packages/web
pnpm build > /tmp/t10-build.log 2>&1; echo "EXIT=$?"
```

Expected: `EXIT=0`.

- [ ] **Step 7: Commit**

```bash
git add frontend/packages/web/src/pages/ProfilePage.tsx frontend/packages/web/src/pages/ProfilePage.test.tsx
git commit -m "feat(web): el cooldown de verificacion muestra los segundos que dice el servidor"
```

---

## Task 11: The same, on mobile

**Files:**
- Modify: `frontend/packages/mobile/app/(tabs)/profile.tsx:76-84` and `:250-260`
- Test: `frontend/packages/mobile/__tests__/profile.test.tsx` (check it exists: `ls frontend/packages/mobile/__tests__/`)

- [ ] **Step 1: Write the failing test**

Append to the mobile profile smoke test, following its existing hook-by-hook mock style (rule #17 — every new hook a screen uses must be added to its mock):

```tsx
it('arranca el contador con los segundos del Retry-After al recibir 429', async () => {
  const mutateAsync = jest.fn().mockRejectedValue(
    new ApiError('otp_cooldown', 429, 'otp_cooldown', 45)
  );
  mockUseSendEmailOTP.mockReturnValue({ mutateAsync, isPending: false });

  const { getByText, findByText } = render(<ProfileScreen />);

  fireEvent.press(getByText('verifyEmail'));
  fireEvent.press(getByText('sendCode'));

  expect(await findByText(/45/)).toBeTruthy();
});
```

Adapt the labels to what the screen actually renders (`t()` is mocked to return the key in this suite) and the mock names to the file's own.

- [ ] **Step 2: Run it and watch it fail**

```bash
cd frontend/packages/mobile
pnpm test:run > /tmp/t11.log 2>&1; echo "EXIT=$?"
```

Expected: non-zero.

Rule #17: `pnpm test` is `jest --watchAll` and never exits. Always `test:run`.

- [ ] **Step 3: Seed the countdown**

In `frontend/packages/mobile/app/(tabs)/profile.tsx`, replace `handleSendOTP` (lines 76–84):

```tsx
  const handleSendOTP = async () => {
    try {
      await sendEmailOTP.mutateAsync();
      setSheetStep('confirm');
      setResendCountdown(60);
    } catch (err) {
      // El cooldown es el unico limite cuya espera se mide en segundos. El tope
      // diario y la reserva del canal se explican con su mensaje.
      if (err instanceof ApiError && err.code === 'otp_cooldown' && err.retryAfter) {
        setSheetStep('confirm');
        setResendCountdown(err.retryAfter);
      }
      Alert.alert(i18next.t('common:error'), getErrorMessage(err, (key) => i18next.t(key)));
    }
  };
```

Add the import: `import { ApiError } from '../../../shared/api/client';` — match the relative path style the file already uses for `@shared` imports.

- [ ] **Step 4: Disable the send button during the countdown**

Replace lines 250–260:

```tsx
            <TouchableOpacity
              style={[styles.sheetPrimaryButton, (sendEmailOTP.isPending || resendCountdown > 0) && styles.buttonDisabled]}
              onPress={handleSendOTP}
              disabled={sendEmailOTP.isPending || resendCountdown > 0}
            >
              {sendEmailOTP.isPending ? (
                <ActivityIndicator color={COLORS.white} />
              ) : (
                <Text style={styles.sheetPrimaryButtonText}>
                  {resendCountdown > 0 ? t('resendIn', { seconds: resendCountdown }) : t('sendCode')}
                </Text>
              )}
            </TouchableOpacity>
```

And the resend link at line 287:

```tsx
                <TouchableOpacity onPress={handleSendOTP} disabled={sendEmailOTP.isPending || resendCountdown > 0}>
```

- [ ] **Step 5: Run the mobile suite**

```bash
cd frontend/packages/mobile
pnpm test:run > /tmp/t11.log 2>&1; echo "EXIT=$?"
```

Expected: `EXIT=0`.

- [ ] **Step 6: Check for prebuild leftovers before committing**

Rule #33: the jest run rewrites `mobile/tsconfig.json` and `mobile/package.json`.

```bash
cd frontend/packages/mobile
git status --short
```

If `tsconfig.json` lost `.expo/types/**/*.ts` or `expo-env.d.ts` from `include`, or `package.json` scripts changed, restore them: `git checkout -- tsconfig.json package.json`.

- [ ] **Step 7: Commit**

```bash
git add "frontend/packages/mobile/app/(tabs)/profile.tsx" frontend/packages/mobile/__tests__/
git commit -m "feat(mobile): el cooldown de verificacion muestra los segundos que dice el servidor"
```

---

## Task 12: Full verification and docs

**Files:**
- Modify: `CLAUDE.md` (gap table + the rules section)
- Modify: `docs/superpowers/specs/2026-07-31-email-verification-quota-design.md` (status line)

- [ ] **Step 1: Run everything, by exit code**

Rule #41 — never a grep over the output, and always with `DATABASE_URL` pointed at `lostpets_test`, or the integration tests skip in silence and green means nothing.

```bash
cd backend
DATABASE_URL="postgres://lostpets:lostpets@localhost:5433/lostpets_test?sslmode=disable" \
  go test ./... -count=1 > /tmp/all-backend.log 2>&1; echo "BACKEND=$?"
DATABASE_URL="postgres://lostpets:lostpets@localhost:5433/lostpets_test?sslmode=disable" \
  go test ./tests/e2e/ -tags e2e -count=1 > /tmp/all-e2e.log 2>&1; echo "E2E=$?"
cd ../frontend/packages/web && pnpm test:run > /tmp/all-web.log 2>&1; echo "WEB=$?"
cd ../web && pnpm build > /tmp/all-webbuild.log 2>&1; echo "WEBBUILD=$?"
cd ../mobile && pnpm test:run > /tmp/all-mobile.log 2>&1; echo "MOBILE=$?"
```

All five must print `=0`. Any other number: read the log, do not proceed.

- [ ] **Step 2: Close the open gap in `CLAUDE.md`**

Find the row `| El canal de verificación de email no tiene NINGÚN tope diario | Medio | Media | 🔲 ABIERTO ...` and replace its status with:

```
| El canal de verificación de email no tiene NINGÚN tope diario | Medio | Media | ✅ DONE — 5 por cuenta y 250 por canal en 24h. Los dos presupuestos ahora SUMAN los 300 de Brevo y son disjuntos, así que la justificación del cupo de reset ("deja 250 para verificación") por fin la hace cumplir alguien. De paso: el 429 del cooldown devolvía `{error:...}` (regla #11) y el fallo de envío marcaba el token usado en vez de borrarlo, que con cupo habría quemado el de la víctima |
```

- [ ] **Step 3: Add rule #43**

At the end of the "Reglas Importantes" list in `CLAUDE.md`:

```markdown
43. **Los cupos de los dos canales de mail son DISJUNTOS y suman el plan** — `verification_tokens` es una tabla y Brevo un solo plan de 300/día, así que los topes de `email` (5 por cuenta, 250 por canal) y de `password_reset` (3 y 50) están calibrados para sumar exactamente 300. Si tocás uno, tocá el otro: dos canales que se reparten un presupuesto compartido sin que la suma cierre es la forma de que uno mate de hambre al otro, que es justo el agujero que este cambio cerró — el spec del reset afirmaba "deja 250 para la verificación" y no lo hacía cumplir absolutamente nadie. Las cuatro constantes derivan su ventana de `repository.TokenRetention` vía `service.QuotaWindow`; ver regla #40 para por qué no se declara una segunda.
    **Y el corolario del fallo de envío**: `CountSince` ignora `used`, así que un token cuyo mail nunca salió tiene que **borrarse** (`DeleteByID`), no marcarse usado. Marcarlo deja al usuario sin cupo por códigos que jamás recibió — el mismo defecto se arregló primero en la recuperación (`8155d1c`) y estaba intacto en la verificación.
```

- [ ] **Step 4: Update the spec status**

In `docs/superpowers/specs/2026-07-31-email-verification-quota-design.md`, line 4:

```markdown
**Status:** implemented (Part A: PR #116 · Part B: this branch)
```

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md docs/superpowers/specs/2026-07-31-email-verification-quota-design.md
git commit -m "docs: cerrar el gap del cupo de verificacion y documentar la regla 43"
```

- [ ] **Step 6: Open the PR**

Use the `searchpet-pr` skill. Base is `docs/email-verification-quota` while Part A is open.

Before opening, confirm the branch is not carrying Part A's commits:

```bash
git fetch origin
git log --oneline origin/docs/email-verification-quota..HEAD
```

The list must contain only the commits from this plan. If Part A's commits appear, A was squash-merged — rebase per the "Branch and delivery" section above before opening.

---

## Out of scope, deliberately

- **The global reserve is itself a cheap denial.** Registration is open, so ~50 accounts can exhaust the channel reserve and block verification for everyone until the window rolls. Accepted for the same reason the reset's reserve was: without it the same attack takes down *both* channels instead of one. Unchanged by this plan; it stays in the spec's Open risks.
- **`users.phone_verified`** stays. Part A's decision, not revisited.
- **250 is an estimate, not a measurement.** Nobody has counted a normal day's verification volume. If real signups approach it, the answer is a larger mail plan, not a larger cap.
