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
	GetOrCreatePublicLink(ctx context.Context, petID string) (*domain.ShareLink, error)
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

	// REGLA: el dueño (o el reporter, si es un stray) puede generar el share link.
	// Compartir es clave para encontrar al animal — los strays deben ser compartibles.
	if !canManagePet(pet, ownerID) {
		return nil, domain.ErrNotPetOwner
	}

	// Generar token criptográficamente seguro
	token, err := newShareToken()
	if err != nil {
		return nil, err
	}

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

// GetOrCreatePublicLink devuelve el share link de una mascota lost/stray sin
// requerir autenticación, creándolo si todavía no existe.
//
// REGLAS DE NEGOCIO:
//  1. La mascota debe existir → ErrPetNotFound
//  2. Guarda de status: solo lost/stray son compartibles públicamente (son las
//     que están en búsqueda activa). Para cualquier otro status devolvemos
//     ErrPetNotFound (404) — no filtramos si la mascota existe.
//  3. IDEMPOTENTE: si ya hay un link, se devuelve el más reciente en vez de
//     crear otra fila. Esto acota el spam de links por usuarios anónimos.
//     Para lost/stray los links no vencen (ver GetByToken), así que cualquier
//     link existente sigue siendo válido.
func (s *shareLinkService) GetOrCreatePublicLink(ctx context.Context, petID string) (*domain.ShareLink, error) {
	pet, err := s.petRepo.FindByID(petID)
	if err != nil {
		return nil, err
	}

	if pet.Status != domain.PetStatusLost && pet.Status != domain.PetStatusStray {
		return nil, domain.ErrPetNotFound
	}

	petUUID, err := uuid.Parse(petID)
	if err != nil {
		return nil, domain.ErrInvalidInput
	}

	existing, err := s.shareLinkRepo.GetByPetID(ctx, petUUID)
	if err != nil {
		return nil, err
	}
	if len(existing) > 0 {
		return &existing[0], nil
	}

	token, err := newShareToken()
	if err != nil {
		return nil, err
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

	return link, nil
}

// newShareToken genera un token criptográficamente seguro (16 bytes → 32 hex chars).
func newShareToken() (string, error) {
	tokenBytes := make([]byte, 16)
	if _, err := rand.Read(tokenBytes); err != nil {
		return "", domain.ErrInternal
	}
	return hex.EncodeToString(tokenBytes), nil
}

// GetByToken obtiene un share link por su token.
// REGLAS:
// 1. Incrementa view_count antes de retornar
// 2. Mientras la mascota siga en búsqueda activa (lost/stray) el link NO vence:
//    los QR impresos en volantes deben funcionar durante toda la búsqueda
// 3. Si la búsqueda terminó y ExpiresAt ya pasó → ErrShareLinkExpired (410)
func (s *shareLinkService) GetByToken(ctx context.Context, token string) (*domain.ShareLink, error) {
	// Primero obtenemos el link para tener su ID
	link, err := s.shareLinkRepo.GetByToken(ctx, token)
	if err != nil {
		return nil, err
	}

	// Verificar expiración antes de incrementar (no contamos vistas a links expirados)
	activeSearch := link.Pet.Status == domain.PetStatusLost || link.Pet.Status == domain.PetStatusStray
	if !activeSearch && link.ExpiresAt != nil && time.Now().After(*link.ExpiresAt) {
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
