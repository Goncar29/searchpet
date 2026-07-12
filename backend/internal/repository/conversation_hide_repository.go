package repository

import (
	"context"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type postgresConversationHideRepository struct {
	db *gorm.DB
}

// NewConversationHideRepository construye un ConversationHideRepository respaldado por PostgreSQL.
func NewConversationHideRepository(db *gorm.DB) ConversationHideRepository {
	return &postgresConversationHideRepository{db: db}
}

// Upsert crea u actualiza el ocultamiento del par (userID, otherUserID).
// ON CONFLICT sobre la PK compuesta refresca hidden_at — re-ocultar siempre funciona.
func (r *postgresConversationHideRepository) Upsert(ctx context.Context, userID, otherUserID uuid.UUID) error {
	return r.db.WithContext(ctx).Exec(
		`INSERT INTO conversation_hides (user_id, other_user_id, hidden_at)
		 VALUES (?, ?, NOW())
		 ON CONFLICT (user_id, other_user_id) DO UPDATE SET hidden_at = NOW()`,
		userID, otherUserID,
	).Error
}

// Verificación estática: postgresConversationHideRepository satisface ConversationHideRepository.
var _ ConversationHideRepository = (*postgresConversationHideRepository)(nil)
