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
// LA TRANSACCIÓN DE ACÁ ES UN AMPLIFICADOR, NO UN ESCENARIO REAL, y conviene
// decirlo para que nadie la "simplifique": HOY ningún camino de producción corre
// este `Upsert` dentro de una transacción — `UnitOfWorkRepos` sólo agrupa Pets,
// Reports y Episodes, y el servicio llama sobre el `*gorm.DB` raíz. La
// transacción está para volver OBSERVABLE la diferencia entre las dos
// implementaciones en una máquina donde los dos relojes coinciden. Sacarla deja
// una aserción que pasa igual con `NOW()` restaurado, o sea un guard que ya no
// distingue nada.
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
	despues := time.Now()

	var hiddenAt time.Time
	if err := tx.Raw(
		`SELECT hidden_at FROM conversation_hides WHERE user_id = ? AND other_user_id = ?`,
		yo.ID, otro.ID,
	).Scan(&hiddenAt).Error; err != nil {
		t.Fatalf("SELECT hidden_at: %v", err)
	}

	// LA COTA ES SIMÉTRICA, y eso NO es un detalle. La primera versión de este
	// test sólo fallaba si `hidden_at` caía en el PASADO — o sea cazaba la cara
	// que se puede reproducir en local (la semántica de `NOW()`) y dejaba pasar
	// justo la del defecto que motivó el PR: con el reloj de la base ADELANTADO,
	// `hidden_at` queda en el FUTURO y se traga los mensajes que entren en esa
	// ventana. Una implementación que estampara `time.Now().Add(time.Hour)`
	// pasaba el test sin despeinarse. Un guard que sólo mira una dirección de un
	// defecto que tiene dos es medio guard.
	//
	// LA TOLERANCIA NO AFLOJA NADA, ES PRECISIÓN DE TIPOS. `timestamptz` guarda
	// MICROSEGUNDOS y `time.Now()` mide nanosegundos, así que el valor que vuelve
	// está truncado hasta 1µs por debajo del que se escribió. Sin margen esto
	// fallaba de a ratos —salió 200ns en el pasado—, y un guard flaky es peor que
	// ninguno. 1ms deja mil veces de aire sobre el truncamiento y sigue siendo mil
	// veces MENOR que el defecto que caza (con `NOW()`, el largo de la
	// transacción: 1,2 segundos).
	const truncamientoTimestamptz = time.Millisecond
	if desfase := antes.Sub(hiddenAt); desfase > truncamientoTimestamptz {
		t.Errorf(
			"hidden_at quedó %v en el PASADO respecto del momento de la llamada: se estampó con el reloj de Postgres (NOW() = inicio de transacción) en vez del de la app",
			desfase,
		)
	}
	if desfase := hiddenAt.Sub(despues); desfase > truncamientoTimestamptz {
		t.Errorf(
			"hidden_at quedó %v en el FUTURO respecto del final de la llamada: esa es la cara del defecto que motivó el PR — con el reloj de la base adelantado, todo mensaje que entre en esa ventana queda invisible para siempre",
			desfase,
		)
	}
}

// Ocultar es MONÓTONO: un segundo ocultamiento nunca puede BAJAR `hidden_at`.
//
// POR QUÉ HACE FALTA. El modelo promete que lo borrado queda invisible "para
// siempre", y al pasar `hidden_at` al reloj de la app esa promesa quedó a merced
// de un reloj que puede saltar hacia atrás: `time.Now()` no tiene protección
// monótona entre llamadas, y una corrección de NTP después de un cold start de
// Render es justo cuándo pasa. Sin el `GREATEST` del ON CONFLICT, el segundo
// ocultamiento baja `hidden_at` y RESUCITA mensajes que el usuario ya había
// borrado — en el hilo, en la lista y en el badge.
//
// El salto de reloj no se puede provocar, pero su CONSECUENCIA sí: se deja
// `hidden_at` adelantado a mano y se comprueba que un `Upsert` con la hora real
// —que es "hacia atrás" respecto de ese valor— no lo pisa. Con `SET hidden_at = ?`
// pelado esto queda rojo.
//
// El peor caso que sí acepta el GREATEST es que un ocultamiento no tome efecto y
// haya que repetirlo. Es molesto; resucitar lo borrado no.
func TestConversationHideRepository_OcultarEsMonotono(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	hideRepo := repository.NewConversationHideRepository(gormDB)
	ctx := context.Background()

	yo := newTestUser(t, userRepo)
	otro := newTestUser(t, userRepo)

	if err := hideRepo.Upsert(ctx, yo.ID, otro.ID); err != nil {
		t.Fatalf("Upsert inicial: %v", err)
	}

	// Simula el estado posterior a un ocultamiento hecho con el reloj adelantado.
	futuro := time.Now().Add(time.Hour)
	if err := gormDB.Model(&domain.ConversationHide{}).
		Where("user_id = ? AND other_user_id = ?", yo.ID, otro.ID).
		Update("hidden_at", futuro).Error; err != nil {
		t.Fatalf("adelantar hidden_at: %v", err)
	}

	// El reloj "vuelve atrás": este Upsert estampa la hora real, anterior.
	if err := hideRepo.Upsert(ctx, yo.ID, otro.ID); err != nil {
		t.Fatalf("Upsert con el reloj atrasado: %v", err)
	}

	var hide domain.ConversationHide
	if err := gormDB.Where("user_id = ? AND other_user_id = ?", yo.ID, otro.ID).
		First(&hide).Error; err != nil {
		t.Fatalf("releer la fila: %v", err)
	}

	if hide.HiddenAt.Before(futuro.Add(-time.Millisecond)) {
		t.Errorf(
			"hidden_at retrocedió de %v a %v: un ocultamiento posterior no puede desandar uno anterior, porque resucita mensajes ya borrados",
			futuro, hide.HiddenAt,
		)
	}
}

// Un `db.Create` corriente también tiene que estampar el reloj de la APP.
//
// EL AGUJERO QUE CIERRA: con `default:now()` en el tag, GORM OMITE del INSERT
// todo campo en cero que tenga default, así que cualquier
// `db.Create(&ConversationHide{...})` futuro caía en silencio al reloj de
// Postgres y reintroducía el bug de los dos relojes. El invariante quedaba
// sostenido por UN solo string de SQL crudo en el repositorio y por nada más —
// ni un test lo habría notado. `autoCreateTime` lo vuelve correcto por
// construcción, para cualquier camino, incluido el que se escriba mañana.
//
// Mismo amplificador que el test de arriba: la transacción abierta hace que el
// `NOW()` de Postgres quede congelado en el pasado y vuelve OBSERVABLE de qué
// reloj salió el valor.
func TestConversationHide_CreateDeGormEstampaElRelojDeLaApp(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)

	yo := newTestUser(t, userRepo)
	otro := newTestUser(t, userRepo)

	tx := gormDB.Begin()
	if tx.Error != nil {
		t.Fatalf("Begin: %v", tx.Error)
	}
	defer tx.Rollback()

	time.Sleep(1200 * time.Millisecond)

	antes := time.Now()
	fila := domain.ConversationHide{UserID: yo.ID, OtherUserID: otro.ID}
	if err := tx.Create(&fila).Error; err != nil {
		t.Fatalf("Create: %v", err)
	}

	var hiddenAt time.Time
	if err := tx.Raw(
		`SELECT hidden_at FROM conversation_hides WHERE user_id = ? AND other_user_id = ?`,
		yo.ID, otro.ID,
	).Scan(&hiddenAt).Error; err != nil {
		t.Fatalf("SELECT hidden_at: %v", err)
	}

	if desfase := antes.Sub(hiddenAt); desfase > time.Millisecond {
		t.Errorf(
			"hidden_at quedó %v en el pasado: el Create de GORM cayó al reloj de Postgres en vez del de la app (¿volvió el `default:now()` al tag?)",
			desfase,
		)
	}
}
