package tests

import (
	"testing"

	"lost-pets/internal/domain"
)

func TestShelterErrorCodes(t *testing.T) {
	cases := []struct {
		err  error
		code string
	}{
		{domain.ErrShelterAlreadyOwned, "shelter_already_owned"},
		{domain.ErrEmailNotVerified, "email_not_verified"},
		{domain.ErrInvalidShelterStatus, "invalid_shelter_status"},
		{domain.ErrRejectionReasonRequired, "rejection_reason_required"},
		{domain.ErrShelterNotFound, "shelter_not_found"},
	}
	for _, tc := range cases {
		if got := domain.CodeFor(tc.err); got != tc.code {
			t.Errorf("CodeFor(%v) = %q, want %q", tc.err, got, tc.code)
		}
	}
}

func TestShelterStatusConstants(t *testing.T) {
	if domain.ShelterStatusPending != "pending" ||
		domain.ShelterStatusApproved != "approved" ||
		domain.ShelterStatusRejected != "rejected" {
		t.Errorf("unexpected shelter status constants: %q %q %q",
			domain.ShelterStatusPending, domain.ShelterStatusApproved, domain.ShelterStatusRejected)
	}
}
