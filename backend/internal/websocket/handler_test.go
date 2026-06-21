package websocket

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

// newTestHandler builds a Handler whose error paths (missing/invalid ticket)
// return before any Hub interaction, so a non-running Hub is sufficient.
func newTestHandler() *Handler {
	return NewHandler(NewHub(nil), NewTicketStore())
}

// runConnect drives Connect with the given ticket query value and returns the
// status code plus the decoded {code,message} body.
func runConnect(t *testing.T, ticket string) (status int, body map[string]string) {
	t.Helper()
	gin.SetMode(gin.TestMode)

	h := newTestHandler()
	r := gin.New()
	r.GET("/api/ws", h.Connect)

	target := "/api/ws"
	if ticket != "" {
		target += "?ticket=" + ticket
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, target, nil))

	_ = json.Unmarshal(w.Body.Bytes(), &body)
	return w.Code, body
}

func TestConnect_MissingTicket_Returns401TicketRequired(t *testing.T) {
	status, body := runConnect(t, "")

	if status != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", status)
	}
	if body["code"] != "ticket_required" {
		t.Errorf("expected code 'ticket_required', got %q (body=%v)", body["code"], body)
	}
	if body["message"] == "" {
		t.Error("expected a non-empty message field per the {code,message} contract")
	}
}

func TestConnect_InvalidTicket_Returns401TicketInvalid(t *testing.T) {
	status, body := runConnect(t, "not-a-real-ticket")

	if status != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", status)
	}
	if body["code"] != "ticket_invalid" {
		t.Errorf("expected code 'ticket_invalid', got %q (body=%v)", body["code"], body)
	}
	if body["message"] == "" {
		t.Error("expected a non-empty message field per the {code,message} contract")
	}
}
