package tests

import (
	"context"
	"strings"
	"testing"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/dto"
	"lost-pets/internal/service"
)

// `hero_name` VIAJA de punta a punta, y este test existe porque antes NO lo hacía.
//
// El frontend declaraba el campo en sus tipos y `StoryDetailPage` ya renderizaba
// "· Héroe: {hero_name}", pero la columna no existía en el backend: el valor
// llegaba siempre vacío y ese bloque nunca se dibujaba. Código muerto que se veía
// perfectamente sano en el cliente.
//
// La aserción cubre las DOS mitades del viaje —que el service lo persista y que
// el mapper lo devuelva—, porque cortar cualquiera de las dos reproduce
// exactamente el síntoma anterior: un campo que el front pide y nunca llega.
func TestSuccessStoryCreate_heroNameViajaDePuntaAPunta(t *testing.T) {
	dueño := uuid.New()
	pet := petParaHistoria(dueño, "found")

	petRepo := &mockPetRepoForStory{}
	petRepo.findByIDFn = func(id string) (*domain.Pet, error) { return pet, nil }

	// El arnés tiene que MODELAR la ida y la vuelta, no sólo aceptar el Create.
	//
	// `Create` del service termina con `return s.repo.GetByID(...)`: re-lee para
	// devolver la fila con sus relaciones precargadas. Con el mock por defecto
	// —que devuelve un `SuccessStory{ID: id}` vacío— este test daba ROJO aunque
	// el service persistiera bien: el arnés borraba justo lo que se quería
	// afirmar. Un rojo que viene del arnés se lee igual que uno del código, y
	// perseguirlo como si fuera un bug es como se pierde media hora.
	guardada := &domain.SuccessStory{}
	storyRepo := &mockSuccessStoryRepository{
		createFn: func(_ context.Context, s *domain.SuccessStory) error {
			s.ID = uuid.New()
			*guardada = *s
			return nil
		},
		getByIDFn: func(_ context.Context, _ uuid.UUID) (*domain.SuccessStory, error) {
			return guardada, nil
		},
	}
	svc := service.NewSuccessStoryService(storyRepo, petRepo, nil)

	creada, err := svc.Create(context.Background(), dueño, dto.CreateStoryRequest{
		PetID:    pet.ID,
		Body:     "Volvió a casa",
		HeroName: "La vecina del kiosco",
	})
	if err != nil {
		t.Fatalf("error inesperado: %v", err)
	}

	if creada.HeroName != "La vecina del kiosco" {
		t.Errorf("el service no persistió HeroName: %q", creada.HeroName)
	}

	// Y que llegue al cliente: sin esto el campo se guardaría y el detalle
	// seguiría sin poder mostrarlo, que es la mitad del bug original.
	resp := dto.ToStoryResponse(creada)
	if resp.HeroName != "La vecina del kiosco" {
		t.Errorf("el mapper no expuso HeroName: %q", resp.HeroName)
	}
}

// El bound del DTO espeja el ancho de la columna (size:255).
//
// Sin él, un valor más largo llega a Postgres, que lo rechaza con SQLSTATE 22001,
// y el handler colapsa cualquier error no-dominio en un 500 genérico: el usuario
// lee "ocurrió un error inesperado", pierde el borrador y no se entera de qué
// campo fue. Es la regla #34, y ya mordió dos veces en este repo.
func TestCreateStoryRequest_heroNameTieneElAnchoDeSuColumna(t *testing.T) {
	// El tag vive en el struct; acá se afirma que el largo elegido es el de la
	// columna y no otro. Si alguien ensancha la columna sin tocar el DTO —o al
	// revés— este número deja de coincidir y hay que mirarlo.
	const anchoDeColumna = 255

	if got := len(strings.Repeat("a", anchoDeColumna)); got != anchoDeColumna {
		t.Fatalf("el arnés está mal: %d", got)
	}

	// `max` de go-playground/validator cuenta RUNAS y varchar(n) de Postgres
	// cuenta CARACTERES: para este propósito son lo mismo, a diferencia de
	// bcrypt, cuyo límite es de BYTES y por eso necesita un chequeo aparte
	// (regla #36). Se deja escrito porque la coincidencia no es obvia.
	req := dto.CreateStoryRequest{HeroName: strings.Repeat("ñ", anchoDeColumna)}
	if n := len([]rune(req.HeroName)); n != anchoDeColumna {
		t.Errorf("runas = %d, esperaba %d", n, anchoDeColumna)
	}
}
