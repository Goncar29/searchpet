package tests

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/repository"
	"lost-pets/tests/testdb"
)

func TestVerificationTokenRepository_CreateAndGetByToken(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	tokenRepo := repository.NewVerificationTokenRepository(gormDB)
	ctx := context.Background()

	user := newTestUser(t, userRepo)

	token := &domain.VerificationToken{
		ID:        uuid.New(),
		UserID:    user.ID,
		Channel:   "email",
		CodeHash:  "abc123hashvalue0000000000000000000000000000000000000000000000000",
		ExpiresAt: time.Now().Add(30 * time.Minute),
		Used:      false,
	}
	if err := tokenRepo.Create(ctx, token); err != nil {
		t.Fatalf("Create: %v", err)
	}

	// FindActiveByUser should return the token
	got, err := tokenRepo.FindActiveByUser(ctx, user.ID, "email")
	if err != nil {
		t.Fatalf("FindActiveByUser: %v", err)
	}
	if got == nil {
		t.Fatal("want non-nil token, got nil")
	}
	if got.ID != token.ID {
		t.Errorf("want token ID %s, got %s", token.ID, got.ID)
	}
	if got.Channel != "email" {
		t.Errorf("want channel 'email', got %q", got.Channel)
	}
}

func TestVerificationTokenRepository_GetByToken_Expired(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	tokenRepo := repository.NewVerificationTokenRepository(gormDB)
	ctx := context.Background()

	user := newTestUser(t, userRepo)

	// Create an already-expired token
	token := &domain.VerificationToken{
		ID:        uuid.New(),
		UserID:    user.ID,
		Channel:   "email",
		CodeHash:  "expiredhashvalue000000000000000000000000000000000000000000000000",
		ExpiresAt: time.Now().Add(-1 * time.Minute), // already expired
		Used:      false,
	}
	if err := tokenRepo.Create(ctx, token); err != nil {
		t.Fatalf("Create: %v", err)
	}

	// FindActiveByUser should return nil (expired token is not "active")
	got, err := tokenRepo.FindActiveByUser(ctx, user.ID, "email")
	if err != nil {
		t.Fatalf("FindActiveByUser: %v", err)
	}
	if got != nil {
		t.Errorf("want nil for expired token, got token ID %s", got.ID)
	}
}

func TestVerificationTokenRepository_MarkUsed(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	tokenRepo := repository.NewVerificationTokenRepository(gormDB)
	ctx := context.Background()

	user := newTestUser(t, userRepo)

	token := &domain.VerificationToken{
		ID:        uuid.New(),
		UserID:    user.ID,
		Channel:   "sms",
		CodeHash:  "smshashabcdefg00000000000000000000000000000000000000000000000000",
		ExpiresAt: time.Now().Add(15 * time.Minute),
		Used:      false,
	}
	if err := tokenRepo.Create(ctx, token); err != nil {
		t.Fatalf("Create: %v", err)
	}

	if err := tokenRepo.MarkUsed(ctx, token.ID); err != nil {
		t.Fatalf("MarkUsed: %v", err)
	}

	// After marking used, FindActiveByUser should return nil (used=true)
	got, err := tokenRepo.FindActiveByUser(ctx, user.ID, "sms")
	if err != nil {
		t.Fatalf("FindActiveByUser after MarkUsed: %v", err)
	}
	if got != nil {
		t.Errorf("want nil after MarkUsed, got token ID %s", got.ID)
	}
}

func TestVerificationTokenRepository_IncrementAttempts(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	tokenRepo := repository.NewVerificationTokenRepository(gormDB)
	ctx := context.Background()

	user := newTestUser(t, userRepo)
	token := &domain.VerificationToken{
		ID:        uuid.New(),
		UserID:    user.ID,
		Channel:   "email",
		CodeHash:  "attempthashvalue000000000000000000000000000000000000000000000000",
		ExpiresAt: time.Now().Add(30 * time.Minute),
	}
	if err := tokenRepo.Create(ctx, token); err != nil {
		t.Fatalf("Create: %v", err)
	}

	count, err := tokenRepo.IncrementAttempts(ctx, token.ID)
	if err != nil {
		t.Fatalf("IncrementAttempts: %v", err)
	}
	if count != 1 {
		t.Errorf("want attempts=1 after first increment, got %d", count)
	}

	count2, err := tokenRepo.IncrementAttempts(ctx, token.ID)
	if err != nil {
		t.Fatalf("IncrementAttempts (2nd): %v", err)
	}
	if count2 != 2 {
		t.Errorf("want attempts=2 after second increment, got %d", count2)
	}
}

func TestVerificationTokenRepository_DeleteExpired(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	tokenRepo := repository.NewVerificationTokenRepository(gormDB)
	ctx := context.Background()

	user := newTestUser(t, userRepo)

	// Vencidos hace MÁS de la retención: éstos sí se barren.
	for i, dur := range []time.Duration{
		-repository.TokenRetention - 2*time.Hour,
		-repository.TokenRetention - 1*time.Hour,
	} {
		tok := &domain.VerificationToken{
			ID:        uuid.New(),
			UserID:    user.ID,
			Channel:   "email",
			CodeHash:  generateTestHash(i),
			ExpiresAt: time.Now().Add(dur),
		}
		if err := tokenRepo.Create(ctx, tok); err != nil {
			t.Fatalf("Create expired token %d: %v", i, err)
		}
	}
	validToken := &domain.VerificationToken{
		ID:        uuid.New(),
		UserID:    user.ID,
		Channel:   "email",
		CodeHash:  generateTestHash(99),
		ExpiresAt: time.Now().Add(30 * time.Minute),
	}
	if err := tokenRepo.Create(ctx, validToken); err != nil {
		t.Fatalf("Create valid token: %v", err)
	}

	// Vencido hace poco, DENTRO de la retención: tiene que sobrevivir. Es la fila
	// que el cupo diario necesita seguir contando; barrerla era el defecto.
	recentlyExpired := &domain.VerificationToken{
		ID:        uuid.New(),
		UserID:    user.ID,
		Channel:   "password_reset",
		CodeHash:  generateTestHash(50),
		ExpiresAt: time.Now().Add(-1 * time.Minute),
	}
	if err := tokenRepo.Create(ctx, recentlyExpired); err != nil {
		t.Fatalf("Create recently expired token: %v", err)
	}

	deleted, err := tokenRepo.DeleteExpired(ctx)
	if err != nil {
		t.Fatalf("DeleteExpired: %v", err)
	}
	if deleted < 2 {
		t.Errorf("want at least 2 deleted (expired tokens), got %d", deleted)
	}

	// Valid token should still be retrievable
	got, err := tokenRepo.FindActiveByUser(ctx, user.ID, "email")
	if err != nil {
		t.Fatalf("FindActiveByUser after DeleteExpired: %v", err)
	}
	if got == nil {
		t.Error("valid token should still exist after DeleteExpired")
	}

	// Y el recién vencido también, aunque ya no sea "activo": el cupo diario lo
	// cuenta por created_at, no por vigencia.
	var survivors int64
	if err := gormDB.Model(&domain.VerificationToken{}).
		Where("id = ?", recentlyExpired.ID).Count(&survivors).Error; err != nil {
		t.Fatalf("count recently expired: %v", err)
	}
	if survivors != 1 {
		t.Error("un token vencido hace un minuto NO puede barrerse: está dentro de la ventana que cuenta el cupo diario")
	}
}

// generateTestHash returns a 64-char hex string safe as a CodeHash.
func generateTestHash(i int) string {
	return fmt.Sprintf("%063d%d", 0, i%10)
}

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

// El cupo diario cuenta HISTORIA, y esta tabla tiene un reaper: router.go corre
// DeleteExpired cada hora, y es un borrado DURO (VerificationToken no tiene
// gorm.DeletedAt). Con los OTP venciendo a los 10 minutos, un sweeper sin
// retencion vacia la ventana de conteo entera cada hora y el tope de 3/dia pasa a
// ser 3/HORA — la feature dejaria de hacer lo que dice.
//
// Este test es el que faltaba. TestVerificationTokenRepository_CountSince backdatea
// filas a mano y NUNCA corre el sweeper: usa una base real, pero modela un mundo sin
// jobs de fondo. Una base de verdad no alcanza si el entorno que simula no existe.
func TestVerificationTokenRepository_DeleteExpiredRespetaLaVentanaDeConteo(t *testing.T) {
	// Regla #40: los DOS canales cuentan historia sobre una tabla que tiene un
	// reaper horario. Si el sweeper se lleva la ventana, el tope diario del canal
	// es ficcion — que es exactamente lo que paso con password_reset la primera
	// vez, y el canal email quedaba sin cubrir al ponerle su propio cupo.
	for _, channel := range []string{"password_reset", "email"} {
		t.Run(channel, func(t *testing.T) {
			gormDB := testdb.SetupTestDB(t)
			userRepo := repository.NewUserRepository(gormDB)
			tokenRepo := repository.NewVerificationTokenRepository(gormDB)
			ctx := context.Background()

			user := newTestUser(t, userRepo)
			now := time.Now()

			// Este test siembra una fila que SOBREVIVE al sweeper a proposito, y la
			// base de tests no trunca entre tests: sin esto queda en el canal para
			// el que venga despues. NthOldestCreatedAtSince mide el canal entero
			// con userID nil y compara contra su propio `now` con +-1s, asi que la
			// heredaba y pasaba solo mientras los dos tests corrieran con menos de
			// un segundo de diferencia.
			t.Cleanup(func() {
				gormDB.Where("user_id = ?", user.ID).Delete(&domain.VerificationToken{})
			})

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

			// La de 23h tiene que seguir contando DESPUES de la barrida. Si el
			// sweeper se la lleva, el usuario recupera cupo cada hora y el tope
			// diario es ficcion.
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

// El 429 del tope diario promete un Retry-After real: cuanto falta para que el
// codigo mas viejo de la ventana salga de ella. Eso no lo puede contestar
// CountSince, y un numero inventado es peor que no dar ninguno.
func TestVerificationTokenRepository_NthOldestCreatedAtSince(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	tokenRepo := repository.NewVerificationTokenRepository(gormDB)
	ctx := context.Background()

	user := newTestUser(t, userRepo)
	other := newTestUser(t, userRepo)
	now := time.Now()

	// Limpiar lo propio por el mismo motivo: este test tambien deja filas del
	// canal email y otros miden el canal entero.
	t.Cleanup(func() {
		gormDB.Where("user_id IN ?", []any{user.ID, other.ID}).Delete(&domain.VerificationToken{})
	})

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

	// Sin filas en la ventana: nil, sin error. El servicio lo lee como "no se
	// puede calcular" y cae a la ventana entera.
	got, err := tokenRepo.NthOldestCreatedAtSince(ctx, &user.ID, "email", since, 0)
	if err != nil {
		t.Fatalf("NthOldestCreatedAtSince (vacio): %v", err)
	}
	if got != nil {
		t.Fatalf("sin filas want nil, got %v", got)
	}

	mint(user.ID, "email", now.Add(-5*time.Hour))
	mint(user.ID, "email", now.Add(-20*time.Hour))          // la mas vieja DENTRO de la ventana
	mint(user.ID, "email", now.Add(-30*time.Hour))          // fuera de la ventana: no cuenta
	mint(user.ID, "password_reset", now.Add(-23*time.Hour)) // otro canal: no cuenta
	mint(other.ID, "email", now.Add(-23*time.Hour))         // otro usuario: no cuenta por cuenta

	got, err = tokenRepo.NthOldestCreatedAtSince(ctx, &user.ID, "email", since, 0)
	if err != nil {
		t.Fatalf("OldestCreatedAtSince: %v", err)
	}
	if got == nil {
		t.Fatal("want la fila de -20h, got nil")
	}
	if diff := got.Sub(now.Add(-20 * time.Hour)); diff > time.Second || diff < -time.Second {
		t.Fatalf("oldest por cuenta = %v, want ~%v — se colo otro canal, otro usuario o una fila fuera de la ventana",
			got, now.Add(-20*time.Hour))
	}

	// userID nil mide el CANAL entero: ahi la de otro usuario a -23h es mas vieja.
	got, err = tokenRepo.NthOldestCreatedAtSince(ctx, nil, "email", since, 0)
	if err != nil {
		t.Fatalf("NthOldestCreatedAtSince (canal): %v", err)
	}
	if got == nil {
		t.Fatal("canal: want la fila de -23h, got nil")
	}
	if diff := got.Sub(now.Add(-23 * time.Hour)); diff > time.Second || diff < -time.Second {
		t.Fatalf("oldest del canal = %v, want ~%v", got, now.Add(-23*time.Hour))
	}

	// skip: la razon de ser del parametro. Con el contador por encima del tope,
	// esperar a la fila mas vieja no devuelve el cupo —siguen sobrando— y el
	// Retry-After manda al cliente a comerse otro 429. La cuenta tiene dos filas
	// en la ventana (-20h y -5h): skip=1 tiene que dar la de -5h, no la de -20h.
	got, err = tokenRepo.NthOldestCreatedAtSince(ctx, &user.ID, "email", since, 1)
	if err != nil {
		t.Fatalf("NthOldestCreatedAtSince (skip=1): %v", err)
	}
	if got == nil {
		t.Fatal("skip=1: want la fila de -5h, got nil")
	}
	if diff := got.Sub(now.Add(-5 * time.Hour)); diff > time.Second || diff < -time.Second {
		t.Fatalf("skip=1 = %v, want ~%v — devolvio la mas vieja, o sea que el offset no se aplico",
			got, now.Add(-5*time.Hour))
	}

	// Mas skip que filas: nil, no un error ni la ultima. El servicio lo lee como
	// "no se puede calcular" y cae a la ventana entera, que es lo conservador.
	got, err = tokenRepo.NthOldestCreatedAtSince(ctx, &user.ID, "email", since, 99)
	if err != nil {
		t.Fatalf("NthOldestCreatedAtSince (skip fuera de rango): %v", err)
	}
	if got != nil {
		t.Fatalf("skip fuera de rango want nil, got %v", got)
	}
}
