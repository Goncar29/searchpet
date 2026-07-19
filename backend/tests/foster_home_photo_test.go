package tests

import (
	"context"
	"io"
	"strings"
	"testing"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/service"
)

// fhPhotoStubRepo is a minimal FosterHomeRepository stub for photo-service tests:
// GetByOwner always resolves to a fixed foster home for the configured owner.
type fhPhotoStubRepo struct {
	ownerID uuid.UUID
	home    *domain.FosterHome
}

func (f *fhPhotoStubRepo) Create(context.Context, *domain.FosterHome) error { return nil }
func (f *fhPhotoStubRepo) GetByID(_ context.Context, id uuid.UUID) (*domain.FosterHome, error) {
	if f.home != nil && f.home.ID == id {
		return f.home, nil
	}
	return nil, domain.ErrFosterHomeNotFound
}
func (f *fhPhotoStubRepo) GetByOwner(_ context.Context, ownerID uuid.UUID) (*domain.FosterHome, error) {
	if ownerID == f.ownerID && f.home != nil {
		return f.home, nil
	}
	return nil, domain.ErrFosterHomeNotFound
}
func (f *fhPhotoStubRepo) GetApproved(_ context.Context, _, _ string) ([]domain.FosterHome, error) {
	return nil, nil
}
func (f *fhPhotoStubRepo) GetPendingQueue(_ context.Context) ([]domain.FosterHome, error) {
	return nil, nil
}
func (f *fhPhotoStubRepo) Update(_ context.Context, fh *domain.FosterHome) error {
	f.home = fh
	return nil
}

// fhPhotoCountRepo is a minimal FosterHomePhotoRepository stub whose CountByFosterHome
// always reports the configured count (used to simulate an already-full photo set).
type fhPhotoCountRepo struct {
	count int64
}

func (f *fhPhotoCountRepo) Create(context.Context, *domain.FosterHomePhoto) error { return nil }
func (f *fhPhotoCountRepo) CountByFosterHome(_ context.Context, _ uuid.UUID) (int64, error) {
	return f.count, nil
}
func (f *fhPhotoCountRepo) FindByFosterHome(_ context.Context, _ uuid.UUID) ([]domain.FosterHomePhoto, error) {
	return nil, nil
}
func (f *fhPhotoCountRepo) FindByID(_ context.Context, _ uuid.UUID) (*domain.FosterHomePhoto, error) {
	return nil, domain.ErrPhotoNotFound
}
func (f *fhPhotoCountRepo) DeleteByID(_ context.Context, _ uuid.UUID) error { return nil }

// stubFHUploader is a fake ImageUploader that always succeeds; used to make sure
// tests fail on the business rule (photo limit) and not on a missing storage dependency.
type stubFHUploader struct{}

func (stubFHUploader) UploadImage(_ context.Context, _ io.Reader, _, _ string) (string, string, error) {
	return "https://cdn.test/fake.jpg", "foster_homes/fake", nil
}
func (stubFHUploader) Delete(context.Context, string) error { return nil }

func TestUpload_RejectsSixthPhoto(t *testing.T) {
	ctx := context.Background()
	ownerID := uuid.New()
	homeID := uuid.New()

	fhRepo := &fhPhotoStubRepo{ownerID: ownerID, home: &domain.FosterHome{ID: homeID, OwnerUserID: ownerID}}
	photoRepo := &fhPhotoCountRepo{count: 5}

	svc := service.NewFosterHomePhotoService(fhRepo, photoRepo, stubFHUploader{})

	photo, err := svc.Upload(ctx, ownerID.String(), strings.NewReader("fake-image-bytes"), "photo.jpg")
	if err != domain.ErrTooManyFosterPhotos {
		t.Fatalf("expected ErrTooManyFosterPhotos, got %v", err)
	}
	if photo != nil {
		t.Fatalf("expected nil photo, got %+v", photo)
	}
}
