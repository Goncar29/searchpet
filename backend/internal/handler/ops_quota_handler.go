package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"lost-pets/internal/service"
)

// opsTokenHeader lleva el secreto compartido que autoriza el reporte de cupo.
const opsTokenHeader = "X-Ops-Token"

// OpsQuotaHandler publica el consumo del cupo de mail para el monitoreo externo.
//
// El cuerpo dice cuanta cuota queda, que para un atacante es el marcador del
// partido: le confirma si ya gano y cuanto le falta. De ahi el token.
//
// El 404 sigue la forma del endpoint hermano (reindex), pero OJO: no vuelve
// invisible a la ruta, y nada puede depender de que lo haga. Una ruta inexistente
// devuelve el `404 page not found` de gin en text/plain; esta devuelve
// {code,message} en application/json. El cuerpo delata que existe igual que un 401.
// Se acepta porque el sigilo nunca fue la proteccion — la proteccion es el token.
type OpsQuotaHandler struct {
	quotaService *service.OpsQuotaService
	token        string
}

func NewOpsQuotaHandler(quotaService *service.OpsQuotaService, token string) *OpsQuotaHandler {
	return &OpsQuotaHandler{quotaService: quotaService, token: token}
}

// Report devuelve el consumo por canal.
func (h *OpsQuotaHandler) Report(c *gin.Context) {
	// Deshabilitado salvo que OPS_STATUS_TOKEN este configurado.
	//
	// Lo que sostiene la seguridad es que esta guarda EXISTA, no que vaya primero:
	// con dos early-returns independientes el orden es indistinguible. El agujero
	// real es colapsar las dos en una sola comparacion (`header == token` para
	// autorizar), porque ahi una variable sin setear matchea con un header vacio y
	// el endpoint le contesta a cualquiera. Ese es el caso que cubre
	// TestOpsQuota_TokenVacioDa404ConHeaderVacio, y se probo en rojo.
	if h.token == "" {
		c.JSON(http.StatusNotFound, gin.H{"code": "not_found", "message": "not found"})
		return
	}
	if c.GetHeader(opsTokenHeader) != h.token {
		c.JSON(http.StatusNotFound, gin.H{"code": "not_found", "message": "not found"})
		return
	}

	report, err := h.quotaService.Report(c.Request.Context())
	if err != nil {
		// Sin status y sin alerts: nunca se gradua un conteo que no ocurrio.
		c.JSON(http.StatusInternalServerError, gin.H{"code": "internal_error", "message": "quota report failed"})
		return
	}

	c.JSON(http.StatusOK, report)
}
