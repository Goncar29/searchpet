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
	// SearchPets aplica filtros opcionales y devuelve resultados paginados.
	SearchPets(criteria domain.PetSearchCriteria) (dto.PetSearchResponse, error)
}

// petService es la implementación concreta del PetService.
type petService struct {
	repo         repository.PetRepository
	eventBus     *event.EventBus
	photoService PhotoService
	reportRepo   repository.ReportRepository
}

// NewPetService es el constructor — recibe el repository, el bus de eventos, el servicio de fotos y el report repository.
// eventBus es opcional — si es nil, los eventos no se publican.
// photoService es opcional — si es nil, la eliminación en cascada de fotos se omite.
// reportRepo es opcional — si es nil, el closure report en MarkAsFound se omite.
func NewPetService(repo repository.PetRepository, eventBus *event.EventBus, photoService PhotoService, reportRepo repository.ReportRepository) PetService {
	return &petService{repo: repo, eventBus: eventBus, photoService: photoService, reportRepo: reportRepo}
}

// CreatePet crea una nueva mascota para el usuario autenticado.
// Status defaults to PetStatusRegistered.
// If req.Status == PetStatusStray, OwnerID is nil (stray pet with no owner).
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

	if err := s.repo.Create(pet); err != nil {
		return nil, err
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
