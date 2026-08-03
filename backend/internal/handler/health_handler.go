package handler

import (
	"context"
	"errors"
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
// algo se rompio es exactamente lo que no queremos. El cuerpo del 503 es
// deliberadamente sin causa ("database unreachable", nada mas): el log es el
// UNICO lugar donde el diagnostico existe.
func (h *HealthHandler) Ready(c *gin.Context) {
	if err := h.checker.Check(c.Request.Context()); err != nil {
		// La pregunta correcta no es "se fue el caller" sino "el chequeo
		// fallo PORQUE se fue el caller". Son distintas en un solo caso: la
		// base esta genuinamente caida Y el caller se desconecta al mismo
		// tiempo (un network flap entre el monitor y el host) — ahi
		// c.Request.Context().Err() != nil iguales, pero el error NO es
		// context.Canceled, es la falla real. Con el predicado viejo
		// (chequear el contexto del request) esa caida real se suprimia del
		// log, justo en el unico lugar donde el diagnostico existe. Con el
		// predicado en el error mismo, solo se suprime cuando la cancelacion
		// es lo que efectivamente rompio el chequeo. Verificado contra
		// Postgres real: un contexto ya cancelado hace que Check devuelva un
		// error donde errors.Is(err, context.Canceled) da true, sobrevive al
		// wrapping de GORM y pgx.
		if !errors.Is(err, context.Canceled) {
			h.log.Error("readiness: la base no contesta", zap.Error(err))
		}
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"code":    "not_ready",
			"message": "database unreachable",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "ready"})
}
