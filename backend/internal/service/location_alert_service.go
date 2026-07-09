package service

import (
	"context"
	"fmt"
	"log"
	"math"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/dto"
	"lost-pets/internal/event"
	"lost-pets/internal/repository"
)

// LocationAlertService expone las operaciones CRUD sobre alertas de ubicación
// y el subscriber que realiza el matching PostGIS cuando llega "report.created".
type LocationAlertService interface {
	CreateAlert(ctx context.Context, userID uuid.UUID, req dto.CreateLocationAlertRequest) (*dto.LocationAlertResponse, error)
	GetAlerts(ctx context.Context, userID uuid.UUID) ([]dto.LocationAlertResponse, error)
	GetAlert(ctx context.Context, userID, alertID uuid.UUID) (*dto.LocationAlertResponse, error)
	UpdateAlert(ctx context.Context, userID, alertID uuid.UUID, req dto.UpdateLocationAlertRequest) (*dto.LocationAlertResponse, error)
	DeleteAlert(ctx context.Context, userID, alertID uuid.UUID) error
	// RegisterListeners suscribe OnReportCreated al EventBus.
	// Debe llamarse una vez durante el arranque del servidor.
	RegisterListeners(bus *event.EventBus)
}

type locationAlertService struct {
	repo            repository.LocationAlertRepository
	deviceTokenRepo repository.DeviceTokenRepository
	bus             *event.EventBus
}

// NewLocationAlertService crea una instancia con sus dependencias.
// deviceTokenRepo se usa en onReportCreated para obtener los FCM tokens del
// dueño de cada alerta antes de publicar el evento "alert.triggered".
// bus es el EventBus compartido — necesario para publicar "alert.triggered".
func NewLocationAlertService(
	repo repository.LocationAlertRepository,
	deviceTokenRepo repository.DeviceTokenRepository,
	bus *event.EventBus,
) LocationAlertService {
	return &locationAlertService{
		repo:            repo,
		deviceTokenRepo: deviceTokenRepo,
		bus:             bus,
	}
}

// RegisterListeners suscribe onReportCreated al EventBus para el evento "report.created".
// Debe llamarse una vez durante el arranque del servidor.
func (s *locationAlertService) RegisterListeners(bus *event.EventBus) {
	bus.Subscribe("report.created", s.onReportCreated)
}

// onReportCreated se invoca cuando el EventBus dispara "report.created".
// El EventBus lo ejecuta en su propia goroutine (NFR1.3: no bloquea el request).
//
// Flujo:
//  1. Consulta FindActiveAlertsNear con PostGIS ST_DWithin — single DB call.
//  2. Por cada alerta coincidente: obtiene tokens FCM del dueño.
//  3. Publica "alert.triggered" con AlertTriggeredEvent.
//
// Todos los datos del reporte llegan en el payload — no hay lookup adicional.
func (s *locationAlertService) onReportCreated(payload interface{}) {
	reportEv, ok := payload.(event.ReportCreatedEvent)
	if !ok {
		log.Printf("[LocationAlertService] onReportCreated: payload inesperado: %T", payload)
		return
	}

	ctx := context.Background()

	matchingAlerts, err := s.repo.FindActiveAlertsNear(ctx, reportEv.Lat, reportEv.Lng, reportEv.PetType)
	if err != nil {
		log.Printf("[LocationAlertService] onReportCreated: error buscando alertas: %v", err)
		return
	}

	for _, alert := range matchingAlerts {
		tokens, err := s.deviceTokenRepo.FindByUserID(ctx, alert.UserID)
		if err != nil {
			log.Printf("[LocationAlertService] onReportCreated: tokens para user %s: %v", alert.UserID, err)
			continue
		}
		if len(tokens) == 0 {
			log.Printf("[LocationAlertService] alerta %s coincide pero el user %s no tiene device tokens registrados — push omitido", alert.ID, alert.UserID)
			continue
		}

		fcmTokens := make([]string, 0, len(tokens))
		for _, t := range tokens {
			fcmTokens = append(fcmTokens, t.Token)
		}

		distKm := haversineKm(reportEv.Lat, reportEv.Lng, alert.AlertLatitude, alert.AlertLongitude)

		s.bus.Publish("alert.triggered", event.AlertTriggeredEvent{
			AlertID:    alert.ID,
			UserID:     alert.UserID,
			ReportID:   reportEv.ReportID,
			PetID:      reportEv.PetID,
			PetName:    reportEv.PetName,
			PetType:    reportEv.PetType,
			FCMTokens:  fcmTokens,
			DistanceKm: distKm,
		})

		log.Printf("[LocationAlertService] alert.triggered publicado — alerta %s, user %s", alert.ID, alert.UserID)
	}
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

// haversineKm calcula la distancia en kilómetros entre dos coordenadas geográficas.
// Fórmula de Haversine — error < 0.5% en distancias < 500 km.
func haversineKm(lat1, lng1, lat2, lng2 float64) float64 {
	const earthRadiusKm = 6371.0
	dLat := (lat2 - lat1) * math.Pi / 180
	dLng := (lng2 - lng1) * math.Pi / 180
	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(lat1*math.Pi/180)*math.Cos(lat2*math.Pi/180)*
			math.Sin(dLng/2)*math.Sin(dLng/2)
	return earthRadiusKm * 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
}
