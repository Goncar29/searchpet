package tests

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"go.uber.org/zap/zaptest/observer"
	"lost-pets/internal/handler"
	"lost-pets/pkg/database"
	"lost-pets/tests/testdb"
)

// stubChecker devuelve el error que le pongan, sin tocar ninguna base.
type stubChecker struct{ err error }

func (s *stubChecker) Check(ctx context.Context) error { return s.err }

// buildHealthRouter arma el router con un logger observable: el cuerpo del 503
// es deliberadamente sin causa, asi que el log es el UNICO lugar donde el
// diagnostico existe, y zap.NewNop() no deja afirmar nada sobre eso.
func buildHealthRouter(err error) (*gin.Engine, *observer.ObservedLogs) {
	core, logs := observer.New(zapcore.ErrorLevel)
	h := handler.NewHealthHandler(&stubChecker{err: err}, zap.New(core))
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/health/ready", h.Ready)
	return r, logs
}

func doReady(r *gin.Engine) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, "/health/ready", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

// TestReady_BaseRespondeDa200 es el camino feliz.
func TestReady_BaseRespondeDa200(t *testing.T) {
	r, _ := buildHealthRouter(nil)
	w := doReady(r)

	if w.Code != http.StatusOK {
		t.Fatalf("status %d, quiero 200", w.Code)
	}

	var cuerpo map[string]string
	if err := json.Unmarshal(w.Body.Bytes(), &cuerpo); err != nil {
		t.Fatalf("cuerpo no parsea: %v", err)
	}
	if cuerpo["status"] != "ready" {
		t.Fatalf(`status = %q, quiero "ready"`, cuerpo["status"])
	}
}

// TestReady_BaseCaidaDa503 fija el contrato que el monitor lee: cualquier no-2xx
// lo tumba, y 503 es el que corresponde a una dependencia caida. Ademas
// completa el par con TestReady_ElCuerpoNoFiltraElErrorDelDriver: el detalle
// no esta en el cuerpo, pero SI tiene que estar en el log, o el 503 se vuelve
// indiagnosticable el dia que alguien pierda la conexion real.
func TestReady_BaseCaidaDa503(t *testing.T) {
	driverErr := errors.New("dial tcp 10.0.0.7:5432: connect: connection refused")
	r, logs := buildHealthRouter(driverErr)
	w := doReady(r)

	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("status %d, quiero 503", w.Code)
	}

	var cuerpo map[string]string
	if err := json.Unmarshal(w.Body.Bytes(), &cuerpo); err != nil {
		t.Fatalf("cuerpo no parsea: %v", err)
	}
	if cuerpo["code"] != "not_ready" {
		t.Fatalf(`code = %q, quiero "not_ready"`, cuerpo["code"])
	}

	entries := logs.FilterMessage("readiness: la base no contesta").All()
	if len(entries) != 1 {
		t.Fatalf("se loguearon %d entradas, quiero exactamente 1", len(entries))
	}
	entry := entries[0]
	if entry.Level != zapcore.ErrorLevel {
		t.Fatalf("nivel = %v, quiero Error", entry.Level)
	}
	campos := entry.ContextMap()
	errorCampo, ok := campos["error"].(string)
	if !ok || !strings.Contains(errorCampo, driverErr.Error()) {
		t.Fatalf("el campo error del log = %v, quiero que contenga %q", campos["error"], driverErr.Error())
	}
}

// TestReady_ElCuerpoNoFiltraElErrorDelDriver es el test que protege la decision del
// spec: los errores de Postgres traen host, puerto, usuario y a veces el nombre de
// la base, y este endpoint es PUBLICO. El detalle va al log, nunca al cuerpo.
func TestReady_ElCuerpoNoFiltraElErrorDelDriver(t *testing.T) {
	const secreto = "dial tcp 10.0.0.7:5432: connect: connection refused"
	r, _ := buildHealthRouter(errors.New(secreto))
	w := doReady(r)

	cuerpo := w.Body.String()

	// Backstop que no puede desincronizarse: si cambia `secreto`, este chequeo
	// sigue relacionado a el. El loop de abajo queda para el caso de fuga
	// parcial, pero solo no alcanza porque sus literales estan copiados a mano.
	if strings.Contains(cuerpo, secreto) {
		t.Fatalf("el cuerpo %q expone el error completo del driver — no puede salir al publico", cuerpo)
	}
	for _, filtracion := range []string{"10.0.0.7", "5432", "dial tcp"} {
		if strings.Contains(cuerpo, filtracion) {
			t.Fatalf("el cuerpo %q expone %q — el error del driver no puede salir al publico", cuerpo, filtracion)
		}
	}
}

// TestReady_ContextoCanceladoNoLoguaComoFallaDeBase prueba el fix de la
// confusion "la base no contesta" vs "el caller se fue": un bot o un scanner
// que corta la conexion en un endpoint publico no puede ensuciar el log que
// un humano lee durante una caida real. La respuesta sigue siendo 503 (el
// caller ya no esta, pero no hay nada mejor que devolver), y el log queda
// limpio.
//
// El stub devuelve context.Canceled, no un error de conexion: es lo unico que
// el checker real puede devolver cuando el contexto del request ya esta
// cancelado (verificado contra Postgres real en Task 2 — WithContext sobre un
// contexto cancelado nunca produce un error de dial). Emparejar un contexto
// cancelado con un error de conexion como antes describia una combinacion que
// no puede ocurrir.
func TestReady_ContextoCanceladoNoLoguaComoFallaDeBase(t *testing.T) {
	r, logs := buildHealthRouter(context.Canceled)

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	req := httptest.NewRequest(http.MethodGet, "/health/ready", nil).WithContext(ctx)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("status %d, quiero 503 igual aunque el caller se haya ido", w.Code)
	}
	if logs.Len() != 0 {
		t.Fatalf("se loguearon %d entradas para un contexto ya cancelado, quiero 0", logs.Len())
	}
}

// TestReady_ContextoCanceladoConFallaRealDeBaseSiLoguea es la regresion que el
// predicado viejo (chequear c.Request.Context().Err() en vez del error) no
// cubria: un network flap puede tumbar la base Y desconectar al caller al
// mismo tiempo. Si el caller ya se fue no dice nada sobre si la base esta
// sana — hay que seguir logueando la falla real.
func TestReady_ContextoCanceladoConFallaRealDeBaseSiLoguea(t *testing.T) {
	driverErr := errors.New("dial tcp 10.0.0.7:5432: connect: connection refused")
	r, logs := buildHealthRouter(driverErr)

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	req := httptest.NewRequest(http.MethodGet, "/health/ready", nil).WithContext(ctx)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("status %d, quiero 503", w.Code)
	}

	entries := logs.FilterMessage("readiness: la base no contesta").All()
	if len(entries) != 1 {
		t.Fatalf("se loguearon %d entradas, quiero exactamente 1 — la caida real no se puede perder aunque el caller tambien se haya ido", len(entries))
	}
}

// TestReadinessChecker_LaFallaDeConexionPropaga prueba que un pool cerrado —el
// caso mas simple de "la base no contesta"— realmente hace que Check devuelva
// error. Con SELECT 1, un fallo de conexion lo captura enteramente la rama
// `if err != nil`: nunca llega a la guarda `uno != 1`, asi que este test NO
// cubre esa guarda. Ver TestGormScanSinFilasNoDaError para lo que si la cubre
// (la premisa que la justifica), y el comentario de Check en readiness.go.
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

// TestGormScanSinFilasNoDaError prueba el peligro del que se defiende la guarda
// `uno != 1` del checker: GORM devuelve error nil y deja la variable en cero
// cuando la consulta no matchea ninguna fila. Sin la guarda, eso seria "listo"
// sin que la base hubiera contestado nada.
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
