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
	UserID          uuid.UUID `json:"user_id"`
	Name            string    `json:"name"`
	ProfilePhotoURL string    `json:"profile_photo_url,omitempty"`
	JoinedAt        time.Time `json:"joined_at"`
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
// Requiere que m.User haya sido precargado con Preload("User").
func ToMemberResponse(m *domain.GroupMember) MemberResponse {
	return MemberResponse{
		UserID:          m.UserID,
		Name:            m.User.Name,
		ProfilePhotoURL: m.User.ProfilePhotoURL,
		JoinedAt:        m.JoinedAt,
	}
}

// ToMemberListResponse convierte una lista de GroupMember a []MemberResponse.
func ToMemberListResponse(members []domain.GroupMember) []MemberResponse {
	resp := make([]MemberResponse, 0, len(members))
	for i := range members {
		resp = append(resp, ToMemberResponse(&members[i]))
	}
	return resp
}
