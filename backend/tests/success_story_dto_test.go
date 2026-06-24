package tests

import (
	"testing"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/dto"
)

// TestToStoryResponse_PetPhoto_UsesFirstPhoto verifies the DTO maps the first
// element of the preloaded Photos slice. Canonical ordering of that slice
// (created_at ASC, id ASC, ignoring is_primary) is the repository's
// responsibility — see success_story_repository_test.go.
func TestToStoryResponse_PetPhoto_UsesFirstPhoto(t *testing.T) {
	petID := uuid.New()
	story := &domain.SuccessStory{
		ID:    uuid.New(),
		PetID: petID,
		Body:  "Reunited",
		Pet: domain.Pet{
			ID:   petID,
			Name: "Toby",
			Photos: []domain.Photo{
				{ID: uuid.New(), URL: "https://cdn/first.jpg"},
				{ID: uuid.New(), URL: "https://cdn/second.jpg"},
			},
		},
	}

	resp := dto.ToStoryResponse(story)

	if resp.PetPhoto != "https://cdn/first.jpg" {
		t.Errorf("want pet_photo=first.jpg, got %q", resp.PetPhoto)
	}
}

func TestToStoryResponse_PetPhoto_EmptyWhenNoPhotos(t *testing.T) {
	petID := uuid.New()
	story := &domain.SuccessStory{
		ID:    uuid.New(),
		PetID: petID,
		Body:  "Reunited",
		Pet:   domain.Pet{ID: petID, Name: "Toby"},
	}

	resp := dto.ToStoryResponse(story)

	if resp.PetPhoto != "" {
		t.Errorf("want empty pet_photo, got %q", resp.PetPhoto)
	}
}
