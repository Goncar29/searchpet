package service

import (
	"context"
	"log"
	"time"

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
	// VerifyReport marca un reporte como verificado (admin-only, enforced en handler).
	VerifyReport(ctx context.Context, reportID, adminID uuid.UUID) error
	// Delete removes a report (admin moderation; admin enforcement is in the handler).
	Delete(ctx context.Context, id uuid.UUID) error
}

// CreateReportRequest contiene los datos para crear un reporte.
type CreateReportRequest struct {
	PetID               string     `json:"pet_id" binding:"required"`
	Status              string     `json:"status" binding:"required"` // lost, found, sighting
	Latitude            float64    `json:"latitude" binding:"required"`
	Longitude           float64    `json:"longitude" binding:"required"`
	LocationDescription string     `json:"location_description"`
	OccurredAt          *time.Time `json:"occurred_at"` // opcional; si viene no puede ser futuro
}

// reportService es la implementación concreta del ReportService.
type reportService struct {
	repo       repository.ReportRepository
	petRepo    repository.PetRepository
	eventBus   *event.EventBus
	statEvents repository.StatEventRepository
}

// NewReportService es el constructor.
// eventBus es opcional — si es nil, los eventos no se publican (zero behavior change).
// statEvents es opcional — si es nil, los eventos de impacto (lifetime ledger) no se registran.
func NewReportService(repo repository.ReportRepository, petRepo repository.PetRepository, eventBus *event.EventBus, statEvents repository.StatEventRepository) ReportService {
	return &reportService{repo: repo, petRepo: petRepo, eventBus: eventBus, statEvents: statEvents}
}

// recordStat appends a lifetime impact event synchronously, in-request.
// Best-effort: a failure is logged but never aborts the report the event
// describes. Mirrors petService.recordStat so both status-change entry points
// feed the same append-only ledger consistently (see stats_handler.go).
func (s *reportService) recordStat(eventType string, petID uuid.UUID) {
	if s.statEvents == nil {
		return
	}
	id := petID
	if err := s.statEvents.Record(context.Background(), eventType, &id); err != nil {
		log.Printf("[report_service] recordStat %s pet=%s: %v", eventType, petID, err)
	}
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

	// La fecha del avistamiento no puede ser futura
	if req.OccurredAt != nil && req.OccurredAt.After(time.Now()) {
		return nil, domain.ErrInvalidInput
	}

	report := &domain.Report{
		PetID:               petUUID,
		ReporterID:          reporterUUID,
		Status:              req.Status,
		Latitude:            req.Latitude,
		Longitude:           req.Longitude,
		LocationDescription: req.LocationDescription,
		OccurredAt:          req.OccurredAt,
	}

	if err := s.repo.Create(report); err != nil {
		return nil, err
	}

	// Recargamos con relaciones para tener Pet y Reporter en la respuesta
	loaded, err := s.repo.FindByID(report.ID.String())
	if err != nil {
		return nil, err
	}

	// Sincronizamos pet.status según el reporte:
	// "found"    → pet.status = "found"      (aparece en contador de encontrados)
	// "lost"     → pet.status = "lost"       (se volvió a perder, aparece en el feed)
	// "sighting" → sin cambio
	//
	// loaded refleja el estado ANTERIOR al UpdateStatus (se cargó arriba), así que
	// oldStatus permite gatear el lifetime ledger por TRANSICIÓN — igual que PetService.
	// Este es el único camino normal para marcar perdido (el botón "Reportar perdido"
	// de MyPets pasa por acá, no por PetService), por eso debe registrar el evento.
	// Un "sighting" NO cuenta: es la misma búsqueda ya iniciada.
	oldStatus := loaded.Pet.Status
	switch req.Status {
	case "found":
		_ = s.petRepo.UpdateStatus(req.PetID, domain.PetStatusFound)
		// Cada transición hacia "found" es un reencuentro: cuenta el episodio y
		// publica pet.found — el MISMO evento de dominio que emite PetService, para
		// que este camino (botón "Reportar encontrado") no se saltee la gamificación
		// (badge al héroe), la notificación al dueño ni la limpieza del embedding CLIP.
		if oldStatus != domain.PetStatusFound {
			s.recordStat(domain.StatEventPetFound, loaded.PetID)
			if s.eventBus != nil {
				// OwnerID es nil-safe: los strays no tienen dueño.
				var eventOwnerID uuid.UUID
				if loaded.Pet.OwnerID != nil {
					eventOwnerID = *loaded.Pet.OwnerID
				}
				s.eventBus.Publish("pet.found", event.PetFoundEvent{
					PetID:   loaded.PetID,
					OwnerID: eventOwnerID,
					PetName: loaded.Pet.Name,
				})
			}
		}
	case "lost":
		_ = s.petRepo.UpdateStatus(req.PetID, domain.PetStatusLost)
		// Transición hacia "lost" abre una nueva búsqueda. Excluimos lost/stray
		// previos: ya son una búsqueda activa, no un episodio nuevo (re-pérdida
		// found→lost sí cuenta). Publica pet.lost para RE-INDEXAR los embeddings
		// CLIP: una mascota encontrada tiene sus embeddings borrados (HandlePetFound),
		// así que sin esto una re-pérdida quedaría invisible en la búsqueda por imagen.
		if oldStatus != domain.PetStatusLost && oldStatus != domain.PetStatusStray {
			s.recordStat(domain.StatEventSearchStarted, loaded.PetID)
			if s.eventBus != nil {
				s.eventBus.Publish("pet.lost", event.PetLostEvent{PetID: loaded.PetID})
			}
		}
	}

	// Publicamos el evento de forma secundaria — un fallo aquí no falla el request
	if s.eventBus != nil {
		// Pet.OwnerID is a pointer (nil for stray pets) — dereference safely
		var petOwnerID uuid.UUID
		if loaded.Pet.OwnerID != nil {
			petOwnerID = *loaded.Pet.OwnerID
		}
		s.eventBus.Publish("report.created", event.ReportCreatedEvent{
			ReportID:   loaded.ID,
			PetID:      loaded.PetID,
			ReporterID: loaded.ReporterID,
			PetOwnerID: petOwnerID,
			PetName:    loaded.Pet.Name,
			PetType:    loaded.Pet.Type,
			Status:     loaded.Status,
			Lat:        loaded.Latitude,
			Lng:        loaded.Longitude,
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
// El radio debe ser provisto por el caller (ver ReportHandler para la lógica de precedencia).
func (s *reportService) GetNearbyReports(lat, lng float64, radiusMeters float64) ([]domain.Report, error) {
	return s.repo.FindNearby(lat, lng, radiusMeters)
}

// VerifyReport marca un reporte como verificado.
// Admin-only enforcement se hace en el handler mediante RequireAdmin middleware.
func (s *reportService) VerifyReport(ctx context.Context, reportID, adminID uuid.UUID) error {
	return s.repo.UpdateVerified(ctx, reportID, adminID)
}

// Delete elimina un reporte (acción de moderación admin).
// Admin-only enforcement se hace en el handler mediante RequireAdmin.
func (s *reportService) Delete(ctx context.Context, id uuid.UUID) error {
	return s.repo.Delete(ctx, id)
}
