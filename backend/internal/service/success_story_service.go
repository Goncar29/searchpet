package service

import (
	"context"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/dto"
	"lost-pets/internal/repository"
)

type successStoryService struct {
	repo repository.SuccessStoryRepository
}

// NewSuccessStoryService construye el SuccessStoryService con sus dependencias.
func NewSuccessStoryService(repo repository.SuccessStoryRepository) SuccessStoryService {
	return &successStoryService{repo: repo}
}

// Create crea una nueva historia de éxito.
func (s *successStoryService) Create(ctx context.Context, userID uuid.UUID, req dto.CreateStoryRequest) (*domain.SuccessStory, error) {
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

// GetByID obtiene una historia por su ID.
func (s *successStoryService) GetByID(ctx context.Context, id uuid.UUID) (*domain.SuccessStory, error) {
	return s.repo.GetByID(ctx, id)
}

// List retorna historias con filtro opcional de featured.
func (s *successStoryService) List(ctx context.Context, featured *bool, limit, offset int) ([]domain.SuccessStory, error) {
	return s.repo.GetAll(ctx, featured, limit, offset)
}

// Like incrementa el like_count de forma atómica.
func (s *successStoryService) Like(ctx context.Context, id uuid.UUID) error {
	return s.repo.IncrementLikes(ctx, id)
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
