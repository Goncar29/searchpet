package tests

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"testing"
	"time"

	"lost-pets/internal/domain"
	"lost-pets/internal/repository"
	"lost-pets/internal/service"
	"lost-pets/tests/testdb"
)

// emailGlobalMaxUnderTest replica emailVerificationGlobalDailyMax, que no esta
// exportado. Si alguien mueve la constante este test NO se vuelve vacuo en
// silencio: la asercion de "exactamente uno pasa" lo delata y su mensaje dice
// que hay que actualizar este valor.
const emailGlobalMaxUnderTest = 250

// La reserva del canal solo puede desbordar con requests SIMULTANEOS, y ese es
// justo el escenario que ningun otro test de esta suite puede ver: todos usan
// mockTokenRepo, cuyo WithChannelLock ejecuta fn derecho, en un solo goroutine.
// Es la regla #40 un paso mas alla — no alcanza con correr contra Postgres real
// si el escenario que modelas no existe.
//
// Sin el lock, contar y acunar son dos operaciones separadas: N requests leen el
// mismo 249 y los N acunan. Como los 250 del canal mas los 50 de password_reset
// son EXACTAMENTE los 300 diarios de Brevo, ese excedente no tiene colchon y
// termina como rechazo opaco del proveedor: el modo de falla que el cupo vino a
// reemplazar.
func TestSendOTP_ReservaDelCanalNoDesbordaConRequestsSimultaneos(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	tokenRepo := repository.NewVerificationTokenRepository(gormDB)
	ctx := context.Background()

	windowStart := time.Now().Add(-service.QuotaWindow)

	// La base de tests NO se trunca entre tests, asi que otros pueden haber
	// dejado filas del canal. Se cuentan y se siembra la diferencia: sin esto el
	// test depende del orden de ejecucion, que es la clase de fragilidad que
	// hace que un guard deje de significar algo.
	var already int64
	if err := gormDB.Model(&domain.VerificationToken{}).
		Where("channel = ? AND created_at >= ?", service.ChannelEmail, windowStart).
		Count(&already).Error; err != nil {
		t.Fatalf("contar lo que ya habia en el canal: %v", err)
	}
	toSeed := emailGlobalMaxUnderTest - 1 - int(already)
	if toSeed < 0 {
		t.Fatalf("el canal ya tiene %d filas en la ventana y el tope es %d: no queda lugar para montar el escenario",
			already, emailGlobalMaxUnderTest)
	}

	// Las filas sembradas van a nombre de un usuario aparte: CountSince con
	// userID nil mide el canal entero, no importa de quien sean.
	filler := newTestUser(t, userRepo)
	seed := make([]domain.VerificationToken, 0, toSeed)
	for i := 0; i < toSeed; i++ {
		seed = append(seed, domain.VerificationToken{
			UserID:    filler.ID,
			Channel:   service.ChannelEmail,
			CodeHash:  fmt.Sprintf("%064x", i),
			ExpiresAt: time.Now().Add(10 * time.Minute),
		})
	}
	if len(seed) > 0 {
		if err := gormDB.CreateInBatches(&seed, 100).Error; err != nil {
			t.Fatalf("sembrar la reserva hasta el borde: %v", err)
		}
	}

	// Cada llamador es un usuario DISTINTO y recien creado, asi el cooldown de
	// 60s y el tope por cuenta quedan fuera de la ecuacion: lo unico que puede
	// frenar a alguien es la reserva del canal.
	const callers = 12
	users := make([]*domain.User, callers)
	for i := range users {
		users[i] = newTestUser(t, userRepo)
	}

	// Limpiar lo propio: este test deja el canal en su tope, y otros tests miden
	// el canal entero con userID nil.
	t.Cleanup(func() {
		ids := []any{filler.ID}
		for _, u := range users {
			ids = append(ids, u.ID)
		}
		gormDB.Where("user_id IN ?", ids).Delete(&domain.VerificationToken{})
	})

	svc := service.NewVerificationService(tokenRepo, userRepo, &noopMailer{}, nil)

	// CALENTAR EL POOL, o el test no prueba nada. database/sql mantiene 2
	// conexiones idle por defecto: con la barrera abierta, el primer goroutine
	// agarra una caliente y corre sus cinco round-trips mientras los demas
	// siguen haciendo el handshake TCP de una conexion nueva. Eso los escalona
	// solos y la ventana entre contar y acunar nunca se solapa — verificado:
	// sin este bloque el test pasaba IGUAL con el lock sacado.
	//
	// Se sube solo MaxIdleConns. MaxOpenConns queda sin limite a proposito: el
	// lock corre en su propia transaccion y fn escribe por OTRA conexion, asi
	// que un pool acotado puede deadlockear (todos los waiters ocupando el pool
	// mientras el que tiene el lock no consigue su segunda conexion).
	sqlDB, err := gormDB.DB()
	if err != nil {
		t.Fatalf("obtener *sql.DB: %v", err)
	}
	sqlDB.SetMaxIdleConns(callers * 2)
	var warm sync.WaitGroup
	warmStart := make(chan struct{})
	for i := 0; i < callers*2; i++ {
		warm.Add(1)
		go func() {
			defer warm.Done()
			<-warmStart
			var one int
			_ = sqlDB.QueryRow("SELECT 1").Scan(&one)
		}()
	}
	close(warmStart)
	warm.Wait()

	// Barrera de largada: que los goroutines no se serialicen solos por el costo
	// de arrancar. Sin esto el test puede pasar sin haber probado nada.
	start := make(chan struct{})
	errs := make([]error, callers)
	var wg sync.WaitGroup
	for i := 0; i < callers; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-start
			errs[i] = svc.SendOTP(ctx, users[i].ID, service.ChannelEmail)
		}(i)
	}
	close(start)
	wg.Wait()

	granted := 0
	for i, err := range errs {
		switch {
		case err == nil:
			granted++
		case errors.Is(err, domain.ErrOTPChannelUnavailable):
			// Esperado: cuando le toco el lock, la reserva ya estaba agotada.
		default:
			t.Fatalf("caller %d: error inesperado %v", i, err)
		}
	}

	var total int64
	if err := gormDB.Model(&domain.VerificationToken{}).
		Where("channel = ? AND created_at >= ?", service.ChannelEmail, windowStart).
		Count(&total).Error; err != nil {
		t.Fatalf("contar el canal despues: %v", err)
	}

	// LA asercion. Sin el lock quedan (tope-1)+callers filas y el canal se paso
	// de su reserva; con el lock, exactamente el tope.
	if total > emailGlobalMaxUnderTest {
		t.Fatalf("el canal quedo en %d filas con un tope de %d: %d requests simultaneos pasaron el mismo conteo y acunaron igual",
			total, emailGlobalMaxUnderTest, granted)
	}
	if granted != 1 {
		t.Fatalf("pasaron %d de %d requests, want exactamente 1. Si es 0, se movio emailVerificationGlobalDailyMax: actualiza emailGlobalMaxUnderTest (hoy %d)",
			granted, callers, emailGlobalMaxUnderTest)
	}
}
