package websocket

import (
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"nhooyr.io/websocket"
)

// Handler holds the Gin HTTP handlers for WebSocket ticket issuance and connection upgrade.
type Handler struct {
	hub   *Hub
	store *TicketStore
}

// NewHandler creates a Handler with the given Hub and TicketStore.
func NewHandler(hub *Hub, store *TicketStore) *Handler {
	return &Handler{hub: hub, store: store}
}

// IssueTicket handles POST /api/ws/ticket (JWT auth required).
// Reads the userID set by the Auth middleware and returns a single-use ticket.
//
//	Response: { "ticket": "<uuid>", "expires_in": 30 }
func (h *Handler) IssueTicket(c *gin.Context) {
	userID := getUserUUID(c)
	if userID == uuid.Nil {
		c.JSON(http.StatusUnauthorized, gin.H{
			"code":    domain.CodeFor(domain.ErrUnauthorized),
			"message": domain.ErrUnauthorized.Error(),
		})
		return
	}

	ticket := h.store.Issue(userID.String())
	c.JSON(http.StatusOK, gin.H{
		"ticket":     ticket,
		"expires_in": 30,
	})
}

// Connect handles GET /api/ws?ticket=<uuid> (no JWT middleware — ticket is the credential).
// Validates the ticket, upgrades the connection, and registers the client with the Hub.
func (h *Handler) Connect(c *gin.Context) {
	ticketID := c.Query("ticket")
	if ticketID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{
			"code":    domain.CodeFor(domain.ErrTicketRequired),
			"message": domain.ErrTicketRequired.Error(),
		})
		return
	}

	userID, ok := h.store.Consume(ticketID)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{
			"code":    domain.CodeFor(domain.ErrTicketInvalid),
			"message": domain.ErrTicketInvalid.Error(),
		})
		return
	}

	conn, err := websocket.Accept(c.Writer, c.Request, &websocket.AcceptOptions{
		// InsecureSkipVerify: true for development — remove or restrict in production.
		InsecureSkipVerify: true,
	})
	if err != nil {
		log.Printf("[ws] Accept error userID=%s: %v", userID, err)
		return
	}

	client := newClient(userID, h.hub, conn)
	h.hub.register <- client

	ctx := c.Request.Context()
	go client.writePump(ctx)
	client.readPump(ctx) // blocks until disconnect
}

// getUserUUID reads the userID set by the Auth middleware from the Gin context.
func getUserUUID(c *gin.Context) uuid.UUID {
	val, exists := c.Get("userID")
	if !exists {
		return uuid.Nil
	}
	id, ok := val.(uuid.UUID)
	if !ok {
		return uuid.Nil
	}
	return id
}
