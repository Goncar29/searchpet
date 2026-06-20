package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"lost-pets/internal/service"
)

// reindexTokenHeader is the request header carrying the shared secret that
// authorizes the one-off embeddings backfill.
const reindexTokenHeader = "X-Reindex-Token"

// ReindexHandler exposes a one-off, token-gated maintenance endpoint that
// re-generates image-search embeddings for every eligible pet.
//
// It is a recovery tool, not a public API: pre-existing lost/stray pets were
// never indexed (their backfill ran under the dead HuggingFace provider). The
// indexing events only fire on new transitions, so without this endpoint those
// pets stay invisible to image search forever.
type ReindexHandler struct {
	embeddingService *service.EmbeddingService
	token            string
}

// NewReindexHandler builds the handler. When token is empty the endpoint is
// disabled and always responds 404 — no surface, no information leak.
func NewReindexHandler(embeddingService *service.EmbeddingService, token string) *ReindexHandler {
	return &ReindexHandler{embeddingService: embeddingService, token: token}
}

// BackfillEmbeddings runs a full embeddings backfill across all lost/stray pets.
//
// Authorization: a constant-time-ish shared secret in the X-Reindex-Token header.
// When the endpoint is disabled (empty configured token) or the supplied token
// does not match, it returns a bare 404 to avoid revealing that the route exists.
func (h *ReindexHandler) BackfillEmbeddings(c *gin.Context) {
	// Disabled unless REINDEX_TOKEN is configured.
	if h.token == "" {
		c.JSON(http.StatusNotFound, gin.H{"code": "not_found", "message": "not found"})
		return
	}

	// Wrong/missing token: indistinguishable from "route does not exist".
	if c.GetHeader(reindexTokenHeader) != h.token {
		c.JSON(http.StatusNotFound, gin.H{"code": "not_found", "message": "not found"})
		return
	}

	result := h.embeddingService.BackfillAll(c.Request.Context())
	c.JSON(http.StatusOK, result)
}
