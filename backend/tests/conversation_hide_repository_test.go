package tests

import (
	"context"
	"testing"
	"time"

	"lost-pets/internal/domain"
	"lost-pets/internal/repository"
	"lost-pets/tests/testdb"
)

func TestConversationHideRepository_UpsertCreatesAndRefreshes(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	hideRepo := repository.NewConversationHideRepository(gormDB)
	ctx := context.Background()

	me := newTestUser(t, userRepo)
	other := newTestUser(t, userRepo)

	// First hide creates the row
	if err := hideRepo.Upsert(ctx, me.ID, other.ID); err != nil {
		t.Fatalf("first Upsert: %v", err)
	}

	var hide domain.ConversationHide
	if err := gormDB.Where("user_id = ? AND other_user_id = ?", me.ID, other.ID).First(&hide).Error; err != nil {
		t.Fatalf("hide row not found: %v", err)
	}
	firstHiddenAt := hide.HiddenAt

	// Second hide refreshes hidden_at instead of failing on the PK
	time.Sleep(50 * time.Millisecond)
	if err := hideRepo.Upsert(ctx, me.ID, other.ID); err != nil {
		t.Fatalf("second Upsert: %v", err)
	}
	if err := gormDB.Where("user_id = ? AND other_user_id = ?", me.ID, other.ID).First(&hide).Error; err != nil {
		t.Fatalf("hide row not found after re-hide: %v", err)
	}
	if !hide.HiddenAt.After(firstHiddenAt) {
		t.Errorf("want hidden_at refreshed: first=%v second=%v", firstHiddenAt, hide.HiddenAt)
	}

	// Only one row exists for the pair
	var count int64
	gormDB.Model(&domain.ConversationHide{}).
		Where("user_id = ? AND other_user_id = ?", me.ID, other.ID).Count(&count)
	if count != 1 {
		t.Errorf("want 1 hide row, got %d", count)
	}
}

// `hidden_at` tiene que salir del reloj de la APP, no del de Postgres.
//
// POR QUE IMPORTA: la regla de visibilidad de "borrar conversación" es
// `hidden_at >= messages.created_at`, y `created_at` lo escribe GORM con
// `autoCreateTime`, o sea `time.Now()` del proceso Go. Con `NOW()` de Postgres
// escribiendo el otro lado, esa comparación cruzaba dos relojes — y en
// producción son dos máquinas, la API en Render y la base en Neon. Un desfase δ
// con la base adelantada se traga todo mensaje que entre en esa ventana justo
// después del borrado, y desde que la regla se aplica también al hilo, ese
// mensaje queda inalcanzable en las TRES vistas, para siempre.
//
// LO QUE ESTE TEST PUEDE Y NO PUEDE REPRODUCIR, que es la parte honesta: el
// desfase entre máquinas NO se puede reproducir acá, porque el Postgres de
// Docker comparte el reloj del host. Lo que sí se reproduce es la OTRA cara del
// mismo defecto, que basta para distinguir las dos implementaciones: `NOW()`
// devuelve la hora de INICIO DE LA TRANSACCIÓN, no la del statement. Con una
// transacción abierta desde hace más de un segundo, la versión vieja estampa un
// `hidden_at` en el pasado; la nueva estampa el instante real de la llamada.
//
// No es un caso de laboratorio: este repo tiene unit of work, así que un
// `Upsert` adentro de una transacción larga es alcanzable.
func TestConversationHideRepository_HiddenAtSaleDelRelojDeLaApp(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	ctx := context.Background()

	yo := newTestUser(t, userRepo)
	otro := newTestUser(t, userRepo)

	// Transacción abierta ANTES, y sostenida. GORM manda el BEGIN acá, así que
	// desde este punto `NOW()` queda congelado para toda la transacción.
	tx := gormDB.Begin()
	if tx.Error != nil {
		t.Fatalf("Begin: %v", tx.Error)
	}
	defer tx.Rollback()

	time.Sleep(1200 * time.Millisecond)

	antes := time.Now()
	hideRepo := repository.NewConversationHideRepository(tx)
	if err := hideRepo.Upsert(ctx, yo.ID, otro.ID); err != nil {
		t.Fatalf("Upsert: %v", err)
	}

	var hiddenAt time.Time
	if err := tx.Raw(
		`SELECT hidden_at FROM conversation_hides WHERE user_id = ? AND other_user_id = ?`,
		yo.ID, otro.ID,
	).Scan(&hiddenAt).Error; err != nil {
		t.Fatalf("SELECT hidden_at: %v", err)
	}

	// LA TOLERANCIA NO ES PARA AFLOJAR EL GUARD, ES PRECISIÓN DE TIPOS.
	// `timestamptz` guarda MICROSEGUNDOS y `time.Now()` mide nanosegundos, así
	// que el valor que vuelve de la base está truncado hasta 1µs por debajo del
	// que se escribió. Sin margen, este test comparaba nanosegundos contra
	// microsegundos y fallaba de a ratos —salió 200ns en el pasado— o sea era
	// flaky, que es peor que no tenerlo.
	//
	// 1ms deja mil veces de aire sobre el truncamiento y sigue siendo mil veces
	// MENOR que el defecto que caza: con `NOW()` el desfase es el largo de la
	// transacción, acá 1,2 segundos.
	const truncamientoTimestamptz = time.Millisecond
	if desfase := antes.Sub(hiddenAt); desfase > truncamientoTimestamptz {
		t.Errorf(
			"hidden_at quedó %v en el PASADO respecto del momento de la llamada: se estampó con el reloj de Postgres (NOW() = inicio de transacción) en vez del de la app",
			desfase,
		)
	}
}
