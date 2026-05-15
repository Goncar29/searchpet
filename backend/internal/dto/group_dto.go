package dto

import (
	"time"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
)

// CreateGroupRequest contiene los datos para crear un grupo local.
type CreateGroupRequest struct {
	City        string `json:"city" binding:"required"`
	Name        string `json:"name" binding:"required"`
	Description string `json:"description"`
}

// GroupResponse es la respuesta de un grupo local.
type GroupResponse struct {
	ID          uuid.UUID `json:"id"`
	City        string    `json:"city"`
	Name        string    `json:"name"`
	Description string    `json:"description,omitempty"`
	MemberCount int       `json:"member_count"`
	CreatedBy   uuid.UUID `json:"created_by"`
	CreatedAt   time.Time `json:"created_at"`
}

// MemberResponse es la respuesta de un miembro de grupo.
type MemberResponse struct {
	UserID   uuid.UUID `json:"user_id"`
	JoinedAt time.Time `json:"joined_at"`
}

// ToGroupResponse convierte un domain.LocalGroup a GroupResponse.
func ToGroupResponse(g *domain.LocalGroup) GroupResponse {
	return GroupResponse{
		ID:          g.ID,
		City:        g.City,
		Name:        g.Name,
		Description: g.Description,
		MemberCount: g.MemberCount,
		CreatedBy:   g.CreatedBy,
		CreatedAt:   g.CreatedAt,
	}
}

// ToGroupListResponse convierte una lista de LocalGroup a []GroupResponse.
func ToGroupListResponse(groups []domain.LocalGroup) []GroupResponse {
	resp := make([]GroupResponse, 0, len(groups))
	for i := range groups {
		resp = append(resp, ToGroupResponse(&groups[i]))
	}
	return resp
}

// ToMemberResponse convierte un domain.GroupMember a MemberResponse.
func ToMemberResponse(m *domain.GroupMember) MemberResponse {
	return MemberResponse{
		UserID:   m.UserID,
		JoinedAt: m.JoinedAt,
	}
}
