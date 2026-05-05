package repository

import (
	"errors"

	"gorm.io/gorm"
	"lost-pets/internal/domain"
)

// PetRepository define el CONTRATO (interfaz) para acceder a datos de mascotas.
// El Service solo conoce esta interfaz, no sabe nada de PostgreSQL.
type PetRepository interface {
	Create(pet *domain.Pet) error
	FindByID(id string) (*domain.Pet, error)
	FindByOwnerID(ownerID string) ([]domain.Pet, error)
	Update(pet *domain.Pet) error
	Delete(id string) error
}

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
	err := r.db.Preload("Owner").Where("id = ?", id).First(&pet).Error
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
	err := r.db.Preload("Owner").Where("owner_id = ?", ownerID).Order("created_at DESC").Find(&pets).Error
	return pets, err
}

// Update guarda los cambios de una mascota existente.
func (r *PostgresPetRepository) Update(pet *domain.Pet) error {
	return r.db.Save(pet).Error
}

// Delete elimina una mascota por su UUID.
func (r *PostgresPetRepository) Delete(id string) error {
	return r.db.Where("id = ?", id).Delete(&domain.Pet{}).Error
}
