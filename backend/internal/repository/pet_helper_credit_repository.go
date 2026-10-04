package repository

import (
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"lost-pets/internal/domain"
)

type PostgresPetHelperCreditRepository struct {
	db *gorm.DB
}

func NewPetHelperCreditRepository(db *gorm.DB) PetHelperCreditRepository {
	return &PostgresPetHelperCreditRepository{db: db}
}

// FindCandidates — ver el contrato en repository/interfaces.go.
//
// El dueño y quien reportó el callejero se leen de la propia fila de pets en la
// misma consulta, así que no hay una ventana entre "leer la mascota" y "listar
// reportes" en la que el dato pueda cambiar.
func (r *PostgresPetHelperCreditRepository) FindCandidates(petID string, episodeID uuid.UUID) ([]domain.HelperCandidate, error) {
	var rows []struct {
		ID              uuid.UUID
		Name            string
		ProfilePhotoURL string
	}
	err := r.db.Raw(`
		SELECT u.id AS id, u.name AS name, u.profile_photo_url AS profile_photo_url
		FROM users u
		JOIN pets p ON p.id = ?
		WHERE u.id IN (
			SELECT DISTINCT rep.reporter_id
			FROM reports rep
			WHERE rep.pet_id = p.id AND rep.episode_id = ?
		)
		AND u.id IS DISTINCT FROM p.owner_id
		AND u.id IS DISTINCT FROM p.reporter_id
		ORDER BY u.name ASC, u.id ASC`, petID, episodeID).Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	out := make([]domain.HelperCandidate, 0, len(rows))
	for _, row := range rows {
		out = append(out, domain.HelperCandidate{ID: row.ID, Name: row.Name, ProfilePhotoURL: row.ProfilePhotoURL})
	}
	return out, nil
}

// InsertCredits — ver el contrato en repository/interfaces.go. Un INSERT por
// ayudante y no un lote: con DO NOTHING el RETURNING de un lote no dice qué fila
// de la entrada corresponde a qué salida, y acá lo único que importa es saber
// exactamente cuáles entraron.
func (r *PostgresPetHelperCreditRepository) InsertCredits(credits []domain.PetHelperCredit) ([]uuid.UUID, error) {
	inserted := make([]uuid.UUID, 0, len(credits))
	for i := range credits {
		res := r.db.Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "pet_id"}, {Name: "helper_user_id"}},
			DoNothing: true,
		}).Create(&credits[i])
		if res.Error != nil {
			return nil, res.Error
		}
		if res.RowsAffected == 1 {
			inserted = append(inserted, credits[i].HelperUserID)
		}
	}
	return inserted, nil
}

// CountByHelper — ver el contrato en repository/interfaces.go.
func (r *PostgresPetHelperCreditRepository) CountByHelper(userID uuid.UUID) (int64, error) {
	var total int64
	err := r.db.Model(&domain.PetHelperCredit{}).
		Where("helper_user_id = ?", userID).
		Distinct("pet_id").
		Count(&total).Error
	return total, err
}
