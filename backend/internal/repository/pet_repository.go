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
	err := r.db.Preload("Owner").Preload("Reporter").Preload("Photos").Where("id = ?", id).First(&pet).Error
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

// FindByReporterID devuelve las mascotas callejeras (stray) que reportó un usuario.
func (r *PostgresPetRepository) FindByReporterID(reporterID string) ([]domain.Pet, error) {
	var pets []domain.Pet
	err := r.db.Preload("Photos").Where("reporter_id = ?", reporterID).Order("created_at DESC").Find(&pets).Error
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

// Search aplica filtros opcionales y devuelve resultados paginados con el total.
// Implementa FR1.1 (filtros), FR1.2 (combinables), FR1.5 (date range por report).
// When Statuses is empty, defaults to FeedVisibleStatuses (lost, stray).
// When Statuses is non-empty, uses an IN clause with the provided values.
func (r *PostgresPetRepository) Search(filters domain.PetSearchCriteria) ([]domain.Pet, int64, error) {
	// Normalizamos paginación
	page := filters.Page
	if page < 1 {
		page = 1
	}
	limit := filters.Limit
	if limit < 1 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}

	// Determine the status filter — default to feed-visible statuses (lost, stray)
	statuses := filters.Statuses
	if len(statuses) == 0 {
		statuses = domain.FeedVisibleStatuses
	}

	// Construimos la query base con Preload
	q := r.db.Model(&domain.Pet{}).
		Preload("Owner").
		Preload("Photos").
		Where("pets.status IN (?)", statuses)

	// Filtros exactos / parciales
	if filters.Type != "" {
		q = q.Where("pets.type = ?", filters.Type)
	}
	if filters.Breed != "" {
		q = q.Where("pets.breed ILIKE ?", "%"+filters.Breed+"%")
	}
	if filters.Color != "" {
		q = q.Where("pets.color ILIKE ?", "%"+filters.Color+"%")
	}

	// Filtros que requieren JOIN a reports: rango de fechas (FR1.5) y/o
	// distancia geográfica opcional. Una mascota matchea si tiene AL MENOS un
	// reporte que cumple todas las condiciones de reporte simultáneamente.
	hasGeo := filters.Lat != nil && filters.Lng != nil && filters.RadiusMeters != nil
	if filters.From != nil || filters.To != nil || hasGeo {
		q = q.Joins("JOIN reports ON reports.pet_id = pets.id")
		if filters.From != nil {
			q = q.Where("reports.occurred_at >= ?", filters.From)
		}
		if filters.To != nil {
			q = q.Where("reports.occurred_at <= ?", filters.To)
		}
		if hasGeo {
			q = q.Where(
				"ST_DWithin(ST_SetSRID(ST_MakePoint(reports.longitude, reports.latitude), 4326)::geography, ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography, ?)",
				*filters.Lng, *filters.Lat, *filters.RadiusMeters,
			)
		}

		// Count distinct pets using a fresh Session so the single-column Distinct
		// below does not bleed into the Find query. GORM emits
		// COUNT(DISTINCT(pets.id)) for a single-column Distinct; the multi-column
		// string variant (used for Find) falls back to count(*) on GORM v1.25.
		var total int64
		if err := q.Session(&gorm.Session{}).Distinct("pets.id").Count(&total).Error; err != nil {
			return nil, 0, err
		}

		// Evitamos duplicados si hay múltiples reports que matchean
		q = q.Distinct("pets.id, pets.owner_id, pets.reporter_id, pets.name, pets.type, pets.breed, pets.color, pets.description, pets.gender, pets.microchip_id, pets.status, pets.version, pets.created_at, pets.updated_at")

		// Paginación
		var pets []domain.Pet
		offset := (page - 1) * limit
		err := q.Order("pets.created_at DESC").Offset(offset).Limit(limit).Find(&pets).Error
		if err != nil {
			return nil, 0, err
		}
		return pets, total, nil
	}

	// Count total ANTES de paginar (no JOIN path — no deduplication needed)
	var total int64
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	// Paginación
	var pets []domain.Pet
	offset := (page - 1) * limit
	err := q.Order("pets.created_at DESC").Offset(offset).Limit(limit).Find(&pets).Error
	if err != nil {
		return nil, 0, err
	}

	return pets, total, nil
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
		if err := tx.Where("pet_id = ?", id).Delete(&domain.Report{}).Error; err != nil {
			return err
		}
		if err := tx.Where("pet_id = ?", id).Delete(&domain.Photo{}).Error; err != nil {
			return err
		}
		return tx.Where("id = ?", id).Delete(&domain.Pet{}).Error
	})
}
