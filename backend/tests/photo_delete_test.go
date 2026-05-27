package tests

import (
	"context"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/handler"
	"lost-pets/internal/service"
)

// ============================================================
// Mock: PhotoService (full interface implementation)
// ============================================================

type mockPhotoService struct {
	deletePhotoFn    func(ctx context.Context, petID, photoID, uploaderID string) error
	uploadPhotoFn    func(ctx context.Context, petID, uploaderID string, file multipart.File, filename string) (*domain.Photo, error)
	getPhotosByPetFn func(petID string) ([]domain.Photo, error)
	deleteByPetIDFn  func(petID string) error
}

func (m *mockPhotoService) DeletePhoto(ctx context.Context, petID, photoID, uploaderID string) error {
	if m.deletePhotoFn != nil {
		return m.deletePhotoFn(ctx, petID, photoID, uploaderID)
	}
	return nil
}

func (m *mockPhotoService) UploadPhoto(ctx context.Context, petID, uploaderID string, file multipart.File, filename string) (*domain.Photo, error) {
	if m.uploadPhotoFn != nil {
		return m.uploadPhotoFn(ctx, petID, uploaderID, file, filename)
	}
	return &domain.Photo{ID: uuid.New()}, nil
}

func (m *mockPhotoService) GetPhotosByPet(petID string) ([]domain.Photo, error) {
	if m.getPhotosByPetFn != nil {
		return m.getPhotosByPetFn(petID)
	}
	return nil, nil
}

func (m *mockPhotoService) DeleteByPetID(petID string) error {
	if m.deleteByPetIDFn != nil {
		return m.deleteByPetIDFn(petID)
	}
	return nil
}

// Ensure mockPhotoService satisfies service.PhotoService at compile time.
var _ service.PhotoService = (*mockPhotoService)(nil)

// ============================================================
// Helpers: build a gin router for DELETE /pets/:id/photos/:photoId
// with the caller's userID injected via context (simulating auth middleware)
// ============================================================

func buildDeletePhotoRouter(svc service.PhotoService, callerUUID uuid.UUID) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	h := handler.NewPhotoHandler(svc)
	r.DELETE("/pets/:id/photos/:photoId", func(c *gin.Context) {
		// Auth middleware stores userID as uuid.UUID in the gin context.
		c.Set("userID", callerUUID)
		h.Delete(c)
	})
	return r
}

// ============================================================
// Tests: DELETE /pets/:id/photos/:photoId
// ============================================================

func TestDeletePhoto_OwnerDeletesSuccessfully(t *testing.T) {
	callerUUID := uuid.New()
	svc := &mockPhotoService{
		deletePhotoFn: func(_ context.Context, _, _, _ string) error {
			return nil
		},
	}

	r := buildDeletePhotoRouter(svc, callerUUID)
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodDelete, "/pets/pet-1/photos/photo-1", nil)
	r.ServeHTTP(w, req)

	if w.Code != http.StatusNoContent {
		t.Errorf("expected 204, got %d (body: %s)", w.Code, w.Body.String())
	}
}

func TestDeletePhoto_NonOwner_Returns403(t *testing.T) {
	callerUUID := uuid.New()
	svc := &mockPhotoService{
		deletePhotoFn: func(_ context.Context, _, _, _ string) error {
			return domain.ErrNotPetOwner
		},
	}

	r := buildDeletePhotoRouter(svc, callerUUID)
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodDelete, "/pets/pet-1/photos/photo-1", nil)
	r.ServeHTTP(w, req)

	if w.Code != http.StatusForbidden {
		t.Errorf("expected 403, got %d (body: %s)", w.Code, w.Body.String())
	}
}

func TestDeletePhoto_PhotoNotFound_Returns404(t *testing.T) {
	callerUUID := uuid.New()
	svc := &mockPhotoService{
		deletePhotoFn: func(_ context.Context, _, _, _ string) error {
			return domain.ErrPhotoNotFound
		},
	}

	r := buildDeletePhotoRouter(svc, callerUUID)
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodDelete, "/pets/pet-1/photos/photo-999", nil)
	r.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d (body: %s)", w.Code, w.Body.String())
	}
}

func TestDeletePhoto_PetNotFound_Returns404(t *testing.T) {
	callerUUID := uuid.New()
	svc := &mockPhotoService{
		deletePhotoFn: func(_ context.Context, _, _, _ string) error {
			return domain.ErrPetNotFound
		},
	}

	r := buildDeletePhotoRouter(svc, callerUUID)
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodDelete, "/pets/pet-999/photos/photo-1", nil)
	r.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d (body: %s)", w.Code, w.Body.String())
	}
}

func TestDeletePhoto_InternalError_Returns500(t *testing.T) {
	callerUUID := uuid.New()
	svc := &mockPhotoService{
		deletePhotoFn: func(_ context.Context, _, _, _ string) error {
			return domain.ErrInternal
		},
	}

	r := buildDeletePhotoRouter(svc, callerUUID)
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodDelete, "/pets/pet-1/photos/photo-1", nil)
	r.ServeHTTP(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Errorf("expected 500, got %d (body: %s)", w.Code, w.Body.String())
	}
}
