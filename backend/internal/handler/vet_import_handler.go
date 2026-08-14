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
	Run(ctx context.Context, opts osmimport.RunOptions) (osmimport.Result, error)
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
	//
	// The scope is this PROCESS, not the service: a second instance would carry
	// its own flag and could run in parallel. That holds today because the free
	// tier runs one instance. If this ever scales out, the lock has to move to
	// the database (an advisory lock, like WithChannelLock does for OTP quotas).
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

	// The body is optional, so a bind failure — no body at all, or malformed JSON —
	// must leave the run fully guarded: failing open here would mean a typo could
	// delete rows.
	//
	// The reset is not belt-and-braces. encoding/json fills fields as it walks the
	// object and keeps what it decoded when it hits the error, so a body truncated
	// mid-object (`{"force_sweep":true,"max_retired":140,`) arrives with BOTH
	// fields set and an error nobody reads. Discarding the error without discarding
	// the half-decoded struct is how a comment ends up describing something the
	// code does not do.
	var req dto.VetImportRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		req = dto.VetImportRequest{}
	}

	res, err := h.importer.Run(c.Request.Context(), osmimport.RunOptions{
		ForceSweep: req.ForceSweep,
		MaxRetired: req.MaxRetired,
	})
	if err != nil {
		// The upstream error carries the endpoint and driver internals, so it goes
		// to the log drain and never to the client.
		logger.Get().Error("vet import failed", zap.Error(err))
		writeError(c, http.StatusBadGateway, domain.ErrVetImportUpstream)
		return
	}

	// The admin and the override travel with the outcome. This run soft-deletes
	// rows and has no un-delete in the panel; when someone later asks why 171
	// clinics went away, "who asked for it, with what evidence, and did the
	// override actually take" has to be answerable from the log drain alone.
	logger.Get().Info("vet import completed",
		zap.String("admin_id", getUserID(c)),
		zap.Int("scanned", res.Scanned), zap.Int("upserted", res.Upserted),
		zap.Int("swept", res.Swept), zap.Int("would_retire", res.WouldRetire),
		zap.String("sweep_skipped", res.SweepSkipped),
		zap.Int64("active_before", res.ActiveBefore),
		// Requested vs applied are different facts: an override granted for a number
		// the new run never reached is recorded as asked-for and NOT forced.
		zap.Bool("force_requested", req.ForceSweep),
		zap.Int("max_retired", req.MaxRetired),
		zap.Bool("sweep_forced", res.SweepForced),
		zap.Bool("force_ignored", res.SweepForceIgnored))

	c.JSON(http.StatusOK, toVetImportResponse(res))
}

// toVetImportResponse maps the importer result onto its HTTP shape. It lives
// here rather than in dto so that the DTO layer keeps mapping from domain only
// and never takes a dependency on an infrastructure package.
func toVetImportResponse(r osmimport.Result) dto.VetImportResponse {
	return dto.VetImportResponse{
		Scanned:           r.Scanned,
		Upserted:          r.Upserted,
		SkippedNoCoords:   r.SkippedNoCoords,
		UpsertFailed:      r.UpsertFailed,
		Swept:             r.Swept,
		WouldRetire:       r.WouldRetire,
		ActiveBefore:      r.ActiveBefore,
		SweepForced:       r.SweepForced,
		SweepForceIgnored: r.SweepForceIgnored,
		SweepSkipped:      r.SweepSkipped,
	}
}
