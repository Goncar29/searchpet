package tests

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/dto"
	"lost-pets/internal/handler"
	"lost-pets/internal/service"
	"lost-pets/pkg/storage"
)

// ============================================================
// Mock: MessageService (full interface implementation)
// ============================================================

type mockMessageService struct {
	getMessageByIDFn    func(ctx context.Context, id uuid.UUID) (*domain.Message, error)
	sendFn              func(ctx context.Context, senderID string, req dto.SendMessageRequest) (*domain.Message, error)
	getConversationsFn  func(ctx context.Context, userID string) ([]domain.Message, error)
	getConversationFn   func(ctx context.Context, userID, otherUserID string, limit, offset int) ([]domain.Message, error)
	markAsReadFn        func(ctx context.Context, userID, messageID string) error
	markConvReadFn      func(ctx context.Context, userID, otherUserID string) error
	countUnreadFn       func(ctx context.Context, userID string) (int64, error)
}

func (m *mockMessageService) Send(ctx context.Context, senderID string, req dto.SendMessageRequest) (*domain.Message, error) {
	if m.sendFn != nil {
		return m.sendFn(ctx, senderID, req)
	}
	return &domain.Message{ID: uuid.New()}, nil
}

func (m *mockMessageService) GetConversations(ctx context.Context, userID string) ([]domain.Message, error) {
	if m.getConversationsFn != nil {
		return m.getConversationsFn(ctx, userID)
	}
	return nil, nil
}

func (m *mockMessageService) GetConversation(ctx context.Context, userID, otherUserID string, limit, offset int) ([]domain.Message, error) {
	if m.getConversationFn != nil {
		return m.getConversationFn(ctx, userID, otherUserID, limit, offset)
	}
	return nil, nil
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

// Ensure mockMessageService satisfies service.MessageService at compile time.
var _ service.MessageService = (*mockMessageService)(nil)

// ============================================================
// Helpers: build a gin router for GET /messages/:messageId/photo-url
// ============================================================

func buildGetPhotoURLRouter(svc service.MessageService, cloudinaryClient *storage.CloudinaryClient, callerUUID uuid.UUID) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	h := handler.NewMessageHandler(svc, cloudinaryClient)
	r.GET("/messages/:messageId/photo-url", func(c *gin.Context) {
		c.Set("userID", callerUUID)
		h.GetPhotoSignedURL(c)
	})
	return r
}

// ============================================================
// Tests: GET /messages/:messageId/photo-url
// ============================================================

// TestGetPhotoSignedURL_NonParticipant_Returns403 verifies that a user who is
// neither the sender nor the receiver of a message gets a 403.
func TestGetPhotoSignedURL_NonParticipant_Returns403(t *testing.T) {
	senderID := uuid.New()
	receiverID := uuid.New()
	callerID := uuid.New() // completely unrelated user
	messageID := uuid.New()

	svc := &mockMessageService{
		getMessageByIDFn: func(_ context.Context, id uuid.UUID) (*domain.Message, error) {
			return &domain.Message{
				ID:            id,
				SenderID:      senderID,
				ReceiverID:    receiverID,
				PhotoPublicID: "pets/some/publicid",
			}, nil
		},
	}

	// A real CloudinaryClient with dummy credentials returns an error but the
	// handler reaches the auth check before trying to generate the URL.
	// We use a non-nil stub by creating one with placeholder credentials.
	// Since we only need the handler to NOT return 503, we use a tiny stub.
	// The handler checks nil-ness of cloudinary before doing auth checks,
	// so we must pass a non-nil client to reach the 403 path.
	cloudinary, _ := storage.NewCloudinaryClient("cloud", "key", "secret")

	r := buildGetPhotoURLRouter(svc, cloudinary, callerID)
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/messages/%s/photo-url", messageID), nil)
	r.ServeHTTP(w, req)

	if w.Code != http.StatusForbidden {
		t.Errorf("expected 403, got %d (body: %s)", w.Code, w.Body.String())
	}
}

// TestGetPhotoSignedURL_NoPhoto_Returns404 verifies that when the message has no
// PhotoPublicID, the handler returns 404.
func TestGetPhotoSignedURL_NoPhoto_Returns404(t *testing.T) {
	callerID := uuid.New()
	messageID := uuid.New()

	svc := &mockMessageService{
		getMessageByIDFn: func(_ context.Context, id uuid.UUID) (*domain.Message, error) {
			return &domain.Message{
				ID:            id,
				SenderID:      callerID,
				ReceiverID:    uuid.New(),
				PhotoPublicID: "", // no photo
			}, nil
		},
	}

	cloudinary, _ := storage.NewCloudinaryClient("cloud", "key", "secret")

	r := buildGetPhotoURLRouter(svc, cloudinary, callerID)
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/messages/%s/photo-url", messageID), nil)
	r.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d (body: %s)", w.Code, w.Body.String())
	}
}

// TestGetPhotoSignedURL_NilCloudinary_Returns503 verifies that when the Cloudinary
// client is nil (not configured), the handler returns 503.
func TestGetPhotoSignedURL_NilCloudinary_Returns503(t *testing.T) {
	callerID := uuid.New()
	messageID := uuid.New()

	svc := &mockMessageService{
		getMessageByIDFn: func(_ context.Context, id uuid.UUID) (*domain.Message, error) {
			return &domain.Message{
				ID:            id,
				SenderID:      callerID,
				ReceiverID:    uuid.New(),
				PhotoPublicID: "pets/some/publicid",
			}, nil
		},
	}

	// nil cloudinary → 503 before any service call
	r := buildGetPhotoURLRouter(svc, nil, callerID)
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/messages/%s/photo-url", messageID), nil)
	r.ServeHTTP(w, req)

	if w.Code != http.StatusServiceUnavailable {
		t.Errorf("expected 503, got %d (body: %s)", w.Code, w.Body.String())
	}
}

// TestGetPhotoSignedURL_MessageNotFound_Returns404 verifies that when the message
// is not found, the handler returns 404.
func TestGetPhotoSignedURL_MessageNotFound_Returns404(t *testing.T) {
	callerID := uuid.New()
	messageID := uuid.New()

	svc := &mockMessageService{
		getMessageByIDFn: func(_ context.Context, _ uuid.UUID) (*domain.Message, error) {
			return nil, domain.ErrMessageNotFound
		},
	}

	cloudinary, _ := storage.NewCloudinaryClient("cloud", "key", "secret")

	r := buildGetPhotoURLRouter(svc, cloudinary, callerID)
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/messages/%s/photo-url", messageID), nil)
	r.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d (body: %s)", w.Code, w.Body.String())
	}
}

