package tests

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/dto"
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
		repo := &mockShelterRepository{
			createFn: func(_ context.Context, _ *domain.Shelter) error {
				t.Error("repo.Create must not be called when the guard fails")
				return nil
			},
		}
		svc := newTestShelterServiceFull(repo, userRepo, event.NewEventBus())
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
			createFn: func(_ context.Context, _ *domain.Shelter) error {
				t.Error("repo.Create must not be called when the guard fails")
				return nil
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
		svc := newTestShelterService(&mockShelterRepository{
			createFn: func(_ context.Context, _ *domain.Shelter) error {
				t.Error("repo.Create must not be called when the guard fails")
				return nil
			},
		})
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
	if created == nil {
		t.Fatal("want repo.Create called")
	}
	if created.Status != domain.ShelterStatusApproved {
		t.Errorf("admin-created shelter: want approved, got %q", created.Status)
	}
	if created.OwnerUserID != nil {
		t.Errorf("admin-created shelter: want no owner, got %v", created.OwnerUserID)
	}
}

// ============================================================
// UpdateMine tests
// ============================================================

// ownedShelter builds a persisted-looking shelter owned by ownerID, and a mock
// repo that returns it from GetByOwner and captures Update calls.
func ownedShelter(ownerID uuid.UUID, status string) (*domain.Shelter, *mockShelterRepository) {
	shelter := &domain.Shelter{
		ID:          uuid.New(),
		OwnerUserID: &ownerID,
		Name:        "Refugio Original",
		City:        "Montevideo",
		WebsiteURL:  "https://original.org",
		DonationURL: "https://original.org/donar",
		Status:      status,
	}
	repo := &mockShelterRepository{
		getByOwnerFn: func(_ context.Context, id uuid.UUID) (*domain.Shelter, error) {
			if id == ownerID {
				return shelter, nil
			}
			return nil, domain.ErrShelterNotFound
		},
	}
	return shelter, repo
}

func strPtr(s string) *string { return &s }

func TestShelterService_UpdateMine_ApprovedStagesLinkChanges(t *testing.T) {
	ownerID := uuid.New()
	shelter, repo := ownedShelter(ownerID, domain.ShelterStatusApproved)
	var saved *domain.Shelter
	repo.updateFn = func(_ context.Context, s *domain.Shelter) error {
		saved = s
		return nil
	}
	svc := newTestShelterServiceFull(repo, &mockUserRepository{}, event.NewEventBus())

	got, err := svc.UpdateMine(context.Background(), ownerID.String(), &dto.UpdateMyShelterRequest{
		Name:        strPtr("Refugio Renombrado"),
		DonationURL: strPtr("https://nuevo.org/donar"),
	})
	if err != nil {
		t.Fatalf("UpdateMine: %v", err)
	}
	if saved == nil {
		t.Fatal("want repo.Update called")
	}
	// Normal field applies immediately.
	if got.Name != "Refugio Renombrado" {
		t.Errorf("Name: want applied, got %q", got.Name)
	}
	// Link change is STAGED: live value untouched, pending set.
	if got.DonationURL != "https://original.org/donar" {
		t.Errorf("DonationURL: want live value untouched, got %q", got.DonationURL)
	}
	if got.PendingDonationURL == nil || *got.PendingDonationURL != "https://nuevo.org/donar" {
		t.Errorf("PendingDonationURL: want staged, got %v", got.PendingDonationURL)
	}
	// Untouched link stays unstaged.
	if got.PendingWebsiteURL != nil {
		t.Errorf("PendingWebsiteURL: want nil, got %v", got.PendingWebsiteURL)
	}
	if got.Status != domain.ShelterStatusApproved {
		t.Errorf("Status: want approved unchanged, got %q", got.Status)
	}
	_ = shelter
}

func TestShelterService_UpdateMine_ApprovedStagesLinkClear(t *testing.T) {
	ownerID := uuid.New()
	_, repo := ownedShelter(ownerID, domain.ShelterStatusApproved)
	svc := newTestShelterServiceFull(repo, &mockUserRepository{}, event.NewEventBus())

	got, err := svc.UpdateMine(context.Background(), ownerID.String(), &dto.UpdateMyShelterRequest{
		WebsiteURL: strPtr(""), // regla #22: "" explícito = vaciar → staged clear
	})
	if err != nil {
		t.Fatalf("UpdateMine: %v", err)
	}
	if got.WebsiteURL != "https://original.org" {
		t.Errorf("WebsiteURL: want live value untouched, got %q", got.WebsiteURL)
	}
	if got.PendingWebsiteURL == nil || *got.PendingWebsiteURL != "" {
		t.Errorf("PendingWebsiteURL: want staged clear (&\"\"), got %v", got.PendingWebsiteURL)
	}
}

func TestShelterService_UpdateMine_ApprovedSameValueNotStaged(t *testing.T) {
	ownerID := uuid.New()
	_, repo := ownedShelter(ownerID, domain.ShelterStatusApproved)
	svc := newTestShelterServiceFull(repo, &mockUserRepository{}, event.NewEventBus())

	got, err := svc.UpdateMine(context.Background(), ownerID.String(), &dto.UpdateMyShelterRequest{
		DonationURL: strPtr("https://original.org/donar"), // same as live → no-op
	})
	if err != nil {
		t.Fatalf("UpdateMine: %v", err)
	}
	if got.PendingDonationURL != nil {
		t.Errorf("PendingDonationURL: want nil for unchanged value, got %v", got.PendingDonationURL)
	}
}

func TestShelterService_UpdateMine_ApprovedResubmitLiveValueCancelsStage(t *testing.T) {
	ownerID := uuid.New()
	shelter, repo := ownedShelter(ownerID, domain.ShelterStatusApproved)
	shelter.PendingDonationURL = strPtr("https://nuevo.org/donar") // staged previo
	svc := newTestShelterServiceFull(repo, &mockUserRepository{}, event.NewEventBus())

	got, err := svc.UpdateMine(context.Background(), ownerID.String(), &dto.UpdateMyShelterRequest{
		DonationURL: strPtr("https://original.org/donar"), // reenviar el valor vivo
	})
	if err != nil {
		t.Fatalf("UpdateMine: %v", err)
	}
	if got.PendingDonationURL != nil {
		t.Errorf("PendingDonationURL: want staged change cancelled (nil), got %v", got.PendingDonationURL)
	}
	if got.DonationURL != "https://original.org/donar" {
		t.Errorf("DonationURL: want live value untouched, got %q", got.DonationURL)
	}
}

func TestShelterService_UpdateMine_UpdateErrorPropagates(t *testing.T) {
	ownerID := uuid.New()
	_, repo := ownedShelter(ownerID, domain.ShelterStatusApproved)
	sentinel := errors.New("boom: update failed")
	repo.updateFn = func(_ context.Context, _ *domain.Shelter) error {
		return sentinel
	}
	svc := newTestShelterServiceFull(repo, &mockUserRepository{}, event.NewEventBus())

	got, err := svc.UpdateMine(context.Background(), ownerID.String(), &dto.UpdateMyShelterRequest{
		Name: strPtr("Refugio X"),
	})
	if !errors.Is(err, sentinel) {
		t.Errorf("want sentinel error propagated, got %v", err)
	}
	if got != nil {
		t.Errorf("want nil shelter on update error, got %v", got)
	}
}

func TestShelterService_UpdateMine_RejectedResubmits(t *testing.T) {
	ownerID := uuid.New()
	shelter, repo := ownedShelter(ownerID, domain.ShelterStatusRejected)
	shelter.RejectionReason = "link roto"
	svc := newTestShelterServiceFull(repo, &mockUserRepository{}, buildBusExpecting(t, "shelter.submitted"))

	got, err := svc.UpdateMine(context.Background(), ownerID.String(), &dto.UpdateMyShelterRequest{
		DonationURL: strPtr("https://arreglado.org/donar"),
	})
	if err != nil {
		t.Fatalf("UpdateMine: %v", err)
	}
	// rejected edits apply DIRECTLY (no staging) and resubmit.
	if got.DonationURL != "https://arreglado.org/donar" {
		t.Errorf("DonationURL: want applied directly, got %q", got.DonationURL)
	}
	if got.PendingDonationURL != nil {
		t.Errorf("PendingDonationURL: want nil in rejected, got %v", got.PendingDonationURL)
	}
	if got.Status != domain.ShelterStatusPending {
		t.Errorf("Status: want pending (resubmitted), got %q", got.Status)
	}
	if got.RejectionReason != "" {
		t.Errorf("RejectionReason: want cleared, got %q", got.RejectionReason)
	}
}

func TestShelterService_UpdateMine_PendingEditsFreely(t *testing.T) {
	ownerID := uuid.New()
	_, repo := ownedShelter(ownerID, domain.ShelterStatusPending)
	svc := newTestShelterServiceFull(repo, &mockUserRepository{}, buildBusRejecting(t, "shelter.submitted"))

	got, err := svc.UpdateMine(context.Background(), ownerID.String(), &dto.UpdateMyShelterRequest{
		WebsiteURL: strPtr("https://cambiada.org"),
	})
	if err != nil {
		t.Fatalf("UpdateMine: %v", err)
	}
	if got.WebsiteURL != "https://cambiada.org" {
		t.Errorf("WebsiteURL: want applied directly, got %q", got.WebsiteURL)
	}
	if got.Status != domain.ShelterStatusPending {
		t.Errorf("Status: want pending unchanged, got %q", got.Status)
	}
}

func TestShelterService_UpdateMine_NoShelter(t *testing.T) {
	svc := newTestShelterService(&mockShelterRepository{})
	if _, err := svc.UpdateMine(context.Background(), uuid.New().String(), &dto.UpdateMyShelterRequest{}); !errors.Is(err, domain.ErrShelterNotFound) {
		t.Errorf("want ErrShelterNotFound, got %v", err)
	}
	if _, err := svc.UpdateMine(context.Background(), "nope", &dto.UpdateMyShelterRequest{}); !errors.Is(err, domain.ErrInvalidInput) {
		t.Errorf("want ErrInvalidInput, got %v", err)
	}
}

// buildBusExpecting returns a bus that FAILS the test if eventName is NOT
// published within 2s. Cleanup asserts on test end.
func buildBusExpecting(t *testing.T, eventName string) *event.EventBus {
	t.Helper()
	bus := event.NewEventBus()
	received := make(chan struct{}, 1)
	bus.Subscribe(eventName, func(_ interface{}) {
		received <- struct{}{}
	})
	t.Cleanup(func() {
		select {
		case <-received:
		case <-time.After(2 * time.Second):
			t.Errorf("timeout: %s not published", eventName)
		}
	})
	return bus
}

// buildBusRejecting returns a bus that FAILS the test if eventName IS
// published. Cleanup waits briefly so the async bus has a chance to deliver
// before the test ends.
func buildBusRejecting(t *testing.T, eventName string) *event.EventBus {
	t.Helper()
	bus := event.NewEventBus()
	bus.Subscribe(eventName, func(_ interface{}) {
		t.Errorf("unexpected publish of %s", eventName)
	})
	t.Cleanup(func() {
		time.Sleep(100 * time.Millisecond)
	})
	return bus
}
