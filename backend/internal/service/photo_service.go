package service

import (
	"context"
	"fmt"
	"io"
	"log"
	"mime/multipart"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/repository"
	"lost-pets/pkg/storage"
)

// sanitizePublicID convierte un nombre de archivo en un public_id válido para Cloudinary.
// Elimina la extensión, reemplaza espacios y caracteres especiales por guiones bajos.
var reInvalidChars = regexp.MustCompile(`[^a-zA-Z0-9_\-]`)

func sanitizePublicID(petID, filename string) string {
	base := strings.TrimSuffix(filename, filepath.Ext(filename))
	base = reInvalidChars.ReplaceAllString(base, "_")
	if base == "" {
		base = "photo"
	}
	return fmt.Sprintf("pets/%s/%s", petID, base)
}

// PhotoService define el contrato de la capa de negocio para fotos de mascotas.
type PhotoService interface {
	// UploadPhoto valida, sube a Cloudinary y persiste la foto.
	UploadPhoto(ctx context.Context, petID string, uploaderID string, file multipart.File, filename string) (*domain.Photo, error)

	// GetPhotosByPet retorna todas las fotos de una mascota.
	GetPhotosByPet(petID string) ([]domain.Photo, error)
}

// photoServiceImpl es la implementación concreta del PhotoService.
type photoServiceImpl struct {
	photoRepo repository.PhotoRepository
	petRepo   repository.PetRepository
	storage   *storage.CloudinaryClient
}

// NewPhotoService construye el PhotoService con todas sus dependencias.
func NewPhotoService(
	photoRepo repository.PhotoRepository,
	petRepo repository.PetRepository,
	storage *storage.CloudinaryClient,
) PhotoService {
	return &photoServiceImpl{
		photoRepo: photoRepo,
		petRepo:   petRepo,
		storage:   storage,
	}
}

// UploadPhoto implementa la lógica completa:
// 1. Verifica que la mascota exista y que el uploader sea el dueño.
// 2. Valida MIME y tamaño.
// 3. Sube a Cloudinary.
// 4. Determina is_primary y persiste en BD.
func (s *photoServiceImpl) UploadPhoto(
	ctx context.Context,
	petID string,
	uploaderID string,
	file multipart.File,
	filename string,
) (*domain.Photo, error) {
	// LÓGICA DE NEGOCIO: solo el dueño puede subir fotos
	pet, err := s.petRepo.FindByID(petID)
	if err != nil {
		return nil, err
	}

	if pet.OwnerID.String() != uploaderID {
		return nil, domain.ErrNotPetOwner
	}

	if s.storage == nil {
		log.Println("[photo_service] Cloudinary no configurado — storage es nil")
		return nil, domain.ErrStorageFailed
	}

	// Aseguramos leer desde el principio (el handler ya buscó el MIME en los primeros bytes)
	if seeker, ok := file.(io.Seeker); ok {
		_, _ = seeker.Seek(0, io.SeekStart)
	}

	publicID := sanitizePublicID(petID, filename)
	log.Printf("[photo_service] Subiendo imagen a Cloudinary — publicID: %s", publicID)

	secureURL, err := s.storage.UploadImage(ctx, file, publicID)
	if err != nil {
		log.Printf("[photo_service] Error en Cloudinary: %v", err)
		return nil, domain.ErrStorageFailed
	}

	// LÓGICA DE NEGOCIO: primera foto → is_primary = true
	hasPrimary, err := s.photoRepo.HasPrimaryPhoto(petID)
	if err != nil {
		return nil, err
	}

	uploaderUUID, err := uuid.Parse(uploaderID)
	if err != nil {
		return nil, domain.ErrInvalidInput
	}

	petUUID, err := uuid.Parse(petID)
	if err != nil {
		return nil, domain.ErrInvalidInput
	}

	photo := &domain.Photo{
		PetID:      petUUID,
		URL:        secureURL,
		UploadedBy: uploaderUUID,
		IsPrimary:  !hasPrimary,
	}

	if err := s.photoRepo.Create(photo); err != nil {
		return nil, err
	}

	return photo, nil
}

// GetPhotosByPet delega al repositorio — sin lógica adicional en esta capa.
func (s *photoServiceImpl) GetPhotosByPet(petID string) ([]domain.Photo, error) {
	return s.photoRepo.FindByPetID(petID)
}
