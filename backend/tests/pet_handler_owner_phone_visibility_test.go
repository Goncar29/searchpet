package tests

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/dto"
	"lost-pets/internal/handler"
)

// GET /api/pets/:id — owner.phone sólo viaja en domain.ContactVisibleStatuses
// (lost/stray/adoption) o cuando el viewer autenticado es el propio dueño.
// Reproduce el hallazgo de la auditoría del 2026-09-23: FindByID no filtraba
// por estado y ToPetResponse copiaba Phone siempre que el owner estuviera
// cargado, así que cualquiera con el UUID de una mascota "registered" (nadie
// la busca) obtenía nombre y teléfono del dueño.
//
// setupPetPhoneVisibilityRouter monta la ruta SIN middleware cuando
// withViewer es uuid.Nil (simula un visitante anónimo — igual que
// OptionalAuth cuando no hay token) y CON un middleware que inyecta userID
// cuando withViewer no es uuid.Nil (simula OptionalAuth con un token válido).
func setupPetPhoneVisibilityRouter(h *handler.PetHandler, withViewer uuid.UUID) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	if withViewer == uuid.Nil {
		r.GET("/api/pets/:id", h.GetPet)
	} else {
		r.GET("/api/pets/:id", injectUserID(withViewer), h.GetPet)
	}
	return r
}

func petWithOwnerAndStatus(status string, ownerID uuid.UUID) *domain.Pet {
	return &domain.Pet{
		ID:      uuid.New(),
		OwnerID: &ownerID,
		Name:    "Firulais",
		Type:    "perro",
		Status:  status,
		Owner: domain.User{
			ID:    ownerID,
			Name:  "Dueño",
			Phone: "+59899123456",
		},
	}
}

func getPetPhone(t *testing.T, r *gin.Engine, petID string) (int, string) {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/api/pets/"+petID, nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		return w.Code, ""
	}
	var resp dto.PetResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if resp.Owner == nil {
		return w.Code, ""
	}
	return w.Code, resp.Owner.Phone
}

func TestGetPet_ExponeTelefono_AnonimoEnEstadosDeContactoActivo(t *testing.T) {
	ownerID := uuid.New()
	for _, status := range []string{domain.PetStatusLost, domain.PetStatusStray, domain.PetStatusAdoption} {
		pet := petWithOwnerAndStatus(status, ownerID)
		svc := &mockPetService{
			getPetByIDFn: func(_ string) (*domain.Pet, error) { return pet, nil },
		}
		r := setupPetPhoneVisibilityRouter(handler.NewPetHandler(svc, nil), uuid.Nil)

		code, phone := getPetPhone(t, r, pet.ID.String())
		if code != http.StatusOK {
			t.Fatalf("status %q: want 200, got %d", status, code)
		}
		if phone != "+59899123456" {
			t.Errorf("status %q anónimo: esperaba teléfono presente, vino %q", status, phone)
		}
	}
}

func TestGetPet_OcultaTelefono_AnonimoFueraDeContactoActivo(t *testing.T) {
	ownerID := uuid.New()
	for _, status := range []string{
		domain.PetStatusRegistered,
		domain.PetStatusArchived,
		domain.PetStatusFound,
		domain.PetStatusAdopted,
	} {
		pet := petWithOwnerAndStatus(status, ownerID)
		svc := &mockPetService{
			getPetByIDFn: func(_ string) (*domain.Pet, error) { return pet, nil },
		}
		r := setupPetPhoneVisibilityRouter(handler.NewPetHandler(svc, nil), uuid.Nil)

		code, phone := getPetPhone(t, r, pet.ID.String())
		if code != http.StatusOK {
			t.Fatalf("status %q: want 200, got %d", status, code)
		}
		if phone != "" {
			t.Errorf("status %q anónimo: esperaba teléfono ausente, vino %q", status, phone)
		}
	}
}

func TestGetPet_DuenoAutenticado_VeSuTelefono_EnEstadoNoActivo(t *testing.T) {
	ownerID := uuid.New()
	pet := petWithOwnerAndStatus(domain.PetStatusRegistered, ownerID)
	svc := &mockPetService{
		getPetByIDFn: func(_ string) (*domain.Pet, error) { return pet, nil },
	}
	r := setupPetPhoneVisibilityRouter(handler.NewPetHandler(svc, nil), ownerID)

	code, phone := getPetPhone(t, r, pet.ID.String())
	if code != http.StatusOK {
		t.Fatalf("want 200, got %d", code)
	}
	if phone != "+59899123456" {
		t.Errorf("dueño autenticado en 'registered': esperaba teléfono presente, vino %q", phone)
	}
}

func TestGetPet_OtroUsuarioAutenticado_NoVeElTelefono_EnEstadoNoActivo(t *testing.T) {
	ownerID := uuid.New()
	otherUserID := uuid.New()
	pet := petWithOwnerAndStatus(domain.PetStatusRegistered, ownerID)
	svc := &mockPetService{
		getPetByIDFn: func(_ string) (*domain.Pet, error) { return pet, nil },
	}
	r := setupPetPhoneVisibilityRouter(handler.NewPetHandler(svc, nil), otherUserID)

	code, phone := getPetPhone(t, r, pet.ID.String())
	if code != http.StatusOK {
		t.Fatalf("want 200, got %d", code)
	}
	if phone != "" {
		t.Errorf("otro usuario autenticado en 'registered': esperaba teléfono ausente, vino %q", phone)
	}
}
