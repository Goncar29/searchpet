package dto

import (
	"time"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
)

// BlockRequest contiene los datos para bloquear a un usuario.
type BlockRequest struct {
	Reason string `json:"reason"`
}

// BlockedUserResponse es la respuesta de un usuario bloqueado.
type BlockedUserResponse struct {
	ID        uuid.UUID `json:"id"`
	BlockedID uuid.UUID `json:"blocked_id"`
	Name      string    `json:"name"`
	BlockedAt time.Time `json:"blocked_at"`
}

// ToBlockedUserResponse convierte un domain.BlockedUser a BlockedUserResponse.
func ToBlockedUserResponse(b *domain.BlockedUser) BlockedUserResponse {
	return BlockedUserResponse{
		ID:        b.ID,
		BlockedID: b.BlockedID,
		BlockedAt: b.CreatedAt,
	}
}
