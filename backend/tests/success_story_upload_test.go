package tests

import (
	"context"
	"errors"
	"io"
	"strings"
	"testing"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/dto"
	"lost-pets/internal/service"
)

// uploaderEspia registra si Cloudinary llegó a ser llamado.
//
// Que se PUEDA observar es el punto de todo el archivo: el valor de este
// endpoint no está en qué devuelve cuando anda, sino en no llamar a un servicio
// que cuesta dinero cuando el usuario no tiene derecho a hacerlo.
type uploaderEspia struct {
	llamadas int
	carpeta  string
	publicID string
}

func (u *uploaderEspia) UploadImage(ctx context.Context, file io.Reader, filename, folder string) (string, string, error) {
	u.llamadas++
	u.carpeta = folder
	u.publicID = filename
	return "https://res.cloudinary.com/demo/stories/ok.webp", "stories/ok", nil
}

func (u *uploaderEspia) Delete(ctx context.Context, publicID string) error { return nil }

func petParaHistoria(ownerID uuid.UUID, status string) *domain.Pet {
	id := uuid.New()
	owner := ownerID
	return &domain.Pet{ID: id, OwnerID: &owner, Status: status, Name: "Firulais"}
}

// El gate NO es una formalidad: sin él, cualquier usuario autenticado puede
// subir imágenes sin límite y quemar los 25 créditos mensuales de Cloudinary.
// Los otros tres uploads del proyecto están acotados porque PERSISTEN y cuentan
// (3 por mascota, 5 por casa de acogida); éste no persiste nada, así que su
// único freno es a quién le pertenece la mascota y en qué estado está.
//
// Cada caso afirma que Cloudinary recibió CERO llamadas, no sólo que hubo error:
// un service que rechazara DESPUÉS de subir devolvería el mismo error y ya
// habría gastado la cuota.
func TestSuccessStoryUploadPhoto_gate(t *testing.T) {
	dueño := uuid.New()
	otro := uuid.New()

	casos := []struct {
		nombre      string
		pet         *domain.Pet
		petErr      error
		quienSube   uuid.UUID
		errEsperado error
	}{
		{
			nombre:      "un extraño no puede subir a la mascota de otro",
			pet:         petParaHistoria(dueño, "found"),
			quienSube:   otro,
			errEsperado: domain.ErrForbidden,
		},
		{
			nombre:      "no se puede subir para una mascota que no está encontrada",
			pet:         petParaHistoria(dueño, "lost"),
			quienSube:   dueño,
			errEsperado: domain.ErrPetNotFoundStatus,
		},
		{
			nombre:      "una mascota inexistente no llega a Cloudinary",
			petErr:      domain.ErrPetNotFound,
			quienSube:   dueño,
			errEsperado: domain.ErrPetNotFound,
		},
	}

	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			espia := &uploaderEspia{}
			petRepo := &mockPetRepoForStory{}
			petRepo.findByIDFn = func(id string) (*domain.Pet, error) {
				if c.petErr != nil {
					return nil, c.petErr
				}
				return c.pet, nil
			}
			svc := service.NewSuccessStoryService(&mockSuccessStoryRepository{}, petRepo, espia)

			_, err := svc.UploadPhoto(context.Background(), c.quienSube, uuid.New().String(), strings.NewReader("bytes"), "foto.jpg")

			if !errors.Is(err, c.errEsperado) {
				t.Fatalf("error = %v, esperaba %v", err, c.errEsperado)
			}
			if espia.llamadas != 0 {
				t.Errorf("Cloudinary recibió %d llamadas y no debía recibir ninguna — "+
					"rechazar después de subir ya gastó la cuota", espia.llamadas)
			}
		})
	}
}

// El camino feliz, y de paso las dos cosas que el comentario del service promete:
// que la foto va a su PROPIA carpeta (no mezclada con las de mascotas) y que el
// public_id lleva el pet id.
func TestSuccessStoryUploadPhoto_dueñoDeMascotaEncontrada(t *testing.T) {
	dueño := uuid.New()
	pet := petParaHistoria(dueño, "found")
	espia := &uploaderEspia{}
	petRepo := &mockPetRepoForStory{}
	petRepo.findByIDFn = func(id string) (*domain.Pet, error) { return pet, nil }

	svc := service.NewSuccessStoryService(&mockSuccessStoryRepository{}, petRepo, espia)

	url, err := svc.UploadPhoto(context.Background(), dueño, pet.ID.String(), strings.NewReader("bytes"), "foto.jpg")
	if err != nil {
		t.Fatalf("error inesperado: %v", err)
	}
	if url == "" {
		t.Fatal("la URL vino vacía")
	}
	if espia.llamadas != 1 {
		t.Errorf("llamadas a Cloudinary = %d, esperaba 1", espia.llamadas)
	}
	if espia.carpeta != "stories" {
		t.Errorf("carpeta = %q, esperaba \"stories\" — una foto de historia no va con las de mascotas", espia.carpeta)
	}
	if !strings.Contains(espia.publicID, pet.ID.String()) {
		t.Errorf("public_id = %q, esperaba que contuviera el pet id", espia.publicID)
	}
}

// Sin Cloudinary configurado el upload falla, pero el resto de las historias
// sigue andando. Es el mismo trato que le da PhotoService: un deploy sin
// credenciales de imágenes no puede tumbar una feature que no las necesita.
func TestSuccessStoryUploadPhoto_sinStorage(t *testing.T) {
	dueño := uuid.New()
	pet := petParaHistoria(dueño, "found")
	petRepo := &mockPetRepoForStory{}
	petRepo.findByIDFn = func(id string) (*domain.Pet, error) { return pet, nil }

	svc := service.NewSuccessStoryService(&mockSuccessStoryRepository{}, petRepo, nil)

	if _, err := svc.UploadPhoto(context.Background(), dueño, pet.ID.String(), strings.NewReader("b"), "f.jpg"); !errors.Is(err, domain.ErrStorageFailed) {
		t.Fatalf("error = %v, esperaba ErrStorageFailed", err)
	}
}

// UNA MASCOTA, UNA HISTORIA, UNA FOTO.
//
// Con la historia ya publicada no queda dónde poner la foto, así que subirla
// sólo gastaría cuota de Cloudinary. Este es el chequeo que cierra el bucle del
// gate: antes de publicar el usuario puede cambiar de foto mientras elige —uso
// legítimo—, y después el endpoint deja de aceptarle nada para esa mascota.
func TestSuccessStoryUploadPhoto_conHistoriaYaPublicada(t *testing.T) {
	dueño := uuid.New()
	pet := petParaHistoria(dueño, "found")
	espia := &uploaderEspia{}

	petRepo := &mockPetRepoForStory{}
	petRepo.findByIDFn = func(id string) (*domain.Pet, error) { return pet, nil }

	storyRepo := &mockSuccessStoryRepository{
		getByPetIDFn: func(_ context.Context, _ uuid.UUID) (*domain.SuccessStory, error) {
			return &domain.SuccessStory{ID: uuid.New(), PetID: pet.ID}, nil
		},
	}

	_, err := service.NewSuccessStoryService(storyRepo, petRepo, espia).
		UploadPhoto(context.Background(), dueño, pet.ID.String(), strings.NewReader("b"), "f.jpg")

	if !errors.Is(err, domain.ErrStoryAlreadyExists) {
		t.Fatalf("error = %v, esperaba ErrStoryAlreadyExists", err)
	}
	if espia.llamadas != 0 {
		t.Errorf("Cloudinary recibió %d llamadas: rechazar DESPUÉS de subir ya gastó la cuota", espia.llamadas)
	}
}

// Una lectura FALLIDA no es "no hay historia".
//
// `GetByPetID` devuelve (nil, nil) cuando no existe, así que confundir el error
// con la ausencia dejaría subir libremente justo cuando la base está caída —
// exactamente el modo de falla de la regla #60, movido al backend.
func TestSuccessStoryUploadPhoto_siLaLecturaFallaNoSube(t *testing.T) {
	dueño := uuid.New()
	pet := petParaHistoria(dueño, "found")
	espia := &uploaderEspia{}

	petRepo := &mockPetRepoForStory{}
	petRepo.findByIDFn = func(id string) (*domain.Pet, error) { return pet, nil }

	boom := errors.New("la base no responde")
	storyRepo := &mockSuccessStoryRepository{
		getByPetIDFn: func(_ context.Context, _ uuid.UUID) (*domain.SuccessStory, error) {
			return nil, boom
		},
	}

	_, err := service.NewSuccessStoryService(storyRepo, petRepo, espia).
		UploadPhoto(context.Background(), dueño, pet.ID.String(), strings.NewReader("b"), "f.jpg")

	if !errors.Is(err, boom) {
		t.Fatalf("error = %v, esperaba que se propagara el de la base", err)
	}
	if espia.llamadas != 0 {
		t.Errorf("subió con la base caída: %d llamadas", espia.llamadas)
	}
}

// La misma regla del lado de crear: dos historias para la misma mascota no.
func TestSuccessStoryCreate_noDuplicaLaHistoriaDeUnaMascota(t *testing.T) {
	dueño := uuid.New()
	pet := petParaHistoria(dueño, "found")

	petRepo := &mockPetRepoForStory{}
	petRepo.findByIDFn = func(id string) (*domain.Pet, error) { return pet, nil }

	creaciones := 0
	storyRepo := &mockSuccessStoryRepository{
		getByPetIDFn: func(_ context.Context, _ uuid.UUID) (*domain.SuccessStory, error) {
			return &domain.SuccessStory{ID: uuid.New(), PetID: pet.ID}, nil
		},
		createFn: func(_ context.Context, _ *domain.SuccessStory) error {
			creaciones++
			return nil
		},
	}

	_, err := service.NewSuccessStoryService(storyRepo, petRepo, nil).
		Create(context.Background(), dueño, dto.CreateStoryRequest{PetID: pet.ID, Body: "otra"})

	if !errors.Is(err, domain.ErrStoryAlreadyExists) {
		t.Fatalf("error = %v, esperaba ErrStoryAlreadyExists", err)
	}
	if creaciones != 0 {
		t.Errorf("insertó igual: %d creaciones", creaciones)
	}
}
