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
	createFn            func(ctx context.Context, msg *domain.Message) error
	getByIDFn           func(ctx context.Context, id uuid.UUID) (*domain.Message, error)
	getConversationFn   func(ctx context.Context, userA, userB uuid.UUID, limit, offset int) ([]domain.Message, error)
	getConversationsFn  func(ctx context.Context, userID uuid.UUID) ([]domain.Message, error)
	markAsReadFn        func(ctx context.Context, messageID uuid.UUID) error
	markConvReadFn      func(ctx context.Context, receiverID, senderID uuid.UUID) error
	countUnreadFn       func(ctx context.Context, userID uuid.UUID) (int64, error)
	// tracking
	markConvReadCalled bool
	markConvReadArgs   [2]uuid.UUID
	countUnreadUserID  uuid.UUID

	markConvUnreadFn     func(ctx context.Context, receiverID, senderID uuid.UUID) error
	markConvUnreadCalled bool
	markConvUnreadArgs   [2]uuid.UUID
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

func (m *mockMessageRepository) MarkConversationRead(ctx context.Context, receiverID, senderID uuid.UUID) error {
	m.markConvReadCalled = true
	m.markConvReadArgs = [2]uuid.UUID{receiverID, senderID}
	if m.markConvReadFn != nil {
		return m.markConvReadFn(ctx, receiverID, senderID)
	}
	return nil
}

func (m *mockMessageRepository) MarkConversationUnread(ctx context.Context, receiverID, senderID uuid.UUID) error {
	m.markConvUnreadCalled = true
	m.markConvUnreadArgs = [2]uuid.UUID{receiverID, senderID}
	if m.markConvUnreadFn != nil {
		return m.markConvUnreadFn(ctx, receiverID, senderID)
	}
	return nil
}

func (m *mockMessageRepository) CountUnread(ctx context.Context, userID uuid.UUID) (int64, error) {
	m.countUnreadUserID = userID
	if m.countUnreadFn != nil {
		return m.countUnreadFn(ctx, userID)
	}
	return 0, nil
}

// ============================================================
// Mock: BlockedUserRepository
// ============================================================

// mockBlockedRepoForMsg is a separate type to avoid name collisions across test files.
type mockBlockedRepoForMsg struct {
	isBlockedFn func(ctx context.Context, userA, userB uuid.UUID) (bool, error)
}

func (m *mockBlockedRepoForMsg) Create(_ context.Context, _ *domain.BlockedUser) error { return nil }
func (m *mockBlockedRepoForMsg) Delete(_ context.Context, _, _ uuid.UUID) error         { return nil }
func (m *mockBlockedRepoForMsg) IsBlocked(ctx context.Context, userA, userB uuid.UUID) (bool, error) {
	if m.isBlockedFn != nil {
		return m.isBlockedFn(ctx, userA, userB)
	}
	return false, nil
}
func (m *mockBlockedRepoForMsg) GetBlockedByUserID(_ context.Context, _ uuid.UUID) ([]domain.BlockedUser, error) {
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
// Tests: Send
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
				ReceiverID: senderID,
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
					return true, nil
				},
			},
			req: dto.SendMessageRequest{
				ReceiverID: receiverID,
				Content:    "Hello!",
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
			}
			if msg == nil {
				t.Error("expected message, got nil")
			}
		})
	}
}

// ============================================================
// Tests: GetConversation
// ============================================================

func TestMessageService_GetConversation(t *testing.T) {
	userID := uuid.New()
	otherID := uuid.New()

	messages := []domain.Message{
		{ID: uuid.New(), SenderID: userID, ReceiverID: otherID, Text: "Hi"},
		{ID: uuid.New(), SenderID: otherID, ReceiverID: userID, Text: "Hello back"},
	}

	tests := []struct {
		name       string
		userIDStr  string
		otherIDStr string
		msgRepo    *mockMessageRepository
		wantCount  int
		wantErr    error
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
		},
		{
			name:       "invalid userID — ErrInvalidInput",
			userIDStr:  "bad-uuid",
			otherIDStr: otherID.String(),
			msgRepo:    &mockMessageRepository{},
			wantErr:    domain.ErrInvalidInput,
		},
		{
			name:       "invalid otherUserID — ErrInvalidInput",
			userIDStr:  userID.String(),
			otherIDStr: "bad-uuid",
			msgRepo:    &mockMessageRepository{},
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
			}
			if len(result) != tc.wantCount {
				t.Errorf("expected %d messages, got %d", tc.wantCount, len(result))
			}
		})
	}
}

// ============================================================
// Tests: MarkAsRead
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
						CreatedAt:  time.Now(),
					}, nil
				},
				markAsReadFn: func(_ context.Context, _ uuid.UUID) error { return nil },
			},
		},
		{
			name:      "wrong user — ErrNotMessageReceiver",
			userID:    senderID.String(),
			messageID: msgID.String(),
			msgRepo: &mockMessageRepository{
				getByIDFn: func(_ context.Context, id uuid.UUID) (*domain.Message, error) {
					return &domain.Message{
						ID:         id,
						SenderID:   senderID,
						ReceiverID: receiverID,
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

// ============================================================
// Tests: MarkConversationRead
// ============================================================

func TestMarkConversationRead_DelegatesToRepo(t *testing.T) {
	userID := uuid.New()
	otherID := uuid.New()

	msgRepo := &mockMessageRepository{}
	svc := newMessageService(msgRepo, &mockBlockedRepoForMsg{})

	err := svc.MarkConversationRead(context.Background(), userID.String(), otherID.String())

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if !msgRepo.markConvReadCalled {
		t.Fatal("expected MarkConversationRead to be called on repo")
	}
	if msgRepo.markConvReadArgs[0] != userID {
		t.Errorf("expected receiverID %v, got %v", userID, msgRepo.markConvReadArgs[0])
	}
	if msgRepo.markConvReadArgs[1] != otherID {
		t.Errorf("expected senderID %v, got %v", otherID, msgRepo.markConvReadArgs[1])
	}
}

func TestMarkConversationRead_InvalidUserID_ReturnsErrInvalidInput(t *testing.T) {
	svc := newMessageService(&mockMessageRepository{}, &mockBlockedRepoForMsg{})
	err := svc.MarkConversationRead(context.Background(), "not-a-uuid", uuid.New().String())
	if !errors.Is(err, domain.ErrInvalidInput) {
		t.Errorf("expected ErrInvalidInput, got %v", err)
	}
}

func TestMarkConversationRead_InvalidOtherID_ReturnsErrInvalidInput(t *testing.T) {
	svc := newMessageService(&mockMessageRepository{}, &mockBlockedRepoForMsg{})
	err := svc.MarkConversationRead(context.Background(), uuid.New().String(), "not-a-uuid")
	if !errors.Is(err, domain.ErrInvalidInput) {
		t.Errorf("expected ErrInvalidInput, got %v", err)
	}
}

// ============================================================
// Tests: CountUnread
// ============================================================

func TestCountUnread_DelegatesToRepo(t *testing.T) {
	userID := uuid.New()
	msgRepo := &mockMessageRepository{
		countUnreadFn: func(_ context.Context, _ uuid.UUID) (int64, error) { return 7, nil },
	}
	svc := newMessageService(msgRepo, &mockBlockedRepoForMsg{})

	count, err := svc.CountUnread(context.Background(), userID.String())

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if count != 7 {
		t.Errorf("expected count 7, got %d", count)
	}
	if msgRepo.countUnreadUserID != userID {
		t.Errorf("expected userID %v passed to repo, got %v", userID, msgRepo.countUnreadUserID)
	}
}

func TestCountUnread_InvalidUserID_ReturnsErrInvalidInput(t *testing.T) {
	svc := newMessageService(&mockMessageRepository{}, &mockBlockedRepoForMsg{})
	_, err := svc.CountUnread(context.Background(), "not-a-uuid")
	if !errors.Is(err, domain.ErrInvalidInput) {
		t.Errorf("expected ErrInvalidInput, got %v", err)
	}
}

// ============================================================
// Tests: GetConversation — MarkConversationRead is fire-and-forget
// ============================================================

func TestGetConversation_MarkReadFailure_StillReturnsMessages(t *testing.T) {
	userID := uuid.New()
	otherID := uuid.New()

	expected := []domain.Message{
		{ID: uuid.New(), SenderID: otherID, ReceiverID: userID},
	}
	msgRepo := &mockMessageRepository{
		getConversationFn: func(_ context.Context, _, _ uuid.UUID, _, _ int) ([]domain.Message, error) {
			return expected, nil
		},
		markConvReadFn: func(_ context.Context, _, _ uuid.UUID) error {
			return errors.New("repo error")
		},
	}
	svc := newMessageService(msgRepo, &mockBlockedRepoForMsg{})

	messages, err := svc.GetConversation(context.Background(), userID.String(), otherID.String(), 20, 0)

	if err != nil {
		t.Fatalf("expected no error even with MarkConversationRead failure, got %v", err)
	}
	if len(messages) != len(expected) {
		t.Errorf("expected %d messages, got %d", len(expected), len(messages))
	}
}
