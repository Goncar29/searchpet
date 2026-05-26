package tests

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/dto"
	"lost-pets/internal/event"
	"lost-pets/internal/service"
)

// ============================================================
// Mock repositories
// ============================================================

type mockLocationAlertRepository struct {
	createFn               func(ctx context.Context, alert *domain.LocationAlert) error
	getByIDFn              func(ctx context.Context, id uuid.UUID) (*domain.LocationAlert, error)
	getByUserIDFn          func(ctx context.Context, userID uuid.UUID) ([]domain.LocationAlert, error)
	updateFn               func(ctx context.Context, alert *domain.LocationAlert) error
	deleteFn               func(ctx context.Context, id uuid.UUID) error
	findActiveAlertsNearFn func(ctx context.Context, lat, lng float64, petType string) ([]domain.LocationAlert, error)
	countActiveByUserIDFn  func(ctx context.Context, userID uuid.UUID) (int64, error)
}

func (m *mockLocationAlertRepository) Create(ctx context.Context, alert *domain.LocationAlert) error {
	if m.createFn != nil {
		return m.createFn(ctx, alert)
	}
	alert.ID = uuid.New()
	return nil
}

func (m *mockLocationAlertRepository) GetByID(ctx context.Context, id uuid.UUID) (*domain.LocationAlert, error) {
	if m.getByIDFn != nil {
		return m.getByIDFn(ctx, id)
	}
	return nil, domain.ErrAlertNotFound
}

func (m *mockLocationAlertRepository) GetByUserID(ctx context.Context, userID uuid.UUID) ([]domain.LocationAlert, error) {
	if m.getByUserIDFn != nil {
		return m.getByUserIDFn(ctx, userID)
	}
	return []domain.LocationAlert{}, nil
}

func (m *mockLocationAlertRepository) Update(ctx context.Context, alert *domain.LocationAlert) error {
	if m.updateFn != nil {
		return m.updateFn(ctx, alert)
	}
	return nil
}

func (m *mockLocationAlertRepository) Delete(ctx context.Context, id uuid.UUID) error {
	if m.deleteFn != nil {
		return m.deleteFn(ctx, id)
	}
	return nil
}

func (m *mockLocationAlertRepository) FindActiveAlertsNear(ctx context.Context, lat, lng float64, petType string) ([]domain.LocationAlert, error) {
	if m.findActiveAlertsNearFn != nil {
		return m.findActiveAlertsNearFn(ctx, lat, lng, petType)
	}
	return []domain.LocationAlert{}, nil
}

func (m *mockLocationAlertRepository) CountActiveByUserID(ctx context.Context, userID uuid.UUID) (int64, error) {
	if m.countActiveByUserIDFn != nil {
		return m.countActiveByUserIDFn(ctx, userID)
	}
	return 0, nil
}

type mockDeviceTokenRepository struct {
	findByUserIDFn func(ctx context.Context, userID uuid.UUID) ([]domain.DeviceToken, error)
}

func (m *mockDeviceTokenRepository) Upsert(ctx context.Context, token *domain.DeviceToken) error {
	return nil
}

func (m *mockDeviceTokenRepository) FindByUserID(ctx context.Context, userID uuid.UUID) ([]domain.DeviceToken, error) {
	if m.findByUserIDFn != nil {
		return m.findByUserIDFn(ctx, userID)
	}
	return []domain.DeviceToken{}, nil
}

func (m *mockDeviceTokenRepository) DeleteByToken(ctx context.Context, token string) error {
	return nil
}

// ============================================================
// Helper: build service
// ============================================================

func newTestLocationAlertService(
	alertRepo *mockLocationAlertRepository,
	deviceTokenRepo *mockDeviceTokenRepository,
) service.LocationAlertService {
	bus := event.NewEventBus()
	return service.NewLocationAlertService(alertRepo, deviceTokenRepo, bus)
}

// ============================================================
// CreateAlert tests
// ============================================================

func TestLocationAlertService_CreateAlert(t *testing.T) {
	userID := uuid.New()

	tests := []struct {
		name      string
		alertRepo *mockLocationAlertRepository
		req       dto.CreateLocationAlertRequest
		wantErr   error
	}{
		{
			name:      "happy path — valid coords, default radius",
			alertRepo: &mockLocationAlertRepository{},
			req: dto.CreateLocationAlertRequest{
				Latitude:  -34.9011,
				Longitude: -56.1645,
				// RadiusKm omitted → defaults to 5
			},
			wantErr: nil,
		},
		{
			name:      "happy path — explicit radius and pet type",
			alertRepo: &mockLocationAlertRepository{},
			req: dto.CreateLocationAlertRequest{
				Latitude:  -34.9011,
				Longitude: -56.1645,
				RadiusKm:  10,
				PetType:   "perro",
				Name:      "Mi zona",
			},
			wantErr: nil,
		},
		{
			name:      "invalid latitude — too low",
			alertRepo: &mockLocationAlertRepository{},
			req: dto.CreateLocationAlertRequest{
				Latitude:  -91,
				Longitude: -56.1645,
				RadiusKm:  5,
			},
			wantErr: domain.ErrInvalidInput,
		},
		{
			name:      "invalid longitude — too high",
			alertRepo: &mockLocationAlertRepository{},
			req: dto.CreateLocationAlertRequest{
				Latitude:  -34.9011,
				Longitude: 181,
				RadiusKm:  5,
			},
			wantErr: domain.ErrInvalidInput,
		},
		{
			name:      "invalid radius — below 1",
			alertRepo: &mockLocationAlertRepository{},
			req: dto.CreateLocationAlertRequest{
				Latitude:  -34.9011,
				Longitude: -56.1645,
				RadiusKm:  0.5,
			},
			wantErr: domain.ErrInvalidInput,
		},
		{
			name:      "invalid radius — above 50",
			alertRepo: &mockLocationAlertRepository{},
			req: dto.CreateLocationAlertRequest{
				Latitude:  -34.9011,
				Longitude: -56.1645,
				RadiusKm:  51,
			},
			wantErr: domain.ErrInvalidInput,
		},
		{
			name: "at alert limit (10) — ErrAlertLimitExceeded",
			alertRepo: &mockLocationAlertRepository{
				countActiveByUserIDFn: func(_ context.Context, _ uuid.UUID) (int64, error) {
					return 10, nil
				},
			},
			req: dto.CreateLocationAlertRequest{
				Latitude:  -34.9011,
				Longitude: -56.1645,
				RadiusKm:  5,
			},
			wantErr: domain.ErrAlertLimitExceeded,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			svc := newTestLocationAlertService(tc.alertRepo, &mockDeviceTokenRepository{})
			resp, err := svc.CreateAlert(context.Background(), userID, tc.req)

			if tc.wantErr != nil {
				if !errors.Is(err, tc.wantErr) {
					t.Errorf("expected error %v, got %v", tc.wantErr, err)
				}
				if resp != nil {
					t.Error("expected nil response on error")
				}
				return
			}

			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if resp == nil {
				t.Fatal("expected response, got nil")
			}
			if resp.UserID != userID {
				t.Errorf("UserID: want %v, got %v", userID, resp.UserID)
			}
			if !resp.IsActive {
				t.Error("new alert should be active")
			}
		})
	}
}

// ============================================================
// GetAlerts tests
// ============================================================

func TestLocationAlertService_GetAlerts(t *testing.T) {
	userID := uuid.New()
	alertID1 := uuid.New()
	alertID2 := uuid.New()

	tests := []struct {
		name      string
		alertRepo *mockLocationAlertRepository
		wantLen   int
		wantErr   error
	}{
		{
			name: "returns all alerts for user",
			alertRepo: &mockLocationAlertRepository{
				getByUserIDFn: func(_ context.Context, uid uuid.UUID) ([]domain.LocationAlert, error) {
					if uid != userID {
						return nil, errors.New("wrong user")
					}
					return []domain.LocationAlert{
						{ID: alertID1, UserID: userID, IsActive: true},
						{ID: alertID2, UserID: userID, IsActive: true},
					}, nil
				},
			},
			wantLen: 2,
			wantErr: nil,
		},
		{
			name:      "user with no alerts returns empty slice",
			alertRepo: &mockLocationAlertRepository{},
			wantLen:   0,
			wantErr:   nil,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			svc := newTestLocationAlertService(tc.alertRepo, &mockDeviceTokenRepository{})
			resp, err := svc.GetAlerts(context.Background(), userID)

			if tc.wantErr != nil {
				if !errors.Is(err, tc.wantErr) {
					t.Errorf("expected error %v, got %v", tc.wantErr, err)
				}
				return
			}

			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if len(resp) != tc.wantLen {
				t.Errorf("expected %d alerts, got %d", tc.wantLen, len(resp))
			}
		})
	}
}

// ============================================================
// DeleteAlert tests
// ============================================================

func TestLocationAlertService_DeleteAlert(t *testing.T) {
	ownerID := uuid.New()
	otherUserID := uuid.New()
	alertID := uuid.New()

	tests := []struct {
		name      string
		callerID  uuid.UUID
		alertRepo *mockLocationAlertRepository
		wantErr   error
	}{
		{
			name:     "owner can delete own alert",
			callerID: ownerID,
			alertRepo: &mockLocationAlertRepository{
				getByIDFn: func(_ context.Context, id uuid.UUID) (*domain.LocationAlert, error) {
					return &domain.LocationAlert{ID: id, UserID: ownerID}, nil
				},
			},
			wantErr: nil,
		},
		{
			name:     "non-owner cannot delete — ErrNotAlertOwner",
			callerID: otherUserID,
			alertRepo: &mockLocationAlertRepository{
				getByIDFn: func(_ context.Context, id uuid.UUID) (*domain.LocationAlert, error) {
					return &domain.LocationAlert{ID: id, UserID: ownerID}, nil
				},
			},
			wantErr: domain.ErrNotAlertOwner,
		},
		{
			name:     "alert not found — ErrAlertNotFound",
			callerID: ownerID,
			alertRepo: &mockLocationAlertRepository{
				getByIDFn: func(_ context.Context, _ uuid.UUID) (*domain.LocationAlert, error) {
					return nil, domain.ErrAlertNotFound
				},
			},
			wantErr: domain.ErrAlertNotFound,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			svc := newTestLocationAlertService(tc.alertRepo, &mockDeviceTokenRepository{})
			err := svc.DeleteAlert(context.Background(), tc.callerID, alertID)

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

// ============================================================
// GetAlert tests
// ============================================================

func TestLocationAlertService_GetAlert(t *testing.T) {
	ownerID := uuid.New()
	otherUserID := uuid.New()
	alertID := uuid.New()

	tests := []struct {
		name      string
		callerID  uuid.UUID
		alertRepo *mockLocationAlertRepository
		wantErr   error
	}{
		{
			name:     "owner gets own alert",
			callerID: ownerID,
			alertRepo: &mockLocationAlertRepository{
				getByIDFn: func(_ context.Context, id uuid.UUID) (*domain.LocationAlert, error) {
					return &domain.LocationAlert{ID: id, UserID: ownerID, AlertLatitude: -34.9, AlertLongitude: -56.1, RadiusKm: 5}, nil
				},
			},
			wantErr: nil,
		},
		{
			name:     "non-owner gets ErrNotAlertOwner",
			callerID: otherUserID,
			alertRepo: &mockLocationAlertRepository{
				getByIDFn: func(_ context.Context, id uuid.UUID) (*domain.LocationAlert, error) {
					return &domain.LocationAlert{ID: id, UserID: ownerID}, nil
				},
			},
			wantErr: domain.ErrNotAlertOwner,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			svc := newTestLocationAlertService(tc.alertRepo, &mockDeviceTokenRepository{})
			resp, err := svc.GetAlert(context.Background(), tc.callerID, alertID)

			if tc.wantErr != nil {
				if !errors.Is(err, tc.wantErr) {
					t.Errorf("expected error %v, got %v", tc.wantErr, err)
				}
				return
			}

			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if resp == nil {
				t.Fatal("expected response, got nil")
			}
		})
	}
}
