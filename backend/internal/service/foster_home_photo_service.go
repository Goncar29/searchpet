package service

import (
	"context"
	"fmt"
	"io"
	"time"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/repository"
)

const maxPhotosPerFosterHome = 5

type FosterHomePhotoService interface {
	Upload(ctx context.Context, userID string, file io.Reader, filename string) (*domain.FosterHomePhoto, error)
	Delete(ctx context.Context, userID, photoID string) error
}

type fosterHomePhotoService struct {
	fhRepo    repository.FosterHomeRepository
	photoRepo repository.FosterHomePhotoRepository
	storage   ImageUploader
}

func NewFosterHomePhotoService(
	fhRepo repository.FosterHomeRepository,
	photoRepo repository.FosterHomePhotoRepository,
	storage ImageUploader,
) FosterHomePhotoService {
	return &fosterHomePhotoService{fhRepo: fhRepo, photoRepo: photoRepo, storage: storage}
}

func (s *fosterHomePhotoService) Upload(ctx context.Context, userID string, file io.Reader, filename string) (*domain.FosterHomePhoto, error) {
	ownerUUID, err := uuid.Parse(userID)
	if err != nil {
		return nil, domain.ErrInvalidInput
	}
	fh, err := s.fhRepo.GetByOwner(ctx, ownerUUID)
	if err != nil {
		return nil, err
	}
	count, err := s.photoRepo.CountByFosterHome(ctx, fh.ID)
	if err != nil {
		return nil, err
	}
	if count >= maxPhotosPerFosterHome {
		return nil, domain.ErrTooManyFosterPhotos
	}
	if s.storage == nil {
		return nil, domain.ErrStorageFailed
	}
	publicID := fmt.Sprintf("foster_homes/%s/%d", fh.ID, time.Now().UnixMilli())
	secureURL, returnedID, err := s.storage.UploadImage(ctx, file, publicID, "foster_homes")
	if err != nil {
		return nil, domain.ErrStorageFailed
	}
	p := &domain.FosterHomePhoto{FosterHomeID: fh.ID, URL: secureURL, PublicID: returnedID}
	if err := s.photoRepo.Create(ctx, p); err != nil {
		return nil, err
	}
	return p, nil
}

func (s *fosterHomePhotoService) Delete(ctx context.Context, userID, photoID string) error {
	ownerUUID, err := uuid.Parse(userID)
	if err != nil {
		return domain.ErrInvalidInput
	}
	fh, err := s.fhRepo.GetByOwner(ctx, ownerUUID)
	if err != nil {
		return err
	}
	pID, err := uuid.Parse(photoID)
	if err != nil {
		return domain.ErrInvalidInput
	}
	photo, err := s.photoRepo.FindByID(ctx, pID)
	if err != nil {
		return err
	}
	if photo.FosterHomeID != fh.ID {
		return domain.ErrPhotoNotFound
	}
	if s.storage != nil && photo.PublicID != "" {
		_ = s.storage.Delete(ctx, photo.PublicID)
	}
	return s.photoRepo.DeleteByID(ctx, pID)
}
