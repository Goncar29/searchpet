package handler

import (
	"context"
	"net/http"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
)

// ReadinessChecker responde si la dependencia dura del backend contesta.
//
// La interfaz la declara el consumidor, no el proveedor: el handler no conoce
// gorm y se testea con un stub. La implementacion concreta vive en pkg/database,
// que ya es la duena de las cuestiones de conexion.
type ReadinessChecker interface {
	Check(ctx context.Context) error
}

// HealthHandler sirve el readiness. El liveness (/health) NO pasa por aca a
// proposito: su valor es no tener dependencias. Ver el design del 2026-08-03.
type HealthHandler struct {
	checker ReadinessChecker
	log     *zap.Logger
}

func NewHealthHandler(checker ReadinessChecker, log *zap.Logger) *HealthHandler {
	return &HealthHandler{checker: checker, log: log}
}

// Ready contesta 200 si la base responde y 503 si no.
//
// El error real del driver va al LOG y nunca al cuerpo: los errores de conexion
// de Postgres traen host, puerto, usuario y a veces el nombre de la base, y este
// endpoint es publico. Regalar la topologia de la infraestructura justo cuando
// algo se rompio es exactamente lo que no queremos.
func (h *HealthHandler) Ready(c *gin.Context) {
	if err := h.checker.Check(c.Request.Context()); err != nil {
		h.log.Error("readiness: la base no contesta", zap.Error(err))
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"code":    "not_ready",
			"message": "database unreachable",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "ready"})
}
