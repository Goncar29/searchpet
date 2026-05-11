package service

import (
	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/event"
	"lost-pets/internal/repository"
)

// ReportService define el CONTRATO de la capa de negocio para reportes.
type ReportService interface {
	CreateReport(reporterID string, req CreateReportRequest) (*domain.Report, error)
	GetReportByID(id string) (*domain.Report, error)
	GetReportsByPet(petID string) ([]domain.Report, error)
	GetNearbyReports(lat, lng float64, radiusMeters float64) ([]domain.Report, error)
}

// CreateReportRequest contiene los datos para crear un reporte.
type CreateReportRequest struct {
	PetID               string  `json:"pet_id" binding:"required"`
	Status              string  `json:"status" binding:"required"` // lost, found, sighting
	Latitude            float64 `json:"latitude" binding:"required"`
	Longitude           float64 `json:"longitude" binding:"required"`
	LocationDescription string  `json:"location_description"`
}

// reportService es la implementación concreta del ReportService.
type reportService struct {
	repo     repository.ReportRepository
	petRepo  repository.PetRepository
	eventBus *event.EventBus
}

// NewReportService es el constructor.
// eventBus es opcional — si es nil, los eventos no se publican (zero behavior change).
func NewReportService(repo repository.ReportRepository, petRepo repository.PetRepository, eventBus *event.EventBus) ReportService {
	return &reportService{repo: repo, petRepo: petRepo, eventBus: eventBus}
}

// CreateReport crea un nuevo reporte de ubicación.
func (s *reportService) CreateReport(reporterID string, req CreateReportRequest) (*domain.Report, error) {
	reporterUUID, err := uuid.Parse(reporterID)
	if err != nil {
		return nil, domain.ErrInvalidInput
	}

	petUUID, err := uuid.Parse(req.PetID)
	if err != nil {
		return nil, domain.ErrInvalidInput
	}

	// Validamos que el status sea uno de los valores permitidos
	validStatuses := map[string]bool{"lost": true, "found": true, "sighting": true}
	if !validStatuses[req.Status] {
		return nil, domain.ErrInvalidStatus
	}

	report := &domain.Report{
		PetID:               petUUID,
		ReporterID:          reporterUUID,
		Status:              req.Status,
		Latitude:            req.Latitude,
		Longitude:           req.Longitude,
		LocationDescription: req.LocationDescription,
	}

	if err := s.repo.Create(report); err != nil {
		return nil, err
	}

	// Recargamos con relaciones para tener Pet y Reporter en la respuesta
	loaded, err := s.repo.FindByID(report.ID.String())
	if err != nil {
		return nil, err
	}

	// Si el reporte indica que la mascota fue encontrada o perdida, sincronizamos
	// el status del pet para que los stats y el feed reflejen el estado real.
	// "sighting" es solo un avistamiento — no cambia el status del pet.
	if req.Status == "found" || req.Status == "lost" {
		pet := loaded.Pet
		pet.Status = req.Status
		// fallo silencioso — el reporte ya fue creado correctamente
		_ = s.petRepo.Update(&pet)
	}

	// Publicamos el evento de forma secundaria — un fallo aquí no falla el request
	if s.eventBus != nil {
		s.eventBus.Publish("report.created", event.ReportCreatedEvent{
			ReportID:   loaded.ID,
			PetID:      loaded.PetID,
			ReporterID: loaded.ReporterID,
			PetOwnerID: loaded.Pet.OwnerID,
			PetName:    loaded.Pet.Name,
			Status:     loaded.Status,
		})
	}

	return loaded, nil
}

// GetReportByID busca un reporte por ID.
func (s *reportService) GetReportByID(id string) (*domain.Report, error) {
	return s.repo.FindByID(id)
}

// GetReportsByPet devuelve todos los reportes de una mascota.
func (s *reportService) GetReportsByPet(petID string) ([]domain.Report, error) {
	return s.repo.FindByPetID(petID)
}

// GetNearbyReports busca reportes cercanos a una ubicación.
// El radio por defecto es 5000 metros (5km) si no se especifica.
func (s *reportService) GetNearbyReports(lat, lng float64, radiusMeters float64) ([]domain.Report, error) {
	if radiusMeters <= 0 {
		radiusMeters = 5000
	}
	return s.repo.FindNearby(lat, lng, radiusMeters)
}
