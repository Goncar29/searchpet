package tests

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"lost-pets/internal/handler"
	"lost-pets/internal/service"
)

// buildReindexRouter wires a ReindexHandler with a real EmbeddingService whose
// HTTP client points at the given Jina mock server, gated by the given token.
func buildReindexRouter(token string, hfSrv *httptest.Server) *gin.Engine {
	embSvc := service.NewEmbeddingService(
		&mockEmbeddingRepoForHandler{},
		&nopPetRepoForHandler{}, // Search returns no pets → empty backfill
		&nopPhotoRepoForHandler{},
		"test-key",
	)
	embSvc.SetHTTPClientAndEndpoint(hfSrv.Client(), hfSrv.URL)

	h := handler.NewReindexHandler(embSvc, token)

	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.POST("/api/admin/reindex-embeddings", h.BackfillEmbeddings)
	return r
}

// TestReindex_DisabledWhenTokenUnset verifies the endpoint returns 404 (no
// surface) when REINDEX_TOKEN is empty, regardless of the request header.
func TestReindex_DisabledWhenTokenUnset(t *testing.T) {
	hfSrv := newJinaServerForSearchTest(t, http.StatusOK)
	defer hfSrv.Close()

	r := buildReindexRouter("", hfSrv)

	req := httptest.NewRequest(http.MethodPost, "/api/admin/reindex-embeddings", nil)
	req.Header.Set("X-Reindex-Token", "anything")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404 when token unset, got %d", w.Code)
	}
}

// TestReindex_WrongToken verifies a 404 (not 401/403) when the supplied token
// does not match — the endpoint stays indistinguishable from a missing route.
func TestReindex_WrongToken(t *testing.T) {
	hfSrv := newJinaServerForSearchTest(t, http.StatusOK)
	defer hfSrv.Close()

	r := buildReindexRouter("the-secret", hfSrv)

	req := httptest.NewRequest(http.MethodPost, "/api/admin/reindex-embeddings", nil)
	req.Header.Set("X-Reindex-Token", "wrong")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for wrong token, got %d", w.Code)
	}
}

// TestReindex_CorrectToken verifies a 200 with a BackfillResult body when the
// token matches.
func TestReindex_CorrectToken(t *testing.T) {
	hfSrv := newJinaServerForSearchTest(t, http.StatusOK)
	defer hfSrv.Close()

	r := buildReindexRouter("the-secret", hfSrv)

	req := httptest.NewRequest(http.MethodPost, "/api/admin/reindex-embeddings", nil)
	req.Header.Set("X-Reindex-Token", "the-secret")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 for correct token, got %d (body: %s)", w.Code, w.Body.String())
	}

	var res service.BackfillResult
	if err := json.Unmarshal(w.Body.Bytes(), &res); err != nil {
		t.Fatalf("response is not a BackfillResult: %v (body: %s)", err, w.Body.String())
	}
	// nopPetRepo returns no pets → everything zero, but the shape must be present.
	if res.PetsScanned != 0 {
		t.Errorf("PetsScanned = %d, want 0 (no eligible pets in mock)", res.PetsScanned)
	}
}
