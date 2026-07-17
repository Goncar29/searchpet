// Package dto — verifies the privacy contract for a stray reporter's phone.
// A good-samaritan's number is sensitive: it is exposed ONLY when the reporter
// explicitly opted in (ReporterContactPublic) AND a phone is actually set.
package dto

import (
	"testing"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
)

func strayPetWithReporter(contactPublic bool, phone string) *domain.Pet {
	reporterID := uuid.New()
	return &domain.Pet{
		ID:                    uuid.New(),
		ReporterID:            &reporterID,
		Name:                  "Callejero",
		Type:                  "perro",
		Status:                domain.PetStatusStray,
		ReporterContactPublic: contactPublic,
		Reporter: domain.User{
			ID:    reporterID,
			Name:  "Vecina",
			Phone: phone,
		},
	}
}

func TestToPetResponse_ExposesReporterPhone_WhenOptedInWithPhone(t *testing.T) {
	resp := ToPetResponse(strayPetWithReporter(true, "+59899123456"))

	if !resp.ReporterContactPublic {
		t.Error("expected reporter_contact_public=true in the response")
	}
	if resp.Reporter == nil {
		t.Fatal("expected reporter block to be present when opted in")
	}
	if resp.Reporter.Phone != "+59899123456" {
		t.Errorf("expected reporter phone exposed, got %q", resp.Reporter.Phone)
	}
}

func TestToPetResponse_HidesReporterPhone_WhenNotOptedIn(t *testing.T) {
	resp := ToPetResponse(strayPetWithReporter(false, "+59899123456"))

	if resp.ReporterContactPublic {
		t.Error("expected reporter_contact_public=false")
	}
	if resp.Reporter != nil {
		t.Errorf("reporter block must be omitted when not opted in, got %+v", resp.Reporter)
	}
}

func TestToPetResponse_OmitsReporterBlock_WhenOptedInButNoPhone(t *testing.T) {
	resp := ToPetResponse(strayPetWithReporter(true, ""))

	if resp.Reporter != nil {
		t.Errorf("reporter block must be omitted when there is no phone, got %+v", resp.Reporter)
	}
}

func TestToPetResponseIncludesCity(t *testing.T) {
	pet := &domain.Pet{Name: "Firulais", Type: "perro", Status: domain.PetStatusAdoption, City: "Montevideo"}
	resp := ToPetResponse(pet)
	if resp.City != "Montevideo" {
		t.Errorf("expected city Montevideo, got %q", resp.City)
	}
}
