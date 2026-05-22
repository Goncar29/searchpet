package service

import (
	"context"
	"strings"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/dto"
	"lost-pets/internal/event"
	"lost-pets/internal/repository"
)

// reviewService implementa ReviewService.
type reviewService struct {
	reviewRepo  repository.UserReviewRepository
	blockedRepo repository.BlockedUserRepository
	userRepo    repository.UserRepository
	bus         *event.EventBus
}

// NewReviewService construye el ReviewService con sus dependencias.
func NewReviewService(
	reviewRepo repository.UserReviewRepository,
	blockedRepo repository.BlockedUserRepository,
	userRepo repository.UserRepository,
	bus *event.EventBus,
) ReviewService {
	return &reviewService{
		reviewRepo:  reviewRepo,
		blockedRepo: blockedRepo,
		userRepo:    userRepo,
		bus:         bus,
	}
}

// Create crea una reseña del reviewerID al revieweeID.
// Aplica guards: self-review, blocked, duplicate, stars range, text vacío.
func (s *reviewService) Create(ctx context.Context, reviewerID, revieweeID uuid.UUID, req dto.CreateReviewRequest) (*dto.ReviewResponse, error) {
	// Guard: self-review — sin DB call
	if reviewerID == revieweeID {
		return nil, domain.ErrSelfReview
	}

	// Guard: validación de input (belt-and-suspenders — el binding del DTO también valida)
	if req.Stars < 1 || req.Stars > 5 {
		return nil, domain.ErrInvalidInput
	}
	if strings.TrimSpace(req.Text) == "" {
		return nil, domain.ErrInvalidInput
	}

	// Guard: el reviewee debe existir
	_, err := s.userRepo.GetByID(ctx, revieweeID)
	if err != nil {
		return nil, err // propaga ErrUserNotFound
	}

	// Guard: usuarios bloqueados no pueden reseñarse entre sí
	blocked, err := s.blockedRepo.IsBlocked(ctx, reviewerID, revieweeID)
	if err != nil {
		return nil, err
	}
	if blocked {
		return nil, domain.ErrUserBlocked
	}

	// Guard: reseña duplicada — mejor UX que esperar el error de unique constraint
	_, err = s.reviewRepo.FindByReviewerAndReviewee(ctx, reviewerID, revieweeID)
	if err == nil {
		// Encontró una reseña existente
		return nil, domain.ErrAlreadyReviewed
	}
	if err != domain.ErrReviewNotFound {
		// Error real de BD
		return nil, err
	}

	review := &domain.UserReview{
		ReviewerID: reviewerID,
		RevieweeID: revieweeID,
		Stars:      req.Stars,
		Text:       req.Text,
	}

	if err := s.reviewRepo.Create(ctx, review); err != nil {
		return nil, err
	}

	// Publicar evento para que GamificationService otorgue puntos al reviewee
	s.bus.Publish("review.created", event.ReviewCreatedEvent{
		ReviewID:   review.ID,
		ReviewerID: reviewerID,
		RevieweeID: revieweeID,
	})

	// Precargar el reviewer para poblar el DTO de respuesta
	reviewer, _ := s.userRepo.GetByID(ctx, reviewerID)
	if reviewer != nil {
		review.Reviewer = *reviewer
	}

	resp := dto.MapReviewToResponse(review)
	return &resp, nil
}

// Update actualiza los campos mutables de la reseña existente para el par (reviewerID, revieweeID).
func (s *reviewService) Update(ctx context.Context, reviewerID, revieweeID uuid.UUID, req dto.UpdateReviewRequest) (*dto.ReviewResponse, error) {
	existing, err := s.reviewRepo.FindByReviewerAndReviewee(ctx, reviewerID, revieweeID)
	if err != nil {
		return nil, err // propaga ErrReviewNotFound
	}

	// Verificar propiedad: solo el reviewer original puede actualizar
	if existing.ReviewerID != reviewerID {
		return nil, domain.ErrForbidden
	}

	// Actualizar solo los campos presentes en el request
	if req.Stars != nil {
		if *req.Stars < 1 || *req.Stars > 5 {
			return nil, domain.ErrInvalidInput
		}
		existing.Stars = *req.Stars
	}
	if req.Text != nil {
		if strings.TrimSpace(*req.Text) == "" {
			return nil, domain.ErrInvalidInput
		}
		existing.Text = *req.Text
	}

	if err := s.reviewRepo.Update(ctx, existing); err != nil {
		return nil, err
	}

	// Precargar reviewer para el DTO
	reviewer, _ := s.userRepo.GetByID(ctx, reviewerID)
	if reviewer != nil {
		existing.Reviewer = *reviewer
	}

	resp := dto.MapReviewToResponse(existing)
	return &resp, nil
}

// GetByReviewee retorna las reseñas paginadas para un usuario.
// CRITICAL-2: verifica que el reviewee exista antes de consultar reseñas.
// CRITICAL-1: retorna Total, Page y PageSize en el response.
func (s *reviewService) GetByReviewee(ctx context.Context, revieweeID uuid.UUID, pageSize, offset int) (*dto.ReviewListResponse, error) {
	if pageSize <= 0 {
		pageSize = 20
	}
	if pageSize > 100 {
		pageSize = 100
	}

	// CRITICAL-2: verificar que el reviewee exista
	_, err := s.userRepo.GetByID(ctx, revieweeID)
	if err != nil {
		return nil, err // propaga ErrUserNotFound → handler mapea a 404
	}

	reviews, err := s.reviewRepo.FindByReviewee(ctx, revieweeID, pageSize, offset)
	if err != nil {
		return nil, err
	}

	_, total, err := s.reviewRepo.GetAverageRating(ctx, revieweeID)
	if err != nil {
		return nil, err
	}

	// Calcular page a partir de offset y pageSize
	page := 1
	if pageSize > 0 && offset >= 0 {
		page = (offset / pageSize) + 1
	}

	items := make([]dto.ReviewResponse, 0, len(reviews))
	for i := range reviews {
		items = append(items, dto.MapReviewToResponse(&reviews[i]))
	}

	return &dto.ReviewListResponse{
		Reviews:  items,
		Total:    total,
		Page:     page,
		PageSize: pageSize,
	}, nil
}
