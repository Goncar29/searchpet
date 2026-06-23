package repository

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"lost-pets/internal/domain"
)

type postgresShareLinkRepository struct {
	db *gorm.DB
}

// NewShareLinkRepository construye un ShareLinkRepository respaldado por PostgreSQL.
func NewShareLinkRepository(db *gorm.DB) ShareLinkRepository {
	return &postgresShareLinkRepository{db: db}
}

// Create persiste un nuevo share link en la BD.
func (r *postgresShareLinkRepository) Create(ctx context.Context, link *domain.ShareLink) error {
	return r.db.WithContext(ctx).Create(link).Error
}

// GetByToken busca un share link por su token único.
// Retorna ErrShareLinkNotFound si no existe.
func (r *postgresShareLinkRepository) GetByToken(ctx context.Context, token string) (*domain.ShareLink, error) {
	var link domain.ShareLink
	result := r.db.WithContext(ctx).
		Preload("Pet").
		Preload("Pet.Owner").
		Preload("Pet.Photos", orderedPhotos).
		Where("share_token = ?", token).
		First(&link)
	if errors.Is(result.Error, gorm.ErrRecordNotFound) {
		return nil, domain.ErrShareLinkNotFound
	}
	if result.Error != nil {
		return nil, result.Error
	}
	return &link, nil
}

// GetByPetID retorna todos los share links de una mascota.
func (r *postgresShareLinkRepository) GetByPetID(ctx context.Context, petID uuid.UUID) ([]domain.ShareLink, error) {
	var links []domain.ShareLink
	err := r.db.WithContext(ctx).
		Where("pet_id = ?", petID).
		Order("created_at DESC").
		Find(&links).Error
	return links, err
}

// GetOrCreateForPet devuelve el share link más reciente de la mascota o crea uno
// nuevo (vía build) si no existe, de forma ATÓMICA. Toda la operación corre en
// una transacción que primero toma un advisory lock transaccional por pet_id:
// así dos requests anónimos simultáneos sobre la misma mascota se serializan y
// no insertan filas duplicadas (el lock se libera solo al commit/rollback).
// El advisory lock es la pieza clave — no hay UNIQUE en pet_id porque el flujo
// protegido Generate crea varias filas por mascota a propósito.
func (r *postgresShareLinkRepository) GetOrCreateForPet(
	ctx context.Context,
	petID uuid.UUID,
	build func() (*domain.ShareLink, error),
) (*domain.ShareLink, error) {
	var result *domain.ShareLink
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec("SELECT pg_advisory_xact_lock(hashtext(?))", petID.String()).Error; err != nil {
			return err
		}

		var existing []domain.ShareLink
		if err := tx.Where("pet_id = ?", petID).
			Order("created_at DESC").
			Limit(1).
			Find(&existing).Error; err != nil {
			return err
		}
		if len(existing) > 0 {
			result = &existing[0]
			return nil
		}

		link, err := build()
		if err != nil {
			return err
		}
		if err := tx.Create(link).Error; err != nil {
			return err
		}
		result = link
		return nil
	})
	if err != nil {
		return nil, err
	}
	return result, nil
}

// IncrementViewCount incrementa view_count de forma atómica usando una sola UPDATE.
// Nunca hace read-modify-write para evitar condiciones de carrera.
func (r *postgresShareLinkRepository) IncrementViewCount(ctx context.Context, id uuid.UUID) error {
	result := r.db.WithContext(ctx).
		Model(&domain.ShareLink{}).
		Where("id = ?", id).
		Update("view_count", gorm.Expr("view_count + ?", 1))
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return domain.ErrShareLinkNotFound
	}
	return nil
}

// IncrementClickedContact incrementa clicked_contact de forma atómica usando una sola UPDATE.
func (r *postgresShareLinkRepository) IncrementClickedContact(ctx context.Context, id uuid.UUID) error {
	result := r.db.WithContext(ctx).
		Model(&domain.ShareLink{}).
		Where("id = ?", id).
		Update("clicked_contact", gorm.Expr("clicked_contact + ?", 1))
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return domain.ErrShareLinkNotFound
	}
	return nil
}

// Verificación estática: postgresShareLinkRepository satisface ShareLinkRepository.
var _ ShareLinkRepository = (*postgresShareLinkRepository)(nil)
