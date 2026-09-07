package testdb

import (
	"context"
	"os"
	"testing"
	"time"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// testLockKey es la clave con la que se ejercita el MECANISMO del candado, y es
// distinta de `suiteLockKey` a propósito.
//
// Con la clave real estos tests contienden contra el candado que la suite ya
// tiene tomado: `go test ./...` corre este paquete en paralelo con `tests`,
// que toma el candado al arrancar y no lo suelta nunca, así que un test que
// afirme "el candado está libre" falla — no por un defecto del candado, sino
// porque el candado está haciendo exactamente su trabajo. Un test de un recurso
// global compite con el recurso global.
//
// Lo que esta clave NO puede verificar es que el call site real use la clave
// real; de eso se ocupa TestAcquireSuiteLock_TomaLaClaveDeLaSuite.
const testLockKey int64 = 8_090_921_999

// dsnOrSkip devuelve la DATABASE_URL o saltea, igual que SetupTestDB.
func dsnOrSkip(t *testing.T) string {
	t.Helper()
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		t.Skip("DATABASE_URL not set — skipping integration test")
	}
	return dsn
}

// tryLockDesdeAfuera pregunta, en una conexión NUEVA e independiente, si el
// candado está libre. Devuelve true si lo pudo tomar (y en ese caso lo suelta).
//
// Es la única forma honesta de verificar el candado desde afuera: preguntarle a
// la misma sesión que lo tiene daría true siempre, porque los advisory locks de
// Postgres son reentrantes DENTRO de una sesión. Ese detalle es justamente el
// que haría pasar un test que no prueba nada.
func tryLockDesdeAfuera(t *testing.T, dsn string, key int64) bool {
	t.Helper()
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatalf("conectando: %v", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("sqlDB: %v", err)
	}
	defer sqlDB.Close()

	conn, err := sqlDB.Conn(context.Background())
	if err != nil {
		t.Fatalf("conn: %v", err)
	}
	defer conn.Close()

	var libre bool
	if err := conn.QueryRowContext(context.Background(),
		"SELECT pg_try_advisory_lock($1)", key).Scan(&libre); err != nil {
		t.Fatalf("pg_try_advisory_lock: %v", err)
	}
	if libre {
		if _, err := conn.ExecContext(context.Background(),
			"SELECT pg_advisory_unlock($1)", key); err != nil {
			t.Fatalf("pg_advisory_unlock: %v", err)
		}
	}
	return libre
}

// El candado tiene que EXCLUIR de verdad y tiene que SOLTAR de verdad. Las dos
// mitades importan por igual: uno que no excluye deja viva la carrera que este
// código existe para cerrar, y uno que no suelta cuelga la suite entera del
// próximo paquete.
func TestSuiteLock_TomaYSuelta(t *testing.T) {
	dsn := dsnOrSkip(t)

	if !tryLockDesdeAfuera(t, dsn, testLockKey) {
		t.Fatal("el candado ya estaba tomado antes de empezar: el test no puede medir nada")
	}

	release, err := lockDatabase(context.Background(), dsn, testLockKey)
	if err != nil {
		t.Fatalf("lockDatabase: %v", err)
	}
	// Diferido ADEMÁS de la llamada explícita de abajo, que es la que se está
	// midiendo. Sin esto, un t.Fatal entre medio se va sin soltar y deja la
	// clave tomada por una sesión viva: el test siguiente se cuelga para
	// siempre esperándola, y una aserción clara se convierte en un timeout de
	// todo el paquete atribuido a otro test. `release` es idempotente.
	defer release()

	if tryLockDesdeAfuera(t, dsn, testLockKey) {
		t.Fatal("otra sesión pudo tomar el candado mientras lo teníamos: NO excluye")
	}

	release()

	if !tryLockDesdeAfuera(t, dsn, testLockKey) {
		t.Fatal("el candado siguió tomado después de release(): NO suelta")
	}
}

// Un `pg_try_advisory_lock` que devuelve false es un rechazo, no una espera. Lo
// que necesita la suite es que el segundo paquete se FORME EN LA COLA: si
// abortara, `go test ./...` fallaría en vez de serializar.
func TestSuiteLock_ElSegundoEsperaEnVezDeFallar(t *testing.T) {
	dsn := dsnOrSkip(t)

	primero, err := lockDatabase(context.Background(), dsn, testLockKey)
	if err != nil {
		t.Fatalf("lockDatabase (primero): %v", err)
	}
	defer primero() // idempotente; la llamada que se mide es la de más abajo

	llego := make(chan error, 1)
	soltarSegundo := make(chan func(), 1)
	go func() {
		release, err := lockDatabase(context.Background(), dsn, testLockKey)
		if release != nil {
			soltarSegundo <- release
		}
		llego <- err
	}()

	// El segundo tiene que estar EN LA COLA, y eso se le pregunta a Postgres.
	//
	// La versión anterior esperaba 300ms y concluía "no llegó ⇒ hay exclusión".
	// Eso no se sostiene: antes de poder pedir el candado, la goroutine hace
	// TCP + auth + ping, y en un runner cargado ese handshake solo puede pasarse
	// de 300ms. O sea que el test habría pasado con la exclusión COMPLETAMENTE
	// removida — medía la latencia de conexión y la reportaba como exclusión.
	esperarEnLaCola(t, dsn, testLockKey)

	select {
	case err := <-llego:
		t.Fatalf("el segundo entró con el candado tomado (err=%v): no hay exclusión", err)
	default:
	}

	primero()

	select {
	case err := <-llego:
		if err != nil {
			t.Fatalf("el segundo falló en vez de entrar: %v", err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("el segundo nunca entró después de soltar: quedó colgado")
	}

	select {
	case release := <-soltarSegundo:
		release()
	default:
	}
}

// esperarEnLaCola bloquea hasta que Postgres reporte una espera PENDIENTE sobre
// `key`, o falla el test.
//
// `pg_locks` con `granted = false` es la afirmación exacta que hace falta: hay
// una sesión formada en la cola de esa clave. Un sleep no puede afirmar eso —
// sólo puede afirmar que algo no pasó todavía, que es compatible con que nunca
// hubiera intentado.
func esperarEnLaCola(t *testing.T, dsn string, key int64) {
	t.Helper()
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatalf("conectando para mirar pg_locks: %v", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("sqlDB: %v", err)
	}
	defer sqlDB.Close()

	// La clave bigint se parte en (classid, objid) de 32 bits, con objsubid = 1.
	const q = `SELECT count(*) FROM pg_locks
	           WHERE locktype = 'advisory' AND NOT granted
	             AND ((classid::bigint << 32) | objid::bigint) = $1`

	limite := time.Now().Add(10 * time.Second)
	for time.Now().Before(limite) {
		var enCola int
		if err := sqlDB.QueryRow(q, key).Scan(&enCola); err != nil {
			t.Fatalf("consultando pg_locks: %v", err)
		}
		if enCola > 0 {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("nadie quedó esperando en la cola del candado: el segundo no llegó a pedirlo, o no hay exclusión")
}

// Un fallo al tomar el candado NO puede quedar cacheado. Con `sync.Once` sí
// quedaba: un Postgres que todavía no aceptaba conexiones —justo lo que el
// bucle de reintentos de SetupTestDB existe para tolerar— envenenaba el
// binario entero, y cada SetupTestDB posterior moría con el mismo error viejo
// contra una base que ya estaba arriba.
//
// Verificado en su momento con una sonda: tras un primer intento contra un
// puerto muerto, el intento siguiente contra la base VIVA seguía devolviendo el
// error del puerto muerto.
func TestAcquireSuiteLock_UnFalloNoEnvenenaLosIntentosSiguientes(t *testing.T) {
	dsn := dsnOrSkip(t)

	muerto := "postgres://postgres:postgres@127.0.0.1:59999/nada?sslmode=disable&connect_timeout=2"
	if err := acquireSuiteLock(muerto, nil); err == nil {
		t.Fatal("acquireSuiteLock contra un puerto cerrado devolvió nil")
	}

	if err := acquireSuiteLock(dsn, nil); err != nil {
		t.Fatalf("el fallo anterior quedó cacheado: el reintento contra la base viva falló con %v", err)
	}
}

// Los dos tests de arriba prueban el MECANISMO con una clave de juguete, así
// que los dos seguirían verdes si alguien le cambiara la clave a
// `acquireSuiteLock` — y ahí el candado dejaría de excluir a nadie sin que un
// solo test se ponga rojo. Eso es exactamente lo que el comentario de
// `suiteLockKey` promete que no puede pasar, y una promesa sin aserción es un
// comentario (regla #37).
//
// Este test cierra esa punta: llama al camino REAL, el mismo que usa
// SetupTestDB, y comprueba desde una sesión independiente que lo que quedó
// tomado es `suiteLockKey`.
//
// Va último a propósito. Toma el candado de la suite y —por diseño— no lo
// suelta, así que a partir de acá este paquete serializa contra los demás. Si
// el paquete `tests` lo tiene, esta llamada ESPERA: eso no es un cuelgue, es el
// candado funcionando.
func TestAcquireSuiteLock_TomaLaClaveDeLaSuite(t *testing.T) {
	dsn := dsnOrSkip(t)

	if err := acquireSuiteLock(dsn, nil); err != nil {
		t.Fatalf("acquireSuiteLock: %v", err)
	}

	if tryLockDesdeAfuera(t, dsn, suiteLockKey) {
		t.Fatal("después de acquireSuiteLock, suiteLockKey seguía libre: el camino real NO usa la clave de la suite")
	}
}
