package tests

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/dto"
	"lost-pets/internal/service"
)

// ============================================================
// Mock: SuccessStoryRepository
// ============================================================

type mockSuccessStoryRepository struct {
	createFn        func(ctx context.Context, story *domain.SuccessStory) error
	getByIDFn       func(ctx context.Context, id uuid.UUID) (*domain.SuccessStory, error)
	getByPetIDFn    func(ctx context.Context, petID uuid.UUID) (*domain.SuccessStory, error)
	getAllFn        func(ctx context.Context, featured *bool, limit, offset int) ([]domain.SuccessStory, error)
	addLikeFn       func(ctx context.Context, storyID, userID uuid.UUID) (bool, int, error)
	removeLikeFn    func(ctx context.Context, storyID, userID uuid.UUID) (bool, int, error)
	likedStoryIDsFn func(ctx context.Context, userID uuid.UUID, storyIDs []uuid.UUID) (map[uuid.UUID]bool, error)
	setFeaturedFn   func(ctx context.Context, id uuid.UUID, featured bool, featuredBy uuid.UUID) error
	deleteFn        func(ctx context.Context, id uuid.UUID) error
}

func (m *mockSuccessStoryRepository) Create(ctx context.Context, story *domain.SuccessStory) error {
	if m.createFn != nil {
		return m.createFn(ctx, story)
	}
	story.ID = uuid.New()
	return nil
}

func (m *mockSuccessStoryRepository) GetByID(ctx context.Context, id uuid.UUID) (*domain.SuccessStory, error) {
	if m.getByIDFn != nil {
		return m.getByIDFn(ctx, id)
	}
	return &domain.SuccessStory{ID: id}, nil
}

func (m *mockSuccessStoryRepository) GetByPetID(ctx context.Context, petID uuid.UUID) (*domain.SuccessStory, error) {
	if m.getByPetIDFn != nil {
		return m.getByPetIDFn(ctx, petID)
	}
	return nil, nil
}

func (m *mockSuccessStoryRepository) GetAll(ctx context.Context, featured *bool, limit, offset int) ([]domain.SuccessStory, error) {
	if m.getAllFn != nil {
		return m.getAllFn(ctx, featured, limit, offset)
	}
	return []domain.SuccessStory{}, nil
}

func (m *mockSuccessStoryRepository) CountAll(ctx context.Context, featured *bool) (int64, error) {
	return 0, nil
}

func (m *mockSuccessStoryRepository) AddLike(ctx context.Context, storyID, userID uuid.UUID) (bool, int, error) {
	if m.addLikeFn != nil {
		return m.addLikeFn(ctx, storyID, userID)
	}
	return true, 1, nil
}

func (m *mockSuccessStoryRepository) RemoveLike(ctx context.Context, storyID, userID uuid.UUID) (bool, int, error) {
	if m.removeLikeFn != nil {
		return m.removeLikeFn(ctx, storyID, userID)
	}
	return true, 0, nil
}

func (m *mockSuccessStoryRepository) LikedStoryIDs(ctx context.Context, userID uuid.UUID, storyIDs []uuid.UUID) (map[uuid.UUID]bool, error) {
	if m.likedStoryIDsFn != nil {
		return m.likedStoryIDsFn(ctx, userID, storyIDs)
	}
	return map[uuid.UUID]bool{}, nil
}

func (m *mockSuccessStoryRepository) SetFeatured(ctx context.Context, id uuid.UUID, featured bool, featuredBy uuid.UUID) error {
	if m.setFeaturedFn != nil {
		return m.setFeaturedFn(ctx, id, featured, featuredBy)
	}
	return nil
}

func (m *mockSuccessStoryRepository) Delete(ctx context.Context, id uuid.UUID) error {
	if m.deleteFn != nil {
		return m.deleteFn(ctx, id)
	}
	return nil
}

// ============================================================
// Mock: PetRepository (for success story service — uses Style B interface)
// ============================================================

type mockPetRepoForStory struct {
	findByIDFn func(id string) (*domain.Pet, error)
}

func (m *mockPetRepoForStory) Create(pet *domain.Pet) error                                   { return nil }
func (m *mockPetRepoForStory) FindByOwnerID(ownerID string) ([]domain.Pet, error)             { return nil, nil }
func (m *mockPetRepoForStory) FindByReporterID(reporterID string) ([]domain.Pet, error) {
	return nil, nil
}
func (m *mockPetRepoForStory) Update(pet *domain.Pet) error                                   { return nil }
func (m *mockPetRepoForStory) UpdateStatus(id string, status string) error                    { return nil }
func (m *mockPetRepoForStory) Delete(id string) error                                         { return nil }
func (m *mockPetRepoForStory) Search(criteria domain.PetSearchCriteria) ([]domain.Pet, int64, error) {
	return nil, 0, nil
}

func (m *mockPetRepoForStory) FindByID(id string) (*domain.Pet, error) {
	if m.findByIDFn != nil {
		return m.findByIDFn(id)
	}
	return nil, domain.ErrPetNotFound
}

// ============================================================
// Helpers
// ============================================================

func newSuccessStoryService(
	storyRepo *mockSuccessStoryRepository,
	petRepo *mockPetRepoForStory,
) service.SuccessStoryService {
	return service.NewSuccessStoryService(storyRepo, petRepo)
}

// ============================================================
// Create tests
// ============================================================

func TestSuccessStoryService_Create(t *testing.T) {
	userID := uuid.New()
	petID := uuid.New()
	storyID := uuid.New()

	foundPet := &domain.Pet{
		ID:      petID,
		OwnerID: ptrUUID(userID),
		Name:    "Max",
		Status:  domain.PetStatusFound,
	}

	activePet := &domain.Pet{
		ID:      petID,
		OwnerID: ptrUUID(userID),
		Name:    "Max",
		Status:  domain.PetStatusRegistered, // not "found"
	}

	tests := []struct {
		name      string
		storyRepo *mockSuccessStoryRepository
		petRepo   *mockPetRepoForStory
		req       dto.CreateStoryRequest
		wantErr   error
	}{
		{
			name: "happy path — story created",
			storyRepo: &mockSuccessStoryRepository{
				createFn: func(_ context.Context, s *domain.SuccessStory) error {
					s.ID = storyID
					return nil
				},
				getByIDFn: func(_ context.Context, id uuid.UUID) (*domain.SuccessStory, error) {
					return &domain.SuccessStory{
						ID:     id,
						PetID:  petID,
						UserID: userID,
						Body:   "We found Max!",
					}, nil
				},
			},
			petRepo: &mockPetRepoForStory{
				findByIDFn: func(_ string) (*domain.Pet, error) {
					return foundPet, nil
				},
			},
			req: dto.CreateStoryRequest{
				PetID: petID,
				Title: "Max Found!",
				Body:  "We found Max!",
			},
			wantErr: nil,
		},
		{
			name:      "pet not found — ErrPetNotFound",
			storyRepo: &mockSuccessStoryRepository{},
			petRepo: &mockPetRepoForStory{
				findByIDFn: func(_ string) (*domain.Pet, error) {
					return nil, domain.ErrPetNotFound
				},
			},
			req: dto.CreateStoryRequest{
				PetID: petID,
				Body:  "Story body",
			},
			wantErr: domain.ErrPetNotFound,
		},
		{
			name:      "pet not in found status — ErrPetNotFoundStatus",
			storyRepo: &mockSuccessStoryRepository{},
			petRepo: &mockPetRepoForStory{
				findByIDFn: func(_ string) (*domain.Pet, error) {
					return activePet, nil // status is "active", not "found"
				},
			},
			req: dto.CreateStoryRequest{
				PetID: petID,
				Body:  "Story body",
			},
			wantErr: domain.ErrPetNotFoundStatus,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			svc := newSuccessStoryService(tc.storyRepo, tc.petRepo)
			story, err := svc.Create(context.Background(), userID, tc.req)

			if tc.wantErr != nil {
				if !errors.Is(err, tc.wantErr) {
					t.Errorf("expected error %v, got %v", tc.wantErr, err)
				}
				if story != nil {
					t.Errorf("expected nil story on error, got %+v", story)
				}
				return
			}

			if err != nil {
				t.Errorf("unexpected error: %v", err)
				return
			}
			if story == nil {
				t.Error("expected story, got nil")
			}
		})
	}
}

// Create authorization: only the user who manages the pet (owner for owned pets,
// reporter for strays) may write its success story — not any authenticated user.

func TestSuccessStoryService_Create_StrayReporterAllowed(t *testing.T) {
	reporterID := uuid.New()
	petID := uuid.New()
	strayFound := &domain.Pet{
		ID:         petID,
		OwnerID:    nil,
		ReporterID: ptrUUID(reporterID),
		Name:       "Callejero",
		Status:     domain.PetStatusFound,
	}
	storyRepo := &mockSuccessStoryRepository{
		createFn: func(_ context.Context, s *domain.SuccessStory) error { s.ID = uuid.New(); return nil },
		getByIDFn: func(_ context.Context, id uuid.UUID) (*domain.SuccessStory, error) {
			return &domain.SuccessStory{ID: id, PetID: petID, UserID: reporterID}, nil
		},
	}
	petRepo := &mockPetRepoForStory{findByIDFn: func(_ string) (*domain.Pet, error) { return strayFound, nil }}
	svc := newSuccessStoryService(storyRepo, petRepo)

	story, err := svc.Create(context.Background(), reporterID, dto.CreateStoryRequest{PetID: petID, Body: "Rescatado!"})
	if err != nil {
		t.Fatalf("stray reporter should be allowed to create a story, got %v", err)
	}
	if story == nil {
		t.Error("expected story, got nil")
	}
}

func TestSuccessStoryService_Create_NonManagerForbidden(t *testing.T) {
	ownerID := uuid.New()
	stranger := uuid.New()
	petID := uuid.New()
	foundPet := &domain.Pet{
		ID:      petID,
		OwnerID: ptrUUID(ownerID),
		Name:    "Max",
		Status:  domain.PetStatusFound,
	}
	petRepo := &mockPetRepoForStory{findByIDFn: func(_ string) (*domain.Pet, error) { return foundPet, nil }}
	svc := newSuccessStoryService(&mockSuccessStoryRepository{}, petRepo)

	story, err := svc.Create(context.Background(), stranger, dto.CreateStoryRequest{PetID: petID, Body: "ajeno"})
	if !errors.Is(err, domain.ErrForbidden) {
		t.Errorf("expected ErrForbidden for a non-manager, got %v", err)
	}
	if story != nil {
		t.Errorf("expected nil story on forbidden, got %+v", story)
	}
}

// ============================================================
// GetAll tests
// ============================================================

func TestSuccessStoryService_GetAll(t *testing.T) {
	stories := []domain.SuccessStory{
		{ID: uuid.New(), Body: "Story 1"},
		{ID: uuid.New(), Body: "Story 2"},
	}

	tests := []struct {
		name      string
		storyRepo *mockSuccessStoryRepository
		wantCount int
		wantErr   error
	}{
		{
			name: "returns list of stories",
			storyRepo: &mockSuccessStoryRepository{
				getAllFn: func(_ context.Context, _ *bool, _, _ int) ([]domain.SuccessStory, error) {
					return stories, nil
				},
			},
			wantCount: 2,
			wantErr:   nil,
		},
		{
			name: "empty list",
			storyRepo: &mockSuccessStoryRepository{
				getAllFn: func(_ context.Context, _ *bool, _, _ int) ([]domain.SuccessStory, error) {
					return []domain.SuccessStory{}, nil
				},
			},
			wantCount: 0,
			wantErr:   nil,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			svc := newSuccessStoryService(tc.storyRepo, &mockPetRepoForStory{})
			result, err := svc.List(context.Background(), nil, 20, 0)

			if tc.wantErr != nil {
				if !errors.Is(err, tc.wantErr) {
					t.Errorf("expected error %v, got %v", tc.wantErr, err)
				}
				return
			}

			if err != nil {
				t.Errorf("unexpected error: %v", err)
				return
			}

			if len(result) != tc.wantCount {
				t.Errorf("expected %d stories, got %d", tc.wantCount, len(result))
			}
		})
	}
}

// ============================================================
// GetByPetID tests
// ============================================================

func TestSuccessStoryService_GetByPetID(t *testing.T) {
	petID := uuid.New()
	story := &domain.SuccessStory{ID: uuid.New(), PetID: petID, Body: "We found Buddy!"}

	tests := []struct {
		name      string
		storyRepo *mockSuccessStoryRepository
		wantNil   bool
		wantErr   error
	}{
		{
			name: "returns story for pet",
			storyRepo: &mockSuccessStoryRepository{
				getByPetIDFn: func(_ context.Context, _ uuid.UUID) (*domain.SuccessStory, error) {
					return story, nil
				},
			},
			wantNil: false,
			wantErr: nil,
		},
		{
			name: "no story for pet — returns nil nil",
			storyRepo: &mockSuccessStoryRepository{
				getByPetIDFn: func(_ context.Context, _ uuid.UUID) (*domain.SuccessStory, error) {
					return nil, nil
				},
			},
			wantNil: true,
			wantErr: nil,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			svc := newSuccessStoryService(tc.storyRepo, &mockPetRepoForStory{})
			result, err := svc.GetByPetID(context.Background(), petID)

			if tc.wantErr != nil {
				if !errors.Is(err, tc.wantErr) {
					t.Errorf("expected error %v, got %v", tc.wantErr, err)
				}
				return
			}

			if err != nil {
				t.Errorf("unexpected error: %v", err)
				return
			}

			if tc.wantNil && result != nil {
				t.Errorf("expected nil result, got %+v", result)
			}
			if !tc.wantNil && result == nil {
				t.Error("expected story, got nil")
			}
		})
	}
}

// ============================================================
// Like tests
// ============================================================

func TestSuccessStoryService_Like(t *testing.T) {
	storyID := uuid.New()
	userID := uuid.New()

	tests := []struct {
		name      string
		storyRepo *mockSuccessStoryRepository
		wantCount int
		wantLiked bool
		wantErr   error
	}{
		{
			name: "first like — added=true",
			storyRepo: &mockSuccessStoryRepository{
				addLikeFn: func(_ context.Context, _, _ uuid.UUID) (bool, int, error) {
					return true, 1, nil
				},
			},
			wantCount: 1,
			wantLiked: true,
			wantErr:   nil,
		},
		{
			name: "repeat like — added=false, still liked=true",
			storyRepo: &mockSuccessStoryRepository{
				addLikeFn: func(_ context.Context, _, _ uuid.UUID) (bool, int, error) {
					return false, 1, nil
				},
			},
			wantCount: 1,
			wantLiked: true,
			wantErr:   nil,
		},
		{
			name: "story not found — returns error",
			storyRepo: &mockSuccessStoryRepository{
				addLikeFn: func(_ context.Context, _, _ uuid.UUID) (bool, int, error) {
					return false, 0, domain.ErrStoryNotFound
				},
			},
			wantErr: domain.ErrStoryNotFound,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			svc := newSuccessStoryService(tc.storyRepo, &mockPetRepoForStory{})
			count, liked, err := svc.Like(context.Background(), storyID, userID)

			if tc.wantErr != nil {
				if !errors.Is(err, tc.wantErr) {
					t.Errorf("expected error %v, got %v", tc.wantErr, err)
				}
				if liked {
					t.Error("expected liked=false on error")
				}
				return
			}

			if err != nil {
				t.Errorf("unexpected error: %v", err)
			}
			if count != tc.wantCount {
				t.Errorf("expected count=%d, got %d", tc.wantCount, count)
			}
			if liked != tc.wantLiked {
				t.Errorf("expected liked=%v, got %v", tc.wantLiked, liked)
			}
		})
	}
}

// ============================================================
// Unlike tests
// ============================================================

func TestSuccessStoryService_Unlike(t *testing.T) {
	storyID := uuid.New()
	userID := uuid.New()

	tests := []struct {
		name      string
		storyRepo *mockSuccessStoryRepository
		wantCount int
		wantErr   error
	}{
		{
			name: "was liked — removed=true, count decremented",
			storyRepo: &mockSuccessStoryRepository{
				removeLikeFn: func(_ context.Context, _, _ uuid.UUID) (bool, int, error) {
					return true, 0, nil
				},
			},
			wantCount: 0,
			wantErr:   nil,
		},
		{
			name: "not liked — removed=false, no-op",
			storyRepo: &mockSuccessStoryRepository{
				removeLikeFn: func(_ context.Context, _, _ uuid.UUID) (bool, int, error) {
					return false, 0, nil
				},
			},
			wantCount: 0,
			wantErr:   nil,
		},
		{
			name: "story not found — returns error",
			storyRepo: &mockSuccessStoryRepository{
				removeLikeFn: func(_ context.Context, _, _ uuid.UUID) (bool, int, error) {
					return false, 0, domain.ErrStoryNotFound
				},
			},
			wantErr: domain.ErrStoryNotFound,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			svc := newSuccessStoryService(tc.storyRepo, &mockPetRepoForStory{})
			count, liked, err := svc.Unlike(context.Background(), storyID, userID)

			if tc.wantErr != nil {
				if !errors.Is(err, tc.wantErr) {
					t.Errorf("expected error %v, got %v", tc.wantErr, err)
				}
				return
			}

			if err != nil {
				t.Errorf("unexpected error: %v", err)
			}
			if count != tc.wantCount {
				t.Errorf("expected count=%d, got %d", tc.wantCount, count)
			}
			if liked {
				t.Error("expected liked=false after Unlike")
			}
		})
	}
}

// ============================================================
// LikedStoryIDs tests
// ============================================================

func TestSuccessStoryService_LikedStoryIDs(t *testing.T) {
	userID := uuid.New()
	storyA := uuid.New()
	storyB := uuid.New()

	storyRepo := &mockSuccessStoryRepository{
		likedStoryIDsFn: func(_ context.Context, _ uuid.UUID, _ []uuid.UUID) (map[uuid.UUID]bool, error) {
			return map[uuid.UUID]bool{storyA: true}, nil
		},
	}
	svc := newSuccessStoryService(storyRepo, &mockPetRepoForStory{})

	result, err := svc.LikedStoryIDs(context.Background(), userID, []uuid.UUID{storyA, storyB})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !result[storyA] {
		t.Error("expected storyA to be liked")
	}
	if result[storyB] {
		t.Error("expected storyB to be NOT liked")
	}
}

// ============================================================
// Delete tests
// ============================================================

func TestSuccessStoryService_Delete(t *testing.T) {
	ownerID := uuid.New()
	adminID := uuid.New()
	otherID := uuid.New()
	storyID := uuid.New()

	existingStory := &domain.SuccessStory{
		ID:     storyID,
		UserID: ownerID,
		Body:   "Found my dog!",
	}

	tests := []struct {
		name      string
		callerID  uuid.UUID
		isAdmin   bool
		storyRepo *mockSuccessStoryRepository
		wantErr   error
	}{
		{
			name:     "owner can delete",
			callerID: ownerID,
			isAdmin:  false,
			storyRepo: &mockSuccessStoryRepository{
				getByIDFn: func(_ context.Context, id uuid.UUID) (*domain.SuccessStory, error) {
					return existingStory, nil
				},
				deleteFn: func(_ context.Context, _ uuid.UUID) error {
					return nil
				},
			},
			wantErr: nil,
		},
		{
			name:     "admin can delete any story",
			callerID: adminID,
			isAdmin:  true,
			storyRepo: &mockSuccessStoryRepository{
				getByIDFn: func(_ context.Context, id uuid.UUID) (*domain.SuccessStory, error) {
					return existingStory, nil
				},
				deleteFn: func(_ context.Context, _ uuid.UUID) error {
					return nil
				},
			},
			wantErr: nil,
		},
		{
			name:     "non-owner cannot delete — ErrForbidden",
			callerID: otherID,
			isAdmin:  false,
			storyRepo: &mockSuccessStoryRepository{
				getByIDFn: func(_ context.Context, id uuid.UUID) (*domain.SuccessStory, error) {
					return existingStory, nil
				},
			},
			wantErr: domain.ErrForbidden,
		},
		{
			name:     "story not found — ErrStoryNotFound",
			callerID: ownerID,
			isAdmin:  false,
			storyRepo: &mockSuccessStoryRepository{
				getByIDFn: func(_ context.Context, _ uuid.UUID) (*domain.SuccessStory, error) {
					return nil, domain.ErrStoryNotFound
				},
			},
			wantErr: domain.ErrStoryNotFound,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			svc := newSuccessStoryService(tc.storyRepo, &mockPetRepoForStory{})
			err := svc.Delete(context.Background(), storyID, tc.callerID, tc.isAdmin)

			if tc.wantErr != nil {
				if !errors.Is(err, tc.wantErr) {
					t.Errorf("expected error %v, got %v", tc.wantErr, err)
				}
				return
			}

			if err != nil {
				t.Errorf("unexpected error: %v", err)
			}
		})
	}
}
