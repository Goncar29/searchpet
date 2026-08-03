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
		// La pregunta no es "se fue el caller" sino "el chequeo fallo PORQUE
		// se fue el caller". Se separan cuando la base RECHAZA la conexion y
		// el caller se desconecta a la vez: ahi gana el error de dial y la
		// caida real se loguea, cosa que preguntandole al contexto no pasaba.
		//
		// OJO con el alcance, que es menor que el que parece: si la base esta
		// COLGADA (acepta y no contesta), la query se queda esperando el
		// contexto, y un caller que corta adentro de la ventana de 2s produce
		// un error que envuelve context.Canceled. Esa caida real SI se suprime
		// igual. El timeout achica la ventana, no la cierra.
		//
		// context.Canceled sobrevive el wrapping de GORM y pgx: verificado
		// contra Postgres real, no supuesto.
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
