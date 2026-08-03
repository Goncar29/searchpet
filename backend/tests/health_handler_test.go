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
	"lost-pets/internal/handler"
)

// stubChecker devuelve el error que le pongan, sin tocar ninguna base.
type stubChecker struct{ err error }

func (s *stubChecker) Check(ctx context.Context) error { return s.err }

func buildHealthRouter(err error) *gin.Engine {
	h := handler.NewHealthHandler(&stubChecker{err: err}, zap.NewNop())
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/health/ready", h.Ready)
	return r
}

func doReady(r *gin.Engine) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, "/health/ready", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

// TestReady_BaseRespondeDa200 es el camino feliz.
func TestReady_BaseRespondeDa200(t *testing.T) {
	w := doReady(buildHealthRouter(nil))

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
// lo tumba, y 503 es el que corresponde a una dependencia caida.
func TestReady_BaseCaidaDa503(t *testing.T) {
	w := doReady(buildHealthRouter(errors.New("dial tcp 10.0.0.7:5432: connect: connection refused")))

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
}

// TestReady_ElCuerpoNoFiltraElErrorDelDriver es el test que protege la decision del
// spec: los errores de Postgres traen host, puerto, usuario y a veces el nombre de
// la base, y este endpoint es PUBLICO. El detalle va al log, nunca al cuerpo.
func TestReady_ElCuerpoNoFiltraElErrorDelDriver(t *testing.T) {
	const secreto = "dial tcp 10.0.0.7:5432: connect: connection refused"
	w := doReady(buildHealthRouter(errors.New(secreto)))

	cuerpo := w.Body.String()
	for _, filtracion := range []string{"10.0.0.7", "5432", "dial tcp"} {
		if strings.Contains(cuerpo, filtracion) {
			t.Fatalf("el cuerpo %q expone %q — el error del driver no puede salir al publico", cuerpo, filtracion)
		}
	}
}
