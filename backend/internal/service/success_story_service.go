package service

import (
	"context"
	"fmt"
	"io"
	"log"
	"net/url"
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

// cloudinaryHost es el único origen del que se aceptan fotos de historia.
const cloudinaryHost = "res.cloudinary.com"

// esURLDeNuestroStorage acepta la cadena vacía (la foto es opcional) y, si hay
// algo, exige que sea una URL https servida por Cloudinary.
//
// SE COMPARA CONTRA EL HOST PARSEADO, nunca con un prefijo de string: un
// `strings.HasPrefix(u, "https://res.cloudinary.com")` lo pasa
// `https://res.cloudinary.com.evil.tld/x.png`, que es de otro dominio entero.
// `url.Parse` además normaliza el esquema a minúsculas, así que `HTTPS://` no
// necesita un caso aparte (regla #54).
//
// QUÉ NO CIERRA, y conviene decirlo: alguien con su propia cuenta de Cloudinary
// podría alojar una imagen ahí y pasar el filtro. Lo que sí elimina —que era el
// impacto real— es el servidor arbitrario que registra la IP de cada visitante
// de la historia. Atarlo además a nuestro cloud name exigiría inyectar config en
// este service; si algún día importa, ese es el paso siguiente.
func esURLDeNuestroStorage(raw string) bool {
	if raw == "" {
		return true
	}
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" {
		return false
	}
	return u.Hostname() == cloudinaryHost
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

	// UNA MASCOTA, UNA HISTORIA, UNA FOTO.
	//
	// Con la historia ya publicada no queda dónde poner la foto, así que subirla
	// sólo gastaría cuota. Este chequeo es lo que cierra el bucle del gate: antes
	// de publicar, el usuario puede cambiar de foto mientras elige —uso legítimo—
	// y una vez publicada, el endpoint deja de aceptarle nada para esa mascota.
	//
	// `GetByPetID` devuelve (nil, nil) cuando no hay historia, así que el error
	// se propaga y la ausencia NO se confunde con un fallo de lectura: sin esa
	// distinción, una base caída dejaría subir libremente.
	existente, err := s.repo.GetByPetID(ctx, pet.ID)
	if err != nil {
		return "", err
	}
	if existente != nil {
		return "", domain.ErrStoryAlreadyExists
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

	// Una mascota tiene UNA historia. No estaba chequeado: `Create` insertaba sin
	// mirar, y `success_stories.pet_id` es `index` y no `uniqueIndex`, así que se
	// podían acumular varias historias para la misma mascota. `GetByPetID`
	// devuelve una sola, con lo cual las demás quedaban invisibles por ese
	// endpoint pero visibles en la lista pública.
	//
	// El chequeo va en el service y NO en un índice único de la tabla, y la
	// diferencia importa: un `uniqueIndex` nuevo hace fallar el AutoMigrate si la
	// base YA tiene duplicados, y eso tumba el deploy (la familia de la regla
	// #35). Local está en cero, pero producción no se pudo verificar. El índice
	// es la garantía dura y va aparte, después de comprobar que no hay filas que
	// lo violen.
	existente, err := s.repo.GetByPetID(ctx, req.PetID)
	if err != nil {
		return nil, err
	}
	if existente != nil {
		return nil, domain.ErrStoryAlreadyExists
	}

	// Las fotos tienen que venir de NUESTRO storage, no de cualquier lado.
	//
	// Los campos son texto libre acotado sólo por largo, y `StoryDetailPage` los
	// pone directo en un `<img src>`: `cloudinaryThumb` devuelve intacta una URL
	// que no sea de Cloudinary. Sin este chequeo, cualquiera podía publicar una
	// historia con una imagen alojada en su propio servidor y quedarse con la IP
	// y el User-Agent de CADA visitante — además de poder cambiar la imagen
	// después de cualquier moderación, porque el contenido no es nuestro.
	//
	// El endpoint de upload existe justamente para producir estas URLs, así que
	// no hay caso legítimo que esto rompa.
	if !esURLDeNuestroStorage(req.PhotoBefore) || !esURLDeNuestroStorage(req.PhotoAfter) {
		return nil, domain.ErrInvalidInput
	}

	story := &domain.SuccessStory{
		PetID:       req.PetID,
		UserID:      userID,
		Title:       req.Title,
		HeroName:    req.HeroName,
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
