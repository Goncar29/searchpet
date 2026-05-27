package repository

import (
	"errors"

	"gorm.io/gorm"
	"lost-pets/internal/domain"
)

// PostgresPhotoRepository es la implementación concreta del PhotoRepository.
type PostgresPhotoRepository struct {
	db *gorm.DB
}

// NewPhotoRepository construye el repositorio e inyecta la conexión GORM.
// Devuelve la interfaz, no el struct — Dependency Injection.
func NewPhotoRepository(db *gorm.DB) PhotoRepository {
	return &PostgresPhotoRepository{db: db}
}

// Create inserta una nueva foto en la BD.
func (r *PostgresPhotoRepository) Create(photo *domain.Photo) error {
	return r.db.Create(photo).Error
}

// FindByPetID retorna todas las fotos de una mascota ordenadas cronológicamente.
func (r *PostgresPhotoRepository) FindByPetID(petID string) ([]domain.Photo, error) {
	var photos []domain.Photo
	err := r.db.Where("pet_id = ?", petID).Order("created_at ASC").Find(&photos).Error
	return photos, err
}

// HasPrimaryPhoto informa si la mascota ya tiene una foto primaria.
func (r *PostgresPhotoRepository) HasPrimaryPhoto(petID string) (bool, error) {
	var count int64
	err := r.db.Model(&domain.Photo{}).
		Where("pet_id = ? AND is_primary = true", petID).
		Count(&count).Error
	return count > 0, err
}

// UnsetPrimaryPhotos quita el flag is_primary de todas las fotos de una mascota.
// Se usa antes de marcar una nueva foto como primary.
func (r *PostgresPhotoRepository) UnsetPrimaryPhotos(petID string) error {
	return r.db.Model(&domain.Photo{}).
		Where("pet_id = ? AND is_primary = true", petID).
		Update("is_primary", false).Error
}

// CountByPetID retorna la cantidad de fotos que tiene una mascota.
func (r *PostgresPhotoRepository) CountByPetID(petID string) (int64, error) {
	var count int64
	err := r.db.Model(&domain.Photo{}).Where("pet_id = ?", petID).Count(&count).Error
	return count, err
}

// FindByID busca una foto por su ID de string.
// Retorna ErrPhotoNotFound si no existe.
func (r *PostgresPhotoRepository) FindByID(photoID string) (*domain.Photo, error) {
	var photo domain.Photo
	result := r.db.Where("id = ?", photoID).First(&photo)
	if errors.Is(result.Error, gorm.ErrRecordNotFound) {
		return nil, domain.ErrPhotoNotFound
	}
	if result.Error != nil {
		return nil, result.Error
	}
	return &photo, nil
}

// DeleteByPetID elimina en bulk todas las fotos de una mascota de la BD.
// Debe llamarse después de haber eliminado los assets de Cloudinary.
func (r *PostgresPhotoRepository) DeleteByPetID(petID string) error {
	return r.db.Where("pet_id = ?", petID).Delete(&domain.Photo{}).Error
}

// DeleteByID elimina una foto individual de la BD por su ID de string.
// Debe llamarse después de haber eliminado el asset de Cloudinary.
func (r *PostgresPhotoRepository) DeleteByID(photoID string) error {
	return r.db.Where("id = ?", photoID).Delete(&domain.Photo{}).Error
}
