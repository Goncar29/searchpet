package dto

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"lost-pets/internal/domain"
)

func TestToGenerateShareLinkResponse_StripsTrailingSlash(t *testing.T) {
	// APP_URL on Render includes a trailing slash — must not produce "//share/"
	expiresAt := time.Now().Add(24 * time.Hour)
	resp := ToGenerateShareLinkResponse("abc123", "https://example.com/", expiresAt)

	if strings.Contains(resp.ShareURL, "//pet/") {
		t.Fatalf("share URL has double slash: %q", resp.ShareURL)
	}
	want := "https://example.com/share/abc123"
	if resp.ShareURL != want {
		t.Fatalf("want %q, got %q", want, resp.ShareURL)
	}
}

func TestToGenerateShareLinkResponse_NoTrailingSlash(t *testing.T) {
	expiresAt := time.Now().Add(24 * time.Hour)
	resp := ToGenerateShareLinkResponse("abc123", "https://example.com", expiresAt)

	want := "https://example.com/share/abc123"
	if resp.ShareURL != want {
		t.Fatalf("want %q, got %q", want, resp.ShareURL)
	}
}

// La landing publica es lo que ve un desconocido que encontro a la mascota, asi
// que las senias tienen que llegarle: sexo y edad son de lo mas util para
// reconocer a un animal, igual que la raza y el color.
func TestToShareLinkPublicResponse_ExponeLasSenias(t *testing.T) {
	nacimiento := time.Date(2022, 3, 9, 0, 0, 0, 0, time.UTC)
	link := &domain.ShareLink{
		ShareToken: "tok",
		Pet: domain.Pet{
			Name:               "Koda",
			Type:               "perro",
			Breed:              "Husky",
			Color:              "Gris",
			Gender:             "male",
			BirthDate:          &nacimiento,
			BirthDatePrecision: "day",
			Status:             "lost",
		},
	}

	resp := ToShareLinkPublicResponse(link)

	if resp.Pet.Gender != "male" {
		t.Fatalf("gender = %q, se esperaba \"male\"", resp.Pet.Gender)
	}
	if resp.Pet.BirthDatePrecision != "day" {
		t.Fatalf("precision = %q", resp.Pet.BirthDatePrecision)
	}
	// Dia de calendario plano, NUNCA un instante ISO: la fecha viaja igual que
	// en PetResponse, o el cliente pierde la zona y la corre un dia entero.
	if resp.Pet.BirthDate != "2022-03-09" {
		t.Fatalf("birth_date = %q, se esperaba \"2022-03-09\"", resp.Pet.BirthDate)
	}
	if strings.ContainsAny(resp.Pet.BirthDate, "TZ:") {
		t.Fatalf("birth_date volvio como instante (%q)", resp.Pet.BirthDate)
	}
}

// EL test que protege la distincion. Este endpoint NO pide sesion: cualquiera
// con el token lee la respuesta. El microchip es PROBATORIO —quien lo sabe
// puede reclamar una mascota ajena— mientras que el sexo y la edad son
// DESCRIPTIVOS. Si alguien agrega MicrochipID al struct "para completar", esto
// se pone rojo.
func TestToShareLinkPublicResponse_NoExponeElMicrochip(t *testing.T) {
	link := &domain.ShareLink{
		ShareToken: "tok",
		Pet:        domain.Pet{Name: "Koda", Type: "perro", MicrochipID: strPtr("985141000123456")},
	}

	crudo, err := json.Marshal(ToShareLinkPublicResponse(link).Pet)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if strings.Contains(string(crudo), "985141000123456") {
		t.Fatalf("el microchip viajo en la respuesta publica: %s", crudo)
	}
	if strings.Contains(string(crudo), "microchip") {
		t.Fatalf("apareció un campo de microchip en la respuesta publica: %s", crudo)
	}
}

func strPtr(s string) *string { return &s }

// La landing de share es publica y SIN sesion — cualquiera con el token la
// lee. Hallazgo lateral S2b de la auditoria de seguridad 2026-09-23, mismo
// patron que pet_service.SearchPets: el link no expira mientras la mascota
// esta en lost/stray (regla #16 de CLAUDE.md) y tampoco inmediatamente
// despues de resolverse (ExpiresAt da un margen de 30 dias), asi que un link
// para una mascota "found" sigue siendo un link vivo. Antes del fix,
// ToShareLinkPublicResponse copiaba Owner.Phone sin mirar el estado.
func TestToShareLinkPublicResponse_OcultaTelefonoFueraDeContactoActivo(t *testing.T) {
	for _, status := range []string{
		domain.PetStatusFound,
		domain.PetStatusRegistered,
		domain.PetStatusArchived,
		domain.PetStatusAdopted,
	} {
		link := &domain.ShareLink{
			ShareToken: "tok",
			Pet: domain.Pet{
				Name:   "Koda",
				Type:   "perro",
				Status: status,
				Owner:  domain.User{Name: "Dueño", Phone: "+59899123456"},
			},
		}

		resp := ToShareLinkPublicResponse(link)

		if resp.Owner.Phone != "" {
			t.Errorf("status %q: esperaba owner.phone vacío (fuera de búsqueda activa), vino %q", status, resp.Owner.Phone)
		}
	}
}

// La otra mitad: lost/stray/adoption SÍ tienen que seguir mostrando el
// teléfono — es lo que permite contactar al dueño desde un link compartido.
func TestToShareLinkPublicResponse_ExponeTelefonoEnContactoActivo(t *testing.T) {
	for _, status := range []string{
		domain.PetStatusLost,
		domain.PetStatusStray,
		domain.PetStatusAdoption,
	} {
		link := &domain.ShareLink{
			ShareToken: "tok",
			Pet: domain.Pet{
				Name:   "Koda",
				Type:   "perro",
				Status: status,
				Owner:  domain.User{Name: "Dueño", Phone: "+59899123456"},
			},
		}

		resp := ToShareLinkPublicResponse(link)

		if resp.Owner.Phone != "+59899123456" {
			t.Errorf("status %q: esperaba owner.phone presente (búsqueda activa), vino %q", status, resp.Owner.Phone)
		}
	}
}
