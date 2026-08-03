package tests

import (
	"context"
	"errors"
	"testing"

	"lost-pets/pkg/database"
	"lost-pets/tests/testdb"
)

// Estos tests ejercitan pkg/database, no el handler, y aun asi viven aca y NO
// en pkg/database/. Es deliberado.
//
// SetupTestDB trunca las 24 tablas de la base que nombra DATABASE_URL en su
// cleanup, y `go test ./...` —lo que corre ci.yml— ejecuta el binario de cada
// paquete EN PARALELO. Un segundo paquete que truncara la misma base podria
// barrer las filas de un test de `tests` entre el sembrado y la asercion: rojo
// en un PR que no toco nada, sin causa reproducible. Mientras `tests` sea el
// unico paquete que llama a SetupTestDB, esa carrera no puede existir.
//
// Si algun dia hace falta paralelizar de verdad, la salida es una base por
// paquete, no mover estos tests.

// TestReadinessChecker_LaFallaDeConexionPropaga prueba que un pool cerrado —el
// caso mas simple de "la base no contesta"— realmente hace que Check devuelva
// error. Con SELECT 1, un fallo de conexion lo captura enteramente la rama
// `if err != nil`: nunca llega a la guarda `uno != 1`, asi que este test NO
// cubre esa guarda. Ver TestGormScanSinFilasNoDaError para lo que si la cubre,
// y el comentario de Check en readiness.go para por que la guarda existe.
func TestReadinessChecker_LaFallaDeConexionPropaga(t *testing.T) {
	db := testdb.SetupTestDB(t)

	checker := database.NewReadinessChecker(db)
	if err := checker.Check(context.Background()); err != nil {
		t.Fatalf("contra una base viva: %v, quiero nil", err)
	}

	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("obtener el pool: %v", err)
	}
	if err := sqlDB.Close(); err != nil {
		t.Fatalf("cerrar el pool: %v", err)
	}

	if err := checker.Check(context.Background()); err == nil {
		t.Fatal("con el pool cerrado devolvio nil — el chequeo no ocurrio y dio verde igual")
	}
}

// TestGormScanSinFilasNoDaError prueba la premisa de la guarda `uno != 1` del
// checker: GORM devuelve error nil y deja la variable en cero cuando la
// consulta no matchea ninguna fila. Ver el comentario de Check en readiness.go
// para por que eso justifica la guarda.
//
// La guarda NO es alcanzable con el SELECT 1 que usa el checker —Postgres
// siempre devuelve exactamente una fila con un uno—, asi que este test prueba la
// PREMISA, no la rama. Es deliberado: agregarle una costura al checker solo para
// poder ejecutar esa rama seria peor que el hueco.
func TestGormScanSinFilasNoDaError(t *testing.T) {
	db := testdb.SetupTestDB(t)

	var uno int
	err := db.Raw("SELECT 1 WHERE false").Scan(&uno).Error
	if err != nil {
		t.Fatalf("Scan sin filas devolvio error: %v — quiero nil (si esto falla, la guarda uno != 1 no defiende nada y hay que sacarla)", err)
	}
	if uno != 0 {
		t.Fatalf("uno = %d, quiero 0 (valor cero sin tocar)", uno)
	}
}

// TestReadinessChecker_PropagaElContextoDelCaller fija el contrato del que
// depende health_handler.go: Ready suprime el log cuando el error satisface
// errors.Is(err, context.Canceled), y eso solo tiene sentido si Check de verdad
// propaga el contexto del caller a la query en vez de usar uno propio. Sin este
// test, borrar la linea del timeout o reemplazar el contexto de la query por
// context.Background() en readiness.go deja los nueve tests preexistentes en
// verde — este es el unico lugar donde esa costura entre los dos archivos se
// verifica.
func TestReadinessChecker_PropagaElContextoDelCaller(t *testing.T) {
	db := testdb.SetupTestDB(t)
	checker := database.NewReadinessChecker(db)

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	if err := checker.Check(ctx); !errors.Is(err, context.Canceled) {
		t.Fatalf("Check = %v, quiero context.Canceled — el handler suprime el log basandose en esto", err)
	}
}
