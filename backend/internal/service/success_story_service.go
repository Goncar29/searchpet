package service

import (
	"context"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/dto"
	"lost-pets/internal/repository"
)

type successStoryService struct {
	repo    repository.SuccessStoryRepository
	petRepo repository.PetRepository
}

// NewSuccessStoryService construye el SuccessStoryService con sus dependencias.
func NewSuccessStoryService(repo repository.SuccessStoryRepository, petRepo repository.PetRepository) SuccessStoryService {
	return &successStoryService{repo: repo, petRepo: petRepo}
}

// Create crea una nueva historia de éxito.
// Verifica que la mascota exista y tenga status "found" antes de crear.
func (s *successStoryService) Create(ctx context.Context, userID uuid.UUID, req dto.CreateStoryRequest) (*domain.SuccessStory, error) {
	pet, err := s.petRepo.FindByID(req.PetID.String())
	if err != nil {
		if err == domain.ErrPetNotFound {
			return nil, domain.ErrPetNotFound
		}
		return nil, err
	}

	// Authorization — only the user who manages the pet may write its story:
	// the owner for owned pets, the reporter for strays (which have no owner).
	if !canManagePet(pet, userID.String()) {
		return nil, domain.ErrForbidden
	}

	if pet.Status != "found" {
		return nil, domain.ErrPetNotFoundStatus
	}

	story := &domain.SuccessStory{
		PetID:       req.PetID,
		UserID:      userID,
		Title:       req.Title,
		Body:        req.Body,
		PhotoBefore: req.PhotoBefore,
		PhotoAfter:  req.PhotoAfter,
		LikeCount:   0,
		Featured:    false,
	}

	if err := s.repo.Create(ctx, story); err != nil {
		return nil, err
	}

	return s.repo.GetByID(ctx, story.ID)
}

// GetByPetID obtiene la historia de éxito asociada a una mascota.
// Retorna nil, nil si no existe ninguna historia para esa mascota.
func (s *successStoryService) GetByPetID(ctx context.Context, petID uuid.UUID) (*domain.SuccessStory, error) {
	return s.repo.GetByPetID(ctx, petID)
}

// GetByID obtiene una historia por su ID.
func (s *successStoryService) GetByID(ctx context.Context, id uuid.UUID) (*domain.SuccessStory, error) {
	return s.repo.GetByID(ctx, id)
}

// List retorna historias con filtro opcional de featured.
func (s *successStoryService) List(ctx context.Context, featured *bool, limit, offset int) ([]domain.SuccessStory, error) {
	return s.repo.GetAll(ctx, featured, limit, offset)
}

// Like asegura que el usuario tenga un like en la historia (idempotente).
// Siempre retorna liked=true en éxito, sin importar si ya existía el like.
func (s *successStoryService) Like(ctx context.Context, storyID, userID uuid.UUID) (int, bool, error) {
	_, count, err := s.repo.AddLike(ctx, storyID, userID)
	if err != nil {
		return 0, false, err
	}
	return count, true, nil
}

// Unlike asegura que el usuario no tenga un like en la historia (idempotente).
// Siempre retorna liked=false en éxito, sin importar si el like existía.
func (s *successStoryService) Unlike(ctx context.Context, storyID, userID uuid.UUID) (int, bool, error) {
	_, count, err := s.repo.RemoveLike(ctx, storyID, userID)
	if err != nil {
		return 0, false, err
	}
	return count, false, nil
}

// LikedStoryIDs retorna el subconjunto de storyIDs que userID likeó.
func (s *successStoryService) LikedStoryIDs(ctx context.Context, userID uuid.UUID, storyIDs []uuid.UUID) (map[uuid.UUID]bool, error) {
	return s.repo.LikedStoryIDs(ctx, userID, storyIDs)
}

// SetFeatured marca o desmarca la historia como featured (solo admin — enforced en handler).
// Persiste featuredBy para auditoría.
func (s *successStoryService) SetFeatured(ctx context.Context, id uuid.UUID, featured bool, adminID uuid.UUID) error {
	return s.repo.SetFeatured(ctx, id, featured, adminID)
}

// Delete hace soft-delete de la historia.
// REGLA: solo el dueño o un admin puede borrar.
func (s *successStoryService) Delete(ctx context.Context, id uuid.UUID, callerID uuid.UUID, isAdmin bool) error {
	story, err := s.repo.GetByID(ctx, id)
	if err != nil {
		return err
	}

	if !isAdmin && story.UserID != callerID {
		return domain.ErrForbidden
	}

	return s.repo.Delete(ctx, id)
}
