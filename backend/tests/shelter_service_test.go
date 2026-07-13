package tests

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/event"
	"lost-pets/internal/service"
)

// ============================================================
// Mock repository
// ============================================================

type mockShelterRepository struct {
	createFn          func(ctx context.Context, shelter *domain.Shelter) error
	getByIDFn         func(ctx context.Context, id uuid.UUID) (*domain.Shelter, error)
	getAllFn          func(ctx context.Context, city string, isVerified *bool) ([]domain.Shelter, error)
	updateFn          func(ctx context.Context, shelter *domain.Shelter) error
	getByOwnerFn      func(ctx context.Context, ownerID uuid.UUID) (*domain.Shelter, error)
	getPendingQueueFn func(ctx context.Context) ([]domain.Shelter, error)
}

func (m *mockShelterRepository) Create(ctx context.Context, shelter *domain.Shelter) error {
	if m.createFn != nil {
		return m.createFn(ctx, shelter)
	}
	shelter.ID = uuid.New()
	return nil
}

func (m *mockShelterRepository) GetByID(ctx context.Context, id uuid.UUID) (*domain.Shelter, error) {
	if m.getByIDFn != nil {
		return m.getByIDFn(ctx, id)
	}
	return nil, domain.ErrShelterNotFound
}

func (m *mockShelterRepository) GetAll(ctx context.Context, city string, isVerified *bool) ([]domain.Shelter, error) {
	if m.getAllFn != nil {
		return m.getAllFn(ctx, city, isVerified)
	}
	return []domain.Shelter{}, nil
}

func (m *mockShelterRepository) Update(ctx context.Context, shelter *domain.Shelter) error {
	if m.updateFn != nil {
		return m.updateFn(ctx, shelter)
	}
	return nil
}

func (m *mockShelterRepository) GetByOwner(ctx context.Context, ownerID uuid.UUID) (*domain.Shelter, error) {
	if m.getByOwnerFn != nil {
		return m.getByOwnerFn(ctx, ownerID)
	}
	return nil, domain.ErrShelterNotFound
}

func (m *mockShelterRepository) GetPendingQueue(ctx context.Context) ([]domain.Shelter, error) {
	if m.getPendingQueueFn != nil {
		return m.getPendingQueueFn(ctx)
	}
	return []domain.Shelter{}, nil
}

// ============================================================
// Helpers
// ============================================================

func newTestShelterService(repo *mockShelterRepository) service.ShelterService {
	return newTestShelterServiceFull(repo, &mockUserRepository{}, event.NewEventBus())
}

func newTestShelterServiceFull(repo *mockShelterRepository, userRepo *mockUserRepository, bus *event.EventBus) service.ShelterService {
	return service.NewShelterService(repo, userRepo, bus)
}

func makeShelter(id uuid.UUID, name, city string) domain.Shelter {
	return domain.Shelter{
		ID:          id,
		Name:        name,
		City:        city,
		IsVerified:  true,
		DonationURL: "https://example.com/donate",
	}
}

// ============================================================
// GetAll tests
// ============================================================

func TestShelterService_GetAll(t *testing.T) {
	shelterA := makeShelter(uuid.New(), "Refugio Montevideo", "Montevideo")
	shelterB := makeShelter(uuid.New(), "Refugio Buenos Aires", "Buenos Aires")

	tests := []struct {
		name    string
		repo    *mockShelterRepository
		city    string
		wantLen int
		wantErr error
	}{
		{
			name: "no city filter — returns all shelters",
			repo: &mockShelterRepository{
				getAllFn: func(_ context.Context, city string, isVerified *bool) ([]domain.Shelter, error) {
					if city != "" {
						return nil, errors.New("unexpected city filter")
					}
					if isVerified != nil {
						return nil, errors.New("isVerified should be nil in service")
					}
					return []domain.Shelter{shelterA, shelterB}, nil
				},
			},
			city:    "",
			wantLen: 2,
			wantErr: nil,
		},
		{
			name: "city filter — returns only matching shelters",
			repo: &mockShelterRepository{
				getAllFn: func(_ context.Context, city string, _ *bool) ([]domain.Shelter, error) {
					if city == "Montevideo" {
						return []domain.Shelter{shelterA}, nil
					}
					return []domain.Shelter{}, nil
				},
			},
			city:    "Montevideo",
			wantLen: 1,
			wantErr: nil,
		},
		{
			name: "city with no shelters — empty slice",
			repo: &mockShelterRepository{
				getAllFn: func(_ context.Context, _ string, _ *bool) ([]domain.Shelter, error) {
					return []domain.Shelter{}, nil
				},
			},
			city:    "NonExistentCity",
			wantLen: 0,
			wantErr: nil,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			svc := newTestShelterService(tc.repo)
			results, err := svc.GetAll(context.Background(), tc.city)

			if tc.wantErr != nil {
				if !errors.Is(err, tc.wantErr) {
					t.Errorf("expected error %v, got %v", tc.wantErr, err)
				}
				return
			}

			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if len(results) != tc.wantLen {
				t.Errorf("expected %d shelters, got %d", tc.wantLen, len(results))
			}
		})
	}
}

// ============================================================
// GetByID tests
// ============================================================

func TestShelterService_GetByID(t *testing.T) {
	shelterID := uuid.New()
	shelter := makeShelter(shelterID, "Refugio Test", "Montevideo")

	tests := []struct {
		name    string
		repo    *mockShelterRepository
		id      string
		wantErr error
	}{
		{
			name: "returns shelter by valid UUID string",
			repo: &mockShelterRepository{
				getByIDFn: func(_ context.Context, id uuid.UUID) (*domain.Shelter, error) {
					if id != shelterID {
						return nil, domain.ErrShelterNotFound
					}
					return &shelter, nil
				},
			},
			id:      shelterID.String(),
			wantErr: nil,
		},
		{
			name: "shelter not found — ErrShelterNotFound",
			repo: &mockShelterRepository{
				getByIDFn: func(_ context.Context, _ uuid.UUID) (*domain.Shelter, error) {
					return nil, domain.ErrShelterNotFound
				},
			},
			id:      uuid.New().String(),
			wantErr: domain.ErrShelterNotFound,
		},
		{
			name:    "invalid UUID string — ErrInvalidInput",
			repo:    &mockShelterRepository{},
			id:      "not-a-valid-uuid",
			wantErr: domain.ErrInvalidInput,
		},
		{
			name:    "empty ID string — ErrInvalidInput",
			repo:    &mockShelterRepository{},
			id:      "",
			wantErr: domain.ErrInvalidInput,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			svc := newTestShelterService(tc.repo)
			result, err := svc.GetByID(context.Background(), tc.id)

			if tc.wantErr != nil {
				if !errors.Is(err, tc.wantErr) {
					t.Errorf("expected error %v, got %v", tc.wantErr, err)
				}
				if result != nil {
					t.Error("expected nil result on error")
				}
				return
			}

			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if result == nil {
				t.Fatal("expected result, got nil")
			}
			if result.ID != shelterID {
				t.Errorf("ID: want %v, got %v", shelterID, result.ID)
			}
		})
	}
}

// ============================================================
// RegisterOwn tests
// ============================================================

func verifiedUser(id uuid.UUID) *domain.User {
	return &domain.User{ID: id, Name: "Verified User", EmailVerified: true}
}

func TestShelterService_RegisterOwn_HappyPath(t *testing.T) {
	ownerID := uuid.New()
	var created *domain.Shelter
	repo := &mockShelterRepository{
		createFn: func(_ context.Context, shelter *domain.Shelter) error {
			shelter.ID = uuid.New()
			created = shelter
			return nil
		},
	}
	userRepo := &mockUserRepository{
		getByIDFn: func(_ context.Context, id uuid.UUID) (*domain.User, error) {
			return verifiedUser(id), nil
		},
	}
	svc := newTestShelterServiceFull(repo, userRepo, event.NewEventBus())

	shelter := &domain.Shelter{Name: "Mi Refugio", City: "Montevideo"}
	if err := svc.RegisterOwn(context.Background(), ownerID.String(), shelter); err != nil {
		t.Fatalf("RegisterOwn: %v", err)
	}
	if created == nil {
		t.Fatal("want repo.Create called")
	}
	if created.Status != domain.ShelterStatusPending {
		t.Errorf("Status: want pending, got %q", created.Status)
	}
	if created.OwnerUserID == nil || *created.OwnerUserID != ownerID {
		t.Errorf("OwnerUserID: want %s, got %v", ownerID, created.OwnerUserID)
	}
}

func TestShelterService_RegisterOwn_PublishesSubmittedEvent(t *testing.T) {
	ownerID := uuid.New()
	repo := &mockShelterRepository{}
	userRepo := &mockUserRepository{
		getByIDFn: func(_ context.Context, id uuid.UUID) (*domain.User, error) {
			return verifiedUser(id), nil
		},
	}
	bus := event.NewEventBus()
	received := make(chan event.ShelterSubmittedEvent, 1)
	bus.Subscribe("shelter.submitted", func(payload interface{}) {
		if ev, ok := payload.(event.ShelterSubmittedEvent); ok {
			received <- ev
		}
	})
	svc := newTestShelterServiceFull(repo, userRepo, bus)

	if err := svc.RegisterOwn(context.Background(), ownerID.String(), &domain.Shelter{Name: "Refugio", City: "Montevideo"}); err != nil {
		t.Fatalf("RegisterOwn: %v", err)
	}
	select {
	case ev := <-received:
		if ev.OwnerUserID != ownerID {
			t.Errorf("event OwnerUserID: want %s, got %s", ownerID, ev.OwnerUserID)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timeout: shelter.submitted not published")
	}
}

func TestShelterService_RegisterOwn_Guards(t *testing.T) {
	ownerID := uuid.New()

	t.Run("unverified email → ErrEmailNotVerified", func(t *testing.T) {
		userRepo := &mockUserRepository{
			getByIDFn: func(_ context.Context, id uuid.UUID) (*domain.User, error) {
				return &domain.User{ID: id, EmailVerified: false}, nil
			},
		}
		svc := newTestShelterServiceFull(&mockShelterRepository{}, userRepo, event.NewEventBus())
		err := svc.RegisterOwn(context.Background(), ownerID.String(), &domain.Shelter{Name: "R", City: "M"})
		if !errors.Is(err, domain.ErrEmailNotVerified) {
			t.Errorf("want ErrEmailNotVerified, got %v", err)
		}
	})

	t.Run("already owns a shelter → ErrShelterAlreadyOwned", func(t *testing.T) {
		repo := &mockShelterRepository{
			getByOwnerFn: func(_ context.Context, _ uuid.UUID) (*domain.Shelter, error) {
				return &domain.Shelter{ID: uuid.New()}, nil
			},
		}
		userRepo := &mockUserRepository{
			getByIDFn: func(_ context.Context, id uuid.UUID) (*domain.User, error) {
				return verifiedUser(id), nil
			},
		}
		svc := newTestShelterServiceFull(repo, userRepo, event.NewEventBus())
		err := svc.RegisterOwn(context.Background(), ownerID.String(), &domain.Shelter{Name: "R", City: "M"})
		if !errors.Is(err, domain.ErrShelterAlreadyOwned) {
			t.Errorf("want ErrShelterAlreadyOwned, got %v", err)
		}
	})

	t.Run("invalid userID → ErrInvalidInput", func(t *testing.T) {
		svc := newTestShelterService(&mockShelterRepository{})
		err := svc.RegisterOwn(context.Background(), "not-a-uuid", &domain.Shelter{Name: "R", City: "M"})
		if !errors.Is(err, domain.ErrInvalidInput) {
			t.Errorf("want ErrInvalidInput, got %v", err)
		}
	})
}

// ============================================================
// GetMine tests
// ============================================================

func TestShelterService_GetMine(t *testing.T) {
	ownerID := uuid.New()
	mine := makeShelter(uuid.New(), "Mi Refugio", "Montevideo")
	mine.OwnerUserID = &ownerID

	repo := &mockShelterRepository{
		getByOwnerFn: func(_ context.Context, id uuid.UUID) (*domain.Shelter, error) {
			if id == ownerID {
				return &mine, nil
			}
			return nil, domain.ErrShelterNotFound
		},
	}
	svc := newTestShelterService(repo)

	got, err := svc.GetMine(context.Background(), ownerID.String())
	if err != nil {
		t.Fatalf("GetMine: %v", err)
	}
	if got.ID != mine.ID {
		t.Errorf("want shelter %s, got %s", mine.ID, got.ID)
	}

	if _, err := svc.GetMine(context.Background(), uuid.New().String()); !errors.Is(err, domain.ErrShelterNotFound) {
		t.Errorf("want ErrShelterNotFound, got %v", err)
	}
	if _, err := svc.GetMine(context.Background(), "nope"); !errors.Is(err, domain.ErrInvalidInput) {
		t.Errorf("want ErrInvalidInput, got %v", err)
	}
}

// ============================================================
// Admin Create born approved
// ============================================================

func TestShelterService_Create_AdminShelterBornApproved(t *testing.T) {
	var created *domain.Shelter
	repo := &mockShelterRepository{
		createFn: func(_ context.Context, shelter *domain.Shelter) error {
			shelter.ID = uuid.New()
			created = shelter
			return nil
		},
	}
	svc := newTestShelterService(repo)

	if err := svc.Create(context.Background(), &domain.Shelter{Name: "Admin Refugio", City: "Montevideo"}); err != nil {
		t.Fatalf("Create: %v", err)
	}
	if created.Status != domain.ShelterStatusApproved {
		t.Errorf("admin-created shelter: want approved, got %q", created.Status)
	}
	if created.OwnerUserID != nil {
		t.Errorf("admin-created shelter: want no owner, got %v", created.OwnerUserID)
	}
}
