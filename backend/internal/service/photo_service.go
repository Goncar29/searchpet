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
	"lost-pets/internal/event"
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

	// DeletePhoto elimina una foto específica. Verifica que el caller sea el dueño de la mascota.
	// El delete de Cloudinary es best-effort — un fallo no interrumpe el delete en BD.
	DeletePhoto(ctx context.Context, petID, photoID, uploaderID string) error
}

// photoServiceImpl es la implementación concreta del PhotoService.
type photoServiceImpl struct {
	photoRepo repository.PhotoRepository
	petRepo   repository.PetRepository
	storage   *storage.CloudinaryClient
	bus       *event.EventBus
}

// NewPhotoService construye el PhotoService con todas sus dependencias.
func NewPhotoService(
	photoRepo repository.PhotoRepository,
	petRepo repository.PetRepository,
	storage *storage.CloudinaryClient,
	bus *event.EventBus,
) PhotoService {
	return &photoServiceImpl{
		photoRepo: photoRepo,
		petRepo:   petRepo,
		storage:   storage,
		bus:       bus,
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
	// LÓGICA DE NEGOCIO: el dueño (o el reporter, si es un stray) puede subir fotos.
	pet, err := s.petRepo.FindByID(petID)
	if err != nil {
		return nil, err
	}

	if !canManagePet(pet, uploaderID) {
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

	// Publicamos el evento para que EmbeddingService genere el vector CLIP (async, fire-and-forget).
	if s.bus != nil {
		s.bus.Publish("photo.uploaded", event.PhotoUploadedEvent{
			PetID:     photo.PetID,
			PhotoID:   photo.ID,
			SecureURL: photo.URL,
		})
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

// DeletePhoto elimina una foto específica de una mascota.
// REGLAS DE NEGOCIO:
// 1. La mascota debe existir → ErrPetNotFound
// 2. El caller debe ser el dueño → ErrNotPetOwner
// 3. La foto debe existir → ErrPhotoNotFound
// 4. Delete de Cloudinary es best-effort (loguea fallo, continúa con delete en BD)
func (s *photoServiceImpl) DeletePhoto(ctx context.Context, petID, photoID, uploaderID string) error {
	// 1. Verificar ownership de la mascota
	pet, err := s.petRepo.FindByID(petID)
	if err != nil {
		return err // ErrPetNotFound se propaga
	}

	// El dueño (o el reporter, si es un stray) puede eliminar fotos.
	if !canManagePet(pet, uploaderID) {
		return domain.ErrNotPetOwner
	}

	// 2. Buscar la foto
	photo, err := s.photoRepo.FindByID(photoID)
	if err != nil {
		return err // ErrPhotoNotFound se propaga
	}

	// 3. Best-effort delete en Cloudinary (Cloudinary tiene recuperación de 30 días en trash)
	if s.storage != nil && photo.PublicID != "" {
		if delErr := s.storage.Delete(ctx, photo.PublicID); delErr != nil {
			log.Printf("[photo_service] Error eliminando publicID=%s de Cloudinary: %v", photo.PublicID, delErr)
			// Continuamos — el delete en BD debe ejecutarse igual
		}
	}

	// 4. Eliminar de BD
	return s.photoRepo.DeleteByID(photoID)
}
