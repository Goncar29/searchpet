package service

import (
	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/dto"
	"lost-pets/internal/event"
	"lost-pets/internal/repository"
)

// PetService define el CONTRATO de la capa de negocio para mascotas.
type PetService interface {
	CreatePet(ownerID string, req CreatePetRequest) (*domain.Pet, error)
	GetPetByID(id string) (*domain.Pet, error)
	GetMyPets(ownerID string) ([]domain.Pet, error)
	UpdatePet(ownerID string, petID string, req UpdatePetRequest) (*domain.Pet, error)
	DeletePet(ownerID string, petID string) error
	MarkAsFound(ownerID string, petID string) (*domain.Pet, error)
	// SearchPets aplica filtros opcionales y devuelve resultados paginados.
	SearchPets(filters dto.PetSearchFilters) (dto.PetSearchResponse, error)
}

// CreatePetRequest contiene los datos para crear una mascota.
// Es el input que viene del Handler — ya parseado, listo para usar.
type CreatePetRequest struct {
	Name        string `json:"name"`
	Type        string `json:"type"`
	Breed       string `json:"breed"`
	Color       string `json:"color"`
	Description string `json:"description"`
	Gender      string `json:"gender"`
	MicrochipID *string `json:"microchip_id"`
}

// UpdatePetRequest contiene los datos para actualizar una mascota.
type UpdatePetRequest struct {
	Name        string `json:"name"`
	Breed       string `json:"breed"`
	Color       string `json:"color"`
	Description string `json:"description"`
	Status      string `json:"status"`
}

// petService es la implementación concreta del PetService.
type petService struct {
	repo     repository.PetRepository
	eventBus *event.EventBus
}

// NewPetService es el constructor — recibe el repository, el bus de eventos y devuelve el service.
// eventBus es opcional — si es nil, los eventos no se publican.
func NewPetService(repo repository.PetRepository, eventBus *event.EventBus) PetService {
	return &petService{repo: repo, eventBus: eventBus}
}

// CreatePet crea una nueva mascota para el usuario autenticado.
func (s *petService) CreatePet(ownerID string, req CreatePetRequest) (*domain.Pet, error) {
	// Parseamos el UUID del owner
	ownerUUID, err := uuid.Parse(ownerID)
	if err != nil {
		return nil, domain.ErrInvalidInput
	}

	// Construimos la entidad Pet
	pet := &domain.Pet{
		OwnerID:     ownerUUID,
		Name:        req.Name,
		Type:        req.Type,
		Breed:       req.Breed,
		Color:       req.Color,
		Description: req.Description,
		Gender:      req.Gender,
		MicrochipID: req.MicrochipID,
		Status:      "active",
	}

	// Delegamos al repository — el service no sabe nada de SQL
	if err := s.repo.Create(pet); err != nil {
		return nil, err
	}

	// Recargamos la mascota con el owner para que el DTO tenga owner_name
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
func (s *petService) UpdatePet(ownerID string, petID string, req UpdatePetRequest) (*domain.Pet, error) {
	// Buscamos la mascota
	pet, err := s.repo.FindByID(petID)
	if err != nil {
		return nil, err
	}

	// LÓGICA DE NEGOCIO: solo el dueño puede editar su mascota
	if pet.OwnerID.String() != ownerID {
		return nil, domain.ErrForbidden
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
	}

	if err := s.repo.Update(pet); err != nil {
		return nil, err
	}

	return pet, nil
}

// DeletePet elimina una mascota — verifica que el usuario sea el dueño.
func (s *petService) DeletePet(ownerID string, petID string) error {
	// Buscamos la mascota primero para verificar ownership
	pet, err := s.repo.FindByID(petID)
	if err != nil {
		return err
	}

	// LÓGICA DE NEGOCIO: solo el dueño puede eliminar su mascota
	if pet.OwnerID.String() != ownerID {
		return domain.ErrForbidden
	}

	return s.repo.Delete(petID)
}

// SearchPets aplica filtros opcionales y devuelve una respuesta paginada.
// Llama al repositorio, mapea los resultados a DTOs y construye PetSearchResponse.
func (s *petService) SearchPets(filters dto.PetSearchFilters) (dto.PetSearchResponse, error) {
	pets, total, err := s.repo.Search(filters)
	if err != nil {
		return dto.PetSearchResponse{}, err
	}

	page := filters.Page
	if page < 1 {
		page = 1
	}
	limit := filters.Limit
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

// MarkAsFound marca una mascota como encontrada.
// Solo el dueño puede llamar este método.
// Si el status ya es "found", es idempotente — retorna 200 sin error.
// Si el status es "archived", retorna ErrPetArchived (409).
func (s *petService) MarkAsFound(ownerID string, petID string) (*domain.Pet, error) {
	pet, err := s.repo.FindByID(petID)
	if err != nil {
		return nil, err
	}

	// LÓGICA DE NEGOCIO: solo el dueño puede marcar su mascota como encontrada
	if pet.OwnerID.String() != ownerID {
		return nil, domain.ErrForbidden
	}

	// 409: no se puede marcar como encontrada una mascota archivada
	if pet.Status == "archived" {
		return nil, domain.ErrPetArchived
	}

	// Idempotente: si ya está en found, retornamos la mascota sin error
	if pet.Status == "found" {
		return pet, nil
	}

	// Actualizamos el status
	if err := s.repo.UpdateStatus(petID, "found"); err != nil {
		return nil, err
	}

	pet.Status = "found"

	// Publicamos el evento en el bus (fire-and-forget, no bloquea)
	if s.eventBus != nil {
		ownerUUID, _ := uuid.Parse(ownerID)
		s.eventBus.Publish("pet.found", event.PetFoundEvent{
			PetID:   pet.ID,
			OwnerID: ownerUUID,
			PetName: pet.Name,
		})
	}

	return pet, nil
}
