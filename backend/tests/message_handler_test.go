package tests

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/dto"
	"lost-pets/internal/handler"
	"lost-pets/internal/service"
)

// ============================================================
// Mock: MessageService
// ============================================================

type mockMessageService struct {
	sendFn             func(ctx context.Context, senderID string, req dto.SendMessageRequest) (*domain.Message, error)
	getConversationsFn func(ctx context.Context, userID string) ([]domain.Message, error)
	getConversationFn  func(ctx context.Context, userID, otherUserID string, limit, offset int) ([]domain.Message, error)
	markAsReadFn       func(ctx context.Context, userID, messageID string) error
	getMessageByIDFn   func(ctx context.Context, id uuid.UUID) (*domain.Message, error)
	markConvReadFn     func(ctx context.Context, userID, otherUserID string) error
	countUnreadFn      func(ctx context.Context, userID string) (int64, error)
	hideConversationFn func(ctx context.Context, userID, otherUserID string) error
	markConvUnreadFn   func(ctx context.Context, userID, otherUserID string) error
	countBySenderFn    func(ctx context.Context, userID string) (map[uuid.UUID]int64, error)
}

func (m *mockMessageService) CountUnreadBySender(ctx context.Context, userID string) (map[uuid.UUID]int64, error) {
	if m.countBySenderFn != nil {
		return m.countBySenderFn(ctx, userID)
	}
	return map[uuid.UUID]int64{}, nil
}

func (m *mockMessageService) Send(ctx context.Context, senderID string, req dto.SendMessageRequest) (*domain.Message, error) {
	if m.sendFn != nil {
		return m.sendFn(ctx, senderID, req)
	}
	return &domain.Message{}, nil
}

func (m *mockMessageService) GetConversations(ctx context.Context, userID string) ([]domain.Message, error) {
	if m.getConversationsFn != nil {
		return m.getConversationsFn(ctx, userID)
	}
	return []domain.Message{}, nil
}

func (m *mockMessageService) GetConversation(ctx context.Context, userID, otherUserID string, limit, offset int) ([]domain.Message, error) {
	if m.getConversationFn != nil {
		return m.getConversationFn(ctx, userID, otherUserID, limit, offset)
	}
	return []domain.Message{}, nil
}

func (m *mockMessageService) MarkAsRead(ctx context.Context, userID, messageID string) error {
	if m.markAsReadFn != nil {
		return m.markAsReadFn(ctx, userID, messageID)
	}
	return nil
}

func (m *mockMessageService) GetMessageByID(ctx context.Context, id uuid.UUID) (*domain.Message, error) {
	if m.getMessageByIDFn != nil {
		return m.getMessageByIDFn(ctx, id)
	}
	return &domain.Message{ID: id}, nil
}

func (m *mockMessageService) MarkConversationRead(ctx context.Context, userID, otherUserID string) error {
	if m.markConvReadFn != nil {
		return m.markConvReadFn(ctx, userID, otherUserID)
	}
	return nil
}

func (m *mockMessageService) CountUnread(ctx context.Context, userID string) (int64, error) {
	if m.countUnreadFn != nil {
		return m.countUnreadFn(ctx, userID)
	}
	return 0, nil
}

func (m *mockMessageService) HideConversation(ctx context.Context, userID, otherUserID string) error {
	if m.hideConversationFn != nil {
		return m.hideConversationFn(ctx, userID, otherUserID)
	}
	return nil
}

func (m *mockMessageService) MarkConversationUnread(ctx context.Context, userID, otherUserID string) error {
	if m.markConvUnreadFn != nil {
		return m.markConvUnreadFn(ctx, userID, otherUserID)
	}
	return nil
}

// Ensure interface compliance at compile time.
var _ service.MessageService = (*mockMessageService)(nil)

// ============================================================
// Router setup
// ============================================================

func setupMessageRouter(h *handler.MessageHandler, callerID uuid.UUID) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	auth := r.Group("/api/messages", injectUserID(callerID))
	auth.POST("", h.Send)
	auth.GET("", h.GetConversations)
	auth.GET("/unread-count", h.GetUnreadCount)
	auth.GET("/:userId", h.GetConversation)
	auth.PATCH("/:id/read", h.MarkAsRead)

	conversations := r.Group("/api/conversations", injectUserID(callerID))
	conversations.DELETE("/:userId", h.HideConversation)
	conversations.PATCH("/:userId/unread", h.MarkConversationUnread)
	return r
}

// newTestMessage is a helper that builds a minimal domain.Message for use in mocks.
func newTestMessage(senderID, receiverID uuid.UUID, text string) *domain.Message {
	return &domain.Message{
		ID:         uuid.New(),
		SenderID:   senderID,
		ReceiverID: receiverID,
		Text:       text,
		CreatedAt:  time.Now(),
	}
}

// ============================================================
// Send tests
// ============================================================

func TestMessageHandler_Send_ValidBody_Returns201(t *testing.T) {
	callerID := uuid.New()
	receiverID := uuid.New()

	msg := newTestMessage(callerID, receiverID, "Hola, vi a tu mascota!")

	svc := &mockMessageService{
		sendFn: func(_ context.Context, _ string, _ dto.SendMessageRequest) (*domain.Message, error) {
			return msg, nil
		},
	}
	h := handler.NewMessageHandler(svc, nil)
	r := setupMessageRouter(h, callerID)

	reqBody := dto.SendMessageRequest{
		ReceiverID: receiverID,
		Content:    "Hola, vi a tu mascota!",
	}
	body, _ := json.Marshal(reqBody)
	req := httptest.NewRequest(http.MethodPost, "/api/messages", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Errorf("expected 201, got %d — body: %s", w.Code, w.Body.String())
	}

	var resp dto.MessageResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("could not parse response: %v", err)
	}
	if resp.Content != "Hola, vi a tu mascota!" {
		t.Errorf("unexpected content in response: %s", resp.Content)
	}
}

func TestMessageHandler_Send_MissingReceiverID_Returns400(t *testing.T) {
	callerID := uuid.New()

	svc := &mockMessageService{}
	h := handler.NewMessageHandler(svc, nil)
	r := setupMessageRouter(h, callerID)

	// ReceiverID is required — omit it.
	body := []byte(`{"content":"hola"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/messages", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

func TestMessageHandler_Send_BlockedUser_Returns403(t *testing.T) {
	callerID := uuid.New()
	receiverID := uuid.New()

	svc := &mockMessageService{
		sendFn: func(_ context.Context, _ string, _ dto.SendMessageRequest) (*domain.Message, error) {
			return nil, domain.ErrUserBlocked
		},
	}
	h := handler.NewMessageHandler(svc, nil)
	r := setupMessageRouter(h, callerID)

	reqBody := dto.SendMessageRequest{ReceiverID: receiverID, Content: "hola"}
	body, _ := json.Marshal(reqBody)
	req := httptest.NewRequest(http.MethodPost, "/api/messages", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusForbidden {
		t.Errorf("expected 403 for blocked user, got %d", w.Code)
	}
}

func TestMessageHandler_Send_SelfMessage_Returns400(t *testing.T) {
	callerID := uuid.New()

	svc := &mockMessageService{
		sendFn: func(_ context.Context, _ string, _ dto.SendMessageRequest) (*domain.Message, error) {
			return nil, domain.ErrSelfMessage
		},
	}
	h := handler.NewMessageHandler(svc, nil)
	r := setupMessageRouter(h, callerID)

	reqBody := dto.SendMessageRequest{ReceiverID: callerID, Content: "hola"}
	body, _ := json.Marshal(reqBody)
	req := httptest.NewRequest(http.MethodPost, "/api/messages", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for self-message, got %d", w.Code)
	}
}

// ============================================================
// GetConversation tests
// ============================================================

func TestMessageHandler_GetConversation_Returns200WithMessages(t *testing.T) {
	callerID := uuid.New()
	otherID := uuid.New()

	messages := []domain.Message{
		*newTestMessage(callerID, otherID, "hola"),
		*newTestMessage(otherID, callerID, "buenas!"),
	}

	svc := &mockMessageService{
		getConversationFn: func(_ context.Context, _, _ string, _, _ int) ([]domain.Message, error) {
			return messages, nil
		},
	}
	h := handler.NewMessageHandler(svc, nil)
	r := setupMessageRouter(h, callerID)

	req := httptest.NewRequest(http.MethodGet, "/api/messages/"+otherID.String(), nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}

	var resp []dto.MessageResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("could not parse response: %v", err)
	}
	if len(resp) != 2 {
		t.Errorf("expected 2 messages, got %d", len(resp))
	}
}

func TestMessageHandler_GetConversation_NeverReturnsNull(t *testing.T) {
	callerID := uuid.New()
	otherID := uuid.New()

	svc := &mockMessageService{
		getConversationFn: func(_ context.Context, _, _ string, _, _ int) ([]domain.Message, error) {
			return []domain.Message{}, nil
		},
	}
	h := handler.NewMessageHandler(svc, nil)
	r := setupMessageRouter(h, callerID)

	req := httptest.NewRequest(http.MethodGet, "/api/messages/"+otherID.String(), nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}

	body := w.Body.String()
	if body == "null\n" || body == "null" {
		t.Error("empty conversation must serialize as [] not null")
	}
}

func TestMessageHandler_GetConversation_LimitOffsetParsed(t *testing.T) {
	callerID := uuid.New()
	otherID := uuid.New()

	var capturedLimit, capturedOffset int

	svc := &mockMessageService{
		getConversationFn: func(_ context.Context, _, _ string, limit, offset int) ([]domain.Message, error) {
			capturedLimit = limit
			capturedOffset = offset
			return []domain.Message{}, nil
		},
	}
	h := handler.NewMessageHandler(svc, nil)
	r := setupMessageRouter(h, callerID)

	req := httptest.NewRequest(http.MethodGet, "/api/messages/"+otherID.String()+"?limit=5&offset=10", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}
	if capturedLimit != 5 {
		t.Errorf("expected limit=5, got %d", capturedLimit)
	}
	if capturedOffset != 10 {
		t.Errorf("expected offset=10, got %d", capturedOffset)
	}
}

// ============================================================
// GetConversations (list) tests
// ============================================================

func TestMessageHandler_GetConversations_Returns200(t *testing.T) {
	callerID := uuid.New()
	otherID := uuid.New()

	svc := &mockMessageService{
		getConversationsFn: func(_ context.Context, _ string) ([]domain.Message, error) {
			return []domain.Message{*newTestMessage(otherID, callerID, "última")}, nil
		},
	}
	h := handler.NewMessageHandler(svc, nil)
	r := setupMessageRouter(h, callerID)

	req := httptest.NewRequest(http.MethodGet, "/api/messages", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}
}

// Each conversation carries how many of its received messages are unread, so the
// list's dot does not have to guess from the latest message. The count is the
// OTHER participant's: they sent what I received. Both rows below have the
// latest message the other way round, to prove the side does not matter.
func TestMessageHandler_GetConversations_IncluyeUnreadCountPorConversacion(t *testing.T) {
	callerID := uuid.New()
	alice := uuid.New() // I replied last: the latest message is mine.
	bob := uuid.New()   // bob wrote last.

	svc := &mockMessageService{
		getConversationsFn: func(_ context.Context, _ string) ([]domain.Message, error) {
			return []domain.Message{
				*newTestMessage(callerID, alice, "mi respuesta"),
				*newTestMessage(bob, callerID, "hola"),
			}, nil
		},
		countBySenderFn: func(_ context.Context, userID string) (map[uuid.UUID]int64, error) {
			if userID != callerID.String() {
				t.Errorf("counts asked for %s, want the caller %s", userID, callerID)
			}
			return map[uuid.UUID]int64{alice: 1}, nil
		},
	}
	r := setupMessageRouter(handler.NewMessageHandler(svc, nil), callerID)

	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/messages", nil))

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var body []map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(body) != 2 {
		t.Fatalf("want 2 conversations, got %d", len(body))
	}
	if got := body[0]["unread_count"]; got != float64(1) {
		t.Errorf("alice: want unread_count 1, got %v", got)
	}
	// Zero is sent, not omitted: a missing field would read as "unknown".
	if got, ok := body[1]["unread_count"]; !ok || got != float64(0) {
		t.Errorf("bob: want unread_count 0 present, got %v (present=%v)", got, ok)
	}
	// The message fields are still there, flat, as before.
	if body[1]["content"] != "hola" {
		t.Errorf("message fields must stay flat, got content=%v", body[1]["content"])
	}
}

// If the counts cannot be read, the list fails: a 0 there would paint every
// conversation as read, which is a claim nobody verified.
func TestMessageHandler_GetConversations_FallaSiNoPuedeContarNoLeidos(t *testing.T) {
	callerID := uuid.New()
	svc := &mockMessageService{
		getConversationsFn: func(_ context.Context, _ string) ([]domain.Message, error) {
			return []domain.Message{*newTestMessage(uuid.New(), callerID, "hola")}, nil
		},
		countBySenderFn: func(_ context.Context, _ string) (map[uuid.UUID]int64, error) {
			return nil, context.DeadlineExceeded
		},
	}
	r := setupMessageRouter(handler.NewMessageHandler(svc, nil), callerID)

	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/messages", nil))

	if w.Code != http.StatusInternalServerError {
		t.Errorf("expected 500, got %d", w.Code)
	}
}

// ============================================================
// MarkAsRead tests
// ============================================================

func TestMessageHandler_MarkAsRead_Returns200(t *testing.T) {
	callerID := uuid.New()
	messageID := uuid.New()

	svc := &mockMessageService{
		markAsReadFn: func(_ context.Context, _, _ string) error {
			return nil
		},
	}
	h := handler.NewMessageHandler(svc, nil)
	r := setupMessageRouter(h, callerID)

	req := httptest.NewRequest(http.MethodPatch, "/api/messages/"+messageID.String()+"/read", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}

	var resp map[string]interface{}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("could not parse response: %v", err)
	}
	if resp["success"] != true {
		t.Errorf("expected success=true in response")
	}
}

func TestMessageHandler_MarkAsRead_NotFound_Returns404(t *testing.T) {
	callerID := uuid.New()
	messageID := uuid.New()

	svc := &mockMessageService{
		markAsReadFn: func(_ context.Context, _, _ string) error {
			return domain.ErrMessageNotFound
		},
	}
	h := handler.NewMessageHandler(svc, nil)
	r := setupMessageRouter(h, callerID)

	req := httptest.NewRequest(http.MethodPatch, "/api/messages/"+messageID.String()+"/read", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", w.Code)
	}
}

func TestMessageHandler_MarkAsRead_NotReceiver_Returns403(t *testing.T) {
	callerID := uuid.New()
	messageID := uuid.New()

	svc := &mockMessageService{
		markAsReadFn: func(_ context.Context, _, _ string) error {
			return domain.ErrNotMessageReceiver
		},
	}
	h := handler.NewMessageHandler(svc, nil)
	r := setupMessageRouter(h, callerID)

	req := httptest.NewRequest(http.MethodPatch, "/api/messages/"+messageID.String()+"/read", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusForbidden {
		t.Errorf("expected 403 for non-receiver, got %d", w.Code)
	}
}

// ============================================================
// GET /api/messages/unread-count
// ============================================================

func TestMessageHandler_GetUnreadCount_ReturnsCount(t *testing.T) {
	callerID := uuid.New()

	var gotUserID string
	svc := &mockMessageService{
		countUnreadFn: func(_ context.Context, userID string) (int64, error) {
			gotUserID = userID
			return 7, nil
		},
	}
	h := handler.NewMessageHandler(svc, nil)
	r := setupMessageRouter(h, callerID)

	req := httptest.NewRequest(http.MethodGet, "/api/messages/unread-count", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	if gotUserID != callerID.String() {
		t.Errorf("expected count for caller %s, got %s", callerID, gotUserID)
	}

	var body struct {
		Count int64 `json:"count"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("invalid JSON response: %v", err)
	}
	if body.Count != 7 {
		t.Errorf("expected count 7, got %d", body.Count)
	}
}

func TestMessageHandler_GetUnreadCount_ServiceError_Returns500(t *testing.T) {
	svc := &mockMessageService{
		countUnreadFn: func(_ context.Context, _ string) (int64, error) {
			return 0, domain.ErrInternal
		},
	}
	h := handler.NewMessageHandler(svc, nil)
	r := setupMessageRouter(h, uuid.New())

	req := httptest.NewRequest(http.MethodGet, "/api/messages/unread-count", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Errorf("expected 500, got %d", w.Code)
	}
}

// ============================================================
// DELETE /api/conversations/:userId (HideConversation)
// ============================================================

func TestMessageHandler_HideConversation_Returns204(t *testing.T) {
	callerID := uuid.New()
	otherID := uuid.New()

	var gotUser, gotOther string
	svc := &mockMessageService{
		hideConversationFn: func(_ context.Context, userID, otherUserID string) error {
			gotUser, gotOther = userID, otherUserID
			return nil
		},
	}
	h := handler.NewMessageHandler(svc, nil)
	r := setupMessageRouter(h, callerID)

	req := httptest.NewRequest(http.MethodDelete, "/api/conversations/"+otherID.String(), nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusNoContent {
		t.Fatalf("want 204, got %d — body: %s", w.Code, w.Body.String())
	}
	if gotUser != callerID.String() || gotOther != otherID.String() {
		t.Errorf("service called with (%s, %s)", gotUser, gotOther)
	}
}

func TestMessageHandler_HideConversation_InvalidID_Returns400(t *testing.T) {
	svc := &mockMessageService{
		hideConversationFn: func(_ context.Context, _, _ string) error {
			return domain.ErrInvalidInput
		},
	}
	h := handler.NewMessageHandler(svc, nil)
	r := setupMessageRouter(h, uuid.New())

	req := httptest.NewRequest(http.MethodDelete, "/api/conversations/not-a-uuid", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d", w.Code)
	}
}

// ============================================================
// PATCH /api/conversations/:userId/unread (MarkConversationUnread)
// ============================================================

func TestMessageHandler_MarkConversationUnread_Returns204(t *testing.T) {
	callerID := uuid.New()
	otherID := uuid.New()

	svc := &mockMessageService{}
	h := handler.NewMessageHandler(svc, nil)
	r := setupMessageRouter(h, callerID)

	req := httptest.NewRequest(http.MethodPatch, "/api/conversations/"+otherID.String()+"/unread", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusNoContent {
		t.Fatalf("want 204, got %d — body: %s", w.Code, w.Body.String())
	}
}

func TestMessageHandler_MarkConversationUnread_InvalidID_Returns400(t *testing.T) {
	svc := &mockMessageService{
		markConvUnreadFn: func(_ context.Context, _, _ string) error {
			return domain.ErrInvalidInput
		},
	}
	h := handler.NewMessageHandler(svc, nil)
	r := setupMessageRouter(h, uuid.New())

	req := httptest.NewRequest(http.MethodPatch, "/api/conversations/not-a-uuid/unread", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d", w.Code)
	}
}
