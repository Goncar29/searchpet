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
	"time"

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
	// El timestamp garantiza una URL única por upload, evitando que el browser
	// sirva la imagen anterior desde cache cuando se reemplaza una foto.
	return fmt.Sprintf("pets/%s/%s_%d", petID, base, time.Now().UnixMilli())
}

// maxPhotosPerPet es el límite de fotos permitidas por mascota.
// Definido aquí como fuente de verdad; referenciado en el handler para el error HTTP.
const maxPhotosPerPet = 3

// PhotoService define el contrato de la capa de negocio para fotos de mascotas.
type PhotoService interface {
	// UploadPhoto valida, sube a Cloudinary y persiste la foto.
	UploadPhoto(ctx context.Context, petID string, uploaderID string, file multipart.File, filename string) (*domain.Photo, error)

	// GetPhotosByPet retorna todas las fotos de una mascota.
	GetPhotosByPet(petID string) ([]domain.Photo, error)

	// DeleteByPetID elimina de Cloudinary y de la BD todas las fotos de una mascota.
	// Los errores de Cloudinary se loguean y no interrumpen la eliminación de las demás fotos.
	DeleteByPetID(petID string) error
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

	// LÓGICA DE NEGOCIO: verificar límite de fotos antes de llamar a Cloudinary
	count, err := s.photoRepo.CountByPetID(petID)
	if err != nil {
		return nil, err
	}
	if count >= maxPhotosPerPet {
		return nil, domain.ErrPhotoLimitReached
	}

	if s.storage == nil {
		log.Println("[photo_service] Cloudinary no configurado — storage es nil")
		return nil, domain.ErrStorageFailed
	}

	// Aseguramos leer desde el principio (el handler ya buscó el MIME en los primeros bytes)
	if seeker, ok := file.(io.Seeker); ok {
		_, _ = seeker.Seek(0, io.SeekStart)
	}

	cloudinaryPublicID := sanitizePublicID(petID, filename)
	log.Printf("[photo_service] Subiendo imagen a Cloudinary — publicID: %s", cloudinaryPublicID)

	secureURL, returnedPublicID, err := s.storage.UploadImage(ctx, file, cloudinaryPublicID, "searchpet")
	if err != nil {
		log.Printf("[photo_service] Error en Cloudinary: %v", err)
		return nil, domain.ErrStorageFailed
	}

	uploaderUUID, err := uuid.Parse(uploaderID)
	if err != nil {
		return nil, domain.ErrInvalidInput
	}

	petUUID, err := uuid.Parse(petID)
	if err != nil {
		return nil, domain.ErrInvalidInput
	}

	// LÓGICA DE NEGOCIO: la nueva foto siempre se convierte en primary.
	// Si ya había una primary, la desmarcamos primero.
	if err := s.photoRepo.UnsetPrimaryPhotos(petID); err != nil {
		return nil, err
	}

	photo := &domain.Photo{
		PetID:      petUUID,
		URL:        secureURL,
		PublicID:   returnedPublicID,
		UploadedBy: uploaderUUID,
		IsPrimary:  true,
	}

	if err := s.photoRepo.Create(photo); err != nil {
		return nil, err
	}

	return photo, nil
}

// DeleteByPetID elimina de Cloudinary todos los assets de la mascota y luego borra las filas de BD.
// Errores de Cloudinary se loguean individualmente sin interrumpir el loop.
// La eliminación en BD siempre se ejecuta al final, independientemente de errores de Cloudinary.
func (s *photoServiceImpl) DeleteByPetID(petID string) error {
	photos, err := s.photoRepo.FindByPetID(petID)
	if err != nil {
		return err
	}

	for _, p := range photos {
		if p.PublicID == "" {
			log.Printf("[photo_service] Foto %s no tiene publicID — saltando delete de Cloudinary", p.ID)
			continue
		}
		if s.storage != nil {
			if delErr := s.storage.Delete(context.Background(), p.PublicID); delErr != nil {
				log.Printf("[photo_service] Error eliminando publicID=%s de Cloudinary: %v", p.PublicID, delErr)
			}
		}
	}

	return s.photoRepo.DeleteByPetID(petID)
}

// GetPhotosByPet delega al repositorio — sin lógica adicional en esta capa.
func (s *photoServiceImpl) GetPhotosByPet(petID string) ([]domain.Photo, error) {
	return s.photoRepo.FindByPetID(petID)
}
