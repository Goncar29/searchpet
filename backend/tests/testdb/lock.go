package testdb

import (
	"context"
	"fmt"
	"sync"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// suiteLockKey es la clave del advisory lock que serializa a TODO proceso de
// test que use esta base. El valor concreto no significa nada; lo único que
// importa es que sea el mismo para todos.
//
// `acquireSuiteLock` —el único camino por el que la suite toma el candado— NO
// recibe la clave: la lee de acá. El día que un llamador pueda elegir la suya,
// dos paquetes con claves distintas dejan de excluirse y el candado se vuelve
// decorativo sin que falle un solo test. Es el mismo motivo por el que
// `DeleteExpired` no toma la retención por parámetro (regla #40).
//
// `lockDatabase` sí la toma, y eso NO es una grieta en lo de arriba: es
// no exportada, sus dos llamadores viven en este paquete, y el único que corre
// en la suite le pasa esta constante. Existe porque los tests del candado
// necesitan su PROPIA clave — con la real, contienden contra el candado que la
// suite ya tiene tomado y afirman que está libre. El test que ata las dos
// puntas es TestAcquireSuiteLock_TomaLaClaveDeLaSuite: se pone rojo si alguien
// le cambia la clave al call site real.
const suiteLockKey int64 = 8_090_921_226

var (
	suiteLockOnce sync.Once
	suiteLockErr  error
	// El release del candado de la suite, guardado y NUNCA llamado.
	//
	// Se guarda por dos motivos, y el segundo es el que importa: mantiene viva
	// la referencia a la conexión que tiene el candado, y deja escrito que la
	// función existe y que la decisión es no invocarla. Una variable descartada
	// con `_` diría lo mismo pero no se puede leer desde un test ni desde una
	// revisión.
	suiteLockRelease func() //nolint:unused // sostiene la sesión que tiene el candado
)

// lockDatabase toma el advisory lock `key` sobre una conexión DEDICADA y
// devuelve la función que lo suelta. Quién elige `key` está explicado en el
// comentario de suiteLockKey: el único llamador de la suite le pasa esa
// constante, y la parametrización existe para los tests del mecanismo.
//
// La conexión dedicada no es un detalle: los advisory locks de sesión de
// Postgres viven en la CONEXIÓN, y un `*sql.DB` es un pool. Tomando el candado
// con `db.Exec` se lo estaría pidiendo a una conexión cualquiera, y un
// `pg_advisory_unlock` posterior podría caer en OTRA — con lo cual devuelve
// false sin error y no suelta nada.
//
// OJO, y esto vale más que el párrafo de arriba: **ningún test de acá cubre ese
// error**. Como el release cierra el pool entero, la sesión muere igual y el
// candado se libera aunque se lo hubiera tomado del pool. El motivo de la
// conexión dedicada es que el candado sea de quien creemos mientras se lo
// tiene; que se suelte al final está sostenido por el cierre del pool, no por
// esto. Si algún día alguien saca ese cierre, esta línea NO lo salva.
func lockDatabase(ctx context.Context, dsn string, key int64) (func(), error) {
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
	if err != nil {
		return nil, fmt.Errorf("testdb: conectando para el candado: %w", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		return nil, fmt.Errorf("testdb: pool para el candado: %w", err)
	}

	conn, err := sqlDB.Conn(ctx)
	if err != nil {
		sqlDB.Close()
		return nil, fmt.Errorf("testdb: conexión dedicada para el candado: %w", err)
	}

	// `pg_advisory_lock` y NO `pg_try_advisory_lock`: el segundo devuelve false
	// al toque y eso convertiría una espera en un fallo, o sea `go test ./...`
	// en rojo en vez de serializado.
	if _, err := conn.ExecContext(ctx, "SELECT pg_advisory_lock($1)", key); err != nil {
		conn.Close()
		sqlDB.Close()
		return nil, fmt.Errorf("testdb: tomando el candado: %w", err)
	}

	return func() {
		// DOS vías que sueltan, y cada una alcanza sola: el unlock explícito
		// sobre la MISMA conexión que lo tomó, y el cierre del pool, que termina
		// la sesión y hace que Postgres lo suelte. Medido con mutantes: sacando
		// cualquiera de las dos el test sigue verde, y sacando las dos se pone
		// rojo. O sea que son redundantes a propósito y el test afirma el
		// RESULTADO —que el candado quedó libre— y no una línea en particular.
		//
		// `conn.Close()` NO es una tercera vía: devuelve la conexión al pool sin
		// terminar la sesión, así que por sí solo no suelta nada. Es el mutante
		// que pone el test en rojo.
		_, _ = conn.ExecContext(context.Background(), "SELECT pg_advisory_unlock($1)", key)
		conn.Close()
		sqlDB.Close()
	}, nil
}

// acquireSuiteLock toma el candado UNA vez por proceso y no lo suelta nunca.
//
// Por qué una vez por proceso y no una por test: dentro de un paquete los tests
// de Go ya corren en serie (no hay un solo `t.Parallel()` en este backend), así
// que tomarlo por test no compraría más aislamiento — y sí traería un modo de
// falla nuevo, porque un test que llame a SetupTestDB dos veces se trabaría
// contra sí mismo. Son conexiones distintas, y la reentrancia de los advisory
// locks es por SESIÓN, no por proceso.
//
// Por qué no se suelta: el candado tiene que cubrir el binario entero, y la
// única forma de garantizar que se suelte pase lo que pase —incluido un panic o
// un `go test -timeout` que mata el proceso— es dejar que lo suelte la muerte de
// la sesión. Un `defer` no corre cuando al proceso lo matan; una sesión cerrada
// libera siempre.
//
// Llama a `lockDatabase` en vez de repetir su cuerpo, y eso NO es prolijidad:
// antes eran dos implementaciones, y los tests del candado probaban la que la
// suite no usa. Un verde sobre una copia no dice nada del original.
func acquireSuiteLock(dsn string) error {
	suiteLockOnce.Do(func() {
		release, err := lockDatabase(context.Background(), dsn, suiteLockKey)
		if err != nil {
			suiteLockErr = err
			return
		}
		suiteLockRelease = release
	})
	return suiteLockErr
}
