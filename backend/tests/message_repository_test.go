package tests

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"lost-pets/internal/domain"
	"lost-pets/internal/repository"
	"lost-pets/tests/testdb"
)

// seedMessage inserts a message directly through the repository.
func seedMessage(t *testing.T, msgRepo repository.MessageRepository, senderID, receiverID uuid.UUID, text string) *domain.Message {
	t.Helper()
	msg := &domain.Message{SenderID: senderID, ReceiverID: receiverID, Text: text}
	if err := msgRepo.Create(context.Background(), msg); err != nil {
		t.Fatalf("seedMessage: %v", err)
	}
	return msg
}

func TestMessageRepository_Create(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	msgRepo := repository.NewMessageRepository(gormDB)
	ctx := context.Background()

	sender := newTestUser(t, userRepo)
	receiver := newTestUser(t, userRepo)

	msg := &domain.Message{
		ID:         uuid.New(),
		SenderID:   sender.ID,
		ReceiverID: receiver.ID,
		Text:       "Hello from test",
	}
	if err := msgRepo.Create(ctx, msg); err != nil {
		t.Fatalf("Create: %v", err)
	}

	got, err := msgRepo.GetByID(ctx, msg.ID)
	if err != nil {
		t.Fatalf("GetByID: %v", err)
	}
	if got.Text != msg.Text {
		t.Errorf("want text %q, got %q", msg.Text, got.Text)
	}
	if got.SenderID != sender.ID {
		t.Errorf("want senderID %s, got %s", sender.ID, got.SenderID)
	}
}

func TestMessageRepository_GetConversation(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	msgRepo := repository.NewMessageRepository(gormDB)
	ctx := context.Background()

	alice := newTestUser(t, userRepo)
	bob := newTestUser(t, userRepo)

	// Exchange three messages
	msgs := []struct {
		from, to *domain.User
		text     string
	}{
		{alice, bob, "Hi Bob"},
		{bob, alice, "Hi Alice"},
		{alice, bob, "How are you?"},
	}
	for _, m := range msgs {
		msg := &domain.Message{
			ID:         uuid.New(),
			SenderID:   m.from.ID,
			ReceiverID: m.to.ID,
			Text:       m.text,
		}
		if err := msgRepo.Create(ctx, msg); err != nil {
			t.Fatalf("Create message %q: %v", m.text, err)
		}
	}

	conversation, err := msgRepo.GetConversation(ctx, alice.ID, bob.ID, 20, 0)
	if err != nil {
		t.Fatalf("GetConversation: %v", err)
	}
	if len(conversation) != 3 {
		t.Errorf("want 3 messages in conversation, got %d", len(conversation))
	}
}

func TestMessageRepository_GetConversation_BidirectionalIsolation(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	msgRepo := repository.NewMessageRepository(gormDB)
	ctx := context.Background()

	alice := newTestUser(t, userRepo)
	bob := newTestUser(t, userRepo)
	carol := newTestUser(t, userRepo)

	// Alice–Bob message
	if err := msgRepo.Create(ctx, &domain.Message{ID: uuid.New(), SenderID: alice.ID, ReceiverID: bob.ID, Text: "AB"}); err != nil {
		t.Fatalf("Create: %v", err)
	}
	// Alice–Carol message (must NOT appear in Alice–Bob conversation)
	if err := msgRepo.Create(ctx, &domain.Message{ID: uuid.New(), SenderID: alice.ID, ReceiverID: carol.ID, Text: "AC"}); err != nil {
		t.Fatalf("Create: %v", err)
	}

	conversation, err := msgRepo.GetConversation(ctx, alice.ID, bob.ID, 20, 0)
	if err != nil {
		t.Fatalf("GetConversation: %v", err)
	}
	if len(conversation) != 1 {
		t.Errorf("want 1 message in Alice–Bob conversation, got %d", len(conversation))
	}
	if conversation[0].Text != "AB" {
		t.Errorf("want text 'AB', got %q", conversation[0].Text)
	}
}

func TestMessageRepository_GetConversations_ExcludesHidden(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	msgRepo := repository.NewMessageRepository(gormDB)
	hideRepo := repository.NewConversationHideRepository(gormDB)
	ctx := context.Background()

	me := newTestUser(t, userRepo)
	alice := newTestUser(t, userRepo)
	bob := newTestUser(t, userRepo)

	seedMessage(t, msgRepo, alice.ID, me.ID, "hola de alice")
	seedMessage(t, msgRepo, bob.ID, me.ID, "hola de bob")

	// Before hiding: both conversations visible
	convs, err := msgRepo.GetConversations(ctx, me.ID)
	if err != nil {
		t.Fatalf("GetConversations: %v", err)
	}
	if len(convs) != 2 {
		t.Fatalf("want 2 conversations before hide, got %d", len(convs))
	}

	// Hide the conversation with alice
	if err := hideRepo.Upsert(ctx, me.ID, alice.ID); err != nil {
		t.Fatalf("Upsert: %v", err)
	}

	convs, err = msgRepo.GetConversations(ctx, me.ID)
	if err != nil {
		t.Fatalf("GetConversations after hide: %v", err)
	}
	if len(convs) != 1 {
		t.Fatalf("want 1 conversation after hide, got %d", len(convs))
	}
	if convs[0].SenderID != bob.ID {
		t.Errorf("want bob's conversation to remain, got sender %s", convs[0].SenderID)
	}

	// Alice still sees the conversation (hide is one-sided)
	aliceConvs, err := msgRepo.GetConversations(ctx, alice.ID)
	if err != nil {
		t.Fatalf("GetConversations for alice: %v", err)
	}
	if len(aliceConvs) != 1 {
		t.Errorf("want alice to still see 1 conversation, got %d", len(aliceConvs))
	}
}

func TestMessageRepository_CountUnread_ExcludesHidden(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	msgRepo := repository.NewMessageRepository(gormDB)
	hideRepo := repository.NewConversationHideRepository(gormDB)
	ctx := context.Background()

	me := newTestUser(t, userRepo)
	alice := newTestUser(t, userRepo)
	bob := newTestUser(t, userRepo)

	seedMessage(t, msgRepo, alice.ID, me.ID, "no leído de alice")
	seedMessage(t, msgRepo, bob.ID, me.ID, "no leído de bob")

	count, err := msgRepo.CountUnread(ctx, me.ID)
	if err != nil {
		t.Fatalf("CountUnread: %v", err)
	}
	if count != 2 {
		t.Fatalf("want 2 unread before hide, got %d", count)
	}

	if err := hideRepo.Upsert(ctx, me.ID, alice.ID); err != nil {
		t.Fatalf("Upsert: %v", err)
	}

	count, err = msgRepo.CountUnread(ctx, me.ID)
	if err != nil {
		t.Fatalf("CountUnread after hide: %v", err)
	}
	if count != 1 {
		t.Errorf("want 1 unread after hiding alice, got %d", count)
	}
}

func TestMessageRepository_GetConversations_HiddenReappearsOnNewMessage(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	msgRepo := repository.NewMessageRepository(gormDB)
	hideRepo := repository.NewConversationHideRepository(gormDB)
	ctx := context.Background()

	me := newTestUser(t, userRepo)
	alice := newTestUser(t, userRepo)

	seedMessage(t, msgRepo, alice.ID, me.ID, "mensaje viejo")
	if err := hideRepo.Upsert(ctx, me.ID, alice.ID); err != nil {
		t.Fatalf("Upsert: %v", err)
	}

	convs, err := msgRepo.GetConversations(ctx, me.ID)
	if err != nil {
		t.Fatalf("GetConversations: %v", err)
	}
	if len(convs) != 0 {
		t.Fatalf("want 0 conversations while hidden, got %d", len(convs))
	}

	// A NEW message (strictly after hidden_at) resurfaces the conversation.
	// NOW() has microsecond resolution; guarantee ordering explicitly:
	newMsg := seedMessage(t, msgRepo, alice.ID, me.ID, "mensaje nuevo")
	gormDB.Model(&domain.Message{}).Where("id = ?", newMsg.ID).
		Update("created_at", gorm.Expr("NOW() + interval '1 second'"))

	convs, err = msgRepo.GetConversations(ctx, me.ID)
	if err != nil {
		t.Fatalf("GetConversations after new message: %v", err)
	}
	if len(convs) != 1 {
		t.Fatalf("want conversation to reappear, got %d", len(convs))
	}
}
