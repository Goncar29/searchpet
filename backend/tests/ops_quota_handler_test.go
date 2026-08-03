package tests

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"lost-pets/internal/handler"
	"lost-pets/internal/service"
)

func buildOpsQuotaRouter(token string, repo *mockTokenRepo) *gin.Engine {
	h := handler.NewOpsQuotaHandler(service.NewOpsQuotaService(repo), token)
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/api/ops/quota", h.Report)
	return r
}

func doOpsQuota(r *gin.Engine, header string, setHeader bool) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, "/api/ops/quota", nil)
	if setHeader {
		req.Header.Set("X-Ops-Token", header)
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

// TestOpsQuota_TokenVacioDa404ConHeaderVacio es un test sobre el ORDEN de los dos
// chequeos, no sobre el 404. Si el handler comparara el header antes de mirar si
// hay token configurado, un OPS_STATUS_TOKEN sin setear matchearia con un header
// vacio y el endpoint le contestaria a cualquiera.
func TestOpsQuota_TokenVacioDa404ConHeaderVacio(t *testing.T) {
	r := buildOpsQuotaRouter("", &mockTokenRepo{})

	w := doOpsQuota(r, "", true)
	if w.Code != http.StatusNotFound {
		t.Fatalf("con token sin configurar y header vacio: %d, quiero 404", w.Code)
	}

	w = doOpsQuota(r, "", false)
	if w.Code != http.StatusNotFound {
		t.Fatalf("con token sin configurar y sin header: %d, quiero 404", w.Code)
	}
}

// TestOpsQuota_TokenEquivocadoDa404 — 404 y no 401: un 401 confirma que la ruta existe.
func TestOpsQuota_TokenEquivocadoDa404(t *testing.T) {
	r := buildOpsQuotaRouter("secreto", &mockTokenRepo{})
	w := doOpsQuota(r, "otra-cosa", true)
	if w.Code != http.StatusNotFound {
		t.Fatalf("token equivocado: %d, quiero 404", w.Code)
	}
	if strings.Contains(w.Body.String(), "quota") {
		t.Fatalf("el 404 filtro info del cupo: %s", w.Body.String())
	}
}

// TestOpsQuota_TokenCorrectoDevuelveElCuerpo verifica el contrato completo.
func TestOpsQuota_TokenCorrectoDevuelveElCuerpo(t *testing.T) {
	r := buildOpsQuotaRouter("secreto", &mockTokenRepo{countGlobal: 0})
	w := doOpsQuota(r, "secreto", true)

	if w.Code != http.StatusOK {
		t.Fatalf("token correcto: %d, quiero 200", w.Code)
	}
	var rep service.QuotaReport
	if err := json.Unmarshal(w.Body.Bytes(), &rep); err != nil {
		t.Fatalf("cuerpo no parsea: %v — %s", err, w.Body.String())
	}
	if rep.Status != service.QuotaLevelOK {
		t.Fatalf("status = %q, quiero ok", rep.Status)
	}
	if len(rep.Alerts) != 0 {
		t.Fatalf("alerts = %v, quiero vacio", rep.Alerts)
	}
	if strings.Contains(w.Body.String(), service.AlertQuotaWarn) {
		t.Fatalf("en ok el cuerpo no puede contener %s: %s", service.AlertQuotaWarn, w.Body.String())
	}
}

// TestOpsQuota_CriticoPoneLosDosTokensEnElCuerpo es lo que los monitores matchean.
// Se verifica sobre el TEXTO CRUDO, no sobre el struct, porque el monitoreo busca
// substrings en el cuerpo — es el cuerpo lo que hay que probar, no el modelo.
func TestOpsQuota_CriticoPoneLosDosTokensEnElCuerpo(t *testing.T) {
	r := buildOpsQuotaRouter("secreto", &mockTokenRepo{countGlobal: 250})
	w := doOpsQuota(r, "secreto", true)

	if w.Code != http.StatusOK {
		t.Fatalf("codigo %d, quiero 200", w.Code)
	}
	body := w.Body.String()
	if !strings.Contains(body, service.AlertQuotaCrit) {
		t.Fatalf("falta %s en %s", service.AlertQuotaCrit, body)
	}
	if !strings.Contains(body, service.AlertQuotaWarn) {
		t.Fatalf("falta %s en %s — escalar no puede leerse como recuperarse", service.AlertQuotaWarn, body)
	}
}

// TestOpsQuota_ConteoRotoDa500SinNivel: si el conteo fallo, el cuerpo no puede
// contener status ni alerts. Un 200 diciendo ok sobre un conteo que no ocurrio es
// peor que un 500.
func TestOpsQuota_ConteoRotoDa500SinNivel(t *testing.T) {
	r := buildOpsQuotaRouter("secreto", &mockTokenRepo{countErr: errors.New("boom")})
	w := doOpsQuota(r, "secreto", true)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("conteo roto: %d, quiero 500", w.Code)
	}
	body := w.Body.String()
	if strings.Contains(body, `"status"`) || strings.Contains(body, `"alerts"`) {
		t.Fatalf("el 500 no puede traer status ni alerts: %s", body)
	}
}
