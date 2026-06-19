// Package service_test — uses EmbeddingService.SetHTTPClientAndEndpoint to
// inject a mock HTTP server so tests never reach the real HuggingFace API.
package service_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/event"
	"lost-pets/internal/repository"
	"lost-pets/internal/service"
)

// ============================================================
// Mock: PetEmbeddingRepository
// ============================================================

type mockEmbeddingRepo struct {
	upsertFn        func(ctx context.Context, emb *domain.PetEmbedding) error
	findSimilarFn   func(ctx context.Context, queryVec []float32, limit int) ([]domain.ImageSearchResult, error)
	deleteByPetIDFn func(ctx context.Context, petID uuid.UUID) error

	upsertCalls        []*domain.PetEmbedding
	deleteByPetIDCalls []uuid.UUID
}

func (m *mockEmbeddingRepo) Upsert(ctx context.Context, emb *domain.PetEmbedding) error {
	m.upsertCalls = append(m.upsertCalls, emb)
	if m.upsertFn != nil {
		return m.upsertFn(ctx, emb)
	}
	return nil
}

func (m *mockEmbeddingRepo) FindSimilar(ctx context.Context, queryVec []float32, limit int) ([]domain.ImageSearchResult, error) {
	if m.findSimilarFn != nil {
		return m.findSimilarFn(ctx, queryVec, limit)
	}
	return []domain.ImageSearchResult{}, nil
}

func (m *mockEmbeddingRepo) DeleteByPetID(ctx context.Context, petID uuid.UUID) error {
	m.deleteByPetIDCalls = append(m.deleteByPetIDCalls, petID)
	if m.deleteByPetIDFn != nil {
		return m.deleteByPetIDFn(ctx, petID)
	}
	return nil
}

var _ repository.PetEmbeddingRepository = (*mockEmbeddingRepo)(nil)

// ============================================================
// Mock: PetRepository (embedding tests — minimal)
// ============================================================

type mockPetRepoForEmbedding struct {
	findByIDFn func(id string) (*domain.Pet, error)
}

func (m *mockPetRepoForEmbedding) FindByID(id string) (*domain.Pet, error) {
	if m.findByIDFn != nil {
		return m.findByIDFn(id)
	}
	return nil, domain.ErrPetNotFound
}

func (m *mockPetRepoForEmbedding) Create(_ *domain.Pet) error                         { return nil }
func (m *mockPetRepoForEmbedding) FindByOwnerID(_ string) ([]domain.Pet, error)       { return nil, nil }
func (m *mockPetRepoForEmbedding) FindByReporterID(_ string) ([]domain.Pet, error)    { return nil, nil }
func (m *mockPetRepoForEmbedding) Update(_ *domain.Pet) error                         { return nil }
func (m *mockPetRepoForEmbedding) UpdateStatus(_ string, _ string) error              { return nil }
func (m *mockPetRepoForEmbedding) Delete(_ string) error                              { return nil }
func (m *mockPetRepoForEmbedding) Search(_ domain.PetSearchCriteria) ([]domain.Pet, int64, error) {
	return nil, 0, nil
}

var _ repository.PetRepository = (*mockPetRepoForEmbedding)(nil)

// ============================================================
// Mock: PhotoRepository (embedding tests — minimal)
// ============================================================

type mockPhotoRepoForEmbedding struct {
	findByPetIDFn func(petID string) ([]domain.Photo, error)
}

func (m *mockPhotoRepoForEmbedding) FindByPetID(petID string) ([]domain.Photo, error) {
	if m.findByPetIDFn != nil {
		return m.findByPetIDFn(petID)
	}
	return []domain.Photo{}, nil
}

func (m *mockPhotoRepoForEmbedding) Create(_ *domain.Photo) error             { return nil }
func (m *mockPhotoRepoForEmbedding) FindByID(_ string) (*domain.Photo, error) { return &domain.Photo{}, nil }
func (m *mockPhotoRepoForEmbedding) HasPrimaryPhoto(_ string) (bool, error)   { return false, nil }
func (m *mockPhotoRepoForEmbedding) UnsetPrimaryPhotos(_ string) error        { return nil }
func (m *mockPhotoRepoForEmbedding) CountByPetID(_ string) (int64, error)     { return 0, nil }
func (m *mockPhotoRepoForEmbedding) DeleteByPetID(_ string) error             { return nil }
func (m *mockPhotoRepoForEmbedding) DeleteByID(_ string) error                { return nil }

var _ repository.PhotoRepository = (*mockPhotoRepoForEmbedding)(nil)

// ============================================================
// Helpers
// ============================================================

// make512Floats returns 512 float32 values (all 0.1).
func make512Floats() []float32 {
	v := make([]float32, 512)
	for i := range v {
		v[i] = 0.1
	}
	return v
}

// newJinaTestServer creates an httptest.Server simulating the Jina embeddings
// endpoint. statusCode != 200 simulates an API error. On success it asserts the
// request matches the empirically verified jina-clip-v2 contract, then returns a
// Jina-shaped response body.
func newJinaTestServer(t *testing.T, statusCode int) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if statusCode != http.StatusOK {
			w.WriteHeader(statusCode)
			fmt.Fprintf(w, `{"error":"service unavailable"}`)
			return
		}
		assertJinaRequest(t, r)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(jinaResponseBody())
	}))
}

// assertJinaRequest verifies the outgoing request matches the verified
// jina-clip-v2 contract: model, 512 dimensions, a non-empty image input, and an
// Authorization header.
func assertJinaRequest(t *testing.T, r *http.Request) {
	t.Helper()
	var req struct {
		Model      string `json:"model"`
		Dimensions int    `json:"dimensions"`
		Input      []struct {
			Image string `json:"image"`
		} `json:"input"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		t.Errorf("could not decode Jina request body: %v", err)
		return
	}
	if req.Model != "jina-clip-v2" {
		t.Errorf("Jina request model = %q, want jina-clip-v2", req.Model)
	}
	if req.Dimensions != 512 {
		t.Errorf("Jina request dimensions = %d, want 512", req.Dimensions)
	}
	if len(req.Input) != 1 || req.Input[0].Image == "" {
		t.Errorf("Jina request input = %+v, want exactly one non-empty image", req.Input)
	}
	if r.Header.Get("Authorization") == "" {
		t.Errorf("Jina request missing Authorization header")
	}
}

// jinaResponseBody returns a Jina-shaped embeddings response with one 512-dim vector.
func jinaResponseBody() map[string]any {
	return map[string]any{
		"data": []map[string]any{{"embedding": make512Floats()}},
	}
}

// newTestEmbeddingService builds an EmbeddingService and points its HTTP
// client + endpoint at the provided test server via SetHTTPClientAndEndpoint.
func newTestEmbeddingService(
	embRepo repository.PetEmbeddingRepository,
	petRepo repository.PetRepository,
	photoRepo repository.PhotoRepository,
	srv *httptest.Server,
) *service.EmbeddingService {
	svc := service.NewEmbeddingService(embRepo, petRepo, photoRepo, "test-api-key")
	svc.SetHTTPClientAndEndpoint(srv.Client(), srv.URL)
	return svc
}

// ============================================================
// HandlePhotoUploaded tests
// ============================================================

func TestEmbeddingService_HandlePhotoUploaded_LostPet_GeneratesAndUpserts(t *testing.T) {
	petID := uuid.New()
	photoID := uuid.New()

	hfSrv := newJinaTestServer(t, http.StatusOK)
	defer hfSrv.Close()

	embRepo := &mockEmbeddingRepo{}
	petRepo := &mockPetRepoForEmbedding{
		findByIDFn: func(_ string) (*domain.Pet, error) {
			return &domain.Pet{ID: petID, Status: "lost"}, nil
		},
	}
	photoRepo := &mockPhotoRepoForEmbedding{}

	svc := newTestEmbeddingService(embRepo, petRepo, photoRepo, hfSrv)

	ev := event.PhotoUploadedEvent{
		PetID:     petID,
		PhotoID:   photoID,
		SecureURL: "https://cdn.example.com/photo.jpg",
	}
	svc.HandlePhotoUploaded(ev)

	if len(embRepo.upsertCalls) != 1 {
		t.Fatalf("expected 1 upsert call, got %d", len(embRepo.upsertCalls))
	}
	emb := embRepo.upsertCalls[0]
	if emb.PetID != petID {
		t.Errorf("upsert PetID mismatch: got %v, want %v", emb.PetID, petID)
	}
	if emb.PhotoID != photoID {
		t.Errorf("upsert PhotoID mismatch: got %v, want %v", emb.PhotoID, photoID)
	}
}

func TestEmbeddingService_HandlePhotoUploaded_NonLostPet_SkipsSilently(t *testing.T) {
	petID := uuid.New()

	hfSrv := newJinaTestServer(t, http.StatusOK)
	defer hfSrv.Close()

	embRepo := &mockEmbeddingRepo{}
	petRepo := &mockPetRepoForEmbedding{
		findByIDFn: func(_ string) (*domain.Pet, error) {
			// Status "registered" — not "lost"
			return &domain.Pet{ID: petID, Status: "registered"}, nil
		},
	}
	photoRepo := &mockPhotoRepoForEmbedding{}

	svc := newTestEmbeddingService(embRepo, petRepo, photoRepo, hfSrv)

	svc.HandlePhotoUploaded(event.PhotoUploadedEvent{
		PetID:     petID,
		PhotoID:   uuid.New(),
		SecureURL: "https://cdn.example.com/photo.jpg",
	})

	if len(embRepo.upsertCalls) != 0 {
		t.Errorf("expected 0 upsert calls for non-lost pet, got %d", len(embRepo.upsertCalls))
	}
}

func TestEmbeddingService_HandlePhotoUploaded_StrayPet_GeneratesAndUpserts(t *testing.T) {
	petID := uuid.New()
	photoID := uuid.New()

	hfSrv := newJinaTestServer(t, http.StatusOK)
	defer hfSrv.Close()

	embRepo := &mockEmbeddingRepo{}
	petRepo := &mockPetRepoForEmbedding{
		findByIDFn: func(_ string) (*domain.Pet, error) {
			return &domain.Pet{ID: petID, Status: domain.PetStatusStray}, nil
		},
	}
	photoRepo := &mockPhotoRepoForEmbedding{}

	svc := newTestEmbeddingService(embRepo, petRepo, photoRepo, hfSrv)
	svc.HandlePhotoUploaded(event.PhotoUploadedEvent{
		PetID:     petID,
		PhotoID:   photoID,
		SecureURL: "https://cdn.example.com/stray.jpg",
	})

	if len(embRepo.upsertCalls) != 1 {
		t.Errorf("expected 1 upsert call for stray pet, got %d", len(embRepo.upsertCalls))
	}
}

func TestEmbeddingService_HandlePhotoUploaded_HFError_NoUpsert(t *testing.T) {
	petID := uuid.New()

	hfSrv := newJinaTestServer(t, http.StatusServiceUnavailable)
	defer hfSrv.Close()

	embRepo := &mockEmbeddingRepo{}
	petRepo := &mockPetRepoForEmbedding{
		findByIDFn: func(_ string) (*domain.Pet, error) {
			return &domain.Pet{ID: petID, Status: "lost"}, nil
		},
	}
	photoRepo := &mockPhotoRepoForEmbedding{}

	svc := newTestEmbeddingService(embRepo, petRepo, photoRepo, hfSrv)

	svc.HandlePhotoUploaded(event.PhotoUploadedEvent{
		PetID:     petID,
		PhotoID:   uuid.New(),
		SecureURL: "https://cdn.example.com/photo.jpg",
	})

	if len(embRepo.upsertCalls) != 0 {
		t.Errorf("expected 0 upsert calls when HF fails, got %d", len(embRepo.upsertCalls))
	}
}

// ============================================================
// HandlePetLost tests
// ============================================================

func TestEmbeddingService_HandlePetLost_FetchesPhotosAndUpsertsEach(t *testing.T) {
	petID := uuid.New()
	photo1 := domain.Photo{ID: uuid.New(), PetID: petID, URL: "https://cdn.example.com/p1.jpg"}
	photo2 := domain.Photo{ID: uuid.New(), PetID: petID, URL: "https://cdn.example.com/p2.jpg"}

	hfSrv := newJinaTestServer(t, http.StatusOK)
	defer hfSrv.Close()

	embRepo := &mockEmbeddingRepo{}
	petRepo := &mockPetRepoForEmbedding{}
	photoRepo := &mockPhotoRepoForEmbedding{
		findByPetIDFn: func(_ string) ([]domain.Photo, error) {
			return []domain.Photo{photo1, photo2}, nil
		},
	}

	svc := newTestEmbeddingService(embRepo, petRepo, photoRepo, hfSrv)
	svc.HandlePetLost(event.PetLostEvent{PetID: petID})

	if len(embRepo.upsertCalls) != 2 {
		t.Errorf("expected 2 upsert calls (one per photo), got %d", len(embRepo.upsertCalls))
	}
}

func TestEmbeddingService_HandlePetLost_OnePhotoFails_ContinuesWithRest(t *testing.T) {
	petID := uuid.New()
	photo1 := domain.Photo{ID: uuid.New(), PetID: petID, URL: "https://cdn.example.com/p1.jpg"}
	photo2 := domain.Photo{ID: uuid.New(), PetID: petID, URL: "https://cdn.example.com/p2.jpg"}

	callCount := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		callCount++
		if callCount == 1 {
			w.WriteHeader(http.StatusServiceUnavailable)
			fmt.Fprintf(w, `{"error":"overloaded"}`)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(jinaResponseBody())
	}))
	defer srv.Close()

	embRepo := &mockEmbeddingRepo{}
	petRepo := &mockPetRepoForEmbedding{}
	photoRepo := &mockPhotoRepoForEmbedding{
		findByPetIDFn: func(_ string) ([]domain.Photo, error) {
			return []domain.Photo{photo1, photo2}, nil
		},
	}

	svc := newTestEmbeddingService(embRepo, petRepo, photoRepo, srv)
	svc.HandlePetLost(event.PetLostEvent{PetID: petID})

	// First photo's HF call failed — only the second should be upserted.
	if len(embRepo.upsertCalls) != 1 {
		t.Errorf("expected 1 upsert call (continuing after partial failure), got %d", len(embRepo.upsertCalls))
	}
}

// ============================================================
// HandlePetStray tests
// ============================================================

func TestEmbeddingService_HandlePetStray_FetchesPhotosAndUpsertsEach(t *testing.T) {
	petID := uuid.New()
	photo1 := domain.Photo{ID: uuid.New(), PetID: petID, URL: "https://cdn.example.com/p1.jpg"}
	photo2 := domain.Photo{ID: uuid.New(), PetID: petID, URL: "https://cdn.example.com/p2.jpg"}

	hfSrv := newJinaTestServer(t, http.StatusOK)
	defer hfSrv.Close()

	embRepo := &mockEmbeddingRepo{}
	petRepo := &mockPetRepoForEmbedding{}
	photoRepo := &mockPhotoRepoForEmbedding{
		findByPetIDFn: func(_ string) ([]domain.Photo, error) {
			return []domain.Photo{photo1, photo2}, nil
		},
	}

	svc := newTestEmbeddingService(embRepo, petRepo, photoRepo, hfSrv)
	svc.HandlePetStray(event.PetStrayEvent{PetID: petID})

	if len(embRepo.upsertCalls) != 2 {
		t.Errorf("expected 2 upsert calls (one per photo), got %d", len(embRepo.upsertCalls))
	}
}

func TestEmbeddingService_HandlePetStray_OnePhotoFails_ContinuesWithRest(t *testing.T) {
	petID := uuid.New()
	photo1 := domain.Photo{ID: uuid.New(), PetID: petID, URL: "https://cdn.example.com/p1.jpg"}
	photo2 := domain.Photo{ID: uuid.New(), PetID: petID, URL: "https://cdn.example.com/p2.jpg"}

	callCount := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		callCount++
		if callCount == 1 {
			w.WriteHeader(http.StatusServiceUnavailable)
			fmt.Fprintf(w, `{"error":"overloaded"}`)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(jinaResponseBody())
	}))
	defer srv.Close()

	embRepo := &mockEmbeddingRepo{}
	petRepo := &mockPetRepoForEmbedding{}
	photoRepo := &mockPhotoRepoForEmbedding{
		findByPetIDFn: func(_ string) ([]domain.Photo, error) {
			return []domain.Photo{photo1, photo2}, nil
		},
	}

	svc := newTestEmbeddingService(embRepo, petRepo, photoRepo, srv)
	svc.HandlePetStray(event.PetStrayEvent{PetID: petID})

	// First photo's HF call failed — only the second should be upserted.
	if len(embRepo.upsertCalls) != 1 {
		t.Errorf("expected 1 upsert call (continuing after partial failure), got %d", len(embRepo.upsertCalls))
	}
}

func TestEmbeddingService_RegisterListeners_PetStrayEvent_BackfillsPhotos(t *testing.T) {
	petID := uuid.New()
	photo := domain.Photo{ID: uuid.New(), PetID: petID, URL: "https://cdn.example.com/p1.jpg"}

	hfSrv := newJinaTestServer(t, http.StatusOK)
	defer hfSrv.Close()

	embRepo := &mockEmbeddingRepo{}
	photoRepo := &mockPhotoRepoForEmbedding{
		findByPetIDFn: func(_ string) ([]domain.Photo, error) {
			return []domain.Photo{photo}, nil
		},
	}

	svc := newTestEmbeddingService(embRepo, &mockPetRepoForEmbedding{}, photoRepo, hfSrv)

	bus := event.NewEventBus()
	svc.RegisterListeners(bus)

	bus.Publish("pet.stray", event.PetStrayEvent{PetID: petID})

	// EventBus fires handlers in goroutines — wait up to 500ms.
	deadline := time.After(500 * time.Millisecond)
	for {
		select {
		case <-deadline:
			t.Fatal("timeout: embedding was not upserted after pet.stray event")
		default:
			if len(embRepo.upsertCalls) > 0 {
				if embRepo.upsertCalls[0].PetID != petID {
					t.Errorf("upsert PetID got %v, want %v", embRepo.upsertCalls[0].PetID, petID)
				}
				return
			}
			time.Sleep(10 * time.Millisecond)
		}
	}
}

// ============================================================
// HandlePetFound tests
// ============================================================

func TestEmbeddingService_HandlePetFound_DeletesByPetID(t *testing.T) {
	petID := uuid.New()

	hfSrv := newJinaTestServer(t, http.StatusOK)
	defer hfSrv.Close()

	embRepo := &mockEmbeddingRepo{}
	svc := newTestEmbeddingService(embRepo, &mockPetRepoForEmbedding{}, &mockPhotoRepoForEmbedding{}, hfSrv)

	svc.HandlePetFound(event.PetFoundEvent{PetID: petID, OwnerID: uuid.New(), PetName: "Luna"})

	if len(embRepo.deleteByPetIDCalls) != 1 {
		t.Fatalf("expected 1 DeleteByPetID call, got %d", len(embRepo.deleteByPetIDCalls))
	}
	if embRepo.deleteByPetIDCalls[0] != petID {
		t.Errorf("DeleteByPetID got %v, want %v", embRepo.deleteByPetIDCalls[0], petID)
	}
}

// ============================================================
// SearchSimilar tests
// ============================================================

func TestEmbeddingService_SearchSimilar_HappyPath(t *testing.T) {
	petID := uuid.New()
	ownerID := uuid.New()

	hfSrv := newJinaTestServer(t, http.StatusOK)
	defer hfSrv.Close()

	expectedResult := domain.ImageSearchResult{
		PetID:      petID,
		OwnerID:    ownerID,
		PetName:    "Rex",
		PetType:    "perro",
		PrimaryURL: "https://cdn.example.com/rex.jpg",
		Similarity: 0.95,
	}

	embRepo := &mockEmbeddingRepo{
		findSimilarFn: func(_ context.Context, _ []float32, _ int) ([]domain.ImageSearchResult, error) {
			return []domain.ImageSearchResult{expectedResult}, nil
		},
	}

	svc := newTestEmbeddingService(embRepo, &mockPetRepoForEmbedding{}, &mockPhotoRepoForEmbedding{}, hfSrv)

	results, err := svc.SearchSimilar(context.Background(), []byte("fake-image-data"), 10)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(results) != 1 {
		t.Fatalf("expected 1 result, got %d", len(results))
	}
	if results[0].PetName != "Rex" {
		t.Errorf("unexpected PetName: got %q, want %q", results[0].PetName, "Rex")
	}
	if results[0].Similarity != 0.95 {
		t.Errorf("unexpected Similarity: got %v, want 0.95", results[0].Similarity)
	}
}

func TestEmbeddingService_SearchSimilar_HFError_ReturnsError(t *testing.T) {
	hfSrv := newJinaTestServer(t, http.StatusServiceUnavailable)
	defer hfSrv.Close()

	embRepo := &mockEmbeddingRepo{}
	svc := newTestEmbeddingService(embRepo, &mockPetRepoForEmbedding{}, &mockPhotoRepoForEmbedding{}, hfSrv)

	_, err := svc.SearchSimilar(context.Background(), []byte("fake-image-data"), 10)
	if err == nil {
		t.Fatal("expected error when HF is down, got nil")
	}
}

// ============================================================
// SetEndpoint test
// ============================================================

func TestEmbeddingService_SetEndpoint_OverridesEndpoint(t *testing.T) {
	hfSrv := newJinaTestServer(t, http.StatusOK)
	defer hfSrv.Close()

	embRepo := &mockEmbeddingRepo{}
	svc := service.NewEmbeddingService(embRepo, &mockPetRepoForEmbedding{}, &mockPhotoRepoForEmbedding{}, "test-api-key")
	svc.SetEndpoint(hfSrv.URL)
	svc.SetHTTPClientAndEndpoint(hfSrv.Client(), hfSrv.URL)

	vector, err := svc.GenerateEmbedding(context.Background(), []byte("fake-image-data"))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(vector) != 512 {
		t.Errorf("expected 512-dim vector, got %d", len(vector))
	}
}

// ============================================================
// RegisterListeners integration smoke test
// ============================================================

func TestEmbeddingService_RegisterListeners_PetFoundEvent_CallsDeleteByPetID(t *testing.T) {
	petID := uuid.New()

	hfSrv := newJinaTestServer(t, http.StatusOK)
	defer hfSrv.Close()

	embRepo := &mockEmbeddingRepo{}
	svc := newTestEmbeddingService(embRepo, &mockPetRepoForEmbedding{}, &mockPhotoRepoForEmbedding{}, hfSrv)

	bus := event.NewEventBus()
	svc.RegisterListeners(bus)

	bus.Publish("pet.found", event.PetFoundEvent{
		PetID:   petID,
		OwnerID: uuid.New(),
		PetName: "Lola",
	})

	// EventBus fires handlers in goroutines — wait up to 500ms.
	deadline := time.After(500 * time.Millisecond)
	for {
		select {
		case <-deadline:
			t.Fatal("timeout: DeleteByPetID was not called after pet.found event")
		default:
			if len(embRepo.deleteByPetIDCalls) > 0 {
				if embRepo.deleteByPetIDCalls[0] != petID {
					t.Errorf("DeleteByPetID got %v, want %v", embRepo.deleteByPetIDCalls[0], petID)
				}
				return
			}
			time.Sleep(10 * time.Millisecond)
		}
	}
}
