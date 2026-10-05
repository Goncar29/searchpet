package repository

import (
	"context"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"lost-pets/internal/domain"
)

type PostgresPetShareCreditRepository struct {
	db *gorm.DB
}

func NewPetShareCreditRepository(db *gorm.DB) PetShareCreditRepository {
	return &PostgresPetShareCreditRepository{db: db}
}

// CreditOnce — see the contract in repository/interfaces.go. ON CONFLICT DO
// NOTHING on the (pet_id, user_id) primary key makes it race-free: the database
// decides which call inserted, not a read before the write.
func (r *PostgresPetShareCreditRepository) CreditOnce(ctx context.Context, petID, userID uuid.UUID) (bool, error) {
	credit := domain.PetShareCredit{PetID: petID, UserID: userID}
	res := r.db.WithContext(ctx).Clauses(clause.OnConflict{DoNothing: true}).Create(&credit)
	if res.Error != nil {
		return false, res.Error
	}
	return res.RowsAffected == 1, nil
}
