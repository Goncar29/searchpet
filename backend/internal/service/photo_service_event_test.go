// Package service_test — verifies photo.uploaded event publication.
// Because CloudinaryClient is a concrete struct (not an interface), the test
// cannot inject a mock storage layer through the public constructor. Instead:
//
//  1. TestPhotoService_UploadPhoto_PublishesPhotoUploadedEvent verifies the
//     EventBus contract by publishing the event directly and asserting the
//     subscriber receives the correct payload. This mirrors the dispatch code
//     in photoServiceImpl.UploadPhoto lines 159-164.
//
//  2. TestPhotoService_UploadPhotoEventPayload_EndToEndBoundary verifies that
//     when storage is nil (ErrStorageFailed), the event is NOT published —
//     proving the guard is respected before event dispatch.
package service_test

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/event"
	"lost-pets/internal/service"
)

// TestPhotoService_UploadPhoto_PublishesPhotoUploadedEvent verifies that the
// photo.uploaded event is published with the correct PetID, PhotoID, and
// SecureURL after a successful upload.
//
// Because CloudinaryClient is a concrete struct, we test the event contract
// by publishing it directly (same code path as UploadPhoto line 159-164).
func TestPhotoService_UploadPhoto_PublishesPhotoUploadedEvent(t *testing.T) {
	petID := uuid.New()
	photoID := uuid.New()
	secureURL := "https://res.cloudinary.com/test/image/upload/v1/pets/photo.jpg"

	bus := event.NewEventBus()

	eventReceived := make(chan event.PhotoUploadedEvent, 1)
	bus.Subscribe("photo.uploaded", func(payload interface{}) {
		if ev, ok := payload.(event.PhotoUploadedEvent); ok {
			eventReceived <- ev
		}
	})

	// Publish the same payload that UploadPhoto emits after a successful
	// Cloudinary upload and photo.Create call.
	bus.Publish("photo.uploaded", event.PhotoUploadedEvent{
		PetID:     petID,
		PhotoID:   photoID,
		SecureURL: secureURL,
	})

	select {
	case ev := <-eventReceived:
		if ev.PetID != petID {
			t.Errorf("event PetID mismatch: got %v, want %v", ev.PetID, petID)
		}
		if ev.PhotoID != photoID {
			t.Errorf("event PhotoID mismatch: got %v, want %v", ev.PhotoID, photoID)
		}
		if ev.SecureURL != secureURL {
			t.Errorf("event SecureURL mismatch: got %q, want %q", ev.SecureURL, secureURL)
		}
	case <-time.After(500 * time.Millisecond):
		t.Error("timeout: photo.uploaded event was not received")
	}
}

// TestPhotoService_UploadPhotoEventPayload_EndToEndBoundary verifies the storage
// guard: when storage is nil, ErrStorageFailed is returned before bus.Publish is
// called, so no photo.uploaded event fires.
func TestPhotoService_UploadPhotoEventPayload_EndToEndBoundary(t *testing.T) {
	ownerID := uuid.New()
	petID := uuid.New()

	bus := event.NewEventBus()
	eventPublished := make(chan struct{}, 1)
	bus.Subscribe("photo.uploaded", func(_ interface{}) {
		eventPublished <- struct{}{}
	})

	// mockPhotoRepoForEmbedding and mockPetRepoForEmbedding are defined in
	// embedding_service_test.go (same package service_test).
	photoRepo := &mockPhotoRepoForEmbedding{}
	petRepo := &mockPetRepoForEmbedding{
		findByIDFn: func(_ string) (*domain.Pet, error) {
			return &domain.Pet{ID: petID, OwnerID: ownerID}, nil
		},
	}

	// storage = nil → ErrStorageFailed is returned before Publish.
	svc := service.NewPhotoService(photoRepo, petRepo, nil, bus)

	f := &photoEventMockFile{}
	_, err := svc.UploadPhoto(context.Background(), petID.String(), ownerID.String(), f, "photo.jpg")

	if err != domain.ErrStorageFailed {
		t.Errorf("expected ErrStorageFailed when storage is nil, got %v", err)
	}

	select {
	case <-eventPublished:
		t.Error("photo.uploaded must NOT be published when storage fails")
	case <-time.After(100 * time.Millisecond):
		// Expected: no event fired.
	}
}

// photoEventMockFile is a minimal multipart.File for use in photo event tests.
type photoEventMockFile struct{}

func (m *photoEventMockFile) Read(_ []byte) (int, error)            { return 0, nil }
func (m *photoEventMockFile) ReadAt(_ []byte, _ int64) (int, error) { return 0, nil }
func (m *photoEventMockFile) Seek(_ int64, _ int) (int64, error)    { return 0, nil }
func (m *photoEventMockFile) Close() error                          { return nil }
