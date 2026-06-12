package service

import (
	"log"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/dto"
	"lost-pets/internal/event"
	"lost-pets/internal/repository"
)

// PetService define el CONTRATO de la capa de negocio para mascotas.
type PetService interface {
	CreatePet(ownerID string, req dto.CreatePetRequest) (*domain.Pet, error)
	GetPetByID(id string) (*domain.Pet, error)
	GetMyPets(ownerID string) ([]domain.Pet, error)
	UpdatePet(ownerID string, petID string, req dto.UpdatePetRequest) (*domain.Pet, error)
	DeletePet(ownerID string, petID string) error
	MarkAsFound(ownerID string, petID string) (*domain.Pet, error)
	// PublishLost transitions an owned pet to "lost" and creates its initial
	// location report atomically. Returns ErrForbidden if the caller does not
	// own the pet, ErrInvalidStatusTransition if the pet's current status
	// cannot transition to "lost".
	PublishLost(ownerID string, petID string, req dto.PublishLostRequest) (*domain.Pet, error)
	// SearchPets aplica filtros opcionales y devuelve resultados paginados.
	SearchPets(criteria domain.PetSearchCriteria) (dto.PetSearchResponse, error)
}

// petService es la implementación concreta del PetService.
type petService struct {
	repo         repository.PetRepository
	eventBus     *event.EventBus
	photoService PhotoService
	reportRepo   repository.ReportRepository
	uow          repository.UnitOfWork
}

// NewPetService es el constructor — recibe el repository, el bus de eventos, el servicio de fotos,
// el report repository y el UnitOfWork (para operaciones transaccionales pet+report).
// eventBus es opcional — si es nil, los eventos no se publican.
// photoService es opcional — si es nil, la eliminación en cascada de fotos se omite.
// reportRepo es opcional — si es nil, el closure report en MarkAsFound se omite.
// uow es opcional en tests unitarios que no ejercitan el camino stray/publish-lost,
// pero requerido en producción para crear strays con initial_report (ver router.go).
func NewPetService(repo repository.PetRepository, eventBus *event.EventBus, photoService PhotoService, reportRepo repository.ReportRepository, uow repository.UnitOfWork) PetService {
	return &petService{repo: repo, eventBus: eventBus, photoService: photoService, reportRepo: reportRepo, uow: uow}
}

// CreatePet crea una nueva mascota para el usuario autenticado.
// Status defaults to PetStatusRegistered.
// If req.Status == PetStatusStray, OwnerID is nil (stray pet with no owner) and
// req.InitialReport is REQUIRED — a "sighting" report is created in the same
// transaction (400 initial_report_required if absent).
// If req.Status == PetStatusRegistered (or omitted), req.InitialReport is
// FORBIDDEN (400 initial_report_not_allowed if present) — registered pets are
// not published and therefore carry no location report.
// Creating with lost/found/archived is rejected with ErrInvalidStatusTransition.
func (s *petService) CreatePet(ownerID string, req dto.CreatePetRequest) (*domain.Pet, error) {
	ownerUUID, err := uuid.Parse(ownerID)
	if err != nil {
		return nil, domain.ErrInvalidInput
	}

	// Determine status — default to registered
	status := domain.PetStatusRegistered
	if req.Status != "" {
		status = req.Status
	}

	// Only registered and stray are valid at creation
	if status != domain.PetStatusRegistered && status != domain.PetStatusStray {
		return nil, domain.ErrInvalidStatusTransition
	}

	// initial_report rules: required for stray, forbidden for registered
	if status == domain.PetStatusStray && req.InitialReport == nil {
		return nil, domain.ErrInitialReportRequired
	}
	if status == domain.PetStatusRegistered && req.InitialReport != nil {
		return nil, domain.ErrInitialReportNotAllowed
	}

	// Stray pets have no owner; registered pets always have an owner
	var ownerPtr *uuid.UUID
	var reporterPtr *uuid.UUID
	if status == domain.PetStatusStray {
		// OwnerID stays nil; the authenticated user becomes the reporter
		reporterPtr = &ownerUUID
	} else {
		ownerPtr = &ownerUUID
	}

	pet := &domain.Pet{
		OwnerID:     ownerPtr,
		ReporterID:  reporterPtr,
		Name:        req.Name,
		Type:        req.Type,
		Breed:       req.Breed,
		Color:       req.Color,
		Description: req.Description,
		Gender:      req.Gender,
		MicrochipID: req.MicrochipID,
		Status:      status,
		Version:     1,
	}

	var report *domain.Report

	if status == domain.PetStatusStray {
		// Pet + initial report must be created atomically — a stray visible in
		// the public feed without a location report is corrupt data for a
		// map-centric product.
		if s.uow == nil {
			return nil, domain.ErrInternal
		}
		report = &domain.Report{
			PetID:               pet.ID,
			ReporterID:          ownerUUID,
			Status:              "sighting",
			Latitude:            req.InitialReport.Latitude,
			Longitude:           req.InitialReport.Longitude,
			LocationDescription: req.InitialReport.Note,
		}
		err := s.uow.Execute(func(tx repository.UnitOfWorkRepos) error {
			if err := tx.Pets.Create(pet); err != nil {
				return err
			}
			report.PetID = pet.ID
			return tx.Reports.Create(report)
		})
		if err != nil {
			return nil, err
		}
	} else {
		if err := s.repo.Create(pet); err != nil {
			return nil, err
		}
	}

	// Publicamos pet.stray cuando se crea una mascota callejera — EmbeddingService
	// se suscribe para backfillear embeddings (no-op si todavía no tiene fotos).
	if s.eventBus != nil && status == domain.PetStatusStray {
		s.eventBus.Publish("pet.stray", event.PetStrayEvent{PetID: pet.ID})

		// report.created — triggers nearby push notifications via NotificationService.
		// PetOwnerID is intentionally left as zero value: stray pets have no owner to notify.
		s.eventBus.Publish("report.created", event.ReportCreatedEvent{
			ReportID:   report.ID,
			PetID:      pet.ID,
			ReporterID: ownerUUID,
			PetName:    pet.Name,
			PetType:    pet.Type,
			Status:     "sighting",
			Lat:        req.InitialReport.Latitude,
			Lng:        req.InitialReport.Longitude,
		})
	}

	return s.repo.FindByID(pet.ID.String())
}

// GetPetByID busca una mascota por ID. Cualquiera puede ver una mascota.
func (s *petService) GetPetByID(id string) (*domain.Pet, error) {
	return s.repo.FindByID(id)
}

// GetMyPets devuelve todas las mascotas del usuario autenticado.
func (s *petService) GetMyPets(ownerID string) ([]domain.Pet, error) {
	return s.repo.FindByOwnerID(ownerID)
}

// UpdatePet actualiza una mascota — verifica que el usuario sea el dueño.
// Enforces state machine transitions and optimistic concurrency via Version field.
func (s *petService) UpdatePet(ownerID string, petID string, req dto.UpdatePetRequest) (*domain.Pet, error) {
	pet, err := s.repo.FindByID(petID)
	if err != nil {
		return nil, err
	}

	// LÓGICA DE NEGOCIO: solo el dueño puede editar su mascota
	if pet.OwnerID == nil || pet.OwnerID.String() != ownerID {
		return nil, domain.ErrForbidden
	}

	// Optimistic concurrency — reject if version has changed since the caller last read
	if req.Version != 0 && pet.Version != req.Version {
		return nil, domain.ErrConflict
	}

	// Capturamos el estado anterior antes de aplicar cambios (necesario para publicar pet.lost)
	oldStatus := pet.Status

	// State machine guard — validate transition before applying any changes
	if req.Status != "" && req.Status != pet.Status {
		if err := domain.ValidateTransition(pet.Status, req.Status); err != nil {
			return nil, err
		}
	}

	// Solo actualizamos los campos que vienen con valor
	if req.Name != "" {
		pet.Name = req.Name
	}
	if req.Breed != "" {
		pet.Breed = req.Breed
	}
	if req.Color != "" {
		pet.Color = req.Color
	}
	if req.Description != "" {
		pet.Description = req.Description
	}
	if req.Status != "" {
		pet.Status = req.Status
		// Increment version on status change
		pet.Version++
	}

	if err := s.repo.Update(pet); err != nil {
		return nil, err
	}

	// Publicamos pet.lost cuando la transición es hacia "lost"
	if s.eventBus != nil && oldStatus != domain.PetStatusLost && pet.Status == domain.PetStatusLost {
		s.eventBus.Publish("pet.lost", event.PetLostEvent{PetID: pet.ID})
	}

	// NOTE: there is no "pet.stray" publish here — the status machine (status_machine.go)
	// does not allow any transition INTO "stray" via UpdatePet (stray pets are only
	// created directly with status="stray", see CreatePet). The pet.stray event is
	// published from CreatePet instead.

	return pet, nil
}

// DeletePet elimina una mascota — verifica que el usuario sea el dueño.
// Antes de borrar el registro, elimina los assets de Cloudinary (cascade delete).
func (s *petService) DeletePet(ownerID string, petID string) error {
	pet, err := s.repo.FindByID(petID)
	if err != nil {
		return err
	}

	// LÓGICA DE NEGOCIO: solo el dueño puede eliminar su mascota
	if pet.OwnerID == nil || pet.OwnerID.String() != ownerID {
		return domain.ErrForbidden
	}

	// Cascade delete: eliminar fotos de Cloudinary antes de borrar el registro.
	if s.photoService != nil {
		if photoErr := s.photoService.DeleteByPetID(petID); photoErr != nil {
			log.Printf("[pet_service] Error eliminando fotos de mascota %s: %v", petID, photoErr)
		}
	}

	return s.repo.Delete(petID)
}

// SearchPets aplica filtros opcionales y devuelve una respuesta paginada.
func (s *petService) SearchPets(criteria domain.PetSearchCriteria) (dto.PetSearchResponse, error) {
	pets, total, err := s.repo.Search(criteria)
	if err != nil {
		return dto.PetSearchResponse{}, err
	}

	page := criteria.Page
	if page < 1 {
		page = 1
	}
	limit := criteria.Limit
	if limit < 1 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}

	data := dto.ToPetListResponse(pets)

	return dto.PetSearchResponse{
		Data:  data,
		Total: total,
		Page:  page,
		Limit: limit,
	}, nil
}

// MarkAsFound marca una mascota como encontrada usando el state machine.
// For owned pets: only the owner may call this.
// For stray pets: only the user who reported the stray (ReporterID) may call this.
func (s *petService) MarkAsFound(ownerID string, petID string) (*domain.Pet, error) {
	pet, err := s.repo.FindByID(petID)
	if err != nil {
		return nil, err
	}

	// Authorization check — differs for owned vs stray pets
	if pet.Status == domain.PetStatusStray {
		// Stray: only the reporter may mark as found
		if pet.ReporterID == nil || pet.ReporterID.String() != ownerID {
			return nil, domain.ErrForbidden
		}
	} else {
		// Owned pet: only the owner may mark as found
		if pet.OwnerID == nil || pet.OwnerID.String() != ownerID {
			return nil, domain.ErrForbidden
		}
	}

	// Validate state machine transition
	if err := domain.ValidateTransition(pet.Status, domain.PetStatusFound); err != nil {
		return nil, err
	}

	// Idempotent: if already found, return without error
	if pet.Status == domain.PetStatusFound {
		return pet, nil
	}

	if err := s.repo.UpdateStatus(petID, domain.PetStatusFound); err != nil {
		return nil, err
	}

	pet.Status = domain.PetStatusFound
	pet.Version++

	// Parseamos el UUID del owner para el closure report y el evento
	ownerUUID, _ := uuid.Parse(ownerID)

	// REQ-02: Auto-create closure report (best-effort — failure does not abort the status flip)
	if s.reportRepo != nil {
		closureReport := &domain.Report{
			PetID:               pet.ID,
			ReporterID:          ownerUUID,
			Status:              "found",
			LocationDescription: "Closure report",
		}
		if err := s.reportRepo.Create(closureReport); err != nil {
			log.Printf("[pet_service] Error creating closure report for pet %s: %v", petID, err)
		}
	}

	// Publicamos el evento en el bus
	if s.eventBus != nil {
		// Determine the actual owner UUID for the event — for stray it may be nil
		var eventOwnerID uuid.UUID
		if pet.OwnerID != nil {
			eventOwnerID = *pet.OwnerID
		}
		s.eventBus.Publish("pet.found", event.PetFoundEvent{
			PetID:   pet.ID,
			OwnerID: eventOwnerID,
			PetName: pet.Name,
		})
	}

	return pet, nil
}

// PublishLost transitions an owned, registered pet to "lost" and creates its
// initial location report in a single transaction. After commit, publishes
// pet.lost (CLIP embedding backfill) and report.created (nearby push notifications).
func (s *petService) PublishLost(ownerID string, petID string, req dto.PublishLostRequest) (*domain.Pet, error) {
	pet, err := s.repo.FindByID(petID)
	if err != nil {
		return nil, err
	}

	// Solo el dueño puede publicar su mascota como perdida
	if pet.OwnerID == nil || pet.OwnerID.String() != ownerID {
		return nil, domain.ErrForbidden
	}

	// Validar que la transición a "lost" sea permitida desde el status actual
	if err := domain.ValidateTransition(pet.Status, domain.PetStatusLost); err != nil {
		return nil, err
	}

	if s.uow == nil {
		return nil, domain.ErrInternal
	}

	ownerUUID, err := uuid.Parse(ownerID)
	if err != nil {
		return nil, domain.ErrInvalidInput
	}

	err = s.uow.Execute(func(tx repository.UnitOfWorkRepos) error {
		if err := tx.Pets.UpdateStatus(petID, domain.PetStatusLost); err != nil {
			return err
		}
		report := &domain.Report{
			PetID:               pet.ID,
			ReporterID:          ownerUUID,
			Status:              "lost",
			Latitude:            req.Latitude,
			Longitude:           req.Longitude,
			LocationDescription: req.Note,
		}
		return tx.Reports.Create(report)
	})
	if err != nil {
		return nil, err
	}

	pet.Status = domain.PetStatusLost
	pet.Version++

	// Publicamos los eventos DESPUÉS del commit — fallos aquí no afectan la transacción ya confirmada
	if s.eventBus != nil {
		s.eventBus.Publish("pet.lost", event.PetLostEvent{PetID: pet.ID})
		s.eventBus.Publish("report.created", event.ReportCreatedEvent{
			PetID:      pet.ID,
			ReporterID: ownerUUID,
			PetOwnerID: ownerUUID,
			PetName:    pet.Name,
			PetType:    pet.Type,
			Status:     "lost",
			Lat:        req.Latitude,
			Lng:        req.Longitude,
		})
	}

	return pet, nil
}
