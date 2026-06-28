package dto

import (
	"time"

	"lost-pets/internal/domain"
)

// AdminRoleRequest is the body for granting/revoking admin by email.
// Grant is a pointer so an absent field fails `required` (a plain bool defaults
// to false, which would silently mean "revoke").
type AdminRoleRequest struct {
	Email string `json:"email" binding:"required,email"`
	Grant *bool  `json:"grant" binding:"required"`
}

// AdminRoleResponse reports the result of a role change.
type AdminRoleResponse struct {
	TargetID string `json:"target_id"`
	Email    string `json:"email"`
	Name     string `json:"name"`
	IsAdmin  bool   `json:"is_admin"`
	NoChange bool   `json:"no_change"`
}

// AdminAuditLogResponse is a single audit-trail entry for the UI.
type AdminAuditLogResponse struct {
	ID          string `json:"id"`
	ActorEmail  string `json:"actor_email"`
	TargetEmail string `json:"target_email"`
	Action      string `json:"action"`
	CreatedAt   string `json:"created_at"`
}

// AdminAuditLogListResponse is a page of audit entries with paging metadata.
type AdminAuditLogListResponse struct {
	Data  []AdminAuditLogResponse `json:"data"`
	Total int64                   `json:"total"`
	Page  int                     `json:"page"`
	Limit int                     `json:"limit"`
}

// ToAdminAuditLogListResponse wraps a page of audit rows with paging metadata.
func ToAdminAuditLogListResponse(entries []domain.AdminAuditLog, total int64, page, limit int) AdminAuditLogListResponse {
	return AdminAuditLogListResponse{
		Data:  ToAdminAuditLogResponses(entries),
		Total: total,
		Page:  page,
		Limit: limit,
	}
}

// ToAdminAuditLogResponses maps audit rows to their HTTP DTOs.
func ToAdminAuditLogResponses(entries []domain.AdminAuditLog) []AdminAuditLogResponse {
	out := make([]AdminAuditLogResponse, 0, len(entries))
	for _, e := range entries {
		out = append(out, AdminAuditLogResponse{
			ID:          e.ID.String(),
			ActorEmail:  e.ActorEmail,
			TargetEmail: e.TargetEmail,
			Action:      e.Action,
			CreatedAt:   e.CreatedAt.Format(time.RFC3339),
		})
	}
	return out
}
