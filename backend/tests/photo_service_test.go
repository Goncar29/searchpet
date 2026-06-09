package tests

import (
	"context"
	"io"
	"mime/multipart"
	"strings"
	"testing"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/repository"
	"lost-pets/internal/service"
)

// ============================================================
// Mock: PhotoRepository (for service tests)
// ============================================================

type mockPhotoRepo struct {
	createFn          func(photo *domain.Photo) error
	findByIDFn        func(photoID string) (*domain.Photo, error)
	findByPetIDFn     func(petID string) ([]domain.Photo, error)
	deleteByPetIDFn   func(petID string) error
	deleteByIDFn      func(photoID string) error
	countByPetIDFn    func(petID string) (int64, error)
	unsetPrimaryFn    func(petID string) error
	hasPrimaryPhotoFn func(petID string) (bool, error)
}

func (m *mockPhotoRepo) FindByID(photoID string) (*domain.Photo, error) {
	if m.findByIDFn != nil {
		return m.findByIDFn(photoID)
	}
	return &domain.Photo{}, nil
}

func (m *mockPhotoRepo) Create(photo *domain.Photo) error {
	if m.createFn != nil {
		return m.createFn(photo)
	}
	return nil
}

func (m *mockPhotoRepo) FindByPetID(petID string) ([]domain.Photo, error) {
	if m.findByPetIDFn != nil {
		return m.findByPetIDFn(petID)
	}
	return []domain.Photo{}, nil
}

func (m *mockPhotoRepo) DeleteByPetID(petID string) error {
	if m.deleteByPetIDFn != nil {
		return m.deleteByPetIDFn(petID)
	}
	return nil
}

func (m *mockPhotoRepo) DeleteByID(photoID string) error {
	if m.deleteByIDFn != nil {
		return m.deleteByIDFn(photoID)
	}
	return nil
}

func (m *mockPhotoRepo) CountByPetID(petID string) (int64, error) {
	if m.countByPetIDFn != nil {
		return m.countByPetIDFn(petID)
	}
	return 0, nil
}

func (m *mockPhotoRepo) UnsetPrimaryPhotos(petID string) error {
	if m.unsetPrimaryFn != nil {
		return m.unsetPrimaryFn(petID)
	}
	return nil
}

func (m *mockPhotoRepo) HasPrimaryPhoto(petID string) (bool, error) {
	if m.hasPrimaryPhotoFn != nil {
		return m.hasPrimaryPhotoFn(petID)
	}
	return false, nil
}

// Ensure interface compliance at compile time.
var _ repository.PhotoRepository = (*mockPhotoRepo)(nil)

// ============================================================
// Mock: PetRepository (reused from pet_handler_test pattern, minimal)
// ============================================================

// Note: mockPetRepo is already defined in pet_handler_test.go via the
// function-pointer mock pattern. We define a local one here for service tests
// since service tests use repository interfaces, not handler-level mocks.

type mockPetRepoForService struct {
	findByIDFn func(id string) (*domain.Pet, error)
}

func (m *mockPetRepoForService) FindByID(id string) (*domain.Pet, error) {
	if m.findByIDFn != nil {
		return m.findByIDFn(id)
	}
	return nil, domain.ErrPetNotFound
}

// Partial implementation — remaining methods are no-ops for service tests.
func (m *mockPetRepoForService) Create(pet *domain.Pet) error                        { return nil }
func (m *mockPetRepoForService) FindByOwnerID(ownerID string) ([]domain.Pet, error)  { return nil, nil }
func (m *mockPetRepoForService) Search(c domain.PetSearchCriteria) ([]domain.Pet, int64, error) {
	return nil, 0, nil
}
func (m *mockPetRepoForService) Update(pet *domain.Pet) error         { return nil }
func (m *mockPetRepoForService) Delete(id string) error               { return nil }
func (m *mockPetRepoForService) UpdateStatus(id, status string) error { return nil }

// Ensure interface compliance at compile time.
var _ repository.PetRepository = (*mockPetRepoForService)(nil)

// ============================================================
// stringReadCloser wraps a string as a multipart.File
// ============================================================

type stringFile struct {
	r io.ReadSeeker
}

func (s *stringFile) Read(p []byte) (n int, err error)  { return s.r.Read(p) }
func (s *stringFile) ReadAt(p []byte, off int64) (n int, err error) {
	return 0, io.EOF
}
func (s *stringFile) Seek(offset int64, whence int) (int64, error) {
	return s.r.Seek(offset, whence)
}
func (s *stringFile) Close() error { return nil }

// Ensure multipart.File interface is satisfied.
var _ multipart.File = (*stringFile)(nil)

func newStringFile(content string) multipart.File {
	return &stringFile{r: strings.NewReader(content)}
}

// ============================================================
// GetPhotosByPet tests
// ============================================================

func TestPhotoService_GetPhotosByPet_ReturnsPhotos(t *testing.T) {
	petID := uuid.New()
	expected := []domain.Photo{
		{ID: uuid.New(), PetID: petID, URL: "https://cdn.example.com/photo1.jpg"},
	}

	photoRepo := &mockPhotoRepo{
		findByPetIDFn: func(pid string) ([]domain.Photo, error) {
			if pid != petID.String() {
				return nil, nil
			}
			return expected, nil
		},
	}
	petRepo := &mockPetRepoForService{}

	svc := service.NewPhotoService(photoRepo, petRepo, nil, nil)

	photos, err := svc.GetPhotosByPet(petID.String())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(photos) != 1 {
		t.Errorf("expected 1 photo, got %d", len(photos))
	}
	if photos[0].URL != "https://cdn.example.com/photo1.jpg" {
		t.Errorf("unexpected URL: %q", photos[0].URL)
	}
}

func TestPhotoService_GetPhotosByPet_Empty(t *testing.T) {
	photoRepo := &mockPhotoRepo{
		findByPetIDFn: func(_ string) ([]domain.Photo, error) {
			return []domain.Photo{}, nil
		},
	}
	petRepo := &mockPetRepoForService{}

	svc := service.NewPhotoService(photoRepo, petRepo, nil, nil)

	photos, err := svc.GetPhotosByPet(uuid.New().String())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(photos) != 0 {
		t.Errorf("expected 0 photos, got %d", len(photos))
	}
}

// ============================================================
// UploadPhoto tests
// ============================================================

func TestPhotoService_UploadPhoto_PetNotFound(t *testing.T) {
	photoRepo := &mockPhotoRepo{}
	petRepo := &mockPetRepoForService{
		findByIDFn: func(_ string) (*domain.Pet, error) {
			return nil, domain.ErrPetNotFound
		},
	}

	svc := service.NewPhotoService(photoRepo, petRepo, nil, nil)

	f := newStringFile("fake-image-data")
	_, err := svc.UploadPhoto(context.Background(), uuid.New().String(), uuid.New().String(), f, "photo.jpg")
	if err != domain.ErrPetNotFound {
		t.Errorf("expected ErrPetNotFound, got %v", err)
	}
}

func TestPhotoService_UploadPhoto_NotOwner_Returns403Error(t *testing.T) {
	ownerID := uuid.New()
	uploaderID := uuid.New() // different from owner
	petID := uuid.New()

	photoRepo := &mockPhotoRepo{}
	petRepo := &mockPetRepoForService{
		findByIDFn: func(_ string) (*domain.Pet, error) {
			return &domain.Pet{ID: petID, OwnerID: &ownerID}, nil
		},
	}

	svc := service.NewPhotoService(photoRepo, petRepo, nil, nil)

	f := newStringFile("fake-image-data")
	_, err := svc.UploadPhoto(context.Background(), petID.String(), uploaderID.String(), f, "photo.jpg")
	if err != domain.ErrNotPetOwner {
		t.Errorf("expected ErrNotPetOwner, got %v", err)
	}
}

func TestPhotoService_UploadPhoto_LimitReached(t *testing.T) {
	ownerID := uuid.New()
	petID := uuid.New()

	photoRepo := &mockPhotoRepo{
		countByPetIDFn: func(_ string) (int64, error) {
			return 3, nil // maxPhotosPerPet = 3
		},
	}
	petRepo := &mockPetRepoForService{
		findByIDFn: func(_ string) (*domain.Pet, error) {
			return &domain.Pet{ID: petID, OwnerID: &ownerID}, nil
		},
	}

	svc := service.NewPhotoService(photoRepo, petRepo, nil, nil)

	f := newStringFile("fake-image-data")
	_, err := svc.UploadPhoto(context.Background(), petID.String(), ownerID.String(), f, "photo.jpg")
	if err != domain.ErrPhotoLimitReached {
		t.Errorf("expected ErrPhotoLimitReached, got %v", err)
	}
}

func TestPhotoService_UploadPhoto_StorageNil_ReturnsStorageFailed(t *testing.T) {
	// When storage is nil, the service returns ErrStorageFailed.
	ownerID := uuid.New()
	petID := uuid.New()

	photoRepo := &mockPhotoRepo{
		countByPetIDFn: func(_ string) (int64, error) {
			return 0, nil // under limit
		},
	}
	petRepo := &mockPetRepoForService{
		findByIDFn: func(_ string) (*domain.Pet, error) {
			return &domain.Pet{ID: petID, OwnerID: &ownerID}, nil
		},
	}

	// storage = nil → should return ErrStorageFailed
	svc := service.NewPhotoService(photoRepo, petRepo, nil, nil)

	f := newStringFile("fake-image-data")
	_, err := svc.UploadPhoto(context.Background(), petID.String(), ownerID.String(), f, "photo.jpg")
	if err != domain.ErrStorageFailed {
		t.Errorf("expected ErrStorageFailed when storage is nil, got %v", err)
	}
}
