package tests

import (
	"testing"
	"time"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/dto"
)

// The conversations list needs the counterpart's name: the repository
// preloads Sender/Receiver but the DTO used to drop them, so the web
// rendered raw UUIDs and mobile fell back to "unknown user".
func TestToMessageResponse_IncludesSenderAndReceiverInfo(t *testing.T) {
	senderID := uuid.New()
	receiverID := uuid.New()

	msg := &domain.Message{
		ID:         uuid.New(),
		SenderID:   senderID,
		ReceiverID: receiverID,
		Text:       "hola",
		Sender:     domain.User{ID: senderID, Name: "Ana", Email: "ana@example.com"},
		Receiver:   domain.User{ID: receiverID, Name: "Bruno", Email: "bruno@example.com"},
	}

	resp := dto.ToMessageResponse(msg)

	if resp.Sender == nil || resp.Sender.Name != "Ana" {
		t.Errorf("expected sender info with name Ana, got %+v", resp.Sender)
	}
	if resp.Sender != nil && resp.Sender.ID != senderID {
		t.Errorf("sender ID: want %s, got %s", senderID, resp.Sender.ID)
	}
	if resp.Receiver == nil || resp.Receiver.Name != "Bruno" {
		t.Errorf("expected receiver info with name Bruno, got %+v", resp.Receiver)
	}
}

// PRIVACY: only id+name cross the DTO boundary — never email or phone.
// Enforced by construction: MessageUserResponse has no other fields.
func TestToMessageResponse_OmitsUsersWhenNotPreloaded(t *testing.T) {
	msg := &domain.Message{
		ID:         uuid.New(),
		SenderID:   uuid.New(),
		ReceiverID: uuid.New(),
		Text:       "hola",
		// Sender/Receiver zero-valued: repository did not preload them.
	}

	resp := dto.ToMessageResponse(msg)

	if resp.Sender != nil {
		t.Errorf("expected nil sender when not preloaded, got %+v", resp.Sender)
	}
	if resp.Receiver != nil {
		t.Errorf("expected nil receiver when not preloaded, got %+v", resp.Receiver)
	}
}

// The shared frontend type declares is_read; the DTO must derive it from
// ReadAt instead of leaving both frontends comparing against undefined.
func TestToMessageResponse_DerivesIsRead(t *testing.T) {
	now := time.Now()

	read := &domain.Message{ID: uuid.New(), Text: "x", ReadAt: &now}
	if resp := dto.ToMessageResponse(read); !resp.IsRead {
		t.Error("expected is_read=true when ReadAt is set")
	}

	unread := &domain.Message{ID: uuid.New(), Text: "x"}
	if resp := dto.ToMessageResponse(unread); resp.IsRead {
		t.Error("expected is_read=false when ReadAt is nil")
	}
}
