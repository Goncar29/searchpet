package tests

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/dto"
)

func TestRegisterShelterRequest_Validate(t *testing.T) {
	base := dto.RegisterShelterRequest{Name: "Refugio", City: "Montevideo"}

	valid := base
	valid.WebsiteURL = "https://refugio.org"
	valid.DonationURL = "https://refugio.org/donar"
	if err := valid.Validate(); err != nil {
		t.Errorf("valid https URLs: want nil, got %v", err)
	}

	empty := base // empty URLs are valid (optional fields)
	if err := empty.Validate(); err != nil {
		t.Errorf("empty URLs: want nil, got %v", err)
	}

	httpURL := base
	httpURL.WebsiteURL = "http://refugio.org"
	if err := httpURL.Validate(); err != domain.ErrInvalidInput {
		t.Errorf("http URL: want ErrInvalidInput, got %v", err)
	}

	garbage := base
	garbage.DonationURL = "no-es-una-url"
	if err := garbage.Validate(); err != domain.ErrInvalidInput {
		t.Errorf("garbage URL: want ErrInvalidInput, got %v", err)
	}
}

func TestUpdateMyShelterRequest_Validate(t *testing.T) {
	https := "https://refugio.org/donar"
	http := "http://refugio.org/donar"
	emptyStr := ""

	ok := dto.UpdateMyShelterRequest{DonationURL: &https, WebsiteURL: &emptyStr}
	if err := ok.Validate(); err != nil {
		t.Errorf("https + explicit clear: want nil, got %v", err)
	}

	bad := dto.UpdateMyShelterRequest{WebsiteURL: &http}
	if err := bad.Validate(); err != domain.ErrInvalidInput {
		t.Errorf("http URL: want ErrInvalidInput, got %v", err)
	}

	// Name/City son REQUERIDOS: vaciar (&"") o mandar solo espacios es inválido
	// (regla #22: el clear con &"" es solo para campos OPCIONALES).
	blankName := dto.UpdateMyShelterRequest{Name: &emptyStr}
	if err := blankName.Validate(); err != domain.ErrInvalidInput {
		t.Errorf("blank name: want ErrInvalidInput, got %v", err)
	}

	spacesCity := "  "
	blankCity := dto.UpdateMyShelterRequest{City: &spacesCity}
	if err := blankCity.Validate(); err != domain.ErrInvalidInput {
		t.Errorf("whitespace city: want ErrInvalidInput, got %v", err)
	}

	// Los opcionales SÍ se pueden vaciar.
	clearOptional := dto.UpdateMyShelterRequest{Phone: &emptyStr, Email: &emptyStr, Description: &emptyStr}
	if err := clearOptional.Validate(); err != nil {
		t.Errorf("clearing optional fields: want nil, got %v", err)
	}

	// Y un Name/City no vacío sigue siendo válido.
	newName := "Refugio Renombrado"
	renamed := dto.UpdateMyShelterRequest{Name: &newName}
	if err := renamed.Validate(); err != nil {
		t.Errorf("non-empty name: want nil, got %v", err)
	}
}

func TestToMyShelterResponse_IncludesReviewState(t *testing.T) {
	ownerID := uuid.New()
	pendingURL := "https://nuevo.org/donar"
	shelter := &domain.Shelter{
		ID:                 uuid.New(),
		OwnerUserID:        &ownerID,
		Name:               "Mi Refugio",
		City:               "Montevideo",
		Status:             domain.ShelterStatusRejected,
		RejectionReason:    "link de donación roto",
		PendingDonationURL: &pendingURL,
	}

	resp := dto.ToMyShelterResponse(shelter)
	if resp.Status != domain.ShelterStatusRejected {
		t.Errorf("Status: want rejected, got %q", resp.Status)
	}
	if resp.RejectionReason != "link de donación roto" {
		t.Errorf("RejectionReason: want the admin reason, got %q", resp.RejectionReason)
	}
	if resp.PendingDonationURL == nil || *resp.PendingDonationURL != pendingURL {
		t.Errorf("PendingDonationURL: want %q, got %v", pendingURL, resp.PendingDonationURL)
	}
}

func TestToShelterResponse_NeverLeaksReviewFields(t *testing.T) {
	ownerID := uuid.New()
	pendingURL := "https://nuevo.org/donar"
	shelter := &domain.Shelter{
		ID:                 uuid.New(),
		OwnerUserID:        &ownerID,
		Name:               "Refugio Público",
		City:               "Montevideo",
		Status:             domain.ShelterStatusApproved,
		RejectionReason:    "dato interno",
		PendingDonationURL: &pendingURL,
	}

	raw, err := json.Marshal(dto.ToShelterResponse(shelter))
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	body := string(raw)
	for _, leaked := range []string{"owner_user_id", "rejection_reason", "pending_donation_url", "pending_website_url", "status"} {
		if strings.Contains(body, leaked) {
			t.Errorf("public ShelterResponse leaks %q: %s", leaked, body)
		}
	}
}
