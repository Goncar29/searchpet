package repository

import (
	"errors"

	"gorm.io/gorm"
	"lost-pets/internal/domain"
)

// PostgresPetRepository es la IMPLEMENTACIÓN concreta que habla con PostgreSQL.
// El * en el receiver significa que trabajamos con la referencia real, no una copia.
type PostgresPetRepository struct {
	db *gorm.DB
}

// NewPetRepository es el constructor — recibe la conexión y devuelve el repository.
// Nota: devuelve la INTERFAZ, no el struct concreto. Esto es Dependency Injection.
func NewPetRepository(db *gorm.DB) PetRepository {
	return &PostgresPetRepository{db: db}
}

// Create inserta una nueva mascota en la BD.
func (r *PostgresPetRepository) Create(pet *domain.Pet) error {
	return r.db.Create(pet).Error
}

// FindByID busca una mascota por su UUID y carga el owner.
// Preload("Owner") hace un segundo SELECT para traer los datos del usuario.
func (r *PostgresPetRepository) FindByID(id string) (*domain.Pet, error) {
	var pet domain.Pet
	err := r.db.Preload("Owner").Preload("Photos").Where("id = ?", id).First(&pet).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, domain.ErrPetNotFound
		}
		return nil, err
	}
	return &pet, nil
}

// FindByOwnerID devuelve todas las mascotas de un usuario con el owner cargado.
func (r *PostgresPetRepository) FindByOwnerID(ownerID string) ([]domain.Pet, error) {
	var pets []domain.Pet
	err := r.db.Preload("Owner").Preload("Photos").Where("owner_id = ?", ownerID).Order("created_at DESC").Find(&pets).Error
	return pets, err
}

// Update guarda los cambios de una mascota existente.
func (r *PostgresPetRepository) Update(pet *domain.Pet) error {
	return r.db.Save(pet).Error
}

// UpdateStatus actualiza solo la columna status de una mascota.
func (r *PostgresPetRepository) UpdateStatus(id string, status string) error {
	return r.db.Model(&domain.Pet{}).Where("id = ?", id).Update("status", status).Error
}

// Delete elimina una mascota y todas sus dependencias dentro de una transacción.
// El orden importa: primero las tablas hijas, después la pet.
func (r *PostgresPetRepository) Delete(id string) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("pet_id = ?", id).Delete(&domain.SuccessStory{}).Error; err != nil {
			return err
		}
		if err := tx.Where("pet_id = ?", id).Delete(&domain.LocationAlert{}).Error; err != nil {
			return err
		}
		if err := tx.Where("pet_id = ?", id).Delete(&domain.ShareLink{}).Error; err != nil {
			return err
		}
		if err := tx.Where("pet_id = ?", id).Delete(&domain.Favorite{}).Error; err != nil {
			return err
		}
		if err := tx.Where("pet_id = ?", id).Delete(&domain.Report{}).Error; err != nil {
			return err
		}
		if err := tx.Where("pet_id = ?", id).Delete(&domain.Photo{}).Error; err != nil {
			return err
		}
		return tx.Where("id = ?", id).Delete(&domain.Pet{}).Error
	})
}
