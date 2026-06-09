package service

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"time"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/event"
	"lost-pets/internal/repository"
)

// ShareLinkService define el CONTRATO de la capa de negocio para links compartibles.
type ShareLinkService interface {
	Generate(ctx context.Context, petID string, ownerID string) (*domain.ShareLink, error)
	GetByToken(ctx context.Context, token string) (*domain.ShareLink, error)
	TrackContact(ctx context.Context, token string) error
}

// shareLinkService es la implementación concreta del ShareLinkService.
type shareLinkService struct {
	shareLinkRepo repository.ShareLinkRepository
	petRepo       repository.PetRepository
	bus           *event.EventBus
}

// NewShareLinkService construye el ShareLinkService con sus dependencias.
// bus puede ser nil: si es nil no se publican eventos (defensivo).
func NewShareLinkService(
	shareLinkRepo repository.ShareLinkRepository,
	petRepo repository.PetRepository,
	bus *event.EventBus,
) ShareLinkService {
	return &shareLinkService{
		shareLinkRepo: shareLinkRepo,
		petRepo:       petRepo,
		bus:           bus,
	}
}

// Generate crea un nuevo share link para una mascota.
// REGLAS DE NEGOCIO:
// 1. La mascota debe existir → ErrPetNotFound
// 2. El ownerID debe coincidir con pet.OwnerID → ErrNotPetOwner
// 3. Token = 16 bytes de crypto/rand codificados en hex (32 chars)
// 4. ExpiresAt = ahora + 30 días
func (s *shareLinkService) Generate(ctx context.Context, petID string, ownerID string) (*domain.ShareLink, error) {
	pet, err := s.petRepo.FindByID(petID)
	if err != nil {
		return nil, err
	}

	// REGLA: solo el dueño puede generar un share link (stray pets have no owner)
	if pet.OwnerID == nil || pet.OwnerID.String() != ownerID {
		return nil, domain.ErrNotPetOwner
	}

	// Generar token criptográficamente seguro
	tokenBytes := make([]byte, 16)
	if _, err := rand.Read(tokenBytes); err != nil {
		return nil, domain.ErrInternal
	}
	token := hex.EncodeToString(tokenBytes)

	petUUID, err := uuid.Parse(petID)
	if err != nil {
		return nil, domain.ErrInvalidInput
	}

	expiresAt := time.Now().Add(30 * 24 * time.Hour)

	link := &domain.ShareLink{
		PetID:      petUUID,
		ShareToken: token,
		ExpiresAt:  &expiresAt,
	}

	if err := s.shareLinkRepo.Create(ctx, link); err != nil {
		return nil, err
	}

	// Publicar evento share.created solo si el bus está disponible y el DB write fue exitoso.
	if s.bus != nil {
		ownerUUID, err := uuid.Parse(ownerID)
		if err == nil {
			s.bus.Publish("share.created", event.ShareCreatedEvent{
				UserID: ownerUUID,
				PetID:  petUUID,
			})
		}
	}

	return link, nil
}

// GetByToken obtiene un share link por su token.
// REGLAS:
// 1. Incrementa view_count antes de retornar
// 2. Si ExpiresAt != nil y ya pasó → ErrShareLinkExpired (410)
func (s *shareLinkService) GetByToken(ctx context.Context, token string) (*domain.ShareLink, error) {
	// Primero obtenemos el link para tener su ID
	link, err := s.shareLinkRepo.GetByToken(ctx, token)
	if err != nil {
		return nil, err
	}

	// Verificar expiración antes de incrementar (no contamos vistas a links expirados)
	if link.ExpiresAt != nil && time.Now().After(*link.ExpiresAt) {
		return nil, domain.ErrShareLinkExpired
	}

	// Incrementar view_count de forma atómica
	if err := s.shareLinkRepo.IncrementViewCount(ctx, link.ID); err != nil {
		return nil, err
	}

	// Actualizar el count en memoria para reflejarlo en la respuesta
	link.ViewCount++

	return link, nil
}

// TrackContact registra un click en "Contactar" para un share link.
func (s *shareLinkService) TrackContact(ctx context.Context, token string) error {
	link, err := s.shareLinkRepo.GetByToken(ctx, token)
	if err != nil {
		return err
	}

	return s.shareLinkRepo.IncrementClickedContact(ctx, link.ID)
}
