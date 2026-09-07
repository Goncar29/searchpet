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

	release, _, err := lockDatabase(context.Background(), dsn, testLockKey)
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

	primero, _, err := lockDatabase(context.Background(), dsn, testLockKey)
	if err != nil {
		t.Fatalf("lockDatabase (primero): %v", err)
	}
	defer primero() // idempotente; la llamada que se mide es la de más abajo

	llego := make(chan error, 1)
	soltarSegundo := make(chan func(), 1)
	// Ante CUALQUIER salida —incluido un t.Fatal en las aserciones de abajo— el
	// segundo candado tiene que soltarse. Sin esto, un fallo intermedio libera
	// el primero, deja que la goroutine tome `testLockKey`, y su `release`
	// queda parqueado en el canal sin que nadie lo llame: la clave y su
	// conexión quedan tomadas por el resto del binario.
	defer func() {
		select {
		case release := <-soltarSegundo:
			release()
		default:
		}
	}()
	go func() {
		release, _, err := lockDatabase(context.Background(), dsn, testLockKey)
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

	// La clave bigint se parte en (classid, objid) de 32 bits. `objsubid = 1` NO
	// es decorativo: identifica a la forma bigint de pg_advisory_lock, y la de
	// dos enteros usa 2 — verificado contra Postgres. Sin ese filtro, un candado
	// de dos enteros que casualmente componga los mismos 64 bits contaría como
	// si fuera el nuestro.
	const q = `SELECT count(*) FROM pg_locks
	           WHERE locktype = 'advisory' AND NOT granted AND objsubid = 1
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

	// t.Logf y no nil: en `go test ./...` ESTA es la llamada que espera a que el
	// paquete `tests` suelte el candado, o sea la espera más larga de la suite.
	// Con nil sería justamente el hang mudo que `esperaAvisadaTras` existe para
	// evitar.
	if err := acquireSuiteLock(dsn, t.Logf); err != nil {
		t.Fatalf("el fallo anterior quedó cacheado: el reintento contra la base viva falló con %v", err)
	}
}

// Los tests de arriba prueban el MECANISMO con una clave de juguete, así que
// seguirían verdes si alguien le cambiara la clave a `acquireSuiteLock` — y ahí
// el candado dejaría de excluir a nadie sin que un solo test se ponga rojo. Eso
// es exactamente lo que el comentario de `suiteLockKey` promete que no puede
// pasar, y una promesa sin aserción es un comentario (regla #37).
//
// Este test cierra esa punta llamando al camino REAL, el mismo que usa
// SetupTestDB.
//
// AFIRMA IDENTIDAD Y NO OCUPACIÓN, y esa distinción es todo el test. La primera
// versión preguntaba `pg_try_advisory_lock(suiteLockKey)` desde afuera y exigía
// false, o sea "alguien lo tiene". Bajo `go test ./...` el paquete `tests`
// retiene esa clave durante TODA su vida, así que con la clave mutada en el call
// site el false lo producía ÉL y el test pasaba igual. Reproducido: con una
// sesión externa reteniendo la clave real, el mutante daba `EXIT=0`. El rojo que
// yo había medido sólo existía corriendo este paquete aislado — que no es como
// corre el CI. Misma forma que la regla #41: una señal de éxito que también se
// emite cuando el chequeo no ocurrió.
//
// Por eso pregunta por el `pid`: la fila de `pg_locks` tiene que estar GRANTED a
// la sesión que abrió NUESTRO candado. Ningún otro proceso puede satisfacer eso.
//
// Sobre el orden: el candado de la suite lo toma el PRIMER test que llame a
// `acquireSuiteLock` con éxito, que hoy es el de más arriba. No importa cuál
// sea, y este test no depende de eso — `acquireSuiteLock` es idempotente y
// `suiteLockPID` queda apuntando a la sesión que lo tomó, sea cual sea.
func TestAcquireSuiteLock_TomaLaClaveDeLaSuite(t *testing.T) {
	dsn := dsnOrSkip(t)

	if err := acquireSuiteLock(dsn, t.Logf); err != nil {
		t.Fatalf("acquireSuiteLock: %v", err)
	}
	if suiteLockPID == 0 {
		t.Fatal("acquireSuiteLock no dejó registrado el pid de la sesión del candado")
	}

	if !candadoGranted(t, dsn, suiteLockKey, suiteLockPID) {
		t.Fatalf("la sesión del candado (pid %d) NO tiene granted la clave de la suite (%d): "+
			"el camino real está usando otra clave", suiteLockPID, suiteLockKey)
	}
}

// candadoGranted responde si `pid` tiene CONCEDIDO el advisory lock `key`.
//
// Se pregunta por (key, pid) juntos a propósito: `key` sola sólo dice que el
// candado está ocupado, y bajo `go test ./...` siempre lo está — por otro
// paquete. La conjunción es lo único que distingue "lo tenemos nosotros" de
// "lo tiene alguien".
func candadoGranted(t *testing.T, dsn string, key int64, pid int) bool {
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

	var n int
	const q = `SELECT count(*) FROM pg_locks
	           WHERE locktype = 'advisory' AND granted AND objsubid = 1 AND pid = $1
	             AND ((classid::bigint << 32) | objid::bigint) = $2`
	if err := sqlDB.QueryRow(q, pid, key).Scan(&n); err != nil {
		t.Fatalf("consultando pg_locks: %v", err)
	}
	return n > 0
}
