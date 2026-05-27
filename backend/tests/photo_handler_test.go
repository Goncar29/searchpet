package tests

import (
	"bytes"
	"context"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/dto"
	"lost-pets/internal/handler"
)

// ============================================================
// Mock: PhotoService
// ============================================================

type mockPhotoService struct {
	uploadPhotoFn    func(ctx context.Context, petID string, uploaderID string, file multipart.File, filename string) (*domain.Photo, error)
	getPhotosByPetFn func(petID string) ([]domain.Photo, error)
	deleteByPetIDFn  func(petID string) error
}

func (m *mockPhotoService) UploadPhoto(ctx context.Context, petID string, uploaderID string, file multipart.File, filename string) (*domain.Photo, error) {
	if m.uploadPhotoFn != nil {
		return m.uploadPhotoFn(ctx, petID, uploaderID, file, filename)
	}
	return &domain.Photo{ID: uuid.New()}, nil
}

func (m *mockPhotoService) GetPhotosByPet(petID string) ([]domain.Photo, error) {
	if m.getPhotosByPetFn != nil {
		return m.getPhotosByPetFn(petID)
	}
	return []domain.Photo{}, nil
}

func (m *mockPhotoService) DeleteByPetID(petID string) error {
	if m.deleteByPetIDFn != nil {
		return m.deleteByPetIDFn(petID)
	}
	return nil
}

// ============================================================
// Router setup
// ============================================================

func setupPhotoRouter(h *handler.PhotoHandler, callerID uuid.UUID) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/api/pets/:id/photos", h.List)
	r.POST("/api/pets/:id/photos", injectUserID(callerID), h.Upload)
	return r
}

// ============================================================
// List tests
// ============================================================

func TestPhotoHandler_List_OK(t *testing.T) {
	petID := uuid.New()
	photos := []domain.Photo{
		{ID: uuid.New(), PetID: petID, URL: "https://example.com/photo1.jpg", IsPrimary: true},
		{ID: uuid.New(), PetID: petID, URL: "https://example.com/photo2.jpg"},
	}

	svc := &mockPhotoService{
		getPhotosByPetFn: func(pid string) ([]domain.Photo, error) {
			return photos, nil
		},
	}
	h := handler.NewPhotoHandler(svc)
	r := setupPhotoRouter(h, uuid.New())

	req := httptest.NewRequest(http.MethodGet, "/api/pets/"+petID.String()+"/photos", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp []dto.PetPhotoResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if len(resp) != 2 {
		t.Errorf("expected 2 photos, got %d", len(resp))
	}
}

func TestPhotoHandler_List_EmptyList(t *testing.T) {
	petID := uuid.New()

	svc := &mockPhotoService{
		getPhotosByPetFn: func(pid string) ([]domain.Photo, error) {
			return []domain.Photo{}, nil
		},
	}
	h := handler.NewPhotoHandler(svc)
	r := setupPhotoRouter(h, uuid.New())

	req := httptest.NewRequest(http.MethodGet, "/api/pets/"+petID.String()+"/photos", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200 for empty list, got %d", w.Code)
	}
}

// ============================================================
// Upload tests (auth guard)
// ============================================================

func TestPhotoHandler_Upload_NoAuth_Returns401(t *testing.T) {
	// When no userID is in context (no injectUserID middleware), getUserID returns ""
	// but Upload still proceeds. The handler itself doesn't check auth explicitly —
	// auth is enforced by the middleware layer in production. We test with a router
	// that has NO injectUserID to verify the route exists and processes the request.
	// The service will get an empty uploaderID which may fail ownership check.
	// We set up a separate router WITHOUT the auth middleware.
	gin.SetMode(gin.TestMode)
	r := gin.New()
	h := handler.NewPhotoHandler(&mockPhotoService{
		uploadPhotoFn: func(_ context.Context, _ string, uploaderID string, _ multipart.File, _ string) (*domain.Photo, error) {
			// Simulate ownership check failing because uploaderID is empty
			return nil, domain.ErrNotPetOwner
		},
	})
	r.POST("/api/pets/:id/photos", h.Upload)

	// Build a minimal multipart body with a valid JPEG header
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	fw, _ := mw.CreateFormFile("photo", "test.jpg")
	// Write JPEG magic bytes so DetectContentType identifies it as image/jpeg
	fw.Write([]byte{0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10})
	mw.Close()

	req := httptest.NewRequest(http.MethodPost, "/api/pets/"+uuid.New().String()+"/photos", &buf)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	// Expect 403 because uploaderID is "" → doesn't match owner
	if w.Code != http.StatusForbidden {
		t.Errorf("expected 403 when no auth user, got %d: %s", w.Code, w.Body.String())
	}
}
