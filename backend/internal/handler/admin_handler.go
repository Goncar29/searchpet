package handler

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"lost-pets/internal/domain"
	"lost-pets/internal/dto"
	"lost-pets/internal/service"
)

// queryIntDefault parses a query param as int, falling back to def when absent or
// invalid.
func queryIntDefault(c *gin.Context, key string, def int) int {
	if v, err := strconv.Atoi(c.Query(key)); err == nil {
		return v
	}
	return def
}

// AdminHandler handles in-app admin-role management (admin only — RequireAdmin).
type AdminHandler struct {
	adminService service.AdminService
}

// NewAdminHandler crea una instancia del AdminHandler.
func NewAdminHandler(adminService service.AdminService) *AdminHandler {
	return &AdminHandler{adminService: adminService}
}

// SetUserAdmin godoc
// POST /api/admin/users/admin-role  (admin only)
func (h *AdminHandler) SetUserAdmin(c *gin.Context) {
	var req dto.AdminRoleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, domain.ErrInvalidInput)
		return
	}

	res, err := h.adminService.SetUserAdmin(c.Request.Context(), getUserUUID(c), req.Email, *req.Grant)
	if err != nil {
		switch {
		case errors.Is(err, domain.ErrUserNotFound):
			writeError(c, http.StatusNotFound, err)
		case errors.Is(err, domain.ErrCannotRevokeSelf),
			errors.Is(err, domain.ErrCannotRevokeLastAdmin),
			errors.Is(err, domain.ErrInvalidInput):
			writeError(c, http.StatusBadRequest, err)
		default:
			writeError(c, http.StatusInternalServerError, domain.ErrInternal)
		}
		return
	}

	c.JSON(http.StatusOK, dto.AdminRoleResponse{
		TargetID: res.TargetID.String(),
		Email:    res.TargetEmail,
		Name:     res.TargetName,
		IsAdmin:  res.IsAdmin,
		NoChange: res.NoChange,
	})
}

// RecentRoleChanges godoc
// GET /api/admin/role-changes  (admin only)
func (h *AdminHandler) RecentRoleChanges(c *gin.Context) {
	// Clamp here so the echoed page/limit match what the query actually used.
	page := queryIntDefault(c, "page", 1)
	limit := queryIntDefault(c, "limit", domain.DefaultRoleChangeLimit)
	if page < 1 {
		page = 1
	}
	if limit <= 0 || limit > domain.MaxRoleChangeLimit {
		limit = domain.DefaultRoleChangeLimit
	}
	entries, total, err := h.adminService.RecentRoleChanges(c.Request.Context(), page, limit)
	if err != nil {
		writeError(c, http.StatusInternalServerError, domain.ErrInternal)
		return
	}
	c.JSON(http.StatusOK, dto.ToAdminAuditLogListResponse(entries, total, page, limit))
}
