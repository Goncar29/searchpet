package tests

import (
	"testing"

	"lost-pets/internal/domain"
)

func TestFosterHomeErrorCodes(t *testing.T) {
	cases := map[error]string{
		domain.ErrFosterHomeNotFound:       "foster_home_not_found",
		domain.ErrFosterHomeAlreadyOwned:   "foster_home_already_owned",
		domain.ErrFosterHomeSuspended:      "foster_home_suspended",
		domain.ErrSuspensionReasonRequired: "suspension_reason_required",
		domain.ErrSelfAbuseReport:          "self_abuse_report",
		domain.ErrDuplicateAbuseReport:     "duplicate_abuse_report",
	}
	for err, want := range cases {
		if got := domain.CodeFor(err); got != want {
			t.Errorf("CodeFor(%v) = %q, want %q", err, got, want)
		}
	}
}
