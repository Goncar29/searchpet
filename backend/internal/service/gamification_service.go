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
	reviewRepo repository.UserReviewRepository      // V1.5 — para avg_rating en perfiles
	reportRepo repository.ReportRepository          // total_reports del perfil, desde las filas
	creditRepo repository.PetHelperCreditRepository // found_count del perfil y super_finder, desde los créditos
	shareRepo  repository.PetShareCreditRepository  // sharing pays once per (pet, user)
}

// NewGamificationService construye el GamificationService con sus dependencias.
func NewGamificationService(
	badgeRepo repository.BadgeRepository,
	pointsRepo repository.UserPointsRepository,
	userRepo repository.UserRepository,
	reviewRepo repository.UserReviewRepository,
	reportRepo repository.ReportRepository,
	creditRepo repository.PetHelperCreditRepository,
	shareRepo repository.PetShareCreditRepository,
) *gamificationService {
	return &gamificationService{
		badgeRepo:  badgeRepo,
		pointsRepo: pointsRepo,
		userRepo:   userRepo,
		reviewRepo: reviewRepo,
		reportRepo: reportRepo,
		creditRepo: creditRepo,
		shareRepo:  shareRepo,
	}
}

// RegisterListeners suscribe los handlers al EventBus.
// Debe llamarse una vez durante el arranque del servidor, después de crear el EventBus.
func (s *gamificationService) RegisterListeners(bus *event.EventBus) {
	bus.Subscribe("report.created", s.onReportCreated)
	bus.Subscribe("share.created", s.onShareCreated)
	bus.Subscribe("review.created", s.onReviewCreated)
	bus.Subscribe("review.deleted", s.onReviewDeleted)
	bus.Subscribe("user.verified", s.onUserVerified)
	// "pet.found" NO se escucha a propósito: el dueño que marca su propia mascota
	// como encontrada no gana puntos ni badges (antes: +100, found_count,
	// pet_rescuer, super_finder). Cobran los AYUDANTES que el dueño confirma, vía
	// "pet.helpers_credited".
	//
	// SÍNCRONO: el crédito ya está commiteado y los puntos no se pueden perder si
	// el instance se suspende tras la respuesta (free tier de Render).
	bus.SubscribeSync("pet.helpers_credited", s.onPetHelpersCredited)
}

// helperAwardPoints son los puntos por ayudar a reunir una mascota.
const helperAwardPoints = 100

// onPetHelpersCredited maneja "pet.helpers_credited": por cada ayudante recién
// acreditado, +100 puntos, el badge pet_rescuer y, desde 5 mascotas distintas,
// super_finder. HelperIDs sólo trae a quienes el INSERT realmente agregó, y eso
// es lo que hace seguro llamar a Upsert, que no es idempotente.
//
// El umbral de super_finder cuenta las filas de créditos y no el contador
// user_points.found_count, que sólo sube y no sabe de borrados.
func (s *gamificationService) onPetHelpersCredited(payload interface{}) {
	ev, ok := payload.(event.PetHelpersCreditedEvent)
	if !ok {
		log.Printf("[GamificationService] onPetHelpersCredited: payload inesperado: %T", payload)
		return
	}

	ctx := context.Background()

	for _, helperID := range ev.HelperIDs {
		if _, err := s.pointsRepo.Upsert(ctx, helperID, helperAwardPoints, "found_count"); err != nil {
			log.Printf("[GamificationService] onPetHelpersCredited: upsert points para %s: %v", helperID, err)
			continue
		}

		if err := s.AwardBadgeIfEligible(ctx, helperID, "pet_rescuer"); err != nil {
			log.Printf("[GamificationService] onPetHelpersCredited: award pet_rescuer para %s: %v", helperID, err)
		}

		credits, err := s.creditRepo.CountByHelper(helperID)
		if err != nil {
			log.Printf("[GamificationService] onPetHelpersCredited: contar créditos de %s: %v", helperID, err)
			continue
		}
		if credits >= 5 {
			if err := s.AwardBadgeIfEligible(ctx, helperID, "super_finder"); err != nil {
				log.Printf("[GamificationService] onPetHelpersCredited: award super_finder para %s: %v", helperID, err)
			}
		}
	}
}

// isOwnClosure reports whether a "found" report was filed by the pet's owner
// or by whoever reported the stray: that closes their own search, it is not
// help. Same predicate that CountByReporter uses to keep it out of the profile.
func isOwnClosure(ev event.ReportCreatedEvent) bool {
	if ev.Status != string(domain.PetStatusFound) {
		return false
	}
	return (ev.PetOwnerID != uuid.Nil && ev.ReporterID == ev.PetOwnerID) ||
		(ev.PetReporterID != uuid.Nil && ev.ReporterID == ev.PetReporterID)
}

// onReportCreated maneja el evento "report.created".
// Suma 5 puntos al reporter e incrementa TotalReports.
// Si es el primer reporte, otorga el badge "first_helper".
// El reporte con el que el dueño (o quien reportó al callejero) cierra su
// propia búsqueda no suma nada: el dueño no gana puntos por encontrar lo suyo.
func (s *gamificationService) onReportCreated(payload interface{}) {
	ev, ok := payload.(event.ReportCreatedEvent)
	if !ok {
		log.Printf("[GamificationService] onReportCreated: payload inesperado: %T", payload)
		return
	}
	if isOwnClosure(ev) {
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

// onShareCreated maneja el evento "share.created".
// Suma 2 puntos al sharer, incrementa ShareCount, y otorga el badge "social_butterfly" (idempotente).
// Paga UNA vez por (mascota, usuario): generar más links de la misma mascota no
// suma, así nadie sube en el ranking generando links en loop. Si el crédito no
// se puede registrar no paga, porque pagar sin el registro dejaría que el
// próximo link pague otra vez.
func (s *gamificationService) onShareCreated(payload interface{}) {
	ev, ok := payload.(event.ShareCreatedEvent)
	if !ok {
		log.Printf("[GamificationService] onShareCreated: payload inesperado: %T", payload)
		return
	}

	ctx := context.Background()

	fresh, err := s.shareRepo.CreditOnce(ctx, ev.PetID, ev.UserID)
	if err != nil {
		log.Printf("[GamificationService] onShareCreated: crédito de %s sobre %s: %v", ev.UserID, ev.PetID, err)
		return
	}
	if !fresh {
		return
	}

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

// onReviewDeleted maneja el evento "review.deleted".
// Revierte los 10 puntos otorgados al reviewee al crearse la reseña, para que
// los puntos reflejen solo las reseñas vigentes (evita farmear creando y
// borrando reseñas repetidamente). El repositorio hace clamp a 0.
func (s *gamificationService) onReviewDeleted(payload interface{}) {
	ev, ok := payload.(event.ReviewDeletedEvent)
	if !ok {
		log.Printf("[GamificationService] onReviewDeleted: payload inesperado: %T", payload)
		return
	}

	ctx := context.Background()

	if _, err := s.pointsRepo.Upsert(ctx, ev.RevieweeID, -10, ""); err != nil {
		log.Printf("[GamificationService] onReviewDeleted: upsert points para %s: %v", ev.RevieweeID, err)
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
	var pts, shareCount int
	points, err := s.pointsRepo.GetByUserID(ctx, userID)
	if err != nil {
		if !errors.Is(err, domain.ErrPointsNotFound) {
			return nil, err
		}
		// Sin puntos aún — usar ceros (valores ya inicializados en cero arriba).
	} else {
		pts = points.Points
		shareCount = points.ShareCount
	}

	// total_reports y found_count salen de las filas, no de user_points: esos
	// contadores los suben los eventos y nunca bajan, así que borrar un reporte
	// o una mascota los dejaba inflados (en prod, 41/12 con ~0 filas reales).
	// found_count = mascotas por las que el dueño te confirmó como ayudante.
	// Puntos, shares, badges y leaderboard siguen siendo por contador.
	reportsCount, err := s.reportRepo.CountByReporter(ctx, userID)
	if err != nil {
		return nil, err
	}
	foundPets, err := s.creditRepo.CountByHelper(userID)
	if err != nil {
		return nil, err
	}
	totalReports, foundCount := int(reportsCount), int(foundPets)

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

	// Cargar los badges de todos los usuarios del ranking en una sola query
	// (evita N+1) y agruparlos por usuario.
	userIDs := make([]uuid.UUID, 0, len(rows))
	for _, row := range rows {
		userIDs = append(userIDs, row.UserID)
	}
	badgesByUser := make(map[uuid.UUID][]string)
	if len(userIDs) > 0 {
		badges, err := s.badgeRepo.FindByUserIDs(ctx, userIDs)
		if err != nil {
			return nil, err
		}
		for _, b := range badges {
			badgesByUser[b.UserID] = append(badgesByUser[b.UserID], b.BadgeType)
		}
	}

	entries := make([]dto.LeaderboardEntry, 0, len(rows))
	for i, row := range rows {
		entry := dto.LeaderboardEntry{
			UserID:      row.UserID,
			TotalPoints: row.Points,
			Rank:        i + 1, // 1-based
			Badges:      badgesByUser[row.UserID],
		}
		// Incluir nombre, ciudad y foto del usuario si la relación fue cargada.
		if row.User.ID != uuid.Nil {
			entry.Name = row.User.Name
			entry.City = row.User.City
			entry.ProfilePhotoURL = row.User.ProfilePhotoURL
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
