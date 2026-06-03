package service

import (
	"context"
	"errors"
	"log"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/dto"
	"lost-pets/internal/event"
	"lost-pets/internal/repository"
)

// gamificationService implementa GamificationService.
// Escucha eventos del EventBus para otorgar puntos y badges de forma asíncrona,
// y expone endpoints síncronos para perfiles públicos y leaderboard.
type gamificationService struct {
	badgeRepo  repository.BadgeRepository
	pointsRepo repository.UserPointsRepository
	userRepo   repository.UserRepository
	reviewRepo repository.UserReviewRepository // V1.5 — para avg_rating en perfiles
}

// NewGamificationService construye el GamificationService con sus dependencias.
func NewGamificationService(
	badgeRepo repository.BadgeRepository,
	pointsRepo repository.UserPointsRepository,
	userRepo repository.UserRepository,
	reviewRepo repository.UserReviewRepository,
) *gamificationService {
	return &gamificationService{
		badgeRepo:  badgeRepo,
		pointsRepo: pointsRepo,
		userRepo:   userRepo,
		reviewRepo: reviewRepo,
	}
}

// RegisterListeners suscribe los handlers al EventBus.
// Debe llamarse una vez durante el arranque del servidor, después de crear el EventBus.
func (s *gamificationService) RegisterListeners(bus *event.EventBus) {
	bus.Subscribe("report.created", s.onReportCreated)
	bus.Subscribe("pet.found", s.onPetFound)
	bus.Subscribe("share.created", s.onShareCreated)
	bus.Subscribe("review.created", s.onReviewCreated)
	bus.Subscribe("user.verified", s.onUserVerified)
}

// onReportCreated maneja el evento "report.created".
// Suma 5 puntos al reporter e incrementa TotalReports.
// Si es el primer reporte, otorga el badge "first_helper".
func (s *gamificationService) onReportCreated(payload interface{}) {
	ev, ok := payload.(event.ReportCreatedEvent)
	if !ok {
		log.Printf("[GamificationService] onReportCreated: payload inesperado: %T", payload)
		return
	}

	ctx := context.Background()

	points, err := s.pointsRepo.Upsert(ctx, ev.ReporterID, 5, "total_reports")
	if err != nil {
		log.Printf("[GamificationService] onReportCreated: upsert points para %s: %v", ev.ReporterID, err)
		return
	}

	// Otorgar badge "first_helper" si es el primer reporte del usuario.
	// TotalReports ya fue incrementado a 1 si era el primero.
	if points.TotalReports == 1 {
		if err := s.AwardBadgeIfEligible(ctx, ev.ReporterID, "first_helper"); err != nil {
			log.Printf("[GamificationService] onReportCreated: award first_helper para %s: %v", ev.ReporterID, err)
		}
	}

	// Otorgar badge "community_guardian" al llegar a 10 reportes.
	if points.TotalReports >= 10 {
		if err := s.AwardBadgeIfEligible(ctx, ev.ReporterID, "community_guardian"); err != nil {
			log.Printf("[GamificationService] onReportCreated: award community_guardian para %s: %v", ev.ReporterID, err)
		}
	}
}

// onPetFound maneja el evento "pet.found".
// Suma 100 puntos al dueño, incrementa FoundCount, y otorga el badge "pet_rescuer".
func (s *gamificationService) onPetFound(payload interface{}) {
	ev, ok := payload.(event.PetFoundEvent)
	if !ok {
		log.Printf("[GamificationService] onPetFound: payload inesperado: %T", payload)
		return
	}

	ctx := context.Background()

	points, err := s.pointsRepo.Upsert(ctx, ev.OwnerID, 100, "found_count")
	if err != nil {
		log.Printf("[GamificationService] onPetFound: upsert points para %s: %v", ev.OwnerID, err)
		return
	}

	if err := s.AwardBadgeIfEligible(ctx, ev.OwnerID, "pet_rescuer"); err != nil {
		log.Printf("[GamificationService] onPetFound: award pet_rescuer para %s: %v", ev.OwnerID, err)
	}

	// Otorgar badge "super_finder" al llegar a 5 mascotas encontradas.
	if points.FoundCount >= 5 {
		if err := s.AwardBadgeIfEligible(ctx, ev.OwnerID, "super_finder"); err != nil {
			log.Printf("[GamificationService] onPetFound: award super_finder para %s: %v", ev.OwnerID, err)
		}
	}
}

// onShareCreated maneja el evento "share.created".
// Suma 2 puntos al sharer, incrementa ShareCount, y otorga el badge "social_butterfly" (idempotente).
func (s *gamificationService) onShareCreated(payload interface{}) {
	ev, ok := payload.(event.ShareCreatedEvent)
	if !ok {
		log.Printf("[GamificationService] onShareCreated: payload inesperado: %T", payload)
		return
	}

	ctx := context.Background()

	if _, err := s.pointsRepo.Upsert(ctx, ev.UserID, 2, "share_count"); err != nil {
		log.Printf("[GamificationService] onShareCreated: upsert points para %s: %v", ev.UserID, err)
		return
	}

	if err := s.AwardBadgeIfEligible(ctx, ev.UserID, "social_butterfly"); err != nil {
		log.Printf("[GamificationService] onShareCreated: award social_butterfly para %s: %v", ev.UserID, err)
	}
}

// onReviewCreated maneja el evento "review.created".
// Otorga 10 puntos al reviewee — recibir una reseña es la señal de confianza que se recompensa.
func (s *gamificationService) onReviewCreated(payload interface{}) {
	ev, ok := payload.(event.ReviewCreatedEvent)
	if !ok {
		log.Printf("[GamificationService] onReviewCreated: payload inesperado: %T", payload)
		return
	}

	ctx := context.Background()

	if _, err := s.pointsRepo.Upsert(ctx, ev.RevieweeID, 10, ""); err != nil {
		log.Printf("[GamificationService] onReviewCreated: upsert points para %s: %v", ev.RevieweeID, err)
	}
}

// onUserVerified maneja el evento "user.verified".
// Otorga el badge "verified_finder" al completar la verificación de identidad (OTP).
func (s *gamificationService) onUserVerified(payload interface{}) {
	ev, ok := payload.(event.UserVerifiedEvent)
	if !ok {
		log.Printf("[GamificationService] onUserVerified: payload inesperado: %T", payload)
		return
	}

	ctx := context.Background()

	if err := s.AwardBadgeIfEligible(ctx, ev.UserID, "verified_finder"); err != nil {
		log.Printf("[GamificationService] onUserVerified: award verified_finder para %s: %v", ev.UserID, err)
	}
}

// AwardBadgeIfEligible otorga un badge al usuario si no lo tiene ya.
// Es idempotente: retorna nil si el badge ya existe.
func (s *gamificationService) AwardBadgeIfEligible(ctx context.Context, userID uuid.UUID, badgeType string) error {
	has, err := s.badgeRepo.HasBadge(ctx, userID, badgeType)
	if err != nil {
		return err
	}
	if has {
		// Ya tiene el badge — idempotente, sin error.
		return nil
	}

	badge := &domain.Badge{
		UserID:    userID,
		BadgeType: badgeType,
	}
	err = s.badgeRepo.Create(ctx, badge)
	if err != nil {
		return err
	}
	return nil
}

// GetPublicProfile retorna el perfil público del usuario: nombre, ciudad, avatar,
// puntos y badges. No expone email ni password hash.
func (s *gamificationService) GetPublicProfile(ctx context.Context, userID uuid.UUID) (*dto.UserProfileResponse, error) {
	user, err := s.userRepo.GetByID(ctx, userID)
	if err != nil {
		return nil, err
	}

	// Puntos: manejar graciosamente el caso donde el usuario aún no tiene puntos.
	var pts, totalReports, foundCount, shareCount int
	points, err := s.pointsRepo.GetByUserID(ctx, userID)
	if err != nil {
		if !errors.Is(err, domain.ErrPointsNotFound) {
			return nil, err
		}
		// Sin puntos aún — usar ceros (valores ya inicializados en cero arriba).
	} else {
		pts = points.Points
		totalReports = points.TotalReports
		foundCount = points.FoundCount
		shareCount = points.ShareCount
	}

	badges, err := s.badgeRepo.FindByUserID(ctx, userID)
	if err != nil {
		return nil, err
	}

	badgeResponses := make([]dto.BadgeResponse, 0, len(badges))
	for _, b := range badges {
		badgeResponses = append(badgeResponses, dto.BadgeResponse{
			ID:        b.ID,
			BadgeType: b.BadgeType,
			EarnedAt:  b.EarnedAt,
		})
	}

	// V1.5 — Obtener promedio y cantidad de reseñas
	avgRating, reviewCount, err := s.reviewRepo.GetAverageRating(ctx, userID)
	if err != nil {
		return nil, err
	}

	return &dto.UserProfileResponse{
		ID:              user.ID,
		Name:            user.Name,
		City:            user.City,
		ProfilePhotoURL: user.ProfilePhotoURL,
		TotalPoints:     pts,
		TotalReports:    totalReports,
		FoundCount:      foundCount,
		ShareCount:      shareCount,
		AvgRating:       avgRating,
		ReviewCount:     reviewCount,
		Badges:          badgeResponses,
	}, nil
}

// GetLeaderboard retorna el ranking de usuarios por ciudad ordenado por TotalPoints DESC.
// limit se clampea entre 1 y 50; default 10.
func (s *gamificationService) GetLeaderboard(ctx context.Context, city string, limit int) ([]dto.LeaderboardEntry, error) {
	if limit <= 0 {
		limit = 10
	}
	if limit > 50 {
		limit = 50
	}

	rows, err := s.pointsRepo.FindLeaderboard(ctx, city, limit)
	if err != nil {
		return nil, err
	}

	entries := make([]dto.LeaderboardEntry, 0, len(rows))
	for i, row := range rows {
		entry := dto.LeaderboardEntry{
			UserID:      row.UserID,
			TotalPoints: row.Points,
			Rank:        i + 1, // 1-based
		}
		// Incluir nombre y ciudad del usuario si la relación fue cargada.
		if row.User.ID != uuid.Nil {
			entry.Name = row.User.Name
			entry.City = row.User.City
		}
		entries = append(entries, entry)
	}

	return entries, nil
}

// GetMyBadges retorna todos los badges del usuario autenticado.
func (s *gamificationService) GetMyBadges(ctx context.Context, userID uuid.UUID) ([]dto.BadgeResponse, error) {
	badges, err := s.badgeRepo.FindByUserID(ctx, userID)
	if err != nil {
		return nil, err
	}

	responses := make([]dto.BadgeResponse, 0, len(badges))
	for _, b := range badges {
		responses = append(responses, dto.BadgeResponse{
			ID:        b.ID,
			BadgeType: b.BadgeType,
			EarnedAt:  b.EarnedAt,
		})
	}

	return responses, nil
}
