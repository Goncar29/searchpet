package service

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/dto"
	"lost-pets/internal/repository"
)

// LocationAlertService expone las operaciones CRUD sobre alertas de ubicación.
// PR4 añadirá onReportCreated y la lógica de matching PostGIS.
type LocationAlertService interface {
	CreateAlert(ctx context.Context, userID uuid.UUID, req dto.CreateLocationAlertRequest) (*dto.LocationAlertResponse, error)
	GetAlerts(ctx context.Context, userID uuid.UUID) ([]dto.LocationAlertResponse, error)
	GetAlert(ctx context.Context, userID, alertID uuid.UUID) (*dto.LocationAlertResponse, error)
	UpdateAlert(ctx context.Context, userID, alertID uuid.UUID, req dto.UpdateLocationAlertRequest) (*dto.LocationAlertResponse, error)
	DeleteAlert(ctx context.Context, userID, alertID uuid.UUID) error
}

type locationAlertService struct {
	repo repository.LocationAlertRepository
}

// NewLocationAlertService crea una instancia con sus dependencias.
func NewLocationAlertService(repo repository.LocationAlertRepository) LocationAlertService {
	return &locationAlertService{repo: repo}
}

// CreateAlert valida y persiste una nueva alerta.
// Reglas:
//   - Latitude: –90 a 90
//   - Longitude: –180 a 180
//   - RadiusKm: 1 a 50 (default 5 si se omite)
//   - Máximo 10 alertas activas por usuario
func (s *locationAlertService) CreateAlert(ctx context.Context, userID uuid.UUID, req dto.CreateLocationAlertRequest) (*dto.LocationAlertResponse, error) {
	if err := validateAlertCoords(req.Latitude, req.Longitude); err != nil {
		return nil, err
	}

	radiusKm := req.RadiusKm
	if radiusKm == 0 {
		radiusKm = 5
	}
	if err := validateRadiusKm(radiusKm); err != nil {
		return nil, err
	}

	// Cap: máximo 10 alertas activas por usuario
	count, err := s.repo.CountActiveByUserID(ctx, userID)
	if err != nil {
		return nil, err
	}
	if count >= 10 {
		return nil, domain.ErrAlertLimitExceeded
	}

	alert := &domain.LocationAlert{
		UserID:         userID,
		AlertLatitude:  req.Latitude,
		AlertLongitude: req.Longitude,
		RadiusKm:       radiusKm,
		PetType:        req.PetType,
		Name:           req.Name,
		IsActive:       true,
	}

	if err := s.repo.Create(ctx, alert); err != nil {
		return nil, err
	}

	resp := dto.ToLocationAlertResponse(alert)
	return &resp, nil
}

// GetAlerts devuelve todas las alertas activas del usuario.
func (s *locationAlertService) GetAlerts(ctx context.Context, userID uuid.UUID) ([]dto.LocationAlertResponse, error) {
	alerts, err := s.repo.GetByUserID(ctx, userID)
	if err != nil {
		return nil, err
	}
	return dto.ToLocationAlertResponseList(alerts), nil
}

// GetAlert devuelve una alerta por ID, verificando que pertenezca al usuario.
func (s *locationAlertService) GetAlert(ctx context.Context, userID, alertID uuid.UUID) (*dto.LocationAlertResponse, error) {
	alert, err := s.repo.GetByID(ctx, alertID)
	if err != nil {
		return nil, domain.ErrAlertNotFound
	}
	if alert.UserID != userID {
		return nil, domain.ErrNotAlertOwner
	}
	resp := dto.ToLocationAlertResponse(alert)
	return &resp, nil
}

// UpdateAlert aplica los campos proporcionados (partial update).
func (s *locationAlertService) UpdateAlert(ctx context.Context, userID, alertID uuid.UUID, req dto.UpdateLocationAlertRequest) (*dto.LocationAlertResponse, error) {
	alert, err := s.repo.GetByID(ctx, alertID)
	if err != nil {
		return nil, domain.ErrAlertNotFound
	}
	if alert.UserID != userID {
		return nil, domain.ErrNotAlertOwner
	}

	if req.Latitude != nil {
		if err := validateAlertCoords(*req.Latitude, alert.AlertLongitude); err != nil {
			return nil, err
		}
		alert.AlertLatitude = *req.Latitude
	}
	if req.Longitude != nil {
		if err := validateAlertCoords(alert.AlertLatitude, *req.Longitude); err != nil {
			return nil, err
		}
		alert.AlertLongitude = *req.Longitude
	}
	if req.RadiusKm != nil {
		if err := validateRadiusKm(*req.RadiusKm); err != nil {
			return nil, err
		}
		alert.RadiusKm = *req.RadiusKm
	}
	if req.PetType != nil {
		alert.PetType = *req.PetType
	}
	if req.Name != nil {
		alert.Name = *req.Name
	}
	if req.IsActive != nil {
		alert.IsActive = *req.IsActive
	}

	if err := s.repo.Update(ctx, alert); err != nil {
		return nil, err
	}

	resp := dto.ToLocationAlertResponse(alert)
	return &resp, nil
}

// DeleteAlert hace soft-delete (IsActive = false), verificando ownership.
func (s *locationAlertService) DeleteAlert(ctx context.Context, userID, alertID uuid.UUID) error {
	alert, err := s.repo.GetByID(ctx, alertID)
	if err != nil {
		return domain.ErrAlertNotFound
	}
	if alert.UserID != userID {
		return domain.ErrNotAlertOwner
	}
	return s.repo.Delete(ctx, alertID)
}

// ── helpers de validación ──────────────────────────────────────────────────

func validateAlertCoords(lat, lng float64) error {
	if lat < -90 || lat > 90 {
		return fmt.Errorf("%w: latitud debe estar entre –90 y 90", domain.ErrInvalidInput)
	}
	if lng < -180 || lng > 180 {
		return fmt.Errorf("%w: longitud debe estar entre –180 y 180", domain.ErrInvalidInput)
	}
	return nil
}

func validateRadiusKm(r float64) error {
	if r < 1 || r > 50 {
		return fmt.Errorf("%w: radius_km debe estar entre 1 y 50", domain.ErrInvalidInput)
	}
	return nil
}
