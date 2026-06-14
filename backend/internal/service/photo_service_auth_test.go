// Package service_test — verifies UploadPhoto authorization for owned vs stray pets.
//
// Stray pets have no owner (OwnerID == nil) and instead carry a ReporterID (the
// user who reported them). The authorization rule is:
//   - owned pet  -> only the owner may upload
//   - stray pet  -> only the reporter may upload
//
// Regression guard for the bug where uploading a photo to a stray always failed
// (the owner-only check never matched a nil OwnerID, and could nil-panic).
package service_test

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/service"
)

func TestPhotoService_UploadPhoto_Authorization(t *testing.T) {
	owner := uuid.New()
	reporter := uuid.New()
	stranger := uuid.New()
	petID := uuid.New()

	tests := []struct {
		name       string
		pet        *domain.Pet
		uploaderID string
		// wantErr is the error expected from UploadPhoto. ErrStorageFailed means
		// authorization PASSED (the call reached the nil-storage guard);
		// ErrNotPetOwner means authorization DENIED the upload.
		wantErr error
	}{
		{
			name:       "stray reporter can upload",
			pet:        &domain.Pet{ID: petID, OwnerID: nil, ReporterID: &reporter, Status: domain.PetStatusStray},
			uploaderID: reporter.String(),
			wantErr:    domain.ErrStorageFailed,
		},
		{
			name:       "stray non-reporter denied",
			pet:        &domain.Pet{ID: petID, OwnerID: nil, ReporterID: &reporter, Status: domain.PetStatusStray},
			uploaderID: stranger.String(),
			wantErr:    domain.ErrNotPetOwner,
		},
		{
			name:       "owned pet owner can upload",
			pet:        &domain.Pet{ID: petID, OwnerID: &owner, ReporterID: nil, Status: domain.PetStatusLost},
			uploaderID: owner.String(),
			wantErr:    domain.ErrStorageFailed,
		},
		{
			name:       "owned pet non-owner denied",
			pet:        &domain.Pet{ID: petID, OwnerID: &owner, ReporterID: nil, Status: domain.PetStatusLost},
			uploaderID: stranger.String(),
			wantErr:    domain.ErrNotPetOwner,
		},
		{
			name:       "stray without reporter denied (no panic)",
			pet:        &domain.Pet{ID: petID, OwnerID: nil, ReporterID: nil, Status: domain.PetStatusStray},
			uploaderID: reporter.String(),
			wantErr:    domain.ErrNotPetOwner,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			petRepo := &mockPetRepoForEmbedding{
				findByIDFn: func(_ string) (*domain.Pet, error) { return tt.pet, nil },
			}
			photoRepo := &mockPhotoRepoForEmbedding{}
			// storage = nil so an authorized call stops at ErrStorageFailed
			// instead of hitting a real Cloudinary upload.
			svc := service.NewPhotoService(photoRepo, petRepo, nil, nil)

			f := &photoEventMockFile{}
			_, err := svc.UploadPhoto(context.Background(), petID.String(), tt.uploaderID, f, "photo.jpg")

			if err != tt.wantErr {
				t.Errorf("UploadPhoto() error = %v, want %v", err, tt.wantErr)
			}
		})
	}
}
