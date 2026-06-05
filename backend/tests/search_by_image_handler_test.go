package tests

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/dto"
	"lost-pets/internal/handler"
	"lost-pets/internal/repository"
	"lost-pets/internal/service"
)

// ============================================================
// Mocks for EmbeddingService repos
// ============================================================

type mockEmbeddingRepoForHandler struct {
	findSimilarFn func(ctx context.Context, queryVec []float32, limit int) ([]domain.ImageSearchResult, error)
}

func (m *mockEmbeddingRepoForHandler) Upsert(_ context.Context, _ *domain.PetEmbedding) error {
	return nil
}

func (m *mockEmbeddingRepoForHandler) FindSimilar(ctx context.Context, queryVec []float32, limit int) ([]domain.ImageSearchResult, error) {
	if m.findSimilarFn != nil {
		return m.findSimilarFn(ctx, queryVec, limit)
	}
	return []domain.ImageSearchResult{}, nil
}

func (m *mockEmbeddingRepoForHandler) DeleteByPetID(_ context.Context, _ uuid.UUID) error {
	return nil
}

var _ repository.PetEmbeddingRepository = (*mockEmbeddingRepoForHandler)(nil)

type nopPetRepoForHandler struct{}

func (n *nopPetRepoForHandler) Create(_ *domain.Pet) error                         { return nil }
func (n *nopPetRepoForHandler) FindByID(_ string) (*domain.Pet, error)             { return nil, nil }
func (n *nopPetRepoForHandler) FindByOwnerID(_ string) ([]domain.Pet, error)       { return nil, nil }
func (n *nopPetRepoForHandler) Update(_ *domain.Pet) error                         { return nil }
func (n *nopPetRepoForHandler) UpdateStatus(_ string, _ string) error              { return nil }
func (n *nopPetRepoForHandler) Delete(_ string) error                              { return nil }
func (n *nopPetRepoForHandler) Search(_ domain.PetSearchCriteria) ([]domain.Pet, int64, error) {
	return nil, 0, nil
}

var _ repository.PetRepository = (*nopPetRepoForHandler)(nil)

type nopPhotoRepoForHandler struct{}

func (n *nopPhotoRepoForHandler) Create(_ *domain.Photo) error                  { return nil }
func (n *nopPhotoRepoForHandler) FindByPetID(_ string) ([]domain.Photo, error)  { return []domain.Photo{}, nil }
func (n *nopPhotoRepoForHandler) FindByID(_ string) (*domain.Photo, error)      { return &domain.Photo{}, nil }
func (n *nopPhotoRepoForHandler) HasPrimaryPhoto(_ string) (bool, error)        { return false, nil }
func (n *nopPhotoRepoForHandler) UnsetPrimaryPhotos(_ string) error             { return nil }
func (n *nopPhotoRepoForHandler) CountByPetID(_ string) (int64, error)          { return 0, nil }
func (n *nopPhotoRepoForHandler) DeleteByPetID(_ string) error                  { return nil }
func (n *nopPhotoRepoForHandler) DeleteByID(_ string) error                     { return nil }

var _ repository.PhotoRepository = (*nopPhotoRepoForHandler)(nil)

// ============================================================
// HF server helpers
// ============================================================

func make512FloatsForSearchTest() []float32 {
	v := make([]float32, 512)
	for i := range v {
		v[i] = 0.1
	}
	return v
}

func newHFServerForSearchTest(t *testing.T, statusCode int) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if statusCode != http.StatusOK {
			w.WriteHeader(statusCode)
			fmt.Fprintf(w, `{"error":"service unavailable"}`)
			return
		}
		nested := [][]float32{make512FloatsForSearchTest()}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(nested)
	}))
}

// buildSearchByImageHandler wires up a PetHandler with a real EmbeddingService
// pointed at the provided mock HTTP server.
func buildSearchByImageHandler(
	embRepo repository.PetEmbeddingRepository,
	hfSrv *httptest.Server,
) *handler.PetHandler {
	embSvc := service.NewEmbeddingService(
		embRepo,
		&nopPetRepoForHandler{},
		&nopPhotoRepoForHandler{},
		"test-key",
	)
	embSvc.SetHTTPClientAndEndpoint(hfSrv.Client(), hfSrv.URL)

	petSvc := &mockPetService{} // defined in pet_handler_test.go (same package)
	return handler.NewPetHandler(petSvc, embSvc)
}

func setupSearchByImageRouter(h *handler.PetHandler) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.POST("/api/pets/search/image", h.SearchByImage)
	return r
}

// buildSearchMultipartRequest creates a multipart POST with an optional "photo" field.
// Pass fieldName="" to omit the field entirely (tests the missing-field error path).
func buildSearchMultipartRequest(t *testing.T, fieldName string, content []byte) *http.Request {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	if fieldName != "" {
		fw, err := mw.CreateFormFile(fieldName, "test.jpg")
		if err != nil {
			t.Fatalf("failed to create form file: %v", err)
		}
		fw.Write(content)
	}
	mw.Close()
	req := httptest.NewRequest(http.MethodPost, "/api/pets/search/image", &buf)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	return req
}

// ============================================================
// Tests: SearchByImage
// ============================================================

// TestSearchByImage_HappyPath verifies that a valid multipart POST with "photo"
// field returns 200 and the expected ImageSearchResponse.
func TestSearchByImage_HappyPath(t *testing.T) {
	petID := uuid.New()
	ownerID := uuid.New()

	hfSrv := newHFServerForSearchTest(t, http.StatusOK)
	defer hfSrv.Close()

	embRepo := &mockEmbeddingRepoForHandler{
		findSimilarFn: func(_ context.Context, _ []float32, _ int) ([]domain.ImageSearchResult, error) {
			return []domain.ImageSearchResult{
				{
					PetID:      petID,
					OwnerID:    ownerID,
					PetName:    "Buddy",
					PetType:    "perro",
					PrimaryURL: "https://cdn.example.com/buddy.jpg",
					Similarity: 0.92,
				},
			}, nil
		},
	}

	h := buildSearchByImageHandler(embRepo, hfSrv)
	r := setupSearchByImageRouter(h)

	// Send a minimal valid JPEG header as image bytes.
	req := buildSearchMultipartRequest(t, "photo", []byte{0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10})
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp dto.ImageSearchResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if len(resp.Results) != 1 {
		t.Fatalf("expected 1 result, got %d", len(resp.Results))
	}
	if resp.Results[0].Name != "Buddy" {
		t.Errorf("expected name 'Buddy', got %q", resp.Results[0].Name)
	}
	if resp.Results[0].Similarity != 0.92 {
		t.Errorf("expected similarity 0.92, got %v", resp.Results[0].Similarity)
	}
}

// TestSearchByImage_MissingField_Returns400 verifies that a multipart POST
// WITHOUT the "photo" field returns HTTP 400.
func TestSearchByImage_MissingField_Returns400(t *testing.T) {
	hfSrv := newHFServerForSearchTest(t, http.StatusOK)
	defer hfSrv.Close()

	h := buildSearchByImageHandler(&mockEmbeddingRepoForHandler{}, hfSrv)
	r := setupSearchByImageRouter(h)

	// Omit the "photo" field entirely.
	req := buildSearchMultipartRequest(t, "", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 when 'photo' field is missing, got %d: %s", w.Code, w.Body.String())
	}
}

// TestSearchByImage_HFDown_Returns503 verifies that when the HuggingFace API
// returns an error, the handler responds with HTTP 503.
func TestSearchByImage_HFDown_Returns503(t *testing.T) {
	hfSrv := newHFServerForSearchTest(t, http.StatusServiceUnavailable)
	defer hfSrv.Close()

	h := buildSearchByImageHandler(&mockEmbeddingRepoForHandler{}, hfSrv)
	r := setupSearchByImageRouter(h)

	req := buildSearchMultipartRequest(t, "photo", []byte{0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10})
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusServiceUnavailable {
		t.Errorf("expected 503 when HF is down, got %d: %s", w.Code, w.Body.String())
	}
}
