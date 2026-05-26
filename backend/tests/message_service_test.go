package tests

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/dto"
	"lost-pets/internal/event"
	"lost-pets/internal/service"
)

// ============================================================
// Mock: MessageRepository
// ============================================================

type mockMessageRepository struct {
	createFn          func(ctx context.Context, msg *domain.Message) error
	getByIDFn         func(ctx context.Context, id uuid.UUID) (*domain.Message, error)
	getConversationFn func(ctx context.Context, userA, userB uuid.UUID, limit, offset int) ([]domain.Message, error)
	getConversationsFn func(ctx context.Context, userID uuid.UUID) ([]domain.Message, error)
	markAsReadFn      func(ctx context.Context, messageID uuid.UUID) error
}

func (m *mockMessageRepository) Create(ctx context.Context, msg *domain.Message) error {
	if m.createFn != nil {
		return m.createFn(ctx, msg)
	}
	msg.ID = uuid.New()
	return nil
}

func (m *mockMessageRepository) GetByID(ctx context.Context, id uuid.UUID) (*domain.Message, error) {
	if m.getByIDFn != nil {
		return m.getByIDFn(ctx, id)
	}
	return &domain.Message{ID: id}, nil
}

func (m *mockMessageRepository) GetConversation(ctx context.Context, userA, userB uuid.UUID, limit, offset int) ([]domain.Message, error) {
	if m.getConversationFn != nil {
		return m.getConversationFn(ctx, userA, userB, limit, offset)
	}
	return []domain.Message{}, nil
}

func (m *mockMessageRepository) GetConversations(ctx context.Context, userID uuid.UUID) ([]domain.Message, error) {
	if m.getConversationsFn != nil {
		return m.getConversationsFn(ctx, userID)
	}
	return []domain.Message{}, nil
}

func (m *mockMessageRepository) MarkAsRead(ctx context.Context, messageID uuid.UUID) error {
	if m.markAsReadFn != nil {
		return m.markAsReadFn(ctx, messageID)
	}
	return nil
}

// ============================================================
// Mock: BlockedUserRepository (reused from review_service_test.go,
// but we need a separate type to avoid redeclaration conflicts — we
// reuse mockBlockedUserRepository which is already declared there)
// ============================================================

// mockBlockedRepoForMsg is a separate type to avoid name collisions across test files.
type mockBlockedRepoForMsg struct {
	isBlockedFn func(ctx context.Context, userA, userB uuid.UUID) (bool, error)
}

func (m *mockBlockedRepoForMsg) Create(ctx context.Context, block *domain.BlockedUser) error {
	return nil
}

func (m *mockBlockedRepoForMsg) Delete(ctx context.Context, blockerID, blockedID uuid.UUID) error {
	return nil
}

func (m *mockBlockedRepoForMsg) IsBlocked(ctx context.Context, userA, userB uuid.UUID) (bool, error) {
	if m.isBlockedFn != nil {
		return m.isBlockedFn(ctx, userA, userB)
	}
	return false, nil
}

func (m *mockBlockedRepoForMsg) GetBlockedByUserID(ctx context.Context, userID uuid.UUID) ([]domain.BlockedUser, error) {
	return []domain.BlockedUser{}, nil
}

// ============================================================
// Helpers
// ============================================================

func newMessageService(
	msgRepo *mockMessageRepository,
	blockedRepo *mockBlockedRepoForMsg,
) service.MessageService {
	bus := event.NewEventBus()
	return service.NewMessageService(msgRepo, blockedRepo, bus)
}

// ============================================================
// Send tests
// ============================================================

func TestMessageService_Send(t *testing.T) {
	senderID := uuid.New()
	receiverID := uuid.New()
	msgID := uuid.New()

	tests := []struct {
		name        string
		senderIDStr string
		msgRepo     *mockMessageRepository
		blockedRepo *mockBlockedRepoForMsg
		req         dto.SendMessageRequest
		wantErr     error
	}{
		{
			name:        "happy path — message stored",
			senderIDStr: senderID.String(),
			msgRepo: &mockMessageRepository{
				createFn: func(_ context.Context, m *domain.Message) error {
					m.ID = msgID
					return nil
				},
				getByIDFn: func(_ context.Context, id uuid.UUID) (*domain.Message, error) {
					return &domain.Message{
						ID:         id,
						SenderID:   senderID,
						ReceiverID: receiverID,
						Text:       "Hello!",
						Sender:     domain.User{ID: senderID, Name: "Alice"},
					}, nil
				},
			},
			blockedRepo: &mockBlockedRepoForMsg{
				isBlockedFn: func(_ context.Context, _, _ uuid.UUID) (bool, error) {
					return false, nil
				},
			},
			req: dto.SendMessageRequest{
				ReceiverID: receiverID,
				Content:    "Hello!",
			},
			wantErr: nil,
		},
		{
			name:        "self-message — ErrSelfMessage",
			senderIDStr: senderID.String(),
			msgRepo:     &mockMessageRepository{},
			blockedRepo: &mockBlockedRepoForMsg{},
			req: dto.SendMessageRequest{
				ReceiverID: senderID, // same as sender
				Content:    "Message to myself",
			},
			wantErr: domain.ErrSelfMessage,
		},
		{
			name:        "sender blocked receiver — ErrUserBlocked",
			senderIDStr: senderID.String(),
			msgRepo:     &mockMessageRepository{},
			blockedRepo: &mockBlockedRepoForMsg{
				isBlockedFn: func(_ context.Context, _, _ uuid.UUID) (bool, error) {
					return true, nil // A blocked B
				},
			},
			req: dto.SendMessageRequest{
				ReceiverID: receiverID,
				Content:    "Hello!",
			},
			wantErr: domain.ErrUserBlocked,
		},
		{
			name:        "reverse block also returns ErrUserBlocked",
			senderIDStr: senderID.String(),
			msgRepo:     &mockMessageRepository{},
			blockedRepo: &mockBlockedRepoForMsg{
				isBlockedFn: func(_ context.Context, _, _ uuid.UUID) (bool, error) {
					return true, nil // B blocked A (bidirectional check in IsBlocked)
				},
			},
			req: dto.SendMessageRequest{
				ReceiverID: receiverID,
				Content:    "Hello from blocked user!",
			},
			wantErr: domain.ErrUserBlocked,
		},
		{
			name:        "invalid sender UUID — ErrInvalidInput",
			senderIDStr: "not-a-uuid",
			msgRepo:     &mockMessageRepository{},
			blockedRepo: &mockBlockedRepoForMsg{},
			req: dto.SendMessageRequest{
				ReceiverID: receiverID,
				Content:    "Hello!",
			},
			wantErr: domain.ErrInvalidInput,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			svc := newMessageService(tc.msgRepo, tc.blockedRepo)
			msg, err := svc.Send(context.Background(), tc.senderIDStr, tc.req)

			if tc.wantErr != nil {
				if !errors.Is(err, tc.wantErr) {
					t.Errorf("expected error %v, got %v", tc.wantErr, err)
				}
				if msg != nil {
					t.Errorf("expected nil message on error, got %+v", msg)
				}
				return
			}

			if err != nil {
				t.Errorf("unexpected error: %v", err)
				return
			}
			if msg == nil {
				t.Error("expected message, got nil")
			}
		})
	}
}

// ============================================================
// GetConversation tests
// ============================================================

func TestMessageService_GetConversation(t *testing.T) {
	userID := uuid.New()
	otherID := uuid.New()

	messages := []domain.Message{
		{ID: uuid.New(), SenderID: userID, ReceiverID: otherID, Text: "Hi"},
		{ID: uuid.New(), SenderID: otherID, ReceiverID: userID, Text: "Hello back"},
	}

	tests := []struct {
		name        string
		userIDStr   string
		otherIDStr  string
		msgRepo     *mockMessageRepository
		wantCount   int
		wantErr     error
	}{
		{
			name:       "returns messages between two users",
			userIDStr:  userID.String(),
			otherIDStr: otherID.String(),
			msgRepo: &mockMessageRepository{
				getConversationFn: func(_ context.Context, _, _ uuid.UUID, _, _ int) ([]domain.Message, error) {
					return messages, nil
				},
			},
			wantCount: 2,
			wantErr:   nil,
		},
		{
			name:       "invalid userID — ErrInvalidInput",
			userIDStr:  "bad-uuid",
			otherIDStr: otherID.String(),
			msgRepo:    &mockMessageRepository{},
			wantCount:  0,
			wantErr:    domain.ErrInvalidInput,
		},
		{
			name:       "invalid otherUserID — ErrInvalidInput",
			userIDStr:  userID.String(),
			otherIDStr: "bad-uuid",
			msgRepo:    &mockMessageRepository{},
			wantCount:  0,
			wantErr:    domain.ErrInvalidInput,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			svc := newMessageService(tc.msgRepo, &mockBlockedRepoForMsg{})
			result, err := svc.GetConversation(context.Background(), tc.userIDStr, tc.otherIDStr, 20, 0)

			if tc.wantErr != nil {
				if !errors.Is(err, tc.wantErr) {
					t.Errorf("expected error %v, got %v", tc.wantErr, err)
				}
				return
			}

			if err != nil {
				t.Errorf("unexpected error: %v", err)
				return
			}

			if len(result) != tc.wantCount {
				t.Errorf("expected %d messages, got %d", tc.wantCount, len(result))
			}
		})
	}
}

// ============================================================
// MarkAsRead tests
// ============================================================

func TestMessageService_MarkAsRead(t *testing.T) {
	receiverID := uuid.New()
	senderID := uuid.New()
	msgID := uuid.New()

	tests := []struct {
		name      string
		userID    string
		messageID string
		msgRepo   *mockMessageRepository
		wantErr   error
	}{
		{
			name:      "happy path — marked as read",
			userID:    receiverID.String(),
			messageID: msgID.String(),
			msgRepo: &mockMessageRepository{
				getByIDFn: func(_ context.Context, id uuid.UUID) (*domain.Message, error) {
					return &domain.Message{
						ID:         id,
						SenderID:   senderID,
						ReceiverID: receiverID,
						IsRead:     false,
						CreatedAt:  time.Now(),
					}, nil
				},
				markAsReadFn: func(_ context.Context, _ uuid.UUID) error {
					return nil
				},
			},
			wantErr: nil,
		},
		{
			name:      "wrong user — ErrNotMessageReceiver",
			userID:    senderID.String(), // sender trying to mark as read
			messageID: msgID.String(),
			msgRepo: &mockMessageRepository{
				getByIDFn: func(_ context.Context, id uuid.UUID) (*domain.Message, error) {
					return &domain.Message{
						ID:         id,
						SenderID:   senderID,
						ReceiverID: receiverID, // receiver is different from caller
						IsRead:     false,
					}, nil
				},
			},
			wantErr: domain.ErrNotMessageReceiver,
		},
		{
			name:      "message not found — ErrMessageNotFound",
			userID:    receiverID.String(),
			messageID: msgID.String(),
			msgRepo: &mockMessageRepository{
				getByIDFn: func(_ context.Context, _ uuid.UUID) (*domain.Message, error) {
					return nil, domain.ErrMessageNotFound
				},
			},
			wantErr: domain.ErrMessageNotFound,
		},
		{
			name:      "invalid messageID — ErrInvalidInput",
			userID:    receiverID.String(),
			messageID: "not-a-uuid",
			msgRepo:   &mockMessageRepository{},
			wantErr:   domain.ErrInvalidInput,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			svc := newMessageService(tc.msgRepo, &mockBlockedRepoForMsg{})
			err := svc.MarkAsRead(context.Background(), tc.userID, tc.messageID)

			if tc.wantErr != nil {
				if !errors.Is(err, tc.wantErr) {
					t.Errorf("expected error %v, got %v", tc.wantErr, err)
				}
				return
			}

			if err != nil {
				t.Errorf("unexpected error: %v", err)
			}
		})
	}
}
