package handler

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/service"
)

// GamificationHandler maneja los endpoints de gamificación:
// perfiles públicos, leaderboard y badges del usuario autenticado.
type GamificationHandler struct {
	svc service.GamificationService
}

// NewGamificationHandler crea una instancia del handler con sus dependencias.
func NewGamificationHandler(svc service.GamificationService) *GamificationHandler {
	return &GamificationHandler{svc: svc}
}

// GetPublicProfile godoc
// GET /api/users/:id/profile — público, no requiere auth
// Retorna el perfil público de un usuario: nombre, ciudad, puntos, badges.
// No expone email ni password hash.
func (h *GamificationHandler) GetPublicProfile(c *gin.Context) {
	idStr := c.Param("id")
	userID, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "id inválido — debe ser un UUID"})
		return
	}

	profile, err := h.svc.GetPublicProfile(c.Request.Context(), userID)
	if err != nil {
		if errors.Is(err, domain.ErrUserNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": domain.ErrInternal.Error()})
		return
	}

	c.JSON(http.StatusOK, profile)
}

// GetLeaderboard godoc
// GET /api/leaderboard?city=Montevideo&limit=10 — público, no requiere auth
// Parámetros:
//   - city (required): nombre de ciudad para filtrar el ranking
//   - limit (optional): cantidad de entradas a retornar (default 10, máx 50)
func (h *GamificationHandler) GetLeaderboard(c *gin.Context) {
	city := c.Query("city")
	if city == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "parámetro 'city' es requerido"})
		return
	}

	limit := 10
	if limitStr := c.Query("limit"); limitStr != "" {
		l, err := strconv.Atoi(limitStr)
		if err != nil || l < 1 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "parámetro 'limit' debe ser un entero positivo"})
			return
		}
		if l > 50 {
			l = 50
		}
		limit = l
	}

	entries, err := h.svc.GetLeaderboard(c.Request.Context(), city, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": domain.ErrInternal.Error()})
		return
	}

	c.JSON(http.StatusOK, entries)
}

// GetMyBadges godoc
// GET /api/users/me/badges — requiere JWT (middleware de auth)
// Retorna todos los badges/logros del usuario autenticado.
func (h *GamificationHandler) GetMyBadges(c *gin.Context) {
	userID := getUserUUID(c)

	badges, err := h.svc.GetMyBadges(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": domain.ErrInternal.Error()})
		return
	}

	c.JSON(http.StatusOK, badges)
}
