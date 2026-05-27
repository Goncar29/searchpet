package tests

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/repository"
	"lost-pets/tests/testdb"
)

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
