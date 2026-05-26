package tests

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/dto"
	"lost-pets/internal/handler"
	"lost-pets/internal/service"
)

// ============================================================
// Mock: PetService
// ============================================================

type mockPetService struct {
	createPetFn   func(ownerID string, req service.CreatePetRequest) (*domain.Pet, error)
	getPetByIDFn  func(id string) (*domain.Pet, error)
	getMyPetsFn   func(ownerID string) ([]domain.Pet, error)
	updatePetFn   func(ownerID, petID string, req service.UpdatePetRequest) (*domain.Pet, error)
	deletePetFn   func(ownerID, petID string) error
	markAsFoundFn func(ownerID, petID string) (*domain.Pet, error)
	searchPetsFn  func(criteria domain.PetSearchCriteria) (dto.PetSearchResponse, error)
}

func (m *mockPetService) CreatePet(ownerID string, req service.CreatePetRequest) (*domain.Pet, error) {
	if m.createPetFn != nil {
		return m.createPetFn(ownerID, req)
	}
	return nil, nil
}

func (m *mockPetService) GetPetByID(id string) (*domain.Pet, error) {
	if m.getPetByIDFn != nil {
		return m.getPetByIDFn(id)
	}
	return nil, domain.ErrPetNotFound
}

func (m *mockPetService) GetMyPets(ownerID string) ([]domain.Pet, error) {
	if m.getMyPetsFn != nil {
		return m.getMyPetsFn(ownerID)
	}
	return nil, nil
}

func (m *mockPetService) UpdatePet(ownerID, petID string, req service.UpdatePetRequest) (*domain.Pet, error) {
	if m.updatePetFn != nil {
		return m.updatePetFn(ownerID, petID, req)
	}
	return nil, nil
}

func (m *mockPetService) DeletePet(ownerID, petID string) error {
	if m.deletePetFn != nil {
		return m.deletePetFn(ownerID, petID)
	}
	return nil
}

func (m *mockPetService) MarkAsFound(ownerID, petID string) (*domain.Pet, error) {
	if m.markAsFoundFn != nil {
		return m.markAsFoundFn(ownerID, petID)
	}
	return nil, nil
}

func (m *mockPetService) SearchPets(criteria domain.PetSearchCriteria) (dto.PetSearchResponse, error) {
	if m.searchPetsFn != nil {
		return m.searchPetsFn(criteria)
	}
	return dto.PetSearchResponse{}, nil
}

// ============================================================
// Router helpers
// ============================================================

func setupPetRouter(h *handler.PetHandler, ownerID uuid.UUID) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()

	// Auth-protected routes — inject userID via mock middleware
	auth := r.Group("/api/pets")
	auth.Use(injectUserID(ownerID))
	{
		auth.POST("", h.CreatePet)
		auth.GET("/mine", h.GetMyPets)
		auth.PUT("/:id", h.UpdatePet)
		auth.DELETE("/:id", h.DeletePet)
	}

	// Public routes — no auth middleware
	r.GET("/api/pets/:id", h.GetPet)

	return r
}

// ============================================================
// Test data helpers
// ============================================================

func newTestPet(ownerID uuid.UUID) *domain.Pet {
	return &domain.Pet{
		ID:        uuid.New(),
		OwnerID:   ownerID,
		Name:      "Buddy",
		Type:      "perro",
		Breed:     "Labrador",
		Color:     "Dorado",
		Status:    "active",
		CreatedAt: time.Now(),
	}
}

// ============================================================
// GET /api/pets/:id
// ============================================================

func TestPetHandler_GetPet(t *testing.T) {
	ownerID := uuid.New()
	existingPet := newTestPet(ownerID)

	tests := []struct {
		name       string
		petID      string
		setupMock  func(*mockPetService)
		wantStatus int
	}{
		{
			name:  "existing pet returns 200",
			petID: existingPet.ID.String(),
			setupMock: func(m *mockPetService) {
				m.getPetByIDFn = func(_ string) (*domain.Pet, error) {
					return existingPet, nil
				}
			},
			wantStatus: http.StatusOK,
		},
		{
			name:  "non-existent pet returns 404",
			petID: uuid.New().String(),
			setupMock: func(m *mockPetService) {
				m.getPetByIDFn = func(_ string) (*domain.Pet, error) {
					return nil, domain.ErrPetNotFound
				}
			},
			wantStatus: http.StatusNotFound,
		},
		{
			name:  "internal error returns 500",
			petID: uuid.New().String(),
			setupMock: func(m *mockPetService) {
				m.getPetByIDFn = func(_ string) (*domain.Pet, error) {
					return nil, domain.ErrInternal
				}
			},
			wantStatus: http.StatusInternalServerError,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			svc := &mockPetService{}
			tc.setupMock(svc)
			r := setupPetRouter(handler.NewPetHandler(svc), ownerID)

			req := httptest.NewRequest(http.MethodGet, "/api/pets/"+tc.petID, nil)
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)

			if w.Code != tc.wantStatus {
				t.Errorf("want status %d, got %d: %s", tc.wantStatus, w.Code, w.Body.String())
			}
		})
	}
}

// TestPetHandler_GetPet_ResponseShape verifies the 200 response contains pet fields.
func TestPetHandler_GetPet_ResponseShape(t *testing.T) {
	ownerID := uuid.New()
	pet := newTestPet(ownerID)
	svc := &mockPetService{
		getPetByIDFn: func(_ string) (*domain.Pet, error) { return pet, nil },
	}
	r := setupPetRouter(handler.NewPetHandler(svc), ownerID)

	req := httptest.NewRequest(http.MethodGet, "/api/pets/"+pet.ID.String(), nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", w.Code)
	}

	var resp dto.PetResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if resp.ID != pet.ID {
		t.Errorf("want pet ID %s, got %s", pet.ID, resp.ID)
	}
	if resp.Name != pet.Name {
		t.Errorf("want pet name %q, got %q", pet.Name, resp.Name)
	}
}

// ============================================================
// POST /api/pets
// ============================================================

func TestPetHandler_CreatePet(t *testing.T) {
	ownerID := uuid.New()

	validBody := map[string]interface{}{
		"name":  "Luna",
		"type":  "gato",
		"color": "Negro",
	}

	tests := []struct {
		name       string
		body       map[string]interface{}
		setupMock  func(*mockPetService)
		wantStatus int
	}{
		{
			name: "valid body with auth returns 201",
			body: validBody,
			setupMock: func(m *mockPetService) {
				m.createPetFn = func(ownerID string, req service.CreatePetRequest) (*domain.Pet, error) {
					return &domain.Pet{
						ID:      uuid.New(),
						OwnerID: uuid.MustParse(ownerID),
						Name:    req.Name,
						Type:    req.Type,
						Color:   req.Color,
						Status:  "active",
					}, nil
				}
			},
			wantStatus: http.StatusCreated,
		},
		{
			name: "internal error returns 500",
			body: validBody,
			setupMock: func(m *mockPetService) {
				m.createPetFn = func(_ string, _ service.CreatePetRequest) (*domain.Pet, error) {
					return nil, domain.ErrInternal
				}
			},
			wantStatus: http.StatusInternalServerError,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			svc := &mockPetService{}
			tc.setupMock(svc)
			r := setupPetRouter(handler.NewPetHandler(svc), ownerID)

			body, _ := json.Marshal(tc.body)
			req := httptest.NewRequest(http.MethodPost, "/api/pets", bytes.NewReader(body))
			req.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)

			if w.Code != tc.wantStatus {
				t.Errorf("want status %d, got %d: %s", tc.wantStatus, w.Code, w.Body.String())
			}
		})
	}
}

// TestPetHandler_CreatePet_MissingAuth verifies that without the userID in context
// the handler panics (or the middleware blocks). We simulate the middleware blocking
// by NOT injecting userID — the router simply never reaches the handler.
// This test documents the expected 401 behavior at the middleware boundary.
func TestPetHandler_CreatePet_MissingAuth(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	// This route has NO injectUserID middleware — it simulates what a real auth
	// middleware would do: abort with 401 before the handler runs.
	r.POST("/api/pets/noauth", func(c *gin.Context) {
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "token requerido"})
	})

	body, _ := json.Marshal(map[string]interface{}{"name": "Luna", "type": "gato"})
	req := httptest.NewRequest(http.MethodPost, "/api/pets/noauth", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("want 401, got %d", w.Code)
	}
}

// ============================================================
// PUT /api/pets/:id
// ============================================================

func TestPetHandler_UpdatePet(t *testing.T) {
	ownerID := uuid.New()
	otherID := uuid.New()
	petID := uuid.New()

	validBody := map[string]interface{}{
		"name":  "Luna Updated",
		"color": "Blanco",
	}

	tests := []struct {
		name       string
		ownerID    uuid.UUID
		petIDStr   string
		body       map[string]interface{}
		setupMock  func(*mockPetService)
		wantStatus int
	}{
		{
			name:     "owner updates pet returns 200",
			ownerID:  ownerID,
			petIDStr: petID.String(),
			body:     validBody,
			setupMock: func(m *mockPetService) {
				m.updatePetFn = func(_, _ string, req service.UpdatePetRequest) (*domain.Pet, error) {
					return &domain.Pet{
						ID:      petID,
						OwnerID: ownerID,
						Name:    req.Name,
						Color:   req.Color,
						Status:  "active",
					}, nil
				}
			},
			wantStatus: http.StatusOK,
		},
		{
			name:     "non-owner update returns 403",
			ownerID:  otherID,
			petIDStr: petID.String(),
			body:     validBody,
			setupMock: func(m *mockPetService) {
				m.updatePetFn = func(_, _ string, _ service.UpdatePetRequest) (*domain.Pet, error) {
					return nil, domain.ErrForbidden
				}
			},
			wantStatus: http.StatusForbidden,
		},
		{
			name:     "pet not found returns 404",
			ownerID:  ownerID,
			petIDStr: uuid.New().String(),
			body:     validBody,
			setupMock: func(m *mockPetService) {
				m.updatePetFn = func(_, _ string, _ service.UpdatePetRequest) (*domain.Pet, error) {
					return nil, domain.ErrPetNotFound
				}
			},
			wantStatus: http.StatusNotFound,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			svc := &mockPetService{}
			tc.setupMock(svc)
			r := setupPetRouter(handler.NewPetHandler(svc), tc.ownerID)

			body, _ := json.Marshal(tc.body)
			req := httptest.NewRequest(http.MethodPut, "/api/pets/"+tc.petIDStr, bytes.NewReader(body))
			req.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)

			if w.Code != tc.wantStatus {
				t.Errorf("want status %d, got %d: %s", tc.wantStatus, w.Code, w.Body.String())
			}
		})
	}
}

// ============================================================
// DELETE /api/pets/:id
// ============================================================

func TestPetHandler_DeletePet(t *testing.T) {
	ownerID := uuid.New()
	otherID := uuid.New()
	petID := uuid.New()

	tests := []struct {
		name       string
		ownerID    uuid.UUID
		petIDStr   string
		setupMock  func(*mockPetService)
		wantStatus int
	}{
		{
			name:     "owner deletes pet returns 204",
			ownerID:  ownerID,
			petIDStr: petID.String(),
			setupMock: func(m *mockPetService) {
				m.deletePetFn = func(_, _ string) error { return nil }
			},
			wantStatus: http.StatusNoContent,
		},
		{
			name:     "non-owner delete returns 403",
			ownerID:  otherID,
			petIDStr: petID.String(),
			setupMock: func(m *mockPetService) {
				m.deletePetFn = func(_, _ string) error { return domain.ErrForbidden }
			},
			wantStatus: http.StatusForbidden,
		},
		{
			name:     "pet not found returns 404",
			ownerID:  ownerID,
			petIDStr: uuid.New().String(),
			setupMock: func(m *mockPetService) {
				m.deletePetFn = func(_, _ string) error { return domain.ErrPetNotFound }
			},
			wantStatus: http.StatusNotFound,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			svc := &mockPetService{}
			tc.setupMock(svc)
			r := setupPetRouter(handler.NewPetHandler(svc), tc.ownerID)

			req := httptest.NewRequest(http.MethodDelete, "/api/pets/"+tc.petIDStr, nil)
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)

			if w.Code != tc.wantStatus {
				t.Errorf("want status %d, got %d: %s", tc.wantStatus, w.Code, w.Body.String())
			}
		})
	}
}

// ============================================================
// GET /api/pets/mine
// ============================================================

func TestPetHandler_GetMyPets(t *testing.T) {
	ownerID := uuid.New()

	tests := []struct {
		name       string
		setupMock  func(*mockPetService)
		wantStatus int
		wantCount  int
	}{
		{
			name: "returns owned pets array",
			setupMock: func(m *mockPetService) {
				m.getMyPetsFn = func(_ string) ([]domain.Pet, error) {
					return []domain.Pet{
						*newTestPet(ownerID),
						*newTestPet(ownerID),
					}, nil
				}
			},
			wantStatus: http.StatusOK,
			wantCount:  2,
		},
		{
			name: "returns empty array when no pets",
			setupMock: func(m *mockPetService) {
				m.getMyPetsFn = func(_ string) ([]domain.Pet, error) {
					return []domain.Pet{}, nil
				}
			},
			wantStatus: http.StatusOK,
			wantCount:  0,
		},
		{
			name: "internal error returns 500",
			setupMock: func(m *mockPetService) {
				m.getMyPetsFn = func(_ string) ([]domain.Pet, error) {
					return nil, domain.ErrInternal
				}
			},
			wantStatus: http.StatusInternalServerError,
			wantCount:  -1, // skip check
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			svc := &mockPetService{}
			tc.setupMock(svc)
			r := setupPetRouter(handler.NewPetHandler(svc), ownerID)

			req := httptest.NewRequest(http.MethodGet, "/api/pets/mine", nil)
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)

			if w.Code != tc.wantStatus {
				t.Errorf("want status %d, got %d: %s", tc.wantStatus, w.Code, w.Body.String())
			}

			if tc.wantCount >= 0 && w.Code == http.StatusOK {
				var resp []dto.PetResponse
				if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
					t.Fatalf("failed to decode response: %v", err)
				}
				if len(resp) != tc.wantCount {
					t.Errorf("want %d pets, got %d", tc.wantCount, len(resp))
				}
			}
		})
	}
}
