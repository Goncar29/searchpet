package service

import (
	"context"
	"fmt"
	"io"
	"log"
	"time"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/dto"
	"lost-pets/internal/repository"
)

type successStoryService struct {
	repo    repository.SuccessStoryRepository
	petRepo repository.PetRepository
	storage ImageUploader
}

// NewSuccessStoryService construye el SuccessStoryService con sus dependencias.
//
// `storage` puede ser nil: si Cloudinary no está configurado el resto de las
// historias sigue funcionando y sólo el upload responde ErrStorageFailed. Es el
// mismo trato que le da PhotoService — un deploy sin credenciales de imágenes no
// puede tumbar la creación de historias, que no las necesita.
func NewSuccessStoryService(
	repo repository.SuccessStoryRepository,
	petRepo repository.PetRepository,
	storage ImageUploader,
) SuccessStoryService {
	return &successStoryService{repo: repo, petRepo: petRepo, storage: storage}
}

// UploadPhoto sube la foto del reencuentro y devuelve su URL. NO persiste nada:
// la URL viaja al cliente y vuelve dentro de CreateStoryRequest.photo_after.
//
// PIDE EL pet_id Y REPITE LA AUTORIZACIÓN DE Create, y eso es lo que lo hace
// seguro. Los otros tres uploads del proyecto están acotados porque PERSISTEN y
// cuentan (3 fotos por mascota, 5 por casa de acogida); éste no persiste, así
// que sin gate sería una vía libre para quemar los 25 créditos mensuales de
// Cloudinary — y la regla #1 del proyecto es $0/mes sin excepciones.
//
// Atarlo a `canManagePet` + `status == found` acota el abuso al conjunto de
// mascotas reencontradas del propio usuario, que es chico y real. Reusa la regla
// que ya existe en vez de agregar un rate limit nuevo, que además tendría la
// clave equivocada: el del proyecto va por `ruta + ClientIP`, o sea acota un
// ORIGEN y nunca una cuenta (regla #43).
//
// El formato lo decide `CloudinaryClient.UploadImage`, que aplica
// `Format: "webp"` y `w_1200,c_limit,q_80` a TODO lo que sube. No se configura
// acá: se hereda por usar la pieza correcta.
func (s *successStoryService) UploadPhoto(
	ctx context.Context,
	userID uuid.UUID,
	petID string,
	file io.Reader,
	filename string,
) (string, error) {
	pet, err := s.petRepo.FindByID(petID)
	if err != nil {
		return "", err
	}
	if !canManagePet(pet, userID.String()) {
		return "", domain.ErrForbidden
	}
	if pet.Status != "found" {
		return "", domain.ErrPetNotFoundStatus
	}
	if s.storage == nil {
		return "", domain.ErrStorageFailed
	}

	// El timestamp evita que el browser sirva la foto anterior desde caché
	// cuando el usuario reemplaza la que había elegido. Mismo motivo que en
	// `sanitizePublicID`; el nombre del archivo NO entra en el public_id porque
	// acá no hay galería que navegar, sólo una URL que viaja al formulario.
	publicID := fmt.Sprintf("stories/%s/%d", petID, time.Now().UnixMilli())
	secureURL, _, err := s.storage.UploadImage(ctx, file, publicID, "stories")
	if err != nil {
		log.Printf("[success_story_service] Error en Cloudinary: %v", err)
		return "", domain.ErrStorageFailed
	}
	return secureURL, nil
}

// Create crea una nueva historia de éxito.
// Verifica que la mascota exista y tenga status "found" antes de crear.
func (s *successStoryService) Create(ctx context.Context, userID uuid.UUID, req dto.CreateStoryRequest) (*domain.SuccessStory, error) {
	pet, err := s.petRepo.FindByID(req.PetID.String())
	if err != nil {
		if err == domain.ErrPetNotFound {
			return nil, domain.ErrPetNotFound
		}
		return nil, err
	}

	// Authorization — only the user who manages the pet may write its story:
	// the owner for owned pets, the reporter for strays (which have no owner).
	if !canManagePet(pet, userID.String()) {
		return nil, domain.ErrForbidden
	}

	if pet.Status != "found" {
		return nil, domain.ErrPetNotFoundStatus
	}

	story := &domain.SuccessStory{
		PetID:       req.PetID,
		UserID:      userID,
		Title:       req.Title,
		Body:        req.Body,
		PhotoBefore: req.PhotoBefore,
		PhotoAfter:  req.PhotoAfter,
		LikeCount:   0,
		Featured:    false,
	}

	if err := s.repo.Create(ctx, story); err != nil {
		return nil, err
	}

	return s.repo.GetByID(ctx, story.ID)
}

// GetByPetID obtiene la historia de éxito asociada a una mascota.
// Retorna nil, nil si no existe ninguna historia para esa mascota.
func (s *successStoryService) GetByPetID(ctx context.Context, petID uuid.UUID) (*domain.SuccessStory, error) {
	return s.repo.GetByPetID(ctx, petID)
}

// GetByID obtiene una historia por su ID.
func (s *successStoryService) GetByID(ctx context.Context, id uuid.UUID) (*domain.SuccessStory, error) {
	return s.repo.GetByID(ctx, id)
}

// List retorna historias con filtro opcional de featured.
func (s *successStoryService) List(ctx context.Context, featured *bool, limit, offset int) ([]domain.SuccessStory, error) {
	return s.repo.GetAll(ctx, featured, limit, offset)
}

func (s *successStoryService) Count(ctx context.Context, featured *bool) (int64, error) {
	return s.repo.CountAll(ctx, featured)
}

// Like asegura que el usuario tenga un like en la historia (idempotente).
// Siempre retorna liked=true en éxito, sin importar si ya existía el like.
func (s *successStoryService) Like(ctx context.Context, storyID, userID uuid.UUID) (int, bool, error) {
	_, count, err := s.repo.AddLike(ctx, storyID, userID)
	if err != nil {
		return 0, false, err
	}
	return count, true, nil
}

// Unlike asegura que el usuario no tenga un like en la historia (idempotente).
// Siempre retorna liked=false en éxito, sin importar si el like existía.
func (s *successStoryService) Unlike(ctx context.Context, storyID, userID uuid.UUID) (int, bool, error) {
	_, count, err := s.repo.RemoveLike(ctx, storyID, userID)
	if err != nil {
		return 0, false, err
	}
	return count, false, nil
}

// LikedStoryIDs retorna el subconjunto de storyIDs que userID likeó.
func (s *successStoryService) LikedStoryIDs(ctx context.Context, userID uuid.UUID, storyIDs []uuid.UUID) (map[uuid.UUID]bool, error) {
	return s.repo.LikedStoryIDs(ctx, userID, storyIDs)
}

// SetFeatured marca o desmarca la historia como featured (solo admin — enforced en handler).
// Persiste featuredBy para auditoría.
func (s *successStoryService) SetFeatured(ctx context.Context, id uuid.UUID, featured bool, adminID uuid.UUID) error {
	return s.repo.SetFeatured(ctx, id, featured, adminID)
}

// Delete hace soft-delete de la historia.
// REGLA: solo el dueño o un admin puede borrar.
func (s *successStoryService) Delete(ctx context.Context, id uuid.UUID, callerID uuid.UUID, isAdmin bool) error {
	story, err := s.repo.GetByID(ctx, id)
	if err != nil {
		return err
	}

	if !isAdmin && story.UserID != callerID {
		return domain.ErrForbidden
	}

	return s.repo.Delete(ctx, id)
}
