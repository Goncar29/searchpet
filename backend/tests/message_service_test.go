package tests

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/event"
	"lost-pets/internal/repository"
	"lost-pets/internal/service"
)

// ============================================================
// Mocks — MessageRepository
// ============================================================

type mockMessageRepo struct {
	msg             *domain.Message
	messages        []domain.Message
	getByIDErr      error
	createErr       error
	markReadErr     error
	markConvReadErr error
	countUnread     int64
	countUnreadErr  error
	// tracking
	markConvReadCalled bool
	markConvReadArgs   [2]uuid.UUID
	countUnreadUserID  uuid.UUID
}

func (m *mockMessageRepo) Create(_ context.Context, msg *domain.Message) error {
	if m.createErr != nil {
		return m.createErr
	}
	msg.ID = uuid.New()
	return nil
}

func (m *mockMessageRepo) GetByID(_ context.Context, id uuid.UUID) (*domain.Message, error) {
	if m.getByIDErr != nil {
		return nil, m.getByIDErr
	}
	if m.msg != nil {
		return m.msg, nil
	}
	return &domain.Message{ID: id}, nil
}

func (m *mockMessageRepo) GetConversation(_ context.Context, _, _ uuid.UUID, _, _ int) ([]domain.Message, error) {
	return m.messages, nil
}

func (m *mockMessageRepo) GetConversations(_ context.Context, _ uuid.UUID) ([]domain.Message, error) {
	return m.messages, nil
}

func (m *mockMessageRepo) MarkAsRead(_ context.Context, _ uuid.UUID) error {
	return m.markReadErr
}

func (m *mockMessageRepo) MarkConversationRead(_ context.Context, receiverID, senderID uuid.UUID) error {
	m.markConvReadCalled = true
	m.markConvReadArgs = [2]uuid.UUID{receiverID, senderID}
	return m.markConvReadErr
}

func (m *mockMessageRepo) CountUnread(_ context.Context, userID uuid.UUID) (int64, error) {
	m.countUnreadUserID = userID
	return m.countUnread, m.countUnreadErr
}

// ============================================================
// Mocks — BlockedUserRepository
// ============================================================

type mockBlockedRepo struct {
	isBlocked bool
	isBlockedErr error
}

func (m *mockBlockedRepo) Create(_ context.Context, _ *domain.BlockedUser) error { return nil }
func (m *mockBlockedRepo) Delete(_ context.Context, _, _ uuid.UUID) error         { return nil }
func (m *mockBlockedRepo) IsBlocked(_ context.Context, _, _ uuid.UUID) (bool, error) {
	return m.isBlocked, m.isBlockedErr
}
func (m *mockBlockedRepo) GetBlockedByUserID(_ context.Context, _ uuid.UUID) ([]domain.BlockedUser, error) {
	return nil, nil
}

// Ensure mockBlockedRepo satisfies repository.BlockedUserRepository at compile time.
var _ repository.BlockedUserRepository = (*mockBlockedRepo)(nil)

// ============================================================
// Helpers
// ============================================================

func newMessageSvc(msgRepo *mockMessageRepo, blockedRepo *mockBlockedRepo) service.MessageService {
	return service.NewMessageService(msgRepo, blockedRepo, event.NewEventBus())
}

// ============================================================
// Tests: MarkConversationRead — delegates to repo with correct UUIDs
// ============================================================

func TestMarkConversationRead_DelegatesToRepo(t *testing.T) {
	userID := uuid.New()
	otherID := uuid.New()

	msgRepo := &mockMessageRepo{}
	svc := newMessageSvc(msgRepo, &mockBlockedRepo{})

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
	svc := newMessageSvc(&mockMessageRepo{}, &mockBlockedRepo{})

	err := svc.MarkConversationRead(context.Background(), "not-a-uuid", uuid.New().String())

	if !errors.Is(err, domain.ErrInvalidInput) {
		t.Errorf("expected ErrInvalidInput, got %v", err)
	}
}

func TestMarkConversationRead_InvalidOtherID_ReturnsErrInvalidInput(t *testing.T) {
	svc := newMessageSvc(&mockMessageRepo{}, &mockBlockedRepo{})

	err := svc.MarkConversationRead(context.Background(), uuid.New().String(), "not-a-uuid")

	if !errors.Is(err, domain.ErrInvalidInput) {
		t.Errorf("expected ErrInvalidInput, got %v", err)
	}
}

// ============================================================
// Tests: CountUnread — delegates to repo correctly
// ============================================================

func TestCountUnread_DelegatesToRepo(t *testing.T) {
	userID := uuid.New()
	msgRepo := &mockMessageRepo{countUnread: 7}
	svc := newMessageSvc(msgRepo, &mockBlockedRepo{})

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
	svc := newMessageSvc(&mockMessageRepo{}, &mockBlockedRepo{})

	_, err := svc.CountUnread(context.Background(), "not-a-uuid")

	if !errors.Is(err, domain.ErrInvalidInput) {
		t.Errorf("expected ErrInvalidInput, got %v", err)
	}
}

// ============================================================
// Tests: GetConversation — MarkConversationRead is fire-and-forget
// Even when it fails, the fetch still returns messages.
// ============================================================

func TestGetConversation_MarkReadFailure_StillReturnsMessages(t *testing.T) {
	userID := uuid.New()
	otherID := uuid.New()

	expected := []domain.Message{
		{ID: uuid.New(), SenderID: otherID, ReceiverID: userID},
	}
	msgRepo := &mockMessageRepo{
		messages:        expected,
		markConvReadErr: errors.New("repo error"),
	}
	svc := newMessageSvc(msgRepo, &mockBlockedRepo{})

	messages, err := svc.GetConversation(context.Background(), userID.String(), otherID.String(), 20, 0)

	if err != nil {
		t.Fatalf("expected no error even with MarkConversationRead failure, got %v", err)
	}
	if len(messages) != len(expected) {
		t.Errorf("expected %d messages, got %d", len(expected), len(messages))
	}
}
