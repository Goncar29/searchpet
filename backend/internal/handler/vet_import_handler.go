package handler

import (
	"context"
	"net/http"
	"sync/atomic"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
	"lost-pets/internal/domain"
	"lost-pets/internal/dto"
	"lost-pets/internal/osmimport"
	"lost-pets/pkg/logger"
)

// VetImporter is the slice of osmimport.Importer this handler needs. Declaring it
// here keeps the handler testable with a fake and keeps the HTTP layer from
// depending on a concrete importer.
type VetImporter interface {
	Run(ctx context.Context) (osmimport.Result, error)
}

// VetImportHandler exposes the OSM veterinary import to admins (RequireAdmin at
// the route level).
//
// The import is synchronous on purpose: the Overpass round trip was measured at
// 10.9 s for all of Uruguay (2026-08-13), and a run that DELETES rows should hand
// its result back in the same response the operator is already waiting on. An
// async job would move that outcome behind a second request and lose it entirely
// on a free-tier restart.
type VetImportHandler struct {
	importer VetImporter
	// running serialises runs. Two concurrent imports would interleave their
	// cutoffs and thresholds over each other's writes — exactly the state the
	// guards reason about — and serialising is cheaper than reasoning about it.
	running atomic.Bool
}

// NewVetImportHandler builds the handler.
func NewVetImportHandler(importer VetImporter) *VetImportHandler {
	return &VetImportHandler{importer: importer}
}

// Import godoc
// POST /api/admin/vets/import  (admin only)
func (h *VetImportHandler) Import(c *gin.Context) {
	if !h.running.CompareAndSwap(false, true) {
		writeError(c, http.StatusConflict, domain.ErrVetImportRunning)
		return
	}
	defer h.running.Store(false)

	res, err := h.importer.Run(c.Request.Context())
	if err != nil {
		// The upstream error carries the endpoint and driver internals, so it goes
		// to the log drain and never to the client.
		logger.Get().Error("vet import failed", zap.Error(err))
		writeError(c, http.StatusBadGateway, domain.ErrVetImportUpstream)
		return
	}

	logger.Get().Info("vet import completed",
		zap.Int("scanned", res.Scanned), zap.Int("upserted", res.Upserted),
		zap.Int("swept", res.Swept), zap.String("sweep_skipped", res.SweepSkipped))

	c.JSON(http.StatusOK, dto.ToVetImportResponse(res))
}
