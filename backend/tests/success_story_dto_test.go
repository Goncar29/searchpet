package tests

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/dto"
)

// TestToStoryResponse_PetPhoto_UsesFirstPhoto verifies the DTO maps the first
// element of the preloaded Photos slice. Canonical ordering of that slice
// (created_at ASC, id ASC, ignoring is_primary) is the repository's
// responsibility — see success_story_repository_test.go.
func TestToStoryResponse_PetPhoto_UsesFirstPhoto(t *testing.T) {
	petID := uuid.New()
	story := &domain.SuccessStory{
		ID:    uuid.New(),
		PetID: petID,
		Body:  "Reunited",
		Pet: domain.Pet{
			ID:   petID,
			Name: "Toby",
			Photos: []domain.Photo{
				{ID: uuid.New(), URL: "https://cdn/first.jpg"},
				{ID: uuid.New(), URL: "https://cdn/second.jpg"},
			},
		},
	}

	resp := dto.ToStoryResponse(story)

	if resp.PetPhoto != "https://cdn/first.jpg" {
		t.Errorf("want pet_photo=first.jpg, got %q", resp.PetPhoto)
	}
}

func TestToStoryResponse_PetPhoto_EmptyWhenNoPhotos(t *testing.T) {
	petID := uuid.New()
	story := &domain.SuccessStory{
		ID:    uuid.New(),
		PetID: petID,
		Body:  "Reunited",
		Pet:   domain.Pet{ID: petID, Name: "Toby"},
	}

	resp := dto.ToStoryResponse(story)

	if resp.PetPhoto != "" {
		t.Errorf("want empty pet_photo, got %q", resp.PetPhoto)
	}
}

// bindCreateStory corre el cuerpo por el MISMO ShouldBindJSON que usa
// SuccessStoryHandler.Create, para que el test ejercite el tag de binding real
// y no una copia de la regla.
func bindCreateStory(t *testing.T, body string) error {
	t.Helper()
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/api/stories", strings.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	var req dto.CreateStoryRequest
	return c.ShouldBindJSON(&req)
}

// TestCreateStoryRequest_TituloLargoSeRechazaEnElBinding cubre el hueco entre el
// DTO y la columna.
//
// `SuccessStory.Title` es varchar(255). Sin el tag `max=255`, un titulo mas
// largo pasa la validacion, viaja hasta Postgres y muere ahi con SQLSTATE
// 22001; el handler colapsa cualquier error no-dominio en 500 ErrInternal
// (success_story_handler.go:47), asi que el usuario lee "ocurrio un error
// inesperado", pierde el borrador entero y no se entera de que campo fue.
//
// El limite se prueba EN EL BORDE, no con un valor cualquiera: 255 tiene que
// entrar y 256 tiene que salir. Un test que solo probara 1000 pasaria igual con
// el tope puesto en 10.
func TestCreateStoryRequest_TituloLargoSeRechazaEnElBinding(t *testing.T) {
	petID := uuid.New().String()

	t.Run("255 entra", func(t *testing.T) {
		body := `{"pet_id":"` + petID + `","body":"volvio a casa","title":"` + strings.Repeat("a", 255) + `"}`
		if err := bindCreateStory(t, body); err != nil {
			t.Fatalf("un titulo de 255 debe ser valido, se rechazo: %v", err)
		}
	})

	t.Run("256 se rechaza", func(t *testing.T) {
		body := `{"pet_id":"` + petID + `","body":"volvio a casa","title":"` + strings.Repeat("a", 256) + `"}`
		if err := bindCreateStory(t, body); err == nil {
			t.Fatal("un titulo de 256 debe rechazarse en el binding (400), no llegar a Postgres y volver como 500")
		}
	})

	// El tag cuenta RUNAS y varchar(n) cuenta CARACTERES, asi que para este
	// proposito son la misma unidad — a diferencia de bcrypt, cuyo limite es de
	// bytes y por eso necesita su propio chequeo (regla #36). 255 acentos son
	// 510 bytes y tienen que ENTRAR: si alguien "arreglara" esto contando bytes,
	// este caso se pone rojo.
	t.Run("255 caracteres multibyte entran", func(t *testing.T) {
		body := `{"pet_id":"` + petID + `","body":"volvio a casa","title":"` + strings.Repeat("á", 255) + `"}`
		if err := bindCreateStory(t, body); err != nil {
			t.Fatalf("255 runas deben entrar aunque pesen 510 bytes, se rechazo: %v", err)
		}
	})
}
