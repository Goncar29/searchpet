# Password reset daily quota — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop a single victim from draining the Brevo daily quota through `/auth/password/forgot`, by capping reset codes at 3 per account and 50 globally per rolling 24 hours.

**Architecture:** One new repository method counts rows in `verification_tokens` by `created_at`; `RequestReset` consults it twice (per account, then channel-wide) and swallows both rejections exactly like the existing cooldown, so the endpoint stays indistinguishable. The UI gains a fixed policy sentence and a purely client-side resend countdown — it never reports account state.

**Tech Stack:** Go 1.25 + GORM + PostgreSQL; React + Vite (web); React Native + Expo (mobile); i18next.

**Spec:** `docs/superpowers/specs/2026-07-31-password-reset-daily-quota-design.md`

---

## File Structure

| File | Responsibility |
|---|---|
| `backend/internal/repository/interfaces.go` | Add `CountSince` to `VerificationTokenRepository` |
| `backend/internal/repository/verification_token_repository.go` | The counting query — the one place that must not filter on `used` |
| `backend/migrations/000022_verification_tokens_channel_created_at_index.{up,down}.sql` | Composite index both queries use |
| `backend/internal/service/password_reset_service.go` | The two caps and their constants |
| `backend/tests/verification_token_repository_test.go` | Query behaviour against real Postgres |
| `backend/tests/password_reset_service_test.go` | Cap behaviour with mocks + the `used` regression guard |
| `backend/tests/verification_service_test.go` | Mock update only (shared interface) |
| `frontend/packages/shared/i18n/locales/{es,en,pt}.json` | New `auth.forgotPassword` keys |
| `frontend/packages/web/src/pages/ForgotPasswordPage.tsx` | Policy line + resend control + countdown |
| `frontend/packages/web/src/pages/ForgotPasswordPage.test.tsx` | Web UI assertions |
| `frontend/packages/mobile/app/forgot-password.tsx` | Same, component state instead of storage |
| `frontend/packages/mobile/__tests__/forgot-password.test.tsx` | Mobile UI assertions |

**A deliberate deviation from the spec:** the spec asked for the counting query to be covered by an `-tags e2e` test. It goes in `backend/tests/verification_token_repository_test.go` instead, which also runs against real Postgres (via `testdb.SetupTestDB`) but executes in the `backend-test` CI job on every push, not only where e2e runs. Same guarantee — real columns, real `created_at` semantics — with faster feedback and no server boot.

---

### Task 1: `CountSince` on the token repository

**Files:**
- Modify: `backend/internal/repository/interfaces.go`
- Modify: `backend/internal/repository/verification_token_repository.go`
- Test: `backend/tests/verification_token_repository_test.go`

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/verification_token_repository_test.go`:

```go
// CountSince is the backbone of the daily quota. It runs against real Postgres
// because a wrong WHERE clause passes every mock-based test in the suite —
// mocks have no columns and no created_at semantics (rule #34).
func TestVerificationTokenRepository_CountSince(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	tokenRepo := repository.NewVerificationTokenRepository(gormDB)
	ctx := context.Background()

	alice := newTestUser(t, userRepo)
	bob := newTestUser(t, userRepo)

	mint := func(userID uuid.UUID, channel string, createdAt time.Time, used bool) {
		t.Helper()
		tok := &domain.VerificationToken{
			UserID:    userID,
			Channel:   channel,
			CodeHash:  "hash",
			ExpiresAt: createdAt.Add(10 * time.Minute),
			Used:      used,
		}
		if err := tokenRepo.Create(ctx, tok); err != nil {
			t.Fatalf("Create: %v", err)
		}
		// GORM stamps created_at on insert, so the backdating is a second write.
		if err := gormDB.Model(&domain.VerificationToken{}).
			Where("id = ?", tok.ID).UpdateColumn("created_at", createdAt).Error; err != nil {
			t.Fatalf("backdate: %v", err)
		}
	}

	now := time.Now()
	since := now.Add(-24 * time.Hour)

	mint(alice.ID, "password_reset", now.Add(-1*time.Hour), false)
	// USED, and inside the window. This row is the whole point: MarkAllUsedByUserExcept
	// marks previous codes used on every new request, so a CountSince that filtered
	// on `used` would make asking for a new code RESET the cap.
	mint(alice.ID, "password_reset", now.Add(-2*time.Hour), true)
	// Outside the window.
	mint(alice.ID, "password_reset", now.Add(-30*time.Hour), false)
	// Another channel — must not be counted.
	mint(alice.ID, "email", now.Add(-1*time.Hour), false)
	// Another user — counts globally, not for alice.
	mint(bob.ID, "password_reset", now.Add(-3*time.Hour), false)

	got, err := tokenRepo.CountSince(ctx, &alice.ID, "password_reset", since)
	if err != nil {
		t.Fatalf("CountSince(alice): %v", err)
	}
	if got != 2 {
		t.Fatalf("per-user count = %d, want 2 (one unused + one USED inside the window)", got)
	}

	global, err := tokenRepo.CountSince(ctx, nil, "password_reset", since)
	if err != nil {
		t.Fatalf("CountSince(global): %v", err)
	}
	if global != 3 {
		t.Fatalf("global count = %d, want 3 (alice's two plus bob's one)", global)
	}
}
```

Ensure the file's import block contains `context`, `testing`, `time`, `github.com/google/uuid`, `lost-pets/internal/domain`, `lost-pets/internal/repository`, `lost-pets/tests/testdb`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && DATABASE_URL="postgres://postgres:postgres@localhost:5433/lostpets_test?sslmode=disable" go test ./tests/ -run TestVerificationTokenRepository_CountSince -count=1`
Expected: build failure — `tokenRepo.CountSince undefined`.

- [ ] **Step 3: Add the method to the interface**

In `backend/internal/repository/interfaces.go`, inside `VerificationTokenRepository`, directly after `MarkAllUsedByUserExcept`:

```go
	// CountSince cuenta tokens del canal creados desde `since`. Un userID nil
	// cuenta TODO el canal, que es como se mide la reserva global diaria.
	// NO filtra por used — ver el comentario de la implementación.
	CountSince(ctx context.Context, userID *uuid.UUID, channel string, since time.Time) (int64, error)
```

- [ ] **Step 4: Implement the query**

In `backend/internal/repository/verification_token_repository.go`, after `MarkAllUsedByUserExcept`:

```go
// CountSince cuenta tokens del canal creados desde `since`. Con userID nil cuenta
// el canal entero (la reserva global); con userID cuenta esa cuenta sola.
//
// NO filtra por `used`, y eso es lo único importante de esta función:
// MarkAllUsedByUserExcept marca los códigos anteriores del usuario como usados
// cada vez que se acuña uno nuevo, así que filtrar por used haría que PEDIR UN
// CÓDIGO NUEVO RESETEE EL CAP y el tope directamente no existiría.
func (r *postgresVerificationTokenRepository) CountSince(ctx context.Context, userID *uuid.UUID, channel string, since time.Time) (int64, error) {
	q := r.db.WithContext(ctx).
		Model(&domain.VerificationToken{}).
		Where("channel = ? AND created_at >= ?", channel, since)
	if userID != nil {
		q = q.Where("user_id = ?", *userID)
	}

	var n int64
	if err := q.Count(&n).Error; err != nil {
		return 0, err
	}
	return n, nil
}
```

- [ ] **Step 5: Add the method to both test mocks so the package compiles**

In `backend/tests/password_reset_service_test.go`, add these fields to `resetTokenRepo`:

```go
	// countByUser y countGlobal manejan los dos topes diarios. Cero significa
	// "por debajo del cap", que es lo que quiere casi todo test existente.
	countByUser int64
	countGlobal int64
	countErr    error
```

and this method:

```go
func (r *resetTokenRepo) CountSince(_ context.Context, userID *uuid.UUID, _ string, _ time.Time) (int64, error) {
	if r.countErr != nil {
		return 0, r.countErr
	}
	if userID == nil {
		return r.countGlobal, nil
	}
	return r.countByUser, nil
}
```

In `backend/tests/verification_service_test.go`, add to `mockTokenRepo`:

```go
func (m *mockTokenRepo) CountSince(_ context.Context, _ *uuid.UUID, _ string, _ time.Time) (int64, error) {
	return 0, nil
}
```

(`captureTokenRepo` embeds `*mockTokenRepo`, so it inherits this.)

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd backend && DATABASE_URL="postgres://postgres:postgres@localhost:5433/lostpets_test?sslmode=disable" go test ./tests/ -run TestVerificationTokenRepository_CountSince -count=1 -v`
Expected: `--- PASS: TestVerificationTokenRepository_CountSince`

- [ ] **Step 7: Prove the `used` guard has teeth**

Temporarily add `AND used = false` to the `Where` in `CountSince`, re-run the command from Step 6, and confirm it fails with `per-user count = 1, want 2`. Then remove it again and confirm the test passes.

- [ ] **Step 8: Commit**

```bash
git add backend/internal/repository/interfaces.go backend/internal/repository/verification_token_repository.go backend/tests/verification_token_repository_test.go backend/tests/password_reset_service_test.go backend/tests/verification_service_test.go
git commit -m "feat(auth): CountSince para el cupo diario de recuperacion"
```

---

### Task 2: Index for the counting query

**Files:**
- Create: `backend/migrations/000022_verification_tokens_channel_created_at_index.up.sql`
- Create: `backend/migrations/000022_verification_tokens_channel_created_at_index.down.sql`

- [ ] **Step 1: Write the up migration**

```sql
-- Indice para las dos queries del cupo diario de recuperacion de contrasena
-- (CountSince por usuario y global). Los indices que ya existen son sobre
-- user_id, used y expires_at: ninguno sirve para filtrar por channel + created_at.
--
-- Guarda de tabla por la regla #35: RunMigrations corre ANTES que RunAutoMigrate
-- (pkg/database/postgres.go), asi que en una base limpia este archivo se ejecuta
-- cuando GORM todavia no creo verification_tokens. CREATE INDEX IF NOT EXISTS
-- protege el INDICE, no la tabla.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'verification_tokens'
    ) THEN
        CREATE INDEX IF NOT EXISTS idx_verification_tokens_channel_created_at
            ON verification_tokens (channel, created_at);
    END IF;
END $$;
```

- [ ] **Step 2: Write the down migration**

```sql
DROP INDEX IF EXISTS idx_verification_tokens_channel_created_at;
```

- [ ] **Step 3: Verify the guard on an empty database**

```bash
docker exec lostpets-db psql -U postgres -c "DROP DATABASE IF EXISTS guardcheck;" -q
docker exec lostpets-db psql -U postgres -c "CREATE DATABASE guardcheck;" -q
docker exec -i lostpets-db psql -U postgres -d guardcheck -v ON_ERROR_STOP=1 \
  < backend/migrations/000022_verification_tokens_channel_created_at_index.up.sql
docker exec lostpets-db psql -U postgres -c "DROP DATABASE guardcheck;" -q
```
Expected: prints `DO`, exit code 0. The test environment cannot catch a missing guard here (it runs AutoMigrate first — rule #35), so this manual check is the only verification.

- [ ] **Step 4: Verify it applies on a real database**

```bash
docker exec lostpets-db psql -U postgres -c "DROP DATABASE IF EXISTS lostpets_test;" -q
docker exec lostpets-db psql -U postgres -c "CREATE DATABASE lostpets_test;" -q
cd backend && DATABASE_URL="postgres://postgres:postgres@localhost:5433/lostpets_test?sslmode=disable" go test ./tests/ -run TestVerificationTokenRepository_CountSince -count=1
docker exec lostpets-db psql -U postgres -d lostpets_test -c "\di idx_verification_tokens_channel_created_at"
```
Expected: the test passes and `\di` lists the index.

- [ ] **Step 5: Commit**

```bash
git add backend/migrations/000022_verification_tokens_channel_created_at_index.up.sql backend/migrations/000022_verification_tokens_channel_created_at_index.down.sql
git commit -m "feat(db): indice channel+created_at para el cupo diario"
```

---

### Task 3: Per-account daily cap

**Files:**
- Modify: `backend/internal/service/password_reset_service.go`
- Test: `backend/tests/password_reset_service_test.go`

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/password_reset_service_test.go`:

```go
func TestRequestReset_PerAccountDailyCap(t *testing.T) {
	// El unico freno por cuenta que existia era el cooldown de 60s: 1440 mails
	// por dia contra una sola direccion, sobre los 300/dia de Brevo que se
	// COMPARTEN con la verificacion de email.
	users := knownUser("user@example.com")
	tokens := &resetTokenRepo{countByUser: 3} // ya en el tope
	m := &recordingMailer{}

	// Devuelve nil igual que todo lo demas: cualquier diferencia observable seria
	// un oraculo de existencia de cuenta.
	if err := newResetSvc(users, tokens, m).RequestReset(context.Background(), "user@example.com"); err != nil {
		t.Fatalf("RequestReset() = %v, want nil", err)
	}
	if len(tokens.created) != 0 {
		t.Fatalf("acuno %d tokens, want 0 — el cap no freno nada", len(tokens.created))
	}
	if m.sentTo != "" {
		t.Fatal("no se acuno codigo, asi que no se puede mandar mail")
	}
}

func TestRequestReset_UnderThePerAccountCapStillWorks(t *testing.T) {
	users := knownUser("user@example.com")
	tokens := &resetTokenRepo{countByUser: 2} // uno por debajo
	m := &recordingMailer{}

	if err := newResetSvc(users, tokens, m).RequestReset(context.Background(), "user@example.com"); err != nil {
		t.Fatalf("RequestReset() = %v, want nil", err)
	}
	if len(tokens.created) != 1 {
		t.Fatalf("acuno %d tokens, want 1 — el cap frena de mas", len(tokens.created))
	}
	if m.sentTo != "user@example.com" {
		t.Fatalf("mailed %q, want user@example.com", m.sentTo)
	}
}

func TestRequestReset_CountFailureFailsClosed(t *testing.T) {
	// Un fallo del conteo no puede abrir la puerta: sin numero no hay tope.
	users := knownUser("user@example.com")
	tokens := &resetTokenRepo{countErr: errors.New("verification_tokens is unavailable")}
	m := &recordingMailer{}

	if err := newResetSvc(users, tokens, m).RequestReset(context.Background(), "user@example.com"); err != nil {
		t.Fatalf("RequestReset() = %v, want nil", err)
	}
	if len(tokens.created) != 0 || m.sentTo != "" {
		t.Fatal("si el conteo falla no se acuna ni se manda nada")
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && go test ./tests/ -count=1 -run 'TestRequestReset_PerAccountDailyCap|TestRequestReset_CountFailureFailsClosed'`
Expected: FAIL — `acuno 1 tokens, want 0` and `si el conteo falla no se acuna ni se manda nada`.

- [ ] **Step 3: Add the constants**

In `backend/internal/service/password_reset_service.go`, directly below the `minRequestResetDuration` block:

```go
// passwordResetDailyMax es el tope de codigos de recuperacion por CUENTA en
// quotaWindow. Tres alcanza de sobra para el caso real —pedis, no te llega,
// mirás el spam, pedis de nuevo— y deja el ataque acotado a 3 mails por victima
// en vez de 1440.
const passwordResetDailyMax = 3

// passwordResetGlobalDailyMax es la reserva del CANAL en quotaWindow. El cap por
// cuenta solo no protege la cuota compartida: un atacante con ~17 direcciones
// registradas la agotaria igual, y con ella se cae la verificacion de email de
// TODA la plataforma, no solo la recuperacion. Cincuenta deja 250 de los 300
// diarios de Brevo para la verificacion, que es el consumidor primario porque
// corre en cada alta.
const passwordResetGlobalDailyMax = 50

// quotaWindow es la ventana movil que usan los dos topes.
const quotaWindow = 24 * time.Hour
```

- [ ] **Step 4: Add the per-account check**

In `RequestReset`, immediately after the cooldown block (`if existing != nil && time.Since(existing.CreatedAt) < otpRateLimit { ... }`) and **before** `code, err := generateOTPCode()`:

```go
	// Tope diario por cuenta. Se traga igual que el cooldown: este camino solo se
	// alcanza para una cuenta que existe, asi que responder distinto lo delataria.
	since := time.Now().Add(-quotaWindow)
	userCount, err := s.tokenRepo.CountSince(ctx, &user.ID, ChannelPasswordReset, since)
	if err != nil {
		// Falla cerrado: sin numero no hay tope, y abrir la puerta ante un error
		// del conteo convierte cualquier hipo de la base en via libre.
		log.Printf("[password_reset] per-account quota count failed for user %s: %v", user.ID, err)
		return nil
	}
	if userCount >= passwordResetDailyMax {
		log.Printf("[password_reset] daily cap reached for user %s (%d/%d)", user.ID, userCount, passwordResetDailyMax)
		return nil
	}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd backend && go test ./tests/ -count=1 -run TestRequestReset -v`
Expected: every `TestRequestReset_*` passes, including the pre-existing ones.

- [ ] **Step 6: Commit**

```bash
git add backend/internal/service/password_reset_service.go backend/tests/password_reset_service_test.go
git commit -m "feat(auth): tope diario de recuperacion por cuenta"
```

---

### Task 4: Global daily reserve

**Files:**
- Modify: `backend/internal/service/password_reset_service.go`
- Test: `backend/tests/password_reset_service_test.go`

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/password_reset_service_test.go`:

```go
func TestRequestReset_GlobalDailyReserve(t *testing.T) {
	// Un usuario POR DEBAJO de su cap igual queda frenado si el canal agoto la
	// reserva. Esa es la unica capa que garantiza que la verificacion de email no
	// se caiga para toda la plataforma por culpa de los resets.
	users := knownUser("user@example.com")
	tokens := &resetTokenRepo{countByUser: 0, countGlobal: 50}
	m := &recordingMailer{}

	if err := newResetSvc(users, tokens, m).RequestReset(context.Background(), "user@example.com"); err != nil {
		t.Fatalf("RequestReset() = %v, want nil", err)
	}
	if len(tokens.created) != 0 {
		t.Fatalf("acuno %d tokens, want 0 — la reserva global no freno nada", len(tokens.created))
	}
	if m.sentTo != "" {
		t.Fatal("reserva agotada: no se puede mandar mail")
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && go test ./tests/ -count=1 -run TestRequestReset_GlobalDailyReserve`
Expected: FAIL — `acuno 1 tokens, want 0`.

- [ ] **Step 3: Add the global check**

Directly after the per-account block added in Task 3, still before `generateOTPCode`:

```go
	// Reserva global del canal. Protege la cuota diaria de Brevo que este flujo
	// COMPARTE con la verificacion de email: sin esto, un ataque de resets deja
	// sin verificar el mail a todos los usuarios nuevos de la plataforma.
	globalCount, err := s.tokenRepo.CountSince(ctx, nil, ChannelPasswordReset, since)
	if err != nil {
		log.Printf("[password_reset] global quota count failed: %v", err)
		return nil
	}
	if globalCount >= passwordResetGlobalDailyMax {
		// INCIDENTE, no rutina: es casi seguro un ataque, y a partir de acá la
		// recuperación de contraseña queda caída para TODOS hasta que corra la
		// ventana. Tiene que ser greppable: esta feature ya nos mordió dos veces
		// por fallar en silencio.
		log.Printf("[password_reset] ALERT: global daily reserve exhausted (%d/%d) — password recovery is disabled until the window rolls",
			globalCount, passwordResetGlobalDailyMax)
		return nil
	}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && go test ./tests/ ./internal/... -count=1`
Expected: every package `ok`.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/service/password_reset_service.go backend/tests/password_reset_service_test.go
git commit -m "feat(auth): reserva global diaria del canal password_reset"
```

---

### Task 5: i18n keys

**Files:**
- Modify: `frontend/packages/shared/i18n/locales/es.json`
- Modify: `frontend/packages/shared/i18n/locales/en.json`
- Modify: `frontend/packages/shared/i18n/locales/pt.json`

- [ ] **Step 1: Add the keys**

In each file, inside `auth.forgotPassword`, after `"backToLogin"`, add a comma to the previous line and then:

`es.json`:
```json
      "dailyLimitNotice": "Podés pedir hasta 3 códigos por día. Esperá 1 minuto entre intentos.",
      "resend": "Reenviar código",
      "resendIn": "Reenviar en {{seconds}}s"
```

`en.json`:
```json
      "dailyLimitNotice": "You can request up to 3 codes per day. Wait a minute between attempts.",
      "resend": "Resend code",
      "resendIn": "Resend in {{seconds}}s"
```

`pt.json`:
```json
      "dailyLimitNotice": "Você pode pedir até 3 códigos por dia. Espere 1 minuto entre tentativas.",
      "resend": "Reenviar código",
      "resendIn": "Reenviar em {{seconds}}s"
```

- [ ] **Step 2: Verify all three files are valid JSON**

Run: `cd frontend/packages/shared/i18n/locales && for f in es en pt; do node -e "JSON.parse(require('fs').readFileSync('$f.json','utf8')); console.log('$f ok')"; done`
Expected: `es ok`, `en ok`, `pt ok`.

- [ ] **Step 3: Commit**

```bash
git add frontend/packages/shared/i18n/locales/es.json frontend/packages/shared/i18n/locales/en.json frontend/packages/shared/i18n/locales/pt.json
git commit -m "feat(i18n): textos del cupo diario de recuperacion"
```

---

### Task 6: Web — policy line and resend countdown

**Files:**
- Modify: `frontend/packages/web/src/pages/ForgotPasswordPage.tsx`
- Test: `frontend/packages/web/src/pages/ForgotPasswordPage.test.tsx`

- [ ] **Step 1: Write the failing tests**

This file mocks i18next as `t: (k) => k`, so **the rendered text is the key itself**, never Spanish. It uses `fireEvent` and the local `renderPage()` helper, not `userEvent`. Match that.

First, add one line to the existing `beforeEach`, because jsdom shares `sessionStorage` across tests in a file and a leftover deadline would make later tests start mid-countdown:

```tsx
  sessionStorage.clear();
```

Then append inside the existing top-level `describe`:

```tsx
  it('shows the daily-limit policy on the email step', () => {
    // FIXED text: it states policy, never account state. A real "2 of 3 left"
    // counter is computable only for an account that exists, so rendering one
    // would rebuild the enumeration oracle the backend was shaped to deny.
    renderPage();
    expect(screen.getByText('forgotPassword.dailyLimitNotice')).toBeInTheDocument();
  });

  it('disables resend with a countdown, then re-enables it after 60s', async () => {
    // shouldAdvanceTime keeps findBy* from hanging under fake timers.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderPage();

      fireEvent.change(screen.getByLabelText('forgotPassword.email'), {
        target: { value: 'user@example.com' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'forgotPassword.sendCode' }));

      // The mock drops the interpolation object, so the accessible name is the
      // bare key — which is exactly what distinguishes the two states.
      const resend = await screen.findByRole('button', { name: 'forgotPassword.resendIn' });
      expect(resend).toBeDisabled();

      await act(async () => {
        vi.advanceTimersByTime(61_000);
      });

      expect(
        await screen.findByRole('button', { name: 'forgotPassword.resend' }),
      ).toBeEnabled();
    } finally {
      vi.useRealTimers();
    }
  });
```

Add `act` to the existing `@testing-library/react` import. `vi` is already imported.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend/packages/web && pnpm vitest run src/pages/ForgotPasswordPage.test.tsx`
Expected: FAIL — the policy text and the resend button do not exist.

- [ ] **Step 3: Add the countdown helpers**

At module scope in `ForgotPasswordPage.tsx`, above the component:

```tsx
const RESEND_COOLDOWN_MS = 60_000;

// sessionStorage, NO localStorage. El tamaño no es el problema (son ~13 bytes
// contra un presupuesto de 5-10 MB por origen, y se sobrescribe en vez de
// acumularse): el problema es la vida util. localStorage no expira nunca, asi que
// una clave escrita en un reset que hacés una vez en la vida queda para siempre.
// sessionStorage lo borra el navegador al cerrar la pestaña, que es exactamente
// lo que dura un contador de 60 segundos, y no necesita codigo de limpieza.
// Sobrevive un F5, que es el caso que importa: si recargás y reenviás enseguida,
// el servidor se come el pedido en silencio por el cooldown.
const RESEND_DEADLINE_KEY = 'searchpet:pwreset:resendAt';

function readResendDeadline(): number {
  try {
    const raw = sessionStorage.getItem(RESEND_DEADLINE_KEY);
    const at = raw ? Number(raw) : 0;
    return Number.isFinite(at) ? at : 0;
  } catch {
    // Safari en modo privado tira al tocar storage. Sin contador se vive; con
    // una excepcion sin atrapar se rompe la pantalla entera.
    return 0;
  }
}

function writeResendDeadline(at: number): void {
  try {
    sessionStorage.setItem(RESEND_DEADLINE_KEY, String(at));
  } catch {
    /* ver readResendDeadline */
  }
}
```

- [ ] **Step 4: Wire the countdown into the component**

Inside `ForgotPasswordPage`, after the existing `useState` declarations:

```tsx
  const [secondsLeft, setSecondsLeft] = useState(0);

  useEffect(() => {
    const tick = () => {
      const ms = readResendDeadline() - Date.now();
      setSecondsLeft(ms > 0 ? Math.ceil(ms / 1000) : 0);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
```

Add `useEffect` to the existing `react` import.

In `handleRequest`, immediately after the `await apiClient.forgotPassword(...)` call and before `setStep('code')`:

```tsx
      writeResendDeadline(Date.now() + RESEND_COOLDOWN_MS);
      setSecondsLeft(RESEND_COOLDOWN_MS / 1000);
```

- [ ] **Step 5: Render the policy line and the resend control**

In the email step, directly below the `{t('forgotPassword.emailStepDescription')}` element:

```tsx
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t('forgotPassword.dailyLimitNotice')}
          </p>
```

In the code step, directly below the `{t('forgotPassword.codeStepDescription')}` element:

```tsx
          <button
            type="button"
            onClick={() => { void handleRequest(); }}
            disabled={secondsLeft > 0 || loading}
            className="text-sm text-primary underline disabled:no-underline disabled:text-gray-400"
          >
            {secondsLeft > 0
              ? t('forgotPassword.resendIn', { seconds: secondsLeft })
              : t('forgotPassword.resend')}
          </button>
```

`handleRequest` already takes a `React.FormEvent`; change its signature to `(e?: React.FormEvent)` and its first line to `e?.preventDefault();` so the button can call it without an event.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd frontend/packages/web && pnpm vitest run src/pages/ForgotPasswordPage.test.tsx`
Expected: PASS, including the two pre-existing tests in the file.

- [ ] **Step 7: Run the full web suite**

Run: `cd frontend/packages/web && pnpm test:run`
Expected: all web and shared files pass.

- [ ] **Step 8: Commit**

```bash
git add frontend/packages/web/src/pages/ForgotPasswordPage.tsx frontend/packages/web/src/pages/ForgotPasswordPage.test.tsx
git commit -m "feat(web): politica de limite diario y reenvio con cuenta regresiva"
```

---

### Task 7: Mobile — policy line and resend countdown

**Files:**
- Modify: `frontend/packages/mobile/app/forgot-password.tsx`
- Test: `frontend/packages/mobile/__tests__/forgot-password.test.tsx`

- [ ] **Step 1: Write the failing tests**

This file also mocks i18next as `t: (key) => key`, so **assert on keys, never on Spanish text**. It uses the module-level `screen` from `@testing-library/react-native` plus `fireEvent` and `waitFor`. Append inside the existing top-level `describe`:

```tsx
  it('shows the daily-limit policy on the email step', () => {
    // FIXED text: policy, never account state — same reason as the web page.
    render(<ForgotPasswordScreen />);
    expect(screen.getByText('forgotPassword.dailyLimitNotice')).toBeTruthy();
  });

  it('disables resend with a countdown, then re-enables it after 60s', async () => {
    // Fake timers go in BEFORE render. Installing them afterwards would leave the
    // component's setInterval scheduled on the real clock, and advanceTimersByTime
    // would never fire it — the test would pass or fail for the wrong reason.
    jest.useFakeTimers();
    try {
      render(<ForgotPasswordScreen />);

      fireEvent.changeText(screen.getByPlaceholderText('forgotPassword.email'), 'user@example.com');
      // await act flushes the resolved API promise. Promise resolution is a
      // microtask, so it works under fake timers without advancing anything.
      await act(async () => {
        fireEvent.press(screen.getByText('forgotPassword.sendCode'));
      });

      // The i18n mock drops the interpolation object, so the two states render as
      // two distinct bare keys — which is what makes them assertable.
      expect(screen.getByText('forgotPassword.resendIn')).toBeTruthy();

      act(() => {
        jest.advanceTimersByTime(61_000);
      });
      expect(screen.getByText('forgotPassword.resend')).toBeTruthy();
    } finally {
      jest.useRealTimers();
    }
  });
```

Add `act` to the existing `@testing-library/react-native` import. Modern Jest fake timers also mock `Date.now()`, which is what makes the deadline-based countdown advance correctly.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend/packages/mobile && npx jest __tests__/forgot-password.test.tsx`
Expected: FAIL — neither the policy text nor the resend control exists.

- [ ] **Step 3: Add the countdown state**

In `forgot-password.tsx`, after the existing `useState` declarations:

```tsx
  // Sin storage: en React Native no hay localStorage, y un contador de 60s no
  // tiene por que sobrevivir a la pantalla. Muere con el componente, que es la
  // vida util correcta.
  //
  // Un deadline + un unico setInterval, en vez de una cadena de setTimeout que se
  // reprograma sola: la cadena obliga a que cada tick corra dentro de su propio
  // act() en los tests, y el deadline ademas no se desfasa si el JS thread se
  // traba. Mismo criterio que la web.
  const [resendAt, setResendAt] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(0);

  useEffect(() => {
    const tick = () => {
      const ms = resendAt - Date.now();
      setSecondsLeft(ms > 0 ? Math.ceil(ms / 1000) : 0);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [resendAt]);
```

Add `useEffect` to the existing `react` import.

In `handleRequestCode`, right after the `await apiClient.forgotPassword(...)` call:

```tsx
      setResendAt(Date.now() + 60_000);
```

- [ ] **Step 4: Render the policy line and the resend control**

Below the email-step description `<Text>`:

```tsx
        <Text style={styles.notice}>{t('forgotPassword.dailyLimitNotice')}</Text>
```

Below the code-step description `<Text>`:

```tsx
        <TouchableOpacity
          onPress={handleRequestCode}
          disabled={secondsLeft > 0 || isLoading}
        >
          <Text style={[styles.link, secondsLeft > 0 && styles.linkDisabled]}>
            {secondsLeft > 0
              ? t('forgotPassword.resendIn', { seconds: secondsLeft })
              : t('forgotPassword.resend')}
          </Text>
        </TouchableOpacity>
```

Add to the `StyleSheet.create` block, reusing the file's existing colour constants:

```tsx
  notice: { fontSize: 13, color: COLORS.textLight, marginTop: 8 },
  linkDisabled: { color: COLORS.textLight },
```

If `styles.link` does not exist in this file, add:

```tsx
  link: { fontSize: 14, color: COLORS.primary, marginTop: 12 },
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd frontend/packages/mobile && npx jest __tests__/forgot-password.test.tsx`
Expected: PASS.

- [ ] **Step 6: Run the full mobile suite**

Run: `cd frontend/packages/mobile && pnpm test:run`
Expected: all suites pass. **Never `pnpm test`** — that is `jest --watchAll` and never exits (rule #17).

- [ ] **Step 7: Commit**

```bash
git add frontend/packages/mobile/app/forgot-password.tsx frontend/packages/mobile/__tests__/forgot-password.test.tsx
git commit -m "feat(mobile): politica de limite diario y reenvio con cuenta regresiva"
```

---

### Task 8: Full verification and PR

**Files:** none — verification only.

- [ ] **Step 1: Backend suite**

Run: `cd backend && go build ./... && go vet ./... && go test ./... -count=1`
Expected: every package `ok`. `-count=1` is mandatory: `go test` reports `ok (cached)` after edits and a cached green means nothing.

- [ ] **Step 2: E2E against a throwaway database**

```bash
docker exec lostpets-db psql -U postgres -c "DROP DATABASE IF EXISTS lostpets_test;" -q
docker exec lostpets-db psql -U postgres -c "CREATE DATABASE lostpets_test;" -q
cd backend && DATABASE_URL="postgres://postgres:postgres@localhost:5433/lostpets_test?sslmode=disable" JWT_SECRET=test-secret-e2e go test -tags e2e -count=1 ./tests/e2e/...
```
Expected: `ok lost-pets/tests/e2e`. Never point this at `lostpets` — it wipes the local seed.

- [ ] **Step 3: Frontend suites**

Run: `cd frontend/packages/web && pnpm test:run` then `cd ../mobile && pnpm test:run`
Expected: both green.

- [ ] **Step 4: Open the PR**

```bash
git log --oneline origin/main..HEAD
```
Expected: exactly the commits from this plan. If more appear, the branch came off the wrong base (rule #30).

Then create the PR against `main` following the `searchpet-pr` skill. Flag the sensitive surface in the body: this changes the authentication path and can deny password recovery, so it deserves a read before merge.

---

## Notes for the implementer

- **"A different user is unaffected by another's cap" is covered at the repository level, not the service level.** The spec lists it as a service test, but the service mock returns whatever `countByUser` is set to regardless of which user is passed, so a mock-based version would assert nothing. The real guarantee — that the `user_id` filter works — is Task 1's test, where bob's row is excluded from alice's count against real Postgres. Do not add a vacuous mock test to "cover" it.
- **Every rejection in `RequestReset` returns `nil`, never an error.** This is not sloppiness, it is the enumeration defence. If you find yourself wanting to return a `429` or a distinct error code so the UI can be helpful, re-read the spec's HTTP contract section first.
- **`CountSince` must never filter on `used`.** Task 1 Step 7 exists to prove that guard has teeth. Do not skip it.
- **The caps count attempts, not deliveries.** A send failure marks the token used to free the cooldown, but the row still counts. That is intentional and documented in the spec's Open risks.
