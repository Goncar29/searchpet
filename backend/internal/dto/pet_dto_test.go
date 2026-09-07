// Package dto — verifies the privacy contract for a stray reporter's phone.
// A good-samaritan's number is sensitive: it is exposed ONLY when the reporter
// explicitly opted in (ReporterContactPublic) AND a phone is actually set.
package dto

import (
	"testing"
	"time"

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

// Las dos mitades. Sólo la primera pasaría con la allowlist invertida, y sólo la
// segunda pasaría con el campo nunca poblado.
func TestToPetResponse_LastSeenAt_SoloEnLostYStray(t *testing.T) {
	visto := time.Date(2026, 5, 3, 9, 30, 0, 0, time.UTC)

	for _, s := range []string{domain.PetStatusLost, domain.PetStatusStray} {
		pet := &domain.Pet{Status: s, LastReportedAt: &visto}
		resp := ToPetResponse(pet)
		if resp.LastSeenAt == nil {
			t.Errorf("status %q: esperaba last_seen_at, vino nil", s)
		} else if !resp.LastSeenAt.Equal(visto) {
			t.Errorf("status %q: esperaba %v, vino %v", s, visto, *resp.LastSeenAt)
		}
	}

	for _, s := range []string{
		domain.PetStatusRegistered,
		domain.PetStatusFound,
		domain.PetStatusArchived,
		domain.PetStatusAdoption,
		domain.PetStatusAdopted,
	} {
		pet := &domain.Pet{Status: s, LastReportedAt: &visto}
		if resp := ToPetResponse(pet); resp.LastSeenAt != nil {
			t.Errorf("status %q: no debería exponer last_seen_at, vino %v", s, *resp.LastSeenAt)
		}
	}
}
