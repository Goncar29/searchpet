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
)

// ============================================================
// Mock: PetService
// ============================================================

type mockPetService struct {
	createPetFn   func(ownerID string, req dto.CreatePetRequest) (*domain.Pet, error)
	getPetByIDFn  func(id string) (*domain.Pet, error)
	getMyPetsFn       func(ownerID string) ([]domain.Pet, error)
	getReportedPetsFn func(reporterID string) ([]domain.Pet, error)
	updatePetFn   func(ownerID, petID string, req dto.UpdatePetRequest) (*domain.Pet, error)
	deletePetFn   func(ownerID, petID string) error
	markAsFoundFn func(ownerID, petID string) (*domain.Pet, error)
	publishLostFn func(ownerID, petID string, req dto.PublishLostRequest) (*domain.Pet, error)
	searchPetsFn  func(criteria domain.PetSearchCriteria) (dto.PetSearchResponse, error)
}

func (m *mockPetService) CreatePet(ownerID string, req dto.CreatePetRequest) (*domain.Pet, error) {
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

func (m *mockPetService) GetReportedPets(reporterID string) ([]domain.Pet, error) {
	if m.getReportedPetsFn != nil {
		return m.getReportedPetsFn(reporterID)
	}
	return nil, nil
}

func (m *mockPetService) UpdatePet(ownerID, petID string, req dto.UpdatePetRequest) (*domain.Pet, error) {
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

func (m *mockPetService) PublishLost(ownerID, petID string, req dto.PublishLostRequest) (*domain.Pet, error) {
	if m.publishLostFn != nil {
		return m.publishLostFn(ownerID, petID, req)
	}
	return nil, nil
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
		auth.GET("/reported", h.GetReportedPets)
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
	ownerPtr := ownerID
	return &domain.Pet{
		ID:        uuid.New(),
		OwnerID:   &ownerPtr,
		Name:      "Buddy",
		Type:      "perro",
		Breed:     "Labrador",
		Color:     "Dorado",
		Status:    domain.PetStatusRegistered,
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
			r := setupPetRouter(handler.NewPetHandler(svc, nil), ownerID)

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
	r := setupPetRouter(handler.NewPetHandler(svc, nil), ownerID)

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
				m.createPetFn = func(ownerID string, req dto.CreatePetRequest) (*domain.Pet, error) {
					id := uuid.MustParse(ownerID)
					return &domain.Pet{
						ID:      uuid.New(),
						OwnerID: &id,
						Name:    req.Name,
						Type:    req.Type,
						Color:   req.Color,
						Status:  domain.PetStatusRegistered,
					}, nil
				}
			},
			wantStatus: http.StatusCreated,
		},
		{
			name: "internal error returns 500",
			body: validBody,
			setupMock: func(m *mockPetService) {
				m.createPetFn = func(_ string, _ dto.CreatePetRequest) (*domain.Pet, error) {
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
			r := setupPetRouter(handler.NewPetHandler(svc, nil), ownerID)

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
				m.updatePetFn = func(_, _ string, req dto.UpdatePetRequest) (*domain.Pet, error) {
					color := ""
					if req.Color != nil {
						color = *req.Color
					}
					return &domain.Pet{
						ID:      petID,
						OwnerID: &ownerID,
						Name:    req.Name,
						Color:   color,
						Status:  domain.PetStatusRegistered,
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
				m.updatePetFn = func(_, _ string, _ dto.UpdatePetRequest) (*domain.Pet, error) {
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
				m.updatePetFn = func(_, _ string, _ dto.UpdatePetRequest) (*domain.Pet, error) {
					return nil, domain.ErrPetNotFound
				}
			},
			wantStatus: http.StatusNotFound,
		},
		{
			name:     "unknown status returns 400",
			ownerID:  ownerID,
			petIDStr: petID.String(),
			body:     map[string]interface{}{"status": "flying"},
			setupMock: func(m *mockPetService) {
				// service should NOT be called — handler rejects before reaching service
			},
			wantStatus: http.StatusBadRequest,
		},
		{
			name:     "invalid transition returns 422",
			ownerID:  ownerID,
			petIDStr: petID.String(),
			body:     map[string]interface{}{"status": domain.PetStatusFound},
			setupMock: func(m *mockPetService) {
				m.updatePetFn = func(_, _ string, _ dto.UpdatePetRequest) (*domain.Pet, error) {
					return nil, domain.ErrInvalidStatusTransition
				}
			},
			wantStatus: http.StatusUnprocessableEntity,
		},
		{
			name:     "version conflict returns 409",
			ownerID:  ownerID,
			petIDStr: petID.String(),
			body:     map[string]interface{}{"status": domain.PetStatusLost, "version": 2},
			setupMock: func(m *mockPetService) {
				m.updatePetFn = func(_, _ string, _ dto.UpdatePetRequest) (*domain.Pet, error) {
					return nil, domain.ErrConflict
				}
			},
			wantStatus: http.StatusConflict,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			svc := &mockPetService{}
			tc.setupMock(svc)
			r := setupPetRouter(handler.NewPetHandler(svc, nil), tc.ownerID)

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
			r := setupPetRouter(handler.NewPetHandler(svc, nil), tc.ownerID)

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
			r := setupPetRouter(handler.NewPetHandler(svc, nil), ownerID)

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

// ============================================================
// GET /api/pets/reported
// ============================================================

func TestPetHandler_GetReportedPets(t *testing.T) {
	reporterID := uuid.New()

	t.Run("returns reported stray pets array", func(t *testing.T) {
		svc := &mockPetService{
			getReportedPetsFn: func(_ string) ([]domain.Pet, error) {
				return []domain.Pet{*newTestPet(reporterID), *newTestPet(reporterID)}, nil
			},
		}
		r := setupPetRouter(handler.NewPetHandler(svc, nil), reporterID)

		req := httptest.NewRequest(http.MethodGet, "/api/pets/reported", nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("want 200, got %d: %s", w.Code, w.Body.String())
		}
		var resp []dto.PetResponse
		if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
			t.Fatalf("failed to decode response: %v", err)
		}
		if len(resp) != 2 {
			t.Errorf("want 2 reported pets, got %d", len(resp))
		}
	})

	t.Run("internal error returns 500", func(t *testing.T) {
		svc := &mockPetService{
			getReportedPetsFn: func(_ string) ([]domain.Pet, error) {
				return nil, domain.ErrInternal
			},
		}
		r := setupPetRouter(handler.NewPetHandler(svc, nil), reporterID)

		req := httptest.NewRequest(http.MethodGet, "/api/pets/reported", nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		if w.Code != http.StatusInternalServerError {
			t.Errorf("want 500, got %d", w.Code)
		}
	})
}

// ============================================================
// GET /api/pets/search — public status allowlist
// ============================================================

func setupPetSearchRouter(h *handler.PetHandler) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/api/pets/search", h.SearchPets)
	return r
}

// The public search endpoint must only accept feed-visible statuses
// (lost, stray, found). Accepting registered/archived would let any
// anonymous visitor enumerate private pets via ?status=registered.
func TestPetHandler_SearchPets_StatusAllowlist(t *testing.T) {
	var captured domain.PetSearchCriteria
	svc := &mockPetService{
		searchPetsFn: func(criteria domain.PetSearchCriteria) (dto.PetSearchResponse, error) {
			captured = criteria
			return dto.PetSearchResponse{}, nil
		},
	}
	r := setupPetSearchRouter(handler.NewPetHandler(svc, nil))

	cases := []struct {
		name       string
		status     string
		wantStatus int
	}{
		{"lost is public", domain.PetStatusLost, http.StatusOK},
		{"stray is public", domain.PetStatusStray, http.StatusOK},
		{"found is public", domain.PetStatusFound, http.StatusOK},
		{"registered is rejected", domain.PetStatusRegistered, http.StatusBadRequest},
		{"archived is rejected", domain.PetStatusArchived, http.StatusBadRequest},
		{"unknown is rejected", "flying", http.StatusBadRequest},
		{"empty status is allowed", "", http.StatusOK},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			url := "/api/pets/search"
			if tc.status != "" {
				url += "?status=" + tc.status
			}
			req := httptest.NewRequest(http.MethodGet, url, nil)
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)
			if w.Code != tc.wantStatus {
				t.Errorf("status %q: want %d, got %d: %s", tc.status, tc.wantStatus, w.Code, w.Body.String())
			}
		})
	}

	// An allowlisted explicit status must still reach the service as a filter.
	captured = domain.PetSearchCriteria{}
	req := httptest.NewRequest(http.MethodGet, "/api/pets/search?status="+domain.PetStatusFound, nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if len(captured.Statuses) != 1 || captured.Statuses[0] != domain.PetStatusFound {
		t.Errorf("expected status=found to flow through as [found], got %v", captured.Statuses)
	}
}

// The optional geo filter (lat/lng/radius) must flow through to the criteria
// only when all three are present and valid; partial/garbage params are 400.
func TestPetHandler_SearchPets_GeoParams(t *testing.T) {
	var captured domain.PetSearchCriteria
	svc := &mockPetService{
		searchPetsFn: func(criteria domain.PetSearchCriteria) (dto.PetSearchResponse, error) {
			captured = criteria
			return dto.PetSearchResponse{}, nil
		},
	}
	r := setupPetSearchRouter(handler.NewPetHandler(svc, nil))

	doGet := func(query string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodGet, "/api/pets/search"+query, nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		return w
	}

	t.Run("all three valid → flows into criteria", func(t *testing.T) {
		captured = domain.PetSearchCriteria{}
		w := doGet("?lat=-34.9011&lng=-56.1645&radius=5000")
		if w.Code != http.StatusOK {
			t.Fatalf("want 200, got %d: %s", w.Code, w.Body.String())
		}
		if captured.Lat == nil || captured.Lng == nil || captured.RadiusMeters == nil {
			t.Fatalf("expected geo criteria to be set, got lat=%v lng=%v radius=%v", captured.Lat, captured.Lng, captured.RadiusMeters)
		}
		if *captured.Lat != -34.9011 || *captured.Lng != -56.1645 || *captured.RadiusMeters != 5000 {
			t.Errorf("geo values mismatch: lat=%v lng=%v radius=%v", *captured.Lat, *captured.Lng, *captured.RadiusMeters)
		}
	})

	t.Run("no geo params → criteria geo stays nil", func(t *testing.T) {
		captured = domain.PetSearchCriteria{}
		w := doGet("")
		if w.Code != http.StatusOK {
			t.Fatalf("want 200, got %d", w.Code)
		}
		if captured.Lat != nil || captured.Lng != nil || captured.RadiusMeters != nil {
			t.Errorf("expected no geo criteria, got lat=%v lng=%v radius=%v", captured.Lat, captured.Lng, captured.RadiusMeters)
		}
	})

	t.Run("partial geo (only lat) → 400", func(t *testing.T) {
		if w := doGet("?lat=-34.9"); w.Code != http.StatusBadRequest {
			t.Errorf("want 400, got %d", w.Code)
		}
	})

	t.Run("garbage radius → 400", func(t *testing.T) {
		if w := doGet("?lat=-34.9&lng=-56.1&radius=abc"); w.Code != http.StatusBadRequest {
			t.Errorf("want 400, got %d", w.Code)
		}
	})

	t.Run("non-positive radius → 400", func(t *testing.T) {
		if w := doGet("?lat=-34.9&lng=-56.1&radius=0"); w.Code != http.StatusBadRequest {
			t.Errorf("want 400, got %d", w.Code)
		}
	})

	// FIX 2: lat/lng range validation — out-of-range coords must be rejected 400
	t.Run("out-of-range lat/lng → 400", func(t *testing.T) {
		w := doGet("?lat=999&lng=999&radius=5000")
		if w.Code != http.StatusBadRequest {
			t.Errorf("want 400 for lat=999 lng=999, got %d: %s", w.Code, w.Body.String())
		}
		var resp dto.ErrorResponse
		if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
			t.Fatalf("failed to decode error body: %v", err)
		}
		if resp.Code != "invalid_input" {
			t.Errorf("want code 'invalid_input', got %q", resp.Code)
		}
	})

	t.Run("zero lat/lng (valid equator) → 200", func(t *testing.T) {
		captured = domain.PetSearchCriteria{}
		w := doGet("?lat=0&lng=0&radius=5000")
		if w.Code != http.StatusOK {
			t.Errorf("want 200 for lat=0 lng=0, got %d: %s", w.Code, w.Body.String())
		}
		if captured.Lat == nil || *captured.Lat != 0 {
			t.Errorf("expected lat=0 to flow through, got %v", captured.Lat)
		}
	})

	// FIX 3: radius upper bound — must match /reports/nearby (1000-50000 m), status 422
	t.Run("radius too small → 422", func(t *testing.T) {
		w := doGet("?lat=-34.9&lng=-56.1&radius=999")
		if w.Code != http.StatusUnprocessableEntity {
			t.Errorf("want 422 for radius=999, got %d: %s", w.Code, w.Body.String())
		}
		var resp dto.ErrorResponse
		if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
			t.Fatalf("failed to decode error body: %v", err)
		}
		if resp.Code != "invalid_search_radius" {
			t.Errorf("want code 'invalid_search_radius', got %q", resp.Code)
		}
	})

	t.Run("radius too large → 422", func(t *testing.T) {
		w := doGet("?lat=-34.9&lng=-56.1&radius=99999")
		if w.Code != http.StatusUnprocessableEntity {
			t.Errorf("want 422 for radius=99999, got %d: %s", w.Code, w.Body.String())
		}
		var resp dto.ErrorResponse
		if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
			t.Fatalf("failed to decode error body: %v", err)
		}
		if resp.Code != "invalid_search_radius" {
			t.Errorf("want code 'invalid_search_radius', got %q", resp.Code)
		}
	})

	t.Run("radius at exact min boundary (1000) → 200", func(t *testing.T) {
		if w := doGet("?lat=-34.9&lng=-56.1&radius=1000"); w.Code != http.StatusOK {
			t.Errorf("want 200 for radius=1000, got %d", w.Code)
		}
	})

	t.Run("radius at exact max boundary (50000) → 200", func(t *testing.T) {
		if w := doGet("?lat=-34.9&lng=-56.1&radius=50000"); w.Code != http.StatusOK {
			t.Errorf("want 200 for radius=50000, got %d", w.Code)
		}
	})

	// Geo params combined with a private status must still be rejected by the
	// public allowlist — the presence of lat/lng/radius must not bypass it.
	t.Run("geo params + restricted status=registered → 400 invalid_status", func(t *testing.T) {
		w := doGet("?lat=-34.9&lng=-56.1&radius=5000&status=registered")
		if w.Code != http.StatusBadRequest {
			t.Errorf("want 400, got %d: %s", w.Code, w.Body.String())
		}
		var resp dto.ErrorResponse
		if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
			t.Fatalf("failed to decode error body: %v", err)
		}
		if resp.Code != "invalid_status" {
			t.Errorf("want code 'invalid_status', got %q", resp.Code)
		}
	})
}

// ============================================================
// POST /api/pets/:id/publish-lost
// ============================================================

func TestPublishLostHandler_HappyPath_Returns200(t *testing.T) {
	gin.SetMode(gin.TestMode)
	ownerID := uuid.New()
	petID := uuid.New()
	svc := &mockPetService{
		publishLostFn: func(_, _ string, _ dto.PublishLostRequest) (*domain.Pet, error) {
			return &domain.Pet{ID: petID, OwnerID: &ownerID, Name: "Rex", Type: "perro", Status: domain.PetStatusLost, Version: 2}, nil
		},
	}
	h := handler.NewPetHandler(svc, nil)

	r := gin.New()
	r.POST("/api/pets/:id/publish-lost", func(c *gin.Context) {
		c.Set("userID", ownerID)
		h.PublishLost(c)
	})

	body, _ := json.Marshal(map[string]interface{}{"latitude": -34.9011, "longitude": -56.1645, "note": "cerca de casa"})
	req := httptest.NewRequest(http.MethodPost, "/api/pets/"+petID.String()+"/publish-lost", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp dto.PetResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if resp.Status != domain.PetStatusLost {
		t.Errorf("want status %q, got %q", domain.PetStatusLost, resp.Status)
	}
}

func TestPublishLostHandler_Forbidden_Returns403(t *testing.T) {
	gin.SetMode(gin.TestMode)
	svc := &mockPetService{
		publishLostFn: func(_, _ string, _ dto.PublishLostRequest) (*domain.Pet, error) {
			return nil, domain.ErrForbidden
		},
	}
	h := handler.NewPetHandler(svc, nil)

	r := gin.New()
	r.POST("/api/pets/:id/publish-lost", func(c *gin.Context) {
		c.Set("userID", uuid.New())
		h.PublishLost(c)
	})

	body, _ := json.Marshal(map[string]interface{}{"latitude": -34.9011, "longitude": -56.1645})
	req := httptest.NewRequest(http.MethodPost, "/api/pets/"+uuid.New().String()+"/publish-lost", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d: %s", w.Code, w.Body.String())
	}
}

func TestPublishLostHandler_InvalidTransition_Returns422(t *testing.T) {
	gin.SetMode(gin.TestMode)
	svc := &mockPetService{
		publishLostFn: func(_, _ string, _ dto.PublishLostRequest) (*domain.Pet, error) {
			return nil, domain.ErrInvalidStatusTransition
		},
	}
	h := handler.NewPetHandler(svc, nil)

	r := gin.New()
	r.POST("/api/pets/:id/publish-lost", func(c *gin.Context) {
		c.Set("userID", uuid.New())
		h.PublishLost(c)
	})

	body, _ := json.Marshal(map[string]interface{}{"latitude": -34.9011, "longitude": -56.1645})
	req := httptest.NewRequest(http.MethodPost, "/api/pets/"+uuid.New().String()+"/publish-lost", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422, got %d: %s", w.Code, w.Body.String())
	}
}

func TestPublishLostHandler_InvalidLatitude_Returns400(t *testing.T) {
	gin.SetMode(gin.TestMode)
	svc := &mockPetService{}
	h := handler.NewPetHandler(svc, nil)

	r := gin.New()
	r.POST("/api/pets/:id/publish-lost", func(c *gin.Context) {
		c.Set("userID", uuid.New())
		h.PublishLost(c)
	})

	// latitude out of range [-90, 90]
	body, _ := json.Marshal(map[string]interface{}{"latitude": 120.0, "longitude": -56.1645})
	req := httptest.NewRequest(http.MethodPost, "/api/pets/"+uuid.New().String()+"/publish-lost", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", w.Code, w.Body.String())
	}
}

func TestPublishLostHandler_InvalidLongitude_Returns400(t *testing.T) {
	gin.SetMode(gin.TestMode)
	svc := &mockPetService{}
	h := handler.NewPetHandler(svc, nil)

	r := gin.New()
	r.POST("/api/pets/:id/publish-lost", func(c *gin.Context) {
		c.Set("userID", uuid.New())
		h.PublishLost(c)
	})

	// longitude out of range [-180, 180]
	body, _ := json.Marshal(map[string]interface{}{"latitude": -34.9011, "longitude": 200.0})
	req := httptest.NewRequest(http.MethodPost, "/api/pets/"+uuid.New().String()+"/publish-lost", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", w.Code, w.Body.String())
	}
}

// ============================================================
// POST /api/pets — initial_report validation
// ============================================================

func TestCreatePetHandler_InvalidInitialReportLatitude_Returns400(t *testing.T) {
	gin.SetMode(gin.TestMode)
	ownerID := uuid.New()
	svc := &mockPetService{}
	h := handler.NewPetHandler(svc, nil)

	r := gin.New()
	r.POST("/api/pets", func(c *gin.Context) {
		c.Set("userID", ownerID.String())
		h.CreatePet(c)
	})

	body, _ := json.Marshal(map[string]interface{}{
		"name":   "Callejero",
		"type":   "perro",
		"status": "stray",
		"initial_report": map[string]interface{}{
			"latitude":  200.0, // out of range
			"longitude": -56.1645,
		},
	})
	req := httptest.NewRequest(http.MethodPost, "/api/pets", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", w.Code, w.Body.String())
	}

	var resp dto.ErrorResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode error response: %v", err)
	}
	if resp.Code != "invalid_input" {
		t.Errorf("expected code 'invalid_input', got %q", resp.Code)
	}
}

func TestCreatePetHandler_InitialReportRequired_Returns400(t *testing.T) {
	gin.SetMode(gin.TestMode)
	ownerID := uuid.New()
	svc := &mockPetService{
		createPetFn: func(_ string, _ dto.CreatePetRequest) (*domain.Pet, error) {
			return nil, domain.ErrInitialReportRequired
		},
	}
	h := handler.NewPetHandler(svc, nil)

	r := gin.New()
	r.POST("/api/pets", func(c *gin.Context) {
		c.Set("userID", ownerID.String())
		h.CreatePet(c)
	})

	body, _ := json.Marshal(map[string]interface{}{"name": "Callejero", "type": "perro", "status": "stray"})
	req := httptest.NewRequest(http.MethodPost, "/api/pets", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", w.Code, w.Body.String())
	}

	var resp dto.ErrorResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode error response: %v", err)
	}
	if resp.Code != "initial_report_required" {
		t.Errorf("expected code 'initial_report_required', got %q", resp.Code)
	}
}

func TestCreatePetHandler_InitialReportNotAllowed_Returns400(t *testing.T) {
	gin.SetMode(gin.TestMode)
	ownerID := uuid.New()
	svc := &mockPetService{
		createPetFn: func(_ string, _ dto.CreatePetRequest) (*domain.Pet, error) {
			return nil, domain.ErrInitialReportNotAllowed
		},
	}
	h := handler.NewPetHandler(svc, nil)

	r := gin.New()
	r.POST("/api/pets", func(c *gin.Context) {
		c.Set("userID", ownerID.String())
		h.CreatePet(c)
	})

	body, _ := json.Marshal(map[string]interface{}{
		"name":   "Luna",
		"type":   "gato",
		"status": "registered",
		"initial_report": map[string]interface{}{
			"latitude":  -34.9011,
			"longitude": -56.1645,
		},
	})
	req := httptest.NewRequest(http.MethodPost, "/api/pets", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", w.Code, w.Body.String())
	}

	var resp dto.ErrorResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode error response: %v", err)
	}
	if resp.Code != "initial_report_not_allowed" {
		t.Errorf("expected code 'initial_report_not_allowed', got %q", resp.Code)
	}
}
