package handler

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/dto"
	"lost-pets/internal/service"
)

// GroupHandler maneja las operaciones de grupos locales.
type GroupHandler struct {
	groupService service.GroupService
}

// NewGroupHandler crea una instancia del GroupHandler.
func NewGroupHandler(groupService service.GroupService) *GroupHandler {
	return &GroupHandler{groupService: groupService}
}

// Create godoc
// POST /api/groups  (admin only — gated by RequireAdmin)
func (h *GroupHandler) Create(c *gin.Context) {
	callerID := getUserUUID(c)

	var req dto.CreateGroupRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	group, err := h.groupService.CreateGroup(c.Request.Context(), callerID, req)
	if err != nil {
		if errors.Is(err, domain.ErrCityGroupExists) {
			c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": domain.ErrInternal.Error()})
		return
	}

	c.JSON(http.StatusCreated, dto.ToGroupResponse(group))
}

// List godoc
// GET /api/groups?city=Montevideo&limit=20&offset=0
func (h *GroupHandler) List(c *gin.Context) {
	city := c.Query("city")

	limit := 20
	offset := 0
	if l := c.Query("limit"); l != "" {
		if v, err := strconv.Atoi(l); err == nil && v > 0 {
			limit = v
		}
	}
	if o := c.Query("offset"); o != "" {
		if v, err := strconv.Atoi(o); err == nil && v >= 0 {
			offset = v
		}
	}

	groups, err := h.groupService.List(c.Request.Context(), city, limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": domain.ErrInternal.Error()})
		return
	}

	c.JSON(http.StatusOK, dto.ToGroupListResponse(groups))
}

// GetByID godoc
// GET /api/groups/:id
func (h *GroupHandler) GetByID(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "id inválido"})
		return
	}

	group, err := h.groupService.GetByID(c.Request.Context(), id)
	if err != nil {
		if errors.Is(err, domain.ErrGroupNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": domain.ErrInternal.Error()})
		return
	}

	c.JSON(http.StatusOK, dto.ToGroupResponse(group))
}

// GetMembers godoc
// GET /api/groups/:id/members
func (h *GroupHandler) GetMembers(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "id inválido"})
		return
	}

	limit := 20
	offset := 0
	if l := c.Query("limit"); l != "" {
		if v, err := strconv.Atoi(l); err == nil && v > 0 {
			limit = v
		}
	}
	if o := c.Query("offset"); o != "" {
		if v, err := strconv.Atoi(o); err == nil && v >= 0 {
			offset = v
		}
	}

	members, err := h.groupService.GetMembers(c.Request.Context(), id, limit, offset)
	if err != nil {
		if errors.Is(err, domain.ErrGroupNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "grupo no encontrado"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "error interno del servidor"})
		return
	}

	c.JSON(http.StatusOK, dto.ToMemberListResponse(members))
}

// Join godoc
// POST /api/groups/:id/join
func (h *GroupHandler) Join(c *gin.Context) {
	callerID := getUserUUID(c)

	groupID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "id inválido"})
		return
	}

	err = h.groupService.Join(c.Request.Context(), groupID, callerID)
	if err != nil {
		if errors.Is(err, domain.ErrGroupNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
			return
		}
		if errors.Is(err, domain.ErrAlreadyMember) {
			// Idempotente — ya era miembro
			c.JSON(http.StatusOK, gin.H{"message": "ya eres miembro de este grupo"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": domain.ErrInternal.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"message": "unido al grupo exitosamente"})
}

// Leave godoc
// DELETE /api/groups/:id/leave
func (h *GroupHandler) Leave(c *gin.Context) {
	callerID := getUserUUID(c)

	groupID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "id inválido"})
		return
	}

	err = h.groupService.Leave(c.Request.Context(), groupID, callerID)
	if err != nil {
		if errors.Is(err, domain.ErrGroupNotFound) || errors.Is(err, domain.ErrNotMember) {
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": domain.ErrInternal.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "saliste del grupo"})
}
