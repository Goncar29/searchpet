package repository

import (
	"context"
	"errors"
	"strings"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"lost-pets/internal/domain"
)

type postgresShelterRepository struct {
	db *gorm.DB
}

// NewShelterRepository construye un ShelterRepository respaldado por PostgreSQL.
func NewShelterRepository(db *gorm.DB) ShelterRepository {
	return &postgresShelterRepository{db: db}
}

// Create persiste un nuevo refugio en la BD.
func (r *postgresShelterRepository) Create(ctx context.Context, shelter *domain.Shelter) error {
	return r.db.WithContext(ctx).Create(shelter).Error
}

// GetByID busca un refugio por su UUID.
// Retorna ErrShelterNotFound si no existe.
func (r *postgresShelterRepository) GetByID(ctx context.Context, id uuid.UUID) (*domain.Shelter, error) {
	var shelter domain.Shelter
	result := r.db.WithContext(ctx).First(&shelter, "id = ?", id)
	if errors.Is(result.Error, gorm.ErrRecordNotFound) {
		return nil, domain.ErrShelterNotFound
	}
	if result.Error != nil {
		return nil, result.Error
	}
	return &shelter, nil
}

// GetAll retorna refugios con filtros opcionales.
// city == "" → sin filtro por ciudad.
// isVerified == nil → sin filtro por verificación.
func (r *postgresShelterRepository) GetAll(ctx context.Context, city string, isVerified *bool) ([]domain.Shelter, error) {
	var shelters []domain.Shelter
	query := r.db.WithContext(ctx).Model(&domain.Shelter{}).
		Where("status = ?", domain.ShelterStatusApproved)

	if city != "" {
		// Búsqueda por palabras, igual que `foster_home_repository.go`: cada
		// término tiene que aparecer en el campo (parcial, case-insensitive).
		//
		// Era `city = ?`, exacto y sensible a mayúsculas. Mientras el filtro
		// no tuvo UI, daba igual — nadie lo tipeaba. Desde que la página de
		// refugios tiene buscador, ese `=` es una MENTIRA: la ciudad la
		// escribe a mano el dueño al registrarse, así que un refugio guardado
		// como "Montevideo" quedaba invisible para quien tipeara "montevideo",
		// y uno guardado como "Ciudad de la Costa, Canelones" para quien
		// tipeara "Ciudad de la Costa". La pantalla contestaba "no
		// encontramos refugios en X" con refugios en X.
		terms := strings.FieldsFunc(city, func(r rune) bool { return r == ' ' || r == ',' })
		for _, term := range terms {
			query = query.Where("city ILIKE ?", "%"+term+"%")
		}
	}
	if isVerified != nil {
		query = query.Where("is_verified = ?", *isVerified)
	}

	err := query.Order("name ASC").Find(&shelters).Error
	return shelters, err
}

// Update guarda los cambios de un refugio existente.
func (r *postgresShelterRepository) Update(ctx context.Context, shelter *domain.Shelter) error {
	return r.db.WithContext(ctx).Save(shelter).Error
}

// GetByOwner busca el refugio cuyo owner_user_id es ownerID.
// Retorna ErrShelterNotFound si el usuario no tiene refugio.
func (r *postgresShelterRepository) GetByOwner(ctx context.Context, ownerID uuid.UUID) (*domain.Shelter, error) {
	var shelter domain.Shelter
	result := r.db.WithContext(ctx).First(&shelter, "owner_user_id = ?", ownerID)
	if errors.Is(result.Error, gorm.ErrRecordNotFound) {
		return nil, domain.ErrShelterNotFound
	}
	if result.Error != nil {
		return nil, result.Error
	}
	return &shelter, nil
}

// GetPendingQueue retorna los refugios que requieren revisión admin:
// registros nuevos (pending) y approved con Pending* staged. FIFO por created_at.
func (r *postgresShelterRepository) GetPendingQueue(ctx context.Context) ([]domain.Shelter, error) {
	var shelters []domain.Shelter
	err := r.db.WithContext(ctx).
		Where("status = ? OR (status = ? AND (pending_donation_url IS NOT NULL OR pending_website_url IS NOT NULL))",
			domain.ShelterStatusPending, domain.ShelterStatusApproved).
		Order("created_at ASC").
		Find(&shelters).Error
	return shelters, err
}

// Verificación estática: postgresShelterRepository satisface ShelterRepository.
var _ ShelterRepository = (*postgresShelterRepository)(nil)
