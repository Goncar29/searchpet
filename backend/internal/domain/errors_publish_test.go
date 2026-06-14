package domain_test

import (
	"testing"

	"lost-pets/internal/domain"
)

func TestCodeFor_InitialReportErrors(t *testing.T) {
	cases := []struct {
		err      error
		wantCode string
	}{
		{domain.ErrInitialReportRequired, "initial_report_required"},
		{domain.ErrInitialReportNotAllowed, "initial_report_not_allowed"},
	}

	for _, tc := range cases {
		t.Run(tc.wantCode, func(t *testing.T) {
			got := domain.CodeFor(tc.err)
			if got != tc.wantCode {
				t.Errorf("CodeFor(%v) = %q, want %q", tc.err, got, tc.wantCode)
			}
		})
	}
}
